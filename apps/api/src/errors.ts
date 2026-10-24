/**
 * 統一的 JSON 錯誤格式：`{ "error": { "code": "...", "message": "..." } }`（型別在 @gsat/shared 的 ApiErrorBody）。
 *
 * 為什麼要統一：前端只需要一個 api() 包裝就能處理所有錯誤；依 code 顯示中文文案，
 * message 只給開發者除錯用。Sekai 的經驗是錯誤格式各路由自己寫，前端就得到處 catch 不同形狀。
 */
import type { ApiErrorBody, ApiErrorCode } from '@gsat/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env';

/**
 * 錯誤的選填細節（docs/design/custom-essay.md §2.5）：更細的原因代碼、出問題的欄位、命中處在學生自己文字裡的位置。
 * 目前只有 custom_prompt_invalid、essay_not_gradable 會帶；其他錯誤的回應一個字都不變。
 * group_id、title：作文範文的 exemplar_site_match 回相同的網站題目（docs/design/model-essays.md §5.3）。
 */
export interface ApiErrorDetail {
  reason?: string;
  field?: string;
  ranges?: Array<[number, number]>;
  group_id?: string;
  title?: string;
}

/** 產生錯誤回應。所有錯誤出口都經過這裡，格式才不會走鐘。detail 有值的欄位才放進本體。 */
export function errorResponse(c: Context<AppEnv>, status: ContentfulStatusCode, code: ApiErrorCode, message: string, detail: ApiErrorDetail = {}) {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(detail.reason !== undefined ? { reason: detail.reason } : {}),
      ...(detail.field !== undefined ? { field: detail.field } : {}),
      ...(detail.ranges !== undefined ? { ranges: detail.ranges } : {}),
      ...(detail.group_id !== undefined ? { group_id: detail.group_id } : {}),
      ...(detail.title !== undefined ? { title: detail.title } : {}),
    },
  };
  return c.json(body, status);
}

/** 路由裡要中斷並回錯誤時丟這個：`throw new ApiError(403, 'forbidden', '…')`；要帶原因或位置時加第 4 個參數。 */
export class ApiError extends HTTPException {
  readonly code: ApiErrorCode;
  readonly detail: ApiErrorDetail;
  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string, detail: ApiErrorDetail = {}) {
    super(status, { message });
    this.code = code;
    this.detail = detail;
  }
}

/** HTTP 狀態碼對應的預設錯誤代碼（給沒有指定 code 的 HTTPException 用，例如 Hono 內建中介層丟出的）。 */
function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 405:
      return 'method_not_allowed';
    case 413:
      return 'payload_too_large';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'bad_request';
  }
}

/** app.onError：預期內的錯誤照實回報；預期外的錯誤只回固定訊息，細節寫進 log，不回顯給使用者。 */
export function handleError(err: Error, c: Context<AppEnv>) {
  if (err instanceof ApiError) {
    return errorResponse(c, err.status, err.code, err.message, err.detail);
  }
  if (err instanceof HTTPException) {
    return errorResponse(c, err.status, codeForStatus(err.status), err.message || '請求無法處理');
  }
  console.error('未預期的錯誤', c.req.method, c.req.path, err);
  return errorResponse(c, 500, 'internal_error', '伺服器發生錯誤，請稍後再試');
}

/** app.notFound：未知路徑也回 JSON，前端不必判斷「是 HTML 錯誤頁還是 JSON」。 */
export function handleNotFound(c: Context<AppEnv>) {
  return errorResponse(c, 404, 'not_found', `找不到 ${c.req.method} ${c.req.path}`);
}

/**
 * 骨架階段的端點：回 501 `not_implemented`。各模組實作時把對應的 `notImplemented` 換掉即可，
 * 路徑、方法與中介層先掛好，前端與其他模組可以照契約（docs/design/ai-auth-mvp.md）並行開發。
 */
export function notImplemented(c: Context<AppEnv>) {
  return errorResponse(c, 501, 'not_implemented', `${c.req.method} ${c.req.path} 尚未實作`);
}
