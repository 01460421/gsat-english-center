/**
 * 草稿自動存在這台裝置的 localStorage（每個題組一筆）。
 *
 * localStorage 在無痕模式、被封鎖的網站資料、部分 App 內建瀏覽器裡會丟例外或容量不足：每次讀寫都包 try/catch，
 * 失敗只回傳 false（畫面提示「草稿無法儲存」），不打斷作答。照片不存（太大，也是個資），只存文字與狀態。
 */
import { ESSAY_CRITERIA, type EssayCriterion } from '@gsat/shared';

const PREFIX = 'gsat-writing-draft:v1:';
/** 手寫作文辨識文字的確認到一半的修改（每份提交一筆）。 */
const OCR_PREFIX = 'gsat-writing-ocr:v1:';
/** 手寫作文確認文字之後、送批改之前的自評（每份提交一筆）。 */
const SELF_PREFIX = 'gsat-writing-self:v1:';

export function draftKey(kind: 'translation' | 'essay', groupId: string): string {
  return `${PREFIX}${kind}:${groupId}`;
}

export function ocrDraftKey(submissionId: string): string {
  return `${OCR_PREFIX}${submissionId}`;
}

export function selfDraftKey(submissionId: string): string {
  return `${SELF_PREFIX}${submissionId}`;
}

/**
 * 清掉這台裝置上所有寫作暫存（作答草稿、辨識文字的修改、自評）。登出與刪除帳號時呼叫：
 * 學校電腦教室的下一位使用者不該看到上一位的作文全文。localStorage 不能用時安靜略過。
 */
export function clearLocalWritingData(): void {
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && (key.startsWith(PREFIX) || key.startsWith(OCR_PREFIX) || key.startsWith(SELF_PREFIX))) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // 不能用就算了：本來就存不進去
  }
}

export interface TranslationDraft {
  texts: string[];
  /** 已建立的提交（AI 批改失敗、額度不足時重送沿用同一份，不重複建立）。 */
  submissionId: string | null;
  /** 自我檢核清單已勾選的項目 id。 */
  checked: string[];
  /** 自評：每句找到幾個錯誤。 */
  errorCounts: number[];
  updatedAt: number;
}

export type EssayScores = Record<EssayCriterion, number>;
/** 自評進行中：四項還沒全部點選時只有部分欄位。 */
export type PartialEssayScores = Partial<EssayScores>;

/** 四項都評了才算一份自評（沒評的項目不能當 0 分送出）。 */
export function completeEssayScores(scores: PartialEssayScores | null): EssayScores | null {
  if (!scores) return null;
  const out: Partial<EssayScores> = {};
  for (const c of ESSAY_CRITERIA) {
    const v = scores[c];
    if (typeof v !== 'number') return null;
    out[c] = v;
  }
  return out as EssayScores;
}

export interface EssayDraft {
  text: string;
  mode: 'typed' | 'photo';
  submissionId: string | null;
  /** 看分數前的自評（四項各 0–5）；還沒評是 null，評到一半只有部分欄位。 */
  selfScores: PartialEssayScores | null;
  checked: string[];
  updatedAt: number;
}

/** 手寫作文「已確認」那一步的自評（存在 selfDraftKey）。 */
export interface SelfDraft {
  scores: PartialEssayScores | null;
  checked: string[];
}

export function isSelfDraft(v: unknown): v is SelfDraft {
  return isObject(v) && (v['scores'] === null || isPartialEssayScores(v['scores'])) && isStringArray(v['checked']);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function isPartialEssayScores(v: unknown): v is PartialEssayScores {
  return isObject(v) && ESSAY_CRITERIA.every((c) => v[c] === undefined || (typeof v[c] === 'number' && Number.isFinite(v[c])));
}

export function isTranslationDraft(v: unknown): v is TranslationDraft {
  return (
    isObject(v) &&
    isStringArray(v['texts']) &&
    (v['submissionId'] === null || typeof v['submissionId'] === 'string') &&
    isStringArray(v['checked']) &&
    isNumberArray(v['errorCounts']) &&
    typeof v['updatedAt'] === 'number'
  );
}

export function isEssayDraft(v: unknown): v is EssayDraft {
  return (
    isObject(v) &&
    typeof v['text'] === 'string' &&
    (v['mode'] === 'typed' || v['mode'] === 'photo') &&
    (v['submissionId'] === null || typeof v['submissionId'] === 'string') &&
    (v['selfScores'] === null || isPartialEssayScores(v['selfScores'])) &&
    isStringArray(v['checked']) &&
    typeof v['updatedAt'] === 'number'
  );
}

/** 讀草稿；沒有、壞掉或 localStorage 不能用都回 null。 */
export function loadDraft<T>(key: string, guard: (v: unknown) => v is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 寫草稿；成功回 true。 */
export function saveDraft(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 不能用就算了：草稿本來就存不進去
  }
}
