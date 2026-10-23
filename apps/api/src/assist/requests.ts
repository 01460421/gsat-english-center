/**
 * 學習助手的呼叫輸入（docs/design/learning-assistant.md §4.9）：解析的 user 訊息、追問的三個 content block、<student_patterns>。
 * 路由（共用快取鍵）與 consumer（正式送出）都從這裡組，所以快取鍵＝實際送出的 user 訊息的雜湊（§4.7.4）。
 *
 *   - 只讀 assist_cases 的 question_json 與案例欄位，不再抓題目檔。
 *   - 每一段題目、解析、學生文字放進提示前都經過 neutralizeTags（整段，不逐行）：任何一段文字都不能提早結束或偽造一個區塊。
 *   - 可以進共用快取的請求（站內題、沒有自由輸入的疑問）不帶 <student_text> 與 <student_patterns>，和學生身分無關；
 *     <student_patterns> 只有代碼與數字（consumer 從 D1 算好傳進來）。
 *   - 送出的內容只有題目、本站解析與統計、學生的作答與文字；沒有 email、暱稱、帳號 id、案例 id（§6.2 第 13 條）。
 *   - 追問的上下文 block 帶 cache_control（5 分鐘）：同一題後續的追問，這個 block 逐位元相同。<conversation> 總長 ≤ 3,000 字元，
 *     最近 2 輪完整、更早的只留學生的問題，以整輪為單位從最舊的開始省略。
 */
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  ASSIST_LIMITS,
  ASSIST_SECTION_LABELS,
  TIER_LABELS,
  type AnswerValue,
  type AssistAnalysisView,
  type AssistCaseKind,
  type AssistDoubtKind,
  type AssistFollowupMode,
  type AssistFollowupView,
  type AssistQuestionTarget,
  type AssistQuestionView,
  type AssistSource,
  type AssistVocabView,
  type AssistWritingView,
} from '@gsat/shared';
import type { ClaudeCallInput } from '../ai/client';
import { maskD8, type D8Fingerprints } from '../ai/d8';
import { neutralizeTags } from '../ai/filter';
import { ASSIST_ANALYZE_TEMPLATE_VERSIONS, assistAnalyzeSchema, assistAnalyzeSystemText } from '../ai/prompts/assist-analyze';
import { ASSIST_FOLLOWUP_TEMPLATE_VERSION, assistFollowupOutputSchema, assistFollowupSystemText } from '../ai/prompts/assist-followup';
import { callSpec, type TaskConfig } from '../ai/tasks';
import { WRITING_D8_MASK_TEXT } from './sources';

/** 解析請求需要的案例欄位。 */
export interface AnalyzeRequestCase {
  source: AssistSource;
  kind: AssistCaseKind;
  question: AssistQuestionView;
  doubtKinds: readonly AssistDoubtKind[];
  tornWith: string | null;
  doubt: string | null;
  hintFirst: boolean;
  /** 歷屆題是從歷屆試題還是真題模考來的（ref_json.via）。 */
  via: 'exam' | 'mock' | null;
}

/**
 * 能不能讀寫共用快取（§4.7.4）：站內題（題庫、自組卷、歷屆）、沒有自由輸入的疑問，而且作答裡沒有學生自己打的文字
 * （hasFreeTextAnswer）：快取不存任何學生文字（§4.17）。
 */
export function isCacheable(c: Pick<AnalyzeRequestCase, 'source' | 'kind' | 'doubt' | 'question'>): boolean {
  return (
    (c.source === 'bank' || c.source === 'bank_mock' || c.source === 'exam') &&
    c.kind === 'item' &&
    (c.doubt === null || c.doubt.trim() === '') &&
    !hasFreeTextAnswer(c.question)
  );
}

const OPTION_LETTER_RE = /^[A-O]$/;

/** 選項代號（或代號的清單、空白）：不是學生自己打的文字。 */
function isLetterAnswer(a: AnswerValue): boolean {
  return typeof a === 'string' ? a.trim() === '' || OPTION_LETTER_RE.test(a) : a.every((x) => OPTION_LETTER_RE.test(x));
}

/**
 * 作答裡有沒有學生自己打的文字：要問的題與同組其他題的作答，只要有一個不是選項代號、也不是本站的答案寫法
 * （可接受答案或部分給分的寫法，前後空白不計）就算。這種請求的提示裡有學生的原文，不進共用快取。
 */
export function hasFreeTextAnswer(q: Pick<AssistQuestionView, 'targets' | 'group_answers'>): boolean {
  for (const t of q.targets) {
    const a = t.student_answer;
    if (a === null || isLetterAnswer(a)) continue;
    const known = [...(t.accepted ?? []), ...(t.explanation?.partial_credit_forms ?? [])].map((s) => s.trim());
    if (typeof a === 'string' && known.includes(a.trim())) continue;
    return true;
  }
  return Object.values(q.group_answers ?? {}).some((a) => !isLetterAnswer(a));
}

/** 一段資料區塊（整段中和）。attrs 只放程式產生的值（題號、角色），不放任何身分資訊。 */
function block(tag: string, body: string, attrs: Record<string, string> = {}): string {
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/["<>\n]/g, '')}"`)
    .join('');
  return `<${tag}${attrText}>\n${neutralizeTags(body)}\n</${tag}>`;
}

/** <task> 的每一行也中和（站內題的題號與字母只會是驗證過的值，學生題目的題號也只是資料）。 */
function taskBlock(lines: Array<string | null | false | undefined>): string {
  return `<task>\n${lines
    .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
    .map(neutralizeTags)
    .join('\n')}\n</task>`;
}

function answerText(a: AnswerValue | null | undefined): string {
  if (a === null || a === undefined) return '';
  return typeof a === 'string' ? a : a.join(', ');
}

/** 題號清單的英文：「question 23」「questions 23 and 27」「questions 21, 23 and 27」。 */
function questionsPhrase(labels: readonly string[]): string {
  if (labels.length === 1) return `question ${labels[0]}`;
  return `questions ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

function sourceLine(c: AnalyzeRequestCase): string {
  const q = c.question;
  switch (c.source) {
    case 'exam':
      return `Source: an official past exam paper (${q.origin_label}); the answer key and the national statistics are official.${c.via === 'mock' ? ' The student took this paper as a timed mock exam on the website.' : ''}`;
    case 'bank':
      return `Source: a practice item written by this website in the style of the GSAT (not an official exam question); difficulty tier ${q.tier ?? 'unknown'}${q.tier ? ` (${TIER_LABELS[q.tier]})` : ''}. The website's own explanation is in <site_explanation>.`;
    case 'bank_mock':
      return `Source: a practice item from a mock exam the website assembled from its own practice bank (not an official exam question); difficulty tier ${q.tier ?? 'unknown'}. The website's own explanation is in <site_explanation>.`;
    case 'vocab':
      return 'Source: words from the student\'s vocabulary mistake notebook on this website.';
    case 'writing':
      return q.trust === 'student'
        ? 'Source: the student\'s own writing for a task the student supplied; the website cannot verify where the task comes from.'
        : `Source: the student's own writing for ${q.origin_label === '' ? 'a task' : `a task from ${q.origin_label}`}${q.tier ? ' (a practice task written by this website)' : ''}.`;
    case 'typed':
    case 'photo':
      return 'Source: a question supplied by the student (photographed or typed); the website cannot verify where it comes from.';
  }
}

function sectionLine(q: AssistQuestionView): string | null {
  return q.section ? `Section: ${q.section} (${ASSIST_SECTION_LABELS[q.section]}).` : null;
}

/** 一題的答案、判定與作答（<task> 裡的一行）。 */
function targetLine(t: AssistQuestionTarget, trust: 'site' | 'student'): string {
  const n = t.display_label || 'the question';
  if (trust === 'student') {
    const answer = answerText(t.student_answer) !== '' ? `the student's answer is in <student_answer label="${t.display_label}">` : 'the student did not give an answer';
    return `Question ${n}: answer key not given (work it out yourself); ${answer}.`;
  }
  const key =
    t.accepted === null || t.accepted.length === 0
      ? 'not given'
      : t.mode === 'multi_select'
        ? `${t.accepted.join(', ')} (all of these and only these)`
        : t.accepted.length === 1
          ? t.accepted[0]
          : `${t.accepted.join(' or ')} (any of these receives credit)`;
  const verdict =
    t.verdict_basis === 'client'
      ? `${t.verdict} (judged on the student's device)`
      : t.verdict === 'unknown'
        ? 'not judged by the program (the official key lists only some accepted answers)'
        : t.verdict;
  const answer = answerText(t.student_answer) !== '' ? `the student's answer is in <student_answer label="${t.display_label}">` : 'the student left it blank';
  return `Question ${n}: mode ${t.mode}; answer key ${key}; program verdict ${verdict}; ${answer}.`;
}

function doubtsLine(c: AnalyzeRequestCase, target: AssistQuestionTarget | undefined): string {
  const parts = c.doubtKinds.map((d) => {
    if (d === 'torn_between' && c.tornWith) {
      const mine = answerText(target?.student_answer);
      return mine ? `torn between ${mine} and ${c.tornWith}` : `torn between two options, one of them ${c.tornWith}`;
    }
    return d;
  });
  return `Doubts the student selected: ${parts.length > 0 ? parts.join('; ') : 'none'}.`;
}

function displayLine(hintFirst: boolean): string {
  return hintFirst ? 'Display: the website shows hints first; still fill every field.' : 'Display: the website shows the full explanation.';
}

function optionsText(options: Record<string, string> | null): string[] {
  return options ? Object.entries(options).map(([k, v]) => `(${k}) ${v}`) : [];
}

/** 站內題的 <question>：說明、選文、圖的文字描述、共用選項、這次問的題（題幹與選項）。 */
function siteQuestionBody(q: AssistQuestionView): string {
  const lines: string[] = [];
  if (q.instructions) lines.push(`Instructions: ${q.instructions}`);
  if (q.passage) lines.push(`Passage:\n${q.passage}`);
  if (q.figure_text) lines.push(`Figures (described in words):\n${q.figure_text}`);
  if (q.shared_options) lines.push(`Options shared by the whole group:\n${optionsText(q.shared_options).join('\n')}`);
  for (const t of q.targets) {
    const head = `Question ${t.display_label}${t.stem ? `: ${t.stem}` : ''}`;
    lines.push([head, ...optionsText(t.options)].join('\n'));
  }
  return lines.join('\n\n');
}

/** 學生提供的題目：依區塊列出；剩下的 [[?]] 換成 [unclear]（§2.5）。 */
function studentQuestionBody(q: AssistQuestionView): string {
  return (q.blocks ?? [])
    .map((b) => `[${b.kind}${b.label ? ` ${b.label}` : ''}]\n${b.text.replaceAll('[[?]]', '[unclear]')}`)
    .join('\n\n');
}

/** 本站解析（只放這次問的題；JSON，鍵是卷面題號）。 */
function siteExplanationBody(q: AssistQuestionView): string | null {
  const items = q.targets.filter((t) => t.explanation !== null).map((t) => `Question ${t.display_label}: ${JSON.stringify(t.explanation)}`);
  if (items.length === 0) return null;
  if (q.elimination) items.push(`Elimination table (feasible options per blank): ${JSON.stringify(q.elimination)}`);
  return items.join('\n');
}

function rate(v: number | null): string {
  return v === null ? '-' : v.toFixed(2);
}

/** 歷屆題的全國統計（一題一行）。多選題的官方數字是得分率（含部分給分），全對的比例另外列。 */
function examStatsBody(q: AssistQuestionView): string | null {
  const lines = q.targets
    .filter((t) => t.stats !== null)
    .map((t) => {
      const s = t.stats!;
      const parts =
        t.mode === 'multi_select'
          ? [
              `question ${t.display_label}: national score rate ${rate(s.correct_rate)} (partial credit counted; not the share answering fully correctly)`,
              ...(s.full_correct_rate !== undefined && s.full_correct_rate !== null ? [`fully correct ${rate(s.full_correct_rate)}`] : []),
            ]
          : [`question ${t.display_label}: national correct rate ${rate(s.correct_rate)}`];
      if (s.option_rates) parts.push(`option rates ${Object.entries(s.option_rates).map(([k, v]) => `${k} ${rate(v)}`).join(', ')}`);
      if (s.high !== null || s.low !== null) parts.push(`top third ${rate(s.high)}, bottom third ${rate(s.low)}`);
      if (s.five_groups) parts.push(`five groups from top 20% to bottom 20%: ${s.five_groups.map(rate).join(', ')}`);
      return parts.join('; ');
    });
  return lines.length > 0 ? lines.join('\n') : null;
}

function studentAnswerBlocks(q: AssistQuestionView): string[] {
  const out = q.targets.filter((t) => answerText(t.student_answer) !== '').map((t) => block('student_answer', answerText(t.student_answer), { label: t.display_label }));
  if (q.group_answers) {
    const display = new Map(q.siblings.map((s) => [s.label, s.display_label]));
    for (const [label, value] of Object.entries(q.group_answers)) {
      if (answerText(value) === '') continue;
      out.push(block('student_answer', answerText(value), { label: display.get(label) ?? label, context: 'another question in the group' }));
    }
  }
  return out;
}

// ───────────────────────── 解析的 user 訊息 ─────────────────────────

/** item 的 <task>（不含疑問與顯示模式：追問的上下文 block 也用這一段）。 */
function itemTaskLines(c: AnalyzeRequestCase): string[] {
  const q = c.question;
  const labels = q.targets.map((t) => t.display_label).filter((l) => l !== '');
  const lines = [
    sourceLine(c),
    sectionLine(q),
    labels.length === 0 ? 'The student is asking about the question below.' : `The student is asking about ${questionsPhrase(labels)}${labels.length > 1 ? ' of one group' : ''}.`,
    ...q.targets.map((t) => targetLine(t, q.trust)),
  ];
  if (q.trust === 'site' && q.siblings.length > 0) {
    lines.push(`Other questions in this group (not asked about): ${q.siblings.map((s) => s.display_label).join(', ')}.${q.group_answers ? ' The student\'s answers to them are given for spotting chain errors.' : ''}`);
  }
  if (c.source === 'bank_mock') lines.push('The student saw this group numbered as on their paper; always use these question numbers and option letters.');
  return lines.filter((l): l is string => l !== null);
}

function itemDataBlocks(c: AnalyzeRequestCase): string[] {
  const q = c.question;
  const out: string[] = [];
  if (q.trust === 'student') out.push(block('student_provided_question', studentQuestionBody(q)));
  else out.push(block('question', siteQuestionBody(q)));
  const explanation = siteExplanationBody(q);
  if (explanation) out.push(block('site_explanation', explanation));
  const stats = examStatsBody(q);
  if (stats) out.push(block('exam_stats', stats));
  out.push(...studentAnswerBlocks(q));
  return out;
}

/** 寫作：學生的作答（中譯英一句一個 block）；整篇貼上官方譯文的部分遮掉（§2.6）。 */
function writingAnswerBlocks(q: AssistQuestionView, fp: D8Fingerprints | null): string[] {
  const w = q.writing;
  if (!w) return [];
  const mask = (text: string) => (w.d8_masked > 0 && fp ? maskD8(text, fp, WRITING_D8_MASK_TEXT).text : text);
  if (w.kind === 'translation') return w.student_text.split('\n').map((s, i) => block('student_text', mask(s), { role: 'answer', sentence: String(i + 1) }));
  return [block('student_text', mask(w.student_text), { role: 'answer' })];
}

function writingTaskLines(c: AnalyzeRequestCase): string[] {
  const w = c.question.writing;
  const digest = (w?.grading_digest ?? null) as { score?: { final: number; max: number } } | null;
  return [
    sourceLine(c),
    w?.kind === 'translation' ? 'Kind: translation (two Chinese sentences, 4 points each).' : 'Kind: composition (20 points).',
    digest?.score ? `Score from the website's grading: ${digest.score.final} / ${digest.score.max}.` : null,
    'The grading result is in <site_explanation>; the student\'s answer is in <student_text role="answer">.',
  ].filter((l): l is string => l !== null);
}

function writingDataBlocks(c: AnalyzeRequestCase, fp: D8Fingerprints | null): string[] {
  const q = c.question;
  const w = q.writing;
  if (!w) return [];
  const task = q.trust === 'student' ? block('student_provided_question', [w.prompt, q.figure_text ? `Pictures or charts, described by the student:\n${q.figure_text}` : ''].filter(Boolean).join('\n\n')) : block('question', w.prompt);
  const explanation = [`Grading result: ${JSON.stringify(w.grading_digest)}`, w.site_reference ? `Website notes for this practice task: ${JSON.stringify(w.site_reference)}` : ''].filter(Boolean).join('\n');
  return [task, block('site_explanation', explanation), ...writingAnswerBlocks(q, fp)];
}

function vocabTaskLines(c: AnalyzeRequestCase): string[] {
  const n = c.question.vocab?.entries.length ?? 0;
  return [sourceLine(c), `The student is asking about ${n} word${n === 1 ? '' : 's'} they got wrong; write one entry per entry_id in <question>.`];
}

function vocabDataBlocks(c: AnalyzeRequestCase): string[] {
  const entries = c.question.vocab?.entries ?? [];
  const body = entries
    .map((e) =>
      [
        `entry_id: ${e.entry_id}`,
        `word: ${e.word}; level ${e.level}; part of speech ${e.pos.join(', ') || '-'}; meanings: ${e.zh}; CEFR ${e.cefr ?? '-'}; in past exams ${e.exam_total} times (${e.exam_answer} times as the answer)`,
        `the student got it wrong ${e.wrong_count} times; quiz type ${e.mode}`,
      ].join('\n'),
    )
    .join('\n\n');
  return [block('question', body)];
}

export interface AnalyzeExtras {
  /** <student_patterns>（只有不進快取的請求才有；只有代碼與數字）。 */
  patterns: string | null;
  /** D8 指紋（寫作的學生文字整篇命中時遮罩用；其他來源用不到）。 */
  fp: D8Fingerprints | null;
}

/** 解析的 user 訊息全文（快取鍵的雜湊對象）。 */
export function analyzeUserText(c: AnalyzeRequestCase, extras: AnalyzeExtras): string {
  const cacheable = isCacheable(c);
  const target = c.question.targets[0];
  const doubtLines = [doubtsLine(c, target), !cacheable && c.doubt ? 'The student\'s own words are in <student_text role="doubt">.' : null];
  let taskLines: Array<string | null>;
  let data: string[];
  switch (c.kind) {
    case 'item':
      taskLines = [...itemTaskLines(c), ...doubtLines, displayLine(c.hintFirst)];
      data = itemDataBlocks(c);
      break;
    case 'writing':
      taskLines = [...writingTaskLines(c), ...doubtLines];
      data = writingDataBlocks(c, extras.fp);
      break;
    case 'vocab':
      taskLines = [...vocabTaskLines(c), ...doubtLines];
      data = vocabDataBlocks(c);
      break;
  }
  const parts = [taskBlock(taskLines), ...data];
  if (!cacheable && c.doubt) parts.push(block('student_text', c.doubt, { role: 'doubt' }));
  if (!cacheable && extras.patterns) parts.push(block('student_patterns', extras.patterns));
  return parts.join('\n');
}

/** 解析的呼叫輸入（路由算快取鍵、consumer 正式送出都用這一支）。 */
export function analyzeCallInput(tc: TaskConfig, c: AnalyzeRequestCase, extras: AnalyzeExtras): ClaudeCallInput {
  return {
    task: tc.task,
    spec: callSpec(tc, 'tutor'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistAnalyzeSystemText(c.kind),
    schema: assistAnalyzeSchema(c.kind),
    content: analyzeUserText(c, extras),
    templateVersion: ASSIST_ANALYZE_TEMPLATE_VERSIONS[c.kind],
  };
}

/**
 * <student_patterns>（§4.9）：這位學生案例上的錯因次數（前 3 個）與最新一版報告的弱點 area。只有代碼與數字，沒有任何自由文字；
 * 錯因代碼與 area 都先過封閉清單（呼叫端傳進來的是 D1 的值）。沒有任何資料時回 null（不帶這個區塊）。
 */
export function studentPatternsText(errorCounts: ReadonlyArray<{ code: string; n: number }>, weakAreas: readonly string[]): string | null {
  const lines: string[] = [];
  const top = errorCounts.filter((e) => e.n > 0).slice(0, 3);
  if (top.length > 0) lines.push(`Error codes on this student's earlier questions (most frequent first): ${top.map((e) => `${e.code} ${e.n}`).join(', ')}.`);
  if (weakAreas.length > 0) lines.push(`Weak areas in the student's latest study report: ${weakAreas.slice(0, 5).join(', ')}.`);
  return lines.length > 0 ? lines.join('\n') : null;
}

// ───────────────────────── 追問 ─────────────────────────

/** 上一次解析的摘要（固定格式；同一份解析逐位元相同）。 */
export function analysisDigest(analysis: AssistAnalysisView | AssistWritingView | AssistVocabView): string {
  const lines: string[] = [];
  const steps = (xs: readonly string[]) => xs.map((s, i) => `  ${i + 1}. ${s}`);
  switch (analysis.kind) {
    case 'item':
      if (analysis.tested_zh) lines.push(`Tested: ${analysis.tested_zh}`);
      if (analysis.structure_zh) lines.push(`Structure: ${analysis.structure_zh}`);
      for (const it of analysis.items) {
        lines.push(`Question ${it.display_label || it.label}: verdict ${it.verdict}; student's answer ${answerText(it.student_answer) || '(blank)'}.`);
        if (it.diagnosis.summary_zh || it.diagnosis.detail_zh) lines.push(`  Diagnosis: ${[it.diagnosis.summary_zh, it.diagnosis.detail_zh].filter(Boolean).join(' ')}`);
        if (it.diagnosis.error_codes.length > 0) lines.push(`  Error codes: ${it.diagnosis.error_codes.join(', ')}`);
        if (it.option_contrast_zh) lines.push(`  Option contrast: ${it.option_contrast_zh}`);
        if (it.solution_steps.length > 0) lines.push('  Steps:', ...steps(it.solution_steps.map((s) => s.text_zh)).map((s) => `  ${s}`));
        for (const t of it.traps) lines.push(`  Trap ${t.option ? `(${t.option})` : ''}: ${t.explain_zh}`);
      }
      if (analysis.method.title_zh) lines.push(`Method: ${analysis.method.title_zh}`, ...steps(analysis.method.steps_zh));
      for (const k of analysis.knowledge) lines.push(`Knowledge: ${k.title_zh}: ${k.explain_zh}`);
      break;
    case 'writing':
      if (analysis.overview_zh) lines.push(`Overview: ${analysis.overview_zh}`);
      for (const b of analysis.by_category) lines.push(`Category ${b.category}: "${b.student_quote}" → ${b.rule_zh}`);
      for (const c of analysis.criteria) lines.push(`${c.criterion}: ${c.issue_zh} Next: ${c.next_step_zh}`);
      for (const s of analysis.sentence_plan) lines.push(`Sentence ${s.sentence_index + 1}: main clause ${s.main_clause_zh}; tense trigger ${s.tense_trigger_zh}`);
      if (analysis.rewrite_steps_zh.length > 0) lines.push('Next time:', ...steps(analysis.rewrite_steps_zh));
      break;
    case 'vocab':
      for (const g of analysis.groups) lines.push(`Group ${g.theme_zh}: ${g.contrast_zh}`);
      for (const e of analysis.entries) lines.push(`${e.word}: ${e.senses.map((s) => `${s.pos} ${s.zh}`).join('; ')}`);
      break;
  }
  return lines.join('\n');
}

/** 一輪追問（對話用；只放學生的問題與回覆的 reply_zh、points）。 */
export interface FollowupRound {
  question: string;
  reply: AssistFollowupView | null;
}

/**
 * <conversation>：總長 ≤ 3,000 字元；最近 2 輪完整（問題＋回覆與重點），更早的只留學生的問題；仍然太長時從最舊的整輪開始省略。
 * 以整輪為單位截斷，所以同樣的對話每一次組出來都一樣。
 */
export function conversationText(rounds: readonly FollowupRound[], limit: number = ASSIST_LIMITS.followupContextChars): string {
  const n = rounds.length;
  const render = (r: FollowupRound, full: boolean) => {
    const out = [`Student asked: ${r.question}`];
    if (full && r.reply) {
      out.push(`Tutor answered: ${r.reply.reply_zh}`);
      for (const p of r.reply.points) out.push(`- ${p.text_zh}${p.example_en ? ` (${p.example_en})` : ''}`);
    }
    return out.join('\n');
  };
  const parts = rounds.map((r, i) => render(r, i >= n - 2));
  const total = () => parts.reduce((sum, p) => sum + p.length, 0) + Math.max(0, parts.length - 1) * 2;
  while (parts.length > 1 && total() > limit) parts.shift();
  return parts.length > 0 ? parts.join('\n\n') : '(no earlier follow-up questions)';
}

export interface FollowupRequest {
  case: AnalyzeRequestCase;
  analysis: AssistAnalysisView | AssistWritingView | AssistVocabView;
  rounds: readonly FollowupRound[];
  question: string;
  mode: AssistFollowupMode;
  /** 追問針對的題（原始題號；null＝整組）。 */
  label: string | null;
  fp: D8Fingerprints | null;
}

/** 追問的三個 content block：上下文（快取 5 分鐘）、對話、這一輪。 */
export function followupContent(r: FollowupRequest): BetaContentBlockParam[] {
  const c = r.case;
  const taskLines = c.kind === 'item' ? itemTaskLines(c) : c.kind === 'writing' ? writingTaskLines(c) : vocabTaskLines(c);
  const data = c.kind === 'item' ? itemDataBlocks(c) : c.kind === 'writing' ? writingDataBlocks(c, r.fp) : vocabDataBlocks(c);
  const context = [taskBlock(taskLines), ...data, block('analysis_digest', analysisDigest(r.analysis))].join('\n');
  const target = r.label === null ? null : c.question.targets.find((t) => t.label === r.label);
  const which = target ? `question ${target.display_label || 'asked'}` : 'the whole group';
  const turn = [taskBlock([`Mode: ${r.mode}.`, `Question: ${which}.`]), block('student_text', r.question, { role: 'question' })].join('\n');
  return [
    { type: 'text', text: context, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: block('conversation', conversationText(r.rounds)) },
    { type: 'text', text: turn },
  ];
}

export function followupCallInput(tc: TaskConfig, r: FollowupRequest): ClaudeCallInput {
  return {
    task: tc.task,
    spec: callSpec(tc, 'tutor'),
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistFollowupSystemText(),
    schema: assistFollowupOutputSchema,
    content: followupContent(r),
    templateVersion: ASSIST_FOLLOWUP_TEMPLATE_VERSION,
  };
}

/** 案例列 → 組請求需要的欄位（路由與 consumer 共用，快取鍵才會一致）。 */
export function requestCaseOf(
  row: { source: AssistSource; kind: AssistCaseKind; ref_json: string; doubt_kinds_json: string; torn_with: string | null; doubt_text: string | null; hint_first: number },
  question: AssistQuestionView,
): AnalyzeRequestCase {
  let via: 'exam' | 'mock' | null = null;
  let doubtKinds: AssistDoubtKind[] = [];
  try {
    const ref = JSON.parse(row.ref_json) as { via?: unknown };
    if (ref.via === 'exam' || ref.via === 'mock') via = ref.via;
  } catch {
    via = null;
  }
  try {
    const kinds = JSON.parse(row.doubt_kinds_json) as unknown;
    if (Array.isArray(kinds)) doubtKinds = kinds.filter((k): k is AssistDoubtKind => typeof k === 'string') as AssistDoubtKind[];
  } catch {
    doubtKinds = [];
  }
  return {
    source: row.source,
    kind: row.kind,
    question,
    doubtKinds,
    tornWith: row.torn_with,
    doubt: row.doubt_text,
    hintFirst: row.hint_first === 1,
    via,
  };
}
