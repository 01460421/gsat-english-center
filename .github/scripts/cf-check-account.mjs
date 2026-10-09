// worker-deploy.yml 的「檢查 Cloudflare 帳號與 workers.dev 子網域」。
//
// 正常情況：讀到帳號的 workers.dev 子網域，寫進 GITHUB_OUTPUT（subdomain=…）後結束。
// 讀不到時找出是哪一種設定錯誤，給站主一句能照做的說明，而不是籠統的「token 被拒絕」：
//   - secret 頭尾多了空白或換行（從網頁複製時常見）
//   - CLOUDFLARE_ACCOUNT_ID 的格式不對（應該是 32 個英數字）
//   - token 本身無效（貼錯東西、被刪除、過期、貼成 Global API Key）
//   - token 有效，但它能存取的帳號裡沒有 CLOUDFLARE_ACCOUNT_ID（Account ID 貼錯，或 token 的 Account Resources 選錯）
//   - token 與帳號都對，但缺少 Workers 權限
//   - 帳號還沒有 workers.dev 子網域
// token 只放在 Authorization 標頭裡，不印出來；帳號名稱常含 email，公開 repo 的 log 誰都看得到，所以也不印。
import { appendFileSync } from 'node:fs';

const API = process.env.CF_API || 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const workerName = process.env.WORKER_NAME || 'gsat-english-api';

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

/** 呼叫 Cloudflare API；網路錯誤或回應不是 JSON 時 body 為 null。 */
async function cf(path) {
  try {
    const res = await fetch(API + path, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // 不是 JSON（例如代理或 Cloudflare 的錯誤頁）
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const codesOf = (r) => (Array.isArray(r.body?.errors) ? r.body.errors.map((e) => e.code) : []);
const detailOf = (r) =>
  (Array.isArray(r.body?.errors) ? r.body.errors.map((e) => `[${e.code}] ${e.message}`).join('；') : '') ||
  (r.status === 0 ? `連不上 Cloudflare API（${r.error}）` : `HTTP ${r.status}，回應不是 Cloudflare API 的 JSON`);

// 1. 格式：頭尾空白、Account ID 的樣子。這些不必問 Cloudflare 就能確定。
if (token !== token.trim()) {
  fail('CLOUDFLARE_API_TOKEN 頭尾多了空白或換行（複製時多選到的）。請到 GitHub → Settings → Secrets and variables → Actions，按 CLOUDFLARE_API_TOKEN 旁的鉛筆重新貼上，只貼 token 本身。');
}
if (account !== account.trim()) {
  fail('CLOUDFLARE_ACCOUNT_ID 頭尾多了空白或換行（複製時多選到的）。請到 GitHub → Settings → Secrets and variables → Actions，重新貼上 CLOUDFLARE_ACCOUNT_ID。');
}
if (!/^[0-9a-f]{32}$/i.test(account)) {
  fail(
    `CLOUDFLARE_ACCOUNT_ID 的格式不對：應該是 32 個英數字（0–9、a–f），目前是 ${account.length} 個字元。` +
      '請到 Cloudflare 儀表板 → Workers & Pages → 概觀頁右側複製「Account ID」（不是 email、帳號名稱或 API token）。',
  );
}

// 2. 正常路徑：讀 workers.dev 子網域。
const sub = await cf(`/accounts/${account}/workers/subdomain`);
const subdomain = sub.body?.success ? sub.body.result?.subdomain : undefined;
if (subdomain) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `subdomain=${subdomain}\n`);
  console.log(`workers.dev 子網域：${subdomain}.workers.dev`);
  console.log(`Worker 網址會是：https://${workerName}.${subdomain}.workers.dev`);
  process.exit(0);
}
if (codesOf(sub).includes(10007)) {
  fail(
    '這個 Cloudflare 帳號還沒有 workers.dev 子網域。請到 Cloudflare 儀表板 → Workers & Pages，' +
      '第一次進入時會要求設定子網域（或在 Workers & Pages 概觀頁右側的「Subdomain」設定；直接網址 ' +
      'https://dash.cloudflare.com/?to=/:account/workers/onboarding ），設定一次後重跑這個 workflow。' +
      '子網域會出現在 Worker 網址裡，之後 vercel.json 的 rewrites 要指向它。',
  );
}
if (sub.status === 0 || sub.status >= 500) {
  fail(`讀不到帳號的 workers.dev 子網域設定：${detailOf(sub)}。多半是 Cloudflare 暫時出錯，請稍後重跑。`);
}

// 3. 讀不到子網域：先確認 token 本身有沒有效。
//    使用者 token 用 /user/tokens/verify；帳號 token（Account API Tokens）只能用 /accounts/:id/tokens/verify。
const userVerify = await cf('/user/tokens/verify');
let tokenStatus = userVerify.body?.success ? userVerify.body.result?.status : undefined;
if (tokenStatus !== 'active') {
  const accountVerify = await cf(`/accounts/${account}/tokens/verify`);
  if (accountVerify.body?.success) tokenStatus = accountVerify.body.result?.status;
}
if (tokenStatus === undefined) {
  const looksLikeGlobalKey = /^[0-9a-f]{37}$/i.test(token);
  fail(
    `CLOUDFLARE_API_TOKEN 不是有效的 API token（${detailOf(userVerify)}）。` +
      (looksLikeGlobalKey
        ? '這串看起來像 Global API Key，不能用在這裡；請到 My Profile → API Tokens 按「Create Token」建立 token。'
        : '請確認貼的是按下 Create Token 後只顯示一次的那串 token（不是 token 名稱、Global API Key 或測試用的 curl 指令）。' +
          '找不到原本那串的話，照 docs/SETUP-KEYS.md §1.4 重建一個，再更新 GitHub secret。'),
  );
}
if (tokenStatus !== 'active') {
  fail(`CLOUDFLARE_API_TOKEN 目前的狀態是「${tokenStatus}」（停用或過期）。請到 My Profile → API Tokens 重新啟用，或照 docs/SETUP-KEYS.md §1.4 重建一個。`);
}

// 4. token 有效：看它能存取哪些帳號（Edit Cloudflare Workers 範本內建 Account Settings: Read）。
const accounts = await cf('/accounts?per_page=50');
const ids = accounts.body?.success && Array.isArray(accounts.body.result) ? accounts.body.result.map((a) => String(a.id).toLowerCase()) : null;
if (ids && ids.length === 0) {
  fail('CLOUDFLARE_API_TOKEN 有效，但沒有任何帳號的存取權。請編輯 token，把 Account Resources 設成「Include → 你的帳號」。');
}
if (ids && !ids.includes(account.toLowerCase())) {
  fail(
    `CLOUDFLARE_API_TOKEN 有效，但它能存取的 ${ids.length} 個帳號裡沒有 CLOUDFLARE_ACCOUNT_ID 這個帳號。` +
      '多半是 Account ID 貼錯（例如貼成 Zone ID）：請到 Cloudflare 儀表板 → Workers & Pages → 概觀頁右側重新複製「Account ID」，更新 GitHub secret。' +
      'Account ID 沒錯的話，就是 token 的 Account Resources 選了別的帳號，請編輯 token 改成這個帳號。',
  );
}
if (ids) {
  fail(
    `CLOUDFLARE_API_TOKEN 有效、帳號也對，但讀不到 Workers 設定（${detailOf(sub)}），token 少了 Workers 權限。` +
      '請編輯 token，確認有 Account「Workers Scripts: Edit」（Edit Cloudflare Workers 範本內建），並加上「D1: Edit」與「Queues: Edit」。',
  );
}
fail(
  `CLOUDFLARE_API_TOKEN 有效，但讀不到 Workers 設定（${detailOf(sub)}）。可能是 CLOUDFLARE_ACCOUNT_ID 貼錯（請從 Workers & Pages 概觀頁右側重新複製「Account ID」），` +
    '或 token 少了 Workers 權限（請用「Edit Cloudflare Workers」範本，Account Resources 選這個帳號）。',
);
