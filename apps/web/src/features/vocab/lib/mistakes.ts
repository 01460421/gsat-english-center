/**
 * 錯題本：測驗答錯的字。存檔格式和每日學習一樣有 schema／version（理由見 srs.ts 檔頭）。
 *
 * 規則：
 *   - 任何測驗答錯：加入錯題本（已在錯題本就把次數加一）；題庫練習的詞彙題答錯也一樣，正解字收進來（SPEC §6.12）；
 *   - 在「錯題本練習」答對：移出錯題本。一般測驗答對不移除：剛看過正解馬上答對，不代表真的記住了。
 *   - 最多保留 MAX_ITEMS 筆，超過時丟掉最久沒錯的，避免 localStorage 無限長大。
 */
import { levelFromEntryId } from '../../../data/vocab';
import { isQuizMode, type QuizMode } from './quiz';
import type { LoadStatus } from './srs';

export const MISTAKES_STORAGE_KEY = 'gsat-vocab-mistakes';
export const MISTAKES_SCHEMA = 'gsat-vocab-mistakes';
export const MISTAKES_VERSION = 1;
export const MAX_MISTAKES = 500;

export interface MistakeItem {
  entry_id: string;
  /** 存一份詞頭：資料改版後 id 對不到時，錯題本仍能顯示是哪個字。 */
  word: string;
  wrong_count: number;
  last_wrong_at: number;
  last_mode: QuizMode;
  /**
   * 最近一次是在哪裡答錯：bank_practice＝題庫練習的詞彙題（四選一填空，last_mode 記成最接近的 cloze）；
   * 省略＝單字測驗。只影響錯題本上的說明文字。
   */
  last_source?: 'bank_practice';
}

export interface MistakeBook {
  schema: typeof MISTAKES_SCHEMA;
  version: typeof MISTAKES_VERSION;
  items: Record<string, MistakeItem>;
  updated_at: number;
}

export function createMistakeBook(now: number): MistakeBook {
  return { schema: MISTAKES_SCHEMA, version: MISTAKES_VERSION, items: {}, updated_at: now };
}

export function serializeMistakeBook(book: MistakeBook): string {
  return JSON.stringify(book);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseItem(id: string, value: unknown): MistakeItem | null {
  if (!isObject(value) || levelFromEntryId(id) === null) return null;
  const { word, wrong_count: count, last_wrong_at: at, last_mode: mode } = value;
  if (typeof word !== 'string' || typeof count !== 'number' || typeof at !== 'number' || !isQuizMode(mode)) return null;
  if (!Number.isFinite(count) || !Number.isFinite(at)) return null;
  return {
    entry_id: id,
    word,
    wrong_count: Math.max(1, Math.floor(count)),
    last_wrong_at: at,
    last_mode: mode,
    ...(value['last_source'] === 'bank_practice' ? { last_source: 'bank_practice' as const } : {}),
  };
}

export function parseMistakeBook(raw: string | null, now: number): { book: MistakeBook; status: LoadStatus } {
  if (raw === null) return { book: createMistakeBook(now), status: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { book: createMistakeBook(now), status: 'invalid' };
  }
  if (!isObject(data) || data['schema'] !== MISTAKES_SCHEMA || typeof data['version'] !== 'number') {
    return { book: createMistakeBook(now), status: 'invalid' };
  }
  if (data['version'] > MISTAKES_VERSION) return { book: createMistakeBook(now), status: 'newer' };
  if (data['version'] !== MISTAKES_VERSION) return { book: createMistakeBook(now), status: 'invalid' };
  const items: Record<string, MistakeItem> = {};
  if (isObject(data['items'])) {
    for (const [id, value] of Object.entries(data['items'])) {
      const item = parseItem(id, value);
      if (item) items[id] = item;
    }
  }
  const updatedAt = data['updated_at'];
  return { book: { ...createMistakeBook(now), items, updated_at: typeof updatedAt === 'number' ? updatedAt : now }, status: 'ok' };
}

export interface AnswerRecord {
  entryId: string;
  word: string;
  mode: QuizMode;
  correct: boolean;
  /** 題庫練習的詞彙題（見 MistakeItem.last_source）。 */
  source?: 'bank_practice';
}

function trim(items: Record<string, MistakeItem>): Record<string, MistakeItem> {
  const list = Object.values(items);
  if (list.length <= MAX_MISTAKES) return items;
  list.sort((a, b) => b.last_wrong_at - a.last_wrong_at);
  return Object.fromEntries(list.slice(0, MAX_MISTAKES).map((item) => [item.entry_id, item]));
}

/** 記錄一題的作答結果。practice 為 true 表示這是錯題本練習（答對會移出）。 */
export function recordAnswer(book: MistakeBook, answer: AnswerRecord, practice: boolean, now: number): MistakeBook {
  const existing = book.items[answer.entryId];
  if (answer.correct) {
    if (!practice || !existing) return book;
    const items = { ...book.items };
    delete items[answer.entryId];
    return { ...book, items, updated_at: now };
  }
  const item: MistakeItem = {
    entry_id: answer.entryId,
    word: answer.word,
    wrong_count: (existing?.wrong_count ?? 0) + 1,
    last_wrong_at: now,
    last_mode: answer.mode,
    ...(answer.source ? { last_source: answer.source } : {}),
  };
  return { ...book, items: trim({ ...book.items, [answer.entryId]: item }), updated_at: now };
}

export function removeMistake(book: MistakeBook, entryId: string, now: number): MistakeBook {
  if (!book.items[entryId]) return book;
  const items = { ...book.items };
  delete items[entryId];
  return { ...book, items, updated_at: now };
}

export function clearMistakes(book: MistakeBook, now: number): MistakeBook {
  return Object.keys(book.items).length === 0 ? book : { ...book, items: {}, updated_at: now };
}

/** 列表順序：最近答錯的在前。 */
export function mistakesByRecency(book: MistakeBook): MistakeItem[] {
  return Object.values(book.items).sort((a, b) => b.last_wrong_at - a.last_wrong_at || a.word.localeCompare(b.word, 'en'));
}

/** 練習順序：錯最多次的先練，同次數時最近錯的先。 */
export function mistakesForPractice(book: MistakeBook): MistakeItem[] {
  return Object.values(book.items).sort((a, b) => b.wrong_count - a.wrong_count || b.last_wrong_at - a.last_wrong_at);
}
