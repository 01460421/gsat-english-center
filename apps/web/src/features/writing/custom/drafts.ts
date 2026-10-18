/**
 * 自訂作文題目的草稿（docs/design/custom-essay.md §6.6）。
 *
 * 鍵：draftKey('essay', CUSTOM_ESSAY_GROUP_ID)＝gsat-writing-draft:v1:essay:custom:essay@1，一台裝置一份。沿用寫作草稿的前綴，
 * 登出、刪帳號、清除資料時 clearLocalWritingData() 會一起清掉（題目可能有學校、老師名字）。
 * 型別守衛是寬鬆的（同 bank/drafts.ts）：缺欄位或型別不對的欄位補預設值，題目與作文不會因為其他欄位壞掉而丟掉。
 * 放在 custom/ 底下（不放 lib/drafts.ts）：lib/drafts.ts 在首頁的主程式裡，這些只有自訂題目的頁面用得到。
 */
import { CUSTOM_ESSAY_GROUP_ID, normalizeCustomPromptText, type CustomEssayPrompt, type CustomEssayPromptInput } from '@gsat/shared';
import { draftKey, isPartialEssayScores, loadDraft, saveDraft, type PartialEssayScores } from '../lib/drafts';

export const CUSTOM_DRAFT_KEY = draftKey('essay', CUSTOM_ESSAY_GROUP_ID);

/** 舊草稿的提醒門檻（天）。 */
export const OLD_DRAFT_DAYS = 30;

export interface CustomPromptDraft {
  text: string;
  figure: string;
  /** 段數要求 1–5；null＝不指定。 */
  paragraphs: number | null;
  /** 輸入框原樣（可能打到一半）；送出時才轉整數。 */
  minWords: string;
  maxWords: string;
}

/** 學生確認過「題目沒有規定」的建議值（§6.3）；題目文字改了、建議值不同時失效。words 是 requirementWordsKey 的值。 */
export interface RequirementsConfirmed {
  paragraphs?: number;
  words?: string;
}

export interface CustomEssayDraft {
  prompt: CustomPromptDraft;
  requirementsConfirmed: RequirementsConfirmed | null;
  /** 題目表單是否收合（§6.2）。 */
  promptCollapsed: boolean;
  text: string;
  mode: 'typed' | 'photo';
  /** 已建立、還沒成功送出批改的提交（重送沿用）。 */
  submissionId: string | null;
  selfScores: PartialEssayScores | null;
  checked: string[];
  /** 最近一次成功送出 AI 批改的時間。 */
  aiSubmittedAt: number | null;
  /** 「看上次的批改結果」連結。 */
  lastSubmissionId: string | null;
  updatedAt: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const timeOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const paragraphsOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

export function emptyCustomPromptDraft(): CustomPromptDraft {
  return { text: '', figure: '', paragraphs: null, minWords: '', maxWords: '' };
}

export function emptyCustomEssayDraft(): CustomEssayDraft {
  return {
    prompt: emptyCustomPromptDraft(),
    requirementsConfirmed: null,
    promptCollapsed: false,
    text: '',
    mode: 'typed',
    submissionId: null,
    selfScores: null,
    checked: [],
    aiSubmittedAt: null,
    lastSubmissionId: null,
    updatedAt: 0,
  };
}

function toPromptDraft(v: unknown): CustomPromptDraft {
  if (!isObject(v)) return emptyCustomPromptDraft();
  return { text: str(v['text']), figure: str(v['figure']), paragraphs: paragraphsOrNull(v['paragraphs']), minWords: str(v['minWords']), maxWords: str(v['maxWords']) };
}

/** 讀出的題目草稿（結果頁就地修改的暫存）→ 題目草稿；不是物件回 null（寬鬆：缺欄位補空白）。 */
export function toCustomPromptDraft(v: unknown): CustomPromptDraft | null {
  return isObject(v) ? toPromptDraft(v) : null;
}

function toConfirmed(v: unknown): RequirementsConfirmed | null {
  if (!isObject(v)) return null;
  const out: RequirementsConfirmed = {};
  const p = paragraphsOrNull(v['paragraphs']);
  if (p !== null) out.paragraphs = p;
  if (typeof v['words'] === 'string') out.words = v['words'];
  return out;
}

/**
 * 讀出的草稿 → 完整的草稿：缺欄位或形狀不對的部分補預設值（舊版本的草稿、手動改壞的資料），
 * 題目與作文絕不因為其他欄位壞掉而丟掉。不是物件時回 null。
 */
export function toCustomEssayDraft(v: unknown): CustomEssayDraft | null {
  if (!isObject(v)) return null;
  return {
    prompt: toPromptDraft(v['prompt']),
    requirementsConfirmed: toConfirmed(v['requirementsConfirmed']),
    promptCollapsed: v['promptCollapsed'] === true,
    text: str(v['text']),
    mode: v['mode'] === 'photo' ? 'photo' : 'typed',
    submissionId: strOrNull(v['submissionId']),
    selfScores: isPartialEssayScores(v['selfScores']) ? v['selfScores'] : null,
    checked: Array.isArray(v['checked']) ? v['checked'].filter((x): x is string => typeof x === 'string') : [],
    aiSubmittedAt: timeOrNull(v['aiSubmittedAt']),
    lastSubmissionId: strOrNull(v['lastSubmissionId']),
    updatedAt: timeOrNull(v['updatedAt']) ?? 0,
  };
}

/** 讀這台裝置上的自訂題目草稿；沒有、壞掉或不能用回 null。 */
export function loadCustomEssayDraft(): CustomEssayDraft | null {
  return toCustomEssayDraft(loadDraft(CUSTOM_DRAFT_KEY, (v: unknown): v is unknown => v !== null));
}

/**
 * 刪除提交後呼叫（安全審查 S15）：草稿的 submissionId 或 lastSubmissionId 是它時，把那個 id 清掉；
 * 草稿裡的題目**就是那一份的題目**時，題目也清掉（題目可能有學校、老師名字；提交刪掉了，這台裝置上也不該留著）。
 * 草稿的題目已經換成別的（學生在作答頁清掉舊題目、打了新題目還沒送出），新題目和被刪的那一份無關，保留（審查 ux-2）：
 *   - 草稿正在沿用被刪的那一份（submissionId 相同）：草稿的題目就是那一份的，一律清掉；
 *   - 只是「上次送出的那一份」（lastSubmissionId 相同）：deletedPrompt 和草稿的題目相同才清；
 *     不知道那一份的題目（deletedPrompt 是 undefined，例如列表刪除）時保守地保留，只清 id。
 * 草稿不存在或不能用時安靜略過。
 */
export function forgetCustomSubmission(submissionId: string, deletedPrompt?: CustomEssayPrompt | null): void {
  const draft = loadCustomEssayDraft();
  if (!draft || (draft.submissionId !== submissionId && draft.lastSubmissionId !== submissionId)) return;
  const samePromptAsDeleted =
    draft.submissionId === submissionId || (deletedPrompt !== undefined && deletedPrompt !== null && !deletedPrompt.hidden && samePrompt(draft.prompt, deletedPrompt));
  saveDraft(CUSTOM_DRAFT_KEY, {
    ...draft,
    ...(samePromptAsDeleted ? { prompt: emptyCustomPromptDraft(), requirementsConfirmed: null, promptCollapsed: false } : {}),
    submissionId: draft.submissionId === submissionId ? null : draft.submissionId,
    lastSubmissionId: draft.lastSubmissionId === submissionId ? null : draft.lastSubmissionId,
    updatedAt: Date.now(),
  } satisfies CustomEssayDraft);
}

/**
 * 字數輸入框 → 送出的值：空白是 null（不指定）；全形數字先轉半形；不是整數時回 NaN（checkCustomPrompt 會判成
 * words_invalid、送出按鈕停用，所以 NaN 不會真的送到伺服器）。
 */
export function parseWordsInput(raw: string): number | null {
  const s = raw.normalize('NFKC').trim();
  if (s === '') return null;
  return /^\d{1,4}$/.test(s) ? Number(s) : Number.NaN;
}

/** 題目草稿 → 建立或修改提交時送的 custom_prompt：字串原樣（伺服器負責正規化），數字欄位轉整數或 null。 */
export function toCustomPromptInput(p: CustomPromptDraft): CustomEssayPromptInput {
  return {
    text: p.text,
    figure_text: p.figure.trim() === '' ? null : p.figure,
    paragraphs: p.paragraphs,
    min_words: parseWordsInput(p.minWords),
    max_words: parseWordsInput(p.maxWords),
  };
}

/** 伺服器存下的題目 → 題目草稿（「用同一個題目再寫一次」）。 */
export function promptDraftFrom(p: Pick<CustomEssayPrompt, 'text' | 'figure_text' | 'paragraphs' | 'min_words' | 'max_words'>): CustomPromptDraft {
  return {
    text: p.text,
    figure: p.figure_text ?? '',
    paragraphs: p.paragraphs,
    minWords: p.min_words === null ? '' : String(p.min_words),
    maxWords: p.max_words === null ? '' : String(p.max_words),
  };
}

/** 題目草稿和伺服器的題目是不是同一題：正規化後的文字、圖片描述與三個數字都相同。 */
export function samePrompt(draft: CustomPromptDraft, prompt: Pick<CustomEssayPrompt, 'text' | 'figure_text' | 'paragraphs' | 'min_words' | 'max_words'>): boolean {
  const figure = normalizeCustomPromptText(draft.figure).text;
  return (
    normalizeCustomPromptText(draft.text).text === normalizeCustomPromptText(prompt.text).text &&
    figure === normalizeCustomPromptText(prompt.figure_text ?? '').text &&
    draft.paragraphs === prompt.paragraphs &&
    parseWordsInput(draft.minWords) === prompt.min_words &&
    parseWordsInput(draft.maxWords) === prompt.max_words
  );
}

/** 題目欄位全部空白。 */
export function promptDraftEmpty(p: CustomPromptDraft): boolean {
  return p.text.trim() === '' && p.figure.trim() === '' && p.paragraphs === null && p.minWords.trim() === '' && p.maxWords.trim() === '';
}

/** 草稿是幾天前存的（沒有存過回 0）。 */
export function draftAgeDays(updatedAt: number, now: number): number {
  if (updatedAt <= 0 || now <= updatedAt) return 0;
  return Math.floor((now - updatedAt) / 86_400_000);
}

/** 題目＋圖片描述（正規化後，以換行接起來）：作文規則的 copies_task 和它比（essayGradableProblem 的 taskText）。 */
export function customTaskText(text: string, figure: string | null): string {
  return [normalizeCustomPromptText(text).text, normalizeCustomPromptText(figure ?? '').text].filter((s) => s !== '').join('\n');
}
