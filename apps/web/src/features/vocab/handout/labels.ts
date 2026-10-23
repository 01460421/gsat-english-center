/**
 * 講義的名稱、說明與標題文字（docs/design/vocab-handout.md §3.2、§5）。講義頁的畫面與 PDF 的標題區、頁首、文件屬性都用這裡的字，
 * 兩邊的寫法才會一致。這個檔案的字串會印在 PDF 上，字型檢查（scripts/font-coverage.mjs 的 PDF_DYNAMIC_FILES）會掃描這裡的
 * 字串常值：新增常用字以外的字後要跑 `npm run check:fonts -w @gsat/web`。
 *
 * 新寫的文字不寫官方考試機構的名稱；歷屆出現次數寫「歷屆 N 次」，沿用單字庫的寫法。
 */
import type { VocabLevel } from '../../../data/vocab';
import type { VocabHandoutKind } from '../../pdf/vocabTypes';
import type { LibraryFilters } from '../lib/search';
import { DEFAULT_FILTERS, EXAM_FILTER_OPTIONS, POS_FILTER_OPTIONS } from '../lib/search';
import { formatCount } from '../lib/text';
import type { LevelRange } from './options';

export const SITE_NAME = '學測英文中心';

export const HANDOUT_TYPES: Record<VocabHandoutKind, { label: string; name: string; description: string }> = {
  notes: { label: '講義版', name: '單字講義', description: '每個字附音標、釋義、變化與例句，後面接句意填空。適合新學、上課講義。' },
  recite: { label: '背誦版', name: '單字背誦版', description: '左英右中的對折表，遮住一邊自我測驗，後面接句意填空。適合考前背誦。' },
  cloze: { label: '句意填空卷', name: '句意填空', description: '只有句意填空：依句意寫出單字。適合單獨練習、小考。' },
  quiz: { label: '測驗卷', name: '單字測驗卷', description: '句意填空＋中翻英拼字＋英選中。適合週考、複習考。' },
};

/** 標題區第一行「學測英文中心　單字講義」。 */
export function handoutKicker(kind: VocabHandoutKind): string {
  return `${SITE_NAME}　${HANDOUT_TYPES[kind].name}`;
}

/** 級別清單的寫法：「Level 4」「Level 3–5」「Level 1、3、5」。 */
export function levelsText(levels: readonly VocabLevel[]): string {
  const list = [...new Set(levels)].sort((a, b) => a - b);
  if (list.length === 0) return 'Level —';
  const first = list[0] as number;
  const last = list.at(-1) as number;
  if (list.length === 1) return `Level ${first}`;
  if (last - first === list.length - 1) return `Level ${first}–${last}`;
  return `Level ${list.join('、')}`;
}

/** 短的級別寫法（檔名、篩選摘要）：「L4」「L3-L5」「L1、L3」。 */
export function levelsShort(levels: readonly VocabLevel[], dash = '–'): string {
  const list = [...new Set(levels)].sort((a, b) => a - b);
  const first = list[0];
  const last = list.at(-1);
  if (first === undefined || last === undefined) return '';
  if (list.length === 1) return `L${first}`;
  if (last - first === list.length - 1) return `L${first}${dash}L${last}`;
  return list.map((l) => `L${l}`).join('、');
}

/** 「依份數」一份的範圍：「第 201–300 字」。 */
export function partRangeText(size: number, part: number, total?: number): string {
  const from = (part - 1) * size + 1;
  const to = total === undefined ? part * size : Math.min(part * size, total);
  return `第 ${formatCount(from)}–${formatCount(to)} 字`;
}

/** 級別範圍的說明：「第 201–300 字」「A–C 開頭」「全部」。 */
export function rangeText(range: LevelRange, total?: number): string {
  if (range.by === 'all') return '全部';
  if (range.by === 'letters') return range.from === range.to ? `${range.from.toUpperCase()} 開頭` : `${range.from.toUpperCase()}–${range.to.toUpperCase()} 開頭`;
  return partRangeText(range.size, range.part, total);
}

/**
 * 單字庫篩選結果的摘要：「L3–5・動詞・歷屆出現過・搜尋「ab」」。
 * 不寫 CEFR 篩選（講義不印 CEFR，§2.1：C1／C2 的對照是 CC BY-SA，印了整份要相同方式分享）。
 */
export function filtersText(filters: LibraryFilters): string {
  const parts: string[] = [];
  if (filters.levels.length > 0) parts.push(levelsShort(filters.levels).replace(/^L(\d)–L(\d)$/u, 'L$1–$2'));
  if (filters.pos !== DEFAULT_FILTERS.pos) parts.push((POS_FILTER_OPTIONS.find((o) => o.value === filters.pos)?.label ?? '').replace(/\s.*$/u, ''));
  if (filters.exam !== DEFAULT_FILTERS.exam) parts.push(EXAM_FILTER_OPTIONS.find((o) => o.value === filters.exam)?.label ?? '');
  const q = filters.query.trim();
  if (q) parts.push(`搜尋「${q.length > 12 ? `${q.slice(0, 12)}…` : q}」`);
  return parts.filter(Boolean).join('・');
}

/** 錯題本的排序。 */
export const MISTAKE_ORDERS = [
  { value: 'recent', label: '依最近答錯' },
  { value: 'count', label: '依答錯次數' },
  { value: 'alpha', label: '依字母' },
] as const;

/** 每日學習的範圍。 */
export const STUDY_WHICH = [
  { value: 'all', label: '加入學習的所有字' },
  { value: 'due', label: '今天到期要複習的字' },
] as const;

export const SORT_LABELS = {
  alpha: '依字母',
  exam: '依歷屆出現次數',
  source: '依來源順序',
} as const;

/** 講義的說明行：「100 字・句意填空 86 題・2026-10-23 製作」。 */
export function metaLine(parts: { words: number; cloze: number; spelling?: number; choice?: number; date: string }): string {
  const items = [`${formatCount(parts.words)} 字`, `句意填空 ${formatCount(parts.cloze)} 題`];
  if (parts.spelling !== undefined && parts.spelling > 0) items.push(`中翻英拼字 ${formatCount(parts.spelling)} 題`);
  if (parts.choice !== undefined && parts.choice > 0) items.push(`英選中 ${formatCount(parts.choice)} 題`);
  items.push(`${parts.date} 製作`);
  return items.join('・');
}

/** 「2026-10-23」（本地日期）。 */
export function dateText(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 講義來源（只用到判斷寫法的欄位；完整型別在 selection.ts）。 */
type SourceForLabel =
  | { kind: 'levels'; levels: readonly VocabLevel[]; range: LevelRange }
  | { kind: 'filters'; filters: LibraryFilters }
  | { kind: 'mistakes' }
  | { kind: 'study'; which: 'all' | 'due' };

/**
 * 講義的標題（標題區第二行）：「Level 4　第 201–300 字」「錯題本　45 字」「單字庫篩選結果　L3–5・動詞」。
 * count：收進講義的字數；rangeTotal：級別範圍「依份數」時這幾級的總字數（最後一份不滿 100 字時寫實際的迄號）；
 * total：來源本身的字數。超過一份的上限、只收前 count 字時，標題寫出實際的範圍，不寫「全部」：
 * 「Level 6　第 1–600 字」「Level 5　A–F 開頭・第 1–600 字」「單字庫篩選結果　L3–5・第 1–600 字」「錯題本　第 1–600 字（共 700 字）」。
 */
export function sourceTitle(source: SourceForLabel, count: number, rangeTotal?: number, total?: number): string {
  const cut = total !== undefined && total > count ? partRangeText(count, 1) : null;
  switch (source.kind) {
    case 'levels': {
      const levels = levelsText(source.levels);
      if (!cut) return `${levels}　${rangeText(source.range, rangeTotal)}`;
      return source.range.by === 'letters' ? `${levels}　${rangeText(source.range)}・${cut}` : `${levels}　${cut}`;
    }
    case 'filters': {
      const detail = [filtersText(source.filters), cut].filter(Boolean).join('・');
      return detail ? `單字庫篩選結果　${detail}` : '單字庫篩選結果';
    }
    case 'mistakes':
      return cut ? `錯題本　${cut}（共 ${formatCount(total ?? count)} 字）` : `錯題本　${formatCount(count)} 字`;
    case 'study': {
      const name = source.which === 'due' ? '今日複習' : '每日學習的字';
      return cut ? `${name}　${cut}（共 ${formatCount(total ?? count)} 字）` : `${name}　${formatCount(count)} 字`;
    }
  }
}
