import { describe, expect, it } from 'vitest';
import { formatUnixTime, formatUnixTimeShort } from './format';

describe('formatUnixTimeShort', () => {
  // 2026-10-03 12:01:40（台灣時間）。
  const sec = 1_791_000_100;

  it('和現在同一年（台灣時間）時省略年份，空白是一般空白', () => {
    expect(formatUnixTimeShort(sec, Date.parse('2026-12-31T23:59:00+08:00'))).toBe('10/3 12:01');
  });

  it('不同年時和 formatUnixTime 相同（只把空白換成一般空白）', () => {
    expect(formatUnixTimeShort(sec, Date.parse('2027-01-01T00:00:00+08:00'))).toBe(formatUnixTime(sec).replace(/\s+/g, ' '));
    expect(formatUnixTimeShort(sec, Date.parse('2027-01-01T00:00:00+08:00'))).toBe('2026/10/3 12:01');
  });

  it('年份看台灣時間：UTC 還是去年、台灣已經過年也算同一年', () => {
    const newYear = Date.parse('2027-01-01T00:30:00+08:00') / 1000;
    expect(formatUnixTimeShort(newYear, Date.parse('2027-01-01T01:00:00+08:00'))).toBe('1/1 00:30');
  });
});
