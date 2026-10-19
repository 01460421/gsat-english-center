/**
 * 媒體查詢與 main 的寬度層級（lib/media.ts，設計文件 §4.1）：lg 斷點、useMainTier 的門檻與第一次 render 的同步估算、
 * ResizeObserver 的量測、跨斷點換樹時保存並還原焦點與游標（沒有 id 的連結用 href＋名稱、按需載入的區塊稍後再找），
 * 找不回來時焦點放到 <h1> 並暫停單鍵快捷鍵。
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import indexCss from '../index.css?raw';
import { setDesktopViewport } from '../test/viewport';
import { resetHotkeysForTests, singleKeysSuspended } from './hotkeys';
import {
  MAIN_TIER_PX,
  MainWidthProvider,
  SIDEBAR_AUTO_COLLAPSE_BELOW,
  SIDEBAR_PX,
  useIsDesktop,
  useMainTier,
  type MainTier,
  type SidebarState,
} from './media';

afterEach(() => resetHotkeysForTests());

function Main({ sidebar = 'expanded', children }: { sidebar?: SidebarState; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  return (
    <main ref={ref}>
      <MainWidthProvider mainRef={ref} sidebar={sidebar}>
        {children}
      </MainWidthProvider>
    </main>
  );
}

function tierAt(width: number, sidebar: SidebarState = 'expanded'): MainTier {
  if (width >= 1024) setDesktopViewport(width, 640);
  const seen: MainTier[] = [];
  function Probe() {
    seen.push(useMainTier());
    return null;
  }
  const view = render(
    <Main sidebar={sidebar}>
      <Probe />
    </Main>,
  );
  view.unmount();
  const first = seen[0];
  if (!first) throw new Error('沒有 render');
  return first;
}

describe('useMediaQuery／useIsDesktop', () => {
  it('預設是手機（375），改成桌機視窗後跟著變', () => {
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    act(() => setDesktopViewport());
    expect(result.current).toBe(true);
  });
});

describe('useMainTier', () => {
  it('< lg 一律 0', () => {
    expect(tierAt(375)).toEqual({ width: 0, ws: false, wide: false });
  });

  it('第一次 render 就用「視窗寬 − 側邊欄寬」估算，門檻 ws 936（58.5rem）、wide 1280', () => {
    expect(tierAt(1366)).toEqual({ width: 1110, ws: true, wide: false });
    expect(tierAt(1192)).toEqual({ width: 936, ws: true, wide: false });
    expect(tierAt(1191)).toEqual({ width: 935, ws: false, wide: false });
    expect(tierAt(1536)).toEqual({ width: 1280, ws: true, wide: true });
    // 收合的側邊欄只有 4rem：1024 寬也到 ws；Windows 的傳統捲軸（約 17px）佔掉之後的 943 也 ≥ 936（§16.7，e2e 在 desktop-lg 量）。
    expect(tierAt(1024, 'collapsed')).toEqual({ width: 960, ws: true, wide: false });
    expect(tierAt(1024)).toEqual({ width: 768, ws: false, wide: false });
  });

  it('JS 的門檻和 index.css 的 container 尺寸相同；1024 寬、側邊欄收合、Windows 傳統捲軸時也到 ws（§16.7）', () => {
    // CSS（lg:@ws/main:）與 JS（useMainTier）量同一個寬度，門檻不同就會出現 CSS 已經分欄、JS 卻以為沒分的情況。
    const px = (name: string) => Number(new RegExp(`--container-${name}:\\s*([\\d.]+)rem;`).exec(indexCss)?.[1]) * 16;
    expect(px('ws')).toBe(MAIN_TIER_PX.ws);
    expect(px('wide')).toBe(MAIN_TIER_PX.wide);
    // ≥ lg 一律保留捲軸的位置：Windows 的傳統捲軸約 17px，1024 寬收合時 main 是 943（無頭 Chromium 15px 時 945）。
    expect(1024 - 17 - SIDEBAR_PX.collapsed).toBeGreaterThanOrEqual(MAIN_TIER_PX.ws);
    // 工作區路由的自動收合門檻（版面寬，已扣掉捲軸）＝展開時 main 剛好到 ws。
    expect(SIDEBAR_AUTO_COLLAPSE_BELOW).toBe(SIDEBAR_PX.expanded + MAIN_TIER_PX.ws);
    expect(SIDEBAR_AUTO_COLLAPSE_BELOW).toBe(1192);
  });

  it('ResizeObserver 量到 main 的內容寬之後改用量測值', () => {
    let callback: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    setDesktopViewport(1366, 640);
    function Probe() {
      const tier = useMainTier();
      return <p>{`${tier.width} ${tier.ws} ${tier.wide}`}</p>;
    }
    render(
      <Main>
        <Probe />
      </Main>,
    );
    expect(screen.getByText('1110 true false')).toBeInTheDocument();
    expect(callback).not.toBeNull();
    act(() => callback?.([{ contentRect: { width: 900 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getByText('900 false false')).toBeInTheDocument();
  });
});

describe('跨斷點保存焦點', () => {
  /** 手機與桌機各一棵樹（R3：同時只有一份），作答框用同一個 id。 */
  function Swap({ desktopHasEditor = true }: { desktopHasEditor?: boolean }) {
    const isDesktop = useIsDesktop();
    if (isDesktop) {
      return desktopHasEditor ? <textarea key="desktop" id="essay" aria-label="桌機" defaultValue="hello world" /> : <p>桌機沒有作答框</p>;
    }
    return <textarea key="mobile" id="essay" aria-label="手機" defaultValue="hello world" />;
  }

  it('換樹之後焦點與游標（含選取範圍）回到同一個 id 的新元素', () => {
    render(
      <Main>
        <Swap />
      </Main>,
    );
    const mobile = screen.getByRole('textbox', { name: '手機' }) as HTMLTextAreaElement;
    mobile.focus();
    mobile.setSelectionRange(2, 5);
    act(() => setDesktopViewport());
    const desktop = screen.getByRole('textbox', { name: '桌機' }) as HTMLTextAreaElement;
    expect(desktop).not.toBe(mobile);
    expect(desktop).toHaveFocus();
    expect([desktop.selectionStart, desktop.selectionEnd]).toEqual([2, 5]);
    expect(singleKeysSuspended()).toBe(false);
  });

  it('沒有換樹（同一個元素還在）就不動', () => {
    function Stable() {
      useIsDesktop();
      return <input id="name" aria-label="暱稱" defaultValue="小明" />;
    }
    render(
      <Main>
        <Stable />
      </Main>,
    );
    const input = screen.getByRole('textbox', { name: '暱稱' });
    input.focus();
    act(() => setDesktopViewport());
    expect(input).toHaveFocus();
    expect(singleKeysSuspended()).toBe(false);
  });

  it('找不回來（焦點掉到 body）時暫停單鍵快捷鍵', () => {
    render(
      <Main>
        <Swap desktopHasEditor={false} />
      </Main>,
    );
    screen.getByRole('textbox', { name: '手機' }).focus();
    act(() => setDesktopViewport());
    expect(document.activeElement).toBe(document.body);
    expect(singleKeysSuspended()).toBe(true);
  });

  /** 首頁、/practice 那種換樹：兩棵樹的連結沒有 id，但網址與名稱相同。 */
  function LinkSwap({ lateDesktop = false }: { lateDesktop?: boolean }) {
    const isDesktop = useIsDesktop();
    const [ready, setReady] = useState(!lateDesktop);
    useEffect(() => {
      if (!isDesktop || ready) return;
      const t = setTimeout(() => setReady(true), 120);
      return () => clearTimeout(t);
    }, [isDesktop, ready]);
    if (isDesktop) {
      return (
        <section>
          <h1>首頁</h1>
          {ready && (
            <>
              <a href="/words">單字</a>
              <a href="/practice" aria-label="題庫練習：1 組">
                桌機的格子
              </a>
            </>
          )}
        </section>
      );
    }
    return (
      <div>
        <h1>首頁</h1>
        <a href="/practice" aria-label="題庫練習：1 組">
          手機的卡片
        </a>
      </div>
    );
  }

  it('沒有 id 的連結：換樹之後用 main 裡同一個 href（與名稱）找回來', () => {
    render(
      <Main>
        <LinkSwap />
      </Main>,
    );
    screen.getByRole('link', { name: '題庫練習：1 組' }).focus();
    act(() => setDesktopViewport());
    expect(document.activeElement?.tagName).toBe('A');
    expect(document.activeElement).toHaveTextContent('桌機的格子');
    expect(singleKeysSuspended()).toBe(false);
  });

  it('新的元素晚一點才出現（按需載入的區塊）：短時間內再找，找到就聚焦', async () => {
    vi.useFakeTimers();
    try {
      render(
        <Main>
          <LinkSwap lateDesktop />
        </Main>,
      );
      screen.getByRole('link', { name: '題庫練習：1 組' }).focus();
      act(() => setDesktopViewport());
      expect(document.activeElement).toBe(document.body);
      expect(singleKeysSuspended()).toBe(true);
      // 120ms 後新的連結才出現（每一段 act 結束時 React 才 commit），之後的重試找到它。
      await act(() => vi.advanceTimersByTimeAsync(130));
      expect(document.activeElement).toBe(document.body);
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(document.activeElement?.tagName).toBe('A');
      expect(document.activeElement).toHaveTextContent('桌機的格子');
      // focusin 解除暫停。
      expect(singleKeysSuspended()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('一直找不回來：焦點放到頁面的 <h1>（不留在 body），單鍵快捷鍵維持暫停', async () => {
    vi.useFakeTimers();
    try {
      function Gone() {
        const isDesktop = useIsDesktop();
        return isDesktop ? <h1>首頁</h1> : <a href="/somewhere">只在手機上的連結</a>;
      }
      render(
        <Main>
          <Gone />
        </Main>,
      );
      screen.getByRole('link', { name: '只在手機上的連結' }).focus();
      act(() => setDesktopViewport());
      await act(() => vi.advanceTimersByTimeAsync(2000));
      const heading = screen.getByRole('heading', { level: 1, name: '首頁' });
      expect(heading).toHaveFocus();
      expect(heading).toHaveAttribute('tabindex', '-1');
      expect(singleKeysSuspended()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('等待期間使用者按了鍵：不再找，也不搶焦點', async () => {
    vi.useFakeTimers();
    try {
      render(
        <Main>
          <LinkSwap lateDesktop />
        </Main>,
      );
      screen.getByRole('link', { name: '題庫練習：1 組' }).focus();
      act(() => setDesktopViewport());
      fireEvent.keyDown(document.body, { key: 'Tab', code: 'Tab' });
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(document.activeElement).toBe(document.body);
    } finally {
      vi.useRealTimers();
    }
  });
});
