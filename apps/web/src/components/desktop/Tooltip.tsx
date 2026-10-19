/**
 * 側邊欄的文字提示泡泡（docs/design/desktop-ui.md §3.2）：收合成圖示欄、或只有圖示的按鈕，滑鼠移入或鍵盤聚焦
 * （:focus-visible）時在旁邊顯示該項的文字。不用 title：title 在鍵盤聚焦時不會出現，觸控也看不到。
 *
 * 整個容器共用一個泡泡元素：容器上掛事件委派（useTooltipTarget），讀最近的 [data-tip]（文字）與 [data-tip-side]
 * （'right'，預設，或 'top'）。泡泡是 position: fixed，位置用該項的 getBoundingClientRect() 算——清單是捲動容器，
 * 放在項目裡的 absolute 提示會被裁掉。泡泡 aria-hidden：可存取名稱本來就在項目上（sr-only 文字或 aria-label）。
 * WCAG 1.4.13：任何時候按 Esc 都收起（焦點不在側邊欄裡也一樣，監聽掛在 document）；滑鼠可以移到泡泡上而不消失
 * （泡泡在容器的 DOM 裡，往項目那一側多一條透明的橋，蓋住中間 8px 的空隙）。浮層樣式一律有框線（R11）。只在 ≥ lg render。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

export type TooltipSide = 'right' | 'top';

export interface TooltipTarget {
  text: string;
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  side: TooltipSide;
}

const GAP = 8;
const EDGE = 4;

export function Tooltip({ target }: { target: TooltipTarget | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!target || !el) {
      setPos(null);
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const { rect, side } = target;
    let left = side === 'right' ? rect.right + GAP : rect.left + rect.width / 2 - width / 2;
    let top = side === 'right' ? rect.top + rect.height / 2 - height / 2 : rect.top - GAP - height;
    left = Math.min(Math.max(EDGE, left), window.innerWidth - width - EDGE);
    top = Math.min(Math.max(EDGE, top), window.innerHeight - height - EDGE);
    setPos({ left, top });
  }, [target]);

  if (!target) return null;
  // 透明的橋（::before）從泡泡往項目那一側延伸 GAP，滑鼠移過空隙時不會離開泡泡＋項目的範圍。
  const bridge =
    target.side === 'right' ? 'before:absolute before:inset-y-0 before:-left-2 before:w-2' : 'before:absolute before:inset-x-0 before:-bottom-2 before:h-2';
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="sidebar-tooltip"
      data-tooltip-bubble=""
      className={`fixed z-40 rounded-lg border border-line bg-surface px-2.5 py-1 text-sm whitespace-nowrap text-fg shadow-lg ${bridge}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {target.text}
    </div>
  );
}

function targetOf(el: Element | null): TooltipTarget | null {
  const item = el?.closest<HTMLElement>('[data-tip]');
  const text = item?.dataset['tip'];
  if (!item || !text || !item.isConnected) return null;
  const r = item.getBoundingClientRect();
  const side: TooltipSide = item.dataset['tipSide'] === 'top' ? 'top' : 'right';
  return { text, side, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } };
}

/**
 * 容器的事件委派：回傳目前要顯示的提示、要掛在容器上的事件處理，以及 hide／refresh。enabled 為 false 時一律沒有提示。
 * 滑鼠移入顯示、移出容器（含泡泡）或移到沒有 data-tip 的地方收起；鍵盤聚焦（:focus-visible）顯示、失焦收起；Esc 收起。
 * refresh：項目的文字或位置變了（例如收合側邊欄之後，同一顆按鈕變成「展開側邊欄」、移到左邊）時重新讀一次。
 */
export function useTooltipTarget(enabled: boolean) {
  const [target, setTarget] = useState<TooltipTarget | null>(null);
  const itemRef = useRef<Element | null>(null);
  const show = useCallback((el: Element | null) => {
    itemRef.current = el;
    setTarget(targetOf(el));
  }, []);
  const hide = useCallback(() => {
    itemRef.current = null;
    setTarget(null);
  }, []);
  const refresh = useCallback(() => {
    setTarget((current) => (current ? targetOf(itemRef.current) : current));
  }, []);

  // Esc：焦點不在容器裡（例如滑鼠停在圖示上、焦點在主要內容）也要收得起來。
  const visible = enabled && target !== null;
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [visible, hide]);

  const handlers = {
    onPointerOver: (e: PointerEvent) => {
      if (!enabled || e.pointerType === 'touch') return;
      const el = e.target instanceof Element ? e.target : null;
      // 移到泡泡上（含透明的橋）：保留目前的提示。
      if (el?.closest('[data-tooltip-bubble]')) return;
      show(el);
    },
    onPointerLeave: hide,
    onFocus: (e: FocusEvent) => {
      if (!enabled || !(e.target instanceof Element) || !e.target.matches(':focus-visible')) return;
      show(e.target);
    },
    onBlur: hide,
  };
  return { target: enabled ? target : null, handlers, hide, refresh };
}
