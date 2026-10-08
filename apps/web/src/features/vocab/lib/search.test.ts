/**
 * 單字庫的搜尋與篩選。
 */
import { describe, expect, it } from 'vitest';
import type { VocabIndexEntry } from '../../../data/vocab';
import { DEFAULT_FILTERS, lemmaCandidates, searchVocab, type LibraryFilters } from './search';

const e = (word: string, level: VocabIndexEntry['level'], extra: Partial<VocabIndexEntry> = {}): VocabIndexEntry => ({
  id: `${word}|${(extra.pos ?? ['n.']).join('/')}|${level}`,
  word,
  level,
  pos: ['n.'],
  zh: `${word}的意思`,
  cefr: null,
  exam_total: 0,
  exam_answer: 0,
  ...extra,
});

const ENTRIES: VocabIndexEntry[] = [
  e('act', 3, { pos: ['v.', 'n.'], zh: '行動, 表演', exam_total: 30, exam_answer: 2, cefr: 'A2' }),
  e('action', 3, { zh: '行動, 作用', exam_total: 50, cefr: 'A2' }),
  e('actor', 1, { variants: ['actress'], zh: '演員' }),
  e('café', 2, { zh: '咖啡館' }),
  e('study', 1, { pos: ['v.', 'n.'], zh: '學習, 研究', exam_total: 300, exam_answer: 1 }),
  e('stop', 1, { pos: ['v.', 'n.'], zh: '停止' }),
  e('abandon', 4, { pos: ['v.'], zh: '放棄, 拋棄', exam_total: 9, cefr: 'B1' }),
  e('about', 1, { pos: ['prep.', 'adv.'], zh: '關於' }),
  e('zeal', 6, { zh: '熱心' }),
];

const filters = (patch: Partial<LibraryFilters>): LibraryFilters => ({ ...DEFAULT_FILTERS, levels: [1, 2, 3, 4, 5, 6], ...patch });
const words = (patch: Partial<LibraryFilters>) => searchVocab(ENTRIES, filters(patch)).entries.map((x) => x.word);

describe('searchVocab', () => {
  it('預設只顯示 L3–5，依字母排序', () => {
    expect(searchVocab(ENTRIES, DEFAULT_FILTERS).entries.map((x) => x.word)).toEqual(['abandon', 'act', 'action']);
  });

  it('英文比對字的開頭（含原表的其他寫法），完全相同的字排最前面', () => {
    expect(words({ query: 'act', sort: 'exam_total' })).toEqual(['act', 'action', 'actor']);
    expect(words({ query: 'actress' })).toEqual(['actor']);
    expect(words({ query: 'ACT' })).toEqual(['act', 'action', 'actor']);
  });

  it('不分重音：cafe 找得到 café', () => {
    expect(words({ query: 'cafe' })).toEqual(['café']);
  });

  it('中文關鍵字比對釋義', () => {
    expect(words({ query: '行動' })).toEqual(['act', 'action']);
    expect(words({ query: ' 放 棄 ' })).toEqual(['abandon']);
  });

  it('規則變化找不到開頭相符的字時，倒推可能的原形', () => {
    const r = searchVocab(ENTRIES, filters({ query: 'studies' }));
    expect(r.mode).toBe('lemma');
    expect(r.entries.map((x) => x.word)).toEqual(['study']);
    expect(words({ query: 'stopped' })).toEqual(['stop']);
    expect(words({ query: 'zzz' })).toEqual([]);
  });

  it('沒勾選的級別裡還有符合的字時回報筆數', () => {
    const r = searchVocab(ENTRIES, { ...DEFAULT_FILTERS, query: 'act' });
    expect(r.entries.map((x) => x.word)).toEqual(['act', 'action']);
    expect(r.otherLevelCount).toBe(1); // actor 在 L1
  });

  it('詞性、CEFR、歷屆出現次數篩選', () => {
    expect(words({ pos: 'v.' })).toEqual(['abandon', 'act', 'stop', 'study']);
    expect(words({ pos: 'other' })).toEqual(['about']);
    expect(words({ cefr: 'A2' })).toEqual(['act', 'action']);
    expect(words({ cefr: 'none' })).toHaveLength(6);
    expect(words({ exam: 'answer' })).toEqual(['act', 'study']);
    expect(words({ exam: 'freq20', sort: 'exam_total' })).toEqual(['study', 'action', 'act']);
    expect(words({ exam: 'never' })).toEqual(['about', 'actor', 'café', 'stop', 'zeal']);
  });

  it('排序：依當正解次數、依級別', () => {
    expect(words({ exam: 'seen', sort: 'exam_answer' })).toEqual(['act', 'study', 'action', 'abandon']);
    expect(words({ query: 'a', sort: 'level' })).toEqual(['about', 'actor', 'act', 'action', 'abandon']);
  });

  it('沒選任何級別：沒有結果', () => {
    expect(words({ levels: [] })).toEqual([]);
  });
});

describe('lemmaCandidates', () => {
  it('倒推規則變化的原形', () => {
    expect(lemmaCandidates('studies')).toContain('study');
    expect(lemmaCandidates('making')).toContain('make');
    expect(lemmaCandidates('bigger')).toContain('big');
    expect(lemmaCandidates('knives')).toContain('knife');
    expect(lemmaCandidates('go')).toEqual([]);
  });
});
