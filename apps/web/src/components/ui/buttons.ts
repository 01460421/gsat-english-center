/**
 * 按鈕的樣式（docs/design/css-overhaul.md §4.1）：`btn(variant, size)` 回傳 class 字串，給 <button>、<Link>、<a>、<label> 共用。
 * React 元件版（停用原因、處理中）在 Button.tsx。各功能原本的按鈕常數（btnPrimary、primaryButton、primaryBtn…）都改成從這裡
 * re-export，新程式碼只用這裡的東西。
 *
 * 尺寸（手機／桌機 ≥ lg）：
 *   lg    48／44 高、px-6／px-5、16px 600：頁面唯一的主要動作（開始作答、送出批改）
 *   md    44／40 高、px-5／px-4、16／15px 600：一般（預設）
 *   sm    44／36 高、px-4／px-3.5、14px 600：工具列（交卷）、表格列、篩選列。手機仍是 44 高（點擊目標），只有字與內距小一級
 *   icon  44／40 見方：只有圖示的按鈕（另給 aria-label）
 * 樣式：
 *   primary       實心主色：每個區塊一個
 *   secondary     外框（line-strong，≥ 3:1）：次要動作（下載 PDF、問學習助手、回到列表）
 *   ghost         主色字、hover 淡底：第三順位（看提示、展開）
 *   danger        實心紅：確認列裡的「確定清除」
 *   danger-ghost  紅字、hover 淡紅底：觸發破壞性動作的按鈕（清除作答、刪除這份紀錄）
 *   link          底線文字連結的外觀（行內的「重新檢查」「改用貼上」）；手機一樣撐到 44 高
 *
 * 停用：不再是 opacity-50（淺色主題會變成看不出能不能按的淡紫色）。實心與外框的按鈕變成 surface-2 底＋muted 字、框線透明；
 * 文字型（ghost、danger-ghost、link）只把字換成 muted。disabled 與 aria-disabled（停用的 <Link>）吃同一組樣式。
 * 停用時旁邊要寫原因（Button 的 disabledReason，或自己用 disabledReasonCls 寫一行）。
 * hover 一律不帶 lg:（Tailwind 的 hover: 只在有滑鼠的裝置生效），停用的樣式排在 hover 之後，滑鼠移上停用的按鈕不會變色。
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full text-center font-semibold transition-colors duration-150 motion-reduce:transition-none';

/** 實心與外框按鈕的停用樣式（disabled 與 aria-disabled 相同）。 */
const DISABLED_FILLED =
  'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-2 disabled:text-muted aria-disabled:cursor-not-allowed aria-disabled:border-transparent aria-disabled:bg-surface-2 aria-disabled:text-muted';
/** 文字型按鈕的停用樣式：沒有底色，只把字換成 muted。 */
const DISABLED_TEXT =
  'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted disabled:no-underline aria-disabled:cursor-not-allowed aria-disabled:bg-transparent aria-disabled:text-muted aria-disabled:no-underline';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: `border border-transparent bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-hover ${DISABLED_FILLED}`,
  secondary: `border border-line-strong bg-surface text-fg hover:border-primary hover:text-primary ${DISABLED_FILLED}`,
  ghost: `border border-transparent text-primary hover:bg-primary-soft ${DISABLED_TEXT}`,
  danger: `border border-transparent bg-bad text-on-primary ${DISABLED_FILLED}`,
  'danger-ghost': `border border-transparent text-bad hover:bg-bad-soft ${DISABLED_TEXT}`,
  link: `text-primary underline decoration-1 underline-offset-2 hover:decoration-2 ${DISABLED_TEXT}`,
};

const SIZES: Record<ButtonSize, string> = {
  lg: 'min-h-12 px-6 py-2.5 text-base lg:min-h-11 lg:px-5',
  md: 'min-h-11 px-5 py-2 text-base lg:min-h-10 lg:px-4 lg:text-control',
  sm: 'min-h-11 px-4 py-1.5 text-meta lg:min-h-9 lg:px-3.5',
  icon: 'size-11 shrink-0 p-0 lg:size-10',
};

/** link 樣式不加左右內距與圓角底色，只決定高度與字級（手機仍是 44 高的點擊目標）。 */
const LINK_SIZES: Record<ButtonSize, string> = {
  lg: 'min-h-12 text-base lg:min-h-11',
  md: 'min-h-11 text-base lg:min-h-10',
  sm: 'min-h-11 text-meta lg:min-h-9',
  icon: 'size-11 shrink-0 lg:size-10',
};

/**
 * 按鈕的 class。extra 接在最後（寬度、外距、gap 這類版面用的 class）；不要用 extra 改尺寸或顏色，換 variant／size。
 *   btn()                       → primary md
 *   btn('secondary', 'sm')
 *   btn('primary', 'lg', 'w-full')
 */
export function btn(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string {
  const sizeCls = variant === 'link' ? LINK_SIZES[size] : SIZES[size];
  const base = variant === 'link' ? BASE.replace('justify-center ', '').replace('rounded-full ', 'rounded-sm ') : BASE;
  return `${base} ${VARIANTS[variant]} ${sizeCls}${extra ? ` ${extra}` : ''}`;
}

/**
 * 只有圖示、低調的按鈕（主題切換、關閉、單字卡的發音）：muted 圖示、hover 淺底；44 見方（桌機 40）。
 * 需要主色時用 btn('ghost', 'icon')。
 */
export const iconBtnCls =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg motion-reduce:transition-none disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted lg:size-10';

/** 停用原因（按鈕旁或下方的一行字；用 aria-describedby 連到按鈕）。 */
export const disabledReasonCls = 'text-meta text-muted';

/** 一列按鈕：同一個尺寸、間距 8；手機放不下時折行。 */
export const buttonRowCls = 'flex flex-wrap items-center gap-2';
