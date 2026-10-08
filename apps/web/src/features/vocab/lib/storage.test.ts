/**
 * 本機儲存的降級：localStorage 不能用、寫入失敗、存檔是新版格式，都不能讓功能壞掉或蓋掉資料。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, createPersistentStore, detectLocalStorage, type StoreCodec } from './storage';

interface Counter {
  n: number;
  newer?: boolean;
}

const codec: StoreCodec<Counter> = {
  read: (raw) => {
    if (raw === null) return { value: { n: 0 }, writable: true };
    const parsed = JSON.parse(raw) as unknown;
    const n = typeof parsed === 'object' && parsed !== null && 'n' in parsed && typeof parsed.n === 'number' ? parsed.n : 0;
    const newer = typeof parsed === 'object' && parsed !== null && 'v' in parsed && parsed.v === 2;
    return { value: { n }, writable: !newer };
  },
  write: (value) => JSON.stringify({ n: value.n }),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectLocalStorage', () => {
  it('可用時回傳 localStorage', () => {
    expect(detectLocalStorage()).toBe(window.localStorage);
  });

  it('寫入丟例外（舊版 Safari 無痕模式）時回傳 null', () => {
    // 換掉整個 localStorage 而不是 spy 它的 setItem：happy-dom 的 Storage 是 Proxy，
    // 在上面設屬性會變成存一筆資料，還原不乾淨。
    const quotaZero: Storage = {
      length: 0,
      clear: () => {},
      key: () => null,
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(quotaZero);
    expect(detectLocalStorage()).toBeNull();
  });

  it('連讀取 window.localStorage 都丟例外（封鎖網站資料）時回傳 null', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(detectLocalStorage()).toBeNull();
  });
});

describe('createPersistentStore', () => {
  it('寫入後存檔、通知訂閱者；重新建立 store 讀得回來', () => {
    const storage = createMemoryStorage();
    const store = createPersistentStore('k', codec, storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.update((c) => ({ n: c.n + 1 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ value: { n: 1 }, mode: 'persistent', saveFailed: false });
    expect(createPersistentStore('k', codec, storage).getSnapshot().value).toEqual({ n: 1 });
    unsubscribe();
  });

  it('沒有 localStorage：改存記憶體，mode 為 memory，功能照常', () => {
    const store = createPersistentStore('k', codec, null);
    store.update((c) => ({ n: c.n + 5 }));
    expect(store.getSnapshot()).toMatchObject({ value: { n: 5 }, mode: 'memory' });
  });

  it('寫入失敗（容量滿）：狀態照樣更新，標記 saveFailed', () => {
    const storage = createMemoryStorage();
    storage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const store = createPersistentStore('k', codec, storage);
    store.update(() => ({ n: 3 }));
    expect(store.getSnapshot()).toMatchObject({ value: { n: 3 }, saveFailed: true });
  });

  it('存檔是新版格式：mode 為 readonly，不覆寫', () => {
    const storage = createMemoryStorage();
    storage.setItem('k', JSON.stringify({ v: 2, n: 42 }));
    const store = createPersistentStore('k', codec, storage);
    expect(store.getSnapshot().mode).toBe('readonly');
    store.update(() => ({ n: 1 }));
    expect(storage.getItem('k')).toBe(JSON.stringify({ v: 2, n: 42 }));
  });

  it('回傳同一個值時不通知、不寫入', () => {
    const store = createPersistentStore('k', codec, createMemoryStorage());
    const listener = vi.fn();
    store.subscribe(listener);
    store.update((c) => c);
    expect(listener).not.toHaveBeenCalled();
  });

  it('其他分頁改了同一個鍵（storage 事件）：重新讀取並通知', () => {
    const store = createPersistentStore('gsat-test-key', codec, window.localStorage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    window.localStorage.setItem('gsat-test-key', JSON.stringify({ n: 7 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'gsat-test-key' }));
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot().value).toEqual({ n: 7 });
    window.dispatchEvent(new StorageEvent('storage', { key: 'other-key' }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
