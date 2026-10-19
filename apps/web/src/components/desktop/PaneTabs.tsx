/**
 * 面板裡的分頁（docs/design/desktop-ui.md §4.6）：寫作工作區左欄的「題目／自我檢核與自評／評分規準…」。
 *
 * - 真正的 tablist：左右方向鍵、Home／End 切換並聚焦（自動啟用），roving tabindex（只有目前的分頁可以 Tab 進來）。
 * - 分頁列在捲動容器外面：結構是「分頁列 → 面板」，scrollPanels（分欄時）每個 tabpanel 自己是捲動容器
 *   （flex-1 min-h-0 overflow-y-auto），分頁列永遠看得到，不需要 sticky。
 * - 面板保持掛載（勾選、輸入不會消失）；每個分頁各自記住捲動位置：切走時記下 scrollTop、切回來時還原
 *   （隱藏的捲動容器可能被瀏覽器重設捲動位置，所以不依賴瀏覽器）。
 * - Ctrl＋F 找得到隱藏分頁裡的字：隱藏的面板用 hidden="until-found"，瀏覽器找到其中的字時發 beforematch，
 *   這時切到那個分頁。不支援的瀏覽器把它當成一般的 hidden（＝現在的行為）。
 * - ref.select(id)：給「在作文中標出」、同名的「自我檢核與自評（不用 AI）」按鈕這類程式切換。
 * 只在桌機的樹裡用。
 */
import { useId, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';

export interface PaneTab {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
  panel: ReactNode;
}

export interface PaneTabsHandle {
  select(id: string): void;
}

export interface PaneTabsProps {
  tabs: PaneTab[];
  value: string;
  onChange: (id: string) => void;
  /** tablist 的名稱。 */
  label: string;
  /** 分欄時 true：每個面板自己捲動（外層要是有高度的 flex 直排容器）。 */
  scrollPanels?: boolean;
  /** 面板元素的 id（沿用既有的錨點，例如 essay-self）；沒給時自動產生。 */
  panelId?: (tabId: string) => string | undefined;
  ref?: Ref<PaneTabsHandle>;
}

export function PaneTabs({ tabs, value, onChange, label, scrollPanels = false, panelId, ref }: PaneTabsProps) {
  const base = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollMemory = useRef(new Map<string, number>());
  const shown = useRef(value);

  const tabDomId = (id: string) => `${base}-tab-${id}`;
  const panelDomId = (id: string) => panelId?.(id) ?? `${base}-panel-${id}`;

  const change = (id: string) => {
    if (id === value || !tabs.some((t) => t.id === id)) return;
    const current = panelRefs.current.get(value);
    if (current) scrollMemory.current.set(value, current.scrollTop);
    onChange(id);
  };

  useImperativeHandle(ref, () => ({ select: change }));

  // 隱藏的面板用 hidden="until-found"（React 的 hidden 是布林屬性，所以直接設屬性），並在切換後還原捲動位置。
  useLayoutEffect(() => {
    for (const [id, panel] of panelRefs.current) {
      if (id === value) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', 'until-found');
    }
    if (shown.current !== value) {
      shown.current = value;
      const panel = panelRefs.current.get(value);
      if (panel) panel.scrollTop = scrollMemory.current.get(value) ?? 0;
    }
  });

  // 瀏覽器在隱藏的面板裡找到字（Ctrl＋F）時切過去。
  const onChangeRef = useRef(change);
  useLayoutEffect(() => {
    onChangeRef.current = change;
  });
  useLayoutEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const [id, panel] of panelRefs.current) {
      const onBeforeMatch = () => onChangeRef.current(id);
      panel.addEventListener('beforematch', onBeforeMatch);
      cleanups.push(() => panel.removeEventListener('beforematch', onBeforeMatch));
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [tabs]);

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
    change(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  return (
    <div className={scrollPanels ? 'flex min-h-0 flex-1 flex-col' : ''}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex shrink-0 flex-wrap gap-1 border-b border-line">
        {tabs.map((tab) => {
          const selected = tab.id === value;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabDomId(tab.id)}
              aria-selected={selected}
              aria-controls={panelDomId(tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => change(tab.id)}
              className={`-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-[0.95rem] ${
                selected ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={(el) => {
            if (el) panelRefs.current.set(tab.id, el);
            else panelRefs.current.delete(tab.id);
          }}
          role="tabpanel"
          id={panelDomId(tab.id)}
          aria-labelledby={tabDomId(tab.id)}
          tabIndex={0}
          {...(scrollPanels ? { 'data-pane-scroll': '' } : {})}
          className={scrollPanels ? 'min-h-0 flex-1 overflow-y-auto p-1.5 pt-3' : 'pt-3'}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
