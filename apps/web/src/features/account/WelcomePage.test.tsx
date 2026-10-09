/**
 * 首次登入與條款改版：自動導到 /account/welcome、同意流程（POST /api/me/consents 的本體）、完成後回到 next，
 * 以及只差年齡區間、條款版本不一致、錯誤與「暫不同意，登出」。
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetOnboardingRedirectForTests } from './RequireAccount';
import { FEATURES_OFF_RESPONSE, FEATURES_ON, VERSIONS, apiError, mockApi, noContent, renderApp, signedInMe } from './testing';

afterEach(() => resetOnboardingRedirectForTests());

const FIRST_LOGIN = signedInMe({
  user: { age_band: null, display_name: 'Ming Wang' },
  pending_consents: ['privacy', 'terms'],
  onboarded: false,
});

async function findH1(name: string | RegExp) {
  return screen.findByRole('heading', { level: 1, name }, { timeout: 5000 });
}

describe('自動導向', () => {
  it('登入後還沒同意條款：從一般頁面導到 /account/welcome，完成後回到原本的頁面', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': FIRST_LOGIN,
      'POST /api/me/consents': () =>
        new Response(
          JSON.stringify(signedInMe({ user: { age_band: 'under18', display_name: '阿明' }, pending_consents: [], onboarded: true })),
          { status: 200 },
        ),
    });
    renderApp('/about');
    await findH1('歡迎使用學測英文中心');
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 2, name: '隱私權說明' })).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: '服務條款' })).toBeInTheDocument();
    expect(within(main).getAllByText(/版本 2026-10-08/)).toHaveLength(2);
    expect(within(main).queryByText('不同意新版的內容？')).not.toBeInTheDocument();

    const submit = within(main).getByRole('button', { name: '同意並繼續' });
    expect(submit).toBeDisabled();
    await user.click(within(main).getByRole('checkbox', { name: /同意隱私權說明（2026-10-08 版）/ }));
    await user.click(within(main).getByRole('checkbox', { name: /同意服務條款（2026-10-08 版）/ }));
    expect(submit).toBeDisabled(); // 還沒選年齡區間
    await user.click(within(main).getByRole('radio', { name: '未滿 18 歲' }));
    const nickname = within(main).getByRole('textbox', { name: '暱稱' });
    expect(nickname).toHaveValue('Ming Wang');
    await user.clear(nickname);
    await user.type(nickname, '  阿明 ');
    expect(submit).toBeEnabled();
    await user.click(submit);

    await findH1('關於');
    expect(api.callsTo('POST', '/api/me/consents')[0]?.body).toEqual({
      items: [
        { kind: 'privacy', version: VERSIONS.privacy, granted: true },
        { kind: 'terms', version: VERSIONS.terms, granted: true },
      ],
      age_band: 'under18',
      display_name: '阿明',
    });
    // 全站登入狀態已更新：頂端列顯示新暱稱，也不會再被導回歡迎頁。
    expect(screen.getAllByRole('button', { name: '阿明（帳號選單）' }).length).toBeGreaterThan(0);
  });

  it('需要登入的頁面（/ai/apply）在同意前一律導到歡迎頁，同意後回到原頁', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ pending_consents: ['terms'], onboarded: false }),
      'POST /api/me/consents': () => new Response(JSON.stringify(signedInMe()), { status: 200 }),
      'GET /api/ai/quota': () => apiError('not_implemented', 501),
    });
    renderApp('/ai/apply');
    await findH1('歡迎使用學測英文中心');
    await user.click(screen.getByRole('checkbox', { name: /同意服務條款/ }));
    await user.click(screen.getByRole('button', { name: '同意並繼續' }));
    await findH1('申請 AI 批改');
    expect(await screen.findByRole('heading', { level: 2, name: '申請表' })).toBeInTheDocument();
  });
});

describe('歡迎頁', () => {
  it('條款改版：只顯示要重新同意的那份，不再問年齡與暱稱', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ pending_consents: ['terms'], onboarded: false }),
      'POST /api/me/consents': () => new Response(JSON.stringify(signedInMe()), { status: 200 }),
    });
    renderApp('/account/welcome?next=%2Faccount');
    await findH1('歡迎使用學測英文中心');
    const main = screen.getByRole('main');
    expect(within(main).getByText('隱私權說明或服務條款已更新')).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { level: 2, name: '隱私權說明' })).not.toBeInTheDocument();
    expect(within(main).queryByRole('radio')).not.toBeInTheDocument();
    // 不同意新版的人仍可匯出或刪除自己的資料（後端對這兩支允許同意未完成）。
    await user.click(within(main).getByText('不同意新版的內容？'));
    expect(within(main).getByRole('button', { name: '匯出我的資料' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: '永久刪除我的帳號' })).toBeDisabled();
    await user.click(within(main).getByRole('checkbox', { name: /同意服務條款/ }));
    await user.click(within(main).getByRole('button', { name: '同意並繼續' }));
    await findH1('我的帳號');
    expect(api.callsTo('POST', '/api/me/consents')[0]?.body).toEqual({
      items: [{ kind: 'terms', version: VERSIONS.terms, granted: true }],
    });
  });

  it('同意都是現行版本、只差年齡區間：改用 PATCH /api/me', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ user: { age_band: null }, pending_consents: [], onboarded: false }),
      'PATCH /api/me': () => new Response(JSON.stringify(signedInMe()), { status: 200 }),
    });
    renderApp('/account/welcome?next=%2Fabout');
    await findH1('歡迎使用學測英文中心');
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(within(main).getByRole('radio', { name: '18 歲以上' }));
    await user.click(within(main).getByRole('button', { name: '完成設定' }));
    await findH1('關於');
    expect(api.callsTo('PATCH', '/api/me')[0]?.body).toEqual({ age_band: '18plus', display_name: '小明' });
    expect(api.callsTo('POST', '/api/me/consents')).toHaveLength(0);
  });

  it('後端的現行版本和本頁內文不同：停用送出並請使用者重新整理', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': { ...FIRST_LOGIN, consent_versions: { ...VERSIONS, privacy: '2027-01-01' } },
    });
    renderApp('/account/welcome');
    await findH1('歡迎使用學測英文中心');
    const main = screen.getByRole('main');
    expect(within(main).getByRole('alert')).toHaveTextContent('條款剛剛更新了');
    await user.click(within(main).getByRole('checkbox', { name: /同意隱私權說明/ }));
    await user.click(within(main).getByRole('checkbox', { name: /同意服務條款/ }));
    await user.click(within(main).getByRole('radio', { name: '18 歲以上' }));
    expect(within(main).getByRole('button', { name: '同意並繼續' })).toBeDisabled();
  });

  it('送出失敗：顯示中文原因，留在本頁', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': FIRST_LOGIN,
      'POST /api/me/consents': () => apiError('bad_request', 400),
    });
    renderApp('/account/welcome');
    await findH1('歡迎使用學測英文中心');
    const main = screen.getByRole('main');
    await user.click(within(main).getByRole('checkbox', { name: /同意隱私權說明/ }));
    await user.click(within(main).getByRole('checkbox', { name: /同意服務條款/ }));
    await user.click(within(main).getByRole('radio', { name: '18 歲以上' }));
    await user.click(within(main).getByRole('button', { name: '同意並繼續' }));
    expect(await within(main).findByRole('alert')).toHaveTextContent('請重新整理頁面後再試一次');
    expect(within(main).getByRole('button', { name: '同意並繼續' })).toBeEnabled();
  });

  it('「暫不同意，登出」：POST /auth/logout 後回首頁', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': FIRST_LOGIN,
      'POST /auth/logout': noContent,
    });
    renderApp('/account/welcome');
    await findH1('歡迎使用學測英文中心');
    await user.click(screen.getByRole('button', { name: '暫不同意，登出' }));
    await findH1('學測英文中心');
    expect(api.callsTo('POST', '/auth/logout')).toHaveLength(1);
  });

  it('未登入：顯示登入連結，登入後回到歡迎頁（保留 next）', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    renderApp('/account/welcome?next=%2Fwriting');
    await findH1('歡迎使用學測英文中心');
    const link = within(screen.getByRole('main')).getByRole('link', { name: '使用 Google 帳號登入' });
    expect(link).toHaveAttribute(
      'href',
      `/auth/google/start?next=${encodeURIComponent('/account/welcome?next=%2Fwriting')}`,
    );
  });

  it('後端未部署（auth 關閉）：顯示即將開放，不是錯誤畫面', async () => {
    mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE });
    renderApp('/account/welcome');
    await findH1('歡迎使用學測英文中心');
    expect(await screen.findByText('即將開放')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('已完成設定還打開歡迎頁：顯示已完成與「繼續」', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe() });
    renderApp('/account/welcome?next=%2Fwriting');
    await findH1('歡迎使用學測英文中心');
    await waitFor(() => expect(screen.getByText('你已完成首次設定')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: '繼續' })).toHaveAttribute('href', '/writing');
  });

  it('next 不是站內路徑（//evil.example）時回首頁', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe() });
    renderApp('/account/welcome?next=%2F%2Fevil.example');
    await findH1('歡迎使用學測英文中心');
    expect(await screen.findByRole('link', { name: '繼續' })).toHaveAttribute('href', '/');
  });
});
