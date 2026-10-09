/**
 * 不靠 Cron 的維護工作（MVP 沒有 scheduled，設計文件 §1.2）。負責：後端 AI A2。
 *
 *   1. 刪除過期的暫存照片（設計文件 §4、遷移 0002：照片最長 24 小時）
 *   2. 回收卡住的預扣（ARCHITECTURE §3.6「30 分鐘以上仍 reserved 的預扣 → 退還」）：預扣成立後、排入 Queue 前
 *      isolate 被終止，或死信佇列的處理也失敗時，ai_ops 會一直是 reserved——佔住這位學生的同時任務名額，
 *      它的 usd_reserved_micros 也每天都算進全站預算。回收條件（都要「建立超過 30 分鐘、仍是 reserved」）：
 *        - 提交不存在（帳號或提交已刪）、提交指向別的操作、或提交已不在進行中的狀態；
 *        - 提交在進行中但 consumer 從來沒處理過（tries = 0）、而且沒有有效租約——訊息沒送出去或排隊太久；
 *        - 建立超過 6 小時（比一則訊息在 Queue 裡最長的壽命還長：補第三位前後各 4 次投遞 × 15 分鐘）而且沒有有效租約。
 *      回收＝退還（refund_reason='expired'，前端顯示「排隊太久已取消」）、提交改 failed（可以再送一次）、寫 ops_events。
 *      退還的 UPDATE 另外要求「提交沒有有效租約」，consumer 搶租約時要求「操作仍是 reserved」，兩邊不會同時成立。
 *
 * 觸發點（盡量常跑、但不影響回應時間）：
 *   - 每一個 /api/* 請求（housekeeping 中介層，回應之後用 waitUntil 跑；每個 isolate 每分鐘最多一次）
 *   - Queue consumer 的每一批訊息（處理完之後）
 *   - 送出 AI 任務之前（同步回收，卡住的預扣不會讓這次預扣失敗）
 * 這些都是「有人在用」才會跑：整站完全沒有流量時照片會留到下一個請求為止（真正的保證要等 Cron，設計文件 §1.2）。
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { nowSeconds } from '../time';
import { refundWithSubmission } from './guard';
import { opsEvent } from './ledger';

/** 沒有被 consumer 處理過的預扣，超過這個時間就回收（ARCHITECTURE §3.6）。 */
export const STALE_RESERVE_SECONDS = 30 * 60;
/** 不論處理過幾次，超過這個時間仍是 reserved 就回收（只要沒有有效租約）。 */
export const STALE_RESERVE_HARD_SECONDS = 6 * 3600;
/** 中介層的節流：每個 isolate 每分鐘最多跑一次。 */
export const HOUSEKEEPING_INTERVAL_MS = 60_000;
/** 一次最多回收幾筆（正常情況是 0；積太多就分幾次）。 */
const RECLAIM_BATCH = 20;

const STALE_OPS_SQL = `SELECT o.id, o.user_id, o.task, o.ref_id, o.created_at
  FROM ai_ops o
  LEFT JOIN submissions s ON s.id = o.ref_id AND s.user_id = o.user_id
 WHERE o.status = 'reserved' AND o.created_at < ?1
   AND (s.id IS NULL
        OR s.op_id IS NOT o.id
        OR s.status NOT IN ('queued', 'grading', 'ocr_queued')
        OR ((s.lease_until IS NULL OR s.lease_until <= ?3) AND (s.tries = 0 OR o.created_at < ?2)))
 ORDER BY o.created_at
 LIMIT ?4`;

/** 刪除過期的暫存照片（不分使用者）；回傳刪了幾張。 */
export async function purgeExpiredPhotos(db: D1Database, nowMs: number): Promise<number> {
  const res = await db.prepare('DELETE FROM submission_photo_temp WHERE expires_at < ?1').bind(nowSeconds(nowMs)).run();
  return res.meta.changes ?? 0;
}

/** 回收卡住的預扣；回傳這次真的退還了幾筆。 */
export async function reclaimStaleOps(db: D1Database, nowMs: number): Promise<number> {
  const now = nowSeconds(nowMs);
  const stale = await db
    .prepare(STALE_OPS_SQL)
    .bind(now - STALE_RESERVE_SECONDS, now - STALE_RESERVE_HARD_SECONDS, now, RECLAIM_BATCH)
    .all<{ id: string; user_id: number | null; task: string; ref_id: string | null; created_at: number }>();
  let reclaimed = 0;
  for (const op of stale.results) {
    if (await refundWithSubmission(db, op, 'expired', nowMs, { onlyIfUnleased: true })) {
      reclaimed++;
      await opsEvent(db, 'ai_reserve_reclaimed', 'warn', { op_id: op.id, task: op.task, age_s: now - op.created_at });
      console.log(JSON.stringify({ event: 'ai_reserve_reclaimed', op_id: op.id, task: op.task }));
    }
  }
  return reclaimed;
}

/** 兩件事都跑；任何錯誤只記 log，不影響呼叫端。 */
export async function runHousekeeping(db: D1Database, nowMs: number): Promise<void> {
  try {
    await purgeExpiredPhotos(db, nowMs);
  } catch (err) {
    console.error('清除過期照片失敗', err);
  }
  try {
    await reclaimStaleOps(db, nowMs);
  } catch (err) {
    console.error('回收卡住的預扣失敗', err);
  }
}

let lastRunAt = 0;

/**
 * /api/* 的中介層：回應之後用 waitUntil 跑 runHousekeeping（每個 isolate 每分鐘最多一次）。
 * 沒有 ExecutionContext（單元測試的 app.request 沒帶）或沒有 DB 綁定時什麼都不做。
 */
export const housekeeping: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const db = c.env?.DB;
  if (!db) return;
  const nowMs = Date.now();
  if (nowMs - lastRunAt < HOUSEKEEPING_INTERVAL_MS) return;
  let waitUntil: (promise: Promise<unknown>) => void;
  try {
    const ctx = c.executionCtx;
    waitUntil = ctx.waitUntil.bind(ctx);
  } catch {
    return;
  }
  lastRunAt = nowMs;
  waitUntil(runHousekeeping(db, nowMs));
};
