/**
 * 測試用：111–115 學年度學測英文的官方級分對照、五標與級分人數（只給測試用，App 不會匯入這個檔案）。
 *
 * 數字逐字抄自 data/exams/gsat-spec.json 的 grading.english_by_year（出處是大考中心各年「原得總分與級分對照表」
 * 「各科成績標準一覽表」「各科級分人數百分比累計表」），範圍字串保留官方表的寫法（"85.36<X<=100.00"）。
 * npm test 不讀 data/（CI 的約定，見 .github/workflows/ci.yml 檔頭），所以抄在這裡；
 * build-data.mjs 另外檢查 score-scales.json 與 gsat-spec.json 一致。
 */
import type { FiveStandardName, ScoreLevelRange, ScoreScales, YearScale } from '../../data/scoreScales';

interface OfficialYear {
  examinees: number;
  step: number;
  examDate: string;
  /** 15 → 0 級分的原得總分範圍（官方表原文）。 */
  ranges: readonly string[];
  /** [名稱, 級分, 該級分以上的累計百分比]，頂標 → 底標。 */
  standards: readonly (readonly [FiveStandardName, number, number])[];
  /** 15 → 0 級分的人數。 */
  counts: readonly number[];
  /** 15 → 0 級分的累計百分比（高到低）。 */
  cumPct: readonly number[];
}

export const OFFICIAL_GSAT_ENGLISH: Readonly<Record<111 | 112 | 113 | 114 | 115, OfficialYear>> = {
  115: {
    examinees: 118169,
    step: 6.09733,
    examDate: '2026-01-18',
    ranges: ['85.36<X<=100.00', '79.27<X<=85.36', '73.17<X<=79.27', '67.07<X<=73.17', '60.97<X<=67.07', '54.88<X<=60.97', '48.78<X<=54.88', '42.68<X<=48.78', '36.58<X<=42.68', '30.49<X<=36.58', '24.39<X<=30.49', '18.29<X<=24.39', '12.19<X<=18.29', '6.10<X<=12.19', '0.00<X<=6.10', 'X=0.00'],
    standards: [['頂標', 13, 15.71], ['前標', 11, 31.8], ['均標', 8, 54.21], ['後標', 5, 76.65], ['底標', 3, 96.11]],
    counts: [3261, 6476, 8823, 9465, 9554, 9135, 8796, 8553, 8381, 8682, 9449, 11428, 11565, 4361, 233, 7],
    cumPct: [2.76, 8.24, 15.71, 23.72, 31.8, 39.53, 46.98, 54.21, 61.31, 68.65, 76.65, 86.32, 96.11, 99.8, 99.99, 100.0],
  },
  114: {
    examinees: 117866,
    step: 6.17067,
    examDate: '2025-01-19',
    ranges: ['86.39<X<=100.00', '80.22<X<=86.39', '74.05<X<=80.22', '67.88<X<=74.05', '61.71<X<=67.88', '55.54<X<=61.71', '49.37<X<=55.54', '43.19<X<=49.37', '37.02<X<=43.19', '30.85<X<=37.02', '24.68<X<=30.85', '18.51<X<=24.68', '12.34<X<=18.51', '6.17<X<=12.34', '0.00<X<=6.17', 'X=0.00'],
    standards: [['頂標', 13, 15.71], ['前標', 11, 30.46], ['均標', 8, 51.39], ['後標', 4, 84.78], ['底標', 3, 95.6]],
    counts: [3874, 6563, 8075, 8775, 8619, 8351, 8303, 8015, 8188, 8826, 10315, 12022, 12757, 4938, 237, 8],
    cumPct: [3.29, 8.85, 15.71, 23.15, 30.46, 37.55, 44.59, 51.39, 58.34, 65.83, 74.58, 84.78, 95.6, 99.79, 99.99, 100.0],
  },
  113: {
    examinees: 117106,
    step: 6.196,
    examDate: '2024-01-21',
    ranges: ['86.74<X<=100.00', '80.55<X<=86.74', '74.35<X<=80.55', '68.16<X<=74.35', '61.96<X<=68.16', '55.76<X<=61.96', '49.57<X<=55.76', '43.37<X<=49.57', '37.18<X<=43.37', '30.98<X<=37.18', '24.78<X<=30.98', '18.59<X<=24.78', '12.39<X<=18.59', '6.20<X<=12.39', '0.00<X<=6.20', 'X=0.00'],
    standards: [['頂標', 13, 14.13], ['前標', 11, 28.0], ['均標', 8, 50.84], ['後標', 5, 77.4], ['底標', 3, 96.78]],
    counts: [3677, 5635, 7239, 7972, 8271, 8331, 9004, 9407, 10047, 10373, 10683, 11598, 11093, 3597, 172, 7],
    cumPct: [3.14, 7.95, 14.13, 20.94, 28.0, 35.12, 42.81, 50.84, 59.42, 68.28, 77.4, 87.3, 96.78, 99.85, 99.99, 100.0],
  },
  112: {
    examinees: 115919,
    step: 6.11533,
    examDate: '2023-01-14',
    ranges: ['85.61<X<=100.00', '79.50<X<=85.61', '73.38<X<=79.50', '67.27<X<=73.38', '61.15<X<=67.27', '55.04<X<=61.15', '48.92<X<=55.04', '42.81<X<=48.92', '36.69<X<=42.81', '30.58<X<=36.69', '24.46<X<=30.58', '18.35<X<=24.46', '12.23<X<=18.35', '6.12<X<=12.23', '0.00<X<=6.12', 'X=0.00'],
    standards: [['頂標', 13, 13.42], ['前標', 11, 27.7], ['均標', 8, 51.77], ['後標', 5, 77.99], ['底標', 4, 88.09]],
    counts: [3426, 5188, 6939, 7770, 8783, 8975, 9620, 9306, 9658, 9792, 10954, 11699, 10478, 3155, 167, 9],
    cumPct: [2.96, 7.43, 13.42, 20.12, 27.7, 35.44, 43.74, 51.77, 60.1, 68.55, 77.99, 88.09, 97.13, 99.85, 99.99, 100.0],
  },
  111: {
    examinees: 113756,
    step: 6.20867,
    examDate: '2022-01-22',
    ranges: ['86.92<X<=100.00', '80.71<X<=86.92', '74.50<X<=80.71', '68.30<X<=74.50', '62.09<X<=68.30', '55.88<X<=62.09', '49.67<X<=55.88', '43.46<X<=49.67', '37.25<X<=43.46', '31.04<X<=37.25', '24.83<X<=31.04', '18.63<X<=24.83', '12.42<X<=18.63', '6.21<X<=12.42', '0.00<X<=6.21', 'X=0.00'],
    standards: [['頂標', 13, 17.2], ['前標', 12, 25.65], ['均標', 8, 56.9], ['後標', 5, 80.52], ['底標', 4, 89.26]],
    counts: [3708, 6918, 8941, 9616, 9258, 9018, 8613, 8655, 8492, 8977, 9400, 9938, 9110, 2945, 157, 10],
    cumPct: [3.26, 9.34, 17.2, 25.65, 33.79, 41.72, 49.29, 56.9, 64.36, 72.26, 80.52, 89.26, 97.26, 99.85, 99.99, 100.0],
  },
};

export const OFFICIAL_YEARS = [115, 114, 113, 112, 111] as const;

const PERCENTILE = { 頂標: 88, 前標: 75, 均標: 50, 後標: 25, 底標: 12 } as const;

/** 官方表的範圍字串 → score-scales.json 的一列（"6.10<X<=12.19" → 下界 6.10、上界 12.19；"X=0.00" → 0 級分）。 */
export function parseOfficialRange(level: number, text: string): ScoreLevelRange {
  if (text === 'X=0.00') return { level, min_exclusive: null, max_inclusive: 0 };
  const m = /^(\d+\.\d{2})<X<=(\d+\.\d{2})$/.exec(text);
  if (!m) throw new Error(`看不懂的範圍：${text}`);
  return { level, min_exclusive: Number(m[1]), max_inclusive: Number(m[2]) };
}

/** 和 /data/exams/score-scales.json 同形狀的一年。 */
export function officialYearScale(year: keyof typeof OFFICIAL_GSAT_ENGLISH): YearScale {
  const y = OFFICIAL_GSAT_ENGLISH[year];
  return {
    year,
    exam_date: y.examDate,
    examinees: y.examinees,
    level_step: y.step,
    levels: y.ranges.map((text, i) => parseOfficialRange(15 - i, text)),
    five_standards: y.standards.map(([name, level, pct]) => ({ name, percentile: PERCENTILE[name], level, pct_at_or_above: pct })),
    distribution: y.counts.map((count, i) => ({
      level: 15 - i,
      count,
      pct: Math.round((count / y.examinees) * 10000) / 100,
      cum_count_at_or_above: y.counts.slice(0, i + 1).reduce((a, b) => a + b, 0),
      cum_pct_at_or_above: y.cumPct[i] ?? 100,
    })),
    sources: [{ label: `${year}學年度學測統計：原得總分與級分對照表`, url: `https://www.ceec.edu.tw/test/${year}.xls` }],
  };
}

export const OFFICIAL_SCALES: ScoreScales = {
  version: 'test',
  subject: 'english',
  exam: 'gsat',
  note: '級分對照表、五標與級分人數取自大學入學考試中心公布的學科能力測驗統計資料；本站依此換算的級分僅供參考，不是官方級分。',
  default_year: 115,
  mean_level_step: 6.1576,
  years: OFFICIAL_YEARS.map(officialYearScale),
};
