/**
 * 計分：單選、選項庫、多選部分給分 (n − 2k)/n、送分與官方公告的其他答案（docs/research/02 §4.1、schema 文件 scoring_exception）。
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceQuestion, MultiSelectQuestion, Question } from '../../data/exams';
import { formatPoints, isAnswered, multiSelectFraction, scoreExam, scoreQuestion } from './scoring';
import { MINI_EXAM } from './testFixtures';

const single = (overrides: Partial<ChoiceQuestion> = {}): ChoiceQuestion => ({
  no: 1,
  label: '1',
  mode: 'single_choice',
  stem: 'stem',
  options: { A: 'a', B: 'b', C: 'c', D: 'd' },
  answer: 'B',
  accepted_answers: null,
  points: 1,
  stats: null,
  tags: {},
  ...overrides,
});

const multi = (answer: MultiSelectQuestion['answer'], points = 4): MultiSelectQuestion => ({
  no: 49,
  label: '49',
  mode: 'multi_select',
  stem: 'stem',
  options: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f' },
  answer,
  accepted_answers: null,
  points,
  stats: null,
  tags: {},
});

describe('單選與選項庫', () => {
  it('答對得全部分數、答錯與未作答 0 分', () => {
    expect(scoreQuestion(single(), 'B')).toMatchObject({ kind: 'auto', earned: 1, status: 'correct' });
    expect(scoreQuestion(single(), 'A')).toMatchObject({ earned: 0, status: 'wrong' });
    expect(scoreQuestion(single(), undefined)).toMatchObject({ earned: 0, status: 'unanswered' });
    expect(scoreQuestion(single(), '')).toMatchObject({ earned: 0, status: 'unanswered' });
  });

  it('bank_choice（文意選填、篇章結構）同單選，用題目自己的配分', () => {
    const q: Question = { ...single({ points: 2 }), mode: 'bank_choice', options: null, answer: 'E' };
    expect(scoreQuestion(q, 'E')).toMatchObject({ earned: 2, max: 2, status: 'correct' });
    expect(scoreQuestion(q, 'C')).toMatchObject({ earned: 0, max: 2, status: 'wrong' });
  });

  it('送分（all_credit）：不論作答內容、包括未作答都給滿分', () => {
    const q = single({ points: 2, scoring_exception: { type: 'all_credit', note: '試題疑義' } });
    for (const value of ['A', 'B', undefined]) {
      expect(scoreQuestion(q, value)).toMatchObject({ earned: 2, status: 'all_credit' });
    }
  });

  it('多個答案皆給分（multiple_correct）：accepted_answers 裡的選項也算對', () => {
    const q = single({ accepted_answers: ['C'], scoring_exception: { type: 'multiple_correct', note: null } });
    expect(scoreQuestion(q, 'B')).toMatchObject({ earned: 1, status: 'correct' });
    expect(scoreQuestion(q, 'C')).toMatchObject({ earned: 1, status: 'correct' });
    expect(scoreQuestion(q, 'D')).toMatchObject({ earned: 0, status: 'wrong' });
  });

  it('選擇題的 accepted_answers 即使還沒標 scoring_exception 也給分（gsat-84 第 45 題）', () => {
    expect(scoreQuestion(single({ accepted_answers: ['C'] }), 'C')).toMatchObject({ earned: 1, status: 'correct' });
  });

  it('scoring_exception 是 other 時照正常規則計分', () => {
    const q = single({ scoring_exception: { type: 'other', note: '說明' } });
    expect(scoreQuestion(q, 'B')).toMatchObject({ earned: 1, status: 'correct' });
    expect(scoreQuestion(q, 'A')).toMatchObject({ earned: 0, status: 'wrong' });
  });
});

describe('多選題 (n − 2k)/n', () => {
  it('公式本身：各選項獨立判定，該選沒選、不該選卻選都算錯一個', () => {
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'D', 'E'])).toEqual({ fraction: 1, wrong: 0 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'D'])).toEqual({ fraction: 4 / 6, wrong: 1 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'D', 'E', 'F'])).toEqual({ fraction: 4 / 6, wrong: 1 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A'])).toEqual({ fraction: 2 / 6, wrong: 2 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'B'])).toEqual({ fraction: 0, wrong: 3 });
    // 錯 3 個：(6 − 6)/6 = 0；錯更多也不會變成負分。
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['B', 'C', 'F']).fraction).toBe(0);
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'B', 'C', 'D', 'E', 'F']).fraction).toBe(0);
  });

  it('全部未作答得 0 分（不是 (n − 2k)/n）', () => {
    // 正確答案只有 1 個時，什麼都不選的 k = 1，公式會算出 4/6；官方規定未作答一律 0 分。
    expect(multiSelectFraction(6, ['A'], [])).toEqual({ fraction: 0, wrong: 1 });
  });

  it('02 文件 §4.1 的例子：n = 6、4 分，錯 1 個 2.67 分、錯 2 個 1.33 分、錯 3 個 0 分', () => {
    const q = multi(['A', 'D', 'E']);
    expect(scoreQuestion(q, ['A', 'D', 'E'])).toMatchObject({ earned: 4, status: 'correct', wrongOptions: 0 });
    const one = scoreQuestion(q, ['A', 'D']);
    expect(one).toMatchObject({ status: 'partial', wrongOptions: 1 });
    expect(one.kind === 'auto' && formatPoints(one.earned)).toBe('2.67');
    const two = scoreQuestion(q, ['A']);
    expect(two.kind === 'auto' && formatPoints(two.earned)).toBe('1.33');
    expect(scoreQuestion(q, ['B', 'C', 'F'])).toMatchObject({ earned: 0, status: 'wrong', wrongOptions: 6 });
    expect(scoreQuestion(q, [])).toMatchObject({ earned: 0, status: 'unanswered' });
  });
});

describe('非選擇題', () => {
  it('不自動計分，只記配分與是否作答', () => {
    const q: Question = { ...single({ points: 2 }), mode: 'fill_in_blank', options: null, answer: 'innovation' };
    expect(scoreQuestion(q, 'innovation')).toEqual({ kind: 'manual', max: 2, answered: true });
    expect(scoreQuestion(q, '   ')).toEqual({ kind: 'manual', max: 2, answered: false });
  });

  it('isAnswered：空白字串、空陣列、全空的表格都算沒作答', () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered(' ')).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(['', ' '])).toBe(false);
    expect(isAnswered(['', 'Omega-3s'])).toBe(true);
  });
});

describe('整份考卷', () => {
  it('依大題加總：選擇題自動計分，非選擇題只列配分', () => {
    const score = scoreExam(MINI_EXAM, {
      '1': 'B', // 對 +1
      '2': 'A', // 送分 +1
      '11': 'B', // 對 +1
      '12': 'A', // 錯
      '21': 'E', // 對 +1
      '22': 'D', // 錯
      '40': 'A', // 對 +2
      '47': 'innovation', // 非選擇，不計
      '49': ['A', 'D'], // 錯 1 個：4 × 4/6
      中譯英1: 'Now more and more teachers...',
    });
    expect(formatPoints(score.earned)).toBe(formatPoints(1 + 1 + 1 + 1 + 2 + (4 * 4) / 6));
    expect(score.autoMax).toBe(2 + 2 + 3 + 2 + 4);
    expect(score.manualMax).toBe(2 + 2 + 4 + 20);
    expect(score.answeredCount).toBe(10);
    expect(score.questionCount).toBe(13);

    const bySection = Object.fromEntries(score.sections.map((s) => [s.type, s]));
    expect(bySection['vocabulary']).toMatchObject({ earned: 2, autoMax: 2, correctCount: 2, autoCount: 2 });
    expect(bySection['cloze']).toMatchObject({ earned: 1, correctCount: 1 });
    expect(bySection['word_bank']).toMatchObject({ earned: 1, autoMax: 3, answeredCount: 2 });
    expect(bySection['mixed']).toMatchObject({ autoCount: 1, autoMax: 4, manualMax: 4, correctCount: 0 });
    expect(bySection['composition']).toMatchObject({ autoCount: 0, manualMax: 20, answeredCount: 0 });
    expect(score.outcomes['49']).toMatchObject({ status: 'partial', wrongOptions: 1 });
  });

  it('formatPoints：最多兩位小數、去掉多餘的 0，避免浮點尾數', () => {
    expect(formatPoints(4)).toBe('4');
    expect(formatPoints(8 / 3)).toBe('2.67');
    expect(formatPoints(0.5)).toBe('0.5');
    expect(formatPoints(0.1 + 0.2)).toBe('0.3');
  });
});
