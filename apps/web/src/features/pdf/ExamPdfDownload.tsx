/**
 * 「下載考試格式 PDF」區塊（設計文件 §4.4、§4.5）：選擇要不要附答題卷、答案，按下後產生並下載 A4 題本格式的 PDF。
 *
 * 呼叫端只要傳考卷（模擬考另外傳 mockMeta）；字型與 PDF 引擎在按下按鈕時才下載（約 2 MB，第一次約 2–6 秒）。
 *   - 產生中顯示進度（role="status"）與「取消」；完成顯示「已下載」，失敗依原因顯示中文說明與「再試一次」；
 *   - iPhone／iPad：瀏覽器支援分享檔案時多一顆「分享／儲存到檔案」（比 Safari 的下載預覽好找）；
 *   - LINE、Instagram、Facebook 等 App 內建的瀏覽器常擋下載：先提示改用 Safari／Chrome，完成後也提供「在新分頁開啟 PDF」。
 * PDF_DOWNLOAD_ENABLED 為 false、也沒有打開預覽開關（index.ts 的 pdfDownloadVisible）時，整個區塊不顯示。
 * props 是和頁面之間的約定（歷屆試題作答頁、模擬考），改動要通知模擬考開發者。
 *
 * 本站自組卷（mockMeta.sitePaper 有值，docs/design/bank-mock.md §2.5、§7.7）：兩個勾選換成三種版本（單選）加「雙面列印」——
 *   學生卷（封面＋題本＋資料來源＋答題卷）｜教師卷（卷子資訊＋答案＋解析＋資料來源，不含題本）｜題本＋答案＋解析；
 * 說明文字也換成本站自組卷的版本。歷屆卷與現有模擬考的區塊完全不變。
 * onDownloaded：存檔（交給瀏覽器下載）或分享成功時各呼叫一次；失敗、取消不呼叫（自組卷用它記「下載過」、確認快照）。
 */
import { Download, ExternalLink, Share2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { Exam } from '../../data/exams';
import {
  pdfDownloadVisible,
  pdfFileName,
  renderExamPdf,
  sitePdfOptions,
  type ExamPdfOptions,
  type MockPdfMeta,
  type PdfDownloadInfo,
  type SitePdfVersion,
} from './index';
import { canShareFile, usePdfDownload, type PdfErrorTextMap } from './usePdfDownload';

export type { SitePdfVersion } from './index';
export { isInAppBrowser } from './usePdfDownload';

export interface ExamPdfDownloadProps {
  exam: Exam;
  /** 模擬考版封面；歷屆試題不傳。sitePaper 有值時是本站自組卷（三種版本＋雙面列印）。 */
  mockMeta?: MockPdfMeta;
  /**
   * 「附答案」預設是否勾選（模擬考開考前應為 false，交卷後可以是 true）。
   * 本站自組卷：沒有給 defaultSiteVersion 時，true 預設「題本＋答案＋解析」（成績單），false 預設「學生卷」（卷子頁）。
   */
  defaultIncludeAnswerKey?: boolean;
  /** 本站自組卷預設選哪一種版本（優先於 defaultIncludeAnswerKey）。 */
  defaultSiteVersion?: SitePdfVersion;
  /** 下載成功：存檔（via 'save'）或分享（via 'share'）成功時各呼叫一次；失敗或取消不呼叫。 */
  onDownloaded?: (info: PdfDownloadInfo) => void;
  className?: string;
}

const SITE_VERSIONS: readonly { value: SitePdfVersion; label: string; hint: string }[] = [
  { value: 'student', label: '學生卷', hint: '題本＋答題卷' },
  { value: 'teacher', label: '教師卷', hint: '答案＋解析，不含題本' },
  { value: 'full', label: '題本＋答案＋解析', hint: '自己練習、對答案用' },
];

/** 本站自組卷的說明裡「題目從哪裡來」（docs/design/weak-paper.md §8.7：加強卷可能有出版社題組；自組模擬考一律是 ai）。 */
const SITE_SOURCE_HINT: Readonly<Record<'ai' | 'publisher' | 'mixed', string>> = {
  ai: '題目由 AI 撰寫',
  publisher: '題目出自出版社模擬試題（經授權）',
  mixed: '題目由 AI 撰寫或出自出版社模擬試題（經授權）',
};

const ERROR_TEXT: PdfErrorTextMap = {
  unsupported: '這個瀏覽器無法產生 PDF。請更新到最新版的 Safari、Chrome、Edge 或 Firefox 後再試。',
  network: '字型或 PDF 產生器下載失敗，請確認網路連線後再試一次；如果還是不行，請重新整理頁面。',
  render: '產生 PDF 時發生錯誤，請再試一次；如果一直失敗，請告訴我們是哪一份考卷。',
};

type DownloadInfo = Omit<PdfDownloadInfo, 'via'>;

export function ExamPdfDownload({ exam, mockMeta, defaultIncludeAnswerKey = false, defaultSiteVersion, onDownloaded, className = '' }: ExamPdfDownloadProps) {
  const id = useId();
  const [enabled] = useState(pdfDownloadVisible);
  const [includeAnswerSheet, setIncludeAnswerSheet] = useState(true);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(defaultIncludeAnswerKey);
  const site = mockMeta?.sitePaper;
  const [siteVersion, setSiteVersion] = useState<SitePdfVersion>(defaultSiteVersion ?? (defaultIncludeAnswerKey ? 'full' : 'student'));
  const [duplex, setDuplex] = useState(false);
  // 同一個元件換了考卷（不經過卸載的頁面切換）：上一份的結果不能留著（resetKey）。
  const download = usePdfDownload<DownloadInfo>({ errorText: ERROR_TEXT, onDownloaded, resetKey: exam.id });
  const { status, inApp, ios } = download;

  if (!enabled) return null;

  const start = () =>
    download.start(async ({ signal, onProgress }) => {
      const options: ExamPdfOptions = site
        ? { ...sitePdfOptions(siteVersion, duplex), ...(mockMeta ? { mockMeta } : {}) }
        : { includeAnswerSheet, includeAnswerKey, ...(mockMeta ? { mockMeta } : {}) };
      const blob = await renderExamPdf(exam, { ...options, signal, onProgress });
      const fileName = pdfFileName(exam, options);
      return { blob, fileName, info: { fileName, includeBooklet: options.includeBooklet ?? true, includeAnswerKey: options.includeAnswerKey } };
    });

  const cancel = download.cancel;
  const share = download.share;

  const busy = download.busy;
  const hintId = `${id}-hint`;
  const statusText = download.statusText;

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>
      <h2 id={`${id}-title`} className="font-semibold">
        下載考試格式 PDF
      </h2>
      <p id={hintId} className="mt-1 text-sm text-muted">
        {site
          ? `A4 題本格式，可以列印後計時作答。本站自組試卷，${SITE_SOURCE_HINT[site.footerKind ?? 'ai']}；圖表印成資料表，作文的圖以文字描述代替。`
          : 'A4 題本格式，可以列印後計時作答。本站依大考中心公開試題重新排版，非官方文件；圖片以文字描述代替。'}
        {download.firstTime && '第一次需要下載約 2 MB 的字型與產生器。'}
      </p>
      {inApp && (
        <p className="mt-2 rounded-xl bg-badge-bg px-3 py-2 text-sm text-badge-fg">
          App 內建的瀏覽器（LINE、Instagram、Facebook 等）常常無法下載檔案：請點右上角的選單，選「用 Safari／Chrome 開啟」後再下載。
        </p>
      )}
      {site ? (
        <fieldset className="mt-2" disabled={busy}>
          <legend className="text-sm font-medium">PDF 版本</legend>
          <div className="flex flex-wrap gap-x-5 text-sm">
            {SITE_VERSIONS.map((v) => (
              <label key={v.value} className="inline-flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" className="size-4" name={`${id}-version`} value={v.value} checked={siteVersion === v.value} onChange={() => setSiteVersion(v.value)} />
                <span>
                  {v.label}
                  <span className="text-muted">（{v.hint}）</span>
                </span>
              </label>
            ))}
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={duplex} onChange={(e) => setDuplex(e.currentTarget.checked)} />
            雙面列印（每段從單數頁開始）
          </label>
        </fieldset>
      ) : (
        <fieldset className="mt-2" disabled={busy}>
          <legend className="sr-only">PDF 內容</legend>
          <div className="flex flex-wrap gap-x-5 text-sm">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4" checked={includeAnswerSheet} onChange={(e) => setIncludeAnswerSheet(e.currentTarget.checked)} />
              附答題卷
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
              <input type="checkbox" className="size-4" checked={includeAnswerKey} onChange={(e) => setIncludeAnswerKey(e.currentTarget.checked)} />
              附答案（放在最後）
            </label>
          </div>
        </fieldset>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          aria-describedby={hintId}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary disabled:opacity-60"
        >
          <Download aria-hidden="true" className="size-4" />
          {busy ? '產生中…' : '下載 PDF'}
        </button>
        {busy && (
          <button type="button" onClick={cancel} className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-primary underline">
            取消
          </button>
        )}
        {status.kind === 'error' && (
          <button type="button" onClick={() => void start()} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium hover:border-primary">
            再試一次
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={`mt-1 min-h-5 text-sm break-words ${status.kind === 'error' ? 'text-bad' : 'text-muted'}`}>
        {statusText}
      </p>
      {status.kind === 'done' && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {ios && canShareFile(status.file) && (
            <button
              type="button"
              onClick={() => void share(status.file, status.info)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 font-medium hover:border-primary"
            >
              <Share2 aria-hidden="true" className="size-4" />
              分享／儲存到檔案
            </button>
          )}
          <a href={status.url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 text-primary underline">
            <ExternalLink aria-hidden="true" className="size-4" />
            沒看到檔案？在新分頁開啟 PDF
          </a>
        </div>
      )}
    </section>
  );
}
