/**
 * 揭露（<details>；docs/design/css-overhaul.md §8 PR B、desktop-polish §2.12）：原生的 ▶ 換成 ChevronDown，兩種：
 *   block   區塊標題：summary 整列 44 高、600 字、右邊 ChevronDown（16、muted），展開時轉 180°
 *   inline  行內的「更多」：主色字、箭頭在左，收合時 −90°（指向右邊）、展開時 0°
 * 轉場只在 motion-safe；<details> 要有 group（Disclosure 會加；直接用 class 的地方自己在 <details> 加 group）。
 */
import { ChevronDown } from 'lucide-react';
import type { DetailsHTMLAttributes, ReactNode } from 'react';

/** 區塊的 summary（放在 <details className="group …"> 裡；右邊接 <DisclosureChevron />）。 */
export const disclosureSummaryCls =
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden';

/** 行內「更多」的 summary（左邊接 <DisclosureChevron inline />）。 */
export const disclosureInlineSummaryCls =
  'inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-primary hover:underline [&::-webkit-details-marker]:hidden';

export function DisclosureChevron({ inline = false }: { inline?: boolean }) {
  return (
    <ChevronDown
      aria-hidden="true"
      className={`size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 ${inline ? '-rotate-90 group-open:rotate-0' : 'text-muted group-open:rotate-180'}`}
    />
  );
}

export interface DisclosureProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'title'> {
  summary: ReactNode;
  variant?: 'block' | 'inline';
  summaryClassName?: string;
  children?: ReactNode;
}

export function Disclosure({ summary, variant = 'block', className, summaryClassName, children, ...rest }: DisclosureProps) {
  const inline = variant === 'inline';
  return (
    <details {...rest} className={`group${className ? ` ${className}` : ''}`}>
      <summary className={`${inline ? disclosureInlineSummaryCls : disclosureSummaryCls}${summaryClassName ? ` ${summaryClassName}` : ''}`}>
        {inline && <DisclosureChevron inline />}
        {summary}
        {!inline && <DisclosureChevron />}
      </summary>
      {children}
    </details>
  );
}
