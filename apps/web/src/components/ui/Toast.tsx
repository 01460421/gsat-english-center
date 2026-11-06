/**
 * 短暫通知（docs/design/css-overhaul.md §4.11）。**優先就地回饋**（按鈕旁的 role="status" 文字）；只有動作的結果不在畫面上時
 * 才用 toast（登出所有裝置、背景同步失敗）。
 *   - 容器是常駐的 aria-live="polite"（Layout 一開始就 render，訊息出現時讀屏才唸得到）。
 *   - 一次一則；4 秒後消失，滑鼠移上或焦點在裡面時暫停；有動作（「復原」）的不自動消失。
 *   - 位置：手機在底部導覽上方（含安全區），桌機右下。外觀 rounded-control、fg 底 bg 字（兩種主題都反白）、shadow-pop。
 *   - prefers-reduced-motion 時不滑入（這裡本來就沒有動畫，只有出現／消失）。
 */
import { X } from 'lucide-react';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastOptions {
  /** 動作按鈕（例如「復原」）：有的話不自動消失。 */
  action?: { label: string; onAction: () => void };
  /** 毫秒；預設 4000。 */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: ReactNode;
}

interface ToastApi {
  show: (message: ReactNode, options?: ToastOptions) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_DURATION_MS = 4000;

/** 取得 show／dismiss。不在 ToastProvider 裡面時（單元測試單獨 render 元件）回傳不做事的版本。 */
export function useToast(): ToastApi {
  return use(ToastContext) ?? NOOP;
}

const NOOP: ToastApi = { show: () => {}, dismiss: () => {} };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const show = useCallback((message: ReactNode, options: ToastOptions = {}) => {
    seq.current += 1;
    setToast({ id: seq.current, message, ...options });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext value={api}>
      {children}
      <ToastRegion toast={toast} onDismiss={dismiss} />
    </ToastContext>
  );
}

function ToastRegion({ toast, onDismiss }: { toast: ToastItem | null; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!toast || toast.action || paused) return;
    const timer = window.setTimeout(onDismiss, toast.duration ?? TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast, paused, onDismiss]);
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center lg:inset-x-auto lg:right-6 lg:bottom-6"
    >
      {toast && (
        <div
          key={toast.id}
          role="status"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          className="pointer-events-auto flex max-w-md items-center gap-3 rounded-control bg-fg py-2 pr-2 pl-4 text-meta text-bg shadow-(--shadow-pop)"
        >
          <span className="min-w-0 flex-1 py-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onAction();
                onDismiss();
              }}
              className="min-h-11 shrink-0 rounded-full px-3 font-semibold underline underline-offset-2 lg:min-h-9"
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" onClick={onDismiss} aria-label="關閉通知" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full lg:size-9">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
