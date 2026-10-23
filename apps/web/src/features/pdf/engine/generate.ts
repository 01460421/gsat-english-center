/**
 * 實際產生 PDF（Worker 裡執行；瀏覽器不支援 Worker 時主執行緒也用這個）。
 * 考卷與單字講義共用 pdfmake 與字型的載入、進度階段（engine → fonts → layout → done）。
 */
import type { Exam } from '../../../data/exams';
import { buildExamDocDefinition, type PdfLayoutOptions } from '../layout/buildDocDefinition';
import { buildVocabHandoutDocDefinition } from '../layout/vocab/buildVocabHandoutDocDefinition';
import { FONT_FILES } from '../fonts';
import { PdfError, type ExamPdfOptions, type PdfProgress } from '../types';
import type { VocabHandoutPdfData } from '../vocabTypes';
import type { PdfDocDefinition } from './docTypes';
import { loadPdfMake } from './pdfmakeApi';

const FONT_COUNT = Object.keys(FONT_FILES).length;

/**
 * 封面印的「線上作答與自動計分」網址：歷屆試題 /exams/{id}，模擬考 /mock/{id}。
 * 本站自組卷在代號後面加 `.p`（代表從 PDF 進來，docs/design/bank-mock.md §4.6）：封面與答題卷的 QR code 都用這個網址。
 * origin 是網站本身（Worker 的 self.location 與頁面同源）；拿不到就不印。
 */
export function onlineUrlFor(exam: Pick<Exam, 'id'>, options: Pick<ExamPdfOptions, 'mockMeta'>, origin: string | undefined): string | null {
  if (!origin || !/^https?:\/\//.test(origin)) return null;
  const suffix = options.mockMeta?.sitePaper ? SITE_PAPER_URL_SUFFIX : '';
  return `${origin}/${options.mockMeta ? 'mock' : 'exams'}/${encodeURIComponent(exam.id)}${suffix}`;
}

/** 自組卷網址的「從 PDF 進來」標記（同 features/mock/bank/code.ts 的 PDF_SUFFIX；PDF 模組不匯入組卷程式）。 */
export const SITE_PAPER_URL_SUFFIX = '.p';

/** 載入引擎與字型（回報進度），再把文件定義排成 PDF。build 在字型載完之後才呼叫（排版前的計算也算在「排版中」）。 */
async function generate(build: () => PdfDocDefinition, errorMessage: string, onProgress: (p: PdfProgress) => void, signal?: AbortSignal): Promise<Blob> {
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
    const blob = await pdfMake.createPdf(build()).getBlob();
    onProgress({ phase: 'done', ratio: 1 });
    return blob;
  } catch (err) {
    throw new PdfError('render', errorMessage, { cause: err });
  }
}

export function generateExamPdf(exam: Exam, options: PdfLayoutOptions, onProgress: (p: PdfProgress) => void = () => {}, signal?: AbortSignal): Promise<Blob> {
  return generate(() => buildExamDocDefinition(exam, options), 'PDF 排版時發生錯誤，請回報給我們（附上考卷名稱）。', onProgress, signal);
}

export function generateVocabHandoutPdf(data: VocabHandoutPdfData, onProgress: (p: PdfProgress) => void = () => {}, signal?: AbortSignal): Promise<Blob> {
  return generate(() => buildVocabHandoutDocDefinition(data), 'PDF 排版時發生錯誤，請回報給我們（附上講義代號）。', onProgress, signal);
}
