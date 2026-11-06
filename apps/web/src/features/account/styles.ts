/**
 * 帳號、AI 申請與後台頁共用的 Tailwind 類別字串。只用 index.css 的語意化顏色，深淺色主題自動跟著換；
 * 按鈕高度至少 44px（min-h-11），手機上手指點得準。
 */

import { btn } from '../../components/ui/buttons';

export const cardCls = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 lg:p-6';

/** 按鈕：共用元件（components/ui/buttons.ts，設計文件 css-overhaul §4.1）。btnDanger 是觸發破壞性動作的紅字按鈕（danger-ghost）。 */
export const btnPrimary = btn('primary', 'md');
export const btnSecondary = btn('secondary', 'md');
export const btnDanger = btn('danger-ghost', 'md');

/** 桌機（≥ lg）限寬 28rem：窄版頁面的內容仍有 50rem 寬，暱稱這類短欄位不必拉滿（docs/design/desktop-ui.md §5.12）。 */
export const fieldCls =
  'min-h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-fg placeholder:text-muted lg:max-w-md';

export const labelCls = 'mb-1 block text-sm font-medium';

export const sectionTitleCls = 'text-lg font-semibold';

export const checkboxCls = 'mt-1 size-4 shrink-0 accent-primary';

export const pageTitleCls = 'text-2xl font-bold tracking-tight lg:text-3xl';
