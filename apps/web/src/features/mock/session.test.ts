/**
 * 作答中的模擬考（MockSession）：答案每次修改立刻存、各大題用時、標記、交卷（手動／時間到／過期）、
 * 多分頁唯讀保護、放棄作答。用假時鐘測。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINI_EXAM } from '../exams/testFixtures';
import { findMockPaper } from './papers';
import { MAX_TICK_GAP_SEC, MockSession } from './session';
import { activeKey, createRecord, loadActiveId, loadRecord, recordKey, saveRecord, setActiveId, type MockAttemptRecord } from './storage';

const START = new Date('2026-10-09T01:00:00.000Z');
const T0 = START.getTime();
const paper = findMockPaper('gsat-115');
if (!paper) throw new Error('沒有 gsat-115');

function begin(strict = false): { session: MockSession; record: MockAttemptRecord } {
  const record = createRecord(paper ?? { examId: 'gsat-115', label: '', scaleYear: 115 }, 's1', { strict, predictedScore: null }, START);
  saveRecord(record);
  setActiveId('gsat-115', record.id);
  return { session: new MockSession(record), record };
}

const stored = (id: string) => {
  const r = loadRecord(id);
  if (!r) throw new Error('沒有存檔');
  return r;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('存檔', () => {
  it('答案每次修改都立刻寫進模擬考自己的紀錄（歷屆試題的作答不受影響）', () => {
    const { session, record } = begin();
    session.attempt.setAnswer('1', 'B');
    expect(stored(record.id).attempt.answers).toEqual({ '1': 'B' });
    session.attempt.setAnswer('49', ['A', 'D']);
    session.attempt.setAnswer('1', null);
    expect(stored(record.id).attempt.answers).toEqual({ '49': ['A', 'D'] });
    expect(window.localStorage.getItem('gsat-exam-attempt:v1:gsat-115')).toBeNull();
    expect(session.persisted).toBe(true);
  });

  it('寫不進去（無痕模式）時 persisted 變成 false，仍然可以作答', () => {
    const { session } = begin();
    const real = window.localStorage;
    const full = {
      getItem: (key: string) => real.getItem(key),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: (key: string) => real.removeItem(key),
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full);
    session.attempt.setAnswer('1', 'B');
    expect(session.attempt.getState().answers).toEqual({ '1': 'B' });
    expect(session.persisted).toBe(false);
  });
});

describe('各大題用時', () => {
  it('頁面可見時每秒記到目前大題；用時只在 flush、切大題時寫入', () => {
    const { session, record } = begin();
    session.resetClock(T0);
    for (let i = 1; i <= 10; i += 1) session.tick(T0 + i * 1000, true);
    expect(session.getMeta().sectionTimeSec).toEqual({ s1: 10 });
    expect(stored(record.id).sectionTimeSec).toEqual({});

    session.setActiveSection('s2', T0 + 12_000);
    let saved = stored(record.id);
    expect(saved.activeSectionId).toBe('s2');
    expect(saved.sectionTimeSec).toEqual({ s1: 12 });

    session.tick(T0 + 13_000, true);
    session.flush();
    saved = stored(record.id);
    expect(saved.sectionTimeSec).toEqual({ s1: 12, s2: 1 });
  });

  it('頁面看不見、或兩次 tick 間隔太久（計時器被延後、手機休眠）不算進大題', () => {
    const { session } = begin();
    session.resetClock(T0);
    session.tick(T0 + 1000, false);
    session.tick(T0 + 1000 + (MAX_TICK_GAP_SEC + 1) * 1000, true);
    session.tick(T0 + 2000 + (MAX_TICK_GAP_SEC + 1) * 1000, true);
    expect(session.getMeta().sectionTimeSec).toEqual({ s1: 1 });
  });
});

describe('標記', () => {
  it('切換標記；一個題目區塊有兩題（47–48）時一起切換', () => {
    const { session, record } = begin();
    session.toggleMarks(['3']);
    session.toggleMarks(['47', '48']);
    expect(stored(record.id).marked).toEqual(['3', '47', '48']);
    session.toggleMarks(['47']);
    expect(session.getMeta().marked).toEqual(['3', '48']);
    // 47–48 只有一題已標記 → 按下去兩題都標記；再按一次兩題都取消。
    session.toggleMarks(['47', '48']);
    expect(session.isMarked('47') && session.isMarked('48')).toBe(true);
    session.toggleMarks(['47', '48']);
    expect(stored(record.id).marked).toEqual(['3']);
  });

  it('通知訂閱者（工具列、題號面板跟著重繪）', () => {
    const { session } = begin();
    const listener = vi.fn();
    const off = session.subscribe(listener);
    session.toggleMarks(['1']);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    session.toggleMarks(['1']);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('交卷', () => {
  it('手動交卷：計分、記下用時與離開頁面的時間、清除作答中指標；不能交兩次', () => {
    const { session, record } = begin();
    session.attempt.setAnswer('1', 'B');
    session.attempt.setAnswer('49', ['A', 'D']);
    session.resetClock(T0);
    for (let i = 1; i <= 600; i += 1) session.tick(T0 + i * 1000, true); // 在畫面上 10 分鐘
    const now = T0 + 25 * 60_000; // 開考 25 分鐘交卷：另外 15 分鐘離開頁面

    const result = session.submit(MINI_EXAM, 'manual', now);
    expect(result).not.toBeNull();
    const saved = stored(record.id);
    expect(saved).toMatchObject({ status: 'submitted', submittedAt: new Date(now).toISOString(), submitReason: 'manual', awaySec: 15 * 60 });
    expect(saved.attempt.submitReason).toBe('manual');
    expect(saved.attempt.elapsedSec).toBe(25 * 60);
    // 第 1 題 1 分＋第 2 題送分 1 分＋多選 4 × 4/6。
    expect(saved.attempt.result?.earned).toBeCloseTo(2 + (4 * 4) / 6, 10);
    expect(saved.attempt.result?.autoMax).toBe(13);
    expect(loadActiveId('gsat-115')).toBeNull();
    expect(session.readOnly).toBe(true);
    expect(session.submit(MINI_EXAM, 'manual', now + 1000)).toBeNull();

    // 交卷後答案鎖住。
    session.attempt.setAnswer('1', 'A');
    expect(stored(record.id).attempt.answers['1']).toBe('B');
  });

  it('時間到自動交卷：用時是整整 100 分鐘', () => {
    const { session, record } = begin();
    vi.setSystemTime(Date.parse(record.deadlineAt));
    expect(session.isExpired()).toBe(true);
    session.submit(MINI_EXAM, 'timeout');
    expect(stored(record.id)).toMatchObject({ submitReason: 'timeout', attempt: { submitReason: 'timeout', elapsedSec: 6000 } });
  });

  it('打開頁面時已過期：以最後存檔的作答交卷（submitReason: expired），離開的時間都算離開頁面', () => {
    const { record } = begin();
    const first = new MockSession(record);
    first.attempt.setAnswer('1', 'B');
    // 關掉分頁 3 小時後再打開：從存檔讀回來。
    vi.setSystemTime(T0 + 3 * 3600_000);
    const reopened = new MockSession(stored(record.id));
    expect(reopened.isExpired()).toBe(true);
    const result = reopened.submit(MINI_EXAM, 'expired');
    expect(result).toMatchObject({ status: 'submitted', submitReason: 'expired', awaySec: 6000, attempt: { answers: { '1': 'B' } } });
    expect(stored(record.id).submitReason).toBe('expired');
  });
});

describe('多分頁：別的分頁改了同一筆紀錄就改成唯讀', () => {
  it('只理會同一筆紀錄的鍵；作答中、已交卷、已放棄分別處理', () => {
    const { session, record } = begin();
    expect(session.handleStorageEvent(activeKey('gsat-115'), 'x')).toBe(false);
    expect(session.getConflict()).toBeNull();

    const other = { ...record, attempt: { ...record.attempt, answers: { '1': 'C' } } };
    expect(session.handleStorageEvent(recordKey(record.id), JSON.stringify(other))).toBe(true);
    expect(session.getConflict()).toBe('other_tab');
    expect(session.readOnly).toBe(true);

    // 唯讀之後不再寫入（不會蓋掉另一個分頁的答案）。
    window.localStorage.setItem(recordKey(record.id), JSON.stringify(other));
    session.attempt.setAnswer('1', 'B');
    session.toggleMarks(['1']);
    session.flush();
    expect(stored(record.id).attempt.answers).toEqual({ '1': 'C' });
    expect(stored(record.id).marked).toEqual([]);
    expect(session.submit(MINI_EXAM, 'manual')).toBeNull();
  });

  it('另一個分頁交卷或放棄', () => {
    const a = begin();
    a.session.handleStorageEvent(recordKey(a.record.id), JSON.stringify({ ...a.record, status: 'submitted', submittedAt: new Date().toISOString(), submitReason: 'manual' }));
    expect(a.session.getConflict()).toBe('submitted');
    const b = begin();
    b.session.handleStorageEvent(recordKey(b.record.id), null);
    expect(b.session.getConflict()).toBe('removed');
  });
});

describe('放棄作答', () => {
  it('刪除紀錄與作答中指標；之後的存檔（例如卸載時）不會把紀錄寫回來', () => {
    const { session, record } = begin();
    session.attempt.setAnswer('1', 'B');
    session.discard();
    expect(loadRecord(record.id)).toBeNull();
    expect(loadActiveId('gsat-115')).toBeNull();
    session.flush();
    session.attempt.setAnswer('2', 'C');
    expect(loadRecord(record.id)).toBeNull();
  });
});
