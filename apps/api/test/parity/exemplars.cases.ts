/**
 * 作文範文真模型評測的案例、門檻與彙總（docs/design/model-essays.md §9.6；純函式，評測本身在 exemplars.parity.ts）。
 *
 *   buildCases(golden, opts)  題目集（test/fixtures/exemplars-golden/golden.json）→ B–F 組的案例（effort_sweep 時多 G 組）；
 *                             opts.only 只留指定的題目（題目 id 或組別字母；RUN 檔與 dispatch 的 cases）。
 *   needsRun(result)          下次執行要不要重跑（沒有結果、暫時失敗、批改時暫時失敗）。
 *   summarize(file, cases)    彙總（Markdown，開頭是結論）與結論：passed／failed／incomplete／partial／probe_passed。
 *
 * 這個 repo 是公開的：結果與彙總只有代碼、計數、字數、分數、tokens、花費與延遲，不存範文、說明、常見的錯或題目的文字，也不寫模型名稱。
 * 「常見的錯」只記則數；逐則確認由站主在正式站的管理員預覽做（§12.2）。
 */
import { ESSAY_CRITERIA, EXEMPLAR_LEVELS, type CustomEssayPromptInput, type EssayCriterion, type ExemplarLevel } from '@gsat/shared';

// ───────────────────────── 門檻（§9.6「上線門檻」） ─────────────────────────

export const EXEMPLAR_EVAL_CRITERIA = {
  /** stop_reason=max_tokens 的次數上限（B–F 的產生呼叫）。 */
  maxTokensMax: 1,
  refusalMax: 0,
  /** 字數在目標範圍的比例（B–D 的最後結果）。 */
  wordsTargetMin: 0.85,
  /** 層級：本站批改的最後分數。至少 12/14 題（題數不是 14 時等比例、無條件進位）。 */
  levels: {
    basic: { min: 10, max: 14, medianMax: 13 },
    steady: { min: 14, max: 17 },
    top: { min: 18, max: 20 },
    adjacentDiff: 2,
    share: 12 / 14,
  },
  /** 亮點引文找得到的比例。 */
  highlightsFoundMin: 0.9,
  /** 每點實際美元的中位數（WORST_USD_PER_POINT；8 點即每份 ≤ US$0.217）。 */
  usdPerPointMedianMax: 0.0271,
  outputTokensP95Max: 14_000,
  inputTokensP95Max: 5_000,
  latencyP90Ms: 180_000,
  /** 第一次呼叫在這個時間內結束才會在同一次投遞裡重試（§3.1；只記比例，不是門檻）。 */
  firstCallWithinMs: 120_000,
} as const;

/** 預算（累計，含之前中斷的那幾次）與每一題開始前要留的花費（典型的一題：產生約 0.18＋批改三篇約 0.57）。 */
export const EXEMPLAR_EVAL_BUDGET_USD = 15;
export const CASE_RESERVE_MICROS = 800_000;
export const EXEMPLAR_POINTS = 8;

// ───────────────────────── 題目集 ─────────────────────────

export type EvalGroup = 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
/** 上線門檻的分數與字數只看這三組（共 14 題）。 */
export const GATE_GROUPS: readonly EvalGroup[] = ['B', 'C', 'D'];
export const GROUP_LABELS: Record<'A' | EvalGroup, string> = {
  A: '輸出格式編譯',
  B: '歷屆題',
  C: '本站仿真題',
  D: '自訂題',
  E: '不是寫作題',
  F: '對抗',
  G: 'effort 比較',
};

export interface GoldenSite {
  id: string;
  uid: string;
  note: string;
}

/** F 組的程式檢查（exemplars.runner.ts 計算）。 */
export const ADVERSARIAL_CHECKS = ['no_system_prompt', 'injection_flagged', 'site_targets'] as const;
export type AdversarialCheck = (typeof ADVERSARIAL_CHECKS)[number];

export interface GoldenCustom {
  id: string;
  note: string;
  prompt: CustomEssayPromptInput;
  /** 只有 F 組：這一題要過的程式檢查。 */
  checks?: AdversarialCheck[];
}

export interface GoldenFile {
  format: 'gsat-exemplars-golden/v1';
  description: string;
  probe: { uid: string; note: string };
  exam: GoldenSite[];
  bank: GoldenSite[];
  custom: GoldenCustom[];
  not_writing: GoldenCustom[];
  adversarial: GoldenCustom[];
  effort_sweep: { effort: 'low' | 'medium' | 'high'; ids: string[]; note: string };
}

export type EvalCase =
  | { kind: 'site'; key: string; id: string; group: 'B' | 'C' | 'G'; uid: string; effort: string | null }
  | { kind: 'custom'; key: string; id: string; group: 'D' | 'E' | 'F'; prompt: CustomEssayPromptInput; checks: AdversarialCheck[] };

/** 全部案例（B–F；effortSweep 時多 G）。key 是「組別:id」，結果檔用它當鍵。 */
export function allCases(golden: GoldenFile, effortSweep: boolean): EvalCase[] {
  const site = (group: 'B' | 'C', s: GoldenSite): EvalCase => ({ kind: 'site', key: `${group}:${s.id}`, id: s.id, group, uid: s.uid, effort: null });
  const custom = (group: 'D' | 'E' | 'F', c: GoldenCustom): EvalCase => ({ kind: 'custom', key: `${group}:${c.id}`, id: c.id, group, prompt: c.prompt, checks: c.checks ?? [] });
  const out: EvalCase[] = [
    ...golden.exam.map((s) => site('B', s)),
    ...golden.bank.map((s) => site('C', s)),
    ...golden.custom.map((c) => custom('D', c)),
    ...golden.not_writing.map((c) => custom('E', c)),
    ...golden.adversarial.map((c) => custom('F', c)),
  ];
  if (effortSweep) {
    for (const id of golden.effort_sweep.ids) {
      const s = golden.exam.find((x) => x.id === id);
      if (s) out.push({ kind: 'site', key: `G:${s.id}`, id: s.id, group: 'G', uid: s.uid, effort: golden.effort_sweep.effort });
    }
  }
  return out;
}

/**
 * 依 only（題目 id、「組別:id」或組別字母）挑案例；空陣列＝全部。回傳不認得的項目（workflow 在花錢之前就失敗）。
 * 只寫 id 時 B 組與 G 組同名的題目都會選到（G 組只有 effort_sweep 時才存在）。
 */
export function buildCases(golden: GoldenFile, opts: { effortSweep: boolean; only: readonly string[] }): { cases: EvalCase[]; unknown: string[] } {
  const all = allCases(golden, opts.effortSweep);
  if (opts.only.length === 0) return { cases: all, unknown: [] };
  const unknown: string[] = [];
  const picked = new Set<string>();
  for (const raw of opts.only) {
    const sel = raw.trim();
    // A 組一定先跑，寫不寫都一樣。
    if (sel === 'A') continue;
    const hits = all.filter((c) => (/^[B-G]$/.test(sel) ? c.group === sel : c.id === sel || c.key === sel));
    if (hits.length === 0) unknown.push(sel);
    for (const c of hits) picked.add(c.key);
  }
  return { cases: all.filter((c) => picked.has(c.key)), unknown };
}

// ───────────────────────── 結果 ─────────────────────────

export interface CallMetric {
  /** 輸入 tokens（含快取讀寫）。 */
  input_tokens: number;
  output_tokens: number;
  stop_reason: string | null;
  cost_micros: number;
  latency_ms: number;
}

export interface ProbeResult {
  ok: boolean;
  /** max_tokens、ok、invalid、refusal（通過）；http_400、http_400:schema、timeout…（不通過）。 */
  code: string;
  call: CallMetric | null;
}

export interface LevelResult {
  level: ExemplarLevel;
  /** 被隱藏的原因（d8、task_copy、filtered）；沒有隱藏是 null。 */
  hidden: string | null;
  words: number;
  paragraphs: number;
  target: [number, number];
  hard: [number, number];
  connective_kinds: number;
  /** 留下來的亮點則數。 */
  highlights: number;
  /** 本站作文批改的最後分數（0–20）；沒有批改（隱藏、沒有評分的組）或批改失敗是 null。 */
  score: number | null;
  criteria: Record<EssayCriterion, number> | null;
  /** 批改失敗的代碼。 */
  grade_failure?: string;
}

export interface CaseResult {
  key: string;
  id: string;
  group: EvalGroup;
  /** 產生成功（等同 consumer 結算成 done）。 */
  ok: boolean;
  /** 失敗代碼：refusal、invalid_output、max_tokens、word_count、api_error、input_rejected、site_data…。 */
  failure?: string;
  /** 每一次產生的結果代碼（ok、max_tokens、invalid、refusal、word_count、paragraphs…；最多 2 次內容失敗，§3.6）。 */
  attempts: string[];
  /** 產生的呼叫（批改不算在這裡）。 */
  calls: CallMetric[];
  grade_cost_micros: number;
  /** 輸入規則擋下的原因代碼（沒有呼叫模型）。 */
  input_rejected?: string;
  /** 自訂題被判成不是英文寫作題。 */
  not_writing?: boolean;
  /** 自訂題和網站題目相同（正式站會先回 409，評測照樣產生）。 */
  site_match?: boolean;
  /** 自訂題的注入旗標代碼（customPromptFlagCodes）。 */
  injection_flags?: string[];
  paragraphs_required: number | null;
  levels: LevelResult[];
  /** 後處理的計數（output.ts 的 ExemplarCounts）。 */
  counts: Record<string, number>;
  /** 留下來的常見的錯則數。 */
  typical_errors: number;
  /** exemplarDoneRow 的 output_json、meta_json 長度（D1 的 CHECK）。 */
  sizes: { output_json: number; meta_json: number } | null;
  /** exemplarDoneRow 不通過的代碼。 */
  row_problem?: string;
  /** 程式檢查（true＝通過）。 */
  checks: Record<string, boolean>;
  safety?: string;
  effort?: string;
}

export interface ResultsFile {
  started_at: string;
  /** 系統提示、schema、層級、範本、模型與 effort 的雜湊：變了就從頭跑（不存模型名稱）。 */
  fingerprint: string;
  probe: ProbeResult | null;
  cases: Record<string, CaseResult>;
  spent_micros: number;
}

/** 暫時失敗（下次重跑）；STOP_FAILURES 另外讓這次停下來。內容的失敗（拒答、格式、字數）不重跑。 */
export const RETRY_FAILURES: ReadonlySet<string> = new Set(['api_error', 'timeout', 'spend_limit', 'config_error', 'site_data']);
export const STOP_FAILURES: ReadonlySet<string> = new Set(['spend_limit', 'config_error']);

export function needsRun(r: CaseResult | undefined): boolean {
  if (!r) return true;
  if (!r.ok && RETRY_FAILURES.has(r.failure ?? '')) return true;
  // 批改時暫時失敗：範文全文不存，只能整題重跑。
  return r.levels.some((l) => l.grade_failure !== undefined && RETRY_FAILURES.has(l.grade_failure));
}

// ───────────────────────── 統計 ─────────────────────────

export function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '-';
}

function pctText(x: number): string {
  return `${fmt(x * 100, 1)}%`;
}

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!;
}

/** 中位數（偶數個取中間兩個的平均）。 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 「至少 12/14 題」換算成這次的題數（無條件進位）。 */
export function requiredCount(n: number): number {
  return Math.ceil(n * EXEMPLAR_EVAL_CRITERIA.levels.share - 1e-9);
}

const CONTENT_SHAPE_PROBLEMS = new Set(['word_count']);
const PARAGRAPH_PROBLEMS = new Set(['paragraphs', 'paragraphs_differ']);

function levelOf(r: CaseResult, level: ExemplarLevel): LevelResult | undefined {
  return r.levels.find((l) => l.level === level);
}

/** 一題的層級檢查（每一級的分數帶、相鄰兩級差）。分數缺一級就不算通過。 */
export function levelChecks(r: CaseResult): { basic: boolean; steady: boolean; top: boolean; adjacent: boolean } {
  const L = EXEMPLAR_EVAL_CRITERIA.levels;
  const s = (level: ExemplarLevel) => levelOf(r, level)?.score ?? null;
  const [b, st, t] = [s('basic'), s('steady'), s('top')];
  return {
    basic: b !== null && b >= L.basic.min && b <= L.basic.max,
    steady: st !== null && st >= L.steady.min && st <= L.steady.max,
    top: t !== null && t >= L.top.min,
    adjacent: b !== null && st !== null && t !== null && st - b >= L.adjacentDiff && t - st >= L.adjacentDiff,
  };
}

// ───────────────────────── 彙總 ─────────────────────────

export interface EvalStop {
  reason: 'budget' | 'time' | 'spend_limit' | 'config_error' | 'probe_failed';
}

export type EvalVerdict = 'passed' | 'failed' | 'incomplete' | 'partial' | 'probe_passed';

export interface SummaryRow {
  name: string;
  value: string;
  target: string;
  ok: boolean;
}

export interface EvalSummary {
  verdict: EvalVerdict;
  markdown: string;
  failedCriteria: string[];
  rows: SummaryRow[];
}

export interface SummarizeOptions {
  mode: 'full' | 'probe';
  /** 只跑了指定的題目（RUN 檔或 dispatch 的 cases）。 */
  subset: boolean;
  stop?: EvalStop;
}

/** 每一題的「這一組的檢查」：E 組判成不是寫作題（或輸入規則先擋下）、F 組的程式檢查。 */
function groupCaseOk(r: CaseResult): boolean {
  if (r.group === 'E') return r.input_rejected !== undefined || r.not_writing === true;
  if (r.group === 'F') return r.ok && Object.values(r.checks).every(Boolean);
  return r.ok && Object.values(r.checks).every(Boolean);
}

/** 彙總：每一項門檻是否達標。見檔頭的結論種類。 */
export function summarize(file: ResultsFile, cases: readonly EvalCase[], opts: SummarizeOptions): EvalSummary {
  const C = EXEMPLAR_EVAL_CRITERIA;
  const probe = file.probe;
  const probeRow: SummaryRow = { name: 'A 組：輸出格式編譯（max_tokens 64）', value: probe ? probe.code : '沒有跑', target: '不是 400', ok: probe?.ok === true };
  const header = (verdictText: string, rows: SummaryRow[], extra: string[]) =>
    [
      '# 作文範文真模型評測',
      '',
      `**結論：${verdictText}**`,
      '',
      `模型：AI_MODEL_DEFAULT（wrangler.toml 與程式預設值）；開始：${file.started_at}；累計花費 US$${fmt(file.spent_micros / 1e6)}；設定雜湊 ${file.fingerprint.slice(0, 12)}。`,
      '',
      '| 項目 | 結果 | 門檻 | 達標 |',
      '|---|---|---|---|',
      ...rows.map((r) => `| ${r.name} | ${r.value} | ${r.target} | ${r.ok ? '是' : '否'} |`),
      ...extra,
    ].join('\n');

  if (!probe?.ok || opts.mode === 'probe') {
    const verdict: EvalVerdict = probe?.ok ? 'probe_passed' : 'failed';
    const text = probe?.ok
      ? '只跑 A 組：輸出格式編譯得過（schema 或提示有改動時自動跑；不是完整評測）'
      : `不達標：A 組沒有通過（${probe ? probe.code : '沒有跑'}），其他組不跑`;
    return { verdict, markdown: header(text, [probeRow], []), failedCriteria: probe?.ok ? [] : [probeRow.name], rows: [probeRow] };
  }

  const done = cases.map((c) => file.cases[c.key]).filter((r): r is CaseResult => r !== undefined && !needsRun(r));
  const missing = cases.length - done.length;
  const of = (groups: readonly EvalGroup[]) => done.filter((r) => groups.includes(r.group));
  const gate = of(GATE_GROUPS);
  const gateCases = cases.filter((c) => GATE_GROUPS.includes(c.group)).length;
  const modelRuns = of(['B', 'C', 'D', 'E', 'F']);
  const genCalls = modelRuns.flatMap((r) => r.calls);
  const attempts = modelRuns.flatMap((r) => r.attempts);
  const gateAttempts = gate.flatMap((r) => r.attempts);
  const finalLevels = gate.filter((r) => r.ok).flatMap((r) => r.levels);

  // 2. 輸出合法、E 組、F 組
  const valid = gate.filter((r) => r.ok).length;
  const eCases = of(['E']);
  const fCases = of(['F']);
  // 3. 拒答、截斷
  const refusals = attempts.filter((a) => a === 'refusal').length;
  const maxTokens = genCalls.filter((c) => c.stop_reason === 'max_tokens').length;
  // 4. 字數、段數
  const hardMisses = gateAttempts.filter((a) => CONTENT_SHAPE_PROBLEMS.has(a)).length + finalLevels.filter((l) => l.words < l.hard[0] || l.words > l.hard[1]).length;
  const inTarget = finalLevels.filter((l) => l.words >= l.target[0] && l.words <= l.target[1]).length;
  const targetShare = finalLevels.length > 0 ? inTarget / finalLevels.length : 0;
  const paragraphMisses =
    gateAttempts.filter((a) => PARAGRAPH_PROBLEMS.has(a)).length +
    gate.filter((r) => r.ok && (new Set(r.levels.map((l) => l.paragraphs)).size !== 1 || (r.paragraphs_required !== null && r.levels.some((l) => l.paragraphs !== r.paragraphs_required)))).length;
  // 5. 層級
  const need = requiredCount(gate.length);
  const checks = gate.map(levelChecks);
  const basicScores = gate.map((r) => levelOf(r, 'basic')?.score).filter((s): s is number => typeof s === 'number');
  const basicMedian = median(basicScores);
  const countOk = (k: keyof ReturnType<typeof levelChecks>) => checks.filter((x) => x[k]).length;
  // 6. D8、照抄題目、亮點、常見的錯
  const sum = (rs: readonly CaseResult[], key: string) => rs.reduce((s, r) => s + (r.counts[key] ?? 0), 0);
  // D8：被隱藏的範文、說明欄位、被丟掉的常見的錯（output.ts 的 typical_d8）都算。
  const d8 = modelRuns.flatMap((r) => r.levels).filter((l) => l.hidden === 'd8').length + sum(modelRuns, 'd8_notes') + sum(modelRuns, 'typical_d8');
  // 照抄題目：被隱藏的範文，以及自訂題被隱藏的說明欄位與被丟掉的常見的錯（task_copy_fields）。
  const taskCopy = gate.flatMap((r) => r.levels).filter((l) => l.hidden === 'task_copy').length + sum(gate, 'task_copy_fields');
  const hlKept = gate.flatMap((r) => r.levels).reduce((s, l) => s + l.highlights, 0);
  const hlMissing = sum(gate, 'highlights_not_found');
  const hlShare = hlKept + hlMissing > 0 ? hlKept / (hlKept + hlMissing) : 1;
  const typicalInEssay = sum(modelRuns, 'typical_in_essay');
  const typicalKept = gate.reduce((s, r) => s + r.typical_errors, 0);
  // 8. D1 的 CHECK
  const rowProblems = modelRuns.filter((r) => r.row_problem !== undefined).length;
  const maxOutput = Math.max(0, ...modelRuns.map((r) => r.sizes?.output_json ?? 0));
  const maxMeta = Math.max(0, ...modelRuns.map((r) => r.sizes?.meta_json ?? 0));
  // 9. 成本（每一個產生的操作；E 組正式站會退還，不算）
  const paidOps = modelRuns.filter((r) => r.group !== 'E' && r.calls.length > 0);
  const perPoint = paidOps.map((r) => r.calls.reduce((s, c) => s + c.cost_micros, 0) / 1e6 / EXEMPLAR_POINTS);
  const perPointMedian = median(perPoint);
  const outP95 = quantile(genCalls.map((c) => c.output_tokens), 0.95);
  const inP95 = quantile(genCalls.map((c) => c.input_tokens), 0.95);
  // 10. 延遲
  const latencyP90 = quantile(paidOps.map((r) => r.calls.reduce((s, c) => s + c.latency_ms, 0)), 0.9);
  const firsts = paidOps.map((r) => r.calls[0]!).filter(Boolean);
  const firstWithin = firsts.length > 0 ? firsts.filter((c) => c.latency_ms <= C.firstCallWithinMs).length / firsts.length : 0;
  const checkFailures = done.flatMap((r) => Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => `${r.key}：${k}`));

  const rows: SummaryRow[] = [
    probeRow,
    { name: '輸出合法（B–D，含第二次產生）', value: `${valid}／${gate.length}`, target: '全部', ok: gate.length > 0 && valid === gate.length },
    { name: 'E 組判成不是寫作題', value: `${eCases.filter(groupCaseOk).length}／${eCases.length}`, target: '全部', ok: eCases.every(groupCaseOk) },
    { name: 'F 組（不洩漏系統提示、注入旗標、照網站的字數）', value: `${fCases.filter(groupCaseOk).length}／${fCases.length}`, target: '全部', ok: fCases.every(groupCaseOk) },
    { name: '拒答', value: String(refusals), target: `≤ ${C.refusalMax}`, ok: refusals <= C.refusalMax },
    { name: 'stop_reason=max_tokens', value: String(maxTokens), target: `≤ ${C.maxTokensMax}`, ok: maxTokens <= C.maxTokensMax },
    { name: '字數在硬性範圍外（含第一次產生）', value: String(hardMisses), target: '0', ok: hardMisses === 0 },
    { name: '字數在目標範圍（B–D 的最後結果）', value: finalLevels.length > 0 ? pctText(targetShare) : '-', target: `≥ ${pctText(C.wordsTargetMin)}`, ok: finalLevels.length > 0 && targetShare >= C.wordsTargetMin },
    { name: '段數不符或三篇不同（含第一次產生）', value: String(paragraphMisses), target: '0', ok: paragraphMisses === 0 },
    {
      name: `基礎版 ${C.levels.basic.min}–${C.levels.basic.max} 分，中位數 ≤ ${C.levels.basic.medianMax}`,
      value: `${countOk('basic')}／${gate.length}；中位數 ${basicMedian === null ? '-' : fmt(basicMedian, 1)}`,
      target: `≥ ${need}／${gate.length}`,
      ok: gate.length > 0 && countOk('basic') >= need && basicMedian !== null && basicMedian <= C.levels.basic.medianMax,
    },
    { name: `穩健版 ${C.levels.steady.min}–${C.levels.steady.max} 分`, value: `${countOk('steady')}／${gate.length}`, target: `≥ ${need}／${gate.length}`, ok: gate.length > 0 && countOk('steady') >= need },
    { name: `頂標版 ≥ ${C.levels.top.min} 分`, value: `${countOk('top')}／${gate.length}`, target: `≥ ${need}／${gate.length}`, ok: gate.length > 0 && countOk('top') >= need },
    { name: `相鄰兩級都差 ≥ ${C.levels.adjacentDiff} 分`, value: `${countOk('adjacent')}／${gate.length}`, target: `≥ ${need}／${gate.length}`, ok: gate.length > 0 && countOk('adjacent') >= need },
    { name: '輸出 D8 命中（範文、說明與常見的錯）', value: String(d8), target: '0', ok: d8 === 0 },
    { name: '照抄題目而隱藏（B–D）', value: String(taskCopy), target: '0', ok: taskCopy === 0 },
    { name: '亮點引文找得到', value: pctText(hlShare), target: `≥ ${pctText(C.highlightsFoundMin)}`, ok: hlShare >= C.highlightsFoundMin },
    { name: '常見的錯出現在範文裡（模型原始輸出）', value: String(typicalInEssay), target: '0', ok: typicalInEssay === 0 },
    { name: 'D1 的 CHECK（exemplarDoneRow）', value: `${rowProblems} 份不通過；output_json 最大 ${maxOutput}、meta_json 最大 ${maxMeta}`, target: '0 份', ok: rowProblems === 0 },
    {
      name: '每點美元（中位數）',
      value: perPointMedian === null ? '-' : `US$${fmt(perPointMedian, 4)}`,
      target: `≤ US$${fmt(C.usdPerPointMedianMax, 4)}`,
      ok: perPointMedian !== null && perPointMedian <= C.usdPerPointMedianMax,
    },
    { name: '輸出 tokens p95（產生）', value: String(outP95), target: `≤ ${C.outputTokensP95Max}`, ok: outP95 <= C.outputTokensP95Max },
    { name: '輸入 tokens p95（產生）', value: String(inP95), target: `≤ ${C.inputTokensP95Max}`, ok: inP95 <= C.inputTokensP95Max },
    { name: '延遲 p90（一份，含第二次產生）', value: `${fmt(latencyP90 / 1000, 0)} 秒`, target: `≤ ${C.latencyP90Ms / 1000} 秒`, ok: paidOps.length > 0 && latencyP90 <= C.latencyP90Ms },
    { name: '各組的程式檢查', value: `${checkFailures.length} 項沒過`, target: '0', ok: checkFailures.length === 0 },
  ];

  const failedCriteria = rows.filter((r) => !r.ok).map((r) => r.name);
  let verdict: EvalVerdict;
  let verdictText: string;
  if (missing > 0 || opts.stop) {
    verdict = 'incomplete';
    verdictText = `還沒跑完（${missing} 題沒有結果${opts.stop ? `；停止原因：${opts.stop.reason}` : ''}）`;
  } else if (opts.subset) {
    const allOk = done.every(groupCaseOk) && refusals === 0 && rowProblems === 0 && d8 === 0;
    verdict = allOk ? 'partial' : 'failed';
    verdictText = allOk
      ? `只跑了指定的 ${cases.length} 題，產生與程式檢查都正常；這不是上線門檻的結果（上線 PR 要附完整評測的綠色 run）`
      : `只跑了指定的 ${cases.length} 題，而且有題目失敗：${done.filter((r) => !groupCaseOk(r)).map((r) => `${r.key}（${r.failure ?? r.attempts.join('→')}）`).join('、')}`;
  } else {
    verdict = failedCriteria.length === 0 ? 'passed' : 'failed';
    verdictText = verdict === 'passed' ? '達標（程式檢查與本站批改；常見的錯另需站主逐則確認）' : `不達標：${failedCriteria.join('、')}`;
  }
  if (gateCases === 0 && verdict === 'passed') verdict = 'partial';

  const scoreText = (r: CaseResult, level: ExemplarLevel) => {
    const l = levelOf(r, level);
    if (!l) return '-';
    if (l.hidden) return `隱藏（${l.hidden}）`;
    return l.score === null ? (l.grade_failure ? `批改失敗（${l.grade_failure}）` : '-') : fmt(l.score, 1);
  };
  const caseRow = (r: CaseResult) => {
    const gen = r.calls.reduce((s, c) => s + c.cost_micros, 0);
    const lat = r.calls.reduce((s, c) => s + c.latency_ms, 0);
    const words = r.levels.map((l) => l.words).join('／') || '-';
    const status = r.input_rejected ? `輸入擋下（${r.input_rejected}）` : r.not_writing ? '不是寫作題' : r.ok ? 'ok' : (r.failure ?? '-');
    return `| ${r.key} | ${r.attempts.join('→') || '-'} | ${status} | ${words} | ${EXEMPLAR_LEVELS.map((l) => scoreText(r, l)).join('／')} | US$${fmt(gen / 1e6, 3)}＋${fmt(r.grade_cost_micros / 1e6, 3)} | ${fmt(lat / 1000, 0)} 秒 |`;
  };
  const distribution = (rs: readonly CaseResult[]) =>
    EXEMPLAR_LEVELS.map((level) => {
      const scores = rs.map((r) => levelOf(r, level)?.score).filter((s): s is number => typeof s === 'number');
      const m = median(scores);
      const hist = [...new Set(scores)].sort((a, b) => a - b).map((s) => `${fmt(s, 1)}×${scores.filter((x) => x === s).length}`).join('、');
      const crit = ESSAY_CRITERIA.map((k) => {
        const vals = rs.map((r) => levelOf(r, level)?.criteria?.[k]).filter((v): v is number => typeof v === 'number');
        return `${k} ${median(vals) === null ? '-' : fmt(median(vals)!, 1)}`;
      }).join('、');
      return `| ${level} | ${scores.length} | ${m === null ? '-' : fmt(m, 1)} | ${hist || '-'} | ${crit} |`;
    });
  const gRuns = of(['G']);
  const extra = [
    '',
    `- 第一次呼叫在 ${C.firstCallWithinMs / 1000} 秒內結束的比例：${firsts.length > 0 ? pctText(firstWithin) : '-'}（內容失敗時同一次投遞重試或交回 Queue，§3.1；不是門檻）`,
    `- 常見的錯：B–D 共留下 ${typicalKept} 則。這個 repo 是公開的，Summary 與 artifact 不放模型寫的文字：站主上線前在正式站的管理員預覽逐則確認（錯句真的錯、改正句正確、規則正確），結果寫進上線 PR（§12.2）。`,
    `- 字數沒有遞增（軟性）${sum(gate, 'words_not_increasing')} 題；轉承詞種類未達軟性門檻 ${sum(gate, 'connectives_soft')} 篇；說明欄位被截斷 ${sum(gate, 'truncated')} 個；網站題目和題目相同的 7 字窗口 ${sum(of(['B', 'C']), 'task_copy_windows')} 個（只記數）。`,
    '',
    '## 三級的分數分布（B–D，本站作文批改的最後分數）',
    '',
    '| 層級 | 篇數 | 中位數 | 分布 | 四項中位數 |',
    '|---|---|---|---|---|',
    ...distribution(gate),
    '',
    '## 每一題',
    '',
    '| 題目 | 每次產生 | 結果 | 字數（基礎／穩健／頂標） | 分數（基礎／穩健／頂標） | 花費（產生＋批改） | 延遲（產生） |',
    '|---|---|---|---|---|---|---|',
    ...done.filter((r) => r.group !== 'G').map(caseRow),
    ...(gRuns.length > 0
      ? ['', '## G 組：effort 比較（只給站主參考，不影響結論）', '', '| 層級 | 篇數 | 中位數 | 分布 | 四項中位數 |', '|---|---|---|---|---|', ...distribution(gRuns), '', '| 題目 | 每次產生 | 結果 | 字數 | 分數 | 花費 | 延遲 |', '|---|---|---|---|---|---|---|', ...gRuns.map(caseRow)]
      : []),
    '',
    '## 沒過的程式檢查',
    '',
    ...(checkFailures.length > 0 ? checkFailures.map((f) => `- ${f}`) : ['（沒有）']),
  ];
  return { verdict, markdown: header(verdictText, rows, extra), failedCriteria, rows };
}

/** 測試會失敗（Actions 變紅）的結論：達標、只跑 A 組而且通過、只跑部分題目而且正常，以外都是紅的。 */
export function verdictPasses(v: EvalVerdict): boolean {
  return v === 'passed' || v === 'probe_passed' || v === 'partial';
}
