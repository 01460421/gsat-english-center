/**
 * 國文的呼叫輸入（docs/design/assistant-subjects.md §3.5、§3.8、§6.1）：解析的 user 訊息、追問的三個 content block、轉錄、國寫範文。
 * 範本版本 assist-zh-user@1、assist-zh-followup-user@1、assist-zh-ocr-user@1、assist-zh-exemplar-user@2（prompts/assist-zh.ts、assist-zh-ocr.ts）。
 * 英文的 src/assist/requests.ts 一個字都不改：兩邊由 subjects/index.ts 依科目分派。
 *
 *   - 沿用現有的結構標籤，不加新標籤：<task>、<student_provided_question>、<student_text role="answer|draft|doubt|question">、
 *     <student_patterns>、<analysis_digest>、<conversation>（都在 filter.ts 的 STRUCTURAL_TAGS）。每一段文字放進提示前都經過
 *     neutralizeTags（整段，不逐行），學生文字裡的 </student_provided_question> 不能提早結束區塊。
 *   - <task> 是網站寫的：格式與子模式、要問的題、程式猜的題型、答案鍵（學生提供）、作答、研判的標籤與學生組合的逐句拆解、
 *     簡答的字數與抄錄規定、注釋、「同一份題目問另一部分」的前一個案例摘要、國寫片段、疑問、顯示模式。
 *   - 題目文字是國文路徑正規化後的原樣（①、輕聲、全形標點都保留，§4.1）；剩下的 [[?]] 換成 [unclear]。
 *   - 國文沒有站內題，請求一律不進共用快取；<student_patterns> 只帶國文的錯因次數（§7.3），沒有報告的弱點。
 *   - 追問的上下文不加 5 分鐘快取標記（國文多半只問一兩輪，寫入比讀取貴，§9.2）；題目截到 3,000 字（先截選文的中段）、
 *     解析摘要 ≤ 1,000 字、先前的問答 ≤ 1,200 字。
 *   - 送出的內容只有題目、學生的作答與文字；沒有 email、暱稱、帳號 id、案例 id。
 */
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  guessZhSection,
  isZhCaseKind,
  ZH_LINE_CELLS,
  type ZhExemplarLimits,
  type ZhExemplarSection,
  zhParseJudgeCombos,
  zhVerdictText,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type PhotoMime,
  type ZhCaseKind,
  type ZhCharLimit,
  type ZhChoiceMode,
  type ZhFollowupView,
} from '@gsat/shared';
import type { ClaudeCallInput } from '../../../ai/client';
import { neutralizeTags } from '../../../ai/filter';
import { taskBlock } from '../../../ai/prompts/common';
import {
  assistZhExemplarSchema,
  assistZhExemplarSystemText,
  assistZhFollowupSchema,
  assistZhFollowupSystemText,
  assistZhSchema,
  assistZhSystemText,
  ZH_ANALYZE_TEMPLATE_VERSIONS,
  ZH_EXEMPLAR_TEMPLATE_VERSION,
  ZH_FOLLOWUP_TEMPLATE_VERSION,
} from '../../../ai/prompts/assist-zh';
import { ASSIST_ZH_OCR_TEMPLATE_VERSION, assistZhOcrSchema, assistZhOcrSystemText, assistZhOcrUserText } from '../../../ai/prompts/assist-zh-ocr';
import { callSpec, type TaskConfig } from '../../../ai/tasks';
import { toBase64 } from '../../../submissions/images';
import type { AnalyzeRequestCase } from '../../requests';
import { zhQuestionNoteNumbers } from './notes';

/** 追問上下文的上限（字元；§3.5）。 */
export const ZH_FOLLOWUP_CONTEXT = { questionChars: 3_000, digestChars: 1_000, conversationChars: 1_200 } as const;
/** 「同一份題目問另一部分」放進 <task> 的前一個案例摘要上限（§1.6）。 */
export const ZH_RELATED_DIGEST_CHARS = 600;

/** 一段資料區塊（整段中和）。attrs 只放程式產生的值（題號、角色）。 */
function block(tag: string, body: string, attrs: Record<string, string> = {}): string {
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/["<>\n]/g, '')}"`)
    .join('');
  return `<${tag}${attrText}>\n${neutralizeTags(body)}\n</${tag}>`;
}

function zhKind(kind: string): ZhCaseKind {
  if (isZhCaseKind(kind)) return kind;
  throw new Error(`國文的請求不處理 ${kind}`);
}

/** 學生提供的題目：依區塊列出（[kind label]）；剩下的 [[?]] 換成 [unclear]。注釋區塊照列。 */
export function zhQuestionBody(q: Pick<AssistQuestionView, 'blocks'>): string {
  return (q.blocks ?? []).map((b) => `[${b.kind}${b.label ? ` ${b.label}` : ''}]\n${b.text.replaceAll('[[?]]', '[unclear]')}`).join('\n\n');
}

function labelOf(t: Pick<AssistQuestionTarget, 'display_label' | 'label'>): string {
  return t.display_label || t.label || 'the question';
}

function answerText(t: AssistQuestionTarget): string {
  const a = t.student_answer;
  if (a === null || a === undefined) return '';
  return typeof a === 'string' ? a : a.join('');
}

const MODE_TEXT: Record<ZhChoiceMode, string> = {
  single: 'single-choice',
  multi: 'multi-select',
  judge: 'numbered statements (judge every statement with the question\'s own labels; answer with the letter of the matching combination)',
  sequence: 'ordering',
};

function optionCount(t: AssistQuestionTarget): number {
  return Object.keys(t.options ?? {}).length;
}

/** 格式與子模式那一行（同一個案例的每一題子模式相同時只寫一次；不同時逐題寫）。 */
function formatLine(kind: ZhCaseKind, targets: readonly AssistQuestionTarget[]): string[] {
  if (kind === 'zh_short') return ['Subject: Chinese (國文). Output format: short answer (non-choice questions; one entry in parts per part listed below).'];
  if (kind === 'zh_writing') return ['Subject: Chinese (國文). Output format: composition guidance (國寫). Never write an essay, a grade or a score.'];
  const modes = [...new Set(targets.map((t) => t.choice_mode ?? 'single'))];
  const lines: string[] = [];
  if (modes.length === 1) {
    const mode = modes[0]!;
    const n = Math.max(0, ...targets.map(optionCount));
    const detail = mode === 'multi' ? ` (${n || 5} options, scored (n−2k)/n of 4 points)` : mode === 'single' && n > 0 ? ` (${n} options)` : '';
    lines.push(`Subject: Chinese (國文). Output format: choice; mode: ${MODE_TEXT[mode]}${detail}.`);
  } else {
    lines.push(`Subject: Chinese (國文). Output format: choice; modes: ${targets.map((t) => `${labelOf(t)} ${MODE_TEXT[t.choice_mode ?? 'single']}`).join('; ')}.`);
  }
  if (targets.some((t) => t.choice_mode === 'multi' && optionCount(t) === 5)) lines.push('5 options; in the official Chinese test these are multiple-select.');
  return lines;
}

/** 研判題：題目的標籤，以及學生選的組合（和答案鍵）拆成逐句的判斷。 */
function judgeLines(t: AssistQuestionTarget): string[] {
  if (t.choice_mode !== 'judge') return [];
  const labels = t.judge_labels ?? null;
  const out: string[] = [];
  const n = labelOf(t);
  if (labels) out.push(`Statement labels in ${n}: positive ${labels.positive}, negative ${labels.negative}, unknown ${labels.unknown}.`);
  const combos = t.options ? zhParseJudgeCombos(t.options, labels) : null;
  const explain = (who: string, letter: string) => {
    const combo = combos?.[letter];
    if (!combo) return;
    const parts = Object.entries(combo).map(([stmt, v]) => `${stmt} ${zhVerdictText(v, labels)}`);
    out.push(`${who} for ${n} is (${letter}), which means ${parts.join(', ')}.`);
  };
  const answer = answerText(t);
  if (answer.length === 1) explain('The student\'s choice', answer);
  const key = t.accepted?.join('') ?? '';
  if (key.length === 1) explain('The answer key', key);
  return out;
}

const COPY_TEXT: Record<ZhCharLimit['copy'], string> = {
  must: 'must copy words exactly from the text',
  must_not: 'must not copy the text (paraphrase)',
  none: 'no copying rule',
};

function limitText(l: ZhCharLimit): string {
  const size = l.max === null ? 'no length limit' : l.min !== null ? `${l.min}–${l.max} characters including punctuation` : `${l.max} characters including punctuation`;
  return `${size}${l.scope === 'total' ? ' in total' : l.scope === 'each' ? ' each' : ''}, ${COPY_TEXT[l.copy]}`;
}

/**
 * 題目裡的注釋標號（由小到大）：和 quotes.ts 的「注釋引用」檢查同一支偵測（notes.ts：注釋區塊、夾在區塊中間的「注釋：」段落、
 * 拍照轉錄的「注釋：①…」、題目裡的「注 N」）；沒有注釋時是空陣列。
 */
export function zhNoteNumbers(q: Pick<AssistQuestionView, 'blocks'>): number[] {
  return [...zhQuestionNoteNumbers(q)].sort((a, b) => a - b);
}

function notesLine(q: AssistQuestionView): string {
  const nums = zhNoteNumbers(q);
  if (nums.length === 0) return 'The question has no annotations.';
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1);
  const list = contiguous && nums.length > 2 ? `注${nums[0]}–注${nums[nums.length - 1]}` : nums.map((n) => `注${n}`).join('、');
  return `The question has annotations: ${list}.`;
}

function doubtsLine(c: AnalyzeRequestCase): string | null {
  if (c.doubtKinds.length === 0) return null;
  const parts = c.doubtKinds.map((d) => (d === 'torn_between' && c.tornWith ? `torn_between (${c.tornWith})` : d));
  return `The student's doubts: ${parts.join(', ')}.`;
}

export interface ZhAnalyzeExtras {
  /** <student_patterns>（只有國文的錯因次數；沒有資料是 null）。 */
  patterns: string | null;
  /** 「同一份題目問另一部分」的前一個案例摘要（≤ 600 字；digest.ts）；沒有是 null。 */
  related: string | null;
}

/** 國文解析的 <task> 各行（追問的上下文也用前半段）。 */
function zhTaskLines(c: AnalyzeRequestCase, extras: ZhAnalyzeExtras | null): string[] {
  const kind = zhKind(c.kind);
  const q = c.question;
  const t = q.targets;
  const labels = t.map(labelOf);
  const lines = [...formatLine(kind, t)];
  lines.push(t.length === 1 && t[0]!.label === '' ? 'Questions to explain: the question below.' : `${kind === 'zh_short' ? 'Parts' : 'Questions'} to explain, in this order: ${labels.join(', ')}.`);
  const guesses = t.flatMap((x) => {
    const g = x.stem ? guessZhSection(x.stem) : null;
    return g ? [`${labelOf(x)} ${g.section}`] : [];
  });
  if (guesses.length > 0) lines.push(`The program guesses the question types: ${guesses.join(', ')}; it may be wrong, so decide from the closed list yourself.`);
  if (kind === 'zh_choice') {
    const keyed = t.filter((x) => (x.accepted?.length ?? 0) > 0);
    lines.push(
      keyed.length > 0
        ? `Answer key: given by the student and not verified by the website: ${keyed.map((x) => `${labelOf(x)}: ${x.accepted!.join('')}`).join('; ')}.`
        : 'No answer key: answer yourself and set certainty honestly.',
    );
    const answered = t.filter((x) => answerText(x) !== '');
    lines.push(
      answered.length === 0
        ? `The student did not answer${c.hintFirst ? '; the page shows hints first' : ''}.`
        : `The student's answers: ${t.map((x) => `${labelOf(x)}: ${answerText(x) || 'no answer'}`).join('; ')}.`,
    );
    for (const x of t) lines.push(...judgeLines(x));
  } else if (kind === 'zh_short') {
    const limits = t.filter((x) => x.char_limit).map((x) => `${labelOf(x)}: ${limitText(x.char_limit!)}`);
    lines.push(limits.length > 0 ? `Character limits found in the question: ${limits.join('; ')}.` : 'No character limit was found in the question.');
    const answered = t.filter((x) => answerText(x) !== '');
    lines.push(
      answered.length === 0
        ? `The student did not answer${c.hintFirst ? '; the page shows hints first' : ''}.`
        : `The student's answers are in <student_text role="answer">, one per part (${answered.map(labelOf).join(', ')}).`,
    );
  } else if (q.draft) {
    lines.push(`The student's own paragraph is in <student_text role="draft">; it answers ${q.draft.target === 'q1' ? '問題（一）' : 'the essay (問題（二）, or the whole task)'}.`);
  }
  lines.push(notesLine(q));
  if (extras?.related) lines.push(`Related case: the student asked about other parts of this material earlier. Summary: ${extras.related}`);
  return lines;
}

function zhDataBlocks(c: AnalyzeRequestCase): string[] {
  const q = c.question;
  const out = [block('student_provided_question', zhQuestionBody(q))];
  if (c.kind === 'zh_short') {
    for (const t of q.targets) if (answerText(t) !== '') out.push(block('student_text', answerText(t), { role: 'answer', label: labelOf(t) }));
  }
  if (c.kind === 'zh_writing' && q.draft) out.push(block('student_text', q.draft.text, { role: 'draft' }));
  return out;
}

/** 國文解析的 user 訊息全文。 */
export function zhAnalyzeUserText(c: AnalyzeRequestCase, extras: ZhAnalyzeExtras): string {
  const taskLines = [
    ...zhTaskLines(c, extras),
    doubtsLine(c),
    c.doubt ? 'The student\'s own words are in <student_text role="doubt">.' : null,
    c.hintFirst ? 'Display: the website shows hints first; still fill every field.' : 'Display: the website shows the full explanation.',
  ];
  const parts = [taskBlock(taskLines), ...zhDataBlocks(c)];
  if (c.doubt) parts.push(block('student_text', c.doubt, { role: 'doubt' }));
  if (extras.patterns) parts.push(block('student_patterns', extras.patterns));
  return parts.join('\n');
}

/** 國文解析的呼叫輸入（consumer 正式送出；國文不進共用快取，路由不算快取鍵）。 */
export function zhAnalyzeCallInput(tc: TaskConfig, c: AnalyzeRequestCase, extras: ZhAnalyzeExtras): ClaudeCallInput {
  const kind = zhKind(c.kind);
  return {
    task: tc.task,
    spec: callSpec(tc, 'tutor'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistZhSystemText(kind),
    schema: assistZhSchema(kind),
    content: zhAnalyzeUserText(c, extras),
    templateVersion: ZH_ANALYZE_TEMPLATE_VERSIONS[kind],
  };
}

/**
 * <student_patterns>：這位學生其他國文案例的錯因次數（前 3 個；只有代碼與數字）。錯因代碼先過封閉清單（呼叫端傳進來的是 D1 的值）。
 */
export function zhStudentPatternsText(errorCounts: ReadonlyArray<{ code: string; n: number }>): string | null {
  const top = errorCounts.filter((e) => e.n > 0).slice(0, 3);
  return top.length > 0 ? `Error codes on this student's earlier Chinese questions (most frequent first): ${top.map((e) => `${e.code} ${e.n}`).join(', ')}.` : null;
}

// ───────────────────────── 追問 ─────────────────────────

/** 題目文字截到上限：要問的題、選項、注釋與題幹完整保留，先截選文（passage，注釋以外）的中段。 */
export function zhTrimQuestionBody(q: Pick<AssistQuestionView, 'blocks'>, limit: number = ZH_FOLLOWUP_CONTEXT.questionChars): string {
  const full = zhQuestionBody(q);
  if (full.length <= limit) return full;
  const blocks = (q.blocks ?? []).map((b) => ({ ...b }));
  const trimmable = blocks.filter((b) => b.kind === 'passage' && !(b.label !== null && /注|框/.test(b.label)));
  const MARK = '……（中略）……';
  let over = full.length - limit;
  for (const b of trimmable) {
    if (over <= 0) break;
    const chars = [...b.text];
    const cut = Math.min(chars.length - 40, over + MARK.length);
    if (cut <= MARK.length) continue;
    const keepHead = Math.floor((chars.length - cut) / 2);
    const keepTail = chars.length - cut - keepHead;
    b.text = `${chars.slice(0, keepHead).join('')}${MARK}${chars.slice(chars.length - keepTail).join('')}`;
    over -= cut - MARK.length;
  }
  const body = zhQuestionBody({ blocks });
  return body.length <= limit ? body : [...body].slice(0, limit).join('');
}

/** 一輪國文追問（對話用；只放學生的問題與回覆的 reply_zh、points）。 */
export interface ZhFollowupRound {
  question: string;
  reply: ZhFollowupView | null;
}

/** <conversation>：總長 ≤ 1,200 字元；最近 2 輪完整，更早的只留學生的問題；仍然太長時從最舊的整輪開始省略。 */
export function zhConversationText(rounds: readonly ZhFollowupRound[], limit: number = ZH_FOLLOWUP_CONTEXT.conversationChars): string {
  const n = rounds.length;
  const render = (r: ZhFollowupRound, full: boolean) => {
    const out = [`Student asked: ${r.question}`];
    if (full && r.reply) {
      out.push(`Tutor answered: ${r.reply.reply_zh}`);
      for (const p of r.reply.points ?? []) out.push(`- ${p.text_zh}${p.example ? `（${p.example}）` : ''}`);
    }
    return out.join('\n');
  };
  const parts = rounds.map((r, i) => render(r, i >= n - 2));
  const total = () => parts.reduce((sum, p) => sum + p.length, 0) + Math.max(0, parts.length - 1) * 2;
  while (parts.length > 1 && total() > limit) parts.shift();
  const text = parts.join('\n\n');
  return parts.length === 0 ? '(no earlier follow-up questions)' : text.length <= limit ? text : [...text].slice(-limit).join('');
}

export interface ZhFollowupRequest {
  case: AnalyzeRequestCase;
  /** 上一次解析的摘要（digest.ts，≤ 1,000 字）。 */
  digest: string;
  rounds: readonly ZhFollowupRound[];
  question: string;
  mode: 'hint' | 'explain';
  /** 追問針對的題（原始題號；null＝整組）。 */
  label: string | null;
}

/** 國文追問的三個 content block：上下文、對話、這一輪（都不加快取標記；系統提示仍是 1 小時快取）。 */
export function zhFollowupContent(r: ZhFollowupRequest): BetaContentBlockParam[] {
  const c = r.case;
  const digest = [...r.digest].slice(0, ZH_FOLLOWUP_CONTEXT.digestChars).join('');
  const context = [taskBlock(zhTaskLines(c, null)), block('student_provided_question', zhTrimQuestionBody(c.question)), block('analysis_digest', digest)].join('\n');
  const target = r.label === null ? null : c.question.targets.find((t) => t.label === r.label);
  const which = target ? `question ${labelOf(target)}` : 'the whole group';
  const turn = [taskBlock([`Mode: ${r.mode}.`, `Question: ${which}.`]), block('student_text', r.question, { role: 'question' })].join('\n');
  return [
    { type: 'text', text: context },
    { type: 'text', text: block('conversation', zhConversationText(r.rounds)) },
    { type: 'text', text: turn },
  ];
}

export function zhFollowupCallInput(tc: TaskConfig, r: ZhFollowupRequest): ClaudeCallInput {
  return {
    task: tc.task,
    spec: callSpec(tc, 'tutor'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistZhFollowupSystemText(),
    schema: assistZhFollowupSchema,
    content: zhFollowupContent(r),
    templateVersion: ZH_FOLLOWUP_TEMPLATE_VERSION,
  };
}

// ───────────────────────── 國寫範文（國寫範文設計 §2） ─────────────────────────

/** 國寫範文 <analysis_digest> 的上限（字）。 */
export const ZH_EXEMPLAR_DIGEST_CHARS = 1_000;

export interface ZhExemplarRequest {
  /** 案例存的題目（全部區塊：素材、圖表文字、引導問題；不含學生的段落）。 */
  question: Pick<AssistQuestionView, 'blocks'>;
  /** 題型（最新一次國寫指導的 section；看不出來時由 run.ts 決定）。 */
  section: ZhExemplarSection;
  /** 前一次國寫指導的摘要（digest.ts 的 zhAnalysisDigest，≤ 1,000 字）。 */
  digest: string;
  /** 國寫指導有沒有問題（一）（知性而且有，才要寫問題（一））。 */
  hasQ1: boolean;
  limits: ZhExemplarLimits;
}

/** 題目指定的題目（「以「…」為題」）；題目自訂回 'own'；沒有題目回 null。 */
export function zhExemplarTitleRule(question: Pick<AssistQuestionView, 'blocks'>): { title: string } | 'own' | null {
  const text = (question.blocks ?? []).map((b) => b.text).join('\n');
  const given = /以\s*[「『]([^「」『』\n]{1,16})[」』]\s*為題/u.exec(text);
  if (given) return { title: given[1]!.trim() };
  if (/題目自訂|自訂題目|自訂標題|自行命題|自訂一個題目/u.test(text)) return 'own';
  return null;
}

/**
 * 有行數規定時，每段預留的格數（段首兩格＋最後一行沒寫滿的格）。隨機長度的段落平均約 13 格，但模型常把段落寫得一樣長，
 * 每段都剛好多出一行時接近 21 格；取 19：400 字、至多 19 行（418 格）時目標上緣 342 字，四段一樣長也寫得進。
 */
export const ZH_EXEMPLAR_CELLS_PER_PARAGRAPH = 19;
/** 情意全文的預設目標（字，含標點）與段數（題目沒有另外規定字數或行數時；同 <task> 原本的寫法）。 */
const ZH_EMOTION_AIM = { chars: [650, 750], paragraphs: [4, 5] } as const;

/**
 * 範文主體（知性的問題（二）、情意的全文）要模型瞄準的字數與段數（國寫範文設計 §5.2）。答題卷每段首空兩格、段末不滿一行也算
 * 一整行，所以題目有行數規定時，字數還沒到上限格子就先用完（例如 400 字、至多 19 行＝418 格：四段各 90 字就要 440 格）。
 * 有行數規定時目標上緣取「字數上限的 95%」與「格數 − 每段預留 × 最多段數」較小的那一個，知性題少寫一段（3–4 段）；
 * 情意題另有字數規定時上緣不超過字數上限的 95%。沒有另外規定時和原本相同（知性 85–95%、3–5 段；情意 650–750 字、4–5 段）。
 */
export function zhExemplarBodyAim(L: ZhExemplarLimits): { chars: [number, number]; paragraphs: [number, number] } {
  const cellsCap = (paragraphs: number) => (L.body.lines !== null ? L.body.maxCells - ZH_EXEMPLAR_CELLS_PER_PARAGRAPH * paragraphs : Infinity);
  if (L.section === 'zh_writing_reason') {
    const maxChars = L.body.maxChars ?? L.body.maxCells;
    const paragraphs: [number, number] = L.body.lines !== null ? [3, 4] : [3, 5];
    const hi = Math.max(0, Math.min(Math.floor(maxChars * 0.95), cellsCap(paragraphs[1])));
    return { chars: [Math.max(0, Math.min(Math.floor(maxChars * 0.85), hi - 30)), hi], paragraphs };
  }
  const [lo0, hi0] = ZH_EMOTION_AIM.chars;
  const paragraphs: [number, number] = [...ZH_EMOTION_AIM.paragraphs];
  const hi = Math.max(0, Math.min(hi0, L.body.maxChars !== null ? Math.floor(L.body.maxChars * 0.95) : hi0, cellsCap(paragraphs[1])));
  return { chars: [Math.max(0, Math.min(lo0, hi - (hi0 - lo0))), hi], paragraphs };
}

/** 國寫範文的 <task> 各行（網站寫的；只有程式產生的值）。 */
export function zhExemplarTaskLines(r: Pick<ZhExemplarRequest, 'question' | 'section' | 'hasQ1' | 'limits'>): string[] {
  const lines = [`Subject: Chinese (國文). Output: one model answer for a 國寫 task (${r.section}). Never write a grade or a score.`];
  const L = r.limits;
  const aim = zhExemplarBodyAim(L);
  if (r.section === 'zh_writing_reason') {
    if (r.hasQ1 && L.q1) lines.push(`問題（一）: at most ${L.q1.maxChars} characters including punctuation.`);
    else lines.push('問題（一） does not apply: leave q1 empty.');
    if (L.body.lines === null) lines.push(`問題（二）: at most ${L.body.maxChars} characters including punctuation.`);
    else {
      // 行數規定：說明格子怎麼算，並給扣掉段首與段末空格之後的目標（取代系統提示的 85–95%）。
      lines.push(
        `問題（二）: at most ${L.body.maxChars} characters including punctuation, at most ${L.body.lines} lines of ${ZH_LINE_CELLS} cells. ` +
          `Each paragraph starts with two empty cells and its last line counts as a full line, so the lines run out before the characters: ` +
          `write ${aim.paragraphs[0]}–${aim.paragraphs[1]} paragraphs and aim for ${aim.chars[0]}–${aim.chars[1]} characters including punctuation (this replaces the 85–95% target).`,
      );
    }
  } else {
    lines.push('問題（一） does not apply: leave q1 empty.');
    lines.push(
      'The essay must fit one side of the answer sheet: 38 lines of 22 cells; each paragraph starts with two empty cells. Aim for 650–750 characters including punctuation in 4–5 paragraphs.',
    );
    if (L.body.maxChars !== null) lines.push(`The task also limits the essay to at most ${L.body.maxChars} characters including punctuation.`);
    if (L.body.lines !== null) lines.push(`The task also limits the essay to at most ${L.body.lines} lines of ${ZH_LINE_CELLS} cells.`);
    if (aim.chars[1] !== ZH_EMOTION_AIM.chars[1]) {
      lines.push(`Because of these limits, aim for ${aim.chars[0]}–${aim.chars[1]} characters including punctuation instead (a paragraph's last line counts as a full line).`);
    }
  }
  const title = zhExemplarTitleRule(r.question);
  lines.push(title === null ? 'No title.' : title === 'own' ? 'Write a title of at most 12 characters.' : `Title given: 「${title.title.replace(/[「」]/gu, '')}」`);
  return lines;
}

/** 國寫範文的 user 訊息：<task>、<student_provided_question>（全部區塊）、<analysis_digest>。不送學生的段落、疑問或錯因。 */
export function zhExemplarUserText(r: ZhExemplarRequest): string {
  const digest = [...r.digest].slice(0, ZH_EXEMPLAR_DIGEST_CHARS).join('');
  return [taskBlock(zhExemplarTaskLines(r)), block('student_provided_question', zhQuestionBody(r.question)), block('analysis_digest', digest)].join('\n');
}

export function zhExemplarCallInput(tc: TaskConfig, r: ZhExemplarRequest): ClaudeCallInput {
  return {
    task: tc.task,
    spec: callSpec(tc, 'writer'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistZhExemplarSystemText(),
    schema: assistZhExemplarSchema,
    content: zhExemplarUserText(r),
    templateVersion: ZH_EXEMPLAR_TEMPLATE_VERSION,
  };
}

// ───────────────────────── 轉錄 ─────────────────────────

/** 國文轉錄的呼叫輸入：照片在前（依 ord）、固定的文字在後；沒有任何學生文字（同英文 ocr.ts 的寫法）。 */
export function zhOcrCallInput(tc: TaskConfig, photos: Array<{ mime: PhotoMime; bytes: Uint8Array }>): ClaudeCallInput {
  const content: BetaContentBlockParam[] = [
    ...photos.map((p): BetaContentBlockParam => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: toBase64(p.bytes) } })),
    { type: 'text', text: assistZhOcrUserText(photos.length) },
  ];
  return {
    task: tc.task,
    spec: callSpec(tc, 'ocr'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistZhOcrSystemText(),
    schema: assistZhOcrSchema,
    content,
    templateVersion: ASSIST_ZH_OCR_TEMPLATE_VERSION,
  };
}
