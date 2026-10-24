/**
 * 作文範文真模型評測的執行步驟（docs/design/model-essays.md §9.6）。呼叫模型的函式由外面傳進來：exemplars.parity.ts 傳真的
 * （buildClaudeRequest → executeClaudeCall），test/exemplars.parity-summary.test.ts 傳假的，所以這裡的流程不需要金鑰就測得到。
 *
 *   runProbe   A 組：完整的系統提示與 schema、題目文字最短的網站題目、max_tokens 64。回應不是錯誤（400 等）就通過。
 *   runCase    B–G 組的一題：和正式站同一套函式——
 *                自訂題 checkExemplarPrompt（路由的檢查）→ matchSiteGroup → customPromptFlagCodes；
 *                網站題目 exemplarSiteGroups（白名單）；
 *                exemplarCallInput → 呼叫 → postprocessExemplars → exemplarDoneRow（遷移 0005 的 CHECK）；
 *                內容失敗（截斷、格式不符、§3.5 的硬性檢查、CHECK 不過）最多付費 2 次（§3.6）；拒答與 API 錯誤不重試；
 *                自訂題被判成不是寫作題不重試（正式站以 invalid_output 退還）。
 *              B、C、D、G 組再用本站的作文批改（essayCallInput 的兩位評分者、差距大時第三位、combineEssay）給每一篇打分。
 *   casesProblems  花錢之前檢查題目集：網站題目都在白名單、自訂題都通過輸入規則、F 組的檢查名稱都認得。
 * 只回傳代碼、計數、字數、分數、tokens、花費與延遲；範文、說明與常見的錯的文字不離開這支程式。
 */
import { countEnglishWords, customPromptFlagCodes, EXEMPLAR_LEVELS, ESSAY_CRITERIA, type EssayCriterion, type ExemplarSetView, type RaterRole } from '@gsat/shared';
import type { WritingGroup } from '../../src/ai/bank';
import type { CallOutcome, ClaudeCallInput } from '../../src/ai/client';
import type { D8Fingerprints } from '../../src/ai/d8';
import { OutputFilter, sanitizeStudentText } from '../../src/ai/filter';
import type { EssayAnalyticOutput, EssayHolisticOutput } from '../../src/ai/prompts/essay';
import { exemplarSystemText } from '../../src/ai/prompts/exemplars';
import { essayCallInput } from '../../src/ai/requests';
import { combineEssay, essayScoresProblem, needsThirdRater, paragraphRanges, scoreEssayAnalytic, scoreEssayHolistic, type EssayContext, type EssayRaterRecord } from '../../src/ai/scoring';
import { taskConfig, type CallRole } from '../../src/ai/tasks';
import type { AppConfig } from '../../src/config';
import { ApiError } from '../../src/errors';
import { exemplarMetaOf } from '../../src/exemplars/consumer';
import { EXEMPLAR_TASK_COPY_WINDOWS, postprocessExemplars, taskCopyWindows } from '../../src/exemplars/output';
import { exemplarDoneRow } from '../../src/exemplars/repo';
import { exemplarCallInput, requestParagraphs, requestTargets, requestTaskTexts, type ExemplarCustomPrompt, type ExemplarRequest } from '../../src/exemplars/requests';
import { checkExemplarPrompt } from '../../src/exemplars/routes';
import type { ExemplarOutput } from '../../src/exemplars/schema';
import { exemplarSiteGroups, siteSourceOf } from '../../src/exemplars/siteGroups';
import { matchSiteGroup } from '../../src/exemplars/siteMatch';
import { customWritingGroup } from '../../src/submissions/custom';
import { ADVERSARIAL_CHECKS, STOP_FAILURES, type CallMetric, type CaseResult, type EvalCase, type GoldenFile, type LevelResult, type ProbeResult } from './exemplars.cases';

/** 呼叫模型（真的或假的）。 */
export type Executor = (input: ClaudeCallInput) => Promise<CallOutcome>;

/** A 組的 max_tokens（§9.6）。 */
export const PROBE_MAX_TOKENS = 64;
/** 一個操作最多付費產生幾次內容失敗的結果（§3.6；同 consumer）。 */
export const CONTENT_ATTEMPTS = 2;

export function metricOf(outcome: CallOutcome): CallMetric {
  const r = outcome.record;
  return {
    input_tokens: r.inputTokens + r.cacheReadTokens + r.cacheWrite5mTokens + r.cacheWrite1hTokens,
    output_tokens: r.outputTokens,
    stop_reason: r.stopReason,
    cost_micros: r.costMicros,
    latency_ms: r.latencyMs,
  };
}

type ErrorOutcome = Extract<CallOutcome, { kind: 'error' }>;

/** API 錯誤 → 記錄用的代碼（http_400、timeout…）。不印 Anthropic 的錯誤說明，只標出是不是輸出格式被拒（:schema）。 */
export function errorCodeOf(outcome: ErrorOutcome): string {
  if (outcome.spendLimit) return 'spend_limit';
  const base = outcome.record.errorCode ?? outcome.reason;
  return /grammar|schema|output_config|json_schema/i.test(outcome.detail ?? '') ? `${base}:schema` : base;
}

/** API 錯誤 → 失敗代碼（同學習助手的評測）：花費上限與請求或金鑰的問題讓這次評測停下來，其他是暫時失敗（下次重跑）。 */
export function failureOf(outcome: ErrorOutcome): string {
  return outcome.spendLimit ? 'spend_limit' : outcome.configProblem ? 'config_error' : outcome.reason;
}

/** 網站題目：白名單裡這個 uid 的最新版本；沒有回 null。 */
export function resolveSiteGroup(uid: string): WritingGroup | null {
  return (
    exemplarSiteGroups()
      .filter((g) => g.uid === uid)
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

/** 範文（含說明、亮點、常見的錯）和系統提示相同的 7 字窗口數的最大值（每一個字串分開算）。 */
export function systemPromptLeakWindows(view: ExemplarSetView, systemText = exemplarSystemText()): number {
  let max = 0;
  const walk = (v: unknown) => {
    if (typeof v === 'string') max = Math.max(max, taskCopyWindows(v, [systemText]));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(view);
  return max;
}

// ───────────────────────── A 組 ─────────────────────────

export async function runProbe(exec: Executor, config: AppConfig, golden: GoldenFile): Promise<ProbeResult> {
  const g = resolveSiteGroup(golden.probe.uid);
  const source = g ? siteSourceOf(g) : null;
  if (!g || !source) return { ok: false, code: 'site_data', call: null };
  const base = exemplarCallInput(taskConfig('essay_exemplars', config), { source, group: g });
  const outcome = await exec({ ...base, spec: { ...base.spec, maxTokens: PROBE_MAX_TOKENS } });
  // 回應不是錯誤＝輸出格式被接受了（64 tokens 寫不完，通常是 max_tokens）。
  return { ok: outcome.kind !== 'error', code: outcome.kind === 'error' ? errorCodeOf(outcome) : outcome.kind, call: metricOf(outcome) };
}

// ───────────────────────── 批改 ─────────────────────────

export interface GradeResult {
  score: number | null;
  criteria: Record<EssayCriterion, number> | null;
  cost_micros: number;
  failure?: string;
}

/** 用本站的作文批改給一篇範文打分（和 consumer 同一套函式；截斷或格式不符重試一次）。 */
export async function gradeEssay(exec: Executor, config: AppConfig, group: WritingGroup, essay: string): Promise<GradeResult> {
  const tc = taskConfig('essay_grade', config);
  const text = sanitizeStudentText(essay).text;
  const ranges = paragraphRanges(text, false);
  const paragraphs = ranges.map((r) => text.slice(r.start, r.end).trim());
  const ctx: EssayContext = {
    text,
    wordCount: countEnglishWords(text),
    paragraphs: ranges.length,
    requiredParagraphs: group.essay?.paragraphs ?? null,
    photoMode: false,
    ...(group.origin === 'custom' ? { custom: true } : {}),
  };
  let cost = 0;
  const rate = async (role: RaterRole): Promise<EssayRaterRecord | string> => {
    const input = essayCallInput(tc, role as CallRole, group, paragraphs, ctx.wordCount);
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await exec(input);
      cost += outcome.record.costMicros;
      if (outcome.kind === 'ok') {
        if (input.spec.framework === 'analytic') {
          const o = outcome.data as EssayAnalyticOutput;
          const scores = Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, o.criteria[c].score])) as Record<EssayCriterion, number>;
          if (essayScoresProblem(scores)) continue;
          return scoreEssayAnalytic(role, ctx, o, new OutputFilter());
        }
        const o = outcome.data as EssayHolisticOutput;
        if (essayScoresProblem(o.scores)) continue;
        return scoreEssayHolistic(role, ctx, o, new OutputFilter());
      }
      if (outcome.kind === 'error') return failureOf(outcome);
      if (outcome.kind === 'refusal') return 'refusal';
    }
    return 'invalid_output';
  };
  const [a, b] = await Promise.all([rate('primary'), rate('second')]);
  if (typeof a === 'string' || typeof b === 'string') {
    const failures = [a, b].filter((x): x is string => typeof x === 'string');
    return { score: null, criteria: null, cost_micros: cost, failure: failures.find((f) => STOP_FAILURES.has(f)) ?? failures[0]! };
  }
  const records: Array<EssayRaterRecord & { role: RaterRole }> = [
    { role: 'primary', ...a },
    { role: 'second', ...b },
  ];
  if (needsThirdRater('essay', a.result.total, b.result.total)) {
    const t = await rate('third');
    if (typeof t === 'string') return { score: null, criteria: null, cost_micros: cost, failure: t };
    records.push({ role: 'third', ...t });
  }
  const result = combineEssay(records, { wordCount: ctx.wordCount, paragraphs: ctx.paragraphs });
  return {
    score: result.final_score,
    criteria: Object.fromEntries(ESSAY_CRITERIA.map((k) => [k, result.criteria[k].score])) as Record<EssayCriterion, number>,
    cost_micros: cost,
  };
}

// ───────────────────────── 一題 ─────────────────────────

export interface RunDeps {
  exec: Executor;
  /** effort 是 null 時用預設設定；G 組傳 low。 */
  configFor: (effort: string | null) => AppConfig;
  fp: D8Fingerprints;
}

type Prepared = { req: ExemplarRequest; gradeGroup: WritingGroup; custom?: { value: ExemplarCustomPrompt; siteMatch: boolean; flags: string[] } } | { rejected: string } | { failure: string };

/** 題目 → 這次的請求（自訂題走路由的同一支檢查）。 */
export function prepareCase(c: EvalCase, fp: D8Fingerprints): Prepared {
  if (c.kind === 'site') {
    const g = resolveSiteGroup(c.uid);
    const source = g ? siteSourceOf(g) : null;
    if (!g || !source) return { failure: 'site_data' };
    return { req: { source, group: g }, gradeGroup: g };
  }
  let value: ExemplarCustomPrompt;
  try {
    value = checkExemplarPrompt(c.prompt as unknown as Record<string, unknown>, fp, null);
  } catch (err) {
    if (err instanceof ApiError) return { rejected: String(err.detail['reason'] ?? err.code) };
    throw err;
  }
  const siteMatch = matchSiteGroup([value.text, ...(value.figure_text ? [value.figure_text] : [])]) !== null;
  const flags = customPromptFlagCodes({ text: value.text, figure_text: value.figure_text });
  const gradeGroup = customWritingGroup({ prompt_text: value.text, figure_text: value.figure_text, paragraphs: value.paragraphs, min_words: value.min_words, max_words: value.max_words, rev: 1 });
  return { req: { source: 'custom', prompt: value }, gradeGroup, custom: { value, siteMatch, flags } };
}

function emptyResult(c: EvalCase): CaseResult {
  return { key: c.key, id: c.id, group: c.group, ok: false, attempts: [], calls: [], grade_cost_micros: 0, paragraphs_required: null, levels: [], counts: {}, typical_errors: 0, sizes: null, checks: {} };
}

export async function runCase(deps: RunDeps, c: EvalCase): Promise<CaseResult> {
  const result = emptyResult(c);
  if (c.kind === 'site' && c.effort) result.effort = c.effort;
  const prepared = prepareCase(c, deps.fp);
  if ('failure' in prepared) return { ...result, failure: prepared.failure };
  if ('rejected' in prepared) return { ...result, failure: 'input_rejected', input_rejected: prepared.rejected };
  const { req, gradeGroup, custom } = prepared;
  if (custom) {
    result.site_match = custom.siteMatch;
    result.injection_flags = custom.flags;
  }
  const config = deps.configFor(c.kind === 'site' ? c.effort : null);
  const input = exemplarCallInput(taskConfig('essay_exemplars', config), req);
  const targets = requestTargets(req);
  result.paragraphs_required = requestParagraphs(req);
  const postCtx = { source: req.source, targets, paragraphs: result.paragraphs_required, taskTexts: requestTaskTexts(req), fp: deps.fp };

  let view: ExemplarSetView | null = null;
  let post: ReturnType<typeof postprocessExemplars> | null = null;
  let contentFailures = 0;
  while (contentFailures < CONTENT_ATTEMPTS) {
    const outcome = await deps.exec(input);
    result.calls.push(metricOf(outcome));
    if (outcome.kind === 'error') {
      result.attempts.push(errorCodeOf(outcome));
      result.failure = failureOf(outcome);
      return result;
    }
    if (outcome.kind === 'refusal') {
      result.attempts.push('refusal');
      result.failure = 'refusal';
      return result;
    }
    if (outcome.kind === 'max_tokens' || outcome.kind === 'invalid') {
      result.attempts.push(outcome.kind);
      result.failure = outcome.kind === 'max_tokens' ? 'max_tokens' : 'invalid_output';
      contentFailures += 1;
      continue;
    }
    const p = postprocessExemplars(outcome.data as ExemplarOutput, postCtx, new OutputFilter());
    result.counts = { ...p.counts };
    if (p.notWritingTask) {
      // 自訂題不是英文寫作題：正式站不重試，以 invalid_output 退還。
      result.attempts.push('not_writing');
      result.not_writing = true;
      result.failure = 'invalid_output';
      return result;
    }
    if (p.problem) {
      result.attempts.push(p.problem);
      result.failure = p.problem;
      contentFailures += 1;
      continue;
    }
    const row = exemplarDoneRow({ view: p.view, meta: exemplarMetaOf(req, deps.fp.version, p) });
    result.sizes = { output_json: row.outputChars, meta_json: row.metaChars };
    if (!row.ok) {
      result.attempts.push(row.problem);
      result.row_problem = row.problem;
      result.failure = row.problem;
      contentFailures += 1;
      continue;
    }
    result.attempts.push('ok');
    delete result.failure;
    delete result.row_problem;
    result.ok = true;
    view = p.view;
    post = p;
    break;
  }
  if (!view || !post) return result;

  result.safety = post.safety;
  result.typical_errors = view.typical_errors.length;
  result.levels = EXEMPLAR_LEVELS.map((level, i): LevelResult => {
    const e = view!.essays[i]!;
    const t = targets[level];
    return {
      level,
      hidden: e.hidden,
      words: post!.details.words[level],
      paragraphs: post!.details.paragraphs[level],
      target: [t.min, t.max],
      hard: [t.hardMin, t.hardMax],
      connective_kinds: post!.details.connective_kinds[level],
      highlights: e.highlights.length,
      score: null,
      criteria: null,
    };
  });

  // 程式檢查：自訂題不該和網站題目相同；F 組依題目集列的檢查。
  if (c.kind === 'custom' && (c.group === 'D' || c.group === 'F')) result.checks['no_site_match'] = result.site_match !== true;
  if (c.kind === 'custom' && c.group === 'F') {
    for (const check of c.checks) {
      if (check === 'no_system_prompt') result.checks[check] = systemPromptLeakWindows(view) < EXEMPLAR_TASK_COPY_WINDOWS;
      else if (check === 'injection_flagged') result.checks[check] = (result.injection_flags ?? []).length > 0;
      else if (check === 'site_targets') result.checks[check] = result.levels.every((l) => l.words >= l.hard[0] && l.words <= l.hard[1]);
    }
  }

  // 本站的作文批改（B、C、D、G）：被隱藏的那一篇不批改。
  if (c.group === 'B' || c.group === 'C' || c.group === 'D' || c.group === 'G') {
    const grades = await Promise.all(
      view.essays.map((e) => (e.text === null ? Promise.resolve<GradeResult | null>(null) : gradeEssay(deps.exec, config, gradeGroup, e.text))),
    );
    grades.forEach((g, i) => {
      if (!g) return;
      result.grade_cost_micros += g.cost_micros;
      const l = result.levels[i]!;
      l.score = g.score;
      l.criteria = g.criteria;
      if (g.failure) l.grade_failure = g.failure;
    });
  }
  return result;
}

// ───────────────────────── 花錢之前的檢查 ─────────────────────────

/** 題目集的問題（空陣列＝沒問題）。不呼叫模型。 */
export function casesProblems(golden: GoldenFile, cases: readonly EvalCase[], fp: D8Fingerprints): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const c of cases) {
    if (keys.has(c.key)) problems.push(`${c.key}：重複`);
    keys.add(c.key);
  }
  const probe = resolveSiteGroup(golden.probe.uid);
  if (!probe) problems.push(`A 組 ${golden.probe.uid}：不在白名單或題目庫沒有`);
  for (const c of cases) {
    if (c.kind === 'site') {
      const g = resolveSiteGroup(c.uid);
      const expected = c.group === 'C' ? 'bank' : 'exam';
      if (!g) problems.push(`${c.key}：${c.uid} 不在白名單或題目庫沒有`);
      else if (siteSourceOf(g) !== expected) problems.push(`${c.key}：${c.uid} 不是${expected === 'bank' ? '本站仿真題' : '歷屆題'}`);
      continue;
    }
    const p = prepareCase(c, fp);
    if ('rejected' in p) {
      // E 組（不是寫作題）被輸入規則先擋下也算通過；D、F 組要送得出去。
      if (c.group !== 'E') problems.push(`${c.key}：被輸入規則擋下（${p.rejected}）`);
      continue;
    }
    if ('failure' in p) {
      problems.push(`${c.key}：${p.failure}`);
      continue;
    }
    if (c.group !== 'E' && p.custom?.siteMatch) problems.push(`${c.key}：和網站題目相同`);
    if (c.group === 'F') {
      if (c.checks.length === 0) problems.push(`${c.key}：沒有列檢查`);
      for (const check of c.checks) if (!(ADVERSARIAL_CHECKS as readonly string[]).includes(check)) problems.push(`${c.key}：不認得的檢查 ${check}`);
      if (c.checks.includes('injection_flagged') && (p.custom?.flags ?? []).length === 0) problems.push(`${c.key}：沒有注入旗標（題目寫法要改）`);
    }
  }
  for (const id of golden.effort_sweep.ids) if (!golden.exam.some((s) => s.id === id)) problems.push(`G 組：B 組沒有 ${id}`);
  return problems;
}
