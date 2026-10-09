/**
 * PDF Web Worker：在背景執行緒載入 pdfmake 與字型並排版，整份考卷約 0.4–3 秒（手機較慢），
 * 期間主畫面照常捲動、進度條照常更新（實測主執行緒最長停頓 38 ms；在主執行緒排版會凍住畫面數秒）。
 * Worker 不關閉，字型留在記憶體裡，同一頁面第二次下載不必重新解壓。
 */
import { PdfError } from '../types';
import { generateExamPdf, onlineUrlFor } from './generate';
import type { PdfWorkerRequest, PdfWorkerResponse } from './protocol';

// tsconfig 用 DOM lib（沒有 WebWorker lib），這裡只宣告用得到的 Worker 全域。
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PdfWorkerRequest>) => void) | null;
  postMessage(message: PdfWorkerResponse): void;
  location?: { origin: string };
};

scope.onmessage = (event) => {
  const { id, exam, options } = event.data;
  const onlineUrl = onlineUrlFor(exam, options, scope.location?.origin);
  generateExamPdf(exam, { ...options, onlineUrl }, (progress) => scope.postMessage({ id, type: 'progress', progress }))
    .then((blob) => scope.postMessage({ id, type: 'done', blob }))
    .catch((err: unknown) => {
      const kind = err instanceof PdfError ? err.kind : 'render';
      const message = err instanceof Error ? err.message : String(err);
      scope.postMessage({ id, type: 'error', kind, message });
    });
};
