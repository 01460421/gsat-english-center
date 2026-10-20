/**
 * 組卷用的確定性亂數（設計文件 §4.1）：同樣的種子得到同樣的數列（寫死前幾個值，換實作就會失敗）、洗牌不掉元素、FNV-1a 的標準值。
 */
import { describe, expect, it } from 'vitest';
import { fnv1a, randomSeed, rngFromSeed, sfc32, shuffled } from './random';

describe('sfc32／rngFromSeed', () => {
  it('同一個種子的數列固定（寫死）', () => {
    const next = sfc32(1, 2, 3, 4);
    expect([next(), next(), next()]).toEqual([7, 34, 56623200]);
    const a = rngFromSeed(42);
    const b = rngFromSeed(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('相近的種子得到不同的數列', () => {
    expect(rngFromSeed(1)()).not.toBe(rngFromSeed(2)());
  });
});

describe('shuffled', () => {
  it('不改原陣列、不掉元素；同一個種子結果相同', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffled(items, rngFromSeed(7));
    expect(items).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(shuffled(items, rngFromSeed(7))).toEqual(a);
    expect(shuffled(items, rngFromSeed(8))).not.toEqual(a);
  });
});

describe('fnv1a', () => {
  it('標準測試值（FNV-1a 32 位元）', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  it('用 UTF-8 位元組計算（中文也穩定）', () => {
    expect(fnv1a('卷號')).toBe(fnv1a('卷號'));
    expect(fnv1a('卷號')).not.toBe(fnv1a('卷号'));
  });
});

describe('randomSeed', () => {
  it('回傳 32 位元無號整數', () => {
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });
});
