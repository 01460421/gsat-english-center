/**
 * 桌機版面依路徑決定的事（lib/desktopLayout.ts）：寬度模式的對照表、工作區路由、側邊欄的目前位置與自動收合。
 * 對照表要涵蓋 App.tsx 的每一條路由：新增路由的人一定要決定它的寬度（列進 ROUTE_MODES 或 DEFAULT_MODE_ROUTES）。
 */
import { describe, expect, it } from 'vitest';
import appSource from '../App.tsx?raw';
import { PAGES } from '../modules';
import {
  DEFAULT_MODE_ROUTES,
  ROUTE_MODES,
  desktopWidthMode,
  isWorkspaceRoute,
  resolveSidebarState,
  sidebarActivePath,
} from './desktopLayout';

/** App.tsx 裡 <Route path="…"> 的路徑（加上開頭的 /）；原始碼用 Vite 的 ?raw 匯入（src/ 的 tsconfig 沒有 node 型別）。 */
function appRoutePaths(): string[] {
  return [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => (m[1] === '*' ? '*' : `/${m[1]}`));
}

describe('desktopWidthMode', () => {
  const classified = new Set([...ROUTE_MODES.map(([pattern]) => pattern), ...DEFAULT_MODE_ROUTES]);

  it('App.tsx 的每一條路由與 PAGES 的每個路徑都在對照表裡（或確定走 default）', () => {
    const routes = appRoutePaths();
    expect(routes.length).toBeGreaterThan(15);
    for (const path of [...routes, ...PAGES.map((p) => p.path)]) {
      expect(classified.has(path), `${path} 沒有登記寬度模式（desktopLayout.ts 的 ROUTE_MODES 或 DEFAULT_MODE_ROUTES）`).toBe(true);
    }
  });

  it('依 §2.3 的對照表分成窄版、一般、放寬的列表頁（§16.7）、工作區', () => {
    for (const path of ['/privacy', '/terms', '/about', '/settings', '/account', '/account/welcome', '/ai/apply']) {
      expect(desktopWidthMode(path)).toBe('narrow');
    }
    for (const path of ['/words', '/admin', '/no-such-page']) {
      expect(desktopWidthMode(path)).toBe('default');
    }
    for (const path of ['/', '/practice', '/translation', '/composition', '/writing', '/writing/translation', '/writing/essay', '/exams', '/mock']) {
      expect(desktopWidthMode(path)).toBe('list');
    }
    for (const path of [
      '/vocabulary',
      '/cloze',
      '/word-bank',
      '/structure',
      '/reading',
      '/mixed',
      '/practice/reading/basic',
      '/exams/gsat-115',
      '/mock/gsat-115',
      '/writing/translation/gsat-115',
      '/writing/essay/gsat-115',
      '/writing/essay/custom',
      '/writing/submissions/sub-1',
    ]) {
      expect(desktopWidthMode(path)).toBe('workspace');
    }
  });

  it('靜態段優先：本站仿真列表是列表頁、成績單是一般寬度，本站仿真作答頁是工作區', () => {
    expect(desktopWidthMode('/writing/translation/ai')).toBe('list');
    expect(desktopWidthMode('/writing/translation/ai/1d423d')).toBe('workspace');
    expect(desktopWidthMode('/writing/essay/ai')).toBe('list');
    expect(desktopWidthMode('/writing/essay/ai/0e89ae')).toBe('workspace');
    expect(desktopWidthMode('/mock/report/00000000-0000-4000-8000-000000000001')).toBe('default');
  });

  it('isWorkspaceRoute', () => {
    expect(isWorkspaceRoute('/exams/gsat-115')).toBe(true);
    expect(isWorkspaceRoute('/exams')).toBe(false);
    expect(isWorkspaceRoute('/writing/translation/ai')).toBe(false);
  });
});

describe('sidebarActivePath', () => {
  it('寫作的子頁依題型標「中譯英」「英文作文」，其他寫作頁標「寫作」', () => {
    expect(sidebarActivePath('/writing/translation')).toBe('/translation');
    expect(sidebarActivePath('/writing/translation/gsat-115')).toBe('/translation');
    expect(sidebarActivePath('/writing/translation/ai/1d423d')).toBe('/translation');
    expect(sidebarActivePath('/writing/essay/custom')).toBe('/composition');
    expect(sidebarActivePath('/writing/essay/ai')).toBe('/composition');
    expect(sidebarActivePath('/writing')).toBe('/writing');
    expect(sidebarActivePath('/writing/submissions/sub-1')).toBe('/writing');
  });

  it('子頁屬於它的列表頁；首頁只在 / 亮；沒有對應的項目時是 null', () => {
    expect(sidebarActivePath('/')).toBe('/');
    expect(sidebarActivePath('/exams/gsat-115')).toBe('/exams');
    expect(sidebarActivePath('/mock/report/x')).toBe('/mock');
    expect(sidebarActivePath('/practice/reading/basic')).toBe('/practice');
    expect(sidebarActivePath('/settings')).toBe('/settings');
    expect(sidebarActivePath('/about')).toBe('/about');
    expect(sidebarActivePath('/privacy')).toBeNull();
    expect(sidebarActivePath('/account')).toBeNull();
    expect(sidebarActivePath('/wordsmith')).toBeNull();
  });

  it('每個 PAGES 路徑都標自己', () => {
    for (const page of PAGES) expect(sidebarActivePath(page.path)).toBe(page.path);
  });
});

describe('resolveSidebarState', () => {
  const base = { pref: null, desktop: true, pointerFine: true, workspace: true, narrowForWorkspace: true } as const;

  it('工作區路由、寬度不夠、沒設定過、有滑鼠：自動收合', () => {
    expect(resolveSidebarState(base)).toBe('collapsed');
    expect(resolveSidebarState({ ...base, workspace: false })).toBe('expanded');
    expect(resolveSidebarState({ ...base, narrowForWorkspace: false })).toBe('expanded');
  });

  it('使用者的設定優先', () => {
    expect(resolveSidebarState({ ...base, pref: 'expanded' })).toBe('expanded');
    expect(resolveSidebarState({ ...base, workspace: false, pref: 'collapsed' })).toBe('collapsed');
  });

  it('手機與觸控為主的裝置一律展開（連已存的「收合」也不套用）', () => {
    expect(resolveSidebarState({ ...base, desktop: false, pref: 'collapsed' })).toBe('expanded');
    expect(resolveSidebarState({ ...base, pointerFine: false, pref: 'collapsed' })).toBe('expanded');
    expect(resolveSidebarState({ ...base, pointerFine: false })).toBe('expanded');
  });
});
