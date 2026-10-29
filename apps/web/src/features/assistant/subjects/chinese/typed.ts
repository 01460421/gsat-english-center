/**
 * 國文表單的純函式（docs/design/assistant-subjects.md §1.3、§4.2、§8.2）：題號清單、把貼上的文字依題號切成區塊、
 * 依表單組出送給 API 的題目（AssistStudentQuestion）、點數的計點單位。前端的檢查一律再跑 shared 的 checkZhQuestion，
 * 這裡只負責把表單變成它吃的形狀。
 */
import {
  ASSIST_TARGET_BLOCK_KINDS,
  ZH_LABEL_PATTERN,
  assistItemCount,
  assistPoints,
  guessZhFormat,
  normalizeZhText,
  zhKindOfFormat,
  zhSplitPartLabel,
  type AssistQuestionBlock,
  type AssistQuestionView,
  type AssistStudentQuestion,
  type ZhCaseKind,
  type ZhChoiceMode,
  type ZhFormat,
  type ZhFormatGuess,
} from '@gsat/shared';

/** 「要問的題號」輸入框 → 題號清單（頓號、逗號、空白分開；全形英數換半形；去重）。 */
export function parseZhLabels(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[、,，;；\s]+/u)) {
    const label = normalizeZhText(part).text;
    if (label !== '' && !out.includes(label)) out.push(label);
  }
  return out;
}

/** 格式不對的題號（國文的題號格式，例如 12、34(1)、一、甲）。 */
export function invalidZhLabels(labels: readonly string[]): string[] {
  return labels.filter((l) => [...l].length > 8 || !ZH_LABEL_PATTERN.test(l));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 題號在一行開頭的寫法：「26.」「26、」「（26）」「第26題」「26 」；後面一定要接分隔，26 不會撞到 260。 */
function labelStartRe(base: string): RegExp {
  return new RegExp(`^[ \\t\\u3000]*(?:第[ \\t]*)?[（(]?[ \\t]*${escapeRe(base)}[ \\t]*[)）]?(?:[ \\t]*題)?(?=[ \\t\\u3000.．、:：，,)）]|$)`, 'mu');
}

/**
 * 貼上的文字 → 題目區塊。只問一題（或沒填題號）時整段是一個題目區塊（同英文）；問好幾題時依題號在行首的位置切開：
 * 第一題之前的文字（選文、注釋、說明）是一個 passage 區塊，每一題是一個帶題號的 question 區塊。
 * 找不到的題號回在 missing（畫面請學生確認題號和題目裡寫的一樣），這時不切。
 */
export function zhTypedBlocks(text: string, figure: string, labels: readonly string[]): { blocks: AssistQuestionBlock[]; missing: string[] } {
  const tail: AssistQuestionBlock[] = figure.trim() !== '' ? [{ kind: 'figure', label: null, text: figure }] : [];
  const bases = [...new Set(labels.map((l) => zhSplitPartLabel(l).base))];
  if (bases.length <= 1) {
    return { blocks: [{ kind: 'question', label: bases[0] ?? null, text }, ...tail], missing: [] };
  }
  const starts: Array<{ base: string; at: number }> = [];
  const missing: string[] = [];
  for (const base of bases) {
    const m = labelStartRe(base).exec(text);
    if (m) starts.push({ base, at: m.index });
    else missing.push(base);
  }
  if (missing.length > 0) return { blocks: [{ kind: 'question', label: null, text }, ...tail], missing };
  starts.sort((a, b) => a.at - b.at);
  const blocks: AssistQuestionBlock[] = [];
  const lead = text.slice(0, starts[0]!.at);
  if (lead.trim() !== '') blocks.push({ kind: 'passage', label: null, text: lead });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.at : text.length;
    blocks.push({ kind: 'question', label: s.base, text: text.slice(s.at, end) });
  });
  return { blocks: [...blocks, ...tail], missing: [] };
}

/** 「同一份題目問另一部分」：前一個案例已確認的區塊 → 預填的文字（題號不在文字裡時補在行首，切區塊才找得到）。 */
export function zhPrefillText(blocks: readonly AssistQuestionBlock[]): string {
  return blocks
    .map((b) => {
      const text = b.text.trim();
      if (b.label !== null && b.kind === 'question' && !labelStartRe(zhSplitPartLabel(b.label).base).test(text)) return `${b.label}. ${text}`;
      return text;
    })
    .filter((t) => t !== '')
    .join('\n\n');
}

/** 國文表單的作答欄位（題型、子模式、作答、答案鍵、國寫片段）。format／mode 是 null＝依題目判斷。 */
export interface ZhFieldsValue {
  format: ZhFormat | null;
  mode: ZhChoiceMode | null;
  /** 題號 → 選擇題的字母或簡答的文字（單題沒有題號時鍵是空字串）。 */
  answers: Record<string, string>;
  /** 「我有講義答案」：題號 → 字母（只有選擇題）。 */
  knownKey: Record<string, string>;
  draft: string;
  draftQ1: boolean;
}

export const EMPTY_ZH_FIELDS: ZhFieldsValue = { format: null, mode: null, answers: {}, knownKey: {}, draft: '', draftQ1: false };

/** 實際採用的格式與子模式：學生改過的優先，否則用程式猜的（猜不到當成選擇題；選擇題猜不到子模式當成單選）。 */
export function effectiveZhFormat(value: Pick<ZhFieldsValue, 'format' | 'mode'>, guess: ZhFormatGuess): { format: ZhFormat; mode: ZhChoiceMode | null } {
  const format = value.format ?? guess.format ?? 'choice';
  if (format !== 'choice') return { format, mode: null };
  return { format, mode: value.mode ?? guess.choice_mode ?? 'single' };
}

/** 作答欄位要列哪些鍵：選擇題是每一題（沒有題號時一格），簡答是每一個小題。 */
export function zhAnswerKeys(format: ZhFormat, labels: readonly string[], parts: readonly string[]): string[] {
  if (format === 'writing') return [];
  if (format === 'short') return parts.length > 0 ? [...parts] : labels.length > 0 ? [...labels] : [''];
  return labels.length > 0 ? [...labels] : [''];
}

/** 只留有內容的值（空白的作答、答案鍵不送）。 */
function filled(map: Readonly<Record<string, string>>, keys: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = map[k]?.trim() ?? '';
    if (v !== '') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 表單 → 送給 API 的國文題目（checkZhQuestion 之前的原始形狀）。 */
export function buildZhQuestion(input: {
  blocks: AssistQuestionBlock[];
  labels: readonly string[];
  fields: ZhFieldsValue;
  format: ZhFormat;
  mode: ZhChoiceMode | null;
  parts: readonly string[];
}): AssistStudentQuestion {
  const { blocks, labels, fields, format, mode, parts } = input;
  const keys = zhAnswerKeys(format, labels, parts);
  const q: AssistStudentQuestion = { blocks, target_labels: [...labels], student_answer: null, format };
  if (format === 'choice' && mode !== null) q.choice_mode = mode;
  const answers = filled(fields.answers, keys);
  if (answers) q.answers = answers;
  if (format === 'choice') {
    const known = filled(fields.knownKey, keys);
    if (known) q.known_key = known;
  }
  if (format === 'writing' && fields.draft.trim() !== '') {
    q.draft = fields.draft;
    q.draft_target = fields.draftQ1 ? 'q1' : 'q2';
  }
  return q;
}

/** 題目區塊合起來的文字（猜格式、猜題型、科目建議用）。 */
export function zhAllText(blocks: readonly Pick<AssistQuestionBlock, 'text'>[]): string {
  return blocks.map((b) => b.text).join('\n');
}

/** 要問的題的區塊（題號在 labels 裡；沒選題號時題目、選項、作答區塊都算）的文字。 */
export function zhTargetText(blocks: readonly AssistQuestionBlock[], labels: readonly string[]): string {
  const bases = labels.map((l) => zhSplitPartLabel(l).base);
  return blocks
    .filter((b) => (ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(b.kind) && (bases.length === 0 || (b.label !== null && bases.includes(zhSplitPartLabel(b.label).base))))
    .map((b) => b.text)
    .join('\n');
}

/** 解析的點數（shared 的 assistPoints 與 assistItemCount：選擇題是題數、簡答是小題數、國寫固定）。 */
export function zhAnalyzePoints(format: ZhFormat, blocks: readonly AssistQuestionBlock[], labels: readonly string[]): number {
  const kind: ZhCaseKind = zhKindOfFormat(format);
  // assistItemCount 只看題號與區塊（其他欄位用不到）。
  const question = { targets: labels.map((label) => ({ label })), blocks: [...blocks] } as unknown as Pick<AssistQuestionView, 'targets' | 'blocks'>;
  return assistPoints('chinese', 'assist_analyze', { kind, items: assistItemCount('chinese', kind, question) });
}

/** 程式猜的格式（作答欄的第一個值也算：填了兩個以上字母是多選）。 */
export function guessZhFormatOf(text: string, fields: Pick<ZhFieldsValue, 'answers'>): ZhFormatGuess {
  const answer = Object.values(fields.answers).find((v) => v.trim() !== '');
  return guessZhFormat(text, answer !== undefined ? { answer } : {});
}
