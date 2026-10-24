/**
 * 學習助手加強卷的開關（docs/design/weak-paper.md §9.3、§17.3）。
 *
 *   WEAK_PAPER_ENABLED   整個功能對所有人顯示（/assistant/papers 與六個入口）。站主 2026-10-23 決定直接開放（不用 AI、不花錢），
 *                        這個常數保留為緊急開關：要關掉只改這一行成 false，預覽開關照常可用。
 *   ?weakpaper=preview   預覽開關：打開後記在這個瀏覽器的 localStorage（gsat-weakpaper-preview），?weakpaper=off 關掉；
 *                        寫法同 mock/bank/flags.ts。開關關著時給站主在正式站試用，也是 e2e 固定種子的前提。
 *   ?paperseed=<n>       只在預覽模式下有效：指定組卷的種子（0–4294967295），只給 e2e 用（§6.7）。
 *
 * 畫面判斷要不要顯示一律用 weakPaperVisible()。和學習助手的 AI 開關無關：學習助手緊急關閉（或唯讀模式）時加強卷照常能用。
 * 開關關著、也沒開預覽時入口都不出現；已經存在的 /mock/bk2-… 網址照常可以打開（§3.8 最後一列）。
 * 這個檔案很小、不匯入組卷程式：學習助手首頁、/mock、成績單都會匯入它。
 */

/** 2026-10-23 站主決定直接開放（§17.1）；要再關掉只改這一行成 false。 */
export const WEAK_PAPER_ENABLED = true;

export const WEAK_PAPER_PREVIEW_KEY = 'gsat-weakpaper-preview';

/** 預覽開關（見檔頭）。localStorage 不能用時當作沒打開。 */
export function weakPaperPreviewEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('weakpaper');
    if (param === 'preview') window.localStorage.setItem(WEAK_PAPER_PREVIEW_KEY, '1');
    else if (param === 'off') window.localStorage.removeItem(WEAK_PAPER_PREVIEW_KEY);
    return window.localStorage.getItem(WEAK_PAPER_PREVIEW_KEY) === '1';
  } catch {
    // 無痕模式或停用網站資料：localStorage 會丟例外。
    return false;
  }
}

/** 加強卷的入口與頁面要不要顯示：正式開放，或這個瀏覽器打開了預覽開關。 */
export function weakPaperVisible(): boolean {
  // 先讀預覽參數：開關打開時也要記住 ?weakpaper=preview，固定種子（weakPaperSeed）才有效。
  const preview = weakPaperPreviewEnabled();
  return WEAK_PAPER_ENABLED || preview;
}

/** 預覽模式下網址的 ?paperseed=<n>（只給 e2e 用）；沒有、格式不對或不在預覽模式時是 null。 */
export function weakPaperSeed(): number | null {
  if (!weakPaperPreviewEnabled()) return null;
  let raw: string | null;
  try {
    raw = new URLSearchParams(window.location.search).get('paperseed');
  } catch {
    return null;
  }
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 0xffff_ffff ? n : null;
}
