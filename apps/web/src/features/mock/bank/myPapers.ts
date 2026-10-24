/**
 * 「我組過的卷子」（docs/design/bank-mock.md §6.6、§4.7 第 (7) 部分）：清單、清理、逾期處理與作答中上限。
 *
 * 依清單參數化（docs/design/weak-paper.md §7.4）：createPaperList(config) 產生一份清單的全部操作（鍵、代號格式、
 * 解析、快照存放區各自設定）。這個檔案匯出的 loadMyPapers、checkActiveLimit… 是自組模擬考（bk1）那一份；
 * 加強卷（bk2）那一份在 weakPapers.ts（鍵 gsat-weakpaper:v1:papers、資料庫 gsat-weakpaper）。
 * 作答中、逐期處理與作答中上限只處理「自己的代號格式」：bk1 實例只看 bk1-，加強卷實例只看 bk2-，
 * 兩邊互不碰（不然 bk1 的逾期處理會到 gsat-bankmock 找 bk2 的快照、找不到就把作答整筆丟掉）。
 *
 *   gsat-bankmock:v1:papers（localStorage）
 *     [{ id, tier, createdAt, startedAt?, pdfAt?, paperDoneAt?, printed?: { from, excluded, keyChanged }, poolVersion }]，新的在前
 *
 * 只讀 localStorage（加上 gsat-mock:v1:* 的作答紀錄），不下載任何資料。所有讀寫都包 try/catch：
 * localStorage 不能用時清單是空的、也不保存（§2.8）。
 *
 * 上限與清理：
 *   - 清單最多 30 份。超過時刪掉最舊、而且沒有作答中紀錄也不在作答歷史裡的卷子，連同它的快照；全部都受保護時就全部保留。
 *     受保護的最多 30（作答歷史上限）＋3（作答中）＝33 份。
 *   - 作答中的自組卷最多 3 份：已經有 3 份時，開考第 4 份之前要提示（checkActiveLimit）。
 *   - 逾期未交卷：期限加 24 小時寬限後仍是作答中的自組卷，用快照以「已超過作答時間」交卷並寫入作答歷史
 *     （submitReason: 'expired'，同歷屆卷打開時已經超過期限的處理）；沒有快照就丟棄那筆紀錄，並清掉作答中的標記。
 *     現有的 upsertHistory 只清理已交卷的紀錄；自組卷每走一次「組卷 → 開始 → 離開」就多一筆，不清理就會無限增加。
 *   - 孤兒快照（清單、作答中、作答歷史都沒有的代號）在打開成績單時順便刪掉（cleanupOrphanSnapshots）。
 */
import { TIERS, type Tier } from '@gsat/shared';
import type { Exam } from '../../../data/exams';
import { computeReport, historyEntryFor } from '../report';
import { MockSession } from '../session';
import {
  MOCK_STORAGE_PREFIX,
  clearActiveId,
  loadActiveId,
  loadActiveRecord,
  loadHistory,
  removeRecord,
  upsertHistory,
  type MockAttemptRecord,
  type MockHistoryEntry,
} from '../storage';
import type { BankPaper } from './buildExam';
import { normalizePaperId, paperNumber, tierOfPaperId } from './code';
import { getSnapshotStore, paperFromSnapshot, type SnapshotStore } from './snapshots';

export const MY_PAPERS_KEY = 'gsat-bankmock:v1:papers';
/** 清單最多保留幾份（受保護的不算在可刪的範圍內）。 */
export const MY_PAPERS_LIMIT = 30;
/** 作答中的自組卷最多幾份。 */
export const BANK_ACTIVE_LIMIT = 3;
/** 期限過後多久還沒交卷，就自動處理。 */
export const EXPIRY_GRACE_MS = 24 * 60 * 60 * 1000;

/** 從 PDF 進來、題組和紙本不同時記下的資訊（§4.7 第 (5) 部分）。 */
export interface PrintedInfo {
  /** 紙本上的代號。 */
  from: string;
  /** 已下架、換成別組的題號範圍（「21-30」）：線上看得到也可以作答，但不計分。 */
  excluded: string[];
  /** 答案已更正的題號（「36」）：以線上（新版）為準計分。 */
  keyChanged: string[];
}

/** 每份清單共有的欄位。 */
export interface PaperListEntryBase {
  id: string;
  /** 組卷（或第一次記到這台裝置）的時間。 */
  createdAt: string;
  startedAt?: string;
  pdfAt?: string;
  paperDoneAt?: string;
  printed?: PrintedInfo;
  poolVersion: string | null;
}

export interface MyPaperEntry extends PaperListEntryBase {
  id: string;
  tier: Tier;
  /** 組卷（或第一次記到這台裝置）的時間。 */
  createdAt: string;
  /** 開考過（包括從 QR code 打開後開考的）。 */
  startedAt?: string;
  /** 下載過 PDF。 */
  pdfAt?: string;
  /** 按過「我已經在紙本做過這份」。 */
  paperDoneAt?: string;
  printed?: PrintedInfo;
  /** 組卷時的組卷池 version；不是在這台裝置組的（例如開考分享來的卷子）是 null。 */
  poolVersion: string | null;
}

// ---------------------------------------------------------------------------
// 共用的小工具
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * 解析共有的欄位（createdAt、startedAt、pdfAt、paperDoneAt、printed、poolVersion）；形狀不對回傳 null。
 * id 與各清單自己的欄位由呼叫端檢查。
 */
export function parseListBase(raw: Record<string, unknown>, id: string): PaperListEntryBase | null {
  const { createdAt, startedAt, pdfAt, paperDoneAt, printed, poolVersion } = raw;
  if (!isIsoDate(createdAt)) return null;
  const entry: PaperListEntryBase = { id, createdAt, poolVersion: typeof poolVersion === 'string' ? poolVersion : null };
  if (startedAt !== undefined) {
    if (!isIsoDate(startedAt)) return null;
    entry.startedAt = startedAt;
  }
  if (pdfAt !== undefined) {
    if (!isIsoDate(pdfAt)) return null;
    entry.pdfAt = pdfAt;
  }
  if (paperDoneAt !== undefined) {
    if (!isIsoDate(paperDoneAt)) return null;
    entry.paperDoneAt = paperDoneAt;
  }
  if (printed !== undefined) {
    if (!isRecord(printed) || typeof printed['from'] !== 'string' || !isStringArray(printed['excluded']) || !isStringArray(printed['keyChanged'])) return null;
    entry.printed = { from: printed['from'], excluded: printed['excluded'], keyChanged: printed['keyChanged'] };
  }
  return entry;
}

/** 檢查一筆；代號要是標準寫法、難度要和代號一致。形狀不對回傳 null（那一筆略過）。 */
export function parseMyPaper(raw: unknown): MyPaperEntry | null {
  if (!isRecord(raw)) return null;
  const { id, tier } = raw;
  if (typeof id !== 'string' || normalizePaperId(id)?.id !== id) return null;
  if (typeof tier !== 'string' || !(TIERS as readonly string[]).includes(tier) || tierOfPaperId(id) !== tier) return null;
  const base = parseListBase(raw, id);
  if (!base) return null;
  // 欄位順序同改動前（id、tier、createdAt、poolVersion、其他），寫回 localStorage 的內容不變。
  const { createdAt, poolVersion, ...rest } = base;
  return { id, tier: tier as Tier, createdAt, poolVersion, ...withoutId(rest) };
}

function withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = value;
  return rest;
}

/** 這份有沒有使用紀錄（開考、下載 PDF、紙本做過）。 */
export function hasPaperUse(entry: PaperListEntryBase): boolean {
  return Boolean(entry.startedAt ?? entry.pdfAt ?? entry.paperDoneAt);
}

/** 最後使用時間（三個時間裡最晚的一個，毫秒）；沒有使用紀錄是 null。 */
export function paperUsedAt(entry: PaperListEntryBase): number | null {
  const times = [entry.startedAt, entry.pdfAt, entry.paperDoneAt].filter((t): t is string => t !== undefined).map((t) => Date.parse(t));
  return times.length === 0 ? null : Math.max(...times);
}

const ACTIVE_PREFIX = `${MOCK_STORAGE_PREFIX}active:`;

function storageKeys(prefix: string): string[] {
  const keys: string[] = [];
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // localStorage 不能用：沒有作答中的紀錄
  }
  return keys;
}

export interface ActiveBankAttempt {
  paperId: string;
  record: MockAttemptRecord;
}

/** 受保護的卷子：有作答中紀錄，或在作答歷史裡。清理時不刪。 */
export function isProtectedPaper(paperId: string, history: readonly MockHistoryEntry[] = loadHistory()): boolean {
  return loadActiveId(paperId) !== null || history.some((h) => h.paperId === paperId);
}

/**
 * 交卷寫入歷史的摘要（自組卷：level 一律 null）。WP2 的 bankScore.ts 傳入含混合題自動判分的版本（bankHistoryEntry）；
 * 判分要用解析裡的部分給分寫法，所以逾期交卷時也把用快照重建的卷子（paper）一起傳進去。
 */
export type BankHistoryEntryFn = (record: MockAttemptRecord, exam: Exam, paper?: BankPaper) => MockHistoryEntry;

/** 預設的歷史摘要：原始分數（computeReport），不換算級分。 */
export const defaultBankHistoryEntry: BankHistoryEntryFn = (record, exam) => historyEntryFor(record, computeReport(exam, record), null);

export interface ExpireResult {
  /** 用快照以「已超過作答時間」交卷的代號。 */
  submitted: string[];
  /** 沒有快照、丟棄作答紀錄的代號。 */
  discarded: string[];
}

export interface MaintainOptions {
  now?: number;
  store?: SnapshotStore;
  historyEntry?: BankHistoryEntryFn;
}

// ---------------------------------------------------------------------------
// 一份清單
// ---------------------------------------------------------------------------

export interface PaperListConfig<E extends PaperListEntryBase> {
  /** localStorage 的鍵。 */
  key: string;
  /** 這份清單負責的代號（標準寫法）：作答中、逐期處理與作答中上限只看它們。 */
  owns: (paperId: string) => boolean;
  /** 檢查一筆；形狀不對回傳 null。 */
  parse: (raw: unknown) => E | null;
  /** 清單裡沒有時新增的一筆（例如開考分享來的卷子）；代號格式不對回傳 null。 */
  blank: (paperId: string, now: Date) => E | null;
  /** 這份清單的快照存放區。 */
  store: () => SnapshotStore;
}

export interface PaperList<E extends PaperListEntryBase> {
  readonly key: string;
  load(): E[];
  save(list: readonly E[]): boolean;
  find(paperId: string): E | null;
  add(entry: E): boolean;
  update(paperId: string, patch: Partial<Omit<E, 'id'>>, now?: Date): boolean;
  markStarted(paperId: string, now?: Date): boolean;
  markPdf(paperId: string, now?: Date): boolean;
  setDone(paperId: string, done: boolean, now?: Date): boolean;
  recordPrinted(paperId: string, printed: PrintedInfo, poolVersion: string | null, now?: Date): boolean;
  replaceId(oldId: string, newId: string): boolean;
  activeAttempts(): ActiveBankAttempt[];
  checkActiveLimit(paperId: string): { ok: true } | { ok: false; active: ActiveBankAttempt[] };
  prune(store?: SnapshotStore): Promise<string[]>;
  expireStaleAttempts(options?: MaintainOptions): Promise<ExpireResult>;
  cleanupOrphanSnapshots(store?: SnapshotStore): Promise<string[]>;
  maintain(options?: MaintainOptions): Promise<ExpireResult>;
}

/** 產生一份清單的操作（docs/design/weak-paper.md §7.4）。 */
export function createPaperList<E extends PaperListEntryBase>(config: PaperListConfig<E>): PaperList<E> {
  /** 清單（新的在前）。壞掉的項目與重複的代號略過。 */
  const load = (): E[] => {
    let raw: unknown;
    try {
      const text = window.localStorage.getItem(config.key);
      raw = text === null ? [] : (JSON.parse(text) as unknown);
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: E[] = [];
    for (const item of raw) {
      const entry = config.parse(item);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  };

  /** 整份寫回；寫不進去回傳 false。 */
  const save = (list: readonly E[]): boolean => {
    try {
      window.localStorage.setItem(config.key, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  };

  const find = (paperId: string): E | null => load().find((e) => e.id === paperId) ?? null;

  /** 新增一份（放最前面；同代號的舊項目取代）。 */
  const add = (entry: E): boolean => save([entry, ...load().filter((e) => e.id !== entry.id)]);

  /**
   * 更新一份的欄位；清單裡沒有就新增（放最前面，例如開考分享來的卷子）。代號格式不對回傳 false。
   * patch 的欄位值是 undefined 時刪掉那個欄位（「紙本做過」可以取消）。
   */
  const update = (paperId: string, patch: Partial<Omit<E, 'id'>>, now = new Date()): boolean => {
    const blank = config.blank(paperId, now);
    if (!blank) return false;
    const list = load();
    const index = list.findIndex((e) => e.id === paperId);
    const base: E = list[index] ?? blank;
    const next: E = { ...base };
    for (const [key, value] of Object.entries(patch) as [keyof E, unknown][]) {
      if (value === undefined) delete next[key];
      else (next as unknown as Record<string, unknown>)[key as string] = value;
    }
    if (index >= 0) list[index] = next;
    else list.unshift(next);
    return save(list);
  };

  /**
   * 換題後把清單裡的舊代號換成新代號（§4.7 第 (4) 部分）：只換沒有使用紀錄的那一筆，位置與組卷時間不變。
   * 清單裡已經有新代號時，保留新代號那一筆的位置、使用紀錄與 printed，組卷時間取兩筆裡較早的，再刪掉舊代號那一筆。
   * 清單裡沒有舊代號、或舊代號有使用紀錄時不動，回傳 false。
   */
  const replaceId = (oldId: string, newId: string): boolean => {
    const list = load();
    const old = list.find((e) => e.id === oldId);
    if (!old || hasPaperUse(old)) return false;
    const existing = list.find((e) => e.id === newId);
    if (existing) {
      const merged: E = { ...old, ...existing, id: newId };
      if (Date.parse(old.createdAt) < Date.parse(existing.createdAt)) merged.createdAt = old.createdAt;
      if (existing.poolVersion === null) merged.poolVersion = old.poolVersion;
      return save(list.flatMap((e) => (e.id === oldId ? [] : e.id === newId ? [merged] : [e])));
    }
    return save(list.map((e) => (e.id === oldId ? { ...old, id: newId } : e)));
  };

  /** 作答中的卷子（gsat-mock:v1:active:{代號} 指向一筆有效、作答中的紀錄；只看這份清單負責的代號）。依開考時間新到舊。 */
  const activeAttempts = (): ActiveBankAttempt[] => {
    const out: ActiveBankAttempt[] = [];
    for (const key of storageKeys(ACTIVE_PREFIX)) {
      const paperId = key.slice(ACTIVE_PREFIX.length);
      if (!config.owns(paperId)) continue;
      const record = loadActiveRecord(paperId);
      if (record) out.push({ paperId, record });
    }
    return out.sort((a, b) => Date.parse(b.record.startedAt) - Date.parse(a.record.startedAt));
  };

  /**
   * 開考前檢查作答中的上限（§2.8）：這份本來就在作答中（接續作答）或作答中的卷子少於 3 份時可以開考；
   * 不然回傳那幾份，讓學生選擇接著作答或放棄其中一份。
   */
  const checkActiveLimit = (paperId: string): { ok: true } | { ok: false; active: ActiveBankAttempt[] } => {
    const active = activeAttempts();
    if (active.some((a) => a.paperId === paperId) || active.length < BANK_ACTIVE_LIMIT) return { ok: true };
    return { ok: false, active };
  };

  /**
   * 清單超過 30 份時，刪掉最舊（組卷時間最早）而且不受保護的卷子，連同快照；全部都受保護時就全部保留。
   * 回傳刪掉的代號。
   */
  const prune = async (store: SnapshotStore = config.store()): Promise<string[]> => {
    const list = load();
    if (list.length <= MY_PAPERS_LIMIT) return [];
    const history = loadHistory();
    const removable = list
      .filter((e) => !isProtectedPaper(e.id, history))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .slice(0, list.length - MY_PAPERS_LIMIT)
      .map((e) => e.id);
    if (removable.length === 0) return [];
    const drop = new Set(removable);
    save(list.filter((e) => !drop.has(e.id)));
    for (const id of removable) {
      try {
        await store.delete(id);
      } catch {
        // 刪不掉的快照之後由 cleanupOrphanSnapshots 再處理。
      }
    }
    return removable;
  };

  /**
   * 逾期 24 小時以上仍未交卷的卷子（§4.7 第 (7) 部分）：有快照就以 submitReason 'expired' 交卷並寫入作答歷史；
   * 沒有快照（或快照壞掉）就丟棄那筆紀錄，並清掉作答中的標記。只處理這份清單負責的代號。
   */
  const expireStaleAttempts = async (options: MaintainOptions = {}): Promise<ExpireResult> => {
    const now = options.now ?? Date.now();
    const store = options.store ?? config.store();
    const historyEntry = options.historyEntry ?? defaultBankHistoryEntry;
    const result: ExpireResult = { submitted: [], discarded: [] };
    for (const { paperId, record } of activeAttempts()) {
      if (Date.parse(record.deadlineAt) + EXPIRY_GRACE_MS > now) continue;
      let paper: BankPaper | null = null;
      try {
        const snapshot = await store.get(paperId);
        if (snapshot) paper = paperFromSnapshot(snapshot);
      } catch {
        paper = null;
      }
      const exam = paper?.exam ?? null;
      // 讀快照的期間別的分頁可能已經交卷或放棄：重新讀一次，確認仍是同一筆作答中的紀錄。
      const current = loadActiveRecord(paperId);
      if (!current || current.id !== record.id) continue;
      if (exam && paper) {
        const submitted = new MockSession(current).submit(exam, 'expired', now);
        if (submitted) {
          upsertHistory(historyEntry(submitted, exam, paper));
          result.submitted.push(paperId);
          continue;
        }
      }
      removeRecord(current.id);
      clearActiveId(paperId, current.id);
      result.discarded.push(paperId);
    }
    return result;
  };

  /** 刪掉孤兒快照：清單、作答中、作答歷史都沒有的代號（打開成績單時順便做）。回傳刪掉的代號。 */
  const cleanupOrphanSnapshots = async (store: SnapshotStore = config.store()): Promise<string[]> => {
    const keep = new Set<string>(load().map((e) => e.id));
    for (const h of loadHistory()) keep.add(h.paperId);
    for (const a of activeAttempts()) keep.add(a.paperId);
    const removed: string[] = [];
    try {
      for (const id of await store.keys()) {
        if (keep.has(id) || loadActiveId(id) !== null) continue;
        await store.delete(id);
        removed.push(id);
      }
    } catch {
      // 下次再清。
    }
    return removed;
  };

  return {
    key: config.key,
    load,
    save,
    find,
    add,
    update,
    markStarted: (paperId, now = new Date()) => update(paperId, { startedAt: now.toISOString() } as Partial<Omit<E, 'id'>>, now),
    markPdf: (paperId, now = new Date()) => update(paperId, { pdfAt: now.toISOString() } as Partial<Omit<E, 'id'>>, now),
    setDone: (paperId, done, now = new Date()) => update(paperId, { paperDoneAt: done ? now.toISOString() : undefined } as Partial<Omit<E, 'id'>>, now),
    recordPrinted: (paperId, printed, poolVersion, now = new Date()) => {
      const existing = find(paperId);
      return update(paperId, { printed, ...(existing ? {} : { poolVersion }) } as Partial<Omit<E, 'id'>>, now);
    },
    replaceId,
    activeAttempts,
    checkActiveLimit,
    prune,
    expireStaleAttempts,
    cleanupOrphanSnapshots,
    maintain: async (options: MaintainOptions = {}) => {
      const expired = await expireStaleAttempts(options);
      await prune(options.store);
      return expired;
    },
  };
}

// ---------------------------------------------------------------------------
// 自組模擬考（bk1）的清單
// ---------------------------------------------------------------------------

/** 自組模擬考的代號（標準寫法）。 */
function isBk1Id(paperId: string): boolean {
  return normalizePaperId(paperId)?.id === paperId;
}

export const bankPaperList: PaperList<MyPaperEntry> = createPaperList<MyPaperEntry>({
  key: MY_PAPERS_KEY,
  owns: isBk1Id,
  parse: parseMyPaper,
  blank: (paperId, now) => {
    const tier = tierOfPaperId(paperId);
    return tier && isBk1Id(paperId) ? { id: paperId, tier, createdAt: now.toISOString(), poolVersion: null } : null;
  },
  store: () => getSnapshotStore(),
});

/** 清單（新的在前）。壞掉的項目與重複的代號略過。 */
export function loadMyPapers(): MyPaperEntry[] {
  return bankPaperList.load();
}

/** 整份寫回；寫不進去回傳 false。 */
export function saveMyPapers(list: readonly MyPaperEntry[]): boolean {
  return bankPaperList.save(list);
}

export function findMyPaper(paperId: string): MyPaperEntry | null {
  return bankPaperList.find(paperId);
}

/** 新增一份（放最前面；同代號的舊項目取代）。 */
export function addMyPaper(entry: MyPaperEntry): boolean {
  return bankPaperList.add(entry);
}

/**
 * 更新一份的欄位；清單裡沒有就新增（放最前面，例如開考分享來的卷子）。代號格式不對回傳 false。
 * patch 的欄位值是 undefined 時刪掉那個欄位（「紙本做過」可以取消）。
 */
export function updateMyPaper(paperId: string, patch: Partial<Omit<MyPaperEntry, 'id' | 'tier'>>, now = new Date()): boolean {
  return bankPaperList.update(paperId, patch, now);
}

/** 開考（§2.3）：記 startedAt。之後組卷會避開這份的題組。 */
export function markPaperStarted(paperId: string, now = new Date()): boolean {
  return bankPaperList.markStarted(paperId, now);
}

/** 下載 PDF 成功（§2.5）：記 pdfAt。 */
export function markPaperPdf(paperId: string, now = new Date()): boolean {
  return bankPaperList.markPdf(paperId, now);
}

/** 「我已經在紙本做過這份」（§2.2）；done 為 false 時取消。 */
export function setPaperDone(paperId: string, done: boolean, now = new Date()): boolean {
  return bankPaperList.setDone(paperId, done, now);
}

/** 從 PDF 進來、題組和紙本不同時記下（§4.7 第 (5) 部分）。 */
export function recordPrinted(paperId: string, printed: PrintedInfo, poolVersion: string | null, now = new Date()): boolean {
  return bankPaperList.recordPrinted(paperId, printed, poolVersion, now);
}

/** 換題後把清單裡的舊代號換成新代號（見 createPaperList 的 replaceId）。 */
export function replaceMyPaperId(oldId: string, newId: string): boolean {
  return bankPaperList.replaceId(oldId, newId);
}

/** 作答中的自組卷（只看 bk1 的代號）。依開考時間新到舊。 */
export function activeBankAttempts(): ActiveBankAttempt[] {
  return bankPaperList.activeAttempts();
}

/** 開考前檢查作答中的上限（§2.8；自組卷與加強卷各自計算）。 */
export function checkActiveLimit(paperId: string): { ok: true } | { ok: false; active: ActiveBankAttempt[] } {
  return bankPaperList.checkActiveLimit(paperId);
}

/** 清單超過 30 份時刪掉最舊、不受保護的卷子與快照。 */
export function prunePapers(store?: SnapshotStore): Promise<string[]> {
  return bankPaperList.prune(store);
}

/** 逾期 24 小時以上仍未交卷的自組卷（§4.7 第 (7) 部分）。 */
export function expireStaleAttempts(options: MaintainOptions = {}): Promise<ExpireResult> {
  return bankPaperList.expireStaleAttempts(options);
}

/** 刪掉孤兒快照（打開成績單時順便做）。 */
export function cleanupOrphanSnapshots(store?: SnapshotStore): Promise<string[]> {
  return bankPaperList.cleanupOrphanSnapshots(store);
}

/**
 * 載入「我組過的卷子」時的例行處理：逾期作答、清單上限（§2.1）。回傳逾期作答的處理結果：有交卷或丟棄時，
 * 呼叫端要通知同一頁的作答紀錄重新讀取（storage 事件只會在別的分頁觸發）。
 */
export async function maintainMyPapers(options: MaintainOptions = {}): Promise<ExpireResult> {
  return bankPaperList.maintain(options);
}

export interface MyPaperRow {
  entry: MyPaperEntry;
  /** 卷號。 */
  code: string;
  /** 作答中的紀錄。 */
  active: MockAttemptRecord | null;
  /** 這份的交卷紀錄（新到舊）。 */
  submissions: MockHistoryEntry[];
}

/** 清單的每一列需要的資料（只讀 localStorage）。狀態文字由畫面組。 */
export function listMyPapers(): MyPaperRow[] {
  const history = loadHistory();
  return loadMyPapers().map((entry) => ({
    entry,
    code: paperNumber(entry.id),
    active: loadActiveRecord(entry.id),
    submissions: history.filter((h) => h.paperId === entry.id),
  }));
}
