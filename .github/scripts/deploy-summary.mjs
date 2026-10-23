// worker-deploy.yml 的「部署後確認」最後一段：把 /api/features、Worker 上的機密名稱、Vercel 代理的狀態整理成
// 這次執行的 Summary（GITHUB_STEP_SUMMARY）與 log 裡的 ::warning::／::notice::。
//
// 站主照 docs/design/custom-essay.md §10 確認「自訂題目批改（customEssay）」是啟用或未啟用，所以這一列一定要有；
// wrangler.toml 的 AI_CUSTOM_ESSAY 和 /api/features 對不起來時印 ::warning::（新版本還沒傳到所有節點時常見）；
// AI 已啟用、自訂題目批改未啟用時印 ::notice::：評分對照（真模型）達標、打開之前，或出問題時只關自訂題，都是預期的狀態，
// 不是錯誤（docs/SETUP-KEYS.md §8.1、§8.2）。
//
// 學習助手的兩個開關（AI_ASSISTANT、AI_ASSISTANT_PHOTO：off／admin／on；docs/design/learning-assistant.md §4.14）也各一列，
// 寫出 wrangler.toml 的值。/api/features 只在 on 時有 assistant、assistantPhoto（admin 模式不出現），所以只比 on：
// 對不起來時印 ::warning::；admin 模式（只有管理員能用：上線後只在緊急時用來查問題）印 ::notice::，提醒用管理員帳號登入確認、
// 查完改回 on（docs/SETUP-KEYS.md §8.3）。2026-10-23 上線後 wrangler.toml 兩個都是 on，Summary 是「啟用」、沒有提醒。
//
// 只讀公開端點的布林與機密的「名稱」，不印任何機密值。buildDeploySummary 是純函式（apps/api/test/deploy-summary.test.ts 測它）。
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const onOff = (v) => (v ? '啟用' : '未啟用');

/** apps/api/src/config.ts 的 CONFIG_DEFAULTS.AI_CUSTOM_ESSAY（wrangler.toml 沒有這一行時 Worker 用它；test/deploy-summary.test.ts 比對兩邊）。 */
export const CUSTOM_ESSAY_DEFAULT = 'off';

/**
 * wrangler.toml 的 AI_CUSTOM_ESSAY：回傳設定的字串；沒有這一行回 null（Worker 用預設值 off）。
 * 只認 [vars] 裡 `AI_CUSTOM_ESSAY = "…"` 這種寫法（註解行不算）。
 */
export function customEssayVarFrom(wranglerToml) {
  const m = /^[ \t]*AI_CUSTOM_ESSAY[ \t]*=[ \t]*"([^"]*)"/m.exec(wranglerToml);
  return m ? m[1] : null;
}

/** 和 apps/api/src/config.ts 的 customEssaySwitch 同一條規則：去掉頭尾空白、轉小寫後等於 on 才開；沒設定或空白用預設值（off）。 */
export function customEssayExpected(value) {
  const v = value === null || value.trim() === '' ? CUSTOM_ESSAY_DEFAULT : value.trim().toLowerCase();
  return v === 'on';
}

/** apps/api/src/config.ts 的 CONFIG_DEFAULTS.AI_ASSISTANT／AI_ASSISTANT_PHOTO（兩個都是 off；test/deploy-summary.test.ts 比對兩邊）。 */
export const ASSISTANT_DEFAULT = 'off';

/**
 * wrangler.toml 的 AI_ASSISTANT、AI_ASSISTANT_PHOTO：各自回傳設定的字串；沒有那一行回 null（Worker 用預設值 off）。
 * 寫法的規則同 customEssayVarFrom（註解行不算）。
 */
export function assistantVarsFrom(wranglerToml) {
  const read = (name) => {
    const m = new RegExp(`^[ \\t]*${name}[ \\t]*=[ \\t]*"([^"]*)"`, 'm').exec(wranglerToml);
    return m ? m[1] : null;
  };
  return { assistant: read('AI_ASSISTANT'), photo: read('AI_ASSISTANT_PHOTO') };
}

/** 和 apps/api/src/config.ts 的 assistantSwitch 同一條規則：去掉頭尾空白、轉小寫後只認 on、admin，其他一律 off；沒設定或空白用預設值（off）。 */
export function assistantMode(value) {
  const v = value === null || value === undefined || value.trim() === '' ? ASSISTANT_DEFAULT : value.trim().toLowerCase();
  return v === 'on' || v === 'admin' ? v : 'off';
}

const MODE_LABELS = { on: '對所有人開放', admin: '只有管理員能用', off: '關閉' };

/**
 * @param {{
 *   features: { auth?: boolean, ai?: boolean, ocr?: boolean, aiPaused?: boolean, customEssay?: boolean, assistant?: boolean, assistantPhoto?: boolean },
 *   secretNames: string[], proxy: string, vercelTarget: string, appUrl: string, workerUrl: string, workerName: string,
 *   subdomain: string, customEssayVar: string | null, assistantVar?: string | null, assistantPhotoVar?: string | null,
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
  const varLabel = input.customEssayVar === null ? `沒有設定，預設 ${CUSTOM_ESSAY_DEFAULT}` : JSON.stringify(input.customEssayVar);
  // 學習助手：wrangler.toml 的值 → 模式；拍照要學習助手本身也開放（admin 模式時只有管理員能用）。
  const assistantVar = input.assistantVar ?? null;
  const assistantPhotoVar = input.assistantPhotoVar ?? null;
  const modeA = assistantMode(assistantVar);
  const photoRaw = assistantMode(assistantPhotoVar);
  const modeP = modeA === 'off' || photoRaw === 'off' ? 'off' : modeA === 'on' && photoRaw === 'on' ? 'on' : 'admin';
  const assistantOn = f.assistant === true;
  const assistantPhotoOn = f.assistantPhoto === true;
  const expAssistantOn = f.ai === true && modeA === 'on';
  const expPhotoOn = expAssistantOn && modeP === 'on';
  const modeVarLabel = (name, value) => `${name}：${value === null ? `沒有設定，預設 ${ASSISTANT_DEFAULT}` : JSON.stringify(value)}`;
  const modeState = (publicOn, mode) => (publicOn ? '啟用' : f.ai && mode === 'admin' ? '只有管理員能用（admin）' : '未啟用');

  const rows = [
    ['Worker 網址', input.workerUrl],
    ['workers.dev 子網域', `${input.subdomain}.workers.dev`],
    ['登入（auth）', onOff(f.auth)],
    ['AI 批改（ai）', onOff(f.ai)],
    ['拍照 OCR（ocr）', onOff(f.ocr)],
    ['自訂題目批改（customEssay）', `${onOff(customOn)}（wrangler.toml 的 AI_CUSTOM_ESSAY：${varLabel}）`],
    ['學習助手（assistant）', `${modeState(assistantOn, modeA)}（wrangler.toml 的 ${modeVarLabel('AI_ASSISTANT', assistantVar)}）`],
    ['學習助手拍照（assistantPhoto）', `${modeState(assistantPhotoOn, modeP)}（wrangler.toml 的 ${modeVarLabel('AI_ASSISTANT_PHOTO', assistantPhotoVar)}）`],
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
  if (f.ai && (assistantOn !== expAssistantOn || assistantPhotoOn !== expPhotoOn)) {
    warnings.push(
      `學習助手（assistant／assistantPhoto）是「${onOff(assistantOn)}／${onOff(assistantPhotoOn)}」，和 wrangler.toml 的 ${modeVarLabel('AI_ASSISTANT', assistantVar)}、${modeVarLabel('AI_ASSISTANT_PHOTO', assistantPhotoVar)} 對不起來：新版本可能還沒傳到所有節點，幾分鐘後再打開 ${input.workerUrl}/api/features 確認（只有 "on" 會出現在 /api/features）；確認之前不要解除全站暫停。`,
    );
  }
  const notices = [];
  if (f.ai && !customOn) {
    notices.push(
      'AI 批改已啟用，自訂題目批改（customEssay）未啟用：自訂作文題目評分對照（真模型）達標之前，這是預期的狀態。歷屆題與本站題照常，自訂題目的作答頁只能自我檢核。' +
        '要打開：在 Actions 跑「自訂作文題目評分對照（真模型）」，Summary 寫「達標」後，只把 apps/api/wrangler.toml 的 AI_CUSTOM_ESSAY 改成 "on"，用一個 PR 合併進 main（docs/SETUP-KEYS.md §8.2「打開自訂題目批改」）；' +
        '如果是出問題時刻意關掉的，照 §8.1「只關閉自訂題目批改」處理。',
    );
  }
  if (f.ai && (modeA === 'admin' || modeP === 'admin')) {
    notices.push(
      `學習助手是「${MODE_LABELS[modeA]}」、拍照是「${MODE_LABELS[modeP]}」：admin 模式只有管理員登入後看得到（/api/me 的 assistant_preview），/api/features 不會出現；學生暫時用不到，通常是緊急時只留給管理員查問題。` +
        `用 ADMIN_EMAIL 的帳號登入後打開 ${input.appUrl}/api/me，應該有 assistant_preview；查完要恢復對所有學生開放，照 docs/SETUP-KEYS.md §8.3 把 apps/api/wrangler.toml 的那一行改回 "on"；要完全關閉就改成 "off"。`,
    );
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
  const toml = readFileSync(env.WRANGLER_TOML || 'apps/api/wrangler.toml', 'utf8');
  const assistantVars = assistantVarsFrom(toml);
  const s = buildDeploySummary({
    features: JSON.parse(env.FEATURES || '{}'),
    secretNames: (env.SECRET_NAMES || '').split(/\s+/).filter(Boolean),
    proxy: env.PROXY || '',
    vercelTarget: env.VERCEL_TARGET || '',
    appUrl: env.APP_URL || '',
    workerUrl: env.WORKER_URL || '',
    workerName: env.WORKER_NAME || 'gsat-english-api',
    subdomain: env.SUBDOMAIN || '',
    customEssayVar: customEssayVarFrom(toml),
    assistantVar: assistantVars.assistant,
    assistantPhotoVar: assistantVars.photo,
  });
  for (const [k, v] of s.rows) console.log(`${k}：${v}`);
  for (const w of s.warnings) console.log(`::warning::${w}`);
  for (const n of s.notices) console.log(`::notice::${n}`);
  for (const [i, n] of s.next.entries()) console.log(`下一步 ${i + 1}：${n}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, s.markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
