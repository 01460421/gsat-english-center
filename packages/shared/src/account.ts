/**
 * 帳號、同意、AI 申請與管理後台的 API 型別（ARCHITECTURE §5、§10.2、§10.5；SPEC §8、§9；DB_SCHEMA §3.4）。
 *
 * 命名沿用資料庫與既有共用型別：JSON 欄位一律 snake_case。列舉值與 DB 的 CHECK 約束一字不差，
 * 後端把資料表的值直接放進回應，不另做對照表。
 */

/** 角色（users.role）。 */
export const USER_ROLES = ['student', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** 帳號狀態（users.status）。和 AI 核准狀態分開：不必核准也能登入、存紀錄。 */
export const ACCOUNT_STATUSES = ['active', 'suspended', 'deleting'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * AI 核准狀態（users.ai_status）。
 *   none      從未申請
 *   pending   已申請、等站主核准
 *   waitlist  名額（AI_APPROVAL_CAP，ARCHITECTURE §6.6）已滿，排入候補
 *   approved  可以使用 AI 功能
 *   rejected  被拒絕（可再申請，受冷卻與次數上限）
 *   suspended AI 功能被停用（帳號本身仍可登入）
 */
export const AI_STATUSES = ['none', 'pending', 'waitlist', 'approved', 'rejected', 'suspended'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

/** 額度等級（users.ai_tier）：trial 每天 10 點；standard 30／300；unlimited 給管理員（照樣記帳、受全站預算限制）。 */
export const AI_TIERS = ['trial', 'standard', 'unlimited'] as const;
export type AiTier = (typeof AI_TIERS)[number];

/** 自述年齡區間（users.age_band）：只問「未滿 18 歲／18 歲以上」，不收生日。 */
export const AGE_BANDS = ['under18', '18plus'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/**
 * 同意種類（consents.kind），只增不改、依種類記版本。
 *   privacy、terms        首次登入必須同意；條款改版（版本不同）要重新同意才能使用需要登入的功能
 *   ai_processing         申請 AI 時單獨同意「作文、翻譯與照片會傳給 Anthropic 的 API 處理（可能在境外）」
 *   guardian_ack          未滿 18 歲者申請 AI 時勾選「已告知法定代理人並取得同意」
 *   improve_grading       選擇性：同意以去識別方式用於改善批改，隨時可撤回
 */
export const CONSENT_KINDS = ['privacy', 'terms', 'ai_processing', 'guardian_ack', 'improve_grading'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** 首次登入必須同意的種類。 */
export const LOGIN_CONSENT_KINDS = ['privacy', 'terms'] as const satisfies readonly ConsentKind[];

/**
 * 申請 AI 時記錄、AI 功能依賴的同意種類（guardian_ack 只有未滿 18 歲需要）。
 * AI_CONSENT_VERSION 改版後，已申請（pending／waitlist）或已核准的學生要重新同意才能再用 AI：
 * /api/me 的 pending_ai_consents 列出缺的種類，AI 端點回 403 consent_required。
 */
export const AI_CONSENT_KINDS = ['ai_processing', 'guardian_ack'] as const satisfies readonly ConsentKind[];

/**
 * 各同意種類對應的「現行版本」來自哪個環境變數（apps/api/src/config.ts 讀取）：
 * privacy → PRIVACY_POLICY_VERSION、terms → TERMS_VERSION、其餘三種都跟 AI_CONSENT_VERSION。
 */
export const CONSENT_VERSION_SOURCE = {
  privacy: 'privacy',
  terms: 'terms',
  ai_processing: 'ai',
  guardian_ack: 'ai',
  improve_grading: 'ai',
} as const satisfies Record<ConsentKind, 'privacy' | 'terms' | 'ai'>;

/** 現行條款版本（例如 '2026-11-01'）。 */
export interface ConsentVersions {
  privacy: string;
  terms: string;
  ai: string;
}

/** 暱稱長度上限（users.display_name CHECK ≤ 40）。 */
export const DISPLAY_NAME_MAX = 40;
/** AI 申請說明長度上限（users.ai_apply_note CHECK ≤ 300）；後台顯示時標示為不可信資料。 */
export const AI_APPLY_NOTE_MAX = 300;
/** 每帳號最多申請 AI 次數（users.ai_apply_count CHECK ≤ 10）。 */
export const AI_APPLY_MAX_COUNT = 10;
/** 兩次申請之間的冷卻秒數（SPEC §8.2）。 */
export const AI_APPLY_COOLDOWN_SECONDS = 60;
/** 刪帳號、匯出資料要求 session 在幾分鐘內登入過（ARCHITECTURE §5）。 */
export const RECENT_LOGIN_MINUTES_SENSITIVE = 10;
/** 後台寫入動作要求 session 在幾分鐘內登入過（ARCHITECTURE §5、§7：12 小時）。 */
export const RECENT_LOGIN_MINUTES_ADMIN = 12 * 60;
/** 刪除帳號時要輸入的確認字串（DELETE /api/me 的 confirm）。 */
export const DELETE_ACCOUNT_CONFIRM = '刪除我的帳號';

/**
 * 使用者本人看得到的帳號資料（/api/me）。
 * 不含 email：email 只供登入識別與管理員聯絡，介面不顯示（DB_SCHEMA §3.4）；後台列表另有 AdminUserRow。
 * id 是 users.public_id（UUID），內部整數 id 不出 Worker。
 */
export interface PublicUser {
  id: string;
  display_name: string | null;
  role: UserRole;
  status: AccountStatus;
  age_band: AgeBand | null;
  ai_status: AiStatus;
  ai_tier: AiTier;
  /** 建立時間（Unix 秒）。 */
  created_at: number;
}

/** GET /api/me 未登入：永遠回 200 `{ user: null }`。 */
export interface MeResponseAnonymous {
  user: null;
}

/** GET /api/me 已登入。 */
export interface MeResponseSignedIn {
  user: PublicUser;
  /**
   * 需要（重新）同意的種類：首次登入是 privacy＋terms；條款改版後是版本不同的那幾種。只會出現 LOGIN_CONSENT_KINDS
   * （AI 相關的在 pending_ai_consents）。「需要」的定義：該種類最新一筆紀錄不是「現行版本、granted=1」。
   * 非空時前端導向 /account/welcome，需要登入的 API 會回 403 consent_required。
   */
  pending_consents: ConsentKind[];
  /** 首次設定是否完成（登入同意都是現行版本、age_band 已填）。 */
  onboarded: boolean;
  /** 現行條款版本，/account/welcome 送同意時原樣帶回。 */
  consent_versions: ConsentVersions;
  /** 這個 session 的登入時間（Unix 秒，cookie 的 iat）；前端判斷刪帳號／匯出前要不要先重新登入。 */
  login_at: number;
  /**
   * AI 相關的同意需要重新確認的種類（AI_CONSENT_KINDS 的子集）：只有 ai_status 是 pending／waitlist／approved 的
   * 學生、且 AI_CONSENT_VERSION 改版（或撤回、或改報未滿 18 歲而沒有 guardian_ack）時才非空；管理員一律空。
   * 和 pending_consents 分開：這裡非空不影響一般功能，只有 AI 端點回 403 consent_required。
   * 前端在「申請 AI」頁（或 AI 頁的提示）讓學生重新勾選，送 POST /api/me/consents 或再送一次 POST /api/ai/apply 都可以。
   * 後端一定會帶；宣告成選填只是為了讓舊的測試假資料不必改。
   */
  pending_ai_consents?: ConsentKind[];
}

export type MeResponse = MeResponseAnonymous | MeResponseSignedIn;

/** PATCH /api/me：改暱稱、年齡區間（欄位省略＝不改；display_name 送 null＝清空）。回 MeResponseSignedIn。 */
export interface MePatchBody {
  display_name?: string | null;
  age_band?: AgeBand;
}

/** POST /api/me/consents 的一筆：同意或撤回某種類的某個版本。 */
export interface ConsentItem {
  kind: ConsentKind;
  version: string;
  granted: boolean;
}

/**
 * POST /api/me/consents。首次登入頁一次送 privacy＋terms（可同時帶 age_band 與暱稱，省一次往返）。
 * version 必須等於現行版本，否則 400（避免前端拿舊頁面同意舊條款）。回 MeResponseSignedIn。
 */
export interface ConsentsPostBody {
  items: ConsentItem[];
  age_band?: AgeBand;
  display_name?: string | null;
}

/** 同意紀錄（匯出用）。 */
export interface ConsentRecord {
  kind: ConsentKind;
  version: string;
  granted: boolean;
  /** Unix 秒。 */
  created_at: number;
}

/** DELETE /api/me：要輸入 DELETE_ACCOUNT_CONFIRM，且 session 在 10 分鐘內登入過（否則 401 reauth_required）。 */
export interface DeleteMeBody {
  confirm: string;
}

/** GET /api/me/export 的回應（附 Content-Disposition 下載）。照片不匯出（SPEC §8.5）。 */
export interface MeExport {
  format: 'gsat-export/v1';
  /** ISO 8601。 */
  exported_at: string;
  user: PublicUser & { email: string };
  consents: ConsentRecord[];
  /**
   * 寫作提交與批改結果；MVP 只有中譯英與作文。每一筆是 submissions 表的欄位（*_json 已解析成物件）
   * 加上 gradings（各評分者的分項判斷、程式分數、回饋）。照片與內部欄位（租約、op_id）不匯出。
   */
  submissions: unknown[];
}

/**
 * /auth/google/callback 失敗時，跳回前端 `/account?auth_error=<代碼>`（回呼頁不回 JSON）。
 *   state         state 簽章或 nonce 不符、過期（可能是重複點擊或開太多分頁）
 *   denied        使用者在 Google 畫面取消
 *   unverified    Google 信箱未驗證
 *   suspended     帳號已停權
 *   google        Google 端錯誤（token 交換失敗等）
 *   not_configured 登入相關機密未設定
 */
export const AUTH_ERROR_CODES = ['state', 'denied', 'unverified', 'suspended', 'google', 'not_configured'] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** 型別守衛：`/account?auth_error=` 的值是否為已知代碼（不認得的就當成 google，顯示通用文案）。 */
export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return (AUTH_ERROR_CODES as readonly unknown[]).includes(value);
}

/** 登入後回跳路徑（`/auth/google/start?next=`）的長度上限。 */
export const SAFE_PATH_MAX_LENGTH = 512;

/**
 * 白名單字元：英數與 `- . _ ~ / ? = & % # + , : @`。刻意不收反斜線、引號、角括號、空白與控制字元：
 * 回跳網址會放進回呼頁的 HTML（meta refresh 與連結），字元越少越不用擔心跳脫。
 * 第二個字元不能是 `/` 或 `\`：`//evil.example` 在瀏覽器裡是「協定相對網址」，會跳到別的網站。
 */
const SAFE_PATH_RE = /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%#+,:@]*$/;

/**
 * 登入後回跳路徑的檢查（ARCHITECTURE §5「回跳」；沿用 Sekai 的 safePath）。
 * 只接受單一斜線開頭、白名單字元、不超過 512 字元的站內路徑；`/auth` 開頭的也不收（回跳到登入起點會無限循環）。
 * 不合格就回 fallback（預設 `/`）。後端用它檢查 next，前端組登入連結時也可以先用它過濾。
 */
export function safePath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value.length > SAFE_PATH_MAX_LENGTH || !SAFE_PATH_RE.test(value)) return fallback;
  if (/^\/auth(?:[/?#]|$)/i.test(value)) return fallback;
  return value;
}

// ───────────────────────── AI 申請（POST /api/ai/apply） ─────────────────────────

/**
 * POST /api/ai/apply。同時記 ai_processing 同意（版本＝現行 AI_CONSENT_VERSION）；
 * 未滿 18 歲必須 guardian_ack=true（另記 guardian_ack 同意）。
 * MVP 不做邀請碼：invite_code 欄位保留，送了也忽略。
 */
export interface AiApplyBody {
  note: string;
  ai_consent_version: string;
  guardian_ack: boolean;
  invite_code?: string;
}

/** POST /api/ai/apply 的回應：申請後的狀態（名額已滿為 waitlist；管理員或邀請碼為 approved）。 */
export interface AiApplyResponse {
  ai_status: AiStatus;
}

// ───────────────────────── 管理後台（/api/admin/*） ─────────────────────────

/**
 * 後台對使用者 AI 狀態的動作：POST /api/admin/users/{id}/{action}（id 是 public_id；要 12 小時內登入過，寫 admin_audit）。
 *   approve    ai_status → approved。名額已滿或 §6.3 啟動檢查不通過 → 409 conflict。
 *              從未申請（none）的也可以直接核准，但他沒有 ai_processing 同意：pending_ai_consents 會列出來，
 *              AI 端點回 403 consent_required，直到他同意為止（同意一定由學生本人做）。
 *   reject     ai_status → rejected（學生可再申請，受冷卻與次數上限）；none 不能 reject（409）
 *   waitlist   ai_status → waitlist；none 不能 waitlist（409）
 *   suspend    ai_status → suspended：停用 AI（帳號仍可登入、存紀錄；不能自己再申請）。不能停用自己（409）
 *   unsuspend  ai_status suspended → approved（和 approve 一樣檢查名額與啟動檢查）
 * 帳號層級的停權（users.status='suspended'，登入時回 auth_error=suspended）MVP 沒有後台按鈕，需要時由站主直接改資料庫，
 * 並把 session_ver 加 1。
 */
export const ADMIN_USER_ACTIONS = ['approve', 'reject', 'waitlist', 'suspend', 'unsuspend'] as const;
export type AdminUserAction = (typeof ADMIN_USER_ACTIONS)[number];

/** 後台使用者列表的一列：只顯示暱稱與 email，不顯示學習內容；ai_apply_note 是不可信資料。 */
export interface AdminUserRow extends PublicUser {
  email: string;
  ai_apply_note: string | null;
  ai_apply_count: number;
  /** Unix 秒。 */
  ai_applied_at: number | null;
  ai_reviewed_at: number | null;
  /** 最後活動的台灣日期 'YYYY-MM-DD'。 */
  last_active_day: string | null;
}

/** GET /api/admin/users?ai_status=&cursor= */
export interface AdminUsersResponse {
  users: AdminUserRow[];
  next_cursor: string | null;
  /** 名額：上限（AI_APPROVAL_CAP 或自動計算）與目前已核准人數。 */
  approval: { cap: number; approved: number };
}

/** POST /api/admin/users/{id}/{action} 的回應：更新後的那一列。 */
export interface AdminUserActionResponse {
  user: AdminUserRow;
}

/** §6.3 啟動檢查的一條。 */
export interface StartupCheck {
  id: 'site_vs_online' | 'workspaces_vs_tier' | 'daily_vs_monthly';
  ok: boolean;
  /** 中文說明（含實際數字，例如「400＋20 ≤ 450」）。 */
  detail: string;
  /** 第 3 條只是提醒：不成立時 warn，不擋核准。 */
  severity: 'error' | 'warn';
}

/** GET /api/admin/health：設定是否齊全只回布林，絕不回值。 */
export interface AdminHealthResponse {
  config: {
    google_client_id: boolean;
    google_client_secret: boolean;
    session_secret: boolean;
    admin_email: boolean;
    ledger_salt: boolean;
    anthropic_api_key: boolean;
    ai_queue: boolean;
  };
  /** 遷移狀態：applied 是 d1_migrations 裡的檔名，expected 是 Worker 打包時知道的檔名。 */
  migrations: { applied: string[]; expected: string[]; ok: boolean };
  startup_checks: StartupCheck[];
  /** 全部 error 級的啟動檢查都通過才允許新的 AI 核准。 */
  approvals_allowed: boolean;
  ai: { paused: boolean; approval_cap: number; approved: number };
  /**
   * 未確認（acked_at IS NULL）的維運事件數；open_errors 是其中 severity='error' 的數量（後台首頁亮燈用）。
   * 後端一定會帶；宣告成選填只是為了讓舊的測試假資料不必改。
   */
  ops_events?: { open: number; open_errors: number };
}

/** POST /api/admin/ai/pause */
export interface AdminAiPauseBody {
  paused: boolean;
}

/** GET /api/admin/usage?from=&to= 的簡單彙總（MVP；依任務、依日）。金額一律整數微美元。 */
export interface AdminUsageResponse {
  from: string;
  to: string;
  totals: { ops: number; points: number; usd_micros: number; refunded_ops: number };
  by_day: Array<{ tw_day: string; ops: number; points: number; usd_micros: number }>;
  by_task: Array<{ task: string; ops: number; points: number; usd_micros: number }>;
  budget: { site_day_usd: number; site_month_usd: number; today_usd_micros: number; month_usd_micros: number };
}

// ───────────────────────── 型別守衛 ─────────────────────────

/** 型別守衛：/api/me 的回應（未登入或已登入）。只檢查前端分支會用到的欄位。 */
export function isMeResponse(value: unknown): value is MeResponse {
  if (typeof value !== 'object' || value === null || !('user' in value)) return false;
  const v = value as Record<string, unknown>;
  if (v['user'] === null) return true;
  const u = v['user'];
  if (typeof u !== 'object' || u === null) return false;
  const user = u as Record<string, unknown>;
  return (
    typeof user['id'] === 'string' &&
    (USER_ROLES as readonly unknown[]).includes(user['role']) &&
    (AI_STATUSES as readonly unknown[]).includes(user['ai_status']) &&
    Array.isArray(v['pending_consents']) &&
    typeof v['onboarded'] === 'boolean'
  );
}
