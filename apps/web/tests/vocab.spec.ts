/**
 * 單字模組的流程測試（建置後的產物＋真的資料檔 /data/vocab/*.json）：
 *   1. 單字庫搜尋 → 單字卡（例句授權標示、Cambridge 外連）→ 同義詞 → 返回；
 *   2. 測驗：英選中 10 題做完看到成績；
 *   3. 每日學習：翻卡、評分，重新整理後進度還在。
 * 桌機與手機（playwright.config.ts 的兩個 project）各跑一次；手機另外在 320px 檢查各分頁與單字卡沒有水平捲動。
 * 斷言只依賴詞彙表本身（abandon 是 L4 動詞），不依賴例句內容，資料更新時不必改測試。
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

test('單字庫 → 單字卡 → 同義詞 → 返回', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/words');
  const search = page.getByRole('searchbox', { name: '搜尋單字' });
  await expect(page.getByText(/^共 [\d,]+ 筆$/)).toBeVisible();
  // 清單分段加 content-visibility（LibraryView 的 WordChunk），輔助科技看到的仍是同一張清單；按「顯示更多」至少再補 50 筆
  // （點按鈕時頁面捲到底部，接近底部的自動補載也可能一起觸發，所以只檢查下限）。
  const list = page.getByRole('list', { name: '單字列表' });
  await expect(list.getByRole('listitem')).toHaveCount(50);
  await page.getByRole('button', { name: /^顯示更多/ }).click();
  await expect.poll(() => list.getByRole('listitem').count()).toBeGreaterThanOrEqual(100);
  await search.fill('abandon');
  const link = page.getByRole('link', { name: /^abandon/ });
  await expect(link).toBeVisible();
  await link.click();

  const card = page.getByRole('region', { name: '單字卡' });
  await expect(card.getByRole('heading', { level: 2, name: 'abandon' })).toBeVisible();
  await expect(page).toHaveURL(/word=abandon/);
  await expect(card.getByText(/^正解 \d+ 次、選項 \d+ 次、選文 \d+ 次$/)).toBeVisible();
  const cambridge = card.getByRole('link', { name: /在 Cambridge 辭典查看/ });
  await expect(cambridge).toHaveAttribute('target', '_blank');
  await expect(cambridge).toHaveAttribute('rel', /noopener/);
  // 每句例句都有英文與中文兩個 Tatoeba 標示連結
  const attributions = card.getByRole('link', { name: /^Tatoeba #\d+/ });
  const zhAttributions = card.getByRole('link', { name: /^中文 Tatoeba #\d+/ });
  await expect(attributions.first()).toBeVisible();
  expect(await attributions.count()).toBe(await zhAttributions.count());

  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page);
  }

  // 同義詞（詞彙表內的字）可以點過去，返回時回到 abandon、再返回回到單字庫且搜尋字還在
  const synonym = card.getByRole('link', { name: /Level \d/ }).first();
  const synonymWord = ((await synonym.locator('span[lang="en"]').textContent()) ?? '').trim();
  await synonym.click();
  await expect(card.getByRole('heading', { level: 2, name: synonymWord })).toBeVisible();
  await card.getByRole('button', { name: '返回' }).click();
  await expect(card.getByRole('heading', { level: 2, name: 'abandon' })).toBeVisible();
  await card.getByRole('button', { name: '返回' }).click();
  await expect(search).toHaveValue('abandon');
  await expect(link).toBeVisible();
  expect(errors).toEqual([]);
});

test('測驗：英選中 10 題，作答後立即回饋，結束顯示成績', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/words?tab=quiz');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  for (let i = 1; i <= 10; i += 1) {
    await expect(page.getByRole('heading', { name: new RegExp(`第 ${i} 題`) })).toBeVisible();
    await page.getByRole('list', { name: '選項' }).getByRole('button').nth(i % 4).click();
    await expect(page.getByText(/^(答對了！|答錯了)$/)).toBeVisible();
    await page.getByRole('button', { name: i === 10 ? '看成績' : '下一題' }).click();
  }
  await expect(page.getByRole('heading', { name: '測驗結果（英選中）' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('每日學習：翻卡、評分，重新整理後進度還在', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/words?tab=study');
  await page.getByRole('button', { name: /開始學習（\d+ 張）/ }).click();
  await page.getByRole('button', { name: '顯示答案' }).click();
  await page.getByRole('group', { name: /評分/ }).getByRole('button', { name: /^良好/ }).click();
  await expect(page.getByRole('button', { name: '顯示答案' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('今天已學 1 個')).toBeVisible();
  await expect(page.getByText('1 天', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('各分頁在手機最窄寬度（320px）沒有水平捲動', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '只在手機版面檢查');
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 667 });
  for (const tab of ['library', 'study', 'quiz', 'mistakes']) {
    await page.goto(`/words?tab=${tab}`);
    await expect(page.getByRole('navigation', { name: '單字功能' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});
