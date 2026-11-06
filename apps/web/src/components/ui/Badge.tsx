/**
 * 標章（docs/design/css-overhaul.md §4.7、desktop-polish §2.10）：
 *   tone  neutral（題數、類型）、primary（新制、本站仿真、上次）、ok（完成、答對）、bad（答錯、失敗）、
 *         warn（補考、注意）、ai（AI 出題、AI 批改；預設帶 Sparkles）
 *   size  xs：高 20、px-2、12px 600（下限）；sm：高 24、px-2.5、14px 600
 * 狀態一定有文字或圖示，不只靠顏色。badgeCls() 給已經有自己結構的標章用（例如 <span className={badgeCls('ok')}>）。
 */
import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'primary' | 'ok' | 'bad' | 'warn' | 'ai';
export type BadgeSize = 'xs' | 'sm';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  primary: 'bg-primary-soft text-primary',
  ok: 'bg-ok-soft text-ok',
  bad: 'bg-bad-soft text-bad',
  warn: 'bg-badge-bg text-badge-fg',
  ai: 'bg-badge-bg text-badge-fg',
};

const SIZES: Record<BadgeSize, string> = {
  xs: 'min-h-5 gap-1 px-2 text-xs leading-4',
  sm: 'min-h-6 gap-1 px-2.5 text-meta leading-5',
};

/** 只有形狀與尺寸（顏色由呼叫端給，例如依對錯換 tone 的既有標章）。 */
export function badgeShapeCls(size: BadgeSize = 'xs'): string {
  return `inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap ${SIZES[size]}`;
}

export function badgeCls(tone: BadgeTone = 'neutral', size: BadgeSize = 'xs', extra = ''): string {
  return `${badgeShapeCls(size)} ${TONES[tone]}${extra ? ` ${extra}` : ''}`;
}

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** 前面的圖示；ai 預設 Sparkles，給 null 拿掉。 */
  icon?: ReactNode;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', size = 'xs', icon, className, title, children }: BadgeProps) {
  const shown = icon === undefined ? (tone === 'ai' ? <Sparkles aria-hidden="true" className={size === 'xs' ? 'size-3' : 'size-3.5'} /> : null) : icon;
  return (
    <span title={title} className={badgeCls(tone, size, className)}>
      {shown}
      {children}
    </span>
  );
}
