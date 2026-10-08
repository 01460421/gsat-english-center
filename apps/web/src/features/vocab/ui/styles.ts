/**
 * 單字模組共用的 Tailwind 類別字串。只用 index.css 定義的語意化顏色（bg-surface、text-muted…），
 * 深淺色主題自動跟著換。按鈕高度至少 44px（min-h-11）：手機上手指點得準（WCAG 2.5.8 的建議尺寸）。
 */

export const cardCls = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 lg:p-6';

export const btnPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

export const btnSecondary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2 font-medium text-fg hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';

export const btnText = 'inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-medium text-primary hover:bg-primary-soft';

export const iconBtn =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg';

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
