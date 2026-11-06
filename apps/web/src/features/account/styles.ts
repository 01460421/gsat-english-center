/**
 * 帳號、AI 申請與後台頁共用的 Tailwind 類別字串。只用 index.css 的語意化顏色，深淺色主題自動跟著換；
 * 按鈕高度至少 44px（min-h-11），手機上手指點得準。
 */

import { btn } from '../../components/ui/buttons';
import { checkInputCls } from '../../components/ui/Check';
import { fieldCls as baseFieldCls } from '../../components/ui/fields';

export const cardCls = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 lg:p-6';

/** 按鈕：共用元件（components/ui/buttons.ts，設計文件 css-overhaul §4.1）。btnDanger 是觸發破壞性動作的紅字按鈕（danger-ghost）。 */
export const btnPrimary = btn('primary', 'md');
export const btnSecondary = btn('secondary', 'md');
export const btnDanger = btn('danger-ghost', 'md');

/** 桌機（≥ lg）限寬 28rem：窄版頁面的內容仍有 50rem 寬，暱稱這類短欄位不必拉滿（docs/design/desktop-ui.md §5.12）。 */
export const fieldCls = `${baseFieldCls} lg:max-w-md`;

/** 標籤：共用元件（components/ui/fields.ts）。 */
export { labelCls } from '../../components/ui/fields';

export const sectionTitleCls = 'text-lg font-semibold';

/** 文字旁的 checkbox（同意條款）：共用的 20px 原生元件，和第一行字對齊。 */
export const checkboxCls = `mt-0.5 ${checkInputCls}`;

export const pageTitleCls = 'text-2xl font-bold tracking-tight lg:text-3xl';
