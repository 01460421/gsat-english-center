/**
 * BankPaper → 現有模擬考的 MockPaper（docs/design/bank-mock.md §6.1、§6.2）：作答、計時、自動交卷都沿用現有的
 * MockSessionPage，自組卷的差異全部放在 MockPaper.bank 的擴充點裡。
 *
 *   label         「本站自組（進階練習）」：開考前與作答頁的標題是「本站自組（進階練習）模擬考」
 *   scaleYear     115：紀錄的 scaleYear 要是整數（parseRecord），但自組卷不換算級分、不使用它（§6.4）
 *   bank.extras   圖表自己畫、表格不顯示文字描述（bankFigure.tsx）；不顯示官方統計的說明；填充每格限一個單詞
 *   bank.*        開考前的「本卷資訊」、規則、頁尾、PDF 封面資訊、開考與下載 PDF 的紀錄、交卷寫入歷史
 *
 * 加強卷（bk2，docs/design/weak-paper.md §3.5）另外依版面帶作答時間與各大題建議時間（durationMinutes、sectionMinutes；
 * 作答時間沒有比實考模式的 60 分鐘鎖定長的卷子不畫實考模式：60 分鐘的卷子鎖 60 分鐘，就只能等時間到自動交卷）、標題「弱點加強卷」與上方小字「學習助手加強卷・卷號 W-7Q2MK」、出版社題組的出處列
 * （renderGroupSource）；清單、作答中上限、開考與下載 PDF 的紀錄用加強卷自己的清單（paperLists.ts）。
 * 自組模擬考（bk1）的 MockPaper 和改動前相同（不設這些欄位）。
 */
import { TIER_LABELS, type Tier } from '@gsat/shared';
import { createElement } from 'react';
import type { QuestionExtras } from '../../exams/QuestionExtras';
import type { MockPdfMeta } from '../../pdf/types';
import { openAnswerNote } from '../../practice/components/MixedCards';
import { STRICT_LOCK_SEC, type MockPaper } from '../papers';
import { bankFigureRenderer } from './bankFigure';
import { bankHistoryEntry } from './bankScore';
import { BankSourceNote } from './BankSourceNote';
import { paperLayout, type BankPaper } from './buildExam';
import { groupSourceRenderer } from './GroupSourceLine';
import { bk2KindLabel } from './paperId';
import { findPaperEntry, findWeakEntry, paperListFor } from './paperLists';
import { ACTIVE_LIMIT_ID, PaperInfo } from './PaperInfo';
import { storedTargetLabel } from './PaperTargets';
import { bankMockPdfMeta, type BankPdfMetaOptions } from './pdfText';
import { ensureSnapshot } from './snapshots';

/** 紀錄的 scaleYear（不使用，見檔頭）。 */
export const BANK_SCALE_YEAR = 115;

/** 開考前規則清單裡取代「不提供全國答對率」的那一條（§2.2、§6.2）。 */
export const BANK_START_RULE = '考試中不提供答案與提示；交卷後在成績單看本站的答案與解析。';

/** 卷名：「本站自組（進階練習）」。 */
export function bankPaperLabel(tier: Tier): string {
  return `本站自組（${TIER_LABELS[tier]}）`;
}

/** 加強卷的卷名（「弱點加強卷」「模考格式卷（進階練習）」「隨機抽題卷」）；自組模擬考是 null。 */
export function weakPaperTitle(paper: Pick<BankPaper, 'kind' | 'tier'>): string | null {
  if (!paper.kind) return null;
  return bk2KindLabel(paper.kind, paper.kind === 'f' || paper.kind === 'm' ? paper.tier : null);
}

/**
 * 卷子頁與成績單的標題：這台裝置組的均衡加強卷、診斷卷依「我的加強卷」存的請求寫「均衡加強卷」「診斷卷（穩定基礎）」
 * （同組卷頁清單的列名）；其他（含分享來的卷子）是卷別名稱。自組模擬考是 null。
 */
export function weakPaperHeading(paper: Pick<BankPaper, 'id' | 'kind' | 'tier'>): string | null {
  const title = weakPaperTitle(paper);
  if (!title) return null;
  const request = findWeakEntry(paper.id)?.request ?? null;
  if (request?.balanced) return '均衡加強卷';
  if (request?.diagnostic) return `診斷卷（${TIER_LABELS[paper.tier]}）`;
  return title;
}

/** 成績單與作答紀錄用的卷名：加強卷是卷別名稱，自組模擬考是「本站自組（進階練習）」。 */
export function bankPaperTitle(paper: Pick<BankPaper, 'kind' | 'tier'>): string {
  return weakPaperTitle(paper) ?? bankPaperLabel(paper.tier);
}

/**
 * 「下載 PDF」區塊的卷子資訊（§7.1、§7.9）：pdfText.ts 的 bankMockPdfMeta（封面、卷號、資料版本、AI 聲明、資料來源、
 * 本站答案與解析），組卷日期取「我組過的卷子」的 createdAt，沒有（別人分享來的卷子）就用今天。卷子頁與成績單共用。
 * 加強卷另外帶封面的「本卷針對」（「我的加強卷」存的弱點名稱，同卷子頁的 PaperTargets；只在組卷的裝置上有）。
 */
export function bankPdfMeta(paper: BankPaper, strict: boolean): MockPdfMeta {
  const entry = findPaperEntry(paper.id);
  const options: BankPdfMetaOptions = { strict, assembledAt: entry?.createdAt ?? null };
  const request = entry && 'request' in entry ? entry.request : null;
  if (entry && 'targets' in entry && request && (request.kind === 'w' || request.kind === 'f')) {
    options.targets = { labels: entry.targets.map(storedTargetLabel), balanced: request.balanced === true };
  }
  return bankMockPdfMeta(paper, options);
}

/** 有記錄就確認快照已寫入（開考、下載 PDF；組卷當下 IndexedDB 寫入失敗的話這時補寫，§2.3、§4.7 第 (2) 部分）。 */
function confirmSnapshot(paper: BankPaper): void {
  void ensureSnapshot(paper).catch(() => false);
}

/**
 * 下載 PDF 成功（§2.5，ExamPdfDownload 的 onDownloaded：存檔或分享完成時各呼叫一次，所以要能重複呼叫）：
 * 記 pdfAt（之後組卷會避開這些題組；學生卷多半會印出來寫，教師卷也已經看過答案）、確認快照已寫入。
 * MockPaper.bank.onPdfDownloaded 與成績單共用。
 */
export function recordBankPdfDownload(paper: BankPaper): void {
  paperListFor(paper.id).markPdf(paper.id);
  confirmSnapshot(paper);
}

export interface BankMockPaperOptions {
  /** 換題或改版前的舊代號（BankPaperRoute 換到新網址時帶過來，PaperInfo 寫「原本的卷號…，現在是…」）。 */
  redirectedFrom?: string | null;
}

export function bankMockPaper(paper: BankPaper, options: BankMockPaperOptions = {}): MockPaper {
  // 同一份卷子每次回傳同一個 Promise（MockSessionPage 用 use() 讀它）。
  const examPromise = Promise.resolve(paper.exam);
  const list = paperListFor(paper.id);
  // 出版社題組的出處列（只有卷子裡有出版社題組時才設，只用本站題的卷子不變）。
  const renderGroupSource = groupSourceRenderer(paper);
  const extras: Partial<QuestionExtras> = {
    noOfficialStats: true,
    singleWordFill: true,
    openAnswerNote,
    renderFigure: bankFigureRenderer([]),
    ...(renderGroupSource ? { renderGroupSource } : {}),
  };
  const title = weakPaperTitle(paper);
  const layout = paperLayout(paper);
  return {
    examId: paper.id,
    label: title ?? bankPaperLabel(paper.tier),
    scaleYear: BANK_SCALE_YEAR,
    bank: {
      load: () => examPromise,
      extras,
      startIntro: createElement(PaperInfo, { paper, redirectedFrom: options.redirectedFrom ?? null }),
      startRule: createElement('li', null, BANK_START_RULE),
      sourceNote: createElement(BankSourceNote, { groups: paper.groups }),
      pdfMeta: (strict) => bankPdfMeta(paper, strict),
      canStart: () => {
        if (list.checkActiveLimit(paper.id).ok) return true;
        // PaperInfo 已經列出作答中的那幾份；把焦點移過去，讓學生知道為什麼沒有開考。
        const notice = document.getElementById(ACTIVE_LIMIT_ID);
        notice?.scrollIntoView({ block: 'center' });
        notice?.focus({ preventScroll: true });
        return false;
      },
      onStarted: () => {
        list.markStarted(paper.id);
        confirmSnapshot(paper);
      },
      onPdfDownloaded: () => recordBankPdfDownload(paper),
      historyEntry: (record, exam) => bankHistoryEntry(record, exam, paper),
      // 加強卷：作答時間與各大題建議時間依版面、短卷不畫實考模式、標題與上方小字（§3.5）。
      ...(title
        ? {
            heading: weakPaperHeading(paper) ?? title,
            kicker: `學習助手加強卷・卷號 ${paper.code}`,
            durationMinutes: layout.minutes,
            sectionMinutes: layout.sectionMinutes,
            strictAllowed: layout.minutes > STRICT_LOCK_SEC / 60,
          }
        : {}),
    },
  };
}
