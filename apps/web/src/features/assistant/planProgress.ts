/**
 * 學習報告的計畫進度（docs/design/learning-assistant.md §1.8 第 4–5 步、§3.4、§5.5 的 plan_progress）。負責：WP-C。
 *
 *   勾選：逐週清單的每一項可以勾「做完了」，存在本機 localStorage 的 gsat-assist:v1:plan:{reportId}（{ v: 1, done: 項目 id[] }）。
 *         讀寫都包 try/catch；存不進去時這一頁照常可以勾（留在記憶體），重新整理後才會不見。跨分頁用 storage 事件同步
 *         （同 usePracticeHistory 的 useSyncExternalStore 寫法）。
 *   進度：產生下一版時，前端把「上一版的推薦做了沒、做得如何」與「勾選完成數（依項目種類）」放進摘要的 plan_progress；
 *         推薦的作答只看本機作答紀錄裡上一版產生之後的首次接觸（寫作題庫的推薦在伺服器，這裡記成沒做）。
 */
import type { AssistHistorySummary, AssistPlanKind, AssistPlanWeek, AssistReportDetail } from '@gsat/shared';
import { useCallback, useSyncExternalStore } from 'react';
import type { OutcomeEntry } from './outcomes';

export const PLAN_KEY_PREFIX = 'gsat-assist:v1:plan:';

export function planKey(reportId: string): string {
  return `${PLAN_KEY_PREFIX}${reportId}`;
}

/** 一份報告的勾選（項目 id 的集合；id 是 w{週次}-{序號}，長期菜單是 w0-{序號}）。 */
export type PlanChecks = ReadonlySet<string>;

const ITEM_ID = /^w\d{1,3}-\d{1,2}$/;
const EMPTY: PlanChecks = new Set();

export function parsePlanChecks(raw: unknown): PlanChecks {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY;
  const r = raw as Record<string, unknown>;
  if (r['v'] !== 1 || !Array.isArray(r['done'])) return EMPTY;
  return new Set(r['done'].filter((x): x is string => typeof x === 'string' && ITEM_ID.test(x)).slice(0, 500));
}

export function readPlanChecks(reportId: string): PlanChecks {
  try {
    const text = window.localStorage.getItem(planKey(reportId));
    return text === null ? EMPTY : parsePlanChecks(JSON.parse(text));
  } catch {
    return EMPTY;
  }
}

// ───────────────────────── store（每份報告一份快照） ─────────────────────────

const snapshots = new Map<string, PlanChecks>();
const listeners = new Map<string, Set<() => void>>();
let storageListening = false;

function snapshotOf(reportId: string): PlanChecks {
  let s = snapshots.get(reportId);
  if (!s) {
    s = readPlanChecks(reportId);
    snapshots.set(reportId, s);
  }
  return s;
}

function notify(reportId: string): void {
  for (const l of listeners.get(reportId) ?? []) l();
}

function onStorage(event: StorageEvent): void {
  if (event.key === null) {
    for (const id of [...snapshots.keys()]) {
      snapshots.set(id, readPlanChecks(id));
      notify(id);
    }
    return;
  }
  if (!event.key.startsWith(PLAN_KEY_PREFIX)) return;
  const id = event.key.slice(PLAN_KEY_PREFIX.length);
  if (!snapshots.has(id)) return;
  snapshots.set(id, readPlanChecks(id));
  notify(id);
}

function subscribe(reportId: string, listener: () => void): () => void {
  const set = listeners.get(reportId) ?? new Set();
  set.add(listener);
  listeners.set(reportId, set);
  if (!storageListening && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    storageListening = true;
  }
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(reportId);
    if (listeners.size === 0 && storageListening) {
      window.removeEventListener('storage', onStorage);
      storageListening = false;
    }
  };
}

/** 勾選或取消一項；回傳有沒有存進 localStorage（存不進去時這一頁照常顯示勾選）。 */
export function setPlanItemDone(reportId: string, itemId: string, done: boolean): boolean {
  if (!ITEM_ID.test(itemId)) return false;
  // 其他分頁可能剛改過：先讀最新的再改。
  const base = new Set(readPlanChecks(reportId));
  for (const id of snapshotOf(reportId)) base.add(id);
  if (done) base.add(itemId);
  else base.delete(itemId);
  snapshots.set(reportId, base);
  notify(reportId);
  try {
    window.localStorage.setItem(planKey(reportId), JSON.stringify({ v: 1, done: [...base].sort() }));
    return true;
  } catch {
    return false;
  }
}

export function usePlanChecks(reportId: string): { done: PlanChecks; toggle: (itemId: string, done: boolean) => void } {
  const sub = useCallback((l: () => void) => subscribe(reportId, l), [reportId]);
  const get = useCallback(() => snapshotOf(reportId), [reportId]);
  const done = useSyncExternalStore(sub, get);
  const toggle = useCallback((itemId: string, value: boolean) => void setPlanItemDone(reportId, itemId, value), [reportId]);
  return { done, toggle };
}

/** 測試用：丟掉記憶體裡的快照。 */
export function resetPlanChecksForTests(): void {
  snapshots.clear();
}

// ───────────────────────── 進度 ─────────────────────────

/** 一週完成幾項（畫面：「預計 180 分鐘、已完成 3／5 項」）。 */
export function weekProgress(week: Pick<AssistPlanWeek, 'items'>, done: PlanChecks): { done: number; total: number } {
  return { done: week.items.filter((i) => done.has(i.id)).length, total: week.items.length };
}

/**
 * 勾選完成數，依項目種類：只算已經開始的週（週的第一天 ≤ 今天）與長期菜單；還沒到的週不算進分母。
 */
export function checklistProgress(detail: Pick<AssistReportDetail, 'report'>, done: PlanChecks, todayTw: string): Array<{ kind: AssistPlanKind; done: number; total: number }> {
  const plan = detail.report?.plan;
  if (!plan) return [];
  const weeks = [...(plan.long_term ? [plan.long_term] : []), ...plan.weeks.filter((w) => w.start <= todayTw)];
  const byKind = new Map<AssistPlanKind, { done: number; total: number }>();
  for (const w of weeks) {
    for (const item of w.items) {
      const cur = byKind.get(item.kind) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (done.has(item.id)) cur.done += 1;
      byKind.set(item.kind, cur);
    }
  }
  return [...byKind].map(([kind, v]) => ({ kind, ...v }));
}

/**
 * 上一版每一項推薦：之後有沒有做、首次接觸的答對數。題組 ref（uid@v）看題庫練習與自組卷的作答紀錄（r 相同），
 * 整份歷屆卷（exam:id）看歷屆試題與真題模考；寫作題庫（wt:、we:）不在本機紀錄裡，記成沒做（伺服器知道有沒有送批改）。
 */
export function recsProgress(refs: readonly string[], outcomes: readonly OutcomeEntry[], sinceMs: number): Array<{ ref: string; attempted: boolean; first_n: number; first_correct: number }> {
  return refs.map((ref) => {
    let match: (e: OutcomeEntry) => boolean;
    if (ref.startsWith('exam:')) {
      const id = ref.slice(5);
      match = (e) => (e.s === 'exam' || e.s === 'mock') && e.r === id;
    } else if (ref.startsWith('wt:') || ref.startsWith('we:')) {
      match = () => false;
    } else {
      match = (e) => (e.s === 'bank' || e.s === 'bank_mock') && e.r === ref;
    }
    const hits = outcomes.filter((e) => e.at >= sinceMs && match(e));
    const first = hits.filter((e) => e.first === 1);
    return { ref, attempted: hits.length > 0, first_n: first.length, first_correct: first.filter((e) => e.ok === 1).length };
  });
}

/** 摘要的 plan_progress（產生下一版時；previous 是「依這版產生」的那一版）。 */
export function planProgressFor(previous: AssistReportDetail | null, outcomes: readonly OutcomeEntry[], done: PlanChecks, todayTw: string): AssistHistorySummary['plan_progress'] {
  if (!previous || previous.status !== 'done' || !previous.report) return null;
  const sinceMs = previous.created_at * 1000;
  return {
    report_id: previous.id,
    since: new Date(sinceMs).toISOString(),
    recs: recsProgress(
      previous.report.recommendations.map((r) => r.ref),
      outcomes,
      sinceMs,
    ).slice(0, 12),
    checklist: checklistProgress(previous, done, todayTw),
  };
}
