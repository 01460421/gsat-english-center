/**
 * /auth/*：Google OAuth 登入與登出（ARCHITECTURE §5、§10.2）。負責：後端登入 A1。
 *
 * 這些路徑在過渡期由 Vercel rewrites 的 /auth/:path* 轉給 Worker（根目錄 vercel.json），所以前端 SPA 路由
 * **不可以用 /auth 開頭**（帳號頁是 /account）。
 *
 *   GET  /auth/google/start?next=   種 __Host-gsat_oauth nonce、302 到 Google（scope openid email profile、prompt=select_account）
 *   GET  /auth/google/callback      驗 state 與 nonce、用授權碼換 id_token、驗信箱已驗證、以 sub 找或建帳號（ADMIN_EMAIL bootstrap）、
 *                                   種 session cookie，回嚴格 CSP 的 HTML 跳轉頁（APP_ORIGIN＋next）；
 *                                   失敗 302 回 APP_ORIGIN/account?auth_error=<AuthErrorCode>
 *   POST /auth/logout               清 cookie → 204（沒登入也回 204：登出是冪等的）
 *   POST /auth/logout-all           session_ver + 1（所有裝置立即失效）、清 cookie → 204（要登入）
 *   GET／POST /auth/probe           過渡期實測代理（多個 Set-Cookie、逾時、本體大小；src/auth/probe.ts，整合時加入）
 *
 * redirect_uri ＝ PUBLIC_API_ORIGIN＋/auth/google/callback；PUBLIC_API_ORIGIN 沒設時就是 APP_ORIGIN。
 * 不從請求網址推：過渡期瀏覽器經 Vercel 代理，Worker 看到的是 workers.dev 的網址（ARCHITECTURE §4.1）。
 * Google Console 要登記的就是這個網址（過渡期 https://gsat-english-center.vercel.app/auth/google/callback）。
 *
 * GET 不改伺服器狀態：start 只種 nonce cookie；callback 建帳號是登入本身（受 state＋nonce 保護）。
 */
import type { AuthErrorCode } from '@gsat/shared';
import { Hono, type Context } from 'hono';
import { upsertGoogleUser } from '../account/users';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { nowSeconds } from '../time';
import { randomToken } from './crypto';
import {
  CALLBACK_CSP,
  OAUTH_CALLBACK_PATH,
  OAuthFailure,
  buildGoogleAuthUrl,
  type GoogleIdentity,
  exchangeCodeForIdToken,
  parseIdToken,
  readNonces,
  redirectPageHtml,
  safePath,
  signState,
  verifyState,
  writeNonces,
} from './oauth';
import { probeRoutes } from './probe';
import { clearSessionCookie, getSessionUser, issueSessionCookie, requireUser } from './session';

export const authRoutes = new Hono<AppEnv>();

// 過渡期的代理探針（ARCHITECTURE §4.3）；正式期（PUBLIC_API_ORIGIN ≠ APP_ORIGIN）自動 404。
authRoutes.route('/probe', probeRoutes);

/** 失敗時跳回帳號頁並帶錯誤代碼（APP_ORIGIN 沒設時用相對路徑）。 */
function authFail(c: Context<AppEnv>, code: AuthErrorCode) {
  const origin = loadConfig(c.env).urls.appOrigin ?? '';
  return c.redirect(`${origin}/account?auth_error=${code}`, 302);
}

authRoutes.get('/google/start', async (c) => {
  const config = loadConfig(c.env);
  const { googleClientId, sessionSecret } = config.auth;
  const apiOrigin = config.urls.publicApiOrigin;
  if (!config.auth.configured || !googleClientId || !sessionSecret || !apiOrigin) return authFail(c, 'not_configured');

  const next = safePath(c.req.query('next'));
  const nonce = randomToken();
  const state = await signState(sessionSecret, nonce, next, nowSeconds());
  writeNonces(c, [...readNonces(c), nonce]);
  const url = buildGoogleAuthUrl({
    authUrl: config.auth.endpoints.googleAuthUrl,
    clientId: googleClientId,
    redirectUri: apiOrigin + OAUTH_CALLBACK_PATH,
    state,
    nonce,
  });
  return c.redirect(url, 302);
});

authRoutes.get('/google/callback', async (c) => {
  const config = loadConfig(c.env);
  const { googleClientId, googleClientSecret, sessionSecret } = config.auth;
  const appOrigin = config.urls.appOrigin;
  const apiOrigin = config.urls.publicApiOrigin;
  if (!config.auth.configured || !googleClientId || !googleClientSecret || !sessionSecret || !appOrigin || !apiOrigin) {
    return authFail(c, 'not_configured');
  }

  // 使用者在 Google 畫面按取消會回 error=access_denied；其他錯誤代碼一律當成 Google 端問題，不回顯原文。
  const error = c.req.query('error');
  if (error) return authFail(c, error === 'access_denied' ? 'denied' : 'google');

  const now = nowSeconds();
  const state = await verifyState(sessionSecret, c.req.query('state') ?? '', now);
  const nonces = readNonces(c);
  if (!state || !nonces.includes(state.nonce)) return authFail(c, 'state');
  // nonce 用一次就丟（重新整理回呼頁、重送同一個 code 都會失敗）。
  writeNonces(c, nonces.filter((n) => n !== state.nonce));

  const code = c.req.query('code');
  if (!code || code.length > 2048) return authFail(c, 'state');

  let identity: GoogleIdentity;
  try {
    const idToken = await exchangeCodeForIdToken({
      tokenUrl: config.auth.endpoints.googleTokenUrl,
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: apiOrigin + OAUTH_CALLBACK_PATH,
      code,
    });
    identity = parseIdToken(idToken, { clientId: googleClientId, nonce: state.nonce, now });
  } catch (err) {
    if (err instanceof OAuthFailure) {
      // 只記錯誤類別與我們自己的說明，不記 code、token、email。
      console.warn('Google 登入失敗', err.code, err.message);
      return authFail(c, err.code);
    }
    throw err;
  }

  const user = await upsertGoogleUser(c.env.DB, config, identity, now);
  // 刪除中的帳號在 MVP 不會留下來（DELETE /api/me 同步刪除）；萬一有，也不要發 session。
  if (user.status !== 'active') return authFail(c, 'suspended');

  await issueSessionCookie(c, { id: user.id, sessionVer: user.session_ver });
  c.header('Content-Security-Policy', CALLBACK_CSP);
  c.header('Referrer-Policy', 'no-referrer');
  return c.html(redirectPageHtml(appOrigin + state.next));
});

authRoutes.post('/logout', (c) => {
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.post('/logout-all', requireUser({ allowPendingConsent: true }), async (c) => {
  const user = await getSessionUser(c);
  if (user) await c.env.DB.prepare('UPDATE users SET session_ver = session_ver + 1 WHERE id = ?').bind(user.id).run();
  clearSessionCookie(c);
  return c.body(null, 204);
});
