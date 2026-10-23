/**
 * 講義的下載檔名（docs/design/vocab-handout.md §5.5）：設計文件的例子、字數與日期只加在會變動的來源、不允許的字元。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../lib/search';
import { fileScope, handoutFileName } from './fileName';

const NOW = new Date(2026, 9, 23);

describe('handoutFileName', () => {
  it('設計文件的例子', () => {
    expect(handoutFileName({ kind: 'notes', source: { kind: 'levels', levels: [4], range: { by: 'part', size: 100, part: 3 } }, words: 100, answerKey: true, now: NOW })).toBe(
      '學測英文中心_單字講義_L4_第201-300字_含答案.pdf',
    );
    expect(handoutFileName({ kind: 'cloze', source: { kind: 'mistakes', order: 'recent' }, words: 45, answerKey: true, now: NOW })).toBe('學測英文中心_句意填空_錯題本_45字_20261023_含答案.pdf');
  });

  it('級別範圍：依字母、全部、最後一份不足一份；不連續的級別用「+」', () => {
    expect(fileScope({ kind: 'levels', levels: [3, 4, 5], range: { by: 'letters', from: 'a', to: 'c' } })).toEqual({ scope: 'L3-L5_A-C', variable: false });
    expect(fileScope({ kind: 'levels', levels: [6], range: { by: 'all' } })).toEqual({ scope: 'L6_全部', variable: false });
    expect(fileScope({ kind: 'levels', levels: [2], range: { by: 'letters', from: 'q', to: 'q' } }).scope).toBe('L2_Q');
    expect(fileScope({ kind: 'levels', levels: [1], range: { by: 'part', size: 100, part: 6 } }, 543).scope).toBe('L1_第501-543字');
    expect(fileScope({ kind: 'levels', levels: [1, 3], range: { by: 'all' } }).scope).toBe('L1+L3_全部');
  });

  it('超過一份的上限只收前 600 字時寫實際的範圍', () => {
    expect(handoutFileName({ kind: 'notes', source: { kind: 'levels', levels: [6], range: { by: 'all' } }, words: 600, total: 1002, answerKey: true, now: NOW })).toBe(
      '學測英文中心_單字講義_L6_第1-600字_含答案.pdf',
    );
    expect(fileScope({ kind: 'levels', levels: [5], range: { by: 'letters', from: 'a', to: 'f' } }, undefined, 600).scope).toBe('L5_A-F_第1-600字');
    expect(handoutFileName({ kind: 'notes', source: { kind: 'levels', levels: [6], range: { by: 'all' } }, words: 600, total: 600, answerKey: false, now: NOW })).toBe('學測英文中心_單字講義_L6_全部.pdf');
  });

  it('篩選、每日學習加字數與日期；不附答案時沒有「_含答案」', () => {
    expect(handoutFileName({ kind: 'recite', source: { kind: 'filters', filters: DEFAULT_FILTERS }, words: 12, answerKey: false, now: NOW })).toBe('學測英文中心_單字背誦版_單字庫篩選_12字_20261023.pdf');
    expect(handoutFileName({ kind: 'quiz', source: { kind: 'study', which: 'due' }, words: 8, answerKey: true, now: NOW })).toBe('學測英文中心_單字測驗卷_今日複習_8字_20261023_含答案.pdf');
    expect(handoutFileName({ kind: 'quiz', source: { kind: 'study', which: 'all' }, words: 8, answerKey: true, now: NOW })).toBe('學測英文中心_單字測驗卷_每日學習_8字_20261023_含答案.pdf');
  });

  it('檔名不允許的字元與空白一律去掉', () => {
    const name = handoutFileName({ kind: 'notes', source: { kind: 'levels', levels: [4], range: { by: 'letters', from: 'a', to: 'b' } }, words: 1, answerKey: false, now: NOW });
    expect(name).not.toMatch(/[\s/\\:*?"<>|]/u);
  });
});
