/**
 * 帳號端點（ARCHITECTURE §5、§8.4）：/api/me、首次同意、條款改版重新同意、PATCH、匯出與刪除（近期登入）、
 * POST /api/ai/apply（同意紀錄、名額與候補、冷卻與次數上限）、AI 同意改版時 requireAiApproved 擋下。
 */
import { DELETE_ACCOUNT_CONFIRM, type MeExport, type MeResponseSignedIn } from '@gsat/shared';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { requireAiApproved } from '../src/auth/session';
import type { AppEnv } from '../src/env';
import { handleError } from '../src/errors';
import { VERSIONS, authEnv, call, cookieFor, insertUser, nowSec, setCookies, type TestEnv } from './helpers/auth';

let env: TestEnv;
beforeEach(() => {
  env = authEnv();
});

async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code: string } };
  return body.error?.code;
}

const q = (env: TestEnv, sql: string, ...params: (string | number | null)[]) => env.DB.sqlite.prepare(sql).all(...params);

describe('GET /api/me', () => {
  it('未登入：200 {user:null}（沒設定登入也一樣）', async () => {
    for (const e of [env, authEnv({ GOOGLE_CLIENT_ID: undefined })]) {
      const res = await call(e, 'GET', '/api/me');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ user: null });
    }
  });

  it('已登入：PublicUser（不含 email 與內部 id）、現行條款版本、login_at', async () => {
    const u = insertUser(env.DB, { displayName: '小明' });
    const iat = nowSec() - 100;
    const res = await call(env, 'GET', '/api/me', { cookie: await cookieFor(u, { iat }) });
    const text = await res.text();
    expect(text).not.toContain(u.email);
    const body = JSON.parse(text) as MeResponseSignedIn;
    expect(body).toEqual({
      user: {
        id: u.publicId,
        display_name: '小明',
        role: 'student',
        status: 'active',
        age_band: '18plus',
        ai_status: 'none',
        ai_tier: 'standard',
        created_at: expect.any(Number),
      },
      pending_consents: [],
      onboarded: true,
      consent_versions: VERSIONS,
      login_at: iat,
      pending_ai_consents: [],
    });
  });
});

describe('首次登入與條款改版', () => {
  it('首次：requireUser 擋下（consent_required）；送同意＋年齡＋暱稱後通過', async () => {
    const u = insertUser(env.DB, { loginConsents: 'none', ageBand: null, displayName: 'Google 名字' });
    const cookie = await cookieFor(u);
    const me = (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponseSignedIn;
    expect(me.pending_consents).toEqual(['privacy', 'terms']);
    expect(me.onboarded).toBe(false);

    // 需要登入的一般端點被擋下
    const blocked = await call(env, 'POST', '/api/ai/apply', { cookie, json: { note: '', ai_consent_version: VERSIONS.ai, guardian_ack: false } });
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe('consent_required');

    const res = await call(env, 'POST', '/api/me/consents', {
      cookie,
      json: {
        items: [
          { kind: 'privacy', version: VERSIONS.privacy, granted: true },
          { kind: 'terms', version: VERSIONS.terms, granted: true },
        ],
        age_band: 'under18',
        display_name: '  小​明  ',
      },
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as MeResponseSignedIn;
    expect(after.pending_consents).toEqual([]);
    expect(after.onboarded).toBe(true);
    expect(after.user).toMatchObject({ age_band: 'under18', display_name: '小明' });
    expect(q(env, 'SELECT kind, version, granted FROM consents WHERE user_id = ? ORDER BY id', u.id)).toEqual([
      { kind: 'privacy', version: VERSIONS.privacy, granted: 1 },
      { kind: 'terms', version: VERSIONS.terms, granted: 1 },
    ]);
  });

  it('條款改版：舊版本的同意要重新同意；送舊版本 400', async () => {
    const u = insertUser(env.DB, { loginConsents: { privacy: '2026-01-01', terms: VERSIONS.terms } });
    const cookie = await cookieFor(u);
    const me = (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponseSignedIn;
    expect(me.pending_consents).toEqual(['privacy']);
    expect(me.onboarded).toBe(false);

    const stale = await call(env, 'POST', '/api/me/consents', {
      cookie,
      json: { items: [{ kind: 'privacy', version: '2026-01-01', granted: true }] },
    });
    expect(stale.status).toBe(400);

    const ok = await call(env, 'POST', '/api/me/consents', {
      cookie,
      json: { items: [{ kind: 'privacy', version: VERSIONS.privacy, granted: true }] },
    });
    expect(((await ok.json()) as MeResponseSignedIn).pending_consents).toEqual([]);
  });

  it('撤回同意（granted=false）：之後又變成需要同意', async () => {
    const u = insertUser(env.DB);
    const cookie = await cookieFor(u);
    const res = await call(env, 'POST', '/api/me/consents', {
      cookie,
      json: { items: [{ kind: 'terms', version: VERSIONS.terms, granted: false }] },
    });
    expect(((await res.json()) as MeResponseSignedIn).pending_consents).toEqual(['terms']);
  });

  it('格式錯誤：不認得的種類、非 JSON、缺欄位都是 400', async () => {
    const cookie = await cookieFor(insertUser(env.DB));
    const bad = [
      { items: [{ kind: 'marketing', version: VERSIONS.ai, granted: true }] },
      { items: [{ kind: 'privacy', granted: true }] },
      { items: 'privacy' },
    ];
    for (const json of bad) expect((await call(env, 'POST', '/api/me/consents', { cookie, json })).status).toBe(400);
    const notJson = await call(env, 'POST', '/api/me/consents', { cookie, headers: { 'Content-Type': 'text/plain' } });
    expect(notJson.status).toBe(400);
  });
});

describe('PATCH /api/me', () => {
  it('改暱稱與年齡區間；null 清空暱稱；超過 40 字 400；同意未完成也可以改', async () => {
    const u = insertUser(env.DB, { loginConsents: 'none' });
    const cookie = await cookieFor(u);
    let res = await call(env, 'PATCH', '/api/me', { cookie, json: { display_name: '新暱稱', age_band: 'under18' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MeResponseSignedIn).user).toMatchObject({ display_name: '新暱稱', age_band: 'under18' });

    res = await call(env, 'PATCH', '/api/me', { cookie, json: { display_name: null } });
    expect(((await res.json()) as MeResponseSignedIn).user.display_name).toBeNull();

    res = await call(env, 'PATCH', '/api/me', { cookie, json: { display_name: '字'.repeat(41) } });
    expect(res.status).toBe(400);
    res = await call(env, 'PATCH', '/api/me', { cookie, json: { age_band: 'adult' } });
    expect(res.status).toBe(400);
  });

  it('未登入 401；停權 403 account_suspended', async () => {
    expect((await call(env, 'PATCH', '/api/me', { json: {} })).status).toBe(401);
    const s = insertUser(env.DB, { status: 'suspended' });
    const res = await call(env, 'PATCH', '/api/me', { cookie: await cookieFor(s), json: {} });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('account_suspended');
  });
});

describe('匯出與刪除帳號：要 10 分鐘內登入過', () => {
  it('GET /api/me/export：太久以前登入 401 reauth_required；近期登入回 MeExport 並附下載檔名', async () => {
    const u = insertUser(env.DB, { aiStatus: 'pending' });
    const old = await call(env, 'GET', '/api/me/export', { cookie: await cookieFor(u, { iat: nowSec() - 11 * 60 }) });
    expect(old.status).toBe(401);
    expect(await errorCode(old)).toBe('reauth_required');

    const res = await call(env, 'GET', '/api/me/export', { cookie: await cookieFor(u, { iat: nowSec() - 60 }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="gsat-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const data = (await res.json()) as MeExport;
    expect(data.format).toBe('gsat-export/v1');
    expect(data.user).toMatchObject({ id: u.publicId, email: u.email, ai_status: 'pending' });
    expect(data.consents.map((c) => c.kind)).toEqual(['privacy', 'terms', 'ai_processing']);
    expect(data.consents[0]).toMatchObject({ granted: true, version: VERSIONS.privacy });
    expect(data.submissions).toEqual([]);
  });

  it('匯出只含自己的資料（提交與批改）', async () => {
    const me = insertUser(env.DB);
    const other = insertUser(env.DB);
    seedSubmission(env, me.id, 'sub-mine');
    seedSubmission(env, other.id, 'sub-other');
    const data = (await (await call(env, 'GET', '/api/me/export', { cookie: await cookieFor(me) })).json()) as MeExport;
    expect(data.submissions).toHaveLength(1);
    expect(data.submissions[0]).toMatchObject({
      id: 'sub-mine',
      body: { text: 'My essay.' },
      gradings: [{ role: 'primary', program_score: 12, judgments: { ok: true } }],
    });
  });

  it('DELETE /api/me：確認字串錯 400；太久以前登入 401；成功後同步刪除、寫 deletion_log、清 cookie、id 不重用', async () => {
    const u = insertUser(env.DB, { aiStatus: 'approved' });
    seedSubmission(env, u.id, 'sub-1');
    env.DB.sqlite
      .prepare(
        "INSERT INTO ai_ops (id, user_id, task, status, points_reserved, usd_reserved_micros, tw_day, tw_month, created_at) VALUES ('op-1', ?, 'essay_grade', 'settled', 7, 1000, '2026-10-08', '2026-10', 1)",
      )
      .run(u.id);

    expect((await call(env, 'DELETE', '/api/me', { cookie: await cookieFor(u), json: { confirm: '刪除' } })).status).toBe(400);
    const stale = await call(env, 'DELETE', '/api/me', {
      cookie: await cookieFor(u, { iat: nowSec() - 20 * 60 }),
      json: { confirm: DELETE_ACCOUNT_CONFIRM },
    });
    expect(await errorCode(stale)).toBe('reauth_required');

    const cookie = await cookieFor(u);
    const res = await call(env, 'DELETE', '/api/me', { cookie, json: { confirm: DELETE_ACCOUNT_CONFIRM } });
    expect(res.status).toBe(204);
    expect(setCookies(res)['__Host-gsat_sid']?.attrs).toContain('Max-Age=0');

    // 使用者資料 CASCADE 刪除；帳本保留但去識別
    expect(q(env, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', u.id)).toEqual([{ n: 0 }]);
    expect(q(env, 'SELECT COUNT(*) AS n FROM consents WHERE user_id = ?', u.id)).toEqual([{ n: 0 }]);
    expect(q(env, 'SELECT COUNT(*) AS n FROM submissions')).toEqual([{ n: 0 }]);
    expect(q(env, 'SELECT COUNT(*) AS n FROM gradings')).toEqual([{ n: 0 }]);
    expect(q(env, "SELECT user_id FROM ai_ops WHERE id = 'op-1'")).toEqual([{ user_id: null }]);

    // 刪除證明：只有假名與列數，不含 email
    const log = q(env, 'SELECT user_ref, kind, rows_json, completed_at FROM deletion_log') as Array<Record<string, string>>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'account' });
    expect(log[0]!['user_ref']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(log[0]!['rows_json']!)).toMatchObject({ consents: 3, submissions: 1, gradings: 1, ai_ops_anonymized: 1 });
    expect(JSON.stringify(log)).not.toContain(u.email);
    expect(q(env, 'SELECT actor_kind, action, target_id FROM admin_audit')).toEqual([
      { actor_kind: 'user', action: 'user.delete', target_id: null },
    ]);

    // 舊 cookie 失效；新帳號拿到新的 id（AUTOINCREMENT 不重用）
    expect(await (await call(env, 'GET', '/api/me', { cookie })).json()).toEqual({ user: null });
    const next = insertUser(env.DB);
    expect(next.id).toBeGreaterThan(u.id);
  });

  it('同意未完成也可以匯出與刪除（個資權利不受新條款影響）', async () => {
    const u = insertUser(env.DB, { loginConsents: 'none' });
    const cookie = await cookieFor(u);
    expect((await call(env, 'GET', '/api/me/export', { cookie })).status).toBe(200);
    expect((await call(env, 'DELETE', '/api/me', { cookie, json: { confirm: DELETE_ACCOUNT_CONFIRM } })).status).toBe(204);
  });
});

/** 建一份提交與一筆批改（題組外鍵需要 item_groups 的最小列）。 */
function seedSubmission(env: TestEnv, userId: number, id: string) {
  const db = env.DB.sqlite;
  db.prepare(
    `INSERT OR IGNORE INTO item_groups (id, uid, version, section_type, origin, format_version, pick_order, license, derivation, status,
                                         content_hash, face_hash, answer_hash)
     VALUES ('test.g1@1', 'test.g1', 1, 'composition', 'ceec', 'composition-1', 1, 'CEEC-exam', 'verbatim', 'draft', 'h', 'h', 'h')`,
  ).run();
  db.prepare(
    `INSERT INTO submissions (id, user_id, kind, group_id, input_mode, body_json, status) VALUES (?, ?, 'essay', 'test.g1@1', 'typed', ?, 'graded')`,
  ).run(id, userId, JSON.stringify({ text: 'My essay.' }));
  db.prepare(
    `INSERT INTO gradings (id, submission_id, user_id, role, prompt_version, rubric_version, judgments_json, program_score)
     VALUES (?, ?, ?, 'primary', 'p1', 'r1', '{"ok":true}', 12)`,
  ).run(`${id}-g`, id, userId);
}

describe('POST /api/ai/apply', () => {
  const apply = (cookie: string, json: Record<string, unknown> = {}) =>
    call(env, 'POST', '/api/ai/apply', { cookie, json: { note: '想練作文', ai_consent_version: VERSIONS.ai, guardian_ack: false, ...json } });

  it('一般申請：pending、記 ai_processing 同意、次數 +1、存申請說明', async () => {
    const u = insertUser(env.DB);
    const res = await apply(await cookieFor(u), { note: '  想練作文\n\n\n\n謝謝‮ ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ai_status: 'pending' });
    expect(q(env, 'SELECT ai_status, ai_apply_count, ai_apply_note FROM users WHERE id = ?', u.id)).toEqual([
      { ai_status: 'pending', ai_apply_count: 1, ai_apply_note: '想練作文\n\n謝謝' },
    ]);
    expect(q(env, "SELECT version FROM consents WHERE user_id = ? AND kind = 'ai_processing'", u.id)).toEqual([{ version: VERSIONS.ai }]);
  });

  it('未滿 18 歲：沒勾 guardian_ack 400；勾了另記 guardian_ack 同意', async () => {
    const u = insertUser(env.DB, { ageBand: 'under18' });
    const cookie = await cookieFor(u);
    expect((await apply(cookie)).status).toBe(400);
    const res = await apply(cookie, { guardian_ack: true });
    expect(res.status).toBe(200);
    expect(q(env, 'SELECT kind FROM consents WHERE user_id = ? ORDER BY id', u.id)).toEqual([
      { kind: 'privacy' },
      { kind: 'terms' },
      { kind: 'ai_processing' },
      { kind: 'guardian_ack' },
    ]);
  });

  it('AI 同意版本不是現行版本 400；年齡區間沒填 403 consent_required；說明超過 300 字 400', async () => {
    const cookie = await cookieFor(insertUser(env.DB));
    expect((await apply(cookie, { ai_consent_version: '2020-01-01' })).status).toBe(400);
    expect((await apply(cookie, { note: '字'.repeat(301) })).status).toBe(400);
    const noAge = await apply(await cookieFor(insertUser(env.DB, { ageBand: null })));
    expect(noAge.status).toBe(403);
    expect(await errorCode(noAge)).toBe('consent_required');
    // 都沒有寫入
    expect(q(env, "SELECT COUNT(*) AS n FROM consents WHERE kind = 'ai_processing'")).toEqual([{ n: 0 }]);
  });

  it('名額已滿（AI_APPROVAL_CAP）：改排 waitlist；管理員不佔名額', async () => {
    env = authEnv({ AI_APPROVAL_CAP: '2' });
    insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    insertUser(env.DB, { aiStatus: 'approved' });
    const a = insertUser(env.DB);
    expect(await (await apply(await cookieFor(a))).json()).toEqual({ ai_status: 'pending' });
    insertUser(env.DB, { aiStatus: 'approved' });
    const b = insertUser(env.DB);
    expect(await (await apply(await cookieFor(b))).json()).toEqual({ ai_status: 'waitlist' });
  });

  it('自動計算的名額是 49 人', async () => {
    for (let i = 0; i < 49; i++) insertUser(env.DB, { aiStatus: 'approved' });
    expect(await (await apply(await cookieFor(insertUser(env.DB)))).json()).toEqual({ ai_status: 'waitlist' });
  });

  it('冷卻 60 秒、每帳號最多 10 次：429 rate_limited', async () => {
    const u = insertUser(env.DB);
    const cookie = await cookieFor(u);
    expect((await apply(cookie)).status).toBe(200);
    const again = await apply(cookie);
    expect(again.status).toBe(429);
    expect(await errorCode(again)).toBe('rate_limited');

    const maxed = insertUser(env.DB, { aiApplyCount: 10, aiStatus: 'rejected', aiAppliedAt: nowSec() - 3600 });
    const res = await apply(await cookieFor(maxed));
    expect(res.status).toBe(429);
    expect(q(env, 'SELECT ai_apply_count FROM users WHERE id = ?', maxed.id)).toEqual([{ ai_apply_count: 10 }]);
  });

  it('被拒絕後可以再申請（冷卻過後）；AI 被停用 409', async () => {
    const r = insertUser(env.DB, { aiStatus: 'rejected', aiApplyCount: 1, aiAppliedAt: nowSec() - 120 });
    expect(await (await apply(await cookieFor(r))).json()).toEqual({ ai_status: 'pending' });
    const s = insertUser(env.DB, { aiStatus: 'suspended' });
    expect((await apply(await cookieFor(s))).status).toBe(409);
  });

  it('已核准的人再送：不改狀態、不算次數，只補記同意（AI 同意改版後的重新同意）', async () => {
    const u = insertUser(env.DB, { aiStatus: 'approved', aiConsent: false });
    const cookie = await cookieFor(u);
    let me = (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponseSignedIn;
    expect(me.pending_ai_consents).toEqual(['ai_processing']);

    expect(await (await apply(cookie)).json()).toEqual({ ai_status: 'approved' });
    expect(q(env, 'SELECT ai_status, ai_apply_count FROM users WHERE id = ?', u.id)).toEqual([{ ai_status: 'approved', ai_apply_count: 0 }]);
    me = (await (await call(env, 'GET', '/api/me', { cookie })).json()) as MeResponseSignedIn;
    expect(me.pending_ai_consents).toEqual([]);
  });

  it('沒有 Origin 的 POST 被 originGuard 擋下', async () => {
    const cookie = await cookieFor(insertUser(env.DB));
    const res = await call(env, 'POST', '/api/ai/apply', {
      cookie,
      json: { note: '', ai_consent_version: VERSIONS.ai, guardian_ack: false },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});

describe('requireAiApproved', () => {
  const guarded = new Hono<AppEnv>();
  guarded.get('/ai-only', requireAiApproved, (c) => c.text('ok'));
  guarded.onError(handleError);
  const hit = async (cookie: string) => guarded.request('https://gsat.example/ai-only', { headers: { Cookie: cookie } }, env);

  it('已核准且 AI 同意是現行版本：通過', async () => {
    const res = await hit(await cookieFor(insertUser(env.DB, { aiStatus: 'approved' })));
    expect(res.status).toBe(200);
  });

  it('未核准 403 not_approved', async () => {
    const res = await hit(await cookieFor(insertUser(env.DB, { aiStatus: 'pending' })));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('not_approved');
  });

  it('AI_CONSENT_VERSION 改版、或改報未滿 18 歲而沒有 guardian_ack：403 consent_required', async () => {
    const u = insertUser(env.DB, { aiStatus: 'approved' });
    const newVersion = authEnv({ AI_CONSENT_VERSION: '2027-01-01', DB: env.DB });
    let res = await guarded.request('https://gsat.example/ai-only', { headers: { Cookie: await cookieFor(u) } }, newVersion);
    expect(await errorCode(res)).toBe('consent_required');

    const v = insertUser(env.DB, { aiStatus: 'approved' });
    env.DB.sqlite.prepare("UPDATE users SET age_band = 'under18' WHERE id = ?").run(v.id);
    res = await hit(await cookieFor(v));
    expect(await errorCode(res)).toBe('consent_required');
    const me = (await (await call(env, 'GET', '/api/me', { cookie: await cookieFor(v) })).json()) as MeResponseSignedIn;
    expect(me.pending_ai_consents).toEqual(['guardian_ack']);
    expect(me.pending_consents).toEqual([]);
  });

  it('管理員（站主）免 AI 同意', async () => {
    const res = await hit(await cookieFor(insertUser(env.DB, { role: 'admin', aiStatus: 'approved', aiConsent: false })));
    expect(res.status).toBe(200);
  });
});
