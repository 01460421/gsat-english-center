/**
 * 作答中的一次模擬考：紀錄的其他欄位（目前大題、各大題用時、標記、交卷）＋作答 store（AttemptStore）。
 *
 * 一份紀錄只有一個寫入點：AttemptStore 的存檔（每次改答案）透過 AttemptPersistence 交回這裡，
 * 和目前的其他欄位合成完整紀錄再寫進 localStorage；其他欄位改變（切大題、標記）也寫同一筆。
 *
 * 計時：
 *   - 剩餘時間只看期限（timer.ts），不靠這裡累加。
 *   - 各大題用時：頁面可見時，計時器每秒呼叫 tick() 把經過的時間記到目前大題；兩次 tick 間隔太久
 *     （計時器在背景被瀏覽器延後、手機休眠）就不算，那段時間在交卷時歸到「離開頁面」。
 *   - 用時每秒只記在記憶體，每 30 秒、切換分頁（visibilitychange）、關閉頁面（pagehide）與切大題時才寫入，
 *     答案則是每次修改都立刻寫入（設計文件 §6.3）。
 *
 * 多分頁：別的分頁改了同一筆紀錄（storage 事件），這個分頁就改成唯讀，不再寫入，避免兩邊互相覆蓋；
 * 使用者可以選擇「在這個分頁繼續」，由頁面重新讀取最新紀錄建立新的 session。
 */
import type { Exam } from '../../data/exams';
import { AttemptStore, type AttemptPersistence, type AttemptState } from '../exams/attempt';
import { scoreExam } from '../exams/scoring';
import { isExpired, usedSec } from './timer';
import { clearActiveId, parseRecord, recordKey, removeRecord, saveRecord, type MockAttemptRecord, type MockSubmitReason } from './storage';

export type MockMeta = Omit<MockAttemptRecord, 'attempt'>;

/** 別的分頁動了這筆紀錄：繼續作答（other_tab）、已交卷（submitted）或已放棄（removed）。 */
export type MockConflict = 'other_tab' | 'submitted' | 'removed';

/** 兩次 tick 之間超過這個秒數就不算進大題用時（計時器被延後或裝置休眠）。 */
export const MAX_TICK_GAP_SEC = 5;

function splitRecord(record: MockAttemptRecord): { meta: MockMeta; attempt: AttemptState } {
  const { attempt, ...meta } = record;
  return { meta, attempt };
}

export class MockSession {
  private meta: MockMeta;
  readonly attempt: AttemptStore;
  private readonly listeners = new Set<() => void>();
  private lastTick: number | null = null;
  private conflictState: MockConflict | null = null;
  private discarded = false;
  /** 最近一次寫入是否成功。 */
  persisted: boolean;

  constructor(record: MockAttemptRecord, persisted = true) {
    const { meta, attempt } = splitRecord(record);
    this.meta = meta;
    this.persisted = persisted;
    const persistence: AttemptPersistence = { save: (state) => this.writeWith(state) };
    this.attempt = new AttemptStore(attempt, persisted, persistence);
  }

  get id(): string {
    return this.meta.id;
  }

  getMeta = (): MockMeta => this.meta;

  getConflict = (): MockConflict | null => this.conflictState;

  get readOnly(): boolean {
    return this.conflictState !== null || this.meta.status === 'submitted' || this.discarded;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** 完整紀錄（目前記憶體裡的狀態）。 */
  toRecord(): MockAttemptRecord {
    return { ...this.meta, sectionTimeSec: roundTimes(this.meta.sectionTimeSec), attempt: this.attempt.getState() };
  }

  /** 放棄這次作答：刪除紀錄與「作答中」指標，之後不再寫入（卸載時的存檔也不會把紀錄寫回來）。 */
  discard(): void {
    this.discarded = true;
    removeRecord(this.meta.id);
    clearActiveId(this.meta.paperId, this.meta.id);
  }

  private writeWith(attempt: AttemptState): boolean {
    if (this.conflictState !== null || this.discarded) return false;
    const ok = saveRecord({ ...this.meta, sectionTimeSec: roundTimes(this.meta.sectionTimeSec), attempt });
    this.persisted = ok;
    return ok;
  }

  /** 立刻寫入目前狀態（30 秒自動存檔、切換分頁、關閉頁面時呼叫）。 */
  flush(): boolean {
    return this.writeWith(this.attempt.getState());
  }

  private update(patch: Partial<MockMeta>, { write = true, notify = true } = {}): void {
    this.meta = { ...this.meta, ...patch };
    if (write) this.flush();
    if (notify) this.notify();
  }

  // ---- 計時 ----------------------------------------------------------------

  /** 重新開始量測（掛載、回到頁面時）：上次 tick 到現在的時間不算進大題。 */
  resetClock(now: number): void {
    this.lastTick = now;
  }

  /** 把上次 tick 到 now 的時間記到目前大題（visible 為 false 或間隔太久時不記）。只改記憶體，不寫入、不通知。 */
  tick(now: number, visible: boolean): void {
    const last = this.lastTick;
    this.lastTick = now;
    if (last === null || this.readOnly) return;
    const delta = (now - last) / 1000;
    if (!visible || delta <= 0 || delta > MAX_TICK_GAP_SEC) return;
    const id = this.meta.activeSectionId;
    const times = this.meta.sectionTimeSec;
    this.meta = { ...this.meta, sectionTimeSec: { ...times, [id]: (times[id] ?? 0) + delta } };
  }

  // ---- 作答中的操作 --------------------------------------------------------

  setActiveSection(sectionId: string, now = Date.now()): void {
    if (this.readOnly || sectionId === this.meta.activeSectionId) return;
    this.tick(now, true);
    this.update({ activeSectionId: sectionId });
  }

  isMarked(label: string): boolean {
    return this.meta.marked.includes(label);
  }

  /** 標記／取消標記（一個題目區塊可能有兩題，例如混合題 47–48：全部已標記就全部取消，否則全部標記）。 */
  toggleMarks(labels: readonly string[]): void {
    if (this.readOnly || labels.length === 0) return;
    const all = labels.every((l) => this.meta.marked.includes(l));
    const marked = all ? this.meta.marked.filter((l) => !labels.includes(l)) : [...new Set([...this.meta.marked, ...labels])];
    this.update({ marked });
  }

  /**
   * 交卷：計分、鎖住作答、記下用時與離開頁面的時間，並清除「作答中」的指標。
   * reason：manual（手動）、timeout（時間到）、expired（打開頁面時已經超過期限，以最後存檔的作答計分）。
   * 回傳交卷後的完整紀錄；已經交過卷就回傳 null。
   */
  submit(exam: Exam, reason: MockSubmitReason, now = Date.now()): MockAttemptRecord | null {
    if (this.meta.status === 'submitted' || this.conflictState !== null) return null;
    if (reason !== 'expired') this.tick(now, true);
    const used = reason === 'manual' ? usedSec(this.meta, now) : this.meta.durationSec;
    const visible = Object.values(this.meta.sectionTimeSec).reduce((a, b) => a + b, 0);
    const score = scoreExam(exam, this.attempt.getState().answers);
    // 先更新紀錄的其他欄位（不寫入），再交給 AttemptStore 交卷：它存檔時會帶著這些欄位一起寫進去。
    this.meta = {
      ...this.meta,
      status: 'submitted',
      submittedAt: new Date(now).toISOString(),
      submitReason: reason,
      awaySec: Math.max(0, Math.round(used - visible)),
    };
    this.attempt.setElapsed(used);
    this.attempt.submit(reason === 'manual' ? 'manual' : 'timeout', { earned: score.earned, autoMax: score.autoMax });
    this.flush();
    clearActiveId(this.meta.paperId, this.meta.id);
    this.notify();
    return this.toRecord();
  }

  isExpired(now = Date.now()): boolean {
    return isExpired(this.meta, now);
  }

  // ---- 多分頁 --------------------------------------------------------------

  /**
   * 處理 storage 事件（只有「別的分頁」寫入時才會收到）。同一筆紀錄被改了就改成唯讀。
   * 回傳是否處理了這個事件。
   */
  handleStorageEvent(key: string | null, newValue: string | null): boolean {
    if (key !== recordKey(this.meta.id) || this.meta.status === 'submitted') return false;
    let conflict: MockConflict = 'other_tab';
    if (newValue === null) conflict = 'removed';
    else {
      try {
        const record = parseRecord(JSON.parse(newValue), this.meta.id);
        if (record?.status === 'submitted') conflict = 'submitted';
      } catch {
        // 讀不懂的內容一樣視為被別的分頁改過。
      }
    }
    this.conflictState = conflict;
    this.notify();
    return true;
  }
}

/** 寫入前把用時取到 0.1 秒（記憶體裡保留完整精度）。 */
function roundTimes(times: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(times)) out[k] = Math.round(v * 10) / 10;
  return out;
}
