/**
 * 首頁：後端連線狀態、學習進度與各模組入口卡片。
 *
 * 學習進度只統計這台裝置的瀏覽器裡已經存著的紀錄（單字每日學習、題庫練習、單字錯題本），不下載資料檔；
 * 內容（features/progress/ProgressStats.tsx）按需載入，理由見該檔檔頭。載入失敗（例如網站剛更新、舊分頁的 chunk 不見了）
 * 只有這一區顯示提示，首頁其他部分照常。
 */
import { ChevronRight } from 'lucide-react';
import { Component, Suspense, lazy, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BackendStatus } from '../components/BackendStatus';
import { PageIcon } from '../components/icons';
import { DevBadge } from '../components/ModulePage';
import { APP_NAME, NAV_GROUPS, PAGES, documentTitle, getPage, isDevPage } from '../modules';

const home = getPage('/');

const ProgressStats = lazy(() => import('../features/progress/ProgressStats'));

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

export default function HomePage() {
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

      {NAV_GROUPS.filter((g) => g.label && PAGES.some((p) => p.group === g.id && p.isStudyModule)).map((group) => (
        <section key={group.id} aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`} className="mb-3 text-lg font-semibold">
            {group.label}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PAGES.filter((p) => p.group === group.id && p.isStudyModule).map((page) => (
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
