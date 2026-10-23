/**
 * 學習報告（docs/design/learning-assistant.md §6.4 第 7 項；WP-C）在建置後的產物上跑一次，桌機與手機都要過。
 * 後端用 tests/support/backend.ts 的假 Worker（fakeReports：POST 排入佇列 → GET 一次之後完成，內容是固定的範例報告）。
 *
 *   7. 選前標、每週 2–4 小時 → 產生 → 各大題目標表、逐週計畫（每週分鐘數）→ 勾兩項 → 依這版產生第 2 版（帶回饋）
 *      → 版本選單；模考成績單出現「用這份模考更新學習報告」，連到產生面板；
 *   報告的 daily_limit（今天已經產生 2 份）；手機 375／320 px 沒有水平捲動。
 * 沒有登記的 API 一律回 404、讓 collectErrors 抓到（假後端的既有機制）。
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { FEATURES_ASSISTANT_ON, collectErrors, expectNoHorizontalOverflow, fakeAssist, fakeBackend, fakeReports, signedInMe } from './support/backend';

const APPROVED = signedInMe({ ai_status: 'approved' });
const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

/** 題庫索引（推薦候選用）：給一份空的索引，報告照樣產生。 */
async function mockBankIndex(page: Page) {
  await page.route('**/data/bank/index.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'e2e', count: 0, groups: [] }) }));
}

/** 一份交卷的真題模考（同 assistant.spec.ts 的寫法），讓成績單可以打開。 */
async function seedMock(page: Page) {
  await page.evaluate(() => {
    const now = new Date();
    const started = new Date(now.getTime() - 90 * 60_000).toISOString();
    const at = now.toISOString();
    const record = {
      v: 1,
      id: 'e2e-mock-report',
      paperId: 'gsat-115',
      strict: false,
      predictedScore: null,
      startedAt: started,
      deadlineAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      durationSec: 6000,
      status: 'submitted',
      submittedAt: at,
      submitReason: 'manual',
      activeSectionId: 's1',
      sectionTimeSec: {},
      awaySec: 0,
      marked: [],
      selfScores: {},
      selfDetail: {},
      scaleYear: 115,
      attempt: {
        v: 1,
        examId: 'gsat-115',
        mode: 'exam',
        answers: { '1': 'B' },
        revealed: [],
        timeLimitSec: 6000,
        elapsedSec: 5400,
        startedAt: started,
        updatedAt: at,
        submittedAt: at,
        submitReason: 'manual',
        result: { earned: 1, autoMax: 66 },
      },
    };
    window.localStorage.setItem('gsat-mock:v1:attempt:e2e-mock-report', JSON.stringify(record));
  });
}

test('學習報告：前標、每週 2–4 小時 → 產生 → 目標表與逐週計畫 → 勾兩項 → 第 2 版（帶回饋）→ 版本選單；模考成績單的更新連結', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  // 學習助手首頁的「最近的解析」（GET /api/assist/cases）。
  fakeAssist(backend);
  const reports = fakeReports(backend);
  await mockBankIndex(page);

  // 首頁的學習報告卡片連到報告頁。
  await page.goto('/assistant');
  await page.getByRole('link', { name: /學習報告/ }).click();
  await expect(page).toHaveURL(/\/assistant\/report$/);
  const panel = page.getByRole('region', { name: '產生第一份報告' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('radio', { name: /前標（11 級分）/ })).toBeChecked();
  // 每週時間必填：沒選就送出 → 說明，不送。
  await panel.getByRole('button', { name: '產生報告' }).click();
  await expect(panel.getByText('請先選每週可以用在英文的時間。')).toBeVisible();
  expect(reports.bodies).toHaveLength(0);
  await panel.getByRole('radio', { name: '2–4 小時' }).check();
  await panel.getByRole('button', { name: '產生報告' }).click();

  await expect(page).toHaveURL(/\/assistant\/report\/1$/);
  const table = page.getByRole('table', { name: '各大題的目前表現與目標' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row', { name: /閱讀測驗/ })).toContainText('50%（歷屆首次作答 30 題）');
  await expect(table.getByRole('row', { name: /閱讀測驗/ })).toContainText('約 5.5 分');
  await expect(page.getByText('最近一次真題模考 58 分（含自評）；依 114 年對照表，11 級分要超過 61.71 分，還差約 4 分。')).toBeVisible();
  expect(reports.bodies[0]).toMatchObject({ target: { standard: 'front' }, weekly: '2to4', based_on: null, feedback: null });
  expect(reports.bodies[0]!.summary).toMatchObject({ v: 2, coverage: { devices_note: 'this_device' } });

  // 逐週計畫：每週分鐘數；勾兩項。
  const week1 = page.locator('details', { has: page.getByText(/^第 1 週（/) });
  await expect(week1.getByText('預計 164 分鐘、已完成 0／3 項')).toBeVisible();
  await week1.getByRole('checkbox', { name: /題庫練習・閱讀測驗/ }).check();
  await week1.getByRole('checkbox', { name: /題庫練習・文意選填/ }).check();
  await expect(week1.getByText('預計 164 分鐘、已完成 2／3 項')).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  // 第 2 版：依這版產生，帶回饋。
  await page.getByRole('button', { name: '依這版產生新版本' }).click();
  const next = page.getByRole('region', { name: '依第 1 版產生新版本' });
  await expect(next).toBeVisible();
  await expect(next.getByRole('radio', { name: '2–4 小時' })).toBeChecked();
  await next.getByRole('textbox', { name: /回饋/ }).fill('閱讀比較穩了，作文常寫不完。');
  await next.getByRole('button', { name: '產生新版本' }).click();
  await expect(page).toHaveURL(/\/assistant\/report\/2$/);
  await expect(page.getByRole('heading', { name: '這一版改了什麼' })).toBeVisible();
  expect(reports.bodies[1]).toMatchObject({ based_on: reports.reports[0]!.id, feedback: '閱讀比較穩了，作文常寫不完。' });
  expect(reports.bodies[1]!.summary.plan_progress).toMatchObject({ report_id: reports.reports[0]!.id });
  const versions = page.getByRole('combobox', { name: '版本' });
  await expect(versions.getByRole('option')).toHaveCount(2);
  await versions.selectOption('1');
  await expect(page).toHaveURL(/\/assistant\/report\/1$/);
  // 第 1 版的勾選還在（存在這台裝置）。
  await expect(page.locator('details', { has: page.getByText(/^第 1 週（/) }).getByText('預計 164 分鐘、已完成 2／3 項')).toBeVisible();

  // 模考成績單：已經產生過報告 → 「用這份模考更新學習報告」→ 產生面板。
  await seedMock(page);
  await page.goto('/mock/report/e2e-mock-report');
  const update = page.getByRole('link', { name: '用這份模考更新學習報告' });
  await expect(update).toBeVisible();
  await update.click();
  await expect(page).toHaveURL(/\/assistant\/report\?refresh=1$/);
  await expect(page.getByRole('region', { name: '依第 2 版產生新版本' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('報告每天 2 份：第 3 份顯示 daily_limit 的說明', async ({ page }) => {
  const errors = collectErrors(page, [/\/api\/assist\/reports$/]);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  fakeReports(backend);
  backend.on('POST /api/assist/reports', () => ({ status: 429, json: { error: { code: 'daily_limit', message: 'e2e daily_limit', reason: 'assist_report' } } }));
  await mockBankIndex(page);
  await page.goto('/assistant/report');
  const panel = page.getByRole('region', { name: '產生第一份報告' });
  await panel.getByRole('radio', { name: '2 小時以內' }).check();
  await panel.getByRole('button', { name: '產生報告' }).click();
  await expect(panel.getByText('今天已經產生 2 份學習報告，明天再試。')).toBeVisible();
  expect(errors).toEqual([]);
});
