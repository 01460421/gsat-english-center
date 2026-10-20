/**
 * BankPaper → 現有模擬考的 MockPaper（docs/design/bank-mock.md §6.1、§6.2）：作答、計時、自動交卷都沿用現有的
 * MockSessionPage，自組卷的差異全部放在 MockPaper.bank 的擴充點裡。
 *
 *   label         「本站自組（進階練習）」：開考前與作答頁的標題是「本站自組（進階練習）模擬考」
 *   scaleYear     115：紀錄的 scaleYear 要是整數（parseRecord），但自組卷不換算級分、不使用它（§6.4）
 *   bank.extras   圖表自己畫、表格不顯示文字描述（bankFigure.tsx）；不顯示官方統計的說明；填充每格限一個單詞
 *   bank.*        開考前的「本卷資訊」、規則、頁尾、PDF 封面資訊、開考與下載 PDF 的紀錄、交卷寫入歷史
 */
import { TIER_LABELS, type Tier } from '@gsat/shared';
import { createElement } from 'react';
import type { QuestionExtras } from '../../exams/QuestionExtras';
import type { MockPdfMeta } from '../../pdf/types';
import { openAnswerNote } from '../../practice/components/MixedCards';
import type { MockPaper } from '../papers';
import { BANK_EXAM_MINUTES } from './blueprint';
import { bankFigureRenderer } from './bankFigure';
import { bankHistoryEntry } from './bankScore';
import { BankSourceNote } from './BankSourceNote';
import type { BankPaper } from './buildExam';
import { checkActiveLimit, markPaperPdf, markPaperStarted } from './myPapers';
import { ACTIVE_LIMIT_ID, PaperInfo } from './PaperInfo';
import { ensureSnapshot } from './snapshots';

/** 紀錄的 scaleYear（不使用，見檔頭）。 */
export const BANK_SCALE_YEAR = 115;

/** 開考前規則清單裡取代「不提供全國答對率」的那一條（§2.2、§6.2）。 */
export const BANK_START_RULE = '考試中不提供答案與提示；交卷後在成績單看本站的答案與解析。';

/** 卷名：「本站自組（進階練習）」。 */
export function bankPaperLabel(tier: Tier): string {
  return `本站自組（${TIER_LABELS[tier]}）`;
}

/**
 * PDF 封面資訊（§7.1）。
 * TODO(WP3-integrate): 加上 sitePaper（features/pdf/types.ts 的 SitePaperPdfMeta：卷號、難度、組卷日期、資料版本、AI 聲明、
 * 依題號範圍的參考資料、本站答案與解析）；固定文字改用 WP3 的 bank/pdfText.ts。
 */
export function bankPdfMeta(paper: Pick<BankPaper, 'tier' | 'code'>, strict: boolean): MockPdfMeta {
  return {
    title: '學測英文中心　本站自組模擬考',
    paperLabel: `${TIER_LABELS[paper.tier]}卷　卷號 ${paper.code}`,
    durationMinutes: BANK_EXAM_MINUTES,
    strict,
  };
}

/** 有記錄就確認快照已寫入（開考、下載 PDF；組卷當下 IndexedDB 寫入失敗的話這時補寫，§2.3、§4.7 第 (2) 部分）。 */
function confirmSnapshot(paper: BankPaper): void {
  void ensureSnapshot(paper).catch(() => false);
}

/** 下載 PDF 成功（§2.5）：記 pdfAt（之後組卷會避開這些題組）、確認快照已寫入。MockPaper.bank.onPdfDownloaded 與成績單共用。 */
export function recordBankPdfDownload(paper: BankPaper): void {
  markPaperPdf(paper.id);
  confirmSnapshot(paper);
}

export interface BankMockPaperOptions {
  /** 換題或改版前的舊代號（BankPaperRoute 換到新網址時帶過來，PaperInfo 寫「原本的卷號…，現在是…」）。 */
  redirectedFrom?: string | null;
}

export function bankMockPaper(paper: BankPaper, options: BankMockPaperOptions = {}): MockPaper {
  // 同一份卷子每次回傳同一個 Promise（MockSessionPage 用 use() 讀它）。
  const examPromise = Promise.resolve(paper.exam);
  const extras: Partial<QuestionExtras> = {
    noOfficialStats: true,
    singleWordFill: true,
    openAnswerNote,
    renderFigure: bankFigureRenderer([]),
  };
  return {
    examId: paper.id,
    label: bankPaperLabel(paper.tier),
    scaleYear: BANK_SCALE_YEAR,
    bank: {
      load: () => examPromise,
      extras,
      startIntro: createElement(PaperInfo, { paper, redirectedFrom: options.redirectedFrom ?? null }),
      startRule: createElement('li', null, BANK_START_RULE),
      sourceNote: createElement(BankSourceNote, { groups: paper.groups }),
      pdfMeta: (strict) => bankPdfMeta(paper, strict),
      canStart: () => {
        if (checkActiveLimit(paper.id).ok) return true;
        // PaperInfo 已經列出作答中的那幾份；把焦點移過去，讓學生知道為什麼沒有開考。
        const notice = document.getElementById(ACTIVE_LIMIT_ID);
        notice?.scrollIntoView({ block: 'center' });
        notice?.focus({ preventScroll: true });
        return false;
      },
      onStarted: () => {
        markPaperStarted(paper.id);
        confirmSnapshot(paper);
      },
      onPdfDownloaded: () => recordBankPdfDownload(paper),
      historyEntry: (record, exam) => bankHistoryEntry(record, exam, paper),
    },
  };
}
