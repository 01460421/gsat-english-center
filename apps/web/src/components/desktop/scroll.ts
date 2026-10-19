/**
 * 桌機的捲動與 sticky 工具（docs/design/desktop-ui.md §3.4、§4.10）。
 *
 * - scrollIntoPane：只捲元素所在的面板（[data-pane-scroll]，分欄時自己捲動的 Pane、分頁面板），不像 scrollIntoView
 *   連整頁一起捲；不在面板裡時才捲 window，並扣掉 sticky 工具列（--session-bar-h）、篩選列（--sticky-bar-h）
 *   與資料表 sticky 表頭（--table-head-h）的高度（和 index.css 的 scroll-padding-top 相同）。
 * - scrollAndFocus：先捲、後聚焦。一般的 focus() 會立刻再捲一次 window 與祖先容器，打斷剛開始的平滑捲動，
 *   停的位置也和 scrollIntoPane 算的不同，所以捲動之後的程式焦點移動一律用它（focus 帶 preventScroll）。
 * - useStickyHeightVar：ResizeObserver 量 sticky 元素的高度，寫進 CSS 變數給 html 的 scroll-padding-top、表頭的 top 用；
 *   只有改變時才寫（不在捲動事件裡讀寫版面），卸載時移除。measure 可以換掉量法（篩選列換成兩行時只算黏住的那一行）。
 */
import { useLayoutEffect, type RefObject } from 'react';

export type ScrollBlock = 'nearest' | 'center' | 'start';
export type StickyHeightVar = '--session-bar-h' | '--sticky-bar-h' | '--table-head-h' | '--ws-head-h';

/** 和 index.css 的 scroll-padding-top 一樣，在 sticky 列下方多留的空間。 */
const GAP_PX = 16;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function rootVarPx(name: StickyHeightVar): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/**
 * 捲動容器要捲到哪裡；不用捲時回傳 null。座標都是容器的內容座標（已加上目前的捲動量）：
 * scroll 是目前的捲動量、viewHeight 是可視高度、reserved 是上方被 sticky 列蓋住的高度。
 */
export function targetScroll(
  block: ScrollBlock,
  el: { top: number; bottom: number },
  view: { scroll: number; height: number; reserved: number },
): number | null {
  const visibleHeight = view.height - view.reserved;
  const alignTop = el.top - view.reserved;
  if (block === 'start') return alignTop;
  if (block === 'center') return (el.top + el.bottom) / 2 - view.reserved - visibleHeight / 2;
  if (el.top < view.scroll + view.reserved) return alignTop;
  if (el.bottom > view.scroll + view.height) {
    // 元素比可視範圍高時對齊頂端，至少看得到開頭。
    return el.bottom - el.top > visibleHeight ? alignTop : el.bottom - view.height;
  }
  return null;
}

export function scrollIntoPane(el: Element, opts: { block?: ScrollBlock } = {}): void {
  const block = opts.block ?? 'nearest';
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  const rect = el.getBoundingClientRect();
  const pane = el.parentElement?.closest('[data-pane-scroll]');
  if (pane instanceof HTMLElement) {
    const origin = pane.getBoundingClientRect().top + pane.clientTop - pane.scrollTop;
    const top = targetScroll(
      block,
      { top: rect.top - origin, bottom: rect.bottom - origin },
      { scroll: pane.scrollTop, height: pane.clientHeight, reserved: 0 },
    );
    if (top !== null) pane.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }
  const reserved = rootVarPx('--session-bar-h') + rootVarPx('--sticky-bar-h') + rootVarPx('--table-head-h') + GAP_PX;
  const top = targetScroll(
    block,
    { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY },
    { scroll: window.scrollY, height: window.innerHeight, reserved },
  );
  if (top !== null) window.scrollTo({ top: Math.max(0, top), behavior });
}

/** 先捲（scrollIntoPane）、後聚焦（preventScroll）。 */
export function scrollAndFocus(el: HTMLElement, opts: { block?: ScrollBlock } = {}): void {
  scrollIntoPane(el, opts);
  el.focus({ preventScroll: true });
}

/**
 * 把 ref 元素的高度寫進 CSS 變數 name。target：'root' 寫在 <html>（scroll-padding-top 要用的變數）、
 * 'parent' 寫在父元素（寫作工作區的 --ws-head-h 只給工作區自己用）。enabled 為 false（例如 < lg）時不量也不寫。
 * measure：要寫的高度怎麼算（預設是元素的外框高）；用 useCallback 固定。
 * 第一次在 layout effect 裡同步寫入，第一個畫面就正確；之後 ResizeObserver 的回呼也在繪製前執行，不會跳動。
 */
export function useStickyHeightVar(
  ref: RefObject<HTMLElement | null>,
  name: StickyHeightVar,
  opts: { enabled: boolean; target?: 'root' | 'parent'; measure?: (el: HTMLElement) => number },
): void {
  const { enabled, target = 'root', measure } = opts;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const host = target === 'root' ? document.documentElement : el.parentElement;
    if (!host) return;
    let last = -1;
    const write = (height: number) => {
      const px = Math.round(height);
      if (px === last) return;
      last = px;
      host.style.setProperty(name, `${px}px`);
    };
    write(measure ? measure(el) : el.getBoundingClientRect().height);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            write(measure ? measure(el) : (entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height));
          });
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      host.style.removeProperty(name);
    };
  }, [ref, name, enabled, target, measure]);
}
