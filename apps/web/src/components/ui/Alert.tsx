/**
 * 頁面內提示（docs/design/css-overhaul.md §4.12）：
 *   info     surface-2 底、無框線＋Info：作答紀錄只存在這台裝置
 *   warn／ai 警示色底與框＋AlertTriangle／Sparkles：AI 批改僅供參考
 *   error    淡紅底、紅框＋AlertCircle；內文用 fg、標題用 bad：送出失敗、連不上伺服器
 *   success  淡綠底、綠框＋CheckCircle2：已核准、檢查全部通過
 * 錯誤一律寫：發生什麼（白話）、什麼仍然能用、下一步（「再試一次」用 btn('secondary', 'sm')）；不寫錯誤碼、HTTP、「後端」。
 * role="alert" 只給使用者動作後出現的錯誤（呼叫端傳 role），常駐的提示不要用。
 */
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'warn' | 'ai' | 'error' | 'success';

const TONES: Record<AlertTone, string> = {
  info: 'bg-surface-2 border-transparent',
  warn: 'border-badge-line bg-badge-bg text-badge-fg',
  ai: 'border-badge-line bg-badge-bg text-badge-fg',
  error: 'border-bad-line bg-bad-soft text-fg',
  success: 'border-ok-line bg-ok-soft text-fg',
};

const TITLE_TONE: Record<AlertTone, string> = {
  info: 'text-fg',
  warn: 'text-badge-fg',
  ai: 'text-badge-fg',
  error: 'text-bad',
  success: 'text-ok',
};

const ICONS: Record<AlertTone, typeof Info> = { info: Info, warn: AlertTriangle, ai: Sparkles, error: AlertCircle, success: CheckCircle2 };

const ICON_TONE: Record<AlertTone, string> = { info: 'text-muted', warn: 'text-badge-fg', ai: 'text-badge-fg', error: 'text-bad', success: 'text-ok' };

/** 只要外觀（沒有圖示的既有提示框用）：rounded-control、框線、底色、內距、14px 字。 */
export function alertCls(tone: AlertTone = 'info', extra = ''): string {
  return `rounded-control border px-4 py-3 text-meta ${TONES[tone]}${extra ? ` ${extra}` : ''}`;
}

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  /** 圖示：預設依 tone；false 不顯示。 */
  icon?: boolean;
  role?: 'alert' | 'status';
  className?: string;
  children?: ReactNode;
}

export function Alert({ tone = 'info', title, icon = true, role, className, children }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div role={role} className={alertCls(tone, `flex items-start gap-2.5${className ? ` ${className}` : ''}`)}>
      {icon && <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${ICON_TONE[tone]}`} />}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className={`font-semibold ${TITLE_TONE[tone]}`}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
