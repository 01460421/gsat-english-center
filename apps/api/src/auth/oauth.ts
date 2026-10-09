/**
 * Google OAuth（授權碼流程）的零件：回跳路徑檢查、state 簽章、nonce cookie、授權網址、token 交換與 id_token 檢查。
 * 負責：後端登入 A1。路由本身在 src/auth/routes.ts。
 *
 * 登入 CSRF（ARCHITECTURE §5「登入 CSRF」）：
 *   /auth/google/start 產生 nonce，簽進 state（連同 next 與時間），同一個 nonce 存進 `__Host-gsat_oauth` cookie
 *   （Path=/、10 分鐘、最多 3 個，可以同時開多個分頁登入）；回呼時 state 的簽章要對、沒過期，而且裡面的 nonce
 *   必須在這個瀏覽器的 cookie 裡。攻擊者拿自己的 code＋state 騙受害者打開回呼網址時，受害者的瀏覽器沒有那個 nonce。
 *   同一個 nonce 也放進 Google 的 `nonce` 參數，回來的 id_token 必須帶同一個值（OIDC Core 3.1.3.7 第 11 點）。
 *
 * id_token 不驗簽：它是 Worker 自己用 client secret 經 TLS 直連 Google token 端點換來的，不是瀏覽器轉交的
 * （OIDC Core 3.1.3.7 第 6 點允許）。仍然檢查 iss、aud、exp、email_verified 與 nonce。
 *
 * 供應商的錯誤只對應到 AuthErrorCode、顯示自己的文案；回應內容與例外細節不回顯（Sekai auth.js:240-242）。
 */
import { safePath, type AuthErrorCode } from '@gsat/shared';
import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { base64UrlDecodeText, signToken, verifyToken } from './crypto';
import { OAUTH_COOKIE } from './session';

export { safePath };

/** 回呼路徑；redirect_uri ＝ PUBLIC_API_ORIGIN（沒設＝APP_ORIGIN）＋這個路徑。 */
export const OAUTH_CALLBACK_PATH = '/auth/google/callback';
/** state 與 nonce cookie 的有效秒數（10 分鐘）。 */
export const OAUTH_STATE_TTL_SECONDS = 600;
/** nonce cookie 最多保留幾個（同時開幾個分頁登入）。 */
export const OAUTH_MAX_NONCES = 3;
export const GOOGLE_SCOPE = 'openid email profile';
/** Google id_token 的 iss 可能是這兩種寫法（Google 文件明列）。 */
export const GOOGLE_ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com'];
/** 呼叫 Google token 端點的逾時（毫秒）。 */
const GOOGLE_TIMEOUT_MS = 10_000;

const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** 回呼失敗：帶著要給前端的 AuthErrorCode。 */
export class OAuthFailure extends Error {
  constructor(readonly code: AuthErrorCode, message: string) {
    super(message);
  }
}

// ───────────────────────── state ─────────────────────────

/** 簽 state：{n: nonce, x: next, t: 簽發時間}。 */
export function signState(secret: string, nonce: string, next: string, now: number): Promise<string> {
  return signToken(secret, 'oauth-state', { n: nonce, x: next, t: now });
}

/** 驗 state：簽章、10 分鐘內、nonce 與 next 格式。next 再過一次 safePath（縱深防禦）。 */
export async function verifyState(secret: string, token: string, now: number): Promise<{ nonce: string; next: string } | null> {
  if (!token) return null;
  const data = await verifyToken(secret, 'oauth-state', token);
  if (typeof data !== 'object' || data === null) return null;
  const { n, x, t } = data as Record<string, unknown>;
  if (typeof n !== 'string' || !NONCE_RE.test(n) || typeof x !== 'string' || typeof t !== 'number') return null;
  if (t > now + 60 || now - t > OAUTH_STATE_TTL_SECONDS) return null;
  return { nonce: n, next: safePath(x) };
}

// ───────────────────────── nonce cookie ─────────────────────────

/** 讀 nonce cookie：以 `.` 分隔，只留格式正確的，最多 OAUTH_MAX_NONCES 個。 */
export function readNonces(c: Context<AppEnv>): string[] {
  const raw = getCookie(c, OAUTH_COOKIE);
  if (!raw) return [];
  return raw
    .split('.')
    .filter((n) => NONCE_RE.test(n))
    .slice(-OAUTH_MAX_NONCES);
}

/** 寫 nonce cookie；清單為空就刪除。 */
export function writeNonces(c: Context<AppEnv>, nonces: readonly string[]): void {
  const list = nonces.slice(-OAUTH_MAX_NONCES);
  setCookie(c, OAUTH_COOKIE, list.join('.'), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: list.length > 0 ? OAUTH_STATE_TTL_SECONDS : 0,
  });
}

// ───────────────────────── Google ─────────────────────────

/** Google 授權網址（scope openid email profile、prompt=select_account：學生常同時有學校與個人帳號）。 */
export function buildGoogleAuthUrl(params: {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL(params.authUrl);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPE);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** 用授權碼向 Google token 端點換 id_token。失敗丟 OAuthFailure('google')；不回顯 Google 的回應內容。 */
export async function exchangeCodeForIdToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<string> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });
  let res: Response;
  try {
    res = await fetch(params.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OAuthFailure('google', `連線 Google token 端點失敗：${err instanceof Error ? err.name : 'unknown'}`);
  }
  if (!res.ok) throw new OAuthFailure('google', `Google token 端點回 ${res.status}`);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new OAuthFailure('google', 'Google token 端點的回應不是 JSON');
  }
  const idToken = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)['id_token'] : undefined;
  if (typeof idToken !== 'string' || idToken.length === 0) throw new OAuthFailure('google', 'Google 回應沒有 id_token');
  return idToken;
}

/** id_token 裡我們用到的身分資料。 */
export interface GoogleIdentity {
  /** 帳號鍵（不用 email：email 可能改，sub 不會）。 */
  sub: string;
  /** 小寫。 */
  email: string;
  /** Google 名稱（未清理；呼叫端清理後才當預設暱稱）。 */
  name: string | null;
}

/**
 * 解析並檢查 id_token 的 claims：iss、aud＝GOOGLE_CLIENT_ID、exp、nonce、email_verified。
 * 信箱未驗證丟 OAuthFailure('unverified')，其他不合格丟 OAuthFailure('google')。
 */
export function parseIdToken(idToken: string, expected: { clientId: string; nonce: string; now: number }): GoogleIdentity {
  const parts = idToken.split('.');
  const json = parts.length === 3 && parts[1] ? base64UrlDecodeText(parts[1]) : null;
  let claims: Record<string, unknown>;
  try {
    const parsed: unknown = json === null ? null : JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    claims = parsed as Record<string, unknown>;
  } catch {
    throw new OAuthFailure('google', 'id_token 格式不正確');
  }

  const { iss, aud, azp, exp, nonce, sub, email, email_verified: emailVerified, name } = claims;
  if (typeof iss !== 'string' || !GOOGLE_ISSUERS.includes(iss)) throw new OAuthFailure('google', 'id_token 的 iss 不是 Google');
  const audOk = Array.isArray(aud) ? aud.includes(expected.clientId) && azp === expected.clientId : aud === expected.clientId;
  if (!audOk) throw new OAuthFailure('google', 'id_token 的 aud 不是本站的 client id');
  // 容許 60 秒時鐘誤差。
  if (typeof exp !== 'number' || exp + 60 < expected.now) throw new OAuthFailure('google', 'id_token 已過期');
  if (nonce !== expected.nonce) throw new OAuthFailure('google', 'id_token 的 nonce 不符');
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) throw new OAuthFailure('google', 'id_token 沒有 sub');
  if (typeof email !== 'string' || !email.includes('@') || email.length > 320) throw new OAuthFailure('google', 'id_token 沒有 email');
  if (emailVerified !== true && emailVerified !== 'true') throw new OAuthFailure('unverified', 'Google 信箱尚未驗證');
  return { sub, email: email.trim().toLowerCase(), name: typeof name === 'string' ? name : null };
}

// ───────────────────────── 回呼頁 ─────────────────────────

/** HTML 跳脫（回呼頁的所有插值都經過這裡）。 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/**
 * 回呼頁的 CSP：什麼都不載入（default-src 'none'）。跳轉用 meta refresh，不需要任何腳本；
 * 用 HTML 頁而不是 302，是為了在同一個回應裡種 cookie（Sekai auth.js:163-209；ARCHITECTURE §5「回跳」）。
 */
export const CALLBACK_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** 登入成功後的跳轉頁。target 必須是 APP_ORIGIN＋safePath 組成的絕對網址。 */
export function redirectPageHtml(target: string): string {
  const href = escapeHtml(target);
  return (
    '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<meta name="referrer" content="no-referrer">' +
    `<meta http-equiv="refresh" content="0;url=${href}">` +
    '<title>登入成功</title></head><body>' +
    `<p>登入成功，正在回到網站…</p><p><a href="${href}">如果沒有自動跳轉，請點這裡</a></p>` +
    '</body></html>'
  );
}
