/**
 * 首頁：後端連線狀態、學習進度與各模組入口卡片。
 *
 * 學習進度只統計這台裝置的瀏覽器裡已經存著的紀錄（單字每日學習、題庫練習、單字錯題本），不下載資料檔；
 * 內容（features/progress/ProgressStats.tsx）按需載入，理由見該檔檔頭。載入失敗（例如網站剛更新、舊分頁的 chunk 不見了）
 * 只有這一區顯示提示，首頁其他部分照常。
 *
 * 桌機 main ≥ 58.5rem（ws 寬度，docs/design/desktop-ui.md §5.1）改成儀表板：頁首（登入後加問候）＋按需載入的
 * features/home/DesktopDashboard.tsx（繼續學習、全部功能、右欄的學習進度與後端狀態）。不到 ws 寬度時是下面原本的 JSX，一字不改。
 * 首頁沒有輸入框，依 useMainTier().ws 換樹不會弄丟焦點（§2.1 R4）。「全部功能」只用 PAGES，留在這個檔案：
 * HomePage 打包在主程式裡，不能把寫作、模擬考、練習的模組拉進來（那些都在儀表板的 chunk）。
 */
import { ChevronRight } from 'lucide-react';
import { Component, Suspense, lazy, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BackendStatus } from '../components/BackendStatus';
import { PageIcon } from '../components/icons';
import { DevBadge } from '../components/ModulePage';
import { signedIn, useMe } from '../lib/api';
import { useMainTier } from '../lib/media';
import { usePageFeatureFlags } from '../features/assistant/lib/useAssistantEnabled';
import { APP_NAME, NAV_GROUPS, documentTitle, getPage, isDevPage, navPages, type PageMeta } from '../modules';

const home = getPage('/');

const ProgressStats = lazy(() => import('../features/progress/ProgressStats'));
const DesktopDashboard = lazy(() => import('../features/home/DesktopDashboard'));

class ProgressBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('首頁學習進度載入失敗', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return <p className="mt-3 text-sm text-muted">暫時讀不到學習紀錄，請重新整理頁面再試一次。</p>;
  }
}

/** 載入中：先排好三格的位置，載入後版面不會大幅跳動。 */
function ProgressPlaceholder() {
  return (
    <div className="mt-3">
      <p role="status" className="sr-only">
        讀取學習紀錄中…
      </p>
      <ul aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-28 rounded-xl bg-surface-2" />
        ))}
      </ul>
    </div>
  );
}

/**
 * 有群組標題、而且有學習模組的群組，以及每個群組的學習模組（首頁卡片與「全部功能」共用）。
 * 在元件裡依功能開關算（docs/design/learning-assistant.md §5.1）：學習助手的開關關著時不列它，畫面和沒有這一頁時相同。
 */
function useHomeGroups(): { id: string; label: string; pages: PageMeta[] }[] {
  const flags = usePageFeatureFlags();
  return useMemo(() => {
    const modules = navPages(flags).filter((p) => p.isStudyModule);
    return NAV_GROUPS.flatMap((g) => {
      const pages = modules.filter((p) => p.group === g.id);
      return g.label && pages.length > 0 ? [{ id: g.id, label: g.label, pages }] : [];
    });
  }, [flags.assistant]);
}

/**
 * 儀表板左欄的「全部功能」：依群組排的精簡列表（32px 圖示＋標題＋一行說明，完整說明放 title；連結的可存取名稱和卡片相同）。
 * CSS 多欄（columns-2，群組不拆開）照 DOM 順序自然分成兩欄；wide 寬度（main ≥ 80rem）一個群組一欄。
 */
function AllFeatures() {
  const groups = useHomeGroups();
  return (
    <section aria-labelledby="all-features-heading">
      <h2 id="all-features-heading" className="mb-3 text-lg font-semibold">
        全部功能
      </h2>
      <div className="columns-2 gap-x-6 @wide/main:grid @wide/main:grid-cols-4 @wide/main:gap-x-4">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="mb-4 break-inside-avoid">
            <h3 id={`group-${group.id}`} className="mb-1 px-2 text-sm font-semibold text-muted">
              {group.label}
            </h3>
            <ul>
              {group.pages.map((page) => (
                <li key={page.path} className="min-w-0">
                  <Link to={page.path} title={page.summary} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <PageIcon icon={page.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold group-hover:text-primary">{page.title}</span>
                        {isDevPage(page) && <DevBadge />}
                      </span>
                      <span className="line-clamp-1 text-sm text-muted">{page.summary}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

/** 儀表板載入失敗（網站剛更新、舊分頁的 chunk 不見了）：只顯示「全部功能」與提示，首頁其他部分照常。 */
class DashboardBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('首頁儀表板載入失敗', error, info.componentStack);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** 儀表板載入中：先佔好左欄與右欄的高度，載入後版面不會大幅跳動。 */
function DashboardPlaceholder() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-8">
      <p role="status" className="sr-only">
        讀取學習紀錄中…
      </p>
      <div aria-hidden="true" className="h-96 rounded-2xl bg-surface-2" />
      <div aria-hidden="true" className="h-72 rounded-2xl bg-surface-2" />
    </div>
  );
}

/**
 * 桌機 ws 寬度起的首頁（放寬到 82rem，§2.3）。H1 上面的問候一律佔一行：/api/me 回來之前、沒登入時是「今天練什麼？」，
 * 登入後換成「小明，今天練什麼？」——只換字、不多出一行，儀表板不會在 /api/me 回來之後整個往下跳（§5.1「載入後不推動版面」）。
 */
function DesktopHome() {
  const { me } = useMe();
  const user = signedIn(me)?.user;
  return (
    // text-pretty：右欄只有 20rem，段落最後一行不要只剩一兩個字（「…開始／吧」）。
    <div className="bleed space-y-6 text-pretty">
      <title>{documentTitle(home)}</title>
      <header>
        <p className="max-w-3xl text-lg font-medium text-primary">{user?.display_name ? `${user.display_name}，今天練什麼？` : '今天練什麼？'}</p>
        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="mt-2 max-w-3xl text-muted">{home.summary}</p>
      </header>
      <DashboardBoundary
        fallback={
          <div className="space-y-6">
            <p className="text-sm text-muted">暫時讀不到學習紀錄，請重新整理頁面再試一次。</p>
            <AllFeatures />
          </div>
        }
      >
        <Suspense fallback={<DashboardPlaceholder />}>
          <DesktopDashboard allFeatures={<AllFeatures />} />
        </Suspense>
      </DashboardBoundary>
    </div>
  );
}

export default function HomePage() {
  const { ws } = useMainTier();
  return ws ? <DesktopHome /> : <HomeCards />;
}

/** 原本的首頁（手機、平板、不到 ws 寬度的桌機）。 */
function HomeCards() {
  const groups = useHomeGroups();
  return (
    <div className="space-y-8">
      <title>{documentTitle(home)}</title>
      <section>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{APP_NAME}</h1>
        <p className="mt-2 text-muted">
          為台灣高中生打造的學測英文備考 App：從大考中心參考詞彙表的單字開始，到各題型練習、歷屆試題與限時模擬考。
        </p>
        <div className="mt-4">
          <BackendStatus />
        </div>
      </section>

      <section aria-labelledby="progress-heading" className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="progress-heading" className="text-lg font-semibold">
            學習進度
          </h2>
          <p className="text-sm text-muted">只統計這台裝置的瀏覽器裡的紀錄</p>
        </div>
        <ProgressBoundary>
          <Suspense fallback={<ProgressPlaceholder />}>
            <ProgressStats />
          </Suspense>
        </ProgressBoundary>
      </section>

      {groups.map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`} className="mb-3 text-lg font-semibold">
            {group.label}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.pages.map((page) => (
              <li key={page.path} className="min-w-0">
                <Link
                  to={page.path}
                  className="group flex h-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-primary"
                >
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <PageIcon icon={page.icon} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{page.title}</span>
                      {isDevPage(page) && <DevBadge />}
                    </span>
                    <span className="mt-1 block text-sm text-muted">{page.summary}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-2 size-4 shrink-0 text-muted group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
