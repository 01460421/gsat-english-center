/**
 * 學習報告的本機摘要（docs/design/learning-assistant.md §5.5）。負責：WP-C。
 *
 * 只讀這台裝置的資料：學習助手的作答紀錄（outcomes.ts）、題庫練習的「做過」、模考紀錄、單字錯題本與複習卡片、
 * 上一版報告的推薦與計畫勾選（planProgress.ts）。統計期間預設最近 90 天，作答數不到 100 時放寬到全部。
 *
 *   buildSummary(input)   純函式（有測試）：算出送給 Worker 的 AssistHistorySummary。
 *   collectSummary(opts)  讀本機資料、載入最近 5 份模考的考卷算各大題得分（同一頁只下載一次），再交給 buildSummary。
 *   fitSummary(summary)   超過 16 KB 時依序縮減（技能、單字、模考的大題、陷阱），Worker 收到的一定在上限內。
 *
 * 不送：題目文字、作答的完整清單、模考的逐題作答、自組卷代號（只送難度 b／a／t）、草稿與自評文字、任何識別資訊。
 * 數量與格式照 Worker 的 zod（apps/api/src/assist/reportSchemas.ts）：答對數 ≤ 作答數、代碼在封閉清單裡、單字的字元。
 */
import {
  ASSIST_LIMITS,
  ASSIST_SECTIONS,
  ASSIST_SUMMARY_WORD_PATTERN,
  TIERS,
  isAssistSkillCode,
  isAssistTrapCode,
  type AssistHistorySummary,
  type AssistReportDetail,
  type AssistSection,
  type AssistSummarySource,
  type Tier,
} from '@gsat/shared';
import { loadExam } from '../../data/exams';
import { levelFromEntryId } from '../../data/vocab';
import { bankReport } from '../mock/bank/bankScore';
import { isBankPaperId, tierOfPaperId, TIER_CODES } from '../mock/bank/paperId';
import { loadBankPaperStrict } from '../mock/bank/resolve';
import { computeReport, type MockReport } from '../mock/report';
import { loadHistory, loadRecord, type MockHistoryEntry } from '../mock/storage';
import { getPracticeHistory, type DoneRecord } from '../practice/history';
import { isDue, type SrsState } from '../vocab/lib/srs';
import type { MistakeBook } from '../vocab/lib/mistakes';
import { getMistakeStore, getSrsStore } from '../vocab/state';
import { assistSectionOf } from './outcomeBuilders';
import { getOutcomes, type OutcomeEntry } from './outcomes';
import { planProgressFor, readPlanChecks } from './planProgress';

const DAY_MS = 86_400_000;
/** 預設統計期間（天）；期間內的作答數不到 MIN_OUTCOMES 時放寬到全部。 */
export const SUMMARY_RANGE_DAYS = 90;
const MIN_OUTCOMES = 100;
const RECENT_DAYS = 30;
const SKILLS_MAX = 40;
const TRAPS_MAX = 15;
const VOCAB_TOP_MAX = 20;
const MOCKS_MAX = 5;

type Mock = AssistHistorySummary['mocks'][number];

export interface SummaryInput {
  /** 現在（毫秒）。 */
  now: number;
  outcomes: readonly OutcomeEntry[];
  /** 題庫練習做過的題組（uid → 紀錄）。 */
  bankDone: Readonly<Record<string, DoneRecord>>;
  /** 最近的模考（新到舊，已經算好）。 */
  mocks: readonly Mock[];
  vocab: { book: MistakeBook | null; srs: SrsState | null };
  planProgress: AssistHistorySummary['plan_progress'];
}

function sourceOf(e: OutcomeEntry): AssistSummarySource | null {
  if (e.s === 'exam' || e.s === 'mock') return 'official';
  if (!e.t || !(TIERS as readonly string[]).includes(e.t)) return null;
  return e.s === 'bank' ? `bank:${e.t}` : `bank_mock:${e.t}`;
}

const isCorrect = (e: OutcomeEntry) => e.ok === 1;

/** 統計期間：最近 90 天；作答數不到 100 時放寬到全部（天數算到最早一筆，至少 1 天）。 */
export function summaryRange(outcomes: readonly OutcomeEntry[], now: number): { items: OutcomeEntry[]; days: number } {
  const recent = outcomes.filter((e) => e.at >= now - SUMMARY_RANGE_DAYS * DAY_MS);
  if (recent.length >= MIN_OUTCOMES || recent.length === outcomes.length) return { items: recent, days: SUMMARY_RANGE_DAYS };
  const earliest = Math.min(...outcomes.map((e) => e.at));
  return { items: [...outcomes], days: Math.min(3_650, Math.max(1, Math.ceil((now - earliest) / DAY_MS))) };
}

function sectionRows(items: readonly OutcomeEntry[], now: number): AssistHistorySummary['sections'] {
  const map = new Map<string, AssistHistorySummary['sections'][number]>();
  for (const e of items) {
    const src = sourceOf(e);
    if (!src || !(ASSIST_SECTIONS as readonly string[]).includes(e.sec)) continue;
    const key = `${e.sec}|${src}`;
    const row = map.get(key) ?? { section: e.sec, src, n: 0, correct: 0, first_n: 0, first_correct: 0, recent_n: 0, recent_correct: 0, hinted: 0, unanswered: 0 };
    row.n += 1;
    if (isCorrect(e)) row.correct += 1;
    if (e.first === 1) {
      row.first_n += 1;
      if (isCorrect(e)) row.first_correct += 1;
    }
    if (e.at >= now - RECENT_DAYS * DAY_MS) {
      row.recent_n += 1;
      if (isCorrect(e)) row.recent_correct += 1;
    }
    if ((e.h ?? 0) > 0) row.hinted += 1;
    if (e.a === null) row.unanswered += 1;
    map.set(key, row);
  }
  const order = (s: AssistSection) => ASSIST_SECTIONS.indexOf(s);
  return [...map.values()].sort((a, b) => order(a.section) - order(b.section) || a.src.localeCompare(b.src));
}

function skillRows(items: readonly OutcomeEntry[]): AssistHistorySummary['skills'] {
  const map = new Map<string, AssistHistorySummary['skills'][number]>();
  for (const e of items) {
    for (const code of new Set(e.k)) {
      if (!isAssistSkillCode(code)) continue;
      const row = map.get(code) ?? { code, n: 0, correct: 0, first_n: 0, first_correct: 0 };
      row.n += 1;
      if (isCorrect(e)) row.correct += 1;
      if (e.first === 1) {
        row.first_n += 1;
        if (isCorrect(e)) row.first_correct += 1;
      }
      map.set(code, row);
    }
  }
  return [...map.values()].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)).slice(0, SKILLS_MAX);
}

function trapRows(items: readonly OutcomeEntry[]): AssistHistorySummary['traps'] {
  const map = new Map<string, number>();
  for (const e of items) if (e.c && !isCorrect(e) && isAssistTrapCode(e.c)) map.set(e.c, (map.get(e.c) ?? 0) + 1);
  return [...map]
    .map(([code, n]) => ({ code, n }))
    .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code))
    .slice(0, TRAPS_MAX);
}

function bankGroupRows(done: Readonly<Record<string, DoneRecord>>, sinceMs: number): AssistHistorySummary['bank_groups'] {
  const map = new Map<string, AssistHistorySummary['bank_groups'][number]>();
  for (const d of Object.values(done)) {
    const at = Date.parse(d.at);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    if (d.total <= 0 || d.correct < 0) continue;
    const key = `${d.section}|${d.tier}`;
    const row = map.get(key) ?? { section: d.section, tier: d.tier, groups: 0, correct: 0, total: 0 };
    row.groups += 1;
    row.correct += Math.min(d.correct, d.total);
    row.total += d.total;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => ASSIST_SECTIONS.indexOf(a.section) - ASSIST_SECTIONS.indexOf(b.section) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
}

function vocabSummary(book: MistakeBook | null, srs: SrsState | null, now: number): AssistHistorySummary['vocab'] {
  const by_level: AssistHistorySummary['vocab']['by_level'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 };
  const items = book ? Object.values(book.items) : [];
  for (const item of items) {
    const level = levelFromEntryId(item.entry_id);
    if (level !== null && level >= 1 && level <= 6) by_level[String(level) as keyof typeof by_level] += 1;
  }
  const top = [...items]
    .sort((a, b) => b.wrong_count - a.wrong_count || b.last_wrong_at - a.last_wrong_at)
    .filter((i) => ASSIST_SUMMARY_WORD_PATTERN.test(i.word))
    .slice(0, VOCAB_TOP_MAX)
    .map((i) => ({ word: i.word, level: levelFromEntryId(i.entry_id) ?? 0, wrong: Math.max(0, Math.floor(i.wrong_count)), mode: i.last_mode }));
  const cards = srs ? Object.values(srs.cards) : [];
  return {
    mistakes: items.length,
    by_level,
    top,
    srs: cards.length === 0 ? null : { cards: cards.length, due: cards.filter((c) => isDue(c, now)).length, lapses_ge3: cards.filter((c) => c.lapses >= 3).length },
  };
}

/** 摘要（純函式）。 */
export function buildSummary(input: SummaryInput): AssistHistorySummary {
  const { items, days } = summaryRange(input.outcomes, input.now);
  const firstAt = input.outcomes.length > 0 ? Math.min(...input.outcomes.map((e) => e.at)) : null;
  return {
    v: 2,
    generated_at: new Date(input.now).toISOString(),
    range_days: days,
    sections: sectionRows(items, input.now),
    skills: skillRows(items),
    traps: trapRows(items),
    bank_groups: bankGroupRows(input.bankDone, input.now - days * DAY_MS),
    mocks: input.mocks.slice(0, MOCKS_MAX),
    vocab: vocabSummary(input.vocab.book, input.vocab.srs, input.now),
    behaviour: { marked: items.filter((e) => e.m === 1).length, revealed: items.filter((e) => e.rv === 1).length, fast_wrong: null },
    plan_progress: input.planProgress,
    coverage: { outcomes: items.length, first_at: firstAt === null ? null : new Date(firstAt).toISOString(), devices_note: 'this_device' },
  };
}

export function summaryBytes(summary: AssistHistorySummary): number {
  return new TextEncoder().encode(JSON.stringify(summary)).byteLength;
}

/** 超過 16 KB 時依序縮減，直到放得下（技能 → 單字 → 模考的大題 → 陷阱 → 題庫彙總）。 */
export function fitSummary(summary: AssistHistorySummary, max = ASSIST_LIMITS.summaryMaxBytes): AssistHistorySummary {
  let s = summary;
  const steps: Array<(x: AssistHistorySummary) => AssistHistorySummary> = [
    (x) => ({ ...x, skills: x.skills.slice(0, 20) }),
    (x) => ({ ...x, vocab: { ...x.vocab, top: x.vocab.top.slice(0, 10) } }),
    (x) => ({ ...x, mocks: x.mocks.map((m) => ({ ...m, sections: [] })) }),
    (x) => ({ ...x, traps: x.traps.slice(0, 5), skills: x.skills.slice(0, 10) }),
    (x) => ({ ...x, bank_groups: [], vocab: { ...x.vocab, top: [] } }),
  ];
  for (const step of steps) {
    if (summaryBytes(s) <= max) return s;
    s = step(s);
  }
  return s;
}

// ───────────────────────── 模考（讀考卷算各大題） ─────────────────────────

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 一份模考的成績單 → 摘要的一列（純函式）。 */
export function mockRow(entry: MockHistoryEntry, report: MockReport | null, tier: Tier | null): Mock {
  const bank = isBankPaperId(entry.paperId);
  const open = (kind: 'translation' | 'composition') => {
    const list = report?.openItems.filter((o) => o.kind === kind) ?? [];
    const max = list.reduce((s, o) => s + o.max, 0);
    const scored = list.filter((o) => o.source === 'self' || o.source === 'auto');
    return { earned: Math.min(max, round2(scored.reduce((s, o) => s + (o.score ?? 0), 0))), max: Math.min(20, max), basis: scored.length > 0 ? ('self' as const) : ('none' as const) };
  };
  const translation = open('translation');
  const essay = open('composition');
  const fullScore = report?.fullScore && report.fullScore > 0 ? report.fullScore : 100;
  return {
    kind: bank ? 'bank' : 'exam',
    paper: bank ? (tier ? TIER_CODES[tier] : 'b') : entry.paperId,
    at: entry.submittedAt,
    raw: Math.max(0, Math.min(fullScore, round2(entry.raw))),
    max: Math.min(100, fullScore),
    level: bank ? null : entry.level,
    scale_year: bank ? null : entry.scaleYear,
    predicted: bank || entry.predictedScore === null ? null : Math.max(0, Math.min(100, entry.predictedScore)),
    nonmc: report && (translation.max > 0 || essay.max > 0) ? { translation, essay } : null,
    sections: (report?.sections ?? [])
      .map((sec) => ({ section: assistSectionOf(sec.type), earned: round2(Math.min(sec.earned, sec.max)), max: round2(sec.max), time_sec: Math.max(0, Math.round(sec.timeSec)), suggested_sec: Math.max(0, Math.round(sec.suggestedSec ?? 0)) }))
      .filter((s) => s.section !== 'other' && s.max > 0)
      .slice(0, 12),
  };
}

async function mockReportOf(entry: MockHistoryEntry): Promise<{ report: MockReport | null; tier: Tier | null }> {
  const record = loadRecord(entry.id);
  if (!record || record.status !== 'submitted') return { report: null, tier: tierOfPaperId(entry.paperId) };
  try {
    if (isBankPaperId(entry.paperId)) {
      const loaded = await loadBankPaperStrict(entry.paperId);
      if (!loaded.ok) return { report: null, tier: tierOfPaperId(entry.paperId) };
      return { report: bankReport(loaded.paper.exam, loaded.paper.explanations, record), tier: loaded.paper.tier };
    }
    return { report: computeReport(await loadExam(entry.paperId), record), tier: null };
  } catch {
    // 考卷讀不到（離線、題目下架）：只送總分，各大題留空。
    return { report: null, tier: tierOfPaperId(entry.paperId) };
  }
}

/** 最近 5 份交卷的模考（新到舊）。 */
export async function collectMocks(): Promise<Mock[]> {
  const entries = loadHistory().slice(0, MOCKS_MAX);
  const rows: Mock[] = [];
  for (const entry of entries) {
    const { report, tier } = await mockReportOf(entry);
    rows.push(mockRow(entry, report, tier));
  }
  return rows;
}

/** 讀這台裝置的資料、組成摘要（previous：依哪一版產生；有的話帶 plan_progress）。 */
export async function collectSummary(opts: { previous: AssistReportDetail | null; todayTw: string; now?: number }): Promise<AssistHistorySummary> {
  const now = opts.now ?? Date.now();
  const outcomes = getOutcomes().items;
  let book: MistakeBook | null = null;
  let srs: SrsState | null = null;
  try {
    book = getMistakeStore().getSnapshot().value;
    srs = getSrsStore().getSnapshot().value;
  } catch {
    // 單字資料讀不到：當成沒有。
  }
  const summary = buildSummary({
    now,
    outcomes,
    bankDone: getPracticeHistory().done,
    mocks: await collectMocks(),
    vocab: { book, srs },
    planProgress: opts.previous ? planProgressFor(opts.previous, outcomes, readPlanChecks(opts.previous.id), opts.todayTw) : null,
  });
  return fitSummary(summary);
}
