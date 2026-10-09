/** 主執行緒 ↔ PDF Web Worker 的訊息格式。函式（onProgress）與 AbortSignal 不能傳進 Worker，只傳資料。 */
import type { Exam } from '../../../data/exams';
import type { ExamPdfOptions, PdfErrorKind, PdfProgress } from '../types';

export interface PdfWorkerRequest {
  id: number;
  exam: Exam;
  options: ExamPdfOptions;
}

export type PdfWorkerResponse =
  | { id: number; type: 'progress'; progress: PdfProgress }
  | { id: number; type: 'done'; blob: Blob }
  | { id: number; type: 'error'; kind: PdfErrorKind; message: string };
