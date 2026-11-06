/**
 * 輸入框、文字框、選單、標籤與說明的樣式（docs/design/css-overhaul.md §4.2–4.4）。React 元件版（標籤、說明、錯誤自動連好）
 * 在 Field.tsx。各功能原本的常數（textInput、fieldCls、inputCls、textInputClass…）都改成從這裡 re-export。
 *
 *   外觀  rounded-control、border-line-strong（對 bg／surface／surface-2 ≥ 3:1，WCAG 1.4.11）、bg-surface（卡片上也是白底，
 *         不再是 bg-bg 的灰色塊）、16px 字（iOS Safari 對 < 16px 的輸入框聚焦時會自動放大頁面）
 *   高度  單行：手機 48、桌機 40；文字框由 rows 決定、可以往下拉長
 *   焦點  只用全站的焦點框（index.css 的 :focus-visible），外層卡片不另外亮
 *   錯誤  aria-invalid="true" 時框線換成 bad（Field 會設，下方另有文字與圖示）
 *   停用  surface-2 底、muted 字、淡框線
 */

/** 所有欄位共用的外觀（不含框線顏色與高度）。要依狀態換框線色（答對綠、答錯紅）時用這個再自己加顏色。 */
const SHAPE =
  'min-w-0 rounded-control border bg-surface px-3 text-body text-fg placeholder:text-muted aria-[invalid=true]:border-bad disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-muted';

/** 單行的高度：行高固定 24，手機 48、桌機 40。 */
const SINGLE_LINE = 'min-h-12 py-2 leading-6 lg:min-h-10 lg:py-1.5';

/** 單行輸入框，不含框線顏色（呼叫端自己加 border-line-strong／border-ok／border-bad）。 */
export const fieldBaseCls = `w-full ${SHAPE} ${SINGLE_LINE}`;

/** 單行輸入框（text、email、search…）。 */
export const fieldCls = `${fieldBaseCls} border-line-strong`;

/** 數字欄（模擬考的預估分數）：窄、靠右、等寬數字。 */
export const numberFieldCls = `w-24 ${SHAPE} ${SINGLE_LINE} border-line-strong text-right tabular-nums`;

/** 多行文字框：高度由 rows（或呼叫端的 min-h）決定，可以往下拉長。行高 1.75（text-body），英文作答好讀。 */
export const textareaBaseCls = `block w-full ${SHAPE} resize-y py-2.5`;
export const textareaCls = `${textareaBaseCls} border-line-strong`;

/**
 * 原生選單：和輸入框同一個外觀；右邊留 pr-9 給箭頭。appearance-none 之後原生箭頭不見了，所以要包在 Field.tsx 的 <Select>
 * （它會疊一個 ChevronDown）。寬度由呼叫端決定（預設 w-full；篩選列裡給 w-auto）。
 */
export const selectCls = `w-full appearance-none ${SHAPE} ${SINGLE_LINE} border-line-strong pr-9`;

/** 篩選列（sticky）裡的精簡版：手機一樣 44 高，桌機 36。 */
export const selectCompactCls = `appearance-none ${SHAPE} border-line-strong min-h-11 py-1.5 pr-9 leading-6 lg:min-h-9 lg:py-1 lg:text-meta`;

/** 欄位上方的標籤。 */
export const labelCls = 'mb-1.5 block text-meta font-semibold text-fg';

/** 欄位下方的說明（aria-describedby）。 */
export const hintCls = 'mt-1.5 text-meta text-muted';

/** 欄位下方的錯誤訊息（Field 會在前面放 AlertCircle）。 */
export const errorTextCls = 'mt-1.5 flex items-start gap-1.5 text-meta text-bad';

/** 必填的文字標示（不只靠星號）。 */
export const REQUIRED_MARK = '（必填）';
