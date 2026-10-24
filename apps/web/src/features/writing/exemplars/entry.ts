/**
 * 作文範文入口的文案與網址（docs/design/model-essays.md §1.4、§8.4）。入口按鈕與卡片在寫作的各頁（作答頁、批改結果頁、
 * /writing、/composition），所以這個檔案不匯入任何東西：那些頁面的程式不會因為入口而多帶層級規格、轉承詞清單這些範文頁才用的東西。
 * labels.ts 轉匯出同樣的常數。
 */
export const EXEMPLARS_PATH = '/writing/essay/exemplars';
export const EXEMPLARS_TITLE = '作文範文';
/** /writing、/composition 的入口卡片。 */
export const EXEMPLARS_CARD_TEXT = '輸入題目或選網站上的題目，看同一個構想在約 12 分、16 分、19 分的寫法，還能一段一段對照。';
/** 入口按鈕（一律次要樣式；可存取名稱帶題目）。 */
export const EXEMPLARS_BUTTON = '看這題的三個層級範文';
/** 歷屆題與自訂題的作答頁：按鈕下方的建議（不擋）。 */
export const WRITE_FIRST_HINT = '建議先自己寫一次再看範文，比較看得出差在哪裡。';
