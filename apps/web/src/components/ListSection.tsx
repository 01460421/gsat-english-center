/**
 * 題型頁的題目區與頁內連結：中譯英、英文作文題型頁（pages/TranslationPage.tsx、pages/CompositionPage.tsx）用來分開
 * 「本站仿真題」與「歷屆試題」兩份列表。和 ModulePage.tsx 分開放，只有這兩頁的 chunk 會載入，首頁與共用的主程式不會變大。
 */
import { ArrowDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';

/**
 * 題目區：<h2> 標題＋題目列表（列表本身就是一張張卡片，這一區不再包一層框）。中譯英、英文作文題型頁用來分開
 * 「本站仿真題」與「歷屆試題」兩份列表；區塊同樣用標題命名。id 給頁內連結用，scroll-mt 讓手機頂端固定的站名列（h-14）
 * 不蓋住標題。aside 放在標題同一列的右邊（例如「跳到歷屆試題」：手機上第一份列表很長，第二份要捲很久才看得到）。
 */
export function ListSection({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} className="min-w-0 scroll-mt-16 space-y-3 lg:scroll-mt-4">
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
