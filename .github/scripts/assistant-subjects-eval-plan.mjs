#!/usr/bin/env node
/**
 * 學習助手國文真模型評測（.github/workflows/assistant-subjects-eval.yml）的「這次要跑什麼」：零依賴的 Node ESM，workflow 的第一步
 * 呼叫，單元測試（apps/api/test/assist-subjects.parity-summary.test.ts）直接匯入同一支函式。設計：docs/design/assistant-subjects.md §11.4。
 *
 *   workflow_dispatch                      → full：參數取 Actions 頁面的輸入（合併進 main 之後才有按鈕；評測不依賴它）。
 *   push 到 claude/** 而且改到 RUN 檔      → full：參數取 RUN 檔（apps/api/test/fixtures/assist-zh-golden/RUN）。
 *   push（main 或 claude/**）改到 PROBE_PATHS（國文的提示、schema、組請求與後處理、它們引用的 shared 檔、送出與攤開）
 *                                          → probe：只跑 A 組（max_tokens 64，確認輸出格式還編譯得過）。
 *   其他                                    → none：不跑（paths 篩選本來就擋掉了，這是保險）。
 *
 * 用法（workflow）：
 *   EVENT_NAME=… GIT_REF=… CHANGED_FILES_PATH=… INPUT_BUDGET_USD=… INPUT_RESUME=… INPUT_ALLOW_ONLINE_KEY=… INPUT_CASES=…
 *   node .github/scripts/assistant-subjects-eval-plan.mjs >> "$GITHUB_OUTPUT"
 * 輸出 mode、budget、resume、allow_online_key、cases 五行（key=value）。輸入不合法時印 ::error:: 並以 1 結束。
 * 只處理參數，不碰金鑰。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RUN_FILE = 'apps/api/test/fixtures/assist-zh-golden/RUN';
/**
 * 改到這些檔的 push 自動跑 A 組（§11.4 第 2 點）。寫法同 GitHub 的 paths 篩選：「*」不跨「/」、「**」可以跨。
 * assist-prompts-zh.json 是國文五份提示與 schema 的雜湊（任何影響送出內容的改動都必須更新它，test/assist.zh.rules.test.ts 強制），
 * 所以這一條就涵蓋了提示、schema、欄位上限與題型設定這些來源；其餘幾條是保險。workflow 的 on.push.paths 要列同一份（單元測試比對兩邊）。
 */
export const PROBE_PATHS = [
  'apps/api/test/fixtures/assist-prompts-zh.json',
  'apps/api/src/ai/prompts/assist-zh*.ts',
  'apps/api/src/ai/prompts/assist-common.ts',
  'apps/api/src/assist/subjects/**',
  'packages/shared/src/assist-zh.ts',
  'packages/shared/src/assist-subjects.ts',
  'packages/shared/src/assist.ts',
  'apps/api/src/ai/client.ts',
];
export const RUN_KEYS = ['request', 'budget_usd', 'resume', 'allow_online_key', 'cases'];
/** 累計花費上限（美元）：預設 25、最高 40（§11.4「預算」；完整評測估計約 US$23，其中國寫範文的 K 組約 US$2.5）。 */
export const BUDGET_MAX_USD = 40;
export const DEFAULT_BUDGET_USD = 25;
/** A 組只有五次 64 tokens 的呼叫：預算上限固定 1 美元。 */
export const PROBE_BUDGET_USD = 1;
/** 組別：A 編譯探測、B 選擇、BS 重排版、BP 沒看過的題（B′）、C 給答案、D 題組、E 簡答、F 國寫、G 追問、H 對抗、J 照片、K 國寫範文。 */
export const GROUP_SELECTORS = ['A', 'B', 'BS', 'BP', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];

/** paths 篩選的寫法 → 正規表示式（「**」任何字元、「*」不跨「/」）。 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else {
      re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** 這個檔有沒有落在 PROBE_PATHS 裡。 */
export function matchesProbePath(file) {
  return PROBE_PATHS.some((p) => globToRegExp(p).test(file));
}

/** 預算：大於 0、不超過 40 的數字（美元）；不合法回 null。 */
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

/** 題目清單：逗號分隔的題目 id（英數字與 -）或組別（GROUP_SELECTORS）；空白＝全部（回 []）；不合法回 null。 */
export function parseCases(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return [];
  const parts = s.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (parts.length === 0 || parts.length > 60) return null;
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
  const allowOnlineKey = parseBool(values.allow_online_key, false);
  if (allowOnlineKey === null) return { ok: false, error: 'allow_online_key 要是 true 或 false' };
  const cases = parseCases(values.cases);
  if (cases === null) return { ok: false, error: `cases 要是逗號分隔的題目 id 或組別（${GROUP_SELECTORS.join('、')}）` };
  return { ok: true, params: { budget, resume, allowOnlineKey, cases } };
}

/** 這次跑哪一種：full、probe 或 none（見檔頭）。 */
export function decideMode({ event, ref, changed }) {
  if (event === 'workflow_dispatch') return 'full';
  if (event !== 'push') return 'none';
  const files = [...changed];
  if (String(ref).startsWith('refs/heads/claude/') && files.includes(RUN_FILE)) return 'full';
  if (files.some(matchesProbePath)) return 'probe';
  return 'none';
}

/** 完整的計畫：mode 與參數（probe／none 用固定的參數，不讀 RUN 檔）。 */
export function planEval({ event, ref, changed, inputs, runFileText }) {
  const mode = decideMode({ event, ref, changed });
  if (mode !== 'full') return { ok: true, plan: { mode, budget: PROBE_BUDGET_USD, resume: false, allowOnlineKey: false, cases: [] } };
  const parsed = event === 'workflow_dispatch' ? paramsFrom(inputs ?? {}) : parseRunFile(runFileText ?? '');
  if (!parsed.ok) return { ok: false, error: `${event === 'workflow_dispatch' ? '輸入' : 'RUN 檔'}：${parsed.error}` };
  return { ok: true, plan: { mode, ...parsed.params } };
}

/** GITHUB_OUTPUT 的五行。 */
export function planOutputLines(plan) {
  return [`mode=${plan.mode}`, `budget=${plan.budget}`, `resume=${plan.resume}`, `allow_online_key=${plan.allowOnlineKey}`, `cases=${plan.cases.join(',')}`];
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
    inputs: { budget_usd: env.INPUT_BUDGET_USD, resume: env.INPUT_RESUME, allow_online_key: env.INPUT_ALLOW_ONLINE_KEY, cases: env.INPUT_CASES },
    runFileText,
  });
  if (!result.ok) {
    console.error(`::error::${result.error}；這次沒有執行（沒有花費）。`);
    process.exit(1);
  }
  process.stdout.write(`${planOutputLines(result.plan).join('\n')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
