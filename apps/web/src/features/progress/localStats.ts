/**
 * 首頁「學習進度」的數字：只從這台裝置的瀏覽器已經存著的紀錄算，不下載任何資料檔。
 *
 *   - 今日待複習單字：單字「每日學習」的間隔重複紀錄（vocab/lib/srs.ts 的 studySummary）。
 *     待複習數只看已有的卡片，不需要單字索引；候選新字傳空陣列（首頁不顯示「今天的新字」，那要下載整份索引）。
 *   - 題庫練習：做完（交卷）的題組數與總答對率（practice/history.ts 的 done）。
 *   - 單字錯題本：錯題本裡的字數（vocab/lib/mistakes.ts）。
 * 歷屆試題的作答紀錄是每份考卷一個 localStorage 鍵、沒有彙總，首頁先不統計。
 */
import type { PracticeHistory } from '../practice/history';
import type { MistakeBook } from '../vocab/lib/mistakes';
import { studySummary, type SrsState } from '../vocab/lib/srs';

export interface LocalStats {
  vocab: {
    /** 每日學習裡的卡片數（含手動加入、還沒開始學的）；0 代表沒用過每日學習。 */
    cards: number;
    /** 今天（到明天凌晨 4 點前）要複習的字數，和單字頁「待複習」同一個數字。 */
    dueToday: number;
    /** 其中現在就可以複習的。 */
    dueNow: number;
    learned: number;
    streak: number;
    /** 今天（凌晨 4 點換日）已經複習的次數，不含第一次學的新字。 */
    reviewsDone: number;
  };
  practice: {
    /** 做完（交卷）的題組數。 */
    groups: number;
    correct: number;
    /** 自動計分的題數（答對率的分母）。 */
    total: number;
  };
  /** 單字錯題本裡的字數。 */
  mistakes: number;
}

export function computeLocalStats(srs: SrsState, book: MistakeBook, history: PracticeHistory, now: number): LocalStats {
  const summary = studySummary(srs, [], now);
  let groups = 0;
  let correct = 0;
  let total = 0;
  for (const record of Object.values(history.done)) {
    groups += 1;
    correct += record.correct;
    total += record.total;
  }
  return {
    vocab: {
      cards: Object.keys(srs.cards).length,
      dueToday: summary.dueToday,
      dueNow: summary.dueNow,
      learned: summary.learned,
      streak: summary.streak,
      reviewsDone: summary.reviewsDone,
    },
    practice: { groups, correct, total },
    mistakes: Object.keys(book.items).length,
  };
}

/** 三種紀錄都沒有：首頁改顯示「從哪裡開始」的提示，而不是一排 0。 */
export function isEmptyStats(stats: LocalStats): boolean {
  return stats.vocab.cards === 0 && stats.practice.groups === 0 && stats.mistakes === 0;
}

/**
 * 單字格的補充說明：學過幾個字、連續幾天。今天沒有待複習時，今天真的複習過才說「完成了」，
 * 否則（例如所有卡片都是幾天後才到期）只說今天沒有要複習的字，不替學生說沒做過的事。
 */
export function vocabHint(vocab: LocalStats['vocab']): string {
  if (vocab.learned === 0) return vocab.cards > 0 ? `已加入 ${vocab.cards} 個字，還沒開始學` : '還沒開始每日學習';
  const parts = [`已學過 ${vocab.learned} 個字`];
  if (vocab.streak > 0) parts.push(`連續 ${vocab.streak} 天`);
  if (vocab.dueToday === 0) parts.unshift(vocab.reviewsDone > 0 ? '今天的複習完成了' : '今天沒有要複習的字');
  else if (vocab.dueNow < vocab.dueToday) parts.unshift(`${vocab.dueNow} 個已到期`);
  return parts.join('・');
}
