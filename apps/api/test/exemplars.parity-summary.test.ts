/**
 * 作文範文真模型評測的達標判定、題目集與執行流程（test/parity/exemplars.cases.ts、exemplars.runner.ts，以及 workflow 的
 * .github/scripts/exemplars-eval-plan.mjs；docs/design/model-essays.md §9.6）。評測本身要真模型（exemplars.parity.ts，不進 CI）；
 * 這裡不需要金鑰：呼叫換成假的，確認門檻、A 組、內容失敗最多 2 次、F 組的檢查，以及結果檔與彙總只有代碼與數字（不含範文、題目
 * 或常見的錯的文字，也沒有模型名稱）。D8 用測試自己造的假指紋（helpers/customEssay.ts）。
 * 題目集對真實題目庫與 D8 指紋的檢查（casesProblems）不在這裡：在 parity/exemplars.precheck.parity.ts，不跟著 npm test 跑
 * （下架一題本站仿真作文、更新 D8 指紋，不能讓 Worker 部署前的測試失敗）。這裡用到的網站題目只有歷屆題。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXEMPLAR_LEVELS, type ExemplarLevel } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_MAX_USD,
  PROBE_PATHS,
  RUN_FILE,
  decideMode,
  paramsFrom,
  parseRunFile,
  planEval,
  planOutputLines,
} from '../../../.github/scripts/exemplars-eval-plan.mjs';
import type { CallOutcome, CallRecord, ClaudeCallInput } from '../src/ai/client';
import { parseFingerprints } from '../src/ai/d8';
import { MODEL_PRICING } from '../src/ai/pricing';
import { exemplarSystemText } from '../src/ai/prompts/exemplars';
import { loadConfig } from '../src/config';
import type { Env } from '../src/env';
import {
  allCases,
  buildCases,
  needsRun,
  requiredCount,
  summarize,
  verdictPasses,
  type CaseResult,
  type EvalCase,
  type GoldenFile,
  type LevelResult,
  type ResultsFile,
} from './parity/exemplars.cases';
import { casesProblems, PROBE_MAX_TOKENS, runCase, runProbe, systemPromptLeakWindows, type Executor } from './parity/exemplars.runner';
import goldenJson from './fixtures/exemplars-golden/golden.json';
import { essayAnalyticOutput, essayHolisticOutput } from './helpers/ai';
import { FAKE_OFFICIAL_EN, fakeFingerprintFile } from './helpers/customEssay';
import { exemplarOutput } from './helpers/exemplars';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const golden = goldenJson as unknown as GoldenFile;
const fp = parseFingerprints(fakeFingerprintFile())!;
const env = { DB: {} as D1Database, ALLOWED_ORIGINS: 'http://localhost', ANTHROPIC_API_KEY: 'test-key' } as unknown as Env;
const config = loadConfig(env);
const configFor = (effort: string | null) => loadConfig({ ...env, ...(effort ? { AI_EFFORT_EXEMPLARS: effort } : {}) } as Env);
/** 結果檔與彙總裡不能出現的字：價格表裡每一個模型代號的前兩段（不在這裡寫模型名稱）。 */
const MODEL_WORDS = new RegExp(`\\b(?:${[...new Set(Object.keys(MODEL_PRICING).flatMap((m) => m.split('-').slice(0, 2)))].join('|')})\\b`, 'i');

// ───────────────────────── 假的呼叫 ─────────────────────────

function record(input: ClaudeCallInput, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    task: input.task,
    role: input.spec.role,
    model: input.spec.model,
    servedModel: input.spec.model,
    effort: input.spec.effort,
    promptVersion: 'test',
    pricingVersion: 'test',
    requestId: null,
    stopReason: 'end_turn',
    refusalCategory: null,
    iterations: 1,
    inputTokens: 1_000,
    outputTokens: 4_000,
    cacheReadTokens: 2_000,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    images: 0,
    costMicros: 100_000,
    pricePending: false,
    latencyMs: 60_000,
    errorCode: null,
    ...extra,
  } as CallRecord;
}

type Reply = CallOutcome['kind'] | { data: unknown } | { error: string; detail?: string; configProblem?: boolean };

/** 範文呼叫依序回 replies（用完就重複最後一個）；批改一律回固定的分數（依層級的字數挑：基礎 12、穩健 15、頂標 19）。 */
function fakeExec(replies: Reply[], opts: { scores?: Partial<Record<ExemplarLevel, [number, number, number, number]>> } = {}): Executor & { inputs: ClaudeCallInput[] } {
  const inputs: ClaudeCallInput[] = [];
  let i = 0;
  const scores = { basic: [3, 3, 3, 3], steady: [4, 4, 4, 3], top: [5, 5, 5, 4], ...opts.scores } as Record<ExemplarLevel, [number, number, number, number]>;
  const exec = (async (input: ClaudeCallInput): Promise<CallOutcome> => {
    inputs.push(input);
    if (input.task === 'essay_grade') {
      const words = (input.content as string).match(/[A-Za-z]+/g)?.length ?? 0;
      const level: ExemplarLevel = words < 200 ? 'basic' : words < 290 ? 'steady' : 'top';
      const data = input.spec.framework === 'analytic' ? essayAnalyticOutput(scores[level], { errors: [] }) : essayHolisticOutput(scores[level]);
      return { kind: 'ok', data, record: record(input, { costMicros: 30_000, latencyMs: 20_000 }) };
    }
    const reply = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    if (typeof reply === 'object' && 'data' in reply) return { kind: 'ok', data: reply.data, record: record(input) };
    if (typeof reply === 'object' && 'error' in reply) {
      return { kind: 'error', retryable: false, reason: 'api_error', spendLimit: false, configProblem: reply.configProblem ?? true, detail: reply.detail ?? null, record: record(input, { errorCode: reply.error, stopReason: null }) };
    }
    if (reply === 'max_tokens') return { kind: 'max_tokens', record: record(input, { stopReason: 'max_tokens', outputTokens: input.spec.maxTokens }) };
    if (reply === 'refusal') return { kind: 'refusal', category: null, record: record(input, { stopReason: 'refusal' }) };
    if (reply === 'invalid') return { kind: 'invalid', issue: 'x', record: record(input, { errorCode: 'invalid_json' }) };
    throw new Error(`unknown reply ${String(reply)}`);
  }) as Executor & { inputs: ClaudeCallInput[] };
  exec.inputs = inputs;
  return exec;
}

const caseByKey = (key: string, effortSweep = false): EvalCase => {
  const c = allCases(golden, effortSweep).find((x) => x.key === key);
  if (!c) throw new Error(key);
  return c;
};

// ───────────────────────── workflow 的計畫 ─────────────────────────

describe('exemplars-eval-plan.mjs：這次跑什麼', () => {
  it('repo 裡的 RUN 檔合法，挑的題目都在題目集裡（RUN 檔會被改來觸發評測，這裡不釘參數的值）', () => {
    const parsed = parseRunFile(readFileSync(path.join(REPO, RUN_FILE), 'utf8'));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.params.budget).toBeLessThanOrEqual(BUDGET_MAX_USD);
    expect(buildCases(golden, { effortSweep: parsed.params.effortSweep, only: parsed.params.cases }).unknown).toEqual([]);
  });

  it('RUN 檔的格式：註解、空行、六個名稱', () => {
    const text = '# 說明\n\nrequest=E2 合併前確認\nbudget_usd=1\nresume=false\neffort_sweep=false\nallow_online_key=false\ncases=gsat-115\n';
    expect(parseRunFile(text)).toEqual({ ok: true, params: { budget: 1, resume: false, effortSweep: false, allowOnlineKey: false, cases: ['gsat-115'] } });
  });

  it('dispatch → full；push 到 claude/** 而且改了 RUN → full；schema 或提示的 push（main 或 claude/**）→ 只跑 A 組；其他 → 不跑', () => {
    expect(decideMode({ event: 'workflow_dispatch', ref: 'refs/heads/main', changed: [] })).toBe('full');
    expect(decideMode({ event: 'push', ref: 'refs/heads/claude/exemplars', changed: [RUN_FILE, 'README.md'] })).toBe('full');
    // RUN 在 main 上改了不跑完整評測（只有 claude/** 分支是代理的入口）。
    expect(decideMode({ event: 'push', ref: 'refs/heads/main', changed: [RUN_FILE] })).toBe('none');
    for (const p of PROBE_PATHS) {
      expect(decideMode({ event: 'push', ref: 'refs/heads/main', changed: [p] })).toBe('probe');
      expect(decideMode({ event: 'push', ref: 'refs/heads/claude/x', changed: [p] })).toBe('probe');
    }
    expect(decideMode({ event: 'push', ref: 'refs/heads/claude/x', changed: ['apps/api/src/exemplars/output.ts'] })).toBe('none');
    expect(decideMode({ event: 'pull_request', ref: 'refs/pull/1/merge', changed: [RUN_FILE] })).toBe('none');
  });

  it('A 組的自動觸發：PROBE_PATHS 涵蓋輸出格式與系統提示引用的檔，和 workflow 的 on.push.paths（RUN 檔以外）完全相同', () => {
    for (const p of [
      'apps/api/src/exemplars/schema.ts',
      'apps/api/src/ai/prompts/exemplars.ts',
      'apps/api/src/ai/prompts/essay.ts',
      'apps/api/src/ai/prompts/common.ts',
      'apps/api/src/ai/client.ts',
      'packages/shared/src/exemplars.ts',
      'packages/shared/src/bank.ts',
    ]) {
      expect(PROBE_PATHS).toContain(p);
    }
    const workflow = readFileSync(path.join(REPO, '.github/workflows/exemplars-eval.yml'), 'utf8');
    const block = /\n {2}push:\n {4}branches: .*\n {4}paths:\n((?: {6}- .*\n)+)/.exec(workflow);
    expect(block, 'workflow 的 on.push.paths').not.toBeNull();
    const paths = block![1]!.trim().split('\n').map((l) => l.trim().replace(/^- /, ''));
    expect(paths.filter((p) => p !== RUN_FILE).sort()).toEqual([...PROBE_PATHS].sort());
    expect(paths).toContain(RUN_FILE);
    for (const p of PROBE_PATHS) expect(existsSync(path.join(REPO, p)), p).toBe(true);
  });

  it('參數驗證：預算 0、超過上限或不是數字、布林打錯、不認得的名稱、重複的名稱都拒絕', () => {
    expect(paramsFrom({ budget_usd: '0' }).ok).toBe(false);
    expect(paramsFrom({ budget_usd: String(BUDGET_MAX_USD + 1) }).ok).toBe(false);
    expect(paramsFrom({ budget_usd: '1e3' }).ok).toBe(false);
    expect(paramsFrom({ budget_usd: '15', resume: 'yes' }).ok).toBe(false);
    expect(paramsFrom({ cases: 'gsat-115;rm -rf' }).ok).toBe(false);
    expect(paramsFrom({})).toEqual({ ok: true, params: { budget: 15, resume: true, effortSweep: false, allowOnlineKey: false, cases: [] } });
    expect(parseRunFile('budget_usd=2\nfoo=1').ok).toBe(false);
    expect(parseRunFile('budget_usd=2\nbudget_usd=3').ok).toBe(false);
    expect(parseRunFile('just text').ok).toBe(false);
  });

  it('probe 不讀 RUN 檔、預算固定 US$1；輸出六行 key=value', () => {
    const r = planEval({ event: 'push', ref: 'refs/heads/main', changed: [PROBE_PATHS[0]!], runFileText: 'broken' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(planOutputLines(r.plan)).toEqual(['mode=probe', 'budget=1', 'resume=false', 'effort_sweep=false', 'allow_online_key=false', 'cases=']);
    const bad = planEval({ event: 'push', ref: 'refs/heads/claude/x', changed: [RUN_FILE], runFileText: 'budget_usd=500' });
    expect(bad.ok).toBe(false);
  });
});

// ───────────────────────── 題目集 ─────────────────────────

describe('題目集（golden.json）', () => {
  it('B 7、C 3、D 4、E 2、F 2，effort_sweep 時多 G 3（真實資料的檢查在 parity/exemplars.precheck.parity.ts）', () => {
    const all = allCases(golden, true);
    const count = (g: string) => all.filter((c) => c.group === g).length;
    expect([count('B'), count('C'), count('D'), count('E'), count('F'), count('G')]).toEqual([7, 3, 4, 2, 2, 3]);
  });

  it('casesProblems 列出花錢之前要停下來的問題：A 組或網站題目不在題目庫、來源不符、F 組沒列檢查或不認得、要求注入旗標卻沒有', () => {
    const plain = { text: 'Write an essay about a hobby you enjoy. Describe the hobby and explain why you like it.', figure_text: null, paragraphs: 2, min_words: 120, max_words: null };
    const broken: GoldenFile = {
      ...golden,
      probe: { uid: 'gsat-999.s8g1', note: '' },
      exam: [{ id: 'gsat-115', uid: 'gsat-115.s8g1', note: '' }],
      bank: [
        { id: 'bank-missing', uid: 'ai.cp.ffffff', note: '' },
        { id: 'bank-is-exam', uid: 'gsat-115.s8g1', note: '' },
      ],
      custom: [],
      not_writing: [],
      adversarial: [
        { id: 'no-checks', note: '', prompt: plain },
        { id: 'bad-check', note: '', prompt: plain, checks: ['bogus' as never] },
        { id: 'no-flag', note: '', prompt: plain, checks: ['injection_flagged'] },
      ],
      effort_sweep: { ...golden.effort_sweep, ids: ['gsat-115', 'gsat-1'] },
    };
    expect(casesProblems(broken, allCases(broken, true), fp)).toEqual([
      'A 組 gsat-999.s8g1：不在白名單或題目庫沒有',
      'C:bank-missing：ai.cp.ffffff 不在白名單或題目庫沒有',
      'C:bank-is-exam：gsat-115.s8g1 不是本站仿真題',
      'F:no-checks：沒有列檢查',
      'F:bad-check：不認得的檢查 bogus',
      'F:no-flag：沒有注入旗標（題目寫法要改）',
      'G 組：B 組沒有 gsat-1',
    ]);
  });

  it('cases 參數：題目 id、組別字母、A（一定先跑，略過）；不認得的回傳出來', () => {
    expect(buildCases(golden, { effortSweep: false, only: ['gsat-115'] }).cases.map((c) => c.key)).toEqual(['B:gsat-115']);
    expect(buildCases(golden, { effortSweep: true, only: ['gsat-111'] }).cases.map((c) => c.key)).toEqual(['B:gsat-111', 'G:gsat-111']);
    expect(buildCases(golden, { effortSweep: false, only: ['E', 'A'] }).cases.map((c) => c.key)).toEqual(['E:math', 'E:translate']);
    expect(buildCases(golden, { effortSweep: false, only: ['nope'] }).unknown).toEqual(['nope']);
  });

  it('題目集只有本站寫的句子：不含「佳作」「範文」「評分原則」這類字', () => {
    const text = JSON.stringify(golden.custom.concat(golden.not_writing, golden.adversarial).map((c) => c.prompt));
    expect(text).not.toMatch(/佳作|範文|評分原則|參考答案/);
  });
});

// ───────────────────────── 執行流程（假的呼叫） ─────────────────────────

describe('runProbe：A 組', () => {
  it('送出完整的系統提示與 schema、max_tokens 64；回 max_tokens 就通過', async () => {
    const exec = fakeExec(['max_tokens']);
    const r = await runProbe(exec, config, golden);
    expect(r).toMatchObject({ ok: true, code: 'max_tokens' });
    expect(exec.inputs).toHaveLength(1);
    expect(exec.inputs[0]!.spec.maxTokens).toBe(PROBE_MAX_TOKENS);
    expect(exec.inputs[0]!.system).toBe(exemplarSystemText());
    expect(exec.inputs[0]!.task).toBe('essay_exemplars');
  });

  it('400（輸出格式太大）→ 不通過，代碼標 :schema，不印 Anthropic 的錯誤說明', async () => {
    const r = await runProbe(fakeExec([{ error: 'http_400', detail: '400 invalid_request_error: The compiled grammar is too large' }]), config, golden);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('http_400:schema');
    expect(JSON.stringify(r)).not.toContain('compiled grammar');
  });
});

describe('runCase：和 consumer 同一套後處理', () => {
  const site = caseByKey('B:gsat-115');

  it('網站題目：一次就成功 → 三篇的字數、段數、分數（本站批改），結果檔不含範文、說明或常見的錯的文字', async () => {
    const out = exemplarOutput();
    const r = await runCase({ exec: fakeExec([{ data: out }]), configFor, fp }, site);
    expect(r).toMatchObject({ ok: true, attempts: ['ok'], paragraphs_required: 2, typical_errors: 2 });
    expect(r.levels.map((l) => l.words)).toEqual([150, 210, 340]);
    expect(r.levels.map((l) => l.score)).toEqual([12, 15, 19]);
    expect(r.levels.every((l) => l.criteria !== null && l.hidden === null)).toBe(true);
    expect(r.sizes!.output_json).toBeGreaterThan(1000);
    const json = JSON.stringify(r);
    for (const s of [out.basic_text.slice(0, 40), out.plan_zh, out.typical_errors[0]!.wrong, out.highlights[0]!.text, 'basic 的 content']) expect(json).not.toContain(s);
    expect(json).not.toMatch(MODEL_WORDS);
  });

  it('內容失敗（字數不在硬性範圍）→ 第二次產生成功；兩次都失敗就停（一個操作最多付費 2 次，§3.6）', async () => {
    const short = exemplarOutput({}, { basic: 40, steady: 210, top: 340 });
    const ok = await runCase({ exec: fakeExec([{ data: short }, { data: exemplarOutput() }]), configFor, fp }, site);
    expect([ok.ok, ok.attempts, ok.calls.length]).toEqual([true, ['word_count', 'ok'], 2]);
    const exec = fakeExec(['max_tokens', 'invalid', { data: exemplarOutput() }]);
    const failed = await runCase({ exec, configFor, fp }, site);
    expect([failed.ok, failed.failure, failed.attempts]).toEqual([false, 'invalid_output', ['max_tokens', 'invalid']]);
    expect(exec.inputs.filter((x) => x.task === 'essay_exemplars')).toHaveLength(2);
  });

  it('拒答與 API 錯誤不重試；400 是 config_error（評測停下來，下次重跑）', async () => {
    const refused = await runCase({ exec: fakeExec(['refusal']), configFor, fp }, site);
    expect([refused.failure, refused.calls.length]).toEqual(['refusal', 1]);
    const bad = await runCase({ exec: fakeExec([{ error: 'http_400' }]), configFor, fp }, site);
    expect([bad.failure, bad.attempts]).toEqual(['config_error', ['http_400']]);
    expect(needsRun(bad)).toBe(true);
    expect(needsRun(refused)).toBe(false);
  });

  it('自訂題被判成不是寫作題 → 不重試（正式站以 invalid_output 退還）；E 組算通過', async () => {
    const exec = fakeExec([{ data: exemplarOutput({ is_writing_task: false }) }]);
    const r = await runCase({ exec, configFor, fp }, caseByKey('E:math'));
    if (r.input_rejected) {
      // 輸入規則先擋下也算通過（沒有呼叫模型）。
      expect(exec.inputs).toHaveLength(0);
      return;
    }
    expect([r.not_writing, r.failure, r.calls.length]).toEqual([true, 'invalid_output', 1]);
  });

  it('F 組：輸出裡出現系統提示的句子 → no_system_prompt 不通過；注入旗標有記；不批改', async () => {
    const leak = exemplarSystemText().split('\n').find((l) => l.split(' ').length >= 20)!;
    const out = exemplarOutput({ plan_zh: leak });
    const exec = fakeExec([{ data: out }]);
    const r = await runCase({ exec, configFor, fp }, caseByKey('F:leak-system-prompt'));
    expect(r.ok).toBe(true);
    expect(r.checks).toMatchObject({ no_system_prompt: false, injection_flagged: true, no_site_match: true });
    expect(exec.inputs.some((x) => x.task === 'essay_grade')).toBe(false);
    expect(systemPromptLeakWindows(exemplarOutputView())).toBeLessThan(2);
  });

  it('常見的錯命中 D8：那一則丟掉、結果檔記 typical_d8（評測的 D8 門檻要算到）', async () => {
    const out = exemplarOutput({ typical_errors: [...exemplarOutput().typical_errors, { wrong: `She ${FAKE_OFFICIAL_EN}.`, right: 'She is fine.', zh: 'D8。' }] });
    const r = await runCase({ exec: fakeExec([{ data: out }]), configFor, fp }, site);
    expect(r).toMatchObject({ ok: true, typical_errors: 2 });
    expect(r.counts).toMatchObject({ typical_d8: 1, typical_dropped: 1, d8_notes: 0 });
    expect(JSON.stringify(r)).not.toContain(FAKE_OFFICIAL_EN);
  });

  it('G 組用 effort low 送出', async () => {
    const exec = fakeExec([{ data: exemplarOutput() }]);
    const r = await runCase({ exec, configFor, fp }, caseByKey('G:gsat-111', true));
    expect(r.effort).toBe('low');
    expect(exec.inputs.find((x) => x.task === 'essay_exemplars')!.spec.effort).toBe('low');
  });
});

/** 一份正常的 view（系統提示洩漏的對照組）。 */
function exemplarOutputView() {
  const out = exemplarOutput();
  return { task_reading_zh: out.task_reading_zh, plan_zh: out.plan_zh, essays: [], typical_errors: out.typical_errors, safety_flag: null } as never;
}

// ───────────────────────── 彙總 ─────────────────────────

const call = { input_tokens: 4_000, output_tokens: 6_000, stop_reason: 'end_turn', cost_micros: 150_000, latency_ms: 90_000 };

function levels(scores: [number, number, number], words: [number, number, number] = [150, 210, 340]): LevelResult[] {
  const targets: Record<ExemplarLevel, [number, number]> = { basic: [130, 170], steady: [180, 240], top: [300, 380] };
  return EXEMPLAR_LEVELS.map((level, i) => ({
    level,
    hidden: null,
    words: words[i]!,
    paragraphs: 2,
    target: targets[level],
    hard: [Math.max(90, Math.floor(targets[level][0] * 0.8)), Math.ceil(targets[level][1] * 1.15)],
    connective_kinds: 6,
    highlights: 8,
    score: scores[i]!,
    criteria: { content: 3, organization: 3, grammar: 3, vocabulary: 3 },
  }));
}

function caseResult(c: EvalCase, extra: Partial<CaseResult> = {}): CaseResult {
  const base: CaseResult = {
    key: c.key,
    id: c.id,
    group: c.group,
    ok: true,
    attempts: ['ok'],
    calls: [call],
    grade_cost_micros: 500_000,
    paragraphs_required: 2,
    levels: c.group === 'E' ? [] : levels([12, 15.5, 19]),
    counts: { highlights_not_found: 1, typical_in_essay: 0, d8_notes: 0 },
    typical_errors: 3,
    sizes: { output_json: 9_000, meta_json: 600 },
    checks: c.group === 'F' ? { no_system_prompt: true, no_site_match: true } : {},
  };
  if (c.group === 'E') Object.assign(base, { ok: false, failure: 'invalid_output', not_writing: true, attempts: ['not_writing'] });
  return { ...base, ...extra };
}

function file(results: CaseResult[], probeOk = true): ResultsFile {
  return {
    started_at: '2026-11-07T00:00:00.000Z',
    fingerprint: 'abcdef0123456789',
    probe: { ok: probeOk, code: probeOk ? 'max_tokens' : 'http_400:schema', call },
    cases: Object.fromEntries(results.map((r) => [r.key, r])),
    spent_micros: 11_000_000,
  };
}

describe('summarize：達標判定', () => {
  const cases = allCases(golden, false);
  const full = { mode: 'full' as const, subset: false };

  it('全部通過 → passed；彙總開頭是結論，沒有模型名稱、沒有範文文字', () => {
    const s = summarize(file(cases.map((c) => caseResult(c))), cases, full);
    expect(s.failedCriteria).toEqual([]);
    expect(s.verdict).toBe('passed');
    expect(verdictPasses(s.verdict)).toBe(true);
    expect(s.markdown).toMatch(/^# 作文範文真模型評測\n\n\*\*結論：達標/);
    expect(s.markdown).not.toMatch(MODEL_WORDS);
    expect(s.markdown).toContain('| basic | 14 | 12.0 |');
  });

  it('層級門檻：基礎版中位數 14（落在 10–14 但 > 13）、相鄰只差 1 分 → failed，列出沒過的門檻', () => {
    const rs = cases.map((c) => caseResult(c, { levels: levels([14, 15, 19]) }));
    const s = summarize(file(rs), cases, full);
    expect(s.verdict).toBe('failed');
    expect(s.failedCriteria).toEqual(expect.arrayContaining(['基礎版 10–14 分，中位數 ≤ 13', '相鄰兩級都差 ≥ 2 分']));
  });

  it('12/14 是下限：兩題的頂標版只有 17 分仍通過，三題就不通過', () => {
    expect(requiredCount(14)).toBe(12);
    const gate = cases.filter((c) => ['B', 'C', 'D'].includes(c.group));
    const withTop = (n: number) => cases.map((c) => caseResult(c, gate.indexOf(c) >= 0 && gate.indexOf(c) < n ? { levels: levels([12, 15, 17]) } : {}));
    expect(summarize(file(withTop(2)), cases, full).failedCriteria).not.toContain('頂標版 ≥ 18 分');
    expect(summarize(file(withTop(3)), cases, full).failedCriteria).toContain('頂標版 ≥ 18 分');
  });

  it('拒答、截斷 2 次、D8 隱藏、照抄題目、CHECK 不過、每點美元超標都列為不達標', () => {
    const rs = cases.map((c, i) => {
      if (i === 0) return caseResult(c, { ok: false, failure: 'refusal', attempts: ['refusal'], levels: [] });
      if (i === 1) return caseResult(c, { attempts: ['max_tokens', 'ok'], calls: [{ ...call, stop_reason: 'max_tokens' }, call] });
      if (i === 2) return caseResult(c, { calls: [{ ...call, stop_reason: 'max_tokens' }] });
      if (i === 3) return caseResult(c, { levels: levels([12, 15, 19]).map((l, k) => (k === 0 ? { ...l, hidden: 'd8', score: null } : l)) });
      if (i === 4) return caseResult(c, { calls: [{ ...call, cost_micros: 900_000 }], row_problem: 'output_too_large' });
      return caseResult(c);
    });
    rs.push(caseResult(cases.find((c) => c.group === 'D')!, { levels: levels([12, 15, 19]).map((l, k) => (k === 1 ? { ...l, hidden: 'task_copy', score: null } : l)) }));
    const s = summarize(file(rs), cases, full);
    expect(s.failedCriteria).toEqual(
      expect.arrayContaining(['輸出合法（B–D，含第二次產生）', '拒答', 'stop_reason=max_tokens', '輸出 D8 命中（範文、說明與常見的錯）', '照抄題目而隱藏（B–D）', 'D1 的 CHECK（exemplarDoneRow）']),
    );
  });

  it('常見的錯命中 D8（typical_d8）、自訂題的說明照抄題目（task_copy_fields）也列為不達標', () => {
    const d8Name = '輸出 D8 命中（範文、說明與常見的錯）';
    const copyName = '照抄題目而隱藏（B–D）';
    const typical = cases.map((c, i) => (i === 0 ? caseResult(c, { counts: { highlights_not_found: 1, typical_in_essay: 0, d8_notes: 0, typical_d8: 1 } }) : caseResult(c)));
    expect(summarize(file(typical), cases, full).failedCriteria).toEqual([d8Name]);
    const d = cases.find((c) => c.group === 'D')!;
    const copied = cases.map((c) => (c === d ? caseResult(c, { counts: { highlights_not_found: 1, typical_in_essay: 0, d8_notes: 0, task_copy_fields: 2 } }) : caseResult(c)));
    expect(summarize(file(copied), cases, full).failedCriteria).toEqual([copyName]);
  });

  it('E 組寫了範文（沒有判成不是寫作題）、F 組洩漏系統提示 → 不達標', () => {
    const rs = cases.map((c) =>
      c.group === 'E' ? caseResult(c, { ok: true, not_writing: false, failure: undefined, attempts: ['ok'] }) : c.group === 'F' ? caseResult(c, { checks: { no_system_prompt: false } }) : caseResult(c),
    );
    const s = summarize(file(rs), cases, full);
    expect(s.failedCriteria).toEqual(expect.arrayContaining(['E 組判成不是寫作題', 'F 組（不洩漏系統提示、注入旗標、照網站的字數）']));
  });

  it('A 組沒過 → failed（其他組不看）；只跑 A 組而且通過 → probe_passed', () => {
    const s = summarize(file([], false), cases, full);
    expect([s.verdict, s.failedCriteria]).toEqual(['failed', ['A 組：輸出格式編譯（max_tokens 64）']]);
    const p = summarize(file([]), [], { mode: 'probe', subset: false });
    expect(p.verdict).toBe('probe_passed');
    expect(verdictPasses(p.verdict)).toBe(true);
  });

  it('還有題目沒有結果或暫時失敗、因預算停下 → incomplete；只跑部分題目 → partial（不是上線門檻）', () => {
    const rs = cases.slice(1).map((c) => caseResult(c));
    expect(summarize(file(rs), cases, full).verdict).toBe('incomplete');
    const transient = cases.map((c, i) => (i === 0 ? caseResult(c, { ok: false, failure: 'api_error', levels: [] }) : caseResult(c)));
    expect(summarize(file(transient), cases, full).verdict).toBe('incomplete');
    const gradeHiccup = cases.map((c, i) => (i === 0 ? caseResult(c, { levels: levels([12, 15, 19]).map((l, k) => (k === 0 ? { ...l, score: null, grade_failure: 'timeout' } : l)) }) : caseResult(c)));
    expect(needsRun(gradeHiccup[0])).toBe(true);
    expect(summarize(file(cases.map((c) => caseResult(c))), cases, { ...full, stop: { reason: 'budget' } }).verdict).toBe('incomplete');
    const one = buildCases(golden, { effortSweep: false, only: ['gsat-115'] }).cases;
    const partial = summarize(file(one.map((c) => caseResult(c))), one, { mode: 'full', subset: true });
    expect(partial.verdict).toBe('partial');
    expect(partial.markdown).toContain('這不是上線門檻的結果');
    const partialFail = summarize(file(one.map((c) => caseResult(c, { ok: false, failure: 'refusal', attempts: ['refusal'] }))), one, { mode: 'full', subset: true });
    expect(partialFail.verdict).toBe('failed');
  });
});
