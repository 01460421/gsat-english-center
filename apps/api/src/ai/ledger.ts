/**
 * 帳本與事件：ai_calls（每次 Anthropic 呼叫一列）、ops_events（告警）、ai_safety_events（安全事件）。
 * 負責：後端 AI A2。
 *
 * 只存數字與代碼（ARCHITECTURE §6.5、§8）：不存提示詞、回應內容、學生文字、email；
 * 使用者以 HMAC(users.id, LEDGER_SALT) 表示（src/auth/crypto.ts 的 userRef，和 deletion_log 用同一支）。
 * LEDGER_SALT 沒設定時 user_ref 記 NULL（絕不退回存原始 id）。
 */
import { userRef } from '../auth/crypto';
import type { CallRecord } from './client';

/** 使用者的 HMAC 假名；沒有鹽或沒有使用者時回 null。 */
export async function userRefFor(salt: string | null, userId: number | null): Promise<string | null> {
  if (!salt || userId === null) return null;
  return userRef(salt, userId);
}

/** 寫一列 ai_calls，回傳它的 id（gradings.call_id 用）。 */
export async function recordCall(db: D1Database, opId: string, record: CallRecord, ref: string | null, twDay: string): Promise<number | null> {
  const res = await db
    .prepare(
      `INSERT INTO ai_calls
         (op_id, channel, workspace, task, role, model, served_model, effort, prompt_version, pricing_version, request_id,
          stop_reason, refusal_category, iterations, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens,
          cache_write_1h_tokens, images, cost_micros, price_pending, latency_ms, error_code, user_ref, tw_day)
       VALUES (?1, 'online', 'online', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)`,
    )
    .bind(
      opId,
      record.task,
      record.role,
      record.model,
      record.servedModel,
      record.effort,
      record.promptVersion,
      record.pricingVersion,
      record.requestId,
      record.stopReason,
      record.refusalCategory,
      record.iterations,
      record.inputTokens,
      record.outputTokens,
      record.cacheReadTokens,
      record.cacheWrite5mTokens,
      record.cacheWrite1hTokens,
      record.images,
      record.costMicros,
      record.pricePending ? 1 : 0,
      record.latencyMs,
      record.errorCode,
      ref,
      twDay,
    )
    .run();
  return typeof res.meta.last_row_id === 'number' ? res.meta.last_row_id : null;
}

/** 告警事件（detail 只放 id 與代碼，不放學生內容）。 */
export function opsEventStatement(db: D1Database, kind: string, severity: 'info' | 'warn' | 'error', detail: Record<string, unknown>): D1PreparedStatement {
  return db.prepare('INSERT INTO ops_events (kind, severity, detail_json) VALUES (?1, ?2, ?3)').bind(kind, severity, JSON.stringify(detail).slice(0, 4000));
}

export async function opsEvent(db: D1Database, kind: string, severity: 'info' | 'warn' | 'error', detail: Record<string, unknown>): Promise<void> {
  try {
    await opsEventStatement(db, kind, severity, detail).run();
  } catch (err) {
    // 告警寫不進去不能讓任務本身失敗；只記 log（不含內容）。
    console.error('寫入 ops_events 失敗', kind, err);
  }
}

export type SafetyKind = 'output_filtered' | 'student_report' | 'wellbeing_flag' | 'injection_flag' | 'refusal';

export function safetyEventStatement(db: D1Database, opId: string | null, kind: SafetyKind, category: string | null, ref: string | null): D1PreparedStatement {
  return db.prepare('INSERT INTO ai_safety_events (op_id, kind, category, user_ref) VALUES (?1, ?2, ?3, ?4)').bind(opId, kind, category, ref);
}
