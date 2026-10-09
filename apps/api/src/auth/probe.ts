/**
 * GET／POST /auth/probe：過渡期（瀏覽器經 Vercel rewrites 代理到 workers.dev）實測代理行為的探針
 * （ARCHITECTURE §4.3、§10.2）。負責：整合者（docs/design/ai-auth-mvp.md §10「整合」）。
 *
 * 只在「過渡期」開啟：PUBLIC_API_ORIGIN（沒設＝APP_ORIGIN）等於 APP_ORIGIN，也就是瀏覽器和 API 同源、走代理的時候。
 * 換成自訂網域後 PUBLIC_API_ORIGIN 是 api.<網域>，這支自動回 404（§10.2「正式期關閉」），不需要另外的開關。
 *
 *   GET  /auth/probe            讀回兩個測試 cookie → { probe: true, cookies: { a, b } }
 *   GET  /auth/probe?set=1      種兩個測試 cookie（__Host-、HttpOnly、Secure、SameSite=Lax，10 分鐘）；
 *                               下一個請求兩個都讀得回來＝代理把多個 Set-Cookie 原樣轉送（§4.3 第 1 點）
 *   GET  /auth/probe?clear=1    清掉兩個測試 cookie
 *   GET  /auth/probe?delay=N    等 N 秒（1–60）才回，量代理的逾時上限（§4.3 第 2 點）
 *   POST /auth/probe            讀完請求本體、只回位元組數（不保存），量代理的本體上限（§4.3 第 3 點；照片一張 ≤1.2 MB）；
 *                               和其他寫入一樣要通過 Origin 檢查，本體最多 3 MB
 * §4.3 第 4 點（代理會不會快取）不另外測：vercel.json 已對 /api、/auth 關閉 rewrite caching，Worker 也一律回 no-store。
 *
 * 不碰資料庫、不讀 session、不記任何請求內容；測試 cookie 的值是固定字串，不帶任何資訊。
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { loadConfig } from '../config';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

/** 兩個測試 cookie 的名稱與固定值。 */
export const PROBE_COOKIES = [
  { name: '__Host-gsat_probe_a', value: 'probe-a' },
  { name: '__Host-gsat_probe_b', value: 'probe-b' },
] as const;
export const PROBE_COOKIE_SECONDS = 600;
export const PROBE_MAX_DELAY_SECONDS = 60;
export const PROBE_MAX_BODY_BYTES = 3 * 1024 * 1024;

const PROBE_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

/** 過渡期（同源代理）才開啟。 */
export function probeEnabled(env: Env): boolean {
  const { appOrigin, publicApiOrigin } = loadConfig(env).urls;
  return appOrigin !== null && publicApiOrigin === appOrigin;
}

export const probeRoutes = new Hono<AppEnv>();

probeRoutes.use('*', async (c, next) => {
  if (!probeEnabled(c.env)) throw new ApiError(404, 'not_found', `找不到 ${c.req.method} ${c.req.path}`);
  await next();
});

function setProbeCookies(c: Context<AppEnv>, maxAge: number): void {
  for (const { name, value } of PROBE_COOKIES) setCookie(c, name, maxAge > 0 ? value : '', { ...PROBE_COOKIE_OPTIONS, maxAge });
}

probeRoutes.get('/', async (c) => {
  const delay = c.req.query('delay');
  if (delay !== undefined) {
    const seconds = Number(delay);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > PROBE_MAX_DELAY_SECONDS) {
      throw new ApiError(400, 'bad_request', `delay 必須是 1–${PROBE_MAX_DELAY_SECONDS} 的整數（秒）`);
    }
    // 等待不算 CPU 時間（Workers 只計 CPU）；代理若先逾時，瀏覽器會看到代理自己的錯誤頁。
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return c.json({ probe: true, delayed_seconds: seconds });
  }
  if (c.req.query('set') === '1') {
    setProbeCookies(c, PROBE_COOKIE_SECONDS);
    return c.json({ probe: true, set: PROBE_COOKIES.map((x) => x.name) });
  }
  if (c.req.query('clear') === '1') {
    setProbeCookies(c, 0);
    return c.json({ probe: true, cleared: PROBE_COOKIES.map((x) => x.name) });
  }
  const [a, b] = PROBE_COOKIES.map(({ name, value }) => getCookie(c, name) === value);
  return c.json({ probe: true, cookies: { a, b } });
});

probeRoutes.post('/', async (c) => {
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (declared > PROBE_MAX_BODY_BYTES) throw new ApiError(413, 'payload_too_large', `探針本體最多 ${PROBE_MAX_BODY_BYTES} 位元組`);
  // 邊讀邊數，不整個放進記憶體；超過上限就停。
  let bytes = 0;
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > PROBE_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'payload_too_large', `探針本體最多 ${PROBE_MAX_BODY_BYTES} 位元組`);
      }
    }
  }
  return c.json({ probe: true, bytes });
});
