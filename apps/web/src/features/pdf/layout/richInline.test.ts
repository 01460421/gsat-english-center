import { describe, expect, it } from 'vitest';
import { blankInline, latinWords, plainInline, richInline, richParagraphs, spacedInline, urlInline } from './richInline';

const texts = (inlines: readonly { text: unknown }[]) => inlines.map((i) => i.text).join('');

describe('richInline：試題標記 → 行內片段', () => {
  it('[[題號]] 變成帶底線的空格，前後用不換行空白撐開', () => {
    const out = richInline('White rhinoceroses, [[11]], do the same');
    expect(out).toContainEqual(blankInline('11'));
    expect(blankInline('11')).toMatchObject({ text: '  11  ', decoration: 'underline', preserveLeadingSpaces: true, preserveTrailingSpaces: true });
    expect(texts(out)).toBe('White rhinoceroses,   11  , do the same');
  });

  it('空格可以換成題目的題號（gsat-87 的選文寫 [[51]]，題本印 61）', () => {
    const out = richInline('passing that [[51]] on', { blankLabel: (t) => String(Number(t) + 10) });
    expect(out).toContainEqual(blankInline('61'));
  });

  it('<b>、<u> 轉成粗體與底線（每個單字一段），其他角括號照原文', () => {
    const out = richInline('closest to “<b>exacerbated the situation</b>” and <u>them</u> a < b');
    expect(out.filter((i) => i.bold).map((i) => i.text)).toEqual(['exacerbated ', 'the ', 'situation']);
    expect(out.filter((i) => i.bold).every((i) => i.font === 'Tinos')).toBe(true);
    expect(out).toContainEqual({ text: 'them', font: 'Tinos', noWrap: true, decoration: 'underline' });
    expect(texts(out)).toContain('a < b');
  });

  it('中英混排依字元換字型；英文單字設 noWrap（左右對齊時才不會在連字號處被撐開），中文不設', () => {
    expect(plainInline('每格限填一個單詞（word）')).toEqual([
      { text: '每格限填一個單詞（', font: 'NotoSerifTC' },
      { text: 'word', font: 'Tinos', noWrap: true },
      { text: '）', font: 'NotoSerifTC' },
    ]);
    expect(plainInline('a well-qualified applicant').map((i) => i.text)).toEqual(['a ', 'well-qualified ', 'applicant']);
    expect(plainInline('smell—just like').map((i) => i.text)).toEqual(['smell—just ', 'like']);
  });

  it('段落：換行分段，空行回傳空陣列', () => {
    const paras = richParagraphs('First line.\n\nSecond [[47]].');
    expect(paras).toHaveLength(3);
    expect(paras[1]).toEqual([]);
    expect(paras[2]).toContainEqual(blankInline('47'));
  });

  it('標題的字距只加在中文上（數字加了會變成「6 2 分」）', () => {
    const out = spacedInline('第壹部分、選擇題（占62分）', { bold: true });
    expect(out.find((i) => i.text === '62')).not.toHaveProperty('characterSpacing');
    expect(out.filter((i) => i.font === 'NotoSerifTC').every((i) => i.characterSpacing === 3)).toBe(true);
  });
});

describe('latinWords', () => {
  it('依空白切成單字（含後面的空白），換行單獨一段', () => {
    expect(latinWords('Hello  world\nnext')).toEqual(['Hello  ', 'world', '\n', 'next']);
    expect(latinWords('  lead')).toEqual(['  ', 'lead']);
  });
});

describe('urlInline', () => {
  it('長網址在「/」之後或每 maxChars 個字元處換行，整段同一個連結', () => {
    const url = 'https://www.ceec.edu.tw/files/file_pool/1/0q054532302653501476/02-115%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf';
    const out = urlInline(url, 40);
    expect(out.link).toBe(url);
    expect(out.font).toBe('Tinos');
    const lines = String(out.text).split('\n');
    expect(lines.join('')).toBe(url);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(40);
    expect(lines[0]).toBe('https://www.ceec.edu.tw/files/file_pool/');
  });
});
