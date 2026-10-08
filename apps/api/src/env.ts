/**
 * Worker 的綁定（bindings）與環境變數型別，與 wrangler.toml 對應。
 * 新增 [vars]、secret 或資源綁定時要同步改這裡，路由裡讀 c.env 才有型別。
 */
export interface Env {
  /** D1 資料庫（wrangler.toml 的 [[d1_databases]] binding = "DB"）。資料表由 migrations/ 管理。 */
  DB: D1Database;
  /** CORS 與 Origin 檢查的允許清單，逗號分隔的完整 origin。 */
  ALLOWED_ORIGINS: string;

  // 以下是之後才會用到的機密（`wrangler secret put` 設定）。先宣告成選填：
  // 沒設定時對應功能應顯示「未啟用」，而不是整支 Worker 壞掉。
  /** Claude API 金鑰。 */
  ANTHROPIC_API_KEY?: string;
  /** 簽 session cookie 用的長隨機字串。 */
  SESSION_SECRET?: string;
  /** Google OAuth client secret。 */
  GOOGLE_CLIENT_SECRET?: string;
}

/** Hono 的泛型參數：讓 c.env 帶上 Env 型別。 */
export interface AppEnv {
  Bindings: Env;
}
