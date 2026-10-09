/**
 * 帳號、AI 申請與後台頁共用的 Tailwind 類別字串。只用 index.css 的語意化顏色，深淺色主題自動跟著換；
 * 按鈕高度至少 44px（min-h-11），手機上手指點得準。
 */

export const cardCls = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 lg:p-6';

export const btnPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

export const btnSecondary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2 font-medium text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

export const btnDanger =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-bad px-4 py-2 font-medium text-bad hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

export const fieldCls =
  'min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-fg placeholder:text-muted';

export const labelCls = 'mb-1 block text-sm font-medium';

export const sectionTitleCls = 'text-lg font-semibold';

export const checkboxCls = 'mt-1 size-4 shrink-0 accent-[var(--primary)]';

export const pageTitleCls = 'text-2xl font-bold tracking-tight lg:text-3xl';
