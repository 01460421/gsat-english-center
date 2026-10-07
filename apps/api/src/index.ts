/**
 * Worker 入口（wrangler.toml 的 main）。
 *
 * 這個檔案只能有 default export：Workers 會把主模組的每個具名匯出都當成入口點（例如 Durable Object 類別、
 * 具名 WorkerEntrypoint），匯出一般常數會讓 workerd 啟動失敗。路由與中介層寫在 app.ts。
 *
 * 之後加 Cron（scheduled）時改成：
 *   export default { fetch: app.fetch, scheduled } satisfies ExportedHandler<Env>;
 */
import { app } from './app';

export default app;
