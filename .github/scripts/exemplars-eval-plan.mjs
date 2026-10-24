#!/usr/bin/env node
/**
 * 作文範文真模型評測（.github/workflows/exemplars-eval.yml）的「這次要跑什麼」：零依賴的 Node ESM，workflow 的第一步呼叫，
 * 單元測試（apps/api/test/exemplars.parity-summary.test.ts）直接匯入同一支函式。設計：docs/design/model-essays.md §9.6。
 *
 *   workflow_dispatch                      → full：參數取 Actions 頁面的輸入。
 *   push 到 claude/** 而且改到 RUN 檔      → full：參數取 RUN 檔（apps/api/test/fixtures/exemplars-golden/RUN）。
 *   push（main 或 claude/**）改到 PROBE_PATHS（輸出格式、系統提示與它們引用的檔）→ probe：只跑 A 組（max_tokens 64，確認輸出格式
 *                                            還編譯得過）。
 *   其他                                    → none：不跑（paths 篩選本來就擋掉了，這是保險）。
 *
 * 用法（workflow）：
 *   EVENT_NAME=… GIT_REF=… CHANGED_FILES_PATH=… INPUT_BUDGET_USD=… INPUT_RESUME=… INPUT_EFFORT_SWEEP=… INPUT_ALLOW_ONLINE_KEY=…
 *   INPUT_CASES=… node .github/scripts/exemplars-eval-plan.mjs >> "$GITHUB_OUTPUT"
 * 輸出 mode、budget、resume、effort_sweep、allow_online_key、cases 六行（key=value）。輸入不合法時印 ::error:: 並以 1 結束。
 * 只處理參數，不碰金鑰。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RUN_FILE = 'apps/api/test/fixtures/exemplars-golden/RUN';
/**
 * 改到這些檔的 push 自動跑 A 組（§9.6 第 3 點、§10.4 風險 1）：送出的輸出格式（schema.ts；enum 來自 shared 的 exemplars.ts、bank.ts 與
 * prompts/essay.ts；client.ts 送出前攤開 $ref）與系統提示（prompts/exemplars.ts；引用 prompts/essay.ts 的評分描述、prompts/common.ts、
 * shared 的層級規格與欄位上限）。workflow 的 on.push.paths 要列同一份（單元測試比對兩邊）。
 */
export const PROBE_PATHS = [
  'apps/api/src/exemplars/schema.ts',
  'apps/api/src/ai/prompts/exemplars.ts',
  'apps/api/src/ai/prompts/essay.ts',
  'apps/api/src/ai/prompts/common.ts',
  'apps/api/src/ai/client.ts',
  'packages/shared/src/exemplars.ts',
  'packages/shared/src/bank.ts',
];
export const RUN_KEYS = ['request', 'budget_usd', 'resume', 'effort_sweep', 'allow_online_key', 'cases'];
export const BUDGET_MAX_USD = 100;
export const DEFAULT_BUDGET_USD = 15;
/** A 組只跑一次 64 tokens 的呼叫：預算上限固定 1 美元。 */
export const PROBE_BUDGET_USD = 1;

/** 預算：大於 0、不超過 100 的數字（美元）；不合法回 null。 */
export function parseBudget(raw) {
  const s = String(raw ?? '').replace(/\s+/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= BUDGET_MAX_USD ? n : null;
}

/** 布林：true／false（不分大小寫）；空字串用預設值；其他回 null。 */
export function parseBool(raw, fallback) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '') return fallback;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

/** 題目清單：逗號分隔的題目 id（英數字與 -）或組別字母（A–G）；空白＝全部（回 []）；不合法回 null。 */
export function parseCases(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return [];
  const parts = s.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (parts.length === 0 || parts.length > 40) return null;
  return parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(p)) ? parts : null;
}

/** RUN 檔：「名稱=值」一行一個，# 開頭是註解；不認得的名稱、重複的名稱、格式不對都是錯誤。 */
export function parseRunFile(text) {
  const values = {};
  for (const [i, line] of String(text).split(/\r?\n/).entries()) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const m = /^([a-z_]+)=(.*)$/.exec(t);
    if (!m) return { ok: false, error: `第 ${i + 1} 行不是「名稱=值」` };
    const [, key, value] = m;
    if (!RUN_KEYS.includes(key)) return { ok: false, error: `第 ${i + 1} 行：不認得的名稱 ${key}` };
    if (key in values) return { ok: false, error: `第 ${i + 1} 行：${key} 重複` };
    values[key] = value.trim();
  }
  return paramsFrom(values);
}

/** 參數（RUN 檔或 dispatch 的輸入）→ 驗證過的值。 */
export function paramsFrom(values) {
  const budget = values.budget_usd === undefined || values.budget_usd === '' ? DEFAULT_BUDGET_USD : parseBudget(values.budget_usd);
  if (budget === null) return { ok: false, error: `budget_usd 要是大於 0、不超過 ${BUDGET_MAX_USD} 的數字（美元）` };
  const resume = parseBool(values.resume, true);
  if (resume === null) return { ok: false, error: 'resume 要是 true 或 false' };
  const effortSweep = parseBool(values.effort_sweep, false);
  if (effortSweep === null) return { ok: false, error: 'effort_sweep 要是 true 或 false' };
  const allowOnlineKey = parseBool(values.allow_online_key, false);
  if (allowOnlineKey === null) return { ok: false, error: 'allow_online_key 要是 true 或 false' };
  const cases = parseCases(values.cases);
  if (cases === null) return { ok: false, error: 'cases 要是逗號分隔的題目 id 或組別字母（A–G）' };
  return { ok: true, params: { budget, resume, effortSweep, allowOnlineKey, cases } };
}

/** 這次跑哪一種：full、probe 或 none（見檔頭）。 */
export function decideMode({ event, ref, changed }) {
  if (event === 'workflow_dispatch') return 'full';
  if (event !== 'push') return 'none';
  const files = new Set(changed);
  if (String(ref).startsWith('refs/heads/claude/') && files.has(RUN_FILE)) return 'full';
  if (PROBE_PATHS.some((p) => files.has(p))) return 'probe';
  return 'none';
}

/** 完整的計畫：mode 與參數（probe／none 用固定的參數，不讀 RUN 檔）。 */
export function planEval({ event, ref, changed, inputs, runFileText }) {
  const mode = decideMode({ event, ref, changed });
  if (mode !== 'full') return { ok: true, plan: { mode, budget: PROBE_BUDGET_USD, resume: false, effortSweep: false, allowOnlineKey: false, cases: [] } };
  const parsed = event === 'workflow_dispatch' ? paramsFrom(inputs ?? {}) : parseRunFile(runFileText ?? '');
  if (!parsed.ok) return { ok: false, error: `${event === 'workflow_dispatch' ? '輸入' : 'RUN 檔'}：${parsed.error}` };
  return { ok: true, plan: { mode, ...parsed.params } };
}

/** GITHUB_OUTPUT 的六行。 */
export function planOutputLines(plan) {
  return [
    `mode=${plan.mode}`,
    `budget=${plan.budget}`,
    `resume=${plan.resume}`,
    `effort_sweep=${plan.effortSweep}`,
    `allow_online_key=${plan.allowOnlineKey}`,
    `cases=${plan.cases.join(',')}`,
  ];
}

function main() {
  const env = process.env;
  const changed = env.CHANGED_FILES_PATH ? readFileSync(env.CHANGED_FILES_PATH, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  let runFileText = null;
  if (decideMode({ event: env.EVENT_NAME, ref: env.GIT_REF, changed }) === 'full' && env.EVENT_NAME === 'push') runFileText = readFileSync(RUN_FILE, 'utf8');
  const result = planEval({
    event: env.EVENT_NAME,
    ref: env.GIT_REF,
    changed,
    inputs: {
      budget_usd: env.INPUT_BUDGET_USD,
      resume: env.INPUT_RESUME,
      effort_sweep: env.INPUT_EFFORT_SWEEP,
      allow_online_key: env.INPUT_ALLOW_ONLINE_KEY,
      cases: env.INPUT_CASES,
    },
    runFileText,
  });
  if (!result.ok) {
    console.error(`::error::${result.error}；這次沒有執行（沒有花費）。`);
    process.exit(1);
  }
  process.stdout.write(`${planOutputLines(result.plan).join('\n')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
