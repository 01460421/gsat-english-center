/**
 * 學習報告的輸出後處理（docs/design/learning-assistant.md §3.3「程式驗證」、§4.11；第 9、13 步是報告專用）。負責：WP-C。
 * consumer 在 callWithPolicy 的 onSuccess 裡呼叫：模型的 JSON 已經用完整的 zod schema 驗證過（第 1 步）。
 *
 *   2 代碼與對應：area 必須是大題或技能代碼；error_codes、code 只留封閉清單裡的；case_refs 只能是輸入的代表案例（c1…），
 *     轉成案例 id 與標題；rec_ref、recommendations 只能是候選；phases 依骨架一一對齊（少的補本站的預設菜單、多的丟掉）；
 *     week 在 1..W；routine 的 kind 不需要大題時忽略大題（bank_practice 給了寫作或單字時換成對應的項目）；
 *     priority、weight 夾到範圍內。第一版的 changes_zh 一律清空。
 *   3–8 長度、內容過濾、品牌字樣、英文字數（每個 _zh ≤ 40 個單詞、整則 ≤ 200）、D8：同解析（output.ts 的 Cleaner）。
 *   9 預測分數：拿掉含「n 級分」（n 不在 facts.levels）的句子，以及「預估／預測／可以拿到／會考到／有望／達到／穩上」後 10 個字內
 *     接數字＋分或級分的句子（數字在 facts 裡也拿掉：這是預測）；分鐘、每題 n 分、扣 n 分、配分、共 n 分照留。拿掉的記在 notices。
 *   11 safety_flag：回傳給 consumer 寫事件。
 *   13 逐週份量：依骨架、對齊後的 routine 與方法庫的每組用時排好（plan.ts），和 AI 的輸出一起存進 report_json。
 * 畫面上的數字全部來自 facts（area 的證據、可爭取分數由程式帶進來），不讀 AI 的文字。
 */
import {
  ASSIST_METHOD_SECTIONS,
  ASSIST_REPORT_SECTIONS,
  isAssistErrorCode,
  isAssistSkillCode,
  type AssistErrorCode,
  type AssistMethodSection,
  type AssistPhaseId,
  type AssistPlanKind,
  type AssistReportBody,
  type AssistReportFacts,
  type AssistReportMilestone,
  type AssistReportPhase,
  type AssistReportSection,
  type AssistRoutineItem,
  type AssistSafetyFlag,
  type AssistSection,
} from '@gsat/shared';
import type { D8Fingerprints } from '../ai/d8';
import { FILTERED_PLACEHOLDER, type OutputFilter } from '../ai/filter';
import { outputEnglishWords } from '../ai/scoring';
import { areaEvidence } from './facts';
import { Cleaner, D8_HIDDEN_TEXT, type PostprocessMeta } from './output';
import { buildPlan, DEFAULT_ROUTINES } from './plan';
import type { AssistReportOutput } from './reportSchemas';
import type { ReportInput } from './reportRequests';

/** 整則報告的英文上限（§4.11 第 7 步）。 */
export const REPORT_ENGLISH_MAX = 200;

/** 預測句（§4.11 第 9 步）：預測的動詞後 10 個字內接數字＋分或級分（分鐘不算）。 */
const PREDICT_RE = /(預估|預測|可以拿到|會考到|有望|達到|穩上).{0,10}?\d+(?:\.\d+)?\s*(?:級分|分(?!鐘))/;
/** 級分的數字。 */
const LEVEL_RE = /(\d+(?:\.\d+)?)\s*級分/g;

/** 依句子拿掉預測（句號、問號、驚嘆號、分號、換行都算句子的結尾）。回傳新文字與拿掉的句數。 */
export function removePredictions(text: string, levels: readonly number[]): { text: string; removed: number } {
  if (text === '') return { text, removed: 0 };
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g) ?? [text];
  let removed = 0;
  const kept = sentences.filter((s) => {
    const predicted = PREDICT_RE.test(s);
    const badLevel = [...s.matchAll(LEVEL_RE)].some((m) => !levels.includes(Number(m[1])));
    if (predicted || badLevel) {
      removed += 1;
      return false;
    }
    return true;
  });
  return { text: kept.join('').trim(), removed };
}

export interface ReportPostprocessed {
  body: AssistReportBody;
  meta: PostprocessMeta & { predictions_removed: number };
  safety: AssistSafetyFlag;
  /** 有欄位被過濾或被 D8 隱藏（只記事件；報告不進共用快取）。 */
  tainted: boolean;
}

const BANK_SECTIONS: ReadonlySet<string> = new Set(['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed']);

/** routine 的一項：kind 與大題的對齊（見檔頭第 2 步）。不合理的回 null。 */
function routineItem(kind: AssistPlanKind, section: AssistSection, weight: number, detail: string): AssistRoutineItem | null {
  const w = Math.min(3, Math.max(1, Math.round(weight))) as 1 | 2 | 3;
  if (kind === 'bank_practice' || kind === 'past_exam_section') {
    if (BANK_SECTIONS.has(section)) return { kind, section, weight: w, detail_zh: detail };
    if (section === 'translation') return { kind: 'translation', section: 'translation', weight: w, detail_zh: detail };
    if (section === 'composition') return { kind: 'essay', section: 'composition', weight: w, detail_zh: detail };
    if (section === 'vocab_word') return { kind: 'vocab_review', section: 'vocab_word', weight: w, detail_zh: detail };
    return { kind, section: 'reading', weight: w, detail_zh: detail };
  }
  if (kind === 'mock_exam') return null;
  const fixed: Partial<Record<AssistPlanKind, AssistSection>> = { translation: 'translation', essay: 'composition', vocab_review: 'vocab_word', vocab_new: 'vocab_word' };
  return { kind, section: fixed[kind] ?? null, weight: w, detail_zh: detail } as AssistRoutineItem;
}

export function postprocessReport(raw: AssistReportOutput, input: ReportInput, filter: OutputFilter, fp: D8Fingerprints): ReportPostprocessed {
  const c = new Cleaner('report', filter, fp);
  const facts: AssistReportFacts = input.facts;
  let predictions = 0;
  /** _zh 欄位：Cleaner（長度、過濾、品牌、英文、D8）→ 拿掉預測句。 */
  const zh = (text: string, limitPath: string, field: string): string => {
    const cleaned = c.zh(text, limitPath, field);
    if (cleaned === '' || cleaned === FILTERED_PLACEHOLDER || cleaned === D8_HIDDEN_TEXT) return cleaned;
    const r = removePredictions(cleaned, facts.levels);
    if (r.removed > 0) {
      predictions += r.removed;
      c.notice('prediction_removed', field);
    }
    return r.text;
  };
  const zhList = (xs: readonly string[], limitPath: string, field: string) =>
    c
      .list(xs, limitPath)
      .map((s, i) => zh(s, limitPath, `${field}[${i}]`))
      .filter((s) => s !== '');
  const isArea = (a: string) => (ASSIST_REPORT_SECTIONS as readonly string[]).includes(a) || isAssistSkillCode(a);
  const caseByRef = new Map(input.digests.map((d) => [d.ref, { id: d.id, title: d.title }]));
  const candidateByRef = new Map(input.candidates.map((x) => [x.ref, x]));
  const W = input.skeleton.total_weeks;

  const strengths = c
    .list(raw.strengths.filter((s) => isArea(s.area.trim())), 'strengths')
    .map((s, i) => {
      const area = s.area.trim();
      return { area, evidence_zh: zh(s.evidence_zh, 'strengths[].evidence_zh', `strengths[${i}].evidence_zh`), facts: areaEvidence(facts, area) };
    });
  if (raw.strengths.some((s) => !isArea(s.area.trim()))) c.meta.codes_dropped += 1;

  const weaknesses = c
    .list(
      raw.weaknesses.filter((w) => isArea(w.area.trim())).sort((a, b) => a.priority - b.priority),
      'weaknesses',
    )
    .map((w, i) => ({
      area: w.area.trim(),
      error_codes: c.codes(w.error_codes, isAssistErrorCode, 'weaknesses[].error_codes') as AssistErrorCode[],
      evidence_zh: zh(w.evidence_zh, 'weaknesses[].evidence_zh', `weaknesses[${i}].evidence_zh`),
      explain_zh: zh(w.explain_zh, 'weaknesses[].explain_zh', `weaknesses[${i}].explain_zh`),
      priority: Math.min(5, Math.max(1, Math.round(w.priority))),
      facts: areaEvidence(facts, w.area.trim()),
    }));

  const errorCount = new Map(facts.errors.map((e) => [e.code, e.n]));
  const seenCodes = new Set<string>();
  const errorPatterns = c
    .list(
      raw.error_patterns.filter((p) => isAssistErrorCode(p.code.trim()) && !seenCodes.has(p.code.trim()) && seenCodes.add(p.code.trim())),
      'error_patterns',
    )
    .map((p, i) => {
      const refs = c.list(p.case_refs.map((r) => r.trim()).filter((r) => caseByRef.has(r)), 'error_patterns[].case_refs');
      if (refs.length < p.case_refs.length) c.meta.codes_dropped += p.case_refs.length - refs.length;
      return {
        code: p.code.trim() as AssistErrorCode,
        explain_zh: zh(p.explain_zh, 'error_patterns[].explain_zh', `error_patterns[${i}].explain_zh`),
        cases: [...new Set(refs)].map((r) => caseByRef.get(r)!),
        fix_zh: zh(p.fix_zh, 'error_patterns[].fix_zh', `error_patterns[${i}].fix_zh`),
        count: errorCount.get(p.code.trim()) ?? null,
      };
    });

  const doubts = c
    .list(raw.doubts, 'doubts')
    .map((d, i) => ({ case: caseByRef.get(d.case_ref.trim()) ?? null, note_zh: zh(d.note_zh, 'doubts[].note_zh', `doubts[${i}].note_zh`) }))
    .filter((d) => d.note_zh !== '');

  const seenSections = new Set<string>();
  const sectionNotes = c
    .list(
      raw.section_notes.filter((n) => (ASSIST_METHOD_SECTIONS as readonly string[]).includes(n.section) && !seenSections.has(n.section) && seenSections.add(n.section)),
      'section_notes',
    )
    .map((n, i) => ({ section: n.section as AssistMethodSection, note_zh: zh(n.note_zh, 'section_notes[].note_zh', `section_notes[${i}].note_zh`) }))
    .filter((n) => n.note_zh !== '');

  const gainOf = new Map(facts.sections.map((s) => [s.section, s.gain]));
  const scorePlan = c
    .list([...raw.score_plan].sort((a, b) => a.priority - b.priority), 'score_plan')
    .map((p, i) => ({
      priority: i + 1,
      section: p.section as AssistReportSection,
      action_zh: zh(p.action_zh, 'score_plan[].action_zh', `score_plan[${i}].action_zh`),
      why_zh: zh(p.why_zh, 'score_plan[].why_zh', `score_plan[${i}].why_zh`),
      gain_level: p.gain_level,
      gain: gainOf.get(p.section) ?? null,
    }))
    .filter((p) => p.action_zh !== '');

  // 階段依骨架一一對齊：同一個 phase_id 取第一筆；少的補預設菜單、多的丟掉。modelPhases：routine 是模型寫的階段。
  const modelPhases = new Set<number>();
  const phases: AssistReportPhase[] = input.skeleton.phases.map((sp, pi) => {
    const fromModel = raw.phases.find((p) => p.phase_id === sp.id);
    if (!fromModel) {
      c.meta.items_missing += 1;
      c.notice('missing_item', `phases[${pi}]`);
      return { phase_id: sp.id, from: sp.from, to: sp.to, focus_zh: '', routine: [...DEFAULT_ROUTINES[sp.id]] };
    }
    const routine = c
      .list(fromModel.routine, 'phases[].routine')
      .map((r, ri) => routineItem(r.kind, r.section, r.weight, zh(r.detail_zh, 'phases[].routine[].detail_zh', `phases[${pi}].routine[${ri}].detail_zh`)))
      .filter((r): r is AssistRoutineItem => r !== null);
    if (routine.length > 0) modelPhases.add(pi);
    return {
      phase_id: sp.id as AssistPhaseId,
      from: sp.from,
      to: sp.to,
      focus_zh: zh(fromModel.focus_zh, 'phases[].focus_zh', `phases[${pi}].focus_zh`),
      routine: routine.length > 0 ? routine : [...DEFAULT_ROUTINES[sp.id]],
    };
  });
  c.meta.items_extra = raw.phases.filter((p) => !input.skeleton.phases.some((sp) => sp.id === p.phase_id)).length;

  const milestones: AssistReportMilestone[] = c
    .list(raw.milestones.filter((m) => m.week >= 1 && m.week <= W), 'milestones')
    .map((m, i) => ({
      week: m.week,
      kind: m.kind,
      detail_zh: zh(m.detail_zh, 'milestones[].detail_zh', `milestones[${i}].detail_zh`),
      rec_ref: candidateByRef.has(m.rec_ref.trim()) ? m.rec_ref.trim() : null,
    }))
    .filter((m) => m.detail_zh !== '')
    .sort((a, b) => a.week - b.week);

  const seenRefs = new Set<string>();
  const recommendations = c
    .list(
      raw.recommendations.filter((r) => candidateByRef.has(r.ref.trim()) && !seenRefs.has(r.ref.trim()) && seenRefs.add(r.ref.trim())),
      'recommendations',
    )
    .map((r, i) => ({ ref: r.ref.trim(), why_zh: zh(r.why_zh, 'recommendations[].why_zh', `recommendations[${i}].why_zh`), candidate: candidateByRef.get(r.ref.trim())! }));
  if (raw.recommendations.length > seenRefs.size) c.meta.codes_dropped += raw.recommendations.length - seenRefs.size;

  const body: AssistReportBody = {
    overview_zh: zh(raw.overview_zh, 'overview_zh', 'overview_zh'),
    strengths,
    weaknesses,
    error_patterns: errorPatterns,
    doubts,
    section_notes: sectionNotes,
    score_plan: scorePlan,
    phases,
    milestones,
    recommendations,
    // 第一版沒有「這一版改了什麼」。
    changes_zh: input.previous ? zhList(raw.changes_zh, 'changes_zh', 'changes_zh') : [],
    questions_zh: zhList(raw.questions_zh, 'questions_zh', 'questions_zh'),
    data_notes_zh: zh(raw.data_notes_zh, 'data_notes_zh', 'data_notes_zh'),
    safety_flag: raw.safety_flag,
    notices: c.notices,
    plan: buildPlan(input.skeleton, [], []),
  };

  // 整則英文 ≤ 200 個單詞：模型寫的每一個 _zh 欄位都登記（依畫面的順序），總數就是全部欄位的合計；超過時從最後一欄往前清
  // （報告沒有例句）。程式的欄位（facts、plan、候選、案例標題）與本站的預設菜單不算、也不清。
  const slots: Array<{ path: string; get: () => string; clear: () => void }> = [];
  const add = (path: string, obj: object, key: string) => {
    const o = obj as Record<string, unknown>;
    slots.push({ path, get: () => String(o[key] ?? ''), clear: () => (o[key] = '') });
  };
  const addList = (path: string, list: string[]) => list.forEach((_s, i) => slots.push({ path: `${path}[${i}]`, get: () => list[i] ?? '', clear: () => (list[i] = '') }));
  add('overview_zh', body, 'overview_zh');
  body.strengths.forEach((s, i) => add(`strengths[${i}].evidence_zh`, s, 'evidence_zh'));
  body.weaknesses.forEach((w, i) => {
    add(`weaknesses[${i}].evidence_zh`, w, 'evidence_zh');
    add(`weaknesses[${i}].explain_zh`, w, 'explain_zh');
  });
  body.error_patterns.forEach((p, i) => {
    add(`error_patterns[${i}].explain_zh`, p, 'explain_zh');
    add(`error_patterns[${i}].fix_zh`, p, 'fix_zh');
  });
  body.doubts.forEach((d, i) => add(`doubts[${i}].note_zh`, d, 'note_zh'));
  body.section_notes.forEach((n, i) => add(`section_notes[${i}].note_zh`, n, 'note_zh'));
  body.score_plan.forEach((p, i) => {
    add(`score_plan[${i}].action_zh`, p, 'action_zh');
    add(`score_plan[${i}].why_zh`, p, 'why_zh');
  });
  phases.forEach((p, i) => {
    add(`phases[${i}].focus_zh`, p, 'focus_zh');
    // 預設菜單（模型沒給這個階段）是本站的文字，而且是共用的常數，不登記。
    if (!modelPhases.has(i)) return;
    p.routine.forEach((r, j) => add(`phases[${i}].routine[${j}].detail_zh`, r, 'detail_zh'));
  });
  body.milestones.forEach((m, i) => add(`milestones[${i}].detail_zh`, m, 'detail_zh'));
  body.recommendations.forEach((r, i) => add(`recommendations[${i}].why_zh`, r, 'why_zh'));
  addList('changes_zh', body.changes_zh);
  addList('questions_zh', body.questions_zh);
  add('data_notes_zh', body, 'data_notes_zh');
  const total = () => slots.reduce((s, x) => s + outputEnglishWords(x.get()), 0);
  for (let i = slots.length - 1; i >= 0 && total() > REPORT_ENGLISH_MAX; i--) {
    const s = slots[i]!;
    if (outputEnglishWords(s.get()) === 0) continue;
    s.clear();
    c.meta.english_cleared += 1;
    c.notice('english_trimmed', s.path);
  }
  // 清空之後沒有內容的項目拿掉（和前面「空的不留」一致）；routine、focus、證據清空了項目照留（程式的份量與 facts 仍然有用）。
  body.changes_zh = body.changes_zh.filter((s) => s !== '');
  body.questions_zh = body.questions_zh.filter((s) => s !== '');
  body.doubts = body.doubts.filter((d) => d.note_zh !== '');
  body.section_notes = body.section_notes.filter((n) => n.note_zh !== '');
  body.score_plan = body.score_plan.filter((p) => p.action_zh !== '').map((p, i) => ({ ...p, priority: i + 1 }));
  body.milestones = body.milestones.filter((m) => m.detail_zh !== '');

  // 第 13 步：逐週份量（AI 的 routine 已對齊骨架）。
  body.plan = buildPlan(input.skeleton, phases, body.milestones);
  body.notices = c.notices;
  return {
    body,
    meta: { ...c.meta, predictions_removed: predictions },
    safety: raw.safety_flag,
    tainted: c.meta.filtered > 0 || c.meta.d8_hidden > 0,
  };
}
