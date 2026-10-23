/**
 * 學習報告的測試資料（單元測試與 e2e 的 FakeBackend 共用；只依賴 @gsat/shared）。負責：WP-C。
 * 形狀照 Worker 的 GET /api/assist/reports/{id}：facts 是程式算的數字（這裡手寫成一組前後一致的值），report 是後處理過的
 * AI 輸出＋程式依骨架排好的逐週計畫。日期以 2026-11-20 為今天：9 週，題型強化 1–5、模考衝刺 6–8、考前調整 9。
 * 全部是本站為測試寫的句子。
 */
import {
  ASSIST_SECTION_POINTS,
  planSkeleton,
  type AssistPlanItem,
  type AssistPlanWeek,
  type AssistReportBody,
  type AssistReportDetail,
  type AssistReportFacts,
  type AssistSectionFacts,
} from '@gsat/shared';

export const REPORT_TODAY = '2026-11-20';
export const REPORT_EXAM_DATE = '2027-01-23';
export const REPORT_ID_1 = '11111111-1111-4111-8111-111111111111';
export const REPORT_ID_2 = '22222222-2222-4222-8222-222222222222';
/** 2026-11-20 10:00（台灣時間）。 */
export const REPORT_CREATED_AT = Date.parse('2026-11-20T02:00:00.000Z') / 1000;

function mc(section: AssistSectionFacts['section'], current: number | null, target: number, national: number, basis: AssistSectionFacts['basis'], n: number): AssistSectionFacts {
  const points = ASSIST_SECTION_POINTS[section];
  const gain = current === null ? null : Math.round(2 * points * Math.max(0, target - current)) / 2;
  return {
    section,
    points,
    official: basis === 'official' ? { n, correct: Math.round(n * (current ?? 0)), rate: current ?? 0 } : null,
    bank: basis === 'bank' ? { rate: current ?? 0, n, tiers: [{ tier: 'advanced', n, rate: current ?? 0 }], note: 'no_top' } : null,
    writing: null,
    current,
    basis,
    target,
    target_floor: false,
    gain,
    national,
  };
}

export function reportFacts(): AssistReportFacts {
  const sections: AssistSectionFacts[] = [
    mc('vocabulary', null, 0.62, 0.5, 'none', 0),
    mc('cloze', 0.5, 0.59, 0.47, 'bank', 10),
    mc('word_bank', 0.45, 0.65, 0.46, 'bank', 20),
    mc('structure', null, 0.66, 0.5, 'none', 0),
    mc('reading', 0.5, 0.72, 0.56, 'official', 30),
    mc('mixed', null, 0.67, 0.5, 'none', 0),
    { section: 'translation', points: 8, official: null, bank: null, writing: { n: 1, avg: 3, basis: 'self' }, current: 3, basis: 'self', target: 4.1, target_floor: false, gain: 1, national: 3.07 },
    { section: 'composition', points: 20, official: null, bank: null, writing: null, current: null, basis: 'none', target: 10.9, target_floor: false, gain: null, national: 8.13 },
  ];
  return {
    v: 1,
    today: REPORT_TODAY,
    exam_date: REPORT_EXAM_DATE,
    target: { level: 11, standard: 'front', top_pct: 30.35 },
    standards: { year: 115, top: 13, front: 11, mean: 8, back: 5, floor: 3 },
    sections,
    gain_total: 11.5,
    distance: { raw: 58, max: 100, scale_year: 114, level: 11, lower: 61.71, short: 4, self_scored: true, at: '2026-11-10T09:00:00.000Z' },
    distance_lines: ['最近一次真題模考 58 分（含自評）；依 114 年對照表，11 級分要超過 61.71 分，還差約 4 分。', '各大題可爭取分數合計約 11.5 分。'],
    skills: { weak: [{ code: 'it:inference', n: 10, correct: 3, rate: 0.3 }], strong: [{ code: 'it:detail', n: 12, correct: 10, rate: 0.83 }] },
    errors: [{ code: 'over_inference', n: 2 }],
    traps: [{ code: 'DS', n: 5 }],
    understood: { yes: 0, partly: 0, no: 1, unset: 1 },
    cases: 2,
    mocks: [{ kind: 'exam', paper: 'gsat-114', at: '2026-11-10T09:00:00.000Z', raw: 58, max: 100, level: 9, scale_year: 114, predicted: null, self_scored: true, sections: [] }],
    writing: { translation: null, essay: null, categories: [], weak_codes: [] },
    vocab: { mistakes: 25, by_level: { '1': 0, '2': 3, '3': 8, '4': 9, '5': 4, '6': 1 }, top_words: ['postpone'], srs: { cards: 120, due: 15, lapses_ge3: 8 } },
    behaviour: { marked: 3, revealed: 2, fast_wrong: null },
    data_level: 'enough',
    data_gaps: ['composition', 'official'],
    coverage: { outcomes: 120, first_at: '2026-09-01T00:00:00.000Z', range_days: 90 },
    levels: [3, 5, 8, 9, 11, 13],
    diff: null,
  };
}

function item(week: number, index: number, kind: AssistPlanItem['kind'], section: AssistPlanItem['section'], units: number, unit: number, detail: string, anchor = false): AssistPlanItem {
  return { id: `w${week}-${index}`, kind, section, units, unit_minutes: unit, minutes: units * unit, detail_zh: detail, anchor };
}

/** 依骨架排的逐週計畫（份量同 Worker 的 plan.ts 對這組 routine 的結果）。 */
export function reportPlan(): AssistReportBody['plan'] {
  const skeleton = planSkeleton(REPORT_TODAY, REPORT_EXAM_DATE, { weekly: '2to4', school_exam_dates: [] })!;
  const weeks: AssistPlanWeek[] = skeleton.weeks.map((w) => {
    const items: AssistPlanItem[] = [];
    let i = 0;
    if (w.mock) items.push(item(w.week, i++, 'mock_exam', 'other', 1, 130, '整份計時，交卷後逐題檢討', true));
    if (w.final) {
      items.push(item(w.week, i++, 'review_mistakes', 'other', 2, 20, '只看錯過的題'));
      items.push(item(w.week, i++, 'vocab_review', 'vocab_word', 2, 15, '複習到期的卡片'));
    } else if (!w.mock) {
      items.push(item(w.week, i++, 'bank_practice', 'reading', 7, 12, '推論題找證據句'));
      items.push(item(w.week, i++, 'bank_practice', 'word_bank', 5, 12, '先分詞性'));
      items.push(item(w.week, i++, 'translation', 'translation', 1, 20, '送 AI 批改'));
    } else {
      items.push(item(w.week, i++, 'review_mistakes', 'other', 2, 20, '檢討模考的錯題'));
    }
    const planned = items.reduce((s, x) => s + x.minutes, 0);
    return {
      week: w.week,
      start: w.start,
      end: w.end,
      phase: w.phase,
      budget: w.budget,
      planned,
      items,
      milestones: w.week === 3 ? [{ week: 3, kind: 'bank_practice', detail_zh: '完成推薦的閱讀題組', rec_ref: 'ai.rd.0a1b2c@1' }] : [],
      notes: w.final ? ['final'] : [],
    };
  });
  return { skeleton, long_term: null, weeks };
}

export function reportBody(extra: Partial<AssistReportBody> = {}): AssistReportBody {
  return {
    overview_zh: '閱讀的歷屆首次答對率 0.50，離前標的目標還有一段距離；文意選填的題庫表現不穩。',
    strengths: [{ area: 'it:detail', evidence_zh: '細節題首次答對率 0.83。', facts: { label: '細節', n: 12, rate: 0.83, target: null, gain: null } }],
    weaknesses: [
      { area: 'reading', error_codes: ['over_inference'], evidence_zh: '歷屆閱讀 30 題答對 15 題。', explain_zh: '推論題常選文中沒寫的結論。', priority: 1, facts: { label: '閱讀測驗', n: 30, rate: 0.5, target: 0.72, gain: 5.5 } },
    ],
    error_patterns: [
      { code: 'over_inference', explain_zh: '選了聽起來合理、但文中沒有寫的選項。', cases: [{ id: 'case-1', title: '本站題庫・閱讀測驗：第 2 題' }], fix_zh: '每一題指出證據句。', count: 2 },
    ],
    doubts: [{ case: { id: 'case-1', title: '本站題庫・閱讀測驗：第 2 題' }, note_zh: '這題的推論還沒弄懂。' }],
    section_notes: [{ section: 'reading', note_zh: '你最常在推論題失分，先找證據句。' }],
    score_plan: [
      { priority: 1, section: 'reading', action_zh: '每天一篇閱讀，計時 8 分鐘。', why_zh: '閱讀配分最高。', gain_level: 'high', gain: 5.5 },
      { priority: 2, section: 'word_bank', action_zh: '每週一篇文意選填，先分詞性。', why_zh: '題庫表現不穩。', gain_level: 'medium', gain: 2 },
      { priority: 3, section: 'translation', action_zh: '每週寫一題中譯英送 AI 批改。', why_zh: '還沒有批改紀錄。', gain_level: 'low', gain: 1 },
    ],
    phases: [
      { phase_id: 'strengthen', from: 1, to: 5, focus_zh: '閱讀推論與文意選填。', routine: [{ kind: 'bank_practice', section: 'reading', weight: 3, detail_zh: '推論題找證據句' }] },
      { phase_id: 'mock_sprint', from: 6, to: 8, focus_zh: '模考與檢討。', routine: [{ kind: 'review_mistakes', section: null, weight: 3, detail_zh: '逐題檢討' }] },
      { phase_id: 'final', from: 9, to: 9, focus_zh: '只複習。', routine: [{ kind: 'review_mistakes', section: null, weight: 3, detail_zh: '只看錯過的題' }] },
    ],
    milestones: [{ week: 3, kind: 'bank_practice', detail_zh: '完成推薦的閱讀題組', rec_ref: 'ai.rd.0a1b2c@1' }],
    recommendations: [
      { ref: 'ai.rd.0a1b2c@1', why_zh: '練推論題。', candidate: { ref: 'ai.rd.0a1b2c@1', section: 'reading', tier: 'basic', skills: ['it:main_idea'], title: '閱讀測驗・穩定基礎・紙船比賽' } },
      { ref: 'exam:gsat-115', why_zh: '模考週用。', candidate: { ref: 'exam:gsat-115', section: 'other', tier: null, skills: [], title: '115 學測（整份）' } },
    ],
    changes_zh: [],
    questions_zh: ['你每天什麼時段讀英文？'],
    data_notes_zh: '資料只來自這台裝置。',
    safety_flag: 'none',
    notices: [{ kind: 'prediction_removed', field: 'overview_zh' }],
    plan: reportPlan(),
    ...extra,
  };
}

export function reportDetail(extra: Partial<AssistReportDetail> = {}): AssistReportDetail {
  return {
    id: REPORT_ID_1,
    version: 1,
    based_on: null,
    status: 'done',
    failure: null,
    created_at: REPORT_CREATED_AT,
    updated_at: REPORT_CREATED_AT + 60,
    expires_at: REPORT_CREATED_AT + 180 * 86_400,
    exam_date: REPORT_EXAM_DATE,
    target_level: 11,
    settings: { target: { standard: 'front' }, practice_tier: null, weekly: '2to4', school_exam_dates: [], exam_date: REPORT_EXAM_DATE },
    feedback: null,
    facts: reportFacts(),
    report: reportBody(),
    ...extra,
  };
}
