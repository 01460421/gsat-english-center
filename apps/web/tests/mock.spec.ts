/**
 * 模擬考（建置後的產物＋真的資料檔 /data/exams/gsat-115.json、score-scales.json）：
 *   列表 → 115 學測開考 → 作答 3 題、標記 → 重新整理後答案、目前大題、標記與剩餘時間都還在（ROADMAP Phase 2 驗收第 7 項前半）
 *   → 交卷（一般模式）→ 成績單有原得總分、級分（非官方）、五標與聲明 → 列表顯示已完成。
 * 桌機與手機（playwright.config.ts 的兩個 project）各跑一次；手機另外在 320px 檢查沒有水平捲動。
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

async function expectNoHorizontalOverflow(page: Page, where: string) {
  const { scrollWidth, viewport } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where}：頁面寬 ${scrollWidth}px 超出視窗 ${viewport}px`).toBeLessThanOrEqual(viewport);
}

async function checkNarrow(page: Page, mobile: boolean, where: string) {
  await expectNoHorizontalOverflow(page, where);
  if (!mobile) return;
  await page.setViewportSize({ width: 320, height: 667 });
  await expectNoHorizontalOverflow(page, `${where}（320px）`);
  await page.setViewportSize({ width: 375, height: 667 });
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('115 學測模擬考：作答、重新整理後接續、交卷看級分與五標', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile';
  const errors = collectErrors(page);

  // 列表：卷別順序與 ref-115 的沿用題提醒。
  await page.goto('/mock');
  await expect(page.getByRole('heading', { level: 1, name: '模擬考' })).toBeVisible();
  const cards = page.getByRole('region', { name: '卷別' }).getByRole('article');
  await expect(cards).toHaveCount(6);
  await expect(cards.getByRole('heading', { level: 3 })).toHaveText(['115 學測', '114 學測', '113 學測', '112 學測', '115 參考試卷', '111 學測']);
  await expect(cards.nth(4)).toContainText('沿用題提醒');
  await checkNarrow(page, mobile, '模擬考列表');
  await page.getByRole('link', { name: /^開始\s*：115 學測模擬考$/ }).click();

  // 開考前：預估分數、一般模式（不勾實考模式）。
  await expect(page.getByRole('heading', { level: 1, name: '115 學測模擬考' })).toBeVisible();
  await checkNarrow(page, mobile, '開考前');
  await page.getByRole('spinbutton', { name: /你覺得這次會考幾分/ }).fill('60');
  await expect(page.getByRole('checkbox', { name: /實考模式/ })).not.toBeChecked();
  await page.getByRole('button', { name: '開始作答' }).click();

  const timer = page.getByRole('timer');
  await expect(timer).toHaveAccessibleName(/^剩餘時間 (100 分鐘|99 分)/);
  // 考試模式不提供答案。
  await expect(page.getByRole('button', { name: '看答案' })).toHaveCount(0);

  // 詞彙題第 1 題（正解 B）＋標記。
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  const mark = page.locator('#q-1').getByRole('button', { name: '標記第 1 題，稍後檢查' });
  await mark.click();
  await expect(mark).toHaveAttribute('aria-pressed', 'true');

  // 綜合測驗第 11 題（正解 B）。
  await page.getByRole('button', { name: /下一大題：綜合測驗/ }).click();
  await page.getByRole('button', { name: '第 11 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 11 題的選項' }).getByRole('button', { name: /it turns out/ }).click();
  await expect(page.getByRole('button', { name: /^第 11 題空格，已填 \(B\)/ })).toBeVisible();

  // 文意選填第 21 題（正解 E），從大題導覽切過去。
  await page.getByRole('navigation', { name: '大題導覽' }).getByRole('button', { name: /^3\. 文意選填/ }).click();
  await page.getByRole('button', { name: '第 21 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 21 題的選項' }).getByRole('button', { name: /^\(E\)/ }).click();
  await expect(page.getByRole('button', { name: /^第 21 題空格，已填 \(E\)/ })).toBeVisible();
  await expect(page.getByText(/已答 3／53/).first()).toBeVisible();
  await checkNarrow(page, mobile, '作答中');

  // 重新整理：接續作答，答案、目前大題、標記、剩餘時間都在。
  await page.reload();
  await expect(page.getByText(/已接續上次的作答進度。離開期間時間照常計算，目前剩下 (100 分鐘|99 分)/)).toBeVisible();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/^剩餘時間 (100 分鐘|99 分)/);
  const nav = page.getByRole('navigation', { name: '大題導覽' });
  await expect(nav.getByRole('button', { name: /^3\. 文意選填/ })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: /^第 21 題空格，已填 \(E\)/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /^1\. 詞彙題/ })).toHaveAccessibleName(/已答 1／10 題，標記 1 題/);
  await nav.getByRole('button', { name: /^1\. 詞彙題/ }).click();
  await expect(page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ })).toBeChecked();
  await expect(page.locator('#q-1').getByRole('button', { name: '標記第 1 題，稍後檢查' })).toHaveAttribute('aria-pressed', 'true');

  // 交卷（一般模式隨時可以交）。
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
  await expect(dialog).toContainText('還有 50 題沒有作答');
  await dialog.getByRole('button', { name: '確定交卷' }).click();

  // 成績單：3 題各 1 分 → 3 分；115 學年度對照表 0 < 3 ≤ 6.10 → 1 級分，還沒達到底標。
  await expect(page.getByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeVisible();
  await expect(page).toHaveURL(/\/mock\/report\/[\w-]+$/);
  await expect(page.getByRole('region', { name: '原得總分' })).toContainText('3／100');
  await expect(page.getByRole('region', { name: '原得總分' })).toContainText('你預估 60 分，實得 3 分（−57）');
  const level = page.getByRole('region', { name: '級分（非官方換算）' });
  await expect(level).toContainText('1級分');
  await expect(level).toContainText('115 學年度：0.00 < 原得總分 ≤ 6.10 → 1 級分');
  await expect(level.getByRole('heading', { name: '五標位置' })).toBeVisible();
  await expect(level).toContainText('還沒達到底標（3 級分）');
  await expect(level).toContainText(/頂標.*13 級分/);
  await expect(page.getByText('模擬分數與級分僅供參考，不是官方級分；AI 批改分數不等於正式閱卷結果。')).toBeVisible();
  await expect(page.getByRole('table', { name: /各大題得分/ })).toBeVisible();
  await checkNarrow(page, mobile, '成績單');

  // 檢討試卷：交卷後才看得到答案與全國答對率。
  await page.getByRole('button', { name: /展開檢討試卷/ }).click();
  await expect(page.locator('#q-1').getByTestId('question-feedback')).toContainText('全國答對率');
  await expect(page.locator('#q-1')).toContainText('作答時標記過');

  // 回列表：顯示已完成與作答紀錄。
  await page.getByRole('link', { name: '回模擬考列表' }).click();
  await expect(cards.first()).toContainText('已完成 1 次，最近一次 3 分、1 級分');
  await expect(page.getByRole('region', { name: '作答紀錄' })).toContainText('115 學測');
  expect(errors).toEqual([]);
});

test('實考模式：開考 60 分鐘內交卷鈕停用', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/mock/gsat-114');
  await page.getByRole('checkbox', { name: /實考模式/ }).check();
  await page.getByRole('button', { name: '不預估，直接開始' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  const submit = page.getByRole('button', { name: '交卷', exact: true });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAccessibleDescription(/還要 (1:00:00|59:\d\d)/);
  // 放棄這次作答：紀錄刪除、回到開考前。
  await page.getByRole('button', { name: '放棄這次作答' }).click();
  await page.getByRole('button', { name: '確定放棄' }).click();
  await expect(page.getByRole('button', { name: '開始作答' })).toBeVisible();
  expect(errors).toEqual([]);
});
