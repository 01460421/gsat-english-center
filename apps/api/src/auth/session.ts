/**
 * session cookie 與權限中介層（ARCHITECTURE §5）。負責：後端登入 A1（docs/design/ai-auth-mvp.md §6）。
 *
 * cookie：`__Host-gsat_sid` ＝ base64url({u: users.id, v: session_ver, e: 到期, iat}) + "." + HMAC-SHA256(SESSION_SECRET)，
 * `HttpOnly; Secure; SameSite=Lax; Path=/`，不設 Domain。30 天有效，剩不到 7 天時下一個請求自動換新（沿用原本的 iat）。
 * 簽章的內容前面加了用途標籤 'sid'（src/auth/crypto.ts），同一把機密簽的 OAuth state 不能冒充 session。
 * 每個請求比對 users.session_ver（登出所有裝置、停權、刪帳號都會 +1）。角色、核准狀態一律每次從 D1 讀，
 * 不信任 cookie 裡的任何資訊（cookie 只有 id、版本與時間）。
 *
 * 其他模組只透過這裡的函式取得登入者，不要自己解析 cookie。
 */
import {
  AI_CONSENT_KINDS,
  CONSENT_VERSION_SOURCE,
  LOGIN_CONSENT_KINDS,
  type AccountStatus,
  type AgeBand,
  type AiStatus,
  type AiTier,
  type ConsentKind,
  type ConsentVersions,
  type UserRole,
} from '@gsat/shared';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { loadConfig } from '../config';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import { nowSeconds, taiwanDay } from '../time';
import { signToken, verifyToken } from './crypto';

/** session cookie 名稱（`__Host-` 前綴：瀏覽器強制 host-only＋Secure＋Path=/）。 */
export const SESSION_COOKIE = '__Host-gsat_sid';
/** OAuth 登入 CSRF 用的 nonce cookie（10 分鐘，最多保留 3 個 nonce）。 */
export const OAUTH_COOKIE = '__Host-gsat_oauth';
/** session 有效天數與自動換新門檻。 */
export const SESSION_TTL_DAYS = 30;
export const SESSION_RENEW_WITHIN_DAYS = 7;

const DAY = 86_400;
/** 容許的時鐘誤差（秒）：iat 比伺服器時間晚這麼多以內仍接受。 */
const CLOCK_SKEW_SECONDS = 300;

/** 已驗證的登入者（從 cookie＋users 表組出來，放在 c.var.sessionUser）。 */
export interface SessionUser {
  /** users.id（內部整數，不出 Worker）。 */
  id: number;
  /** users.public_id（回應裡用這個）。 */
  publicId: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  status: AccountStatus;
  ageBand: AgeBand | null;
  aiStatus: AiStatus;
  aiTier: AiTier;
  /** 個別點數覆寫（users.ai_points_day／_month）；null＝用等級預設。 */
  aiPointsDay: number | null;
  aiPointsMonth: number | null;
  sessionVer: number;
  /** cookie 的 iat（Unix 秒）＝這次登入的時間。 */
  loginAt: number;
  /** 登入同意（privacy、terms）是否都是現行版本。 */
  consentsCurrent: boolean;
  // 以下欄位由 getSessionUser 一定會填；宣告成選填，是為了讓其他模組測試裡手寫的 SessionUser 不必跟著改。
  /** users.created_at（Unix 秒）。 */
  createdAt?: number;
  /** 需要（重新）同意的登入同意種類（consentsCurrent 為 false 時非空）。 */
  pendingConsents?: ConsentKind[];
  /**
   * AI 相關同意（ai_processing、未滿 18 歲另加 guardian_ack）缺的種類；非空時 requireAiApproved 回 403 consent_required。
   * 只對 ai_status 是 pending／waitlist／approved 的學生計算；管理員一律空（站主自己免）。
   */
  pendingAiConsents?: ConsentKind[];
}

/** users 表在 session 與帳號端點會用到的欄位。 */
export interface UserRow {
  id: number;
  public_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  status: AccountStatus;
  age_band: AgeBand | null;
  ai_status: AiStatus;
  ai_tier: AiTier;
  ai_points_day: number | null;
  ai_points_month: number | null;
  ai_applied_at: number | null;
  ai_apply_count: number;
  ai_apply_note: string | null;
  ai_reviewed_at: number | null;
  session_ver: number;
  created_at: number;
  last_active_day: string | null;
}

/** SELECT 欄位清單（常數，不含使用者輸入）。 */
export const USER_COLUMNS =
  'id, public_id, email, display_name, role, status, age_band, ai_status, ai_tier, ai_points_day, ai_points_month, ' +
  'ai_applied_at, ai_apply_count, ai_apply_note, ai_reviewed_at, session_ver, created_at, last_active_day';

/** 各同意種類最新一筆紀錄。 */
export interface LatestConsent {
  kind: ConsentKind;
  version: string;
  granted: number;
}

/** 需要 AI 同意的 AI 狀態：已申請（等核准或候補）與已核准。 */
const AI_STATUSES_NEEDING_CONSENT: readonly AiStatus[] = ['pending', 'waitlist', 'approved'];

/** 某種類的最新同意是否為「現行版本、granted=1」。 */
function isConsentCurrent(latest: Map<ConsentKind, LatestConsent>, kind: ConsentKind, versions: ConsentVersions): boolean {
  const row = latest.get(kind);
  return row !== undefined && row.granted === 1 && row.version === versions[CONSENT_VERSION_SOURCE[kind]];
}

/** 由 users 列與最新同意算出 SessionUser（純函式，GET /api/me 與權限檢查共用）。 */
export function toSessionUser(
  row: UserRow,
  consents: readonly LatestConsent[],
  versions: ConsentVersions,
  loginAt: number,
): SessionUser {
  const latest = new Map(consents.map((r) => [r.kind, r]));
  const pendingConsents: ConsentKind[] = LOGIN_CONSENT_KINDS.filter((k) => !isConsentCurrent(latest, k, versions));
  const needsAi = row.role !== 'admin' && AI_STATUSES_NEEDING_CONSENT.includes(row.ai_status);
  const pendingAiConsents: ConsentKind[] = needsAi
    ? AI_CONSENT_KINDS.filter((k) => {
        if (k === 'guardian_ack' && row.age_band !== 'under18') return false;
        return !isConsentCurrent(latest, k, versions);
      })
    : [];
  return {
    id: row.id,
    publicId: row.public_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    ageBand: row.age_band,
    aiStatus: row.ai_status,
    aiTier: row.ai_tier,
    aiPointsDay: row.ai_points_day,
    aiPointsMonth: row.ai_points_month,
    sessionVer: row.session_ver,
    loginAt,
    consentsCurrent: pendingConsents.length === 0,
    createdAt: row.created_at,
    pendingConsents,
    pendingAiConsents,
  };
}

/** 讀一位使用者與他各種類最新的同意（一次往返）。不存在回 null。 */
export async function loadUserWithConsents(
  db: D1Database,
  userId: number,
): Promise<{ row: UserRow; consents: LatestConsent[] } | null> {
  const [users, consents] = await db.batch([
    db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(userId),
    // SQLite 的 MAX() 聚合搭配裸欄位：kind、version、granted 取自 id 最大（最新）的那一列。
    db.prepare('SELECT kind, version, granted, MAX(id) AS latest_id FROM consents WHERE user_id = ? GROUP BY kind').bind(userId),
  ]);
  const row = users?.results[0] as UserRow | undefined;
  if (!row) return null;
  return { row, consents: (consents?.results ?? []) as LatestConsent[] };
}

/** 依 id 重新從 D1 組出 SessionUser（寫入後要回傳最新狀態時用），並更新 c.var 的快取。 */
export async function reloadSessionUser(c: Context<AppEnv>, userId: number, loginAt: number): Promise<SessionUser | null> {
  const loaded = await loadUserWithConsents(c.env.DB, userId);
  const user = loaded ? toSessionUser(loaded.row, loaded.consents, loadConfig(c.env).consentVersions, loginAt) : null;
  c.set('sessionUser', user);
  return user;
}

/** cookie 內容。 */
export interface SessionPayload {
  /** users.id */
  u: number;
  /** users.session_ver */
  v: number;
  /** 到期（Unix 秒） */
  e: number;
  /** 登入時間（Unix 秒；換新時沿用） */
  iat: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 簽出 cookie 的值（測試與 issueSessionCookie 共用）。 */
export function encodeSessionCookie(secret: string, payload: SessionPayload): Promise<string> {
  return signToken(secret, 'sid', payload);
}

/** 驗證 cookie 的值：簽章、欄位型別、未過期、iat 不在未來。不合格回 null。 */
export async function decodeSessionCookie(value: string, secret: string, now: number = nowSeconds()): Promise<SessionPayload | null> {
  const data = await verifyToken(secret, 'sid', value);
  if (typeof data !== 'object' || data === null) return null;
  const p = data as Record<string, unknown>;
  const { u, v, e, iat } = p;
  if (!isPositiveInt(u) || !isPositiveInt(v) || !isPositiveInt(e) || !isPositiveInt(iat)) return null;
  if (e <= now || iat > now + CLOCK_SKEW_SECONDS || e <= iat) return null;
  return { u, v, e, iat };
}

/**
 * 解析並驗證 session（第一次呼叫時查 DB，結果快取在 c.var.sessionUser）。未登入、cookie 無效、
 * session_ver 不符、帳號刪除中都回 null（cookie 無效時順便清掉，下次就不必再驗）。
 * 剩不到 7 天會換新 cookie（沿用 iat）；台灣日期換日後的第一個請求寫一次 last_active_day。
 * 登入相關機密沒設定時一律回 null。DB 錯誤照常丟出（500），不當成未登入。
 */
export async function getSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const cached = c.get('sessionUser');
  if (cached !== undefined) return cached;

  const raw = getCookie(c, SESSION_COOKIE);
  const config = loadConfig(c.env);
  const secret = config.auth.sessionSecret;
  if (!raw || !secret) {
    c.set('sessionUser', null);
    return null;
  }

  const now = nowSeconds();
  const payload = await decodeSessionCookie(raw, secret, now);
  if (!payload) {
    clearSessionCookie(c);
    c.set('sessionUser', null);
    return null;
  }

  const loaded = await loadUserWithConsents(c.env.DB, payload.u);
  if (!loaded || loaded.row.session_ver !== payload.v || loaded.row.status === 'deleting') {
    clearSessionCookie(c);
    c.set('sessionUser', null);
    return null;
  }

  const user = toSessionUser(loaded.row, loaded.consents, config.consentVersions, payload.iat);
  if (payload.e - now < SESSION_RENEW_WITHIN_DAYS * DAY) {
    await issueSessionCookie(c, { id: user.id, sessionVer: user.sessionVer }, { iat: payload.iat });
  }
  await touchLastActiveDay(c.env, loaded.row, now);
  c.set('sessionUser', user);
  return user;
}

/** last_active_day 一天最多寫一次（DB_SCHEMA §3.4）；寫失敗不影響這個請求。 */
async function touchLastActiveDay(env: Env, row: UserRow, now: number): Promise<void> {
  const today = taiwanDay(now * 1000);
  if (row.last_active_day === today) return;
  try {
    await env.DB.prepare('UPDATE users SET last_active_day = ? WHERE id = ? AND (last_active_day IS NULL OR last_active_day <> ?)')
      .bind(today, row.id, today)
      .run();
  } catch (err) {
    console.warn('更新 last_active_day 失敗', err instanceof Error ? err.message : 'unknown');
  }
}

/**
 * 要求登入。未登入 401 unauthorized；停權 403 account_suspended；
 * 登入同意不是現行版本 403 consent_required（options.allowPendingConsent 為 true 時略過，給 /api/me/consents、PATCH /api/me、
 * 匯出、刪帳號、登出所有裝置用：不同意新條款的人仍然要能行使個資權利與登出）。
 */
export function requireUser(options: { allowPendingConsent?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await getSessionUser(c);
    if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
    if (user.status !== 'active') throw new ApiError(403, 'account_suspended', '帳號已停權');
    if (!options.allowPendingConsent && !user.consentsCurrent) {
      throw new ApiError(403, 'consent_required', '請先同意最新版的隱私權說明與服務條款');
    }
    await next();
  };
}

/**
 * 要求 AI 已核准（含 requireUser 的檢查）。未核准 403 not_approved；
 * AI 資料處理說明改版後尚未重新同意（pendingAiConsents 非空）403 consent_required。
 */
export const requireAiApproved: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireUser()(c, async () => {
    const user = await getSessionUser(c);
    if (user?.aiStatus !== 'approved') throw new ApiError(403, 'not_approved', 'AI 功能尚未核准');
    if ((user.pendingAiConsents?.length ?? 0) > 0) {
      throw new ApiError(403, 'consent_required', 'AI 資料處理說明已更新，請到「申請 AI」頁重新同意');
    }
    await next();
  });
};

/** 要求管理員（含 requireUser 的檢查）。非管理員 403 forbidden。角色每次從 D1 讀。 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  await requireUser()(c, async () => {
    const user = await getSessionUser(c);
    if (user?.role !== 'admin') throw new ApiError(403, 'forbidden', '需要管理員權限');
    await next();
  });
};

/**
 * 要求 session 在 minutes 分鐘內登入過（刪帳號、匯出 10 分鐘；後台寫入 12 小時）。
 * 太舊回 401 reauth_required，前端導向 /auth/google/start?next=… 重新登入。須放在 requireUser 之後。
 * 依據是 cookie 的 iat：自動換新沿用原 iat，所以換新不會讓「近期登入」變新。
 */
export function requireRecentLogin(minutes: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await getSessionUser(c);
    if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
    if (nowSeconds() - user.loginAt > minutes * 60) {
      throw new ApiError(401, 'reauth_required', `這個操作需要在 ${minutes} 分鐘內重新登入`);
    }
    await next();
  };
}

/** session cookie 的共同屬性（`__Host-` 前綴要求 Secure、Path=/、不設 Domain）。 */
const SESSION_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' } as const;

/**
 * 簽發 session cookie（登入成功、自動換新時）。iat 預設為現在；換新時沿用原本的 iat
 * （否則「10 分鐘內登入過」會被換新繞過）。登入機密沒設定時 503 not_configured。
 */
export async function issueSessionCookie(
  c: Context<AppEnv>,
  user: { id: number; sessionVer: number },
  options: { iat?: number } = {},
): Promise<void> {
  const secret = loadConfig(c.env).auth.sessionSecret;
  if (!secret) throw new ApiError(503, 'not_configured', '登入功能尚未設定');
  const now = nowSeconds();
  const ttl = SESSION_TTL_DAYS * DAY;
  const value = await encodeSessionCookie(secret, { u: user.id, v: user.sessionVer, e: now + ttl, iat: options.iat ?? now });
  setCookie(c, SESSION_COOKIE, value, { ...SESSION_COOKIE_OPTIONS, maxAge: ttl });
}

/** 清除 session cookie（登出、cookie 無效時）。 */
export function clearSessionCookie(c: Context<AppEnv>): void {
  setCookie(c, SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
}
