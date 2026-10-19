/**
 * 全站版面（手機優先）。
 *
 *   手機（< lg）：頂端列（站名＋主題切換）＋內容＋底部導覽（4 個常用頁＋「更多」）。
 *                 頁面一共 15 個，全部塞進底部會擠到點不準，所以其他頁收進「更多」面板。
 *   桌機（≥ lg）：左側固定側邊欄，沒有底部導覽（docs/design/desktop-ui.md §3）。側邊欄分三段：
 *                 品牌列（＋收合鈕）｜可捲動的導覽清單（依 modules.ts 的 NAV_GROUPS 分組，「其他」群組除外）｜
 *                 底部工具列（帳號或登入、主題、快捷鍵、設定、關於）。
 *
 * 手機與平板（< 1024px）的畫面逐像素不變（設計文件 §2.1）：桌機的改動只放在 lg: 起的 class、只在 ≥ lg 才掛載的元件，
 * 或 useIsDesktop() 為真才作用的行為；改版前後用 tests/visual 的截圖逐像素比對。
 *
 * 頁面元件是按需載入的，Suspense 與錯誤邊界只包住內容區：載入中或載入失敗時導覽列仍可操作。
 */
import { ArrowUp, Ellipsis, Info, Keyboard, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import { Component, lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode, type RefObject } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { LoginButton } from '../features/account/LoginButton';
import { OnboardingRedirect } from '../features/account/RequireAccount';
import { signedIn, useFeatures, useMe } from '../lib/api';
import { FOOTER_MODE_CLASSES, MODE_CLASSES, desktopWidthMode, resolveSidebarState, sidebarActivePath, type WidthMode } from '../lib/desktopLayout';
import { useDesktopPref, type SidebarPref } from '../lib/desktopPrefs';
import { useHotkeys, type HotkeyDef } from '../lib/hotkeys';
import {
  MQ,
  MainWidthProvider,
  SIDEBAR_AUTO_COLLAPSE_BELOW,
  captureFocus,
  useIsDesktop,
  useMediaQuery,
  useViewportNarrowerThan,
  type SidebarState,
} from '../lib/media';
import { APP_NAME, BOTTOM_NAV_PATHS, NAV_GROUPS, PAGES, type PageMeta } from '../modules';
import { OpenShortcutHelpContext } from './desktop/shortcutHelpContext';
import { Tooltip, useTooltipTarget } from './desktop/Tooltip';
import { PageIcon } from './icons';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { ThemeToggle } from './ThemeToggle';

/** 鍵盤快捷鍵說明：第一次打開才下載（只在 ≥ lg 用得到）。 */
const ShortcutHelp = lazy(() => import('./desktop/ShortcutHelp'));

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2 font-bold tracking-tight">
      <img src="/icon.svg" alt="" width={28} height={28} className="size-7" />
      <span>{APP_NAME}</span>
    </NavLink>
  );
}

// ───────────────────────── 桌機側邊欄（只在 ≥ lg 顯示） ─────────────────────────

/**
 * 導覽清單的一項：28px 高（仍 ≥ 24px，WCAG 2.5.8）。目前頁除了底色，左側另有 3px 的色條（框線，§4.11）。
 * 高對比模式（forced-colors）會拿掉底色，而且把透明的框線換成系統色，每一項都會出現同樣的色條：所以非目前頁的色條
 * 指定成 Canvas（和背景同色、看不見），目前頁指定成 Highlight（作者指定的系統色不會被換掉），收合時也看得出目前頁。
 * 收合時文字改成 sr-only（可存取名稱不變），滑鼠移入或鍵盤聚焦時由提示泡泡顯示（data-tip）。
 * 不用 NavLink 的 isActive：/writing/translation/… 要亮「中譯英」而不是「寫作」，由 sidebarActivePath 決定。
 */
function SidebarLink({ page, active, collapsed }: { page: PageMeta; active: boolean; collapsed: boolean }) {
  return (
    <Link
      to={page.path}
      aria-current={active ? 'page' : undefined}
      data-tip={collapsed ? page.navLabel : undefined}
      className={`flex items-center gap-3 rounded-md border-l-[3px] py-0.5 text-[0.95rem] leading-6 ${
        collapsed ? 'justify-center px-0' : 'pr-3 pl-[0.5625rem]'
      } ${
        active
          ? 'border-primary bg-primary-soft font-semibold text-primary forced-colors:border-[color:Highlight]'
          : 'border-transparent text-fg hover:bg-surface-2 forced-colors:border-[color:Canvas]'
      }`}
    >
      <PageIcon icon={page.icon} className="size-5 shrink-0" />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{page.navLabel}</span>
    </Link>
  );
}

/** 清單底部淡出遮罩的高度（mask-image 的 2rem）。 */
const LIST_FADE_PX = 32;

/**
 * 導覽清單（可捲動）。放不下時底部加淡出遮罩當捲動提示：清單最後放一個 1px 的哨兵，IntersectionObserver
 * （root 是清單本身）看不到它時設 data-overflow；捲到底、哨兵出現時拿掉。不掛 scroll 事件。
 * 換頁（或收合、展開）時，目前頁在清單的可見範圍外、或壓在淡出遮罩底下（600 高的視窗、未登入時的「歷屆試題」「模擬考」），
 * 就把清單捲到它完整出現在遮罩上方（§3.2 的目前位置提示）。
 */
function SidebarList({ collapsed, activePath, onScroll }: { collapsed: boolean; activePath: string | null; onScroll: () => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const isDesktop = useIsDesktop();

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!isDesktop || !list) return;
    const reveal = () => {
      const item = list.querySelector<HTMLElement>('[aria-current="page"]');
      if (!item) return;
      const view = list.getBoundingClientRect();
      const box = item.getBoundingClientRect();
      if (box.bottom > view.bottom - LIST_FADE_PX) list.scrollTop += box.bottom - (view.bottom - LIST_FADE_PX);
      else if (box.top < view.top) list.scrollTop -= view.top - box.top;
    };
    reveal();
    // 清單的高度之後還會變：未登入的「使用 Google 登入」在 /api/me 回來之後才出現，底部工具列變高、清單變矮。
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [isDesktop, activePath, collapsed]);

  useEffect(() => {
    const list = listRef.current;
    const end = endRef.current;
    if (!isDesktop || !list || !end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setOverflow(!entry.isIntersecting);
      },
      { root: list },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [isDesktop]);

  return (
    <div
      ref={listRef}
      data-sidebar-list=""
      data-overflow={overflow ? '' : undefined}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 lg:data-overflow:[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
    >
      {NAV_GROUPS.filter((group) => group.id !== 'system').map((group) => {
        const pages = PAGES.filter((p) => p.group === group.id);
        return (
          <div key={group.id}>
            {group.label &&
              (collapsed ? (
                <>
                  <p className="sr-only">{group.label}</p>
                  <div aria-hidden="true" className="mx-3 my-1 border-t border-line" />
                </>
              ) : (
                <p className="px-3 pt-1 pb-0.5 text-xs leading-4 font-semibold tracking-wide text-muted">{group.label}</p>
              ))}
            <ul>
              {pages.map((page) => (
                <li key={page.path}>
                  <SidebarLink page={page} active={activePath === page.path} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div ref={endRef} aria-hidden="true" className="h-px" />
    </div>
  );
}

/**
 * 底部工具列的圖示鈕：展開時 32px、收合時 28px（直排五顆也放得進 1366×640，仍 ≥ 24px，WCAG 2.5.8）。
 * 目前頁（設定、關於）平常靠底色與主色；高對比模式會拿掉這兩個，另外在底部畫一條 Highlight 的框線。
 */
const toolCls = (collapsed: boolean) =>
  `inline-flex ${collapsed ? 'size-7' : 'size-8'} shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary forced-colors:aria-[current=page]:border-b-2 forced-colors:aria-[current=page]:border-[color:Highlight]`;

/**
 * 底部工具列：帳號或登入、主題、快捷鍵、設定、關於。「其他」群組（設定、關於）不在清單裡，改成這裡的圖示連結，
 * 仍在同一個 <nav aria-label="主要導覽"> 裡（tests/smoke.spec.ts 要求只有一個，而且看得到「關於」）。
 *   已登入：一列＝帳號按鈕（flex-1）＋四顆圖示；未登入：外框的「使用 Google 登入」＋提示，下一列四顆圖示；
 *   收合：全部直排。
 */
function SidebarTools({
  collapsed,
  activePath,
  onOpenHelp,
}: {
  collapsed: boolean;
  activePath: string | null;
  onOpenHelp: () => void;
}) {
  const features = useFeatures();
  const { me, loading } = useMe();
  const account = !features.auth || loading ? 'none' : signedIn(me) ? 'signed-in' : 'signed-out';
  const side = collapsed ? 'right' : 'top';
  const icons = (
    <>
      <ThemeToggle className={toolCls(collapsed)} tipSide={side} />
      <button
        type="button"
        onClick={onOpenHelp}
        aria-label="鍵盤快捷鍵"
        aria-haspopup="dialog"
        aria-keyshortcuts="?"
        data-tip="鍵盤快捷鍵（?）"
        data-tip-side={side}
        className={toolCls(collapsed)}
      >
        <Keyboard aria-hidden="true" className="size-5" />
      </button>
      <Link to="/settings" aria-label="設定" aria-current={activePath === '/settings' ? 'page' : undefined} data-tip="設定" data-tip-side={side} className={toolCls(collapsed)}>
        <Settings aria-hidden="true" className="size-5" />
      </Link>
      <Link to="/about" aria-label="關於" aria-current={activePath === '/about' ? 'page' : undefined} data-tip="關於" data-tip-side={side} className={toolCls(collapsed)}>
        <Info aria-hidden="true" className="size-5" />
      </Link>
    </>
  );

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-0.5 border-t border-line py-1">
        <LoginButton placement="sidebar" collapsed />
        {icons}
      </div>
    );
  }
  return (
    <div className="shrink-0 border-t border-line p-1.5">
      {account === 'signed-in' ? (
        <div className="flex items-center gap-0.5">
          <div className="min-w-0 flex-1">
            <LoginButton placement="sidebar" />
          </div>
          {icons}
        </div>
      ) : (
        <>
          {account === 'signed-out' && (
            <div className="px-1 pb-1">
              <LoginButton placement="sidebar" />
            </div>
          )}
          <div className="flex items-center justify-around">{icons}</div>
        </>
      )}
    </div>
  );
}

function Sidebar({
  sidebar,
  canCollapse,
  onToggle,
  activePath,
  onOpenHelp,
}: {
  sidebar: SidebarState;
  canCollapse: boolean;
  onToggle: () => void;
  activePath: string | null;
  onOpenHelp: () => void;
}) {
  const isDesktop = useIsDesktop();
  const collapsed = sidebar === 'collapsed';
  // 提示泡泡：收合時的每一項、以及只有圖示的按鈕（任何時候）。整個側邊欄共用一個泡泡元素。
  const tip = useTooltipTarget(isDesktop);
  // 收合或展開之後（按鈕、[ 鍵），正在顯示的提示要重讀文字與位置：用鍵盤按下收合鈕時焦點還在同一顆按鈕上，
  // 它已經改名「展開側邊欄」、移到左邊，舊的提示不能留在原處。
  const { refresh: refreshTip } = tip;
  useLayoutEffect(() => {
    refreshTip();
  }, [sidebar, refreshTip]);
  return (
    <aside
      data-sidebar={sidebar}
      className={`fixed inset-y-0 left-0 z-20 hidden ${collapsed ? 'w-16' : 'w-64'} flex-col border-r border-line bg-surface lg:flex`}
      {...tip.handlers}
    >
      <div className={`flex h-12 shrink-0 items-center ${collapsed ? 'justify-center' : 'justify-between gap-2 pr-1.5 pl-4'}`}>
        {/* 收合時品牌只剩收合鈕的位置；首頁仍是清單的第一項。 */}
        {!collapsed && <Brand />}
        {canCollapse && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'}
            aria-expanded={!collapsed}
            aria-keyshortcuts="["
            data-tip={collapsed ? '展開側邊欄（[）' : '收合側邊欄（[）'}
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          >
            {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-5" /> : <PanelLeftClose aria-hidden="true" className="size-5" />}
          </button>
        )}
      </div>
      <nav aria-label="主要導覽" className="flex min-h-0 flex-1 flex-col">
        <SidebarList collapsed={collapsed} activePath={activePath} onScroll={tip.hide} />
        <SidebarTools collapsed={collapsed} activePath={activePath} onOpenHelp={onOpenHelp} />
      </nav>
      {isDesktop && <Tooltip target={tip.target} />}
    </aside>
  );
}

/**
 * 側邊欄展開或收合（§3.2）：使用者的設定（localStorage）優先；沒設定過時，工作區路由在寬度不夠時自動收合（不寫進設定），
 * 離開工作區路由就恢復展開。判斷在 render 時同步算出，換頁時不會先展開再收起。觸控為主的裝置一律展開。
 * 切換前先記下焦點（lib/media.ts 的 captureFocus）：main 的寬度在同一次 render 就跨過 ws，首頁、/practice 會換樹，
 * 新的樹 commit 後由 MainWidthProvider 找回同一個連結（不在 ResizeObserver 才記，那時已經換完樹了）。
 */
function useSidebarState(pathname: string, isDesktop: boolean, pointerFine: boolean) {
  const [pref, setPref] = useDesktopPref<SidebarPref>('sidebar', null);
  const workspace = desktopWidthMode(pathname) === 'workspace';
  const narrowForWorkspace = useViewportNarrowerThan(SIDEBAR_AUTO_COLLAPSE_BELOW, isDesktop && pointerFine && workspace && pref === null);
  const state = resolveSidebarState({ pref, desktop: isDesktop, pointerFine, workspace, narrowForWorkspace });
  const toggle = useCallback(() => {
    captureFocus();
    setPref(state === 'collapsed' ? 'expanded' : 'collapsed');
  }, [state, setPref]);
  return { state, toggle };
}

// ───────────────────────── 手機的頂端列、底部導覽、「更多」面板（只在 < lg 顯示） ─────────────────────────

function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
      <Brand />
      <div className="flex items-center gap-2">
        {/* 登入按鈕：features.auth 為 false 時不顯示（features/account/LoginButton.tsx） */}
        <LoginButton />
        <ThemeToggle />
      </div>
    </header>
  );
}

const bottomItemClass = (active: boolean) =>
  `flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[0.7rem] leading-tight ${
    active ? 'font-semibold text-primary' : 'text-muted'
  }`;

function BottomNav({
  menuOpen,
  onOpenMenu,
  moreButtonRef,
}: {
  menuOpen: boolean;
  onOpenMenu: () => void;
  moreButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const location = useLocation();
  const bottomPages = BOTTOM_NAV_PATHS.map((path) => PAGES.find((p) => p.path === path)).filter(
    (p): p is (typeof PAGES)[number] => p !== undefined,
  );
  // 目前所在頁不在底部的 4 個常用頁裡時，「更多」要亮起來，使用者才知道自己在哪一區。
  // 用前綴比對而不是完全相同：子頁（/exams/gsat-115）屬於「歷屆試題」，NavLink 已經把它標成目前頁，
  // 完全比對的話「更多」也會一起亮，畫面上同時有兩個「目前位置」。首頁 '/' 是所有路徑的前綴，要另外判斷。
  const inMore = !BOTTOM_NAV_PATHS.some((p) =>
    p === '/' ? location.pathname === '/' : location.pathname === p || location.pathname.startsWith(`${p}/`),
  );
  return (
    <nav
      aria-label="主要導覽"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg">
        {bottomPages.map((page) => (
          <li key={page.path} className="flex min-w-0 flex-1">
            <NavLink to={page.path} end={page.path === '/'} className={({ isActive }) => bottomItemClass(isActive)}>
              <PageIcon icon={page.icon} className="size-6" />
              <span className="max-w-full truncate">{page.navLabel}</span>
            </NavLink>
          </li>
        ))}
        <li className="flex min-w-0 flex-1">
          <button
            ref={moreButtonRef}
            type="button"
            onClick={onOpenMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            className={bottomItemClass(inMore || menuOpen)}
          >
            <Ellipsis aria-hidden="true" className="size-6" />
            <span>更多</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/**
 * 手機的「更多」面板：列出全部頁面。
 * onDismiss：按 Esc、點背景或關閉鈕（焦點要回到「更多」按鈕，鍵盤使用者才不會迷路）。
 * onNavigate：選了某一頁（焦點交給新頁面，不拉回按鈕）。
 */
function MoreMenu({ onDismiss, onNavigate }: { onDismiss: () => void; onNavigate: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 開啟時把焦點移進面板，讀螢幕軟體才會從面板開始唸；背景不能捲動，避免手指滑動時底下的頁面跟著動。
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-30 lg:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onDismiss} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            全部功能
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onDismiss}
            aria-label="關閉選單"
            className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {NAV_GROUPS.map((group) => {
          const pages = PAGES.filter((p) => p.group === group.id);
          return (
            <section key={group.id} className="mt-3">
              {group.label && <h3 className="pb-1 text-xs font-semibold tracking-wide text-muted">{group.label}</h3>}
              <ul className="grid grid-cols-2 gap-2">
                {pages.map((page) => (
                  <li key={page.path} className="min-w-0">
                    <NavLink
                      to={page.path}
                      end={page.path === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
                          isActive ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line hover:bg-surface-2'
                        }`
                      }
                    >
                      <PageIcon icon={page.icon} className="size-5 shrink-0" />
                      <span className="truncate">{page.navLabel}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── 頁尾與桌機的浮動元件 ─────────────────────────

/**
 * 每頁底部的條款連結：Google 登入的品牌審查會檢查首頁有沒有連到隱私權政策。
 * 桌機（≥ lg）：寬度與左右內距和內容容器相同、框線移到裡面的 nav，左右和內容卡片對齊；另外多一個「鍵盤快捷鍵」。
 * 放寬的列表頁（mode 'list'）：nav 用 bleed，和頁面放寬的區塊同寬、同一條左緣。
 */
function SiteFooter({ mode, onOpenHelp }: { mode: WidthMode; onOpenHelp: () => void }) {
  const linkCls = 'inline-flex min-h-11 items-center underline-offset-2 hover:text-fg hover:underline';
  return (
    <footer
      className={`mx-auto max-w-5xl border-t border-line px-4 py-2 text-sm text-muted lg:w-full lg:border-t-0 lg:px-(--page-px) lg:pt-0 ${FOOTER_MODE_CLASSES[mode]}`}
    >
      <nav aria-label="網站資訊" className={`flex flex-wrap gap-x-5 lg:border-t lg:border-line ${mode === 'list' ? 'lg:bleed' : ''}`}>
        <NavLink to="/privacy" className={linkCls}>
          隱私權說明
        </NavLink>
        <NavLink to="/terms" className={linkCls}>
          服務條款
        </NavLink>
        <button
          type="button"
          onClick={onOpenHelp}
          aria-haspopup="dialog"
          className="hidden min-h-11 items-center underline-offset-2 lg:inline-flex lg:hover:text-fg lg:hover:underline"
        >
          鍵盤快捷鍵
        </button>
      </nav>
    </footer>
  );
}

/**
 * 「回到頂端」（≥ lg）：捲過兩個視窗高之後才出現（頁面至少三個視窗高）。固定在右下角，放在 main 外面（R5）。
 * 判斷用 IntersectionObserver：文件頂端的 1px 哨兵，root 的上緣往上延伸兩個視窗高，哨兵離開就是捲過兩個視窗高。
 * 按下後捲回頂端，焦點移到頁面的 <h1>（按鈕會消失，焦點不能留在它上面掉到 body）。
 */
function BackToTop() {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setShow(!entry.isIntersecting);
      },
      { rootMargin: '200% 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };

  return (
    <>
      <span ref={sentinelRef} aria-hidden="true" className="pointer-events-none absolute top-0 left-0 h-px w-px" />
      {show && (
        <button
          type="button"
          onClick={toTop}
          className="fixed right-6 bottom-6 z-20 inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-lg hover:text-fg"
        >
          <ArrowUp aria-hidden="true" className="size-5" />
          <span className="sr-only">回到頂端</span>
        </button>
      )}
    </>
  );
}

/**
 * 快捷鍵說明的程式（lazy chunk）載入失敗時（網站剛重新部署、舊分頁的 chunk 不見了，或離線）：只在這裡顯示一個小對話框
 * 請學生重新整理，不讓錯誤往上拋到沒有錯誤邊界的地方、把整個畫面卸載（首頁的 ProgressBoundary 也是同一個理由）。
 * 每次打開說明都是新掛載的邊界；React.lazy 會記住失敗，所以重新整理之前再按也是這個對話框。
 */
class ShortcutHelpBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('鍵盤快捷鍵說明載入失敗', error, info.componentStack);
  }

  override render() {
    return this.state.failed ? <ShortcutHelpUnavailable onClose={this.props.onClose} /> : this.props.children;
  }
}

function ShortcutHelpUnavailable({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const onDialogClose = () => {
      if (!dialog.open) onClose();
    };
    dialog.addEventListener('close', onDialogClose);
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-5 text-fg shadow-lg backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        鍵盤快捷鍵
      </h2>
      <p className="mt-2 text-[0.95rem]">說明暫時載入不了，可能是網站剛更新。請重新整理頁面後再試一次。</p>
      <button
        type="button"
        onClick={() => ref.current?.close()}
        className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm font-medium hover:bg-surface-2"
      >
        關閉
      </button>
    </dialog>
  );
}

function PageLoading() {
  return (
    <p role="status" className="py-10 text-center text-muted">
      載入中…
    </p>
  );
}

export function Layout() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isDesktop = useIsDesktop();
  const pointerFine = useMediaQuery(MQ.pointerFine);
  const mode = desktopWidthMode(location.pathname);
  const sidebar = useSidebarState(location.pathname, isDesktop, pointerFine);
  // 收合只在有滑鼠或觸控板的裝置提供（iPad 橫向也是 1024，但沒有 hover，收合後只剩看不懂的圖示）。
  const canCollapse = isDesktop && pointerFine;
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  // 縮到 < lg 時說明對話框跟著卸載（只在桌機 render），卸載不會發 close 事件：這裡把狀態也關掉，
  // 否則放大回桌機時對話框會自己跳出來。
  useEffect(() => {
    if (!isDesktop) setHelpOpen(false);
  }, [isDesktop]);

  // 換頁後回到頂端：SPA 換頁不會自動捲動，停在上一頁的位置會讓人以為沒換頁。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // 全站快捷鍵（§8）：? 開說明、[ 收合／展開側邊欄。只在 ≥ lg 登記（R7）。
  const toggleSidebar = sidebar.toggle;
  const hotkeys = useMemo<HotkeyDef[]>(
    () => [
      { keys: ['?'], description: '開啟快捷鍵說明', group: '全站', run: openHelp },
      { keys: ['['], description: '收合／展開側邊欄', group: '全站', when: () => canCollapse, run: toggleSidebar },
    ],
    [openHelp, toggleSidebar, canCollapse],
  );
  useHotkeys(hotkeys, { enabled: isDesktop });

  // useCallback：MoreMenu 的 effect 依賴這兩個函式，每次重繪都換新函式會讓 effect 反覆重跑、焦點亂跳。
  const dismissMenu = useCallback(() => {
    setMenuOpen(false);
    moreButtonRef.current?.focus();
  }, []);
  const closeMenuAfterNavigate = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        跳到主要內容
      </a>
      {/* 登入後還沒同意條款或沒填年齡區間：導到 /account/welcome（features/account/RequireAccount.tsx）。 */}
      <OnboardingRedirect />
      <Sidebar
        sidebar={sidebar.state}
        canCollapse={canCollapse}
        onToggle={toggleSidebar}
        activePath={sidebarActivePath(location.pathname)}
        onOpenHelp={openHelp}
      />
      <TopBar />
      {/*
        ≥ lg：main 是 container（@container/main，分欄看它的內容寬，§2.2）、直排 flex 讓頁尾貼底；
        內容容器一定要 lg:w-full：flex 直排容器裡左右 margin: auto 的子元素不會被拉伸，會縮成內容寬度。
      */}
      <main
        id="main"
        ref={mainRef}
        className={`pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 ${sidebar.state === 'collapsed' ? 'lg:pl-16' : 'lg:pl-64'} lg:flex lg:min-h-dvh lg:flex-col lg:@container/main`}
      >
        <MainWidthProvider mainRef={mainRef} sidebar={sidebar.state}>
          <div className={`mx-auto max-w-5xl px-4 py-6 lg:w-full lg:flex-1 lg:px-(--page-px) ${MODE_CLASSES[mode]}`}>
            {/* key：換頁時重設錯誤邊界，上一頁的錯誤不會卡在下一頁。 */}
            <RouteErrorBoundary key={location.pathname}>
              <Suspense fallback={<PageLoading />}>
                <OpenShortcutHelpContext.Provider value={openHelp}>
                  <Outlet />
                </OpenShortcutHelpContext.Provider>
              </Suspense>
            </RouteErrorBoundary>
          </div>
          <SiteFooter mode={mode} onOpenHelp={openHelp} />
        </MainWidthProvider>
      </main>
      <BottomNav menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} moreButtonRef={moreButtonRef} />
      {menuOpen && <MoreMenu onDismiss={dismissMenu} onNavigate={closeMenuAfterNavigate} />}
      {isDesktop && <BackToTop />}
      {isDesktop && helpOpen && (
        <ShortcutHelpBoundary onClose={closeHelp}>
          <Suspense fallback={null}>
            <ShortcutHelp onClose={closeHelp} />
          </Suspense>
        </ShortcutHelpBoundary>
      )}
    </div>
  );
}
