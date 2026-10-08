/**
 * 學習紀錄的本機儲存（localStorage）與降級。
 *
 * localStorage 在無痕模式（舊版 Safari 一寫就丟例外）、被封鎖的網站資料、部分 App 內建瀏覽器裡不能用，
 * 容量滿了寫入也會失敗。這些情況下功能照樣要能用，只是進度留不住，所以：
 *   - 開頭先實際寫一次探測，不能用就改存在記憶體（mode = 'memory'），畫面上提示學生；
 *   - 之後每次寫入都包 try/catch，失敗只記下 saveFailed，不讓例外打斷作答；
 *   - 存檔是比這個版本新的格式時（mode = 'readonly'），一律不覆寫，避免舊分頁把新版進度蓋掉。
 *
 * 用極小的外部 store＋useSyncExternalStore（和 lib/theme.ts 同樣的做法），而不是 React context：
 * 單字卡、每日學習、測驗、錯題本都要讀寫同一份紀錄，也要接收其他分頁改動（storage 事件）。
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 記憶體版 Storage：localStorage 不能用時的替代品，重新整理就消失。 */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const PROBE_KEY = 'gsat-storage-probe';

/** 回傳可用的 localStorage；讀取屬性、寫入、刪除任何一步丟例外就回傳 null。 */
export function detectLocalStorage(): StorageLike | null {
  try {
    const ls = window.localStorage;
    ls.setItem(PROBE_KEY, '1');
    ls.removeItem(PROBE_KEY);
    return ls;
  } catch {
    return null;
  }
}

/**
 * persistent  正常存在 localStorage
 * memory      localStorage 不能用，只存在這次瀏覽
 * readonly    存檔是較新版本的格式：照常運作但不寫回，避免蓋掉新版資料
 */
export type StoreMode = 'persistent' | 'memory' | 'readonly';

export interface StoreSnapshot<T> {
  value: T;
  mode: StoreMode;
  /** 最近一次寫入失敗（多半是容量滿了）。 */
  saveFailed: boolean;
}

export interface PersistentStore<T> {
  getSnapshot(): StoreSnapshot<T>;
  update(fn: (prev: T) => T): void;
  subscribe(listener: () => void): () => void;
}

export interface StoreCodec<T> {
  /** 從存檔字串還原；writable 為 false 表示存檔是新版格式，不可覆寫。 */
  read(raw: string | null): { value: T; writable: boolean };
  write(value: T): string;
}

export function createPersistentStore<T>(key: string, codec: StoreCodec<T>, storage: StorageLike | null): PersistentStore<T> {
  const backend = storage ?? createMemoryStorage();
  const readRaw = () => {
    try {
      return backend.getItem(key);
    } catch {
      return null;
    }
  };
  const initial = codec.read(readRaw());
  let snapshot: StoreSnapshot<T> = {
    value: initial.value,
    mode: storage === null ? 'memory' : initial.writable ? 'persistent' : 'readonly',
    saveFailed: false,
  };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  // 其他分頁改了同一份紀錄：重新讀取，兩個分頁才不會各自寫入、互相覆蓋。
  const onStorage = (e: StorageEvent) => {
    if (storage === null || (e.key !== null && e.key !== key)) return;
    const next = codec.read(readRaw());
    snapshot = { value: next.value, mode: next.writable ? 'persistent' : 'readonly', saveFailed: false };
    emit();
  };

  return {
    getSnapshot: () => snapshot,
    update(fn) {
      const value = fn(snapshot.value);
      if (Object.is(value, snapshot.value)) return;
      let saveFailed = false;
      if (snapshot.mode !== 'readonly') {
        try {
          backend.setItem(key, codec.write(value));
        } catch {
          saveFailed = true;
        }
      }
      snapshot = { ...snapshot, value, saveFailed };
      emit();
    },
    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
  };
}
