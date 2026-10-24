/**
 * 作文範文頁的分頁（ARIA tabs：role="tablist"／"tab"／"tabpanel"、左右方向鍵與 Home／End 切換並聚焦、roving tabindex）。
 * 首頁的「輸入題目｜選網站上的題目」與結果頁逐篇檢視的「基礎版｜穩健版｜頂標版」共用；手機與桌機同一棵樹。
 * 面板全部保持掛載（表單的內容不會因為切換而消失），沒選的加 hidden。目前的分頁有底線、粗體與 aria-selected，不只靠顏色（R11）。
 * 觸控目標 ≥ 44 px（min-h-11）；沒有切換動畫（prefers-reduced-motion 不用另外處理）。
 */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

export function Tabs({
  label,
  tabs,
  value,
  onChange,
  panelClassName = 'pt-4',
}: {
  /** tablist 的可存取名稱。 */
  label: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  panelClassName?: string;
}) {
  const base = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    const tab = tabs[next];
    if (!tab) return;
    e.preventDefault();
    onChange(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-4 text-[0.95rem] ${
                selected ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted lg:hover:text-fg'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" id={panelId(tab.id)} aria-labelledby={tabId(tab.id)} hidden={tab.id !== value} className={panelClassName}>
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
