/**
 * 講義的選項與預設值（docs/design/vocab-handout.md §5.4），以及「上次用的設定」的本機記憶。
 *
 * 記在 localStorage 的 `gsat-vocab-handout:v1`：{ type, options, levels, range }。讀寫都包在 try/catch 裡；
 * 讀不到、格式不對或欄位不合法時逐欄回到預設值（壞掉的一欄不影響其他欄）。來源（錯題本、每日學習）不記：每天都會變。
 */
import { VOCAB_LEVELS, isVocabLevel, type VocabLevel } from '../../../data/vocab';
import type { VocabHandoutKind } from '../../pdf/vocabTypes';

export const HANDOUT_KINDS: readonly VocabHandoutKind[] = ['notes', 'recite', 'cloze', 'quiz'];

export type HandoutSort = 'alpha' | 'exam' | 'source';
export type ClozeCount = 'all' | 50 | 30 | 20;

export interface HandoutOptions {
  /** 講義版：一欄或兩欄（兩欄不印例句）。 */
  columns: 1 | 2;
  examples: boolean;
  ipa: boolean;
  fullSenses: boolean;
  forms: boolean;
  family: boolean;
  synonyms: boolean;
  /** 講義版、背誦版的排序。 */
  sort: HandoutSort;
  /** 背誦版：遮哪一邊。 */
  hide: 'zh' | 'en';
  firstLetter: boolean;
  letterCount: boolean;
  clozeZh: boolean;
  clozeCount: ClozeCount;
  /** 測驗卷：中翻英拼字、英選中（句意填空不能關）。 */
  quizSpelling: boolean;
  quizChoice: boolean;
  answerKey: boolean;
  keyDetails: boolean;
  nameFields: boolean;
  duplex: boolean;
}

export const DEFAULT_HANDOUT_OPTIONS: HandoutOptions = {
  columns: 1,
  examples: true,
  ipa: true,
  fullSenses: false,
  forms: true,
  family: true,
  synonyms: false,
  sort: 'alpha',
  hide: 'zh',
  firstLetter: true,
  letterCount: false,
  clozeZh: false,
  clozeCount: 'all',
  quizSpelling: true,
  quizChoice: true,
  answerKey: true,
  keyDetails: true,
  nameFields: true,
  duplex: false,
};

export const CLOZE_COUNTS: readonly ClozeCount[] = ['all', 50, 30, 20];

/** 每份 PDF 的上限（§5.3、§8）。 */
export const HANDOUT_LIMITS = {
  words: 600,
  /** 手機上講義版一次的上限（WP0 實測後決定，見設計文件 §8.2 與實作備註）。 */
  notesOnPhone: 600,
  cloze: 200,
  spelling: 100,
  choice: 100,
} as const;

export type LevelRange = { by: 'all' } | { by: 'letters'; from: string; to: string } | { by: 'part'; size: 50 | 100; part: number };

export const DEFAULT_LEVELS: readonly VocabLevel[] = [3];
export const DEFAULT_RANGE: LevelRange = { by: 'part', size: 50, part: 1 };

export interface StoredHandoutSettings {
  type: VocabHandoutKind;
  options: HandoutOptions;
  levels: VocabLevel[];
  range: LevelRange;
}

export const HANDOUT_STORAGE_KEY = 'gsat-vocab-handout:v1';

export function defaultHandoutSettings(): StoredHandoutSettings {
  return { type: 'notes', options: { ...DEFAULT_HANDOUT_OPTIONS }, levels: [...DEFAULT_LEVELS], range: { ...DEFAULT_RANGE } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const BOOLEAN_KEYS = [
  'examples',
  'ipa',
  'fullSenses',
  'forms',
  'family',
  'synonyms',
  'firstLetter',
  'letterCount',
  'clozeZh',
  'quizSpelling',
  'quizChoice',
  'answerKey',
  'keyDetails',
  'nameFields',
  'duplex',
] as const satisfies readonly (keyof HandoutOptions)[];

function parseOptions(raw: unknown): HandoutOptions {
  const out: HandoutOptions = { ...DEFAULT_HANDOUT_OPTIONS };
  if (!isObject(raw)) return out;
  for (const key of BOOLEAN_KEYS) if (typeof raw[key] === 'boolean') out[key] = raw[key];
  if (raw['columns'] === 1 || raw['columns'] === 2) out.columns = raw['columns'];
  if (raw['sort'] === 'alpha' || raw['sort'] === 'exam' || raw['sort'] === 'source') out.sort = raw['sort'];
  if (raw['hide'] === 'zh' || raw['hide'] === 'en') out.hide = raw['hide'];
  const count = raw['clozeCount'];
  if ((CLOZE_COUNTS as readonly unknown[]).includes(count)) out.clozeCount = count as ClozeCount;
  return out;
}

const LETTER = /^[a-z]$/;

export function parseRange(raw: unknown): LevelRange {
  if (!isObject(raw)) return { ...DEFAULT_RANGE };
  if (raw['by'] === 'all') return { by: 'all' };
  if (raw['by'] === 'letters' && typeof raw['from'] === 'string' && typeof raw['to'] === 'string' && LETTER.test(raw['from']) && LETTER.test(raw['to'])) {
    return raw['from'] <= raw['to'] ? { by: 'letters', from: raw['from'], to: raw['to'] } : { by: 'letters', from: raw['to'], to: raw['from'] };
  }
  if (raw['by'] === 'part' && (raw['size'] === 50 || raw['size'] === 100) && typeof raw['part'] === 'number' && Number.isInteger(raw['part']) && raw['part'] >= 1) {
    return { by: 'part', size: raw['size'], part: raw['part'] };
  }
  return { ...DEFAULT_RANGE };
}

/** 存檔字串 → 設定；任何一欄不合法就用那一欄的預設值。 */
export function parseHandoutSettings(raw: string | null): StoredHandoutSettings {
  const fallback = defaultHandoutSettings();
  if (raw === null) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!isObject(data)) return fallback;
  const type = HANDOUT_KINDS.find((k) => k === data['type']) ?? fallback.type;
  const levels = Array.isArray(data['levels']) ? [...new Set(data['levels'].filter(isVocabLevel))].sort((a, b) => a - b) : fallback.levels;
  return {
    type,
    options: parseOptions(data['options']),
    levels: levels.length > 0 ? levels : fallback.levels,
    range: parseRange(data['range']),
  };
}

export function loadHandoutSettings(): StoredHandoutSettings {
  try {
    return parseHandoutSettings(window.localStorage.getItem(HANDOUT_STORAGE_KEY));
  } catch {
    return defaultHandoutSettings();
  }
}

export function saveHandoutSettings(settings: StoredHandoutSettings): void {
  try {
    window.localStorage.setItem(HANDOUT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 無痕模式、容量滿或停用網站資料：只是下次不記得設定，不影響產生講義。
  }
}

/** 全部級別（給選單用）。 */
export const ALL_LEVELS: readonly VocabLevel[] = VOCAB_LEVELS;
