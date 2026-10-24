/**
 * 作文範文的內容失敗次數（docs/design/model-essays.md §3.6）：一個操作最多付費產生 2 次內容失敗的結果，**跨 Queue 投遞累計**。
 *
 * 為什麼：callWithPolicy 只有在「已用時間＋這次呼叫的總期限 ≤ 牆鐘預算」時才在同一次投遞裡重試（範文的第一次呼叫要在
 * 120 秒內結束），否則回 retryable: true、交回 Queue，下一次投遞又從第 0 次算起；照原樣，截斷、格式不符、語意檢查不過
 * 都要付費到 QUEUE_MAX_DELIVERIES（4 次投遞、最多 4–5 次呼叫）才退還。
 *
 * 內容失敗＝ai_calls 裡 stop_reason='max_tokens' 或 error_code 是 schema_mismatch／invalid_json／unexpected_stop 的呼叫
 * （client.ts 的 executeClaudeCall），加上 exemplar_sets.content_failures（語意檢查不通過不會在 ai_calls 留下錯誤代碼，
 * consumer 在 onSuccess 回傳字串之前先用 bumpContentFailureStatement 加 1）。兩者不重複：語意失敗的呼叫在 ai_calls 是正常結束。
 * consumer 在呼叫之前算 exemplarContentFailures，傳 callWithPolicy({ contentAttempts: remainingContentAttempts(n) })；
 * 還剩 0 次就不呼叫、直接退還。API 錯誤、逾時、429 不算內容失敗（照既有規則最多 4 次投遞）。
 */
import { EXEMPLAR_LIMITS } from '@gsat/shared';

/** ai_calls 裡算內容失敗的錯誤代碼（client.ts 的 executeClaudeCall 寫的）。 */
export const CONTENT_FAILURE_ERROR_CODES = ['schema_mismatch', 'invalid_json', 'unexpected_stop'] as const;

/**
 * 這個操作已有的內容失敗次數（§3.6 的 SQL）：?1 op_id ?2 exemplar_sets.id ?3 user_id。
 * 列不存在（帳號已刪）時只算 ai_calls 的部分。
 */
export const CONTENT_FAILURES_SQL = `SELECT
    (SELECT COUNT(*) FROM ai_calls WHERE op_id = ?1
       AND (stop_reason = 'max_tokens' OR error_code IN ('schema_mismatch', 'invalid_json', 'unexpected_stop')))
  + COALESCE((SELECT content_failures FROM exemplar_sets WHERE id = ?2 AND user_id = ?3 AND op_id = ?1), 0) AS n`;

/** 讀這個操作已有的內容失敗次數。 */
export async function exemplarContentFailures(db: D1Database, ref: { opId: string; setId: string; userId: number }): Promise<number> {
  const row = await db.prepare(CONTENT_FAILURES_SQL).bind(ref.opId, ref.setId, ref.userId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** 還能付費產生幾次（0＝不再呼叫、直接退還；1＝這次的內容失敗就退還；2＝既有規則）。 */
export function remainingContentAttempts(failures: number): number {
  return Math.max(0, EXEMPLAR_LIMITS.contentAttempts - Math.max(0, Math.floor(failures)));
}

/**
 * 語意檢查不通過時加 1（onSuccess 回傳字串之前執行；上限 4，同遷移 0005 的 CHECK）。只改還指向這個操作、還在進行中的那一列。
 */
export function bumpContentFailureStatement(db: D1Database, ref: { opId: string; setId: string; userId: number }): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE exemplar_sets SET content_failures = MIN(content_failures + 1, 4)
        WHERE id = ?1 AND user_id = ?2 AND op_id = ?3 AND status IN ('queued', 'running')`,
    )
    .bind(ref.setId, ref.userId, ref.opId);
}
