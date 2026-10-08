/**
 * 首頁：後端連線狀態、學習進度（占位）與各模組入口卡片。
 * 學習進度要等登入與作答紀錄（D1）完成才有資料，先放占位說明，版面先決定好位置。
 */
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { BackendStatus } from '../components/BackendStatus';
import { PageIcon } from '../components/icons';
import { DevBadge } from '../components/ModulePage';
import { APP_NAME, NAV_GROUPS, PAGES, documentTitle, getPage } from '../modules';

const home = getPage('/');

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
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="progress-heading" className="text-lg font-semibold">
            學習進度
          </h2>
          <DevBadge />
        </div>
        <p className="mt-2 text-muted">登入與作答紀錄完成後，這裡會顯示：</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ['今日待複習單字', '依間隔重複排程，到期的單字會出現在這裡'],
            ['各題型答對率', '詞彙、綜合測驗、文意選填等分開統計'],
            ['弱點分析', '錯題依考點（搭配詞、轉折詞、文法…）歸類'],
          ].map(([label, hint]) => (
            <li key={label} className="rounded-xl bg-surface-2 p-4">
              <p className="text-2xl font-bold text-muted" aria-hidden="true">
                —
              </p>
              <p className="mt-1 font-medium">{label}</p>
              <p className="text-sm text-muted">{hint}</p>
            </li>
          ))}
        </ul>
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
                      {page.status === 'dev' && <DevBadge />}
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
