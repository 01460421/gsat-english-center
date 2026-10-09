/**
 * 登入相關的測試小工具：已設定登入的 env、直接在假 D1 建使用者、簽 session cookie、帶 cookie 發請求。
 * A2 的測試也可以沿用（要讓 requireUser 通過，使用者必須有現行版本的 privacy＋terms 同意；
 * 要讓 requireAiApproved 通過，另外要 ai_status='approved' 與 ai_processing 同意——insertUser 的預設都幫你建好）。
 */
import { CONFIG_DEFAULTS } from '../../src/config';
import type { Env } from '../../src/env';
import { app } from '../../src/app';
import { encodeSessionCookie, SESSION_COOKIE } from '../../src/auth/session';
import { createTestD1, type TestD1 } from './d1';

export const ORIGIN = 'https://gsat.example';
export const SESSION_SECRET = 'test-session-secret-'.padEnd(48, 'x');
export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
export const ADMIN_EMAIL = 'owner@example.com';
export const VERSIONS = {
  privacy: CONFIG_DEFAULTS.PRIVACY_POLICY_VERSION,
  terms: CONFIG_DEFAULTS.TERMS_VERSION,
  ai: CONFIG_DEFAULTS.AI_CONSENT_VERSION,
} as const;

export type TestEnv = Env & { DB: TestD1 };

/** 已設定登入（Google、SESSION_SECRET、APP_ORIGIN、ADMIN_EMAIL、LEDGER_SALT）的 env，DB 是新的假 D1。 */
export function authEnv(overrides: Partial<Env> = {}): TestEnv {
  return {
    DB: createTestD1(),
    ALLOWED_ORIGINS: ORIGIN,
    APP_ORIGIN: ORIGIN,
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    SESSION_SECRET,
    ADMIN_EMAIL: 'Owner@Example.com ',
    LEDGER_SALT: 'test-ledger-salt',
    ...overrides,
  } as TestEnv;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export interface TestUser {
  id: number;
  publicId: string;
  sessionVer: number;
  email: string;
}

let seq = 0;

/**
 * 直接在資料庫建一位使用者。預設：學生、active、18plus、登入同意都是現行版本；
 * aiStatus 是 pending／waitlist／approved 時一併建 ai_processing 同意（未滿 18 歲加 guardian_ack），除非 aiConsent: false。
 */
export function insertUser(
  db: TestD1,
  options: {
    email?: string;
    role?: 'student' | 'admin';
    status?: 'active' | 'suspended';
    aiStatus?: 'none' | 'pending' | 'waitlist' | 'approved' | 'rejected' | 'suspended';
    ageBand?: 'under18' | '18plus' | null;
    loginConsents?: 'current' | 'none' | { privacy: string; terms: string };
    aiConsent?: boolean;
    displayName?: string | null;
    aiApplyCount?: number;
    aiAppliedAt?: number | null;
  } = {},
): TestUser {
  seq += 1;
  const email = options.email ?? `student${seq}@example.com`;
  const publicId = crypto.randomUUID();
  const r = db.sqlite
    .prepare(
      `INSERT INTO users (public_id, google_sub, email, display_name, role, status, age_band, ai_status, ai_apply_count, ai_applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      publicId,
      `sub-${seq}-${publicId}`,
      email,
      options.displayName === undefined ? `學生${seq}` : options.displayName,
      options.role ?? 'student',
      options.status ?? 'active',
      options.ageBand === undefined ? '18plus' : options.ageBand,
      options.aiStatus ?? 'none',
      options.aiApplyCount ?? 0,
      options.aiAppliedAt ?? null,
    );
  const id = Number(r.lastInsertRowid);
  const consent = db.sqlite.prepare('INSERT INTO consents (user_id, kind, version, granted) VALUES (?, ?, ?, 1)');
  const login = options.loginConsents ?? 'current';
  if (login !== 'none') {
    const v = login === 'current' ? VERSIONS : login;
    consent.run(id, 'privacy', v.privacy);
    consent.run(id, 'terms', v.terms);
  }
  const ai = options.aiStatus ?? 'none';
  if ((options.aiConsent ?? true) && ['pending', 'waitlist', 'approved'].includes(ai)) {
    consent.run(id, 'ai_processing', VERSIONS.ai);
    if (options.ageBand === 'under18') consent.run(id, 'guardian_ack', VERSIONS.ai);
  }
  return { id, publicId, sessionVer: 1, email };
}

/** 簽一個 session cookie，回傳可以直接放進 Cookie 標頭的字串。iat、e 可以指定（測近期登入與換新）。 */
export async function cookieFor(user: { id: number; sessionVer: number }, options: { iat?: number; e?: number; secret?: string } = {}): Promise<string> {
  const now = nowSec();
  const iat = options.iat ?? now;
  const value = await encodeSessionCookie(options.secret ?? SESSION_SECRET, {
    u: user.id,
    v: user.sessionVer,
    e: options.e ?? now + 30 * 86_400,
    iat,
  });
  return `${SESSION_COOKIE}=${value}`;
}

/** 發請求：自動補完整網址、非 GET 帶 Origin、JSON 本體自動序列化。 */
export function call(
  env: Env,
  method: string,
  path: string,
  options: { cookie?: string; json?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie) headers['Cookie'] = options.cookie;
  if (method !== 'GET' && method !== 'HEAD' && !('Origin' in headers)) headers['Origin'] = ORIGIN;
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  return Promise.resolve(app.request(`${ORIGIN}${path}`, { method, headers, body }, env));
}

/** 解析回應的 Set-Cookie，回傳 { 名稱: { value, attrs } }（同名多個時取最後一個，和瀏覽器相同）。 */
export function setCookies(res: Response): Record<string, { value: string; attrs: string[]; raw: string }> {
  const out: Record<string, { value: string; attrs: string[]; raw: string }> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair = '', ...attrs] = raw.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq)] = { value: decodeURIComponent(pair.slice(eq + 1)), attrs, raw };
  }
  return out;
}
