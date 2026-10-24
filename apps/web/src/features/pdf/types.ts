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
  /**
   * 本站自組卷（docs/design/bank-mock.md §7）：有值時封面、頁首頁尾、圖、答題卷、答案頁與文件屬性都換成本站自組卷的文字，
   * 不寫官方考試機構；另外可以印解析頁、資料來源頁，以及學生卷、教師卷與雙面列印（ExamPdfOptions 的三個選填欄位）。
   * 內容由 features/mock/bank/pdfText.ts 的 sitePaperPdfMeta() 組出來。
   */
  sitePaper?: SitePaperPdfMeta;
}

/** 本站自組卷的 PDF 資訊（全部是純資料，可以直接 postMessage 給 Worker）。 */
export interface SitePaperPdfMeta {
  /** 卷號，例如 B-7Q2MK（只供核對）。 */
  code: string;
  /** 難度名稱，例如「進階練習」。 */
  tierLabel: string;
  /** 組卷日期 YYYY-MM-DD。 */
  assembledOn: string;
  /** 資料版本（bank/index.json、組卷池的 version）。 */
  dataVersion: string;
  /** AI 出題聲明（「AI 出題・已通過自動驗證・人工審核中」）。 */
  aiNotice: string;
  /** 資料來源頁（§7.5）：依題號範圍（「35–38」）列出出處說明與參考資料；沒有參考資料的題組不列。 */
  references: { range: string; attribution: string | null; items: { publisher: string; title: string; url: string; license?: string }[] }[];
  answers: {
    /** 題號（中譯英1）→ 本站參考譯文；答案頁印第一個寫法。 */
    translation: Record<string, string[]>;
    /** 作文：評分重點（每項一行）與一篇 AI 範文（段落以換行分開；沒有範文是 null）。 */
    composition: { criteria: string[]; modelText: string | null };
    /** 題號 → 中文解析；null 表示沒有可印的解析（PDF 改印「請到線上檢討試卷查看」）。含 PDF 字型沒有的字時由版面程式改印同一句。 */
    explanations: Record<string, string | null>;
    /**
     * 混合題填充、簡答的題號 → 給部分分數（1 分）的寫法（題庫解析的 partial_credit_forms：選字正確、字形錯誤），
     * 答案頁印在該題的答案下方，紙本批改和線上自動判分才一致（§6.3）。沒有就不印。
     */
    partialCredit?: Record<string, string[]>;
    /**
     * 出版社授權結束、題目已經遮住的題組裡的填充、簡答題號（docs/design/weak-paper.md §7.6）：答案頁不印答案文字。
     * 只有加強卷有遮住的題組時才有。
     */
    ended?: string[];
  };
  /**
   * 以下三個欄位只有卷子裡有出版社題組時才有（docs/design/weak-paper.md §9.5；features/mock/bank/paperSources.ts 組出來）。
   * 自組模擬考（只用本站題）不傳，PDF 和原本完全相同。
   */
  /** 封面「題目來源」的幾行（本站題庫、各出版社的書名，經授權使用）。 */
  sourceLines?: readonly string[];
  /** 題組 id（s5g2）→ 這組的出處（只有出版社題組）。題本每組標題下一行印出。 */
  groupSources?: Record<string, string>;
  /** 頁尾聲明的種類：ai（現行）、publisher（全部是出版社題）、mixed。 */
  footerKind?: 'ai' | 'publisher' | 'mixed';
  /**
   * 學習助手加強卷（bk2，docs/design/weak-paper.md §9.5）的卷別：弱點加強卷 w、模考格式卷 f、隨機抽題卷 r、中性模考格式卷 m。
   * 有值時封面、頁首頁尾、各節標題、文件屬性與檔名改用加強卷的文字（layout/strings.ts 的 WEAK_PAPER_TEXT），
   * tierLabel 是卷子裡出現的難度（跨難度時「穩定基礎、進階練習」）。自組模擬考（bk1）不傳，PDF 和原本完全相同。
   */
  paperKind?: 'w' | 'f' | 'r' | 'm';
  /** 加強卷的作答時間（分鐘；教師卷的卷子資訊用，封面讀 MockPdfMeta.durationMinutes）。只有 paperKind 有值時才有。 */
  minutes?: number;
  /**
   * 加強卷封面的「本卷針對」（只在組卷的裝置上有：「我的加強卷」存的弱點名稱；分享來的卷子、隨機抽題卷沒有）。
   * balanced：均衡加強卷（沒有針對弱點）。名稱含 PDF 字型沒有的字時那一項不印。
   */
  targets?: { labels: readonly string[]; balanced: boolean };
}

export interface ExamPdfOptions {
  /** 附「答題卷」：選擇題答案卡（簡化格式）、混合題作答區、中譯英與英文作文的格線頁。 */
  includeAnswerSheet: boolean;
  /**
   * 附「答案」頁：選擇題答案、混合題官方答案（含可接受答案）；中譯英只印「官方參考譯文見大考中心評分原則」與網址，
   * 作文不印任何範文（站主決定 D8、docs/research/04 §4.3）。本站自組卷改印本站的答案、參考譯文與評分重點（bank-mock §7.4）。
   */
  includeAnswerKey: boolean;
  /** 有值時產生模擬考版封面；沒有就是歷屆試題版。 */
  mockMeta?: MockPdfMeta;
  /** 附解析頁（只有 mockMeta.sitePaper 有值時有效；需要 includeAnswerKey）。 */
  includeExplanations?: boolean;
  /** false：教師卷，不印封面與題本（只有 mockMeta.sitePaper 有值時有效）。預設 true。 */
  includeBooklet?: boolean;
  /** 雙面列印：答題卷、答案、解析每一段從單數頁開始（只有 mockMeta.sitePaper 有值時有效）。 */
  duplex?: boolean;
}

/** 下載成功（存檔或分享完成）時交給 ExamPdfDownload 的 onDownloaded（bank-mock §2.5：自組卷記為下載過、確認快照）。 */
export interface PdfDownloadInfo {
  fileName: string;
  /** 有沒有題本（教師卷是 false）。 */
  includeBooklet: boolean;
  /** 有沒有答案頁。 */
  includeAnswerKey: boolean;
  /** save＝已交給瀏覽器存檔（<a download>）；share＝分享面板回報完成。 */
  via: 'save' | 'share';
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
