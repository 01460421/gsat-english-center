/**
 * 學習報告的數字（docs/design/learning-assistant.md §3.2；純函式，除了打包進來的目標資料不讀任何外部狀態）。負責：WP-C。
 *
 * 「數字一律由程式算」：目標答對率、目前表現、可爭取分數、距離目標、技能、錯因、模考、寫作、單字、和上一版的差異都在這裡算好，
 * 存進報告的 input_json；畫面上的每一個數字都直接讀 facts，AI 只能引用它們（§4.11 第 9 步拿掉預測句）。
 *
 *   目標      目標級分 L → 百分位 p＝level_top_pct[L]（L 級分以上的人數百分比）。選擇題各大題：五等分組放在百分位 10、30、50、70、90，
 *             相鄰兩組線性內插；p ≤ 10 取最高一組（不外插，標「作為下限」）、p ≥ 90 取最低一組。中譯英、作文在（12, 前 12%）、
 *             （25, 前 25%）、（50, 中位數）三點之間內插；p ≤ 12 取前 12%、p ≥ 50 取中位數。
 *   目前表現  選擇題：歷屆與真題模考（official）的首次接觸答對率，作答 ≥ 20 題才採用；不足時用依難度加權的題庫答對率（題庫練習與
 *             自組卷合併、每個難度 ≥ 5 題才算、依官方題的難度比例加權，缺的難度不算、權重重新正規化）；都沒有是「還沒有資料」。
 *             中譯英、作文：最近 3 份 AI 批改的平均（不含自訂題）；沒有時用最近一份模考的自評；都沒有是「還沒有資料」。
 *   可爭取    配分 × max(0, 目標 − 目前)，四捨五入到 0.5 分（中譯英、作文直接用分數差）；沒有資料的大題不算；混合題不算
 *             （目標是多選題的官方得分率，和每一小題全對的比例不能相減）。
 *   距離目標  最近一份真題模考的原始總分（滿分不是 100 時換算成 100 分），對照那份模考的對照年度上目標級分的下限；
 *             還沒超過時至少差 1 分（無條件進位）。
 * 本機摘要是學生端資料：路由已經驗證過形狀與範圍（reportSchemas.ts），這裡不重算、也不相信它的任何文字。
 */
import {
  ASSIST_ERROR_CODES,
  ASSIST_MC_SECTIONS,
  ASSIST_PLAN_KINDS,
  ASSIST_REPORT_SECTIONS,
  ASSIST_SECTION_LABELS,
  ASSIST_SECTION_POINTS,
  ASSIST_STANDARD_LEVELS,
  TIERS,
  assistSkillLabel,
  assistTargetLevel,
  isAssistSkillCode,
  type AssistBankRate,
  type AssistDataGap,
  type AssistDataLevel,
  type AssistHistorySummary,
  type AssistMcSection,
  type AssistMockFact,
  type AssistPlanKind,
  type AssistReportDiff,
  type AssistReportFacts,
  type AssistReportSection,
  type AssistSectionFacts,
  type AssistSkillFact,
  type AssistStandard,
  type Tier,
} from '@gsat/shared';
import targetsJson from '../generated/assist-targets.json';

/** 建置時產生的目標資料（apps/api/scripts/build-assist-data.mjs）。百分比是 0–100。 */
export interface AssistTargets {
  format: string;
  years: number[];
  mc_quintiles: Record<AssistMcSection, number[]>;
  mc_national: Record<AssistMcSection, number>;
  level_top_pct: Record<string, number>;
  standards: { year: number; top: number; front: number; mean: number; back: number; floor: number };
  raw_lower: Record<string, Record<string, number>>;
  nonmc_bands: Record<'translation' | 'essay', { top12: number; top25: number; median: number; max: number }>;
  nonmc_national: { translation: number; essay: number };
  tier_weights: Record<AssistMcSection, Record<Tier, number>>;
  section_points: Record<string, number>;
}

export const ASSIST_TARGETS = targetsJson as unknown as AssistTargets;

/** official 的首次接觸作答數門檻（§3.2.3）。 */
export const OFFICIAL_MIN_N = 20;
/** 題庫每個難度的作答數門檻。 */
export const BANK_TIER_MIN_N = 5;
/** 技能：作答 ≥ 5 次才排弱點（§3.2.5）；最低 8 個、最高 5 個。 */
export const SKILL_MIN_N = 5;
const WEAK_SKILLS = 8;
const STRONG_SKILLS = 5;

/** 四捨五入到 0.5。 */
export function roundHalf(x: number): number {
  return Math.round(x * 2) / 2;
}

/** 數字的顯示：整數不帶小數，其他留到 0.01（去掉尾端的 0）。 */
export function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100);
}

/** 目標級分 → 百分位（該級分以上的人數百分比）。 */
export function topPctOfLevel(level: number, targets: AssistTargets = ASSIST_TARGETS): number {
  const L = Math.min(15, Math.max(1, Math.round(level)));
  return targets.level_top_pct[String(L)] ?? 50;
}

/** 五等分組（百分比）在百分位 p 的值：中點 10、30、50、70、90 之間線性內插，兩端不外插。 */
export function quintileAt(quintiles: readonly number[], p: number): { value: number; floor: boolean } {
  const mids = [10, 30, 50, 70, 90];
  if (p <= 10) return { value: quintiles[0] ?? 0, floor: true };
  if (p >= 90) return { value: quintiles[4] ?? 0, floor: false };
  for (let i = 0; i < 4; i += 1) {
    const lo = mids[i]!;
    const hi = mids[i + 1]!;
    if (p <= hi) {
      const a = quintiles[i] ?? 0;
      const b = quintiles[i + 1] ?? 0;
      return { value: a + ((b - a) * (p - lo)) / (hi - lo), floor: false };
    }
  }
  return { value: quintiles[4] ?? 0, floor: false };
}

/** 非選擇題的目標分數：（12, 前 12%）、（25, 前 25%）、（50, 中位數）三點之間內插，兩端不外插。 */
export function nonmcAt(bands: { top12: number; top25: number; median: number }, p: number): { value: number; floor: boolean } {
  if (p <= 12) return { value: bands.top12, floor: true };
  if (p >= 50) return { value: bands.median, floor: false };
  if (p <= 25) return { value: bands.top12 + ((bands.top25 - bands.top12) * (p - 12)) / 13, floor: false };
  return { value: bands.top25 + ((bands.median - bands.top25) * (p - 25)) / 25, floor: false };
}

/** 各大題在目標級分的目標（選擇題 0–1、非選擇題分數）。 */
export function sectionTarget(section: AssistReportSection, level: number, targets: AssistTargets = ASSIST_TARGETS): { value: number; floor: boolean } {
  const p = topPctOfLevel(level, targets);
  if (section === 'translation') return nonmcAt(targets.nonmc_bands.translation, p);
  if (section === 'composition') return nonmcAt(targets.nonmc_bands.essay, p);
  const q = quintileAt(targets.mc_quintiles[section], p);
  return { value: q.value / 100, floor: q.floor };
}

/** 各大題目標換成分數的合計（產生器的自我檢查與測試用）。 */
export function targetTotal(level: number, targets: AssistTargets = ASSIST_TARGETS): number {
  return ASSIST_REPORT_SECTIONS.reduce((sum, s) => {
    const t = sectionTarget(s, level, targets).value;
    return sum + (s === 'translation' || s === 'composition' ? t : t * ASSIST_SECTION_POINTS[s]);
  }, 0);
}

// ───────────────────────── 伺服器端的輸入（D1 彙整） ─────────────────────────

/** 寫作批改（D1）：最近 10 份已批改的提交（新到舊；自訂題不算進分數平均，錯誤類別照算）。 */
export interface WritingStats {
  translation: number[];
  essay: number[];
  /** 作文四項的分數（新到舊，和 essay 對應；自訂題不算）。 */
  essayCriteria: Array<Record<'content' | 'organization' | 'grammar' | 'vocabulary', number>>;
  categories: Array<{ category: string; n: number }>;
  /** 寫作解析案例的 ts:、tt: 代碼與作文四項分數最低的 wc: 代碼。 */
  weakCodes: string[];
}

/** 案例的伺服器彙整（digests.ts）。 */
export interface CaseStats {
  cases: number;
  errors: Array<{ code: string; n: number }>;
  understood: { yes: number; partly: number; no: number; unset: number };
}

/** 上一版（based_on）的資料。 */
export interface PreviousReport {
  id: string;
  version: number;
  createdAt: number;
  facts: AssistReportFacts | null;
  /** 上一版推薦的 ref 與標題（伺服器重建的）。 */
  recommendations: Array<{ ref: string; title: string }>;
}

export interface FactsInput {
  summary: AssistHistorySummary;
  target: { standard: AssistStandard } | { level: number };
  today: string;
  examDate: string;
  cases: CaseStats;
  writing: WritingStats;
  previous: PreviousReport | null;
  targets?: AssistTargets;
}

// ───────────────────────── 目前表現 ─────────────────────────

function officialOf(summary: AssistHistorySummary, section: AssistMcSection): AssistSectionFacts['official'] {
  const rows = summary.sections.filter((r) => r.section === section && r.src === 'official');
  const n = rows.reduce((s, r) => s + r.first_n, 0);
  const correct = rows.reduce((s, r) => s + r.first_correct, 0);
  return n > 0 ? { n, correct, rate: correct / n } : null;
}

/** 題庫（題庫練習＋自組卷）依難度加權的答對率；每個難度 ≥ 5 題才算，缺的難度不算、權重重新正規化。 */
export function bankRateOf(summary: AssistHistorySummary, section: AssistMcSection, weights: Record<Tier, number>): AssistBankRate | null {
  const tiers: AssistBankRate['tiers'] = [];
  for (const tier of TIERS) {
    const rows = summary.sections.filter((r) => r.section === section && (r.src === `bank:${tier}` || r.src === `bank_mock:${tier}`));
    const n = rows.reduce((s, r) => s + r.n, 0);
    const correct = rows.reduce((s, r) => s + r.correct, 0);
    if (n >= BANK_TIER_MIN_N) tiers.push({ tier, n, rate: correct / n });
  }
  if (tiers.length === 0) return null;
  const wSum = tiers.reduce((s, t) => s + (weights[t.tier] ?? 0), 0);
  const rate = wSum > 0 ? tiers.reduce((s, t) => s + (weights[t.tier] ?? 0) * t.rate, 0) / wSum : tiers.reduce((s, t) => s + t.rate, 0) / tiers.length;
  const has = new Set(tiers.map((t) => t.tier));
  const note: AssistBankRate['note'] = !has.has('top') ? 'no_top' : has.size === 1 ? 'only_top' : null;
  return { rate, n: tiers.reduce((s, t) => s + t.n, 0), tiers, note };
}

/** 最近一份模考（真題或自組卷）的非選擇題自評。 */
function selfScore(summary: AssistHistorySummary, kind: 'translation' | 'essay'): number | null {
  const mocks = [...summary.mocks].sort((a, b) => b.at.localeCompare(a.at));
  for (const m of mocks) {
    const part = m.nonmc?.[kind];
    if (part && part.basis === 'self' && part.max > 0) return part.earned;
  }
  return null;
}

function writingSection(section: 'translation' | 'composition', input: FactsInput, level: number, targets: AssistTargets): AssistSectionFacts {
  const scores = section === 'translation' ? input.writing.translation : input.writing.essay;
  const recent = scores.slice(0, 3);
  const self = selfScore(input.summary, section === 'translation' ? 'translation' : 'essay');
  const writing: AssistSectionFacts['writing'] =
    recent.length > 0 ? { n: recent.length, avg: recent.reduce((a, b) => a + b, 0) / recent.length, basis: 'ai_grading' } : self !== null ? { n: 1, avg: self, basis: 'self' } : null;
  const t = sectionTarget(section, level, targets);
  const current = writing?.avg ?? null;
  return {
    section,
    points: ASSIST_SECTION_POINTS[section],
    official: null,
    bank: null,
    writing,
    current,
    basis: writing?.basis ?? 'none',
    target: t.value,
    target_floor: t.floor,
    gain: current === null ? null : roundHalf(Math.max(0, t.value - current)),
    national: section === 'translation' ? targets.nonmc_national.translation : targets.nonmc_national.essay,
  };
}

function mcSection(section: AssistMcSection, summary: AssistHistorySummary, level: number, targets: AssistTargets): AssistSectionFacts {
  const official = officialOf(summary, section);
  const bank = bankRateOf(summary, section, targets.tier_weights[section]);
  const t = sectionTarget(section, level, targets);
  let current: number | null = null;
  let basis: AssistSectionFacts['basis'] = 'none';
  if (official && official.n >= OFFICIAL_MIN_N) {
    current = official.rate;
    basis = 'official';
  } else if (bank) {
    current = bank.rate;
    basis = 'bank';
  }
  const points = ASSIST_SECTION_POINTS[section];
  return {
    section,
    points,
    official,
    bank,
    writing: null,
    current,
    basis,
    target: t.value,
    target_floor: t.floor,
    // 混合題不算可爭取分數：目標只代表多選題的官方得分率（含部分給分；§3.2.1），目前表現卻是填充、簡答、多選每一小題
    // 「全對」的比例（部分給分算錯、書寫小題占多數），兩者量的不是同一件事，相減會算出不存在的分數。
    gain: current === null || section === 'mixed' ? null : roundHalf(points * Math.max(0, t.value - current)),
    national: targets.mc_national[section] / 100,
  };
}

// ───────────────────────── 其他數字 ─────────────────────────

function skillsOf(summary: AssistHistorySummary): AssistReportFacts['skills'] {
  const rows: AssistSkillFact[] = summary.skills
    .filter((s) => isAssistSkillCode(s.code) && s.first_n >= SKILL_MIN_N)
    .map((s) => ({ code: s.code, n: s.first_n, correct: s.first_correct, rate: s.first_correct / s.first_n }));
  const byRate = (dir: 1 | -1) => (a: AssistSkillFact, b: AssistSkillFact) => dir * (a.rate - b.rate) || b.n - a.n || a.code.localeCompare(b.code);
  const weak = [...rows].sort(byRate(1)).slice(0, WEAK_SKILLS);
  const weakSet = new Set(weak.map((w) => w.code));
  const strong = [...rows].sort(byRate(-1)).filter((s) => !weakSet.has(s.code)).slice(0, STRONG_SKILLS);
  return { weak, strong };
}

function mocksOf(summary: AssistHistorySummary): AssistMockFact[] {
  return [...summary.mocks]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5)
    .map((m) => ({
      kind: m.kind,
      paper: m.paper,
      at: m.at,
      raw: m.raw,
      max: m.max,
      level: m.kind === 'exam' ? m.level : null,
      scale_year: m.kind === 'exam' ? m.scale_year : null,
      predicted: m.kind === 'exam' ? m.predicted : null,
      self_scored: m.nonmc !== null && (m.nonmc.translation.basis === 'self' || m.nonmc.essay.basis === 'self'),
      sections: m.sections.map((s) => ({ section: s.section, rate: s.max > 0 ? s.earned / s.max : 0, time_sec: s.time_sec, suggested_sec: s.suggested_sec })),
    }));
}

/** 距離目標（§3.2.4）。 */
function distanceOf(mocks: readonly AssistMockFact[], level: number, targets: AssistTargets): AssistReportFacts['distance'] {
  const exam = mocks.find((m) => m.kind === 'exam' && m.max > 0);
  if (!exam) return null;
  const latest = targets.years[targets.years.length - 1]!;
  const year = exam.scale_year !== null && targets.raw_lower[String(exam.scale_year)] ? exam.scale_year : latest;
  const lower = targets.raw_lower[String(year)]?.[String(level)];
  if (lower === undefined) return null;
  const raw = Math.round((exam.max === 100 ? exam.raw : (exam.raw / exam.max) * 100) * 100) / 100;
  // 要「超過」下限才到那個級分：還沒超過時至少差 1 分（無條件進位），不會因為四捨五入說成差 0 分。
  const short = raw > lower ? 0 : Math.max(1, Math.ceil(Math.round((lower - raw) * 100) / 100));
  return { raw, max: 100, scale_year: year, level, lower, short, self_scored: exam.self_scored, at: exam.at };
}

/** 程式產生的「距離目標」句子（§3.2.4；畫面與提示共用）。 */
export function distanceLines(distance: AssistReportFacts['distance'], gainTotal: number, anyData: boolean): string[] {
  const lines: string[] = [];
  if (distance) {
    const head = `最近一次真題模考 ${fmt(distance.raw)} 分${distance.self_scored ? '（含自評）' : ''}；依 ${distance.scale_year} 年對照表，${distance.level} 級分要超過 ${fmt(distance.lower)} 分`;
    const gap = distance.lower - distance.raw;
    lines.push(gap < 0 ? `${head}，已經超過。` : gap < 1 ? `${head}，還差不到 1 分。` : `${head}，還差約 ${distance.short} 分。`);
  } else {
    lines.push('還沒有真題模考的成績；做一份真題模考，就能看到和目標級分的距離。');
  }
  if (anyData) lines.push(`各大題可爭取分數合計約 ${fmt(gainTotal)} 分。`);
  return lines;
}

function dataLevel(summary: AssistHistorySummary, cases: number): AssistDataLevel {
  const answered = Math.max(
    summary.coverage.outcomes,
    summary.sections.reduce((s, r) => s + r.n, 0),
  );
  if (answered >= 200 || summary.mocks.length >= 1) return 'enough';
  if (answered < 30 && cases < 3) return 'little';
  return 'some';
}

function dataGaps(sections: readonly AssistSectionFacts[], summary: AssistHistorySummary, cases: number): AssistDataGap[] {
  const gaps: AssistDataGap[] = [];
  const mc = sections.filter((s) => (ASSIST_MC_SECTIONS as readonly string[]).includes(s.section));
  if (!mc.some((s) => s.basis === 'official')) gaps.push('official');
  if (!mc.some((s) => s.bank !== null)) gaps.push('bank');
  if (summary.mocks.length === 0) gaps.push('mock');
  for (const s of ['translation', 'composition'] as const) if (sections.find((x) => x.section === s)?.basis === 'none') gaps.push(s);
  if (summary.vocab.mistakes === 0 && summary.vocab.srs === null) gaps.push('vocab');
  if (cases === 0) gaps.push('cases');
  return gaps;
}

function diffOf(input: FactsInput, sections: readonly AssistSectionFacts[], weak: readonly AssistSkillFact[], errors: ReadonlyArray<{ code: string; n: number }>): AssistReportDiff | null {
  const prev = input.previous;
  if (!prev) return null;
  const before = prev.facts;
  const progress = input.summary.plan_progress && input.summary.plan_progress.report_id === prev.id ? input.summary.plan_progress : null;
  const recTitles = new Map(prev.recommendations.map((r) => [r.ref, r.title]));
  const errCodes = [...new Set([...(before?.errors ?? []).map((e) => e.code), ...errors.map((e) => e.code)])];
  const prevWeak = new Set((before?.skills.weak ?? []).map((s) => s.code));
  const nowWeak = new Set(weak.map((s) => s.code));
  return {
    previous_id: prev.id,
    previous_version: prev.version,
    since: new Date(prev.createdAt * 1000).toISOString(),
    sections: sections.map((s) => ({ section: s.section, before: before?.sections.find((b) => b.section === s.section)?.current ?? null, after: s.current })),
    errors: errCodes
      .map((code) => ({ code, before: before?.errors.find((e) => e.code === code)?.n ?? 0, after: errors.find((e) => e.code === code)?.n ?? 0 }))
      .filter((e) => e.before !== e.after),
    weak_added: [...nowWeak].filter((c) => !prevWeak.has(c)),
    weak_removed: [...prevWeak].filter((c) => !nowWeak.has(c)),
    // 只收上一版真的推薦過的 ref（§3.2.7）。
    followed: (progress?.recs ?? [])
      .filter((r) => recTitles.has(r.ref))
      .map((r) => ({ ref: r.ref, title: recTitles.get(r.ref) ?? '', attempted: r.attempted, first_n: r.first_n, first_correct: Math.min(r.first_correct, r.first_n) })),
    checklist: (progress?.checklist ?? [])
      .filter((c): c is { kind: AssistPlanKind; done: number; total: number } => (ASSIST_PLAN_KINDS as readonly string[]).includes(c.kind))
      .map((c) => ({ kind: c.kind, done: Math.min(c.done, c.total), total: c.total })),
  };
}

/** 算出這一版的 facts（§3.2）。 */
export function computeFacts(input: FactsInput): AssistReportFacts {
  const targets = input.targets ?? ASSIST_TARGETS;
  const level = assistTargetLevel(input.target);
  const summary = input.summary;
  const sections: AssistSectionFacts[] = ASSIST_REPORT_SECTIONS.map((s) =>
    s === 'translation' || s === 'composition' ? writingSection(s, input, level, targets) : mcSection(s, summary, level, targets),
  );
  const withData = sections.filter((s) => s.gain !== null);
  const gainTotal = roundHalf(withData.reduce((sum, s) => sum + (s.gain ?? 0), 0));
  const mocks = mocksOf(summary);
  const distance = distanceOf(mocks, level, targets);
  const skills = skillsOf(summary);
  const errors = input.cases.errors.filter((e) => (ASSIST_ERROR_CODES as readonly string[]).includes(e.code)).sort((a, b) => b.n - a.n || a.code.localeCompare(b.code));
  const essayCriteria = input.writing.essayCriteria.slice(0, 3);
  const criteriaAvg =
    essayCriteria.length > 0
      ? (Object.fromEntries(
          (['content', 'organization', 'grammar', 'vocabulary'] as const).map((k) => [k, Math.round((essayCriteria.reduce((s, c) => s + c[k], 0) / essayCriteria.length) * 100) / 100]),
        ) as Record<'content' | 'organization' | 'grammar' | 'vocabulary', number>)
      : null;
  const avg = (xs: readonly number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100;
  const tr5 = input.writing.translation.slice(0, 5);
  const es5 = input.writing.essay.slice(0, 5);
  const levels = new Set<number>([level, targets.standards.top, targets.standards.front, targets.standards.mean, targets.standards.back, targets.standards.floor]);
  for (const m of mocks) if (m.level !== null) levels.add(m.level);
  return {
    v: 1,
    today: input.today,
    exam_date: input.examDate,
    target: { level, standard: 'standard' in input.target ? input.target.standard : null, top_pct: topPctOfLevel(level, targets) },
    standards: { ...targets.standards },
    sections,
    gain_total: gainTotal,
    distance,
    distance_lines: distanceLines(distance, gainTotal, withData.length > 0),
    skills,
    errors,
    traps: [...summary.traps].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)).slice(0, 15),
    understood: input.cases.understood,
    cases: input.cases.cases,
    mocks,
    writing: {
      translation: tr5.length > 0 ? { n: tr5.length, avg: avg(tr5), max: 8 } : null,
      essay: es5.length > 0 ? { n: es5.length, avg: avg(es5), max: 20, criteria: criteriaAvg } : null,
      categories: input.writing.categories.slice(0, 5),
      weak_codes: input.writing.weakCodes.filter(isAssistSkillCode).slice(0, 8),
    },
    vocab: {
      mistakes: summary.vocab.mistakes,
      by_level: { ...summary.vocab.by_level },
      top_words: summary.vocab.top.slice(0, 10).map((w) => w.word),
      srs: summary.vocab.srs,
    },
    behaviour: summary.behaviour,
    data_level: dataLevel(summary, input.cases.cases),
    data_gaps: dataGaps(sections, summary, input.cases.cases),
    coverage: { outcomes: summary.coverage.outcomes, first_at: summary.coverage.first_at, range_days: summary.range_days },
    levels: [...levels].sort((a, b) => a - b),
    diff: diffOf(input, sections, skills.weak, errors),
  };
}

// ───────────────────────── 給畫面與提示的小工具 ─────────────────────────

/** 一個 area（大題代號或技能代碼）在 facts 裡的證據（報告的強項與待加強）。不認得的 area 回 null。 */
export function areaEvidence(facts: AssistReportFacts, area: string): { label: string; n: number | null; rate: number | null; target: number | null; gain: number | null } | null {
  const section = facts.sections.find((s) => s.section === area);
  if (section) {
    const n = section.basis === 'official' ? (section.official?.n ?? null) : section.basis === 'bank' ? (section.bank?.n ?? null) : (section.writing?.n ?? null);
    return { label: ASSIST_SECTION_LABELS[section.section], n, rate: section.current, target: section.target, gain: section.gain };
  }
  const label = assistSkillLabel(area);
  if (!label) return null;
  const skill = [...facts.skills.weak, ...facts.skills.strong].find((s) => s.code === area);
  return { label, n: skill?.n ?? null, rate: skill?.rate ?? null, target: null, gain: null };
}

/** 五標的級分對照（給提示）。 */
export function standardsLine(facts: AssistReportFacts): string {
  const s = facts.standards;
  return `In ${s.year}: top standard (頂標) level ${s.top}, front (前標) ${s.front}, mean (均標) ${s.mean}, back (後標) ${s.back}, floor (底標) ${s.floor}.`;
}

/** 測試用：五標和 shared 的常數一致。 */
export function standardsMatchShared(targets: AssistTargets = ASSIST_TARGETS): boolean {
  return targets.standards.top === ASSIST_STANDARD_LEVELS.top && targets.standards.front === ASSIST_STANDARD_LEVELS.front && targets.standards.mean === ASSIST_STANDARD_LEVELS.mean && targets.standards.year === ASSIST_STANDARD_LEVELS.year;
}
