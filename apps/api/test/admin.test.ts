/**
 * 後台（ARCHITECTURE §6.3、§7「後台越權」、§10.5）：權限（401／403）、12 小時內登入才能寫入、health 只回布林、
 * 遷移狀態、§6.3 啟動檢查與 ops_events、使用者列表（篩選、分頁、不含學習內容）、核准動作（名額、稽核、停權）。
 */
import type { AdminHealthResponse, AdminUserActionResponse, AdminUsersResponse } from '@gsat/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../src/admin/migrations';
import { createTestD1, migrationFileNames } from './helpers/d1';
import { VERSIONS, authEnv, call, cookieFor, insertUser, nowSec, type TestEnv, type TestUser } from './helpers/auth';

let env: TestEnv;
let admin: TestUser;
let adminCookie: string;

beforeEach(async () => {
  env = authEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-secret-value' });
  admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved', email: 'owner@example.com' });
  adminCookie = await cookieFor(admin);
  // isAiPaused 在 ai_budget_daily 查不到時不寫 log；這裡只是保險
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function errorCode(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

const q = (sql: string, ...params: (string | number | null)[]) => env.DB.sqlite.prepare(sql).all(...params);

describe('權限', () => {
  const endpoints: Array<[string, string]> = [
    ['GET', '/api/admin/health'],
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users/00000000-0000-4000-8000-000000000000/approve'],
  ];

  it.each(endpoints)('%s %s：未登入 401、學生 403 forbidden', async (method, path) => {
    expect((await call(env, method, path)).status).toBe(401);
    const res = await call(env, method, path, { cookie: await cookieFor(insertUser(env.DB)) });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe('forbidden');
  });

  it('角色每次從 D1 讀：管理員被降為學生後，同一個 cookie 立刻失去權限', async () => {
    env.DB.sqlite.prepare("UPDATE users SET role = 'student' WHERE id = ?").run(admin.id);
    expect((await call(env, 'GET', '/api/admin/health', { cookie: adminCookie })).status).toBe(403);
  });

  it('寫入動作要 12 小時內登入過（401 reauth_required）；讀取不用', async () => {
    const target = insertUser(env.DB, { aiStatus: 'pending' });
    const old = await cookieFor(admin, { iat: nowSec() - 13 * 3600 });
    expect((await call(env, 'GET', '/api/admin/users', { cookie: old })).status).toBe(200);
    const res = await call(env, 'POST', `/api/admin/users/${target.publicId}/approve`, { cookie: old });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe('reauth_required');
    expect(q('SELECT ai_status FROM users WHERE id = ?', target.id)).toEqual([{ ai_status: 'pending' }]);
  });

  it('不存在的 /api/admin 路徑是 404，不是 401（中介層掛在個別路由上）', async () => {
    expect((await call(env, 'GET', '/api/admin/nope')).status).toBe(404);
  });
});

describe('GET /api/admin/health', () => {
  it('設定只回布林、不含任何機密值；遷移都已套用；預設的啟動檢查全部通過', async () => {
    const res = await call(env, 'GET', '/api/admin/health', { cookie: adminCookie });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const secret of ['sk-ant-test-secret-value', 'test-client-secret', 'test-session-secret', 'test-ledger-salt', 'owner@example.com']) {
      expect(text).not.toContain(secret);
    }
    const body = JSON.parse(text) as AdminHealthResponse;
    expect(body.config).toEqual({
      google_client_id: true,
      google_client_secret: true,
      session_secret: true,
      admin_email: true,
      ledger_salt: true,
      anthropic_api_key: true,
      ai_queue: false,
    });
    for (const value of Object.values(body.config)) expect(typeof value).toBe('boolean');
    expect(body.migrations).toEqual({ applied: migrationFileNames(), expected: [...EXPECTED_MIGRATIONS], ok: true });
    expect(body.startup_checks.map((c) => c.id)).toEqual(['site_vs_online', 'workspaces_vs_tier', 'daily_vs_monthly']);
    expect(body.approvals_allowed).toBe(true);
    expect(body.ai).toEqual({ paused: false, approval_cap: 49, approved: 0 });
    expect(body.ops_events).toEqual({ open: 0, open_errors: 0 });
  });

  it('遷移沒有全部套用：ok=false', async () => {
    env = authEnv({ DB: createTestD1({ migrations: ['0001_init.sql'] }) });
    if (EXPECTED_MIGRATIONS.length < 2) return; // 只有一支遷移時這個情境不存在
    const a = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const body = (await (await call(env, 'GET', '/api/admin/health', { cookie: await cookieFor(a) })).json()) as AdminHealthResponse;
    expect(body.migrations.applied).toEqual(['0001_init.sql']);
    expect(body.migrations.ok).toBe(false);
  });

  it('§6.3 啟動檢查不通過：approvals_allowed=false、寫一筆 ops_events(error)（24 小時內不重複寫）、核准被拒', async () => {
    env = authEnv({ DB: env.DB, ANTHROPIC_PIPELINE_SPEND_LIMIT_USD: '150' });
    const res1 = (await (await call(env, 'GET', '/api/admin/health', { cookie: adminCookie })).json()) as AdminHealthResponse;
    expect(res1.approvals_allowed).toBe(false);
    expect(res1.startup_checks.find((c) => c.id === 'workspaces_vs_tier')?.ok).toBe(false);
    expect(res1.ops_events).toEqual({ open: 1, open_errors: 1 });
    await call(env, 'GET', '/api/admin/health', { cookie: adminCookie });
    const events = q('SELECT kind, severity, detail_json FROM ops_events');
    expect(events).toEqual([{ kind: 'startup_check_failed', severity: 'error', detail_json: '{"failed":["workspaces_vs_tier"]}' }]);

    const target = insertUser(env.DB, { aiStatus: 'pending' });
    const res = await call(env, 'POST', `/api/admin/users/${target.publicId}/approve`, { cookie: adminCookie });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe('conflict');
  });

  it('EXPECTED_MIGRATIONS 和 migrations/*.sql 一致（新增遷移檔時要把檔名加進 src/admin/migrations.ts）', () => {
    expect([...EXPECTED_MIGRATIONS]).toEqual(migrationFileNames());
  });
});

describe('GET /api/admin/users', () => {
  it('列表：AdminUserRow（含 email 與申請說明）、名額摘要；不含學習內容', async () => {
    const s = insertUser(env.DB, { aiStatus: 'pending', displayName: '小華' });
    env.DB.sqlite.prepare("UPDATE users SET ai_apply_note = '想練作文' WHERE id = ?").run(s.id);
    const res = await call(env, 'GET', '/api/admin/users', { cookie: adminCookie });
    const body = (await res.json()) as AdminUsersResponse;
    expect(body.approval).toEqual({ cap: 49, approved: 0 });
    expect(body.next_cursor).toBeNull();
    expect(body.users.map((u) => u.id)).toEqual([s.publicId, admin.publicId]);
    expect(body.users[0]).toEqual({
      id: s.publicId,
      display_name: '小華',
      role: 'student',
      status: 'active',
      age_band: '18plus',
      ai_status: 'pending',
      ai_tier: 'standard',
      created_at: expect.any(Number),
      email: s.email,
      ai_apply_note: '想練作文',
      ai_apply_count: 0,
      ai_applied_at: null,
      ai_reviewed_at: null,
      last_active_day: null,
    });
  });

  it('依 ai_status 篩選；不合法的值 400', async () => {
    const p = insertUser(env.DB, { aiStatus: 'pending' });
    insertUser(env.DB, { aiStatus: 'rejected' });
    const body = (await (await call(env, 'GET', '/api/admin/users?ai_status=pending', { cookie: adminCookie })).json()) as AdminUsersResponse;
    expect(body.users.map((u) => u.id)).toEqual([p.publicId]);
    expect((await call(env, 'GET', '/api/admin/users?ai_status=root', { cookie: adminCookie })).status).toBe(400);
    expect((await call(env, 'GET', '/api/admin/users?cursor=1', { cookie: adminCookie })).status).toBe(400);
  });

  it('分頁：每頁 50 筆，next_cursor 是 public_id（不外露內部 id）', async () => {
    for (let i = 0; i < 55; i++) insertUser(env.DB);
    const page1 = (await (await call(env, 'GET', '/api/admin/users', { cookie: adminCookie })).json()) as AdminUsersResponse;
    expect(page1.users).toHaveLength(50);
    expect(page1.next_cursor).toBe(page1.users[49]?.id);
    const page2 = (await (
      await call(env, 'GET', `/api/admin/users?cursor=${page1.next_cursor}`, { cookie: adminCookie })
    ).json()) as AdminUsersResponse;
    expect(page2.users).toHaveLength(6);
    expect(page2.next_cursor).toBeNull();
    expect(new Set([...page1.users, ...page2.users].map((u) => u.id)).size).toBe(56);
  });
});

describe('POST /api/admin/users/:id/:action', () => {
  const act = (u: TestUser, action: string) => call(env, 'POST', `/api/admin/users/${u.publicId}/${action}`, { cookie: adminCookie });

  it('approve：狀態、核准者與時間、admin_audit（只記前後值）', async () => {
    const s = insertUser(env.DB, { aiStatus: 'pending' });
    const res = await act(s, 'approve');
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminUserActionResponse;
    expect(body.user).toMatchObject({ id: s.publicId, ai_status: 'approved', ai_reviewed_at: expect.any(Number) });
    expect(q('SELECT ai_reviewed_by FROM users WHERE id = ?', s.id)).toEqual([{ ai_reviewed_by: admin.id }]);
    expect(q('SELECT actor_id, actor_kind, action, target_kind, target_id, detail_json FROM admin_audit')).toEqual([
      {
        actor_id: admin.id,
        actor_kind: 'admin',
        action: 'user.approve',
        target_kind: 'user',
        target_id: s.publicId,
        detail_json: '{"field":"ai_status","from":"pending","to":"approved"}',
      },
    ]);
    // 再按一次：冪等，不重複寫稽核
    expect((await act(s, 'approve')).status).toBe(200);
    expect(q('SELECT COUNT(*) AS n FROM admin_audit')).toEqual([{ n: 1 }]);
  });

  it('approve：名額已滿 409，狀態不變、不寫稽核；管理員本人不佔名額', async () => {
    env = authEnv({ DB: env.DB, AI_APPROVAL_CAP: '1' });
    insertUser(env.DB, { aiStatus: 'approved' });
    const w = insertUser(env.DB, { aiStatus: 'waitlist' });
    const res = await act(w, 'approve');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('名額已滿');
    expect(q('SELECT ai_status FROM users WHERE id = ?', w.id)).toEqual([{ ai_status: 'waitlist' }]);
    expect(q('SELECT COUNT(*) AS n FROM admin_audit')).toEqual([{ n: 0 }]);
  });

  it('approve：同時核准兩個人搶最後一個名額，只有一個成功（計數與更新在同一句 SQL）', async () => {
    env = authEnv({ DB: env.DB, AI_APPROVAL_CAP: '1' });
    const a = insertUser(env.DB, { aiStatus: 'pending' });
    const b = insertUser(env.DB, { aiStatus: 'pending' });
    const statuses = (await Promise.all([act(a, 'approve'), act(b, 'approve')])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(q("SELECT COUNT(*) AS n FROM users WHERE ai_status = 'approved' AND role = 'student'")).toEqual([{ n: 1 }]);
    expect(q('SELECT COUNT(*) AS n FROM admin_audit')).toEqual([{ n: 1 }]);
  });

  it('approve：從未申請（none）也可以核准，但 AI 要等學生本人同意 ai_processing；reject／waitlist 對 none 409', async () => {
    const n = insertUser(env.DB);
    for (const action of ['reject', 'waitlist']) expect((await act(n, action)).status).toBe(409);
    const res = await act(n, 'approve');
    expect(((await res.json()) as AdminUserActionResponse).user.ai_status).toBe('approved');
    const me = (await (await call(env, 'GET', '/api/me', { cookie: await cookieFor(n) })).json()) as { pending_ai_consents: string[] };
    expect(me.pending_ai_consents).toEqual(['ai_processing']);
  });

  it('reject 與 waitlist', async () => {
    const s = insertUser(env.DB, { aiStatus: 'pending' });
    expect(((await (await act(s, 'waitlist')).json()) as AdminUserActionResponse).user.ai_status).toBe('waitlist');
    expect(((await (await act(s, 'reject')).json()) as AdminUserActionResponse).user.ai_status).toBe('rejected');
    expect(q('SELECT action FROM admin_audit ORDER BY id')).toEqual([{ action: 'user.waitlist' }, { action: 'user.reject' }]);
  });

  it('suspend：停用 AI（ai_status=suspended，帳號照常登入、不能自己再申請）；unsuspend 恢復為 approved', async () => {
    const s = insertUser(env.DB, { aiStatus: 'approved' });
    const studentCookie = await cookieFor(s);
    const res = await act(s, 'suspend');
    expect(((await res.json()) as AdminUserActionResponse).user).toMatchObject({ status: 'active', ai_status: 'suspended' });
    // 帳號仍是登入狀態，但不能再申請
    const me = (await (await call(env, 'GET', '/api/me', { cookie: studentCookie })).json()) as { user: { ai_status: string } };
    expect(me.user.ai_status).toBe('suspended');
    const apply = await call(env, 'POST', '/api/ai/apply', {
      cookie: studentCookie,
      json: { note: '', ai_consent_version: VERSIONS.ai, guardian_ack: false },
    });
    expect(apply.status).toBe(409);

    const back = await act(s, 'unsuspend');
    expect(((await back.json()) as AdminUserActionResponse).user).toMatchObject({ status: 'active', ai_status: 'approved' });
    expect(q('SELECT action, detail_json FROM admin_audit ORDER BY id')).toEqual([
      { action: 'user.suspend', detail_json: '{"field":"ai_status","from":"approved","to":"suspended"}' },
      { action: 'user.unsuspend', detail_json: '{"field":"ai_status","from":"suspended","to":"approved"}' },
    ]);
  });

  it('unsuspend：名額已滿 409；沒有被停用的人 409', async () => {
    env = authEnv({ DB: env.DB, AI_APPROVAL_CAP: '1' });
    const s = insertUser(env.DB, { aiStatus: 'suspended' });
    insertUser(env.DB, { aiStatus: 'approved' });
    const full = await act(s, 'unsuspend');
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: { message: string } }).error.message).toContain('名額已滿');
    expect((await act(insertUser(env.DB, { aiStatus: 'pending' }), 'unsuspend')).status).toBe(409);
  });

  it('不能停用自己的 AI（409）', async () => {
    expect((await act(admin, 'suspend')).status).toBe(409);
    expect(q('SELECT ai_status FROM users WHERE id = ?', admin.id)).toEqual([{ ai_status: 'approved' }]);
  });

  it('找不到的使用者 404、不認得的動作 400、沒有 Origin 403', async () => {
    expect((await call(env, 'POST', `/api/admin/users/${crypto.randomUUID()}/approve`, { cookie: adminCookie })).status).toBe(404);
    expect((await call(env, 'POST', '/api/admin/users/not-a-uuid/approve', { cookie: adminCookie })).status).toBe(404);
    const s = insertUser(env.DB, { aiStatus: 'pending' });
    expect((await act(s, 'promote')).status).toBe(400);
    const res = await call(env, 'POST', `/api/admin/users/${s.publicId}/approve`, {
      cookie: adminCookie,
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
