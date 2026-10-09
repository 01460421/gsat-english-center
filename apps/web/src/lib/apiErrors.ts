/**
 * API 錯誤 → 給學生看的中文訊息。畫面一律顯示這裡的文案，不顯示後端的 message（那是給開發者看的英文或技術細節）。
 *
 * 用 Record<ApiErrorCode, string>：共用套件（packages/shared/src/api.ts）新增錯誤代碼時，tsc 會要求這裡補上文案。
 * AI 額度與擋下原因直接沿用共用的 AI_ERROR_MESSAGES（SPEC §8.3 的用語），前後端說法一致。
 */
import { AI_ERROR_MESSAGES, type ApiErrorCode } from '@gsat/shared';
import { ApiRequestError, isGatewayError } from './api';

export const API_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  bad_request: '送出的資料不正確，請檢查後再試一次',
  unauthorized: '請先登入',
  forbidden: '你沒有權限執行這個動作',
  bad_origin: '請求來源不正確，請重新整理頁面後再試',
  not_found: '找不到這筆資料',
  method_not_allowed: '不支援這個操作',
  payload_too_large: '內容太長，請縮短後再送出',
  rate_limited: '操作太頻繁，請稍等一下再試',
  internal_error: '伺服器暫時發生問題，請稍後再試',
  not_configured: '這個功能尚未開放',
  not_implemented: '這個功能還在建置中，即將開放',
  consent_required: AI_ERROR_MESSAGES.consent_required,
  reauth_required: '為了保護你的帳號，這個操作需要重新登入',
  account_suspended: '你的帳號已停權',
  conflict: '目前的狀態不允許這個操作，請重新整理後再試',
  quota_day: AI_ERROR_MESSAGES.quota_day,
  quota_month: AI_ERROR_MESSAGES.quota_month,
  daily_limit: AI_ERROR_MESSAGES.daily_limit,
  busy: AI_ERROR_MESSAGES.busy,
  ai_paused: AI_ERROR_MESSAGES.ai_paused,
  site_budget: AI_ERROR_MESSAGES.site_budget,
  not_approved: AI_ERROR_MESSAGES.not_approved,
};

/** 錯誤代碼（不是 ApiRequestError 或後端沒給代碼時為 null）。 */
export function errorCode(err: unknown): ApiErrorCode | null {
  return err instanceof ApiRequestError ? err.code : null;
}

/**
 * 任何錯誤 → 一句中文。overrides 讓各頁依情境改寫特定代碼（例如後台的 conflict 是「名額已滿或狀態已改變」）。
 * 網路錯誤（fetch 丟 TypeError）與沒有統一格式的 HTTP 錯誤都有對應文案，不會顯示 undefined 或英文。
 */
export function errorMessage(err: unknown, overrides: Partial<Record<ApiErrorCode, string>> = {}): string {
  if (err instanceof ApiRequestError) {
    // 閘道的 HTML 錯誤頁（502／504 等）：暫時性的伺服器問題，不是「功能尚未開放」。
    if (isGatewayError(err)) return API_ERROR_MESSAGES.internal_error;
    if (err.code) return overrides[err.code] ?? API_ERROR_MESSAGES[err.code];
    if (err.status === 401) return API_ERROR_MESSAGES.unauthorized;
    if (err.status === 403) return API_ERROR_MESSAGES.forbidden;
    if (err.status === 404) return API_ERROR_MESSAGES.not_found;
    if (err.status === 429) return API_ERROR_MESSAGES.rate_limited;
    if (err.status >= 500) return API_ERROR_MESSAGES.internal_error;
    return `發生錯誤（HTTP ${err.status}），請稍後再試`;
  }
  if (err instanceof DOMException && err.name === 'AbortError') return '請求已取消';
  return '連線失敗，請檢查網路後再試一次';
}
