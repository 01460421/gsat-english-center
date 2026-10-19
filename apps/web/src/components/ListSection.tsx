/**
 * 題型頁的題目區與頁內連結：中譯英、英文作文題型頁（pages/TranslationPage.tsx、pages/CompositionPage.tsx）用來分開
 * 「本站仿真題」與「歷屆試題」兩份列表。和 ModulePage.tsx 分開放，只有這兩頁的 chunk 會載入，首頁與共用的主程式不會變大。
 */
import { ArrowDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { scrollIntoPane } from './desktop/scroll';
import { StickyBar } from './desktop/StickyBar';

/**
 * 題目區：<h2> 標題＋題目列表（列表本身就是一張張卡片，這一區不再包一層框）。中譯英、英文作文題型頁用來分開
 * 「本站仿真題」與「歷屆試題」兩份列表；區塊同樣用標題命名。id 給頁內連結用，scroll-mt 讓手機頂端固定的站名列（h-14）
 * 不蓋住標題；桌機的 sticky 篩選列由 html 的 scroll-padding-top 扣掉（index.css），這裡只留一點間距（lg:scroll-mt-2）。
 * aside 放在標題同一列的右邊（例如「跳到歷屆試題」：手機上第一份列表很長，第二份要捲很久才看得到）。
 */
export function ListSection({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} className="min-w-0 scroll-mt-16 space-y-3 lg:scroll-mt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 id={titleId} className="text-xl font-bold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** 頁內連結（往下捲到同一頁的另一區），放在 ListSection 的 aside。 */
export function JumpLink({ href, children }: { href: `#${string}`; children: ReactNode }) {
  return (
    <a href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
      {children}
      <ArrowDown aria-hidden="true" className="size-4" />
    </a>
  );
}

/**
 * 桌機（≥ lg）的題型頁 sticky 篩選列（docs/design/desktop-ui.md §5.4，只在 ≥ lg render）：頁內跳轉（本站仿真題、自訂題目、歷屆試題）
 * 放左邊，右邊一格給歷屆試題的「學測／指考／參考試卷」篩選（列表本體用 InSlot 把同一份篩選搬進來，每個選項附筆數）。
 * 原本標題列右邊的「跳到…」連結在桌機樹裡不 render（同一組連結不出現兩份）。
 * 篩選在整頁共用的列上，只篩下面的「歷屆試題」：前面加看得到的標籤 filterLabel（aria-hidden，讀屏聽的是篩選自己的 legend
 * 「歷屆試題的考試」，不重複唸）；篩選還沒載入時標籤也不顯示。main 不到 ws（1024 寬）時膠囊改小，列維持一行。
 */
export function ListJumpBar({
  links,
  slotRef,
  filterLabel,
}: {
  links: ReadonlyArray<{ href: `#${string}`; label: string }>;
  slotRef: (el: HTMLElement | null) => void;
  filterLabel?: string;
}) {
  return (
    <StickyBar className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <nav aria-label="頁內跳轉">
        <ul className="flex flex-wrap gap-x-5">
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-2 hover:underline">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="ml-auto flex min-w-0 items-center gap-2 [&:not(:has(fieldset))]:hidden @max-ws/main:[&_label]:px-2.5 @max-ws/main:[&_label]:py-1 @max-ws/main:[&_label]:text-xs">
        {filterLabel && (
          <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-muted">
            {filterLabel}
          </span>
        )}
        <div ref={slotRef} className="min-w-0" />
      </div>
    </StickyBar>
  );
}

/**
 * 題型頁的桌機版改了篩選之後：篩選在頂端的篩選列，被篩的「歷屆試題」區常常在一千多 px 以下，畫面上看不出有變化。
 * 這一區的標題不在畫面裡時把它捲到篩選列下方（scrollIntoPane 扣掉 sticky 列的高度）；焦點留在篩選上，方向鍵可以繼續換。
 */
export function revealListSection(id: string) {
  requestAnimationFrame(() => {
    const section = document.getElementById(id);
    if (!section) return;
    const heading = section.querySelector('h2') ?? section;
    const box = heading.getBoundingClientRect();
    const reserved = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (box.top >= reserved && box.bottom <= window.innerHeight) return;
    scrollIntoPane(section, { block: 'start' });
  });
}
