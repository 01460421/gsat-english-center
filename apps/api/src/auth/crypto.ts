/**
 * 登入用的密碼學小工具：base64url、HMAC-SHA256 簽章與驗證、隨機值、HMAC 假名。負責：後端登入 A1。
 *
 * 只用 Web Crypto（crypto.subtle）：Workers 與 Node 都內建，不需要 nodejs_compat。
 *
 * 簽章格式 `base64url(JSON) + "." + base64url(HMAC-SHA256(secret, purpose + "." + base64url(JSON)))`：
 * 簽的內容前面加上用途（'sid'＝session cookie、'oauth-state'＝OAuth state），同一把 SESSION_SECRET 簽出來的
 * state 不能拿來當 session cookie 用，反之亦然（不同用途的權杖不可互換）。
 * 驗證用 crypto.subtle.verify，比對時間固定，不會因為「前幾個位元組對了」而洩漏資訊。
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** 位元組 → base64url（無補位）。 */
export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → 位元組；格式不對回 null（不丟錯，呼叫端一律當成「無效」）。 */
export function base64UrlDecode(input: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input) || input.length % 4 === 1) return null;
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * base64url → UTF-8 字串。id_token 的 payload 一定要用 UTF-8 解碼：atob 只會給 Latin-1，
 * 中文名字會變亂碼（Sekai worker/src/auth.js:16-24 踩過的雷）。
 */
export function base64UrlDecodeText(input: string): string | null {
  const bytes = base64UrlDecode(input);
  if (!bytes) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** HMAC 金鑰快取：同一個 isolate 內同一把機密只匯入一次（importKey 不便宜，每個請求都會用到）。 */
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, key);
  }
  return key;
}

/** HMAC-SHA256 原始位元組。 */
export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return new Uint8Array(sig);
}

/** 用途標籤（簽在內容前面，見檔頭）。 */
export type TokenPurpose = 'sid' | 'oauth-state';

/** 簽一個 JSON 權杖。 */
export async function signToken(secret: string, purpose: TokenPurpose, payload: object): Promise<string> {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256(secret, `${purpose}.${body}`);
  return `${body}.${base64UrlEncode(sig)}`;
}

/** 驗證權杖並回傳解析後的 JSON；簽章不符、格式不對一律回 null。內容欄位由呼叫端再檢查。 */
export async function verifyToken(secret: string, purpose: TokenPurpose, token: string): Promise<unknown> {
  if (token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = base64UrlDecode(token.slice(dot + 1));
  if (!sig || sig.length !== 32) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, encoder.encode(`${purpose}.${body}`));
  if (!ok) return null;
  const text = base64UrlDecodeText(body);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 隨機值（base64url）。預設 16 bytes＝128 位元，當 nonce 足夠。 */
export function randomToken(bytes = 16): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * 使用者的 HMAC 假名（deletion_log.user_ref、日誌）：hex(HMAC-SHA256(LEDGER_SALT, String(users.id)))。
 * 帳號刪除後無法從假名回推是誰（DB_SCHEMA §3.8）。ai_calls.user_ref 也應該用這支函式，兩邊才對得起來。
 */
export async function userRef(salt: string, userId: number): Promise<string> {
  const sig = await hmacSha256(salt, String(userId));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}
