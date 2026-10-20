/**
 * 卷子內容的快照（docs/design/bank-mock.md §4.7 第 (2) 部分）。
 *
 * 建置只輸出每個題組最新的版本，代號裡的 uid@版本 之後可能拿不到；這台裝置組過、開考過、下載過或標記紙本做過的卷子，
 * 題組內容存一份快照，作答、自動交卷與成績單一律用快照。
 *
 *   儲存位置  IndexedDB 資料庫 gsat-bankmock 的物件存放區 papers，鍵是 paperId
 *   值        { v: 1, id, savedAt, dataVersion, slots: { key: 'uid@v'; swap: [number, number][] }[], files: Record<'uid@v', 題組檔> }
 *             slots 記下每個位置實際用的版本與可交換設定，用快照重建時不必再查組卷池。
 *             題組檔是題庫練習的題組檔；中譯英、作文是 { prompt, answers } 兩個檔（同一個 uid@v 有題目與答案兩個檔）。
 *   大小      一份約 160–195 KB；最多約 33 份、6.4 MB（myPapers.ts 的上限）
 *
 * 為什麼不用 localStorage：一份就算壓縮也要 60–75 KB，localStorage 每個網站約只有 5 MB，要和單字複習、作答紀錄共用，
 * 而且是同步寫入。IndexedDB 空間大、又是非同步的。
 *
 * IndexedDB 不能用時（部分無痕模式、內嵌瀏覽器）改用記憶體，只在同一個分頁內有效；persistent() 回傳 false，
 * 畫面提示「這個瀏覽器不能保存卷子內容」。讀回來的資料一律檢查，形狀不對就當成沒有。
 * 單元測試用記憶體版（happy-dom 沒有 IndexedDB），e2e 在 Chromium 測真的 IndexedDB。
 */
import { isRecord } from '../../../data/client';
import { SLOT_COUNT } from './blueprint';
import { buildBankPaper, parseSlotKey, type BankPaper, type BankPaperNotices, type BankSlotSource, type SlotFile } from './buildExam';
import { decodePaperId } from './code';

export const SNAPSHOT_DB_NAME = 'gsat-bankmock';
export const SNAPSHOT_STORE_NAME = 'papers';
const DB_VERSION = 1;

export interface BankSnapshot {
  v: 1;
  /** 代號（paperId）。 */
  id: string;
  savedAt: string;
  /** 組卷池的 version。 */
  dataVersion: string;
  /** 11 個位置，依代號的順序。 */
  slots: BankSlotSource[];
  /** 鍵是 uid@v。 */
  files: Record<string, SlotFile>;
}

export interface SnapshotStore {
  /** 是不是存在 IndexedDB（false＝只在這個分頁的記憶體裡）。 */
  persistent(): Promise<boolean>;
  /** 讀一份；沒有或壞掉回傳 null（壞掉的那份也會刪掉）。 */
  get(paperId: string): Promise<BankSnapshot | null>;
  /** 寫一份；寫不進去回傳 false。 */
  put(snapshot: BankSnapshot): Promise<boolean>;
  delete(paperId: string): Promise<void>;
  /** 所有快照的 paperId。 */
  keys(): Promise<string[]>;
}

/** BankPaper → 快照。 */
export function snapshotOf(paper: Pick<BankPaper, 'id' | 'dataVersion' | 'source'>, now = new Date()): BankSnapshot {
  return {
    v: 1,
    id: paper.id,
    savedAt: now.toISOString(),
    dataVersion: paper.dataVersion,
    slots: paper.source.slots.map((s) => ({ key: s.key, swap: s.swap.map(([q, r]) => [q, r] as [number, number]) })),
    files: { ...paper.source.files },
  };
}

// ---------------------------------------------------------------------------
// 檢查
// ---------------------------------------------------------------------------

function isSlotFile(value: unknown, key: string): value is SlotFile {
  const parsed = parseSlotKey(key);
  if (!parsed || !isRecord(value)) return false;
  const matches = (f: unknown): boolean => isRecord(f) && f['uid'] === parsed.uid && f['version'] === parsed.v;
  if ('prompt' in value || 'answers' in value) {
    const { prompt, answers } = value;
    return matches(prompt) && matches(answers) && isRecord(prompt) && prompt['part'] === 'prompt' && isRecord(answers) && answers['part'] === 'answers';
  }
  return matches(value) && value['schema'] === 'gsat-bank-practice/v1' && isRecord(value['group']) && Array.isArray(value['group']['questions']) && isRecord(value['annotations']);
}

/** 檢查讀回來的快照；id 有給時也要對得上。形狀不對回傳 null。 */
export function parseSnapshot(raw: unknown, id?: string): BankSnapshot | null {
  if (!isRecord(raw) || raw['v'] !== 1) return null;
  if (typeof raw['id'] !== 'string' || (id !== undefined && raw['id'] !== id)) return null;
  if (typeof raw['savedAt'] !== 'string' || typeof raw['dataVersion'] !== 'string') return null;
  const slots = raw['slots'];
  const files = raw['files'];
  if (!Array.isArray(slots) || slots.length !== SLOT_COUNT || !isRecord(files)) return null;
  const cleanSlots: BankSlotSource[] = [];
  const cleanFiles: Record<string, SlotFile> = {};
  for (const slot of slots as unknown[]) {
    if (!isRecord(slot) || typeof slot['key'] !== 'string' || !Array.isArray(slot['swap'])) return null;
    const key = slot['key'];
    const swap: [number, number][] = [];
    for (const pair of slot['swap'] as unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((x) => Number.isInteger(x))) return null;
      swap.push([pair[0] as number, pair[1] as number]);
    }
    const file = files[key];
    if (!isSlotFile(file, key)) return null;
    cleanSlots.push({ key, swap });
    cleanFiles[key] = file;
  }
  return { v: 1, id: raw['id'], savedAt: raw['savedAt'], dataVersion: raw['dataVersion'], slots: cleanSlots, files: cleanFiles };
}

// ---------------------------------------------------------------------------
// 記憶體版
// ---------------------------------------------------------------------------

/** 記憶體版：IndexedDB 不能用時的退路，也給單元測試用。存的是結構複製後的副本，和 IndexedDB 一樣不共用物件。 */
export function createMemorySnapshotStore(): SnapshotStore {
  const data = new Map<string, unknown>();
  return {
    persistent: () => Promise.resolve(false),
    get: (paperId) => {
      const raw = data.get(paperId);
      if (raw === undefined) return Promise.resolve(null);
      const parsed = parseSnapshot(structuredClone(raw), paperId);
      if (!parsed) data.delete(paperId);
      return Promise.resolve(parsed);
    },
    put: (snapshot) => {
      try {
        data.set(snapshot.id, structuredClone(snapshot));
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    },
    delete: (paperId) => {
      data.delete(paperId);
      return Promise.resolve();
    },
    keys: () => Promise.resolve([...data.keys()]),
  };
}

// ---------------------------------------------------------------------------
// IndexedDB 版
// ---------------------------------------------------------------------------

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(SNAPSHOT_DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('IndexedDB 無法開啟'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) db.createObjectStore(SNAPSHOT_STORE_NAME);
    };
    request.onsuccess = () => {
      const db = request.result;
      // 別的分頁要升級資料庫時先關掉，不擋住它。
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 無法開啟'));
    request.onblocked = () => reject(new Error('IndexedDB 被其他分頁佔用'));
  });
}

function runRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      tx = db.transaction(SNAPSHOT_STORE_NAME, mode);
      request = make(tx.objectStore(SNAPSHOT_STORE_NAME));
    } catch (error) {
      reject(error instanceof Error ? error : new Error('IndexedDB 交易失敗'));
      return;
    }
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('IndexedDB 交易失敗'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 交易中止'));
  });
}

/**
 * IndexedDB 版。資料庫打不開（不支援、無痕模式、被封鎖）時，整個 store 改用記憶體版，persistent() 變成 false。
 * 打得開但某次讀寫失敗（空間滿）只讓那一次失敗：get 回傳 null、put 回傳 false。
 */
export function createIndexedDbSnapshotStore(factory: IDBFactory | undefined): SnapshotStore {
  const memory = createMemorySnapshotStore();
  const ready: Promise<IDBDatabase | null> = factory ? openDatabase(factory).catch(() => null) : Promise.resolve(null);
  return {
    persistent: async () => (await ready) !== null,
    get: async (paperId) => {
      const db = await ready;
      if (!db) return memory.get(paperId);
      try {
        const raw = await runRequest<unknown>(db, 'readonly', (s) => s.get(paperId));
        if (raw === undefined) return null;
        const parsed = parseSnapshot(raw, paperId);
        if (!parsed) await runRequest(db, 'readwrite', (s) => s.delete(paperId)).catch(() => undefined);
        return parsed;
      } catch {
        return null;
      }
    },
    put: async (snapshot) => {
      const db = await ready;
      if (!db) return memory.put(snapshot);
      try {
        await runRequest(db, 'readwrite', (s) => s.put(snapshot, snapshot.id));
        return true;
      } catch {
        return false;
      }
    },
    delete: async (paperId) => {
      const db = await ready;
      if (!db) return memory.delete(paperId);
      await runRequest(db, 'readwrite', (s) => s.delete(paperId)).catch(() => undefined);
    },
    keys: async () => {
      const db = await ready;
      if (!db) return memory.keys();
      try {
        const keys = await runRequest(db, 'readonly', (s) => s.getAllKeys());
        return keys.filter((k): k is string => typeof k === 'string');
      } catch {
        return [];
      }
    },
  };
}

function defaultFactory(): IDBFactory | undefined {
  try {
    return typeof indexedDB === 'undefined' ? undefined : indexedDB;
  } catch {
    // 某些瀏覽器在封鎖網站資料時，讀 indexedDB 這個全域就會丟例外。
    return undefined;
  }
}

let shared: SnapshotStore | null = null;

/** 整個頁面共用的快照存放區（第一次用到時才開資料庫）。 */
export function getSnapshotStore(): SnapshotStore {
  shared ??= createIndexedDbSnapshotStore(defaultFactory());
  return shared;
}

/** 測試用：換成指定的存放區（null＝下次重新建立）。 */
export function setSnapshotStoreForTests(store: SnapshotStore | null): void {
  shared = store;
}

/** 用快照重建卷子（不需要組卷池）。代號格式不對或快照內容和代號不符時丟出錯誤。 */
export function paperFromSnapshot(snapshot: BankSnapshot, notices?: Partial<BankPaperNotices>): BankPaper {
  const decoded = decodePaperId(snapshot.id);
  if (!decoded) throw new Error(`快照的代號格式不對：${snapshot.id}`);
  return buildBankPaper({
    paperId: decoded.id,
    tier: decoded.tier,
    dataVersion: snapshot.dataVersion,
    slots: snapshot.slots,
    files: snapshot.files,
    ...(notices ? { notices } : {}),
  });
}

/** 快照不存在時才寫（開考、下載 PDF、按「紙本做過」時確認快照已經寫入，§4.7 第 (2) 部分）。回傳最後有沒有快照。 */
export async function ensureSnapshot(paper: Pick<BankPaper, 'id' | 'dataVersion' | 'source'>, store: SnapshotStore = getSnapshotStore()): Promise<boolean> {
  if (await store.get(paper.id)) return true;
  return store.put(snapshotOf(paper));
}
