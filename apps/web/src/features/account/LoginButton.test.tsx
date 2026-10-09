/**
 * 登入按鈕與帳號選單（Layout 的頂端列與側邊欄各一份；測試環境不套 CSS，兩份都在畫面上）。
 * 重點：features.auth 為 false 時完全不出現、登入是整頁跳轉的連結（next 帶目前路徑）、已登入的選單內容依角色變化、登出。
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { resetOnboardingRedirectForTests } from './RequireAccount';
import {
  FEATURES_AUTH_ONLY,
  FEATURES_OFF_RESPONSE,
  FEATURES_ON,
  apiError,
  mockApi,
  noContent,
  renderApp,
  signedInMe,
} from './testing';

afterEach(() => resetOnboardingRedirectForTests());

async function waitForPage(title: string) {
  return screen.findByRole('heading', { level: 1, name: title }, { timeout: 5000 });
}

describe('登入按鈕', () => {
  it('features.auth 為 false：不顯示登入按鈕，也不讀 /api/me', async () => {
    const api = mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE, 'GET /api/me': { user: null } });
    renderApp('/about');
    await waitForPage('關於');
    await waitFor(() => expect(api.callsTo('GET', '/api/features')).toHaveLength(1));
    expect(screen.queryByRole('link', { name: /登入/ })).not.toBeInTheDocument();
    expect(api.callsTo('GET', '/api/me')).toHaveLength(0);
  });

  it('/api/features 失敗（後端未部署、回 HTML）：一樣不顯示，頁面照常', async () => {
    mockApi({ 'GET /api/features': () => new Response('<!doctype html>', { status: 200 }) });
    renderApp('/about');
    await waitForPage('關於');
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('link', { name: /登入/ })).not.toBeInTheDocument();
  });

  it('未登入：顯示「登入」，整頁跳到 /auth/google/start，next 是目前站內路徑；側邊欄附 Gmail 提示', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    renderApp('/about?tab=credits');
    await waitForPage('關於');
    const topbar = await screen.findByRole('link', { name: '登入' });
    expect(topbar).toHaveAttribute('href', '/auth/google/start?next=%2Fabout%3Ftab%3Dcredits');
    const sidebar = screen.getByRole('link', { name: '使用 Google 登入' });
    expect(sidebar).toHaveAttribute('href', '/auth/google/start?next=%2Fabout%3Ftab%3Dcredits');
    expect(screen.getByText('學校帳號不能用時請改用個人 Gmail')).toBeInTheDocument();
  });

  it('登入失敗回到 /account?auth_error=… 時，再按登入不會把 auth_error 帶回來', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    renderApp('/account?auth_error=state');
    await waitForPage('我的帳號');
    expect(await screen.findByRole('link', { name: '登入' })).toHaveAttribute('href', '/auth/google/start?next=%2Faccount');
  });

  it('已登入（學生）：顯示暱稱；選單有我的帳號、AI 申請狀態，沒有管理後台', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe({ user: { ai_status: 'pending' } }) });
    renderApp('/about');
    await waitForPage('關於');
    const [button] = await screen.findAllByRole('button', { name: '小明（帳號選單）' });
    if (!button) throw new Error('找不到帳號選單');
    expect(screen.queryByRole('link', { name: /登入/ })).not.toBeInTheDocument();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('找不到選單面板');
    expect(within(panel).getByRole('link', { name: '我的帳號' })).toHaveAttribute('href', '/account');
    const ai = within(panel).getByRole('link', { name: /AI 申請狀態/ });
    expect(ai).toHaveAttribute('href', '/ai/apply');
    expect(within(ai).getByText('審核中')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: '管理後台' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: '登出' })).toBeInTheDocument();
  });

  it('管理員的選單多一個「管理後台」；AI 未開啟時 AI 項目顯示「即將開放」', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/features': FEATURES_AUTH_ONLY, 'GET /api/me': signedInMe({ user: { role: 'admin', display_name: '站主' } }) });
    renderApp('/about');
    await waitForPage('關於');
    const [button] = await screen.findAllByRole('button', { name: '站主（帳號選單）' });
    if (!button) throw new Error('找不到帳號選單');
    await user.click(button);
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('找不到選單面板');
    expect(within(panel).getByRole('link', { name: '管理後台' })).toHaveAttribute('href', '/admin');
    expect(within(within(panel).getByRole('link', { name: /AI 申請狀態/ })).getByText('即將開放')).toBeInTheDocument();
  });

  it('Esc 關閉選單並把焦點還給按鈕；點選單項目會換頁並關閉', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe() });
    renderApp('/about');
    await waitForPage('關於');
    const [button] = await screen.findAllByRole('button', { name: '小明（帳號選單）' });
    if (!button) throw new Error('找不到帳號選單');
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();

    await user.click(button);
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('找不到選單面板');
    await user.click(within(panel).getByRole('link', { name: '我的帳號' }));
    await waitForPage('我的帳號');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('登出：POST /auth/logout，之後變回「登入」', async () => {
    const user = userEvent.setup();
    let loggedIn = true;
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': () => new Response(JSON.stringify(loggedIn ? signedInMe() : { user: null }), { status: 200 }),
      'POST /auth/logout': () => {
        loggedIn = false;
        return noContent();
      },
    });
    renderApp('/about');
    await waitForPage('關於');
    const [button] = await screen.findAllByRole('button', { name: '小明（帳號選單）' });
    if (!button) throw new Error('找不到帳號選單');
    await user.click(button);
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('找不到選單面板');
    window.localStorage.setItem('gsat-writing-draft:v1:translation:gsat-115.s7g1@1', '{"texts":["mine"]}');
    await user.click(within(panel).getByRole('button', { name: '登出' }));
    expect(await screen.findByRole('link', { name: '登入' })).toBeInTheDocument();
    expect(api.callsTo('POST', '/auth/logout')).toHaveLength(1);
    // 公用電腦：下一位使用者看不到這台裝置上的作答草稿
    expect(window.localStorage.getItem('gsat-writing-draft:v1:translation:gsat-115.s7g1@1')).toBeNull();
    expect(screen.queryByRole('button', { name: /帳號選單/ })).not.toBeInTheDocument();
  });

  it('登出失敗：留在登入狀態並顯示中文原因', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(),
      'POST /auth/logout': () => apiError('internal_error', 500),
    });
    renderApp('/about');
    await waitForPage('關於');
    const [button] = await screen.findAllByRole('button', { name: '小明（帳號選單）' });
    if (!button) throw new Error('找不到帳號選單');
    await user.click(button);
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!panel) throw new Error('找不到選單面板');
    await user.click(within(panel).getByRole('button', { name: '登出' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent('登出失敗：伺服器暫時發生問題，請稍後再試');
  });
});
