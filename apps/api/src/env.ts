/**
 * Worker 的綁定（bindings）與環境變數型別，與 wrangler.toml 對應（ARCHITECTURE §11）。
 * 新增 [vars]、secret 或資源綁定時要同步改這裡，路由裡讀 c.env 才有型別。
 *
 * 原則：
 *   - 路由與業務邏輯**不直接讀 c.env 的設定值**，一律經過 src/config.ts 的 loadConfig()：預設值集中在那裡，
 *     避免「wrangler.toml 與程式預設值不一致」（ARCHITECTURE §11 最後一段）。機密也由 config.ts 判斷有沒有設。
 *   - [vars] 在 wrangler 裡一律是字串；數字由 config.ts 解析。
 *   - 機密與大部分變數宣告成選填：沒設定時對應功能顯示「未啟用」（/api/features 回 false），而不是整支 Worker 壞掉。
 *     測試環境（test/*.test.ts）也只需要給 DB 與 ALLOWED_ORIGINS。
 */

/** ai-tasks Queue 的訊息：只有操作 id，內容一律從 D1 讀（Queue 訊息上限 128 KB，ARCHITECTURE §6.8）。 */
export interface AiQueueMessage {
  op_id: string;
}

export interface Env {
  /** D1 資料庫（wrangler.toml 的 [[d1_databases]] binding = "DB"）。資料表由 migrations/ 管理。 */
  DB: D1Database;
  /** CORS 與 Origin 檢查的允許清單，逗號分隔的完整 origin。 */
  ALLOWED_ORIGINS: string;

  /** AI 任務佇列（producer；consumer 是 src/ai/consumer.ts 的 handleQueue）。測試與未設定 Queue 的環境為 undefined。 */
  AI_QUEUE?: Queue<AiQueueMessage>;

  // ── 網址（ARCHITECTURE §4.1）──
  /** 前端網址（登入後跳回）。過渡期＝Vercel 網址；買網域後＝主網域。 */
  APP_ORIGIN?: string;
  /** OAuth 回呼與 cookie 檢查的基準；不從請求網址推（經代理時 Worker 看到的是 workers.dev）。未設定時用 APP_ORIGIN。 */
  PUBLIC_API_ORIGIN?: string;

  // ── 登入（secret；GOOGLE_CLIENT_ID 不論設成 var 或 secret 都從 env 讀，站主會設成 secret）──
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 簽 session cookie 與 OAuth state 用的長隨機字串。 */
  SESSION_SECRET?: string;
  /** 管理員 bootstrap：這個信箱第一次登入時自動設為 admin 並核准 AI。 */
  ADMIN_EMAIL?: string;
  /** 帳本、日誌、刪除證明的 HMAC 假名鹽。 */
  LEDGER_SALT?: string;

  // ── 測試用可覆寫的端點（正式環境不設＝官方網址；只給整合測試指到本機假伺服器）──
  /** Google 授權頁，預設 https://accounts.google.com/o/oauth2/v2/auth */
  GOOGLE_OAUTH_AUTH_URL?: string;
  /** Google token 端點，預設 https://oauth2.googleapis.com/token */
  GOOGLE_TOKEN_URL?: string;
  /** Google userinfo 端點，預設 https://openidconnect.googleapis.com/v1/userinfo */
  GOOGLE_USERINFO_URL?: string;
  /** Anthropic API 基底網址，預設 https://api.anthropic.com（傳給 SDK 的 baseURL）。 */
  ANTHROPIC_BASE_URL?: string;

  // ── 條款版本（例如 '2026-10-08'）──
  PRIVACY_POLICY_VERSION?: string;
  TERMS_VERSION?: string;
  AI_CONSENT_VERSION?: string;

  // ── AI ──
  /** Claude API 金鑰（online workspace）。 */
  ANTHROPIC_API_KEY?: string;
  AI_MODEL_DEFAULT?: string;
  AI_MODEL_SECOND_RATER?: string;
  AI_EFFORT_GRADE?: string;
  AI_EFFORT_OCR?: string;

  // ── AI 上限與預算（ARCHITECTURE §6.3；數字字串，config.ts 解析）──
  AI_POINTS_USER_DAY?: string;
  AI_POINTS_USER_MONTH?: string;
  AI_POINTS_TRIAL_DAY?: string;
  AI_ESSAY_USER_DAY?: string;
  AI_CONCURRENT_USER?: string;
  AI_BUDGET_SITE_USD_DAY?: string;
  AI_BUDGET_SITE_USD_MONTH?: string;
  ANTHROPIC_ONLINE_SPEND_LIMIT_USD?: string;
  ANTHROPIC_PIPELINE_SPEND_LIMIT_USD?: string;
  ANTHROPIC_DEV_SPEND_LIMIT_USD?: string;
  ANTHROPIC_TIER_LIMIT_USD?: string;
  /** 核准名額；不設（或空字串）就依 §6.6 自動計算。 */
  AI_APPROVAL_CAP?: string;
}

/** 中介層放進 context 的值（src/auth/session.ts 設定）。 */
export interface AppVariables {
  /** 目前登入的使用者；未登入為 null。由 getSessionUser() 第一次呼叫時解析並快取。 */
  sessionUser: import('./auth/session').SessionUser | null;
}

/** Hono 的泛型參數：讓 c.env、c.var 帶上型別。 */
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
