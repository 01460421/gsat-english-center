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
  /**
   * 學習助手讀網站公開題目檔（/data/…）的來源（docs/design/learning-assistant.md §4.5.1）。選填：沒設時等於 APP_ORIGIN
   * （正式站不用設）；只有本機整合測試（scripts/local-e2e.mjs）把它指到假的靜態檔伺服器，APP_ORIGIN 照舊。
   */
  SITE_DATA_ORIGIN?: string;

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
  /**
   * 英文作文自訂題目的總開關（docs/design/custom-essay.md §5.3）。只有值是 on（不分大小寫、去頭尾空白）才開，
   * 其他任何值都當成關（fail closed）；沒設定或空白時用 config.ts 的預設值 off（評分對照達標之前是關的；
   * 要打開是把 wrangler.toml 的 [vars] 改成 "on"，見 docs/SETUP-KEYS.md §8.2）。
   */
  AI_CUSTOM_ESSAY?: string;
  /**
   * 學習助手的總開關（docs/design/learning-assistant.md §4.14）：去頭尾空白、轉小寫後只認 on（開放給已核准的學生）、
   * admin（只有管理員能用，緊急時在正式站查問題），其他任何值都當成關（fail closed）；沒設定時用 config.ts 的預設值 off。
   * 2026-10-23 上線後 wrangler.toml 是 on（緊急關閉見 docs/SETUP-KEYS.md §8.3）。
   */
  AI_ASSISTANT?: string;
  /** 學習助手的拍照問題目（同樣只認 on、admin；其他一律關）。拍照另外要學習助手本身對這位使用者開放。 */
  AI_ASSISTANT_PHOTO?: string;
  /**
   * 學習助手英文以外的科目（第一版只有國文；docs/design/assistant-subjects.md §7.5）：同樣只認 on、admin，其他一律關；
   * 沒設定時用 config.ts 的預設值 off。2026-10-30 上線後 wrangler.toml 是 on（緊急關閉見 docs/SETUP-KEYS.md §8.4）。
   * 另外要 AI_ASSISTANT 本身對這位使用者開放。
   */
  AI_ASSISTANT_SUBJECTS?: string;
  /** 英文以外科目的拍照（同樣只認 on、admin；其他一律關）。另外要 AI_ASSISTANT_PHOTO 與 AI_ASSISTANT_SUBJECTS 都對這位使用者開放。 */
  AI_ASSISTANT_SUBJECTS_PHOTO?: string;
  /**
   * 學習助手的國寫範文（國寫範文設計 §7）：同樣只認 on、admin，其他一律關；沒設定時用 config.ts 的預設值 off。
   * 另外要國文（AI_ASSISTANT_SUBJECTS）對這位使用者開放。緊急關閉＝改成 "off" 部署（docs/SETUP-KEYS.md §8.4）。
   */
  AI_ZH_EXEMPLAR?: string;
  /** 學習助手解析與報告的 effort（預設 medium）。 */
  AI_EFFORT_ASSIST?: string;
  /** 學習助手追問的 effort（預設 low；ARCHITECTURE §11 預留的名字）。 */
  AI_EFFORT_CHAT?: string;
  /**
   * 作文範文的總開關（docs/design/model-essays.md §7.5）：規則同 AI_ASSISTANT（只認 on、admin，其他任何值都當成關；沒設定時
   * 用 config.ts 的預設值 off）。2026-10-30 上線後 wrangler.toml 是 on（緊急關閉見 docs/SETUP-KEYS.md §8.5）。
   */
  AI_ESSAY_EXEMPLARS?: string;
  /** 作文範文的 effort（預設 medium）。 */
  AI_EFFORT_EXEMPLARS?: string;
  /** 學習助手國寫範文的 effort（預設 high；2026-10-31 起和解析分開，國寫範文設計「實作備註（範文品質）」）。 */
  AI_EFFORT_ZH_EXEMPLAR?: string;

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
  /**
   * 學習助手讀網站公開題目檔的工具（src/assist/siteData.ts）。/api/assist/* 的中介層（app.ts）在沒有設定時建立；
   * 測試在外層先放假的（注入 fetchImpl），不 stub 全域 fetch。
   */
  siteData: import('./assist/siteData').SiteData;
}

/** Hono 的泛型參數：讓 c.env、c.var 帶上型別。 */
export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
