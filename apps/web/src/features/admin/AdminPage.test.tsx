/**
 * /admin：非管理員無權限、設定與啟動檢查的紅綠燈、使用者列表篩選與核准等操作（含錯誤與 reauth_required）、
 * 全站 AI 暫停開關、用量摘要，以及後端還沒做完（501）時只影響那一區。
 */
import type { AdminHealthResponse, AdminUsageResponse, AdminUserRow, AdminUsersResponse } from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetOnboardingRedirectForTests } from '../account/RequireAccount';
import { FEATURES_ON, apiError, json, mockApi, noContent, renderApp, signedInMe, type ApiCall } from '../account/testing';

afterEach(() => resetOnboardingRedirectForTests());

const ADMIN_ME = signedInMe({ user: { role: 'admin', display_name: '站主', ai_status: 'approved', ai_tier: 'unlimited' } });

const HEALTH: AdminHealthResponse = {
  config: {
    google_client_id: true,
    google_client_secret: true,
    session_secret: true,
    admin_email: true,
    ledger_salt: false,
    anthropic_api_key: true,
    ai_queue: true,
  },
  migrations: { applied: ['0001_init.sql'], expected: ['0001_init.sql', '0002_photos.sql'], ok: false },
  startup_checks: [
    { id: 'site_vs_online', ok: true, detail: '400＋20 ≤ 450', severity: 'error' },
    { id: 'workspaces_vs_tier', ok: false, detail: '450＋150＋50 ＞ 500', severity: 'error' },
    { id: 'daily_vs_monthly', ok: false, detail: '5 × 31 ＜ 200', severity: 'warn' },
  ],
  approvals_allowed: false,
  ai: { paused: false, approval_cap: 49, approved: 2 },
};

function row(overrides: Partial<AdminUserRow>): AdminUserRow {
  return {
    id: 'u-1',
    display_name: '小華',
    role: 'student',
    status: 'active',
    age_band: 'under18',
    ai_status: 'pending',
    ai_tier: 'standard',
    created_at: 1_790_000_000,
    email: 'hua@example.com',
    ai_apply_note: '<b>想練作文</b>',
    ai_apply_count: 1,
    ai_applied_at: 1_791_000_000,
    ai_reviewed_at: null,
    last_active_day: '2026-10-07',
    ...overrides,
  };
}

const USAGE: AdminUsageResponse = {
  from: '2026-10-02',
  to: '2026-10-08',
  totals: { ops: 12, points: 50, usd_micros: 1_234_567, refunded_ops: 1 },
  by_day: [{ tw_day: '2026-10-08', ops: 12, points: 50, usd_micros: 1_234_567 }],
  by_task: [
    { task: 'essay_grade', ops: 5, points: 35, usd_micros: 950_000 },
    { task: 'translation_grade', ops: 7, points: 21, usd_micros: 284_567 },
  ],
  budget: { site_day_usd: 20, site_month_usd: 400, today_usd_micros: 1_234_567, month_usd_micros: 9_000_000 },
};

function usersResponse(users: AdminUserRow[], approved = 2): AdminUsersResponse {
  return { users, next_cursor: null, approval: { cap: 49, approved } };
}

function adminRoutes(extra: Record<string, object | ((call: ApiCall) => Response)> = {}) {
  return {
    'GET /api/features': FEATURES_ON,
    'GET /api/me': ADMIN_ME,
    'GET /api/admin/health': HEALTH,
    'GET /api/admin/users': (call: ApiCall) =>
      json(call.path.includes('ai_status=approved') ? usersResponse([row({ id: 'u-2', display_name: '小美', ai_status: 'approved' })]) : usersResponse([row({})])),
    'GET /api/admin/usage': USAGE,
    ...extra,
  };
}

async function openAdmin() {
  renderApp('/admin');
  await screen.findByRole('heading', { level: 1, name: '管理後台' }, { timeout: 5000 });
  return screen.getByRole('main');
}

function section(main: HTMLElement, title: string): HTMLElement {
  const heading = within(main).getByRole('heading', { level: 2, name: title });
  const el = heading.closest('section');
  if (!el) throw new Error(`找不到區塊：${title}`);
  return el;
}

describe('權限', () => {
  it('非管理員：顯示沒有權限，不打任何後台 API', async () => {
    const api = mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe() });
    const main = await openAdmin();
    expect(await within(main).findByText(/你沒有管理後台的權限/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.startsWith('/api/admin'))).toHaveLength(0);
  });
});

describe('設定與啟動檢查', () => {
  it('布林設定、遷移與三條啟動檢查都用文字＋紅綠燈顯示', async () => {
    mockApi(adminRoutes());
    const main = await openAdmin();
    await within(main).findByText('LEDGER_SALT', { exact: false });
    const health = section(main, '設定與啟動檢查');
    const ledger = within(health).getByText('帳本假名鹽（LEDGER_SALT）').closest('li');
    if (!ledger) throw new Error('找不到 LEDGER_SALT 那一列');
    expect(within(ledger).getByText('未設定')).toBeInTheDocument();
    const key = within(health).getByText('Anthropic API 金鑰（ANTHROPIC_API_KEY）').closest('li');
    if (!key) throw new Error('找不到 API 金鑰那一列');
    expect(within(key).getByText('已設定')).toBeInTheDocument();
    expect(within(health).getByText('尚未套用完')).toBeInTheDocument();
    expect(within(health).getByText('尚未套用：0002_photos.sql')).toBeInTheDocument();
    expect(within(health).getByText('450＋150＋50 ＞ 500')).toBeInTheDocument();
    expect(within(health).getByText('未通過')).toBeInTheDocument();
    expect(within(health).getByText('提醒')).toBeInTheDocument();
    expect(within(health).getByText('通過')).toBeInTheDocument();
    expect(within(health).getByRole('alert')).toHaveTextContent('後端會拒絕新的 AI 核准');
    expect(within(health).getByText('已核准 2／名額 49 人')).toBeInTheDocument();
    expect(within(health).queryByText('未確認事件')).not.toBeInTheDocument();
  });

  it('有未確認的維運事件時顯示件數（後端新版的 ops_events）', async () => {
    mockApi(adminRoutes({ 'GET /api/admin/health': { ...HEALTH, ops_events: { open: 3, open_errors: 1 } } }));
    const main = await openAdmin();
    const health = section(main, '設定與啟動檢查');
    expect(await within(health).findByText('3 件（錯誤 1 件）')).toBeInTheDocument();
  });

  it('health 還沒做完（501）：那一區顯示建置中，使用者與用量照常', async () => {
    mockApi(adminRoutes({ 'GET /api/admin/health': () => apiError('not_implemented', 501) }));
    const main = await openAdmin();
    expect(await within(section(main, '設定與啟動檢查')).findByText('這個功能還在建置中，即將開放')).toBeInTheDocument();
    expect(await within(section(main, '使用者與 AI 申請')).findByText('hua@example.com')).toBeInTheDocument();
    expect((await within(section(main, 'AI 用量摘要')).findAllByText('US$1.23')).length).toBeGreaterThan(0);
  });
});

describe('使用者與 AI 申請', () => {
  it('預設列出待審核；申請說明以純文字顯示並標示未經查證', async () => {
    const api = mockApi(adminRoutes());
    const main = await openAdmin();
    const users = section(main, '使用者與 AI 申請');
    expect(await within(users).findByText('hua@example.com')).toBeInTheDocument();
    expect(api.callsTo('GET', '/api/admin/users')[0]?.path).toBe('/api/admin/users?ai_status=pending');
    expect(within(users).getByText('申請說明（使用者填寫，未經查證）')).toBeInTheDocument();
    expect(within(users).getByText('<b>想練作文</b>')).toBeInTheDocument();
    expect(within(users).getByText((_, el) => el?.tagName === 'P' && el.textContent === '已核准 2／名額 49 人')).toBeInTheDocument();
  });

  it('核准：POST /api/admin/users/{id}/approve，顯示結果並重新讀列表', async () => {
    const user = userEvent.setup();
    let approved = false;
    const api = mockApi(
      adminRoutes({
        'GET /api/admin/users': () => json(usersResponse(approved ? [] : [row({})], approved ? 3 : 2)),
        'POST /api/admin/users/u-1/approve': () => {
          approved = true;
          return json({ user: row({ ai_status: 'approved' }) });
        },
      }),
    );
    const main = await openAdmin();
    const users = section(main, '使用者與 AI 申請');
    await user.click(await within(users).findByRole('button', { name: '核准：小華' }));
    expect(await within(users).findByText('已核准：小華')).toBeInTheDocument();
    await waitFor(() => expect(within(users).getByText(/沒有「審核中」的使用者/)).toBeInTheDocument());
    expect(api.callsTo('POST', '/api/admin/users/u-1/approve')).toHaveLength(1);
    expect(api.callsTo('GET', '/api/admin/users').length).toBeGreaterThanOrEqual(2);
    expect(within(users).getByText((_, el) => el?.tagName === 'P' && el.textContent === '已核准 3／名額 49 人')).toBeInTheDocument();
  });

  it('切換篩選：改讀 ai_status=approved，已核准的人有「停用 AI」', async () => {
    const user = userEvent.setup();
    const api = mockApi(adminRoutes());
    const main = await openAdmin();
    const users = section(main, '使用者與 AI 申請');
    await within(users).findByText('hua@example.com');
    await user.selectOptions(within(users).getByRole('combobox', { name: '依 AI 狀態篩選' }), 'approved');
    expect(await within(users).findByRole('button', { name: '停用 AI：小美' })).toBeInTheDocument();
    expect(within(users).queryByRole('button', { name: '核准：小美' })).not.toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/admin/users?ai_status=approved')).toBe(true);
  });

  it('各狀態的按鈕：自己那列不能停用 AI、已停用的可以恢復、從未申請的只能直接核准', async () => {
    const user = userEvent.setup();
    const api = mockApi(
      adminRoutes({
        'GET /api/admin/users': () =>
          json(
            usersResponse([
              row({ id: 'u-self', email: 'me@example.com', display_name: '站主', role: 'admin', ai_status: 'approved' }),
              row({ id: 'u-none', email: 'none@example.com', display_name: '路人', ai_status: 'none', ai_apply_note: null }),
              row({ id: 'u-off', email: 'off@example.com', display_name: '阿停', ai_status: 'suspended' }),
            ]),
          ),
        'POST /api/admin/users/u-off/unsuspend': () => json({ user: row({ id: 'u-off', display_name: '阿停', ai_status: 'approved' }) }),
      }),
    );
    const main = await openAdmin();
    const users = section(main, '使用者與 AI 申請');
    await within(users).findByText('me@example.com');
    expect(within(users).queryByRole('button', { name: '停用 AI：站主' })).toBeNull();
    expect(within(users).getByRole('button', { name: '核准：路人' })).toBeInTheDocument();
    expect(within(users).queryByRole('button', { name: '拒絕：路人' })).toBeNull();
    expect(within(users).getByText(/仍要等他本人同意 AI 處理說明/)).toBeInTheDocument();
    await user.click(within(users).getByRole('button', { name: '恢復 AI：阿停' }));
    expect(await within(users).findByText('已恢復 AI：阿停')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/admin/users/u-off/unsuspend')).toHaveLength(1);
  });

  it('名額已滿（conflict）：顯示中文原因', async () => {
    const user = userEvent.setup();
    mockApi(adminRoutes({ 'POST /api/admin/users/u-1/approve': () => apiError('conflict', 409) }));
    const main = await openAdmin();
    const users = section(main, '使用者與 AI 申請');
    await user.click(await within(users).findByRole('button', { name: '核准：小華' }));
    expect(await within(users).findByRole('alert')).toHaveTextContent('核准人數已達名額上限');
  });

  it('reauth_required：頁首提示重新登入（登入後回到 /admin）', async () => {
    const user = userEvent.setup();
    mockApi(adminRoutes({ 'POST /api/admin/users/u-1/reject': () => apiError('reauth_required', 401) }));
    const main = await openAdmin();
    const users = section(main, '使用者與 AI 申請');
    await user.click(await within(users).findByRole('button', { name: '拒絕：小華' }));
    expect(await within(users).findByRole('alert')).toHaveTextContent('12 小時內登入過');
    expect(within(main).getByRole('link', { name: '重新登入' })).toHaveAttribute('href', '/auth/google/start?next=%2Fadmin');
  });
});

describe('全站 AI 開關與用量', () => {
  it('暫停：先確認再 POST /api/admin/ai/pause { paused: true }', async () => {
    const user = userEvent.setup();
    let paused = false;
    const api = mockApi(
      adminRoutes({
        'GET /api/admin/health': () => json({ ...HEALTH, ai: { ...HEALTH.ai, paused } }),
        'POST /api/admin/ai/pause': (call) => {
          paused = (call.body as { paused: boolean }).paused;
          return noContent();
        },
      }),
    );
    const main = await openAdmin();
    const pause = section(main, '全站 AI 開關');
    await user.click(await within(pause).findByRole('button', { name: '暫停全站 AI 批改' }));
    await user.click(within(pause).getByRole('button', { name: '確定暫停' }));
    expect(await within(pause).findByText('已暫停全站 AI 批改。')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/admin/ai/pause')[0]?.body).toEqual({ paused: true });
    expect(await within(pause).findByRole('button', { name: '恢復 AI 批改' })).toBeInTheDocument();
  });

  it('用量摘要：總計、預算與依任務的中文名稱；切到近 30 天會重新讀', async () => {
    const user = userEvent.setup();
    const api = mockApi(adminRoutes());
    const main = await openAdmin();
    const usage = section(main, 'AI 用量摘要');
    expect(await within(usage).findByText('12 次')).toBeInTheDocument();
    expect(within(usage).getByText('50 點')).toBeInTheDocument();
    expect(within(usage).getByText('英文作文批改')).toBeInTheDocument();
    expect(within(usage).getByText('中譯英批改')).toBeInTheDocument();
    expect(within(usage).getByText(/US\$9\.00／US\$400/)).toBeInTheDocument();
    const first = api.callsTo('GET', '/api/admin/usage')[0]?.path ?? '';
    expect(first).toMatch(/^\/api\/admin\/usage\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    await user.click(within(usage).getByRole('button', { name: '近 30 天' }));
    await waitFor(() => expect(api.callsTo('GET', '/api/admin/usage')).toHaveLength(2));
    expect(within(usage).getByRole('button', { name: '近 30 天' })).toHaveAttribute('aria-pressed', 'true');
  });
});
