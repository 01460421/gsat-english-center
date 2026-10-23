/**
 * 學習助手任務的退還（docs/design/learning-assistant.md §4.8）：退還點數並把 turn 或報告標成 failed、放掉租約，
 * 案例一起回到能再試的狀態。consumer 的失敗結算、死信佇列、回收卡住的預扣（onlyIfUnleased）共用這一支
 * （guard.ts 的 refundForOp 依任務分流到這裡，寫作批改照舊 refundWithSubmission）。
 *
 * 全部語句都以這次的 settle_token 為條件，Queue 重送或回收重跑都不會重複：
 *   - turn 或報告：status='failed'、failure=退還原因、lease_until=NULL（只改還指向這個操作、還在進行中的那一列）；
 *   - 解析：案例從 analyzing 回到 analyzed（之前有成功的解析）或 failed（從來沒有）；
 *   - 轉錄：案例從 ocr_queued 回到 draft；內容造成的退還（拒答、看不出是英文題目、截斷）同時刪照片（要重拍），
 *     系統原因（API 錯誤、逾時、暫停…）保留照片到 24 小時到期，可以直接再試；
 *   - 追問：案例不變（追問不改案例狀態）。
 * 帳號已刪（列已隨 CASCADE 消失）時只退還點數。
 */
import { ASSIST_LIMITS } from '@gsat/shared';
import { COUNTED_REFUND_REASONS, refundOp, type OpRef } from '../ai/guard';
import { nowSeconds } from '../time';

/** 案例的保存期限：最後一次更新後 180 天（assist_cases.expires_at）。 */
export const ASSIST_RETENTION_SECONDS = ASSIST_LIMITS.retentionDays * 86_400;

/** 退還並把學習助手的 turn 或報告標成 failed（見檔頭）。回傳這次是否真的退還（false＝已經結算或退還過）。 */
export async function refundWithAssistRef(db: D1Database, op: OpRef, reason: string, nowMs: number, options: { onlyIfUnleased?: boolean } = {}): Promise<boolean> {
  const now = nowSeconds(nowMs);
  return refundOp(db, {
    opId: op.id,
    reason,
    nowMs,
    ...(options.onlyIfUnleased ? { onlyIfUnleased: true } : {}),
    extra: (token) => {
      if (op.user_id === null || op.ref_id === null) return [];
      if (op.task === 'assist_report') {
        return [
          db
            .prepare(
              `UPDATE assist_reports SET status = 'failed', failure = ?1, lease_until = NULL, updated_at = ?2
                WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status IN ('queued', 'running')
                  AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND settle_token = ?6)`,
            )
            .bind(reason, now, op.ref_id, op.user_id, op.id, token),
        ];
      }
      const statements = [
        db
          .prepare(
            `UPDATE assist_turns SET status = 'failed', failure = ?1, lease_until = NULL, updated_at = ?2
              WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status IN ('queued', 'running')
                AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND settle_token = ?6)`,
          )
          .bind(reason, now, op.ref_id, op.user_id, op.id, token),
      ];
      /** 這個 turn 所屬的案例（只認同一個使用者的；turn 被刪就是 NULL，下面的語句都不會改到任何列）。 */
      const caseOf = `(SELECT case_id FROM assist_turns WHERE id = ?3 AND user_id = ?4)`;
      if (op.task === 'assist_analyze') {
        statements.push(
          db
            .prepare(
              `UPDATE assist_cases SET status = CASE WHEN analyses > 0 THEN 'analyzed' ELSE 'failed' END, updated_at = ?1, expires_at = ?2
                WHERE id = ${caseOf} AND user_id = ?4 AND status = 'analyzing'
                  AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND settle_token = ?6)`,
            )
            .bind(now, now + ASSIST_RETENTION_SECONDS, op.ref_id, op.user_id, op.id, token),
        );
      } else if (op.task === 'assist_ocr') {
        statements.push(
          db
            .prepare(
              `UPDATE assist_cases SET status = 'draft', updated_at = ?1, expires_at = ?2
                WHERE id = ${caseOf} AND user_id = ?4 AND status = 'ocr_queued'
                  AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND settle_token = ?6)`,
            )
            .bind(now, now + ASSIST_RETENTION_SECONDS, op.ref_id, op.user_id, op.id, token),
        );
        if ((COUNTED_REFUND_REASONS as readonly string[]).includes(reason)) {
          statements.push(
            db
              .prepare(
                `DELETE FROM assist_photos WHERE case_id = (SELECT case_id FROM assist_turns WHERE id = ?1 AND user_id = ?2) AND user_id = ?2
                   AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`,
              )
              .bind(op.ref_id, op.user_id, op.id, token),
          );
        }
      }
      return statements;
    },
  });
}
