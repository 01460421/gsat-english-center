/**
 * 按鈕元件（docs/design/css-overhaul.md §4.1）：外觀同 btn()，另外處理兩件事：
 *   - 停用原因：disabled 且有 disabledReason 時，按鈕後面接一行原因（disabledReasonCls），並用 aria-describedby 連起來，
 *     讀屏聽到「寫好了，對照參考譯文，變暗，兩句都寫完才能對照」。原因放在按鈕的兄弟節點，外層的排版（flex、grid）決定它在右邊或下面。
 *   - 處理中：busy 時 aria-busy="true"、文字換成 busyLabel（預設「處理中…」），按鈕維持可聚焦但不重複送出（呼叫端照常判斷）。
 * 只有 <button>；連結長得像按鈕時直接 <Link className={btn(…)}>。
 */
import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { btn, disabledReasonCls, type ButtonSize, type ButtonVariant } from './buttons';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 停用時顯示的原因（按鈕後面一行字，aria-describedby）。 */
  disabledReason?: ReactNode;
  busy?: boolean;
  busyLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  disabledReason,
  busy = false,
  busyLabel = '處理中…',
  type = 'button',
  disabled,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const showReason = Boolean(disabled && disabledReason);
  const describedBy = [rest['aria-describedby'], showReason ? reasonId : null].filter(Boolean).join(' ') || undefined;
  const button = (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      {...rest}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      className={btn(variant, size, className)}
    >
      {busy ? busyLabel : children}
    </button>
  );
  if (!showReason) return button;
  return (
    <>
      {button}
      <span id={reasonId} className={disabledReasonCls}>
        {disabledReason}
      </span>
    </>
  );
}
