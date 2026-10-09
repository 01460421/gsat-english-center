/**
 * 級分換算的驗收測試（ROADMAP Phase 2 驗收第 7 項：111–115 每年各 10 個以上的邊界值都和官方對照表一致）。
 *
 * 不讀 data/（npm test 不依賴資料檔，見 CI 說明）：對照表的邊界值直接抄在下面，出處是大考中心各年
 * 「原得總分與級分對照表」，與 docs/research/02-gsat-english-spec.md §5.4 相同；
 * build-data.mjs 另外檢查 score-scales.json 的每一列都等於 round2(k × 級距)。
 */
import { describe, expect, it } from 'vitest';
import {
  highestStandardReached,
  levelRange,
  minRawForLevel,
  nextStandardAbove,
  percentBelowLevel,
  rawToLevel,
  roundRawScore,
  type FiveStandard,
  type LevelCount,
  type ScoreLevelRange,
} from './scoreScales';

/** 1–14 級分的原得總分上界（官方對照表），15 級分上界是 100。 */
const OFFICIAL_UPPER_BOUNDS: Record<number, { step: number; bounds: number[] }> = {
  111: { step: 6.20867, bounds: [6.21, 12.42, 18.63, 24.83, 31.04, 37.25, 43.46, 49.67, 55.88, 62.09, 68.3, 74.5, 80.71, 86.92] },
  112: { step: 6.11533, bounds: [6.12, 12.23, 18.35, 24.46, 30.58, 36.69, 42.81, 48.92, 55.04, 61.15, 67.27, 73.38, 79.5, 85.61] },
  113: { step: 6.196, bounds: [6.2, 12.39, 18.59, 24.78, 30.98, 37.18, 43.37, 49.57, 55.76, 61.96, 68.16, 74.35, 80.55, 86.74] },
  114: { step: 6.17067, bounds: [6.17, 12.34, 18.51, 24.68, 30.85, 37.02, 43.19, 49.37, 55.54, 61.71, 67.88, 74.05, 80.22, 86.39] },
  115: { step: 6.09733, bounds: [6.1, 12.19, 18.29, 24.39, 30.49, 36.58, 42.68, 48.78, 54.88, 60.97, 67.07, 73.17, 79.27, 85.36] },
};

/** 和 score-scales.json 相同形狀的 levels（15 → 0）。 */
function levelsFrom(bounds: number[]): ScoreLevelRange[] {
  const uppers = [0, ...bounds, 100]; // index = 級分
  const out: ScoreLevelRange[] = [];
  for (let level = 15; level >= 0; level -= 1) {
    out.push({ level, min_exclusive: level === 0 ? null : (uppers[level - 1] ?? 0), max_inclusive: uppers[level] ?? 0 });
  }
  return out;
}

const plus = (x: number) => Math.round((x + 0.01) * 100) / 100;

describe('rawToLevel：111–115 官方對照表的邊界值', () => {
  for (const [year, { step, bounds }] of Object.entries(OFFICIAL_UPPER_BOUNDS)) {
    const levels = levelsFrom(bounds);
    const b = (k: number) => bounds[k - 1] ?? NaN;
    // 每年 12 個邊界值：0 分、最低分、1／2、5／6、7／8、10／11、13／14、14／15 級分交界，以及滿分。
    const cases: [number, number][] = [
      [0, 0],
      [0.01, 1],
      [b(1), 1],
      [plus(b(1)), 2],
      [b(5), 5],
      [plus(b(5)), 6],
      [b(7), 7],
      [plus(b(7)), 8],
      [b(10), 10],
      [plus(b(10)), 11],
      [b(14), 14],
      [plus(b(14)), 15],
      [100, 15],
    ];
    it(`${year} 學年度（級距 ${step}）`, () => {
      for (const [raw, expected] of cases) expect([raw, rawToLevel(raw, { levels })]).toEqual([raw, expected]);
    });
    it(`${year} 學年度的對照表每一列都等於 round2(k × 級距)`, () => {
      bounds.forEach((bound, i) => expect(Math.round((i + 1) * step * 100 + 1e-6) / 100).toBe(bound));
    });
  }

  it('原得總分先取到小數第二位（第三位四捨五入）再查表', () => {
    const levels = levelsFrom(OFFICIAL_UPPER_BOUNDS[115]?.bounds ?? []);
    expect(roundRawScore(85.364)).toBe(85.36);
    expect(roundRawScore(85.365)).toBe(85.37);
    expect(rawToLevel(85.364, { levels })).toBe(14);
    expect(rawToLevel(85.365, { levels })).toBe(15);
    // 多選題部分給分：4 × 4/6 = 2.666… → 加總後取位
    expect(rawToLevel(40 + (4 * 4) / 6, { levels })).toBe(7); // 42.67 ≤ 42.68
    expect(rawToLevel(-3, { levels })).toBe(0);
  });
});

describe('五標與「贏過多少比例的考生」', () => {
  // 115 學年度英文（官方：各科級分人數百分比累計表、各科成績標準一覽表）的其中幾列。
  const distribution: LevelCount[] = [
    { level: 15, count: 3261, pct: 2.76, cum_count_at_or_above: 3261, cum_pct_at_or_above: 2.76 },
    { level: 14, count: 6476, pct: 5.48, cum_count_at_or_above: 9737, cum_pct_at_or_above: 8.24 },
    { level: 13, count: 8823, pct: 7.47, cum_count_at_or_above: 18560, cum_pct_at_or_above: 15.71 },
    { level: 8, count: 8553, pct: 7.24, cum_count_at_or_above: 64060, cum_pct_at_or_above: 54.21 },
  ];
  const five_standards: FiveStandard[] = [
    { name: '頂標', percentile: 88, level: 13, pct_at_or_above: 15.71 },
    { name: '前標', percentile: 75, level: 11, pct_at_or_above: 31.8 },
    { name: '均標', percentile: 50, level: 8, pct_at_or_above: 54.21 },
    { name: '後標', percentile: 25, level: 5, pct_at_or_above: 76.65 },
    { name: '底標', percentile: 12, level: 3, pct_at_or_above: 96.11 },
  ];

  it('比你低的級分人數百分比（同級分不算）', () => {
    expect(percentBelowLevel(15, { distribution })).toBe(97.24);
    expect(percentBelowLevel(13, { distribution })).toBe(84.29);
    expect(percentBelowLevel(8, { distribution })).toBe(45.79);
    expect(percentBelowLevel(4, { distribution })).toBe(0); // 表裡沒有的級分
  });

  it('達到的最高五標', () => {
    expect(highestStandardReached(14, { five_standards })?.name).toBe('頂標');
    expect(highestStandardReached(12, { five_standards })?.name).toBe('前標');
    expect(highestStandardReached(8, { five_standards })?.name).toBe('均標');
    expect(highestStandardReached(3, { five_standards })?.name).toBe('底標');
    expect(highestStandardReached(2, { five_standards })).toBeNull();
  });
});

describe('成績單用的輔助函式（模擬考）', () => {
  const levels = levelsFrom(OFFICIAL_UPPER_BOUNDS[115]?.bounds ?? []);
  const five_standards: FiveStandard[] = [
    { name: '頂標', percentile: 88, level: 13, pct_at_or_above: 15.71 },
    { name: '前標', percentile: 75, level: 11, pct_at_or_above: 31.8 },
    { name: '均標', percentile: 50, level: 8, pct_at_or_above: 54.21 },
    { name: '後標', percentile: 25, level: 5, pct_at_or_above: 76.65 },
    { name: '底標', percentile: 12, level: 3, pct_at_or_above: 96.11 },
  ];

  it('levelRange：某個級分在對照表的那一列', () => {
    expect(levelRange(11, { levels })).toEqual({ level: 11, min_exclusive: 60.97, max_inclusive: 67.07 });
    expect(levelRange(0, { levels })).toEqual({ level: 0, min_exclusive: null, max_inclusive: 0 });
    expect(levelRange(16, { levels })).toBeNull();
  });

  it('minRawForLevel：拿到某個級分最少要多少原得總分（下界＋0.01），而且剛好換算回那個級分', () => {
    expect(minRawForLevel(12, { levels })).toBe(67.08);
    expect(minRawForLevel(1, { levels })).toBe(0.01);
    expect(minRawForLevel(0, { levels })).toBe(0);
    expect(minRawForLevel(16, { levels })).toBeNull();
    for (let level = 0; level <= 15; level += 1) {
      const min = minRawForLevel(level, { levels }) ?? NaN;
      expect(rawToLevel(min, { levels })).toBe(level);
      if (level > 0) expect(rawToLevel(Math.round((min - 0.01) * 100) / 100, { levels })).toBe(level - 1);
    }
  });

  it('nextStandardAbove：比目前級分高的下一個五標', () => {
    expect(nextStandardAbove(11, { five_standards })?.name).toBe('頂標');
    expect(nextStandardAbove(10, { five_standards })?.name).toBe('前標');
    expect(nextStandardAbove(0, { five_standards })?.name).toBe('底標');
    expect(nextStandardAbove(13, { five_standards })).toBeNull();
  });
});
