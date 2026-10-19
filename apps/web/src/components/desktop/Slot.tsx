/**
 * 桌機版面把「同一份」元件搬到別的位置（docs/design/desktop-ui.md §2.1 R3、R4）：例如題型頁的難度切換放進頁首右邊、
 * 寫作題目列表的篩選膠囊放進 sticky 篩選列。不 render 兩份（有狀態、id、可存取名稱的東西同時只能有一份），
 * 而是用 createPortal 把唯一的那一份放進目標元素；目標放在畫面上要的位置，DOM 順序＝畫面順序，Tab 順序跟著走。
 *
 *   const [target, targetRef] = useSlotTarget();            // 目標元素（callback ref；掛上之前是 null）
 *   <SlotProvider name="kind-filter" target={target}>…      // 只在桌機提供（手機不提供，元件原地 render，DOM 和原本一樣）
 *   <div ref={targetRef} />                                  // 放在桌機版面要的位置
 *   <InSlot name="kind-filter"><KindFilter … /></InSlot>     // 沒有人提供：原地；有但目標還沒掛上：先不顯示；否則搬過去
 *
 * 目標在 commit 時由 callback ref 設好，setState 在繪製前同步重繪，所以不會先在原地閃一下。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Slots = Readonly<Record<string, HTMLElement | null>>;

const SlotsContext = createContext<Slots>({});

export function useSlotTarget(): [HTMLElement | null, (el: HTMLElement | null) => void] {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return [target, setTarget];
}

/** 提供一個具名的位置（和外層提供的位置合併）。enabled 為 false 時不提供（InSlot 原地 render）。 */
export function SlotProvider({ name, target, enabled = true, children }: { name: string; target: HTMLElement | null; enabled?: boolean; children: ReactNode }) {
  const parent = useContext(SlotsContext);
  const value = useMemo(() => {
    if (enabled) return { ...parent, [name]: target };
    if (!(name in parent)) return parent;
    return Object.fromEntries(Object.entries(parent).filter(([key]) => key !== name));
  }, [parent, name, target, enabled]);
  return <SlotsContext.Provider value={value}>{children}</SlotsContext.Provider>;
}

export function InSlot({ name, children }: { name: string; children: ReactNode }) {
  const slots = useContext(SlotsContext);
  if (!(name in slots)) return <>{children}</>;
  const target = slots[name];
  return target ? createPortal(children, target) : null;
}

/** 這個位置有沒有人提供（元件在桌機與手機要用不同外觀時用）。 */
export function useInSlot(name: string): boolean {
  return name in useContext(SlotsContext);
}
