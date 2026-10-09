/**
 * 考試格式 PDF 的公開介面（PDF 模組與呼叫端之間的約定）。
 *
 * 呼叫端：歷屆試題作答頁（features/exams/ExamPaperPage.tsx）、模擬考（features/mock/）。
 * 實作：features/pdf/（設計見 docs/design/mock-exam-pdf.md §4–§5）。
 *
 * 這個檔案是兩邊共用的約定：改欄位要同時通知 PDF 與模擬考的開發者，並更新設計文件 §4.2。
 * 只加選填欄位不算破壞相容；刪除或改名欄位要兩邊一起改。
 */
import type { Exam } from '../../data/exams';

/** 模擬考版 PDF 的封面資訊（歷屆試題版不傳）。 */
export interface MockPdfMeta {
  /** 封面主標的前綴，例如「學測英文中心模擬考」。 */
  title: string;
  /** 卷別名稱，例如「115 學測英文（真題卷）」「115 參考試卷」。 */
  paperLabel: string;
  /** 建議作答時間（分鐘），印在封面「考試時間」。 */
  durationMinutes: number;
  /** 實考模式：封面加印「開考後 60 分鐘內不交卷」。 */
  strict?: boolean;
  /** 封面額外提醒（例如 ref-115 的「本卷 49 題沿用歷屆試題」）；每個元素一行。 */
  notices?: readonly string[];
}

export interface ExamPdfOptions {
  /** 附「答題卷」：選擇題答案卡（簡化格式）、混合題作答區、中譯英與英文作文的格線頁。 */
  includeAnswerSheet: boolean;
  /**
   * 附「答案」頁：選擇題答案、混合題官方答案（含可接受答案）；中譯英只印「官方參考譯文見大考中心評分原則」與網址，
   * 作文不印任何範文（站主決定 D8、docs/research/04 §4.3）。
   */
  includeAnswerKey: boolean;
  /** 有值時產生模擬考版封面；沒有就是歷屆試題版。 */
  mockMeta?: MockPdfMeta;
}

/** 產生進度（給按鈕顯示「準備字型…」「排版中…」）。 */
export type PdfProgressPhase = 'engine' | 'fonts' | 'layout' | 'done';

export interface PdfProgress {
  phase: PdfProgressPhase;
  /** 0–1；不知道進度時省略。 */
  ratio?: number;
}

export interface RenderExamPdfOptions extends ExamPdfOptions {
  onProgress?: (progress: PdfProgress) => void;
  /** 取消（使用者離開頁面或按「取消」）。被取消時 Promise 以 AbortError 拒絕。 */
  signal?: AbortSignal;
}

/**
 * 產生一份考卷的考試格式 PDF（A4、文字可選取與搜尋、字型嵌入子集）。
 * 第一次呼叫才下載 PDF 引擎與字型（約 0.4 MB＋1.5 MB gzip），之後同一頁面重用。
 */
export type RenderExamPdf = (exam: Exam, options: RenderExamPdfOptions) => Promise<Blob>;

/** PDF 產生失敗的原因（畫面依此顯示中文說明）。 */
export type PdfErrorKind =
  /** 瀏覽器缺少必要功能（DecompressionStream、Web Worker、Blob 下載）。 */
  | 'unsupported'
  /** 字型或引擎下載失敗（離線、網路中斷）。 */
  | 'network'
  /** 排版或產生時的程式錯誤。 */
  | 'render'
  | 'aborted';

export class PdfError extends Error {
  readonly kind: PdfErrorKind;
  constructor(kind: PdfErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfError';
    this.kind = kind;
  }
}
