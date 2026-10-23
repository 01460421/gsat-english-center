/**
 * 「下載 PDF」的狀態機（從 ExamPdfDownload.tsx 抽出，考卷與單字講義共用，docs/design/vocab-handout.md §6.3）：
 *   idle（可附「已取消」）→ busy（進度）→ done（已存檔，可分享或在新分頁開啟）／error（中文說明＋再試一次）。
 *
 * 處理的細節：
 *   - 存檔用 saveBlob（<a download>）；完成後另留一個物件網址給「在新分頁開啟 PDF」，換下一份或元件卸載時釋放；
 *   - 取消：AbortController，被取消的工作晚回來也不會蓋掉新的狀態；
 *   - iPhone／iPad 有分享面板（navigator.share 檔案）時多一顆「分享／儲存到檔案」；
 *   - LINE、Instagram、Facebook 等 App 內建瀏覽器常擋下載，畫面先提示改用 Safari／Chrome；
 *   - warmed：這個頁面已經成功產生過一次（引擎與字型在記憶體與 HTTP 快取裡），就不再提示「第一次要下載 2 MB」。
 * resetKey 改變（同一個元件換了考卷或講義內容）時回到 idle：上一份的結果不能留著，免得「在新分頁開啟」打開別份。
 */
import { useEffect, useRef, useState } from 'react';
import { PdfError, saveBlob, type PdfErrorKind, type PdfProgress } from './index';

export type PdfErrorTextMap = Record<Exclude<PdfErrorKind, 'aborted'>, string>;

const PHASE_TEXT: Record<PdfProgress['phase'], string> = {
  engine: '載入 PDF 產生器…',
  fonts: '下載字型…',
  layout: '排版中…',
  done: '完成',
};

/** 預設的進度文字：「下載字型…（50%）」「排版中…」。 */
export function defaultProgressText(p: PdfProgress): string {
  const ratio = p.phase === 'fonts' && p.ratio !== undefined ? `（${Math.round(p.ratio * 100)}%）` : '';
  return `${PHASE_TEXT[p.phase]}${ratio}`;
}

export type PdfDownloadStatus<I> =
  | { kind: 'idle'; cancelled?: boolean }
  | { kind: 'busy'; progress: PdfProgress }
  | { kind: 'done'; fileName: string; file: File; url: string; info: I }
  | { kind: 'error'; message: string };

/** 一次產生工作：拿到 signal 與進度回報，回傳 PDF、檔名與要交給 onDownloaded 的資訊。 */
export type PdfDownloadTask<I> = (ctx: { signal: AbortSignal; onProgress: (p: PdfProgress) => void }) => Promise<{ blob: Blob; fileName: string; info: I }>;

/** 這個頁面已經成功產生過一次（考卷與講義共用同一個引擎與字型）。 */
let warmed = false;

/** 測試用。 */
export function isPdfWarmed(): boolean {
  return warmed;
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

export function canShareFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export interface UsePdfDownloadOptions<I> {
  errorText: PdfErrorTextMap;
  /** 存檔（via 'save'）或分享（via 'share'）成功時呼叫；失敗、取消不呼叫。每次重繪可以傳新的函式。 */
  onDownloaded?: ((info: I & { via: 'save' | 'share' }) => void) | undefined;
  /** 改變時回到 idle（見檔頭）。 */
  resetKey?: string;
  progressText?: (p: PdfProgress) => string;
}

export interface PdfDownloadController<I> {
  status: PdfDownloadStatus<I>;
  busy: boolean;
  /** role="status" 要顯示的文字（進度、已下載、錯誤說明、已取消）。 */
  statusText: string;
  /** 首次產生（還沒下載過引擎與字型）。 */
  firstTime: boolean;
  inApp: boolean;
  ios: boolean;
  start: (task: PdfDownloadTask<I>) => Promise<void>;
  cancel: () => void;
  share: (file: File, info: I) => Promise<void>;
}

export function usePdfDownload<I>(options: UsePdfDownloadOptions<I>): PdfDownloadController<I> {
  const { errorText, resetKey, progressText = defaultProgressText } = options;
  // 回呼放在 ref：頁面每次重繪傳進新的函式，不影響進行中的產生。
  const onDownloadedRef = useRef(options.onDownloaded);
  useEffect(() => {
    onDownloadedRef.current = options.onDownloaded;
  });
  const [status, setStatus] = useState<PdfDownloadStatus<I>>({ kind: 'idle' });
  const [inApp] = useState(() => typeof navigator !== 'undefined' && isInAppBrowser(navigator.userAgent));
  const [ios] = useState(isIOS);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
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

  const start = async (task: PdfDownloadTask<I>) => {
    abortRef.current?.abort();
    releaseUrl();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'busy', progress: { phase: 'engine' } });
    try {
      const { blob, fileName, info } = await task({
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setStatus({ kind: 'busy', progress });
        },
      });
      if (controller.signal.aborted) return;
      saveBlob(blob, fileName);
      warmed = true;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setStatus({ kind: 'done', fileName, file: new File([blob], fileName, { type: 'application/pdf' }), url, info });
      onDownloadedRef.current?.({ ...info, via: 'save' });
    } catch (err) {
      if (abortRef.current !== controller) return;
      if (err instanceof PdfError && err.kind === 'aborted') {
        setStatus({ kind: 'idle', cancelled: true });
        return;
      }
      const kind = err instanceof PdfError ? err.kind : 'render';
      setStatus({ kind: 'error', message: kind === 'aborted' ? errorText.render : errorText[kind] });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  const share = async (file: File, info: I) => {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch {
      // 使用者關掉分享面板，或系統不讓分享：不必提示（檔案已經下載過一次）。
      return;
    }
    onDownloadedRef.current?.({ ...info, via: 'share' });
  };

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

  return { status, busy: status.kind === 'busy', statusText, firstTime: !warmed, inApp, ios, start, cancel, share };
}
