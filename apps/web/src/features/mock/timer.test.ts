/**
 * 模擬考的計時：以期限倒數（關掉分頁時間照走）、實考模式 60 分鐘交卷鎖、10／5／1 分鐘提醒。用假時鐘測。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findMockPaper, MOCK_DURATION_SEC, STRICT_LOCK_SEC } from './papers';
import { createRecord } from './storage';
import { canSubmitManually, crossedWarning, isExpired, remainingSec, strictLockRemainingSec, usedSec } from './timer';

const START = new Date('2026-10-09T01:00:00.000Z');
const paper = findMockPaper('gsat-115');
if (!paper) throw new Error('沒有 gsat-115');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('期限倒數', () => {
  it('開考時存下期限＝開考時間＋100 分鐘；剩餘時間只看期限與現在的時間', () => {
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null });
    expect(record.startedAt).toBe(START.toISOString());
    expect(Date.parse(record.deadlineAt) - Date.parse(record.startedAt)).toBe(MOCK_DURATION_SEC * 1000);
    expect(remainingSec(record, Date.now())).toBe(6000);

    vi.advanceTimersByTime(25 * 60_000 + 500);
    expect(remainingSec(record, Date.now())).toBe(75 * 60); // 不足一秒的部分無條件進位
    expect(usedSec(record, Date.now())).toBe(25 * 60 + 1);
    expect(isExpired(record, Date.now())).toBe(false);
  });

  it('關掉分頁（沒有任何計時器在跑）時間照走：回來時剩餘時間已經扣掉離開的時間', () => {
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null });
    // 模擬「關掉分頁 40 分鐘」：只是時鐘往前走，沒有 tick。
    vi.setSystemTime(START.getTime() + 40 * 60_000);
    expect(remainingSec(record, Date.now())).toBe(60 * 60);
  });

  it('到期（含剛好到期）與超過期限：剩餘 0、已用時間最多 100 分鐘', () => {
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null });
    vi.setSystemTime(Date.parse(record.deadlineAt) - 1);
    expect(isExpired(record, Date.now())).toBe(false);
    expect(remainingSec(record, Date.now())).toBe(1);
    vi.setSystemTime(Date.parse(record.deadlineAt));
    expect(isExpired(record, Date.now())).toBe(true);
    expect(remainingSec(record, Date.now())).toBe(0);
    vi.setSystemTime(Date.parse(record.deadlineAt) + 3 * 3600_000);
    expect(remainingSec(record, Date.now())).toBe(0);
    expect(usedSec(record, Date.now())).toBe(MOCK_DURATION_SEC);
  });
});

describe('實考模式：開考 60 分鐘內不能交卷', () => {
  it('一般模式隨時可以交卷', () => {
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null });
    expect(strictLockRemainingSec(record, Date.now())).toBe(0);
    expect(canSubmitManually(record, Date.now())).toBe(true);
  });

  it('實考模式：前 60 分鐘鎖住，之後解鎖；已交卷的不能再交', () => {
    const record = createRecord(paper, 's1', { strict: true, predictedScore: null });
    expect(strictLockRemainingSec(record, Date.now())).toBe(STRICT_LOCK_SEC);
    expect(canSubmitManually(record, Date.now())).toBe(false);

    vi.advanceTimersByTime(59 * 60_000 + 59_000);
    expect(strictLockRemainingSec(record, Date.now())).toBe(1);
    expect(canSubmitManually(record, Date.now())).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(strictLockRemainingSec(record, Date.now())).toBe(0);
    expect(canSubmitManually(record, Date.now())).toBe(true);
    expect(canSubmitManually({ ...record, status: 'submitted' }, Date.now())).toBe(false);
  });
});

describe('剩 10、5、1 分鐘提醒', () => {
  it('跨過提醒點才提醒一次（計時器晚觸發、跳過整秒也不漏）', () => {
    expect(crossedWarning(601, 600)).toBe(600);
    expect(crossedWarning(603, 598)).toBe(600);
    expect(crossedWarning(600, 599)).toBeNull();
    expect(crossedWarning(301, 300)).toBe(300);
    expect(crossedWarning(61, 60)).toBe(60);
    expect(crossedWarning(1000, 999)).toBeNull();
    expect(crossedWarning(59, 58)).toBeNull();
  });

  it('一次跨過好幾個提醒點（分頁在背景時計時器暫停）：提醒最接近現在的那個', () => {
    expect(crossedWarning(2400, 299)).toBe(300);
    expect(crossedWarning(700, 30)).toBe(60);
  });
});
