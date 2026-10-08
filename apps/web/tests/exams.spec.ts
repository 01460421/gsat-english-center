/**
 * 歷屆試題的作答流程（建置後的產物＋真的資料檔 /data/exams/*.json）：
 *   1. 列表依考試與學年度篩選、進入考卷、回列表時篩選條件還在；
 *   2. 考試模式：選擇題、綜合測驗空格、文意選填晶片作答 → 重新整理後續作 → 交卷計分；
 *   3. 練習模式看答案（全國答對率與選項分布）；
 *   4. 中譯英：資料檔與畫面都沒有官方參考譯文，只連到官方評分原則（站主決定 D8）；
 *   5. 考卷不存在或離線：顯示說明與「再試一次」，失敗的請求不會一直重送。
 * 桌機與手機（playwright.config.ts 的兩個 project）各跑一次，順便檢查作答頁在手機上沒有水平捲動。
 */
import { expect, test, type Page } from '@playwright/test';

async function mockBackend(page: Page) {
  await page.route(/\/(api|auth)\//, (route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'e2e' } } }));
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `頁面寬 ${scrollWidth}px 超出視窗 ${viewport}px`).toBeLessThanOrEqual(viewport);
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('列表：依考試與學年度篩選，進入考卷後可以帶著篩選條件回來', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/exams');
  await expect(page.getByRole('link', { name: /115 學測/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /115 學測/ })).toContainText('新制');

  // 篩選鈕是視覺隱藏的 radio，點它的 label。
  await page.locator('label').filter({ hasText: /^指考/ }).click();
  await expect(page).toHaveURL(/kind=ast/);
  await page.getByRole('combobox', { name: '學年度' }).selectOption('110');
  const cards = page.getByRole('main').getByRole('link', { name: /指考/ });
  await expect(cards).toHaveCount(1);
  await cards.first().click();

  await expect(page.getByRole('heading', { level: 1, name: '110學年度指定科目考試英文考科' })).toBeVisible();
  await expect(page).toHaveTitle(/110 指考/);
  await page.getByRole('link', { name: '歷屆試題列表' }).click();
  await expect(page).toHaveURL(/\/exams\?kind=ast&year=110$/);
  await expect(page.getByRole('combobox', { name: '學年度' })).toHaveValue('110');
  expect(errors).toEqual([]);
});

test('考試模式：作答、重新整理後續作、交卷計分', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/exams/gsat-115');
  await page.locator('label').filter({ hasText: '考試模式' }).click();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/剩餘時間/);

  // 詞彙題（正解 B）
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  // 綜合測驗：點空格、在空格下方的面板選（正解 B）
  await page.getByRole('button', { name: '第 11 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 11 題的選項' }).getByRole('button', { name: /it turns out/ }).click();
  await expect(page.getByRole('button', { name: /^第 11 題空格，已填 \(B\)/ })).toBeVisible();
  // 文意選填：點空格、點晶片（正解 E）
  await page.getByRole('button', { name: '第 21 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 21 題的選項' }).getByRole('button', { name: /^\(E\)/ }).click();
  await expect(page.getByRole('button', { name: /^第 21 題空格，已填 \(E\)/ })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page);
  }

  await page.reload();
  await expect(page.getByText(/已接續上次的作答進度（考試模式，已答 3 題）/)).toBeVisible();
  await expect(page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ })).toBeChecked();
  await expect(page.getByRole('button', { name: /^第 21 題空格，已填 \(E\)/ })).toBeVisible();

  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  const result = page.getByRole('region', { name: '交卷結果' });
  await expect(result).toBeVisible();
  // 3 題各 1 分全對；選擇題（含混合題多選）滿分 66。
  await expect(result.getByText('3／66', { exact: true })).toBeVisible();
  await expect(page.locator('#q-1').getByTestId('question-feedback')).toContainText('答對');
  expect(errors).toEqual([]);
});

test('練習模式：看答案顯示全國答對率與選項分布', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/exams/gsat-115');
  await page.getByRole('button', { name: '開始作答' }).click();
  const q = page.locator('#q-35');
  await q.getByRole('radio', { name: /^\(C\)/ }).check();
  await q.getByRole('button', { name: '看答案' }).click();
  const feedback = q.getByTestId('question-feedback');
  await expect(feedback).toContainText('答對 +2 分');
  await expect(feedback).toContainText('全國答對率');
  await expect(feedback.getByRole('list', { name: '全國考生各選項選答比例' })).toContainText('52%');
  await expect(page.getByText('試題來源：大學入學考試中心 115學年度學科能力測驗英文考科（115 學年度）')).toBeVisible();
  expect(errors).toEqual([]);
});

test('中譯英：公開的資料檔與畫面都沒有官方參考譯文，只連到官方評分原則（D8）', async ({ page, request }) => {
  const errors = collectErrors(page);
  // 資料檔本身就不能有：靜態檔任何人都下載得到，只在畫面上藏起來不夠。
  const exam: { sections: { groups: { questions: Record<string, unknown>[] }[] }[] } = await (await request.get('/data/exams/gsat-115.json')).json();
  const translations = exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).filter((q) => q['mode'] === 'translation');
  expect(translations.length).toBe(2);
  for (const q of translations) {
    for (const key of ['answer', 'accepted_answers', 'answer_segments', 'answer_variants', 'answer_is_composite', 'scoring_notes']) {
      expect(q, `中譯英 ${String(q['label'])} 不該有 ${key}`).not.toHaveProperty(key);
    }
  }

  await page.goto('/exams/gsat-115');
  await page.getByRole('button', { name: '開始作答' }).click();
  const card = page.locator('[id="q-中譯英1"]');
  await card.getByRole('textbox', { name: '英文譯文' }).fill('More and more people prefer cashless payment.');
  await card.getByRole('button', { name: '看說明' }).click();
  const feedback = card.getByTestId('question-feedback');
  await expect(feedback).toContainText('本題官方參考譯文請見大考中心');
  await expect(feedback.getByRole('link', { name: /非選擇題評分原則/ })).toHaveAttribute('href', /^https:\/\/www\.ceec\.edu\.tw\//);
  await expect(feedback).not.toContainText('官方參考答案');
  expect(errors).toEqual([]);
});

test('考卷不存在或資料載入失敗：顯示說明而且不會無限重抓', async ({ page }) => {
  // 回歸測試：Promise 曾在 Suspense 裡面建立，失敗後每次重繪都發新請求，正式版在 3 秒內打了近 800 次 404，
  // 畫面永遠停在「載入中」。這裡數請求次數，確認失敗的請求只送一次（React 重試時最多兩次）。
  const examRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/data/exams/')) examRequests.push(req.url());
  });
  await page.goto('/exams/gsat-999');
  await expect(page.getByRole('heading', { level: 1, name: '找不到這份考卷' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(examRequests.filter((u) => u.endsWith('/gsat-999.json')).length).toBeLessThanOrEqual(2);

  // 列表的索引檔連不上（離線）：顯示錯誤與「再試一次」，恢復連線後重試成功。
  let offline = true;
  await page.route('**/data/exams/index.json', (route) => (offline ? route.abort('internetdisconnected') : route.continue()));
  await page.goto('/exams');
  await expect(page.getByRole('alert')).toContainText('無法連線');
  const indexRequests = examRequests.filter((u) => u.endsWith('/index.json')).length;
  await page.waitForTimeout(500);
  expect(examRequests.filter((u) => u.endsWith('/index.json')).length - indexRequests).toBe(0);
  offline = false;
  await page.getByRole('button', { name: '再試一次' }).click();
  await expect(page.getByRole('link', { name: /115 學測/ })).toBeVisible();
});
