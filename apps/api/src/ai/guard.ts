/**
 * 點數與美元的原子預扣、結算、退還（DB_SCHEMA §3.7；ARCHITECTURE §6.4）。負責：後端 AI A2。
 *
 * - 預扣：一句 INSERT … SELECT … WHERE 同時檢查每人每日／每月點數、任務家族每日篇數、同時任務數、全站暫停、
 *   全站今日與本月美元（已結算＋所有進行中的預扣＋這次 ≤ 上限）。D1 的寫入是序列化的，單一敘述就是原子操作，
 *   meta.changes === 1 才算成功；失敗再跑唯讀查詢判斷是哪個條件擋下，回固定代碼。
 * - 結算與退還在同一個 db.batch()（D1 的 batch 是交易）：先以 settle_token 條件式更新 ai_ops，再「只認這個 token」
 *   累加 ai_budget_daily；Queue 重送同一則訊息時第一句更新 0 列、第二句找不到 token，預算不會重複累加。
 *   呼叫端附帶的其他語句（例如把提交改成 graded）也要用 token 當條件。
 * - 退還時 points_charged=0，但 usd_actual_micros 是實際成本、照樣累加進全站預算（拒答也收費，§6.2 第 10 條）。
 * - 管理員與 unlimited 等級不受點數與篇數限制（傳很大的上限），但照樣記帳、受同時任務數與全站預算限制（§6.4）。
 * - 每日退還上限（DB_SCHEMA §3.7 原文之外多的一個條件；設計文件 §10「A2 修正（第二輪審查）」）：退還的任務不算點數，
 *   所以「內容造成的退還」（拒答、截斷、輸出格式不符、照片看不出是作文）每人每天最多 AI_REFUNDS_PER_DAY 次，
 *   超過就不再預扣（429 rate_limited），否則可以零成本反覆呼叫 Claude、耗光全站預算。系統原因的退還
 *   （API 錯誤、逾時、暫停、排隊太久、內部錯誤）不算。
 */
import type { AiReserveErrorCode, AiTask } from '@gsat/shared';
import type { SessionUser } from '../auth/session';
import type { AppConfig } from '../config';
import { nowSeconds, taiwanDay, taiwanMonth } from '../time';

/** 「不限」的上限值（SQLite INTEGER 放得下、遠大於任何實際用量）。 */
export const UNLIMITED = 1_000_000_000;

/**
 * 每人每天「內容造成的退還」上限（設計值）。正常使用每天最多十幾個任務，這幾種退還很少見；
 * 上限內每次的成本最多是一次預扣（作文 US$0.544），所以一個帳號一天最多讓全站多花約 US$2.7。
 */
export const AI_REFUNDS_PER_DAY = 5;

/** 算進每日退還上限的退還原因（RESERVE_SQL 與 usageSnapshot 裡寫死同一組字串）。 */
export const COUNTED_REFUND_REASONS = ['refusal', 'invalid_output', 'max_tokens'] as const;

export interface UserLimits {
  capDay: number;
  capMonth: number;
  /** 作文家族每日篇數；0＝不限。 */
  familyCap: number;
  capConc: number;
  unlimited: boolean;
  /** 每日「內容造成的退還」上限（沒給＝AI_REFUNDS_PER_DAY）。 */
  refundCap?: number;
}

/** 依等級與個別覆寫算出這位使用者的上限（ARCHITECTURE §6.3；users.ai_points_day／_month 可個別覆寫）。 */
export function userLimits(config: AppConfig, user: Pick<SessionUser, 'role' | 'aiTier' | 'aiPointsDay' | 'aiPointsMonth'>): UserLimits {
  const l = config.ai.limits;
  const unlimited = user.role === 'admin' || user.aiTier === 'unlimited';
  if (unlimited) return { capDay: UNLIMITED, capMonth: UNLIMITED, familyCap: 0, capConc: Math.max(1, l.concurrentUser), unlimited, refundCap: UNLIMITED };
  const dayDefault = user.aiTier === 'trial' ? l.pointsTrialDay : l.pointsUserDay;
  return {
    capDay: user.aiPointsDay ?? dayDefault,
    capMonth: user.aiPointsMonth ?? l.pointsUserMonth,
    familyCap: Math.max(0, Math.floor(l.essayUserDay)),
    capConc: Math.max(1, Math.floor(l.concurrentUser)),
    unlimited,
    refundCap: AI_REFUNDS_PER_DAY,
  };
}

/** 全站美元上限（微美元）。 */
export function siteLimitsMicros(config: AppConfig): { day: number; month: number } {
  return { day: Math.floor(config.ai.budget.siteUsdDay * 1_000_000), month: Math.floor(config.ai.budget.siteUsdMonth * 1_000_000) };
}

export interface ReserveInput {
  opId: string;
  userId: number;
  task: AiTask;
  refId: string;
  points: number;
  usdMicros: number;
  family: readonly AiTask[] | null;
  limits: UserLimits;
  site: { day: number; month: number };
  nowMs: number;
}

/**
 * 預扣的 SQL（DB_SCHEMA §3.7 原文，具名參數改成 D1 支援的 ?N；最後多一個「每日退還上限」條件，見檔頭）：
 *   ?1 id ?2 uid ?3 task ?4 ref ?5 pts ?6 usd ?7 day ?8 month ?9 now ?10 cap_day ?11 cap_month
 *   ?12 family_cap ?13 family_tasks(JSON) ?14 cap_conc ?15 site_day ?16 site_month ?17 refund_cap
 */
export const RESERVE_SQL = `INSERT INTO ai_ops (id, user_id, task, ref_id, status, points_reserved, usd_reserved_micros, tw_day, tw_month, created_at)
SELECT ?1, ?2, ?3, ?4, 'reserved', ?5, ?6, ?7, ?8, ?9
WHERE (SELECT COALESCE(SUM(COALESCE(points_charged, points_reserved)), 0) FROM ai_ops
        WHERE user_id = ?2 AND tw_day = ?7 AND status <> 'refunded') + ?5 <= ?10
  AND (SELECT COALESCE(SUM(COALESCE(points_charged, points_reserved)), 0) FROM ai_ops
        WHERE user_id = ?2 AND tw_month = ?8 AND status <> 'refunded') + ?5 <= ?11
  AND (?12 = 0 OR (SELECT COUNT(*) FROM ai_ops WHERE user_id = ?2 AND tw_day = ?7
        AND task IN (SELECT value FROM json_each(?13)) AND status <> 'refunded') < ?12)
  AND (SELECT COUNT(*) FROM ai_ops WHERE user_id = ?2 AND status = 'reserved') < ?14
  AND COALESCE((SELECT paused FROM ai_budget_daily WHERE tw_day = ?7), 0) = 0
  AND COALESCE((SELECT online_usd_micros FROM ai_budget_daily WHERE tw_day = ?7), 0)
      + (SELECT COALESCE(SUM(usd_reserved_micros), 0) FROM ai_ops WHERE status = 'reserved') + ?6 <= ?15
  AND (SELECT COALESCE(SUM(online_usd_micros), 0) FROM ai_budget_daily
        WHERE tw_day BETWEEN ?8 || '-01' AND ?8 || '-31')
      + (SELECT COALESCE(SUM(usd_reserved_micros), 0) FROM ai_ops WHERE status = 'reserved') + ?6 <= ?16
  AND (SELECT COUNT(*) FROM ai_ops WHERE user_id = ?2 AND tw_day = ?7 AND status = 'refunded'
        AND refund_reason IN ('refusal', 'invalid_output', 'max_tokens')) < ?17`;

/** 預扣失敗的原因：共用的 AI_RESERVE_ERROR_CODES，另加每日退還上限（路由回 429 rate_limited）。 */
export type ReserveFailureCode = AiReserveErrorCode | 'refund_limit';

export type ReserveResult = { ok: true } | { ok: false; code: ReserveFailureCode };

/** 原子預扣；失敗時回傳原因代碼。 */
export async function reserveOp(db: D1Database, input: ReserveInput): Promise<ReserveResult> {
  const day = taiwanDay(input.nowMs);
  const month = taiwanMonth(input.nowMs);
  const familyCap = input.family && input.family.includes(input.task) ? input.limits.familyCap : 0;
  const res = await db
    .prepare(RESERVE_SQL)
    .bind(
      input.opId,
      input.userId,
      input.task,
      input.refId,
      input.points,
      input.usdMicros,
      day,
      month,
      nowSeconds(input.nowMs),
      input.limits.capDay,
      input.limits.capMonth,
      familyCap,
      JSON.stringify(input.family ?? []),
      input.limits.capConc,
      input.site.day,
      input.site.month,
      refundCapOf(input.limits),
    )
    .run();
  if (res.meta.changes === 1) return { ok: true };
  return { ok: false, code: await diagnoseReserveFailure(db, input) };
}

function refundCapOf(limits: UserLimits): number {
  return limits.refundCap ?? AI_REFUNDS_PER_DAY;
}

export interface UsageSnapshot {
  paused: boolean;
  dayPoints: number;
  monthPoints: number;
  familyToday: number;
  active: number;
  siteDaySettled: number;
  siteMonthSettled: number;
  siteReserved: number;
  /** 今天「內容造成的退還」次數（COUNTED_REFUND_REASONS）。 */
  refundsToday: number;
}

/** 唯讀查詢目前的用量（預扣失敗的原因判斷、GET /api/ai/quota 共用）。 */
export async function usageSnapshot(db: D1Database, userId: number, family: readonly AiTask[], nowMs: number): Promise<UsageSnapshot> {
  const day = taiwanDay(nowMs);
  const month = taiwanMonth(nowMs);
  const row = await db
    .prepare(
      `SELECT
         COALESCE((SELECT paused FROM ai_budget_daily WHERE tw_day = ?2), 0) AS paused,
         (SELECT COALESCE(SUM(COALESCE(points_charged, points_reserved)), 0) FROM ai_ops
            WHERE user_id = ?1 AND tw_day = ?2 AND status <> 'refunded') AS day_points,
         (SELECT COALESCE(SUM(COALESCE(points_charged, points_reserved)), 0) FROM ai_ops
            WHERE user_id = ?1 AND tw_month = ?3 AND status <> 'refunded') AS month_points,
         (SELECT COUNT(*) FROM ai_ops WHERE user_id = ?1 AND tw_day = ?2
            AND task IN (SELECT value FROM json_each(?4)) AND status <> 'refunded') AS family_today,
         (SELECT COUNT(*) FROM ai_ops WHERE user_id = ?1 AND status = 'reserved') AS active,
         COALESCE((SELECT online_usd_micros FROM ai_budget_daily WHERE tw_day = ?2), 0) AS site_day,
         (SELECT COALESCE(SUM(online_usd_micros), 0) FROM ai_budget_daily WHERE tw_day BETWEEN ?3 || '-01' AND ?3 || '-31') AS site_month,
         (SELECT COALESCE(SUM(usd_reserved_micros), 0) FROM ai_ops WHERE status = 'reserved') AS site_reserved,
         (SELECT COUNT(*) FROM ai_ops WHERE user_id = ?1 AND tw_day = ?2 AND status = 'refunded'
            AND refund_reason IN ('refusal', 'invalid_output', 'max_tokens')) AS refunds_today`,
    )
    .bind(userId, day, month, JSON.stringify(family))
    .first<Record<string, number>>();
  const n = (k: string) => Number(row?.[k] ?? 0);
  return {
    paused: n('paused') === 1,
    dayPoints: n('day_points'),
    monthPoints: n('month_points'),
    familyToday: n('family_today'),
    active: n('active'),
    siteDaySettled: n('site_day'),
    siteMonthSettled: n('site_month'),
    siteReserved: n('site_reserved'),
    refundsToday: n('refunds_today'),
  };
}

/** 預扣失敗後判斷原因（全站暫停優先；其次是個人的點數、篇數、同時任務、退還次數；最後是全站預算）。 */
export async function diagnoseReserveFailure(db: D1Database, input: ReserveInput): Promise<ReserveFailureCode> {
  const s = await usageSnapshot(db, input.userId, input.family ?? [], input.nowMs);
  if (s.paused) return 'ai_paused';
  if (s.dayPoints + input.points > input.limits.capDay) return 'quota_day';
  if (s.monthPoints + input.points > input.limits.capMonth) return 'quota_month';
  const familyCap = input.family && input.family.includes(input.task) ? input.limits.familyCap : 0;
  if (familyCap > 0 && s.familyToday >= familyCap) return 'daily_limit';
  if (s.active >= input.limits.capConc) return 'busy';
  if (s.refundsToday >= refundCapOf(input.limits)) return 'refund_limit';
  if (s.siteDaySettled + s.siteReserved + input.usdMicros > input.site.day) return 'site_budget';
  if (s.siteMonthSettled + s.siteReserved + input.usdMicros > input.site.month) return 'site_budget';
  // 兩次查詢之間狀態變了（例如另一個任務剛結算）：當成暫時忙碌，請前端稍後再試。
  return 'busy';
}

function settleToken(): string {
  return crypto.randomUUID();
}

export interface FinishInput {
  opId: string;
  nowMs: number;
  /** 依這次的 settle_token 產生附帶語句（例如更新提交）；每一句都要以 token 當條件才會冪等。 */
  extra?: (token: string) => D1PreparedStatement[];
  /**
   * 只在「對應的提交沒有有效租約」時才結算或退還（回收卡住的預扣用）：consumer 已經搶到租約、正在處理的操作
   * 不會被回收退還；反過來 consumer 搶租約時也要求操作仍是 reserved，兩邊互斥（D1 的寫入是序列化的）。
   */
  onlyIfUnleased?: boolean;
}

const FINISH_SQL = `UPDATE ai_ops SET status = ?1,
     points_charged = CASE WHEN ?1 = 'settled' THEN points_reserved ELSE 0 END,
     usd_actual_micros = (SELECT COALESCE(SUM(cost_micros), 0) FROM ai_calls WHERE op_id = ?2),
     settle_token = ?3, refund_reason = ?4, settled_at = ?5
   WHERE id = ?2 AND status = 'reserved'`;

const FINISH_UNLEASED_SQL = `UPDATE ai_ops SET status = ?1,
     points_charged = CASE WHEN ?1 = 'settled' THEN points_reserved ELSE 0 END,
     usd_actual_micros = (SELECT COALESCE(SUM(cost_micros), 0) FROM ai_calls WHERE op_id = ?2),
     settle_token = ?3, refund_reason = ?4, settled_at = ?5
   WHERE id = ?2 AND status = 'reserved'
     AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.id = ai_ops.ref_id AND s.op_id = ?2 AND s.lease_until IS NOT NULL AND s.lease_until > ?5)`;

async function finishOp(db: D1Database, input: FinishInput, outcome: { status: 'settled' } | { status: 'refunded'; reason: string }): Promise<boolean> {
  const token = settleToken();
  const now = nowSeconds(input.nowMs);
  const day = taiwanDay(input.nowMs);
  const reason = outcome.status === 'refunded' ? outcome.reason : null;
  const statements = [
    db.prepare(input.onlyIfUnleased ? FINISH_UNLEASED_SQL : FINISH_SQL).bind(outcome.status, input.opId, token, reason, now),
    db
      .prepare(
        `INSERT INTO ai_budget_daily (tw_day, online_usd_micros, calls, paused, updated_at)
         SELECT ?1, usd_actual_micros, (SELECT COUNT(*) FROM ai_calls WHERE op_id = ?2), 0, ?4
           FROM ai_ops WHERE id = ?2 AND settle_token = ?3
         ON CONFLICT(tw_day) DO UPDATE SET
           online_usd_micros = online_usd_micros + excluded.online_usd_micros,
           calls = calls + excluded.calls,
           updated_at = excluded.updated_at`,
      )
      .bind(day, input.opId, token, now),
    ...(input.extra?.(token) ?? []),
  ];
  const results = await db.batch(statements);
  return results[0]?.meta.changes === 1;
}

/** 結算：實扣預扣的點數、累加實際美元。回傳這次是否真的結算（false＝已經結算或退還過）。 */
export function settleOp(db: D1Database, input: FinishInput): Promise<boolean> {
  return finishOp(db, input, { status: 'settled' });
}

/** 退還：點數全退、實際美元照記。 */
export function refundOp(db: D1Database, input: FinishInput & { reason: string }): Promise<boolean> {
  return finishOp(db, input, { status: 'refunded', reason: input.reason });
}

/** refundWithSubmission 需要的 ai_ops 欄位。 */
export interface OpRef {
  id: string;
  user_id: number | null;
  task: string;
  ref_id: string | null;
}

/**
 * 退還並把提交標成 failed、放掉租約（OCR 另外刪照片）；全部以 settle_token 為條件，重送不會重複。
 * consumer 的失敗結算、死信佇列、回收卡住的預扣（onlyIfUnleased）共用這一支。
 */
export async function refundWithSubmission(db: D1Database, op: OpRef, reason: string, nowMs: number, options: { onlyIfUnleased?: boolean } = {}): Promise<boolean> {
  const now = nowSeconds(nowMs);
  return refundOp(db, {
    opId: op.id,
    reason,
    nowMs,
    ...(options.onlyIfUnleased ? { onlyIfUnleased: true } : {}),
    extra: (token) => {
      if (op.user_id === null || op.ref_id === null) return [];
      const statements = [
        db
          .prepare(
            `UPDATE submissions SET status = 'failed', lease_until = NULL, updated_at = ?1
             WHERE id = ?2 AND user_id = ?3 AND op_id = ?4 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?4 AND settle_token = ?5)`,
          )
          .bind(now, op.ref_id, op.user_id, op.id, token),
      ];
      if (op.task === 'essay_ocr') {
        statements.push(
          db
            .prepare(
              `DELETE FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2
                 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`,
            )
            .bind(op.ref_id, op.user_id, op.id, token),
        );
      }
      return statements;
    },
  });
}

/** 全站暫停或恢復（今天的 ai_budget_daily.paused；一天一列，隔天自動恢復）。 */
export function setPausedStatement(db: D1Database, paused: boolean, nowMs: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ai_budget_daily (tw_day, paused, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(tw_day) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at`,
    )
    .bind(taiwanDay(nowMs), paused ? 1 : 0, nowSeconds(nowMs));
}
