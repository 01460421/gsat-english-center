/**
 * 本站自組模擬考的開關（docs/design/bank-mock.md §7.8、§2.8、§11 第 3 步）。
 *
 *   BANK_MOCK_ENABLED   整個功能對所有人顯示（/mock 的「本站自組模擬考」區塊與頁首、頁尾、作答紀錄說明的改寫）
 *   ?bankmock=preview   預覽開關：打開後記在這個瀏覽器的 localStorage（gsat-bankmock-preview），?bankmock=off 關掉；
 *                       寫法同 pdf/index.ts 的 pdfPreviewEnabled。開關關著時給站主在正式站試用，也是 e2e 固定種子的前提
 *   ?bankmockseed=<n>   只在預覽模式下有效：指定組卷的種子（0–4294967295），只給 e2e 用（§4.1、§10.4）
 *
 * 畫面判斷要不要顯示一律用 bankMockVisible()。開關關著、也沒開預覽時 /mock 一個像素都不變；
 * 已經存在的 /mock/bk1-… 網址照常可以打開（§2.8 最後一列）。
 * 自組卷的 PDF 沒有自己的開關：跟著全站的 pdfDownloadVisible()（features/pdf/index.ts，§7.8），和歷屆卷的 PDF 一起開放。
 * 這個檔案很小、不匯入組卷程式：/mock 頁與作答紀錄列表都會匯入它。
 */

/** 2026-10-20 站主決定直接上線（§11 第 3 步）；要再關掉只改這一行成 false，預覽開關照常可用。 */
export const BANK_MOCK_ENABLED = true;

const PREVIEW_KEY = 'gsat-bankmock-preview';

/** 預覽開關（見檔頭）。localStorage 不能用時當作沒打開。 */
export function bankMockPreviewEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('bankmock');
    if (param === 'preview') window.localStorage.setItem(PREVIEW_KEY, '1');
    else if (param === 'off') window.localStorage.removeItem(PREVIEW_KEY);
    return window.localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    // 無痕模式或停用網站資料：localStorage 會丟例外。
    return false;
  }
}

/** 頁面上和本站自組模擬考有關的區塊與文字要不要顯示：正式開放，或這個瀏覽器打開了預覽開關。 */
export function bankMockVisible(): boolean {
  // 先讀預覽參數：開關打開時也要記住 ?bankmock=preview，固定種子（bankMockSeed）才有效。
  const preview = bankMockPreviewEnabled();
  return BANK_MOCK_ENABLED || preview;
}

/** 預覽模式下網址的 ?bankmockseed=<n>（只給 e2e 用）；沒有、格式不對或不在預覽模式時是 null。 */
export function bankMockSeed(): number | null {
  if (!bankMockPreviewEnabled()) return null;
  let raw: string | null;
  try {
    raw = new URLSearchParams(window.location.search).get('bankmockseed');
  } catch {
    return null;
  }
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 0xffff_ffff ? n : null;
}
