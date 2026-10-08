/**
 * exam.ts 的小工具與常數。這些是之後各題型模組（前端渲染空格、Worker 匯入 D1）會共用的判斷，
 * 錯了會讓作答框放錯位置或把選擇題當成填充題，所以把規格文件裡的例子寫死在這裡。
 * 對實際 data/ 的檢查在 exam.data.test.ts（npm run test:data）。
 */
import { describe, expect, it } from 'vitest';
import { EXAM_ID_PATTERN, blankNumbers, isChoiceQuestion, type Question } from './exam';

const base = {
  no: 1,
  label: '1',
  stem: 'The mayor has such a ______ schedule.',
  accepted_answers: null,
  points: 1,
  stats: null,
  scoring_notes: null,
  tags: {},
} as const;

describe('isChoiceQuestion', () => {
  it('單選、多選、選項庫作答都是選擇題', () => {
    const questions: Question[] = [
      { ...base, mode: 'single_choice', options: { A: 'hasty', B: 'tight' }, answer: 'B' },
      { ...base, mode: 'bank_choice', options: null, answer: 'C' },
      { ...base, mode: 'multi_select', options: { A: 'x', B: 'y', C: 'z' }, answer: ['A', 'C'] },
    ];
    for (const q of questions) expect(isChoiceQuestion(q), q.mode).toBe(true);
  });

  it('填充、簡答、表格填空、翻譯、作文不是選擇題', () => {
    const questions: Question[] = [
      { ...base, mode: 'fill_in_blank', options: null, answer: 'tighten' },
      { ...base, mode: 'short_answer', options: null, answer: null },
      { ...base, mode: 'table_completion', options: null, answer: 'Tuesday' },
      { ...base, mode: 'translation', options: null, answer: null },
      { ...base, mode: 'composition', options: null, answer: null },
    ];
    for (const q of questions) expect(isChoiceQuestion(q), q.mode).toBe(false);
  });
});

describe('blankNumbers', () => {
  it('依出現順序取出 [[題號]]', () => {
    expect(blankNumbers('Text with blanks [[11]] ... [[12]] and [[13]].')).toEqual([11, 12, 13]);
  });

  it('沒有空格時回空陣列；連續呼叫結果相同（g 旗標的 lastIndex 不會殘留）', () => {
    expect(blankNumbers('no blanks here')).toEqual([]);
    expect(blankNumbers('[[1]] [[2]]')).toEqual([1, 2]);
    expect(blankNumbers('[[1]] [[2]]')).toEqual([1, 2]);
  });

  it('單層方括號或非數字不算空格', () => {
    expect(blankNumbers('[11] [[A]] [[ 12 ]]')).toEqual([]);
  });
});

describe('EXAM_ID_PATTERN（與 tools/validate_exam.py 的 ID_RE 相同）', () => {
  it('接受規格文件列出的命名', () => {
    for (const id of ['gsat-115', 'gsat-91-makeup', 'ast-110', 'ast-109-makeup', 'ref-115', 'ref-98-a']) {
      expect(EXAM_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it('拒絕不合規則的命名', () => {
    for (const id of ['gsat-1', 'gsat-1150', 'ref-115-makeup', 'ref-98-ab', 'ast-110-a', 'GSAT-115', 'gsat-115.json']) {
      expect(EXAM_ID_PATTERN.test(id), id).toBe(false);
    }
  });
});
