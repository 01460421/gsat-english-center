/**
 * 後台的使用者列表與核准動作（ARCHITECTURE §5「管理員」、§7「後台越權」、§10.5；SPEC §9「使用者」）。負責：後端登入 A1。
 *
 * 列表只回帳號與申請資料，不碰任何學習內容（提交、批改、作答）。ai_apply_note 是學生寫的文字，前端要當純文字顯示並標示不可信。
 *
 * 動作（ADMIN_USER_ACTIONS 的註解有完整規則）：每一個會改變狀態的動作都在同一個 db.batch()（交易）裡
 * 先寫 admin_audit、再 UPDATE，兩句用同一個條件（常數 SQL），條件不成立時兩句都不生效；稽核只記狀態的前後值，不記學生內容。
 * 狀態已經是目標值時不寫入、直接回傳（冪等）。
 */
import { AI_STATUSES, type AdminUserAction, type AiStatus } from '@gsat/shared';
import type { AppConfig } from '../config';
import { ApiError } from '../errors';
import { nowSeconds } from '../time';
import { USER_COLUMNS, type SessionUser, type UserRow } from '../auth/session';
import { APPROVED_STUDENT_SQL, approvalsAllowed, countApprovedStudents } from '../account/approval';
import { loadUserByPublicId } from '../account/users';

/** 每頁筆數。 */
export const ADMIN_USERS_PAGE_SIZE = 50;

/** public_id 是 crypto.randomUUID()；格式不對直接 404，不查資料庫。 */
export const PUBLIC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isAiStatus(value: unknown): value is AiStatus {
  return (AI_STATUSES as readonly unknown[]).includes(value);
}

/**
 * 列表：依 users.id 由新到舊。cursor 是上一頁最後一位的 public_id（不外露內部整數 id）。
 * ai_status 篩選（例如 pending 就是申請佇列）。
 */
export async function listUsers(
  db: D1Database,
  filter: { aiStatus: AiStatus | null; cursor: string | null },
): Promise<{ rows: UserRow[]; nextCursor: string | null }> {
  const { results } = await db
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users
       WHERE (?1 IS NULL OR ai_status = ?1)
         AND (?2 IS NULL OR id < (SELECT id FROM users WHERE public_id = ?2))
       ORDER BY id DESC LIMIT ?3`,
    )
    .bind(filter.aiStatus, filter.cursor, ADMIN_USERS_PAGE_SIZE + 1)
    .all<UserRow>();
  const rows = results.slice(0, ADMIN_USERS_PAGE_SIZE);
  const nextCursor = results.length > ADMIN_USERS_PAGE_SIZE ? (rows[rows.length - 1]?.public_id ?? null) : null;
  return { rows, nextCursor };
}

/** 一個會改狀態的動作：SET 子句、條件（常數 SQL）與稽核的前後值。 */
interface PlannedChange {
  set: string;
  setParams: (string | number)[];
  where: string;
  whereParams: (string | number)[];
  detail: { field: 'ai_status' | 'status'; from: string; to: string };
}

/** 執行動作，回傳更新後的那一列。找不到 404；規則不允許 409。 */
export async function applyAdminAction(
  db: D1Database,
  config: AppConfig,
  actor: SessionUser,
  publicId: string,
  action: AdminUserAction,
): Promise<UserRow> {
  const target = PUBLIC_ID_RE.test(publicId) ? await loadUserByPublicId(db, publicId) : null;
  if (!target || target.status === 'deleting') throw new ApiError(404, 'not_found', '找不到這位使用者');

  const now = nowSeconds();
  const plan = planChange(config, actor, target, action, now);
  if (!plan) return target; // 已經是目標狀態

  const where = `id = ? AND status <> 'deleting' AND ${plan.where}`;
  const whereParams = [target.id, ...plan.whereParams];
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO admin_audit (actor_id, actor_kind, action, target_kind, target_id, detail_json, created_at)
         SELECT ?, 'admin', ?, 'user', public_id, ?, ? FROM users WHERE ${where}`,
      )
      .bind(actor.id, `user.${action}`, JSON.stringify(plan.detail), now, ...whereParams),
    db.prepare(`UPDATE users SET ${plan.set} WHERE ${where}`).bind(...plan.setParams, ...whereParams),
  ]);

  if ((results[1]?.meta.changes ?? 0) !== 1) {
    // 條件不成立：通常是名額在這一瞬間被別的核准用完，或狀態剛被改掉。
    if (action === 'approve' || action === 'unsuspend') {
      const approved = await countApprovedStudents(db);
      if (approved >= config.ai.approvalCap) {
        throw new ApiError(409, 'conflict', `核准名額已滿（${approved}／${config.ai.approvalCap} 人）`);
      }
    }
    throw new ApiError(409, 'conflict', '使用者的狀態剛被改變，請重新整理後再試');
  }

  const updated = await loadUserByPublicId(db, publicId);
  if (!updated) throw new ApiError(404, 'not_found', '找不到這位使用者');
  return updated;
}

/** 依動作與目前狀態決定要怎麼改；null＝已經是目標狀態。規則不允許時丟 409。 */
function planChange(config: AppConfig, actor: SessionUser, target: UserRow, action: AdminUserAction, now: number): PlannedChange | null {
  const review = (to: AiStatus, extraWhere = '', extraParams: (string | number)[] = []): PlannedChange => ({
    set: 'ai_status = ?, ai_reviewed_by = ?, ai_reviewed_at = ?',
    setParams: [to, actor.id, now],
    // 條件裡帶「狀態仍是讀到的那個值」：讀和寫之間被別人改過就不生效（樂觀鎖）。
    where: `ai_status = ?${extraWhere}`,
    whereParams: [target.ai_status, ...extraParams],
    detail: { field: 'ai_status', from: target.ai_status, to },
  });
  /** 變成 approved（approve、unsuspend）：§6.3 啟動檢查要通過、名額要有空位。 */
  const toApproved = (): PlannedChange => {
    if (!approvalsAllowed(config)) {
      throw new ApiError(409, 'conflict', '預算的啟動檢查（ARCHITECTURE §6.3）未通過，暫停新的 AI 核准；請先修正設定');
    }
    // 名額只算學生；核准管理員不受名額限制。計數與更新在同一句，不會兩個核准同時擠進最後一個名額。
    return review('approved', ` AND (role = 'admin' OR (SELECT COUNT(*) FROM users WHERE ${APPROVED_STUDENT_SQL}) < ?)`, [
      config.ai.approvalCap,
    ]);
  };

  switch (action) {
    case 'approve':
      if (target.ai_status === 'approved') return null;
      return toApproved();
    case 'reject':
    case 'waitlist': {
      const to: AiStatus = action === 'reject' ? 'rejected' : 'waitlist';
      if (target.ai_status === to) return null;
      if (target.ai_status === 'none') {
        throw new ApiError(409, 'conflict', '這位使用者還沒申請 AI，不能拒絕或排入候補');
      }
      return review(to);
    }
    case 'suspend':
      if (target.id === actor.id) throw new ApiError(409, 'conflict', '不能停用自己的 AI 功能');
      if (target.ai_status === 'suspended') return null;
      return review('suspended');
    case 'unsuspend':
      if (target.ai_status !== 'suspended') {
        if (target.ai_status === 'approved') return null;
        throw new ApiError(409, 'conflict', '這位使用者的 AI 功能沒有被停用');
      }
      return toApproved();
  }
}
