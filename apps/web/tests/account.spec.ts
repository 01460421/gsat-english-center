/**
 * 登入、首次同意、AI 申請與管理後台的 e2e（建置後的產物；後端用 tests/support/backend.ts 的假 Worker）：
 *   1. 未登入：版面上的登入按鈕與寫作頁的提示都連到 /auth/google/start?next=<目前頁>，點下去整頁跳轉；
 *   2. 首次登入：/api/me 回需要同意 → 自動導到 /account/welcome → 送出同意 → 回到原本那一頁；
 *   3. AI 未核准：寫作頁引導到 /ai/apply → 送出申請 → 顯示「審核中」，回寫作頁看到等待核准的說明；
 *   4. 管理員：帳號選單進 /admin → 看到待審核的使用者 → 核准一位；
 *   5. 後端沒部署、或只開了登入沒開 AI：帳號、申請、後台、批改結果頁都是「即將開放」，不是錯誤畫面。
 * 桌機與手機（playwright.config.ts 的兩個 project）各跑一次。
 */
import { expect, test } from '@playwright/test';
import {
  ADMIN_HEALTH,
  ADMIN_USAGE,
  FEATURES_ON,
  VERSIONS,
  adminUserRow,
  collectErrors,
  expectNoHorizontalOverflow,
  fakeBackend,
  ok,
  signedInMe,
} from './support/backend';

test('未登入：登入按鈕連到 /auth/google/start，next 是目前的頁面', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { me: { user: null } });
  await page.goto('/writing/translation/gsat-115');
  await expect(page.getByRole('heading', { level: 1, name: '115 學測 中譯英' })).toBeVisible();

  const expected = '/auth/google/start?next=%2Fwriting%2Ftranslation%2Fgsat-115';
  // 版面上的登入按鈕：手機在頂端列（「登入」），桌機在側邊欄（「使用 Google 登入」）；另一份用 CSS 隱藏。
  const layoutLogin = page.getByRole('link', { name: testInfo.project.name === 'mobile' ? '登入' : '使用 Google 登入', exact: true });
  await expect(layoutLogin).toHaveAttribute('href', expected);
  // 寫作頁的 AI 說明也給同一個登入連結，並說明登入後要申請。
  const notice = page.getByRole('link', { name: '用 Google 登入', exact: true });
  await expect(notice).toHaveAttribute('href', expected);
  await expect(page.getByRole('link', { name: '申請 AI 批改' })).toHaveAttribute('href', '/ai/apply');
  // 沒登入就沒有 AI 送出按鈕，自我檢核照常。
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '自我檢核（不用 AI）' })).toBeVisible();

  await layoutLogin.click();
  await expect(page).toHaveURL(new RegExp(`${expected.replace(/[?]/g, '\\?')}$`));
  await expect(page.getByRole('heading', { name: 'Google 登入（測試替身）' })).toBeVisible();
  expect(backend.callsTo('GET', '/auth/google/start')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('首次登入：導到 /account/welcome，同意並填年齡區間後回到原頁', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, {
    me: signedInMe({ display_name: 'Wang Xiao-Ming', age_band: null }, { pending_consents: ['privacy', 'terms'], onboarded: false }),
  });
  backend.on('POST /api/me/consents', () => {
    backend.me = signedInMe({ display_name: '小明', age_band: '18plus' });
    return ok(backend.me);
  });

  await page.goto('/writing/translation');
  // 登入後第一次載入（不論在哪一頁）先導到歡迎頁，next 記住原本要去的地方。
  await expect(page).toHaveURL(/\/account\/welcome\?next=%2Fwriting%2Ftranslation$/);
  await expect(page.getByRole('heading', { level: 1, name: '歡迎使用學測英文中心' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '隱私權說明' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '服務條款' })).toBeVisible();

  const submit = page.getByRole('button', { name: '同意並繼續' });
  await expect(submit).toBeDisabled();
  await page.getByRole('radio', { name: '18 歲以上' }).check();
  await page.getByRole('textbox', { name: '暱稱' }).fill('小明');
  await page.getByRole('checkbox', { name: `我已閱讀並同意隱私權說明（${VERSIONS.privacy} 版）` }).check();
  await page.getByRole('checkbox', { name: `我已閱讀並同意服務條款（${VERSIONS.terms} 版）` }).check();
  await submit.click();

  await expect(page).toHaveURL(/\/writing\/translation$/);
  await expect(page.getByRole('heading', { level: 1, name: '中譯英題目' })).toBeVisible();
  // 版面上的帳號選單換成新暱稱。
  await expect(page.getByRole('button', { name: '小明（帳號選單）' })).toBeVisible();
  const [consent] = backend.callsTo('POST', '/api/me/consents');
  expect(consent?.json).toEqual({
    items: [
      { kind: 'privacy', version: VERSIONS.privacy, granted: true },
      { kind: 'terms', version: VERSIONS.terms, granted: true },
    ],
    age_band: '18plus',
    display_name: '小明',
  });
  expect(errors).toEqual([]);
});

test('AI 未核准：寫作頁引導申請，送出後顯示審核中', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { me: signedInMe({ ai_status: 'none' }) });
  backend.quota = { ...backend.quota, ai_status: 'none' };
  backend.on('POST /api/ai/apply', () => {
    backend.me = signedInMe({ ai_status: 'pending' });
    return ok({ ai_status: 'pending' });
  });

  await page.goto('/writing');
  await expect(page.getByRole('heading', { level: 1, name: '寫作練習' })).toBeVisible();
  await expect(page.getByText('AI 批改需要先申請。')).toBeVisible();
  await page.getByRole('link', { name: '申請 AI 批改' }).click();

  await expect(page).toHaveURL(/\/ai\/apply$/);
  await expect(page.getByRole('heading', { level: 1, name: '申請 AI 批改' })).toBeVisible();
  const status = page.locator('section', { has: page.getByRole('heading', { name: '目前狀態' }) });
  await expect(status).toContainText('尚未申請');
  await page.getByRole('textbox', { name: /想用 AI 批改做什麼/ }).fill('準備學測，想每週練兩篇作文。');
  await page.getByRole('checkbox', { name: new RegExp(`^我已閱讀並同意 AI 處理說明（${VERSIONS.ai} 版）`) }).check();
  await page.getByRole('button', { name: '送出申請' }).click();

  await expect(status).toContainText('審核中');
  await expect(status).toContainText('已收到你的申請，正在等站主審核');
  await expect(page.getByRole('button', { name: '送出申請' })).toHaveCount(0);
  const [apply] = backend.callsTo('POST', '/api/ai/apply');
  expect(apply?.json).toEqual({ note: '準備學測，想每週練兩篇作文。', ai_consent_version: VERSIONS.ai, guardian_ack: false });
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');

  // 核准前可以先用自我檢核；寫作頁改成說明「等待核准」。
  await page.getByRole('link', { name: '先用自我檢核練習寫作' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '寫作練習' })).toBeVisible();
  await expect(page.getByText('你的 AI 批改申請已送出，正在等站主核准')).toBeVisible();
  expect(errors).toEqual([]);
});

test('管理員：從帳號選單進入後台，看到待審核的使用者並核准一位', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, {
    me: signedInMe({ id: 'u-admin', display_name: '站主', role: 'admin', ai_status: 'approved', ai_tier: 'unlimited' }),
  });
  let pending = [adminUserRow('u-101', '學生甲'), adminUserRow('u-102', '學生乙', { age_band: 'under18', ai_apply_note: '<b>想練作文</b>' })];
  let approved = 12;
  backend.on('GET /api/admin/health', () => ok({ ...ADMIN_HEALTH, ai: { ...ADMIN_HEALTH.ai, approved } }));
  backend.on('GET /api/admin/users', (call) =>
    ok({ users: call.query.get('ai_status') === 'pending' ? pending : [], next_cursor: null, approval: { cap: 49, approved } }),
  );
  backend.on('GET /api/admin/usage', (call) => ok({ from: call.query.get('from'), to: call.query.get('to'), ...ADMIN_USAGE }));
  backend.on('POST /api/admin/users/u-101/approve', () => {
    const row = pending.find((u) => u.id === 'u-101');
    if (!row) return { status: 409, json: { error: { code: 'conflict', message: 'e2e' } } };
    pending = pending.filter((u) => u.id !== 'u-101');
    approved += 1;
    return ok({ user: { ...row, ai_status: 'approved', ai_reviewed_at: Math.floor(Date.now() / 1000) } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '站主（帳號選單）' }).click();
  await page.getByRole('link', { name: '管理後台' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { level: 1, name: '管理後台' })).toBeVisible();
  const users = page.getByRole('region', { name: '使用者與 AI 申請' });
  await expect(users.getByRole('listitem', { name: '學生甲（審核中）' })).toBeVisible();
  await expect(users.getByRole('listitem', { name: '學生乙（審核中）' })).toBeVisible();
  // 申請說明是使用者填的：以純文字顯示，不會變成 HTML。
  await expect(users.getByText('<b>想練作文</b>')).toBeVisible();
  await expect(users).toContainText('已核准 12／名額 49 人');
  // 用量摘要的期間是台灣日期。
  const [usage] = backend.callsTo('GET', '/api/admin/usage');
  expect(usage?.query.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await users.getByRole('button', { name: '核准：學生甲' }).click();
  await expect(users.getByText('已核准：學生甲')).toBeVisible();
  await expect(users.getByRole('listitem', { name: '學生甲（審核中）' })).toHaveCount(0);
  await expect(users.getByRole('listitem', { name: '學生乙（審核中）' })).toBeVisible();
  await expect(users).toContainText('已核准 13／名額 49 人');
  expect(backend.callsTo('POST', '/api/admin/users/u-101/approve')).toHaveLength(1);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect(errors).toEqual([]);
});

test('後端沒部署：帳號、AI 申請、後台與批改結果頁都顯示即將開放，不出現錯誤畫面', async ({ page }, testInfo) => {
  const errors = collectErrors(page, [/\/api\/features$/]);
  const backend = await fakeBackend(page, { features: 'not-deployed' });
  const pages: Array<[string, string, RegExp]> = [
    ['/account', '我的帳號', /帳號功能即將開放/],
    ['/account/welcome', '歡迎使用學測英文中心', /帳號功能即將開放/],
    ['/ai/apply', '申請 AI 批改', /AI 批改即將開放/],
    ['/admin', '管理後台', /管理後台即將開放/],
    ['/writing/submissions/sub-1', '批改結果', /AI 批改即將開放/],
  ];
  for (const [path, title, soon] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(soon).first()).toBeVisible();
    await expect(page.locator('a[href*="/auth/"]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  }
  // 只打過 /api/features：不讀 /api/me，也不打任何後台或 AI 端點。
  expect([...new Set(backend.calls.map((c) => c.path))]).toEqual(['/api/features']);
  expect(errors).toEqual([]);
});

test('只開了登入、還沒開 AI：可以登入，AI 申請與寫作頁的 AI 批改顯示即將開放', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: { ...FEATURES_ON, ai: false, ocr: false }, me: signedInMe() });

  await page.goto('/ai/apply');
  await expect(page.getByRole('heading', { level: 1, name: '申請 AI 批改' })).toBeVisible();
  await expect(page.getByText('AI 批改即將開放').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '送出申請' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '小明（帳號選單）' })).toBeVisible();

  await page.goto('/writing/essay/gsat-115');
  await expect(page.getByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeVisible();
  await expect(page.getByText('AI 批改即將開放。')).toBeVisible();
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  await expect(page.getByRole('button', { name: /上傳並辨識/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');

  // AI 沒開：不打 /api/ai/*（額度、申請、任務都不打）。
  expect(backend.calls.filter((c) => c.path.startsWith('/api/ai/'))).toEqual([]);
  expect(errors).toEqual([]);
});
