/**
 * 桌機殼層（components/Layout.tsx，設計文件 §3）：側邊欄的收合（只在有滑鼠的裝置）、[ 與 ? 快捷鍵、工作區路由的自動收合、
 * 目前位置、底部工具列，以及手機（< lg）上這些都不作用。路由與頁面的完整測試在 App.test.tsx。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetHotkeysForTests } from '../lib/hotkeys';
import { setDesktopViewport } from '../test/viewport';
import { Layout } from './Layout';

afterEach(() => resetHotkeysForTests());

function Page() {
  return (
    <>
      <h1>測試頁</h1>
      <label>
        搜尋
        <input />
      </label>
      <Link to="/writing/essay/gsat-115">去寫作文</Link>
      <Link to="/">回首頁</Link>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<Page />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const sidebar = () => document.querySelector('aside[data-sidebar]');
const main = () => document.getElementById('main');

/**
 * 可以手動切換的 (min-width: 64rem)：happy-dom 的 setViewport 從桌機縮到手機時，matches 會變但不發 change 事件
 * （放大時會發），測「縮到 < lg 再放大」要自己發。其他查詢照 happy-dom。
 */
function controllableLg() {
  let desktop = true;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const original = window.matchMedia.bind(window);
  vi.stubGlobal('matchMedia', (query: string) => {
    if (query !== '(min-width: 64rem)') return original(query);
    return {
      media: query,
      get matches() {
        return desktop;
      },
      addEventListener: (_type: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeEventListener: (_type: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
    } as unknown as MediaQueryList;
  });
  return {
    set(value: boolean) {
      desktop = value;
      for (const l of [...listeners]) l({ matches: value } as MediaQueryListEvent);
    },
  };
}

/** 觸控為主的裝置：(pointer: fine) 不成立，其他查詢照 happy-dom。 */
function emulateTouchOnly() {
  const original = window.matchMedia.bind(window);
  vi.stubGlobal('matchMedia', (query: string) => {
    const mql = original(query);
    if (query !== '(pointer: fine)') return mql;
    return { matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} } as unknown as MediaQueryList;
  });
}

describe('桌機側邊欄', () => {
  it('三段：品牌與收合鈕、導覽清單、底部工具列（設定、關於是圖示連結，仍在「主要導覽」裡）', () => {
    setDesktopViewport();
    renderAt('/cloze');
    const [nav] = screen.getAllByRole('navigation', { name: '主要導覽' });
    if (!nav) throw new Error('找不到側邊欄');
    expect(within(nav).getByRole('link', { name: '綜合測驗' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '設定' })).toHaveAttribute('href', '/settings');
    expect(within(nav).getByRole('link', { name: '關於' })).toHaveAttribute('href', '/about');
    expect(within(nav).getByRole('button', { name: '鍵盤快捷鍵' })).toHaveAttribute('aria-keyshortcuts', '?');
    expect(within(nav).getByRole('button', { name: /^切換為深色主題/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收合側邊欄' })).toHaveAttribute('aria-expanded', 'true');
    // 「其他」群組不在清單裡（只剩底部的圖示連結）。
    expect(within(nav).queryByText('其他')).not.toBeInTheDocument();
  });

  it('寫作的子頁亮「中譯英」「英文作文」，同一時間只有一項是目前頁', () => {
    setDesktopViewport();
    renderAt('/writing/translation/gsat-115');
    const [nav] = screen.getAllByRole('navigation', { name: '主要導覽' });
    if (!nav) throw new Error('找不到側邊欄');
    expect(within(nav).getByRole('link', { name: '中譯英' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '寫作' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('收合鈕與 [ 鍵切換，記在 gsat-ui:v1:sidebar；收合時項目文字是 sr-only（可存取名稱不變）', async () => {
    const user = userEvent.setup();
    setDesktopViewport();
    renderAt('/');
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
    expect(main()).toHaveClass('lg:pl-64');
    await user.click(screen.getByRole('button', { name: '收合側邊欄' }));
    expect(sidebar()).toHaveAttribute('data-sidebar', 'collapsed');
    expect(main()).toHaveClass('lg:pl-16');
    expect(window.localStorage.getItem('gsat-ui:v1:sidebar')).toBe('collapsed');
    const [nav] = screen.getAllByRole('navigation', { name: '主要導覽' });
    expect(within(nav as HTMLElement).getByRole('link', { name: '單字' })).toHaveAttribute('data-tip', '單字');
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
    expect(window.localStorage.getItem('gsat-ui:v1:sidebar')).toBe('expanded');
  });

  it('觸控為主的裝置沒有收合鈕、[ 不作用，已存的「收合」也不套用', () => {
    emulateTouchOnly();
    window.localStorage.setItem('gsat-ui:v1:sidebar', 'collapsed');
    setDesktopViewport(1024, 768);
    renderAt('/');
    expect(screen.queryByRole('button', { name: /側邊欄/ })).not.toBeInTheDocument();
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
  });

  it('工作區路由寬度不夠、沒設定過：自動收合（不寫進設定）；回到一般頁恢復展開', async () => {
    const user = userEvent.setup();
    setDesktopViewport(1100, 640);
    renderAt('/');
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
    await user.click(screen.getByRole('link', { name: '去寫作文' }));
    expect(sidebar()).toHaveAttribute('data-sidebar', 'collapsed');
    expect(window.localStorage.getItem('gsat-ui:v1:sidebar')).toBeNull();
    await user.click(screen.getByRole('link', { name: '回首頁' }));
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
  });

  it('寬度夠（≥ 1192，main 展開時 ≥ 58.5rem）不自動收合；自己按過展開之後不再自動收合', async () => {
    const user = userEvent.setup();
    setDesktopViewport(1366, 640);
    renderAt('/writing/essay/gsat-115');
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
    act(() => setDesktopViewport(1100, 640));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(sidebar()).toHaveAttribute('data-sidebar', 'collapsed');
    await user.click(screen.getByRole('button', { name: '展開側邊欄' }));
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
    expect(window.localStorage.getItem('gsat-ui:v1:sidebar')).toBe('expanded');
  });
});

describe('鍵盤快捷鍵說明', () => {
  it('? 打開（第一次才載入），在輸入框裡按 ? 不打開', async () => {
    setDesktopViewport();
    renderAt('/');
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜尋' }), { key: '?', code: 'Slash', shiftKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog', { name: '鍵盤快捷鍵' })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: '鍵盤快捷鍵' });
    expect(within(dialog).getByText('收合／展開側邊欄')).toBeInTheDocument();
  });

  it('開著時縮到 < lg（對話框跟著卸載）、再放大回桌機：對話框不會自己再跳出來', async () => {
    setDesktopViewport();
    const lg = controllableLg();
    renderAt('/');
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true });
    await screen.findByRole('dialog', { name: '鍵盤快捷鍵' });
    act(() => lg.set(false));
    expect(screen.queryByRole('dialog', { name: '鍵盤快捷鍵' })).not.toBeInTheDocument();
    act(() => lg.set(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: '鍵盤快捷鍵' })).not.toBeInTheDocument();
    // 再按 ? 照常打開。
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true });
    expect(await screen.findByRole('dialog', { name: '鍵盤快捷鍵' })).toBeInTheDocument();
  });

  it('側邊欄的快捷鍵按鈕與頁尾的「鍵盤快捷鍵」都能打開，關閉後焦點回到按鈕', async () => {
    const user = userEvent.setup();
    setDesktopViewport();
    renderAt('/');
    const footer = within(screen.getByRole('navigation', { name: '網站資訊' })).getByRole('button', { name: '鍵盤快捷鍵' });
    await user.click(footer);
    await user.click(await screen.findByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(footer).toHaveFocus();
  });
});

describe('手機（< lg）', () => {
  it('沒有收合鈕，? 與 [ 不作用', async () => {
    renderAt('/');
    expect(screen.queryByRole('button', { name: /側邊欄/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.keyDown(document.body, { key: '[', code: 'BracketLeft' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog', { name: '鍵盤快捷鍵' })).not.toBeInTheDocument();
    expect(sidebar()).toHaveAttribute('data-sidebar', 'expanded');
  });
});
