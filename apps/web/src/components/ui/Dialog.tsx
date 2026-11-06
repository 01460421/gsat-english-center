/**
 * 對話框（docs/design/css-overhaul.md §4.10）：原生 <dialog> 的 showModal()（背景自動 inert、Esc 會發 cancel）。
 *   外觀  rounded-card、line 框、surface 底、shadow-pop；遮罩 scrim（dim="strong"：scrim-strong，模擬考交卷）
 *   結構  標題列（＋右上角 44×44 的「關閉」）→ 可捲動的內容 → 固定在底部的動作列（border-t）
 *   手機  寬 calc(100% − 2rem)、最高 85dvh；動作列按鈕撐滿寬度、上下排列（主要動作放在 actions 的第一個，排在最上面）
 *   焦點  打開時到 initialFocusRef（破壞性的確認給「取消」）；沒給就是第一個可聚焦的元素（瀏覽器預設）。
 *         關閉時回到打開前的元素（restoreFocus="opener"，預設）；呼叫端自己處理時給 false。
 *   關閉  Esc 與「關閉」都呼叫 onClose（cancel 事件會先 preventDefault，開關由呼叫端的 open 決定）。
 * open 是受控的：false 時關起來但元素留著（模擬考交卷這種反覆開關的對話框）；只在需要時才 render 的對話框不必給（預設 true）。
 */
import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { iconBtnCls } from './buttons';

export const dialogCls =
  'm-auto max-h-[85dvh] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-card border border-line bg-surface p-0 text-fg shadow-(--shadow-pop) open:flex';

const WIDTHS = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-xl lg:max-w-2xl' } as const;

/** 動作列：手機撐滿寬度、上下排列；桌機一列。 */
export const dialogActionsCls = 'flex shrink-0 flex-col gap-2 border-t border-line bg-surface px-5 py-3 sm:flex-row sm:flex-wrap [&>*]:w-full sm:[&>*]:w-auto';

export interface DialogProps {
  open?: boolean;
  title: ReactNode;
  onClose: () => void;
  /** 標題下方的說明（aria-describedby）；也可以自己在內容裡放，再用 describedBy 指過去。 */
  description?: ReactNode;
  describedBy?: string;
  /** 固定在底部的動作列（主要動作放第一個）。 */
  actions?: ReactNode;
  children?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: 'opener' | false;
  dim?: 'default' | 'strong';
  size?: keyof typeof WIDTHS;
  /** 右上角的「關閉」；預設有。 */
  closeButton?: boolean;
  /** 給內容區的 class（預設 px-5 py-4 space-y-4）。 */
  bodyClassName?: string;
  /** 標題的 id（沿用既有的錨點時）。 */
  titleId?: string;
}

export function Dialog({
  open = true,
  title,
  onClose,
  description,
  describedBy,
  actions,
  children,
  initialFocusRef,
  restoreFocus = 'opener',
  dim = 'default',
  size = 'md',
  closeButton = true,
  bodyClassName = 'space-y-4 px-5 py-4',
  titleId,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const headingId = titleId ?? `${autoId}-title`;
  const descId = `${autoId}-desc`;
  const opener = useRef<HTMLElement | null>(null);
  const restore = useRef(restoreFocus);
  useLayoutEffect(() => {
    restore.current = restoreFocus;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      initialFocusRef?.current?.focus({ preventScroll: true });
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      if (restore.current === 'opener' && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [open, initialFocusRef]);

  // 卸載（只在需要時才 render 的對話框）：關掉並把焦點還回去。
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      if (restore.current === 'opener' && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, []);

  const describedByIds = [description ? descId : null, describedBy ?? null].filter(Boolean).join(' ') || undefined;
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      aria-describedby={describedByIds}
      aria-modal="true"
      // 桌機鎖住捲動時，保留的捲軸槽用同樣濃度的遮罩色（index.css 的 html:has(dialog:modal)）。
      data-backdrop-dim={dim === 'strong' ? '50' : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`${dialogCls} ${WIDTHS[size]} ${dim === 'strong' ? 'backdrop:bg-scrim-strong' : 'backdrop:bg-scrim'}`}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line py-2 pr-2 pl-5">
        <h2 id={headingId} className="py-2 text-lg font-semibold">
          {title}
        </h2>
        {closeButton && (
          <button type="button" onClick={onClose} aria-label="關閉" className={iconBtnCls}>
            <X aria-hidden="true" className="size-5" />
          </button>
        )}
      </div>
      <div ref={bodyRef} className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>
        {description && (
          <div id={descId} className="text-body text-pretty">
            {description}
          </div>
        )}
        {children}
      </div>
      {actions && <div className={dialogActionsCls}>{actions}</div>}
    </dialog>
  );
}
