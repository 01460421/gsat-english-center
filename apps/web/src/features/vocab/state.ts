/**
 * 單字模組的兩份本機紀錄（每日學習、錯題本）：單例 store 與 React hook。
 * store 在第一次使用時才建立，才不會在模組載入（例如路由測試）時就去碰 localStorage。
 */
import { useSyncExternalStore } from 'react';
import { MISTAKES_STORAGE_KEY, parseMistakeBook, serializeMistakeBook, type MistakeBook } from './lib/mistakes';
import { parseSrsState, serializeSrsState, SRS_STORAGE_KEY, type SrsState } from './lib/srs';
import { createPersistentStore, detectLocalStorage, type PersistentStore, type StoreSnapshot } from './lib/storage';

let srsStore: PersistentStore<SrsState> | null = null;
let mistakeStore: PersistentStore<MistakeBook> | null = null;

export function getSrsStore(): PersistentStore<SrsState> {
  srsStore ??= createPersistentStore(
    SRS_STORAGE_KEY,
    {
      read: (raw) => {
        const { state, status } = parseSrsState(raw, Date.now());
        return { value: state, writable: status !== 'newer' };
      },
      write: serializeSrsState,
    },
    detectLocalStorage(),
  );
  return srsStore;
}

export function getMistakeStore(): PersistentStore<MistakeBook> {
  mistakeStore ??= createPersistentStore(
    MISTAKES_STORAGE_KEY,
    {
      read: (raw) => {
        const { book, status } = parseMistakeBook(raw, Date.now());
        return { value: book, writable: status !== 'newer' };
      },
      write: serializeMistakeBook,
    },
    detectLocalStorage(),
  );
  return mistakeStore;
}

export function useSrs(): StoreSnapshot<SrsState> {
  const store = getSrsStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export function useMistakes(): StoreSnapshot<MistakeBook> {
  const store = getMistakeStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** 測試用：丟掉單例，下一次使用時重新從 localStorage 讀。 */
export function resetVocabStoresForTests(): void {
  srsStore = null;
  mistakeStore = null;
}
