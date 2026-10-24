/**
 * 入口帶來的焦點（docs/design/weak-paper.md §3.1、§5.5）：錯題清單、真題模考與自組卷／加強卷成績單的「用這些錯題組一份加強卷」。
 *
 * 錯題清單沒有技能篩選，而「最常見」的技能其實就是出現比例最高的代碼（詞彙的 sn:core 出現在 71% 的題目），
 * 和學生自己的平均比通常不是弱點，所以：
 *   - section：篩選了單一大題就帶那個大題；選「全部」時帶錯題列數最多的前 2 個大題。
 *   - skill：依「提升度」挑：這個代碼（併過別名）在錯題裡的比例 ÷ 在學生最近 180 天全部首次作答（同樣的大題）裡的比例；
 *     取 ≥ 1.3、而且在錯題裡出現 ≥ 2 次的前 3 個。沒有就不帶。
 * 真題模考與成績單的入口用同一支，輸入換成那一份作答的錯題（focusFromOutcomes）。純函式。
 */
import { canonicalSkills, type BankSectionType } from '@gsat/shared';
import type { OutcomeEntry } from '../outcomes';

const DAY_MS = 86_400_000;
export const FOCUS_BASELINE_DAYS = 180;
export const FOCUS_MIN_LIFT = 1.3;
export const FOCUS_MIN_COUNT = 2;
export const FOCUS_MAX_SECTIONS = 2;
export const FOCUS_MAX_SKILLS = 3;

const MC_SECTIONS: readonly BankSectionType[] = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'];
const isMcSection = (s: unknown): s is BankSectionType => typeof s === 'string' && (MC_SECTIONS as readonly string[]).includes(s);

export interface FocusRow {
  /** 這一列（題組）的大題；單字、寫作等沒有對應大題的是 null（不參與）。 */
  section: string | null;
  /** 這一列每一題錯題的原始技能代碼（同作答紀錄的 k）。 */
  questions: readonly (readonly string[])[];
}

export interface WeakFocus {
  sections: BankSectionType[];
  /** 主代碼（依各自大題的別名表正規化過）。 */
  skills: string[];
  /** 挑出來的技能的提升度（預覽的「錯題裡比你平常多 x 倍」；網址帶來的焦點沒有）。 */
  lifts?: Record<string, number>;
}

/**
 * 錯題列 → 焦點。onlySection 是錯題清單篩選的單一大題（「全部」時是 null）；baseline 是這台裝置的作答紀錄（取最近 180 天的首次作答）。
 */
export function focusFromRows(rows: readonly FocusRow[], baseline: readonly OutcomeEntry[], options: { now: number; onlySection?: string | null }): WeakFocus {
  const mcRows = rows.filter((r) => isMcSection(r.section));
  let sections: BankSectionType[];
  if (options.onlySection && isMcSection(options.onlySection)) sections = [options.onlySection];
  else {
    const counts = new Map<BankSectionType, number>();
    for (const r of mcRows) counts.set(r.section as BankSectionType, (counts.get(r.section as BankSectionType) ?? 0) + 1);
    sections = [...counts]
      .sort((a, b) => b[1] - a[1] || MC_SECTIONS.indexOf(a[0]) - MC_SECTIONS.indexOf(b[0]))
      .slice(0, FOCUS_MAX_SECTIONS)
      .map(([s]) => s);
  }
  const inScope = new Set(sections);

  // 錯題裡每個主代碼的次數與比例。
  const wrongCounts = new Map<string, number>();
  let wrongTotal = 0;
  for (const r of mcRows) {
    if (!inScope.has(r.section as BankSectionType)) continue;
    for (const codes of r.questions) {
      wrongTotal += 1;
      for (const c of canonicalSkills(r.section as string, codes)) wrongCounts.set(c, (wrongCounts.get(c) ?? 0) + 1);
    }
  }
  // 基準：最近 180 天、同樣大題的首次作答。
  const since = options.now - FOCUS_BASELINE_DAYS * DAY_MS;
  const baseCounts = new Map<string, number>();
  let baseTotal = 0;
  for (const e of baseline) {
    if (e.first !== 1 || e.at < since || !inScope.has(e.sec as BankSectionType)) continue;
    baseTotal += 1;
    for (const c of canonicalSkills(e.sec, e.k)) baseCounts.set(c, (baseCounts.get(c) ?? 0) + 1);
  }
  const picked =
    wrongTotal === 0
      ? []
      : [...wrongCounts]
          .filter(([, n]) => n >= FOCUS_MIN_COUNT)
          .map(([code, n]) => {
            const base = baseTotal > 0 ? (baseCounts.get(code) ?? 0) / baseTotal : 0;
            const lift = base > 0 ? n / wrongTotal / base : Number.POSITIVE_INFINITY;
            return { code, n, lift };
          })
          .filter((x) => x.lift >= FOCUS_MIN_LIFT)
          .sort((a, b) => b.lift - a.lift || b.n - a.n || a.code.localeCompare(b.code))
          .slice(0, FOCUS_MAX_SKILLS);
  const lifts = Object.fromEntries(picked.filter((x) => Number.isFinite(x.lift)).map((x) => [x.code, Math.round(x.lift * 10) / 10]));
  return { sections, skills: picked.map((x) => x.code), ...(Object.keys(lifts).length > 0 ? { lifts } : {}) };
}

/**
 * 某一份作答（真題模考的 attemptId、自組卷與加強卷的代號，都記在作答紀錄的 p）的錯題 → 焦點：依題組（g）分列，
 * 只取錯題（未作答與部分給分也算）。
 */
export function focusFromOutcomes(paperRecords: readonly OutcomeEntry[], baseline: readonly OutcomeEntry[], now: number): WeakFocus {
  const rows = new Map<string, { section: string; questions: string[][] }>();
  for (const e of paperRecords) {
    if (e.ok === 1) continue;
    const row = rows.get(e.g) ?? { section: e.sec, questions: [] };
    row.questions.push([...e.k]);
    rows.set(e.g, row);
  }
  return focusFromRows([...rows.values()], baseline, { now });
}
