/**
 * 弱點模型（docs/design/weak-paper.md §5）：依這台裝置的作答紀錄（加上登入時讀到的學習報告與解析案例）算出
 * 「最需要加強的大題、技能、陷阱與錯因群組」，給組卷（assemblePaper.ts）與預覽、成績單用。純函式，不產生文字（文字在 reasons.ts）。
 *
 * 主要規則（設計值，§5.2–§5.5）：
 *   - 只用最近 180 天、選擇題與混合題的首次作答；時間權重 0.5^(天數／30)；殘差 r ＝ Σw(e−y)／(Σw＋4)（4 個虛擬觀察值，資料少時往 0 收）。
 *   - 技能代碼先依別名表正規化（canonicalSkills），*:other 不算；技能依大題分開算。
 *   - 大題：e＝0.7（題庫題，SPEC §3「目標族群約七成答對」）或歷屆題同程度考生的答對率（peerRate／np）；y＝原始的 ok。
 *     門檻：證據 ≥ 8 題（篇章結構、混合題：≥ 4 題而且答錯 ≥ 2 題）、殘差 ≥ 0.08；W＝min(0.4, r)。
 *   - 技能：e＝學生自己在同大題、同難度的基準答對率（不含帶這個代碼的紀錄；剩不到 4 題時才算進去）；
 *     y：答對但標記過、用了提示或先看答案的算 0.5。門檻：≥ 4 題、殘差 ≥ 0.10；W＝min(0.5, r × (1 ＋ 大題殘差⁺))。
 *   - 陷阱：和曝光量比（trapExcess）：最近 90 天有 c 的答錯，期望 E＝Σ（那一題這類錯誤選項數 ÷ 錯誤選項總數），
 *     O ≥ 1.5E 而且 O − E ≥ max(2, 1.5√E)；W＝min(0.25, 0.05 × 時間加權的 (O − E))。
 *   - 同一份作答對同一個弱點的權重合計超過 4 時依比例縮小（診斷卷與焦點那一份除外）；焦點那一份權重 × 2。
 *   - 最近 6 題答對 ≥ 5 題：W × 0.5、標 improving。包含關係：某技能 ≥ 80% 的題同時帶著排名更前面、同大題的另一個技能時不另列。
 *   - 證據規則（isSectionEvidence）：大題弱點、技能的基準、學習報告的「各大題答對率」共用（summary.ts）。
 *   - 學習報告與案例（§5.4）：優先序權重、14／45／60 天衰減、報告之後又有 150 題首次作答就不用；和本機合併 max ＋ 0.5 × min；
 *     本機反證（殘差 ≤ 0、≥ 8 題）時報告的權重減半。錯因依 errorTargets.ts 的表加成（applyErrorSignal）。
 *   - 取權重前 6 名（同分時作答數多的先、再依鍵排序）。焦點裡的大題與技能一定列為目標（權重至少 0.15），其他只保留焦點大題裡的。
 */
import {
  ASSIST_ERROR_CODES,
  ASSIST_SECTION_POINTS,
  TIERS,
  assistDefaultTier,
  canonicalSkill,
  canonicalSkills,
  isAssistErrorCode,
  isAssistSkillCode,
  type AssistErrorCode,
  type AssistReportDetail,
  type BankSectionType,
  type Tier,
} from '@gsat/shared';
import type { AssembleTarget } from '../../mock/bank/assemblePaper';
import { bk2KindOf } from '../../mock/bank/paperId';
import { codeSectionCounts, topSection, trapCompositionOf, type PaperSkills } from '../../mock/bank/paperSkills';
import type { DoneRecord } from '../../practice/history';
import { practiceTierFrom } from '../candidates';
import type { OutcomeEntry } from '../outcomes';
import { DEFAULT_TARGET_LEVEL, peerRate, percentileOfLevel } from '../rankMistakes';
import { ERROR_TARGETS } from './errorTargets';
import type { WeakFocus } from './focus';

// ---------------------------------------------------------------------------
// 參數（設計值；上線後依作答資料校正）
// ---------------------------------------------------------------------------

export const WEAKNESS_PARAMS = {
  halfLifeDays: 30,
  windowDays: 180,
  trapDays: 90,
  alpha: 4,
  paperCap: 4,
  bankExpected: 0.7,
  sectionMinN: 8,
  smallSectionMinN: 4,
  smallSectionMinWrong: 2,
  sectionMinResidual: 0.08,
  sectionMaxWeight: 0.4,
  skillMinN: 4,
  skillMinResidual: 0.1,
  skillMaxWeight: 0.5,
  trapRatio: 1.5,
  trapMinExcess: 2,
  trapSqrtFactor: 1.5,
  trapUnit: 0.05,
  trapMaxWeight: 0.25,
  maxTargets: 6,
  minFirstAttempts: 30,
  improvingWindow: 6,
  improvingCorrect: 5,
  containment: 0.8,
  focusMinWeight: 0.15,
  focusPaperFactor: 2,
  maintenanceIdleDays: 14,
  maintenanceMinN: 4,
  tooHardMinN: 30,
  tooHardMaxRate: 0.55,
  tooHardMinSections: 4,
  reportFullDays: 14,
  reportHalfDays: 45,
  reportMaxDays: 60,
  reportMaxNewFirst: 150,
  /** 報告的錯因（weaknesses[].error_codes、error_patterns[].code）：每個錯因 0.10，只算一次。 */
  reportErrorSignal: 0.1,
  /** 案例的錯因次數 ≥ 2：0.05 × 次數，最多 0.20。 */
  caseErrorUnit: 0.05,
  caseErrorMax: 0.2,
  caseErrorMinCount: 2,
  /** 錯因訊號合計的上限（報告的文字與案例次數加起來）。 */
  errorSignalMax: 0.25,
  /** 「不懂」的案例：每個技能 0.05，最多 0.15。 */
  notUnderstoodUnit: 0.05,
  notUnderstoodMax: 0.15,
  /** score_plan 第 1、2 優先的大題：＋0.10。 */
  scorePlanBonus: 0.1,
  /** 報告的寫作弱代碼（ts:、tt:）。 */
  writingCodeWeight: 0.15,
  writingSectionMax: 0.3,
  mergedMax: 0.5,
} as const;

const P = WEAKNESS_PARAMS;
const DAY_MS = 86_400_000;
export const MC_SECTIONS: readonly BankSectionType[] = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'];
const ALL_SECTIONS: readonly BankSectionType[] = [...MC_SECTIONS, 'translation', 'composition'];
const SMALL_SECTIONS: ReadonlySet<BankSectionType> = new Set(['structure', 'mixed']);
/** 保持手感的候選（選擇題大題）。 */
const MAINTENANCE_SECTIONS: readonly BankSectionType[] = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading'];
const TRAP_SECTIONS: readonly BankSectionType[] = ['reading', 'mixed'];
const isMc = (s: string): s is BankSectionType => (MC_SECTIONS as readonly string[]).includes(s);
const isBankSection = (s: string): s is BankSectionType => (ALL_SECTIONS as readonly string[]).includes(s);

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export type WeakSource = 'local' | 'report' | 'cases' | 'focus';

export type WeakEvidence =
  | { n: number; rate: number | null; expected: number | null; basis: 'bank' | 'official' | 'mixed' | 'report' }
  /** 陷阱：O、E、有 c 的答錯數。 */
  | { observed: number; expected: number; wrongs: number };

export interface WeakTarget extends AssembleTarget {
  evidence: WeakEvidence;
  from: WeakSource[];
  improving: boolean;
  /** 本機的殘差（沒有本機資料是 null）。 */
  residual: number | null;
  /** 學習報告列為弱點時的優先序（1–5）。 */
  reportPriority: number | null;
  /** 本機資料顯示這一項沒問題、只有報告說弱（報告的權重已減半）。 */
  contradicted: boolean;
  /** 包含關係併進來的技能（§5.3：例如 ct:grammar_frame 併進 tp:grammar）。 */
  merged: string[];
  /** 錯因群組與錯因加成的來源錯因。 */
  errors: AssistErrorCode[];
  /** 焦點裡的項目、但沒有過一般門檻（預覽寫「錯題裡比你平常多…」或「你這次選的範圍」）。 */
  focusOnly: boolean;
}

export interface WeaknessProfile {
  /** ≤ 6，依權重。 */
  targets: WeakTarget[];
  maintenance: { section: BankSectionType; rate: number; daysSince: number } | null;
  baseTier: Tier;
  baseTierBasis: 'prefs' | 'report' | 'practice' | 'target' | 'default';
  /** §5.5 的最少資料：證據首次作答 ≥ 30 題，或報告有至少一項可用的弱點。 */
  enough: boolean;
  /** enough 而且 targets 是空的（§3.4 的「沒有明顯弱點」）。 */
  noWeakness: boolean;
  /** §3.4 的「整體偏難」：基準難度的首次作答 ≥ 30 題、答對 ≤ 55%，而且 ≥ 4 個大題是大題弱點。 */
  tooHard: { rate: number; n: number } | null;
  /** 沒有資料的大題。 */
  gaps: BankSectionType[];
  coverage: { firstAttempts: number; days: number; trapDays: 90; report: { version: number; createdAt: number; used: boolean } | null };
  /** 不靠挑題改善的錯因（粗心、時間不夠、缺背景知識；報告或案例裡有的）。 */
  unhelpedErrors: AssistErrorCode[];
  /** 從報告頁進來時可以直接放進卷子的推薦題組（uid，≤ 2；§6.3 第 5 步）。 */
  reportPins: string[];
}

/** 證據規則要的「我的加強卷」資料（weakPapers.ts 的 weakPaperEvidence）：targetCodes 是每個大題的目標命中代碼。 */
export type PaperEvidenceMap = ReadonlyMap<string, { kind: string; targetCodes: Readonly<Partial<Record<BankSectionType, readonly string[]>>>; diagnostic?: boolean }>;

export interface WeaknessInput {
  outcomes: readonly OutcomeEntry[];
  /** 技能分布（陷阱的誘答組成、技能代碼的大題）；讀不到時是 null（陷阱弱點不算）。 */
  skills: PaperSkills | null;
  papers: PaperEvidenceMap;
  /** 題庫練習的「做過」：作答紀錄上線前做的題組只有每組的答對數，補進大題（沒有技能）。 */
  practiceDone?: Readonly<Record<string, DoneRecord>>;
  prefs?: { practiceTier?: Tier | null; targetLevel?: number | null };
  /** 學生自己選的基準難度（畫面的難度選項）；不給就自動決定。 */
  baseTier?: Tier | null;
  /** 最新一版 done 的學習報告（登入時）。 */
  report?: AssistReportDetail | null;
  /** 解析案例清單第一頁（登入時）：全部案例的錯因次數、這一頁裡「不懂」的案例的技能代碼。 */
  cases?: { errorCounts: Readonly<Record<string, number>>; notUnderstoodSkills: readonly (readonly string[])[] } | null;
  /** 入口帶來的焦點；paper 是那一份作答的 p（真題模考的 attemptId、自組卷與加強卷的代號）。 */
  focus?: (WeakFocus & { paper?: string | null }) | null;
}

// ---------------------------------------------------------------------------
// 證據規則
// ---------------------------------------------------------------------------

/**
 * 證據規則（§5.2）：這一筆紀錄算不算進「大題」的證據（大題弱點、技能的基準、學習報告的各大題答對率共用）。
 *   - 題庫練習、歷屆試題、真題模考、自組模擬考（bk1）、中性模考格式卷（bk2-m）、隨機抽題卷（bk2-r）：全部算。
 *   - 弱點加強卷（bk2-w）、模考格式卷（bk2-f）：這一題（正規化後）的技能代碼和組卷時**同一個大題**的目標代碼沒有交集才算
 *     （保持手感那一組、只依大題選入的題組、題組裡其他技能的題、沒有標註的題組）。只比同一個大題：tp:collocation 這類代碼
 *     出現在好幾個大題，綜合測驗的目標不會讓詞彙的題（從來不是為那個目標挑的）不算。均衡加強卷的目標是空的，全部算。
 *   - 讀不到清單的 w、f（別人分享的卷子、清單被清掉）：整份不算進大題，只進技能與陷阱。
 */
export function isSectionEvidence(e: Pick<OutcomeEntry, 's' | 'p' | 'sec' | 'k'>, papers: PaperEvidenceMap): boolean {
  if (e.s !== 'bank_mock' || !e.p) return true;
  const kind = bk2KindOf(e.p);
  if (kind === null || kind === 'm' || kind === 'r') return true;
  const info = papers.get(e.p);
  if (!info) return false;
  const own = info.targetCodes[e.sec as BankSectionType];
  if (!own || own.length === 0) return true;
  const targets = new Set(own);
  return !canonicalSkills(e.sec, e.k).some((c) => targets.has(c));
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 一個觀察值：n 題（作答紀錄是 1；練習紀錄的補登是整組題數），y、x 是合計。 */
interface Obs {
  paper: string;
  at: number;
  w: number;
  n: number;
  y: number;
  x: number;
  correct: number;
  official: boolean;
  /** 卷子的權重上限不適用（診斷卷、焦點那一份）。 */
  uncapped: boolean;
}

/** 時間權重 0.5^(天數／30)（半衰期 30 天）。 */
export function recencyWeight(at: number, now: number): number {
  const days = Math.max(0, (now - at) / DAY_MS);
  return 0.5 ** (days / P.halfLifeDays);
}

/** 同一份作答（p；題庫練習與歷屆試題用 r 加作答時間）。 */
function paperKeyOf(e: Pick<OutcomeEntry, 'p' | 'r' | 'at'>): string {
  return e.p ?? `${e.r}|${e.at}`;
}

/** 同一份作答對同一個弱點的權重合計超過 4 時依比例縮小（診斷卷、焦點那一份除外）。 */
function capObs(obs: readonly Obs[]): Obs[] {
  const sums = new Map<string, number>();
  for (const o of obs) if (!o.uncapped) sums.set(o.paper, (sums.get(o.paper) ?? 0) + o.w * o.n);
  return obs.map((o) => {
    const sum = sums.get(o.paper) ?? 0;
    return !o.uncapped && sum > P.paperCap ? { ...o, w: (o.w * P.paperCap) / sum } : o;
  });
}

/** 殘差 Σw(x−y)／(Σw·n＋α)。 */
function residualOf(obs: readonly Obs[]): number {
  let num = 0;
  let den = 0;
  for (const o of obs) {
    num += o.w * (o.x - o.y);
    den += o.w * o.n;
  }
  return num / (den + P.alpha);
}

function basisOf(obs: readonly Obs[]): 'bank' | 'official' | 'mixed' {
  const official = obs.some((o) => o.official);
  const bank = obs.some((o) => !o.official);
  return official && bank ? 'mixed' : official ? 'official' : 'bank';
}

function summarize(obs: readonly Obs[]): { n: number; correct: number; wrong: number; rate: number | null; expected: number | null } {
  const n = obs.reduce((s, o) => s + o.n, 0);
  const correct = obs.reduce((s, o) => s + o.correct, 0);
  const wrong = obs.reduce((s, o) => s + (o.n - o.y), 0);
  const wsum = obs.reduce((s, o) => s + o.w * o.n, 0);
  const expected = wsum > 0 ? obs.reduce((s, o) => s + o.w * o.x, 0) / wsum : null;
  return { n, correct, wrong, rate: n > 0 ? correct / n : null, expected };
}

/** 最近 6 題答對 ≥ 5 題（依時間；不到 6 題不算）。 */
function isImproving(records: readonly Pick<OutcomeEntry, 'at' | 'ok'>[]): boolean {
  if (records.length < P.improvingWindow) return false;
  const recent = [...records].sort((a, b) => b.at - a.at).slice(0, P.improvingWindow);
  return recent.filter((e) => e.ok === 1).length >= P.improvingCorrect;
}

/** 合併同一個鍵的兩個權重：max ＋ 0.5 × min，上限 0.5。 */
export function mergeWeights(a: number, b: number): number {
  return Math.min(P.mergedMax, Math.max(a, b) + 0.5 * Math.min(a, b));
}

/** 報告的新舊係數（§5.4）：14 天內 1，之後線性降到 45 天的 0.5，60 天內 0.5，超過 60 天或之後又有 150 題首次作答時 0。 */
export function reportFactor(createdAtMs: number, now: number, firstAttemptsSince: number): number {
  if (firstAttemptsSince >= P.reportMaxNewFirst) return 0;
  const days = (now - createdAtMs) / DAY_MS;
  if (days > P.reportMaxDays) return 0;
  if (days <= P.reportFullDays) return 1;
  if (days >= P.reportHalfDays) return 0.5;
  return 1 - (0.5 * (days - P.reportFullDays)) / (P.reportHalfDays - P.reportFullDays);
}

/** 報告的優先序 → 權重（1 → 0.25、2 → 0.20、3 → 0.15、4–5 → 0.10）。 */
export function priorityWeight(priority: number): number {
  if (priority <= 1) return 0.25;
  if (priority === 2) return 0.2;
  if (priority === 3) return 0.15;
  return 0.1;
}

// ---------------------------------------------------------------------------
// 陷阱（和曝光量比）
// ---------------------------------------------------------------------------

export interface TrapStat {
  code: string;
  observed: number;
  expected: number;
  /** 時間加權的 O − E。 */
  weightedExcess: number;
  wrongs: number;
  /** 依大題的 O − E（陷阱目標的大題取比較多的那個）。 */
  bySection: Partial<Record<BankSectionType, number>>;
}

/**
 * 陷阱的觀察次數 O 與期望次數 E（§5.3）：最近 90 天、有 c 的答錯（題庫練習與自組卷的閱讀、混合題多選）。每一筆答錯 j，
 * 從技分布的 tr 取那一題錯誤選項的誘答組成：E_c ＝ Σⱼ（代碼 c 的錯誤選項數 ÷ 錯誤選項總數）、O_c ＝ 選到 c 的次數。
 * 查不到誘答組成的答錯（題組不在這一版的資料、歷屆題）不算進觀察也不算進期望。
 */
export function trapExcess(outcomes: readonly OutcomeEntry[], skills: PaperSkills, now: number): TrapStat[] {
  const since = now - P.trapDays * DAY_MS;
  const stats = new Map<string, TrapStat>();
  const stat = (code: string): TrapStat => {
    let s = stats.get(code);
    if (!s) {
      s = { code, observed: 0, expected: 0, weightedExcess: 0, wrongs: 0, bySection: {} };
      stats.set(code, s);
    }
    return s;
  };
  let wrongs = 0;
  for (const e of outcomes) {
    if (!e.c || e.ok === 1 || e.at < since || !(TRAP_SECTIONS as readonly string[]).includes(e.sec)) continue;
    const comp = trapCompositionOf(skills, e.r, e.l);
    if (!comp) continue;
    const total = Object.values(comp).reduce((s, n) => s + n, 0);
    if (total <= 0) continue;
    wrongs += 1;
    const w = recencyWeight(e.at, now);
    const sec = e.sec as BankSectionType;
    const codes = new Set([...Object.keys(comp), e.c]);
    for (const code of codes) {
      const p = (comp[code] ?? 0) / total;
      const hit = code === e.c ? 1 : 0;
      const s = stat(code);
      s.expected += p;
      s.observed += hit;
      s.weightedExcess += w * (hit - p);
      s.bySection[sec] = (s.bySection[sec] ?? 0) + hit - p;
    }
  }
  for (const s of stats.values()) s.wrongs = wrongs;
  return [...stats.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** 陷阱弱點的條件：O ≥ 1.5E 而且 O − E ≥ max(2, 1.5√E)。 */
export function isTrapWeakness(s: Pick<TrapStat, 'observed' | 'expected'>): boolean {
  return s.observed >= P.trapRatio * s.expected && s.observed - s.expected >= Math.max(P.trapMinExcess, P.trapSqrtFactor * Math.sqrt(s.expected));
}

// ---------------------------------------------------------------------------
// 主程式
// ---------------------------------------------------------------------------

interface Ctx {
  input: WeaknessInput;
  now: number;
  /** 最近 180 天、選擇與混合題的首次作答。 */
  recent: OutcomeEntry[];
  pct: number;
  focusPaper: string | null;
}

function expectedOfficial(e: OutcomeEntry, pct: number): number | null {
  if (e.g5 && e.g5.length === 5) {
    const r = peerRate(e.g5, pct);
    if (r !== null) return r;
  }
  return typeof e.np === 'number' ? e.np : null;
}

function isOfficial(e: OutcomeEntry): boolean {
  return e.s === 'exam' || e.s === 'mock';
}

function obsOf(ctx: Ctx, e: OutcomeEntry, y: number, x: number): Obs {
  const focus = ctx.focusPaper !== null && e.p === ctx.focusPaper;
  const diagnostic = e.p !== undefined && ctx.input.papers.get(e.p)?.diagnostic === true;
  return {
    paper: paperKeyOf(e),
    at: e.at,
    w: recencyWeight(e.at, ctx.now) * (focus ? P.focusPaperFactor : 1),
    n: 1,
    y,
    x,
    correct: e.ok === 1 ? 1 : 0,
    official: isOfficial(e),
    uncapped: focus || diagnostic,
  };
}

/** 技能弱點的 y：答對但標記過、用了提示或先看答案的算 0.5（「答對但不確定」）。 */
function skillY(e: OutcomeEntry): number {
  if (e.ok === 1 && (e.m === 1 || (e.h ?? 0) > 0 || e.rv === 1)) return 0.5;
  return e.ok;
}

interface LocalSection {
  section: BankSectionType;
  obs: Obs[];
  records: OutcomeEntry[];
  residual: number;
  n: number;
  wrong: number;
  qualifies: boolean;
}

function localSections(ctx: Ctx): Map<BankSectionType, LocalSection> {
  const out = new Map<BankSectionType, LocalSection>();
  const usedUids = new Set(ctx.recent.filter((e) => e.s === 'bank' || e.s === 'bank_mock').map((e) => e.r.split('@')[0] ?? ''));
  for (const section of MC_SECTIONS) {
    const records = ctx.recent.filter((e) => e.sec === section && isSectionEvidence(e, ctx.input.papers));
    const obs: Obs[] = [];
    for (const e of records) {
      const x = isOfficial(e) ? expectedOfficial(e, ctx.pct) : P.bankExpected;
      if (x === null) continue;
      obs.push(obsOf(ctx, e, e.ok, x));
    }
    // 作答紀錄上線前做的題庫練習：每組只有答對數，補進大題（沒有技能；每組是一份作答）。
    for (const [uid, d] of Object.entries(ctx.input.practiceDone ?? {})) {
      if (d.section !== section || usedUids.has(uid) || d.total <= 0) continue;
      const at = Date.parse(d.at);
      if (!Number.isFinite(at) || at < ctx.now - P.windowDays * DAY_MS) continue;
      const correct = Math.max(0, Math.min(d.correct, d.total));
      obs.push({ paper: `${uid}|${d.at}`, at, w: recencyWeight(at, ctx.now), n: d.total, y: correct, x: P.bankExpected * d.total, correct, official: false, uncapped: false });
    }
    const capped = capObs(obs);
    const sum = summarize(capped);
    const residual = residualOf(capped);
    const enoughN = SMALL_SECTIONS.has(section) ? sum.n >= P.smallSectionMinN && sum.wrong >= P.smallSectionMinWrong : sum.n >= P.sectionMinN;
    out.set(section, { section, obs: capped, records, residual, n: sum.n, wrong: sum.wrong, qualifies: enoughN && residual >= P.sectionMinResidual });
  }
  return out;
}

interface LocalSkill {
  section: BankSectionType;
  code: string;
  records: OutcomeEntry[];
  residual: number;
  n: number;
  obs: Obs[];
  qualifies: boolean;
}

/** 技能的基準 b(大題, 難度)（不含帶這個代碼的紀錄；剩不到 4 題時才算進去）。 */
function baseline(ctx: Ctx, section: BankSectionType, tier: Tier | undefined, code: string, evidence: readonly OutcomeEntry[]): number {
  const same = evidence.filter((e) => !isOfficial(e) && e.t === tier);
  const without = same.filter((e) => !canonicalSkills(section, e.k).includes(code as never));
  const pool = without.length >= P.skillMinN ? without : same;
  let num = P.alpha * P.bankExpected;
  let den = P.alpha;
  for (const e of pool) {
    const w = recencyWeight(e.at, ctx.now);
    num += w * skillY(e);
    den += w;
  }
  return num / den;
}

function localSkills(ctx: Ctx, sections: ReadonlyMap<BankSectionType, LocalSection>): LocalSkill[] {
  const out: LocalSkill[] = [];
  for (const section of MC_SECTIONS) {
    const all = ctx.recent.filter((e) => e.sec === section);
    const evidence = sections.get(section)?.records ?? [];
    const byCode = new Map<string, OutcomeEntry[]>();
    for (const e of all) for (const c of canonicalSkills(section, e.k)) byCode.set(c, [...(byCode.get(c) ?? []), e]);
    for (const [code, records] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
      const obs: Obs[] = [];
      for (const e of records) {
        const x = isOfficial(e) ? expectedOfficial(e, ctx.pct) : baseline(ctx, section, e.t, code, evidence);
        if (x === null) continue;
        obs.push(obsOf(ctx, e, skillY(e), x));
      }
      const capped = capObs(obs);
      const residual = residualOf(capped);
      const n = records.length;
      out.push({ section, code, records, residual, n, obs: capped, qualifies: n >= P.skillMinN && residual >= P.skillMinResidual });
    }
  }
  return out;
}

function newTarget(base: Pick<WeakTarget, 'key' | 'kind' | 'section' | 'code' | 'codes' | 'weight' | 'evidence'> & Partial<WeakTarget>): WeakTarget {
  return {
    from: [],
    improving: false,
    residual: null,
    reportPriority: null,
    contradicted: false,
    merged: [],
    errors: [],
    focusOnly: false,
    ...base,
  };
}

/** 一個技能代碼（原始或主代碼）的大題（§5.4）：本機首次作答最多的大題 → 技能分布的 codeSections（基準難度，沒有就全部）。 */
export function sectionOfCode(code: string, outcomes: readonly OutcomeEntry[], skills: PaperSkills | null, baseTier: Tier, prefer: readonly BankSectionType[] = []): BankSectionType | null {
  if (code.startsWith('ts:') || code.startsWith('tt:')) return 'translation';
  const counts: Partial<Record<BankSectionType, number>> = {};
  for (const e of outcomes) {
    if (e.first !== 1 || !isMc(e.sec)) continue;
    const primary = canonicalSkill(e.sec, code);
    if (canonicalSkills(e.sec, e.k).includes(primary as never)) counts[e.sec] = (counts[e.sec] ?? 0) + 1;
  }
  const order = [...prefer, ...MC_SECTIONS.filter((s) => !prefer.includes(s))];
  const local = topSection(counts, order);
  if (local) return local;
  if (!skills) return null;
  for (const tier of [baseTier, null] as const) {
    const fromData: Partial<Record<BankSectionType, number>> = {};
    for (const s of MC_SECTIONS) {
      const n = codeSectionCounts(skills, canonicalSkill(s, code), tier)[s];
      if (n) fromData[s] = n;
    }
    const top = topSection(fromData, order);
    if (top) return top;
  }
  return null;
}

/** 基準難度（§3.2）：學生選的 → 偏好的練習難度 → 報告的設定 → 題庫練習推得的 → 目標級分 → 穩定基礎。 */
function baseTierOf(input: WeaknessInput): { tier: Tier; basis: WeaknessProfile['baseTierBasis'] } {
  if (input.baseTier) return { tier: input.baseTier, basis: 'prefs' };
  if (input.prefs?.practiceTier) return { tier: input.prefs.practiceTier, basis: 'prefs' };
  const reportTier = input.report?.settings?.practice_tier;
  if (reportTier) return { tier: reportTier, basis: 'report' };
  const done = Object.values(input.practiceDone ?? {});
  if (done.length > 0) return { tier: practiceTierFrom(null, done), basis: 'practice' };
  if (typeof input.prefs?.targetLevel === 'number') return { tier: assistDefaultTier(input.prefs.targetLevel), basis: 'target' };
  return { tier: 'basic', basis: 'default' };
}

/** 依 §5 算出弱點（純函式）。 */
export function computeWeakness(input: WeaknessInput, now: number): WeaknessProfile {
  const since = now - P.windowDays * DAY_MS;
  const recent = input.outcomes.filter((e) => e.first === 1 && e.at >= since && isMc(e.sec));
  const reportLevel = input.report?.facts?.target.level ?? null;
  const pct = percentileOfLevel(input.prefs?.targetLevel ?? reportLevel ?? DEFAULT_TARGET_LEVEL);
  const focusPaper = input.focus?.paper ?? null;
  const ctx: Ctx = { input, now, recent, pct, focusPaper };
  const { tier: baseTier, basis: baseTierBasis } = baseTierOf(input);

  const sections = localSections(ctx);
  const skillStats = localSkills(ctx, sections);
  const candidates = new Map<string, WeakTarget>();

  // ── 本機：大題 ──
  for (const s of sections.values()) {
    if (!s.qualifies) continue;
    const sum = summarize(s.obs);
    const evidenceRecords = s.records;
    candidates.set(
      `sec:${s.section}`,
      newTarget({
        key: `sec:${s.section}`,
        kind: 'section',
        section: s.section,
        code: null,
        codes: [],
        weight: Math.min(P.sectionMaxWeight, s.residual),
        evidence: { n: s.n, rate: sum.rate, expected: sum.expected, basis: basisOf(s.obs) },
        from: ['local'],
        residual: s.residual,
        improving: isImproving(evidenceRecords),
      }),
    );
  }

  // ── 本機：技能（包含關係在取前 6 名時處理）──
  for (const k of skillStats) {
    if (!k.qualifies) continue;
    const sectionResidual = Math.max(0, sections.get(k.section)?.residual ?? 0);
    const sum = summarize(k.obs);
    const key = `skill:${k.section}:${k.code}`;
    candidates.set(
      key,
      newTarget({
        key,
        kind: 'skill',
        section: k.section,
        code: k.code,
        codes: [k.code],
        weight: Math.min(P.skillMaxWeight, k.residual * (1 + sectionResidual)),
        evidence: { n: k.n, rate: sum.rate, expected: sum.expected, basis: basisOf(k.obs) },
        from: ['local'],
        residual: k.residual,
        improving: isImproving(k.records),
      }),
    );
  }

  // ── 本機：陷阱 ──
  if (input.skills) {
    for (const t of trapExcess(input.outcomes, input.skills, now)) {
      if (!isTrapWeakness(t) || t.weightedExcess <= 0) continue;
      const section = (TRAP_SECTIONS as readonly BankSectionType[]).reduce((best, s) => ((t.bySection[s] ?? -Infinity) > (t.bySection[best] ?? -Infinity) ? s : best), 'reading' as BankSectionType);
      candidates.set(
        `trap:${t.code}`,
        newTarget({
          key: `trap:${t.code}`,
          kind: 'trap',
          section,
          code: t.code,
          codes: [],
          weight: Math.min(P.trapMaxWeight, P.trapUnit * t.weightedExcess),
          evidence: { observed: t.observed, expected: t.expected, wrongs: t.wrongs },
          from: ['local'],
        }),
      );
    }
  }

  // 改善減權（§5.5 第 4 點）。
  for (const t of candidates.values()) if (t.improving) t.weight *= 0.5;

  // ── 學習報告與案例（§5.4、§5.7）──
  const unhelped = new Set<AssistErrorCode>();
  const reportCreatedAt = input.report ? input.report.created_at * 1000 : null;
  const firstSinceReport = reportCreatedAt === null ? 0 : input.outcomes.filter((e) => e.first === 1 && e.at > reportCreatedAt).length;
  const factor = input.report && reportCreatedAt !== null && input.report.report ? reportFactor(reportCreatedAt, now, firstSinceReport) : 0;
  let reportUsable = false;

  const localSkillStat = (section: BankSectionType, code: string) => skillStats.find((k) => k.section === section && k.code === code) ?? null;
  const addSignal = (target: WeakTarget, weight: number, source: WeakSource) => {
    const existing = candidates.get(target.key);
    if (existing) {
      existing.weight = mergeWeights(existing.weight, weight);
      if (!existing.from.includes(source)) existing.from.push(source);
      if (target.reportPriority !== null) existing.reportPriority = Math.min(existing.reportPriority ?? 9, target.reportPriority);
      return existing;
    }
    candidates.set(target.key, { ...target, weight, from: [source] });
    return candidates.get(target.key) as WeakTarget;
  };

  /** 報告或案例說某個大題弱：本機反證（殘差 ≤ 0、≥ 8 題）時權重減半。 */
  const sectionSignal = (section: BankSectionType, weight: number, source: WeakSource, priority: number | null = null) => {
    const local = sections.get(section);
    const contradicted = !candidates.has(`sec:${section}`) && local !== undefined && local.residual <= 0 && local.n >= P.sectionMinN;
    const w = contradicted ? weight * 0.5 : weight;
    const sum = local ? summarize(local.obs) : null;
    const t = addSignal(
      newTarget({
        key: `sec:${section}`,
        kind: 'section',
        section,
        code: null,
        codes: [],
        weight: w,
        evidence: { n: local?.n ?? 0, rate: sum?.rate ?? null, expected: sum?.expected ?? null, basis: 'report' },
        residual: local?.residual ?? null,
        reportPriority: priority,
      }),
      w,
      source,
    );
    if (contradicted) t.contradicted = true;
  };

  const skillSignal = (rawCode: string, weight: number, source: WeakSource, priority: number | null = null) => {
    if (!isAssistSkillCode(rawCode) || rawCode.endsWith(':other')) return;
    const section = sectionOfCode(rawCode, input.outcomes, input.skills, baseTier);
    if (!section) return;
    const code = canonicalSkill(section, rawCode);
    const local = isMc(section) ? localSkillStat(section, code) : null;
    const contradicted = !candidates.has(`skill:${section}:${code}`) && local !== null && local.residual <= 0 && local.n >= P.sectionMinN;
    const w = contradicted ? weight * 0.5 : weight;
    const sum = local ? summarize(local.obs) : null;
    const t = addSignal(
      newTarget({
        key: `skill:${section}:${code}`,
        kind: 'skill',
        section,
        code,
        codes: [code],
        weight: w,
        evidence: { n: local?.n ?? 0, rate: sum?.rate ?? null, expected: sum?.expected ?? null, basis: 'report' },
        residual: local?.residual ?? null,
        reportPriority: priority,
      }),
      w,
      source,
    );
    if (contradicted) t.contradicted = true;
  };

  /** 錯因加成（§5.7 的 applyErrorSignal）。 */
  const errorSignal = (code: AssistErrorCode, s: number, source: WeakSource) => {
    const spec = ERROR_TARGETS[code];
    if (spec.none) {
      unhelped.add(code);
      return;
    }
    if (spec.sections) {
      for (const section of spec.sections) {
        sectionSignal(section, s, source);
        const t = candidates.get(`sec:${section}`);
        if (t && !t.errors.includes(code)) t.errors.push(code);
      }
      return;
    }
    // 1. 對到的特徵裡已經是本機弱點的：挑權重最高的那一個加上去。
    const matchesSkill = (t: WeakTarget) => t.kind === 'skill' && t.code !== null && spec.codes.some((c) => canonicalSkill(t.section, c) === t.code);
    const matchesTrap = (t: WeakTarget) => t.kind === 'trap' && t.code !== null && spec.traps.includes(t.code);
    const existing = [...candidates.values()]
      .filter((t) => t.from.includes('local') && (matchesSkill(t) || matchesTrap(t)))
      .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))[0];
    if (existing) {
      existing.weight = mergeWeights(existing.weight, s);
      if (!existing.from.includes(source)) existing.from.push(source);
      if (!existing.errors.includes(code)) existing.errors.push(code);
      return;
    }
    // 2. 本機有證據（同大題 ≥ 4 題）、殘差 > 0 的：挑殘差最大的建一個技能目標。
    const evidenced = skillStats
      .filter((k) => k.n >= P.skillMinN && k.residual > 0 && spec.codes.some((c) => canonicalSkill(k.section, c) === k.code))
      .sort((a, b) => b.residual - a.residual || a.code.localeCompare(b.code))[0];
    if (evidenced) {
      const sum = summarize(evidenced.obs);
      const t = addSignal(
        newTarget({
          key: `skill:${evidenced.section}:${evidenced.code}`,
          kind: 'skill',
          section: evidenced.section,
          code: evidenced.code,
          codes: [evidenced.code],
          weight: s,
          evidence: { n: evidenced.n, rate: sum.rate, expected: sum.expected, basis: basisOf(evidenced.obs) },
          residual: evidenced.residual,
        }),
        s,
        source,
      );
      if (!t.errors.includes(code)) t.errors.push(code);
      return;
    }
    // 3. 都沒有本機證據：錯因群組（命中＝題目帶有任何一個對到的代碼）。
    let section = spec.section;
    if (!section) {
      const counts: Partial<Record<BankSectionType, number>> = {};
      for (const e of recent) if (spec.codes.some((c) => canonicalSkills(e.sec, e.k).includes(canonicalSkill(e.sec, c) as never))) counts[e.sec as BankSectionType] = (counts[e.sec as BankSectionType] ?? 0) + 1;
      section = topSection(counts, MC_SECTIONS) ?? spec.fallbackSection ?? 'reading';
    }
    const codes = [...new Set([...spec.codes.map((c) => canonicalSkill(section as string, c)), ...spec.traps])];
    const t = addSignal(newTarget({ key: `err:${code}`, kind: 'error', section, code, codes, weight: s, evidence: { n: 0, rate: null, expected: null, basis: 'report' } }), s, source);
    if (!t.errors.includes(code)) t.errors.push(code);
  };

  const detail = input.report;
  const body = detail?.report ?? null;
  if (body && factor > 0) {
    for (const wk of body.weaknesses) {
      const w = priorityWeight(wk.priority) * factor;
      if (isBankSection(wk.area)) sectionSignal(wk.area, w, 'report', wk.priority);
      else skillSignal(wk.area, w, 'report', wk.priority);
      reportUsable = true;
    }
    // score_plan 第 1、2 優先的大題：直接加 0.10（§5.4），不走 max ＋ 0.5 × min 的合併（那樣只加得到 0.05）。
    const planned = new Set<BankSectionType>();
    for (const plan of body.score_plan) {
      if (plan.priority > 2 || !isBankSection(plan.section) || planned.has(plan.section)) continue;
      planned.add(plan.section);
      const bonus = P.scorePlanBonus * factor;
      const existing = candidates.get(`sec:${plan.section}`);
      if (existing) {
        existing.weight = Math.min(P.mergedMax, existing.weight + bonus);
        if (!existing.from.includes('report')) existing.from.push('report');
      } else sectionSignal(plan.section, bonus, 'report');
    }
    const facts = detail?.facts ?? null;
    for (const s of facts?.sections ?? []) {
      if ((s.section === 'translation' && (s.gain ?? 0) >= 1) || (s.section === 'composition' && (s.gain ?? 0) >= 2)) {
        sectionSignal(s.section, Math.min(P.writingSectionMax, ((s.gain ?? 0) / ASSIST_SECTION_POINTS[s.section]) * 2) * factor, 'report');
      }
    }
    for (const code of facts?.writing.weak_codes ?? []) skillSignal(code, P.writingCodeWeight * factor, 'report');
  }

  // 錯因：報告文字（每個 0.10，只算一次）＋案例次數（≥ 2 次時 0.05 × 次數，最多 0.20），合計最多 0.25。
  const errorWeights = new Map<AssistErrorCode, { w: number; source: WeakSource }>();
  if (body && factor > 0) {
    const textCodes = new Set<string>([...body.weaknesses.flatMap((w) => w.error_codes), ...body.error_patterns.map((p) => p.code)]);
    for (const c of textCodes) if (isAssistErrorCode(c)) errorWeights.set(c, { w: P.reportErrorSignal * factor, source: 'report' });
  }
  const counts = new Map<string, number>();
  for (const e of detail && factor > 0 ? (detail.facts?.errors ?? []) : []) counts.set(e.code, Math.max(counts.get(e.code) ?? 0, e.n));
  for (const [code, n] of Object.entries(input.cases?.errorCounts ?? {})) counts.set(code, Math.max(counts.get(code) ?? 0, n));
  for (const [code, n] of counts) {
    if (!isAssistErrorCode(code) || n < P.caseErrorMinCount) continue;
    const prev = errorWeights.get(code);
    errorWeights.set(code, { w: Math.min(P.errorSignalMax, (prev?.w ?? 0) + Math.min(P.caseErrorMax, P.caseErrorUnit * n)), source: prev?.source ?? 'cases' });
  }
  for (const code of ASSIST_ERROR_CODES) {
    const e = errorWeights.get(code);
    if (e) errorSignal(code, e.w, e.source);
  }

  // 「不懂」的案例的技能：每個 0.05，最多 0.15。
  const notUnderstood = new Map<string, number>();
  for (const codes of input.cases?.notUnderstoodSkills ?? []) for (const c of new Set(codes)) notUnderstood.set(c, (notUnderstood.get(c) ?? 0) + 1);
  for (const [code, n] of [...notUnderstood].sort(([a], [b]) => a.localeCompare(b))) skillSignal(code, Math.min(P.notUnderstoodMax, P.notUnderstoodUnit * n), 'cases');

  // ── 焦點（§5.5）──
  const focus = input.focus ?? null;
  const focusKeys = new Set<string>();
  if (focus) {
    for (const section of focus.sections) {
      const key = `sec:${section}`;
      focusKeys.add(key);
      const existing = candidates.get(key);
      if (existing) {
        existing.weight = Math.max(existing.weight, P.focusMinWeight);
        if (!existing.from.includes('focus')) existing.from.push('focus');
      } else {
        const local = sections.get(section);
        const sum = local ? summarize(local.obs) : null;
        candidates.set(
          key,
          newTarget({
            key,
            kind: 'section',
            section,
            code: null,
            codes: [],
            weight: P.focusMinWeight,
            evidence: { n: local?.n ?? 0, rate: sum?.rate ?? null, expected: sum?.expected ?? null, basis: local ? basisOf(local.obs) : 'bank' },
            from: ['focus'],
            residual: local?.residual ?? null,
            focusOnly: true,
          }),
        );
      }
    }
    for (const raw of focus.skills) {
      const section = sectionOfCode(raw, input.outcomes, input.skills, baseTier, focus.sections);
      if (!section) continue;
      const code = canonicalSkill(section, raw);
      const key = `skill:${section}:${code}`;
      focusKeys.add(key);
      const existing = candidates.get(key);
      if (existing) {
        existing.weight = Math.max(existing.weight, P.focusMinWeight);
        if (!existing.from.includes('focus')) existing.from.push('focus');
      } else {
        const local = isMc(section) ? localSkillStat(section, code) : null;
        const sum = local ? summarize(local.obs) : null;
        candidates.set(
          key,
          newTarget({
            key,
            kind: 'skill',
            section,
            code,
            codes: [code],
            weight: P.focusMinWeight,
            evidence: { n: local?.n ?? 0, rate: sum?.rate ?? null, expected: sum?.expected ?? null, basis: local ? basisOf(local.obs) : 'bank' },
            from: ['focus'],
            residual: local?.residual ?? null,
            focusOnly: true,
          }),
        );
      }
    }
  }

  // ── 取前 6 名 ──
  const focusSections = new Set(focus?.sections ?? []);
  const nOf = (t: WeakTarget) => ('n' in t.evidence ? t.evidence.n : t.evidence.wrongs);
  const ranked = [...candidates.values()]
    .filter((t) => t.weight > 0)
    .filter((t) => !focus || focusKeys.has(t.key) || focusSections.size === 0 || focusSections.has(t.section))
    .sort((a, b) => b.weight - a.weight || nOf(b) - nOf(a) || a.key.localeCompare(b.key));
  const chosen: WeakTarget[] = ranked.filter((t) => focusKeys.has(t.key)).slice(0, P.maxTargets);
  const recordsOf = (t: WeakTarget) => (t.kind === 'skill' && t.code !== null && isMc(t.section) ? (localSkillStat(t.section, t.code)?.records ?? []) : []);
  for (const t of ranked) {
    if (chosen.length >= P.maxTargets) break;
    if (chosen.includes(t)) continue;
    // 包含關係：這個技能 ≥ 80% 的題同時帶著排名更前面、同大題的另一個技能弱點時不另列。
    if (t.kind === 'skill' && t.code !== null) {
      const mine = recordsOf(t);
      const parent = chosen.find((c) => {
        if (c.kind !== 'skill' || c.section !== t.section || c.code === null || mine.length === 0) return false;
        const overlap = mine.filter((e) => canonicalSkills(t.section, e.k).includes(c.code as never)).length;
        return overlap / mine.length >= P.containment;
      });
      if (parent) {
        parent.merged.push(t.code);
        continue;
      }
    }
    chosen.push(t);
  }
  const targets = chosen.sort((a, b) => b.weight - a.weight || nOf(b) - nOf(a) || a.key.localeCompare(b.key));

  // ── 最少資料、整體偏難、保持手感、資料不夠的大題 ──
  const evidenceFirst = recent.filter((e) => isSectionEvidence(e, input.papers));
  const enough = evidenceFirst.length >= P.minFirstAttempts || reportUsable;
  const baseRecords = evidenceFirst.filter((e) => !isOfficial(e) && e.t === baseTier);
  const sectionTargets = [...candidates.values()].filter((t) => t.kind === 'section' && t.from.includes('local')).length;
  const baseRate = baseRecords.length > 0 ? baseRecords.filter((e) => e.ok === 1).length / baseRecords.length : 1;
  const tooHard = baseRecords.length >= P.tooHardMinN && baseRate <= P.tooHardMaxRate && sectionTargets >= P.tooHardMinSections ? { rate: baseRate, n: baseRecords.length } : null;

  const targetSections = new Set(targets.map((t) => t.section));
  let maintenance: WeaknessProfile['maintenance'] = null;
  for (const section of MAINTENANCE_SECTIONS) {
    const s = sections.get(section);
    if (!s || targetSections.has(section) || s.n < P.maintenanceMinN || s.residual > 0) continue;
    // 最後一次練：作答紀錄與作答紀錄上線前的題庫練習（practiceDone）一起看；都沒有可用的時間就不選這個大題。
    const practiceAts = Object.values(input.practiceDone ?? {})
      .filter((d) => d.section === section)
      .map((d) => Date.parse(d.at));
    const last = Math.max(...input.outcomes.filter((e) => e.sec === section).map((e) => e.at), ...practiceAts.filter(Number.isFinite));
    if (!Number.isFinite(last)) continue;
    const daysSince = Math.floor((now - last) / DAY_MS);
    if (daysSince < P.maintenanceIdleDays) continue;
    const sum = summarize(s.obs);
    if (!maintenance || daysSince > maintenance.daysSince) maintenance = { section, rate: sum.rate ?? 0, daysSince };
  }

  const gaps = ALL_SECTIONS.filter((s) => {
    if (isMc(s)) return (sections.get(s)?.n ?? 0) === 0;
    return !targets.some((t) => t.section === s) && !(detail?.facts?.sections ?? []).some((f) => f.section === s && f.current !== null);
  });

  const earliest = recent.length > 0 ? Math.min(...recent.map((e) => e.at)) : now;
  const reportPins =
    body && factor > 0
      ? body.recommendations
          .map((r) => r.ref.split('@')[0] ?? '')
          .filter((uid) => /^(ai|pb)\.(vo|cz|wb|st|rd|mx)\.[0-9a-f]{6}$/.test(uid))
          .slice(0, 2)
      : [];

  return {
    targets,
    maintenance,
    baseTier,
    baseTierBasis,
    enough,
    noWeakness: enough && targets.length === 0,
    tooHard,
    gaps,
    coverage: {
      firstAttempts: evidenceFirst.length,
      days: recent.length > 0 ? Math.min(P.windowDays, Math.max(1, Math.ceil((now - earliest) / DAY_MS))) : 0,
      trapDays: 90,
      report: detail && reportCreatedAt !== null ? { version: detail.version, createdAt: reportCreatedAt, used: factor > 0 } : null,
    },
    unhelpedErrors: ASSIST_ERROR_CODES.filter((c) => unhelped.has(c)),
    reportPins,
  };
}

// ---------------------------------------------------------------------------
// 其他給組卷用的資料
// ---------------------------------------------------------------------------

/** 這台裝置錯過的題組（重做用，§6.3 第 4 步的第 2 層）：uid → 最後一次答錯的時間、每一題答錯的題的主代碼。 */
export function wrongGroupsFrom(outcomes: readonly OutcomeEntry[]): Map<string, { at: number; questions: string[][] }> {
  const out = new Map<string, { at: number; questions: string[][] }>();
  for (const e of outcomes) {
    if ((e.s !== 'bank' && e.s !== 'bank_mock') || e.ok === 1) continue;
    const uid = e.r.split('@')[0] ?? '';
    if (!uid) continue;
    const row = out.get(uid) ?? { at: 0, questions: [] };
    row.at = Math.max(row.at, e.at);
    row.questions.push(canonicalSkills(e.sec, e.k));
    out.set(uid, row);
  }
  return out;
}

/** 首次作答的難度分布（畫面的「自動：進階練習（依你的練習紀錄）」用）。 */
export function tierCounts(outcomes: readonly OutcomeEntry[]): Record<Tier, number> {
  const out = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const e of outcomes) if (e.first === 1 && e.t) out[e.t] += 1;
  return out;
}
