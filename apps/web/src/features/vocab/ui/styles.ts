/**
 * 單字模組共用的 Tailwind 類別字串。只用 index.css 定義的語意化顏色（bg-surface、text-muted…），
 * 深淺色主題自動跟著換。按鈕高度至少 44px（min-h-11）：手機上手指點得準（WCAG 2.5.8 的建議尺寸）。
 */

import { btn, iconBtnCls } from '../../../components/ui/buttons';

export const cardCls = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 lg:p-6';

/** 按鈕：共用元件（components/ui/buttons.ts，設計文件 css-overhaul §4.1）。 */
export const btnPrimary = btn('primary', 'md');
export const btnSecondary = btn('secondary', 'md');
export const btnText = btn('ghost', 'md');
export const iconBtn = iconBtnCls;

/**
 * 輸入框（不含邊框顏色）。要依狀態換邊框色（答對綠、答錯紅）時用這個再自己加顏色：同一個元素同時有
 * border-line 和 border-bad 時，Tailwind 依類別在 CSS 裡的先後決定，border-line 會蓋掉 border-bad。
 */
export const fieldBaseCls = 'min-h-11 w-full min-w-0 rounded-xl border bg-surface px-3 py-2 text-fg placeholder:text-muted';

export const fieldCls = `${fieldBaseCls} border-line`;

export const labelCls = 'mb-1 block text-sm font-medium text-muted';

export const sectionTitleCls = 'text-lg font-semibold';

/** 新分頁連結旁的補充說明（螢幕閱讀器才唸）。 */
export const NEW_TAB_HINT = '（另開新分頁）';
