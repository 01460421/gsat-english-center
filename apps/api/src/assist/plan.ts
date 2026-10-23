/**
 * 讀書計畫的逐週份量（docs/design/learning-assistant.md §3.2.6、§4.11 第 13 步；純函式）。負責：WP-C。
 *
 * 骨架（planSkeleton，shared）決定週次、階段、模考與段考的錨點、每週預算；AI 只給每個階段的 routine（項目、大題、權重 1–3、
 * 重點）。份量由這裡算，AI 不寫任何分鐘數或組數：
 *   1. 先扣錨點：模考 130 分鐘（作答 100＋檢討 30）。預算不夠一份模考時，那週只排模考（mock_only，必要時 over_budget）。
 *      模考撞到段考週、前後都移不動時（mock_conflict）：保留模考，其他份量再減半。
 *   2. 剩下的時間依權重按比例分給 routine 的每一項，每項換成「幾組」：floor(分配時間 ÷ 每組用時)（方法庫的 UNIT_MINUTES）；
 *      權重最高的一項至少 1 組（放不下時從權重最低的項目扣回來）。
 *   3. 餘下的時間給「檢討錯題」（每次 20 分鐘）。
 *   考前調整週只排檢討錯題、單字複習與計時的單一大題（不排整份模考；骨架已經把最後幾天的時間減半，SPEC §6.11 的延伸）；
 *   暫停新單字的週，新單字換成單字複習；
 *   routine 裡的模擬考不另外排（模考只排在錨點週）。超過 16 週時，長期的每週菜單用第一個階段的 routine、整週預算。
 * AI 少給的階段用本站的預設菜單補上（DEFAULT_ROUTINES），多給的丟掉（reportOutput.ts）。
 */
import {
  ASSIST_MOCK_MINUTES,
  UNIT_MINUTES,
  planUnitMinutes,
  type AssistPhaseId,
  type AssistPlanItem,
  type AssistPlanKind,
  type AssistPlanSkeleton,
  type AssistPlanWeek,
  type AssistPlanWeekNote,
  type AssistReportMilestone,
  type AssistReportPhase,
  type AssistReportPlan,
  type AssistRoutineItem,
  type AssistSection,
  type AssistSkeletonWeek,
} from '@gsat/shared';

/** AI 沒給（或給錯）某個階段時的預設菜單（本站撰寫；權重 1–3）。 */
export const DEFAULT_ROUTINES: Readonly<Record<AssistPhaseId, readonly AssistRoutineItem[]>> = {
  foundation: [
    { kind: 'vocab_new', section: 'vocab_word', weight: 2, detail_zh: '新單字連同搭配詞一起記' },
    { kind: 'bank_practice', section: 'reading', weight: 3, detail_zh: '閱讀每題找出證據句' },
    { kind: 'bank_practice', section: 'vocabulary', weight: 2, detail_zh: '詞彙題檢討每個選項' },
    { kind: 'review_mistakes', section: null, weight: 1, detail_zh: '這週的錯題重做一次' },
  ],
  strengthen: [
    { kind: 'bank_practice', section: 'reading', weight: 3, detail_zh: '每篇計時 8 分鐘' },
    { kind: 'bank_practice', section: 'word_bank', weight: 2, detail_zh: '先分詞性再選' },
    { kind: 'translation', section: 'translation', weight: 1, detail_zh: '寫完送 AI 批改' },
    { kind: 'vocab_review', section: 'vocab_word', weight: 2, detail_zh: '複習到期的單字' },
  ],
  mock_sprint: [
    { kind: 'review_mistakes', section: null, weight: 3, detail_zh: '模考錯題逐題檢討' },
    { kind: 'past_exam_section', section: 'reading', weight: 2, detail_zh: '照建議時間計時' },
    { kind: 'vocab_review', section: 'vocab_word', weight: 2, detail_zh: '複習錯過的字' },
    { kind: 'essay', section: 'composition', weight: 1, detail_zh: '寫完送 AI 批改' },
  ],
  final: [
    { kind: 'review_mistakes', section: null, weight: 3, detail_zh: '看錯題與筆記，不做整份新卷' },
    { kind: 'vocab_review', section: 'vocab_word', weight: 2, detail_zh: '複習錯過的字' },
    { kind: 'past_exam_section', section: 'reading', weight: 1, detail_zh: '考前最後幾天以外，計時做一個大題保持手感' },
  ],
};

/** 考前調整週可以排的項目（計時的單一大題可以，整份模考不排）。 */
const FINAL_KINDS: ReadonlySet<AssistPlanKind> = new Set(['review_mistakes', 'vocab_review', 'past_exam_section', 'assistant', 'rest']);

interface Alloc {
  kind: AssistPlanKind;
  section: AssistSection | null;
  weight: number;
  detail: string;
  unit: number;
  units: number;
}

/** 這一週要用的 routine（依週的性質過濾、換項目）。 */
function routineFor(week: Pick<AssistSkeletonWeek, 'final' | 'vocab_paused'>, routine: readonly AssistRoutineItem[], phase: AssistPhaseId): AssistRoutineItem[] {
  let items = routine.filter((r) => r.kind !== 'mock_exam');
  if (week.final) {
    items = items.filter((r) => FINAL_KINDS.has(r.kind));
    if (items.length === 0) items = [...DEFAULT_ROUTINES.final];
  }
  if (week.vocab_paused) items = items.map((r) => (r.kind === 'vocab_new' ? { ...r, kind: 'vocab_review' as const } : r));
  // 同一種項目＋大題只留一項（權重取最大）。
  const merged: AssistRoutineItem[] = [];
  for (const r of items) {
    const same = merged.find((m) => m.kind === r.kind && m.section === r.section);
    if (same) same.weight = Math.max(same.weight, r.weight) as 1 | 2 | 3;
    else merged.push({ ...r });
  }
  return merged.length > 0 ? merged : [...(DEFAULT_ROUTINES[phase] ?? DEFAULT_ROUTINES.final)];
}

/** 把 rest 分鐘依權重分給 routine（見檔頭第 2、3 步）。 */
export function allocate(rest: number, routine: readonly AssistRoutineItem[]): Alloc[] {
  const items: Alloc[] = routine
    .filter((r) => r.kind !== 'rest')
    .map((r) => ({ kind: r.kind, section: r.kind === 'bank_practice' || r.kind === 'past_exam_section' ? r.section : null, weight: r.weight, detail: r.detail_zh, unit: planUnitMinutes(r.kind, r.section), units: 0 }))
    .filter((a) => a.unit > 0);
  if (rest <= 0 || items.length === 0) return [];
  const wSum = items.reduce((s, a) => s + a.weight, 0);
  for (const a of items) a.units = Math.floor((rest * a.weight) / wSum / a.unit);
  // 權重最高的一項（同權重取先列的）至少 1 組。
  const top = items.reduce((best, a) => (a.weight > best.weight ? a : best), items[0]!);
  if (top.units === 0) top.units = 1;
  // 放不下時，從權重最低（同權重取後列）的其他項目扣回來。
  const used = () => items.reduce((s, a) => s + a.units * a.unit, 0);
  const byLow = [...items].reverse().sort((a, b) => a.weight - b.weight);
  for (const a of byLow) {
    while (used() > rest && a !== top && a.units > 0) a.units -= 1;
  }
  // 餘下的時間給檢討錯題。
  const left = rest - used();
  const review = Math.floor(left / UNIT_MINUTES.review_mistakes);
  if (review > 0) {
    const existing = items.find((a) => a.kind === 'review_mistakes');
    if (existing) existing.units += review;
    else items.push({ kind: 'review_mistakes', section: null, weight: 0, detail: '這週的錯題重做一次，寫下錯因', unit: UNIT_MINUTES.review_mistakes, units: review });
  }
  return items.filter((a) => a.units > 0);
}

function item(week: number, index: number, a: { kind: AssistPlanKind; section: AssistSection | null; unit: number; units: number; detail: string }, anchor: boolean): AssistPlanItem {
  return { id: `w${week}-${index}`, kind: a.kind, section: a.section, units: a.units, unit_minutes: a.unit, minutes: a.unit * a.units, detail_zh: a.detail, anchor };
}

function weekPlan(w: AssistSkeletonWeek, routine: readonly AssistRoutineItem[], milestones: readonly AssistReportMilestone[]): AssistPlanWeek {
  const notes: AssistPlanWeekNote[] = [];
  if (w.school_exam) notes.push('school_exam');
  if (w.final) notes.push('final');
  if (w.vocab_paused) notes.push('vocab_paused');
  if (w.mock_moved) notes.push('mock_moved');
  const items: AssistPlanItem[] = [];
  let rest = w.budget;
  if (w.mock) {
    items.push(item(w.week, 0, { kind: 'mock_exam', section: null, unit: ASSIST_MOCK_MINUTES, units: 1, detail: '計時作答一份完整的模擬考，隔天檢討' }, true));
    rest -= ASSIST_MOCK_MINUTES;
    if (w.mock_conflict) {
      notes.push('mock_conflict');
      rest = Math.floor(Math.max(0, rest) / 2);
    }
    if (rest <= 0) notes.push('mock_only');
    if (w.budget < ASSIST_MOCK_MINUTES) notes.push('over_budget');
  }
  for (const a of allocate(rest, routineFor(w, routine, w.phase))) items.push(item(w.week, items.length, a, false));
  const planned = items.reduce((s, i) => s + i.minutes, 0);
  if (planned > w.budget && !notes.includes('over_budget')) notes.push('over_budget');
  return {
    week: w.week,
    start: w.start,
    end: w.end,
    phase: w.phase,
    budget: w.budget,
    planned,
    items,
    milestones: milestones.filter((m) => m.week === w.week),
    notes,
  };
}

/**
 * 依骨架與 AI 的階段（已經由 reportOutput.ts 對齊骨架：每個階段一筆、順序相同）排出逐週計畫。
 */
export function buildPlan(skeleton: AssistPlanSkeleton, phases: readonly AssistReportPhase[], milestones: readonly AssistReportMilestone[]): AssistReportPlan {
  const routineOf = (id: AssistPhaseId) => phases.find((p) => p.phase_id === id)?.routine ?? DEFAULT_ROUTINES[id];
  const weeks = skeleton.weeks.map((w) => weekPlan(w, routineOf(w.phase), milestones));
  let longTerm: AssistPlanWeek | null = null;
  if (skeleton.long_term) {
    const phase = skeleton.phases[0]?.id ?? 'foundation';
    const lt = skeleton.long_term;
    const plan = weekPlan(
      { week: 0, start: lt.start, end: lt.end, days: 7, phase, mock: false, mock_moved: null, mock_conflict: false, school_exam: false, final: false, vocab_paused: false, budget: skeleton.weekly_minutes },
      routineOf(phase),
      milestones.filter((m) => m.week >= lt.from && m.week <= lt.to),
    );
    longTerm = { ...plan, milestones: milestones.filter((m) => m.week >= lt.from && m.week <= lt.to) };
  }
  return { skeleton, long_term: longTerm, weeks };
}
