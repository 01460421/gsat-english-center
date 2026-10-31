/**
 * 國寫範文獨立頁的資料與純函式（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」）：
 *
 *   歷屆題目   /data/zh-writing/prompts.json（shared 的 ZH_WRITING_PROMPTS_PATH；build-data.mjs 原樣輸出）：載入、依學年度分組。
 *              送給 Worker 的只有代號（題目文字由 Worker 用打包的同一份）。
 *   貼上題目   表單的草稿 → 送出的本體：題型、題目、素材與選填的字數規定。送出前在瀏覽器跑國文貼上的同一套檢查（shared 的
 *              zhPasteQuestion＋checkAssistQuestion(…, 'chinese', { writingPaste: true })，和 Worker 同一支：本站寫的字數規定區塊不算進
 *              長度、科目與任務字樣；D8 的官方文字指紋與比賽語料指紋只有 Worker 會查），擋下的問題依區塊放回對應的欄位（字數規定、
 *              素材、題目），同 Worker 的 field；訊息用 shared 的 ZH_PASTE_PROBLEM_MESSAGES（Worker 回的 message 也是這一份）。
 *   我的範文   列表一列的狀態文字、去掉「國寫範文・」前綴的標題。
 */
import {
  ASSIST_INPUT_PROBLEM_MESSAGES,
  ZH_EXEMPLAR_PASTE_LIMITS,
  ZH_PASTE_PROBLEM_MESSAGES,
  ZH_WRITING_PROMPTS_PATH,
  checkAssistQuestion,
  isZhWritingPromptFile,
  normalizeZhText,
  zhPasteLimitsProblem,
  zhPasteQuestion,
  type AssistInputProblem,
  type ZhExemplarListItem,
  type ZhExemplarPasteInput,
  type ZhExemplarPasteLimits,
  type ZhExemplarSection,
  type ZhWritingPrompt,
  type ZhWritingPromptFile,
} from '@gsat/shared';
import { fetchDataFile, memoizeAsync } from '../../../data/client';
import { ZH_WRITING_COPY } from './labels';

// ───────────────────────── 歷屆題目 ─────────────────────────

const promptsLoader = memoizeAsync((_key: 'zh-writing') => fetchDataFile<ZhWritingPromptFile>(ZH_WRITING_PROMPTS_PATH, isZhWritingPromptFile));

/** 載入歷屆國寫題目（同一頁面內只下載一次；失敗要等 forgetFailedLoads() 才重抓，理由見 data/client.ts）。 */
export function loadZhWritingPrompts(): Promise<ZhWritingPromptFile> {
  return promptsLoader('zh-writing');
}

/** 依學年度分組（新到舊；每年第一大題在前）。 */
export function zhPromptsByYear(prompts: readonly ZhWritingPrompt[]): Array<{ year: number; prompts: ZhWritingPrompt[] }> {
  const years = [...new Set(prompts.map((p) => p.year))].sort((a, b) => b - a);
  return years.map((year) => ({ year, prompts: prompts.filter((p) => p.year === year).sort((a, b) => a.number - b.number) }));
}

// ───────────────────────── 貼上題目 ─────────────────────────

/** 貼上表單的草稿（字數規定是輸入框的原始文字）。 */
export interface ZhPasteDraft {
  section: ZhExemplarSection | null;
  prompt: string;
  material: string;
  q1: string;
  body: string;
  lines: string;
}

export const EMPTY_ZH_PASTE_DRAFT: ZhPasteDraft = { section: null, prompt: '', material: '', q1: '', body: '', lines: '' };

/** 表單的欄位（Worker 的 field 也是 prompt／material／limits）。 */
export type ZhPasteField = 'section' | 'prompt' | 'material' | 'limits';

export interface ZhPasteProblem {
  field: ZhPasteField;
  message: string;
  /** 命中的位置（那一欄正規化後的文字；只是位置，不含任何受保護文字）。 */
  ranges: ReadonlyArray<readonly [number, number]> | null;
}

/** 字數規定的輸入框 → 數字（空白＝沒填；不是整數回 'invalid'）。情意題不送問題（一）。 */
export function zhPasteLimitsOf(draft: Pick<ZhPasteDraft, 'section' | 'q1' | 'body' | 'lines'>): ZhExemplarPasteLimits | null | 'invalid' {
  const parse = (raw: string): number | undefined | 'invalid' => {
    const t = raw.normalize('NFKC').trim();
    if (t === '') return undefined;
    return /^\d{1,5}$/.test(t) ? Number(t) : 'invalid';
  };
  const q1 = draft.section === 'zh_writing_emotion' ? undefined : parse(draft.q1);
  const body = parse(draft.body);
  const lines = parse(draft.lines);
  if (q1 === 'invalid' || body === 'invalid' || lines === 'invalid') return 'invalid';
  const out: ZhExemplarPasteLimits = {};
  if (q1 !== undefined) out.q1_chars = q1;
  if (body !== undefined) out.body_chars = body;
  if (lines !== undefined) out.body_lines = lines;
  return Object.keys(out).length > 0 ? out : null;
}

/** 題目區塊的種類 → 表單的欄位（同 Worker 的 PASTE_FIELD_OF_KIND；整體的問題放在題目那一欄）。 */
const FIELD_OF_KIND: Readonly<Record<string, ZhPasteField>> = { instructions: 'limits', passage: 'material', question: 'prompt' };

/**
 * 國文貼上的問題代碼 → 這一頁的說法：shared 的 ZH_PASTE_PROBLEM_MESSAGES（提到這一頁沒有的欄位——選項、「我有講義答案」、改選科目——
 * 或說「學習助手解析」的幾條改寫），其餘照學習助手（ASSIST_INPUT_PROBLEM_MESSAGES）。
 */
export function zhPasteProblemMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return ZH_PASTE_PROBLEM_MESSAGES[code as AssistInputProblem] ?? (ASSIST_INPUT_PROBLEM_MESSAGES as Record<string, string>)[code] ?? null;
}

/** Worker 回的 field（prompt／material／limits；其他當成題目）。 */
export function zhPasteFieldOf(field: string | null | undefined): ZhPasteField {
  return field === 'material' || field === 'limits' || field === 'section' ? field : 'prompt';
}

/**
 * 送出前的檢查：題型、題目必填、長度（同 Worker 的 schema）、字數規定的範圍與組合（shared 的 zhPasteLimitsProblem）、國文貼上的檢查
 * （writingPaste：答案或詳解段落、評分說明、範文佳作樣式、注入、長度、國寫的任務字樣）。每一欄只留第一個問題。
 */
export function checkZhPaste(draft: ZhPasteDraft): { ok: true; input: ZhExemplarPasteInput } | { ok: false; problems: ZhPasteProblem[] } {
  const L = ZH_EXEMPLAR_PASTE_LIMITS;
  const problems: ZhPasteProblem[] = [];
  const add = (field: ZhPasteField, message: string, ranges: ZhPasteProblem['ranges'] = null) => {
    if (!problems.some((p) => p.field === field)) problems.push({ field, message, ranges });
  };
  if (draft.section === null) add('section', ZH_WRITING_COPY.sectionMissing);
  if (draft.prompt.trim() === '') add('prompt', ZH_WRITING_COPY.promptMissing);
  else if (draft.prompt.length > L.promptMaxChars) add('prompt', ZH_WRITING_COPY.tooLong('題目', L.promptMaxChars));
  if (draft.material.length > L.materialMaxChars) add('material', ZH_WRITING_COPY.tooLong('素材', L.materialMaxChars));
  const limits = zhPasteLimitsOf(draft);
  if (limits === 'invalid') add('limits', ZH_WRITING_COPY.limitNotNumber);
  else if (draft.section !== null) {
    const problem = zhPasteLimitsProblem(draft.section, limits);
    if (problem) add('limits', problem);
  }
  if (draft.section === null || limits === 'invalid' || problems.length > 0) return { ok: false, problems };
  const material = draft.material.trim();
  const input: ZhExemplarPasteInput = {
    section: draft.section,
    prompt: draft.prompt.trim(),
    ...(material !== '' ? { material } : {}),
    ...(limits ? { limits } : {}),
  };
  const question = zhPasteQuestion(input);
  const check = checkAssistQuestion(question, 'chinese', { writingPaste: true });
  if (!check.ok) {
    for (const p of check.problems) {
      const m = /^blocks\[(\d+)\]\.text$/.exec(p.field);
      const kind = m ? question.blocks[Number(m[1])]?.kind : undefined;
      const field = (kind && FIELD_OF_KIND[kind]) || 'prompt';
      const ranges = p.start !== undefined && p.end !== undefined && kind ? [[p.start, p.end] as const] : null;
      add(field, zhPasteProblemMessage(p.code) ?? ZH_WRITING_COPY.fixAndRetry, ranges);
    }
    return { ok: false, problems };
  }
  return { ok: true, input };
}

/**
 * 加亮用的文字：那一欄送出時的區塊文字（正規化後，和 Worker 的 ranges 同一個座標）。字數規定是本站寫的那一行；
 * 草稿不完整時回 null。
 */
export function zhPasteFieldText(draft: ZhPasteDraft, field: ZhPasteField): string | null {
  if (draft.section === null || field === 'section') return null;
  const limits = zhPasteLimitsOf(draft);
  const input: ZhExemplarPasteInput = {
    section: draft.section,
    prompt: draft.prompt,
    material: draft.material,
    ...(limits && limits !== 'invalid' ? { limits } : {}),
  };
  const kind = field === 'limits' ? 'instructions' : field === 'material' ? 'passage' : 'question';
  const block = zhPasteQuestion(input).blocks.find((b) => b.kind === kind);
  return block ? normalizeZhText(block.text).text : null;
}

// ───────────────────────── 我的國寫範文 ─────────────────────────

/** 列表與結果頁的標題：去掉 Worker 加的「國寫範文・」前綴（頁面本身就是國寫範文）。 */
export function zhWritingDisplayTitle(title: string): string {
  return title.replace(/^國寫範文・/u, '') || title;
}

/** 列表一列的狀態：產生中、上一篇沒有完成（點數已退還）、N 篇示範、還沒有示範。 */
export function zhHistoryStatus(item: Pick<ZhExemplarListItem, 'latest' | 'exemplars'>): { text: string; tone: 'pending' | 'failed' | 'done' | 'none' } {
  const latest = item.latest;
  if (latest && (latest.status === 'queued' || latest.status === 'running')) return { text: ZH_WRITING_COPY.historyPending, tone: 'pending' };
  if (latest?.status === 'failed') {
    return item.exemplars > 0
      ? { text: `${ZH_WRITING_COPY.historyDone(item.exemplars)}・${ZH_WRITING_COPY.historyLastFailed}`, tone: 'failed' }
      : { text: ZH_WRITING_COPY.historyLastFailed, tone: 'failed' };
  }
  if (item.exemplars > 0) return { text: ZH_WRITING_COPY.historyDone(item.exemplars), tone: 'done' };
  return { text: ZH_WRITING_COPY.historyNone, tone: 'none' };
}
