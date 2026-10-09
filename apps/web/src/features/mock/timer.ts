/**
 * 模擬考的計時（純函式，方便用假時鐘測試）。
 *
 * 以「期限」倒數：deadlineAt＝開考時間＋100 分鐘（牆鐘時間），剩餘＝deadlineAt − 現在。
 * 關掉分頁、手機休眠時時間照走（SPEC §6.11：伺服器記期限；後端上線前由瀏覽器記）。
 * 改裝置時間可以繞過——練習用途可以接受，畫面也不宣稱防作弊（設計文件 §6.4、§10 R8）。
 */
import { STRICT_LOCK_SEC } from './papers';
import type { MockAttemptRecord } from './storage';

type Timing = Pick<MockAttemptRecord, 'startedAt' | 'deadlineAt' | 'durationSec'>;

/**
 * 剩餘秒數：不小於 0，也不超過作答時間（裝置時間往回調時，100 分鐘的考試不會顯示剩 160 分鐘）。
 */
export function remainingSec(record: Pick<MockAttemptRecord, 'deadlineAt' | 'durationSec'>, now: number): number {
  return Math.min(record.durationSec, Math.max(0, Math.ceil((Date.parse(record.deadlineAt) - now) / 1000)));
}

/** 已經超過期限（含剛好到期）。 */
export function isExpired(record: Pick<MockAttemptRecord, 'deadlineAt'>, now: number): boolean {
  return now >= Date.parse(record.deadlineAt);
}

/** 開考到現在的秒數，最多是作答時間。 */
export function usedSec(record: Timing, now: number): number {
  const sec = (now - Date.parse(record.startedAt)) / 1000;
  return Math.min(record.durationSec, Math.max(0, Math.round(sec)));
}

/** 實考模式還要等多久才能交卷（秒，最多 60 分鐘）；一般模式或已經過了 60 分鐘是 0。 */
export function strictLockRemainingSec(record: Pick<MockAttemptRecord, 'strict' | 'startedAt'>, now: number): number {
  if (!record.strict) return 0;
  const unlockAt = Date.parse(record.startedAt) + STRICT_LOCK_SEC * 1000;
  return Math.min(STRICT_LOCK_SEC, Math.max(0, Math.ceil((unlockAt - now) / 1000)));
}

/** 現在能不能手動交卷（時間到的自動交卷不受實考模式限制）。 */
export function canSubmitManually(record: Pick<MockAttemptRecord, 'strict' | 'startedAt' | 'status'>, now: number): boolean {
  return record.status === 'in_progress' && strictLockRemainingSec(record, now) === 0;
}

/** 剩 10、5、1 分鐘時提醒（aria-live，只播報這三次，不每秒播報）。 */
export const WARN_AT_SEC = [600, 300, 60] as const;

/**
 * 從 previous 秒到 current 秒之間跨過了哪個提醒點（計時器偶爾會晚一點觸發，用「跨過」而不是「剛好等於」）。
 * 一次跨過好幾個（分頁在背景時計時器被暫停，回來時已經剩 4 分鐘）就回傳最小的那個，也就是現在最接近的提醒。
 * 回傳那個提醒點（秒），沒有就是 null。
 */
export function crossedWarning(previous: number, current: number): number | null {
  let crossed: number | null = null;
  for (const w of WARN_AT_SEC) if (previous > w && current <= w && (crossed === null || w < crossed)) crossed = w;
  return crossed;
}
