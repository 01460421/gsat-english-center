/**
 * /account：登入頁（未登入、auth_error）、改暱稱與年齡區間、撤回 AI 處理同意、登出所有裝置、匯出（含 reauth_required）、刪除帳號。
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetOnboardingRedirectForTests } from './RequireAccount';
import { FEATURES_OFF_RESPONSE, FEATURES_ON, apiError, json, mockApi, noContent, renderApp, signedInMe } from './testing';

afterEach(() => resetOnboardingRedirectForTests());

async function openAccount(path = '/account') {
  renderApp(path);
  await screen.findByRole('heading', { level: 1, name: '我的帳號' }, { timeout: 5000 });
  return screen.getByRole('main');
}

describe('未登入與登入失敗', () => {
  it('後端未部署（auth 關閉）：顯示即將開放，不讀 /api/me', async () => {
    const api = mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE });
    const main = await openAccount();
    expect(await within(main).findByText('帳號功能即將開放')).toBeInTheDocument();
    expect(api.callsTo('GET', '/api/me')).toHaveLength(0);
    expect(within(main).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('未登入：這頁就是登入頁，有 Google 登入與 Gmail 提示', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    const main = await openAccount();
    const link = await within(main).findByRole('link', { name: '使用 Google 帳號登入' });
    expect(link).toHaveAttribute('href', '/auth/google/start?next=%2Faccount');
    expect(within(main).getByText(/學校帳號不能用時請改用個人 Gmail/)).toBeInTheDocument();
  });

  it('auth_error 轉成中文；不認得的代碼顯示通用訊息', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    const main = await openAccount('/account?auth_error=unverified');
    expect(within(main).getByRole('alert')).toHaveTextContent('這個 Google 帳號的電子郵件還沒有驗證');
  });

  it('auth_error 是未知代碼：通用訊息', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    const main = await openAccount('/account?auth_error=weird');
    expect(within(main).getByRole('alert')).toHaveTextContent('登入時發生問題，請再試一次。');
  });
});

describe('已登入', () => {
  it('改暱稱：PATCH /api/me 只送改了的欄位，頂端列跟著更新', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(),
      'PATCH /api/me': () => json(signedInMe({ user: { display_name: '英文小達人' } })),
    });
    const main = await openAccount();
    const nickname = await within(main).findByRole('textbox', { name: '暱稱' });
    const save = within(main).getByRole('button', { name: '儲存' });
    expect(save).toBeDisabled();
    await user.clear(nickname);
    await user.type(nickname, '英文小達人');
    await user.click(save);
    expect(await within(main).findByText('已儲存。')).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/api/me')[0]?.body).toEqual({ display_name: '英文小達人' });
    expect(screen.getAllByRole('button', { name: '英文小達人（帳號選單）' }).length).toBeGreaterThan(0);
  });

  it('改年齡區間失敗：顯示中文錯誤', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(),
      'PATCH /api/me': () => apiError('rate_limited', 429),
    });
    const main = await openAccount();
    await user.click(await within(main).findByRole('radio', { name: '未滿 18 歲' }));
    await user.click(within(main).getByRole('button', { name: '儲存' }));
    expect(await within(main).findByRole('alert')).toHaveTextContent('操作太頻繁，請稍等一下再試');
  });

  it('AI 狀態區塊顯示目前狀態並連到申請頁', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe({ user: { ai_status: 'waitlist' } }) });
    const main = await openAccount();
    const section = (await within(main).findByRole('heading', { level: 2, name: 'AI 批改' })).closest('section');
    if (!section) throw new Error('找不到 AI 區塊');
    expect(within(section).getByText('候補中')).toBeInTheDocument();
    expect(within(section).getByText(/本月的 AI 批改名額已滿/)).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: '查看申請狀態與點數' })).toHaveAttribute('href', '/ai/apply');
  });

  it('登出所有裝置：先確認，再 POST /auth/logout-all，之後變回未登入', async () => {
    const user = userEvent.setup();
    let loggedIn = true;
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': () => json(loggedIn ? signedInMe() : { user: null }),
      'POST /auth/logout-all': () => {
        loggedIn = false;
        return noContent();
      },
    });
    const main = await openAccount();
    await user.click(await within(main).findByRole('button', { name: '登出所有裝置' }));
    expect(api.callsTo('POST', '/auth/logout-all')).toHaveLength(0);
    await user.click(within(main).getByRole('button', { name: '確定登出所有裝置' }));
    expect(await within(main).findByText('已登出所有裝置。')).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: '使用 Google 帳號登入' })).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/logout-all')).toHaveLength(1);
  });

  it('匯出資料：GET /api/me/export 後存成 JSON 檔', async () => {
    const user = userEvent.setup();
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exportBody = { format: 'gsat-export/v1', exported_at: '2026-10-08T00:00:00Z', user: {}, consents: [], submissions: [] };
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe(), 'GET /api/me/export': exportBody });
    const main = await openAccount();
    await user.click(await within(main).findByRole('button', { name: '匯出我的資料' }));
    expect(await within(main).findByText('已下載匯出檔。')).toBeInTheDocument();
    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0]?.[0];
    if (!(blob instanceof Blob)) throw new Error('沒有建立 Blob');
    expect(JSON.parse(await blob.text())).toEqual(exportBody);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('匯出資料回 reauth_required：提示重新登入，登入後回到 /account', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(),
      'GET /api/me/export': () => apiError('reauth_required', 401),
    });
    const main = await openAccount();
    await user.click(await within(main).findByRole('button', { name: '匯出我的資料' }));
    expect(await within(main).findByText('需要重新登入')).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: '重新登入' })).toHaveAttribute('href', '/auth/google/start?next=%2Faccount');
  });

  it('刪除帳號：要輸入完全相同的確認字串；reauth_required 時提示重新登入', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(),
      'DELETE /api/me': () => apiError('reauth_required', 401),
    });
    const main = await openAccount();
    const input = await within(main).findByRole('textbox', { name: '請輸入「刪除我的帳號」確認' });
    const button = within(main).getByRole('button', { name: '永久刪除我的帳號' });
    await user.type(input, '刪除我的');
    expect(button).toBeDisabled();
    await user.type(input, '帳號');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(await within(main).findByText('需要重新登入')).toBeInTheDocument();
    expect(api.callsTo('DELETE', '/api/me')[0]?.body).toEqual({ confirm: '刪除我的帳號' });
  });

  it('刪除帳號成功：顯示已刪除並回到未登入狀態', async () => {
    const user = userEvent.setup();
    let exists = true;
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': () => json(exists ? signedInMe() : { user: null }),
      'DELETE /api/me': () => {
        exists = false;
        return noContent();
      },
    });
    const main = await openAccount();
    await user.type(await within(main).findByRole('textbox', { name: /確認/ }), '刪除我的帳號');
    await user.click(within(main).getByRole('button', { name: '永久刪除我的帳號' }));
    expect(await within(main).findByText(/你的帳號與資料已刪除/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /帳號選單/ })).not.toBeInTheDocument());
  });

  it('刪除帳號成功後，這台裝置上的寫作草稿（作文全文、辨識文字的修改、自評）也清掉', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('gsat-writing-draft:v1:essay:gsat-115.s8g1@1', '{"text":"my essay"}');
    window.localStorage.setItem('gsat-writing-ocr:v1:sub-1', '{}');
    window.localStorage.setItem('gsat-writing-self:v1:sub-1', '{}');
    let exists = true;
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': () => json(exists ? signedInMe() : { user: null }),
      'DELETE /api/me': () => {
        exists = false;
        return noContent();
      },
    });
    const main = await openAccount();
    await user.type(await within(main).findByRole('textbox', { name: /確認/ }), '刪除我的帳號');
    await user.click(within(main).getByRole('button', { name: '永久刪除我的帳號' }));
    expect(await within(main).findByText(/寫作草稿也已清除/)).toBeInTheDocument();
    expect(window.localStorage.getItem('gsat-writing-draft:v1:essay:gsat-115.s8g1@1')).toBeNull();
    expect(window.localStorage.getItem('gsat-writing-ocr:v1:sub-1')).toBeNull();
    expect(window.localStorage.getItem('gsat-writing-self:v1:sub-1')).toBeNull();
  });

  it('撤回 AI 處理同意：先確認，再送 granted: false；之後提示要重新同意', async () => {
    const user = userEvent.setup();
    const approved = { user: { ai_status: 'approved' as const } };
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(approved),
      'POST /api/me/consents': () => json(signedInMe({ ...approved, pending_ai_consents: ['ai_processing'] })),
    });
    const main = await openAccount();
    await user.click(await within(main).findByRole('button', { name: '撤回同意' }));
    expect(api.callsTo('POST', '/api/me/consents')).toHaveLength(0);
    await user.click(within(main).getByRole('button', { name: '確定撤回' }));
    expect(await within(main).findByText(/已撤回 AI 處理同意/)).toBeInTheDocument();
    expect(within(main).getByText(/需要重新同意 AI 處理說明/)).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: '撤回同意' })).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/api/me/consents')[0]?.body).toEqual({
      items: [{ kind: 'ai_processing', version: '2026-10-08', granted: false }],
    });
  });

  it('沒申請過 AI：沒有「撤回同意」', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe() });
    const main = await openAccount();
    expect(await within(main).findByRole('link', { name: '申請 AI 批改' })).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: '撤回同意' })).not.toBeInTheDocument();
  });

  it('管理員看得到「前往管理後台」', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe({ user: { role: 'admin' } }) });
    const main = await openAccount();
    expect(await within(main).findByRole('link', { name: '前往管理後台' })).toHaveAttribute('href', '/admin');
  });
});
