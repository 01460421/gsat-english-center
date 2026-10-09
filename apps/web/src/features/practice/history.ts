/**
 * 題庫練習的本機紀錄（localStorage）：做過哪些題組、每一格目前在做哪一組、作答中看過幾層提示。
 *
 * 為什麼存在本機：登入與作答紀錄（D1）還沒做；「抽一組沒做過的」只要記得做過哪些 uid 就夠了。
 * 題組的作答內容本身沿用歷屆試題的作答紀錄（features/exams/attempt.ts，鍵是 practice:{uid}@{version}），
 * 這裡只記練習層級的資料。
 *
 * 「做過」以 uid 判斷、不看版本：改版（@2）通常只是修正錯字或解析，學生已經看過這篇文章了。
 *
 * localStorage 在無痕模式、被封鎖的網站資料或某些內嵌瀏覽器裡會丟例外，讀寫一律包 try/catch：
 * 存不進去仍然可以練習（紀錄留在記憶體），只是重新整理後會忘記做過哪些。
 */
import { useSyncExternalStore } from 'react';
import type { PracticeSectionType, Tier } from '../../data/bank';

export const PRACTICE_HISTORY_KEY = 'gsat-bank-practice:v1';
/** 最多記幾組做過的紀錄；超過時丟掉最早做的（每筆約 100 位元組，500 筆約 50 KB）。 */
export const MAX_DONE = 500;

export interface DoneRecord {
  version: number;
  section: PracticeSectionType;
  tier: Tier;
  /** 交卷時間（ISO 8601）。 */
  at: string;
  correct: number;
  total: number;
  /** 用了提示的題目數（用了提示照樣計分，但不算「第一次就答對」，SPEC §4.2）。 */
  hinted: number;
}

export interface PracticeHistory {
  v: 1;
  /** 做完（交卷）的題組，鍵是 uid。 */
  done: Readonly<Record<string, DoneRecord>>;
  /** 每一格（`${section}/${tier}`）目前在做的題組 `uid@version`：重新整理或離開再回來，接著做同一組。 */
  current: Readonly<Record<string, string>>;
  /** 作答中每一題看過幾層提示：`uid@version` → 題號 → 層數。交卷後保留到換下一組，解析卡要顯示。 */
  hints: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export function emptyHistory(): PracticeHistory {
  return { v: 1, done: {}, current: {}, hints: {} };
}

export function cellKey(section: PracticeSectionType, tier: Tier): string {
  return `${section}/${tier}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 讀回來的資料可能是舊版程式寫的或被使用者改過：逐筆檢查，壞掉的那筆丟掉，不讓整份紀錄作廢。 */
export function parseHistory(raw: unknown): PracticeHistory {
  if (!isRecord(raw) || raw['v'] !== 1) return emptyHistory();
  const done: Record<string, DoneRecord> = {};
  if (isRecord(raw['done'])) {
    for (const [uid, r] of Object.entries(raw['done'])) {
      if (!isRecord(r)) continue;
      const { version, section, tier, at, correct, total, hinted } = r;
      if (!isFiniteNumber(version) || typeof section !== 'string' || typeof tier !== 'string' || typeof at !== 'string') continue;
      if (!isFiniteNumber(correct) || !isFiniteNumber(total)) continue;
      done[uid] = {
        version,
        section: section as PracticeSectionType,
        tier: tier as Tier,
        at,
        correct,
        total,
        hinted: isFiniteNumber(hinted) ? hinted : 0,
      };
    }
  }
  const current: Record<string, string> = {};
  if (isRecord(raw['current'])) {
    for (const [cell, key] of Object.entries(raw['current'])) if (typeof key === 'string') current[cell] = key;
  }
  const hints: Record<string, Record<string, number>> = {};
  if (isRecord(raw['hints'])) {
    for (const [key, perQ] of Object.entries(raw['hints'])) {
      if (!isRecord(perQ)) continue;
      const clean: Record<string, number> = {};
      for (const [label, n] of Object.entries(perQ)) if (isFiniteNumber(n) && n > 0) clean[label] = Math.floor(n);
      hints[key] = clean;
    }
  }
  return { v: 1, done, current, hints };
}

function trimDone(done: Record<string, DoneRecord>): Record<string, DoneRecord> {
  const entries = Object.entries(done);
  if (entries.length <= MAX_DONE) return done;
  entries.sort(([, a], [, b]) => b.at.localeCompare(a.at));
  return Object.fromEntries(entries.slice(0, MAX_DONE));
}

/** 一個題組交卷：記成做過，提示紀錄留著（解析卡要顯示用了幾層）。 */
export function recordDone(h: PracticeHistory, uid: string, record: DoneRecord): PracticeHistory {
  return { ...h, done: trimDone({ ...h.done, [uid]: record }) };
}

export function setCurrent(h: PracticeHistory, cell: string, key: string | null): PracticeHistory {
  if ((h.current[cell] ?? null) === key) return h;
  const current = { ...h.current };
  if (key === null) delete current[cell];
  else current[cell] = key;
  return { ...h, current };
}

/** 看下一層提示。 */
export function revealHint(h: PracticeHistory, key: string, label: string, max: number): PracticeHistory {
  const perQ = h.hints[key] ?? {};
  const used = perQ[label] ?? 0;
  if (used >= max) return h;
  return { ...h, hints: { ...h.hints, [key]: { ...perQ, [label]: used + 1 } } };
}

/** 換下一組時清掉上一組的提示紀錄（做過的紀錄已經記下用了提示的題數）。 */
export function clearHints(h: PracticeHistory, key: string): PracticeHistory {
  if (!(key in h.hints)) return h;
  const hints = { ...h.hints };
  delete hints[key];
  return { ...h, hints };
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export interface HistorySnapshot {
  value: PracticeHistory;
  /** 最近一次寫入是否成功；false 時畫面提示「這個瀏覽器無法儲存練習紀錄」。 */
  persisted: boolean;
}

function readStorage(): PracticeHistory {
  try {
    const text = window.localStorage.getItem(PRACTICE_HISTORY_KEY);
    return text === null ? emptyHistory() : parseHistory(JSON.parse(text));
  } catch {
    return emptyHistory();
  }
}

function writeStorage(value: PracticeHistory): boolean {
  try {
    window.localStorage.setItem(PRACTICE_HISTORY_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let snapshot: HistorySnapshot | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): HistorySnapshot {
  snapshot ??= { value: readStorage(), persisted: true };
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPracticeHistory(): PracticeHistory {
  return getSnapshot().value;
}

/** 改紀錄：算出新值 → 寫 localStorage → 通知訂閱者。值沒變就什麼都不做。 */
export function updatePracticeHistory(fn: (prev: PracticeHistory) => PracticeHistory): void {
  const prev = getSnapshot();
  const next = fn(prev.value);
  if (next === prev.value) return;
  snapshot = { value: next, persisted: writeStorage(next) };
  for (const l of listeners) l();
}

export function usePracticeHistory(): HistorySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 測試用：丟掉記憶體裡的紀錄，下一次使用時重新從 localStorage 讀。 */
export function resetPracticeHistoryForTests(): void {
  snapshot = null;
}
