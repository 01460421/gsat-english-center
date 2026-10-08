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

/** 產生錯誤回應。所有錯誤出口都經過這裡，格式才不會走鐘。 */
export function errorResponse(c: Context<AppEnv>, status: ContentfulStatusCode, code: ApiErrorCode, message: string) {
  const body: ApiErrorBody = { error: { code, message } };
  return c.json(body, status);
}

/** 路由裡要中斷並回錯誤時丟這個：`throw new ApiError(403, 'forbidden', '…')`。 */
export class ApiError extends HTTPException {
  readonly code: ApiErrorCode;
  constructor(status: ContentfulStatusCode, code: ApiErrorCode, message: string) {
    super(status, { message });
    this.code = code;
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
    return errorResponse(c, err.status, err.code, err.message);
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
