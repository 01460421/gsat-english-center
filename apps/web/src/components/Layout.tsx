/**
 * 全站版面（手機優先）。
 *
 *   手機（< lg）：頂端列（站名＋主題切換）＋內容＋底部導覽（4 個常用頁＋「更多」）。
 *                 頁面一共 14 個，全部塞進底部會擠到點不準，所以其他頁收進「更多」面板。
 *   桌機（≥ lg）：左側固定側邊欄列出全部頁面（依 modules.ts 的 NAV_GROUPS 分組），沒有底部導覽。
 *
 * 頁面元件是按需載入的，Suspense 與錯誤邊界只包住內容區：載入中或載入失敗時導覽列仍可操作。
 */
import { Ellipsis, X } from 'lucide-react';
import { Suspense, useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { APP_NAME, BOTTOM_NAV_PATHS, NAV_GROUPS, PAGES, type PageMeta } from '../modules';
import { PageIcon } from './icons';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { ThemeToggle } from './ThemeToggle';

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2 font-bold tracking-tight">
      <img src="/icon.svg" alt="" width={28} height={28} className="size-7" />
      <span>{APP_NAME}</span>
    </NavLink>
  );
}

function SidebarLink({ page }: { page: PageMeta }) {
  return (
    <NavLink
      to={page.path}
      end={page.path === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] ${
          isActive ? 'bg-primary-soft font-semibold text-primary' : 'text-fg hover:bg-surface-2'
        }`
      }
    >
      <PageIcon icon={page.icon} className="size-5 shrink-0" />
      <span className="truncate">{page.navLabel}</span>
    </NavLink>
  );
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-16 shrink-0 items-center justify-between px-5">
        <Brand />
        <ThemeToggle />
      </div>
      <nav aria-label="主要導覽" className="flex-1 overflow-y-auto px-3 pb-6">
        {NAV_GROUPS.map((group) => {
          const pages = PAGES.filter((p) => p.group === group.id);
          return (
            <div key={group.id} className="mt-4 first:mt-1">
              {group.label && <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted">{group.label}</p>}
              <ul className="space-y-0.5">
                {pages.map((page) => (
                  <li key={page.path}>
                    <SidebarLink page={page} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
      <Brand />
      <ThemeToggle />
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

  // 換頁後回到頂端：SPA 換頁不會自動捲動，停在上一頁的位置會讓人以為沒換頁。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
      <Sidebar />
      <TopBar />
      <main id="main" className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-64">
        <div className="mx-auto max-w-5xl px-4 py-6 lg:px-10 lg:py-10">
          {/* key：換頁時重設錯誤邊界，上一頁的錯誤不會卡在下一頁。 */}
          <RouteErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </div>
      </main>
      <BottomNav menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} moreButtonRef={moreButtonRef} />
      {menuOpen && <MoreMenu onDismiss={dismissMenu} onNavigate={closeMenuAfterNavigate} />}
    </div>
  );
}
