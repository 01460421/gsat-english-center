/**
 * 手機守門（docs/design/desktop-ui.md §11.3；只在 mobile project 跑，375×667、觸控）：桌機介面的東西在手機上都不存在、不作用。
 * 像素層面的「完全不變」由 tests/visual 的截圖逐像素比對保證；這裡守行為：快捷鍵、對話框、提示泡泡、回到頂端、
 * 只在 ≥ lg 生效的 CSS（scroll-padding、scrollbar-gutter）；PR A2 的頁面（首頁儀表板、資料表與矩陣、sticky 篩選列、
 * 設定頁的「電腦版介面」）在手機上都是原本的樣子。題號列等之後的 PR 再加進來。
 */
import { expect, test } from '@playwright/test';
import { collectErrors, fakeBackend, signedInMe } from './support/backend';

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'mobile', '只在手機 project 跑');
});

test('沒有桌機的殼層：側邊欄、快捷鍵按鈕、提示泡泡、回到頂端都不出現；? 與 [ 不作用', async ({ page }) => {
  const errors = collectErrors(page);
  await fakeBackend(page);
  await page.goto('/exams');
  await expect(page.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeVisible();
  await expect(page.locator('aside[data-sidebar]')).toBeHidden();
  await expect(page.getByRole('button', { name: '鍵盤快捷鍵' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /側邊欄/ })).toHaveCount(0);
  await page.keyboard.press('?');
  await page.keyboard.press('[');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-tooltip')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole('button', { name: '回到頂端' })).toHaveCount(0);
  // /exams 在手機仍是卡片，不是資料表。
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('只在 ≥ lg 生效的 CSS 在手機上不作用（scroll-padding、scrollbar-gutter、main 不是 container）', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/');
  const css = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const main = getComputedStyle(document.getElementById('main') as HTMLElement);
    return { scrollPaddingTop: html.scrollPaddingTop, gutter: html.scrollbarGutter, containerType: main.containerType, display: main.display };
  });
  expect(css).toEqual({ scrollPaddingTop: 'auto', gutter: 'auto', containerType: 'normal', display: 'block' });
});

test('作答頁：按字母鍵不改變答案', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/exams/gsat-115');
  await page.getByRole('button', { name: '開始作答' }).click();
  const q1 = page.locator('#q-1');
  const first = q1.getByRole('radio').first();
  await first.check();
  for (const key of ['b', 'c', 'n', 'p', '2']) await page.keyboard.press(key);
  await expect(first).toBeChecked();
  await expect(q1.getByRole('radio', { checked: true })).toHaveCount(1);
});

test('作文框裡按 Ctrl＋Enter 沒有任何反應（不送出、不出現確認）', async ({ page }) => {
  const backend = await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
  await page.goto('/writing/essay/gsat-115');
  const editor = page.getByRole('textbox', { name: /你的作文/ });
  await editor.fill('Pets are part of our families now. '.repeat(20));
  await editor.press('Control+Enter');
  await editor.press('Meta+Enter');
  await expect(page.getByRole('group', { name: /送出 AI 批改/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.calls.filter((c) => c.method === 'POST')).toEqual([]);
});

test('/mock 仍是原本的卡片（卷別 6 個 article，不是列式排版；說明不在右欄）', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/mock');
  const cards = page.getByRole('region', { name: '卷別' }).getByRole('article');
  await expect(cards).toHaveCount(6);
  expect(await cards.evaluateAll((els) => els.map((el) => getComputedStyle(el).display))).toEqual(Array(6).fill('flex'));
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('PR A2 的頁面在手機上是原本的樣子：沒有儀表板、矩陣、資料表、sticky 篩選列與「電腦版介面」', async ({ page }) => {
  const errors = collectErrors(page);
  await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
  await page.goto('/');
  await expect(page.getByRole('region', { name: '學習進度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '全部功能' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '我的學習' })).toHaveCount(0);

  await page.goto('/practice');
  await expect(page.getByRole('link', { name: /^詞彙題・穩定基礎：/ })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  for (const path of ['/translation', '/writing/essay', '/writing/translation/ai']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-sticky-bar]')).toHaveCount(0);
  }
  await expect(page.getByRole('group', { name: '難度' })).toBeVisible();

  await page.goto('/writing');
  const history = page.getByRole('region', { name: '我的寫作紀錄' });
  await expect(history).toBeVisible();
  await expect(history.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('complementary')).toHaveCount(0);

  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  await expect(page.getByRole('region', { name: '電腦版介面' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
