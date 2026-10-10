/** 本站仿真中譯英的自評分（和 Worker 的 scoreTranslationRater 同一套規則；大小寫與標點用 shared 的 checkMechanics）。 */
import { checkMechanics, normalizeStudentText } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { bankTranslationSelfScore, selfScoresOf } from './selfScore';

const NONE = [0, 0, 0, 0];
const NO_MISS = [false, false, false, false];

describe('bankTranslationSelfScore', () => {
  it('每部分 1 分、每個錯誤扣 0.5、扣完為止', () => {
    expect(bankTranslationSelfScore('It is fine.', NONE, NO_MISS).score).toBe(4);
    const r = bankTranslationSelfScore('It is fine.', [0, 1, 2, 3], NO_MISS);
    expect(r.parts).toEqual([1, 0.5, 0, 0]);
    expect(r.score).toBe(1.5);
  });

  it('勾了「這部分整個漏譯」就是 0（不管記了幾個錯）', () => {
    const r = bankTranslationSelfScore('It is fine.', [0, 1, 0, 0], [false, true, false, true]);
    expect(r.parts).toEqual([1, 0, 1, 0]);
    expect(r.score).toBe(2);
  });

  it('句首沒大寫、句尾標點不對各扣 0.5；整句最低 0', () => {
    const both = bankTranslationSelfScore('it is fine', NONE, NO_MISS);
    expect([both.capitalization, both.punctuation, both.mechanicsDeduction, both.score]).toEqual([true, true, 1, 3]);
    const low = bankTranslationSelfScore('it is fine', [2, 2, 2, 1], NO_MISS);
    expect(low.partsTotal).toBe(0.5);
    expect(low.mechanicsDeduction).toBe(0.5);
    expect(low.score).toBe(0);
    expect(bankTranslationSelfScore('', NONE, [true, true, true, true]).score).toBe(0);
  });

  // 對照表（packages/shared/src/writing.test.ts 用同一張表）：自評的大小寫與標點扣分＝checkMechanics(normalizeStudentText(s))。
  const table = [
    'Is it？',
    'It is true。',
    'He said, "Yes."',
    'He said, "Yes."”',
    'It is true]',
    'it is true.',
    '  It is true.  ',
    '​it is​ true',
  ];
  for (const s of table) {
    it(`大小寫與標點和 AI 批改一致：${JSON.stringify(s)}`, () => {
      const m = checkMechanics(normalizeStudentText(s).text);
      const r = bankTranslationSelfScore(s, NONE, NO_MISS);
      expect(r.capitalization).toBe(m.capitalization !== null);
      expect(r.punctuation).toBe(m.punctuation !== null);
      expect(r.mechanicsDeduction).toBe((m.capitalization ? 0.5 : 0) + (m.punctuation ? 0.5 : 0));
    });
  }

  it('全形問號：正規化後是半形，不扣標點（和 Worker 相同）', () => {
    expect(bankTranslationSelfScore('Is it？', NONE, NO_MISS).punctuation).toBe(false);
  });
});

it('selfScoresOf：每句的分數（送 AI 批改時附上）', () => {
  expect(
    selfScoresOf({
      texts: ['Good one.', 'bad one'],
      partErrors: [
        [1, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      partMissing: [NO_MISS, NO_MISS],
    }),
  ).toEqual([3.5, 3]);
});
