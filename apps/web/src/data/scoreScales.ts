/**
 * 學測英文的級分對照、五標與級分人數分布（111 學年度起），以及「原得總分 → 級分（非官方）」的換算。
 *
 * 資料檔：/data/exams/score-scales.json（scripts/build-data.mjs 由 data/exams/gsat-spec.json 產生，
 * 數字取自大考中心各年「原得總分與級分對照表」「各科成績標準一覽表」「各科級分人數百分比累計表」）。
 * 建置時已檢查：16 個級分首尾相接、1–14 級分上界＝round2(k × 級距)、各級分人數加總＝到考人數、五標百分比與累計表一致。
 *
 * 換算規則（116 學年度簡章；docs/research/02-gsat-english-spec.md §5.1）：
 *   原得總分 X 取到小數第二位（第三位四捨五入），0 分是 0 級分；其餘落在哪一列「下界 < X ≤ 上界」就是哪個級分。
 *   直接查官方對照表的邊界，而不是用 ceil(X / 級距) 重算：邊界值以官方表為準（ROADMAP Phase 2 驗收第 7 項）。
 * 畫面上一律標「非官方」：模擬考的非選擇題是自評，級距也是當年度的，不代表今年的級分。
 */
import { fetchDataFile, isRecord, memoizeAsync } from './client';

export interface ScoreLevelRange {
  /** 15 → 0。 */
  level: number;
  /** 原得總分的下界（不含）；0 級分是 null。 */
  min_exclusive: number | null;
  /** 原得總分的上界（含）；15 級分是滿分 100，0 級分是 0。 */
  max_inclusive: number;
}

export type FiveStandardName = '頂標' | '前標' | '均標' | '後標' | '底標';

export interface FiveStandard {
  name: FiveStandardName;
  /** 百分位數：頂標 88、前標 75、均標 50、後標 25、底標 12。 */
  percentile: 88 | 75 | 50 | 25 | 12;
  level: number;
  /** 達到這個級分（含）以上的到考考生百分比（0–100）。 */
  pct_at_or_above: number;
}

export interface LevelCount {
  level: number;
  count: number;
  /** 這個級分的人數百分比（0–100）。 */
  pct: number;
  cum_count_at_or_above: number;
  /** 這個級分（含）以上的累計百分比（0–100）。 */
  cum_pct_at_or_above: number;
}

export interface YearScale {
  /** 學年度（民國）。 */
  year: number;
  /** 英文科考試日（ISO 日期）。 */
  exam_date: string | null;
  /** 到考人數。 */
  examinees: number;
  /** 級距 L（111 起取到小數第五位）。 */
  level_step: number;
  /** 15 → 0，共 16 列。 */
  levels: ScoreLevelRange[];
  /** 頂標 → 底標。 */
  five_standards: FiveStandard[];
  /** 15 → 0。 */
  distribution: LevelCount[];
  /** 大考中心的統計檔案（出處標示用）。 */
  sources: { label: string; url: string }[];
}

/** /data/exams/score-scales.json */
export interface ScoreScales {
  version: string;
  subject: 'english';
  exam: 'gsat';
  /** 出處與「非官方」說明，成績單上照印。 */
  note: string;
  /** 預設對照年度（最新一年）。 */
  default_year: number;
  /** 各年級距的平均（本站計算，參考用）。 */
  mean_level_step: number;
  /** 新 → 舊。 */
  years: YearScale[];
}

function isScoreScales(body: unknown): body is ScoreScales {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.years) && body.years.length > 0;
}

const loader = memoizeAsync((_key: 'scales') => fetchDataFile('exams/score-scales.json', isScoreScales));

/** 載入級分對照（同一頁面只下載一次；約 3 KB gzip）。 */
export function loadScoreScales(): Promise<ScoreScales> {
  return loader('scales');
}

/** 某一年的對照；沒有就回傳 null（例如舊制年度）。 */
export function scaleForYear(scales: Pick<ScoreScales, 'years'>, year: number): YearScale | null {
  return scales.years.find((y) => y.year === year) ?? null;
}

/**
 * 原得總分取到小數第二位、第三位四捨五入（官方取位方式）。
 * 多選題的部分給分（4 × 4/6 = 2.666…）加總後會有長尾數，先取位再查表，和官方的原得總分一致。
 * 加 1e-6 再四捨五入：避免 85.365 在二進位裡是 85.36499… 而被捨去。
 */
export function roundRawScore(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw * 100 + 1e-6) / 100;
}

/** 原得總分 → 級分（非官方換算，查當年度官方對照表的邊界）。 */
export function rawToLevel(raw: number, scale: Pick<YearScale, 'levels'>): number {
  const x = roundRawScore(raw);
  if (x <= 0) return 0;
  for (const range of scale.levels) {
    if (range.min_exclusive !== null && x > range.min_exclusive && x <= range.max_inclusive) return range.level;
  }
  // 超過滿分（不應發生）：視為最高級分。
  return Math.max(...scale.levels.map((r) => r.level));
}

/**
 * 「大約贏過多少比例的考生」：當年級分比你低的到考考生百分比（0–100）。
 * 同級分的人不算在內（保守估計），所以 15 級分是 100 − 15 級分人數百分比，而不是 100。
 */
export function percentBelowLevel(level: number, scale: Pick<YearScale, 'distribution'>): number {
  const row = scale.distribution.find((d) => d.level === level);
  if (!row) return 0;
  return Math.max(0, Math.round((100 - row.cum_pct_at_or_above) * 100) / 100);
}

/** 達到的最高一個五標（級分 ≥ 該標）；連底標都沒到是 null。 */
export function highestStandardReached(level: number, scale: Pick<YearScale, 'five_standards'>): FiveStandard | null {
  return scale.five_standards.find((s) => level >= s.level) ?? null;
}

// ---------------------------------------------------------------------------
// 成績單用的輔助函式（模擬考，features/mock/）。只新增，不改上面的換算規則。
// ---------------------------------------------------------------------------

/** 某個級分在當年對照表的那一列（「60.97 < X ≤ 67.07 → 11 級分」）；表裡沒有就是 null。 */
export function levelRange(level: number, scale: Pick<YearScale, 'levels'>): ScoreLevelRange | null {
  return scale.levels.find((r) => r.level === level) ?? null;
}

/**
 * 拿到某個級分最少要多少原得總分：下界＋0.01（原得總分取到小數第二位，「下界 < X」的最小值就是下界＋0.01）。
 * 0 級分是 0；表裡沒有這個級分（例如超過 15）是 null。
 */
export function minRawForLevel(level: number, scale: Pick<YearScale, 'levels'>): number | null {
  const range = levelRange(level, scale);
  if (!range) return null;
  if (range.min_exclusive === null) return 0;
  return Math.round((range.min_exclusive + 0.01) * 100) / 100;
}

/** 比 level 高的下一個五標（「離頂標還差多少」）；已經達到頂標是 null。 */
export function nextStandardAbove(level: number, scale: Pick<YearScale, 'five_standards'>): FiveStandard | null {
  const above = scale.five_standards.filter((s) => s.level > level);
  return above.length === 0 ? null : above.reduce((a, b) => (b.level < a.level ? b : a));
}
