/**
 * 呼叫後端 Worker 的唯一入口，以及全站共用的登入狀態（useFeatures、useMe）。
 *
 * 網址一律用相對路徑 /api/...：
 *   - 本機開發：Vite 的 server.proxy 轉到 wrangler dev（127.0.0.1:8787）。
 *   - 買網域前：Vercel rewrites 轉到 *.workers.dev。
 * 兩種情況瀏覽器看到的都是同源，host-only 的 session cookie（__Host-gsat_sid）才會跟著送出
 * （*.vercel.app 與 *.workers.dev 彼此跨站，見 docs/research/05-sekai-center-patterns.md §1.3）。
 * 買網域後若改成直接呼叫 https://api.<網域>，在建置時設定 VITE_API_BASE 即可，程式碼不用改。
 *
 * credentials：同源（VITE_API_BASE 未設）用 'same-origin'；設了 VITE_API_BASE 就是跨子網域（主網域 → api.<網域>，
 * 同站），要用 'include' cookie 才會送出（ARCHITECTURE §4.4 第 5 步）。
 *
 * 「回應不是 JSON」一律視為 not_configured：Worker 還沒部署時，Vercel 代理會回 SPA 的 index.html 或 404 頁，
 * 這不是「伺服器錯誤」，而是「後端功能尚未開放」，畫面應該安靜地隱藏登入與 AI，而不是跳錯誤訊息。
 */
import {
  FEATURES_OFF,
  isApiErrorBody,
  isFeaturesResponse,
  isHealthResponse,
  isMeResponse,
  type ApiErrorCode,
  type FeaturesResponse,
  type HealthResponse,
  type MeResponse,
  type MeResponseSignedIn,
} from '@gsat/shared';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const CREDENTIALS: RequestCredentials = API_BASE ? 'include' : 'same-origin';

/** 請求失敗。code 是後端回的錯誤代碼；網路錯誤或回應不是統一格式時為 null（回應不是 JSON 時為 not_configured）。 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | null;
  /**
   * 回應不是 JSON（代理或閘道的 HTML／純文字頁；這時 code 是 not_configured）。
   * 用來分辨「後端說功能沒開」（JSON 的 503 not_configured）與「閘道暫時出錯」（HTML 的 502／504、Cloudflare 1101／1102）：
   * 後者在功能開關已確認後端有部署之後出現，多半是暫時性的，不該顯示成「尚未開放」。
   */
  readonly nonJson: boolean;
  constructor(status: number, code: ApiErrorCode | null, message: string, options: { nonJson?: boolean } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.nonJson = options.nonJson === true;
  }
}

/** 閘道或代理回的非 JSON 5xx（Vercel 502／504、Cloudflare 1101／1102 錯誤頁）：暫時性錯誤，重試多半就好。 */
export function isGatewayError(err: unknown): boolean {
  return err instanceof ApiRequestError && err.nonJson && err.status >= 500;
}

export type ApiPath = `/${string}`;

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON 本體（會 JSON.stringify）；FormData 原樣送出（照片上傳，瀏覽器自己帶 multipart 邊界）。 */
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * 送出請求並解析 JSON。2xx 回解析後的值（204 回 null）；其他狀態丟 ApiRequestError。
 * 回應不是 JSON（content-type 不是 application/json，或解析失敗）→ ApiRequestError(status, 'not_configured')。
 */
export async function api(path: ApiPath, options: ApiOptions = {}): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method: options.method ?? 'GET', credentials: CREDENTIALS, headers };
  if (options.body instanceof FormData) {
    init.body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;

  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 204) return null;
  // 不看 content-type、直接試著解析：代理的 HTML 頁一定解析失敗；測試裡的假 Response 常常沒帶 content-type。
  const body: unknown = await res.json().catch(() => undefined);
  if (body === undefined) {
    throw new ApiRequestError(res.status, 'not_configured', `回應不是 JSON（HTTP ${res.status}），後端可能尚未部署`, { nonJson: true });
  }
  if (!res.ok) {
    const code = isApiErrorBody(body) ? body.error.code : null;
    const message = isApiErrorBody(body) ? body.error.message : `HTTP ${res.status}`;
    throw new ApiRequestError(res.status, code, message);
  }
  return body;
}

/** GET 並解析 JSON（既有呼叫端用；等同 api(path)）。 */
export function apiGet(path: ApiPath, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return api(path, options);
}

export function apiPost(path: ApiPath, body?: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return api(path, { ...options, method: 'POST', body });
}

export function apiPut(path: ApiPath, body?: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return api(path, { ...options, method: 'PUT', body });
}

export function apiPatch(path: ApiPath, body?: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return api(path, { ...options, method: 'PATCH', body });
}

export function apiDelete(path: ApiPath, body?: unknown, options: { signal?: AbortSignal } = {}): Promise<unknown> {
  return api(path, { ...options, method: 'DELETE', body });
}

/** GET /api/health。回應形狀不對（例如拿到 SPA 的 index.html）也算失敗。 */
export async function fetchHealth(options: { signal?: AbortSignal } = {}): Promise<HealthResponse> {
  const body = await apiGet('/api/health', options);
  if (!isHealthResponse(body)) throw new ApiRequestError(200, null, '健康檢查回應格式不符');
  return body;
}

/** GET /api/features。任何失敗（未部署、網路錯誤、形狀不對）都回 FEATURES_OFF：功能開關只決定「顯不顯示」。 */
export async function fetchFeatures(options: { signal?: AbortSignal } = {}): Promise<FeaturesResponse> {
  try {
    const body = await apiGet('/api/features', options);
    return isFeaturesResponse(body) ? body : { ...FEATURES_OFF };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return { ...FEATURES_OFF };
  }
}

/** GET /api/me。失敗（含 501 骨架期、未部署）一律當成未登入。 */
export async function fetchMe(options: { signal?: AbortSignal } = {}): Promise<MeResponse> {
  try {
    const body = await apiGet('/api/me', options);
    return isMeResponse(body) ? body : { user: null };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return { user: null };
  }
}

// ───────────────────────── 全站登入狀態（SessionProvider） ─────────────────────────

export interface SessionState {
  features: FeaturesResponse;
  me: MeResponse;
  /** 第一次載入完成前為 true（避免登入按鈕閃一下「登入」再變成暱稱）。 */
  loading: boolean;
  /** 重新讀取 /api/features 與 /api/me（登出、申請 AI、後台暫停 AI 之後呼叫）。 */
  refresh: () => Promise<void>;
  /**
   * 直接套用後端回的最新 /api/me（PATCH /api/me、POST /api/me/consents 都回 MeResponseSignedIn），
   * 省一次 GET /api/me；登出或刪帳號後傳 { user: null }。
   */
  applyMe: (me: MeResponse) => void;
}

const DEFAULT_SESSION: SessionState = {
  features: FEATURES_OFF,
  me: { user: null },
  loading: false,
  refresh: async () => {},
  applyMe: () => {},
};

/**
 * 沒有 Provider 時的預設值＝全部關閉、未登入：元件測試直接 render 頁面也不會壞，
 * 也不會在測試裡打真的 /api/features。
 */
const SessionContext = createContext<SessionState>(DEFAULT_SESSION);

/** 放在 App 外層（main.tsx）：載入一次功能開關；auth 開啟才讀 /api/me。 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeaturesResponse>(FEATURES_OFF);
  const [me, setMe] = useState<MeResponse>({ user: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    const opts = signal ? { signal } : {};
    const f = await fetchFeatures(opts);
    const m = f.auth ? await fetchMe(opts) : { user: null };
    if (signal?.aborted) return;
    setFeatures(f);
    setMe(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(() => {
      // 只有 abort 會走到這裡（fetchFeatures／fetchMe 自己吞掉其他錯誤）
    });
    return () => controller.abort();
  }, [load]);

  const applyMe = useCallback((next: MeResponse) => setMe(next), []);
  const value = useMemo<SessionState>(
    () => ({ features, me, loading, refresh: () => load(), applyMe }),
    [features, me, loading, load, applyMe],
  );
  return createElement(SessionContext.Provider, { value }, children);
}

/** 功能開關（auth／ai／ocr／aiPaused）。 */
export function useFeatures(): FeaturesResponse {
  return useContext(SessionContext).features;
}

/** 目前使用者與重新整理函式。 */
export function useMe(): Pick<SessionState, 'me' | 'loading' | 'refresh' | 'applyMe'> {
  const { me, loading, refresh, applyMe } = useContext(SessionContext);
  return { me, loading, refresh, applyMe };
}

/** 已登入時回 MeResponseSignedIn，否則 null（型別收窄用）。 */
export function signedIn(me: MeResponse): MeResponseSignedIn | null {
  return me.user ? me : null;
}

/**
 * 是否要先到 /account/welcome：還有需要（重新）同意的條款，或首次設定沒完成（年齡區間沒填）。
 * 這時需要登入的 API 會回 403 consent_required，所以需要登入的頁面一律先導過去。
 */
export function needsOnboarding(me: MeResponseSignedIn): boolean {
  return me.pending_consents.length > 0 || !me.onboarded;
}

/** 登入網址：next 只放站內路徑（後端另以 safePath 驗證）。用 <a href>，不用 router 的 Link（要整頁跳到 Worker）。 */
export function loginHref(next: string): string {
  return `${API_BASE}/auth/google/start?next=${encodeURIComponent(next)}`;
}
