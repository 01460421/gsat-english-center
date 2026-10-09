/**
 * /api/admin/ai/pause、/api/admin/usage：AI 全站暫停與用量彙總（ARCHITECTURE §10.5、§6.4）。負責：後端 AI A2。
 * 和 src/admin/routes.ts（A1）掛在同一個前綴 /api/admin，但分成兩個檔案，兩位 agent 不會改到同一個檔。
 * 全部 requireAdmin；暫停另加 requireRecentLogin(RECENT_LOGIN_MINUTES_ADMIN) 並寫 admin_audit。
 *
 *   POST /api/admin/ai/pause         AdminAiPauseBody → 204（寫今天〔台灣日期〕的 ai_budget_daily.paused；
 *                                    一天一列，隔天 00:00 自動恢復；進行中的任務讓它完成，還沒開始的由 consumer 退還）
 *   GET  /api/admin/usage?from=&to=  AdminUsageResponse（依日、依任務的點數與微美元；預設本月 1 日到今天，最多 366 天）
 */
import { RECENT_LOGIN_MINUTES_ADMIN, type AdminAiPauseBody, type AdminUsageResponse } from '@gsat/shared';
import { Hono } from 'hono';
import * as z from 'zod/v4';
import { readJsonBody } from '../account/validate';
import { getSessionUser, requireAdmin, requireRecentLogin } from '../auth/session';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { setPausedStatement } from '../ai/guard';
import { opsEventStatement } from '../ai/ledger';
import { taiwanDay, taiwanMonth } from '../time';

export const adminAiRoutes = new Hono<AppEnv>();

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 暫停請求只有一個布林；只收 application/json、最多 4 KB（邊讀邊數）。 */
const pauseSchema = z.object({ paused: z.boolean() }) satisfies z.ZodType<AdminAiPauseBody>;

adminAiRoutes.post('/ai/pause', requireAdmin, requireRecentLogin(RECENT_LOGIN_MINUTES_ADMIN), async (c) => {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  const { paused } = await readJsonBody(c, pauseSchema, 4 * 1024);
  const db = c.env.DB;
  const nowMs = Date.now();
  await db.batch([
    setPausedStatement(db, paused, nowMs),
    db
      .prepare(`INSERT INTO admin_audit (actor_id, actor_kind, action, target_kind, target_id, detail_json) VALUES (?1, 'admin', ?2, 'ai', ?3, '{}')`)
      .bind(user.id, paused ? 'ai.pause' : 'ai.resume', taiwanDay(nowMs)),
    opsEventStatement(db, paused ? 'ai_paused_by_admin' : 'ai_resumed_by_admin', paused ? 'warn' : 'info', { tw_day: taiwanDay(nowMs) }),
  ]);
  return c.body(null, 204);
});

adminAiRoutes.get('/usage', requireAdmin, async (c) => {
  const nowMs = Date.now();
  const today = taiwanDay(nowMs);
  const from = c.req.query('from') || `${taiwanMonth(nowMs)}-01`;
  const to = c.req.query('to') || today;
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new ApiError(400, 'bad_request', 'from、to 必須是 YYYY-MM-DD，且 from ≤ to');
  const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(spanDays) || spanDays > 366) throw new ApiError(400, 'bad_request', '查詢區間最多 366 天');
  const db = c.env.DB;
  const config = loadConfig(c.env);
  // 點數：已結算的實扣、進行中的預扣；退還的不算點數，但美元（實際成本）照算。
  const [byDay, byTask, totals, budget] = await Promise.all([
    db
      .prepare(
        `SELECT tw_day, COUNT(*) AS ops,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN 0 ELSE COALESCE(points_charged, points_reserved) END), 0) AS points,
                COALESCE(SUM(usd_actual_micros), 0) AS usd_micros
           FROM ai_ops WHERE tw_day BETWEEN ?1 AND ?2 GROUP BY tw_day ORDER BY tw_day`,
      )
      .bind(from, to)
      .all<{ tw_day: string; ops: number; points: number; usd_micros: number }>(),
    db
      .prepare(
        `SELECT task, COUNT(*) AS ops,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN 0 ELSE COALESCE(points_charged, points_reserved) END), 0) AS points,
                COALESCE(SUM(usd_actual_micros), 0) AS usd_micros
           FROM ai_ops WHERE tw_day BETWEEN ?1 AND ?2 GROUP BY task ORDER BY task`,
      )
      .bind(from, to)
      .all<{ task: string; ops: number; points: number; usd_micros: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS ops,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN 0 ELSE COALESCE(points_charged, points_reserved) END), 0) AS points,
                COALESCE(SUM(usd_actual_micros), 0) AS usd_micros,
                COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded_ops
           FROM ai_ops WHERE tw_day BETWEEN ?1 AND ?2`,
      )
      .bind(from, to)
      .first<{ ops: number; points: number; usd_micros: number; refunded_ops: number }>(),
    db
      .prepare(
        `SELECT COALESCE((SELECT online_usd_micros FROM ai_budget_daily WHERE tw_day = ?1), 0) AS today,
                (SELECT COALESCE(SUM(online_usd_micros), 0) FROM ai_budget_daily WHERE tw_day BETWEEN ?2 || '-01' AND ?2 || '-31') AS month`,
      )
      .bind(today, taiwanMonth(nowMs))
      .first<{ today: number; month: number }>(),
  ]);
  const body: AdminUsageResponse = {
    from,
    to,
    totals: { ops: totals?.ops ?? 0, points: totals?.points ?? 0, usd_micros: totals?.usd_micros ?? 0, refunded_ops: totals?.refunded_ops ?? 0 },
    by_day: byDay.results,
    by_task: byTask.results,
    budget: {
      site_day_usd: config.ai.budget.siteUsdDay,
      site_month_usd: config.ai.budget.siteUsdMonth,
      today_usd_micros: budget?.today ?? 0,
      month_usd_micros: budget?.month ?? 0,
    },
  };
  return c.json(body);
});
