/**
 * 學習報告的測試資料（docs/design/learning-assistant.md §3、§5.5）：本機摘要、報告請求本體、模型的報告輸出，以及假網站的三份索引。
 * 全部是本站為測試自己編的數字與文字。
 */
import { planSkeleton, type AssistHistorySummary, type CreateAssistReportBody } from '@gsat/shared';
import { computeFacts } from '../../src/assist/facts';
import type { ReportInput } from '../../src/assist/reportRequests';
import type { AssistReportOutput } from '../../src/assist/reportSchemas';
import { defaultSiteFiles, RD_REF, WB_REF, type SiteFiles } from './assistSite';

type SectionRow = AssistHistorySummary['sections'][number];

/** 一列大題統計（first_n 預設等於 n）。 */
export function row(section: SectionRow['section'], src: SectionRow['src'], n: number, correct: number, extra: Partial<SectionRow> = {}): SectionRow {
  return { section, src, n, correct, first_n: n, first_correct: correct, recent_n: 0, recent_correct: 0, hinted: 0, unanswered: 0, ...extra };
}

/** 空的摘要（沒有任何作答）。 */
export function emptySummary(): AssistHistorySummary {
  return {
    v: 2,
    generated_at: '2026-11-20T08:00:00.000Z',
    range_days: 90,
    sections: [],
    skills: [],
    traps: [],
    bank_groups: [],
    mocks: [],
    vocab: { mistakes: 0, by_level: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }, top: [], srs: null },
    behaviour: { marked: 0, revealed: 0, fast_wrong: null },
    plan_progress: null,
    coverage: { outcomes: 0, first_at: null, devices_note: 'this_device' },
  };
}

/** 有資料的摘要：閱讀歷屆 30 題（答對 15）、文意選填只有題庫、一份真題模考（中譯英與作文自評）。 */
export function richSummary(extra: Partial<AssistHistorySummary> = {}): AssistHistorySummary {
  return {
    ...emptySummary(),
    sections: [
      row('reading', 'official', 30, 15),
      row('reading', 'bank:basic', 20, 16),
      row('word_bank', 'bank:basic', 10, 8),
      row('word_bank', 'bank:advanced', 10, 5),
      row('word_bank', 'bank:top', 4, 1),
      row('vocabulary', 'official', 12, 6),
      row('cloze', 'bank_mock:advanced', 6, 3),
      row('cloze', 'bank:advanced', 4, 2),
    ],
    skills: [
      { code: 'it:inference', n: 12, correct: 4, first_n: 10, first_correct: 3 },
      { code: 'it:detail', n: 14, correct: 11, first_n: 12, first_correct: 10 },
      { code: 'tp:collocation', n: 8, correct: 4, first_n: 6, first_correct: 2 },
      { code: 'ct:contrast', n: 4, correct: 1, first_n: 4, first_correct: 1 },
    ],
    traps: [
      { code: 'DS', n: 5 },
      { code: 'OP', n: 3 },
    ],
    mocks: [
      {
        kind: 'exam',
        paper: 'gsat-114',
        at: '2026-11-10T09:00:00.000Z',
        raw: 58,
        max: 100,
        level: 9,
        scale_year: 114,
        predicted: null,
        nonmc: { translation: { earned: 3, max: 8, basis: 'self' }, essay: { earned: 10, max: 20, basis: 'self' } },
        sections: [{ section: 'reading', earned: 14, max: 24, time_sec: 1_800, suggested_sec: 1_500 }],
      },
    ],
    vocab: { mistakes: 25, by_level: { '1': 0, '2': 3, '3': 8, '4': 9, '5': 4, '6': 1 }, top: [{ word: 'postpone', level: 3, wrong: 4, mode: 'en2zh' }], srs: { cards: 120, due: 15, lapses_ge3: 8 } },
    behaviour: { marked: 3, revealed: 2, fast_wrong: 4 },
    coverage: { outcomes: 120, first_at: '2026-09-01T00:00:00.000Z', devices_note: 'this_device' },
    ...extra,
  };
}

export function reportBody(extra: Partial<CreateAssistReportBody> = {}): CreateAssistReportBody {
  return {
    summary: richSummary(),
    target: { standard: 'front' },
    weekly: '2to4',
    school_exam_dates: [],
    exam_date: '2027-01-23',
    feedback: null,
    candidates: [RD_REF, WB_REF, 'exam:gsat-115', 'ai.rd.ffffff@9'],
    ...extra,
  };
}

/** 假網站的題目檔加上報告用的三份索引。 */
export function reportSiteFiles(): SiteFiles {
  return {
    ...defaultSiteFiles(),
    'bank/index.json': {
      version: 'test',
      count: 2,
      groups: [
        { uid: 'ai.rd.0a1b2c', version: 1, section_type: 'reading', tier: 'basic', topic: '紙船比賽', skills: ['it:main_idea', 'it:detail', 'xx:bogus'] },
        { uid: 'ai.wb.3f9a1c', version: 2, section_type: 'word_bank', tier: 'advanced', topic: 'selling a bike', skills: ['tp:collocation'] },
      ],
    },
    'writing/bank/index.json': {
      version: 'test',
      count: 3,
      groups: [
        { uid: 'ai.tr.aaaaaa', version: 1, section_type: 'translation', tier: 'basic', topic: '校園生活', skills: ['ts:PERF', 'tt:tense_trigger'] },
        { uid: 'ai.tr.bbbbbb', version: 1, section_type: 'translation', tier: 'advanced', topic: '科技', skills: ['ts:PASS'] },
        { uid: 'ai.cp.cccccc', version: 2, section_type: 'composition', tier: 'advanced', topic: '社團經驗', skills: [] },
      ],
    },
    'exams/index.json': {
      version: 'test',
      count: 1,
      exams: [{ id: 'gsat-115', exam: 'gsat', year: 115, session: 'regular', title: '115學年度學科能力測驗英文考科' }],
    },
  };
}

/**
 * 一份報告的呼叫輸入（ai.rules.test.ts 逐條掃描用；和路由存進 input_json 的同一個形狀）：2026-11-20 起算的 9 週骨架、
 * richSummary 算出的 facts、一個代表案例、兩個候選。
 */
export function sampleReportInput(): ReportInput {
  const skeleton = planSkeleton('2026-11-20', '2027-01-23', { weekly: '2to4', school_exam_dates: [] })!;
  const facts = computeFacts({
    summary: richSummary(),
    target: { standard: 'front' },
    today: '2026-11-20',
    examDate: '2027-01-23',
    cases: { cases: 1, errors: [{ code: 'over_inference', n: 1 }], understood: { yes: 0, partly: 0, no: 1, unset: 0 } },
    writing: { translation: [], essay: [], essayCriteria: [], categories: [], weakCodes: [] },
    previous: null,
  });
  return {
    v: 1,
    version: 1,
    settings: { target: { standard: 'front' }, practice_tier: null, weekly: '2to4', school_exam_dates: [], exam_date: '2027-01-23' },
    facts,
    skeleton,
    case_skills: [{ code: 'it:inference', n: 1 }],
    digests: [
      {
        ref: 'c1',
        id: '33333333-3333-4333-8333-333333333333',
        title: '本站題庫・閱讀測驗：第 2 題',
        section: 'reading',
        errors: ['over_inference'],
        verdict: 'wrong',
        understood: 'no',
        summary: '選了文中沒有寫的結論。',
      },
    ],
    candidates: [
      { ref: RD_REF, section: 'reading', tier: 'basic', skills: ['it:main_idea', 'it:detail'], title: '閱讀測驗・穩定基礎・紙船比賽' },
      { ref: WB_REF, section: 'word_bank', tier: 'advanced', skills: ['tp:collocation'], title: '文意選填・進階練習' },
    ],
    previous: null,
    injection: [],
  };
}

/** 模型的報告輸出（phases 依 2026-11-20 起算的 9 週骨架：題型強化、模考衝刺、考前調整）。 */
export function reportOutput(extra: Partial<AssistReportOutput> = {}): AssistReportOutput {
  return {
    overview_zh: '閱讀的歷屆首次答對率 0.50，離前標的目標還有一段距離；文意選填的題庫表現不穩。你有望達到 11 級分。',
    strengths: [
      { area: 'it:detail', evidence_zh: '細節題首次答對率 0.83。' },
      { area: 'not_an_area', evidence_zh: '這一則會被丟掉。' },
    ],
    weaknesses: [
      { area: 'reading', error_codes: ['over_inference', 'xx'], evidence_zh: '歷屆閱讀 30 題答對 15 題。', explain_zh: '推論題常選文中沒寫的結論。', priority: 1 },
      { area: 'it:inference', error_codes: ['over_inference'], evidence_zh: '推論題 10 題答對 3 題。', explain_zh: '要找到可以推出答案的那一句。', priority: 9 },
    ],
    error_patterns: [
      { code: 'over_inference', explain_zh: '選了聽起來合理、但文中沒有寫的選項。', case_refs: ['c1', 'c99'], fix_zh: '每一題指出證據句。' },
      { code: 'not_a_code', explain_zh: '丟掉。', case_refs: [], fix_zh: '' },
    ],
    doubts: [{ case_ref: 'c1', note_zh: '這題的推論還沒弄懂。' }],
    section_notes: [
      { section: 'reading', note_zh: '你最常在推論題失分，先找證據句。' },
      { section: 'reading', note_zh: '重複的會被丟掉。' },
    ],
    score_plan: [
      { priority: 2, section: 'word_bank', action_zh: '每週一篇文意選填，先分詞性。', why_zh: '題庫表現不穩。', gain_level: 'medium' },
      { priority: 1, section: 'reading', action_zh: '每天一篇閱讀，計時 8 分鐘。', why_zh: '閱讀配分最高。預估可以拿到 60 分。', gain_level: 'high' },
      { priority: 3, section: 'translation', action_zh: '每週寫一題中譯英送 AI 批改。', why_zh: '還沒有批改紀錄。', gain_level: 'low' },
    ],
    phases: [
      {
        phase_id: 'strengthen',
        focus_zh: '閱讀推論與文意選填。',
        routine: [
          { kind: 'bank_practice', section: 'reading', weight: 3, detail_zh: '推論題找證據句' },
          { kind: 'bank_practice', section: 'word_bank', weight: 2, detail_zh: '先分詞性' },
          { kind: 'translation', section: 'translation', weight: 1, detail_zh: '送 AI 批改' },
          { kind: 'mock_exam', section: 'other', weight: 3, detail_zh: '模考不放在 routine' },
        ],
      },
      { phase_id: 'mock_sprint', focus_zh: '模考與檢討。', routine: [{ kind: 'review_mistakes', section: 'other', weight: 3, detail_zh: '逐題檢討' }] },
      { phase_id: 'final', focus_zh: '只複習。', routine: [{ kind: 'bank_practice', section: 'reading', weight: 3, detail_zh: '考前不做新題' }] },
      { phase_id: 'foundation', focus_zh: '骨架沒有這個階段，會被丟掉。', routine: [] },
    ],
    milestones: [
      { week: 3, kind: 'bank_practice', detail_zh: '完成推薦的閱讀題組', rec_ref: RD_REF },
      { week: 99, kind: 'essay', detail_zh: '週次不在範圍內', rec_ref: '' },
    ],
    recommendations: [
      { ref: RD_REF, why_zh: '練推論題。' },
      { ref: 'ai.rd.ffffff@9', why_zh: '不在候選裡，丟掉。' },
      { ref: RD_REF, why_zh: '重複，丟掉。' },
    ],
    changes_zh: ['第一版不該有這一欄。'],
    questions_zh: ['你每天什麼時段讀英文？'],
    data_notes_zh: '資料只來自這台裝置。',
    safety_flag: 'none',
    ...extra,
  };
}
