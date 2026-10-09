/**
 * GET /api/admin/health 的內容（ARCHITECTURE §6.3、§10.5；SPEC §9「概況」）。負責：後端登入 A1。
 *
 *   - 設定是否齊全：**只回布林**，絕不回值或片段。
 *   - 遷移：d1_migrations 已套用的檔名 vs. Worker 打包時的 EXPECTED_MIGRATIONS（src/admin/migrations.ts）。
 *     d1_migrations 不存在（例如用 d1 execute 手動建表）時 applied＝[]、ok＝false。
 *   - §6.3 啟動檢查（三條大小關係，src/config.ts 的 startupChecks）＋第 4 條「任一條 error 級不成立：後台紅燈、
 *     寫 ops_events(severity='error')、拒絕新的 AI 核准」。ops_events 24 小時內只寫一筆（未確認的還在就不重複寫）。
 *   - AI：全站暫停、名額、已核准人數；未確認的維運事件數。
 */
import type { AdminHealthResponse } from '@gsat/shared';
import { startupChecks, type AppConfig } from '../config';
import type { Env } from '../env';
import { isAiPaused } from '../features';
import { nowSeconds } from '../time';
import { approvalsAllowed, countApprovedStudents } from '../account/approval';
import { EXPECTED_MIGRATIONS } from './migrations';

/** 啟動檢查失敗的維運事件代碼。 */
export const STARTUP_CHECK_EVENT = 'startup_check_failed';

async function appliedMigrations(db: D1Database): Promise<string[]> {
  try {
    const { results } = await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    return results.map((r) => r.name);
  } catch {
    return [];
  }
}

export async function buildHealth(env: Env, config: AppConfig): Promise<AdminHealthResponse> {
  const db = env.DB;
  const now = nowSeconds();
  const checks = startupChecks(config);
  const allowed = approvalsAllowed(config);

  if (!allowed) {
    const failed = checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.id);
    await db
      .prepare(
        `INSERT INTO ops_events (kind, severity, detail_json, created_at)
         SELECT ?, 'error', ?, ? WHERE NOT EXISTS (
           SELECT 1 FROM ops_events WHERE kind = ? AND acked_at IS NULL AND created_at > ?)`,
      )
      .bind(STARTUP_CHECK_EVENT, JSON.stringify({ failed }), now, STARTUP_CHECK_EVENT, now - 86_400)
      .run();
  }

  const applied = await appliedMigrations(db);
  const [paused, approved, ops] = await Promise.all([
    isAiPaused(env),
    countApprovedStudents(db),
    db
      .prepare(
        "SELECT COUNT(*) AS open, COALESCE(SUM(CASE WHEN severity = 'error' THEN 1 ELSE 0 END), 0) AS open_errors FROM ops_events WHERE acked_at IS NULL",
      )
      .first<{ open: number; open_errors: number }>(),
  ]);

  return {
    config: {
      google_client_id: config.auth.googleClientId !== null,
      google_client_secret: config.auth.googleClientSecret !== null,
      session_secret: config.auth.sessionSecret !== null,
      admin_email: config.auth.adminEmail !== null,
      ledger_salt: config.auth.ledgerSalt !== null,
      anthropic_api_key: config.ai.apiKey !== null,
      ai_queue: env.AI_QUEUE !== undefined,
    },
    migrations: {
      applied,
      expected: [...EXPECTED_MIGRATIONS],
      ok: EXPECTED_MIGRATIONS.every((name) => applied.includes(name)),
    },
    startup_checks: checks,
    approvals_allowed: allowed,
    ai: { paused, approval_cap: config.ai.approvalCap, approved },
    ops_events: { open: ops?.open ?? 0, open_errors: ops?.open_errors ?? 0 },
  };
}
