/**
 * 設定頁：標題旁不再掛「開發中」，只有還沒做的學習偏好（複習提醒、發音聲音）那一行標「開發中」，每日新字數連到單字的每日學習；
 * 「帳號」區塊：後端沒部署時顯示「即將開放」；登入功能開放後連到我的帳號、AI 批改申請與寫作練習。
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetOnboardingRedirectForTests } from '../features/account/RequireAccount';
import { FEATURES_OFF_RESPONSE, FEATURES_ON, mockApi, renderApp, signedInMe } from '../features/account/testing';

afterEach(() => resetOnboardingRedirectForTests());

async function accountSection() {
  await screen.findByRole('heading', { level: 1, name: '設定' }, { timeout: 5000 });
  const heading = screen.getByRole('heading', { level: 2, name: '帳號' });
  const section = heading.closest('section');
  if (!section) throw new Error('找不到帳號區塊');
  return within(section);
}

describe('設定頁的完成狀態', () => {
  it('頁首沒有「開發中」；學習偏好連到每日學習，「開發中」只標在還沒做的那一行', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    renderApp('/settings');
    const h1 = await screen.findByRole('heading', { level: 1, name: '設定' }, { timeout: 5000 });
    expect(within(h1.parentElement as HTMLElement).queryByText('開發中')).not.toBeInTheDocument();
    expect(screen.queryByText(/這個模組還在開發中/)).not.toBeInTheDocument();
    const prefs = within(screen.getByRole('region', { name: '學習偏好' }));
    expect(prefs.getByRole('link', { name: '單字的「每日學習」' })).toHaveAttribute('href', '/words?tab=study');
    const badges = screen.getAllByText('開發中');
    expect(badges).toHaveLength(1);
    expect(badges[0]?.parentElement).toHaveTextContent('複習提醒時間、發音聲音的選擇');
  });
});

describe('設定頁的帳號區塊', () => {
  it('後端沒部署：顯示即將開放，不讀 /api/me', async () => {
    const api = mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE });
    renderApp('/settings');
    const section = await accountSection();
    expect(await section.findByText('即將開放')).toBeInTheDocument();
    expect(section.queryByRole('link')).not.toBeInTheDocument();
    expect(api.callsTo('GET', '/api/me')).toHaveLength(0);
  });

  it('未登入：連到 /account 登入', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    renderApp('/settings');
    const section = await accountSection();
    expect(await section.findByRole('link', { name: '前往登入' })).toHaveAttribute('href', '/account');
  });

  it('已登入：連到我的帳號、AI 批改申請與寫作練習', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe() });
    renderApp('/settings');
    const section = await accountSection();
    await waitFor(() => expect(section.getByRole('link', { name: '我的帳號' })).toHaveAttribute('href', '/account'));
    expect(section.getByRole('link', { name: 'AI 批改申請' })).toHaveAttribute('href', '/ai/apply');
    expect(section.getByRole('link', { name: '寫作練習' })).toHaveAttribute('href', '/writing');
  });
});
