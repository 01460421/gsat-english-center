/**
 * 公開的 /privacy 與 /terms：不必登入、後端沒開帳號功能也看得到全文；登入但還沒同意條款的人也不會被導走。
 * 每頁底部都有連到這兩頁的連結（Google 登入的品牌審查會檢查首頁有沒有連到隱私權政策）。
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from './policy';
import { resetOnboardingRedirectForTests } from './RequireAccount';
import { FEATURES_OFF_RESPONSE, FEATURES_ON, mockApi, renderApp, signedInMe } from './testing';

afterEach(() => resetOnboardingRedirectForTests());

const findH1 = (name: string) => screen.findByRole('heading', { level: 1, name }, { timeout: 5000 });

describe('公開條款頁', () => {
  it('/privacy：不登入就能看重點、全文（直接展開）與 AI 處理說明', async () => {
    mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE, 'GET /api/me': { user: null } });
    renderApp('/privacy');
    await findH1('隱私權說明');
    const main = screen.getByRole('article');
    for (const s of PRIVACY_POLICY.sections) expect(within(main).getByRole('heading', { level: 3, name: s.heading })).toBeVisible();
    expect(within(main).getByRole('heading', { level: 2, name: 'AI 處理說明' })).toBeInTheDocument();
    expect(main.querySelector('details')).toBeNull();
    expect(within(main).getByRole('link', { name: '服務條款' })).toHaveAttribute('href', '/terms');
    expect(document.title).toBe('隱私權說明｜學測英文中心');
  });

  it('/terms：全文直接展開', async () => {
    mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE, 'GET /api/me': { user: null } });
    renderApp('/terms');
    await findH1('服務條款');
    const main = screen.getByRole('article');
    for (const s of TERMS_OF_SERVICE.sections) expect(within(main).getByRole('heading', { level: 3, name: s.heading })).toBeVisible();
    expect(within(main).getByRole('link', { name: '隱私權說明' })).toHaveAttribute('href', '/privacy');
  });

  it('登入但還沒同意條款：停在 /privacy，不導到歡迎頁', async () => {
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ pending_consents: ['privacy', 'terms'], onboarded: false }),
    });
    renderApp('/privacy');
    await findH1('隱私權說明');
    await waitFor(() => expect(api.callsTo('GET', '/api/me')).not.toHaveLength(0));
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('heading', { level: 1, name: /歡迎使用/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '隱私權說明' })).toBeInTheDocument();
  });

  it('每頁底部都有隱私權說明與服務條款的連結', async () => {
    mockApi({ 'GET /api/features': FEATURES_OFF_RESPONSE, 'GET /api/me': { user: null } });
    renderApp('/');
    const footer = await screen.findByRole('navigation', { name: '網站資訊' });
    expect(within(footer).getByRole('link', { name: '隱私權說明' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: '服務條款' })).toHaveAttribute('href', '/terms');
  });
});
