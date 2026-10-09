/**
 * 實際產生 PDF（Worker 裡執行；瀏覽器不支援 Worker 時主執行緒也用這個）。
 */
import type { Exam } from '../../../data/exams';
import { buildExamDocDefinition, type PdfLayoutOptions } from '../layout/buildDocDefinition';
import { FONT_FILES } from '../fonts';
import { PdfError, type ExamPdfOptions, type PdfProgress } from '../types';
import { loadPdfMake } from './pdfmakeApi';

const FONT_COUNT = Object.keys(FONT_FILES).length;

/**
 * 封面印的「線上作答與自動計分」網址：歷屆試題 /exams/{id}，模擬考 /mock/{id}。
 * origin 是網站本身（Worker 的 self.location 與頁面同源）；拿不到就不印。
 */
export function onlineUrlFor(exam: Pick<Exam, 'id'>, options: Pick<ExamPdfOptions, 'mockMeta'>, origin: string | undefined): string | null {
  if (!origin || !/^https?:\/\//.test(origin)) return null;
  return `${origin}/${options.mockMeta ? 'mock' : 'exams'}/${encodeURIComponent(exam.id)}`;
}

export async function generateExamPdf(
  exam: Exam,
  options: PdfLayoutOptions,
  onProgress: (p: PdfProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<Blob> {
  let fonts = 0;
  onProgress({ phase: 'engine' });
  const pdfMake = await loadPdfMake({
    signal,
    onEngineLoaded: () => onProgress({ phase: 'fonts', ratio: fonts / FONT_COUNT }),
    onFontLoaded: () => {
      fonts += 1;
      onProgress({ phase: 'fonts', ratio: fonts / FONT_COUNT });
    },
  });
  if (signal?.aborted) throw new PdfError('aborted', '已取消');
  onProgress({ phase: 'layout' });
  try {
    const blob = await pdfMake.createPdf(buildExamDocDefinition(exam, options)).getBlob();
    onProgress({ phase: 'done', ratio: 1 });
    return blob;
  } catch (err) {
    throw new PdfError('render', 'PDF 排版時發生錯誤，請回報給我們（附上考卷名稱）。', { cause: err });
  }
}
