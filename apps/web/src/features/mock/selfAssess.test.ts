/**
 * 中譯英與英文作文的自評計分（設計文件 §6.6）。
 */
import { describe, expect, it } from 'vitest';
import {
  compositionChecks,
  compositionComplete,
  compositionScore,
  emptyCompositionDetail,
  translationMechanicsIssue,
  translationScore,
} from './selfAssess';

describe('中譯英（每題 4 分）', () => {
  it('程式判斷句首大寫與句尾標點', () => {
    expect(translationMechanicsIssue('More and more teachers use English.')).toBe(false);
    expect(translationMechanicsIssue('"Is it true?" she asked.')).toBe(false);
    expect(translationMechanicsIssue('He said, "Yes."')).toBe(false);
    expect(translationMechanicsIssue('more and more teachers use English.')).toBe(true);
    expect(translationMechanicsIssue('More and more teachers use English')).toBe(true);
    expect(translationMechanicsIssue('')).toBe(false);
  });

  it('每處錯誤 −0.5；句首大寫或句尾標點有問題另扣 0.5（只扣一次）；最低 0 分', () => {
    expect(translationScore(4, { errors: 0, mechanics: false })).toBe(4);
    expect(translationScore(4, { errors: 3, mechanics: false })).toBe(2.5);
    expect(translationScore(4, { errors: 3, mechanics: true })).toBe(2);
    expect(translationScore(4, { errors: 8, mechanics: false })).toBe(0);
    expect(translationScore(4, { errors: 20, mechanics: true })).toBe(0);
    // 小數或負數的錯誤處數不會讓分數變奇怪。
    expect(translationScore(4, { errors: 1.7, mechanics: false })).toBe(3.5);
    expect(translationScore(4, { errors: -2, mechanics: false })).toBe(4);
  });
});

describe('英文作文（20 分）', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

  it('字數與段數：少於 100 字或未分段扣 1，兩者都有也只扣 1；少於 120 字只提醒', () => {
    const ok = compositionChecks(`${words(70)}\n\n${words(60)}`, 2);
    expect(ok).toMatchObject({ words: 130, paragraphs: 2, tooShort: false, notParagraphed: false, belowRecommended: false, deduction: 0 });

    const short = compositionChecks(`${words(50)}\n${words(40)}`, 2);
    expect(short).toMatchObject({ words: 90, tooShort: true, notParagraphed: false, belowRecommended: true, deduction: 1 });

    const oneParagraph = compositionChecks(words(130), 2);
    expect(oneParagraph).toMatchObject({ notParagraphed: true, deduction: 1 });

    const both = compositionChecks(words(30), 2);
    expect(both).toMatchObject({ tooShort: true, notParagraphed: true, deduction: 1 });

    const recommended = compositionChecks(`${words(60)}\n${words(50)}`, 2);
    expect(recommended).toMatchObject({ words: 110, tooShort: false, belowRecommended: true, deduction: 0 });

    // 題目沒有規定段數（或只要一段）就不檢查分段；字數門檻可以依題目調整。
    expect(compositionChecks(words(130), undefined).notParagraphed).toBe(false);
    expect(compositionChecks(words(130), 1).notParagraphed).toBe(false);
    expect(compositionChecks(words(130), undefined, 150).belowRecommended).toBe(true);
  });

  it('四項都選了才算完成；總分＝四項相加 − 形式扣分，最低 0', () => {
    const empty = emptyCompositionDetail();
    expect(compositionComplete(empty)).toBe(false);
    expect(compositionScore(empty, { deduction: 0 })).toBeNull();
    expect(compositionScore({ ...empty, content: 4, organization: 3 }, { deduction: 0 })).toBeNull();

    const full = { ...empty, content: 4, organization: 3, grammar: 3, vocabulary: 4 };
    expect(compositionComplete(full)).toBe(true);
    expect(compositionScore(full, { deduction: 0 })).toBe(14);
    expect(compositionScore(full, { deduction: 1 })).toBe(13);
    expect(compositionScore({ ...empty, content: 0, organization: 0, grammar: 0, vocabulary: 0 }, { deduction: 1 })).toBe(0);
    expect(compositionScore({ ...empty, content: 5, organization: 5, grammar: 5, vocabulary: 5 }, { deduction: 0 })).toBe(20);
  });

  it('勾「離題」：其他各項都算 0（不必選完四項）', () => {
    const offTopic = { ...emptyCompositionDetail(), content: 5, offTopic: true };
    expect(compositionComplete(offTopic)).toBe(true);
    expect(compositionScore(offTopic, { deduction: 0 })).toBe(0);
  });
});
