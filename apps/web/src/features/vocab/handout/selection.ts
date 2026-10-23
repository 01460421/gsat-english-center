/**
 * 講義的選字（docs/design/vocab-handout.md §5.3）：來源 → 條目 id 清單（講義的順序）。
 *
 *   levels    級別＋範圍：依級別、再依字母排序（索引本來就照字母排）；「依份數」每 50 或 100 字切一份，「依字母」選起訖字母
 *   filters   單字庫目前的搜尋與篩選結果（searchVocab，照單字庫的排序）
 *   mistakes  錯題本（依最近答錯、答錯次數或字母）
 *   study     每日學習加入過的所有字，或今天到期要複習的字（依加入的先後）
 * 超過上限（600 字）時只收前面的字，摘要另外說明。資料改版後對不到索引的 id（錯題本、每日學習）直接略過。
 */
import type { VocabIndexEntry, VocabLevel } from '../../../data/vocab';
import { mistakesByRecency, mistakesForPractice, type MistakeBook } from '../lib/mistakes';
import { CEFR_FILTER_OPTIONS, EXAM_FILTER_OPTIONS, POS_FILTER_OPTIONS, SORT_OPTIONS, searchVocab, type LibraryFilters } from '../lib/search';
import { isDue, type SrsState } from '../lib/srs';
import { normalizeWord } from '../lib/text';
import { isVocabLevel } from '../../../data/vocab';
import { HANDOUT_LIMITS, parseRange, type LevelRange } from './options';

export type HandoutSource =
  | { kind: 'levels'; levels: VocabLevel[]; range: LevelRange }
  | { kind: 'filters'; filters: LibraryFilters }
  | { kind: 'mistakes'; order: 'recent' | 'count' | 'alpha' }
  | { kind: 'study'; which: 'all' | 'due' };

export interface SelectionContext {
  index: readonly VocabIndexEntry[];
  mistakes: MistakeBook;
  srs: SrsState;
  now: number;
}

export interface Selection {
  /** 講義收的條目（最多 limit 個）。 */
  entries: VocabIndexEntry[];
  /** 截斷前的字數。 */
  total: number;
  truncated: boolean;
  /** 要載入的級別檔。 */
  levels: VocabLevel[];
}

/** 字的首字母（a–z）；不是英文字母開頭的歸到「#」。 */
export function initialOf(word: string): string {
  const ch = normalizeWord(word).charAt(0);
  return /[a-z]/.test(ch) ? ch : '#';
}

/** 選定級別的條目：依級別、再依字母（索引的順序）。 */
export function levelEntries(index: readonly VocabIndexEntry[], levels: readonly VocabLevel[]): VocabIndexEntry[] {
  const set = new Set<number>(levels);
  const order = [...set].sort((a, b) => a - b);
  return order.flatMap((level) => index.filter((e) => e.level === level));
}

/** 依份數的下拉選項：「第 3 份（201–300：ban – bulk）」。 */
export function partOptions(list: readonly VocabIndexEntry[], size: number): { part: number; from: number; to: number; first: string; last: string }[] {
  const out: { part: number; from: number; to: number; first: string; last: string }[] = [];
  for (let start = 0; start < list.length; start += size) {
    const slice = list.slice(start, start + size);
    out.push({ part: out.length + 1, from: start + 1, to: start + slice.length, first: slice[0]?.word ?? '', last: slice.at(-1)?.word ?? '' });
  }
  return out;
}

/** 這些條目出現過的首字母（依字母順序）。 */
export function letterOptions(list: readonly VocabIndexEntry[]): string[] {
  return [...new Set(list.map((e) => initialOf(e.word)))].filter((l) => l !== '#').sort();
}

function applyRange(list: VocabIndexEntry[], range: LevelRange): VocabIndexEntry[] {
  if (range.by === 'all') return list;
  if (range.by === 'letters') {
    return list.filter((e) => {
      const ch = initialOf(e.word);
      return ch >= range.from && ch <= range.to;
    });
  }
  const start = (range.part - 1) * range.size;
  return list.slice(start, start + range.size);
}

function mistakeEntries(ctx: SelectionContext, order: 'recent' | 'count' | 'alpha', byId: Map<string, VocabIndexEntry>): VocabIndexEntry[] {
  const items = order === 'count' ? mistakesForPractice(ctx.mistakes) : mistakesByRecency(ctx.mistakes);
  const list = items.flatMap((i) => {
    const e = byId.get(i.entry_id);
    return e ? [e] : [];
  });
  if (order === 'alpha') list.sort((a, b) => normalizeWord(a.word).localeCompare(normalizeWord(b.word), 'en') || a.level - b.level);
  return list;
}

function studyEntries(ctx: SelectionContext, which: 'all' | 'due', byId: Map<string, VocabIndexEntry>): VocabIndexEntry[] {
  return Object.entries(ctx.srs.cards)
    .filter(([, card]) => which === 'all' || isDue(card, ctx.now))
    .sort(([a, ca], [b, cb]) => ca.added_at - cb.added_at || a.localeCompare(b))
    .flatMap(([id]) => {
      const e = byId.get(id);
      return e ? [e] : [];
    });
}

const byIdCache = new WeakMap<readonly VocabIndexEntry[], Map<string, VocabIndexEntry>>();

function indexById(index: readonly VocabIndexEntry[]): Map<string, VocabIndexEntry> {
  let map = byIdCache.get(index);
  if (!map) {
    map = new Map(index.map((e) => [e.id, e]));
    byIdCache.set(index, map);
  }
  return map;
}

/** 來源的所有字（未截斷）。 */
export function sourceEntries(source: HandoutSource, ctx: SelectionContext): VocabIndexEntry[] {
  switch (source.kind) {
    case 'levels':
      return applyRange(levelEntries(ctx.index, source.levels), source.range);
    case 'filters':
      return searchVocab(ctx.index, source.filters).entries;
    case 'mistakes':
      return mistakeEntries(ctx, source.order, indexById(ctx.index));
    case 'study':
      return studyEntries(ctx, source.which, indexById(ctx.index));
  }
}

export function selectHandoutEntries(source: HandoutSource, ctx: SelectionContext, limit: number = HANDOUT_LIMITS.words): Selection {
  const all = sourceEntries(source, ctx);
  const entries = all.slice(0, limit);
  const levels = [...new Set(entries.map((e) => e.level))].sort((a, b) => a - b);
  return { entries, total: all.length, truncated: all.length > entries.length, levels };
}

/** 錯題本、每日學習的字數（入口與來源選項上顯示「錯題本（45 字）」；對不到索引的 id 不算）。 */
export function sourceCount(source: HandoutSource, ctx: SelectionContext): number {
  return sourceEntries(source, ctx).length;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseFilters(raw: unknown): LibraryFilters | null {
  if (!isObject(raw)) return null;
  const pos = POS_FILTER_OPTIONS.find((o) => o.value === raw['pos'])?.value;
  const cefr = CEFR_FILTER_OPTIONS.find((o) => o.value === raw['cefr'])?.value;
  const exam = EXAM_FILTER_OPTIONS.find((o) => o.value === raw['exam'])?.value;
  const sort = SORT_OPTIONS.find((o) => o.value === raw['sort'])?.value;
  if (typeof raw['query'] !== 'string' || !Array.isArray(raw['levels']) || !pos || !cefr || !exam || !sort) return null;
  const levels = [...new Set(raw['levels'].filter(isVocabLevel))].sort((a, b) => a - b);
  return { query: raw['query'].slice(0, 100), levels, pos, cefr, exam, sort };
}

/**
 * history state 裡的來源（navigation.ts 的 vocabHandoutSource）→ HandoutSource；形狀不對（舊版、被改過）回傳 null，講義頁改用預設來源。
 */
export function parseHandoutSource(raw: unknown): HandoutSource | null {
  if (!isObject(raw)) return null;
  switch (raw['kind']) {
    case 'levels': {
      const levels = Array.isArray(raw['levels']) ? [...new Set(raw['levels'].filter(isVocabLevel))].sort((a, b) => a - b) : [];
      return levels.length > 0 ? { kind: 'levels', levels, range: parseRange(raw['range']) } : null;
    }
    case 'filters': {
      const filters = parseFilters(raw['filters']);
      return filters ? { kind: 'filters', filters } : null;
    }
    case 'mistakes':
      return { kind: 'mistakes', order: raw['order'] === 'count' || raw['order'] === 'alpha' ? raw['order'] : 'recent' };
    case 'study':
      return { kind: 'study', which: raw['which'] === 'due' ? 'due' : 'all' };
    default:
      return null;
  }
}
