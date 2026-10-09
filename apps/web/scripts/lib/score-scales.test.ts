// @vitest-environment node
/**
 * build-data 的級分對照輸出（lib/score-scales.mjs）：gsat-spec.json 的 grading.english_by_year → exams/score-scales.json。
 * 換算本身（rawToLevel 等）的驗收測試在 src/data/scoreScales.test.ts；這裡測建置端的轉換與防呆：
 * 官方對照表的 111–115 邊界原樣輸出，轉錄錯誤（邊界接不起來、不等於 round2(k × 級距)、人數加總不符、
 * 五標百分比和累計表不符）都要讓建置失敗。
 */
import { describe, expect, it } from 'vitest';
import { OFFICIAL_UPPER_BOUNDS, specFixture } from './score-scales.fixture';
import { ScoreScalesError, buildScoreScales, parseLevelRange, round2 } from './score-scales.mjs';

describe('buildScoreScales', () => {
  it('111–115 的級分範圍原樣輸出（新到舊），15 級分上界 100、0 級分是 X=0', () => {
    const out = buildScoreScales(specFixture());
    expect(out.years.map((y) => y.year)).toEqual([115, 114, 113, 112, 111]);
    expect(out.default_year).toBe(115);
    expect(out.note).toMatch(/不是官方級分/);
    for (const y of out.years) {
      const bounds = OFFICIAL_UPPER_BOUNDS[y.year]?.bounds ?? [];
      expect(y.levels).toHaveLength(16);
      expect(y.levels[0]).toEqual({ level: 15, min_exclusive: bounds[13], max_inclusive: 100 });
      expect(y.levels[15]).toEqual({ level: 0, min_exclusive: null, max_inclusive: 0 });
      // levels 是 15 → 0；1–14 級分的上界就是官方表。
      expect(y.levels.slice(1, 15).map((l) => l.max_inclusive).reverse()).toEqual(bounds);
      expect(y.five_standards.map((s) => [s.name, s.percentile])).toEqual([
        ['頂標', 88],
        ['前標', 75],
        ['均標', 50],
        ['後標', 25],
        ['底標', 12],
      ]);
      expect(y.distribution.at(-1)?.cum_count_at_or_above).toBe(y.examinees);
      expect(y.sources).toEqual([{ label: `${y.year}學年度學測原得總分與級分對照表`, url: `https://www.ceec.edu.tw/test/${y.year}.pdf` }]);
    }
    const mean = [6.09733, 6.17067, 6.196, 6.11533, 6.20867].reduce((a, b) => a + b, 0) / 5;
    expect(out.mean_level_step).toBeCloseTo(mean, 4);
  });

  it('110 以前（舊制）不收', () => {
    const spec = specFixture();
    const y111 = spec.grading.english_by_year['111'];
    if (y111) spec.grading.english_by_year['110'] = { ...y111, level_step: 6.6 };
    expect(buildScoreScales(spec).years.map((y) => y.year)).not.toContain(110);
  });

  it('round2 與官方取位一致（第三位四捨五入，不受浮點誤差影響）', () => {
    expect(round2(14 * 6.09733)).toBe(85.36);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(1.005)).toBe(1.01);
    expect(parseLevelRange('X=0.00', 'x')).toEqual({ min_exclusive: null, max_inclusive: 0 });
    expect(parseLevelRange('85.36<X<=100.00', 'x')).toEqual({ min_exclusive: 85.36, max_inclusive: 100 });
    expect(() => parseLevelRange('85.36-100', 'x')).toThrow(ScoreScalesError);
  });

  const broken: [string, (spec: ReturnType<typeof specFixture>) => void, RegExp][] = [
    [
      '上界不等於 round2(k × 級距)',
      (spec) => {
        const y = spec.grading.english_by_year['115'];
        if (y) {
          y.raw_score_range_by_level['8'] = '42.68<X<=48.79';
          y.raw_score_range_by_level['9'] = '48.79<X<=54.88';
        }
      },
      /8 級分上界 48\.79/,
    ],
    [
      '相鄰兩列接不起來',
      (spec) => {
        const y = spec.grading.english_by_year['114'];
        if (y) y.raw_score_range_by_level['12'] = '67.89<X<=74.05';
      },
      /接不起來/,
    ],
    [
      '各級分人數加總不等於到考人數',
      (spec) => {
        const y = spec.grading.english_by_year['113'];
        if (y) y.examinees += 1;
      },
      /到考人數|累計百分比/,
    ],
    [
      '五標的累計百分比和級分人數表不符',
      (spec) => {
        const s = spec.grading.english_by_year['112']?.five_standards['均標'];
        if (s) s.pct_at_or_above += 1;
      },
      /均標的累計百分比/,
    ],
    [
      '少了一年',
      (spec) => {
        delete spec.grading.english_by_year['111'];
      },
      /少於 5 年/,
    ],
    [
      '來源對不到網址',
      (spec) => {
        const y = spec.grading.english_by_year['111'];
        if (y) y.src = ['nope'];
      },
      /src 對不到/,
    ],
  ];
  for (const [name, mutate, message] of broken) {
    it(`轉錄錯誤要讓建置失敗：${name}`, () => {
      const spec = specFixture();
      mutate(spec);
      expect(() => buildScoreScales(spec)).toThrow(ScoreScalesError);
      expect(() => buildScoreScales(spec)).toThrow(message);
    });
  }
});
