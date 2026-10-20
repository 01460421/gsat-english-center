/**
 * 考試格式 PDF 的對外入口（輕量）：頁面只 import 這個檔案與 ExamPdfDownload.tsx。
 * PDF 引擎、Worker 與字型都在 renderExamPdf() 第一次被呼叫時才動態載入（engine/render.ts），不會進到頁面的 JS。
 */
import type { Exam } from '../../data/exams';
import { examShortName } from '../../data/exams';
import { PdfError, type ExamPdfOptions, type RenderExamPdf } from './types';

export type {
  ExamPdfOptions,
  MockPdfMeta,
  PdfDownloadInfo,
  PdfErrorKind,
  PdfProgress,
  PdfProgressPhase,
  RenderExamPdf,
  RenderExamPdfOptions,
  SitePaperPdfMeta,
} from './types';
export { PdfError };

/**
 * 「下載 PDF」按鈕是否對所有人顯示。docs/design/mock-exam-pdf.md §9.1 的 P1–P7、P9 已通過；
 * P8（iPhone Safari 與 Android Chrome 實機下載）沒有做，2026-10-19 站主決定直接開放。
 * 要再關掉只改這一行成 false；關掉時仍可用 pdfPreviewEnabled() 的預覽開關在正式站上測試。
 */
export const PDF_DOWNLOAD_ENABLED = true;

const PREVIEW_KEY = 'gsat-pdf-preview';

/**
 * 預覽開關（PDF_DOWNLOAD_ENABLED 還是 false 時用）：網址加上 `?pdf=preview` 打開、`?pdf=off` 關掉，
 * 記在這個瀏覽器的 localStorage（`gsat-pdf-preview`）。給站主在正式站用 iPhone／Android 實機驗收（設計文件 §9.1 P8）
 * 與 Playwright 測試用；一般使用者看不到按鈕。頁面判斷要不要顯示時用 pdfDownloadVisible()。
 */
export function pdfPreviewEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('pdf');
    if (param === 'preview') window.localStorage.setItem(PREVIEW_KEY, '1');
    else if (param === 'off') window.localStorage.removeItem(PREVIEW_KEY);
    return window.localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    // 無痕模式或停用網站資料：localStorage 會丟例外，當作沒打開。
    return false;
  }
}

/**
 * 頁面上和 PDF 下載有關的按鈕與說明要不要顯示：正式開放（PDF_DOWNLOAD_ENABLED），或這個瀏覽器打開了預覽開關。
 * ExamPdfDownload、模擬考列表的「下載 PDF」與說明文字都用這一個判斷，預覽時才不會有的地方出現、有的地方沒有。
 */
export function pdfDownloadVisible(): boolean {
  return PDF_DOWNLOAD_ENABLED || pdfPreviewEnabled();
}

export const renderExamPdf: RenderExamPdf = async (exam, options) => {
  let impl: RenderExamPdf;
  try {
    ({ renderExamPdf: impl } = await import('./engine/render'));
  } catch (err) {
    // 離線，或網站剛更新、這個頁面還在要舊版的檔案（檔名帶雜湊，舊檔已經不在）：重新整理就好。
    throw new PdfError('network', 'PDF 產生器下載失敗，請確認網路連線或重新整理頁面後再試。', { cause: err });
  }
  return impl(exam, options);
};

/** 本站自組卷的三種版本（docs/design/bank-mock.md §2.5）：學生卷、教師卷、題本＋答案＋解析。 */
export type SitePdfVersion = 'student' | 'teacher' | 'full';

/** 自組卷的版本 → PDF 選項（bank-mock §7.7 的表）。 */
export function sitePdfOptions(
  version: SitePdfVersion,
  duplex: boolean,
): Pick<ExamPdfOptions, 'includeAnswerSheet' | 'includeAnswerKey' | 'includeExplanations' | 'includeBooklet' | 'duplex'> {
  switch (version) {
    case 'student':
      return { includeBooklet: true, includeAnswerSheet: true, includeAnswerKey: false, includeExplanations: false, duplex };
    case 'teacher':
      return { includeBooklet: false, includeAnswerSheet: false, includeAnswerKey: true, includeExplanations: true, duplex };
    case 'full':
      return { includeBooklet: true, includeAnswerSheet: true, includeAnswerKey: true, includeExplanations: true, duplex };
  }
}

/**
 * 下載檔名：「學測英文中心_115學測英文_題本.pdf」「學測英文中心_模擬考_115學測英文_含答案.pdf」。
 * 本站自組卷（docs/design/bank-mock.md §2.5）：「學測英文中心_自組模擬考_進階練習_A-3KD9W_學生卷.pdf」，
 * 另外兩種結尾是「_教師卷」「_含答案解析」。
 */
export function pdfFileName(
  exam: Pick<Exam, 'exam' | 'year' | 'session' | 'target'>,
  options: Pick<ExamPdfOptions, 'includeAnswerKey' | 'mockMeta' | 'includeBooklet'>,
): string {
  const site = options.mockMeta?.sitePaper;
  if (site) {
    const version = options.includeBooklet === false ? '教師卷' : options.includeAnswerKey ? '含答案解析' : '學生卷';
    const safe = (s: string) => s.replace(/[\s/\\:*?"<>|]+/g, '');
    return `學測英文中心_自組模擬考_${safe(site.tierLabel)}_${safe(site.code)}_${version}.pdf`;
  }
  const name = `${examShortName(exam).replace(/\s+/g, '')}英文`;
  const parts = ['學測英文中心', options.mockMeta ? '模擬考' : null, name, options.mockMeta ? null : '題本', options.includeAnswerKey ? '含答案' : null];
  return `${parts.filter(Boolean).join('_')}.pdf`;
}

/**
 * 把 Blob 存成檔案：用 <a download>（桌機 Chrome／Edge／Firefox／Safari、Android Chrome、iOS 13 以上的 Safari 都支援）。
 * 物件網址保留 60 秒再釋放：iOS 會先開預覽，太早釋放會變成空白頁。
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
