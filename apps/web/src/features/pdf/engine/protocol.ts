/**
 * 主執行緒 ↔ PDF Web Worker 的訊息格式。函式（onProgress）與 AbortSignal 不能傳進 Worker，只傳資料。
 * 兩種工作：考卷（kind: 'exam'）與單字講義（kind: 'vocab'，docs/design/vocab-handout.md §6.3）。
 */
import type { Exam } from '../../../data/exams';
import type { ExamPdfOptions, PdfErrorKind, PdfProgress } from '../types';
import type { VocabHandoutPdfData } from '../vocabTypes';

export type PdfWorkerRequest =
  | { id: number; kind: 'exam'; exam: Exam; options: ExamPdfOptions }
  | { id: number; kind: 'vocab'; data: VocabHandoutPdfData };

export type PdfWorkerResponse =
  | { id: number; type: 'progress'; progress: PdfProgress }
  | { id: number; type: 'done'; blob: Blob }
  | { id: number; type: 'error'; kind: PdfErrorKind; message: string };
