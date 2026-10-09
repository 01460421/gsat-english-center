/**
 * AI 核准名額（ARCHITECTURE §6.6）與「是否允許新的核准」（§6.3 第 4 條）。負責：後端登入 A1。
 * /api/ai/apply（排候補）、/api/admin/users（核准）、/api/admin/health 共用；A2 的 /api/ai/quota 也可以直接呼叫
 * approvalSummary()，名額的算法只有這一份。
 *
 * 名額只算學生：管理員（站主）不受點數限制，他的測試用量由站主調整 AI_APPROVAL_CAP 時自行扣掉（§6.6）。
 * 停權中的帳號仍佔名額（解除停權後立刻能用 AI，預算要先留著）；刪除中的不算。
 */
import { loadConfig, startupChecks, type AppConfig } from '../config';
import type { Env } from '../env';

/** 「已核准的學生」條件（SQL 片段，常數）。 */
export const APPROVED_STUDENT_SQL = "ai_status = 'approved' AND role = 'student' AND status <> 'deleting'";

/** 目前已核准的學生人數。 */
export async function countApprovedStudents(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${APPROVED_STUDENT_SQL}`).first<{ n: number }>();
  return row?.n ?? 0;
}

/** §6.3：error 級的啟動檢查全部通過才允許新的 AI 核准。 */
export function approvalsAllowed(config: AppConfig): boolean {
  return startupChecks(config).every((check) => check.ok || check.severity !== 'error');
}

/** 名額摘要（AiQuotaResponse.approval、AdminUsersResponse.approval 的形狀）。 */
export async function approvalSummary(env: Env, config: AppConfig = loadConfig(env)): Promise<{ cap: number; approved: number; full: boolean }> {
  const approved = await countApprovedStudents(env.DB);
  const cap = config.ai.approvalCap;
  return { cap, approved, full: approved >= cap };
}
