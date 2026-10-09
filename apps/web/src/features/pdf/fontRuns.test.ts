import { describe, expect, it } from 'vitest';
import { estimateTextWidth, fontForCodePoint, hasBoldGlyph, splitFontRuns } from './fontRuns';

const cp = (ch: string) => ch.codePointAt(0) ?? 0;

describe('fontForCodePoint', () => {
  it('英文、半形標點、彎引號、破折號用 Tinos', () => {
    for (const ch of ['A', 'z', '9', '(', '“', '’', '—', '…', 'é', '½']) expect(fontForCodePoint(cp(ch))).toBe('Tinos');
  });
  it('中文與全形標點用 Noto Serif TC', () => {
    for (const ch of ['學', '測', '，', '。', '（', '）', '「', '︰', '❶', 'Ａ']) expect(fontForCodePoint(cp(ch))).toBe('NotoSerifTC');
  });
  it('表情符號用 Noto Emoji', () => {
    for (const ch of ['😄', '😠', '🤣', '😍']) expect(fontForCodePoint(cp(ch))).toBe('NotoEmoji');
  });
});

describe('splitFontRuns', () => {
  it('中英混排切成同字型的片段', () => {
    expect(splitFontRuns('說明︰第1題至第10題為單選題')).toEqual([
      { text: '說明︰第', font: 'NotoSerifTC', bold: false },
      { text: '1', font: 'Tinos', bold: false },
      { text: '題至第', font: 'NotoSerifTC', bold: false },
      { text: '10', font: 'Tinos', bold: false },
      { text: '題為單選題', font: 'NotoSerifTC', bold: false },
    ]);
    expect(splitFontRuns('Wonder Village 是')).toEqual([
      { text: 'Wonder Village ', font: 'Tinos', bold: false },
      { text: '是', font: 'NotoSerifTC', bold: false },
    ]);
  });

  it('半形空白一律用 Tinos（中文子集沒有 U+0020，跟著中文字型會印成方框）；換行跟著前一段', () => {
    expect(splitFontRuns('第 1 頁')).toEqual([
      { text: '第', font: 'NotoSerifTC', bold: false },
      { text: ' 1 ', font: 'Tinos', bold: false },
      { text: '頁', font: 'NotoSerifTC', bold: false },
    ]);
    expect(splitFontRuns('本 PDF\n說明').map((r) => [r.text, r.font])).toEqual([
      ['本', 'NotoSerifTC'],
      [' PDF\n', 'Tinos'],
      ['說明', 'NotoSerifTC'],
    ]);
    expect(splitFontRuns('說明：\n第')).toEqual([{ text: '說明：\n第', font: 'NotoSerifTC', bold: false }]);
  });

  it('粗體子集沒有的中文字改用一般粗細', () => {
    expect(hasBoldGlyph(cp('詞'))).toBe(true); // 大題標題「詞彙題」
    expect(hasBoldGlyph(cp('犀'))).toBe(false); // 只出現在選文
    expect(splitFontRuns('一、詞彙題犀', true)).toEqual([
      { text: '一、詞彙題', font: 'NotoSerifTC', bold: true },
      { text: '犀', font: 'NotoSerifTC', bold: false },
    ]);
    expect(splitFontRuns('A 😄', true).map((r) => r.bold)).toEqual([true, false]);
  });
});

describe('estimateTextWidth', () => {
  it('Times 字寬：12 pt 的 "(A) hasty" 約 47 pt；中文每字 1 em', () => {
    expect(estimateTextWidth('(A) hasty', 12)).toBeGreaterThan(40);
    expect(estimateTextWidth('(A) hasty', 12)).toBeLessThan(55);
    expect(estimateTextWidth('學測', 12)).toBe(24);
  });
});
