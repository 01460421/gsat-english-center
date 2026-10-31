/**
 * 國寫範文的獨立頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」小節）：不必先在學習助手建國寫案例、看國寫指導，
 * 直接選一題歷屆國寫或貼上自己的國寫題目，就能看一篇 AI 示範。這裡放前端與 Worker 共用的部分：
 *
 *   歷屆題目     data/zh-writing/prompts.json（gsat-zh-writing-prompts/v1）的型別與守衛、轉成學習助手的題目區塊。
 *                111–115 學測國寫的十題（每年知性、情意各一），只有題本上的題目、素材、引導問題與字數規定（試題不受著作權保護，
 *                著作權法第 9 條第 1 項第 5 款）；沒有任何參考答案、評分原則、佳作或試題分析（D8）。圖只抄錄圖上的文字。
 *                網站建置時複製到 /data/zh-writing/prompts.json（前端選題用），Worker 建置時打包（apps/api/src/generated/）。
 *   貼上題目     題目、素材與選填的字數規定 → 學習助手的題目區塊（之後由 Worker 用國文貼上的同一套檢查：D8、答案區、注入、長度；
 *                checkZhQuestion 的 writingPaste：長度、科目與任務字樣只看學生的題目與素材）。學生填的字數規定由本站寫成一個區塊放在
 *                最前面（模型與畫面看得到）；Worker 讀題目的規定時不算這個區塊，再用 zhApplyPasteLimits 直接套用學生填的數字
 *                （zhStandaloneExemplarLimits；題目文字裡也寫了規定時，以學生填的為準）。字數規定的範圍與組合（zhPasteLimitsProblem）
 *                擋掉寫不出來的數字（行數太少、行數裝不下字數、知性兩題放不進一面），不讓學生付了點數才失敗退還。
 *   API 型別     POST /api/assist/zh-exemplars 的本體與回應、GET /api/assist/zh-exemplars 的列表。
 *
 * 資料仍存在學習助手（一個國文的國寫案例＋範文的 turn）：保存與刪除照學習助手（180 天、可以自己刪），隱私權說明不必改版。
 */
import { ASSIST_LIMITS, type AssistInputProblem, type AssistQuestionBlock, type AssistQuestionView, type AssistStudentQuestion, type AssistTaskAccepted } from './assist';
import { ZH_LINE_CELLS, ZH_TEXT_LIMITS } from './assist-zh';
import {
  ZH_EXEMPLAR_DEFAULT_LIMITS,
  ZH_EXEMPLAR_TARGETS,
  ZH_SHEET_CELLS,
  zhExemplarLimits,
  type ZhExemplarLimits,
  type ZhExemplarSection,
} from './assist-zh-exemplar';
import type { AiRefundReason } from './writing';

// ───────────────────────── 歷屆題目（data/zh-writing/prompts.json） ─────────────────────────

export const ZH_WRITING_PROMPTS_FORMAT = 'gsat-zh-writing-prompts/v1';
/** 網站上的路徑（相對於 /data/；apps/web/scripts/build-data.mjs 輸出）。 */
export const ZH_WRITING_PROMPTS_PATH = 'zh-writing/prompts.json';
/** 題目代號：zh-{學年度}-{第幾大題}（1＝知性、2＝情意）。 */
export const ZH_WRITING_PROMPT_ID_RE = /^zh-1\d{2}-[12]$/;

export const ZH_EXEMPLAR_SECTIONS = ['zh_writing_reason', 'zh_writing_emotion'] as const satisfies readonly ZhExemplarSection[];

export function isZhExemplarSection(v: unknown): v is ZhExemplarSection {
  return typeof v === 'string' && (ZH_EXEMPLAR_SECTIONS as readonly string[]).includes(v);
}

/** 題目印的一個字數規定：字數（含標點）與行數（「至多 N 行」；沒寫是 null）。 */
export interface ZhWritingPromptLimit {
  chars: number;
  lines: number | null;
}

/** 一題歷屆國寫。 */
export interface ZhWritingPrompt {
  id: string;
  year: number;
  /** 第幾大題（1＝知性、2＝情意）。 */
  number: 1 | 2;
  section: ZhExemplarSection;
  /** 列表上的短標（本站寫的幾個字）。 */
  topic: string;
  /** 題目指定的題目（「以「…」為題」）；沒有指定是 null。 */
  title_given: string | null;
  /** 素材（依序）：passage 是題本的文字（段落以換行分開）；figure 是本站把圖改寫成的文字（只抄錄圖上的字）。 */
  material: Array<{ kind: 'passage' | 'figure'; text: string }>;
  /** 引導問題（「請分項回答下列問題：」起，含問題（一）（二）與配分，照題本）。 */
  prompt: string;
  /** 題目印的字數規定（知性：問題（一）與問題（二）；情意：題本沒寫時兩個都是 null）。 */
  limits: { q1: ZhWritingPromptLimit | null; body: ZhWritingPromptLimit | null };
  /** 題本上字數規定的原文（顯示用；沒有規定是空陣列）。 */
  limits_printed: string[];
  /** 題本有圖時是 described（圖改寫成文字）；沒有圖是 none。 */
  figures: 'none' | 'described';
}

export interface ZhWritingPromptFile {
  format: typeof ZH_WRITING_PROMPTS_FORMAT;
  note: string;
  prompts: ZhWritingPrompt[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isLimit(v: unknown): v is ZhWritingPromptLimit | null {
  if (v === null) return true;
  return (
    isRecord(v) &&
    Number.isInteger(v['chars']) &&
    (v['chars'] as number) > 0 &&
    (v['lines'] === null || (Number.isInteger(v['lines']) && (v['lines'] as number) > 0))
  );
}

function isPrompt(v: unknown): v is ZhWritingPrompt {
  if (!isRecord(v)) return false;
  const limits = v['limits'];
  const material = v['material'];
  return (
    typeof v['id'] === 'string' &&
    ZH_WRITING_PROMPT_ID_RE.test(v['id']) &&
    Number.isInteger(v['year']) &&
    (v['number'] === 1 || v['number'] === 2) &&
    isZhExemplarSection(v['section']) &&
    typeof v['topic'] === 'string' &&
    v['topic'] !== '' &&
    (v['title_given'] === null || (typeof v['title_given'] === 'string' && v['title_given'] !== '')) &&
    Array.isArray(material) &&
    material.length >= 1 &&
    material.every((b) => isRecord(b) && (b['kind'] === 'passage' || b['kind'] === 'figure') && typeof b['text'] === 'string' && b['text'].trim() !== '') &&
    typeof v['prompt'] === 'string' &&
    v['prompt'].trim() !== '' &&
    isRecord(limits) &&
    isLimit(limits['q1']) &&
    isLimit(limits['body']) &&
    Array.isArray(v['limits_printed']) &&
    v['limits_printed'].every((s) => typeof s === 'string') &&
    (v['figures'] === 'none' || v['figures'] === 'described')
  );
}

/** 歷屆題目檔的守衛（格式、每一題的欄位、代號不重複、代號和學年度與大題一致）。 */
export function isZhWritingPromptFile(v: unknown): v is ZhWritingPromptFile {
  if (!isRecord(v) || v['format'] !== ZH_WRITING_PROMPTS_FORMAT || typeof v['note'] !== 'string' || !Array.isArray(v['prompts'])) return false;
  const prompts = v['prompts'] as unknown[];
  if (!prompts.every(isPrompt)) return false;
  const ids = new Set(prompts.map((p) => p.id));
  return ids.size === prompts.length && prompts.every((p) => p.id === `zh-${p.year}-${p.number}`);
}

/** 一題歷屆國寫的名稱：「111 學測國寫・第一大題（知性）」。 */
export function zhWritingPromptLabel(p: Pick<ZhWritingPrompt, 'year' | 'number'>): string {
  return `${p.year} 學測國寫・${p.number === 1 ? '第一大題（知性）' : '第二大題（情意）'}`;
}

/** 歷屆題目 → 學習助手的題目區塊：素材依序（題本的文字是 passage、改寫的圖是 figure），最後是引導問題（question）。 */
export function zhWritingPromptBlocks(p: Pick<ZhWritingPrompt, 'material' | 'prompt'>): AssistQuestionBlock[] {
  return [...p.material.map((b) => ({ kind: b.kind, label: null, text: b.text })), { kind: 'question' as const, label: null, text: p.prompt }];
}

/** 歷屆題目 → 送進國文貼上檢查的題目（國寫格式；沒有作答與片段）。 */
export function zhWritingPromptQuestion(p: Pick<ZhWritingPrompt, 'material' | 'prompt'>): AssistStudentQuestion {
  return { blocks: zhWritingPromptBlocks(p), target_labels: [], format: 'writing' };
}

// ───────────────────────── 貼上題目 ─────────────────────────

/**
 * 貼上的上限：題目（引導問題）與素材各自的字元數（精確的長度與內容規則在國文貼上的檢查：全部合計 ≤ 6,000 字元），
 * 選填的字數規定的範圍（問題（一）20–200 字；問題（二）200–680 字、10–38 行；情意全文 300–1,200 字、15–38 行）。
 * 下限：範文的主體要寫 3–5 段（模型瞄準上限的 85–95%，段首空兩格、段末不滿一行也算一行），太少的數字寫不出來，模型一定超過，
 * 要付費重寫、最後退還（審查 2026-10-30：學生把問題（一）的「至多 4 行」填進行數欄）。知性問題（二）的上限 680＋問題（一）
 * 預設 80＝一面答題卷寫得下的 760 字（reasonSheetChars）。
 */
export const ZH_EXEMPLAR_PASTE_LIMITS = {
  promptMaxChars: 2_000,
  materialMaxChars: 5_000,
  q1Chars: [20, 200],
  bodyChars: { zh_writing_reason: [200, 680], zh_writing_emotion: [300, 1_200] },
  bodyLines: { zh_writing_reason: [10, 38], zh_writing_emotion: [15, 38] },
  /** 知性：問題（一）與問題（二）寫在同一面答題卷，兩題的字數合計上限（含標點；沒填的用預設 80／400）。 */
  reasonSheetChars: 760,
} as const satisfies {
  promptMaxChars: number;
  materialMaxChars: number;
  q1Chars: readonly [number, number];
  bodyChars: Record<ZhExemplarSection, readonly [number, number]>;
  bodyLines: Record<ZhExemplarSection, readonly [number, number]>;
  reasonSheetChars: number;
};

/** 貼上時選填的字數規定（沒有填＝看題目裡寫的，題目也沒寫就用本站預設）。 */
export interface ZhExemplarPasteLimits {
  /** 知性的問題（一）（字，含標點）。情意題不能填。 */
  q1_chars?: number | null;
  /** 知性的問題（二）或情意全文（字，含標點）。 */
  body_chars?: number | null;
  /** 同上的行數（「至多 N 行」，每行 22 格）。 */
  body_lines?: number | null;
}

/**
 * 字數規定的問題（給前端與 Worker 同一份訊息；Worker 在預扣之前擋）；沒有問題回 null。依序：情意不能填問題（一）→ 各欄的範圍
 * （依題型）→ 行數裝得下字數（每行 22 格）→ 知性兩題放得進一面答題卷（行數：問題（一）約幾行＋問題（二）的行數 ≤ 38；
 * 字數：合計 ≤ reasonSheetChars，沒填的用預設）。
 */
export function zhPasteLimitsProblem(section: ZhExemplarSection, limits: ZhExemplarPasteLimits | null | undefined): string | null {
  if (!limits) return null;
  const L = ZH_EXEMPLAR_PASTE_LIMITS;
  const sheetLines = Math.round(ZH_SHEET_CELLS / ZH_LINE_CELLS);
  const given = (v: number | null | undefined): v is number => v !== null && v !== undefined;
  const within = (v: number | null | undefined, [lo, hi]: readonly [number, number]) => !given(v) || (Number.isInteger(v) && v >= lo && v <= hi);
  const reason = section === 'zh_writing_reason';
  const part = reason ? '問題（二）' : '全文';
  if (!reason && given(limits.q1_chars)) return '情意題沒有問題（一），不用填問題（一）的字數';
  if (!within(limits.q1_chars, L.q1Chars)) return `問題（一）的字數請填 ${L.q1Chars[0]}–${L.q1Chars[1]} 的整數`;
  const chars = L.bodyChars[section];
  if (!within(limits.body_chars, chars)) return `${part}的字數請填 ${chars[0]}–${chars[1]} 的整數`;
  const lines = L.bodyLines[section];
  if (!within(limits.body_lines, lines)) return `${part}的行數請填 ${lines[0]}–${lines[1]} 的整數${reason ? '（問題（一）的行數不用填）' : ''}`;
  if (given(limits.body_lines) && given(limits.body_chars) && limits.body_lines * ZH_LINE_CELLS < limits.body_chars) {
    return `行數和字數對不上：${limits.body_lines} 行最多只能寫 ${limits.body_lines * ZH_LINE_CELLS} 字（每行 ${ZH_LINE_CELLS} 格），請再對一次題目的規定`;
  }
  if (reason) {
    const q1 = limits.q1_chars ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q1Chars;
    // 問題（一）的答案是一段：段首空兩格，最後一行不滿也算一行。
    const q1Lines = Math.ceil((q1 + 2) / ZH_LINE_CELLS);
    if (given(limits.body_lines) && q1Lines + limits.body_lines > sheetLines) {
      return `問題（一）和問題（二）要寫在同一面答題卷（${sheetLines} 行）：問題（一）約 ${q1Lines} 行，問題（二）最多填 ${sheetLines - q1Lines} 行`;
    }
    const body = Math.min(limits.body_chars ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q2Chars, given(limits.body_lines) ? limits.body_lines * ZH_LINE_CELLS : Infinity);
    if (q1 + body > L.reasonSheetChars) return `問題（一）和問題（二）要寫在同一面答題卷：兩題的字數合計最多 ${L.reasonSheetChars} 字`;
  }
  return null;
}

/** 本站寫的字數規定區塊的開頭（zhPasteLimitText）。 */
export const ZH_PASTE_LIMITS_HEAD = '字數規定（你填的）';

/**
 * 選填的字數規定 → 本站寫的一行（寫法同題本：「問題（一）：文長限 80 字以內。」「問題（二）：文長限 400 字以內（至多 19 行）。」
 * 情意：「文長限 600 字以內（至多 30 行）。」）；什麼都沒填回 null。只有行數時寫「文長至多 N 行。」。這個區塊給模型與畫面看，
 * 上限的數字由 zhApplyPasteLimits 直接套用。
 */
export function zhPasteLimitText(section: ZhExemplarSection, limits: ZhExemplarPasteLimits | null | undefined): string | null {
  if (!limits) return null;
  const body = (chars: number | null | undefined, lines: number | null | undefined): string | null => {
    const c = chars ?? null;
    const l = lines ?? null;
    if (c === null && l === null) return null;
    if (c === null) return `文長至多 ${l} 行。`;
    return `文長限 ${c} 字以內${l !== null ? `（至多 ${l} 行）` : ''}。`;
  };
  const out: string[] = [];
  if (section === 'zh_writing_reason') {
    if (limits.q1_chars !== null && limits.q1_chars !== undefined) out.push(`問題（一）：文長限 ${limits.q1_chars} 字以內。`);
    const b = body(limits.body_chars, limits.body_lines);
    if (b) out.push(`問題（二）：${b}`);
  } else {
    const b = body(limits.body_chars, limits.body_lines);
    if (b) out.push(b);
  }
  return out.length > 0 ? `${ZH_PASTE_LIMITS_HEAD}：\n${out.join('\n')}` : null;
}

/** 這個區塊是本站寫的字數規定嗎（zhPasteQuestion 放在最前面的 instructions；學生自己的題目與素材是 question／passage）。 */
export function zhIsPasteLimitsBlock(b: Pick<AssistQuestionBlock, 'kind' | 'text'>): boolean {
  return b.kind === 'instructions' && b.text.startsWith(`${ZH_PASTE_LIMITS_HEAD}：`);
}

/** 貼上的國寫題目（POST 本體裡 source 是 paste 的欄位）。 */
export interface ZhExemplarPasteInput {
  section: ZhExemplarSection;
  /** 引導問題（必填）：題目要你寫什麼、問題（一）（二）。 */
  prompt: string;
  /** 素材（選填）：引文、資料、圖表的文字描述。 */
  material?: string | null;
  limits?: ZhExemplarPasteLimits | null;
}

/**
 * 貼上的題目 → 送進國文貼上檢查的題目：本站寫的字數規定（有填時，放最前面）、素材（passage）、引導問題（question）。
 * 不檢查內容（Worker 用國文貼上的同一套檢查；前端送出前先用 checkAssistQuestion(…, 'chinese', { writingPaste: true }) 預檢）。
 */
export function zhPasteQuestion(input: ZhExemplarPasteInput): AssistStudentQuestion {
  const limitText = zhPasteLimitText(input.section, input.limits);
  const material = (input.material ?? '').trim();
  const blocks: AssistQuestionBlock[] = [
    ...(limitText ? [{ kind: 'instructions' as const, label: null, text: limitText }] : []),
    ...(material !== '' ? [{ kind: 'passage' as const, label: null, text: material }] : []),
    { kind: 'question', label: null, text: input.prompt.trim() },
  ];
  return { blocks, target_labels: [], format: 'writing' };
}

/**
 * 學生填的字數規定蓋過從題目讀到的上限（zhExemplarLimits 的結果）：題目文字裡的規定和本站寫的那一行可能同時存在，zhCharLimits
 * 只讀一串「問題（一）（二）」，所以學生填的數字由這裡直接套用（Worker 的 <task> 與後處理都用套用後的值）。沒填的欄位照原值。
 */
export function zhApplyPasteLimits(base: ZhExemplarLimits, paste: ZhExemplarPasteLimits | null | undefined): ZhExemplarLimits {
  if (!paste) return base;
  const pct = (max: number, [lo, hi]: readonly [number, number]): [number, number] => [Math.floor(max * lo), Math.floor(max * hi)];
  const lines = paste.body_lines ?? base.body.lines;
  const maxCells = Math.min(ZH_SHEET_CELLS, lines !== null ? lines * ZH_LINE_CELLS : ZH_SHEET_CELLS);
  const givenChars = paste.body_chars ?? null;
  if (base.section === 'zh_writing_reason') {
    const q1 = paste.q1_chars ?? base.q1?.maxChars ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q1Chars;
    const maxChars = givenChars ?? base.body.maxChars ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q2Chars;
    return {
      ...base,
      q1: { maxChars: q1 },
      body: { maxChars, charsFromQuestion: givenChars !== null || base.body.charsFromQuestion, maxCells, lines },
      target: { q1: pct(q1, ZH_EXEMPLAR_TARGETS.q1), body: pct(maxChars, ZH_EXEMPLAR_TARGETS.q2) },
    };
  }
  const maxChars = givenChars ?? base.body.maxChars;
  return {
    ...base,
    q1: null,
    body: { maxChars, charsFromQuestion: maxChars !== null, maxCells, lines },
    target: { q1: null, body: maxChars !== null ? pct(maxChars, ZH_EXEMPLAR_TARGETS.q2) : [...ZH_EXEMPLAR_TARGETS.emotionChars] },
  };
}

/**
 * 獨立頁案例的範文上限（Worker 的 consumer 用）：先從題目本身讀規定——**不含本站寫的字數規定區塊**——再用 zhApplyPasteLimits
 * 套用學生填的數字。那個區塊放在最前面，若一起讀，zhCharLimits 會把「問題（二）：文長限 N 字」當成第一個「問題（一）」之前的
 * 題幹規定，套到題目沒有自己規定的問題（一）（審查 2026-10-30：只填問題（二）400 字，問題（一）也變成 400 字）。
 */
export function zhStandaloneExemplarLimits(
  question: Pick<AssistQuestionView, 'blocks'>,
  section: ZhExemplarSection,
  paste: ZhExemplarPasteLimits | null | undefined,
): ZhExemplarLimits {
  const blocks = (question.blocks ?? []).filter((b) => !zhIsPasteLimitsBlock(b));
  return zhApplyPasteLimits(zhExemplarLimits({ blocks }, section), paste);
}

/**
 * 國文貼上的問題代碼 → 國寫範文頁的說法（前端顯示、Worker 回的 message 都用這一份；沒列的照學習助手的 ASSIST_INPUT_PROBLEM_MESSAGES）：
 * 提到這一頁沒有的欄位（選項、「我有講義答案」、改選科目）或說「學習助手解析」的幾條改寫（這一頁就是要 AI 寫示範）。
 */
export const ZH_PASTE_PROBLEM_MESSAGES: Readonly<Partial<Record<AssistInputProblem, string>>> = {
  text_too_short: `題目太短了，請把題目的引導文字一起貼上（題目與素材合計至少 ${ZH_TEXT_LIMITS.pasteWritingHanMin} 個字）。`,
  subject_mismatch: '這看起來不是國寫題目：題目與素材要以中文為主。',
  zh_answer_section: '請刪掉答案與解析再送出（已加亮那一段）。',
  request_to_ai: '題目欄只放題目本身，不要寫給 AI 的要求（例如「幫我寫」「照某篇的寫法」）。',
  text_too_long: `題目、素材與字數規定合計最多 ${ASSIST_LIMITS.questionMaxChars.toLocaleString('en-US')} 字元。只貼這一題的題目與素材就好。`,
};

/** 題目裡有沒有「問題（一）」（知性題要不要寫問題（一）的答案；沒有國寫指導時由題目判斷）。 */
export function zhHasWritingQ1(text: string): boolean {
  return /問題\s*[（(]\s*一\s*[）)]/u.test(text);
}

// ───────────────────────── API ─────────────────────────

/**
 * POST /api/assist/zh-exemplars：
 *   past   選一題歷屆國寫（prompt_id 是 data/zh-writing/prompts.json 的代號）；
 *   paste  貼上自己的國寫題目（section 由學生選：知性或情意）；
 *   case   同一個案例再看一篇（失敗後重試、看第二篇）：只限這個頁面建立的案例，或已經有國寫指導的國寫案例。
 * past 與 paste 會先找同一題的案例（同一位使用者、180 天內）：有就在那個案例上再加一篇（每案例最多 2 篇），沒有就建立新案例。
 */
export type CreateZhExemplarBody =
  | { source: 'past'; prompt_id: string }
  | ({ source: 'paste' } & ZhExemplarPasteInput)
  | { source: 'case'; case_id: string };

/**
 * 回應：202＝已排入（status queued，points 8）；200＝同一題已經有一篇正在產生（existing: true，沒有另外扣點，turn_id 是那一篇）。
 * 之後輪詢 GET /api/assist/cases/{case_id}，範文在 turns 裡 kind 是 zh_exemplar 的那一筆（exemplar 欄位）。
 */
export interface ZhExemplarAccepted extends AssistTaskAccepted {
  existing?: true;
}

/** 案例從哪裡來：past／paste＝這個頁面建立的；assistant＝學習助手的國寫案例（先看過國寫指導）。 */
export type ZhExemplarOrigin = 'past' | 'paste' | 'assistant';

/** 「我的國寫範文」的一列（一個案例；範文本身在案例詳情）。 */
export interface ZhExemplarListItem {
  case_id: string;
  title: string;
  origin: ZhExemplarOrigin;
  /** 歷屆題目的代號（origin 是 past 才有）。 */
  prompt_id: string | null;
  /** 題型（這個頁面建立的案例一定有；學習助手的案例是國寫指導判斷的題型）。 */
  section: ZhExemplarSection | null;
  /** 完成的範文篇數。 */
  exemplars: number;
  /** 這個案例還能再看幾篇（每案例 2 篇，完成＋進行中；失敗的不算）。 */
  remaining: number;
  /** 最新一篇（不論成敗）；沒有任何一篇（只有這頁建立、還沒排入就失敗的情況不會發生）是 null。 */
  latest: { turn_id: string; status: 'queued' | 'running' | 'done' | 'failed'; failure: AiRefundReason | null; created_at: number } | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

/** GET /api/assist/zh-exemplars?cursor=：新到舊，每頁 20 列（游標同案例列表）。 */
export interface ZhExemplarListResponse {
  items: ZhExemplarListItem[];
  next_cursor: string | null;
}

/** 頁面上那一行保存說明（範文和學習助手的紀錄存在一起）。 */
export const ZH_EXEMPLAR_RECORDS_NOTE = `國寫範文和學習助手的紀錄存在一起：最後一次使用後保存 ${ASSIST_LIMITS.retentionDays} 天，也可以隨時自己刪除。`;
