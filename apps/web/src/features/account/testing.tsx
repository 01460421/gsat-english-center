/**
 * 帳號、AI 申請與後台元件測試的共用工具：假 API（stub 全域 fetch，依「方法＋路徑」回應並記錄呼叫）、
 * 已登入的 /api/me 假資料，以及帶 SessionProvider 的整個 App（含 Layout，才測得到登入按鈕與自動導向）。
 * 只給測試匯入，App 本身不會用到。
 */
import type { FeaturesResponse, MeResponseSignedIn, PublicUser } from '@gsat/shared';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../../App';
import { SessionProvider } from '../../lib/api';

export const FEATURES_ON: FeaturesResponse = { auth: true, ai: true, ocr: true, aiPaused: false };
export const FEATURES_AUTH_ONLY: FeaturesResponse = { auth: true, ai: false, ocr: false, aiPaused: false };
export const FEATURES_OFF_RESPONSE: FeaturesResponse = { auth: false, ai: false, ocr: false, aiPaused: false };

export const VERSIONS = { privacy: '2026-10-08', terms: '2026-10-08', ai: '2026-10-08' };

export function signedInMe(
  overrides: Partial<Omit<MeResponseSignedIn, 'user'>> & { user?: Partial<PublicUser> } = {},
): MeResponseSignedIn {
  const { user, ...rest } = overrides;
  return {
    user: {
      id: 'u-self',
      display_name: '小明',
      role: 'student',
      status: 'active',
      age_band: '18plus',
      ai_status: 'none',
      ai_tier: 'standard',
      created_at: 1_790_000_000,
      ...user,
    },
    pending_consents: [],
    onboarded: true,
    consent_versions: VERSIONS,
    login_at: Math.floor(Date.now() / 1000),
    ...rest,
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (code: string, status: number) => json({ error: { code, message: `mock ${code}` } }, status);

export const noContent = () => new Response(null, { status: 204 });

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: ApiCall) => Response | Promise<Response>;

/**
 * 依「方法 路徑」回應；先找含查詢字串的完整路徑，再找去掉查詢字串的路徑；都沒有就回統一格式的 404。
 * 值是函式就呼叫它（每次都要產生新的 Response，Response 的本體只能讀一次），否則當成 200 的 JSON 本體。
 */
export function mockApi(routes: Record<string, Handler | object>) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input);
    let body: unknown;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    const call = { method, path, body };
    calls.push(call);
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (route === undefined) return apiError('not_found', 404);
    return typeof route === 'function' ? (route as Handler)(call) : json(route);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    calls,
    /** 某方法、路徑前綴的呼叫。 */
    callsTo(method: string, pathPrefix: string): ApiCall[] {
      return calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix));
    },
  };
}

/** 整個 App（Layout＋路由）包在 SessionProvider 裡，從 path 開始。 */
export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}
