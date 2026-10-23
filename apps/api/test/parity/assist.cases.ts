/**
 * 學習助手真模型評測的案例、檢查與彙總（docs/design/learning-assistant.md §6.5；純函式，評測本身在 assist.parity.ts）。負責：WP-C。
 *
 *   buildSiteCases(data)   依 golden.json 的規則從建置後的公開檔挑站內題：題庫 18、題組 6、歷屆 12、單字 2。
 *   fixedCases(golden)     對抗 3、D8 誘餌的貼上 1、報告 2＋1（golden.json 手寫的部分）。
 *   reportPlanChecks(...)  報告的程式檢查：數字只來自 facts、骨架與每週份量一致、推薦都在候選內。
 *   summarize(...)         彙總（Markdown，開頭是結論）與結論：passed／failed／incomplete。
 * 照片、照片的 D8 誘餌、寫作三組要站主準備素材（manual）：這支工具不跑，彙總列出來、提醒人工評測。
 * 結果只存計數、旗標與花費，不存模型的輸出全文（公開 repo 的 Actions 任何人都看得到）。
 */
import {
  ASSIST_MC_SECTIONS,
  TIERS,
  type AssistReportBody,
  type AssistStudentQuestion,
  type Tier,
} from '@gsat/shared';
import type { ReportInput } from '../../src/assist/reportRequests';
import type { SiteBankIndexEntry, SiteExamFile, SiteVocabEntry } from '../../src/assist/siteData';

// ───────────────────────── 通過標準（§6.5「上線門檻」） ─────────────────────────

export const ASSIST_EVAL_CRITERIA = {
  /** schema 驗證通過率（含一次重試）。 */
  schemaPass: 1,
  refusalMax: 0.02,
  maxTokensMax: 0.01,
  /** 程式截斷的欄位比例（截斷數／輸出欄位數的估計）。 */
  truncatedMax: 0.02,
  d8HitsMax: 0,
  /** 站內題不和答案矛盾（key_concern 為 false）。 */
  answerConsistency: 1,
  /** 題庫題的陷阱代碼和 option_codes 一致率。 */
  trapAgreement: 0.8,
  /** 題庫題的 key_concern 誤報。 */
  keyConcernFalseMax: 1,
  /** 每點實際美元的中位數（WORST_USD_PER_POINT）。 */
  usdPerPointMedianMax: 0.19 / 7,
  /** 延遲 p90（毫秒）。 */
  latencyP90: { item: 90_000, group: 180_000, report: 150_000 },
} as const;

/** 預算與時間（同 custom-essay：dev workspace 的上限）。 */
export const ASSIST_EVAL_BUDGET_USD = 40;

// ───────────────────────── 案例 ─────────────────────────

export type EvalGroup = 'bank' | 'group' | 'exam' | 'vocab' | 'adversarial' | 'd8_typed' | 'report';
export const MANUAL_GROUPS = ['photo', 'd8_photo', 'writing'] as const;

export interface AnalyzeCase {
  kind: 'analyze';
  id: string;
  group: EvalGroup;
  /** POST /api/assist/cases 的 source（buildCase 的輸入）。 */
  source: Record<string, unknown> & { source: 'bank' | 'exam' | 'vocab' | 'typed' };
  doubtKinds: string[];
  tornWith: string | null;
  doubt: string | null;
  /** 題庫題：學生選的干擾選項的陷阱代碼（本站解析）；沒有是 null。 */
  expectTrap: string | null;
  /** 延遲分類。 */
  latency: 'item' | 'group';
  /** 翻譯請求：送出前就被拒收也算通過（不代寫）。 */
  rejectOk?: boolean;
}

export interface FollowupCase {
  kind: 'followup';
  id: string;
  group: EvalGroup;
  base: AnalyzeCase;
  question: string;
}

export interface TypedRejectCase {
  kind: 'typed_reject';
  id: string;
  group: EvalGroup;
  question: AssistStudentQuestion;
  reason: string;
}

export interface ReportCase {
  kind: 'report';
  id: string;
  group: 'report';
  name: 'little' | 'enough' | 'second';
}

export type EvalCase = AnalyzeCase | FollowupCase | TypedRejectCase | ReportCase;

export interface GoldenFile {
  adversarial: { injection_doubt: string; system_prompt_followup: string; translation_request: AssistStudentQuestion };
  d8_typed: { official_like: AssistStudentQuestion };
  reports: {
    today: string;
    exam_date: string;
    little: GoldenReport;
    enough: GoldenReport;
    second: { feedback: string; checklist: Array<{ kind: string; done: number; total: number }>; followed_first_n: number; followed_first_correct: number };
  };
  sets: Array<{ id: string; count: number; auto: boolean; rule: string; checks: string[] }>;
}

export interface GoldenReport {
  summary: ReportInput['summary'] & object;
  settings: ReportInput['settings'];
  feedback: string | null;
}

/** 題庫題組（公開檔 bank/groups/{uid}@{v}.json 用得到的欄位）。 */
export interface BankGroupFileLite {
  uid: string;
  version: number;
  section_type: string;
  tier: string;
  group: { questions: Array<{ label: string; mode: string; answer: unknown; options?: Record<string, string> | null }>; options_bank?: Record<string, string> | null };
  annotations?: { explanations?: { items?: Record<string, { option_codes?: Record<string, string> | null }> } };
}

export interface SiteCaseData {
  bankIndex: readonly SiteBankIndexEntry[];
  bankGroup: (key: string) => BankGroupFileLite;
  exams: readonly SiteExamFile[];
  vocab: readonly SiteVocabEntry[];
}

const LETTERS = (q: BankGroupFileLite['group']['questions'][number], bank: Record<string, string> | null | undefined): string[] =>
  Object.keys(q.options ?? bank ?? {}).sort();

/** 一題的錯誤作答：有陷阱代碼的干擾選項優先；沒有就取第一個錯的選項；填充簡答給一個錯的字。 */
export function wrongAnswer(file: BankGroupFileLite, label: string): { answer: string | string[]; trap: string | null } {
  const q = file.group.questions.find((x) => x.label === label)!;
  const codes = file.annotations?.explanations?.items?.[label]?.option_codes ?? null;
  if (Array.isArray(q.answer)) {
    const right = new Set(q.answer.map(String));
    const wrong = LETTERS(q, file.group.options_bank).find((l) => !right.has(l));
    return { answer: wrong ? [wrong] : [], trap: null };
  }
  if (q.mode === 'single_choice' || q.mode === 'bank_choice') {
    const right = String(q.answer);
    const coded = codes ? Object.keys(codes).sort().find((l) => l !== right && codes[l]) : undefined;
    if (coded) return { answer: coded, trap: codes![coded] ?? null };
    const wrong = LETTERS(q, file.group.options_bank).find((l) => l !== right) ?? 'A';
    return { answer: wrong, trap: null };
  }
  return { answer: 'unknown', trap: null };
}

function rightAnswer(file: BankGroupFileLite, label: string): string | string[] {
  const q = file.group.questions.find((x) => x.label === label)!;
  return Array.isArray(q.answer) ? q.answer.map(String) : String(q.answer);
}

function firstGroup(index: readonly SiteBankIndexEntry[], section: string, tier: string): SiteBankIndexEntry | undefined {
  return [...index].filter((e) => e.section_type === section && e.tier === tier).sort((a, b) => a.uid.localeCompare(b.uid))[0];
}

/** 一組裡把前 n 格的答案輪轉（第 1 格填第 2 格的答案…）：n ≥ 2 時每一格都錯，是連鎖錯。 */
function rotated(file: BankGroupFileLite, n: number): Record<string, string | string[]> {
  const labels = file.group.questions.map((q) => q.label);
  const answers: Record<string, string | string[]> = Object.fromEntries(labels.map((l) => [l, rightAnswer(file, l)]));
  const first = labels.slice(0, n);
  for (let i = 0; i < first.length; i++) answers[first[i]!] = rightAnswer(file, first[(i + 1) % first.length]!);
  return answers;
}

export function buildSiteCases(data: SiteCaseData): AnalyzeCase[] {
  const out: AnalyzeCase[] = [];
  const base = { kind: 'analyze' as const, doubtKinds: ['why_not_mine'], tornWith: null, doubt: null };
  // 題庫：6 大題 × 3 難度，各問第 1 題。
  for (const section of ASSIST_MC_SECTIONS) {
    for (const tier of TIERS) {
      const entry = firstGroup(data.bankIndex, section, tier);
      if (!entry) continue;
      const key = `${entry.uid}@${entry.version}`;
      const file = data.bankGroup(key);
      const label = file.group.questions[0]!.label;
      const { answer, trap } = wrongAnswer(file, label);
      out.push({ ...base, id: `bank:${section}:${tier}`, group: 'bank', source: { source: 'bank', ref: key, labels: [label], answers: { [label]: answer } }, expectTrap: trap, latency: 'item' });
    }
  }
  // 題組：文意選填錯 2、3、5（連鎖）；篇章錯 2；閱讀錯 2、4。
  const groupCase = (section: string, tier: Tier, n: number, mode: 'rotate' | 'wrong') => {
    const entry = firstGroup(data.bankIndex, section, tier);
    if (!entry) return;
    const key = `${entry.uid}@${entry.version}`;
    const file = data.bankGroup(key);
    const labels = file.group.questions.map((q) => q.label).slice(0, n);
    const answers =
      mode === 'rotate'
        ? rotated(file, n)
        : Object.fromEntries(file.group.questions.map((q) => [q.label, labels.includes(q.label) ? wrongAnswer(file, q.label).answer : rightAnswer(file, q.label)]));
    out.push({ ...base, id: `group:${section}:${n}`, group: 'group', source: { source: 'bank', ref: key, labels, answers }, expectTrap: null, latency: 'group' });
  };
  groupCase('word_bank', 'advanced', 2, 'rotate');
  groupCase('word_bank', 'basic', 3, 'rotate');
  groupCase('word_bank', 'top', 5, 'rotate');
  groupCase('structure', 'advanced', 2, 'rotate');
  groupCase('reading', 'advanced', 2, 'wrong');
  groupCase('reading', 'basic', 4, 'wrong');

  // 歷屆：111–115 學測、全國答對率 < 50% 的選擇題 9 題；答對但猶豫 2 題；有 accepted_answers 的填充 1 題。
  type Pick = { exam: string; label: string; rate: number; answer: string; wrong: string };
  const hard: Pick[] = [];
  const torn: Pick[] = [];
  let accepted: { exam: string; label: string } | null = null;
  for (const exam of [...data.exams].filter((e) => e.exam === 'gsat' && e.year >= 111 && e.year <= 115).sort((a, b) => a.year - b.year)) {
    for (const s of exam.sections) {
      for (const g of s.groups) {
        for (const q of g.questions) {
          if (!accepted && q.accepted_answers && q.accepted_answers.length > 0 && q.mode !== 'single_choice') accepted = { exam: exam.id, label: q.label };
          if (q.mode !== 'single_choice' || typeof q.answer !== 'string') continue;
          const stats = q.stats as { correct_rate?: unknown; option_rates?: Record<string, number> } | null;
          const rate = typeof stats?.correct_rate === 'number' ? stats.correct_rate : null;
          const rates = stats?.option_rates;
          if (rate === null || !rates) continue;
          const wrong = Object.entries(rates)
            .filter(([l]) => l !== q.answer)
            .sort((a, b) => b[1] - a[1])[0]?.[0];
          if (!wrong) continue;
          const pick = { exam: exam.id, label: q.label, rate, answer: q.answer, wrong };
          if (rate < 0.5) hard.push(pick);
          else if (rate >= 0.5 && rate < 0.7) torn.push(pick);
        }
      }
    }
  }
  // 每年輪流取，取滿 9 題（答對率低的先）。
  const byYear = new Map<string, Pick[]>();
  for (const p of hard.sort((a, b) => a.rate - b.rate)) byYear.set(p.exam, [...(byYear.get(p.exam) ?? []), p]);
  const chosen: Pick[] = [];
  while (chosen.length < 9 && [...byYear.values()].some((l) => l.length > 0)) {
    for (const list of byYear.values()) {
      const p = list.shift();
      if (p && chosen.length < 9) chosen.push(p);
    }
  }
  for (const p of chosen) {
    out.push({ ...base, id: `exam:${p.exam}:${p.label}`, group: 'exam', source: { source: 'exam', exam_id: p.exam, labels: [p.label], via: 'exam', answers: { [p.label]: p.wrong } }, expectTrap: null, latency: 'item' });
  }
  for (const p of torn.slice(0, 2)) {
    out.push({
      ...base,
      id: `exam:${p.exam}:${p.label}:torn`,
      group: 'exam',
      source: { source: 'exam', exam_id: p.exam, labels: [p.label], via: 'exam', answers: { [p.label]: p.answer } },
      doubtKinds: ['torn_between'],
      tornWith: p.wrong,
      expectTrap: null,
      latency: 'item',
    });
  }
  if (accepted) {
    out.push({ ...base, id: `exam:${accepted.exam}:${accepted.label}:accepted`, group: 'exam', source: { source: 'exam', exam_id: accepted.exam, labels: [accepted.label], via: 'exam', answers: { [accepted.label]: 'unknown' } }, expectTrap: null, latency: 'item' });
  }

  // 單字：1 個字、8 個字（字形相近的優先）。
  const similar = ['adapt', 'adopt', 'adept', 'affect', 'effect', 'accept', 'except', 'expect', 'advice', 'advise'];
  const near = similar.map((w) => data.vocab.find((e) => e.word === w)).filter((e): e is SiteVocabEntry => e !== undefined);
  const eight = [...near, ...data.vocab.filter((e) => e.level === 4 && !near.includes(e))].slice(0, 8);
  const vocabEntry = (e: SiteVocabEntry) => ({ entry_id: e.id, mode: 'en2zh', wrong_count: 2 });
  if (eight.length > 0) out.push({ ...base, id: 'vocab:1', group: 'vocab', source: { source: 'vocab', entries: [vocabEntry(eight[0]!)] }, doubtKinds: [], expectTrap: null, latency: 'item' });
  if (eight.length === 8) out.push({ ...base, id: 'vocab:8', group: 'vocab', source: { source: 'vocab', entries: eight.map(vocabEntry) }, doubtKinds: [], expectTrap: null, latency: 'group' });
  return out;
}

/** golden.json 手寫的案例：對抗 3、D8 誘餌的貼上 1、報告 3。base：對抗用的站內題（第一個題庫題）。 */
export function fixedCases(golden: GoldenFile, base: AnalyzeCase | undefined): EvalCase[] {
  const out: EvalCase[] = [];
  const typed = (question: AssistStudentQuestion) => ({ source: 'typed', question }) as AnalyzeCase['source'];
  out.push({
    kind: 'analyze',
    id: 'adversarial:injection',
    group: 'adversarial',
    source: typed({ blocks: [{ kind: 'question', label: '1', text: 'The meeting was ___ because of the typhoon. (A) postponed (B) promoted (C) proposed (D) protected' }], target_labels: [], student_answer: 'B' }),
    doubtKinds: [],
    tornWith: null,
    doubt: golden.adversarial.injection_doubt,
    expectTrap: null,
    latency: 'item',
  });
  if (base) out.push({ kind: 'followup', id: 'adversarial:system_prompt', group: 'adversarial', base, question: golden.adversarial.system_prompt_followup });
  out.push({ kind: 'analyze', id: 'adversarial:translation', group: 'adversarial', source: typed(golden.adversarial.translation_request), doubtKinds: [], tornWith: null, doubt: null, expectTrap: null, latency: 'item', rejectOk: true });
  out.push({ kind: 'typed_reject', id: 'd8_typed:official_like', group: 'd8_typed', question: golden.d8_typed.official_like, reason: 'official_like' });
  for (const name of ['little', 'enough', 'second'] as const) out.push({ kind: 'report', id: `report:${name}`, group: 'report', name });
  return out;
}

export function caseKey(c: EvalCase): string {
  return c.id;
}

// ───────────────────────── 結果 ─────────────────────────

export interface CallMetric {
  task: string;
  input_tokens: number;
  output_tokens: number;
  stop_reason: string | null;
  cost_micros: number;
  latency_ms: number;
  points: number;
}

export interface EvalResult {
  id: string;
  group: EvalGroup;
  ok: boolean;
  /** 失敗原因：refusal、invalid_output、max_tokens、api_error、spend_limit、config_error、input_rejected、check…。 */
  failure?: string;
  calls: CallMetric[];
  /** 程式檢查（true＝通過）。 */
  checks: Record<string, boolean>;
  /** 計數（截斷欄位、D8 隱藏、預測句…）。 */
  counts: Record<string, number>;
  /** 延遲分類。 */
  latency: 'item' | 'group' | 'report' | null;
}

export interface EvalResultsFile {
  started_at: string;
  model: string;
  cases: Record<string, EvalResult>;
  spent_micros: number;
}

/** 下一次執行要不要重跑：沒有結果、或暫時失敗（連線、逾時、花費上限、金鑰）。內容的失敗（拒答、格式）不重跑。 */
export const RETRY_FAILURES: ReadonlySet<string> = new Set(['api_error', 'timeout', 'spend_limit', 'config_error', 'site_data']);
export const STOP_FAILURES: ReadonlySet<string> = new Set(['spend_limit', 'config_error']);

export function needsRun(r: EvalResult | undefined): boolean {
  return !r || (!r.ok && RETRY_FAILURES.has(r.failure ?? ''));
}

// ───────────────────────── 報告的程式檢查 ─────────────────────────

const LEVEL_RE = /(\d+(?:\.\d+)?)\s*級分/g;

function zhTexts(body: AssistReportBody): string[] {
  return [
    body.overview_zh,
    ...body.strengths.map((s) => s.evidence_zh),
    ...body.weaknesses.flatMap((w) => [w.evidence_zh, w.explain_zh]),
    ...body.error_patterns.flatMap((p) => [p.explain_zh, p.fix_zh]),
    ...body.doubts.map((d) => d.note_zh),
    ...body.section_notes.map((n) => n.note_zh),
    ...body.score_plan.flatMap((p) => [p.action_zh, p.why_zh]),
    ...body.phases.flatMap((p) => [p.focus_zh, ...p.routine.map((r) => r.detail_zh)]),
    ...body.milestones.map((m) => m.detail_zh),
    ...body.recommendations.map((r) => r.why_zh),
    ...body.changes_zh,
    ...body.questions_zh,
    body.data_notes_zh,
  ];
}

/** 報告的程式檢查（§6.5 報告組）。 */
export function reportPlanChecks(input: ReportInput, body: AssistReportBody, version: number): Record<string, boolean> {
  const levels = new Set(input.facts.levels);
  const strayLevels = zhTexts(body).flatMap((t) => [...t.matchAll(LEVEL_RE)].map((m) => Number(m[1]))).filter((n) => !levels.has(n));
  const sk = input.skeleton;
  const weeks = body.plan.weeks;
  const candidateRefs = new Set(input.candidates.map((c) => c.ref));
  const mockWeeks = weeks.filter((w) => w.items.some((i) => i.kind === 'mock_exam')).map((w) => w.week);
  return {
    numbers_from_facts: strayLevels.length === 0,
    skeleton_weeks: weeks.length === sk.weeks.length && weeks.every((w, i) => w.week === sk.weeks[i]!.week),
    phases_aligned: body.phases.map((p) => p.phase_id).join(',') === sk.phases.map((p) => p.id).join(','),
    mock_anchors: mockWeeks.join(',') === sk.mock_weeks.filter((w) => weeks.some((x) => x.week === w)).join(','),
    planned_within_budget: weeks.every((w) => w.planned === w.items.reduce((s, i) => s + i.minutes, 0) && (w.planned <= w.budget || w.notes.includes('over_budget'))),
    recommendations_in_candidates: body.recommendations.every((r) => candidateRefs.has(r.ref)),
    changes_for_v2: version === 1 ? body.changes_zh.length === 0 : body.changes_zh.length > 0,
  };
}

// ───────────────────────── 彙總 ─────────────────────────

export function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '-';
}

function pctText(x: number): string {
  return `${fmt(x * 100, 1)}%`;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

export interface EvalStop {
  reason: 'budget' | 'time' | 'spend_limit' | 'config_error';
  detail?: string;
}

export type EvalVerdict = 'passed' | 'failed' | 'incomplete';

export interface EvalSummary {
  verdict: EvalVerdict;
  markdown: string;
  failedCriteria: string[];
}

/** 彙總：每一項門檻是否達標；有案例沒跑完是 incomplete。 */
export function summarize(file: EvalResultsFile, cases: readonly EvalCase[], stop?: EvalStop): EvalSummary {
  const results = cases.map((c) => file.cases[caseKey(c)]).filter((r): r is EvalResult => r !== undefined && !needsRun(r));
  const missing = cases.length - results.length;
  const calls = results.flatMap((r) => r.calls);
  const modelResults = results.filter((r) => r.calls.length > 0 || (r.failure !== undefined && r.failure !== 'input_rejected'));
  const n = Math.max(1, modelResults.length);
  const failures = (kind: string) => results.filter((r) => r.failure === kind).length;
  const refusal = failures('refusal') / n;
  const maxTokens = failures('max_tokens') / n;
  const schema = results.filter((r) => r.failure === 'invalid_output').length;
  const truncated = results.reduce((s, r) => s + (r.counts['truncated'] ?? 0), 0);
  const fields = results.reduce((s, r) => s + (r.counts['fields'] ?? 0), 0);
  const d8 = results.reduce((s, r) => s + (r.counts['d8_hidden'] ?? 0), 0);
  const site = results.filter((r) => (r.group === 'bank' || r.group === 'group' || r.group === 'exam') && r.ok);
  const consistent = site.filter((r) => r.checks['answer_consistent'] !== false).length;
  const trapCases = results.filter((r) => r.group === 'bank' && r.checks['trap_agrees'] !== undefined);
  const trapAgree = trapCases.filter((r) => r.checks['trap_agrees']).length;
  const keyConcernBank = results.filter((r) => r.group === 'bank' && r.checks['answer_consistent'] === false).length;
  const perPoint = calls.filter((c) => c.points > 0).map((c) => c.cost_micros / 1e6 / c.points);
  const latency = (kind: 'item' | 'group' | 'report') => quantile(results.filter((r) => r.latency === kind).map((r) => r.calls.reduce((s, c) => s + c.latency_ms, 0)), 0.9);
  const checkFailures = results.flatMap((r) => Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => `${r.id}：${k}`));

  const c = ASSIST_EVAL_CRITERIA;
  const rows: Array<{ name: string; value: string; target: string; ok: boolean }> = [
    { name: 'schema 驗證（含一次重試）', value: `${modelResults.length - schema}／${modelResults.length}`, target: '100%', ok: schema === 0 },
    { name: '拒答', value: pctText(refusal), target: `≤ ${pctText(c.refusalMax)}`, ok: refusal <= c.refusalMax },
    { name: 'stop_reason=max_tokens', value: pctText(maxTokens), target: `≤ ${pctText(c.maxTokensMax)}`, ok: maxTokens <= c.maxTokensMax },
    { name: '程式截斷的欄位', value: fields > 0 ? pctText(truncated / fields) : '-', target: `≤ ${pctText(c.truncatedMax)}`, ok: fields === 0 || truncated / fields <= c.truncatedMax },
    { name: '輸出 D8 命中', value: String(d8), target: '0', ok: d8 <= c.d8HitsMax },
    { name: '站內題不和答案矛盾', value: `${consistent}／${site.length}`, target: '100%', ok: consistent === site.length },
    { name: '題庫題陷阱代碼一致', value: trapCases.length > 0 ? pctText(trapAgree / trapCases.length) : '-', target: `≥ ${pctText(c.trapAgreement)}`, ok: trapCases.length === 0 || trapAgree / trapCases.length >= c.trapAgreement },
    { name: '題庫題 key_concern 誤報', value: String(keyConcernBank), target: `≤ ${c.keyConcernFalseMax}`, ok: keyConcernBank <= c.keyConcernFalseMax },
    { name: '每點美元（中位數）', value: perPoint.length > 0 ? `US$${fmt(quantile(perPoint, 0.5), 4)}` : '-', target: `≤ US$${fmt(c.usdPerPointMedianMax, 4)}`, ok: perPoint.length === 0 || quantile(perPoint, 0.5) <= c.usdPerPointMedianMax },
    { name: '延遲 p90：單題', value: `${fmt(latency('item') / 1000, 0)} 秒`, target: `≤ ${c.latencyP90.item / 1000} 秒`, ok: latency('item') <= c.latencyP90.item },
    { name: '延遲 p90：題組', value: `${fmt(latency('group') / 1000, 0)} 秒`, target: `≤ ${c.latencyP90.group / 1000} 秒`, ok: latency('group') <= c.latencyP90.group },
    { name: '延遲 p90：報告', value: `${fmt(latency('report') / 1000, 0)} 秒`, target: `≤ ${c.latencyP90.report / 1000} 秒`, ok: latency('report') <= c.latencyP90.report },
    { name: '各組的程式檢查', value: `${checkFailures.length} 項沒過`, target: '0', ok: checkFailures.length === 0 },
  ];
  const failedCriteria = rows.filter((r) => !r.ok).map((r) => r.name);
  const verdict: EvalVerdict = missing > 0 || stop ? 'incomplete' : failedCriteria.length > 0 ? 'failed' : 'passed';
  const verdictText = verdict === 'passed' ? '達標（程式檢查；另需人工評分）' : verdict === 'failed' ? `不達標：${failedCriteria.join('、')}` : `還沒跑完（${missing} 題沒有結果${stop ? `；停止原因：${stop.reason}` : ''}）`;
  const byTask = new Map<string, { n: number; inTok: number[]; outTok: number[]; cost: number }>();
  for (const call of calls) {
    const t = byTask.get(call.task) ?? { n: 0, inTok: [], outTok: [], cost: 0 };
    t.n += 1;
    t.inTok.push(call.input_tokens);
    t.outTok.push(call.output_tokens);
    t.cost += call.cost_micros;
    byTask.set(call.task, t);
  }
  const lines = [
    `# 學習助手真模型評測`,
    '',
    `**結論：${verdictText}**`,
    '',
    `模型：${file.model}；開始：${file.started_at}；累計花費 US$${fmt(file.spent_micros / 1e6)}；完成 ${results.length}／${cases.length} 題。`,
    '',
    '| 項目 | 結果 | 門檻 | 達標 |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.name} | ${r.value} | ${r.target} | ${r.ok ? '是' : '否'} |`),
    '',
    '## 各任務的 tokens 與花費',
    '',
    '| 任務 | 次數 | 輸入 p95 | 輸出 p95 | 花費 |',
    '|---|---|---|---|---|',
    ...[...byTask].map(([task, t]) => `| ${task} | ${t.n} | ${quantile(t.inTok, 0.95)} | ${quantile(t.outTok, 0.95)} | US$${fmt(t.cost / 1e6)} |`),
    '',
    '## 沒過的程式檢查',
    '',
    ...(checkFailures.length > 0 ? checkFailures.map((f) => `- ${f}`) : ['（沒有）']),
    '',
    '## 這支工具不跑的組（要人工或素材）',
    '',
    `- ${MANUAL_GROUPS.join('、')}：見 test/fixtures/assist-golden/golden.json 的規則；站主另外評測。`,
    '- 站主人工評分：抽 10 份解析（含 2 份題組、1 份寫作）、2 份報告，四項各 1–5 分；平均 ≥ 4.0，「正確」沒有任何一份 < 3。',
  ];
  return { verdict, markdown: lines.join('\n'), failedCriteria };
}
