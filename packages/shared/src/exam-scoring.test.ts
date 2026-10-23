/**
 * 搬到共用套件的計分（exam-scoring.ts；docs/design/learning-assistant.md §4.5.3、§6.1）：直接跑 web 既有測試
 * （apps/web/src/features/exams/scoring.test.ts、features/mock/scoreOpen.test.ts）的案例，輸出要逐位元相同；
 * 另外確認共用的 Question（exam.ts）也可以直接傳進來。
 */
import { describe, expect, it } from 'vitest';
import type { MultiSelectQuestion, Question, SingleChoiceQuestion } from './exam';
import {
  acceptedLetters,
  isAnswered,
  multiSelectFraction,
  normalizeBankOpenAnswer,
  normalizeOpenAnswer,
  normalizeOpenAnswerCased,
  scoreQuestion,
  type SingleChoiceScorable,
} from './exam-scoring';

/** 共用的 Question（題目 JSON gsat-exam/v1.1）：多了 scoring_notes 等欄位，一樣可以傳。 */
const single = (overrides: Partial<SingleChoiceQuestion> = {}): SingleChoiceQuestion => ({
  no: 1,
  label: '1',
  mode: 'single_choice',
  stem: 'stem',
  options: { A: 'a', B: 'b', C: 'c', D: 'd' },
  answer: 'B',
  accepted_answers: null,
  points: 1,
  stats: null,
  scoring_notes: null,
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
  scoring_notes: null,
  tags: {},
});

/** 兩位小數（同 web 的 formatPoints）。 */
const two = (n: number) => Math.round(n * 100) / 100;

describe('單選與選項庫（web scoring.test.ts 的案例）', () => {
  it('答對得全部分數、答錯與未作答 0 分', () => {
    expect(scoreQuestion(single(), 'B')).toEqual({ kind: 'auto', max: 1, earned: 1, status: 'correct', wrongOptions: null });
    expect(scoreQuestion(single(), 'A')).toEqual({ kind: 'auto', max: 1, earned: 0, status: 'wrong', wrongOptions: null });
    expect(scoreQuestion(single(), undefined)).toEqual({ kind: 'auto', max: 1, earned: 0, status: 'unanswered', wrongOptions: null });
    expect(scoreQuestion(single(), '')).toEqual({ kind: 'auto', max: 1, earned: 0, status: 'unanswered', wrongOptions: null });
  });

  it('bank_choice（文意選填、篇章結構）同單選，用題目自己的配分', () => {
    const q: Question = { ...single({ points: 2 }), mode: 'bank_choice', options: null, answer: 'E' };
    expect(scoreQuestion(q, 'E')).toMatchObject({ earned: 2, max: 2, status: 'correct' });
    expect(scoreQuestion(q, 'C')).toMatchObject({ earned: 0, max: 2, status: 'wrong' });
  });

  it('送分（all_credit）：不論作答內容、包括未作答都給滿分', () => {
    const q = single({ points: 2, scoring_exception: { type: 'all_credit', note: '試題疑義' } });
    for (const value of ['A', 'B', undefined]) {
      expect(scoreQuestion(q, value)).toEqual({ kind: 'auto', max: 2, earned: 2, status: 'all_credit', wrongOptions: null });
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
    // acceptedLetters：官方答案在前、去重、只收 A–O 的代號（大小寫、空白不計）。
    expect(acceptedLetters(single({ accepted_answers: [' c ', 'B', 'beta', 'Z'] }))).toEqual(['B', 'C']);
  });

  it('scoring_exception 是 other 時照正常規則計分', () => {
    const q = single({ scoring_exception: { type: 'other', note: '說明' } });
    expect(scoreQuestion(q, 'B')).toMatchObject({ earned: 1, status: 'correct' });
    expect(scoreQuestion(q, 'A')).toMatchObject({ earned: 0, status: 'wrong' });
  });

  it('最小的結構型別就夠（學習助手的 Worker 只帶計分要的欄位）', () => {
    const q: SingleChoiceScorable = { mode: 'single_choice', answer: 'D', points: 2 };
    expect(scoreQuestion(q, 'D')).toEqual({ kind: 'auto', max: 2, earned: 2, status: 'correct', wrongOptions: null });
    expect(scoreQuestion({ mode: 'composition' }, 'text')).toEqual({ kind: 'manual', max: 0, answered: true });
  });
});

describe('多選題 (n − 2k)/n（web scoring.test.ts 的案例）', () => {
  it('公式本身：各選項獨立判定，該選沒選、不該選卻選都算錯一個', () => {
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'D', 'E'])).toEqual({ fraction: 1, wrong: 0 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'D'])).toEqual({ fraction: 4 / 6, wrong: 1 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'D', 'E', 'F'])).toEqual({ fraction: 4 / 6, wrong: 1 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A'])).toEqual({ fraction: 2 / 6, wrong: 2 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'B'])).toEqual({ fraction: 0, wrong: 3 });
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['B', 'C', 'F']).fraction).toBe(0);
    expect(multiSelectFraction(6, ['A', 'D', 'E'], ['A', 'B', 'C', 'D', 'E', 'F']).fraction).toBe(0);
  });

  it('全部未作答得 0 分（不是 (n − 2k)/n）', () => {
    expect(multiSelectFraction(6, ['A'], [])).toEqual({ fraction: 0, wrong: 1 });
  });

  it('02 文件 §4.1 的例子：n = 6、4 分，錯 1 個 2.67 分、錯 2 個 1.33 分、錯 3 個 0 分', () => {
    const q = multi(['A', 'D', 'E']);
    expect(scoreQuestion(q, ['A', 'D', 'E'])).toMatchObject({ earned: 4, status: 'correct', wrongOptions: 0 });
    const one = scoreQuestion(q, ['A', 'D']);
    expect(one).toMatchObject({ status: 'partial', wrongOptions: 1 });
    expect(one.kind === 'auto' && two(one.earned)).toBe(2.67);
    const second = scoreQuestion(q, ['A']);
    expect(second.kind === 'auto' && two(second.earned)).toBe(1.33);
    expect(scoreQuestion(q, ['B', 'C', 'F'])).toMatchObject({ earned: 0, status: 'wrong', wrongOptions: 6 });
    expect(scoreQuestion(q, [])).toMatchObject({ earned: 0, status: 'unanswered' });
  });
});

describe('非選擇題與 isAnswered（web scoring.test.ts 的案例）', () => {
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

describe('歷屆與模考的比對正規化（web scoreOpen.test.ts 的案例）', () => {
  it('去頭尾空白、壓縮空白、大小寫不計、句尾句點不計', () => {
    expect(normalizeOpenAnswer('  One   of a\tKind. ')).toBe('one of a kind');
    expect(normalizeOpenAnswer('Asylum.')).toBe('asylum');
    expect(normalizeOpenAnswer('blended。')).toBe('blended');
  });

  it('彎引號換直引號、全形英數字換半形、❶–❼ 視同 1–7', () => {
    expect(normalizeOpenAnswer('don’t')).toBe("don't");
    expect(normalizeOpenAnswer('“yes”')).toBe('"yes"');
    expect(normalizeOpenAnswer('ｉｎｎｏｖａｔｉｏｎ')).toBe('innovation');
    expect(normalizeOpenAnswer('❸')).toBe('3');
    expect(normalizeOpenAnswer('❶❼')).toBe('17');
  });

  it('保留大小寫的版本只差在不轉小寫（填充題要連大小寫都一樣才自動給分）', () => {
    expect(normalizeOpenAnswerCased('  Blended. ')).toBe('Blended');
    expect(normalizeOpenAnswerCased('Blended')).not.toBe(normalizeOpenAnswerCased('blended'));
  });
});

describe('題庫練習的比對正規化（web scoring.test.ts 的案例；web 以 normalizeOpenAnswer 的名稱轉匯出）', () => {
  it('正規化：頭尾空白、大小寫、結尾句點、彎引號、全形、圈號數字', () => {
    expect(normalizeBankOpenAnswer('  Turns. ')).toBe('turns');
    expect(normalizeBankOpenAnswer('ｔｕｒｎｓ')).toBe('turns');
    expect(normalizeBankOpenAnswer('it’s  fine')).toBe("it's fine");
    expect(normalizeBankOpenAnswer('❼')).toBe('7');
    expect(normalizeBankOpenAnswer('②')).toBe('2');
    expect(normalizeBankOpenAnswer('Asylum.')).toBe(normalizeBankOpenAnswer('asylum'));
  });

  it('正規化：去掉包住答案的引號與結尾的標點（逗號、驚嘆號、問號、分號、冒號，全形也算）', () => {
    for (const typed of ['“come up with”', '"come up with"', "'come up with'", '‘come up with’', 'come up with,', 'Come up with!', '"Come up with,"', '"come up with"?', '「come up with」', 'come up with；', 'come up with？', '＂come up with＂']) {
      expect(normalizeBankOpenAnswer(typed), typed).toBe('come up with');
    }
    expect(normalizeBankOpenAnswer('count me in!')).toBe('count me in');
    expect(normalizeBankOpenAnswer("students'")).toBe("students'");
    expect(normalizeBankOpenAnswer("'til")).toBe("'til");
    expect(normalizeBankOpenAnswer('well-known, ')).toBe('well-known');
    expect(normalizeBankOpenAnswer('"')).toBe('');
  });
});
