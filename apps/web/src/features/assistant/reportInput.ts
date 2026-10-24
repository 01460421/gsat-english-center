/**
 * 產生報告前在前端準備的東西（docs/design/learning-assistant.md §1.8、§5.5、§5.6）。負責：WP-C。
 *
 *   weakSkillsOf / focusSectionsOf  從摘要挑最弱的 6 個技能與答對率最低的大題（推薦候選的排序用；純函式）。
 *   collectCandidates               推薦候選的 ref（≤ 24）：題庫索引依弱技能與練習難度取 14 組＋6 份沒做過或很久沒做的學測卷。
 *                                   只送 ref；標題、大題、難度由 Worker 從公開索引重建（不採用前端的文字）。
 *   localOverview / sinceOverview   產生面板的「資料概況」與「上一版之後」。
 */
import { ASSIST_MC_SECTIONS, type AssistHistorySummary, type AssistReportDetail, type AssistSection, type Tier } from '@gsat/shared';
import { loadPracticeIndex } from '../../data/bank';
import { loadExamIndex } from '../../data/exams';
import { loadUsedGroups } from '../mock/bank/used';
import { loadHistory } from '../mock/storage';
import { getPracticeHistory } from '../practice/history';
import { getMistakeStore } from '../vocab/state';
import { reportCandidates, type CandidateEntry } from './candidates';
import { getOutcomes } from './outcomes';
import { checklistProgress, readPlanChecks, recsProgress } from './planProgress';

/** 首次接觸作答 ≥ 5 次的技能，答對率低到高取 6 個。 */
export function weakSkillsOf(summary: Pick<AssistHistorySummary, 'skills'>, n = 6): string[] {
  return summary.skills
    .filter((s) => s.first_n >= 5)
    .map((s) => ({ code: s.code, rate: s.first_correct / s.first_n }))
    .sort((a, b) => a.rate - b.rate || a.code.localeCompare(b.code))
    .slice(0, n)
    .map((s) => s.code);
}

/** 選擇題大題依首次接觸答對率低到高（沒有作答的排最後，順序照考卷）。 */
export function focusSectionsOf(summary: Pick<AssistHistorySummary, 'sections'>): AssistSection[] {
  const rate = new Map<string, { n: number; c: number }>();
  for (const row of summary.sections) {
    const cur = rate.get(row.section) ?? { n: 0, c: 0 };
    cur.n += row.first_n;
    cur.c += row.first_correct;
    rate.set(row.section, cur);
  }
  const value = (s: string) => {
    const r = rate.get(s);
    return r && r.n > 0 ? r.c / r.n : 2;
  };
  return [...ASSIST_MC_SECTIONS].sort((a, b) => value(a) - value(b) || ASSIST_MC_SECTIONS.indexOf(a) - ASSIST_MC_SECTIONS.indexOf(b));
}

/** 推薦候選的 ref（索引讀不到時回空陣列：報告照樣產生，只是沒有推薦）。 */
export async function collectCandidates(summary: AssistHistorySummary, tier: Tier): Promise<string[]> {
  const [bank, exams] = await Promise.all([loadPracticeIndex().catch(() => null), loadExamIndex().catch(() => null)]);
  const done = new Set([...loadUsedGroups().keys(), ...Object.keys(getPracticeHistory().done)]);
  const lastAt = new Map<string, number>();
  for (const e of getOutcomes().items) if (e.s === 'exam' || e.s === 'mock') lastAt.set(e.r, Math.max(lastAt.get(e.r) ?? 0, e.at));
  for (const h of loadHistory()) lastAt.set(h.paperId, Math.max(lastAt.get(h.paperId) ?? 0, Date.parse(h.submittedAt) || 0));
  return reportCandidates({
    bank: (bank?.groups ?? []) as unknown as CandidateEntry[],
    weakSkills: weakSkillsOf(summary),
    focusSections: focusSectionsOf(summary),
    tier,
    done,
    exams: (exams?.exams ?? []).filter((e) => e.exam === 'gsat' && e.session === 'regular').map((e) => ({ id: e.id, lastAt: lastAt.get(e.id) ?? null })),
  });
}

export interface LocalOverview {
  outcomes: number;
  official: number;
  bank: number;
  mocks: number;
  vocabMistakes: number;
}

/** 這台裝置的資料概況（產生面板）。 */
export function localOverview(): LocalOverview {
  const items = getOutcomes().items;
  let vocabMistakes = 0;
  try {
    vocabMistakes = Object.keys(getMistakeStore().getSnapshot().value.items).length;
  } catch {
    vocabMistakes = 0;
  }
  return {
    outcomes: items.length,
    official: items.filter((e) => e.s === 'exam' || e.s === 'mock').length,
    bank: items.filter((e) => e.s === 'bank' || e.s === 'bank_mock').length,
    mocks: loadHistory().length,
    vocabMistakes,
  };
}

export interface SinceOverview {
  outcomes: number;
  mocks: number;
  checklist: { done: number; total: number };
  recs: { done: number; total: number };
}

/** 「上一版之後：新作答 212 題、模考 1 份；計畫完成 9／14 項；推薦的 6 組做了 4 組」。 */
export function sinceOverview(previous: AssistReportDetail, todayTw: string): SinceOverview {
  const since = previous.created_at * 1000;
  const outcomes = getOutcomes().items;
  const checklist = checklistProgress(previous, readPlanChecks(previous.id), todayTw).reduce((s, c) => ({ done: s.done + c.done, total: s.total + c.total }), { done: 0, total: 0 });
  const recs = recsProgress(previous.report?.recommendations.map((r) => r.ref) ?? [], outcomes, since);
  return {
    outcomes: outcomes.filter((e) => e.at >= since).length,
    mocks: loadHistory().filter((h) => Date.parse(h.submittedAt) >= since).length,
    checklist,
    recs: { done: recs.filter((r) => r.attempted).length, total: recs.length },
  };
}
