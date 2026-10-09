/**
 * users 表的存取與回應形狀轉換（PublicUser、MeResponseSignedIn、AdminUserRow）。負責：後端登入 A1。
 * 所有 SQL 都是常數字串＋綁定參數；回應裡只用 public_id，內部整數 id 不出 Worker。
 */
import {
  DISPLAY_NAME_MAX,
  type AdminUserRow,
  type ConsentVersions,
  type MeResponseSignedIn,
  type PublicUser,
} from '@gsat/shared';
import type { AppConfig } from '../config';
import { taiwanDay } from '../time';
import type { GoogleIdentity } from '../auth/oauth';
import { USER_COLUMNS, type SessionUser, type UserRow } from '../auth/session';
import { cleanSingleLine, truncateCodePoints } from './validate';

/** SessionUser → PublicUser（/api/me）。 */
export function sessionToPublicUser(user: SessionUser): PublicUser {
  return {
    id: user.publicId,
    display_name: user.displayName,
    role: user.role,
    status: user.status,
    age_band: user.ageBand,
    ai_status: user.aiStatus,
    ai_tier: user.aiTier,
    created_at: user.createdAt ?? 0,
  };
}

/** GET /api/me 等端點的已登入回應。 */
export function buildMeResponse(user: SessionUser, versions: ConsentVersions): MeResponseSignedIn {
  const pending = user.pendingConsents ?? [];
  return {
    user: sessionToPublicUser(user),
    pending_consents: pending,
    onboarded: pending.length === 0 && user.ageBand !== null,
    consent_versions: { ...versions },
    login_at: user.loginAt,
    pending_ai_consents: user.pendingAiConsents ?? [],
  };
}

/** users 列 → 後台列表的一列（不含任何學習內容；ai_apply_note 由前端標示為不可信）。 */
export function toAdminUserRow(row: UserRow): AdminUserRow {
  return {
    id: row.public_id,
    display_name: row.display_name,
    role: row.role,
    status: row.status,
    age_band: row.age_band,
    ai_status: row.ai_status,
    ai_tier: row.ai_tier,
    created_at: row.created_at,
    email: row.email,
    ai_apply_note: row.ai_apply_note,
    ai_apply_count: row.ai_apply_count,
    ai_applied_at: row.ai_applied_at,
    ai_reviewed_at: row.ai_reviewed_at,
    last_active_day: row.last_active_day,
  };
}

/** 依 public_id 讀一位使用者。 */
export async function loadUserByPublicId(db: D1Database, publicId: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE public_id = ?`).bind(publicId).first<UserRow>();
}

/** Google 名稱 → 預設暱稱（清理後截到 40 個字；沒有就 null）。 */
export function defaultDisplayName(name: string | null): string | null {
  if (name === null) return null;
  const cleaned = cleanSingleLine(name);
  return cleaned === null ? null : truncateCodePoints(cleaned, DISPLAY_NAME_MAX);
}

/**
 * 登入回呼：以 Google sub 找或建帳號（一個 batch＝一個交易）。
 *   - 新帳號：public_id＝crypto.randomUUID()、暱稱預設取 Google 名稱。
 *   - 舊帳號：只更新 email（Google 端可能改過）與 last_active_day；暱稱不動（學生可能改過）。
 *   - ADMIN_EMAIL bootstrap：信箱等於 ADMIN_EMAIL、而且站上**還沒有任何管理員**時，設為 admin、核准 AI、unlimited，
 *     並寫一筆 admin_audit（actor_kind='system'）。「還沒有管理員」這個條件讓 bootstrap 只發生一次：
 *     之後以 sub 為準，就算 ADMIN_EMAIL 改了、或別的 Google 帳號用了同一個信箱，也不會多出管理員；
 *     站主在設定 ADMIN_EMAIL 之前就先登入過也沒關係（下次登入時補上）。
 */
export async function upsertGoogleUser(db: D1Database, config: AppConfig, identity: GoogleIdentity, now: number): Promise<UserRow> {
  const today = taiwanDay(now * 1000);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO users (public_id, google_sub, email, display_name, created_at, last_active_day)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, last_active_day = excluded.last_active_day`,
      )
      .bind(crypto.randomUUID(), identity.sub, identity.email, defaultDisplayName(identity.name), now, today),
  ];
  if (config.auth.adminEmail !== null && identity.email === config.auth.adminEmail) {
    const bootstrap = "google_sub = ? AND status = 'active' AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')";
    // 稽核寫在 UPDATE 之前：兩句看到的是同一個狀態（UPDATE 之後「沒有管理員」就不成立了）。
    statements.push(
      db
        .prepare(
          `INSERT INTO admin_audit (actor_id, actor_kind, action, target_kind, target_id, detail_json, created_at)
           SELECT NULL, 'system', 'user.bootstrap_admin', 'user', public_id, '{}', ? FROM users WHERE ${bootstrap}`,
        )
        .bind(now, identity.sub),
      db
        .prepare(
          `UPDATE users SET role = 'admin', ai_status = 'approved', ai_tier = 'unlimited', ai_reviewed_at = ?
           WHERE ${bootstrap}`,
        )
        .bind(now, identity.sub),
    );
  }
  statements.push(db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE google_sub = ?`).bind(identity.sub));
  const results = await db.batch(statements);
  const row = results[results.length - 1]?.results[0] as UserRow | undefined;
  if (!row) throw new Error('建立或讀取使用者失敗');
  return row;
}
