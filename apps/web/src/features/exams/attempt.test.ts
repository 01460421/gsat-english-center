/**
 * 作答紀錄：存進 localStorage、重新開啟後續作、壞掉的紀錄不採用、鎖定規則（練習模式看過答案、交卷後）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AttemptStore,
  attemptProgress,
  attemptStorageKey,
  clearAttempt,
  createAttempt,
  loadAttempt,
  parseAttempt,
  saveAttempt,
} from './attempt';

const NOW = new Date('2026-10-08T01:00:00.000Z');

afterEach(() => {
  window.localStorage.clear();
});

describe('儲存與續作', () => {
  it('作答會立刻寫進 localStorage，重新建立 store 時接續原本的答案與用時', () => {
    const first = new AttemptStore(createAttempt('gsat-115', 'exam', 6000, NOW));
    first.setAnswer('1', 'B');
    first.setAnswer('49', ['A', 'D']);
    first.setAnswer('中譯英1', 'More and more teachers...');
    first.setElapsed(125.7);

    const saved = loadAttempt('gsat-115');
    expect(saved).not.toBeNull();
    const resumed = new AttemptStore(saved ?? createAttempt('gsat-115', 'exam', 6000));
    expect(resumed.getState()).toMatchObject({
      mode: 'exam',
      timeLimitSec: 6000,
      elapsedSec: 125,
      answers: { '1': 'B', '49': ['A', 'D'], 中譯英1: 'More and more teachers...' },
      submittedAt: null,
    });
  });

  it('每份考卷各自一個鍵，互不影響', () => {
    new AttemptStore(createAttempt('gsat-115', 'practice', null)).setAnswer('1', 'A');
    new AttemptStore(createAttempt('ast-110', 'practice', null)).setAnswer('1', 'C');
    expect(loadAttempt('gsat-115')?.answers['1']).toBe('A');
    expect(loadAttempt('ast-110')?.answers['1']).toBe('C');
  });

  it('清除後就沒有紀錄', () => {
    new AttemptStore(createAttempt('gsat-115', 'practice', null)).setAnswer('1', 'A');
    clearAttempt('gsat-115');
    expect(loadAttempt('gsat-115')).toBeNull();
    expect(window.localStorage.getItem(attemptStorageKey('gsat-115'))).toBeNull();
  });

  it('壞掉、舊版或別份考卷的紀錄不採用', () => {
    const key = attemptStorageKey('gsat-115');
    window.localStorage.setItem(key, '{not json');
    expect(loadAttempt('gsat-115')).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ ...createAttempt('gsat-115', 'exam', 60), v: 0 }));
    expect(loadAttempt('gsat-115')).toBeNull();
    window.localStorage.setItem(key, JSON.stringify(createAttempt('gsat-114', 'exam', 60)));
    expect(loadAttempt('gsat-115')).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ ...createAttempt('gsat-115', 'exam', 60), answers: { '1': 3 } }));
    expect(loadAttempt('gsat-115')).toBeNull();
    window.localStorage.setItem(key, JSON.stringify({ ...createAttempt('gsat-115', 'exam', 60), mode: 'cheat' }));
    expect(loadAttempt('gsat-115')).toBeNull();
  });

  it('parseAttempt 接受合法的紀錄（含已交卷的結果）', () => {
    const state = { ...createAttempt('gsat-115', 'exam', 60, NOW), submittedAt: NOW.toISOString(), submitReason: 'timeout', result: { earned: 52.5, autoMax: 72 } };
    expect(parseAttempt(JSON.parse(JSON.stringify(state)), 'gsat-115')).toEqual(state);
  });

  it('開始作答時立刻存檔：還沒作答就重新整理也能接回模式與時間限制', () => {
    AttemptStore.start('gsat-115', 'exam', 4800);
    expect(loadAttempt('gsat-115')).toMatchObject({ mode: 'exam', timeLimitSec: 4800, answers: {} });
  });

  it('localStorage 不能用（無痕模式）時照樣可以作答，只是標記為未儲存', () => {
    // 換掉整個 localStorage（happy-dom 的 Storage 是 Proxy，對原型的 spy 攔不到）；setup.ts 的 unstubAllGlobals 會還原。
    const quota = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: quota, removeItem: () => undefined, clear: () => undefined });
    const store = AttemptStore.start('gsat-115', 'practice', null);
    expect(store.persisted).toBe(false);
    store.setAnswer('1', 'B');
    expect(store.getState().answers['1']).toBe('B');
    expect(store.persisted).toBe(false);
    expect(saveAttempt(store.getState())).toBe(false);
  });

  it('列表頁的進度摘要', () => {
    expect(attemptProgress('gsat-115')).toBeNull();
    const store = new AttemptStore(createAttempt('gsat-115', 'exam', 60));
    store.setAnswer('1', 'B');
    store.setAnswer('2', 'C');
    expect(attemptProgress('gsat-115')).toEqual({ status: 'in_progress', mode: 'exam', answered: 2 });
    store.submit('manual', { earned: 2, autoMax: 72 });
    expect(attemptProgress('gsat-115')).toEqual({ status: 'submitted', mode: 'exam', result: { earned: 2, autoMax: 72 } });
  });
});

describe('作答規則', () => {
  it('清空答案（空字串、空陣列）會從紀錄移除', () => {
    const store = new AttemptStore(createAttempt('gsat-115', 'practice', null));
    store.setAnswer('47', 'innovation');
    store.setAnswer('47', '');
    store.setAnswer('49', ['A']);
    store.setAnswer('49', []);
    store.setAnswer('21', 'E');
    store.setAnswer('21', null);
    expect(store.getState().answers).toEqual({});
  });

  it('練習模式：看過答案的題目鎖住，其他題照常作答', () => {
    const store = new AttemptStore(createAttempt('gsat-115', 'practice', null));
    store.setAnswer('1', 'A');
    store.reveal(['1']);
    store.setAnswer('1', 'B');
    store.setAnswer('2', 'C');
    expect(store.getState().answers).toEqual({ '1': 'A', '2': 'C' });
    expect(store.isLocked('1')).toBe(true);
    expect(store.isLocked('2')).toBe(false);
  });

  it('考試模式不能提前看答案', () => {
    const store = new AttemptStore(createAttempt('gsat-115', 'exam', 60));
    store.reveal(['1']);
    expect(store.getState().revealed).toEqual([]);
  });

  it('交卷後全部鎖住、用時不再變動，重複交卷不會覆蓋第一次的結果', () => {
    const store = new AttemptStore(createAttempt('gsat-115', 'exam', 60));
    store.setAnswer('1', 'A');
    store.setElapsed(30);
    store.submit('timeout', { earned: 0, autoMax: 1 });
    store.setAnswer('1', 'B');
    store.setElapsed(99);
    store.submit('manual', { earned: 1, autoMax: 1 });
    expect(store.getState()).toMatchObject({ answers: { '1': 'A' }, elapsedSec: 30, submitReason: 'timeout', result: { earned: 0, autoMax: 1 } });
  });

  it('練習模式不記時間限制', () => {
    expect(createAttempt('gsat-115', 'practice', 6000).timeLimitSec).toBeNull();
  });

  it('只有內容真的改變才通知訂閱者', () => {
    const store = new AttemptStore(createAttempt('gsat-115', 'practice', null));
    const listener = vi.fn();
    store.subscribe(listener);
    store.setAnswer('1', 'A');
    store.setAnswer('1', 'A');
    store.setAnswer('2', null);
    store.setElapsed(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
