/**
 * 學習助手（docs/design/learning-assistant.md §6.4）在建置後的產物上跑一次，桌機與手機都要過。
 * 後端用 tests/support/backend.ts 的假 Worker（fakeAssist：建立案例 → 排入佇列 → 輪詢完成、追問、懂了嗎）；
 * 題庫題用 tests/fixtures/bank-public 的範例資料，歷屆試題與模考用建置產生的真資料檔。
 *
 *   1. 開關關著（以及 admin 模式下的一般學生）：導覽、首頁、練習交卷後都沒有學習助手，錯題清單顯示暫停使用中，
 *      /assistant 是唯讀模式（之前的題目可以看與刪除，不能送出新的）；緊急關閉後，之前問過的題目照樣看得到、刪得掉；
 *   2. 題庫練習的文意選填錯兩格 → 「問學習助手」→ 確認頁預設勾兩格、8 點 → 送出 → 輪詢到完成 → 全篇結構與逐題
 *      → 追問一次（3 點）→ 回覆 → 懂了嗎；
 *   3. 歷屆試題答對的題「這題有疑問？」→ 在兩個選項之間猶豫 → 共用快取命中（0 點）；
 *   4. 真題模考成績單的作文「先送 AI 批改，再問學習助手」→ 作文作答頁已填入模考答案；
 *   5. 貼上題目：含「佳作一」在瀏覽器就擋下、命中位置加亮；D8 拒收的錯誤與位置（Worker 回的 ranges）；
 *   8. 額度與上限：送出解析 quota_day（案例留著，可以稍後再送）、追問 assist_limit；
 *   9. 沒登入：錯題清單照常，確認頁的送出換成登入說明；
 *  10. 手機 375／320 px 沒有水平捲動；桌機 1440 的案例頁分欄。
 * 拍照（6）是 WP-A3、學習報告（7）與報告的 daily_limit 是 WP-C 的範圍，不在這裡。
 * 沒有登記的 API 一律回 404、讓 collectErrors 抓到（假後端的既有機制）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CreateAssistCaseBody, CreateAssistFollowupBody } from '@gsat/shared';
import {
  FEATURES_ASSISTANT_ON,
  FEATURES_ON,
  ME_ASSISTANT_PREVIEW,
  collectErrors,
  ok,
  expectNoHorizontalOverflow,
  fakeAssist,
  fakeBackend,
  signedInMe,
  type FakeBackend,
  type Reply,
} from './support/backend';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bank-public');
const APPROVED = signedInMe({ ai_status: 'approved' });
/** 範例文意選填（ai.wb.0a1b2c@1）的答案。 */
const WB_REF = 'ai.wb.0a1b2c@1';
const WB_KEYS: Record<string, string> = { '1': 'E', '2': 'G', '3': 'B', '4': 'D', '5': 'I', '6': 'H', '7': 'C', '8': 'A', '9': 'F', '10': 'J' };
const TYPED_QUESTION = 'The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend';

/** 假的 /data/bank/*：範例輸出（同 practice.spec.ts）。 */
async function mockBank(page: Page) {
  await page.route('**/data/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    const file = path.join(FIXTURE_DIR, rel);
    if (!rel.startsWith('bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
}

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

/** 文意選填：點空格 → 在空格下方的面板點選項。 */
async function fillBlank(page: Page, label: string, letter: string) {
  await page.getByRole('button', { name: `第 ${label} 題空格，未作答` }).click();
  await page
    .getByRole('group', { name: `第 ${label} 題的選項` })
    .getByRole('button', { name: new RegExp(`^\\(${letter}\\)`) })
    .click();
  await expect(page.getByRole('button', { name: new RegExp(`^第 ${label} 題空格，已填 \\(${letter}\\)`) })).toBeVisible();
}

/** 題庫練習的文意選填：第 1、2 格對調（兩格都錯），其他全對，交卷。 */
async function doWordBank(page: Page) {
  await page.goto('/practice/word-bank/advanced');
  await expect(page.getByRole('heading', { level: 1, name: '文意選填・進階練習' })).toBeVisible();
  const answers: Record<string, string> = { ...WB_KEYS, '1': 'G', '2': 'E' };
  for (const [label, letter] of Object.entries(answers)) await fillBlank(page, label, letter);
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  const result = page.getByRole('region', { name: '交卷結果' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('8／10 題');
}

/** 桌機的案例頁右欄是「解析｜追問」分頁；手機是一頁往下。 */
async function openFollowups(page: Page, testInfo: TestInfo) {
  if (!isMobile(testInfo)) await page.getByRole('tab', { name: /^追問/ }).click();
}

async function openAnalysis(page: Page, testInfo: TestInfo) {
  if (!isMobile(testInfo)) await page.getByRole('tab', { name: '解析' }).click();
}

async function expectNoAssistant(page: Page, backend: FakeBackend) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('a[href="/assistant"]')).toHaveCount(0);
  await expect(page.getByText('學習助手')).toHaveCount(0);

  await doWordBank(page);
  await expect(page.locator('[data-assist-entry]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /問學習助手|這題有疑問/ })).toHaveCount(0);

  await page.goto('/assistant/mistakes');
  await expect(page.getByText(/學習助手暫停使用中/)).toBeVisible();
  expect(backend.calls.filter((c) => c.path.startsWith('/api/assist/'))).toEqual([]);

  // 學習助手首頁：已登入的學生是唯讀模式（之前的題目與報告可以看與刪除），沒有送出新題目的入口。
  backend.on('GET /api/assist/cases', () => ok({ cases: [], next_cursor: null, error_counts: {} }));
  await page.goto('/assistant');
  await expect(page.getByText(/學習助手暫停使用中/).first()).toBeVisible();
  await expect(page.getByText('沒有之前的解析紀錄。')).toBeVisible();
  await expect(page.locator('a[href="/assistant/new"]')).toHaveCount(0);
  await expect(page.locator('a[href="/assistant/mistakes"]')).toHaveCount(0);
  expect(backend.calls.filter((c) => c.path.startsWith('/api/assist/') && c.method !== 'GET')).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await mockBank(page);
});

test('開關關著：導覽、首頁、練習交卷後都沒有學習助手，錯題清單暫停使用中，/assistant 是唯讀模式', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ON, me: APPROVED });
  await expectNoAssistant(page, backend);
  expect(errors).toEqual([]);
});

test('admin 模式：一般學生看不到；管理員（assistant_preview）看得到', async ({ page }) => {
  const errors = collectErrors(page);
  // admin 模式時公開的 /api/features 沒有 assistant 欄位；一般學生的 /api/me 也沒有 assistant_preview。
  const backend = await fakeBackend(page, { features: FEATURES_ON, me: APPROVED });
  await expectNoAssistant(page, backend);

  fakeAssist(backend);
  backend.me = ME_ASSISTANT_PREVIEW;
  await page.goto('/');
  await expect(page.locator('a[href="/assistant"]').first()).toBeAttached();
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { level: 1, name: '學習助手' })).toBeVisible();
  await expect(page.getByText(/學習助手暫停使用中/)).toHaveCount(0);
  await expect(page.locator('a[href="/assistant/new"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('題庫練習 → 問學習助手：預設勾兩格、8 點 → 輪詢到完成 → 追問（3 點）→ 懂了嗎', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  const assist = fakeAssist(backend, { keys: WB_KEYS });

  await doWordBank(page);
  // 每格解析卡下方：錯的是「問學習助手」，對的是「這題有疑問？」。
  await expect(page.getByRole('link', { name: '問學習助手：第 1 題' })).toBeVisible();
  await expect(page.getByRole('link', { name: '這題有疑問？：第 3 題' })).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await page.getByRole('link', { name: '問學習助手：這一組的錯題與疑點' }).click();

  // 確認頁：只在瀏覽器組預覽，不打 API；預設勾兩格錯的、8 點。
  await expect(page).toHaveURL(/\/assistant\/ask\?src=bank&ref=ai\.wb\.0a1b2c%401&label=1&label=2$/);
  await expect(page.getByRole('heading', { level: 1, name: '請學習助手解析' })).toBeVisible();
  await expect(page.getByText('你正在和 AI 互動', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^第 1 格/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^第 2 格/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^第 3 格/ })).not.toBeChecked();
  await expect(page.getByText(/解析 2 格會用 8 點；今天還剩 20 點/)).toBeVisible();
  await page.getByRole('checkbox', { name: /^第 3 格/ }).check();
  await expect(page.getByText(/解析 3 格會用 10 點/)).toBeVisible();
  await page.getByRole('checkbox', { name: /^第 3 格/ }).uncheck();
  await expect(page.getByText(/解析 2 格會用 8 點/)).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(backend.callsTo('POST', '/api/assist/cases')).toHaveLength(0);

  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);
  const created = backend.callsTo('POST', '/api/assist/cases')[0]?.json as CreateAssistCaseBody;
  expect(created.source).toMatchObject({ source: 'bank', ref: WB_REF, labels: ['1', '2'] });
  expect(created.source.source === 'bank' && created.source.answers).toMatchObject({ '1': 'G', '2': 'E', '3': 'B' });
  expect(backend.callsTo('POST', '/api/assist/cases/case-1/analyze')).toHaveLength(1);

  // 輪詢：先看到進行中，完成後出現全篇結構與逐題。
  await expect(page.getByRole('heading', { level: 1, name: /文意選填：第 1、2 格/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^全篇結構與這組的線索/ })).toBeVisible({ timeout: 15_000 });
  const perItem = page.getByRole('region', { name: /^逐題解析/ });
  await expect(perItem.getByRole('heading', { name: '第 1 題', exact: true })).toBeVisible();
  await expect(perItem.getByRole('heading', { name: '第 2 題', exact: true })).toBeVisible();
  await expect(perItem).toContainText('第 1 格：詞性對了，但語意和前後文接不起來。');
  await expect(page.getByText('答案與本站解析以題目頁為準；AI 的說明是補充。')).toBeVisible();
  expect(assist.cases.get('case-1')?.status).toBe('analyzed');
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  // 追問一次（3 點）。
  await openFollowups(page, testInfo);
  const composer = page.getByRole('textbox', { name: '還有問題？繼續追問' });
  await page.getByRole('button', { name: '可以再舉一個例句嗎？' }).click();
  await expect(composer).toHaveValue('可以再舉一個例句嗎？');
  await composer.fill('那 retain 什麼時候可以用？');
  await page.getByRole('button', { name: '送出追問（用 3 點）' }).click();
  await expect(page.getByText('retain 是「保留、維持」，後面直接接受詞，不接 from。')).toBeVisible({ timeout: 15_000 });
  const followup = backend.callsTo('POST', '/api/assist/cases/case-1/followups')[0]?.json as CreateAssistFollowupBody;
  expect(followup).toMatchObject({ text: '那 retain 什麼時候可以用？', mode: 'explain', label: null });
  await expect(composer).toHaveValue('');

  // 懂了嗎：PATCH，存在案例上。
  await openAnalysis(page, testInfo);
  await page.getByRole('radio', { name: '懂了', exact: true }).check();
  await expect(page.getByText('已記下「懂了」')).toBeVisible();
  expect(assist.cases.get('case-1')?.understood).toBe('yes');
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  // 學習助手首頁：最近問過的題目。
  await page.goto('/assistant');
  await expect(page.getByRole('link', { name: /文意選填：第 1、2 格/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('緊急關閉（開關改成 off）：已登入的學生仍然可以看之前的題目、改懂了嗎與刪除；不能追問或送出新的', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  const assist = fakeAssist(backend, { keys: WB_KEYS });
  await doWordBank(page);
  await page.getByRole('link', { name: '問學習助手：這一組的錯題與疑點' }).click();
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page.getByRole('heading', { name: /^全篇結構與這組的線索/ })).toBeVisible({ timeout: 15_000 });

  // 站主把 AI_ASSISTANT 改成 off：/api/features 不再有 assistant。
  backend.features = FEATURES_ON;
  await page.goto('/assistant');
  await expect(page.getByText(/學習助手暫停使用中/).first()).toBeVisible();
  await expect(page.locator('a[href="/assistant/new"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await page.getByRole('link', { name: /文意選填：第 1、2 格/ }).click();
  await expect(page.getByRole('heading', { name: /^全篇結構與這組的線索/ })).toBeVisible();
  await expect(page.getByText(/學習助手暫停使用中/).first()).toBeVisible();
  await openFollowups(page, testInfo);
  await expect(page.getByRole('textbox', { name: '還有問題？繼續追問' })).toHaveCount(0);
  await openAnalysis(page, testInfo);
  await page.getByRole('radio', { name: '懂了', exact: true }).check();
  await expect(page.getByText('已記下「懂了」')).toBeVisible();
  expect(assist.cases.get('case-1')?.understood).toBe('yes');
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await page.getByRole('button', { name: '刪除這一題' }).click();
  await page.getByRole('button', { name: '確定刪除' }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByText('沒有之前的解析紀錄。')).toBeVisible();
  expect(assist.cases.size).toBe(0);
  expect(backend.callsTo('POST', '/api/assist/cases/case-1/followups')).toHaveLength(0);

  // 錯題清單（送出新題目的入口）照樣關著，指回首頁看之前的紀錄。
  await page.goto('/assistant/mistakes');
  await expect(page.getByText(/學習助手暫停使用中/)).toBeVisible();
  await expect(page.getByRole('link', { name: '看之前的題目與學習報告' })).toHaveAttribute('href', '/assistant');
  expect(errors).toEqual([]);
});

test('歷屆試題答對的題「這題有疑問？」→ 在兩個選項之間猶豫 → 共用快取命中（0 點）', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  fakeAssist(backend, { analyze: 'cache_hit', keys: { '35': 'C' } });

  await page.goto('/exams/gsat-115');
  await page.getByRole('button', { name: '開始作答' }).click();
  const q = page.locator('#q-35');
  await q.getByRole('radio', { name: /^\(C\)/ }).check();
  await q.getByRole('button', { name: '看答案' }).click();
  await expect(q.getByTestId('question-feedback')).toContainText('答對');
  await q.getByRole('link', { name: '這題有疑問？：第 35 題' }).click();

  await expect(page).toHaveURL(/\/assistant\/ask\?src=exam&exam=gsat-115&label=35$/);
  await expect(page.getByRole('heading', { level: 1, name: '請學習助手解析' })).toBeVisible();
  await page.getByRole('checkbox', { name: '我在 (C) 和另一個選項之間猶豫' }).check();
  await page.getByRole('combobox', { name: '另一個讓你猶豫的選項' }).selectOption('B');
  await expect(page.getByText(/解析 1 題會用 6 點/)).toBeVisible();
  await expect(page.getByText('之前有同學問過同一題同樣的答案時，0 點。')).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await page.getByRole('button', { name: '送出解析' }).click();

  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);
  await expect(page.getByText('這份解析之前已經有同學問過，免費提供（0 點）。')).toBeVisible();
  await expect(page.getByText('在 (C) 和 (B) 之間猶豫')).toBeVisible();
  await expect(page.getByText('這份解析由 AI 即時產生，沒有經過人工審核；答案以官方公布為準。')).toBeVisible();
  const created = backend.callsTo('POST', '/api/assist/cases')[0]?.json as CreateAssistCaseBody;
  expect(created).toMatchObject({ doubt_kinds: ['torn_between'], torn_with: 'B', doubt: null });
  expect(created.source).toMatchObject({ source: 'exam', exam_id: 'gsat-115', labels: ['35'], via: 'exam' });
  expect(created.source.source === 'exam' && created.source.answers['35']).toBe('C');
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('真題模考成績單：作文「先送 AI 批改，再問學習助手」→ 作文作答頁已填入模考答案', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  const essay = 'Last summer I joined a beach clean-up with my classmates.\nIt taught me that small actions can make a big difference.';
  await page.goto('/');
  await page.evaluate((text) => {
    const now = new Date();
    const started = new Date(now.getTime() - 90 * 60_000).toISOString();
    const at = now.toISOString();
    const record = {
      v: 1,
      id: 'e2e-mock-1',
      paperId: 'gsat-115',
      strict: false,
      predictedScore: null,
      startedAt: started,
      deadlineAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      durationSec: 6000,
      status: 'submitted',
      submittedAt: at,
      submitReason: 'manual',
      activeSectionId: 's8',
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
        answers: { '1': 'B', 英文作文: text },
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
    window.localStorage.setItem('gsat-mock:v1:attempt:e2e-mock-1', JSON.stringify(record));
  }, essay);

  await page.goto('/mock/report/e2e-mock-1');
  const handoff = page.getByRole('button', { name: '先送 AI 批改，再問學習助手：英文作文' });
  await expect(handoff).toBeVisible();
  // 中譯英沒作答：不出現（沒有東西可以帶過去）。
  await expect(page.getByRole('button', { name: '先送 AI 批改，再問學習助手：中譯英' })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await handoff.click();

  await expect(page).toHaveURL(/\/writing\/essay\/gsat-115$/);
  await expect(page.getByText('已帶入模考的答案；送出 AI 批改後，結果頁可以請學習助手解析這份批改。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '你的作文（段落之間換行）' })).toHaveValue(essay);
  // 轉接只用一次：重新整理後不再出現提示（草稿已經存在這台裝置）。
  await page.reload();
  await expect(page.getByRole('textbox', { name: '你的作文（段落之間換行）' })).toHaveValue(essay);
  await expect(page.getByText('已帶入模考的答案', { exact: false })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('貼上題目：「佳作一」在瀏覽器就擋下並加亮；D8 拒收顯示 Worker 回的位置', async ({ page }, testInfo) => {
  const errors = collectErrors(page, [/\/api\/assist\/cases$/]);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  fakeAssist(backend);

  await page.goto('/assistant/new');
  await expect(page.getByRole('heading', { level: 1, name: '貼上題目' })).toBeVisible();
  const text = page.getByRole('textbox', { name: '題目全文（必填）' });
  await text.fill(`佳作一\n${TYPED_QUESTION}`);
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '題目裡有評分說明、範文或佳作' })).toBeVisible();
  await expect(page.getByText('命中的位置（刪掉這一段再送出）：')).toBeVisible();
  await expect(page.locator('mark').filter({ hasText: '佳作' })).toBeVisible();
  expect(backend.callsTo('POST', '/api/assist/cases')).toHaveLength(0);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  // D8 指紋只有 Worker 會比對：400 assist_input_invalid＋ranges。
  backend.on('POST /api/assist/cases', (): Reply => ({
    status: 400,
    json: {
      error: {
        code: 'assist_input_invalid',
        reason: 'official_material',
        field: 'blocks[0].text',
        ranges: [[0, 16]],
        message: 'e2e official_material',
      },
    },
  }));
  await text.fill(TYPED_QUESTION);
  await expect(page.getByText('命中的位置（刪掉這一段再送出）：')).toHaveCount(0);
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page.getByText('題目裡有一段和官方受保護的資料（評分原則或參考譯文）相同，請刪掉那一段再送出。')).toBeVisible();
  await expect(page.locator('mark').filter({ hasText: 'The city counci' })).toBeVisible();
  expect(backend.callsTo('POST', '/api/assist/cases')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('額度與上限：送出解析 quota_day（案例留著，之後再送）；追問 assist_limit', async ({ page }, testInfo) => {
  const errors = collectErrors(page, [/\/api\/assist\/cases\/[^/]+\/(analyze|followups)$/]);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  const assist = fakeAssist(backend);
  let quotaOut = true;
  backend.on('POST /api/assist/cases/:id/analyze', (call) =>
    quotaOut ? { status: 429, json: { error: { code: 'quota_day', message: 'e2e quota_day' } } } : (assist.handlers['POST /api/assist/cases/:id/analyze']?.(call) ?? { status: 500 }),
  );
  backend.on('POST /api/assist/cases/:id/followups', () => ({
    status: 429,
    json: { error: { code: 'assist_limit', reason: 'followups_per_case', message: 'e2e assist_limit' } },
  }));

  await page.goto('/assistant/new');
  await page.getByRole('textbox', { name: '題目全文（必填）' }).fill(TYPED_QUESTION);
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('B');
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page.getByText(/今日點數已用完/)).toBeVisible();
  expect(assist.cases.size).toBe(1);

  // 額度恢復後重送：沿用同一個案例（PUT …/question），不重複建立。
  quotaOut = false;
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);
  expect(backend.callsTo('POST', '/api/assist/cases')).toHaveLength(1);
  expect(backend.callsTo('PUT', '/api/assist/cases/case-1/question')).toHaveLength(1);
  await expect(page.getByText('你提供的題目沒有經過本站確認；AI 判斷的答案可能有錯，請對照課本或老師的答案。')).toBeVisible({ timeout: 15_000 });

  await openFollowups(page, testInfo);
  await page.getByRole('textbox', { name: '還有問題？繼續追問' }).fill('為什麼不是 (A)？');
  await page.getByRole('button', { name: '送出追問（用 3 點）' }).click();
  await expect(page.getByText('這一題已經追問 8 次，建議開新的一題，或把疑問寫進學習報告的回饋。')).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('沒登入：錯題清單照常，確認頁的送出換成登入說明', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON });

  await doWordBank(page);
  await page.goto('/assistant/mistakes');
  await expect(page.getByRole('heading', { level: 1, name: '錯題與疑點' })).toBeVisible();
  // 手機是每列的「問學習助手」，桌機是表格每列的題目連結；兩者都到確認頁。
  const ask = page.getByRole('main').locator('a[href^="/assistant/ask?src=bank"]').first();
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAccessibleName(/文意選填（進階練習）：第 1、2 格$/);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await ask.click();

  await expect(page.getByRole('heading', { level: 1, name: '請學習助手解析' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^第 1 格/ })).toBeChecked();
  await expect(page.getByText('請學習助手解析要先登入並申請使用 AI。', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '用 Google 登入', exact: true })).toHaveAttribute('href', /^\/auth\/google\/start\?next=%2Fassistant%2Fask/);
  await expect(page.getByRole('button', { name: '送出解析' })).toHaveCount(0);
  expect(backend.calls.filter((c) => c.path.startsWith('/api/assist/'))).toEqual([]);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('桌機 1440：案例頁左欄題目、右欄解析與追問；追問輸入框在寬度改變時不重新掛載', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), '桌機版面');
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: APPROVED });
  fakeAssist(backend, { analyze: 'cache_hit', keys: WB_KEYS });

  await doWordBank(page);
  await page.getByRole('link', { name: '問學習助手：這一組的錯題與疑點' }).click();
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);

  const left = page.locator('#assist-question');
  const right = page.locator('#assist-answer');
  await expect(left.getByRole('heading', { name: '題目', exact: true })).toBeVisible();
  await expect(right.getByRole('tab', { name: '解析' })).toHaveAttribute('aria-selected', 'true');
  await expect(right.getByRole('heading', { name: /^逐題解析/ })).toBeVisible();
  const [l, r] = [await left.boundingBox(), await right.boundingBox()];
  expect(l && r && l.x + l.width <= r.x + 1).toBe(true);
  // 證據句在左欄的選文裡加亮。
  await expect(left.locator('mark').first()).toBeVisible();

  await right.getByRole('tab', { name: /^追問/ }).click();
  const composer = right.getByRole('textbox', { name: '還有問題？繼續追問' });
  await composer.fill('草稿還在嗎？');
  await composer.evaluate((el) => el.setAttribute('data-e2e-mounted', '1'));
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(composer).toHaveAttribute('data-e2e-mounted', '1');
  await expect(composer).toHaveValue('草稿還在嗎？');
  await expectNoHorizontalOverflow(page, false);
  expect(errors).toEqual([]);
});
