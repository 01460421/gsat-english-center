/**
 * /api/admin/*：管理後台的健康檢查與使用者核准（ARCHITECTURE §10.5；SPEC §9）。負責：後端登入 A1。
 * 全部 requireAdmin（角色每次從 D1 讀）；寫入動作另加 requireRecentLogin(RECENT_LOGIN_MINUTES_ADMIN)（12 小時），並寫 admin_audit。
 * AI 用量與全站暫停在 src/admin/ai.ts（A2）。
 *
 * 中介層掛在每一條路由上、不用 adminRoutes.use('*')：這個子應用和 adminAiRoutes 共用 /api/admin 前綴，
 * use('*') 會連 A2 的路由與不存在的路徑一起套用（不存在的路徑應該是 404，不是 401）。
 *
 *   GET  /api/admin/health                       AdminHealthResponse（設定只回布林、遷移狀態、§6.3 startupChecks、未確認的維運事件數）
 *   GET  /api/admin/users?ai_status=&cursor=     AdminUsersResponse（每頁 50 筆，依建立順序由新到舊）
 *   POST /api/admin/users/:id/:action            AdminUserAction（approve／reject／waitlist／suspend／unsuspend）
 *                                                → AdminUserActionResponse；approve 超過名額或啟動檢查不通過 → 409 conflict
 */
import {
  ADMIN_USER_ACTIONS,
  RECENT_LOGIN_MINUTES_ADMIN,
  type AdminUserAction,
  type AdminUserActionResponse,
  type AdminUsersResponse,
} from '@gsat/shared';
import { Hono } from 'hono';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { getSessionUser, requireAdmin, requireRecentLogin } from '../auth/session';
import { approvalSummary } from '../account/approval';
import { toAdminUserRow } from '../account/users';
import { buildHealth } from './health';
import { PUBLIC_ID_RE, applyAdminAction, isAiStatus, listUsers } from './users';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get('/health', requireAdmin, async (c) => c.json(await buildHealth(c.env, loadConfig(c.env))));

adminRoutes.get('/users', requireAdmin, async (c) => {
  const statusParam = c.req.query('ai_status') || null;
  if (statusParam !== null && !isAiStatus(statusParam)) throw new ApiError(400, 'bad_request', 'ai_status 不是合法的值');
  const cursor = c.req.query('cursor') || null;
  if (cursor !== null && !PUBLIC_ID_RE.test(cursor)) throw new ApiError(400, 'bad_request', 'cursor 格式不正確');

  const config = loadConfig(c.env);
  const [{ rows, nextCursor }, approval] = await Promise.all([
    listUsers(c.env.DB, { aiStatus: statusParam, cursor }),
    approvalSummary(c.env, config),
  ]);
  const body: AdminUsersResponse = {
    users: rows.map(toAdminUserRow),
    next_cursor: nextCursor,
    approval: { cap: approval.cap, approved: approval.approved },
  };
  return c.json(body);
});

adminRoutes.post('/users/:id/:action', requireAdmin, requireRecentLogin(RECENT_LOGIN_MINUTES_ADMIN), async (c) => {
  const action = c.req.param('action');
  if (!(ADMIN_USER_ACTIONS as readonly string[]).includes(action)) {
    throw new ApiError(400, 'bad_request', `不認得的動作：只接受 ${ADMIN_USER_ACTIONS.join('、')}`);
  }
  const actor = await getSessionUser(c);
  if (!actor) throw new ApiError(401, 'unauthorized', '請先登入');
  const row = await applyAdminAction(c.env.DB, loadConfig(c.env), actor, c.req.param('id'), action as AdminUserAction);
  const body: AdminUserActionResponse = { user: toAdminUserRow(row) };
  return c.json(body);
});
