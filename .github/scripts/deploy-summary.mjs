// worker-deploy.yml 的「部署後確認」最後一段：把 /api/features、Worker 上的機密名稱、Vercel 代理的狀態整理成
// 這次執行的 Summary（GITHUB_STEP_SUMMARY）與 log 裡的 ::warning::／::notice::。
//
// 站主照 docs/design/custom-essay.md §10 第 3、5 步確認「自訂題目批改（customEssay）」是啟用或未啟用，所以這一列一定要有；
// wrangler.toml 的 AI_CUSTOM_ESSAY 和 /api/features 對不起來時印 ::warning::（新版本還沒傳到所有節點時常見）；
// AI 已啟用、自訂題目批改未啟用時印 ::notice::（只關自訂題時是預期的狀態，不是錯誤）。
//
// 只讀公開端點的布林與機密的「名稱」，不印任何機密值。buildDeploySummary 是純函式（apps/api/test/deploy-summary.test.ts 測它）。
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const onOff = (v) => (v ? '啟用' : '未啟用');

/**
 * wrangler.toml 的 AI_CUSTOM_ESSAY：回傳設定的字串；沒有這一行回 null（Worker 用預設值 on）。
 * 只認 [vars] 裡 `AI_CUSTOM_ESSAY = "…"` 這種寫法（註解行不算）。
 */
export function customEssayVarFrom(wranglerToml) {
  const m = /^[ \t]*AI_CUSTOM_ESSAY[ \t]*=[ \t]*"([^"]*)"/m.exec(wranglerToml);
  return m ? m[1] : null;
}

/** 和 apps/api/src/config.ts 的 customEssaySwitch 同一條規則：去掉頭尾空白、轉小寫後等於 on 才開；沒設定或空白用預設 on。 */
export function customEssayExpected(value) {
  const v = value === null || value.trim() === '' ? 'on' : value.trim().toLowerCase();
  return v === 'on';
}

/**
 * @param {{
 *   features: { auth?: boolean, ai?: boolean, ocr?: boolean, aiPaused?: boolean, customEssay?: boolean },
 *   secretNames: string[], proxy: string, vercelTarget: string, appUrl: string, workerUrl: string, workerName: string,
 *   subdomain: string, customEssayVar: string | null,
 * }} input
 */
export function buildDeploySummary(input) {
  const f = input.features;
  const names = new Set(input.secretNames);
  const missing = (list) => list.filter((n) => !names.has(n));
  const authMissing = missing(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET']);
  const aiMissing = missing(['ANTHROPIC_API_KEY']);
  let proxyOk = false;
  try {
    proxyOk = JSON.parse(input.proxy).service === input.workerName;
  } catch {
    proxyOk = false;
  }
  const workerHost = `${input.workerName}.${input.subdomain}.workers.dev`;
  const vercelOk = input.vercelTarget === workerHost;
  const customOn = f.customEssay === true;
  const expCustom = f.ai === true && customEssayExpected(input.customEssayVar);
  const varLabel = input.customEssayVar === null ? '沒有設定，預設 on' : JSON.stringify(input.customEssayVar);

  const rows = [
    ['Worker 網址', input.workerUrl],
    ['workers.dev 子網域', `${input.subdomain}.workers.dev`],
    ['登入（auth）', onOff(f.auth)],
    ['AI 批改（ai）', onOff(f.ai)],
    ['拍照 OCR（ocr）', onOff(f.ocr)],
    ['自訂題目批改（customEssay）', `${onOff(customOn)}（wrangler.toml 的 AI_CUSTOM_ESSAY：${varLabel}）`],
    ['AI 全站暫停（aiPaused）', f.aiPaused ? '是' : '否'],
    ['Worker 上的機密（只列名稱）', [...names].join('、') || '（沒有）'],
    [`經 Vercel 代理的 ${input.appUrl}/api/health`, proxyOk ? '已接上' : '還沒接上'],
  ];

  const warnings = [];
  if (!f.auth) warnings.push(`登入未啟用：Worker 上缺 ${authMissing.join('、') || '（機密都在，請檢查 wrangler.toml 的 APP_ORIGIN）'}。`);
  else if (!f.ai) warnings.push(`AI 批改未啟用：Worker 上缺 ${aiMissing.join('、') || '（機密都在，請檢查 wrangler.toml 的 [[queues.producers]]）'}。`);
  if (f.ai && f.aiPaused) warnings.push('AI 目前是暫停狀態：今天的全站預算用完、管理員在後台按了暫停，或 D1 遷移沒有套用成功。');
  const expAuth = authMissing.length === 0;
  const expAi = expAuth && aiMissing.length === 0;
  if (f.auth !== expAuth || f.ai !== expAi) {
    warnings.push(`/api/features 和 Worker 上的機密對不起來（可能是新版本還沒傳到所有節點），幾分鐘後再打開 ${input.workerUrl}/api/features 確認。`);
  }
  if (f.ai && customOn !== expCustom) {
    warnings.push(
      `自訂題目批改（customEssay）是「${onOff(customOn)}」，和 wrangler.toml 的 AI_CUSTOM_ESSAY（${varLabel}）對不起來：新版本可能還沒傳到所有節點，幾分鐘後再打開 ${input.workerUrl}/api/features 確認；確認之前不要解除全站暫停。`,
    );
  }
  const notices = [];
  if (f.ai && !customOn) {
    notices.push('AI 批改已啟用，但自訂題目批改（customEssay）未啟用：歷屆題與本站題照常，自訂題目的作答頁只能自我檢核。要開啟請把 wrangler.toml 的 AI_CUSTOM_ESSAY 改成 "on"（docs/SETUP-KEYS.md「只關閉自訂題目批改」）。');
  }

  const next = [];
  if (!vercelOk) {
    next.push(`把根目錄 vercel.json 的 rewrites（/api、/auth 兩條）指向 https://${workerHost}（目前是 ${input.vercelTarget || '沒有找到'}），推到 main，Vercel 重新部署後打開 ${input.appUrl}/api/health 應該回 ok。`);
  } else if (!proxyOk) {
    next.push(`vercel.json 已指向這支 Worker，但 ${input.appUrl}/api/health 還不通：確認 Vercel 已重新部署（Vercel 儀表板 → Deployments）。`);
  }
  if (f.auth) next.push(`Google Cloud Console 的 OAuth 用戶端要有重新導向 URI ${input.appUrl}/auth/google/callback；用 ADMIN_EMAIL 的 Google 帳號登入後打開 ${input.appUrl}/admin 看健康檢查。`);
  else next.push('設定登入需要的機密（docs/SETUP-KEYS.md），再重跑這個 workflow。');

  const md = ['## 後端部署結果', '', '| 項目 | 結果 |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`), ''];
  if (warnings.length) md.push('### 注意', '', ...warnings.map((w) => `- ${w}`), '');
  if (notices.length) md.push('### 提醒', '', ...notices.map((n) => `- ${n}`), '');
  md.push('### 下一步', '', ...next.map((n, i) => `${i + 1}. ${n}`), '', '詳細說明見 docs/SETUP-KEYS.md。', '');
  return { rows, warnings, notices, next, markdown: md.join('\n') };
}

function main() {
  const env = process.env;
  const s = buildDeploySummary({
    features: JSON.parse(env.FEATURES || '{}'),
    secretNames: (env.SECRET_NAMES || '').split(/\s+/).filter(Boolean),
    proxy: env.PROXY || '',
    vercelTarget: env.VERCEL_TARGET || '',
    appUrl: env.APP_URL || '',
    workerUrl: env.WORKER_URL || '',
    workerName: env.WORKER_NAME || 'gsat-english-api',
    subdomain: env.SUBDOMAIN || '',
    customEssayVar: customEssayVarFrom(readFileSync(env.WRANGLER_TOML || 'apps/api/wrangler.toml', 'utf8')),
  });
  for (const [k, v] of s.rows) console.log(`${k}：${v}`);
  for (const w of s.warnings) console.log(`::warning::${w}`);
  for (const n of s.notices) console.log(`::notice::${n}`);
  for (const [i, n] of s.next.entries()) console.log(`下一步 ${i + 1}：${n}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, s.markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
