/**
 * Hono 應用程式本體（路由與中介層）。
 *
 * 為什麼和 index.ts 分開：Workers 會把主模組（wrangler.toml 的 main）的每一個具名匯出都當成入口點，
 * 匯出字串常數之類的值會讓 workerd 啟動失敗（"Incorrect type for map entry"）。
 * 所以 index.ts 只放 default export，測試與其他模組從這裡匯入。
 *
 * 路由規劃（docs/research/05-sekai-center-patterns.md §1.2）：
 *   /api/*     使用者 API：作答紀錄、單字複習排程、題庫查詢、設定同步
 *   /api/ai/*  任務型 AI 端點（Claude API）：提示詞與評分基準都寫在伺服器端，前端只送作答內容
 *   /auth/*    Google OAuth 與 session cookie
 *   /admin/*   後台
 * 目前只有健康檢查；其他路由會隨各功能模組加入。
 *
 * 中介層順序有意義：
 *   noStore → cors → originGuard → 路由
 *   cors 放在 originGuard 前面，讓「允許的來源」收到的錯誤回應也帶 CORS 標頭，前端才讀得到錯誤內容。
 */
import type { HealthResponse } from '@gsat/shared';
import { Hono } from 'hono';
import pkg from '../package.json';
import type { AppEnv } from './env';
import { handleError, handleNotFound } from './errors';
import { corsMiddleware, noStore, originGuard } from './security';

/** 與 wrangler.toml 的 name 相同。 */
export const SERVICE_NAME = 'gsat-english-api';

export const app = new Hono<AppEnv>();

app.use('*', noStore);
app.use('*', corsMiddleware);
app.use('*', originGuard);

app.get('/api/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    service: SERVICE_NAME,
    version: pkg.version,
    time: new Date().toISOString(),
  };
  return c.json(body);
});

app.notFound(handleNotFound);
app.onError(handleError);
