/**
 * 手機守門（docs/design/desktop-ui.md §11.3；只在 mobile project 跑，375×667、觸控）：桌機介面的東西在手機上都不存在、不作用。
 * 像素層面的「完全不變」由 tests/visual 的截圖逐像素比對保證；這裡守行為：快捷鍵、對話框、提示泡泡、回到頂端、
 * 只在 ≥ lg 生效的 CSS（scroll-padding、scrollbar-gutter）；PR A2 的頁面（首頁儀表板、資料表與矩陣、sticky 篩選列、
 * 設定頁的「電腦版介面」）在手機上都是原本的樣子。題號列等之後的 PR 再加進來。
 *
 * docs/design/desktop-polish.md PR 1（防誤觸）：站主同意兩個會讓學生失去作答的修正手機也一起改（§7 第 1 點 (a)(b)）——
 * 交卷確認的焦點在「繼續作答」、歷屆交卷後的清除要先確認；其他（未作答題號、剩餘時間、送出前的確認、計時中離開確認、
 * 模擬考交卷對話框的桌機版）手機都不變。
 */
import { expect, test } from '@playwright/test';
import { collectErrors, fakeBackend, ok, signedInMe } from './support/backend';

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

test.describe('PR 1 防誤觸：手機', () => {
  test('交卷確認（手機一起改）：焦點在「繼續作答」，連按兩次 Enter 不會交卷；沒有桌機的未作答題號與剩餘時間', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/exams/gsat-115');
    await page.locator('label').filter({ hasText: '考試模式' }).click();
    await page.getByRole('button', { name: '開始作答' }).click();
    await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    const confirm = page.getByRole('group', { name: '確認交卷' });
    await expect(confirm.getByRole('button', { name: '繼續作答' })).toBeFocused();
    await expect(confirm).toHaveText(/^還有 52 題沒有作答。交卷後就不能再修改答案。確定交卷繼續作答$/);
    await expect(confirm.getByRole('region')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: '交卷結果' })).toHaveCount(0);
  });

  test('歷屆交卷後「清除作答，重新開始」（手機一起改）：按鈕是原本的樣子，按了先確認、焦點在「取消」；「確定清除」才清除', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/exams/gsat-115');
    await page.locator('label').filter({ hasText: '考試模式' }).click();
    await page.getByRole('button', { name: '開始作答' }).click();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    await page.getByRole('button', { name: '確定交卷' }).click();
    const result = page.getByRole('region', { name: '交卷結果' });
    const restart = result.getByRole('button', { name: '清除作答，重新開始' });
    // 手機的按鈕外觀不變（外框膠囊、主文字色），不是桌機的紅字。
    const look = await restart.evaluate((el) => ({ border: getComputedStyle(el).borderTopStyle, color: getComputedStyle(el).color, fg: getComputedStyle(document.body).color }));
    expect(look.border).toBe('solid');
    expect(look.color).toBe(look.fg);
    await restart.click();
    const confirm = result.getByRole('group', { name: '確定要清除這份考卷的作答與成績嗎？清除後無法復原。' });
    await expect(confirm.getByRole('button', { name: '取消' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('gsat-exam-attempt:v1:gsat-115'))).not.toBeNull();
    await restart.click();
    await confirm.getByRole('button', { name: '確定清除' }).click();
    await expect(page.getByRole('button', { name: '開始作答' })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('gsat-exam-attempt:v1:gsat-115'))).toBeNull();
  });

  test('作文字數不足時按「送出 AI 批改」：手機直接送出，沒有確認列', async ({ page }) => {
    const backend = await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
    backend.on('POST /api/submissions', () => ok({ id: 'sub-m1', kind: 'essay', group_id: 'gsat-115.s8g1@1', input_mode: 'typed', status: 'draft', body: { text: '' }, photos: [] }, 201));
    backend.on('POST /api/ai/essay-grade', () => ok({ op_id: 'op-m1', submission_id: 'sub-m1', status: 'queued' }, 202));
    await page.goto('/writing/essay/gsat-115');
    await page.getByRole('textbox', { name: /你的作文/ }).fill('Pets are part of our families now. '.repeat(10));
    await expect(page.getByText(/題目要求至少 120 個單詞/)).toBeVisible();
    await page.getByRole('button', { name: /^送出 AI 批改（\d+ 點）$/ }).click();
    await expect.poll(() => backend.callsTo('POST', '/api/submissions').length).toBe(1);
    await expect(page.getByRole('group', { name: /送出 AI 批改會用/ })).toHaveCount(0);
  });

  test('模擬考：交卷對話框是原本的樣子（沒有關閉鈕）；作答中點底部導覽直接換頁，沒有離開確認', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/mock/gsat-115');
    await page.getByRole('button', { name: '不預估，直接開始' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '關閉' })).toHaveCount(0);
    await expect(dialog).toContainText('還有 53 題沒有作答。交卷後就不能再修改答案，會直接看到成績單。');
    await dialog.getByRole('button', { name: '繼續作答' }).click();
    await page.getByRole('navigation', { name: '主要導覽' }).getByRole('link', { name: '首頁' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('dialog', { name: '要離開作答頁嗎？' })).toHaveCount(0);
  });
});
