/**
 * 呼叫後端 Worker 的唯一入口。
 *
 * 網址一律用相對路徑 /api/...：
 *   - 本機開發：Vite 的 server.proxy 轉到 wrangler dev（127.0.0.1:8787）。
 *   - 買網域前：Vercel rewrites 轉到 *.workers.dev。
 * 兩種情況瀏覽器看到的都是同源，之後 host-only 的 session cookie 才會跟著送出
 * （*.vercel.app 與 *.workers.dev 彼此跨站，見 docs/research/05-sekai-center-patterns.md §1.3）。
 * 買網域後若改成直接呼叫 https://api.<網域>，在建置時設定 VITE_API_BASE 即可，程式碼不用改。
 */
import { isApiErrorBody, isHealthResponse, type ApiErrorCode, type HealthResponse } from '@gsat/shared';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** 請求失敗。code 是後端回的錯誤代碼；網路錯誤或回應不是統一格式時為 null。 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | null;
  constructor(status: number, code: ApiErrorCode | null, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * GET 並解析 JSON。credentials: 'include' 讓之後的 session cookie 在跨子網域（api.<網域>）時也會送出；
 * 同源時沒有差別。
 */
export async function apiGet(path: `/${string}`, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  const init: RequestInit = { credentials: 'include', headers: { Accept: 'application/json' } };
  if (options.signal) init.signal = options.signal;
  const res = await fetch(`${API_BASE}${path}`, init);
  // 代理或 CDN 出錯時可能回 HTML，解析失敗就當成 null，由下面依狀態碼處理。
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = isApiErrorBody(body) ? body.error.code : null;
    const message = isApiErrorBody(body) ? body.error.message : `HTTP ${res.status}`;
    throw new ApiRequestError(res.status, code, message);
  }
  return body;
}

/** GET /api/health。回應形狀不對（例如拿到 SPA 的 index.html）也算失敗。 */
export async function fetchHealth(options: { signal?: AbortSignal } = {}): Promise<HealthResponse> {
  const body = await apiGet('/api/health', options);
  if (!isHealthResponse(body)) throw new ApiRequestError(200, null, '健康檢查回應格式不符');
  return body;
}
