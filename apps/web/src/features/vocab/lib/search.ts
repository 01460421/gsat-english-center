/**
 * 單字庫的篩選、搜尋與排序（純函式，對 /data/vocab/index.json 的 6,012 筆操作）。
 *
 * 全部在前端算：資料只有幾千筆，每次按鍵重新過濾一次不到幾毫秒，不值得為此建倒排索引或打 API。
 * 比較花時間的是英文字的正規化（NFKD），所以每份索引只做一次，結果放在 WeakMap。
 */
import type { CefrLevel, VocabIndexEntry, VocabLevel, VocabPos } from '../../../data/vocab';
import { VOCAB_TIERS } from '../../../data/vocab';
import { regularInflections } from './forms';
import { hasHan, normalizeWord } from './text';

export type PosFilter = 'all' | 'n.' | 'v.' | 'adj.' | 'adv.' | 'other';
export type CefrFilter = 'all' | CefrLevel | 'none';
export type ExamFilter = 'all' | 'seen' | 'answer' | 'freq5' | 'freq20' | 'never';
export type SortKey = 'alpha' | 'exam_total' | 'exam_answer' | 'level';

export interface LibraryFilters {
  query: string;
  levels: readonly VocabLevel[];
  pos: PosFilter;
  cefr: CefrFilter;
  exam: ExamFilter;
  sort: SortKey;
}

/** 預設只看主力層 L3–5（03 文件 §9.1）；從 VOCAB_TIERS 取，分層定義改了這裡跟著改。 */
export const DEFAULT_LEVELS: readonly VocabLevel[] = VOCAB_TIERS.find((t) => t.id === 'core')?.levels ?? [3, 4, 5];

export const DEFAULT_FILTERS: LibraryFilters = {
  query: '',
  levels: DEFAULT_LEVELS,
  pos: 'all',
  cefr: 'all',
  exam: 'all',
  sort: 'alpha',
};

export const POS_FILTER_OPTIONS: readonly { value: PosFilter; label: string }[] = [
  { value: 'all', label: '全部詞性' },
  { value: 'n.', label: '名詞 n.' },
  { value: 'v.', label: '動詞 v.' },
  { value: 'adj.', label: '形容詞 adj.' },
  { value: 'adv.', label: '副詞 adv.' },
  { value: 'other', label: '其他（介系詞、連接詞…）' },
];

export const CEFR_FILTER_OPTIONS: readonly { value: CefrFilter; label: string }[] = [
  { value: 'all', label: '全部 CEFR' },
  { value: 'A1', label: '約 A1' },
  { value: 'A2', label: '約 A2' },
  { value: 'B1', label: '約 B1' },
  { value: 'B2', label: '約 B2' },
  { value: 'C1', label: '約 C1' },
  { value: 'C2', label: '約 C2' },
  { value: 'none', label: '沒有 CEFR 對照' },
];

export const EXAM_FILTER_OPTIONS: readonly { value: ExamFilter; label: string }[] = [
  { value: 'all', label: '不限歷屆出現' },
  { value: 'seen', label: '歷屆出現過' },
  { value: 'freq5', label: '出現 5 次以上' },
  { value: 'freq20', label: '出現 20 次以上' },
  { value: 'answer', label: '曾當單字題正解' },
  { value: 'never', label: '從未出現' },
];

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'alpha', label: '依字母' },
  { value: 'exam_total', label: '依歷屆出現次數' },
  { value: 'exam_answer', label: '依當正解次數' },
  { value: 'level', label: '依級別' },
];

const OTHER_POS: readonly VocabPos[] = ['prep.', 'conj.', 'pron.', 'aux.', 'art.'];

interface Prepared {
  entry: VocabIndexEntry;
  /** 正規化後的詞頭與其他寫法。 */
  keys: string[];
}

const prepared = new WeakMap<readonly VocabIndexEntry[], Prepared[]>();

function prepare(entries: readonly VocabIndexEntry[]): Prepared[] {
  let list = prepared.get(entries);
  if (!list) {
    list = entries.map((entry) => ({ entry, keys: [entry.word, ...(entry.variants ?? [])].map(normalizeWord) }));
    prepared.set(entries, list);
  }
  return list;
}

function matchesPos(entry: VocabIndexEntry, pos: PosFilter): boolean {
  if (pos === 'all') return true;
  if (pos === 'other') return entry.pos.some((p) => OTHER_POS.includes(p));
  return entry.pos.includes(pos);
}

function matchesCefr(entry: VocabIndexEntry, cefr: CefrFilter): boolean {
  if (cefr === 'all') return true;
  if (cefr === 'none') return entry.cefr === null;
  return entry.cefr === cefr;
}

function matchesExam(entry: VocabIndexEntry, exam: ExamFilter): boolean {
  switch (exam) {
    case 'all':
      return true;
    case 'seen':
      return entry.exam_total > 0;
    case 'freq5':
      return entry.exam_total >= 5;
    case 'freq20':
      return entry.exam_total >= 20;
    case 'answer':
      return entry.exam_answer > 0;
    case 'never':
      return entry.exam_total === 0;
  }
}

/**
 * 從可能的變化形倒推原形候選（studies → study、stopped → stop、making → make）。
 * 只處理規則變化；went → go 這種不規則形式要查詞形表，索引裡沒有。
 */
export function lemmaCandidates(query: string): string[] {
  const q = normalizeWord(query);
  if (!/^[a-z]{3,}$/.test(q)) return [];
  const out = new Set<string>();
  const strip = (suffix: string, add = '') => {
    if (q.endsWith(suffix) && q.length > suffix.length + 1) out.add(q.slice(0, -suffix.length) + add);
  };
  strip('ies', 'y');
  strip('ied', 'y');
  strip('ier', 'y');
  strip('iest', 'y');
  strip('ves', 'f');
  strip('ves', 'fe');
  strip('es');
  strip('s');
  strip('ed');
  strip('d');
  strip('ing');
  strip('ing', 'e');
  strip('er');
  strip('r');
  strip('est');
  strip('st');
  // 重複子音：stopped → stopp → stop、bigger → bigg → big。
  for (const c of [...out]) if (/([b-df-hj-np-tv-z])\1$/.test(c)) out.add(c.slice(0, -1));
  out.delete(q);
  return [...out];
}

export interface SearchResult {
  entries: VocabIndexEntry[];
  /**
   * none：沒有輸入搜尋字；prefix：英文開頭比對；zh：中文關鍵字；
   * lemma：英文開頭比對沒有結果，改用「可能的原形」找到的（畫面上要說明）。
   */
  mode: 'none' | 'prefix' | 'zh' | 'lemma';
  /** 有輸入搜尋字時，未勾選的級別裡還有幾筆符合（提示學生放寬級別）。 */
  otherLevelCount: number;
}

function compareAlpha(a: Prepared, b: Prepared): number {
  return (a.keys[0] ?? '').localeCompare(b.keys[0] ?? '', 'en') || a.entry.level - b.entry.level;
}

const SORTERS: Record<SortKey, (a: Prepared, b: Prepared) => number> = {
  alpha: compareAlpha,
  exam_total: (a, b) => b.entry.exam_total - a.entry.exam_total || compareAlpha(a, b),
  exam_answer: (a, b) =>
    b.entry.exam_answer - a.entry.exam_answer || b.entry.exam_total - a.entry.exam_total || compareAlpha(a, b),
  level: (a, b) => a.entry.level - b.entry.level || compareAlpha(a, b),
};

/** 依篩選條件過濾並排序。搜尋字完全相同的條目一律排在最前面（搜 act 時 act 要在 action 前）。 */
export function searchVocab(entries: readonly VocabIndexEntry[], filters: LibraryFilters): SearchResult {
  const list = prepare(entries);
  const levels = new Set<number>(filters.levels);
  const passesOthers = (p: Prepared) =>
    matchesPos(p.entry, filters.pos) && matchesCefr(p.entry, filters.cefr) && matchesExam(p.entry, filters.exam);

  const raw = filters.query.trim();
  let mode: SearchResult['mode'] = 'none';
  let matchesQuery: (p: Prepared) => boolean = () => true;
  let exact: (p: Prepared) => boolean = () => false;
  if (raw) {
    if (hasHan(raw)) {
      mode = 'zh';
      const needle = raw.replace(/\s+/g, '');
      matchesQuery = (p) => p.entry.zh.includes(needle);
    } else {
      mode = 'prefix';
      const q = normalizeWord(raw);
      matchesQuery = (p) => p.keys.some((k) => k.startsWith(q));
      exact = (p) => p.keys.includes(q);
    }
  }

  let hits = list.filter((p) => matchesQuery(p) && passesOthers(p));
  if (mode === 'prefix' && hits.length === 0) {
    const q = normalizeWord(raw);
    const candidates = new Set(lemmaCandidates(q));
    if (candidates.size > 0) {
      // 要求原形「真的能」規則變化成搜尋字，避免 need → ne 這種誤判。
      const lemmaHits = list.filter(
        (p) =>
          p.keys.some((k) => candidates.has(k)) &&
          Object.values(regularInflections(p.entry.word, p.entry.pos)).some((forms) => forms.includes(q)) &&
          passesOthers(p),
      );
      if (lemmaHits.length > 0) {
        mode = 'lemma';
        hits = lemmaHits;
        exact = () => false;
      }
    }
  }

  const inLevels = hits.filter((p) => levels.has(p.entry.level));
  const sorter = SORTERS[filters.sort];
  inLevels.sort((a, b) => Number(exact(b)) - Number(exact(a)) || sorter(a, b));
  return {
    entries: inLevels.map((p) => p.entry),
    mode,
    otherLevelCount: mode === 'none' ? 0 : hits.length - inLevels.length,
  };
}
