/**
 * 按鍵提示（docs/design/desktop-ui.md §4.9）：<kbd> 的樣式，以及把 'mod+enter' 這類寫法顯示成 Ctrl＋Enter（Mac 是 ⌘）。
 * 控制項旁的按鍵提示一律 hidden lg:inline，而且只放在空間夠的地方；有快捷鍵的按鈕另外加 aria-keyshortcuts。
 */
import { Fragment, type ReactNode } from 'react';
import { hotkeyLabels } from '../../lib/hotkeys';

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`inline-flex min-w-[1.5em] items-center justify-center rounded border border-line bg-surface-2 px-1.5 font-mono text-xs leading-5 text-fg ${className}`}>
      {children}
    </kbd>
  );
}

/** 一個快捷鍵的按鍵組合（'mod+enter' → Ctrl ＋ Enter）。 */
export function KeyCombo({ spec }: { spec: string }) {
  const labels = hotkeyLabels(spec);
  return (
    <span className="inline-flex items-center gap-1">
      {labels.map((label, i) => (
        <Fragment key={label}>
          {i > 0 && (
            <span aria-hidden="true" className="text-xs text-muted">
              ＋
            </span>
          )}
          <Kbd>{label}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}
