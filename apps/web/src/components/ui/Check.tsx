/**
 * checkbox／radio（docs/design/css-overhaul.md §4.4）：原生元件（20px、accent-primary），整個 <label> 是點擊範圍、至少 44 高。
 * 做成選項卡（設定頁的主題、單字測驗題型、帳號年齡）時用 card：line-strong 框線、選中 primary 框＋淡底
 * （has-[:checked] 寫在 label 上，不另外存狀態）。
 * 作答的選項卡（exams/components/Questions.tsx）不用這個：一題 4–10 個選項加深框線會讓試卷很吵，原生 radio 本身就有 ≥ 3:1 的邊界。
 */
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

/** 原生 checkbox／radio 本身。 */
export const checkInputCls = 'size-5 shrink-0 accent-primary';

/** 包住 checkbox／radio 與文字的 label（一般）。 */
export const checkLabelCls = 'flex min-h-11 cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted';

/** 同上，文字好幾行時 checkbox 對齊第一行。 */
export const checkLabelTopCls = 'flex min-h-11 cursor-pointer items-start gap-3 py-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted';

const OPTION_BASE =
  'flex min-h-11 cursor-pointer gap-3 rounded-control border border-line-strong bg-surface p-3 transition-colors duration-150 hover:border-primary motion-reduce:transition-none has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:border-line has-[:disabled]:bg-surface-2 has-[:disabled]:text-muted forced-colors:has-[:checked]:border-[color:Highlight]';

/** 選項卡（框線 line-strong；選中 primary 框＋淡底）：一行文字，垂直置中。 */
export const optionCardCls = `${OPTION_BASE} items-center`;

/** 選項卡：標題＋說明好幾行時，radio 對齊第一行。 */
export const optionCardTopCls = `${OPTION_BASE} items-start`;

export interface CheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'checkbox' | 'radio';
  label: ReactNode;
  /** 文字下方的補充說明（muted）。 */
  description?: ReactNode;
  /** 選項卡外觀。 */
  card?: boolean;
  labelClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

export function Check({ type = 'checkbox', label, description, card = false, labelClassName, className, ref, ...rest }: CheckProps) {
  return (
    <label className={`${card ? (description ? optionCardTopCls : optionCardCls) : description ? checkLabelTopCls : checkLabelCls}${labelClassName ? ` ${labelClassName}` : ''}`}>
      <input ref={ref} type={type} {...rest} className={`${checkInputCls}${description ? ' mt-0.5' : ''}${className ? ` ${className}` : ''}`} />
      <span className="min-w-0">
        <span className="block">{label}</span>
        {description && <span className="mt-0.5 block text-meta text-muted">{description}</span>}
      </span>
    </label>
  );
}
