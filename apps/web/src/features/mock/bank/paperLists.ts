/**
 * 依代號格式取「這份卷子所在的清單」（docs/design/weak-paper.md §7.4）：自組模擬考（bk1）是 gsat-bankmock:v1:papers，
 * 加強卷（bk2）是 gsat-weakpaper:v1:papers。卷子頁、開考、下載 PDF、紙本做過、作答中上限都經過這裡，兩邊互不碰。
 * 另外放一個檔案：weakPapers.ts 匯入 myPapers.ts，反過來會循環匯入。
 */
import { bankPaperList, type MyPaperEntry, type PaperList } from './myPapers';
import { normalizeBk2PaperId } from './paperId';
import { weakPaperList, type WeakPaperEntry } from './weakPapers';

export type AnyPaperList = PaperList<MyPaperEntry> | PaperList<WeakPaperEntry>;

/** 這份卷子所在的清單：bk2 的代號是加強卷的清單，其他（bk1）是自組模擬考的清單。 */
export function paperListFor(paperId: string): AnyPaperList {
  return normalizeBk2PaperId(paperId) ? weakPaperList : bankPaperList;
}

/** 清單裡的這一份（加強卷多 kind、request、targets、notes）；沒有是 null。 */
export function findPaperEntry(paperId: string): MyPaperEntry | WeakPaperEntry | null {
  return normalizeBk2PaperId(paperId) ? weakPaperList.find(paperId) : bankPaperList.find(paperId);
}

/** 加強卷清單裡的這一份（自組模擬考的代號是 null）。 */
export function findWeakEntry(paperId: string): WeakPaperEntry | null {
  return normalizeBk2PaperId(paperId) ? weakPaperList.find(paperId) : null;
}
