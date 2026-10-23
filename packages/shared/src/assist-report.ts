/**
 * 學習報告的型別、計畫骨架與前後端共用的純函式（docs/design/learning-assistant.md §3、§4.2）。負責：WP-C。
 *
 * 分工（§3.2「數字一律由程式算」）：
 *   - facts（apps/api/src/assist/facts.ts）：目標、目前表現、可爭取分數、距離目標、技能、錯因、模考、寫作、單字、和上一版的差異。
 *     畫面上的每一個數字都直接讀 facts，不讀 AI 的文字。
 *   - planSkeleton（這裡）：週次、階段、模考與段考的錨點、單字暫停週、每週預算；前端的產生面板與 Worker 共用。
 *   - 每週份量（apps/api/src/assist/plan.ts）：依骨架、AI 給每個階段的 routine（項目與權重）與方法庫的每組用時排好，
 *     和 AI 的輸出一起存進 report_json.plan。
 *   - AI 只寫分析、重點與計畫的項目組合（AssistReportBody 的 _zh 欄位與代碼），不寫任何數字以外的預測。
 * 和 assist.ts 分開成一個檔（同樣由 index.ts 直接轉匯出）：只有報告頁、產生面板與 Worker 的報告分支用到。
 */
import type { AssistErrorCode } from './assist-codes';
import type { AssistMethodSection, AssistPlanKind } from './assist-methods';
import type { AssistNotice, AssistPracticeCandidate, AssistSafetyFlag, AssistSection, AssistStandard, AssistWeekly } from './assist';
import type { Tier } from './tiers';
import type { AiRefundReason } from './writing';

// ───────────────────────── 目標、時間與大題 ─────────────────────────

/** 報告的八個大題（六個選擇題大題＋中譯英、作文）；順序就是畫面與提示列出的順序。 */
export const ASSIST_REPORT_SECTIONS = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition'] as const satisfies readonly AssistSection[];
export type AssistReportSection = (typeof ASSIST_REPORT_SECTIONS)[number];
/** 選擇題大題（混合題以多選題代表）。 */
export const ASSIST_MC_SECTIONS = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const satisfies readonly AssistReportSection[];
export type AssistMcSection = (typeof ASSIST_MC_SECTIONS)[number];

/** 現制（115 年格式）各大題的配分；合計 100。 */
export const ASSIST_SECTION_POINTS: Readonly<Record<AssistReportSection, number>> = {
  vocabulary: 10,
  cloze: 10,
  word_bank: 10,
  structure: 8,
  reading: 24,
  mixed: 10,
  translation: 8,
  composition: 20,
};

/**
 * 五標的級分（115 學測英文，§8 第 15 點：取最近一年；111 年前標是 12）。Worker 建置時產生的目標資料
 * （assist-targets.json 的 standards）有同一組數字，test/assist.targets.test.ts 檢查兩者一致。
 */
export const ASSIST_STANDARD_LEVELS = { year: 115, top: 13, front: 11, mean: 8 } as const;

export const ASSIST_STANDARD_LABELS: Record<AssistStandard, string> = { top: '頂標', front: '前標', mean: '均標' };

/** 目標 → 級分。 */
export function assistTargetLevel(target: { standard: AssistStandard } | { level: number }): number {
  return 'standard' in target ? ASSIST_STANDARD_LEVELS[target.standard] : Math.min(15, Math.max(1, Math.round(target.level)));
}

/** 目標的文字（「前標（11 級分）」「12 級分」）。 */
export function assistTargetLabel(target: { standard: AssistStandard } | { level: number }): string {
  return 'standard' in target ? `${ASSIST_STANDARD_LABELS[target.standard]}（${assistTargetLevel(target)} 級分）` : `${assistTargetLevel(target)} 級分`;
}

/** 每週可以用在英文的時間 → 每週預算（分鐘；設計值，§3.2.6）。 */
export const ASSIST_WEEKLY_MINUTES: Readonly<Record<AssistWeekly, number>> = { le2: 100, '2to4': 180, '4to6': 300, '6plus': 420 };
export const ASSIST_WEEKLY_LABELS: Record<AssistWeekly, string> = { le2: '2 小時以內', '2to4': '2–4 小時', '4to6': '4–6 小時', '6plus': '6 小時以上' };

/** 沒選練習難度時依目標推（均標以下 → 穩定基礎、前標 → 進階練習、頂標以上 → 超越頂標；§1.8）。 */
export function assistDefaultTier(level: number): Tier {
  if (level >= ASSIST_STANDARD_LEVELS.top) return 'top';
  if (level >= ASSIST_STANDARD_LEVELS.front) return 'advanced';
  return 'basic';
}

// ───────────────────────── 日期（台灣時間的日曆日） ─────────────────────────

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → 那一天 UTC 00:00 的毫秒；不是合法的日期回 null。 */
export function parseIsoDate(date: string): number | null {
  if (!ISO_DATE_PATTERN.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? ms : null;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 日期加減天數（輸入必須是合法的 'YYYY-MM-DD'）。 */
export function addDays(date: string, days: number): string {
  const ms = parseIsoDate(date);
  if (ms === null) throw new Error(`日期格式不對：${date}`);
  return isoOf(ms + days * 86_400_000);
}

/** b − a 的天數。 */
export function daysBetween(a: string, b: string): number {
  const x = parseIsoDate(a);
  const y = parseIsoDate(b);
  if (x === null || y === null) throw new Error(`日期格式不對：${a}、${b}`);
  return Math.round((y - x) / 86_400_000);
}

/** 台灣時間的今天（'YYYY-MM-DD'）。 */
export function taiwanToday(nowMs: number = Date.now()): string {
  return isoOf(nowMs + 8 * 3_600_000);
}

// ───────────────────────── 計畫骨架（§3.2.6） ─────────────────────────

export const ASSIST_PHASE_IDS = ['foundation', 'strengthen', 'mock_sprint', 'final'] as const;
export type AssistPhaseId = (typeof ASSIST_PHASE_IDS)[number];
export const ASSIST_PHASE_LABELS: Record<AssistPhaseId, string> = {
  foundation: '基礎補強',
  strengthen: '題型強化',
  mock_sprint: '模考衝刺',
  final: '考前調整',
};

/** 骨架最多排幾週；更早的週歸成「長期」（每週同一份基礎菜單）。 */
export const ASSIST_PLAN_MAX_WEEKS = 16;
/** 一份模擬考（作答 100＋檢討 30 分鐘）。 */
export const ASSIST_MOCK_MINUTES = 130;
/** 考試日前幾天起暫停新單字（SPEC §6.1）。 */
export const ASSIST_VOCAB_PAUSE_DAYS = 21;
/**
 * 考前只複習、時間減半的天數（考試前最後 4 天；SPEC §6.11「考前一天不做新卷」的延伸）。考前調整週裡這幾天之前的日子照每週的
 * 時間算（併進最後一週的零頭天數也算），可以計時做單一大題，只是不排整份模考。
 */
export const ASSIST_FINAL_TAPER_DAYS = 4;

export interface AssistSkeletonWeek {
  week: number;
  /** 這一週的第一天與最後一天（最後一週到考試日前一天）。 */
  start: string;
  end: string;
  days: number;
  phase: AssistPhaseId;
  /** 這一週排一份模擬考（錨點）。 */
  mock: boolean;
  /** 這份模考是從段考週移過來的。 */
  mock_moved: 'later' | 'earlier' | null;
  /** 模考撞到段考週、前後都移不動：保留模考，其他份量減半。 */
  mock_conflict: boolean;
  school_exam: boolean;
  final: boolean;
  /** 考試日前 21 天所在的週起暫停新單字。 */
  vocab_paused: boolean;
  /** 這一週的時間預算（分鐘，含模考）：段考週減半；考前調整週依天數算，最後 ASSIST_FINAL_TAPER_DAYS 天減半。 */
  budget: number;
}

export interface AssistPlanSkeleton {
  today: string;
  exam_date: string;
  /** 今天到考試日前一天的天數。 */
  days: number;
  /** 總週數 W（最後不滿 7 天併入最後一週）。 */
  total_weeks: number;
  weekly: AssistWeekly;
  weekly_minutes: number;
  /** 各階段的週次（不排空的階段）。 */
  phases: Array<{ id: AssistPhaseId; from: number; to: number }>;
  /** 超過 16 週時，第 1 週到第 W−16 週歸成長期（每週基礎菜單）；否則 null。 */
  long_term: { from: number; to: number; start: string; end: string } | null;
  /** 排出來的週（最後 ≤ 16 週，週次照總週數編號）。 */
  weeks: AssistSkeletonWeek[];
  mock_weeks: number[];
  school_exam_weeks: number[];
  vocab_pause_week: number | null;
}

export interface PlanSkeletonOptions {
  weekly: AssistWeekly;
  /** 段考日期（≤ 4 個；在今天到考試日之間的才算）。 */
  school_exam_dates?: readonly string[];
}

/** 階段的週次（依總週數 W）。 */
function phasesOf(W: number): Array<{ id: AssistPhaseId; from: number; to: number }> {
  const out: Array<{ id: AssistPhaseId; from: number; to: number }> = [];
  const push = (id: AssistPhaseId, from: number, to: number) => {
    if (from <= to) out.push({ id, from, to });
  };
  if (W >= 10) {
    const f = Math.floor(0.4 * W);
    push('foundation', 1, f);
    push('strengthen', f + 1, W - 4);
  } else if (W >= 5) {
    push('strengthen', 1, W - 4);
  }
  push('mock_sprint', Math.max(1, W - 3), W - 1);
  push('final', W, W);
  return out;
}

/**
 * 模考錨點：第 W−7、W−5、W−3、W−2、W−1 週（小於 1 的不排）。落在段考週時往後移一週；往後會撞到考前調整週、另一份模考或
 * 另一個段考週時改往前移；兩邊都不行就保留，並把那週的其他份量減半（mock_conflict）。依週次由小到大處理。
 */
function mockAnchors(W: number, school: ReadonlySet<number>): { weeks: Set<number>; moved: Map<number, 'later' | 'earlier'>; conflict: Set<number> } {
  const weeks = new Set([W - 7, W - 5, W - 3, W - 2, W - 1].filter((w) => w >= 1));
  const moved = new Map<number, 'later' | 'earlier'>();
  const conflict = new Set<number>();
  for (const w of [...weeks].sort((a, b) => a - b)) {
    if (!school.has(w)) continue;
    const free = (x: number) => x >= 1 && x < W && !weeks.has(x) && !school.has(x);
    if (free(w + 1)) {
      weeks.delete(w);
      weeks.add(w + 1);
      moved.set(w + 1, 'later');
    } else if (free(w - 1)) {
      weeks.delete(w);
      weeks.add(w - 1);
      moved.set(w - 1, 'earlier');
    } else {
      conflict.add(w);
    }
  }
  return { weeks, moved, conflict };
}

/**
 * 計畫骨架（§3.2.6）：從今天到考試日切成週（今天是第 1 週的第一天，最後不滿 7 天併入最後一週）；超過 16 週時只排最後 16 週。
 * 階段依總週數 W：W ≥ 10 基礎補強（1 到 ⌊0.4W⌋）→ 題型強化 → 模考衝刺（W−3 到 W−1）→ 考前調整（W）；5 ≤ W < 10 沒有基礎補強；
 * W < 5 只有模考衝刺與考前調整。考前調整週不排模考。每週預算依每週可用時間，段考週減半；考前調整週依它的天數（7–13 天）
 * 照比例算，只有最後 ASSIST_FINAL_TAPER_DAYS 天減半（不然併進零頭的考前調整週會有將近兩週只剩一半的時間）。
 * 考試日不在今天之後（已經過了或就是今天）時回 null（沒有骨架）。日期格式不對時丟錯。
 */
export function planSkeleton(todayTw: string, examDate: string, options: PlanSkeletonOptions): AssistPlanSkeleton | null {
  const days = daysBetween(todayTw, examDate);
  if (days <= 0) return null;
  const W = Math.max(1, Math.floor(days / 7));
  const weekOf = (date: string): number => Math.min(W, Math.floor(daysBetween(todayTw, date) / 7) + 1);
  const schoolWeeks = new Set<number>();
  for (const d of options.school_exam_dates ?? []) {
    if (parseIsoDate(d) === null) continue;
    const offset = daysBetween(todayTw, d);
    if (offset < 0 || offset >= days) continue;
    schoolWeeks.add(weekOf(d));
  }
  const phases = phasesOf(W);
  const { weeks: mocks, moved, conflict } = mockAnchors(W, schoolWeeks);
  const pauseDate = addDays(examDate, -ASSIST_VOCAB_PAUSE_DAYS);
  const pauseWeek = daysBetween(todayTw, pauseDate) < 0 ? 1 : weekOf(pauseDate);
  const weekly = ASSIST_WEEKLY_MINUTES[options.weekly];
  const first = Math.max(1, W - ASSIST_PLAN_MAX_WEEKS + 1);
  const weeks: AssistSkeletonWeek[] = [];
  for (let w = first; w <= W; w += 1) {
    const start = addDays(todayTw, 7 * (w - 1));
    const end = w === W ? addDays(examDate, -1) : addDays(start, 6);
    const school = schoolWeeks.has(w);
    const final = w === W;
    const length = daysBetween(start, end) + 1;
    const taper = Math.min(length, ASSIST_FINAL_TAPER_DAYS);
    const base = final ? Math.floor((weekly * (length - taper / 2)) / 7) : weekly;
    weeks.push({
      week: w,
      start,
      end,
      days: length,
      phase: phases.find((p) => w >= p.from && w <= p.to)?.id ?? 'final',
      mock: mocks.has(w),
      mock_moved: moved.get(w) ?? null,
      mock_conflict: conflict.has(w),
      school_exam: school,
      final,
      vocab_paused: w >= pauseWeek,
      budget: school ? Math.floor(base / 2) : base,
    });
  }
  return {
    today: todayTw,
    exam_date: examDate,
    days,
    total_weeks: W,
    weekly: options.weekly,
    weekly_minutes: weekly,
    phases,
    long_term: first > 1 ? { from: 1, to: first - 1, start: todayTw, end: addDays(todayTw, 7 * (first - 1) - 1) } : null,
    weeks,
    mock_weeks: [...mocks].sort((a, b) => a - b),
    school_exam_weeks: [...schoolWeeks].sort((a, b) => a - b),
    vocab_pause_week: pauseWeek,
  };
}

// ───────────────────────── facts（§3.2；Worker 算、存在報告的 input_json，畫面直接讀） ─────────────────────────

/** 一個選擇題大題在題庫的難度加權答對率。note：沒有超越頂標的作答（可能偏高）／只有超越頂標（可能偏低）。 */
export interface AssistBankRate {
  rate: number;
  n: number;
  tiers: Array<{ tier: Tier; n: number; rate: number }>;
  note: 'no_top' | 'only_top' | null;
}

export interface AssistSectionFacts {
  section: AssistReportSection;
  points: number;
  /** 歷屆與真題模考的首次接觸答對率（有作答才有；≥ 20 題才採用為目前表現）。 */
  official: { n: number; correct: number; rate: number } | null;
  /** 題庫（題庫練習與自組卷合併）依難度加權的答對率（每個難度 ≥ 5 題才算）。 */
  bank: AssistBankRate | null;
  /** 中譯英、作文：最近 3 份 AI 批改的平均（不含自訂題），或最近一份模考的自評。 */
  writing: { n: number; avg: number; basis: 'ai_grading' | 'self' } | null;
  /** 目前表現：選擇題是 0–1 的答對率；中譯英、作文是分數。null＝還沒有資料。 */
  current: number | null;
  basis: 'official' | 'bank' | 'ai_grading' | 'self' | 'none';
  /** 目標：選擇題是 0–1 的答對率；中譯英、作文是分數。 */
  target: number;
  /** 目標在前 10%（或前 12%）以內：取最高一組的平均，作為下限。 */
  target_floor: boolean;
  /** 可爭取分數（0.5 的倍數；沒有資料是 null）。 */
  gain: number | null;
  /** 全國平均：選擇題是 111–115 學測的平均答對率；中譯英、作文是平均分數。 */
  national: number | null;
}

export interface AssistSkillFact {
  code: string;
  n: number;
  correct: number;
  rate: number;
}

export interface AssistMockFact {
  kind: 'exam' | 'bank';
  paper: string;
  at: string;
  raw: number;
  max: number;
  /** 真題卷的非官方級分（自組卷不換算，null）。 */
  level: number | null;
  scale_year: number | null;
  /** 開考前自己預估的原始分數（0–100；只有真題卷）。 */
  predicted: number | null;
  /** 非選擇題用的是自評。 */
  self_scored: boolean;
  sections: Array<{ section: AssistSection; rate: number; time_sec: number; suggested_sec: number }>;
}

export interface AssistReportDiff {
  previous_id: string;
  previous_version: number;
  since: string;
  sections: Array<{ section: AssistReportSection; before: number | null; after: number | null }>;
  errors: Array<{ code: string; before: number; after: number }>;
  weak_added: string[];
  weak_removed: string[];
  /** 上一版每一項推薦：之後有沒有做、第一次作答的答對率（只收上一版真的推薦過的 ref）。 */
  followed: Array<{ ref: string; title: string; attempted: boolean; first_n: number; first_correct: number }>;
  /** 逐週清單的勾選完成數（依項目種類）。 */
  checklist: Array<{ kind: AssistPlanKind; done: number; total: number }>;
}

export const ASSIST_DATA_LEVELS = ['little', 'some', 'enough'] as const;
export type AssistDataLevel = (typeof ASSIST_DATA_LEVELS)[number];

/** 資料不足的項目（AI 被要求把它排進建議）。 */
export const ASSIST_DATA_GAPS = ['official', 'bank', 'mock', 'translation', 'composition', 'vocab', 'cases'] as const;
export type AssistDataGap = (typeof ASSIST_DATA_GAPS)[number];

export interface AssistReportFacts {
  v: 1;
  today: string;
  exam_date: string;
  target: { level: number; standard: AssistStandard | null; top_pct: number };
  /** 五標的級分（建置時的目標資料；最近一年）。 */
  standards: { year: number; top: number; front: number; mean: number; back: number; floor: number };
  sections: AssistSectionFacts[];
  /** 各大題可爭取分數合計（有資料的大題）。 */
  gain_total: number;
  /** 距離目標：最近一份真題模考的原始總分，對照那份模考的對照年度上目標級分的下限。 */
  distance: { raw: number; max: number; scale_year: number; level: number; lower: number; short: number; self_scored: boolean; at: string } | null;
  /** 程式產生的「距離目標」句子（畫面與提示共用）。 */
  distance_lines: string[];
  skills: { weak: AssistSkillFact[]; strong: AssistSkillFact[] };
  /** 案例的錯因次數（伺服器彙整）。 */
  errors: Array<{ code: string; n: number }>;
  /** 本機摘要的陷阱代碼次數。 */
  traps: Array<{ code: string; n: number }>;
  /** 案例的「懂了嗎」分布。 */
  understood: { yes: number; partly: number; no: number; unset: number };
  cases: number;
  mocks: AssistMockFact[];
  writing: {
    translation: { n: number; avg: number; max: number } | null;
    essay: { n: number; avg: number; max: number; criteria: Record<'content' | 'organization' | 'grammar' | 'vocabulary', number> | null } | null;
    categories: Array<{ category: string; n: number }>;
    weak_codes: string[];
  };
  vocab: { mistakes: number; by_level: Record<string, number>; top_words: string[]; srs: { cards: number; due: number; lapses_ge3: number } | null };
  behaviour: { marked: number; revealed: number; fast_wrong: number | null };
  data_level: AssistDataLevel;
  data_gaps: AssistDataGap[];
  coverage: { outcomes: number; first_at: string | null; range_days: number };
  /** AI 的文字可以提到的級分（目標、五標、模考的非官方級分）：其他級分數字一律當成預測拿掉（§4.11 第 9 步）。 */
  levels: number[];
  diff: AssistReportDiff | null;
}

// ───────────────────────── 報告內容（AI 的輸出經過程式後處理） ─────────────────────────

/** 一個「area」（大題或技能代碼）在 facts 裡的證據：作答數與答對率由程式帶出（§3.3 第 4 段）。 */
export interface AssistAreaEvidence {
  label: string;
  n: number | null;
  rate: number | null;
  /** 選擇題大題的目標答對率、可爭取分數（大題才有）。 */
  target: number | null;
  gain: number | null;
}

export interface AssistReportStrength {
  area: string;
  evidence_zh: string;
  facts: AssistAreaEvidence | null;
}

export interface AssistReportWeakness {
  area: string;
  error_codes: AssistErrorCode[];
  evidence_zh: string;
  explain_zh: string;
  priority: number;
  facts: AssistAreaEvidence | null;
}

export interface AssistCaseLink {
  id: string;
  title: string;
}

export interface AssistReportErrorPattern {
  code: AssistErrorCode;
  explain_zh: string;
  cases: AssistCaseLink[];
  fix_zh: string;
  /** 這個錯因在案例裡的次數（facts.errors）。 */
  count: number | null;
}

export interface AssistReportDoubt {
  case: AssistCaseLink | null;
  note_zh: string;
}

export interface AssistReportSectionNote {
  section: AssistMethodSection;
  note_zh: string;
}

export interface AssistReportScorePlan {
  priority: number;
  section: AssistReportSection;
  action_zh: string;
  why_zh: string;
  gain_level: 'high' | 'medium' | 'low';
  /** 程式算的可爭取分數（facts）。 */
  gain: number | null;
}

export interface AssistRoutineItem {
  kind: AssistPlanKind;
  section: AssistSection | null;
  weight: 1 | 2 | 3;
  detail_zh: string;
}

export interface AssistReportPhase {
  phase_id: AssistPhaseId;
  from: number;
  to: number;
  focus_zh: string;
  routine: AssistRoutineItem[];
}

export interface AssistReportMilestone {
  week: number;
  kind: AssistPlanKind;
  detail_zh: string;
  rec_ref: string | null;
}

export interface AssistReportRecommendation {
  ref: string;
  why_zh: string;
  /** 伺服器依 ref 重建的候選（標題、大題、難度；不採用前端或模型給的文字）。 */
  candidate: AssistPracticeCandidate;
}

/** 逐週清單的一項（程式排好的份量；id 給勾選用）。 */
export interface AssistPlanItem {
  id: string;
  kind: AssistPlanKind;
  section: AssistSection | null;
  units: number;
  unit_minutes: number;
  minutes: number;
  detail_zh: string;
  /** 錨點（模擬考）：不是 AI 的 routine 排的。 */
  anchor: boolean;
}

export type AssistPlanWeekNote = 'school_exam' | 'final' | 'mock_only' | 'mock_conflict' | 'mock_moved' | 'vocab_paused' | 'over_budget';

export interface AssistPlanWeek {
  /** 週次；長期菜單是 0。 */
  week: number;
  start: string;
  end: string;
  phase: AssistPhaseId;
  budget: number;
  /** 預計分鐘數（各項合計）。 */
  planned: number;
  items: AssistPlanItem[];
  milestones: AssistReportMilestone[];
  notes: AssistPlanWeekNote[];
}

export interface AssistReportPlan {
  skeleton: AssistPlanSkeleton;
  /** 長期（超過 16 週時，前面每週的基礎菜單）。 */
  long_term: AssistPlanWeek | null;
  weeks: AssistPlanWeek[];
}

/** report_json：AI 的報告（後處理過）＋程式排好的逐週計畫。 */
export interface AssistReportBody {
  overview_zh: string;
  strengths: AssistReportStrength[];
  weaknesses: AssistReportWeakness[];
  error_patterns: AssistReportErrorPattern[];
  doubts: AssistReportDoubt[];
  section_notes: AssistReportSectionNote[];
  score_plan: AssistReportScorePlan[];
  phases: AssistReportPhase[];
  milestones: AssistReportMilestone[];
  recommendations: AssistReportRecommendation[];
  changes_zh: string[];
  questions_zh: string[];
  data_notes_zh: string;
  safety_flag: AssistSafetyFlag;
  notices: AssistNotice[];
  plan: AssistReportPlan;
}

// ───────────────────────── API 的回應 ─────────────────────────

export const ASSIST_REPORT_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type AssistReportStatus = (typeof ASSIST_REPORT_STATUSES)[number];

/** 產生報告時的設定（存在 target_json；畫面「這一版的設定」與下一版的預填）。 */
export interface AssistReportSettings {
  target: { standard: AssistStandard } | { level: number };
  practice_tier: Tier | null;
  weekly: AssistWeekly;
  school_exam_dates: string[];
  exam_date: string;
}

/** GET /api/assist/reports 的一列（只有中繼資料）。 */
export interface AssistReportSummary {
  id: string;
  version: number;
  based_on: string | null;
  status: AssistReportStatus;
  failure: AiRefundReason | null;
  created_at: number;
  exam_date: string;
  target_level: number | null;
}

export interface AssistReportListResponse {
  reports: AssistReportSummary[];
}

/** GET /api/assist/reports/{id}（前端輪詢這支）。 */
export interface AssistReportDetail extends AssistReportSummary {
  updated_at: number;
  expires_at: number;
  settings: AssistReportSettings | null;
  feedback: string | null;
  facts: AssistReportFacts | null;
  report: AssistReportBody | null;
}

/** POST /api/assist/reports 的回應（202）。 */
export interface AssistReportAccepted {
  op_id: string;
  report_id: string;
  version: number;
  status: 'queued';
  points: number;
}
