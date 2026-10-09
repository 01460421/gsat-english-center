import { describe, expect, it } from 'vitest';
import { checkEssayLength, checkTranslationSentence, countEnglishWords, countParagraphs, mechanicsMessages } from './text';

describe('countEnglishWords', () => {
  it('撇號與連字號的字算一個，標點與空白不算', () => {
    expect(countEnglishWords("It's a well-known fact, isn’t it?")).toBe(6);
    expect(countEnglishWords('')).toBe(0);
    expect(countEnglishWords('   \n\n  ')).toBe(0);
    expect(countEnglishWords('In 2026, I read 3 books.')).toBe(6);
  });

  it('中文與全形標點不算單詞', () => {
    expect(countEnglishWords('我喜歡 English，也喜歡 math。')).toBe(2);
  });

  it('和後端計分同一個規則（@gsat/shared）：以空白切開，沒空白的不拆開', () => {
    expect(countEnglishWords('e.g. 2,000 people - and/or more')).toBe(5);
    expect(countEnglishWords('word,word')).toBe(1);
  });
});

describe('countParagraphs', () => {
  it('沒有空行時每一行算一段（打字只按一次 Enter）', () => {
    expect(countParagraphs('First paragraph.\nSecond paragraph.')).toBe(2);
    expect(countParagraphs('Only one.')).toBe(1);
    expect(countParagraphs('')).toBe(0);
  });

  it('有空行時以空行分段（手寫稿的 OCR 一行對應紙上的一行）', () => {
    expect(countParagraphs('line one\nline two\n\nline three\nline four')).toBe(2);
    expect(countParagraphs('A\n  \nB\n\n\nC')).toBe(3);
  });

  it('照片辨識的文字只認空白行（原稿的換行不是分段）', () => {
    expect(countParagraphs('line one\nline two\nline three', true)).toBe(1);
    expect(checkEssayLength('line one\nline two\n\nline three', null, true).paragraphs).toBe(2);
  });
});

describe('checkEssayLength', () => {
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

  it('少於 120 個單詞提醒、少於 100 個標示會扣分，但不算太長', () => {
    const r = checkEssayLength(words(99));
    expect(r).toMatchObject({ words: 99, belowHint: true, veryShort: true, tooLong: false, empty: false });
    expect(checkEssayLength(words(110))).toMatchObject({ belowHint: true, veryShort: false });
    expect(checkEssayLength(words(120))).toMatchObject({ belowHint: false, veryShort: false });
  });

  it('超過 600 個單詞或 4,000 字元不能送', () => {
    expect(checkEssayLength(words(600)).tooLong).toBe(false);
    expect(checkEssayLength(words(601))).toMatchObject({ overWords: true, tooLong: true });
    const long = 'a'.repeat(4001);
    expect(checkEssayLength(long)).toMatchObject({ words: 1, overChars: true, tooLong: true });
  });

  it('段數和題目要求不同時提醒；空白作文不提醒', () => {
    expect(checkEssayLength(`${words(130)}`, 2).paragraphMismatch).toBe(true);
    expect(checkEssayLength(`${words(65)}\n${words(65)}`, 2).paragraphMismatch).toBe(false);
    expect(checkEssayLength(words(130), null).paragraphMismatch).toBe(false);
    expect(checkEssayLength('', 2)).toMatchObject({ empty: true, belowHint: false, paragraphMismatch: false });
  });

  it('「未分段會扣 1 分」和 Worker 計分同一條規則：要求 ≥2 段而不到 2 段才扣', () => {
    // 要求 2 段、只有 1 段：扣
    expect(checkEssayLength(words(130), 2)).toMatchObject({ paragraphMismatch: true, paragraphDeduction: true });
    // 要求 2 段、寫了 3 段：只提醒，不扣
    expect(checkEssayLength(`${words(40)}\n${words(40)}\n${words(50)}`, 2)).toMatchObject({ paragraphMismatch: true, paragraphDeduction: false });
    // 題目沒有段數要求（舊題）：不扣
    expect(checkEssayLength(words(130), null)).toMatchObject({ paragraphMismatch: false, paragraphDeduction: false });
    // 照片辨識的文字：段落只認空白行
    expect(checkEssayLength(`${words(65)}\n${words(65)}`, 2, true).paragraphDeduction).toBe(true);
    expect(checkEssayLength(`${words(65)}\n\n${words(65)}`, 2, true).paragraphDeduction).toBe(false);
    expect(checkEssayLength('', 2).paragraphDeduction).toBe(false);
  });
});

describe('checkTranslationSentence', () => {
  it('句首小寫、句尾沒標點、全形標點、連續空白、漏譯的中文都抓得到', () => {
    const c = checkTranslationSentence('they  went to 台北，happily');
    expect(c.mechanics).toEqual({
      lowercaseStart: true,
      missingEndPunctuation: true,
      fullWidthPunctuation: true,
      doubleSpace: true,
      hasChinese: true,
    });
    expect(mechanicsMessages(c.mechanics)).toHaveLength(5);
  });

  it('正確的句子沒有提醒；引號結尾也算有句尾標點', () => {
    expect(mechanicsMessages(checkTranslationSentence('He said, "I am fine."').mechanics)).toEqual([]);
    expect(mechanicsMessages(checkTranslationSentence('Is it true?').mechanics)).toEqual([]);
  });

  it('500 字元上限與空白', () => {
    expect(checkTranslationSentence('a'.repeat(500)).tooLong).toBe(false);
    expect(checkTranslationSentence('a'.repeat(501)).tooLong).toBe(true);
    const empty = checkTranslationSentence('   ');
    expect(empty.empty).toBe(true);
    expect(mechanicsMessages(empty.mechanics)).toEqual([]);
  });
});
