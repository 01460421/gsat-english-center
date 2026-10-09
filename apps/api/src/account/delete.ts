/**
 * DELETE /api/me 的刪除流程（ARCHITECTURE §8.4；DB_SCHEMA §2.2 的外鍵、§3.8 的 deletion_log）。負責：後端登入 A1。
 *
 * 原設計是「status='deleting' → Cron 分批刪各表 → 刪 users 列 → 寫 deletion_log」。MVP 沒有 Cron（設計文件 §1.2），
 * 而且一個帳號的資料量很小（同意、提交、批改、暫存照片），所以在請求裡**同步**做完，全部放在同一個 db.batch()（交易）：
 *   1. users.status='deleting'、delete_requested_at、session_ver+1（所有裝置立即登出；也讓 trg_consents_no_delete 放行）
 *   2. 寫 deletion_log（只有 HMAC 假名、時間、各表列數，不含個資）
 *   3. 寫 admin_audit：只記「刪除了一個帳號」（不記是誰）
 *   4. DELETE users：外鍵 ON DELETE CASCADE 刪掉使用者資料；ai_ops、item_reports 的 user_id 設為 NULL（帳本與回報保留、去識別）
 * users.id 是 AUTOINCREMENT，刪掉的 id 永遠不會再發給新帳號（舊 cookie 不會對到別人）。
 * 之後資料量變大（作答、複習）再改回 Cron 分批：只要把第 4 步搬走，前三步不變。
 */
import type { AppConfig } from '../config';
import type { Env } from '../env';
import { nowSeconds } from '../time';
import { userRef } from '../auth/crypto';

/**
 * 會隨帳號一起刪除（CASCADE）的表，計入 deletion_log.rows_json（必須有 user_id 欄位）。
 * 不存在的表（例如遷移還沒套用）計數時略過；沒列在這裡的 CASCADE 表照樣會被刪，只是不計數。
 */
export const CASCADE_TABLES = [
  'consents',
  'user_prefs',
  'user_notices',
  'practice_sessions',
  'attempts',
  'user_group_seen',
  'srs_cards',
  'srs_reviews',
  'user_skill_daily',
  'score_predictions',
  'user_ability',
  'submissions',
  'submission_photos',
  'gradings',
  'chat_threads',
  // 0002：手寫照片暫存（A2）。
  'submission_photo_temp',
] as const;

/** user_id 會被設為 NULL（保留但去識別）的表。 */
export const SET_NULL_TABLES = ['ai_ops', 'item_reports'] as const;

/** 刪除證明的假名鹽：LEDGER_SALT；沒設時退回 SESSION_SECRET（只影響假名能不能和帳本對上，不影響刪除本身）。 */
function pseudonymSalt(config: AppConfig): string {
  const salt = config.auth.ledgerSalt ?? config.auth.sessionSecret;
  if (!salt) throw new Error('LEDGER_SALT 與 SESSION_SECRET 都沒設定，無法產生刪除證明');
  return salt;
}

export async function deleteAccount(env: Env, config: AppConfig, userId: number): Promise<void> {
  const db = env.DB;
  const now = nowSeconds();

  // 先問 sqlite_master 哪些表存在，再一次算完各表列數。表名來自上面的常數陣列，不是使用者輸入。
  const wanted: readonly string[] = [...CASCADE_TABLES, ...SET_NULL_TABLES];
  const { results: existing } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(wanted))
    .all<{ name: string }>();
  const tables = wanted.filter((t) => existing.some((r) => r.name === t));
  const counts = tables.map((t) => `(SELECT COUNT(*) FROM ${t} WHERE user_id = ?1) AS ${t}`);
  const row = counts.length > 0 ? await db.prepare(`SELECT ${counts.join(', ')}`).bind(userId).first<Record<string, number>>() : null;
  const rows: Record<string, number> = {};
  for (const t of tables) {
    const key = (SET_NULL_TABLES as readonly string[]).includes(t) ? `${t}_anonymized` : t;
    rows[key] = row?.[t] ?? 0;
  }

  const ref = await userRef(pseudonymSalt(config), userId);
  await db.batch([
    db
      .prepare("UPDATE users SET status = 'deleting', delete_requested_at = ?, session_ver = session_ver + 1 WHERE id = ?")
      .bind(now, userId),
    db
      .prepare(
        `INSERT INTO deletion_log (id, user_ref, kind, requested_at, completed_at, rows_json, r2_objects)
         VALUES (?, ?, 'account', ?, ?, ?, 0)`,
      )
      .bind(crypto.randomUUID(), ref, now, now, JSON.stringify(rows)),
    db
      .prepare(
        `INSERT INTO admin_audit (actor_id, actor_kind, action, target_kind, target_id, detail_json, created_at)
         VALUES (NULL, 'user', 'user.delete', 'user', NULL, '{}', ?)`,
      )
      .bind(now),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}
