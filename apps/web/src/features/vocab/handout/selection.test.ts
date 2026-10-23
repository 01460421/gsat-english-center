/**
 * 講義的選字（docs/design/vocab-handout.md §5.3）、檔名（§5.5）與設定記憶（§5.4）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { VocabIndexEntry } from '../../../data/vocab';
import { createMistakeBook, recordAnswer } from '../lib/mistakes';
import { DEFAULT_FILTERS } from '../lib/search';
import { addCard, createSrsState } from '../lib/srs';
import { fixtureIndex } from '../testing/fixtures';
import { handoutFileName } from './fileName';
import { filtersText, levelsText, sourceTitle } from './labels';
import { DEFAULT_HANDOUT_OPTIONS, HANDOUT_STORAGE_KEY, defaultHandoutSettings, loadHandoutSettings, parseHandoutSettings, saveHandoutSettings } from './options';
import { letterOptions, levelEntries, parseHandoutSource, partOptions, selectHandoutEntries, type SelectionContext } from './selection';

const NOW = new Date(2026, 9, 23, 10, 0).getTime();

function ctx(extra: Partial<SelectionContext> = {}): SelectionContext {
  return { index: fixtureIndex().entries, mistakes: createMistakeBook(NOW), srs: createSrsState(NOW), now: NOW, ...extra };
}

/** 大量的假索引（切份數用）：L4 有 230 個字。 */
function bigIndex(): VocabIndexEntry[] {
  return Array.from({ length: 230 }, (_, i) => ({
    id: `w${String(i).padStart(3, '0')}|n.|4`,
    word: `${String.fromCharCode(97 + Math.floor(i / 10))}w${String(i).padStart(3, '0')}`,
    level: 4 as const,
    pos: ['n.' as const],
    zh: '字',
    cefr: null,
    exam_total: 0,
    exam_answer: 0,
  }));
}

describe('級別範圍', () => {
  it('依份數：每 50 或 100 字一份，最後一份不滿；下拉選單列出起訖字', () => {
    const c = ctx({ index: bigIndex() });
    const third = selectHandoutEntries({ kind: 'levels', levels: [4], range: { by: 'part', size: 100, part: 3 } }, c);
    expect(third.entries).toHaveLength(30);
    expect(third.entries[0]?.word).toBe('uw200');
    const parts = partOptions(levelEntries(c.index, [4]), 50);
    expect(parts).toHaveLength(5);
    expect(parts[1]).toEqual({ part: 2, from: 51, to: 100, first: 'fw050', last: 'jw099' });
  });

  it('依字母：起訖字母（含）；全部；依級別再依字母', () => {
    const c = ctx();
    const ab = selectHandoutEntries({ kind: 'levels', levels: [3, 4], range: { by: 'letters', from: 'a', to: 'b' } }, c);
    expect(ab.entries.every((e) => /^[ab]/.test(e.word))).toBe(true);
    expect(ab.entries.map((e) => e.level)).toEqual([...ab.entries.map((e) => e.level)].sort());
    expect(ab.levels).toEqual([3, 4]);
    const all = selectHandoutEntries({ kind: 'levels', levels: [5], range: { by: 'all' } }, c);
    expect(all.entries).toHaveLength(30);
    expect(letterOptions(levelEntries(c.index, [3]))).toContain('a');
  });

  it('超過 600 字只收前 600 字並標示截斷；0 字', () => {
    const many = Array.from({ length: 700 }, (_, i) => ({ ...bigIndex()[0]!, id: `x${i}|n.|4`, word: `x${String(i).padStart(4, '0')}` }));
    const s = selectHandoutEntries({ kind: 'levels', levels: [4], range: { by: 'all' } }, ctx({ index: many }));
    expect(s).toMatchObject({ total: 700, truncated: true });
    expect(s.entries).toHaveLength(600);
    expect(selectHandoutEntries({ kind: 'levels', levels: [6], range: { by: 'all' } }, ctx()).entries).toEqual([]);
  });
});

describe('其他來源', () => {
  it('單字庫篩選結果：照 searchVocab 的結果與排序', () => {
    const s = selectHandoutEntries({ kind: 'filters', filters: { ...DEFAULT_FILTERS, query: 'acc', levels: [3, 4, 5] } }, ctx());
    expect(s.entries.map((e) => e.word)).toEqual(['accomplish']);
  });

  it('錯題本：依最近答錯、答錯次數、字母；對不到索引的 id 略過', () => {
    let book = createMistakeBook(NOW);
    const wrong = (entryId: string, word: string, at: number) => {
      book = recordAnswer(book, { entryId, word, mode: 'en2zh', correct: false }, false, at);
    };
    wrong('achieve|v./(n.)|3', 'achieve', NOW - 3000);
    wrong('accomplish|v.|4', 'accomplish', NOW - 2000);
    wrong('accomplish|v.|4', 'accomplish', NOW - 1000);
    wrong('gone|v.|3', 'gone', NOW);
    const c = ctx({ mistakes: book });
    expect(selectHandoutEntries({ kind: 'mistakes', order: 'recent' }, c).entries.map((e) => e.word)).toEqual(['accomplish', 'achieve']);
    expect(selectHandoutEntries({ kind: 'mistakes', order: 'count' }, c).entries.map((e) => e.word)).toEqual(['accomplish', 'achieve']);
    expect(selectHandoutEntries({ kind: 'mistakes', order: 'alpha' }, c).entries.map((e) => e.word)).toEqual(['accomplish', 'achieve']);
  });

  it('每日學習：加入過的所有字依加入先後；今天到期的字（新卡不算）', () => {
    let srs = createSrsState(NOW);
    srs = addCard(srs, 'achieve|v./(n.)|3', NOW - 2000);
    srs = addCard(srs, 'accomplish|v.|4', NOW - 1000);
    const c = ctx({ srs });
    expect(selectHandoutEntries({ kind: 'study', which: 'all' }, c).entries.map((e) => e.word)).toEqual(['achieve', 'accomplish']);
    expect(selectHandoutEntries({ kind: 'study', which: 'due' }, c).entries).toEqual([]);
  });

  it('history state 的來源：形狀不對回傳 null；欄位不合法時改用預設值', () => {
    expect(parseHandoutSource(null)).toBeNull();
    expect(parseHandoutSource({ kind: 'nope' })).toBeNull();
    expect(parseHandoutSource({ kind: 'filters', filters: { query: 1 } })).toBeNull();
    expect(parseHandoutSource({ kind: 'filters', filters: { ...DEFAULT_FILTERS, levels: [9, 4, 4] } })).toEqual({ kind: 'filters', filters: { ...DEFAULT_FILTERS, levels: [4] } });
    expect(parseHandoutSource({ kind: 'mistakes', order: 'x' })).toEqual({ kind: 'mistakes', order: 'recent' });
    expect(parseHandoutSource({ kind: 'levels', levels: [4], range: { by: 'part', size: 70, part: 2 } })).toEqual({ kind: 'levels', levels: [4], range: { by: 'part', size: 50, part: 1 } });
  });
});

describe('標題與檔名（§3.2、§5.5）', () => {
  const now = new Date(2026, 9, 23);
  it('標題', () => {
    expect(levelsText([3, 4, 5])).toBe('Level 3–5');
    expect(levelsText([1, 3])).toBe('Level 1、3');
    expect(sourceTitle({ kind: 'levels', levels: [4], range: { by: 'part', size: 100, part: 3 } }, 100)).toBe('Level 4　第 201–300 字');
    expect(sourceTitle({ kind: 'levels', levels: [4], range: { by: 'part', size: 100, part: 11 } }, 2, 1002)).toBe('Level 4　第 1,001–1,002 字');
    expect(sourceTitle({ kind: 'mistakes' }, 45)).toBe('錯題本　45 字');
    expect(sourceTitle({ kind: 'study', which: 'due' }, 3)).toBe('今日複習　3 字');
    expect(filtersText({ ...DEFAULT_FILTERS, pos: 'v.', cefr: 'C1', query: 'ab' })).toBe('L3–5・動詞・搜尋「ab」');
  });

  it('標題：超過一份的上限只收前 600 字時寫實際的範圍，不寫「全部」', () => {
    expect(sourceTitle({ kind: 'levels', levels: [6], range: { by: 'all' } }, 600, undefined, 1002)).toBe('Level 6　第 1–600 字');
    expect(sourceTitle({ kind: 'levels', levels: [6], range: { by: 'all' } }, 600, undefined, 600)).toBe('Level 6　全部');
    expect(sourceTitle({ kind: 'levels', levels: [5], range: { by: 'letters', from: 'a', to: 'f' } }, 600, undefined, 700)).toBe('Level 5　A–F 開頭・第 1–600 字');
    expect(sourceTitle({ kind: 'filters', filters: DEFAULT_FILTERS }, 600, undefined, 2991)).toBe('單字庫篩選結果　L3–5・第 1–600 字');
    expect(sourceTitle({ kind: 'mistakes' }, 600, undefined, 700)).toBe('錯題本　第 1–600 字（共 700 字）');
    expect(sourceTitle({ kind: 'study', which: 'all' }, 600, undefined, 1200)).toBe('每日學習的字　第 1–600 字（共 1,200 字）');
  });

  it('檔名：設計文件 §5.5 的例子、非法字元', () => {
    expect(handoutFileName({ kind: 'notes', source: { kind: 'levels', levels: [4], range: { by: 'part', size: 100, part: 3 } }, words: 100, answerKey: true, now })).toBe(
      '學測英文中心_單字講義_L4_第201-300字_含答案.pdf',
    );
    expect(handoutFileName({ kind: 'cloze', source: { kind: 'mistakes', order: 'recent' }, words: 45, answerKey: true, now })).toBe('學測英文中心_句意填空_錯題本_45字_20261023_含答案.pdf');
    expect(handoutFileName({ kind: 'recite', source: { kind: 'levels', levels: [3, 4, 5], range: { by: 'letters', from: 'a', to: 'c' } }, words: 300, answerKey: false, now })).toBe(
      '學測英文中心_單字背誦版_L3-L5_A-C.pdf',
    );
    expect(handoutFileName({ kind: 'quiz', source: { kind: 'levels', levels: [6], range: { by: 'all' } }, words: 600, answerKey: true, now })).toBe('學測英文中心_單字測驗卷_L6_全部_含答案.pdf');
    expect(handoutFileName({ kind: 'notes', source: { kind: 'study', which: 'due' }, words: 3, answerKey: false, now })).toBe('學測英文中心_單字講義_今日複習_3字_20261023.pdf');
    expect(handoutFileName({ kind: 'notes', source: { kind: 'filters', filters: DEFAULT_FILTERS }, words: 12, answerKey: false, now })).not.toMatch(/[\s/\\:*?"<>|]/);
  });
});

describe('設定記憶（§5.4）', () => {
  it('壞掉的存檔：整份或逐欄回到預設值', () => {
    expect(parseHandoutSettings(null)).toEqual(defaultHandoutSettings());
    expect(parseHandoutSettings('{not json')).toEqual(defaultHandoutSettings());
    const parsed = parseHandoutSettings(JSON.stringify({ type: 'quiz', options: { examples: 'yes', ipa: false, clozeCount: 7, sort: 'exam' }, levels: [9], range: { by: 'letters', from: 'c', to: 'a' } }));
    expect(parsed.type).toBe('quiz');
    expect(parsed.options).toEqual({ ...DEFAULT_HANDOUT_OPTIONS, ipa: false, sort: 'exam' });
    expect(parsed.levels).toEqual([3]);
    expect(parsed.range).toEqual({ by: 'letters', from: 'a', to: 'c' });
  });

  it('localStorage 讀寫（丟例外時用預設值，不影響產生講義）', () => {
    saveHandoutSettings({ ...defaultHandoutSettings(), type: 'recite' });
    expect(window.localStorage.getItem(HANDOUT_STORAGE_KEY)).toContain('recite');
    expect(loadHandoutSettings().type).toBe('recite');
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    try {
      expect(loadHandoutSettings()).toEqual(defaultHandoutSettings());
      expect(() => saveHandoutSettings(defaultHandoutSettings())).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
