/**
 * 登入流程（ARCHITECTURE §5）：OAuth 開始與回呼（假的 Google token 端點）、state／nonce、信箱未驗證、safePath、
 * cookie 旗標、竄改 cookie、session_ver 撤銷、自動換新、登出、ADMIN_EMAIL bootstrap、停權帳號登入。
 * Google 一律 mock：測試不打真的 API、不需要真金鑰。
 */
import { safePath } from '@gsat/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { base64UrlEncode, signToken } from '../src/auth/crypto';
import { decodeSessionCookie, OAUTH_COOKIE, SESSION_COOKIE } from '../src/auth/session';
import { parseIdToken } from '../src/auth/oauth';
import {
  ADMIN_EMAIL,
  CLIENT_ID,
  ORIGIN,
  SESSION_SECRET,
  authEnv,
  call,
  cookieFor,
  insertUser,
  nowSec,
  setCookies,
  type TestEnv,
} from './helpers/auth';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** 做一個 id_token（不驗簽，所以簽章部分隨便放）。 */
function idToken(claims: Record<string, unknown>): string {
  return `${base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64UrlEncode(JSON.stringify(claims))}.c2ln`;
}

interface GoogleMock {
  calls: Array<{ url: string; body: URLSearchParams }>;
}

/** 假的 Google token 端點：回傳 claims(nonce) 組成的 id_token（nonce 從 start 的轉址網址取得）。 */
function mockGoogle(claims: (nonce: string) => Record<string, unknown>, nonce: () => string, status = 200): GoogleMock {
  const mock: GoogleMock = { calls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      mock.calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
      if (url !== TOKEN_URL) return new Response('unexpected', { status: 500 });
      if (status !== 200) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status });
      return Response.json({ access_token: 'at', id_token: idToken(claims(nonce())), token_type: 'Bearer' });
    }),
  );
  return mock;
}

function googleClaims(overrides: Record<string, unknown> = {}) {
  return (nonce: string) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-123',
    email: 'Student@Example.com',
    email_verified: true,
    name: '王小明',
    nonce,
    exp: nowSec() + 3600,
    iat: nowSec(),
    ...overrides,
  });
}

/** 走一次 /auth/google/start，回傳 state、nonce 與 nonce cookie。 */
async function start(env: TestEnv, next = '/writing', cookie?: string) {
  const res = await call(env, 'GET', `/auth/google/start?next=${encodeURIComponent(next)}`, { cookie });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location') ?? '');
  const oauth = setCookies(res)[OAUTH_COOKIE];
  return {
    res,
    location,
    state: location.searchParams.get('state') ?? '',
    nonce: location.searchParams.get('nonce') ?? '',
    cookie: `${OAUTH_COOKIE}=${oauth?.value ?? ''}`,
    oauth,
  };
}

function callback(env: TestEnv, params: Record<string, string>, cookie?: string) {
  return call(env, 'GET', `/auth/google/callback?${new URLSearchParams(params).toString()}`, { cookie });
}

let env: TestEnv;
beforeEach(() => {
  env = authEnv();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safePath', () => {
  it('接受單一斜線開頭、白名單字元的站內路徑', () => {
    for (const p of ['/', '/writing', '/writing/essay?id=gsat-115.s7g1%401#top', '/account/welcome', '/a-b_c.d~e/f:g@h,i+j']) {
      expect(safePath(p), p).toBe(p);
    }
  });

  it('拒絕開放轉址、奇怪字元、太長的路徑與 /auth 開頭（回 fallback）', () => {
    const bad = [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'evil.example',
      '',
      '/a b',
      '/"onload',
      "/'x",
      '/<script>',
      '/a\\b',
      '/\u0000',
      '/中文',
      `/${'a'.repeat(600)}`,
      '/auth/google/start',
      '/AUTH/logout',
      '/auth',
      '/auth?x=1',
    ];
    for (const p of bad) expect(safePath(p), JSON.stringify(p)).toBe('/');
    expect(safePath(undefined)).toBe('/');
    expect(safePath(42)).toBe('/');
    expect(safePath('//x', '/account')).toBe('/account');
    // /authors 不是 /auth 底下的路徑
    expect(safePath('/authors')).toBe('/authors');
  });
});

describe('GET /auth/google/start', () => {
  it('302 到 Google：scope、prompt、redirect_uri ＝ APP_ORIGIN＋/auth/google/callback、state 與 nonce', async () => {
    const { location, state, nonce, oauth } = await start(env);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('prompt')).toBe('select_account');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);
    expect(state).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(nonce).toMatch(/^[\w-]{16,}$/);
    // nonce cookie：__Host- 前綴的旗標、10 分鐘
    expect(oauth?.value).toBe(nonce);
    expect(oauth?.attrs).toEqual(expect.arrayContaining(['Max-Age=600', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']));
    expect(oauth?.raw).not.toMatch(/Domain=/i);
  });

  it('PUBLIC_API_ORIGIN 有設時 redirect_uri 用它（買網域後）', async () => {
    env = authEnv({ PUBLIC_API_ORIGIN: 'https://api.gsat.example/' });
    const { location } = await start(env);
    expect(location.searchParams.get('redirect_uri')).toBe('https://api.gsat.example/auth/google/callback');
  });

  it('nonce cookie 最多保留 3 個（可以同時開多個分頁登入）', async () => {
    let cookie: string | undefined;
    const nonces: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await start(env, '/', cookie);
      nonces.push(r.nonce);
      cookie = r.cookie;
    }
    expect(cookie).toBe(`${OAUTH_COOKIE}=${nonces.slice(1).join('.')}`);
  });

  it('機密沒設定：跳回 /account?auth_error=not_configured', async () => {
    const res = await call(authEnv({ GOOGLE_CLIENT_SECRET: '' }), 'GET', '/auth/google/start');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=not_configured`);
  });
});

describe('GET /auth/google/callback', () => {
  it('成功：換 token、建帳號、種 session cookie、回嚴格 CSP 的跳轉頁（APP_ORIGIN＋next）', async () => {
    const s = await start(env, '/writing/essay?x=1');
    const google = mockGoogle(googleClaims(), () => s.nonce);
    const res = await callback(env, { code: 'auth-code', state: s.state }, s.cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain(`url=${ORIGIN}/writing/essay?x=1`);
    expect(html).not.toContain('<script');

    // token 交換的參數
    expect(google.calls).toHaveLength(1);
    const body = google.calls[0]!.body;
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);

    // session cookie 旗標與內容
    const cookies = setCookies(res);
    const sid = cookies[SESSION_COOKIE];
    expect(sid?.attrs).toEqual(expect.arrayContaining(['Max-Age=2592000', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']));
    expect(sid?.raw).not.toMatch(/Domain=/i);
    const payload = await decodeSessionCookie(sid?.value ?? '', SESSION_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.e - payload!.iat).toBe(30 * 86_400);
    // nonce 用掉就刪
    expect(cookies[OAUTH_COOKIE]?.attrs).toContain('Max-Age=0');

    // 帳號：以 sub 為鍵、email 小寫、暱稱預設取 Google 名稱、一般學生
    const row = env.DB.sqlite.prepare('SELECT * FROM users WHERE google_sub = ?').get('google-sub-123') as Record<string, unknown>;
    expect(row).toMatchObject({ email: 'student@example.com', display_name: '王小明', role: 'student', ai_status: 'none' });
    expect(payload!.u).toBe(row['id']);

    // 拿這個 cookie 讀 /api/me：首次登入要同意隱私權與條款
    const me = await call(env, 'GET', '/api/me', { cookie: `${SESSION_COOKIE}=${sid?.value}` });
    const meBody = (await me.json()) as { user: { id: string }; pending_consents: string[]; onboarded: boolean };
    expect(meBody.user.id).toBe(row['public_id']);
    expect(meBody.pending_consents).toEqual(['privacy', 'terms']);
    expect(meBody.onboarded).toBe(false);
  });

  it('同一個 Google 帳號再登入：同一列，只更新 email，不覆蓋暱稱', async () => {
    let s = await start(env);
    mockGoogle(googleClaims(), () => s.nonce);
    await callback(env, { code: 'c1', state: s.state }, s.cookie);
    env.DB.sqlite.prepare("UPDATE users SET display_name = '自己取的'").run();

    s = await start(env);
    mockGoogle(googleClaims({ email: 'new@example.com', name: 'Google 新名字' }), () => s.nonce);
    const res = await callback(env, { code: 'c2', state: s.state }, s.cookie);
    expect(res.status).toBe(200);
    const rows = env.DB.sqlite.prepare('SELECT email, display_name FROM users').all();
    expect(rows).toEqual([{ email: 'new@example.com', display_name: '自己取的' }]);
  });

  it('state 被竄改、過期，或瀏覽器沒有對應的 nonce：auth_error=state，不呼叫 Google', async () => {
    const s = await start(env);
    const google = mockGoogle(googleClaims(), () => s.nonce);
    const expectState = async (res: Response) => {
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=state`);
    };
    // 沒有 nonce cookie（例如攻擊者把自己的 code＋state 給受害者）
    await expectState(await callback(env, { code: 'c', state: s.state }));
    // nonce cookie 是別的值
    await expectState(await callback(env, { code: 'c', state: s.state }, `${OAUTH_COOKIE}=${'A'.repeat(22)}`));
    // state 簽章被改
    await expectState(await callback(env, { code: 'c', state: `${s.state.slice(0, -2)}xx` }, s.cookie));
    // 用別的機密簽的 state
    const forged = await signToken('other-secret'.padEnd(48, 'y'), 'oauth-state', { n: s.nonce, x: '/', t: nowSec() });
    await expectState(await callback(env, { code: 'c', state: forged }, s.cookie));
    // 過期（11 分鐘前簽的）
    const old = await signToken(SESSION_SECRET, 'oauth-state', { n: s.nonce, x: '/', t: nowSec() - 660 });
    await expectState(await callback(env, { code: 'c', state: old }, s.cookie));
    // session cookie 不能冒充 state（用途標籤不同）
    const sidAsState = (await cookieFor({ id: 1, sessionVer: 1 })).split('=')[1]!;
    await expectState(await callback(env, { code: 'c', state: sidAsState }, s.cookie));
    // 沒帶 state
    await expectState(await callback(env, { code: 'c' }, s.cookie));
    expect(google.calls).toHaveLength(0);
  });

  it('nonce 只能用一次：同一個 state 重送第二次失敗', async () => {
    const s = await start(env);
    mockGoogle(googleClaims(), () => s.nonce);
    const first = await callback(env, { code: 'c', state: s.state }, s.cookie);
    expect(first.status).toBe(200);
    const remaining = setCookies(first)[OAUTH_COOKIE]?.value ?? '';
    const second = await callback(env, { code: 'c', state: s.state }, `${OAUTH_COOKIE}=${remaining}`);
    expect(second.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=state`);
  });

  it('id_token 的 nonce 和 state 的不同：auth_error=google', async () => {
    const s = await start(env);
    mockGoogle(googleClaims(), () => 'B'.repeat(22));
    const res = await callback(env, { code: 'c', state: s.state }, s.cookie);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=google`);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('信箱未驗證：auth_error=unverified，不建帳號、不發 session', async () => {
    const s = await start(env);
    mockGoogle(googleClaims({ email_verified: false }), () => s.nonce);
    const res = await callback(env, { code: 'c', state: s.state }, s.cookie);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=unverified`);
    expect(setCookies(res)[SESSION_COOKIE]).toBeUndefined();
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('Google token 端點失敗、或 id_token 的 iss／aud／exp 不對：auth_error=google', async () => {
    let s = await start(env);
    mockGoogle(googleClaims(), () => s.nonce, 400);
    expect((await callback(env, { code: 'c', state: s.state }, s.cookie)).headers.get('location')).toBe(
      `${ORIGIN}/account?auth_error=google`,
    );
    for (const bad of [{ iss: 'https://evil.example' }, { aud: 'someone-else' }, { exp: nowSec() - 3600 }]) {
      s = await start(env);
      mockGoogle(googleClaims(bad), () => s.nonce);
      const res = await callback(env, { code: 'c', state: s.state }, s.cookie);
      expect(res.headers.get('location'), JSON.stringify(bad)).toBe(`${ORIGIN}/account?auth_error=google`);
    }
  });

  it('使用者在 Google 按取消：auth_error=denied', async () => {
    const res = await callback(env, { error: 'access_denied', state: 'x' });
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=denied`);
  });

  it('停權的帳號：auth_error=suspended，不發 session', async () => {
    const s = await start(env);
    mockGoogle(googleClaims(), () => s.nonce);
    env.DB.sqlite
      .prepare("INSERT INTO users (public_id, google_sub, email, status) VALUES (?, 'google-sub-123', 'student@example.com', 'suspended')")
      .run(crypto.randomUUID());
    const res = await callback(env, { code: 'c', state: s.state }, s.cookie);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account?auth_error=suspended`);
    expect(setCookies(res)[SESSION_COOKIE]).toBeUndefined();
  });

  it('回跳路徑在 state 裡；start 的 next 不合格時回到 /', async () => {
    const s = await start(env, '//evil.example/steal');
    mockGoogle(googleClaims(), () => s.nonce);
    const html = await (await callback(env, { code: 'c', state: s.state }, s.cookie)).text();
    expect(html).toContain(`url=${ORIGIN}/"`);
    expect(html).not.toContain('evil.example');
  });
});

describe('ADMIN_EMAIL bootstrap', () => {
  async function login(sub: string, email: string) {
    const s = await start(env);
    mockGoogle(googleClaims({ sub, email }), () => s.nonce);
    const res = await callback(env, { code: 'c', state: s.state }, s.cookie);
    expect(res.status).toBe(200);
    return env.DB.sqlite.prepare('SELECT role, ai_status, ai_tier FROM users WHERE google_sub = ?').get(sub);
  }

  it('ADMIN_EMAIL（不分大小寫）第一次登入：admin＋核准 AI＋unlimited，寫 admin_audit', async () => {
    expect(await login('owner-sub', ADMIN_EMAIL.toUpperCase())).toEqual({ role: 'admin', ai_status: 'approved', ai_tier: 'unlimited' });
    const audit = env.DB.sqlite.prepare('SELECT actor_kind, action FROM admin_audit').all();
    expect(audit).toEqual([{ actor_kind: 'system', action: 'user.bootstrap_admin' }]);
  });

  it('已經有管理員之後，別的 Google 帳號用同一個信箱也不會變成管理員（以 sub 為準）', async () => {
    await login('owner-sub', ADMIN_EMAIL);
    expect(await login('other-sub', ADMIN_EMAIL)).toEqual({ role: 'student', ai_status: 'none', ai_tier: 'standard' });
  });

  it('一般信箱不會變成管理員；沒設 ADMIN_EMAIL 時沒有人會', async () => {
    expect(await login('s1', 'student@example.com')).toMatchObject({ role: 'student' });
    env = authEnv({ ADMIN_EMAIL: undefined });
    expect(await login('s2', ADMIN_EMAIL)).toMatchObject({ role: 'student' });
  });
});

describe('session cookie', () => {
  it('有效的 cookie：/api/me 回登入者；不需要換新時不發新 cookie', async () => {
    const u = insertUser(env.DB);
    const res = await call(env, 'GET', '/api/me', { cookie: await cookieFor(u) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(u.publicId);
    expect(setCookies(res)[SESSION_COOKIE]).toBeUndefined();
  });

  it('竄改過的 cookie（改內容、改簽章、別的機密）：當成未登入並清掉 cookie', async () => {
    const u = insertUser(env.DB);
    const good = (await cookieFor(u)).split('=')[1]!;
    const [body, sig] = good.split('.') as [string, string];
    const otherUserBody = base64UrlEncode(JSON.stringify({ u: u.id + 1, v: 1, e: nowSec() + 86_400, iat: nowSec() }));
    const variants = [
      `${otherUserBody}.${sig}`,
      `${body}.${sig.slice(0, -2)}AA`,
      `${body}`,
      'garbage',
      (await cookieFor(u, { secret: 'another-secret'.padEnd(48, 'z') })).split('=')[1]!,
    ];
    for (const v of variants) {
      const res = await call(env, 'GET', '/api/me', { cookie: `${SESSION_COOKIE}=${v}` });
      expect(await res.json(), v).toEqual({ user: null });
      expect(setCookies(res)[SESSION_COOKIE]?.attrs).toContain('Max-Age=0');
    }
  });

  it('過期的 cookie：未登入', async () => {
    const u = insertUser(env.DB);
    const res = await call(env, 'GET', '/api/me', { cookie: await cookieFor(u, { iat: nowSec() - 40 * 86_400, e: nowSec() - 10 }) });
    expect(await res.json()).toEqual({ user: null });
  });

  it('session_ver 不符（登出所有裝置、停權之後）：舊 cookie 失效', async () => {
    const u = insertUser(env.DB);
    env.DB.sqlite.prepare('UPDATE users SET session_ver = 2 WHERE id = ?').run(u.id);
    const res = await call(env, 'GET', '/api/me', { cookie: await cookieFor(u) });
    expect(await res.json()).toEqual({ user: null });
  });

  it('使用者不存在（帳號已刪）：未登入', async () => {
    const res = await call(env, 'GET', '/api/me', { cookie: await cookieFor({ id: 999, sessionVer: 1 }) });
    expect(await res.json()).toEqual({ user: null });
  });

  it('剩不到 7 天：自動換新（新的到期日、沿用原本的 iat）', async () => {
    const u = insertUser(env.DB);
    const iat = nowSec() - 25 * 86_400;
    const res = await call(env, 'GET', '/api/me', { cookie: await cookieFor(u, { iat, e: nowSec() + 5 * 86_400 }) });
    expect(res.status).toBe(200);
    const sid = setCookies(res)[SESSION_COOKIE];
    expect(sid?.attrs).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']));
    const payload = await decodeSessionCookie(sid?.value ?? '', SESSION_SECRET);
    expect(payload?.iat).toBe(iat);
    expect(payload!.e).toBeGreaterThanOrEqual(nowSec() + 30 * 86_400 - 5);
    // 換新不會讓「近期登入」變新：login_at 仍是原本的 iat
    expect(((await res.json()) as { login_at: number }).login_at).toBe(iat);
  });

  it('SESSION_SECRET 沒設定：一律未登入', async () => {
    const u = insertUser(env.DB);
    const res = await call(authEnv({ SESSION_SECRET: undefined, DB: env.DB }), 'GET', '/api/me', { cookie: await cookieFor(u) });
    expect(await res.json()).toEqual({ user: null });
  });

  it('每天第一次請求寫 last_active_day', async () => {
    const u = insertUser(env.DB);
    await call(env, 'GET', '/api/me', { cookie: await cookieFor(u) });
    const row = env.DB.sqlite.prepare('SELECT last_active_day FROM users WHERE id = ?').get(u.id) as { last_active_day: string };
    expect(row.last_active_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('登出', () => {
  it('POST /auth/logout：204、清 cookie（沒登入也一樣）', async () => {
    const u = insertUser(env.DB);
    const res = await call(env, 'POST', '/auth/logout', { cookie: await cookieFor(u) });
    expect(res.status).toBe(204);
    expect(setCookies(res)[SESSION_COOKIE]?.attrs).toContain('Max-Age=0');
    expect((await call(env, 'POST', '/auth/logout')).status).toBe(204);
  });

  it('POST /auth/logout 沒有 Origin：403 bad_origin（originGuard）', async () => {
    const res = await call(env, 'POST', '/auth/logout', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('POST /auth/logout-all：session_ver+1，所有舊 cookie 失效；沒登入 401', async () => {
    const u = insertUser(env.DB);
    const phone = await cookieFor(u);
    const laptop = await cookieFor(u, { iat: nowSec() - 60 });
    const res = await call(env, 'POST', '/auth/logout-all', { cookie: laptop });
    expect(res.status).toBe(204);
    expect(env.DB.sqlite.prepare('SELECT session_ver FROM users WHERE id = ?').get(u.id)).toEqual({ session_ver: 2 });
    expect(await (await call(env, 'GET', '/api/me', { cookie: phone })).json()).toEqual({ user: null });
    expect((await call(env, 'POST', '/auth/logout-all')).status).toBe(401);
  });
});

describe('parseIdToken', () => {
  const base = { clientId: CLIENT_ID, nonce: 'N'.repeat(22), now: nowSec() };
  it('中文名字用 UTF-8 解碼；aud 是陣列時要有 azp', () => {
    const claims = googleClaims({ aud: [CLIENT_ID, 'x'], azp: CLIENT_ID })(base.nonce);
    expect(parseIdToken(idToken(claims), base)).toEqual({ sub: 'google-sub-123', email: 'student@example.com', name: '王小明' });
    expect(() => parseIdToken(idToken({ ...claims, azp: 'x' }), base)).toThrow();
  });

  it('email_verified 可以是字串 "true"；格式壞掉的 token 丟錯', () => {
    const claims = googleClaims({ email_verified: 'true' })(base.nonce);
    expect(parseIdToken(idToken(claims), base).sub).toBe('google-sub-123');
    expect(() => parseIdToken('not-a-jwt', base)).toThrow();
    expect(() => parseIdToken('a.b.c', base)).toThrow();
  });
});
