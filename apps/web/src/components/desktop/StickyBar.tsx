/**
 * 列表頁的 sticky 篩選列（docs/design/desktop-ui.md §3.3、§4.7）：篩選膠囊、頁內跳轉、筆數放在這裡，捲動後仍看得到。
 * 只在 ≥ lg 黏住（全部樣式帶 lg: 前綴），撐滿內容區（--page-px），並把自己的高度寫進 <html> 的 --sticky-bar-h，給：
 *   - html 的 scroll-padding-top：Tab、錨點跳轉時內容不會被篩選列蓋住（WCAG 2.4.11）；
 *   - DataTable 的 sticky 表頭的 top；/words 篩選欄的 top 與 max-h。
 *
 * 兩種用法：包一個新的桌機元素（<StickyBar>），或把 STICKY_BAR_CLASS 與 useStickyBar 加在原本就存在的篩選容器上
 * （只加 lg: class，手機像素不變，R1）。
 *
 * collapseFirstLine（寫作題目列表的 WritingListBar）：寬度不夠、列換成兩行時（1024 寬：返回連結＋標題＋來源分頁一行、
 * 篩選一行，共約 115px，是 600 高的視窗的五分之一），第一行跟著頁面捲走，只有最後一行黏在頂端：sticky 的 top 是負的
 * 「第一個子元素到最後一個子元素的距離」（--sticky-bar-hide，量的時候寫在列上），--sticky-bar-h 只算黏住時看得到的高度。
 * 鍵盤焦點進到第一行（[data-bar-head] 裡的 :focus-visible）時整條列回到 top: 0，焦點不會停在畫面外。一行放得下時兩者都是 0。
 */
import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import { useIsDesktop } from '../../lib/media';
import { useStickyHeightVar } from './scroll';

const STICKY_BAR_BASE = 'lg:sticky lg:z-10 lg:-mx-(--page-px) lg:border-b lg:border-line lg:bg-bg/95 lg:px-(--page-px) lg:py-2 lg:backdrop-blur';
export const STICKY_BAR_CLASS = `lg:top-0 ${STICKY_BAR_BASE}`;
const COLLAPSING_TOP = 'lg:top-[calc(-1*var(--sticky-bar-hide,0px))] lg:has-[[data-bar-head]_:focus-visible]:top-0';

/** 換成兩行時第一行要捲走多少（第一個與最後一個子元素的上緣距離）；同一行時是 0。順便寫進列上的 --sticky-bar-hide。 */
export function measureCollapsingBar(el: HTMLElement): number {
  const first = el.firstElementChild;
  const last = el.lastElementChild;
  const hide = first && last && first !== last ? Math.max(0, Math.round(last.getBoundingClientRect().top - first.getBoundingClientRect().top)) : 0;
  el.style.setProperty('--sticky-bar-hide', `${hide}px`);
  return el.getBoundingClientRect().height - hide;
}

/** 在 ≥ lg 把 ref 元素的高度寫進 --sticky-bar-h（卸載時移除）。 */
export function useStickyBar(ref: RefObject<HTMLElement | null>, opts: { collapseFirstLine?: boolean } = {}) {
  const isDesktop = useIsDesktop();
  const measure = useCallback(measureCollapsingBar, []);
  useStickyHeightVar(ref, '--sticky-bar-h', { enabled: isDesktop, measure: opts.collapseFirstLine ? measure : undefined });
}

export function StickyBar({
  children,
  className = '',
  label,
  collapseFirstLine = false,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  collapseFirstLine?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyBar(ref, { collapseFirstLine });
  const top = collapseFirstLine ? `${COLLAPSING_TOP} ${STICKY_BAR_BASE}` : STICKY_BAR_CLASS;
  return (
    <div ref={ref} role={label ? 'region' : undefined} aria-label={label} data-sticky-bar="" className={`${top} ${className}`}>
      {children}
    </div>
  );
}
