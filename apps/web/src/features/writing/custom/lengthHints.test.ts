/** 自訂題目作文的段數與字數提醒（docs/design/custom-essay.md §6.4、產品審查 P3）。 */
import { describe, expect, it } from 'vitest';
import { customLengthHints } from './lengthHints';

const none = { paragraphs: null, minWords: null, maxWords: null };
const ids = (hints: ReturnType<typeof customLengthHints>) => hints.map((h) => h.id);
const texts = (hints: ReturnType<typeof customLengthHints>) => hints.map((h) => h.text).join('\n');

describe('customLengthHints', () => {
  it('空白的作文不提醒', () => {
    expect(customLengthHints({ words: 0, paragraphs: 0, empty: true }, { paragraphs: 2, minWords: 120, maxWords: 150 })).toEqual([]);
  });

  it('沒有設定：不提學測的 120 個單詞，只在少於 100 個單詞時說會扣 1 分', () => {
    const hints = customLengthHints({ words: 90, paragraphs: 1, empty: false }, none);
    expect(ids(hints)).toEqual(['very_short']);
    expect(texts(hints)).toBe('少於 100 個單詞會扣總分 1 分。');
    expect(texts(hints)).not.toContain('120');
    expect(customLengthHints({ words: 130, paragraphs: 1, empty: false }, none)).toEqual([]);
  });

  it('設「最多 100」：寫 90 個不出現「至少 120」；寫 110 個說超過題目要求', () => {
    const under = customLengthHints({ words: 90, paragraphs: 2, empty: false }, { ...none, maxWords: 100 });
    expect(texts(under)).not.toContain('至少 120');
    expect(ids(under)).toEqual(['very_short']);
    const over = customLengthHints({ words: 110, paragraphs: 2, empty: false }, { ...none, maxWords: 100 });
    expect(ids(over)).toEqual(['above_max']);
    expect(texts(over)).toBe('超過題目要求的 100 個單詞（AI 會依題目判斷內容）。');
  });

  it('設「至少 150」：不足時說題目要求與目前的數字', () => {
    const hints = customLengthHints({ words: 130, paragraphs: 2, empty: false }, { ...none, minWords: 150 });
    expect(hints).toEqual([{ id: 'below_min', tone: 'warn', text: '題目要求至少 150 個單詞，目前 130 個。' }]);
  });

  it('段數：要求 2 段只寫 1 段會扣 1 分（和 Worker 一致）；不指定時不提段數', () => {
    expect(ids(customLengthHints({ words: 130, paragraphs: 1, empty: false }, { ...none, paragraphs: 2 }))).toEqual(['paragraph_deduction']);
    expect(texts(customLengthHints({ words: 130, paragraphs: 1, empty: false }, { ...none, paragraphs: 2 }))).toContain('未分段會扣 1 分');
    expect(customLengthHints({ words: 130, paragraphs: 1, empty: false }, none)).toEqual([]);
  });

  it('段數：要求 3 段而只寫 2 段，只說題目要求幾段，不說會扣分', () => {
    const hints = customLengthHints({ words: 130, paragraphs: 2, empty: false }, { ...none, paragraphs: 3 });
    expect(hints).toEqual([{ id: 'paragraph_mismatch', tone: 'info', text: '題目要求 3 段，你目前寫了 2 段。' }]);
  });
});
