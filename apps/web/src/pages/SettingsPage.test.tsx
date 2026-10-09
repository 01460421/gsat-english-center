/**
 * 設定頁的「帳號」區塊：後端沒部署時顯示「即將開放」；登入功能開放後連到我的帳號、AI 批改申請與寫作練習。
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
