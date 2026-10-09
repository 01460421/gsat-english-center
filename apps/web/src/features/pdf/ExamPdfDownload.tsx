/**
 * 「下載考試格式 PDF」區塊（設計文件 §4.4、§4.5）：選擇要不要附答題卷、答案，按下後產生並下載 A4 題本格式的 PDF。
 *
 * 呼叫端只要傳考卷（模擬考另外傳 mockMeta）；字型與 PDF 引擎在按下按鈕時才下載（約 2 MB，第一次約 2–6 秒）。
 *   - 產生中顯示進度（role="status"）與「取消」；完成顯示「已下載」，失敗依原因顯示中文說明與「再試一次」；
 *   - iPhone／iPad：瀏覽器支援分享檔案時多一顆「分享／儲存到檔案」（比 Safari 的下載預覽好找）；
 *   - LINE、Instagram、Facebook 等 App 內建的瀏覽器常擋下載：先提示改用 Safari／Chrome，完成後也提供「在新分頁開啟 PDF」。
 * PDF_DOWNLOAD_ENABLED 為 false、也沒有打開預覽開關（index.ts 的 pdfPreviewEnabled）時，整個區塊不顯示。
 * props 是和頁面之間的約定（歷屆試題作答頁、模擬考），改動要通知模擬考開發者。
 */
import { Download, ExternalLink, Share2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Exam } from '../../data/exams';
import { PDF_DOWNLOAD_ENABLED, PdfError, pdfFileName, pdfPreviewEnabled, renderExamPdf, saveBlob, type MockPdfMeta, type PdfErrorKind, type PdfProgress } from './index';

export interface ExamPdfDownloadProps {
  exam: Exam;
  /** 模擬考版封面；歷屆試題不傳。 */
  mockMeta?: MockPdfMeta;
  /** 「附答案」預設是否勾選（模擬考開考前應為 false，交卷後可以是 true）。 */
  defaultIncludeAnswerKey?: boolean;
  className?: string;
}

const PHASE_TEXT: Record<PdfProgress['phase'], string> = {
  engine: '載入 PDF 產生器…',
  fonts: '下載字型…',
  layout: '排版中…',
  done: '完成',
};

const ERROR_TEXT: Record<Exclude<PdfErrorKind, 'aborted'>, string> = {
  unsupported: '這個瀏覽器無法產生 PDF。請更新到最新版的 Safari、Chrome、Edge 或 Firefox 後再試。',
  network: '字型或 PDF 產生器下載失敗，請確認網路連線後再試一次；如果還是不行，請重新整理頁面。',
  render: '產生 PDF 時發生錯誤，請再試一次；如果一直失敗，請告訴我們是哪一份考卷。',
};

type Status =
  | { kind: 'idle'; cancelled?: boolean }
  | { kind: 'busy'; progress: PdfProgress }
  | { kind: 'done'; fileName: string; file: File; url: string }
  | { kind: 'error'; message: string };

/** 這個頁面已經成功產生過一次（引擎與字型在記憶體與 HTTP 快取裡），就不再提示「第一次要下載 2 MB」。 */
let warmed = false;

function progressText(p: PdfProgress): string {
  const ratio = p.phase === 'fonts' && p.ratio !== undefined ? `（${Math.round(p.ratio * 100)}%）` : '';
  return `${PHASE_TEXT[p.phase]}${ratio}`;
}

/** iPhone／iPad（iPadOS 的 Safari 自稱 Macintosh，用觸控點數分辨）。 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** App 內建的瀏覽器（LINE、Instagram、Facebook、Messenger、微信）：常常不能下載檔案。 */
export function isInAppBrowser(ua: string): boolean {
  return /\bLine\/|FBAN|FBAV|FB_IAB|FBIOS|Instagram|MicroMessenger|KAKAOTALK/i.test(ua);
}

function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function ExamPdfDownload({ exam, mockMeta, defaultIncludeAnswerKey = false, className = '' }: ExamPdfDownloadProps) {
  const id = useId();
  const [enabled] = useState(() => PDF_DOWNLOAD_ENABLED || pdfPreviewEnabled());
  const [includeAnswerSheet, setIncludeAnswerSheet] = useState(true);
  const [includeAnswerKey, setIncludeAnswerKey] = useState(defaultIncludeAnswerKey);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [inApp] = useState(() => typeof navigator !== 'undefined' && isInAppBrowser(navigator.userAgent));
  const [ios] = useState(isIOS);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  // 同一個元件換了考卷（不經過卸載的頁面切換）：上一份的結果不能留著，免得「在新分頁開啟」打開別份考卷。
  const [examId, setExamId] = useState(exam.id);
  if (examId !== exam.id) {
    setExamId(exam.id);
    setStatus({ kind: 'idle' });
  }

  const releaseUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  useEffect(
    () => () => {
      abortRef.current?.abort();
      releaseUrl();
    },
    [],
  );

  if (!enabled) return null;

  const start = async () => {
    abortRef.current?.abort();
    releaseUrl();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'busy', progress: { phase: 'engine' } });
    const options = { includeAnswerSheet, includeAnswerKey, ...(mockMeta ? { mockMeta } : {}) };
    try {
      const blob = await renderExamPdf(exam, {
        ...options,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setStatus({ kind: 'busy', progress });
        },
      });
      if (controller.signal.aborted) return;
      const fileName = pdfFileName(exam, options);
      saveBlob(blob, fileName);
      warmed = true;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setStatus({ kind: 'done', fileName, file: new File([blob], fileName, { type: 'application/pdf' }), url });
    } catch (err) {
      if (abortRef.current !== controller) return;
      if (err instanceof PdfError && err.kind === 'aborted') {
        setStatus({ kind: 'idle', cancelled: true });
        return;
      }
      const kind = err instanceof PdfError ? err.kind : 'render';
      setStatus({ kind: 'error', message: kind === 'aborted' ? ERROR_TEXT.render : ERROR_TEXT[kind] });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const share = async (file: File) => {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch {
      // 使用者關掉分享面板，或系統不讓分享：不必提示（檔案已經下載過一次）。
    }
  };

  const busy = status.kind === 'busy';
  const hintId = `${id}-hint`;
  const statusText =
    status.kind === 'busy'
      ? progressText(status.progress)
      : status.kind === 'done'
        ? `已下載：${status.fileName}`
        : status.kind === 'error'
          ? status.message
          : status.kind === 'idle' && status.cancelled
            ? '已取消。'
            : '';

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>
      <h2 id={`${id}-title`} className="font-semibold">
        下載考試格式 PDF
      </h2>
      <p id={hintId} className="mt-1 text-sm text-muted">
        A4 題本格式，可以列印後計時作答。本站依大考中心公開試題重新排版，非官方文件；圖片以文字描述代替。
        {!warmed && '第一次需要下載約 2 MB 的字型與產生器。'}
      </p>
      {inApp && (
        <p className="mt-2 rounded-xl bg-badge-bg px-3 py-2 text-sm text-badge-fg">
          App 內建的瀏覽器（LINE、Instagram、Facebook 等）常常無法下載檔案：請點右上角的選單，選「用 Safari／Chrome 開啟」後再下載。
        </p>
      )}
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
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={start}
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
          <button type="button" onClick={start} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium hover:border-primary">
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
              onClick={() => void share(status.file)}
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
