/**
 * renderExamPdf、renderVocabHandoutPdf 的實作（index.ts 動態載入這個模組）：把工作交給 Web Worker，回傳 PDF 的 Blob。
 * 不支援 Worker 的環境（極少數內嵌瀏覽器）改在主執行緒產生，畫面會停頓幾秒，但仍能下載。
 * 兩種工作共用同一個 Worker（字型只載一次）與 runJob 的進度、取消、錯誤處理。
 */
import type { Exam } from '../../../data/exams';
import { PdfError, type PdfProgress, type RenderExamPdfOptions } from '../types';
import type { RenderVocabHandoutPdfOptions, VocabHandoutPdfData } from '../vocabTypes';
import type { PdfWorkerRequest, PdfWorkerResponse } from './protocol';

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'pdf' });
  return worker;
}

function resetWorker(): void {
  worker?.terminate();
  worker = null;
}

type JobRequest = PdfWorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** 把一個工作交給 Worker：轉送進度、處理取消（終止 Worker）與錯誤。 */
function runJob(request: JobRequest, onProgress: ((p: PdfProgress) => void) | undefined, signal: AbortSignal | undefined): Promise<Blob> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onMessage = (event: MessageEvent<PdfWorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if (msg.type === 'progress') {
        onProgress?.(msg.progress);
        return;
      }
      cleanup();
      if (msg.type === 'done') resolve(msg.blob);
      else reject(new PdfError(msg.kind, msg.message));
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      resetWorker();
      // 產生時的錯誤都在 Worker 裡接住、以訊息回傳；會走到這裡的幾乎都是 Worker 檔案本身載入失敗（離線、網站剛更新）。
      reject(new PdfError('network', 'PDF 產生器啟動失敗，請重新整理頁面後再試。', { cause: event.error ?? event.message }));
    };
    const onAbort = () => {
      cleanup();
      // 排版中途沒辦法暫停 pdfmake，直接結束 Worker；下次再建一個（字型有 HTTP 快取，不會重新下載）。
      resetWorker();
      reject(new PdfError('aborted', '已取消'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ ...request, id } as PdfWorkerRequest);
  });
}

export async function renderExamPdf(exam: Exam, options: RenderExamPdfOptions): Promise<Blob> {
  const { onProgress, signal, ...pdfOptions } = options;
  if (signal?.aborted) throw new PdfError('aborted', '已取消');
  if (typeof Worker === 'undefined') {
    const { generateExamPdf, onlineUrlFor } = await import('./generate');
    return generateExamPdf(exam, { ...pdfOptions, onlineUrl: onlineUrlFor(exam, pdfOptions, globalThis.location?.origin) }, onProgress, signal);
  }
  return runJob({ kind: 'exam', exam, options: pdfOptions }, onProgress, signal);
}

export async function renderVocabHandoutPdf(data: VocabHandoutPdfData, options: RenderVocabHandoutPdfOptions): Promise<Blob> {
  const { onProgress, signal } = options;
  if (signal?.aborted) throw new PdfError('aborted', '已取消');
  if (typeof Worker === 'undefined') {
    const { generateVocabHandoutPdf } = await import('./generate');
    return generateVocabHandoutPdf(data, onProgress, signal);
  }
  return runJob({ kind: 'vocab', data }, onProgress, signal);
}
