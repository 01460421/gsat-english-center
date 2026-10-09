/**
 * 後台的小元件：紅綠燈、區塊外框、錯誤區塊。顏色之外一律附文字（「通過」「未設定」），顏色不是唯一的資訊來源。
 */
import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '../../lib/apiErrors';
import { btnSecondary, cardCls, sectionTitleCls } from '../account/styles';
import { Notice } from '../account/ui';

export type LightState = 'ok' | 'warn' | 'error';

const LIGHT_DOT: Record<LightState, string> = {
  ok: 'bg-ok',
  warn: 'bg-badge-fg',
  error: 'bg-bad',
};

const LIGHT_TEXT: Record<LightState, string> = {
  ok: 'text-ok',
  warn: 'text-badge-fg',
  error: 'text-bad',
};

/** 紅綠燈＋狀態文字（例如「已設定」「未設定」）。 */
export function StatusLight({ state, text }: { state: LightState; text: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold ${LIGHT_TEXT[state]}`}>
      <span aria-hidden="true" className={`size-2.5 rounded-full ${LIGHT_DOT[state]}`} />
      {text}
    </span>
  );
}

export function AdminSection({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`${cardCls} scroll-mt-20`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className={sectionTitleCls}>
          {title}
        </h2>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function SectionError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <Notice tone="error">{errorMessage(error, { forbidden: '你沒有管理後台的權限。' })}</Notice>
      <button type="button" onClick={onRetry} className={btnSecondary}>
        <RefreshCw aria-hidden="true" className="size-4" />
        再試一次
      </button>
    </div>
  );
}

export function ReloadButton({ onClick, busy, label = '重新整理' }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={btnSecondary}>
      <RefreshCw aria-hidden="true" className={`size-4 ${busy ? 'animate-spin' : ''}`} />
      {label}
    </button>
  );
}

/** 整數微美元 → 「US$1.23」。 */
export function formatUsdMicros(micros: number): string {
  return `US$${(micros / 1_000_000).toFixed(2)}`;
}

/** Unix 秒 → 台灣時間「2026/10/8 14:05」；null 顯示「—」。 */
export function formatUnixTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(seconds * 1000));
}
