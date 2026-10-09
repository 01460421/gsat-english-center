/**
 * /api/me*：目前使用者、首次同意、個資權利（ARCHITECTURE §5、§8.4、§10.2）。負責：後端登入 A1。
 *
 *   GET    /api/me            永遠 200：未登入 {user:null}，已登入 MeResponseSignedIn（@gsat/shared）
 *   PATCH  /api/me            MePatchBody → MeResponseSignedIn（requireUser({ allowPendingConsent: true })）
 *   POST   /api/me/consents   ConsentsPostBody → MeResponseSignedIn（同上；version 必須是現行版本）
 *   GET    /api/me/export     MeExport（附 Content-Disposition 下載；10 分鐘內登入過）
 *   DELETE /api/me            DeleteMeBody → 204（10 分鐘內登入過；同步刪除帳號、寫 deletion_log、清 cookie）
 *
 * 匯出與刪除也用 allowPendingConsent：不同意新版條款的人仍然要能取回或刪除自己的資料。
 */
import {
  AGE_BANDS,
  CONSENT_KINDS,
  CONSENT_VERSION_SOURCE,
  DELETE_ACCOUNT_CONFIRM,
  DISPLAY_NAME_MAX,
  RECENT_LOGIN_MINUTES_SENSITIVE,
  type MeResponse,
} from '@gsat/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { nowSeconds, taiwanDay } from '../time';
import {
  clearSessionCookie,
  getSessionUser,
  reloadSessionUser,
  requireRecentLogin,
  requireUser,
  type SessionUser,
} from '../auth/session';
import { deleteAccount } from './delete';
import { buildExport } from './export';
import { buildMeResponse } from './users';
import { cleanSingleLine, codePointLength, readJsonBody } from './validate';

export const accountRoutes = new Hono<AppEnv>();

/** 暱稱欄位：省略＝不改、null＝清空、字串＝清理後 ≤40 字（清理後是空字串也當成清空）。 */
const displayNameField = z.string().max(400).nullable().optional();

const mePatchSchema = z.object({
  display_name: displayNameField,
  age_band: z.enum(AGE_BANDS).optional(),
});

const consentsSchema = z.object({
  items: z
    .array(z.object({ kind: z.enum(CONSENT_KINDS), version: z.string().min(1).max(64), granted: z.boolean() }))
    .max(CONSENT_KINDS.length * 2),
  age_band: z.enum(AGE_BANDS).optional(),
  display_name: displayNameField,
});

const deleteSchema = z.object({ confirm: z.string().max(100) });

/** 已通過 requireUser 的登入者（中介層保證不是 null）。 */
async function currentUser(c: Context<AppEnv>): Promise<SessionUser> {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  return user;
}

/** 清理暱稱；超過上限 400。undefined＝不改。 */
function normalizeDisplayName(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const cleaned = cleanSingleLine(value);
  if (cleaned !== null && codePointLength(cleaned) > DISPLAY_NAME_MAX) {
    throw new ApiError(400, 'bad_request', `暱稱最多 ${DISPLAY_NAME_MAX} 個字`);
  }
  return cleaned;
}

/**
 * 組出「更新暱稱、年齡區間」的 UPDATE（沒有要改的欄位回 null）。欄位名稱是程式內的常數，不是使用者輸入。
 */
function profileUpdate(
  db: D1Database,
  userId: number,
  fields: { displayName: string | null | undefined; ageBand: string | undefined },
): D1PreparedStatement | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (fields.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(fields.displayName);
  }
  if (fields.ageBand !== undefined) {
    sets.push('age_band = ?');
    params.push(fields.ageBand);
  }
  if (sets.length === 0) return null;
  return db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params, userId);
}

/** 寫入後重新讀取並回傳 MeResponseSignedIn。 */
async function respondMe(c: Context<AppEnv>, user: SessionUser) {
  const fresh = await reloadSessionUser(c, user.id, user.loginAt);
  if (!fresh) throw new ApiError(401, 'unauthorized', '請先登入');
  return c.json(buildMeResponse(fresh, loadConfig(c.env).consentVersions));
}

accountRoutes.get('/', async (c) => {
  const user = await getSessionUser(c);
  const body: MeResponse = user ? buildMeResponse(user, loadConfig(c.env).consentVersions) : { user: null };
  return c.json(body);
});

accountRoutes.patch('/', requireUser({ allowPendingConsent: true }), async (c) => {
  const user = await currentUser(c);
  const body = await readJsonBody(c, mePatchSchema);
  const update = profileUpdate(c.env.DB, user.id, {
    displayName: normalizeDisplayName(body.display_name),
    ageBand: body.age_band,
  });
  if (update) await update.run();
  return respondMe(c, user);
});

accountRoutes.post('/consents', requireUser({ allowPendingConsent: true }), async (c) => {
  const user = await currentUser(c);
  const body = await readJsonBody(c, consentsSchema);
  const versions = loadConfig(c.env).consentVersions;
  for (const item of body.items) {
    if (item.version !== versions[CONSENT_VERSION_SOURCE[item.kind]]) {
      // 前端拿舊頁面同意舊條款：要求重新整理，不記錄（ConsentsPostBody 的約定）。
      throw new ApiError(400, 'bad_request', '條款已更新，請重新整理頁面後再同意');
    }
  }
  const db = c.env.DB;
  const now = nowSeconds();
  const statements: D1PreparedStatement[] = body.items.map((item) =>
    db
      .prepare('INSERT INTO consents (user_id, kind, version, granted, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, item.kind, item.version, item.granted ? 1 : 0, now),
  );
  const update = profileUpdate(db, user.id, {
    displayName: normalizeDisplayName(body.display_name),
    ageBand: body.age_band,
  });
  if (update) statements.push(update);
  if (statements.length > 0) await db.batch(statements);
  return respondMe(c, user);
});

accountRoutes.get('/export', requireUser({ allowPendingConsent: true }), requireRecentLogin(RECENT_LOGIN_MINUTES_SENSITIVE), async (c) => {
  const user = await currentUser(c);
  const data = await buildExport(c.env.DB, user.id);
  c.header('Content-Disposition', `attachment; filename="gsat-export-${taiwanDay()}.json"`);
  return c.json(data);
});

accountRoutes.delete('/', requireUser({ allowPendingConsent: true }), requireRecentLogin(RECENT_LOGIN_MINUTES_SENSITIVE), async (c) => {
  const user = await currentUser(c);
  const body = await readJsonBody(c, deleteSchema);
  if (body.confirm.trim() !== DELETE_ACCOUNT_CONFIRM) {
    throw new ApiError(400, 'bad_request', `請輸入「${DELETE_ACCOUNT_CONFIRM}」確認`);
  }
  await deleteAccount(c.env, loadConfig(c.env), user.id);
  c.set('sessionUser', null);
  clearSessionCookie(c);
  return c.body(null, 204);
});
