/**
 * 測試用：和 data/exams/gsat-spec.json 同形狀的 grading.english_by_year（score-scales.test.ts、data-contract.test.ts 共用）。
 *
 * npm test 不讀 data/（見 .github/workflows/ci.yml 檔頭），所以這裡自己組一份：
 *   - 1–14 級分的上界抄自大考中心 111–115 學年度「原得總分與級分對照表」（和 src/data/scoreScales.test.ts 同一份）；
 *   - 級分人數是假的（只要加總、累計一致），五標的級分是 115 學年度的，百分比由假的人數算出。
 * 建置時用的是真正的 gsat-spec.json；那份資料由 build-data.mjs 用同一個 buildScoreScales() 檢查。
 */

/** 1–14 級分的原得總分上界（官方對照表），15 級分上界是 100。 */
export const OFFICIAL_UPPER_BOUNDS: Readonly<Record<number, { step: number; bounds: readonly number[] }>> = {
  111: { step: 6.20867, bounds: [6.21, 12.42, 18.63, 24.83, 31.04, 37.25, 43.46, 49.67, 55.88, 62.09, 68.3, 74.5, 80.71, 86.92] },
  112: { step: 6.11533, bounds: [6.12, 12.23, 18.35, 24.46, 30.58, 36.69, 42.81, 48.92, 55.04, 61.15, 67.27, 73.38, 79.5, 85.61] },
  113: { step: 6.196, bounds: [6.2, 12.39, 18.59, 24.78, 30.98, 37.18, 43.37, 49.57, 55.76, 61.96, 68.16, 74.35, 80.55, 86.74] },
  114: { step: 6.17067, bounds: [6.17, 12.34, 18.51, 24.68, 30.85, 37.02, 43.19, 49.37, 55.54, 61.71, 67.88, 74.05, 80.22, 86.39] },
  115: { step: 6.09733, bounds: [6.1, 12.19, 18.29, 24.39, 30.49, 36.58, 42.68, 48.78, 54.88, 60.97, 67.07, 73.17, 79.27, 85.36] },
};

const fmt = (x: number) => x.toFixed(2);

interface SpecLevelCount {
  count: number;
  pct: number;
  cum_high_to_low_count: number;
  cum_high_to_low_pct: number;
}

export interface SpecYearFixture {
  examinees: number;
  level_step: number;
  exam_date: string;
  src: string[];
  raw_score_range_by_level: Record<string, string>;
  five_standards: Record<string, { level: number; pct_at_or_above: number }>;
  level_distribution: Record<string, SpecLevelCount>;
}

export interface SpecFixture {
  grading: { english_by_year: Record<string, SpecYearFixture> };
  sources: Record<string, { title: string; url: string }>;
}

function specYear(year: number): SpecYearFixture {
  const { step, bounds } = OFFICIAL_UPPER_BOUNDS[year] ?? { step: 0, bounds: [] };
  const uppers = [0, ...bounds, 100]; // index＝級分
  const raw_score_range_by_level: Record<string, string> = { '0': 'X=0.00' };
  for (let level = 1; level <= 15; level += 1) {
    raw_score_range_by_level[String(level)] = `${fmt(uppers[level - 1] ?? 0)}<X<=${fmt(uppers[level] ?? 0)}`;
  }
  // 假的人數：中間級分多、兩端少，加總後當到考人數。
  const counts = Array.from({ length: 16 }, (_, level) => 1000 + 100 * (8 - Math.abs(level - 8)) + year);
  const examinees = counts.reduce((a, b) => a + b, 0);
  const level_distribution: Record<string, SpecLevelCount> = {};
  let cum = 0;
  for (let level = 15; level >= 0; level -= 1) {
    const count = counts[level] ?? 0;
    cum += count;
    level_distribution[String(level)] = {
      count,
      pct: Math.round((count / examinees) * 10000) / 100,
      cum_high_to_low_count: cum,
      cum_high_to_low_pct: Math.round((cum / examinees) * 10000) / 100,
    };
  }
  const standardLevels = { 頂標: 13, 前標: 11, 均標: 8, 後標: 5, 底標: 3 };
  const five_standards = Object.fromEntries(
    Object.entries(standardLevels).map(([name, level]) => [
      name,
      { level, pct_at_or_above: level_distribution[String(level)]?.cum_high_to_low_pct ?? 0 },
    ]),
  );
  return {
    examinees,
    level_step: step,
    exam_date: `${year + 1911}-01-20`,
    src: [`grading_${year}`],
    raw_score_range_by_level,
    five_standards,
    level_distribution,
  };
}

/** 111–115 學年度、可以直接交給 buildScoreScales() 的 gsat-spec 物件（每次呼叫都是新的，可以放心修改）。 */
export function specFixture(): SpecFixture {
  const years = [111, 112, 113, 114, 115];
  return {
    grading: { english_by_year: Object.fromEntries(years.map((y) => [String(y), specYear(y)])) },
    sources: Object.fromEntries(
      years.map((y) => [`grading_${y}`, { title: `${y}學年度學測原得總分與級分對照表`, url: `https://www.ceec.edu.tw/test/${y}.pdf` }]),
    ),
  };
}
