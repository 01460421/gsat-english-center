/**
 * Hono 應用程式本體（路由與中介層）。
 *
 * 為什麼和 index.ts 分開：Workers 會把主模組（wrangler.toml 的 main）的每一個具名匯出都當成入口點，
 * 匯出字串常數之類的值會讓 workerd 啟動失敗（"Incorrect type for map entry"）。
 * 所以 index.ts 只放 default export，測試與其他模組從這裡匯入。
 *
 * 路由規劃（ARCHITECTURE §10；各檔案的負責 agent 見 docs/design/ai-auth-mvp.md §6）：
 *   /api/features     公開的功能開關（src/features.ts）
 *   /api/me*          目前使用者、同意、匯出與刪除（src/account/routes.ts）
 *   /api/submissions* 中譯英與作文的提交（src/submissions/routes.ts）
 *   /api/ai/apply     申請 AI（src/account/apply.ts）
 *   /api/ai/*         任務型 AI 端點（src/ai/routes.ts）：提示詞與評分基準都寫在伺服器端，前端只送作答內容
 *   /api/admin/*      後台（src/admin/routes.ts、src/admin/ai.ts）。不用 /admin/*：過渡期 Vercel 只轉送 /api 與 /auth，
 *                     SPA 的 catch-all 會吞掉 /admin/*（ARCHITECTURE §12）
 *   /auth/*           Google OAuth 與 session cookie（src/auth/routes.ts）
 * Queue consumer 不是 HTTP 路由，在 src/ai/consumer.ts，由 index.ts 掛成 queue 入口。
 *
 * 中介層順序有意義：
 *   noStore → cors → originGuard →（/api/*）housekeeping → 路由
 *   cors 放在 originGuard 前面，讓「允許的來源」收到的錯誤回應也帶 CORS 標頭，前端才讀得到錯誤內容。
 *   housekeeping（src/ai/housekeeping.ts）在回應之後用 waitUntil 清過期照片、回收卡住的 AI 預扣
 *   （MVP 沒有 Cron；每個 isolate 每分鐘最多一次，不影響回應時間）。
 */
import type { HealthResponse } from '@gsat/shared';
import { Hono } from 'hono';
import pkg from '../package.json';
import type { AppEnv } from './env';
import { handleError, handleNotFound } from './errors';
import { accountRoutes } from './account/routes';
import { aiApplyRoutes } from './account/apply';
import { adminAiRoutes } from './admin/ai';
import { adminRoutes } from './admin/routes';
import { aiRoutes } from './ai/routes';
import { authRoutes } from './auth/routes';
import { featureRoutes } from './features';
import { housekeeping } from './ai/housekeeping';
import { corsMiddleware, noStore, originGuard } from './security';
import { submissionRoutes } from './submissions/routes';

/** 與 wrangler.toml 的 name 相同。 */
export const SERVICE_NAME = 'gsat-english-api';

export const app = new Hono<AppEnv>();

app.use('*', noStore);
app.use('*', corsMiddleware);
app.use('*', originGuard);
app.use('/api/*', housekeeping);

app.get('/api/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    service: SERVICE_NAME,
    version: pkg.version,
    time: new Date().toISOString(),
  };
  return c.json(body);
});

app.route('/api/features', featureRoutes);
app.route('/api/me', accountRoutes);
app.route('/api/submissions', submissionRoutes);
// /api/ai/apply 要在 /api/ai 之前掛：兩個子應用各自負責，前者屬帳號流程（A1）、後者屬 AI 任務（A2）。
app.route('/api/ai/apply', aiApplyRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/admin', adminAiRoutes);
app.route('/auth', authRoutes);

app.notFound(handleNotFound);
app.onError(handleError);
