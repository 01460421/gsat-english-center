/**
 * 模擬考的卷別（SPEC §6.11）：111–115 學測真題與 115 參考試卷。
 *
 * 順序就是列表上的建議順序：ref-115 有 49 題沿用歷屆試題（30 題來自 gsat-111），所以排在 gsat-111 之前，
 * 先做 ref-115 再做 gsat-111 時，gsat-111 才是「沒看過的卷子」。
 * scaleYear：成績單預設用哪一年的官方級分對照表（學生可以在成績單上切換 111–115）。
 */
import type { ReactNode } from 'react';
import { TIER_LABELS } from '@gsat/shared';
import type { Exam, SectionType } from '../../data/exams';
import type { QuestionExtras } from '../exams/QuestionExtras';
import type { MockPdfMeta } from '../pdf/types';
import { isBankPaperId, paperNumber, tierOfPaperId } from './bank/paperId';
import type { MockAttemptRecord, MockHistoryEntry } from './storage';

export interface MockPaper {
  examId: string;
  /** 列表與成績單上的名稱。 */
  label: string;
  /** 預設的級分對照年度。 */
  scaleYear: number;
  /** 開考前的提醒（ref-115 的沿用題說明）。 */
  reuseNotice?: string;
  /** 印在 PDF 封面的提醒（不提網站功能，紙本也看得懂）。 */
  pdfNotice?: string;
  /**
   * 本站自組卷（features/mock/bank，docs/design/bank-mock.md §6.1）才有；歷屆卷不設這個欄位，既有的程式路徑完全不變。
   * 由 bank/bankMockPaper.ts 組出來。
   */
  bank?: MockPaperBank;
}

/** 自組卷的擴充點（作答頁、開考前、交卷）。 */
export interface MockPaperBank {
  /** 這份卷子的 Exam（快照、嚴格載入或解析的結果）；同一份卷子每次回傳同一個 Promise。 */
  load: () => Promise<Exam>;
  /** 作答中的題目擴充點（§6.2）：圖表自己畫、不顯示官方統計的說明、填充每格限一個單詞。 */
  extras: Partial<QuestionExtras>;
  /** 開考前標題下面的「本卷資訊」（PaperInfo）。 */
  startIntro: ReactNode;
  /** 取代規則清單裡「不提供全國答對率」那一條（一個 <li>）。 */
  startRule: ReactNode;
  /** 作答頁頁尾：AI 出題聲明與參考資料（取代歷屆卷的試題來源）。 */
  sourceNote: ReactNode;
  /** PDF 封面資訊（§7.1）。 */
  pdfMeta: (strict: boolean) => MockPdfMeta;
  /** 開考前檢查（§2.8：作答中的自組卷最多 3 份）；回傳 false 就不開考（PaperInfo 會列出那幾份）。 */
  canStart: () => boolean;
  /** 開考：記 startedAt、確認快照已寫入。 */
  onStarted: () => void;
  /**
   * 下載 PDF 成功：記 pdfAt、確認快照已寫入（§2.5）。不讀參數，所以可以直接交給 ExamPdfDownload 的
   * onDownloaded（WP3 的 (info: PdfDownloadInfo) => void）。
   */
  onPdfDownloaded: () => void;
  /** 交卷時寫入歷史的摘要：混合題的填充、簡答自動判分，level 一律 null（§6.3、§6.4）。 */
  historyEntry: (record: MockAttemptRecord, exam: Exam) => MockHistoryEntry;
}

export const MOCK_PAPERS: readonly MockPaper[] = [
  { examId: 'gsat-115', label: '115 學測', scaleYear: 115 },
  { examId: 'gsat-114', label: '114 學測', scaleYear: 114 },
  { examId: 'gsat-113', label: '113 學測', scaleYear: 113 },
  { examId: 'gsat-112', label: '112 學測', scaleYear: 112 },
  {
    examId: 'ref-115',
    label: '115 參考試卷',
    scaleYear: 115,
    reuseNotice: '本卷 53 題中有 49 題沿用歷屆試題（30 題來自 111 學測）。做過原題的題目分數會偏高；成績單另外列出「扣掉做過的題」的得分。',
    pdfNotice: '本卷 53 題中有 49 題沿用歷屆試題（30 題來自 111 學測），做過原題的題目分數會偏高。',
  },
  { examId: 'gsat-111', label: '111 學測', scaleYear: 111 },
];

export function findMockPaper(examId: string): MockPaper | null {
  return MOCK_PAPERS.find((p) => p.examId === examId) ?? null;
}

/**
 * 作答紀錄等處顯示的卷名：歷屆卷是 label；本站自組卷直接解代號，得到「本站自組（穩定基礎）B-7Q2MK」，不下載資料
 * （不然讀屏會念出 72 個字元的代號，§6.1）。都不是時回傳原字串。
 */
export function mockPaperLabel(paperId: string): string {
  const paper = findMockPaper(paperId);
  if (paper) return paper.label;
  if (isBankPaperId(paperId)) {
    const tier = tierOfPaperId(paperId);
    if (tier) return `本站自組（${TIER_LABELS[tier]}）${paperNumber(paperId)}`;
  }
  return paperId;
}

/** 作答時間：100 分鐘（現行學測英文）。 */
export const MOCK_DURATION_MIN = 100;
export const MOCK_DURATION_SEC = MOCK_DURATION_MIN * 60;
/** 實考模式：開考後 60 分鐘內不能交卷（比照正式考試入場後 60 分鐘內不得離場，02 文件 §6.2）。 */
export const STRICT_LOCK_SEC = 60 * 60;

/**
 * 各大題的建議作答時間（分鐘，合計 100）：docs/research/02-gsat-english-spec.md §6.2 的設計值。
 * 成績單用來對照「實際用時」，不是硬性規定。
 */
export const SUGGESTED_MINUTES: Partial<Record<SectionType, number>> = {
  vocabulary: 7,
  cloze: 9,
  word_bank: 9,
  structure: 7,
  reading: 25,
  mixed: 10,
  translation: 8,
  composition: 25,
};

/** 對照年度可以選的範圍（score-scales.json 有的年度）。 */
export const SCALE_YEARS = [115, 114, 113, 112, 111] as const;

/** 模擬考版 PDF 的封面資訊（features/pdf 的 MockPdfMeta）。自組卷用它自己的（bank.pdfMeta）。 */
export function mockPdfMeta(paper: MockPaper, strict: boolean): MockPdfMeta {
  if (paper.bank) return paper.bank.pdfMeta(strict);
  return {
    title: '學測英文中心模擬考',
    paperLabel: paper.examId.startsWith('ref-') ? paper.label : `${paper.label}英文（真題卷）`,
    durationMinutes: MOCK_DURATION_MIN,
    strict,
    ...(paper.pdfNotice ? { notices: [paper.pdfNotice] } : {}),
  };
}
