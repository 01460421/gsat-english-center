/**
 * 學習助手的本機作答紀錄（docs/design/learning-assistant.md §5.4）：localStorage 的 gsat-assist:v1:outcomes。
 *
 * 為什麼另外記：各模組的作答紀錄會被覆蓋或刪掉——題庫練習按「再一組」就清掉逐題作答、歷屆試題每份卷子只有一筆
 * （重新開始就覆蓋）、模考只留最近 30 筆。錯題清單、確認頁與學習報告要的是「每一題做過幾次、對不對」，
 * 所以交卷（或成績單第一次顯示）時多寫一行到這裡；各模組原本的資料格式一律不改。
 *
 *   - 一題一筆（OutcomeEntry，欄位用短名稱省空間）；新到舊，最多 2,000 筆（約 280 KB，估計）。
 *   - 同一題（s、r、l、p 相同）只留最新一筆；first 是「這台裝置第一次作答這一題」（同一題的歷屆試題與真題模考、
 *     題庫練習與自組卷算同一題）。
 *   - 寫入失敗（容量滿）時刪最舊的一半再試一次；localStorage 不能用（無痕模式、封鎖網站資料）時功能照常，只是錯題清單少一些。
 *   - 讀寫都包 try/catch；讀回來逐筆驗證，壞掉的那筆丟掉。跨分頁用 storage 事件同步（同 usePracticeHistory 的寫法）。
 *
 * 這個檔案只放紀錄本身與通用的小工具；各模組怎麼把作答轉成紀錄在 outcomeBuilders.ts。
 */
import { ASSIST_SECTIONS, TIERS, type AnswerValue, type AssistSection, type Tier } from '@gsat/shared';
import { useSyncExternalStore } from 'react';

export const OUTCOMES_KEY = 'gsat-assist:v1:outcomes';
/** 第一次開啟 /assistant 時的補登完成記號（backfill.ts）。 */
export const BACKFILLED_KEY = 'gsat-assist:v1:backfilled';
/** 最多保留幾筆；超過時刪最舊的。 */
export const MAX_OUTCOMES = 2_000;

export type OutcomeSource = 'bank' | 'bank_mock' | 'exam' | 'mock';

export interface OutcomeEntry {
  s: OutcomeSource;
  /** 題組版本 uid@v，或考卷 id。 */
  r: string;
  /** 題組 id（同一組的題一起問）；詞彙題每題自成一組。 */
  g: string;
  /** 題組裡的原始題號。 */
  l: string;
  /** 卷面題號（自組卷）。 */
  d?: string;
  /** 自組卷的 paperId 或模考的 attemptId。 */
  p?: string;
  /** 自組卷交換的那一對原始題號（letterSwaps）。 */
  w?: [string, string];
  sec: AssistSection;
  /** 題庫難度。 */
  t?: Tier;
  /** 技能代碼（記錄當下從題目 tags 與解析算好）。 */
  k: string[];
  /** 對、部分給分、錯（未作答也是 0）。 */
  ok: 1 | 0.5 | 0;
  /** 學生的答案（null＝未作答）。 */
  a: AnswerValue | null;
  /** 選擇題的答案（公開資料）。 */
  key?: AnswerValue;
  /** 填充簡答在裝置上的判分（client_status）。 */
  cs?: 'partial' | 'wrong';
  /** 選到的選項的陷阱代碼（題庫閱讀、混合題）。 */
  c?: string;
  /** 用了幾層提示。 */
  h?: number;
  /** 模考標記過。 */
  m?: 1;
  /** 練習模式先看了答案。 */
  rv?: 1;
  /** 歷屆題的全國答對率（0–1）。 */
  np?: number;
  /** 歷屆題的五等分組答對率（高分組到低分組）。 */
  g5?: number[];
  /** 這台裝置第一次作答這一題。 */
  first: 0 | 1;
  /** 毫秒。 */
  at: number;
}

export type OutcomeInput = Omit<OutcomeEntry, 'first'>;

export interface OutcomeLog {
  v: 1;
  items: OutcomeEntry[];
}

const OUTCOME_SOURCES: readonly string[] = ['bank', 'bank_mock', 'exam', 'mock'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isAnswerValue(v: unknown): v is AnswerValue {
  return isString(v) || (Array.isArray(v) && v.every(isString));
}

/** 一筆紀錄；形狀不對回 null（那一筆丟掉）。 */
export function parseOutcome(raw: unknown): OutcomeEntry | null {
  if (!isRecord(raw)) return null;
  const { s, r, g, l, sec, k, ok, a, first, at } = raw;
  if (!isString(s) || !OUTCOME_SOURCES.includes(s) || !isString(r) || !isString(g) || !isString(l)) return null;
  if (!isString(sec) || !(ASSIST_SECTIONS as readonly string[]).includes(sec)) return null;
  if (!Array.isArray(k) || !k.every(isString)) return null;
  if (ok !== 1 && ok !== 0.5 && ok !== 0) return null;
  if (a !== null && !isAnswerValue(a)) return null;
  if (first !== 0 && first !== 1) return null;
  if (!isFiniteNumber(at)) return null;
  const out: OutcomeEntry = { s: s as OutcomeSource, r, g, l, sec: sec as AssistSection, k, ok, a, first, at };
  if (isString(raw['d'])) out.d = raw['d'];
  if (isString(raw['p'])) out.p = raw['p'];
  const w = raw['w'];
  if (Array.isArray(w) && w.length === 2 && isString(w[0]) && isString(w[1])) out.w = [w[0], w[1]];
  if (isString(raw['t']) && (TIERS as readonly string[]).includes(raw['t'])) out.t = raw['t'] as Tier;
  if (isAnswerValue(raw['key'])) out.key = raw['key'];
  if (raw['cs'] === 'partial' || raw['cs'] === 'wrong') out.cs = raw['cs'];
  if (isString(raw['c'])) out.c = raw['c'];
  if (isFiniteNumber(raw['h']) && raw['h'] > 0) out.h = Math.floor(raw['h']);
  if (raw['m'] === 1) out.m = 1;
  if (raw['rv'] === 1) out.rv = 1;
  if (isFiniteNumber(raw['np'])) out.np = raw['np'];
  const g5 = raw['g5'];
  if (Array.isArray(g5) && g5.length === 5 && g5.every(isFiniteNumber)) out.g5 = g5;
  return out;
}

export function emptyLog(): OutcomeLog {
  return { v: 1, items: [] };
}

export function parseLog(raw: unknown): OutcomeLog {
  if (!isRecord(raw) || raw['v'] !== 1 || !Array.isArray(raw['items'])) return emptyLog();
  return { v: 1, items: raw['items'].map(parseOutcome).filter((e): e is OutcomeEntry => e !== null) };
}

/** 去重用的「同一題」：來源、題組版本或考卷、原始題號、卷子或作答紀錄。 */
export function outcomeKey(e: Pick<OutcomeEntry, 's' | 'r' | 'l' | 'p'>): string {
  return `${e.s}|${e.r}|${e.l}|${e.p ?? ''}`;
}

/**
 * 判斷 first 用的「同一題」：歷屆試題與真題模考是同一份考卷的同一題；題庫練習與自組卷是同一個題組（不分版本）的同一題。
 */
export function questionIdentity(e: Pick<OutcomeEntry, 's' | 'r' | 'l'>): string {
  const official = e.s === 'exam' || e.s === 'mock';
  const base = official ? e.r : (e.r.split('@')[0] ?? e.r);
  return `${official ? 'official' : 'bank'}|${base}|${e.l}`;
}

/**
 * 加入新紀錄（純函式）：first 依「之前有沒有這一題」決定；同一題（outcomeKey）只留最新一筆；新到舊排；超過上限刪最舊的。
 * 同一次加入的幾筆依傳入順序視為先後（同一題在同一批裡出現兩次時，後面那筆不是 first）。
 */
export function addOutcomes(log: OutcomeLog, inputs: readonly OutcomeInput[], max = MAX_OUTCOMES): OutcomeLog {
  if (inputs.length === 0) return log;
  const seen = new Set(log.items.map(questionIdentity));
  const added: OutcomeEntry[] = [];
  for (const input of inputs) {
    const id = questionIdentity(input);
    added.push({ ...input, first: seen.has(id) ? 0 : 1 });
    seen.add(id);
  }
  const replaced = new Set(added.map(outcomeKey));
  // 同一批裡同一題出現兩次時留後面那筆（最新）。
  const dedupedAdded = added.filter((e, i) => added.findIndex((x, j) => j > i && outcomeKey(x) === outcomeKey(e)) === -1);
  const kept = log.items.filter((e) => !replaced.has(outcomeKey(e)));
  const items = [...dedupedAdded, ...kept].sort((a, b) => b.at - a.at).slice(0, max);
  return { v: 1, items };
}

// ───────────────────────── store ─────────────────────────

export interface OutcomesSnapshot {
  value: OutcomeLog;
  /** 最近一次寫入是否成功。 */
  persisted: boolean;
}

function readStorage(): OutcomeLog {
  try {
    const text = window.localStorage.getItem(OUTCOMES_KEY);
    return text === null ? emptyLog() : parseLog(JSON.parse(text));
  } catch {
    return emptyLog();
  }
}

/** 寫入；容量滿時刪最舊的一半再試一次。回傳實際存進去的紀錄（失敗是 null）。 */
function writeStorage(value: OutcomeLog): OutcomeLog | null {
  try {
    window.localStorage.setItem(OUTCOMES_KEY, JSON.stringify(value));
    return value;
  } catch {
    try {
      const half: OutcomeLog = { v: 1, items: value.items.slice(0, Math.floor(value.items.length / 2)) };
      window.localStorage.setItem(OUTCOMES_KEY, JSON.stringify(half));
      return half;
    } catch {
      return null;
    }
  }
}

let snapshot: OutcomesSnapshot | null = null;
const listeners = new Set<() => void>();
let storageListening = false;

function getSnapshot(): OutcomesSnapshot {
  snapshot ??= { value: readStorage(), persisted: true };
  return snapshot;
}

function notify(): void {
  for (const l of listeners) l();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== OUTCOMES_KEY && event.key !== null) return;
  snapshot = { value: readStorage(), persisted: true };
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListening && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    storageListening = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListening) {
      window.removeEventListener('storage', onStorage);
      storageListening = false;
    }
  };
}

export function getOutcomes(): OutcomeLog {
  return getSnapshot().value;
}

/** 加入作答紀錄並寫進 localStorage（寫不進去時留在記憶體，這一頁照常可用）。 */
export function recordOutcomes(inputs: readonly OutcomeInput[]): void {
  if (inputs.length === 0) return;
  // 其他分頁可能剛寫過：先讀最新的再加。
  const fresh = readStorage();
  const base = fresh.items.length > 0 || snapshot === null ? fresh : snapshot.value;
  const next = addOutcomes(base, inputs);
  const written = writeStorage(next);
  snapshot = { value: written ?? next, persisted: written !== null };
  notify();
}

/** 這份卷子或作答紀錄（p）已經寫過了沒（模考、自組卷的成績單第一次顯示時冪等寫入）。 */
export function hasOutcomesFor(source: OutcomeSource, p: string): boolean {
  return getOutcomes().items.some((e) => e.s === source && e.p === p);
}

export function useOutcomes(): OutcomesSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 測試用：丟掉記憶體裡的紀錄，下一次使用時重新從 localStorage 讀。 */
export function resetOutcomesForTests(): void {
  snapshot = null;
}

// ───────────────────────── 小工具 ─────────────────────────

/** 得分率 → ok（全分、部分、0）。 */
export function okFromRatio(earned: number, max: number): 1 | 0.5 | 0 {
  if (max <= 0) return earned > 0 ? 1 : 0;
  if (earned >= max - 1e-9) return 1;
  return earned > 0 ? 0.5 : 0;
}

/** 補登記號：讀、寫（失敗安靜略過）。 */
export function isBackfilled(): boolean {
  try {
    return window.localStorage.getItem(BACKFILLED_KEY) !== null;
  } catch {
    return true;
  }
}

export function markBackfilled(): void {
  try {
    window.localStorage.setItem(BACKFILLED_KEY, new Date().toISOString());
  } catch {
    // 存不進去：下次開啟再補一次（recordOutcomes 依 outcomeKey 去重，不會重複）。
  }
}
