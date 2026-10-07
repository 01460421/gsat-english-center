/**
 * CORS 與 Origin 檢查。沿用 Sekai Center worker/src/cors.js 與 api.js 的做法
 * （docs/research/05-sekai-center-patterns.md §2.5），改寫成 Hono 中介層：
 *
 * 1. CORS 只放行 ALLOWED_ORIGINS 裡的 origin，並帶 credentials（之後 session 用 cookie）。
 *    帶 credentials 時瀏覽器拒絕 `*`，所以一定回「具體的」Allow-Origin；不允許的 origin 連標頭都不發，
 *    由瀏覽器自己擋。回應帶 Vary: Origin，避免 CDN 把 A 站的標頭快取給 B 站。
 * 2. 會改變狀態的請求（GET／HEAD／OPTIONS 以外）一律要求 Origin 是允許清單裡的站或 Worker 自己。
 *    CORS 只管「瀏覽器能不能讀回應」，管不到「請求有沒有送到」；SameSite=Lax 也擋不住同站子網域
 *    發出的 POST（主網域與 api. 子網域是同站）。沒有 Origin 的（非瀏覽器）也拒絕。
 *    之後若有機器對機器的端點（例如 GitHub Actions 呼叫的管理 API），改用獨立的權杖驗證並在這裡排除。
 */
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './env';
import { errorResponse } from './errors';

/** 解析 ALLOWED_ORIGINS：去空白、去結尾斜線、略過空項目。 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0);
}

/** origin 是否在允許清單裡（完全比對，不做萬用字元，避免 evil-example.com 這類比對漏洞）。 */
export function isAllowedOrigin(origin: string | undefined | null, env: Pick<Env, 'ALLOWED_ORIGINS'>): boolean {
  if (!origin) return false;
  return parseAllowedOrigins(env.ALLOWED_ORIGINS).includes(origin);
}

/** CORS 中介層：只允許 ALLOWED_ORIGINS，帶 credentials；preflight 快取一天以減少往返。 */
export const corsMiddleware: MiddlewareHandler<AppEnv> = cors({
  origin: (origin, c) => (isAllowedOrigin(origin, c.env) ? origin : null),
  credentials: true,
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 非 GET 請求的 Origin 檢查（理由見檔頭第 2 點）。 */
export const originGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next();
  const origin = c.req.header('Origin');
  const self = new URL(c.req.url).origin;
  if (!origin || (origin !== self && !isAllowedOrigin(origin, c.env))) {
    return errorResponse(c, 403, 'bad_origin', '請求來源不被允許');
  }
  return next();
};

/**
 * API 回應一律不快取：之後回應會帶個人資料（作答紀錄、session），不能被瀏覽器或中間層快取；
 * nosniff 讓瀏覽器不要把 JSON 猜成其他型別執行。
 */
export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
};
