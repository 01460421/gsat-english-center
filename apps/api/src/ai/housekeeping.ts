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
 *      學習助手的任務（docs/design/learning-assistant.md §4.8）不在這條：它們的 ref_id 是 assist_turns／assist_reports 的列，
 *      照提交的條件找不到提交（s.id IS NULL），30 分鐘就會退還「正在處理」的報告。所以 STALE_OPS_SQL 排除學習助手的任務，
 *      另外用對稱的 STALE_ASSIST_OPS_SQL（turn 或報告不存在、指向別的操作、不在進行中；或沒有有效租約而且沒處理過／超過 6 小時）。
 *      作文範文（docs/design/model-essays.md §7.4）同理：ref_id 是 exemplar_sets 的列，STALE_OPS_SQL 的排除清單也包含它，
 *      另外用對稱的 STALE_EXEMPLAR_OPS_SQL。三條各自綁自己的任務清單。
 *   3. 學習助手的到期清理（purgeExpiredAssist，每一步各自吞錯誤）：過期照片（最長 24 小時）、照片到期而沒確認的轉錄文字
 *      （只留統計）、過期案例（最後一次更新後 180 天，每次最多 200 個，CASCADE turn 與照片）、過期報告、過期的共用快取
 *      （每次最多 200 筆）。進行中的案例與報告不刪。
 *   4. 作文範文的到期清理（purgeExpiredExemplars）：最後一次更新後 180 天的 exemplar_sets，每次最多 200 列；進行中的不刪。
 *      共用快取的範文由第 3 步的共用快取清理一起處理。
 *
 * 觸發點（盡量常跑、但不影響回應時間）：
 *   - 每一個 /api/* 請求（housekeeping 中介層，回應之後用 waitUntil 跑；每個 isolate 每分鐘最多一次）
 *   - Queue consumer 的每一批訊息（處理完之後）
 *   - 送出 AI 任務之前（同步回收，卡住的預扣不會讓這次預扣失敗）
 * 這些都是「有人在用」才會跑：整站完全沒有流量時照片會留到下一個請求為止（真正的保證要等 Cron，設計文件 §1.2）。
 */
import { ASSIST_TASKS, EXEMPLAR_TASKS } from '@gsat/shared';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { nowSeconds } from '../time';
import { refundForOp } from './guard';
import { opsEvent } from './ledger';

/** 沒有被 consumer 處理過的預扣，超過這個時間就回收（ARCHITECTURE §3.6）。 */
export const STALE_RESERVE_SECONDS = 30 * 60;
/** 不論處理過幾次，超過這個時間仍是 reserved 就回收（只要沒有有效租約）。 */
export const STALE_RESERVE_HARD_SECONDS = 6 * 3600;
/** 中介層的節流：每個 isolate 每分鐘最多跑一次。 */
export const HOUSEKEEPING_INTERVAL_MS = 60_000;
/** 一次最多回收幾筆（正常情況是 0；積太多就分幾次）。 */
const RECLAIM_BATCH = 20;
/** 學習助手的到期清理每次最多刪幾筆（案例、共用快取；積太多就分幾次）。 */
export const ASSIST_PURGE_BATCH = 200;
/** 作文範文的到期清理每次最多刪幾列。 */
export const EXEMPLAR_PURGE_BATCH = 200;

/** STALE_OPS_SQL 排除的任務（各自有對稱的回收 SQL）：學習助手與作文範文。 */
export const NON_WRITING_TASKS: readonly string[] = [...ASSIST_TASKS, ...EXEMPLAR_TASKS];

/**
 * 寫作批改的卡住預扣（?5：要排除的任務代號，JSON 陣列＝NON_WRITING_TASKS；學習助手由 STALE_ASSIST_OPS_SQL、
 * 作文範文由 STALE_EXEMPLAR_OPS_SQL 處理）。
 */
export const STALE_OPS_SQL = `SELECT o.id, o.user_id, o.task, o.ref_id, o.created_at
  FROM ai_ops o
  LEFT JOIN submissions s ON s.id = o.ref_id AND s.user_id = o.user_id
 WHERE o.status = 'reserved' AND o.created_at < ?1
   AND o.task NOT IN (SELECT value FROM json_each(?5))
   AND (s.id IS NULL
        OR s.op_id IS NOT o.id
        OR s.status NOT IN ('queued', 'grading', 'ocr_queued')
        OR ((s.lease_until IS NULL OR s.lease_until <= ?3) AND (s.tries = 0 OR o.created_at < ?2)))
 ORDER BY o.created_at
 LIMIT ?4`;

/** 學習助手的卡住預扣：條件和提交版本對稱，對象是 assist_turns 或 assist_reports（設計文件 §4.8）。 */
export const STALE_ASSIST_OPS_SQL = `SELECT o.id, o.user_id, o.task, o.ref_id, o.created_at
  FROM ai_ops o
  LEFT JOIN assist_turns   t ON t.id = o.ref_id AND t.user_id = o.user_id
  LEFT JOIN assist_reports r ON r.id = o.ref_id AND r.user_id = o.user_id
 WHERE o.status = 'reserved' AND o.created_at < ?1
   AND o.task IN (SELECT value FROM json_each(?5))
   AND ((t.id IS NULL AND r.id IS NULL)
        OR COALESCE(t.op_id, r.op_id) IS NOT o.id
        OR COALESCE(t.status, r.status) NOT IN ('queued', 'running')
        OR ((COALESCE(t.lease_until, r.lease_until) IS NULL OR COALESCE(t.lease_until, r.lease_until) <= ?3)
            AND (COALESCE(t.tries, r.tries) = 0 OR o.created_at < ?2)))
 ORDER BY o.created_at
 LIMIT ?4`;

/** 作文範文的卡住預扣：條件和提交版本對稱，對象是 exemplar_sets（docs/design/model-essays.md §7.4 第 6 點）。 */
export const STALE_EXEMPLAR_OPS_SQL = `SELECT o.id, o.user_id, o.task, o.ref_id, o.created_at
  FROM ai_ops o
  LEFT JOIN exemplar_sets e ON e.id = o.ref_id AND e.user_id = o.user_id
 WHERE o.status = 'reserved' AND o.created_at < ?1
   AND o.task IN (SELECT value FROM json_each(?5))
   AND (e.id IS NULL
        OR e.op_id IS NOT o.id
        OR e.status NOT IN ('queued', 'running')
        OR ((e.lease_until IS NULL OR e.lease_until <= ?3) AND (e.tries = 0 OR o.created_at < ?2)))
 ORDER BY o.created_at
 LIMIT ?4`;

/**
 * 照片到期時清掉沒確認的轉錄文字（設計文件 §4.8 第 2 步、§4.17）：轉錄 turn 已完成、文字還在（output_json 沒有 stats）、
 * 照片的到期時間（轉錄結算時記在 meta_json.photos_expire_at；沒有時用 turn 建立時間＋24 小時）已過。只留 status、omitted
 * 與統計（meta_json.ocr_stats：區塊數、[[?]] 數）。不看案例狀態：確認時本來就已經清掉（assist/routes.ts），這裡是兜底。
 * 每次最多 ?2 筆。
 */
export const CLEAR_UNCONFIRMED_OCR_SQL = `UPDATE assist_turns
   SET output_json = json_object('status', json_extract(output_json, '$.status'), 'blocks', json('[]'), 'student_answer_seen', '',
                                 'omitted', json(COALESCE(json_extract(output_json, '$.omitted'), '[]')), 'notices', json('[]'),
                                 'stats', json(COALESCE(json_extract(meta_json, '$.ocr_stats'), '{"blocks":0,"unresolved":0}'))),
       updated_at = ?1
 WHERE id IN (SELECT id FROM assist_turns
               WHERE kind = 'ocr' AND status = 'done' AND output_json IS NOT NULL
                 AND json_extract(output_json, '$.stats') IS NULL
                 AND COALESCE(json_extract(meta_json, '$.photos_expire_at'), created_at + 86400) < ?1
               LIMIT ?2)`;

/** 刪除過期的暫存照片（不分使用者）；回傳刪了幾張。 */
export async function purgeExpiredPhotos(db: D1Database, nowMs: number): Promise<number> {
  const res = await db.prepare('DELETE FROM submission_photo_temp WHERE expires_at < ?1').bind(nowSeconds(nowMs)).run();
  return res.meta.changes ?? 0;
}

/** 回收卡住的預扣（寫作批改、學習助手、作文範文三條，各自綁自己的任務清單）；回傳這次真的退還了幾筆。 */
export async function reclaimStaleOps(db: D1Database, nowMs: number): Promise<number> {
  const now = nowSeconds(nowMs);
  type Stale = { id: string; user_id: number | null; task: string; ref_id: string | null; created_at: number };
  const stale = (sql: string, tasks: readonly string[]) =>
    db.prepare(sql).bind(now - STALE_RESERVE_SECONDS, now - STALE_RESERVE_HARD_SECONDS, now, RECLAIM_BATCH, JSON.stringify(tasks)).all<Stale>();
  const writing = await stale(STALE_OPS_SQL, NON_WRITING_TASKS);
  const assist = await stale(STALE_ASSIST_OPS_SQL, ASSIST_TASKS);
  const exemplars = await stale(STALE_EXEMPLAR_OPS_SQL, EXEMPLAR_TASKS);
  let reclaimed = 0;
  for (const op of [...writing.results, ...assist.results, ...exemplars.results]) {
    // 依任務退還：提交改 failed，或學習助手的 turn、報告、作文範文的那一列改 failed（guard.ts 的 refundForOp）；都要求沒有有效租約。
    if (await refundForOp(db, op, 'expired', nowMs, { onlyIfUnleased: true })) {
      reclaimed++;
      await opsEvent(db, 'ai_reserve_reclaimed', 'warn', { op_id: op.id, task: op.task, age_s: now - op.created_at });
      console.log(JSON.stringify({ event: 'ai_reserve_reclaimed', op_id: op.id, task: op.task }));
    }
  }
  return reclaimed;
}

/**
 * 學習助手的到期清理（設計文件 §4.8、§4.17）。每一步各自吞錯誤（一步失敗不影響其他步）；回傳各步刪了幾筆。
 *   1. 過期的題目照片（上傳後 24 小時）。
 *   2. 沒確認的轉錄文字：照片到期（轉錄結算時記下的照片到期時間已過）而學生還沒確認的轉錄 turn，文字清掉、只留統計
 *      （區塊數、[[?]] 數、omitted 種類；assist/ocr.ts 的 CLEAR_UNCONFIRMED_OCR_SQL，每次最多 200 筆）。
 *   3. 過期的案例（最後一次更新後 180 天）：每次最多 200 個，CASCADE turn 與照片；有進行中 turn 的不刪。
 *   4. 過期的報告；進行中的不刪。
 *   5. 過期的共用快取（ai_shared_cache；每次最多 200 筆）。
 */
export async function purgeExpiredAssist(db: D1Database, nowMs: number): Promise<{ photos: number; ocr: number; cases: number; reports: number; cache: number }> {
  const now = nowSeconds(nowMs);
  const out = { photos: 0, ocr: 0, cases: 0, reports: 0, cache: 0 };
  const step = async (name: keyof typeof out, label: string, statement: D1PreparedStatement) => {
    try {
      out[name] = (await statement.run()).meta.changes ?? 0;
    } catch (err) {
      console.error(`學習助手的到期清理失敗：${label}`, err);
    }
  };
  await step('photos', '照片', db.prepare('DELETE FROM assist_photos WHERE expires_at < ?1').bind(now));
  await step('ocr', '沒確認的轉錄文字', db.prepare(CLEAR_UNCONFIRMED_OCR_SQL).bind(now, ASSIST_PURGE_BATCH));
  await step(
    'cases',
    '案例',
    db
      .prepare(
        `DELETE FROM assist_cases WHERE id IN (
           SELECT c.id FROM assist_cases c
            WHERE c.expires_at < ?1
              AND NOT EXISTS (SELECT 1 FROM assist_turns t WHERE t.case_id = c.id AND t.status IN ('queued', 'running'))
            LIMIT ?2)`,
      )
      .bind(now, ASSIST_PURGE_BATCH),
  );
  await step('reports', '報告', db.prepare(`DELETE FROM assist_reports WHERE expires_at < ?1 AND status NOT IN ('queued', 'running')`).bind(now));
  await step(
    'cache',
    '共用快取',
    db.prepare('DELETE FROM ai_shared_cache WHERE rowid IN (SELECT rowid FROM ai_shared_cache WHERE expires_at < ?1 LIMIT ?2)').bind(now, ASSIST_PURGE_BATCH),
  );
  return out;
}

/**
 * 作文範文的到期清理（docs/design/model-essays.md §6.2）：最後一次更新後 180 天（expires_at）的組，每次最多 200 列；
 * 進行中的不刪（等結算或回收）。錯誤只記 log；回傳刪了幾列。
 */
export async function purgeExpiredExemplars(db: D1Database, nowMs: number): Promise<number> {
  try {
    const res = await db
      .prepare(
        `DELETE FROM exemplar_sets WHERE id IN (
           SELECT id FROM exemplar_sets WHERE expires_at < ?1 AND status NOT IN ('queued', 'running') LIMIT ?2)`,
      )
      .bind(nowSeconds(nowMs), EXEMPLAR_PURGE_BATCH)
      .run();
    return res.meta.changes ?? 0;
  } catch (err) {
    console.error('作文範文的到期清理失敗', err);
    return 0;
  }
}

/** 四件事都跑；任何錯誤只記 log，不影響呼叫端。 */
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
  await purgeExpiredAssist(db, nowMs);
  await purgeExpiredExemplars(db, nowMs);
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
