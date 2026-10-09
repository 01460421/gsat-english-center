/**
 * /ai/apply：AI 未開啟時只有說明、點數規則、申請表（未滿 18 歲多一個勾選）、各狀態的中文說明、額度顯示與錯誤文案。
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiQuotaResponse } from '@gsat/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { resetOnboardingRedirectForTests } from './RequireAccount';
import { FEATURES_AUTH_ONLY, FEATURES_ON, apiError, json, mockApi, renderApp, signedInMe } from './testing';

afterEach(() => resetOnboardingRedirectForTests());

const QUOTA: AiQuotaResponse = {
  ai_status: 'approved',
  tier: 'trial',
  points: { day_used: 3, day_limit: 10, month_used: 12, month_limit: 300 },
  essays: { day_used: 1, day_limit: 3 },
  concurrent: { active: 0, limit: 2 },
  site: { paused: false, budget_available: true },
  approval: { cap: 49, approved: 10, full: false },
  resets_at: { day: '2026-10-08T16:00:00Z', month: '2026-10-31T16:00:00Z' },
  task_points: { translation_grade: 3, essay_grade: 7, essay_ocr: 2 },
};

async function openApply() {
  renderApp('/ai/apply');
  await screen.findByRole('heading', { level: 1, name: '申請 AI 批改' }, { timeout: 5000 });
  return screen.getByRole('main');
}

describe('說明與開關', () => {
  it('AI 未開啟：說明與點數規則照常顯示，申請表換成「即將開放」，不打 AI 相關 API', async () => {
    const api = mockApi({ 'GET /api/features': FEATURES_AUTH_ONLY, 'GET /api/me': signedInMe() });
    const main = await openApply();
    expect(await within(main).findByText('AI 批改即將開放')).toBeInTheDocument();
    expect(within(main).getByText('AI 批改，僅供參考')).toBeInTheDocument();
    const table = within(main).getByRole('table');
    expect(within(table).getByRole('row', { name: /中譯英批改.*3 點/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /英文作文批改.*7 點/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /手寫作文照片辨識.*2 點/ })).toBeInTheDocument();
    expect(within(main).getByText(/每天 30 點、每月 300 點/)).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { name: '申請表' })).not.toBeInTheDocument();
    expect(api.callsTo('GET', '/api/ai/quota')).toHaveLength(0);
  });

  it('AI 開啟但未登入：請先登入', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    const main = await openApply();
    expect(await within(main).findByRole('link', { name: '使用 Google 帳號登入' })).toHaveAttribute(
      'href',
      '/auth/google/start?next=%2Fai%2Fapply',
    );
  });

  it('已登入：「目前狀態」排在說明前面（手機上不用滑兩個螢幕才看得到），點數欄不斷行', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe({ user: { ai_status: 'pending' } }) });
    const main = await openApply();
    const status = await within(main).findByRole('heading', { name: '目前狀態' });
    const about = within(main).getByRole('heading', { name: 'AI 批改是什麼' });
    expect(status.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cells = within(within(main).getByRole('table')).getAllByRole('cell').filter((c) => /點$/.test(c.textContent ?? ''));
    for (const cell of cells) expect(cell.className).toContain('whitespace-nowrap');
  });

  it('全站暫停中：狀態區塊提示 AI 功能暫停中', async () => {
    mockApi({ 'GET /api/features': { ...FEATURES_ON, aiPaused: true }, 'GET /api/me': signedInMe(), 'GET /api/ai/quota': QUOTA });
    const main = await openApply();
    expect(await within(main).findByText(/AI 功能暫停中/)).toBeInTheDocument();
  });
});

describe('申請', () => {
  it('18 歲以上：填用途並同意 AI 處理後送出，畫面改成審核中', async () => {
    const user = userEvent.setup();
    let status = 'none';
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': () => json(signedInMe({ user: { ai_status: status as 'none' } })),
      'GET /api/ai/quota': () => apiError('not_implemented', 501),
      'POST /api/ai/apply': () => {
        status = 'pending';
        return json({ ai_status: 'pending' });
      },
    });
    const main = await openApply();
    expect(await within(main).findByRole('heading', { level: 2, name: '申請表' })).toBeInTheDocument();
    expect(within(main).getByText('尚未申請')).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: 'AI 處理說明' })).toBeInTheDocument();
    expect(within(main).queryByRole('checkbox', { name: /法定代理人/ })).not.toBeInTheDocument();

    const submit = within(main).getByRole('button', { name: '送出申請' });
    expect(submit).toBeDisabled();
    await user.type(within(main).getByRole('textbox', { name: /想用 AI 批改做什麼/ }), '準備學測作文');
    expect(submit).toBeDisabled();
    await user.click(within(main).getByRole('checkbox', { name: /同意 AI 處理說明（2026-10-08 版）/ }));
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(await within(main).findByText('審核中')).toBeInTheDocument();
    expect(within(main).getByText(/正在等站主審核/)).toBeInTheDocument();
    expect(within(main).queryByRole('heading', { name: '申請表' })).not.toBeInTheDocument();
    // 核准前可以先回寫作練習用自我檢核。
    expect(within(main).getByRole('link', { name: '先用自我檢核練習寫作' })).toHaveAttribute('href', '/writing');
    expect(api.callsTo('POST', '/api/ai/apply')[0]?.body).toEqual({
      note: '準備學測作文',
      ai_consent_version: '2026-10-08',
      guardian_ack: false,
    });
  });

  it('未滿 18 歲：要多勾「已告知法定代理人」，送出 guardian_ack: true', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ user: { age_band: 'under18' } }),
      'POST /api/ai/apply': { ai_status: 'waitlist' },
    });
    const main = await openApply();
    await user.type(await within(main).findByRole('textbox', { name: /想用 AI 批改做什麼/ }), '練翻譯');
    await user.click(within(main).getByRole('checkbox', { name: /同意 AI 處理說明/ }));
    const submit = within(main).getByRole('button', { name: '送出申請' });
    expect(submit).toBeDisabled();
    await user.click(within(main).getByRole('checkbox', { name: /已告知法定代理人/ }));
    await user.click(submit);
    expect(await within(main).findByText('候補中')).toBeInTheDocument();
    expect(within(main).getByText(/本月的 AI 批改名額已滿/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/ai/apply')[0]?.body).toMatchObject({ guardian_ack: true });
  });

  it('申請太頻繁（rate_limited）：中文提示，可再送', async () => {
    const user = userEvent.setup();
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ user: { ai_status: 'rejected' } }),
      'POST /api/ai/apply': () => apiError('rate_limited', 429),
    });
    const main = await openApply();
    expect(await within(main).findByText('未通過')).toBeInTheDocument();
    expect(within(main).getByText(/最多申請 10 次/)).toBeInTheDocument();
    await user.type(within(main).getByRole('textbox', { name: /想用 AI 批改做什麼/ }), '再申請一次');
    await user.click(within(main).getByRole('checkbox', { name: /同意 AI 處理說明/ }));
    await user.click(within(main).getByRole('button', { name: '送出申請' }));
    expect(await within(main).findByRole('alert')).toHaveTextContent('申請太頻繁，或已達申請次數上限（每次至少間隔 60 秒、每個帳號最多 10 次）。');
  });

  it('AI 處理說明的版本和後端不同：停用送出', async () => {
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ consent_versions: { privacy: '2026-10-08', terms: '2026-10-08', ai: '2027-02-01' } }),
    });
    const main = await openApply();
    expect(await within(main).findByText('AI 處理說明剛剛更新了')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: '送出申請' })).toBeDisabled();
  });
});

describe('各狀態', () => {
  it('已核准：顯示今日與本月用量（來自 /api/ai/quota）與寫作練習連結，上限也改用額度回應', async () => {
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ user: { ai_status: 'approved', ai_tier: 'trial' } }),
      'GET /api/ai/quota': QUOTA,
    });
    const main = await openApply();
    expect(await within(main).findByText('已用 3／10 點')).toBeInTheDocument();
    expect(within(main).getByText(/點（台灣時間 00:00 重置）/)).toHaveTextContent('7 點（台灣時間 00:00 重置）');
    expect(within(main).getByText('已用 12／300 點')).toBeInTheDocument();
    expect(within(main).getByText('已批改 1／3 篇')).toBeInTheDocument();
    expect(within(main).getByText(/每天 10 點、每月 300 點/)).toBeInTheDocument();
    expect(within(main).getByText('額度等級：試用')).toBeInTheDocument();
    expect(within(main).getByRole('link', { name: '前往寫作練習' })).toHaveAttribute('href', '/writing');
    expect(within(main).queryByRole('heading', { name: '申請表' })).not.toBeInTheDocument();
  });

  it('已核准但 AI 處理說明改版（pending_ai_consents）：重新勾選後送 POST /api/me/consents', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({
        user: { ai_status: 'approved', age_band: 'under18' },
        pending_ai_consents: ['ai_processing', 'guardian_ack'],
      }),
      'GET /api/ai/quota': QUOTA,
      'POST /api/me/consents': () =>
        json(signedInMe({ user: { ai_status: 'approved', age_band: 'under18' }, pending_ai_consents: [] })),
    });
    const main = await openApply();
    expect(await within(main).findByText('請重新確認 AI 處理說明')).toBeInTheDocument();
    const submit = within(main).getByRole('button', { name: '同意並繼續使用' });
    await user.click(within(main).getByRole('checkbox', { name: /同意 AI 處理說明/ }));
    expect(submit).toBeDisabled();
    await user.click(within(main).getByRole('checkbox', { name: /已告知法定代理人/ }));
    await user.click(submit);
    await waitFor(() => expect(within(main).queryByText('請重新確認 AI 處理說明')).not.toBeInTheDocument());
    expect(api.callsTo('POST', '/api/me/consents')[0]?.body).toEqual({
      items: [
        { kind: 'ai_processing', version: '2026-10-08', granted: true },
        { kind: 'guardian_ack', version: '2026-10-08', granted: true },
      ],
    });
  });

  it('管理員（不限點數）：用量顯示「不限」，說明區仍顯示一般規則', async () => {
    const huge = 1_000_000_000;
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe({ user: { role: 'admin', ai_status: 'approved', ai_tier: 'unlimited' } }),
      'GET /api/ai/quota': {
        ...QUOTA,
        tier: 'unlimited',
        points: { day_used: 14, day_limit: huge, month_used: 40, month_limit: huge },
        essays: { day_used: 2, day_limit: huge },
      },
    });
    const main = await openApply();
    expect(await within(main).findByText('不限點數')).toBeInTheDocument();
    expect(within(main).getByText('已用 14 點（不限）')).toBeInTheDocument();
    expect(within(main).getByText('已批改 2 篇（不限）')).toBeInTheDocument();
    expect(within(main).getByText(/每天 30 點、每月 300 點/)).toBeInTheDocument();
    expect(within(main).queryByText(/1000000000/)).not.toBeInTheDocument();
  });

  it('名額已滿（approval.full）：申請表先說明會排入候補', async () => {
    mockApi({
      'GET /api/features': FEATURES_ON,
      'GET /api/me': signedInMe(),
      'GET /api/ai/quota': { ...QUOTA, ai_status: 'none', approval: { cap: 49, approved: 49, full: true } },
    });
    const main = await openApply();
    expect(await within(main).findByText('本月名額已滿')).toBeInTheDocument();
    expect(within(main).getByText(/會先排入候補/)).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: '送出申請' })).toBeInTheDocument();
  });

  it('使用須知：能做、不能做、不要放個資、遇到不當內容怎麼辦', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': { user: null } });
    const main = await openApply();
    // 收在 <details>（手機上不要把目前狀態與申請表擠到好幾個螢幕以下）；內容仍在頁面上。
    expect(await within(main).findByText(/^使用須知/, { selector: 'summary' })).toBeInTheDocument();
    expect(within(main).getByText(/AI 能做的/)).toBeInTheDocument();
    expect(within(main).getByText(/AI 不能做的/)).toBeInTheDocument();
    expect(within(main).getByText(/不要在作答裡寫真實姓名/)).toBeInTheDocument();
    expect(within(main).getByText(/不恰當或讓你不舒服的內容/)).toBeInTheDocument();
  });

  it('已停用：只顯示狀態說明，沒有申請表', async () => {
    mockApi({ 'GET /api/features': FEATURES_ON, 'GET /api/me': signedInMe({ user: { ai_status: 'suspended' } }) });
    const main = await openApply();
    expect(await within(main).findByText('已停用')).toBeInTheDocument();
    expect(within(main).getByText(/AI 批改目前已停用/)).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: '送出申請' })).not.toBeInTheDocument();
  });
});
