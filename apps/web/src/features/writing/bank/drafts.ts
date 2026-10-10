/**
 * 本站仿真題的草稿（docs/design/bank-writing.md §2.5）。
 * 鍵沿用 lib/drafts.ts 的 draftKey(kind, groupId)，groupId 是 '{uid}@{version}'：新版上架時是新的草稿，舊版的草稿留在這台裝置，
 * 登出時 clearLocalWritingData 一起清掉。
 * 放在 bank/ 底下（不放 lib/drafts.ts）：lib/drafts.ts 在首頁的主程式裡（登出要清草稿），這些只有本站題的頁面用得到。
 */
import { draftKey, isPartialEssayScores, loadDraft, type PartialEssayScores } from '../lib/drafts';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export interface BankTranslationDraft {
  texts: string[];
  /** 每句開到第幾層提示（0–3）。 */
  hintLevels: number[];
  /** 按下「對照」的時間；非 null＝作答唯讀。 */
  revealedAt: number | null;
  /** [句][部分] 自評錯誤數 0–2。 */
  partErrors: number[][];
  /** [句][部分] 整個漏譯。 */
  partMissing: boolean[][];
  /** 已建立、還沒成功送出批改的提交（重送沿用，同歷屆題）。 */
  submissionId: string | null;
  /** 最近一次成功送出 AI 批改的時間（startTask 成功，或遇到 AlreadySubmittedError）。 */
  aiSubmittedAt: number | null;
  /** 那一次的提交 id：作答頁顯示「看上次的批改結果」連結。 */
  lastSubmissionId: string | null;
  updatedAt: number;
}

export interface BankEssayDraft {
  text: string;
  mode: 'typed' | 'photo';
  /** 開到第幾層提示（0–3）。 */
  hintLevel: number;
  revealedAt: number | null;
  selfScores: PartialEssayScores | null;
  submissionId: string | null;
  aiSubmittedAt: number | null;
  lastSubmissionId: string | null;
  updatedAt: number;
}

/** 本站中譯英每句幾個評分部分（SPEC §4.6）。 */
const BANK_PARTS = 4;

const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const timeOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const clampInt = (v: unknown, min: number, max: number): number => Math.min(max, Math.max(min, Math.floor(numOr(v, min))));

export function emptyBankTranslationDraft(sentences: number): BankTranslationDraft {
  return {
    texts: Array.from({ length: sentences }, () => ''),
    hintLevels: Array.from({ length: sentences }, () => 0),
    revealedAt: null,
    partErrors: Array.from({ length: sentences }, () => Array.from({ length: BANK_PARTS }, () => 0)),
    partMissing: Array.from({ length: sentences }, () => Array.from({ length: BANK_PARTS }, () => false)),
    submissionId: null,
    aiSubmittedAt: null,
    lastSubmissionId: null,
    updatedAt: 0,
  };
}

/**
 * 讀出的本站中譯英草稿 → 完整的草稿：缺欄位或形狀不對的部分補預設值（舊版本的草稿、手動改壞的資料），
 * 文字絕不因為其他欄位壞掉而丟掉。句數不同時補齊或截斷。不是物件、或連 texts 都沒有時回 null。
 */
export function toBankTranslationDraft(v: unknown, sentences: number): BankTranslationDraft | null {
  if (!isObject(v) || !isStringArray(v['texts'])) return null;
  const texts = v['texts'];
  const rows = <T,>(raw: unknown, cell: (x: unknown) => T): T[][] =>
    Array.from({ length: sentences }, (_, i) => {
      const row = Array.isArray(raw) && Array.isArray(raw[i]) ? (raw[i] as unknown[]) : [];
      return Array.from({ length: BANK_PARTS }, (_, j) => cell(row[j]));
    });
  const hints = Array.isArray(v['hintLevels']) ? (v['hintLevels'] as unknown[]) : [];
  return {
    texts: Array.from({ length: sentences }, (_, i) => texts[i] ?? ''),
    hintLevels: Array.from({ length: sentences }, (_, i) => clampInt(hints[i], 0, 3)),
    revealedAt: timeOrNull(v['revealedAt']),
    partErrors: rows(v['partErrors'], (x) => clampInt(x, 0, 2)),
    partMissing: rows(v['partMissing'], (x) => x === true),
    submissionId: strOrNull(v['submissionId']),
    aiSubmittedAt: timeOrNull(v['aiSubmittedAt']),
    lastSubmissionId: strOrNull(v['lastSubmissionId']),
    updatedAt: numOr(v['updatedAt'], 0),
  };
}

export function emptyBankEssayDraft(): BankEssayDraft {
  return { text: '', mode: 'typed', hintLevel: 0, revealedAt: null, selfScores: null, submissionId: null, aiSubmittedAt: null, lastSubmissionId: null, updatedAt: 0 };
}

/** 讀出的本站作文草稿 → 完整的草稿（同上：補預設值，不丟文字）。 */
export function toBankEssayDraft(v: unknown): BankEssayDraft | null {
  if (!isObject(v) || typeof v['text'] !== 'string') return null;
  return {
    text: v['text'],
    mode: v['mode'] === 'photo' ? 'photo' : 'typed',
    hintLevel: clampInt(v['hintLevel'], 0, 3),
    revealedAt: timeOrNull(v['revealedAt']),
    selfScores: isPartialEssayScores(v['selfScores']) ? v['selfScores'] : null,
    submissionId: strOrNull(v['submissionId']),
    aiSubmittedAt: timeOrNull(v['aiSubmittedAt']),
    lastSubmissionId: strOrNull(v['lastSubmissionId']),
    updatedAt: numOr(v['updatedAt'], 0),
  };
}

/** 本站題在這台裝置上的進度（列表卡片、「下一組」用）：done＝已對照或已送 AI 批改；draft＝有文字但兩者都還沒有。 */
export type BankProgress = 'done' | 'draft' | null;

export function bankProgressOf(kind: 'translation' | 'essay', groupId: string): BankProgress {
  const raw = loadDraft(draftKey(kind, groupId), isObject);
  if (!raw) return null;
  if (timeOrNull(raw['revealedAt']) !== null || timeOrNull(raw['aiSubmittedAt']) !== null) return 'done';
  const hasText = kind === 'translation' ? isStringArray(raw['texts']) && raw['texts'].some((t) => t.trim() !== '') : typeof raw['text'] === 'string' && raw['text'].trim() !== '';
  return hasText ? 'draft' : null;
}

/** 讀草稿的原始內容（不檢查形狀；本站題的草稿用 toBank*Draft 補預設值）。沒有、壞掉或不能用回 null。 */
export function loadRawDraft(key: string): unknown {
  return loadDraft(key, (v: unknown): v is unknown => v !== null);
}
