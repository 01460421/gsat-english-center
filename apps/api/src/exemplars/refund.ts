/**
 * 作文範文的退還（docs/design/model-essays.md §3.6、§7.4）：退還點數並把 exemplar_sets 的那一列標成 failed、寫退還原因、
 * 放掉租約。consumer 的失敗結算、死信佇列、回收卡住的預扣（onlyIfUnleased）共用這一支（guard.ts 的 refundForOp 依任務分流到這裡）。
 *
 * 全部語句都以這次的 settle_token 為條件，Queue 重送或回收重跑都不會重複；只改還指向這個操作、還在進行中的那一列
 * （已完成或已失敗的不動）。帳號已刪（列已隨 CASCADE 消失）時只退還點數。
 * 退還會更新 updated_at，保存期限跟著重算（最後一次更新後 180 天）。
 */
import { EXEMPLAR_LIMITS } from '@gsat/shared';
import { refundOp, type OpRef } from '../ai/guard';
import { nowSeconds } from '../time';

/** 保存期限：最後一次更新後 180 天（exemplar_sets.expires_at）。 */
export const EXEMPLAR_RETENTION_SECONDS = EXEMPLAR_LIMITS.retentionDays * 86_400;

/**
 * 退還並把作文範文的那一列標成 failed（見檔頭）。回傳這次是否真的退還（false＝已經結算或退還過，或回收時還有有效租約）。
 * metaJson：consumer 要一起寫的 meta_json（自訂題不是寫作題時的 not_writing_task；由 repo.ts 的 buildExemplarMeta 組好）。
 */
export async function refundWithExemplarSet(
  db: D1Database,
  op: OpRef,
  reason: string,
  nowMs: number,
  options: { onlyIfUnleased?: boolean; metaJson?: string } = {},
): Promise<boolean> {
  const now = nowSeconds(nowMs);
  return refundOp(db, {
    opId: op.id,
    reason,
    nowMs,
    ...(options.onlyIfUnleased ? { onlyIfUnleased: true } : {}),
    extra: (token) => {
      if (op.user_id === null || op.ref_id === null) return [];
      return [
        db
          .prepare(
            `UPDATE exemplar_sets SET status = 'failed', failure = ?1, lease_until = NULL, updated_at = ?2, expires_at = ?3,
                    meta_json = COALESCE(?8, meta_json)
              WHERE id = ?4 AND user_id = ?5 AND op_id = ?6 AND status IN ('queued', 'running')
                AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?6 AND settle_token = ?7)`,
          )
          .bind(reason, now, now + EXEMPLAR_RETENTION_SECONDS, op.ref_id, op.user_id, op.id, token, options.metaJson ?? null),
      ];
    },
  });
}
