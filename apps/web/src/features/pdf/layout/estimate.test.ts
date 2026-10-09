import { describe, expect, it } from 'vitest';
import { estimateLineCount, plainForEstimate, textWidth } from './estimate';
import { CONTENT_WIDTH, SIZE } from './metrics';

describe('版面估計', () => {
  it('空格記號換成印出來的寬度、去掉 <u>／<b>', () => {
    expect(plainForEstimate('a [[11]] <b>bold</b>')).toBe('a   11   bold');
    expect(textWidth('(A) hasty', 12)).toBeGreaterThan(40);
  });

  it('行數：短句一行；長段落依寬度換行；換行字元各自算', () => {
    expect(estimateLineCount('The mayor has such a ______ schedule.', CONTENT_WIDTH, SIZE.body)).toBe(1);
    const long = 'From the campfire to the café, people have always gathered together to share the latest news. '.repeat(4);
    const lines = estimateLineCount(long, CONTENT_WIDTH, SIZE.body, 24);
    expect(lines).toBeGreaterThanOrEqual(4);
    expect(lines).toBeLessThanOrEqual(6);
    expect(estimateLineCount('one\ntwo\nthree', CONTENT_WIDTH, SIZE.body)).toBe(3);
    // 中文每個字都可以換行：40 個字在 468 pt、12 pt 下是兩行
    expect(estimateLineCount('說'.repeat(40), CONTENT_WIDTH, 12)).toBe(2);
  });
});
