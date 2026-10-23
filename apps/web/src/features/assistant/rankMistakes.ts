/**
 * 錯題清單的「建議先問」排序（docs/design/learning-assistant.md §5.9；純函式）。
 *
 * 每天 30 點約能解析 5 題，均標程度的學生一份模考常錯 15–20 題，所以預設幫學生把點數花在最值得問的題目上：
 *   1. 同程度考生大多答對、你卻答錯的歷屆題：用五等分組答對率在學生目標級分的百分位內插（同 §3.2.2），≥ 0.6 排最前；
 *   2. 技能屬於最弱技能（這台裝置作答 ≥ 5 次、首次答對率最低的 6 個）的錯題；
 *   3. 其他錯題，新到舊；
 *   4. 疑點（答對但標記過、用了提示、先看答案）排在錯題之後。
 *   目標是均標以下時，全國答對率 < 0.3 的題目往後排（排在其他錯題之後、疑點之前），標「這題全國答對率很低，可以先放」。
 * 同一層裡依分數、時間排，最後用 key 排序，結果穩定。
 */
import { assistSkillLabel } from '@gsat/shared';
import type { OutcomeEntry } from './outcomes';
import type { MistakeRow } from './sources/types';

/**
 * 每個級分「該級分以上的人數百分比」（111–115 學測英文五年平均，本站依官方級分人數統計推算，非官方）。
 * 和 Worker 建置時產生的 SECTION_TARGETS.level_top_pct 同一份來源（data/exams/gsat-spec.json）。
 */
export const LEVEL_TOP_PCT: Readonly<Record<number, number>> = {
  15: 3.1,
  14: 8.4,
  13: 15.2,
  12: 22.7,
  11: 30.4,
  10: 37.9,
  9: 45.5,
  8: 53.0,
  7: 60.7,
  6: 68.7,
  5: 77.4,
  4: 87.2,
  3: 96.6,
  2: 99.8,
  1: 100,
};

/** 預設目標：前標（115 學測 11 級分，§8 第 15 點）。 */
export const DEFAULT_TARGET_LEVEL = 11;
/** 均標（115 學測 8 級分）。 */
export const MEAN_LEVEL = 8;

/**
 * 五等分組（高分組到低分組，各組 20%）在目標百分位的答對率：五組放在百分位 10、30、50、70、90，相鄰兩組線性內插；
 * p ≤ 10 取第一組、p ≥ 90 取最後一組（不外插）。
 */
export function peerRate(fiveGroups: readonly number[], percentile: number): number | null {
  if (fiveGroups.length !== 5 || fiveGroups.some((v) => !Number.isFinite(v))) return null;
  const points = [10, 30, 50, 70, 90];
  if (percentile <= 10) return fiveGroups[0] ?? null;
  if (percentile >= 90) return fiveGroups[4] ?? null;
  for (let i = 0; i < 4; i += 1) {
    const lo = points[i] as number;
    const hi = points[i + 1] as number;
    if (percentile <= hi) {
      const a = fiveGroups[i] as number;
      const b = fiveGroups[i + 1] as number;
      return a + ((b - a) * (percentile - lo)) / (hi - lo);
    }
  }
  return fiveGroups[4] ?? null;
}

export function percentileOfLevel(level: number): number {
  return LEVEL_TOP_PCT[Math.min(15, Math.max(1, Math.round(level)))] ?? LEVEL_TOP_PCT[DEFAULT_TARGET_LEVEL] ?? 30.4;
}

/** 最弱的技能：這台裝置作答 ≥ minN 次、首次接觸答對率最低的 n 個（同答對率時作答多的先）。 */
export function weakestSkills(entries: readonly OutcomeEntry[], n = 6, minN = 5): string[] {
  const stats = new Map<string, { n: number; firstN: number; firstCorrect: number }>();
  for (const e of entries) {
    for (const code of e.k) {
      const s = stats.get(code) ?? { n: 0, firstN: 0, firstCorrect: 0 };
      s.n += 1;
      if (e.first === 1) {
        s.firstN += 1;
        s.firstCorrect += e.ok;
      }
      stats.set(code, s);
    }
  }
  return [...stats]
    .filter(([, s]) => s.n >= minN && s.firstN > 0)
    .sort(([ca, a], [cb, b]) => a.firstCorrect / a.firstN - b.firstCorrect / b.firstN || b.n - a.n || ca.localeCompare(cb))
    .slice(0, n)
    .map(([code]) => code);
}

export type RankReason = 'peers' | 'weak_skill' | 'recent' | 'low_national' | 'doubt';

export interface RankedRow {
  row: MistakeRow;
  reason: RankReason;
  /** 同程度考生的答對率（有算時）。 */
  peer: number | null;
  /** 畫面上的標記：「同程度考生大多答對」「這題全國答對率很低，可以先放」。 */
  note: string | null;
}

export interface RankOptions {
  /** 目標級分（1–15）；沒選時用前標。 */
  targetLevel?: number;
  weakSkills?: readonly string[];
  sort?: 'suggested' | 'recent';
}

const ORDER: Record<RankReason, number> = { peers: 0, weak_skill: 1, recent: 2, low_national: 3, doubt: 4 };

export function rankMistakes(rows: readonly MistakeRow[], opts: RankOptions = {}): RankedRow[] {
  const level = opts.targetLevel ?? DEFAULT_TARGET_LEVEL;
  const p = percentileOfLevel(level);
  const weak = new Set(opts.weakSkills ?? []);
  const belowMean = level <= MEAN_LEVEL;
  const ranked = rows.map((row): RankedRow => {
    if (row.kind === 'doubt') return { row, reason: 'doubt', peer: null, note: null };
    const peer = row.fiveGroups ? peerRate(row.fiveGroups, p) : null;
    if (peer !== null && peer >= 0.6) return { row, reason: 'peers', peer, note: '同程度考生大多答對' };
    if (belowMean && row.nationalRate !== null && row.nationalRate < 0.3) return { row, reason: 'low_national', peer, note: '這題全國答對率很低，可以先放' };
    if (row.skills.some((s) => weak.has(s))) return { row, reason: 'weak_skill', peer, note: null };
    return { row, reason: 'recent', peer, note: null };
  });
  const byKey = (a: RankedRow, b: RankedRow) => a.row.key.localeCompare(b.row.key);
  if (opts.sort === 'recent') return ranked.sort((a, b) => b.row.at - a.row.at || byKey(a, b));
  return ranked.sort((a, b) => {
    const tier = ORDER[a.reason] - ORDER[b.reason];
    if (tier !== 0) return tier;
    if (a.reason === 'peers') return (b.peer ?? 0) - (a.peer ?? 0) || b.row.at - a.row.at || byKey(a, b);
    return b.row.at - a.row.at || byKey(a, b);
  });
}

/**
 * 題庫題的合併提示：同一個技能有 3 列以上的錯題時，「3 題都在考搭配詞，建議只問其中一題」（題庫題先看本站解析）。
 * 回傳列的 key → 提示。每一列只取它最常見的那個技能。
 */
export function skillClusterNotes(rows: readonly MistakeRow[], min = 3): Map<string, string> {
  const bank = rows.filter((r) => r.source === 'bank' && r.kind === 'mistake');
  const count = new Map<string, number>();
  for (const r of bank) for (const s of new Set(r.skills)) count.set(s, (count.get(s) ?? 0) + 1);
  const notes = new Map<string, string>();
  for (const r of bank) {
    const best = [...new Set(r.skills)].filter((s) => (count.get(s) ?? 0) >= min).sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || a.localeCompare(b))[0];
    if (!best) continue;
    const label = assistSkillLabel(best);
    if (!label) continue;
    notes.set(r.key, `${count.get(best)} 組都在考「${label}」，建議只問其中一組，其他先看本站解析`);
  }
  return notes;
}
