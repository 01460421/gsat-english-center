/**
 * 這台裝置「做過」的題組（docs/design/bank-mock.md §4.4）：組卷時優先避開。只讀 localStorage。
 *
 * 以 uid 判斷，不看版本（同題庫練習的「做過」：改版通常只是修錯字，學生已經看過這篇文章了）。
 *
 *   來源       鍵                          算「做過」的條件                                     最後使用時間
 *   題庫練習   gsat-bank-practice:v1       done 裡的 uid（交過卷）、current 裡的 uid（正在做）     done[uid].at；current 用作答紀錄的 updatedAt
 *   寫作題庫   gsat-writing-draft:v1:*     鍵裡的 ai.tr.*、ai.cp.* 有草稿（有文字、對照過或送過批改）  草稿的 updatedAt
 *   自組卷     gsat-bankmock:v1:papers     開考過、下載過 PDF 或按過「紙本做過」的卷子裡的 11 個 uid  三個時間裡最晚的一個
 *              gsat-mock:v1:*              另外也算作答中與作答歷史裡的自組卷（清單寫入失敗時的備援）  開考／交卷時間
 *
 * 只組了卷、三者都沒有的不算，因為學生沒看到題目。拿不到時間的當成很久以前做的（0）。
 */
import { PRACTICE_HISTORY_KEY, parseHistory } from '../../practice/history';
import { loadAttempt } from '../../exams/attempt';
import { loadHistory } from '../storage';
import { decodePaperId } from './code';
import { activeBankAttempts, loadMyPapers, paperUsedAt } from './myPapers';

const WRITING_DRAFT_PREFIX = 'gsat-writing-draft:v1:';
const WRITING_DRAFT_KEY = /^gsat-writing-draft:v1:(?:translation|essay):(ai\.(?:tr|cp)\.[0-9a-f]{6})@[1-9]\d*$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function timeOf(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export interface UsedOptions {
  /** 不算這份卷子自己的使用紀錄（打開一份卷子時，算它「開考前」做過哪些題組）。 */
  excludePaperId?: string;
  /** 只算這個時間（毫秒）之前的使用；拿不到時間的照樣算。 */
  before?: number;
}

/** 這台裝置做過的題組：uid → 最後使用時間（毫秒）。 */
export function loadUsedGroups(options: UsedOptions = {}): Map<string, number> {
  const used = new Map<string, number>();
  const limit = options.before ?? Infinity;
  const add = (uid: string, at: number) => {
    if (at !== 0 && at >= limit) return;
    used.set(uid, Math.max(used.get(uid) ?? 0, at));
  };
  const addPaper = (paperId: string, at: number) => {
    if (paperId === options.excludePaperId) return;
    const decoded = decodePaperId(paperId);
    if (!decoded) return;
    for (const slot of decoded.slots) add(slot.uid, at);
  };

  // 題庫練習
  try {
    const text = window.localStorage.getItem(PRACTICE_HISTORY_KEY);
    if (text !== null) {
      const practice = parseHistory(JSON.parse(text));
      for (const [uid, done] of Object.entries(practice.done)) add(uid, timeOf(done.at));
      for (const key of Object.values(practice.current)) {
        const uid = key.split('@')[0] ?? '';
        if (uid) add(uid, timeOf(loadAttempt(`practice:${key}`)?.updatedAt));
      }
    }
  } catch {
    // 讀不到就當成沒有練習紀錄。
  }

  // 寫作題庫的草稿
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key?.startsWith(WRITING_DRAFT_PREFIX)) continue;
      const m = WRITING_DRAFT_KEY.exec(key);
      if (!m?.[1]) continue;
      let draft: unknown;
      try {
        draft = JSON.parse(storage.getItem(key) ?? 'null');
      } catch {
        continue;
      }
      if (!isRecord(draft)) continue;
      const written = Array.isArray(draft['texts']) ? draft['texts'].some(hasText) : hasText(draft['text']);
      if (!written && draft['revealedAt'] == null && draft['aiSubmittedAt'] == null) continue;
      add(m[1], finiteOr(draft['updatedAt'], 0));
    }
  } catch {
    // localStorage 不能用。
  }

  // 自組卷
  for (const entry of loadMyPapers()) {
    const at = paperUsedAt(entry);
    if (at !== null) addPaper(entry.id, at);
  }
  for (const { paperId, record } of activeBankAttempts()) addPaper(paperId, timeOf(record.startedAt));
  for (const h of loadHistory()) addPaper(h.paperId, timeOf(h.submittedAt));

  return used;
}
