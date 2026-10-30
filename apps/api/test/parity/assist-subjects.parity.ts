/**
 * 學習助手國文的真模型評測（docs/design/assistant-subjects.md §11.2–§11.4；開放國文之前必跑，不進 CI、開發時不跑）。負責：S1-eval。
 *
 *   ANTHROPIC_API_KEY=<dev workspace 的金鑰> npm run parity:assist-subjects -w @gsat/api
 *
 * 站主不用在自己的電腦跑：GitHub Actions 的「學習助手國文真模型評測」（.github/workflows/assistant-subjects-eval.yml）用 GitHub secret 的
 * 金鑰跑這支工具——在 claude/** 分支改 RUN 檔（test/fixtures/assist-zh-golden/RUN）推上去，或國文的提示、schema、後處理改動時自動只跑
 * A 組。Summary 顯示結論，結果目錄存成 artifact 並快取起來給下一次接著跑。
 *
 * 單元測試全部用假模型，測不出 Anthropic 端的限制（輸出格式的 grammar 太大會被 400 拒收），也量不到真正的正確率與成本。
 * 這支工具用真模型、和 Worker 同一套函式（assist-subjects.runner.ts）：
 *   A 組  五份輸出格式各一次、max_tokens 64：回應不是 400 就通過；**不過就停**，其他組不跑。
 *   B–J   題目集（test/fixtures/assist-zh-golden/）：先跑全部的解析，再跑追問（沿用同一次執行的解析），最後跑照片。
 *         解析可以同時跑幾題（ASSIST_SUBJECTS_EVAL_CONCURRENCY，預設 4）：完整評測約 200 次呼叫，一題一題跑會超過 Actions 的時間上限。
 * 門檻與彙總在 assist-subjects.cases.ts（單元測試 test/assist-subjects.parity-summary.test.ts 驗證達標判定與執行流程）。
 *
 * 環境變數：
 *   ASSIST_SUBJECTS_EVAL_MODE         full（預設）或 probe（只跑 A 組）
 *   ASSIST_SUBJECTS_EVAL_CASES        只跑這些題目（題目 id 或組別，逗號分隔；空白＝全部；只有 A＝只跑 A 組）；只跑一部分時結論是「部分」
 *   ASSIST_SUBJECTS_EVAL_CONCURRENCY  同時跑幾題（1–8，預設 4）
 *   PARITY_BUDGET_USD                 累計花費上限（預設 25；含之前中斷的那幾次）；PARITY_TIME_LIMIT_MINUTES 時間上限
 *   PARITY_OUT                        結果目錄（預設 test/parity/.results/，不進版控）
 * 每一題的結果馬上存檔，下次執行從中斷處接著跑（系統提示、schema、任務設定、題目集或指紋變了就從頭跑）。A 組每次都先跑。
 *
 * 國文 D8 指紋：完整評測一定要有（npm run prompts 打包；沒有就在花錢之前失敗）。只跑 A 組時，指紋還沒接上也可以跑（用空的國文集合組題目，
 * A 組只看輸出格式）。指紋不帶金鑰，不需要另外的 secret。
 *
 * 這個 repo 是公開的：log、結果檔與彙總只有代碼、計數、對錯、tokens、花費與延遲；不印模型寫的任何文字、Anthropic 的錯誤說明、
 * 金鑰或模型名稱。結論不是「達標」「只跑 A 組而且通過」或「部分（正常）」時這支測試會失敗（exit code 非 0）。
 * 沒有 ANTHROPIC_API_KEY 時：本機略過；CI 直接失敗（略過會被當成通過）。
 * 檔名不符合 test/**\/*.test.ts：npm test 與 CI 都不會跑它（vitest.parity.config.ts 只收 *.parity.ts，
 * package.json 的 parity:assist-subjects 只跑這一支）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCases } from '../../../../.github/scripts/assistant-subjects-eval-plan.mjs';
import { buildClaudeRequest, createAnthropicClient, executeClaudeCall, type ClaudeCallInput } from '../../src/ai/client';
import { d8Fingerprints } from '../../src/ai/d8';
import { taskConfig, ZH_TASK_SIZES } from '../../src/ai/tasks';
import { loadConfig } from '../../src/config';
import type { Env } from '../../src/env';
import { chineseSubject } from '../../src/assist/subjects';
import { zhFingerprints, type ZhFingerprints } from '../../src/assist/subjects/chinese/d8';
import {
  CASE_RESERVE_MICROS,
  STOP_FAILURES,
  ZH_EVAL_BUDGET_USD,
  buildCases,
  fmt,
  needsRun,
  probeCases,
  summarize,
  verdictPasses,
  type EvalCase,
  type EvalStop,
  type ResultsFile,
} from './assist-subjects.cases';
import { buildAnalyze, casesProblems, readGolden, runCase, runProbe, type Executor, type RunDeps } from './assist-subjects.runner';

const OUT_DIR = process.env['PARITY_OUT'] ?? path.join(import.meta.dirname, '.results');
const RESULTS_FILE = path.join(OUT_DIR, 'assist-subjects.json');
const SUMMARY_FILE = path.join(OUT_DIR, 'assist-subjects.md');
const API_KEY = process.env['ANTHROPIC_API_KEY']?.trim() ?? '';
const GOLDEN_DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'assist-zh-golden');

function positiveEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name}=${JSON.stringify(raw)} 不是正數`);
  return n;
}

/** 國文指紋還沒接上時，A 組用的空集合（只看輸出格式）。 */
const EMPTY_ZH: ZhFingerprints = { version: 'empty', windows: new Set(), short: [] };

/** 會影響結果的設定的雜湊（不存模型名稱本身）：五份請求的 prompt version（系統提示＋schema）、任務設定、題目集、指紋版本。 */
async function evalFingerprint(deps: Pick<RunDeps, 'config' | 'fp' | 'zh'>, goldenTexts: readonly string[], probe: ReturnType<typeof probeCases>): Promise<string> {
  const parts: unknown[] = [goldenTexts, ZH_TASK_SIZES, deps.fp.version, deps.zh.version];
  for (const task of ['assist_analyze', 'assist_followup', 'assist_ocr'] as const) parts.push(taskConfig(task, deps.config, { subject: 'chinese' }).calls);
  for (const p of probe) {
    if (!p.analyze) continue;
    const b = buildAnalyze(p.analyze, deps);
    if (!('rejected' in b)) parts.push((await buildClaudeRequest(b.input)).promptVersion);
  }
  const ocr = chineseSubject.ocr.callInput(taskConfig('assist_ocr', deps.config, { subject: 'chinese', photos: 1 }), [{ mime: 'image/png', bytes: new Uint8Array([0]) }]);
  parts.push((await buildClaudeRequest(ocr)).promptVersion, chineseSubject.followup.templateVersion);
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

describe.skipIf(!API_KEY && !process.env['CI'])('學習助手國文真模型評測', () => {
  it('A 組先跑（不過就停），再依 §11.2 跑 B–J，結果存檔並印出彙總；結論不通過時失敗', async () => {
    if (!API_KEY) throw new Error('沒有 ANTHROPIC_API_KEY：在 CI 上不能略過評測（略過會被當成通過）。');
    const envMode = (process.env['ASSIST_SUBJECTS_EVAL_MODE']?.trim() || 'full') as 'full' | 'probe';
    if (envMode !== 'full' && envMode !== 'probe') throw new Error('ASSIST_SUBJECTS_EVAL_MODE 要是 full 或 probe');
    const only = parseCases(process.env['ASSIST_SUBJECTS_EVAL_CASES'] ?? '');
    if (only === null) throw new Error('ASSIST_SUBJECTS_EVAL_CASES 要是逗號分隔的題目 id 或組別');
    const concurrency = Math.min(8, Math.max(1, Math.floor(positiveEnv('ASSIST_SUBJECTS_EVAL_CONCURRENCY', 4)!)));
    const budgetMicros = Math.round(positiveEnv('PARITY_BUDGET_USD', ZH_EVAL_BUDGET_USD)! * 1_000_000);
    const limitMinutes = positiveEnv('PARITY_TIME_LIMIT_MINUTES', null);
    const deadline = limitMinutes === null ? null : Date.now() + limitMinutes * 60_000;

    const env = { ...process.env, DB: {} as D1Database, ALLOWED_ORIGINS: 'http://localhost' } as unknown as Env;
    const config = loadConfig(env);
    const fp = d8Fingerprints();
    if (!fp) throw new Error('英文 D8 指紋檔無效：先跑 npm run prompts -w @gsat/api（沒有花費）。');
    const { golden, texts } = readGolden(GOLDEN_DIR);
    const { cases: picked, unknown } = buildCases(golden, { only });
    if (unknown.length > 0) throw new Error(`題目集裡沒有：${unknown.join('、')}（沒有花費）`);
    // 只寫 A（或沒有挑到任何題目）＝只跑 A 組。
    const mode: 'full' | 'probe' = envMode === 'probe' || (only.length > 0 && picked.length === 0) ? 'probe' : 'full';
    const cases: EvalCase[] = mode === 'probe' ? [] : picked;
    const loaded = zhFingerprints();
    if (!loaded && mode === 'full') throw new Error('國文 D8 指紋讀不到：完整評測一定要有（先跑 npm run prompts -w @gsat/api；沒有花費）。');
    const zh = loaded ?? EMPTY_ZH;
    const probe = probeCases(golden);
    const base = { config, fp, zh, goldenDir: GOLDEN_DIR };
    const problems = casesProblems(golden, cases, base);
    if (problems.length > 0) throw new Error(`題目集有問題，評測沒有開始（沒有花費）：${problems.join('；')}`);

    const fingerprint = await evalFingerprint(base, texts, probe);
    mkdirSync(OUT_DIR, { recursive: true });
    const previous = existsSync(RESULTS_FILE) ? (JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) as ResultsFile) : null;
    const results: ResultsFile =
      previous && previous.fingerprint === fingerprint
        ? { ...previous, probe: null }
        : { started_at: new Date().toISOString(), fingerprint, zh_version: loaded ? zh.version : null, probe: null, cases: {}, spent_micros: 0 };
    if (previous && previous.fingerprint !== fingerprint) console.log('[assist-subjects-eval] 提示、schema、任務設定、題目集或指紋變了：之前的結果與花費不沿用，從頭開始');
    const save = () => writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    const client = createAnthropicClient({ apiKey: config.ai.apiKey ?? '', baseURL: config.ai.baseUrl });
    const exec: Executor = async (input: ClaudeCallInput) => executeClaudeCall(client, input, await buildClaudeRequest(input));
    const deps: RunDeps = { ...base, exec, views: new Map() };

    // A 組：每次都先跑。
    const probeResult = await runProbe(deps, probe, loaded ? 'loaded' : 'empty');
    results.probe = probeResult;
    results.spent_micros += probeResult.runs.reduce((s, r) => s + (r.call?.cost_micros ?? 0), 0);
    save();
    console.log(`[assist-subjects-eval] A 組：${probeResult.ok ? '通過' : '沒有通過'}（${probeResult.runs.map((r) => `${r.id} ${r.code}`).join('、')}）`);

    let stop: EvalStop | undefined;
    if (!probeResult.ok) {
      stop = { reason: 'probe_failed' };
    } else if (cases.length > 0) {
      const pending = cases.filter((c) => !(c.kind === 'ocr' && c.skip) && needsRun(results.cases[c.key]));
      console.log(`[assist-subjects-eval] 共 ${cases.length} 題，這次要跑 ${pending.length} 題（同時 ${concurrency} 題）；已花費 US$${fmt(results.spent_micros / 1e6)}，上限 US$${fmt(budgetMicros / 1e6)}`);
      // 先解析、再追問（沿用這次的解析）、最後照片。
      const phases = [pending.filter((c) => c.kind === 'analyze'), pending.filter((c) => c.kind === 'followup'), pending.filter((c) => c.kind === 'ocr')];
      let inflight = 0;
      for (const phase of phases) {
        let next = 0;
        const worker = async () => {
          while (!stop && next < phase.length) {
            const c = phase[next++]!;
            if (results.spent_micros + (inflight + 1) * CASE_RESERVE_MICROS > budgetMicros) {
              stop = { reason: 'budget' };
              console.log(`[assist-subjects-eval] 到達累計預算上限，停在 ${c.key}`);
              break;
            }
            if (deadline !== null && Date.now() >= deadline) {
              stop = { reason: 'time' };
              console.log(`[assist-subjects-eval] 到達時間上限 ${limitMinutes} 分鐘，停在 ${c.key}`);
              break;
            }
            inflight += 1;
            const r = await runCase(deps, c).finally(() => {
              inflight -= 1;
            });
            results.spent_micros += r.ops.reduce((s, o) => s + o.calls.reduce((t, x) => t + x.cost_micros, 0), 0);
            if (!r.ok && STOP_FAILURES.has(r.failure ?? '')) {
              stop = { reason: r.failure as 'spend_limit' | 'config_error' };
              save();
              console.log(`[assist-subjects-eval] Anthropic 回 ${r.failure}（${r.attempts.join('→')}），停在 ${c.key}（這一題不記成失敗，下次重跑）`);
              break;
            }
            results.cases[c.key] = r;
            save();
            console.log(`[assist-subjects-eval] ${c.key}：${r.input_rejected ? `輸入擋下 ${r.input_rejected}` : r.attempts.join('→')}${r.mismatch ? `（科目 ${r.mismatch}）` : ''}`);
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
        if (stop) break;
      }
    }
    save();
    const { markdown, verdict } = summarize(results, cases, { mode, subset: mode === 'full' && only.length > 0, ...(stop ? { stop } : {}) });
    writeFileSync(SUMMARY_FILE, markdown);
    console.log(markdown);
    console.log(`[assist-subjects-eval] 結論：${verdict}；結果：${RESULTS_FILE}`);
    expect(verdictPasses(verdict), `評測的結論是 ${verdict}：見彙總開頭的結論`).toBe(true);
  });
});
