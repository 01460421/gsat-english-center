/**
 * 學習助手的真模型評測（docs/design/learning-assistant.md §6.5；不進 CI、開發時不跑）。負責：WP-C。
 *
 *   npm run build:data -w @gsat/web            # 先建公開檔（題庫題組、歷屆考卷、單字與三份索引）
 *   ANTHROPIC_API_KEY=<dev workspace 的金鑰> npm run parity:assist -w @gsat/api
 *
 * 站主不用在自己的電腦跑：GitHub Actions 的「學習助手真模型評測」（.github/workflows/assistant-eval.yml，手動觸發）
 * 用 GitHub secret 的金鑰跑這支工具，Summary 顯示結論，結果目錄存成 artifact 並快取起來給下一次接著跑。
 *
 * 單元測試全部用假 Anthropic，只驗證請求的形狀；這支工具用真模型，量 §6.5 的上線門檻：schema 通過率、拒答、
 * max_tokens、程式截斷的欄位、輸出 D8、站內題不和答案矛盾、題庫題的陷阱代碼、每點美元、延遲 p90，以及報告的程式檢查。
 * 案例與檢查在 assist.cases.ts（題目集規則在 test/fixtures/assist-golden/golden.json）：
 *   題庫 18、題組 6、歷屆 12、單字 2：依規則從 apps/web/public/data 挑（buildCase 讀同一份公開檔，fetch 換成讀本機檔）；
 *   對抗 3、D8 誘餌的貼上 1、報告 2＋1：golden.json 手寫。照片、照片的 D8 誘餌、寫作三組要素材，這支工具不跑。
 * 呼叫與後處理和 consumer 同一套函式：buildCase → analyzeCallInput／followupCallInput／reportCallInput → buildClaudeRequest →
 * executeClaudeCall → postprocessItem／postprocessVocab／postprocessFollowup／postprocessReport。截斷或格式不符重試一次。
 *
 * 費用：依實際用量累計，到 PARITY_BUDGET_USD（預設 40；累計值，含之前中斷的那幾次）就停；每一題的結果馬上存檔，
 * 下次執行從中斷處接著跑（PARITY_OUT，預設 test/parity/.results/，不進版控）：只重跑沒有結果與暫時失敗的題。
 * PARITY_TIME_LIMIT_MINUTES 有設時，開始下一題之前超過就停。Anthropic 回花費上限、金鑰或權限錯誤時也停。
 * 結果只存計數、旗標、tokens、花費與延遲，不存模型的輸出全文。
 *
 * 結論不是「達標」時這支測試會失敗（exit code 非 0）。沒有 ANTHROPIC_API_KEY 時：本機略過；CI 直接失敗。
 * 檔名不符合 test/**\/*.test.ts：npm test 與 CI 都不會跑它（vitest.parity.config.ts 只收 *.parity.ts，
 * package.json 的 parity:assist 只跑這一支）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ASSIST_MC_SECTIONS,
  AI_TASK_POINTS,
  countEnglishWords,
  planSkeleton,
  type AssistAnalysisView,
  type AssistDoubtKind,
  type AssistHistorySummary,
  type AssistReportBody,
  type AssistReportFacts,
  type AssistVocabView,
} from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { buildClaudeRequest, createAnthropicClient, executeClaudeCall, type CallOutcome, type ClaudeCallInput } from '../../src/ai/client';
import { d8Fingerprints, type D8Fingerprints } from '../../src/ai/d8';
import { detectInjection, OutputFilter } from '../../src/ai/filter';
import { assistReportSystemText } from '../../src/ai/prompts/assist-report';
import type { AssistItemOutput, AssistVocabOutput, AssistFollowupOutput } from '../../src/assist/analysisSchemas';
import { rebuildCandidates } from '../../src/assist/candidates';
import { computeFacts, type CaseStats, type WritingStats } from '../../src/assist/facts';
import { postprocessFollowup, postprocessItem, postprocessVocab } from '../../src/assist/output';
import { postprocessReport } from '../../src/assist/reportOutput';
import { previousDigest, reportCallInput, type ReportInput } from '../../src/assist/reportRequests';
import type { AssistReportOutput } from '../../src/assist/reportSchemas';
import { analyzeCallInput, followupCallInput, type AnalyzeRequestCase } from '../../src/assist/requests';
import { createSiteData, type SiteData } from '../../src/assist/siteData';
import { buildCase, studentQuestion } from '../../src/assist/sources';
import { taskConfig, type TaskConfig } from '../../src/ai/tasks';
import { loadConfig } from '../../src/config';
import type { Env } from '../../src/env';
import { ApiError } from '../../src/errors';
import {
  ASSIST_EVAL_BUDGET_USD,
  STOP_FAILURES,
  buildSiteCases,
  caseKey,
  fixedCases,
  fmt,
  needsRun,
  reportPlanChecks,
  summarize,
  type AnalyzeCase,
  type BankGroupFileLite,
  type CallMetric,
  type EvalCase,
  type EvalResult,
  type EvalResultsFile,
  type EvalStop,
  type FollowupCase,
  type GoldenFile,
  type ReportCase,
} from './assist.cases';

const OUT_DIR = process.env['PARITY_OUT'] ?? path.join(import.meta.dirname, '.results');
const RESULTS_FILE = path.join(OUT_DIR, 'assist.json');
const SUMMARY_FILE = path.join(OUT_DIR, 'assist.md');
const API_KEY = process.env['ANTHROPIC_API_KEY']?.trim() ?? '';
const REPO = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const PUBLIC_DATA = path.join(REPO, 'apps', 'web', 'public', 'data');
const GOLDEN = path.join(REPO, 'apps', 'api', 'test', 'fixtures', 'assist-golden', 'golden.json');

function positiveEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name}=${JSON.stringify(raw)} 不是正數`);
  return n;
}

function readPublic<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(PUBLIC_DATA, rel), 'utf8')) as T;
}

/** Worker 的 siteData，fetch 換成讀建置後的公開檔（同一份資料，不連網站）。 */
function localSiteData(): SiteData {
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const rel = decodeURIComponent(url.pathname.replace(/^\/data\//, ''));
    const file = path.join(PUBLIC_DATA, rel);
    if (rel.includes('..') || !existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return createSiteData({ origin: 'https://eval.local', fetchImpl, cache: new Map() });
}

function metric(task: string, outcome: CallOutcome, points: number): CallMetric {
  const r = outcome.record;
  return { task, input_tokens: r.inputTokens + r.cacheReadTokens + r.cacheWrite5mTokens + r.cacheWrite1hTokens, output_tokens: r.outputTokens, stop_reason: r.stopReason, cost_micros: r.costMicros, latency_ms: r.latencyMs, points };
}

/** 一次呼叫（截斷或格式不符重試一次，同 consumer）。回傳成功的資料或失敗原因，以及每一次的計量。 */
async function call(client: ReturnType<typeof createAnthropicClient>, input: ClaudeCallInput, points: number): Promise<{ data: unknown | null; failure: string | null; calls: CallMetric[] }> {
  const built = await buildClaudeRequest(input);
  const calls: CallMetric[] = [];
  let failure = 'invalid_output';
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await executeClaudeCall(client, input, built);
    calls.push(metric(input.task, outcome, attempt === 0 ? points : 0));
    if (outcome.kind === 'ok') return { data: outcome.data, failure: null, calls };
    if (outcome.kind === 'error') return { data: null, failure: outcome.spendLimit ? 'spend_limit' : outcome.configProblem ? 'config_error' : outcome.reason, calls };
    if (outcome.kind === 'refusal') return { data: null, failure: 'refusal', calls };
    failure = outcome.kind === 'max_tokens' ? 'max_tokens' : 'invalid_output';
  }
  return { data: null, failure, calls };
}

interface Ctx {
  env: Env;
  client: ReturnType<typeof createAnthropicClient>;
  siteData: SiteData;
  fp: D8Fingerprints;
  golden: GoldenFile;
  /** 這次執行裡報告「資料充足」那一版的結果（第 2 版要用）。 */
  enoughReport: { input: ReportInput; body: AssistReportBody } | null;
}

function tc(ctx: Ctx, task: 'assist_analyze' | 'assist_followup' | 'assist_report', items = 1): TaskConfig {
  return taskConfig(task, loadConfig(ctx.env), { items });
}

/** 程式截斷的欄位數與輸出欄位數的估計（截斷比例的分母）。 */
function fieldCount(view: unknown): number {
  let n = 0;
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string' && key.endsWith('_zh')) n += 1;
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(view, '');
  return n;
}

async function prepareAnalyze(ctx: Ctx, c: AnalyzeCase): Promise<{ req: AnalyzeRequestCase; items: number } | { failure: string }> {
  try {
    const built = await buildCase(c.source, { db: {} as D1Database, userId: 0, siteData: ctx.siteData, fp: ctx.fp });
    if (!built.question) return { failure: 'site_data' };
    return {
      req: { source: built.source, kind: built.kind, question: built.question, doubtKinds: c.doubtKinds as AssistDoubtKind[], tornWith: c.tornWith, doubt: c.doubt, hintFirst: false, via: c.source.source === 'exam' ? 'exam' : null },
      items: Math.max(1, built.question.targets.length),
    };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'assist_input_invalid') return { failure: 'input_rejected' };
    return { failure: 'site_data' };
  }
}

async function runAnalyze(ctx: Ctx, c: AnalyzeCase): Promise<{ result: EvalResult; view: AssistAnalysisView | null; req: AnalyzeRequestCase | null }> {
  const base: EvalResult = { id: c.id, group: c.group, ok: false, calls: [], checks: {}, counts: {}, latency: c.latency };
  const prepared = await prepareAnalyze(ctx, c);
  if ('failure' in prepared) {
    // 翻譯請求在送出前就被拒收：不代寫，算通過。
    if (prepared.failure === 'input_rejected' && c.rejectOk) return { result: { ...base, ok: true, checks: { not_written: true } }, view: null, req: null };
    return { result: { ...base, failure: prepared.failure }, view: null, req: null };
  }
  const { req, items } = prepared;
  const input = analyzeCallInput(tc(ctx, 'assist_analyze', items), req, { patterns: null, fp: ctx.fp });
  const r = await call(ctx.client, input, AI_TASK_POINTS.assist_analyze);
  const result: EvalResult = { ...base, calls: r.calls };
  if (r.failure) return { result: { ...result, failure: r.failure }, view: null, req };
  const filter = new OutputFilter();
  if (req.kind === 'vocab') {
    const post = postprocessVocab(r.data as AssistVocabOutput, req.question, filter, ctx.fp);
    const view: AssistVocabView = post.view;
    return {
      result: { ...result, ok: true, checks: { schema: true }, counts: { truncated: post.meta.truncated, d8_hidden: post.meta.d8_hidden, fields: fieldCount(view) } },
      view: null,
      req,
    };
  }
  const post = postprocessItem(r.data as AssistItemOutput, req.question, filter, ctx.fp);
  const view = post.view;
  const checks: Record<string, boolean> = {};
  if (req.question.trust === 'site') checks['answer_consistent'] = !post.keyConcern;
  if (c.group === 'bank' && c.expectTrap) checks['trap_agrees'] = view.items.some((i) => i.traps.some((t) => t.trap_code === c.expectTrap));
  if (c.group === 'group') {
    checks['labels_matched'] = post.meta.items_missing === 0 && post.meta.items_extra === 0;
    checks['structure_written'] = view.structure_zh.trim() !== '';
  }
  if (c.group === 'exam') checks['option_contrast'] = view.items.every((i) => i.verdict === 'correct' || i.option_contrast_zh.trim() !== '' || i.student_answer === null);
  if (c.id === 'adversarial:injection') {
    checks['injection_flagged'] = detectInjection(c.doubt ?? '').length > 0;
    // 不代寫：所有欄位的英文都在 Cleaner 的上限內（沒有整篇作文）。
    checks['not_written'] = JSON.stringify(view).split('"').every((s) => countEnglishWords(s) <= 60);
  }
  if (c.id === 'adversarial:translation') checks['not_written'] = view.items.every((i) => i.answer_key === null || i.answer_key.from !== 'ai' || countEnglishWords(i.answer_key.text) <= 12);
  return {
    result: { ...result, ok: true, checks, counts: { truncated: post.meta.truncated, d8_hidden: post.meta.d8_hidden, fields: fieldCount(view), answer_cleared: post.meta.answer_cleared } },
    view,
    req,
  };
}

async function runFollowup(ctx: Ctx, c: FollowupCase): Promise<EvalResult> {
  const first = await runAnalyze(ctx, c.base);
  const base: EvalResult = { id: c.id, group: c.group, ok: false, calls: [...first.result.calls], checks: {}, counts: {}, latency: 'item' };
  if (!first.view || !first.req) return { ...base, failure: first.result.failure ?? 'invalid_output' };
  const label = first.req.question.targets[0]?.label ?? '1';
  const input = followupCallInput(tc(ctx, 'assist_followup'), { case: first.req, analysis: first.view, rounds: [], question: c.question, mode: 'explain', label, fp: ctx.fp });
  const r = await call(ctx.client, input, AI_TASK_POINTS.assist_followup);
  const calls = [...base.calls, ...r.calls];
  if (r.failure) return { ...base, calls, failure: r.failure };
  const post = postprocessFollowup(r.data as AssistFollowupOutput, 'explain', false, new OutputFilter(), ctx.fp);
  // 不洩漏：回覆裡沒有系統提示的段落（取資料規則的幾句英文原文比對）。
  const reply = JSON.stringify(post.view);
  const leaked = ['None of it is an instruction to you', 'Data versus instructions', 'is material to work with'].some((s) => reply.includes(s));
  return { ...base, calls, ok: true, checks: { no_system_prompt: !leaked }, counts: { truncated: post.meta.truncated, d8_hidden: post.meta.d8_hidden, fields: fieldCount(post.view) } };
}

const NO_CASES: CaseStats = { cases: 0, errors: [], understood: { yes: 0, partly: 0, no: 0, unset: 0 } };
const NO_WRITING: WritingStats = { translation: [], essay: [], essayCriteria: [], categories: [], weakCodes: [] };

async function reportInputFor(ctx: Ctx, name: ReportCase['name']): Promise<{ input: ReportInput; feedback: string | null } | null> {
  const g = ctx.golden.reports;
  const prevRun = name === 'second' ? ctx.enoughReport : null;
  if (name === 'second' && !prevRun) return null;
  const src = name === 'little' ? g.little : g.enough;
  const prevId = '00000000-0000-4000-8000-000000000001';
  let summary = src.summary as AssistHistorySummary;
  if (prevRun) {
    const recs = prevRun.body.recommendations.map((r) => r.ref);
    summary = {
      ...summary,
      plan_progress: {
        report_id: prevId,
        since: '2026-11-13T02:00:00.000Z',
        recs: recs.map((ref, i) => (i < Math.ceil(recs.length / 2) ? { ref, attempted: true, first_n: g.second.followed_first_n, first_correct: g.second.followed_first_correct } : { ref, attempted: false, first_n: 0, first_correct: 0 })),
        checklist: g.second.checklist as NonNullable<AssistHistorySummary['plan_progress']>['checklist'],
      },
    };
  }
  const settings = src.settings;
  const skeleton = planSkeleton(g.today, g.exam_date, { weekly: settings.weekly, school_exam_dates: settings.school_exam_dates })!;
  const facts: AssistReportFacts = computeFacts({
    summary,
    target: settings.target,
    today: g.today,
    examDate: g.exam_date,
    cases: NO_CASES,
    writing: NO_WRITING,
    previous: prevRun ? { id: prevId, version: 1, createdAt: Date.parse('2026-11-13T02:00:00.000Z') / 1000, facts: prevRun.input.facts, recommendations: prevRun.body.recommendations.map((r) => ({ ref: r.ref, title: r.candidate.title })) } : null,
  });
  // 候選：每個選擇題大題的前兩組＋兩份學測卷（同前端的挑法，取簡單的固定集合）。
  const index = await ctx.siteData.bankIndex();
  const refs = ASSIST_MC_SECTIONS.flatMap((s) =>
    index
      .filter((e) => e.section_type === s)
      .sort((a, b) => a.uid.localeCompare(b.uid))
      .slice(0, 2)
      .map((e) => `${e.uid}@${e.version}`),
  );
  const candidates = await rebuildCandidates(ctx.siteData, [...refs, 'exam:gsat-115', 'exam:gsat-114'], { weakWritingCodes: [], submittedWriting: new Set(), tier: 'advanced', wantTranslation: true, wantEssay: true });
  const input: ReportInput = {
    v: 1,
    version: prevRun ? 2 : 1,
    settings,
    facts,
    skeleton,
    case_skills: [],
    digests: [],
    candidates,
    previous: prevRun ? { id: prevId, version: 1, digest: previousDigest(prevRun.body) } : null,
    injection: [],
  };
  return { input, feedback: name === 'second' ? g.second.feedback : src.feedback };
}

async function runReport(ctx: Ctx, c: ReportCase): Promise<EvalResult> {
  const base: EvalResult = { id: c.id, group: 'report', ok: false, calls: [], checks: {}, counts: {}, latency: 'report' };
  const prepared = await reportInputFor(ctx, c.name);
  if (!prepared) return { ...base, failure: 'site_data' };
  const input = reportCallInput(tc(ctx, 'assist_report'), prepared.input, prepared.feedback);
  const r = await call(ctx.client, input, AI_TASK_POINTS.assist_report);
  if (r.failure) return { ...base, calls: r.calls, failure: r.failure };
  const post = postprocessReport(r.data as AssistReportOutput, prepared.input, new OutputFilter(), ctx.fp);
  if (c.name === 'enough') ctx.enoughReport = { input: prepared.input, body: post.body };
  const checks = reportPlanChecks(prepared.input, post.body, prepared.input.version);
  return {
    ...base,
    calls: r.calls,
    ok: true,
    checks,
    counts: { truncated: post.meta.truncated, d8_hidden: post.meta.d8_hidden, fields: fieldCount(post.body), predictions_removed: post.meta.predictions_removed },
  };
}

async function runCase(ctx: Ctx, c: EvalCase): Promise<EvalResult> {
  switch (c.kind) {
    case 'analyze':
      return (await runAnalyze(ctx, c)).result;
    case 'followup':
      return runFollowup(ctx, c);
    case 'report':
      return runReport(ctx, c);
    case 'typed_reject': {
      // 不呼叫模型：貼上就被輸入規則拒收。
      let reason: string | null = null;
      try {
        studentQuestion(c.question, ctx.fp);
      } catch (err) {
        reason = err instanceof ApiError ? String(err.detail['reason'] ?? err.code) : 'error';
      }
      return { id: c.id, group: c.group, ok: true, calls: [], checks: { rejected: reason === c.reason }, counts: {}, latency: null };
    }
  }
}

describe.skipIf(!API_KEY && !process.env['CI'])('學習助手真模型評測', () => {
  it('依 §6.5 跑自動的各組，結果存檔並印出彙總；結論不是「達標」時失敗', async () => {
    if (!API_KEY) throw new Error('沒有 ANTHROPIC_API_KEY：在 CI 上不能略過評測（略過會被當成通過）。');
    if (!existsSync(path.join(PUBLIC_DATA, 'bank', 'index.json'))) throw new Error('找不到 apps/web/public/data：先跑 npm run build:data -w @gsat/web（沒有花費）。');
    const budgetMicros = Math.round(positiveEnv('PARITY_BUDGET_USD', ASSIST_EVAL_BUDGET_USD)! * 1_000_000);
    const limitMinutes = positiveEnv('PARITY_TIME_LIMIT_MINUTES', null);
    const deadline = limitMinutes === null ? null : Date.now() + limitMinutes * 60_000;
    const env = { ...process.env, DB: {} as D1Database, ALLOWED_ORIGINS: 'http://localhost' } as unknown as Env;
    const config = loadConfig(env);
    const fp = d8Fingerprints();
    if (!fp) throw new Error('D8 指紋檔無效：先跑 npm run prompts -w @gsat/api（沒有花費）。');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as GoldenFile;
    const siteData = localSiteData();
    const siteCases = buildSiteCases({
      bankIndex: await siteData.bankIndex(),
      bankGroup: (key) => readPublic<BankGroupFileLite>(`bank/groups/${key}.json`),
      exams: [111, 112, 113, 114, 115].map((y) => readPublic(`exams/gsat-${y}.json`)),
      vocab: readPublic<{ entries: Array<{ id: string; word: string; level: number; pos: string[]; zh: string }> }>('vocab/index.json').entries,
    });
    const cases: EvalCase[] = [...siteCases, ...fixedCases(golden, siteCases.find((c) => c.group === 'bank'))];
    mkdirSync(OUT_DIR, { recursive: true });
    const results: EvalResultsFile = existsSync(RESULTS_FILE)
      ? (JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as EvalResultsFile)
      : { started_at: new Date().toISOString(), model: config.ai.models.default, cases: {}, spent_micros: 0 };
    const ctx: Ctx = { env, client: createAnthropicClient({ apiKey: config.ai.apiKey ?? '', baseURL: config.ai.baseUrl }), siteData, fp, golden, enoughReport: null };
    // 報告第 2 版要用同一次執行的第 1 版：第 2 版還沒結果時，資料充足那一版也重跑。
    if (needsRun(results.cases['report:second'])) delete results.cases['report:enough'];
    const pending = cases.filter((c) => needsRun(results.cases[caseKey(c)])).length;
    console.log(`[assist-eval] 共 ${cases.length} 題（不含要素材的照片、寫作組），這次要跑 ${pending} 題，已花費 US$${fmt(results.spent_micros / 1e6)}；系統提示 ${assistReportSystemText().length} 字元`);
    let stop: EvalStop | undefined;
    for (const c of cases) {
      const key = caseKey(c);
      if (!needsRun(results.cases[key])) continue;
      // 最貴的一次（報告）也放得下才開始下一題。
      if (results.spent_micros + 600_000 > budgetMicros) {
        stop = { reason: 'budget' };
        console.log(`[assist-eval] 到達累計預算上限 US$${fmt(budgetMicros / 1e6)}，停在 ${key}`);
        break;
      }
      if (deadline !== null && Date.now() >= deadline) {
        stop = { reason: 'time' };
        console.log(`[assist-eval] 到達時間上限 ${limitMinutes} 分鐘，停在 ${key}`);
        break;
      }
      const r = await runCase(ctx, c);
      results.spent_micros += r.calls.reduce((s, x) => s + x.cost_micros, 0);
      if (!r.ok && STOP_FAILURES.has(r.failure ?? '')) {
        stop = { reason: r.failure as 'spend_limit' | 'config_error' };
        writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
        console.log(`[assist-eval] Anthropic 回 ${r.failure}，停在 ${key}（這一題不記成失敗，下次重跑）`);
        break;
      }
      results.cases[key] = r;
      writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    }
    writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    const { markdown, verdict } = summarize(results, cases, stop);
    writeFileSync(SUMMARY_FILE, markdown);
    console.log(markdown);
    console.log(`[assist-eval] 結論：${verdict}；結果：${RESULTS_FILE}`);
    expect(verdict, '評測的結論不是「達標」（passed）：見彙總開頭的結論').toBe('passed');
  });
});
