/**
 * 學習模組頁的共用外殼：標題、「開發中」標記、一句話說明，以及各頁自己的說明內容。
 * 模組實作完成後，頁面可以繼續用這個外殼，只把 children 換成實際功能，並把 modules.ts 的 status 改成 'ready'。
 */
import { useId, type ReactNode } from 'react';
import { documentTitle, isDevPage, type PageMeta } from '../modules';
import { PageIcon } from './icons';

export function DevBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">
      開發中
    </span>
  );
}

/** 頁面標題列。<title> 由 React 19 自動移到 <head>，每頁各自宣告，不需要額外的套件。 */
export function PageHeader({ page }: { page: PageMeta }) {
  return (
    <header className="mb-6">
      <title>{documentTitle(page)}</title>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <PageIcon icon={page.icon} className="size-6" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{page.title}</h1>
        {isDevPage(page) && <DevBadge />}
      </div>
      <p className="mt-3 text-muted">{page.summary}</p>
    </header>
  );
}

/**
 * 說明區塊：標題＋內文，模組頁用來寫考試說明、現在能怎麼練習等。
 * 區塊用標題命名（aria-labelledby），螢幕閱讀器的地標清單與測試都能用標題找到這一區。
 */
export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-[0.95rem] [&_ol]:space-y-1 [&_ol>li]:ml-5 [&_ol>li]:list-decimal [&_ul]:space-y-1 [&_ul>li]:ml-5 [&_ul>li]:list-disc">{children}</div>
    </section>
  );
}

export function ModulePage({ page, children }: { page: PageMeta; children: ReactNode }) {
  return (
    <article>
      <PageHeader page={page} />
      {isDevPage(page) && (
        <p className="mb-6 rounded-xl border border-dashed border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          這個模組還在開發中，目前只有功能說明，練習功能會陸續上線。
        </p>
      )}
      {/*
        grid-cols-1 是 minmax(0, 1fr)：預設的隱含欄寬是 auto，會被內容的最小寬度撐開（例如模擬考頁的配分表），
        區塊裡的 overflow-x-auto 就失效，整頁在 320px 寬（WCAG 1.4.10 重排的基準）出現水平捲動。
      */}
      <div className="grid grid-cols-1 gap-4">{children}</div>
    </article>
  );
}
