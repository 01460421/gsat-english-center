/**
 * 作文範文的真模型評測（docs/design/model-essays.md §9.6；上線前必跑，不進 CI、開發時不跑）。負責：E2。
 *
 *   ANTHROPIC_API_KEY=<dev workspace 的金鑰> npm run parity:exemplars -w @gsat/api
 *
 * 站主不用在自己的電腦跑：GitHub Actions 的「作文範文真模型評測」（.github/workflows/exemplars-eval.yml）用 GitHub secret 的金鑰
 * 跑這支工具——Actions 頁面的 Run workflow、在 claude/** 分支改 RUN 檔（test/fixtures/exemplars-golden/RUN）推上去，或 schema、
 * 提示改動時自動只跑 A 組。Summary 顯示結論，結果目錄存成 artifact 並快取起來給下一次接著跑。
 *
 * 單元測試全部用假模型，測不出 Anthropic 端的限制（輸出格式的 grammar 太大會被 400 拒收）與真輸出的長度（D1 的 CHECK）。
 * 這支工具用真模型、和 Worker 同一套函式（exemplars.runner.ts）：
 *   A 組  完整的系統提示與 schema、max_tokens 64：回應不是 400 就通過；**不過就停**，其他組不跑。
 *   B–F  題目集（test/fixtures/exemplars-golden/golden.json）：歷屆 7、本站仿真 3、自訂 4、不是寫作題 2、對抗 2；
 *        effort_sweep 時另跑 G 組（B 組的 3 題用 effort low）。B、C、D、G 組再用本站的作文批改給每一篇打分。
 * 門檻與彙總在 exemplars.cases.ts（單元測試 test/exemplars.parity-summary.test.ts 驗證達標判定與執行流程）。
 *
 * 環境變數：
 *   EXEMPLARS_EVAL_MODE          full（預設）或 probe（只跑 A 組）
 *   EXEMPLARS_EVAL_CASES         只跑這些題目（題目 id 或組別字母，逗號分隔；空白＝B–F 全部）；只跑一部分時結論是「部分」
 *   EXEMPLARS_EVAL_EFFORT_SWEEP  true＝另跑 G 組
 *   PARITY_BUDGET_USD            累計花費上限（預設 15；含之前中斷的那幾次）；PARITY_TIME_LIMIT_MINUTES 時間上限
 *   PARITY_OUT                   結果目錄（預設 test/parity/.results/，不進版控）
 * 每一題的結果馬上存檔，下次執行從中斷處接著跑（系統提示、schema、模型、effort 或題目集變了就從頭跑）。A 組每次都先跑。
 *
 * 這個 repo 是公開的：log、結果檔與彙總只有代碼、計數、字數、分數、tokens、花費與延遲；不印模型寫的任何文字、Anthropic 的錯誤說明、
 * 金鑰或模型名稱。結論不是「達標」「只跑 A 組而且通過」或「部分（正常）」時這支測試會失敗（exit code 非 0）。
 * 沒有 ANTHROPIC_API_KEY 時：本機略過；CI 直接失敗（略過會被當成通過）。
 * 檔名不符合 test/**\/*.test.ts：npm test 與 CI 都不會跑它（vitest.parity.config.ts 只收 *.parity.ts，
 * package.json 的 parity:exemplars 只跑這一支）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXEMPLAR_LEVELS_VERSION } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { parseCases } from '../../../../.github/scripts/exemplars-eval-plan.mjs';
import { getWritingGroup } from '../../src/ai/bank';
import { buildClaudeRequest, createAnthropicClient, executeClaudeCall, type ClaudeCallInput } from '../../src/ai/client';
import { d8Fingerprints } from '../../src/ai/d8';
import { essayCallInput } from '../../src/ai/requests';
import { taskConfig } from '../../src/ai/tasks';
import { loadConfig, type AppConfig } from '../../src/config';
import type { Env } from '../../src/env';
import { exemplarCallInput } from '../../src/exemplars/requests';
import { siteSourceOf } from '../../src/exemplars/siteGroups';
import {
  CASE_RESERVE_MICROS,
  EXEMPLAR_EVAL_BUDGET_USD,
  STOP_FAILURES,
  buildCases,
  fmt,
  needsRun,
  summarize,
  verdictPasses,
  type EvalStop,
  type GoldenFile,
  type ResultsFile,
} from './exemplars.cases';
import { casesProblems, resolveSiteGroup, runCase, runProbe, type Executor } from './exemplars.runner';

const OUT_DIR = process.env['PARITY_OUT'] ?? path.join(import.meta.dirname, '.results');
const RESULTS_FILE = path.join(OUT_DIR, 'exemplars.json');
const SUMMARY_FILE = path.join(OUT_DIR, 'exemplars.md');
const API_KEY = process.env['ANTHROPIC_API_KEY']?.trim() ?? '';
const GOLDEN = path.resolve(import.meta.dirname, '..', 'fixtures', 'exemplars-golden', 'golden.json');

function positiveEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name}=${JSON.stringify(raw)} 不是正數`);
  return n;
}

/** 會影響結果的設定的雜湊（不存模型名稱本身）：系統提示、schema、範本、模型、effort、max_tokens、層級規格、題目集、批改的提示。 */
async function evalFingerprint(config: AppConfig, goldenText: string, golden: GoldenFile): Promise<string> {
  const ex = taskConfig('essay_exemplars', config);
  const grade = taskConfig('essay_grade', config);
  const probe = resolveSiteGroup(golden.probe.uid);
  const parts: unknown[] = [EXEMPLAR_LEVELS_VERSION, goldenText, ex.calls, grade.calls];
  if (probe) {
    parts.push((await buildClaudeRequest(exemplarCallInput(ex, { source: siteSourceOf(probe) ?? 'exam', group: probe }))).promptVersion);
    parts.push((await buildClaudeRequest(exemplarCallInput(ex, { source: 'custom', prompt: { text: '題目', figure_text: null, paragraphs: null, min_words: null, max_words: null } }))).promptVersion);
    const g = getWritingGroup(probe.group_id)!;
    for (const role of ['primary', 'second'] as const) parts.push((await buildClaudeRequest(essayCallInput(grade, role, g, ['x'], 1))).promptVersion);
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

describe.skipIf(!API_KEY && !process.env['CI'])('作文範文真模型評測', () => {
  it('A 組先跑（不過就停），再依 §9.6 跑 B–F（G 選填），結果存檔並印出彙總；結論不通過時失敗', async () => {
    if (!API_KEY) throw new Error('沒有 ANTHROPIC_API_KEY：在 CI 上不能略過評測（略過會被當成通過）。');
    const mode = (process.env['EXEMPLARS_EVAL_MODE']?.trim() || 'full') as 'full' | 'probe';
    if (mode !== 'full' && mode !== 'probe') throw new Error(`EXEMPLARS_EVAL_MODE 要是 full 或 probe`);
    const only = parseCases(process.env['EXEMPLARS_EVAL_CASES'] ?? '');
    if (only === null) throw new Error('EXEMPLARS_EVAL_CASES 要是逗號分隔的題目 id 或組別字母');
    const effortSweep = process.env['EXEMPLARS_EVAL_EFFORT_SWEEP']?.trim() === 'true';
    const budgetMicros = Math.round(positiveEnv('PARITY_BUDGET_USD', EXEMPLAR_EVAL_BUDGET_USD)! * 1_000_000);
    const limitMinutes = positiveEnv('PARITY_TIME_LIMIT_MINUTES', null);
    const deadline = limitMinutes === null ? null : Date.now() + limitMinutes * 60_000;

    const env = { ...process.env, DB: {} as D1Database, ALLOWED_ORIGINS: 'http://localhost' } as unknown as Env;
    const config = loadConfig(env);
    const configFor = (effort: string | null) => (effort ? loadConfig({ ...env, AI_EFFORT_EXEMPLARS: effort } as Env) : config);
    const fp = d8Fingerprints();
    if (!fp) throw new Error('D8 指紋檔無效：先跑 npm run prompts -w @gsat/api（沒有花費）。');
    const goldenText = readFileSync(GOLDEN, 'utf8');
    const golden = JSON.parse(goldenText) as GoldenFile;
    const { cases: picked, unknown } = buildCases(golden, { effortSweep, only });
    if (unknown.length > 0) throw new Error(`題目集裡沒有：${unknown.join('、')}（沒有花費）`);
    const cases = mode === 'probe' ? [] : picked;
    const problems = casesProblems(golden, cases, fp);
    if (problems.length > 0) throw new Error(`題目集有問題，評測沒有開始（沒有花費）：${problems.join('；')}`);

    const fingerprint = await evalFingerprint(config, goldenText, golden);
    mkdirSync(OUT_DIR, { recursive: true });
    const previous = existsSync(RESULTS_FILE) ? (JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as ResultsFile) : null;
    const results: ResultsFile =
      previous && previous.fingerprint === fingerprint ? { ...previous, probe: null } : { started_at: new Date().toISOString(), fingerprint, probe: null, cases: {}, spent_micros: 0 };
    if (previous && previous.fingerprint !== fingerprint) console.log('[exemplars-eval] 提示、schema、模型、effort 或題目集變了：之前的結果與花費不沿用，從頭開始');
    const save = () => writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    const client = createAnthropicClient({ apiKey: config.ai.apiKey ?? '', baseURL: config.ai.baseUrl });
    const exec: Executor = async (input: ClaudeCallInput) => executeClaudeCall(client, input, await buildClaudeRequest(input));

    // A 組：每次都先跑。
    const probe = await runProbe(exec, config, golden);
    results.probe = probe;
    results.spent_micros += probe.call?.cost_micros ?? 0;
    save();
    console.log(`[exemplars-eval] A 組：${probe.ok ? '通過' : '沒有通過'}（${probe.code}；輸入 ${probe.call?.input_tokens ?? 0} tokens）`);

    let stop: EvalStop | undefined;
    if (!probe.ok) {
      stop = { reason: 'probe_failed' };
    } else {
      const pending = cases.filter((c) => needsRun(results.cases[c.key])).length;
      console.log(`[exemplars-eval] ${mode === 'probe' ? '只跑 A 組' : `共 ${cases.length} 題，這次要跑 ${pending} 題`}；已花費 US$${fmt(results.spent_micros / 1e6)}，上限 US$${fmt(budgetMicros / 1e6)}`);
      for (const c of cases) {
        if (!needsRun(results.cases[c.key])) continue;
        if (results.spent_micros + CASE_RESERVE_MICROS > budgetMicros) {
          stop = { reason: 'budget' };
          console.log(`[exemplars-eval] 到達累計預算上限，停在 ${c.key}`);
          break;
        }
        if (deadline !== null && Date.now() >= deadline) {
          stop = { reason: 'time' };
          console.log(`[exemplars-eval] 到達時間上限 ${limitMinutes} 分鐘，停在 ${c.key}`);
          break;
        }
        const r = await runCase({ exec, configFor, fp }, c);
        results.spent_micros += r.calls.reduce((s, x) => s + x.cost_micros, 0) + r.grade_cost_micros;
        const stopCode = [r.failure, ...r.levels.map((l) => l.grade_failure)].find((f): f is string => f !== undefined && STOP_FAILURES.has(f));
        if (stopCode) {
          stop = { reason: stopCode as 'spend_limit' | 'config_error' };
          save();
          console.log(`[exemplars-eval] Anthropic 回 ${stopCode}（${r.attempts.join('→')}），停在 ${c.key}（這一題不記成失敗，下次重跑）`);
          break;
        }
        results.cases[c.key] = r;
        save();
        const scores = r.levels.map((l) => (l.score === null ? '-' : fmt(l.score, 1))).join('／');
        console.log(`[exemplars-eval] ${c.key}：${r.input_rejected ? `輸入擋下 ${r.input_rejected}` : r.attempts.join('→')}；字數 ${r.levels.map((l) => l.words).join('／') || '-'}；分數 ${scores || '-'}`);
      }
    }
    save();
    const { markdown, verdict } = summarize(results, cases, { mode, subset: mode === 'full' && only.length > 0, ...(stop ? { stop } : {}) });
    writeFileSync(SUMMARY_FILE, markdown);
    console.log(markdown);
    console.log(`[exemplars-eval] 結論：${verdict}；結果：${RESULTS_FILE}`);
    expect(verdictPasses(verdict), `評測的結論是 ${verdict}：見彙總開頭的結論`).toBe(true);
  });
});
