/**
 * 學習助手的本機作答紀錄（outcomes.ts，docs/design/learning-assistant.md §5.4）：去重、first、上限、容量滿、
 * localStorage 不能用；recordOutcomesOnce 對同一次作答只寫一次（成績單重新整理、重新掛載不重複寫）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outcomesRecordedAt, recordOutcomesOnce } from './entries';
import {
  MAX_OUTCOMES,
  OUTCOMES_KEY,
  addOutcomes,
  emptyLog,
  getOutcomes,
  okFromRatio,
  parseLog,
  questionIdentity,
  recordOutcomes,
  resetOutcomesForTests,
  type OutcomeInput,
} from './outcomes';

function input(patch: Partial<OutcomeInput> = {}): OutcomeInput {
  return { s: 'bank', r: 'ai.wb.0a1b2c@1', g: 'ai.wb.0a1b2c', l: '1', sec: 'word_bank', t: 'advanced', k: [], ok: 0, a: 'G', key: 'E', at: 1_000, ...patch };
}

beforeEach(() => {
  resetOutcomesForTests();
});

afterEach(() => {
  resetOutcomesForTests();
});

describe('addOutcomes（純函式）', () => {
  it('同一題（來源、版本、題號、卷子）只留最新一筆，新到舊排', () => {
    let log = addOutcomes(emptyLog(), [input({ l: '1', at: 1_000 }), input({ l: '2', at: 1_000 })]);
    log = addOutcomes(log, [input({ l: '1', ok: 1, a: 'E', at: 2_000 })]);
    expect(log.items.map((e) => [e.l, e.ok, e.at])).toEqual([
      ['1', 1, 2_000],
      ['2', 0, 1_000],
    ]);
  });

  it('first：這台裝置第一次作答這一題；題組換版本、真題模考與歷屆試題算同一題', () => {
    let log = addOutcomes(emptyLog(), [input({ l: '1', at: 1_000 })]);
    expect(log.items[0]?.first).toBe(1);
    // 同一題組的新版本：不是第一次。
    log = addOutcomes(log, [input({ r: 'ai.wb.0a1b2c@2', l: '1', at: 2_000 })]);
    expect(log.items.find((e) => e.r === 'ai.wb.0a1b2c@2')?.first).toBe(0);
    // 自組卷做到同一題組的題：也不是第一次。
    log = addOutcomes(log, [input({ s: 'bank_mock', p: 'bk1-x', l: '1', at: 3_000 })]);
    expect(log.items.find((e) => e.s === 'bank_mock')?.first).toBe(0);
    // 歷屆試題與真題模考是同一份考卷的同一題。
    log = addOutcomes(log, [input({ s: 'exam', r: 'gsat-115', g: 'gsat-115.s3g1', l: '23', sec: 'word_bank', at: 4_000 })]);
    log = addOutcomes(log, [input({ s: 'mock', r: 'gsat-115', g: 'gsat-115.s3g1', l: '23', p: 'att-1', sec: 'word_bank', at: 5_000 })]);
    expect(log.items.find((e) => e.s === 'exam')?.first).toBe(1);
    expect(log.items.find((e) => e.s === 'mock')?.first).toBe(0);
    expect(questionIdentity({ s: 'exam', r: 'gsat-115', l: '23' })).toBe(questionIdentity({ s: 'mock', r: 'gsat-115', l: '23' }));
  });

  it('同一批裡同一題出現兩次：留後面那筆，後面那筆不是 first', () => {
    const log = addOutcomes(emptyLog(), [input({ l: '1', ok: 0, at: 1_000 }), input({ l: '1', ok: 1, at: 1_000 })]);
    expect(log.items).toHaveLength(1);
    expect(log.items[0]).toMatchObject({ ok: 1, first: 0 });
  });

  it('超過上限刪最舊的', () => {
    const many = Array.from({ length: 12 }, (_, i) => input({ l: String(i + 1), at: i }));
    const log = addOutcomes(emptyLog(), many, 10);
    expect(log.items).toHaveLength(10);
    expect(log.items.map((e) => e.l)).not.toContain('1');
    expect(log.items.map((e) => e.l)).not.toContain('2');
    expect(MAX_OUTCOMES).toBe(2_000);
  });

  it('parseLog：壞掉的那筆丟掉，其他照用；整個格式不對當成空的', () => {
    const good = { ...input(), first: 1 };
    expect(parseLog({ v: 1, items: [good, { s: 'nope' }, { ...good, ok: 2 }] }).items).toHaveLength(1);
    expect(parseLog({ v: 2, items: [good] }).items).toEqual([]);
    expect(parseLog('garbage').items).toEqual([]);
  });

  it('okFromRatio：全分、部分、0', () => {
    expect(okFromRatio(2, 2)).toBe(1);
    expect(okFromRatio(1, 2)).toBe(0.5);
    expect(okFromRatio(0, 2)).toBe(0);
  });
});

describe('recordOutcomes（localStorage）', () => {
  it('寫進 gsat-assist:v1:outcomes，讀回來一樣', () => {
    recordOutcomes([input({ l: '1' }), input({ l: '2' })]);
    const stored = JSON.parse(window.localStorage.getItem(OUTCOMES_KEY) ?? 'null') as { v: number; items: unknown[] };
    expect(stored.v).toBe(1);
    expect(stored.items).toHaveLength(2);
    resetOutcomesForTests();
    expect(getOutcomes().items.map((e) => e.l).sort()).toEqual(['1', '2']);
  });

  it('容量滿：刪最舊的一半再試一次', () => {
    recordOutcomes(Array.from({ length: 6 }, (_, i) => input({ l: String(i + 1), at: i + 1 })));
    const real = window.localStorage;
    let calls = 0;
    const full = {
      getItem: (k: string) => real.getItem(k),
      setItem: (k: string, v: string) => {
        calls += 1;
        // 第一次（完整的 7 筆）寫不進去，刪掉一半之後可以。
        if (calls === 1) throw new DOMException('full', 'QuotaExceededError');
        real.setItem(k, v);
      },
      removeItem: (k: string) => real.removeItem(k),
      clear: () => real.clear(),
      key: (i: number) => real.key(i),
      get length() {
        return real.length;
      },
    } as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full);
    recordOutcomes([input({ l: '7', at: 100 })]);
    const stored = JSON.parse(real.getItem(OUTCOMES_KEY) ?? 'null') as { items: Array<{ l: string }> };
    expect(stored.items.map((e) => e.l)).toEqual(['7', '6', '5']);
  });

  it('localStorage 不能用（無痕模式、封鎖網站資料）：不丟例外，這一頁照常有紀錄', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(broken);
    expect(() => recordOutcomes([input({ l: '1' })])).not.toThrow();
    expect(getOutcomes().items.map((e) => e.l)).toEqual(['1']);
    expect(() => recordOutcomes([input({ l: '2', at: 2_000 })])).not.toThrow();
    expect(getOutcomes().items.map((e) => e.l)).toEqual(['2', '1']);
  });
});

describe('recordOutcomesOnce（成績單第一次顯示時寫入）', () => {
  it('同一次作答（來源、代號、時間）只寫一次；重新整理（重讀 localStorage）也不重複', () => {
    const build = vi.fn(() => [input({ s: 'mock', r: 'gsat-115', g: 'gsat-115.s1g1', l: '1', p: 'att-1', sec: 'vocabulary', at: 5_000 })]);
    recordOutcomesOnce('mock', { p: 'att-1' }, 5_000, build);
    recordOutcomesOnce('mock', { p: 'att-1' }, 5_000, build);
    resetOutcomesForTests();
    recordOutcomesOnce('mock', { p: 'att-1' }, 5_000, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(outcomesRecordedAt('mock', { p: 'att-1' }, 5_000)).toBe(true);
    expect(outcomesRecordedAt('mock', { p: 'att-2' }, 5_000)).toBe(false);
  });

  it('時間不是數字時不寫；build 丟例外也不影響呼叫端', () => {
    const build = vi.fn(() => [input()]);
    recordOutcomesOnce('bank', { r: 'ai.wb.0a1b2c@1' }, Number.NaN, build);
    expect(build).not.toHaveBeenCalled();
    expect(() =>
      recordOutcomesOnce('bank', { r: 'ai.wb.0a1b2c@1' }, 1_000, () => {
        throw new Error('boom');
      }),
    ).not.toThrow();
    expect(getOutcomes().items).toEqual([]);
  });
});
