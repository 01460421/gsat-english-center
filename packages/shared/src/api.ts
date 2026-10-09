/**
 * 前端與 Worker 之間的 API 回應格式。放在共用套件，是為了讓兩邊改格式時 tsc 會一起報錯，
 * 而不是等到線上才發現前端讀不到欄位。
 */

/** GET /api/health 的回應。 */
export interface HealthResponse {
  ok: true;
  /** 服務名稱，與 wrangler.toml 的 name 相同。 */
  service: string;
  /** Worker 的版本（apps/api/package.json 的 version）。 */
  version: string;
  /** 伺服器時間（ISO 8601，UTC）。 */
  time: string;
}

/**
 * 判斷一個未知的 JSON 值是不是健康檢查回應。
 * 前端不能只靠型別斷言：買網域前 /api 經過 Vercel rewrites 轉送，設定錯誤時可能拿到 SPA 的
 * index.html 或代理的錯誤頁，形狀不對就要當成「後端未連線」，而不是在畫面上印出 undefined。
 */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['ok'] === true && typeof v['service'] === 'string' && typeof v['version'] === 'string' && typeof v['time'] === 'string';
}

/**
 * 錯誤代碼。前端依代碼決定要顯示什麼文案，不直接顯示 message（message 只給開發者看）。
 * 之後加新的錯誤情境時，在這裡補代碼，前端的對照表就會被 tsc 要求補齊。
 */
export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'bad_origin',
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'rate_limited',
  'internal_error',
  // ── 帳號與登入（account.ts；ARCHITECTURE §5）──
  /** 功能所需的機密或設定沒填（例如還沒設 GOOGLE_CLIENT_ID）；前端也把「回應不是 JSON」當成這個代碼。 */
  'not_configured',
  /** 骨架階段尚未實作的端點（501）。 */
  'not_implemented',
  /** 還沒完成首次同意，或條款改版後尚未重新同意（403）。 */
  'consent_required',
  /** 敏感操作（刪帳號、匯出、後台寫入）要求近期登入，session 的 iat 太舊（401）。 */
  'reauth_required',
  /** 帳號已停權或刪除中（403）。 */
  'account_suspended',
  /** 狀態不允許這個動作，例如提交已在批改中又要修改（409）。 */
  'conflict',
  // ── AI 額度與狀態（writing.ts 的 AI_RESERVE_ERROR_CODES；ARCHITECTURE §6.4）──
  /** 今日點數不足（429）。 */
  'quota_day',
  /** 本月點數不足（429）。 */
  'quota_month',
  /** 任務家族的每日篇數已滿，例如作文每天 3 篇（429）。 */
  'daily_limit',
  /** 同時進行中的 AI 任務已達上限（429）。 */
  'busy',
  /** 後台全站暫停中（503）。 */
  'ai_paused',
  /** 全站今日或本月美元預算用完（503）。 */
  'site_budget',
  /** AI 功能尚未核准（403）。 */
  'not_approved',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 所有錯誤回應的統一格式：`{ "error": { "code": "...", "message": "..." } }`。 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

/**
 * 判斷一個未知的 JSON 值是不是統一格式的錯誤回應。
 * code 必須是 API_ERROR_CODES 裡的值，不能只檢查是字串：型別守衛宣稱 code 是 ApiErrorCode，
 * 前端會拿它去查文案對照表；收到不認得的代碼（例如後端先部署了新代碼）就當成「不是統一格式」，
 * 由呼叫端退回用 HTTP 狀態碼處理，而不是查表查到 undefined。
 */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err: unknown = value.error;
  if (typeof err !== 'object' || err === null || !('code' in err) || !('message' in err)) return false;
  return (API_ERROR_CODES as readonly unknown[]).includes(err.code) && typeof err.message === 'string';
}
