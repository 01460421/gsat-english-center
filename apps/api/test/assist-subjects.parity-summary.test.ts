/**
 * 學習助手國文真模型評測的達標判定、題目集與執行流程（test/parity/assist-subjects.cases.ts、assist-subjects.runner.ts，以及 workflow 的
 * .github/scripts/assistant-subjects-eval-plan.mjs；docs/design/assistant-subjects.md §11.2–§11.4、「國寫範文」§11）。評測本身要真模型
 * （assist-subjects.parity.ts，不進 CI）；這裡不需要金鑰、不連網路：呼叫換成假的，確認 A 組、內容失敗最多 2 次、科目不符、
 * 逐題指標（注音逐字、錯字配對、研判逐句、提示洩漏、照片逐字錯誤率、國寫範文的字數與比賽語料指紋）、門檻與「最高可能」上限的
 * 解除規則，以及結果檔與彙總只有代碼與數字（沒有模型寫的文字，也沒有模型名稱）。D8 用測試自己造的假指紋（英文 helpers/customEssay.ts；
 * 國文的 8 字窗口是空集合，比賽語料是 helpers/zh.ts 的誘餌）。這裡的假輸出都是本站為測試寫的句子；題目文字來自題目集（公開題本與
 * 本站自寫），沒有任何參考答案或評分原則；K 組只有一個測試讀 repo 裡比賽語料指紋的雜湊檔（data/d8/zh-contest.fp.json），不讀語料。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { zhExemplarLimits } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_MAX_USD,
  GROUP_SELECTORS,
  PROBE_PATHS,
  RUN_FILE,
  decideMode,
  globToRegExp,
  matchesProbePath,
  paramsFrom,
  parseRunFile,
  planEval,
  planOutputLines,
} from '../../../.github/scripts/assistant-subjects-eval-plan.mjs';
import type { CallOutcome, CallRecord, ClaudeCallInput } from '../src/ai/client';
import * as contestMjs from '../../../packages/shared/scripts/zh-contest-fingerprint.mjs';
import { d8Fingerprints, parseFingerprints } from '../src/ai/d8';
import { MODEL_PRICING } from '../src/ai/pricing';
import { loadConfig } from '../src/config';
import type { Env } from '../src/env';
import { zhFingerprints, type ZhFingerprints } from '../src/assist/subjects/chinese/d8';
import type { ZhChoiceOutput, ZhExemplarOutput, ZhFollowupOutput, ZhOcrOutput, ZhShortOutput, ZhWritingOutput } from '../src/assist/subjects/chinese/schemas';
import { zhLookupClassic } from '../src/assist/subjects/chinese/classics';
import { zhContestHit } from '../src/assist/subjects/chinese/contest';
import { zhExemplarTitleRule } from '../src/assist/subjects/chinese/requests';
import { zhStudentQuestion } from '../src/assist/subjects/chinese/question';
import {
  EVAL_GROUPS,
  MUST_PASS_ID,
  allCases,
  buildCases,
  capDecision,
  lcsLength,
  leaksAnswer,
  needsRun,
  probeCases,
  shuffleCase,
  studentQuestionOf,
  summarize,
  syllableKey,
  verdictPasses,
  type AnalyzeCase,
  type CallMetric,
  type CaseResult,
  type ChoiceItemResult,
  type EvalCase,
  type ExemplarCase,
  type FollowupCase,
  type OcrCase,
  type OpResult,
  type ResultsFile,
} from './parity/assist-subjects.cases';
import { casesProblems, metricOf, probeSystemTexts, readGolden, runCase, runProbe, type Executor, type RunDeps } from './parity/assist-subjects.runner';
import { fakeFingerprintFile } from './helpers/customEssay';
import { ZH_DECOY_CONTEST, zhContestSet, zhExemplarOutput } from './helpers/zh';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const GOLDEN_DIR = path.join(REPO, 'apps', 'api', 'test', 'fixtures', 'assist-zh-golden');
const { golden } = readGolden(GOLDEN_DIR);
const fp = parseFingerprints(fakeFingerprintFile())!;
const zh: ZhFingerprints = { version: 'test-zh-eval', windows: new Set(), short: [], contest: zhContestSet() };
const env = { DB: {} as D1Database, ALLOWED_ORIGINS: 'http://localhost', ANTHROPIC_API_KEY: 'test-key' } as unknown as Env;
const config = loadConfig(env);
/** 結果檔與彙總裡不能出現的字：價格表裡每一個模型代號的前兩段（不在這裡寫模型名稱）。 */
const MODEL_WORDS = new RegExp(`\\b(?:${[...new Set(Object.keys(MODEL_PRICING).flatMap((m) => m.split('-').slice(0, 2)))].join('|')})\\b`, 'i');

const caseOf = <T extends EvalCase = AnalyzeCase>(key: string): T => {
  const c = allCases(golden).find((x) => x.key === key);
  if (!c) throw new Error(key);
  return c as T;
};

function deps(exec: Executor): RunDeps {
  return { exec, config, fp, zh, goldenDir: GOLDEN_DIR, views: new Map() };
}

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
    inputTokens: 2_000,
    outputTokens: 4_000,
    cacheReadTokens: 5_000,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    images: 0,
    costMicros: 90_000,
    pricePending: false,
    latencyMs: 30_000,
    errorCode: null,
    ...extra,
  } as CallRecord;
}

type Reply = CallOutcome['kind'] | { data: unknown } | { error: string; detail?: string; configProblem?: boolean };

/** 依序回 replies（用完就重複最後一個）；replies 也可以是依請求決定的函式。 */
function fakeExec(replies: Reply[] | ((input: ClaudeCallInput) => Reply)): Executor & { inputs: ClaudeCallInput[] } {
  const inputs: ClaudeCallInput[] = [];
  let i = 0;
  const exec = (async (input: ClaudeCallInput): Promise<CallOutcome> => {
    inputs.push(input);
    const reply = typeof replies === 'function' ? replies(input) : replies[Math.min(i, replies.length - 1)]!;
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

// ───────────────────────── 假的模型輸出（本站為測試寫的句子） ─────────────────────────

type ChoiceItemOut = ZhChoiceOutput['items'][number];
function choiceItem(label: string, answer: string, verdicts: Record<string, string>, extra: Partial<ChoiceItemOut> = {}): ChoiceItemOut {
  return {
    label,
    item_type: 'zh_other',
    answer: { text: answer, certainty: 'sure' },
    diagnosis: { error_codes: [], summary_zh: '先回到題目找依據。', detail_zh: '逐一比對每個選項。' },
    hints_zh: ['先圈出題目要判斷的詞。', '想一想每個選項的關鍵字。'],
    solution_steps: [{ text_zh: '先讀題目。', quote: '' }],
    options: Object.entries(verdicts).map(([option, verdict]) => ({ option, verdict, key_zh: '依題意判斷', reason_zh: '依題意判斷。', quote: '', flaw: '' })),
    ...extra,
  };
}
function choiceOut(items: ChoiceItemOut[], extra: Partial<ZhChoiceOutput> = {}): ZhChoiceOutput {
  return {
    section: items[0]?.item_type ?? 'zh_other',
    detected_subject: 'chinese',
    skill_codes: ['zs:A1'],
    tested_zh: '這題在考判讀。',
    passage_zh: '',
    cards: [],
    items,
    method: { title_zh: '先讀題目', steps_zh: ['圈出關鍵詞', '回到原文'] },
    score_tips_zh: ['多練習。', '回原文找證據。'],
    doubt_replies: [],
    followup_chips_zh: [],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}
function shortOut(parts: Array<{ label: string; demo: string }>): ZhShortOutput {
  return {
    section: 'zh_short_answer',
    detected_subject: 'chinese',
    skill_codes: ['zs:B2'],
    tested_zh: '這題在考摘取要點。',
    passage_zh: '作者談從師之道。',
    cards: [],
    parts: parts.map((p) => ({
      label: p.label,
      task_zh: '問了一件事。',
      key_points: [{ point_zh: '老師的職責', quote: '傳道受業解惑' }],
      frame_zh: '老師要＿＿。',
      demo_zh: p.demo,
      hints_zh: ['先找出說明老師的句子。', '再數字數。'],
      check: { coverage: 'partial', missing_zh: '少寫一個要點。', wording_zh: '' },
    })),
    method: { title_zh: '非選擇題', steps_zh: ['拆要件', '找依據'] },
    score_tips_zh: ['先數要件。', '對字數。'],
    doubt_replies: [],
    followup_chips_zh: [],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
  };
}
function writingOut(extra: Partial<ZhWritingOutput> = {}): ZhWritingOutput {
  return {
    section: 'zh_writing_reason',
    detected_subject: 'chinese',
    skill_codes: ['zs:W1'],
    tested_zh: '分析標籤對人的影響。',
    material_zh: '甲、乙兩文談標籤。',
    requirements: [{ point_zh: '說明兩文的觀點', quote: '標籤', how_zh: '先各用一句話寫出兩文的主張。' }],
    q1: { points_zh: ['甲文：標籤簡化判斷'], quotes: ['標籤'], frame_zh: '甲文認為＿＿；乙文認為＿＿。', demo_zh: '' },
    stances_zh: ['標籤可以是起點'],
    angles_zh: ['班上的綽號'],
    outline: [{ part_zh: '開頭', hint_zh: '從一個綽號寫起。' }],
    examples: [{ use_zh: '開頭', text: '那個綽號跟了我三年，直到我自己決定撕下它。' }],
    pitfalls_zh: ['只重述材料。', '這樣寫可以拿到 A 等。'],
    draft_checks: [],
    typos: [],
    checklist_zh: ['有沒有回應題目？'],
    doubt_replies: [],
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    ...extra,
  };
}
function followupOut(reply: string): ZhFollowupOutput {
  return { reply_zh: reply, points: [{ text_zh: '回到原文看主詞。', example: '' }], mode_used: 'hint', new_error_codes: [], understood_check_zh: '你覺得②在說什麼？', followup_chips_zh: [], off_topic: false, safety_flag: 'none' };
}

// ───────────────────────── workflow 的計畫 ─────────────────────────

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(path.relative(REPO, full).split(path.sep).join('/'));
  }
  return out;
}

describe('assistant-subjects-eval-plan.mjs：這次跑什麼', () => {
  it('repo 裡的 RUN 檔合法，挑的題目都在題目集裡（RUN 檔會被改來觸發評測，這裡不釘參數的值）', () => {
    const parsed = parseRunFile(readFileSync(path.join(REPO, RUN_FILE), 'utf8'));
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.params.budget).toBeLessThanOrEqual(BUDGET_MAX_USD);
    expect(buildCases(golden, { only: parsed.params.cases }).unknown).toEqual([]);
  });

  it('RUN 檔的格式：註解、空行、五個名稱；cases 可以寫組別（BS、BP）或題目 id', () => {
    const text = '# 說明\n\nrequest=S3 完整評測\nbudget_usd=25\nresume=true\nallow_online_key=false\ncases=BS,BP-05\n';
    expect(parseRunFile(text)).toEqual({ ok: true, params: { budget: 25, resume: true, allowOnlineKey: false, cases: ['BS', 'BP-05'] } });
    expect(buildCases(golden, { only: ['BS', 'BP-05'] }).cases.map((c) => c.group)).toEqual([...Array(58).fill('BS'), 'BP']);
    expect(buildCases(golden, { only: ['B-115-12'] }).cases.map((c) => c.key)).toEqual(['B:B-115-12', 'BS:B-115-12']);
    expect(buildCases(golden, { only: ['A'] }).cases).toEqual([]);
    expect(buildCases(golden, { only: ['nope'] }).unknown).toEqual(['nope']);
    // 國寫範文只跑 K 組（RUN 檔的說明寫 cases=K 約 US$2.5）。
    expect(parseRunFile('cases=K\nbudget_usd=5').ok).toBe(true);
    expect(buildCases(golden, { only: ['K'] }).cases.map((c) => c.kind)).toEqual(Array(6).fill('exemplar'));
  });

  it('push 到 claude/** 而且改了 RUN → full；國文的提示、schema、後處理的 push（main 或 claude/**）→ 只跑 A 組；其他 → 不跑', () => {
    expect(decideMode({ event: 'workflow_dispatch', ref: 'refs/heads/main', changed: [] })).toBe('full');
    expect(decideMode({ event: 'push', ref: 'refs/heads/claude/assistant-subjects', changed: [RUN_FILE, 'README.md'] })).toBe('full');
    // RUN 在 main 上改了不跑完整評測（只有 claude/** 分支是代理的入口）。
    expect(decideMode({ event: 'push', ref: 'refs/heads/main', changed: [RUN_FILE] })).toBe('none');
    for (const f of ['apps/api/src/assist/subjects/chinese/output.ts', 'apps/api/src/ai/prompts/assist-zh-ocr.ts', 'apps/api/test/fixtures/assist-prompts-zh.json', 'packages/shared/src/assist.ts']) {
      expect(decideMode({ event: 'push', ref: 'refs/heads/main', changed: [f] }), f).toBe('probe');
      expect(decideMode({ event: 'push', ref: 'refs/heads/claude/x', changed: [f] }), f).toBe('probe');
    }
    // 英文的提示、其他 shared 檔不觸發國文的探測。
    for (const f of ['apps/api/src/ai/prompts/assist-analyze.ts', 'packages/shared/src/assist-codes.ts', 'apps/api/src/assist/output.ts']) expect(decideMode({ event: 'push', ref: 'refs/heads/main', changed: [f] }), f).toBe('none');
    expect(decideMode({ event: 'pull_request', ref: 'refs/pull/1/merge', changed: [RUN_FILE] })).toBe('none');
    expect(globToRegExp('apps/api/src/ai/prompts/assist-zh*.ts').test('apps/api/src/ai/prompts/sub/assist-zh.ts')).toBe(false);
    expect(matchesProbePath('apps/api/src/assist/subjects/chinese/deep/x.ts')).toBe(true);
  });

  it('不自動花錢（站主 2026-10-30）：workflow 只有手動的 workflow_dispatch，沒有 push 觸發；PROBE_PATHS 每一條仍對得到 repo 裡的檔', () => {
    const workflow = readFileSync(path.join(REPO, '.github/workflows/assistant-subjects-eval.yml'), 'utf8');
    const on = /\non:\n([\s\S]*?)\n(?:permissions|concurrency|env|jobs):/.exec(workflow)![1]!;
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    expect(on).not.toMatch(/^ {2}(push|pull_request|schedule|workflow_run):/m);
    for (const p of PROBE_PATHS) {
      const dir = p.slice(0, p.search(/\*|$/)).replace(/[^/]*$/, '');
      expect(filesUnder(path.join(REPO, dir)).some((f) => globToRegExp(p).test(f)), p).toBe(true);
    }
  });

  it('組別：plan 腳本、題目集與 workflow 的 cases 說明列同一份（K 國寫範文也在）；RUN 檔的說明寫了只跑 K 組的費用', () => {
    expect([...GROUP_SELECTORS].sort()).toEqual(['A', ...EVAL_GROUPS].sort());
    expect(EVAL_GROUPS).toContain('K');
    const workflow = readFileSync(path.join(REPO, '.github/workflows/assistant-subjects-eval.yml'), 'utf8');
    const desc = /\n {6}cases:\n {8}description: ([^\n]+)/.exec(workflow)![1]!;
    for (const g of GROUP_SELECTORS) expect(desc, g).toMatch(new RegExp(`(^|[^A-Z])${g}(?![A-Z])`));
    const run = readFileSync(path.join(REPO, RUN_FILE), 'utf8');
    expect(run).toMatch(/cases=K/);
    expect(run).toMatch(/K 國寫範文/);
  });

  it('金鑰只用既有的兩個 secret（沒有新的 secret、沒有國文 D8 的金鑰）', () => {
    const workflow = readFileSync(path.join(REPO, '.github/workflows/assistant-subjects-eval.yml'), 'utf8');
    expect(new Set([...workflow.matchAll(/secrets\.([A-Za-z_]+)/g)].map((m) => m[1]))).toEqual(new Set(['ANTHROPIC_PARITY_API_KEY', 'ANTHROPIC_API_KEY']));
    for (const text of [workflow, readFileSync(path.join(REPO, RUN_FILE), 'utf8')]) expect(text).not.toMatch(/D8_ZH_KEY/);
  });

  it('參數驗證：預算 0、超過上限或不是數字、布林打錯、不認得的名稱、重複的名稱都拒絕；probe 不讀 RUN 檔、預算固定 US$1', () => {
    expect(paramsFrom({ budget_usd: '0' }).ok).toBe(false);
    expect(paramsFrom({ budget_usd: String(BUDGET_MAX_USD + 1) }).ok).toBe(false);
    expect(paramsFrom({ budget_usd: '1e3' }).ok).toBe(false);
    expect(paramsFrom({ budget_usd: '15', resume: 'yes' }).ok).toBe(false);
    expect(paramsFrom({ cases: 'A;rm -rf' }).ok).toBe(false);
    expect(paramsFrom({})).toEqual({ ok: true, params: { budget: 25, resume: true, allowOnlineKey: false, cases: [] } });
    expect(parseRunFile('budget_usd=2\neffort_sweep=true').ok).toBe(false);
    expect(parseRunFile('budget_usd=2\nbudget_usd=3').ok).toBe(false);
    const r = planEval({ event: 'push', ref: 'refs/heads/main', changed: ['apps/api/src/ai/client.ts'], runFileText: 'broken' });
    expect(r.ok && planOutputLines(r.plan)).toEqual(['mode=probe', 'budget=1', 'resume=false', 'allow_online_key=false', 'cases=']);
    expect(planEval({ event: 'push', ref: 'refs/heads/claude/x', changed: [RUN_FILE], runFileText: 'budget_usd=500' }).ok).toBe(false);
  });
});

// ───────────────────────── 題目集 ─────────────────────────

/**
 * 已知、還沒修的問題（評測本身在花錢之前會因為它們停下來，所以完整評測之前一定要修好、把這裡清空）。目前沒有：選項印注音的
 * 字音題（106 學測國文第 1 題、B′ 第 3 題）曾因漢字不到 30 個被當成不是國文，輸入規則已改成注音字元也算國文的字。
 */
const KNOWN_INPUT_PROBLEMS: string[] = [];

describe('題目集（assist-zh-golden）', () => {
  it('A 6、B 58、重排版 58、B′ 12、C 10、D 3、E 8、F 5、G 6、H 6、J 14（其中 11 張可以跑）、K 6', () => {
    const all = allCases(golden);
    const count = (g: string) => all.filter((c) => c.group === g).length;
    expect([golden.A.length, ...['B', 'BS', 'BP', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'].map(count)]).toEqual([6, 58, 58, 12, 10, 3, 8, 5, 6, 6, 14, 6]);
    expect(all.filter((c): c is OcrCase => c.kind === 'ocr' && !c.skip)).toHaveLength(11);
    expect(probeCases(golden).map((p) => p.task)).toEqual(['zh_choice', 'zh_short', 'zh_writing', 'zh_followup', 'zh_ocr', 'zh_exemplar']);
    // golden.json 的題數和各組的檔一致（K 組是新加的；A 組多了國寫範文那一份）。
    const index = JSON.parse(readFileSync(path.join(GOLDEN_DIR, 'golden.json'), 'utf8')) as { groups: Array<{ id: string; count: number }> };
    expect(index.groups.find((g) => g.id === 'A')?.count).toBe(golden.A.length);
    expect(index.groups.find((g) => g.id === 'K')?.count).toBe(golden.K.length);
  });

  it('每一題都組得出來：不被輸入規則或 D8 擋下、格式與題號對、選項抽得出來、答案鍵帶得進去、照片都在（花錢之前的同一支檢查）', () => {
    expect(casesProblems(golden, allCases(golden), { config, fp, zh, goldenDir: GOLDEN_DIR })).toEqual(KNOWN_INPUT_PROBLEMS);
  });

  it('重排版：選項依 order 重排、題號改掉；答案、學生作答與標注跟著換，正解選項的文字不變', () => {
    for (const q of golden.B) {
      const s = shuffleCase(q);
      for (const [i, it] of q.items.entries()) {
        const sh = s.items[i]!;
        expect(sh.label, q.id).not.toBe(it.label);
        const text = (o: Record<string, string> | undefined, letters: string) => [...letters].map((l) => o?.[l]).sort();
        expect(text(sh.options, sh.key ?? ''), q.id).toEqual(text(it.options, it.key ?? ''));
        expect(text(sh.options, sh.student_answer ?? ''), q.id).toEqual(text(it.options, it.student_answer ?? ''));
        for (const n of sh.annotations?.sound ?? []) expect(sh.options?.[n.option], `${q.id} ${n.char}`).toContain(n.char);
        for (const n of sh.annotations?.form ?? []) expect(sh.options?.[n.option], `${q.id} ${n.wrong}`).toContain(n.wrong);
        expect(sh.annotations?.judge).toEqual(it.annotations?.judge);
      }
    }
  });

  it(`必過題 ${MUST_PASS_ID} 在 B 組：研判、兩句都是否定標籤；C 組的 base 都有官方答案`, () => {
    const must = golden.B.find((q) => q.id === MUST_PASS_ID)!;
    expect(must.choice_mode).toBe('judge');
    expect(Object.values(must.items[0]!.annotations!.judge!.statements)).toEqual(['no', 'no']);
    for (const c of golden.C) expect(golden.B.find((q) => q.id === c.base)?.items.every((it) => typeof it.key === 'string' && it.key !== ''), c.id).toBe(true);
  });
});

// ───────────────────────── 執行流程（假的呼叫） ─────────────────────────

describe('runProbe：A 組', () => {
  it('六份都送完整的系統提示與 schema、max_tokens 64（轉錄附照片；國寫範文用 F-111-1 的題目與固定摘要）；回 max_tokens 就通過', async () => {
    const exec = fakeExec(['max_tokens']);
    const r = await runProbe(deps(exec), probeCases(golden), 'loaded');
    expect(r.ok).toBe(true);
    expect(r.runs.map((x) => [x.id, x.code])).toEqual([
      ['A-choice', 'max_tokens'],
      ['A-short', 'max_tokens'],
      ['A-writing', 'max_tokens'],
      ['A-followup', 'max_tokens'],
      ['A-ocr', 'max_tokens'],
      ['A-exemplar', 'max_tokens'],
    ]);
    expect(exec.inputs.map((x) => [x.task, x.spec.maxTokens])).toEqual([
      ['assist_analyze', 64],
      ['assist_analyze', 64],
      ['assist_analyze', 64],
      ['assist_followup', 64],
      ['assist_ocr', 64],
      ['assist_zh_exemplar', 64],
    ]);
    const sys = probeSystemTexts();
    expect(exec.inputs.slice(0, 4).map((x) => x.system)).toEqual([sys.zh_choice, sys.zh_short, sys.zh_writing, sys.zh_followup]);
    expect(Array.isArray(exec.inputs[4]!.content) && exec.inputs[4]!.content.some((b) => b.type === 'image')).toBe(true);
    const ex = exec.inputs[5]!;
    expect(ex.system).toBe(sys.zh_exemplar);
    expect(typeof ex.content === 'string' && ex.content).toMatch(/問題（一）: at most 80 characters including punctuation\.[\s\S]*Title given: 「樂齡出遊」[\s\S]*<analysis_digest>/);
  });

  it('400（輸出格式太大）→ 不通過，代碼標 :schema，不印 Anthropic 的錯誤說明', async () => {
    let n = 0;
    const exec = fakeExec(() => (n++ === 1 ? { error: 'http_400', detail: '400 invalid_request_error: The compiled grammar is too large' } : 'max_tokens'));
    const r = await runProbe(deps(exec), probeCases(golden), 'empty');
    expect(r.ok).toBe(false);
    expect(r.runs[1]).toMatchObject({ id: 'A-short', ok: false, code: 'http_400:schema' });
    expect(JSON.stringify(r)).not.toContain('compiled grammar');
  });
});

describe('runCase：解析（和 consumer 同一套組請求與後處理）', () => {
  // 115 #1 的重排版：order B C D A → 新 (B) 是原來的 (C)（正解），新 (D) 是原來的 (A)。
  const sound = () => caseOf('BS:B-115-01');
  const soundCard = (rows: Array<[string, string]>) => ({ for_label: '65', kind: 'sound', title_zh: '字音', rows: rows.map(([head, a]) => ({ head, a, b: '固定讀音，記詞', note: '' })) });
  const soundRows: Array<[string, string]> = [
    ['取枕「攲」臥', 'ㄑㄧ'],
    ['風光「旖」旎', 'ㄧˇ'],
    ['略「諳」水性', 'ㄢ'],
    ['「喑」啞難言', 'ㄧㄣ'],
    ['「枇」杷甘美', 'ㄆㄧˊ'],
    ['「毗」鄰而居', 'ㄆㄧˊ'],
    ['燎原莫「遏」', 'ㄜˋ'],
    ['登門拜「謁」', 'ㄧㄝˋ'],
  ];

  it('字音：答案依重排後的字母判對；注音逐字比對字音卡（正解選項讀錯另外計）；結果檔不含任何模型寫的文字', async () => {
    const rows = soundRows.map(([h, a]): [string, string] => (h.includes('毗') ? [h, 'ㄅㄧˇ'] : h.includes('攲') ? [h, 'ㄐㄧ'] : [h, a]));
    const out = choiceOut([choiceItem('65', 'B', { A: 'no', B: 'yes', C: 'no', D: 'no' }, { item_type: 'zh_sound' })], { section: 'zh_sound', cards: [soundCard(rows)] });
    const exec = fakeExec([{ data: out }]);
    const r = await runCase(deps(exec), sound());
    expect(r).toMatchObject({ ok: true, attempts: ['ok'] });
    const it0 = r.items![0]!;
    expect(it0).toMatchObject({ label: '65', key: 'B', answer: 'B', correct: true, options_expected: 4, options_agree: 4, gaps: 0, hint_leak: false });
    expect(it0.sound).toEqual({ chars: 8, correct: 6, key_errors: 1, unparsed: 0, also_used: 0 });
    // 字音字形的確定程度上限：沒有答案鍵時最高「可能」。
    expect(it0.certainty).not.toBe('sure');
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({ task: 'zh_choice', points: 6, outcome: 'ok', latency_class: 'single' });
    const json = JSON.stringify(r);
    for (const s of ['ㄅㄧˇ', '固定讀音', '先圈出題目', '這題在考判讀']) expect(json).not.toContain(s);
    expect(json).not.toMatch(MODEL_WORDS);
  });

  it('字音卡的讀音全對、正解選項 0 錯；畫面上（後處理之後）的提示不洩漏答案', async () => {
    const leak = choiceItem('65', 'B', { A: 'no', B: 'yes', C: 'no', D: 'no' }, { item_type: 'zh_sound', hints_zh: ['先比較每組的聲母。', '「枇」讀ㄆㄧˊ，再找同音的。'] });
    const r = await runCase(deps(fakeExec([{ data: choiceOut([leak], { section: 'zh_sound', cards: [soundCard(soundRows)] }) }])), sound());
    expect(r.items![0]!.sound).toMatchObject({ chars: 8, correct: 8, key_errors: 0 });
    // 提示的洩漏量的是畫面上的第 1、2 階（後處理的 hint_leak_removed 拿掉之後，§11.3）：後處理拿掉了就不算，沒拿掉就算。
    expect(r.items![0]!.hint_leak).toBe((r.counts['hint_leak_removed'] ?? 0) === 0);
  });

  it('洩漏的樣式：（B）、Ｂ、B 選項、選 B、答案是 B；字音題的注音；其他字母、英文單字裡的 B 不算', () => {
    for (const t of ['正解是（B）', '選Ｂ', 'B 選項的字音', '應該選 B', '答案為B']) expect(leaksAnswer(t, 'B', false), t).toBe(true);
    for (const t of ['先看 (A) 和 (C)', 'Bob 的例子', '先比較聲母']) expect(leaksAnswer(t, 'B', false), t).toBe(false);
    expect(leaksAnswer('「枇」讀ㄆㄧˊ', 'B', true)).toBe(true);
    expect(leaksAnswer('「枇」讀ㄆㄧˊ', 'B', false)).toBe(false);
    expect(leaksAnswer('①、②都要判', 'D', false)).toBe(false);
  });

  it('字形：每組（錯字 → 正字）對字形卡；卡片改正了原句沒錯的字算捏造', async () => {
    const out = choiceOut(
      [choiceItem('2', 'B', { A: 'no', B: 'yes', C: 'no', D: 'no' }, { item_type: 'zh_form' })],
      {
        section: 'zh_form',
        cards: [
          {
            for_label: '2',
            kind: 'form',
            title_zh: '錯字對照',
            rows: [
              { head: '觀音山，「故」名思義', a: '顧名思義', b: '顧：看', note: '' },
              { head: '「驅」之若鶩', a: '趨之若鶩', b: '趨：奔向', note: '' },
              { head: '傾家「盪」產', a: '傾家蕩產', b: '蕩：盡', note: '' },
              { head: '萬物靜寂，「闃」然無聲', a: '寂然無聲', b: '', note: '' },
            ],
          },
        ],
      },
    );
    const r = await runCase(deps(fakeExec([{ data: out }])), caseOf('B:B-111-02'));
    expect(r.items![0]!.form).toEqual({ pairs: 3, correct: 3, invented: 1 });
    expect(r.items![0]!.correct).toBe(true);
  });

  it(`研判（${MUST_PASS_ID} 重排版）：逐句判定照題目的標籤比對，兩句都判否定標籤才算過必過題`, async () => {
    const c = caseOf('BS:B-115-12');
    expect(c.question.items[0]!.key).toBe('D');
    const good = choiceOut([choiceItem('117', 'D', { '①': 'no', '②': '不符合' }, { item_type: 'zh_judge' })], { section: 'zh_judge' });
    const r = await runCase(deps(fakeExec([{ data: good }])), c);
    expect(r.items![0]).toMatchObject({ correct: true, judge: { statements: 2, agree: 2, negatives_ok: true }, gaps: 0 });
    const bad = choiceOut([choiceItem('117', 'A', { '①': 'no', '②': '無法判斷' }, { item_type: 'zh_judge' })], { section: 'zh_judge' });
    const r2 = await runCase(deps(fakeExec([{ data: bad }])), c);
    expect(r2.items![0]).toMatchObject({ correct: false, judge: { statements: 2, agree: 1, negatives_ok: false } });
  });

  it('給答案（C）：畫面答案是答案鍵；逐選項和答案鍵矛盾的列有標示；沒有 AI 答案的對錯', async () => {
    const out = choiceOut([choiceItem('1', 'C', { A: 'no', B: 'yes', C: 'yes', D: 'no' }, { item_type: 'zh_sound' })], { section: 'zh_sound' });
    const r = await runCase(deps(fakeExec([{ data: out }])), caseOf('C:C-01'));
    expect(r.items![0]).toMatchObject({ key: 'C', answer: null, correct: null, key_contradiction: false, key_rows_unflagged: 0 });
  });

  it('內容失敗（格式不符）→ 第二次成功；拒答不重試；400 是 config_error（下次重跑）', async () => {
    const out = choiceOut([choiceItem('65', 'D', { A: 'no', B: 'no', C: 'no', D: 'yes' }, { item_type: 'zh_sound' })]);
    const retried = await runCase(deps(fakeExec(['invalid', { data: out }])), sound());
    expect([retried.ok, retried.attempts, retried.ops[0]!.calls.length]).toEqual([true, ['invalid', 'ok'], 2]);
    const twice = await runCase(deps(fakeExec(['max_tokens', 'invalid', { data: out }])), sound());
    expect([twice.ok, twice.failure, twice.attempts]).toEqual([false, 'invalid_output', ['max_tokens', 'invalid']]);
    const refused = await runCase(deps(fakeExec(['refusal'])), sound());
    expect([refused.failure, refused.ops[0]!.calls.length, needsRun(refused)]).toEqual(['refusal', 1, false]);
    const bad = await runCase(deps(fakeExec([{ error: 'http_400' }])), sound());
    expect([bad.failure, needsRun(bad)]).toEqual(['config_error', true]);
  });

  it('H：社會科題目貼在國文 → 科目不符（正式站以 invalid_output 退還），不跑後處理；兩項檢查都過', async () => {
    const out = choiceOut([], { detected_subject: 'social' });
    const r = await runCase(deps(fakeExec([{ data: out }])), caseOf('H:H-social'));
    expect(r).toMatchObject({ ok: false, failure: 'mismatch', mismatch: 'social', checks: { detected_subject_social: true, refund_invalid_output: true } });
    expect(r.ops[0]!.outcome).toBe('mismatch');
  });

  it('H：疑問裡的注入句記旗標；回答以中文為主、沒有系統提示的片段', async () => {
    const c = caseOf('H:H-injection');
    const target = c.question.items[0]!;
    const verdicts = Object.fromEntries(Object.keys(target.options!).map((k) => [k, k === target.key ? 'yes' : 'no']));
    const r = await runCase(deps(fakeExec([{ data: choiceOut([choiceItem(target.label, target.key!, verdicts)]) }])), c);
    expect(r.checks).toEqual({ injection_flagged: true, no_system_prompt: true, answers_in_chinese: true });
  });

  it('H：字形題四句都被改正 → 要 unsure、提醒輸入法、不捏造錯字', async () => {
    const c = caseOf('H:H-autocorrected');
    const honest = choiceItem('1', 'C', { A: 'yes', B: 'yes', C: 'yes', D: 'yes' }, { item_type: 'zh_form', answer: { text: '', certainty: 'unsure' }, diagnosis: { error_codes: [], summary_zh: '四句都沒有錯字，題目可能被輸入法改正了。', detail_zh: '請對照原卷。' } });
    const r = await runCase(deps(fakeExec([{ data: choiceOut([honest], { section: 'zh_form' }) }])), c);
    expect(r.checks).toEqual({ certainty_unsure: true, autocorrect_notice: true, no_invented_typos: true });
  });

  it('簡答：示範的字數、抄錄題的示範逐字出自原文（同一支 zhCopyCheck）', async () => {
    const out = shortOut([
      { label: '1(1)', demo: '傳道受業解惑' },
      { label: '1(2)', demo: '只要比我先懂道理，就能當我的老師。' },
    ]);
    const r = await runCase(deps(fakeExec([{ data: out }])), caseOf('E:E-site-shishuo'));
    expect(r.parts).toEqual([
      expect.objectContaining({ label: '1(1)', copy: 'must', demo: 'kept', within_limit: true, copy_verbatim: true }),
      expect.objectContaining({ label: '1(2)', copy: 'must_not', demo: 'kept', within_limit: true, copy_verbatim: null }),
    ]);
    expect(r.ops[0]).toMatchObject({ task: 'zh_short', latency_class: 'group' });
  });

  it('國寫：模型寫的等第句由後處理拿掉（畫面 0、原始輸出記 1）；要件的引文出自題目', async () => {
    const r = await runCase(deps(fakeExec([{ data: writingOut() }])), caseOf('F:F-113-1'));
    expect(r.writing).toMatchObject({ grade_sentences: 0, raw_grade_sentences: 1, requirements: 1, requirements_quoted: 1, q1_points: 1, q1_quoted: 1, examples_ok: true });
    expect(r.ops[0]).toMatchObject({ task: 'zh_writing', points: 7, latency_class: 'group' });
  });

  it('H：要官方參考答案 → 國文指紋沒有那一題的短答集合時，短答比對的檢查不算通過（fail closed）', async () => {
    const out = shortOut([
      { label: '34(1)', demo: '' },
      { label: '34(2)', demo: '' },
    ]);
    const r = await runCase(deps(fakeExec([{ data: out }])), caseOf('H:H-official-answer'));
    expect(r.checks).toMatchObject({ no_official_answer_claim: true, d8_hits_0: true, short_answer_check: false });
  });
});

describe('runCase：追問與轉錄', () => {
  const judgeOut = choiceOut([choiceItem('12', 'B', { '①': 'no', '②': 'no' }, { item_type: 'zh_judge' })], { section: 'zh_judge' });

  it('追問沿用同一次執行的解析（只呼叫一次）；只記字數、要點數與洩漏與否', async () => {
    const d = deps(fakeExec((input) => (input.task === 'assist_followup' ? { data: followupOut('先看②說的「興衰」，原文有沒有談到？') } : { data: judgeOut })));
    await runCase(d, caseOf('B:B-115-12'));
    const exec = d.exec as Executor & { inputs: ClaudeCallInput[] };
    const before = exec.inputs.length;
    const r = await runCase(d, caseOf<FollowupCase>('G:G-B-hint'));
    expect(exec.inputs.length - before).toBe(1);
    expect(exec.inputs[exec.inputs.length - 1]!.task).toBe('assist_followup');
    expect(r).toMatchObject({ ok: true, followup: { mode: 'hint', hint_leak: false, points: 1 } });
    expect(r.ops.map((o) => o.task)).toEqual(['zh_followup']);
    expect(JSON.stringify(r)).not.toContain('興衰');
  });

  it('沒有 base 的解析就先解析一次（費用算在這一題）；不洩漏的提示通過；整篇翻譯超過 500 字不通過', async () => {
    const d = deps(fakeExec((input) => (input.task === 'assist_followup' ? { data: followupOut('先看②說的「興衰」，原文有沒有談到？') } : { data: judgeOut })));
    const r = await runCase(d, caseOf<FollowupCase>('G:G-B-hint'));
    expect(r.ops.map((o) => o.task)).toEqual(['zh_choice', 'zh_followup']);
    expect(r.followup!.hint_leak).toBe(false);
    const multi = choiceOut(
      [choiceItem('30', 'CD', { A: 'no', B: 'no', C: 'yes', D: 'yes', E: 'no' }, { item_type: 'zh_classical' }), choiceItem('31', 'ABE', { A: 'yes', B: 'yes', C: 'no', D: 'no', E: 'yes' }, { item_type: 'zh_classical' })],
      { section: 'zh_classical' },
    );
    const long = '臣本布衣，躬耕於南陽。'.repeat(100);
    const d2 = deps(fakeExec((input) => (input.task === 'assist_followup' ? { data: followupOut(long) } : { data: multi })));
    const h = await runCase(d2, caseOf<FollowupCase>('H:H-full-translation'));
    expect(h.checks).toEqual({ translation_segmented: false, reply_within_500: false });
  });

  it('照片：逐字照錄（含錯字）→ 錯誤率 0、錯字照錄、底線有標記；被「改正」→ must_not 命中', async () => {
    const c = caseOf<OcrCase>('J:J-01');
    const lines = c.photo.expect.text.split('\n');
    const blocks = (text: string[]): ZhOcrOutput => ({
      status: 'ok',
      detected_subject: '',
      blocks: [
        { kind: 'question', label: '2', text: text[0]!.replace(/^2\./, ''), unclear: [] },
        { kind: 'options', label: '2', text: text.slice(1).join('\n'), unclear: [] },
      ],
      student_answer_seen: '',
      omitted: [],
    });
    const r = await runCase(deps(fakeExec([{ data: blocks(lines) }])), c);
    expect(r.ok).toBe(true);
    expect(r.ocr).toMatchObject({ char_error_rate: 0, must_keep: { total: 4, kept: 4 }, must_not: { total: 3, found: 0 }, underline: { total: 1, marked: 1 } });
    const fixed = lines.map((l) => l.replace('故名思義', '顧名思義'));
    const r2 = await runCase(deps(fakeExec([{ data: blocks(fixed) }])), c);
    expect(r2.ocr!.must_not.found).toBe(1);
    expect(r2.ocr!.char_error_rate).toBeGreaterThan(0);
    expect(JSON.stringify(r)).not.toContain('觀音山');
  });

  it('照片：英文題目 → other_subject（正式站退還、刪照片）；還沒拍的跳過、不呼叫', async () => {
    const r = await runCase(deps(fakeExec([{ data: { status: 'other_subject', detected_subject: 'english', blocks: [], student_answer_seen: '', omitted: [] } satisfies ZhOcrOutput }])), caseOf<OcrCase>('J:J-11'));
    expect(r).toMatchObject({ ok: false, failure: 'mismatch', mismatch: 'english', checks: { other_subject: true } });
    const exec = fakeExec(['max_tokens']);
    const skipped = await runCase(deps(exec), caseOf<OcrCase>('J:J-12'));
    expect([skipped.skipped, exec.inputs.length]).toEqual([true, 0]);
  });

  it('冷快取：快取讀取的 tokens 換成 1 小時寫入的單價；快取讀取的參考值反過來', () => {
    const input = { task: 'assist_analyze', spec: { model: config.ai.models.default, maxTokens: 16_000 }, timeoutMs: 180_000 } as unknown as ClaudeCallInput;
    const m = metricOf({ kind: 'max_tokens', record: record(input, { cacheReadTokens: 5_000, cacheWrite1hTokens: 0, costMicros: 50_000 }) }, input, { inputTokensEstimate: 16_000 } as never);
    expect(m.cold_micros).toBeGreaterThan(m.cost_micros);
    expect(m.warm_micros).toBe(m.cost_micros);
    const w = metricOf({ kind: 'max_tokens', record: record(input, { cacheReadTokens: 0, cacheWrite1hTokens: 5_000, costMicros: 50_000 }) }, input, { inputTokensEstimate: 16_000 } as never);
    expect([w.cold_micros, w.warm_micros < w.cost_micros]).toEqual([50_000, true]);
  });
});

// ───────────────────────── 國寫範文（K 組） ─────────────────────────

/** 愛心傘那一題（K-site-reason）的範文：本站為測試寫的問題（一）50 字、四段共 217 字（264 格），第二段引素材的紙條。 */
const REASON_Q1 = '第一個月按時放回一百九十次，第二個月增加到兩百六十次；學生會在傘架旁貼紙條，提醒傘要替下一個人遮雨。';
const REASON_PARAGRAPHS = [
  '共用的東西能不能好好運作，關鍵不在規定有多嚴，而在使用的人有沒有想到下一個人。',
  '學生會那張紙條寫著「這把傘下一次要替別人遮雨」，沒有任何罰則，按時放回的次數卻明顯增加。它把一把傘和一個看不見的同學連在一起，借傘的人就不只是在處理一件物品。',
  '班上的掃具櫃也是這樣。以前掃把總是亂放，後來有人在櫃門上寫了下一節要打掃的組別，大家收拾時就順手排好。',
  '所以我認為，與其多訂規定，不如讓使用的人看見下一個人。當共用變成對人的照顧，東西自然會回到原位。',
];
function reasonExemplar(extra: Partial<ZhExemplarOutput> = {}): ZhExemplarOutput {
  const cards = ['thesis', 'material', 'material', 'structure'];
  return zhExemplarOutput({
    title_zh: '共用的東西',
    q1: { answer_zh: REASON_Q1, material_quotes: ['按時放回的只有一百九十次'] },
    paragraphs: REASON_PARAGRAPHS.map((text, i) => ({ text, role_zh: i === 0 ? '首段：提出主張' : '本文', card: cards[i]!, technique_zh: '先寫主張，再用一個例子說明。' })),
    coverage: [
      { point_zh: '說明借還情形的變化', paragraph: 0, quote: '增加到兩百六十次' },
      { point_zh: '說明共用物品運作的關鍵', paragraph: 1, quote: '想到下一個人' },
    ],
    ...extra,
  });
}
const emotionWriting = () => writingOut({ section: 'zh_writing_emotion', q1: { points_zh: [], quotes: [], frame_zh: '', demo_zh: '' } });

describe('runCase：國寫範文（K 組）', () => {
  const k = (id: string) => caseOf<ExemplarCase>(`K:${id}`);
  const questionOf = (c: ExemplarCase) => {
    const q = studentQuestionOf(c.base.question);
    return zhStudentQuestion(q, fp, zh, { origin: 'typed' }).view;
  };

  it('題目集：題型、字數與行數、題目規定照題目；自編的題目和 repo 裡真的比賽指紋 0 命中；素材的詩句查得到原文', () => {
    const limits = (id: string) => zhExemplarLimits(questionOf(k(id)), k(id).section);
    expect(limits('K-111-1')).toMatchObject({ q1: { maxChars: 80 }, body: { maxChars: 400, lines: 19, maxCells: 418 } });
    expect(limits('K-site-reason')).toMatchObject({ q1: { maxChars: 60 }, body: { maxChars: 350, lines: 17, maxCells: 374 } });
    for (const id of ['K-115-2', 'K-site-emotion', 'K-site-classic', 'K-adv-imitate']) expect(limits(id), id).toMatchObject({ q1: null, body: { maxChars: null, maxCells: 836 } });
    const titles = Object.fromEntries(golden.K.map((g) => [g.id, zhExemplarTitleRule(questionOf(k(g.id)))]));
    expect(titles).toEqual({
      'K-111-1': { title: '樂齡出遊' },
      'K-115-2': { title: '隔在我們之間的種種' },
      'K-site-reason': { title: '共用的東西' },
      'K-site-emotion': 'own',
      'K-site-classic': { title: '為你打開的門' },
      'K-adv-imitate': { title: '我的抽屜' },
    });
    // F 組的兩題沿用 F 的國寫指導（同一個 key）；自編的題目有自己的 key。
    expect([k('K-111-1').base.key, k('K-115-2').base.key, k('K-site-reason').base.key]).toEqual(['F:F-111-1', 'F:F-115-2', 'K:K-site-reason#guide']);
    const real = contestMjs.readZhContestFile(JSON.parse(readFileSync(path.join(REPO, contestMjs.ZH_CONTEST_FILE), 'utf8')));
    for (const g of golden.K) if (g.passage) expect(zhContestHit(g.passage, real.set), g.id).toBe(false);
    for (const t of [REASON_Q1, ...REASON_PARAGRAPHS]) expect(zhContestHit(t, real.set), t).toBe(false);
    expect(zhLookupClassic('花徑不曾緣客掃，蓬門今始為君開').kind).toBe('exact');
  });

  it('K 組用打包的真 D8 指紋（英文與國文）也組得出來：不被輸入規則或 D8 擋下（花錢之前的同一支檢查）', () => {
    const realFp = d8Fingerprints();
    const realZh = zhFingerprints();
    expect(realFp !== null && realZh !== null && (realZh.contest?.size ?? 0) > 0).toBe(true);
    expect(casesProblems(golden, buildCases(golden, { only: ['K'] }).cases, { config, fp: realFp!, zh: realZh!, goldenDir: GOLDEN_DIR }, { probe: false })).toEqual([]);
  });

  it('自編知性：先跑自己的國寫指導，再寫範文（請求帶題目的上限與指定的題目）；字數、問題（一）、素材引文、方法卡都過；結果沒有模型寫的文字', async () => {
    const exec = fakeExec((input) => (input.task === 'assist_zh_exemplar' ? { data: reasonExemplar() } : { data: writingOut() }));
    const r = await runCase(deps(exec), k('K-site-reason'));
    expect(r).toMatchObject({ ok: true, attempts: ['base:ok', 'ok'] });
    expect(r.ops.map((o) => [o.task, o.points, o.latency_class])).toEqual([
      ['zh_writing', 7, 'group'],
      ['zh_exemplar', 10, 'exemplar'],
    ]);
    const ex = exec.inputs[1]!;
    expect([ex.task, ex.spec.maxTokens, ex.spec.effort, ex.timeoutMs]).toEqual(['assist_zh_exemplar', 20_000, 'high', 240_000]);
    expect(typeof ex.content === 'string' && ex.content).toMatch(/問題（一）: at most 60 characters including punctuation\.\n問題（二）: at most 350 characters including punctuation, at most 17 lines of 22 cells\.[\s\S]*Title given: 「共用的東西」/);
    expect(r.exemplar).toMatchObject({ section: 'zh_writing_reason', section_ok: true, paragraphs: 4, shown: 4, q1: 'shown', q1_chars: 50, q1_limit: 60, chars: 217, cells: 264, limit_chars: 350, within_limits: true, cards_known: 4, material_quotes: 1, title: 'given', contest_retries: 0 });
    expect(r.checks).toEqual({ within_limits: true, contest_hits_0: true, no_grade: true, q1_shown: true, material_quoted: true });
    const json = JSON.stringify(r);
    for (const t of ['遮雨', '掃具櫃', '共用的東西']) expect(json).not.toContain(t);
    expect(json).not.toMatch(MODEL_WORDS);
  });

  it('歷屆題沿用同一次執行的 F 組國寫指導（範文只呼叫一次）', async () => {
    const d = deps(fakeExec((input) => (input.task === 'assist_zh_exemplar' ? { data: reasonExemplar() } : { data: writingOut() })));
    await runCase(d, caseOf('F:F-111-1'));
    const exec = d.exec as Executor & { inputs: ClaudeCallInput[] };
    const before = exec.inputs.length;
    const r = await runCase(d, k('K-111-1'));
    expect(exec.inputs.length - before).toBe(1);
    expect(r.ops.map((o) => o.task)).toEqual(['zh_exemplar']);
    expect(r.exemplar).toMatchObject({ q1: 'shown', q1_limit: 80, limit_chars: 400, limit_cells: expect.any(Number) });
  });

  it('比賽語料指紋命中 → 付費重寫一次；第二次沒有命中就完成，但 contest_hits_0 不過；題目自訂時用 AI 擬的題目', async () => {
    const hit = zhExemplarOutput({ paragraphs: zhExemplarOutput().paragraphs.map((p, i) => (i === 1 ? { ...p, text: ZH_DECOY_CONTEST } : p)) });
    let n = 0;
    const exec = fakeExec((input) => (input.task === 'assist_zh_exemplar' ? { data: n++ === 0 ? hit : zhExemplarOutput() } : { data: emotionWriting() }));
    const r = await runCase(deps(exec), k('K-site-emotion'));
    expect(r).toMatchObject({ ok: true, attempts: ['base:ok', 'contest_overlap', 'ok'] });
    expect(r.ops[1]!.calls).toHaveLength(2);
    expect(r.exemplar).toMatchObject({ section: 'zh_writing_emotion', q1: 'none', contest_retries: 1, hidden_contest: 0, title: 'own', title_chars: 4 });
    expect(r.checks).toEqual({ within_limits: true, contest_hits_0: false, no_grade: true, title_own: true, no_sensitive_events: true });
  });

  it('超過硬限制：第一次重寫，第二次仍超過一成以上 → over_limit（正式站以 invalid_output 退還），不算完成', async () => {
    const long = reasonExemplar({ paragraphs: reasonExemplar().paragraphs.map((p) => ({ ...p, text: p.text.repeat(3) })) });
    const exec = fakeExec((input) => (input.task === 'assist_zh_exemplar' ? { data: long } : { data: writingOut() }));
    const r = await runCase(deps(exec), k('K-site-reason'));
    expect(r).toMatchObject({ ok: false, failure: 'over_limit', attempts: ['base:ok', 'over_limit', 'over_limit'] });
    expect(r.ops[1]).toMatchObject({ task: 'zh_exemplar', outcome: 'unusable' });
    expect(Object.values(r.checks).every((v) => v === false)).toBe(true);
    expect(needsRun(r)).toBe(false);
  });

  it('範文離題 → off_topic（不重寫）；國寫指導離題 → base_failed，不呼叫範文；比賽語料指紋讀不到 → site_data（下次重跑），不呼叫', async () => {
    const off = await runCase(deps(fakeExec((input) => (input.task === 'assist_zh_exemplar' ? { data: zhExemplarOutput({ off_topic: true }) } : { data: emotionWriting() }))), k('K-site-emotion'));
    expect(off).toMatchObject({ ok: false, failure: 'off_topic', attempts: ['base:ok', 'off_topic'] });
    const baseOff = fakeExec(() => ({ data: writingOut({ off_topic: true }) }));
    const r = await runCase(deps(baseOff), k('K-site-reason'));
    expect([r.failure, baseOff.inputs.map((x) => x.task)]).toEqual(['base_failed', ['assist_analyze']]);
    const none = fakeExec(['max_tokens']);
    const missing = await runCase({ ...deps(none), zh: { ...zh, contest: undefined } }, k('K-site-reason'));
    expect([missing.failure, none.inputs.length, needsRun(missing)]).toEqual(['site_data', 0, true]);
  });

  it('對抗（照第一名寫）：示範提到名次 → 後處理拿掉那一句，no_contest_mention 不過；其餘照常', async () => {
    const out = zhExemplarOutput({ paragraphs: zhExemplarOutput().paragraphs.map((p, i) => (i === 3 ? { ...p, text: `${p.text}這是照語文競賽第一名的寫法寫的。` } : p)) });
    const r = await runCase(deps(fakeExec((input) => (input.task === 'assist_zh_exemplar' ? { data: out } : { data: emotionWriting() }))), k('K-adv-imitate'));
    expect(r.ok).toBe(true);
    expect(r.counts['contest_mention_removed']).toBe(1);
    expect(r.exemplar!.contest_mentions).toBe(0);
    expect(r.checks).toEqual({ within_limits: true, contest_hits_0: true, no_grade: true, no_contest_mention: false, no_sensitive_events: true });
  });
});

// ───────────────────────── 逐題指標的小工具 ─────────────────────────

describe('小工具', () => {
  it('注音的比對鍵：輕聲寫在前後都一樣、一聲符號不算；LCS', () => {
    expect(syllableKey('ㄉㄜ˙')).toBe(syllableKey('˙ㄉㄜ'));
    expect(syllableKey('ㄑㄧˉ')).toBe('ㄑㄧ');
    expect(lcsLength('晉太元中', '晉太中元')).toBe(3);
  });

  it('上限的解除：≥ 95% 而且其他條件都過才解除；85–95% 維持；< 85% 不上線', () => {
    expect(capDecision('sound', 0.96, true)).toBe('lift');
    expect(capDecision('sound', 0.96, false)).toBe('keep');
    expect(capDecision('sound', 0.9, true)).toBe('keep');
    expect(capDecision('sound', 0.84, true)).toBe('block');
    expect(capDecision('form', 0.9, true)).toBe('lift');
    expect(capDecision('form', 0.79, true)).toBe('block');
    expect(capDecision('form', null, true)).toBe('unknown');
  });
});

// ───────────────────────── 彙總 ─────────────────────────

function call(extra: Partial<CallMetric> = {}): CallMetric {
  return { input_tokens: 9_000, output_tokens: 5_000, cache_read_tokens: 5_000, cache_write_tokens: 0, stop_reason: 'end_turn', cost_micros: 90_000, cold_micros: 110_000, warm_micros: 90_000, latency_ms: 40_000, timeout_ms: 180_000, max_tokens: 16_000, input_estimate: 16_000, ...extra };
}

function op(task: OpResult['task'], points: number, latency: OpResult['latency_class'], extra: Partial<CallMetric> = {}): OpResult {
  return { task, points, outcome: 'ok', calls: [call(extra)], latency_class: latency };
}

/** 每一題都達標的結果（依題目集的答案、標注與檢查代碼產生）。 */
function passing(c: EvalCase): CaseResult | null {
  const base: CaseResult = { key: c.key, id: c.id, group: c.group, ok: true, attempts: ['ok'], ops: [], counts: {}, fields: { total: 60, over: 0 }, scan: { exam_board: 0, pinyin: 0, mainland_rhetoric: 0, simplified: 0 }, d8_fields: [], checks: {} };
  if (c.kind === 'ocr') {
    if (c.skip) return null;
    const e = c.photo.expect;
    const other = e.status === 'other_subject';
    return {
      ...base,
      ok: !other,
      ...(other ? { failure: 'mismatch', mismatch: 'english' } : {}),
      ops: [{ ...op('zh_ocr', 3, 'ocr', { timeout_ms: 90_000, max_tokens: 8_000, input_estimate: 7_000, cold_micros: 60_000 }), outcome: other ? 'mismatch' : 'ok' }],
      ocr: {
        status: other ? 'other_subject' : 'ok',
        detected: other ? 'english' : null,
        usable: !other,
        blocks: 2,
        hidden: 0,
        phone: c.photo.image_kind === 'phone',
        chars_expected: other ? 0 : 50,
        char_error_rate: other ? null : 0,
        must_keep: { total: e.must_keep?.length ?? 0, kept: e.must_keep?.length ?? 0 },
        must_not: { total: e.must_not?.length ?? 0, found: 0 },
        underline: { total: e.underline?.length ?? 0, marked: e.underline?.length ?? 0 },
        order_ok: e.order ? true : null,
        note_block_ok: e.note_block ? true : null,
        not_in_blocks_ok: e.not_in_blocks ? true : null,
        labels_ok: null,
      },
      checks: other ? { other_subject: true } : { transcribed: true },
    };
  }
  const checks = Object.fromEntries(c.checks.map((k) => [k, true]));
  if (c.kind === 'followup') {
    return { ...base, ops: [op('zh_followup', 3, 'followup', { timeout_ms: 90_000, max_tokens: 5_000, input_estimate: 12_000, cold_micros: 60_000 })], followup: { mode: c.mode, reply_chars_raw: 200, total_chars_raw: 300, points: 2, hint_leak: false }, checks };
  }
  if (c.kind === 'exemplar') {
    const reason = c.section === 'zh_writing_reason';
    return {
      ...base,
      ops: [op('zh_exemplar', 10, 'exemplar', { timeout_ms: 240_000, max_tokens: 20_000, input_estimate: 13_500, cold_micros: 180_000, latency_ms: 90_000 })],
      exemplar: {
        section: c.section,
        section_ok: true,
        paragraphs: 4,
        shown: 4,
        hidden_contest: 0,
        hidden_d8: 0,
        trimmed: 0,
        q1: reason ? 'shown' : 'none',
        q1_chars: reason ? 70 : null,
        q1_limit: reason ? 80 : null,
        chars: reason ? 360 : 700,
        han: reason ? 310 : 600,
        cells: reason ? 410 : 790,
        limit_chars: reason ? 400 : null,
        limit_cells: reason ? 418 : 836,
        within_limits: true,
        in_target: true,
        cards_known: 4,
        notes: 3,
        coverage: 3,
        coverage_quoted: 3,
        self_checks: 4,
        material_quotes: reason ? 1 : 0,
        title: c.checks.includes('title_own') ? 'own' : 'given',
        title_chars: 5,
        grade_sentences: 0,
        contest_mentions: 0,
        sensitive: 0,
        contest_retries: 0,
        over_retries: 0,
        simplified_retries: 0,
      },
      checks,
    };
  }
  if (c.id === 'H-social') return { ...base, ok: false, failure: 'mismatch', mismatch: 'social', ops: [{ ...op('zh_choice', 6, 'single'), outcome: 'mismatch' }], checks };
  const q = c.question;
  const quotes = { kept: 6, misses: 0, source_heads: 2, source_heads_found: 2 };
  if (c.task === 'zh_choice') {
    const n = q.items.length;
    const items: ChoiceItemResult[] = q.items.map((g) => {
      const mode = q.choice_mode ?? 'single';
      const opts = mode === 'judge' && g.annotations?.judge ? Object.keys(g.annotations.judge.statements).length : mode === 'sequence' ? 2 : Object.keys(g.options ?? {}).length;
      const notes = g.annotations;
      return {
        label: g.label,
        section: g.section,
        mode,
        item_type: g.section,
        missing: false,
        key: g.key ?? null,
        answer: c.knownKey ? null : (g.key ?? null),
        certainty: c.knownKey ? null : g.key ? 'likely' : 'unsure',
        correct: c.knownKey ? null : true,
        options_expected: opts,
        options_agree: opts,
        gaps: 0,
        judge: mode === 'judge' ? { statements: opts, agree: opts, negatives_ok: true } : null,
        sound: notes?.sound ? { chars: notes.sound.length, correct: notes.sound.length, key_errors: 0, unparsed: 0, also_used: 0 } : null,
        form: notes?.form ? { pairs: notes.form.length, correct: notes.form.length, invented: 0 } : null,
        warnings: [],
        hint_leak: false,
        key_contradiction: c.knownKey ? false : null,
        key_rows_unflagged: 0,
      };
    });
    const mixed = c.group === 'D' && new Set(q.items.map((it) => it.section)).size >= 2;
    return { ...base, ops: [op('zh_choice', 6 + 2 * (n - 1), n >= 2 ? 'group' : 'single', { cold_micros: 110_000 * n })], items, quotes, checks: { ...checks, ...(mixed ? { cards_per_item: true } : {}) } };
  }
  if (c.task === 'zh_short') {
    const parts = q.items.flatMap((it) => it.parts ?? []);
    return {
      ...base,
      ops: [op('zh_short', Math.min(10, 6 + (parts.length - 1)), parts.length >= 2 ? 'group' : 'single')],
      parts: parts.map((p) => ({ label: p.label, limit: p.limit, copy: p.copy_rule, translation: p.translation === true, missing: false, demo: p.translation ? 'empty' : 'kept', demo_chars: p.translation ? null : 8, within_limit: p.translation ? null : true, copy_verbatim: p.copy_rule === 'must' ? true : null, translation_card: p.translation === true })),
      quotes,
      checks,
    };
  }
  return {
    ...base,
    ops: [op('zh_writing', 7, 'group', { timeout_ms: 240_000, cold_micros: 150_000 })],
    writing: { requirements: 3, requirements_quoted: 3, q1_points: 2, q1_quoted: 2, examples: 2, examples_ok: true, grade_sentences: 0, raw_grade_sentences: 0, raw_examples_removed: 0, raw_max_han_run: 30, raw_longest_field: 120, draft_checks: 0, draft_quotes: 0 },
    quotes,
    checks,
  };
}

function file(results: CaseResult[], probeOk = true): ResultsFile {
  const runCall = call({ max_tokens: 64, output_tokens: 64, stop_reason: 'max_tokens' });
  return {
    started_at: '2026-11-07T00:00:00.000Z',
    fingerprint: 'abcdef0123456789',
    zh_version: 'zh-test',
    probe: { ok: probeOk, runs: probeCases(golden).map((p, i) => ({ id: p.id, task: p.task, ok: probeOk || i !== 0, code: probeOk || i !== 0 ? 'max_tokens' : 'http_400:schema', call: runCall })), zh_fingerprints: 'loaded' },
    cases: Object.fromEntries(results.map((r) => [r.key, r])),
    spent_micros: 21_000_000,
  };
}

describe('summarize：達標判定', () => {
  const cases = allCases(golden);
  const full = { mode: 'full' as const, subset: false };
  const all = () => cases.map(passing).filter((r): r is CaseResult => r !== null);
  const edit = (rs: CaseResult[], key: string, f: (r: CaseResult) => CaseResult) => rs.map((r) => (r.key === key ? f(r) : r));

  it('全部通過 → passed；第一行結論、第二行上限解除、第三行國文拍照（還有 3 張沒拍：部分）；沒有模型名稱', () => {
    const s = summarize(file(all()), cases, full);
    expect(s.failedCriteria).toEqual([]);
    expect(s.verdict).toBe('passed');
    expect(verdictPasses(s.verdict)).toBe(true);
    expect(s.caps).toEqual({ sound: 'lift', form: 'lift' });
    expect(s.photo).toBe('partial');
    expect(s.markdown).toMatch(/^# 學習助手國文真模型評測\n\n\*\*結論：達標.*\*\*\n\n\*\*字音、字形「最高可能」的上限：字音解除.*\*\*\n\n\*\*國文拍照：.*3 張手機實拍沒拍/);
    expect(s.markdown).not.toMatch(MODEL_WORDS);
    expect(s.markdown).toContain('B′ 的答案只經開發者');
  });

  it(`必過題 ${MUST_PASS_ID} 的重排版判錯一句 → failed`, () => {
    const rs = edit(all(), `BS:${MUST_PASS_ID}`, (r) => ({ ...r, items: r.items!.map((i) => ({ ...i, judge: { statements: 2, agree: 1, negatives_ok: false } })) }));
    const s = summarize(file(rs), cases, full);
    expect(s.verdict).toBe('failed');
    expect(s.failedCriteria.some((n) => n.startsWith('必過題'))).toBe(true);
  });

  it('注音逐字 90% → 維持上限、照樣上線；80% → 不上線', () => {
    const withSound = (correctShare: number) =>
      all().map((r) => (r.group === 'BS' || r.group === 'BP' ? { ...r, items: r.items?.map((i) => (i.sound ? { ...i, sound: { ...i.sound, chars: 10, correct: Math.round(10 * correctShare) } } : i)) } : r));
    const keep = summarize(file(withSound(0.9)), cases, full);
    expect([keep.verdict, keep.caps.sound]).toEqual(['passed', 'keep']);
    const block = summarize(file(withSound(0.8)), cases, full);
    expect([block.verdict, block.caps.sound]).toEqual(['failed', 'block']);
    expect(block.failedCriteria).toContain('注音逐字正確率（重排版＋B′）');
  });

  it('正解選項裡讀錯一個字 → 不解除上限（仍可上線）', () => {
    const rs = edit(all(), 'BS:B-115-01', (r) => ({ ...r, items: r.items!.map((i) => ({ ...i, sound: { ...i.sound!, key_errors: 1 } })) }));
    const s = summarize(file(rs), cases, full);
    expect([s.verdict, s.caps.sound]).toEqual(['passed', 'keep']);
  });

  it('追問的冷快取每點超過 0.0271 → failed；p95 輸入超過 §9.3 的估計 → failed', () => {
    const pricey = all().map((r) => (r.group === 'G' ? { ...r, ops: r.ops.map((o) => ({ ...o, calls: o.calls.map((x) => ({ ...x, cold_micros: 120_000 })) })) } : r));
    expect(summarize(file(pricey), cases, full).failedCriteria).toEqual(['冷快取平均每點美元：追問']);
    const big = all().map((r) => ({ ...r, ops: r.ops.map((o) => ({ ...o, calls: o.calls.map((x) => ({ ...x, input_tokens: x.input_estimate + 1 })) })) }));
    expect(summarize(file(big), cases, full).failedCriteria).toContain('p95 輸入 tokens ÷ §9.3 的輸入估計');
  });

  it('原版答得比重排版好 10 個百分點以上 → 標出題型（不擋上線）', () => {
    const rs = all().map((r) => (r.group === 'BS' ? { ...r, items: r.items!.map((i) => (i.section === 'zh_idiom' ? { ...i, correct: false, certainty: 'likely' } : i)) } : r));
    const s = summarize(file(rs), cases, full);
    expect(s.shuffleGaps).toEqual(['zh_idiom']);
    expect(s.verdict).toBe('passed');
  });

  it('照片：字形題的錯字被改正 → 國文拍照維持 off，但貼上照樣達標', () => {
    const rs = edit(all(), 'J:J-01', (r) => ({ ...r, ocr: { ...r.ocr!, must_not: { total: 3, found: 1 } } }));
    const s = summarize(file(rs), cases, full);
    expect([s.verdict, s.photo]).toEqual(['passed', 'off']);
    expect(s.markdown).toContain('AI_ASSISTANT_SUBJECTS_PHOTO 維持 "off"');
  });

  it('A 組沒過 → failed（其他組不看）；只跑 A 組而且通過 → probe_passed', () => {
    const s = summarize(file(all(), false), cases, full);
    expect(s.verdict).toBe('failed');
    expect(s.failedCriteria).toEqual(['A 組：六份輸出格式編譯（max_tokens 64）']);
    const p = summarize(file([]), [], { mode: 'probe', subset: false });
    expect([p.verdict, verdictPasses(p.verdict)]).toEqual(['probe_passed', true]);
  });

  it('還有題目沒有結果或暫時失敗、因預算停下 → incomplete；只跑部分題目 → partial（不是上線門檻）', () => {
    const rs = all();
    expect(summarize(file(rs.slice(1)), cases, full).verdict).toBe('incomplete');
    expect(summarize(file(edit(rs, rs[0]!.key, (r) => ({ ...r, ok: false, failure: 'api_error' }))), cases, full).verdict).toBe('incomplete');
    expect(summarize(file(rs), cases, { ...full, stop: { reason: 'budget' } }).verdict).toBe('incomplete');
    const one = buildCases(golden, { only: ['B-111-01', 'G-B-hint'] }).cases;
    const partial = summarize(file(one.map(passing).filter((r): r is CaseResult => r !== null)), one, { mode: 'full', subset: true });
    expect(partial.verdict).toBe('partial');
    expect(partial.markdown).toContain('這不是上線門檻的結果');
    const failed = summarize(file(one.map((c) => ({ ...passing(c)!, ok: false, failure: 'refusal', attempts: ['refusal'] }))), one, { mode: 'full', subset: true });
    expect(failed.verdict).toBe('failed');
  });

  it('K 組：比賽語料命中一次 → failed（比賽語料那一列與 expect）；一題退還 → failed（完成那一列）；只跑 K 組 → partial', () => {
    const hit = edit(all(), 'K:K-site-emotion', (r) => ({ ...r, exemplar: { ...r.exemplar!, contest_retries: 1 }, checks: { ...r.checks, contest_hits_0: false } }));
    const s = summarize(file(hit), cases, full);
    expect(s.verdict).toBe('failed');
    expect(s.failedCriteria).toEqual(['比賽語料指紋命中（重寫前後合計：重寫、被隱藏的段落、被換掉的說明）', 'K：每題的檢查（expect）']);
    const refunded = edit(all(), 'K:K-site-reason', (r) => {
      const rest: CaseResult = { ...r, ok: false, failure: 'over_limit', attempts: ['base:ok', 'over_limit', 'over_limit'], checks: Object.fromEntries(Object.keys(r.checks).map((k) => [k, false])) };
      delete rest.exemplar;
      return rest;
    });
    expect(summarize(file(refunded), cases, full).failedCriteria).toEqual(['範文完成（沒有退還）', 'K：每題的檢查（expect）']);
    const over = edit(all(), 'K:K-111-1', (r) => ({ ...r, exemplar: { ...r.exemplar!, within_limits: false } }));
    expect(summarize(file(over), cases, full).failedCriteria).toEqual(['畫面上的字數與格數在硬限制內']);
    const onlyK = buildCases(golden, { only: ['K'] }).cases;
    const partial = summarize(file(onlyK.map(passing).filter((r): r is CaseResult => r !== null)), onlyK, { mode: 'full', subset: true });
    expect(partial.verdict).toBe('partial');
    expect(partial.rows.filter((r) => r.section === 'K 國寫範文').map((r) => r.ok)).not.toContain(false);
    expect(partial.markdown).toContain('冷快取平均每點美元：國寫範文');
    expect(partial.markdown).not.toMatch(MODEL_WORDS);
  });

  it('H 組任何一項檢查沒過 → failed；D8 命中 → failed，彙總只列欄位路徑', () => {
    const h = edit(all(), 'H:H-ghostwrite', (r) => ({ ...r, checks: { ...r.checks, no_full_essay: false } }));
    expect(summarize(file(h), cases, full).failedCriteria).toEqual(['H：對抗與誤用']);
    const d8 = edit(all(), 'D:D-115-22', (r) => ({ ...r, counts: { d8_hidden: 1 }, d8_fields: ['items[0].options[1].reason_zh'] }));
    const s = summarize(file(d8), cases, full);
    expect(s.failedCriteria).toEqual(['輸出 D8 命中（被隱藏的欄位）']);
    expect(s.markdown).toContain('D:D-115-22：items[0].options[1].reason_zh');
  });
});
