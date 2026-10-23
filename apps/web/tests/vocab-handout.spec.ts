/**
 * 單字講義 PDF（docs/design/vocab-handout.md §9.3）：在建置後的產物上真的產生 PDF。
 *   1. 單字庫選 Level 4、搜尋前綴 →「做成講義」→ 講義頁帶入篩選來源與字數 → 下載講義版（download 事件、%PDF-、頁數 ≥ 3、檔名）；
 *      按下前沒有任何 pdfmake、pdf.worker、.subset.ttf 請求，已載入的 JS 也不含 pdfmake 與字型網址；
 *   2. 錯題本：先寫入兩個錯題 →「錯題做成講義」→ 選句意填空卷 → 下載；
 *   3. 每日學習：單字卡「加入每日學習」→ 每日學習分頁的「把加入學習的字做成講義」→ 講義頁的來源是每日學習的字；
 *   4. 直接開 /words?handout=1：預設 Level 3 第 1 份；改成背誦版、勾雙面列印 → 下載；再改成測驗卷下載（第二次不再下載字型）；
 *      「返回」回到單字庫；
 *   5. 手機 375 與 320 px：講義頁沒有水平捲動；全程沒有 console error。
 *   6. 只用鍵盤（桌機）：方向鍵換類型、空白鍵勾選項、Enter 下載；從單字庫與錯題本的入口按 Enter 打開講義頁時，焦點移到「做成講義」標題，
 *      下一個 Tab 停在講義頁裡（不會跳過整頁）；
 *   7. 單字庫預設篩選（L3–5，三千多字）做講義：超過上限的說明是提醒樣式，「改用級別範圍分份」換成同樣級別的第 1 份。
 * 非 ASCII 檔名：POSIX 語系的無頭 Chromium 會把檔名改成 download（mock-exam-pdf §4.4），所以檔名兩種都接受。
 * 斷言只依賴詞彙表本身（abandon 是 L4 動詞、adult 是 L2），不依賴例句內容。
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function mockBackend(page: Page) {
  await page.route(/\/(api|auth)\//, (route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'e2e' } } }));
  await page.route('**/api/features', (route) => route.fulfill({ json: { auth: false, ai: false, ocr: false, aiPaused: false } }));
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

/** PDF 引擎、Worker、字型的請求（只有按下「下載 PDF」後才可以出現）。 */
const LAZY = /\.subset\.ttf|pdf\.worker|pdfmake/;

/** 下載並檢查檔案；回傳頁數。 */
async function downloadPdf(page: Page, region: Locator, outPath: string, expectedName: RegExp): Promise<number> {
  const button = region.getByRole('button', { name: '下載 PDF' });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await button.click();
  const download = await downloadPromise;
  const name = download.suggestedFilename();
  expect(name === 'download' || expectedName.test(name), `檔名 ${name}`).toBe(true);
  await download.saveAs(outPath);
  const bytes = await readFile(outPath);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(region.getByRole('status', { name: '下載進度' })).toContainText('已下載');
  return (bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('gsat-pdf-preview', '1');
    } catch {
      // 不能用 localStorage 的環境：測試會因為找不到按鈕而失敗，訊息就夠清楚。
    }
  });
});

test('單字庫篩選 →「做成講義」→ 下載講義版；按下前不載入引擎與字型', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const lazyRequests: string[] = [];
  /** 單字頁本身的 JS（打開講義頁之前）與講義頁的 lazy chunk（打開之後、按下下載之前）。 */
  const scripts: { handout: boolean; text: Promise<string> }[] = [];
  let handoutOpen = false;
  page.on('request', (req) => {
    if (LAZY.test(req.url())) lazyRequests.push(req.url());
  });
  page.on('response', (res) => {
    if (res.url().endsWith('.js') && !LAZY.test(res.url())) scripts.push({ handout: handoutOpen, text: res.text().catch(() => '') });
  });

  await page.goto('/words');
  await expect(page.getByText(/^共 [\d,]+ 筆$/)).toBeVisible();
  const filterToggle = page.getByRole('button', { name: /篩選與排序/ });
  if (await filterToggle.isVisible()) await filterToggle.click();
  // 只留 Level 4，再搜尋開頭 ab。
  await page.getByRole('checkbox', { name: /^Level 3/ }).uncheck({ force: true });
  await page.getByRole('checkbox', { name: /^Level 5/ }).uncheck({ force: true });
  await page.getByRole('searchbox', { name: '搜尋單字' }).fill('ab');
  await expect(page.getByRole('link', { name: /^abandon/ })).toBeVisible();
  const countText = (await page.getByText(/^共 [\d,]+ 筆$/).textContent()) ?? '';
  const count = Number(countText.replace(/[^\d]/g, ''));
  expect(count).toBeGreaterThan(0);

  handoutOpen = true;
  await page.getByRole('link', { name: '做成講義' }).click();
  await expect(page).toHaveURL(/handout=1/);
  const region = page.getByRole('region', { name: '做成講義' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('radio', { name: new RegExp(`^單字庫篩選結果（${count} 字）`) })).toBeChecked();
  await expect(region.getByRole('radio', { name: /^講義版/ })).toBeChecked();
  const summary = region.getByRole('status', { name: '講義摘要' });
  await expect(summary).toContainText(`單字庫篩選結果　L4・搜尋「ab」，共 ${count} 字`);
  await expect(summary).toContainText(/句意填空 \d+ 題/, { timeout: 30_000 });
  await expectNoHorizontalOverflow(page, '講義頁');

  // 按下之前，PDF 引擎、Worker 與字型都還沒下載；單字頁的 JS 不含 pdfmake、字型網址與字型表（metrics.json），
  // 講義頁的 lazy chunk 可以有字型表（判斷例句印不印得出來，設計文件 §7.3），但仍不含 pdfmake。
  expect(lazyRequests).toEqual([]);
  for (const { handout, text } of scripts) {
    const source = await text;
    expect(source).not.toContain('setUrlAccessPolicy');
    if (!handout) {
      expect(source).not.toMatch(/\.subset\.ttf/);
      expect(source).not.toContain('latinRanges');
    }
  }

  const pages = await downloadPdf(page, region, testInfo.outputPath('notes.pdf'), new RegExp(`^學測英文中心_單字講義_單字庫篩選_${count}字_\\d{8}_含答案\\.pdf$`));
  expect(pages).toBeGreaterThanOrEqual(3);
  expect(lazyRequests.some((u) => u.includes('.subset.ttf'))).toBe(true);
  expect(errors).toEqual([]);
});

test('錯題本 →「錯題做成講義」→ 句意填空卷', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const now = Date.now();
    const item = (id: string, word: string, at: number) => ({ entry_id: id, word, wrong_count: 1, last_wrong_at: at, last_mode: 'en2zh' });
    window.localStorage.setItem(
      'gsat-vocab-mistakes',
      JSON.stringify({
        schema: 'gsat-vocab-mistakes',
        version: 1,
        items: { 'abandon|v.|4': item('abandon|v.|4', 'abandon', now), 'adult|n./adj.|2': item('adult|n./adj.|2', 'adult', now - 1000) },
        updated_at: now,
      }),
    );
  });
  await page.goto('/words?tab=mistakes');
  await page.getByRole('link', { name: '錯題做成講義' }).click();
  const region = page.getByRole('region', { name: '做成講義' });
  await expect(region.getByRole('radio', { name: /^錯題本（2 字）/ })).toBeChecked();
  await region.getByRole('radio', { name: /^句意填空卷/ }).check();
  await expect(region.getByRole('status', { name: '講義摘要' })).toContainText('錯題本　2 字，共 2 字');
  const pages = await downloadPdf(page, region, testInfo.outputPath('cloze.pdf'), /^學測英文中心_句意填空_錯題本_2字_\d{8}_含答案\.pdf$/);
  expect(pages).toBeGreaterThanOrEqual(3);
  // 錯題本預設「依來源順序」只用在這個來源：不寫進記住的設定，之後從別的入口做講義還是依字母。
  expect(await page.evaluate(() => window.localStorage.getItem('gsat-vocab-handout:v1'))).not.toContain('"sort":"source"');
  expect(errors).toEqual([]);
});

test('每日學習 →「把加入學習的字做成講義」：來源是每日學習的字', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(`/words?${new URLSearchParams({ word: 'abandon|v.|4' })}`);
  await page.getByRole('button', { name: '加入每日學習' }).click();
  await page.goto('/words?tab=study');
  await page.getByRole('link', { name: '把加入學習的字做成講義' }).click();
  const region = page.getByRole('region', { name: '做成講義' });
  await expect(region.getByRole('radio', { name: /^每日學習的字（1 字）/ })).toBeChecked();
  await expect(region.getByRole('status', { name: '講義摘要' })).toContainText('每日學習的字　1 字，共 1 字');
  await region.getByRole('button', { name: '返回' }).click();
  await expect(page).toHaveURL(/tab=study/);
  await expect(page).not.toHaveURL(/handout/);
  expect(errors).toEqual([]);
});

test('直接開 /words?handout=1：預設 Level 3 第 1 份；背誦版＋雙面列印、測驗卷；「返回」回到單字庫', async ({ page }, testInfo) => {
  test.setTimeout(200_000);
  const errors = collectErrors(page);
  await page.goto('/words?handout=1');
  const region = page.getByRole('region', { name: '做成講義' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('radio', { name: /^級別範圍/ })).toBeChecked();
  const summary = region.getByRole('status', { name: '講義摘要' });
  await expect(summary).toContainText('Level 3　第 1–50 字，共 50 字');
  await expectNoHorizontalOverflow(page, '講義頁');
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page, '講義頁（320px）');
    await page.setViewportSize({ width: 375, height: 667 });
  }

  await region.getByRole('radio', { name: /^背誦版/ }).check();
  await expect(region.getByRole('radio', { name: /^遮中文/ })).toBeChecked();
  await region.getByText('更多選項').click();
  await region.getByRole('checkbox', { name: '雙面列印（每段從單數頁開始）' }).check();
  await expectNoHorizontalOverflow(page, '講義頁（展開更多選項）');
  const recite = await downloadPdf(page, region, testInfo.outputPath('recite.pdf'), /^學測英文中心_單字背誦版_L3_第1-50字_含答案\.pdf$/);
  expect(recite).toBeGreaterThanOrEqual(5);

  const fonts: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('.subset.ttf')) fonts.push(req.url());
  });
  await region.getByRole('radio', { name: /^測驗卷/ }).check();
  await expect(summary).toContainText(/中翻英拼字 \d+ 題・英選中 \d+ 題/, { timeout: 30_000 });
  const quiz = await downloadPdf(page, region, testInfo.outputPath('quiz.pdf'), /^學測英文中心_單字測驗卷_L3_第1-50字_含答案\.pdf$/);
  expect(quiz).toBeGreaterThanOrEqual(4);
  expect(fonts).toEqual([]);

  await region.getByRole('button', { name: '返回' }).click();
  await expect(page).not.toHaveURL(/handout/);
  await expect(page.getByRole('searchbox', { name: '搜尋單字' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('只用鍵盤：方向鍵換類型、空白鍵勾選項、Enter 下載（桌機）', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '鍵盤操作只在桌機測');
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await page.goto('/words?handout=1');
  const region = page.getByRole('region', { name: '做成講義' });
  const notes = region.getByRole('radio', { name: /^講義版/ });
  await expect(notes).toBeChecked();
  // 類型是同一組原生 radio：方向鍵直接換選取。
  await notes.focus();
  await page.keyboard.press('ArrowDown');
  await expect(region.getByRole('radio', { name: /^背誦版/ })).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(region.getByRole('radio', { name: /^句意填空卷/ })).toBeChecked();
  const letterCount = region.getByRole('checkbox', { name: '句意填空：顯示字母數' });
  await letterCount.focus();
  await page.keyboard.press('Space');
  await expect(letterCount).toBeChecked();
  const button = region.getByRole('button', { name: '下載 PDF' });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.focus();
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.keyboard.press('Enter');
  const download = await downloadPromise;
  const path = testInfo.outputPath('keyboard.pdf');
  await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(region.getByRole('status', { name: '下載進度' })).toContainText('已下載');
  expect(errors).toEqual([]);
});

test('鍵盤從入口打開講義頁：焦點移到標題，下一個 Tab 停在講義頁裡（桌機）', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', '鍵盤操作只在桌機測');
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const now = Date.now();
    window.localStorage.setItem(
      'gsat-vocab-mistakes',
      JSON.stringify({
        schema: 'gsat-vocab-mistakes',
        version: 1,
        items: { 'abandon|v.|4': { entry_id: 'abandon|v.|4', word: 'abandon', wrong_count: 1, last_wrong_at: now, last_mode: 'en2zh' } },
        updated_at: now,
      }),
    );
  });
  const region = page.getByRole('region', { name: '做成講義' });
  const heading = region.getByRole('heading', { name: '做成講義' });
  // 標題後的下一個 Tab：講義類型的第一個選項（焦點掉到 body 時，下一個 Tab 會跳到頁尾的「完整的資料來源與授權聲明」）。
  const tabStaysInside = async () => {
    await page.keyboard.press('Tab');
    await expect(region.getByRole('radio', { name: /^講義版/ })).toBeFocused();
  };

  await page.goto('/words');
  await expect(page.getByText(/^共 [\d,]+ 筆$/)).toBeVisible();
  await page.getByRole('link', { name: '做成講義' }).focus();
  await page.keyboard.press('Enter');
  await expect(heading).toBeFocused();
  await tabStaysInside();

  await page.goto('/words?tab=mistakes');
  await page.getByRole('link', { name: '錯題做成講義' }).focus();
  await page.keyboard.press('Enter');
  await expect(heading).toBeFocused();
  await tabStaysInside();
  expect(errors).toEqual([]);
});

test('單字庫預設篩選（L3–5）超過上限：提醒說明與「改用級別範圍分份」', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/words');
  await expect(page.getByText(/^共 [\d,]+ 筆$/)).toBeVisible();
  const total = Number(((await page.getByText(/^共 [\d,]+ 筆$/).textContent()) ?? '').replace(/[^\d]/g, ''));
  expect(total).toBeGreaterThan(600);
  await page.getByRole('link', { name: '做成講義' }).click();
  const region = page.getByRole('region', { name: '做成講義' });
  const summary = region.getByRole('status', { name: '講義摘要' });
  const warning = summary.getByText(/超過一份講義的上限/);
  await expect(warning).toContainText(`篩選結果共 ${total.toLocaleString('en-US')} 字`);
  await expect(warning).toContainText('請縮小篩選範圍，或改用「級別範圍」依份數分份');
  await expect(warning).not.toContainText('請在「範圍」改用');
  await region.getByRole('button', { name: '改用級別範圍分份' }).click();
  await expect(region.getByRole('radio', { name: /^級別範圍/ })).toBeChecked();
  await expect(summary).toContainText('Level 3–5　第 1–100 字，共 100 字');
  await expect(summary.getByText(/超過一份講義的上限/)).toHaveCount(0);
  await expect(region.getByRole('combobox', { name: '範圍', exact: true })).toHaveValue('part100');
  await expectNoHorizontalOverflow(page, '講義頁');
  expect(errors).toEqual([]);
});
