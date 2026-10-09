/** 頁面測試：假 fetch＋SessionProvider（功能開關、登入狀態）＋記憶體路由。 */
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import { SessionProvider } from '../../../lib/api';
import { createFetchMock, type FetchMock, type Handler } from './fixtures';

/** 顯示目前路徑，測試「送出後導到結果頁」。 */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function renderPage(path: string, routes: Record<string, Handler>, pages: Record<string, ReactNode>): RenderResult & { fetch: FetchMock } {
  const mock = createFetchMock(routes);
  vi.stubGlobal('fetch', vi.fn(mock.fn));
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <Routes>
          {Object.entries(pages).map(([p, el]) => (
            <Route key={p} path={p} element={el} />
          ))}
          <Route path="*" element={<p>其他頁面</p>} />
        </Routes>
        <LocationProbe />
      </SessionProvider>
    </MemoryRouter>,
  );
  return { ...result, fetch: mock };
}

/** 除了功能開關、登入、靜態資料之外，有沒有打其他 API。 */
export function apiCallsExceptSession(mock: FetchMock): string[] {
  return mock.calls.filter((c) => c.path.startsWith('/api/') && c.path !== '/api/features' && c.path !== '/api/me').map((c) => `${c.method} ${c.path}`);
}
