/**
 * 考試格式 PDF（docs/design/mock-exam-pdf.md §4.6、§9.1 P1／P5／P7）：在建置後的產物上真的產生 PDF。
 *   1. 歷屆試題 gsat-115：開始畫面的「下載 PDF」→ download 事件 → 檔案以 %PDF- 開頭、頁數合理；
 *   2. 按下前不載入 PDF 引擎與字型，一般頁面的 JS 不含 pdfmake、字型網址（P5）；
 *   3. 模擬考開考前的「下載 PDF」也能產生；
 *   4. 下載區塊在手機 375 與 320 px 沒有水平捲動（P7）。
 * PDF_DOWNLOAD_ENABLED 還是 false（等實機驗收 P8），測試用預覽開關（localStorage gsat-pdf-preview）打開按鈕。
 * 非 ASCII 檔名：POSIX 語系的無頭 Chromium 會把檔名改成 download（設計文件 §4.4），所以檔名兩種都接受。
 */
import { readFile } from 'node:fs/promises';
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

/** PDF 引擎、Worker、字型的請求（只有按下「下載 PDF」後才可以出現）。 */
const LAZY = /\.subset\.ttf|pdf\.worker|pdfmake/;

/** 下載並檢查檔案；回傳頁數。 */
async function downloadPdf(page: Page, button: ReturnType<Page['getByRole']>, outPath: string, expectedName: RegExp): Promise<number> {
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await button.click();
  const download = await downloadPromise;
  const name = download.suggestedFilename();
  expect(name === 'download' || expectedName.test(name), `檔名 ${name}`).toBe(true);
  await download.saveAs(outPath);
  const bytes = await readFile(outPath);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
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

test('歷屆試題 gsat-115：下載題本格式 PDF；按下前不載入引擎與字型', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  const lazyRequests: string[] = [];
  const scripts: Promise<string>[] = [];
  page.on('request', (req) => {
    if (LAZY.test(req.url())) lazyRequests.push(req.url());
  });
  page.on('response', (res) => {
    if (res.url().endsWith('.js') && !LAZY.test(res.url())) scripts.push(res.text().catch(() => ''));
  });

  await page.goto('/exams/gsat-115');
  const region = page.getByRole('region', { name: '下載考試格式 PDF' });
  await expect(region).toBeVisible();
  await expect(region.getByRole('checkbox', { name: '附答題卷' })).toBeChecked();
  await expect(region.getByRole('checkbox', { name: '附答案（放在最後）' })).not.toBeChecked();
  await expectNoHorizontalOverflow(page, '開始畫面');
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page, '開始畫面（320px）');
    await page.setViewportSize({ width: 375, height: 667 });
  }

  // P5：按下之前，PDF 引擎、Worker 與字型都還沒下載，已載入的 JS 也不含 pdfmake 與字型網址。
  expect(lazyRequests).toEqual([]);
  for (const source of await Promise.all(scripts)) {
    expect(source).not.toContain('setUrlAccessPolicy');
    expect(source).not.toMatch(/\.subset\.ttf/);
  }

  const pages = await downloadPdf(page, region.getByRole('button', { name: '下載 PDF' }), testInfo.outputPath('gsat-115.pdf'), /^學測英文中心_115學測英文_題本\.pdf$/);
  // 封面 1＋題本 11＋答題卷 4（設計文件 §9.1 P1：題本 10–14 頁＋答題卷 4 頁）
  expect(pages).toBeGreaterThanOrEqual(14);
  expect(pages).toBeLessThanOrEqual(20);
  await expect(region.getByRole('status')).toContainText('已下載');
  expect(lazyRequests.some((u) => u.includes('.subset.ttf'))).toBe(true);
  await expectNoHorizontalOverflow(page, '下載完成');
  expect(errors).toEqual([]);
});

test('附答案：多一頁答案；同一頁第二次下載不再下載字型', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/exams/gsat-115');
  const region = page.getByRole('region', { name: '下載考試格式 PDF' });
  const button = region.getByRole('button', { name: '下載 PDF' });
  const without = await downloadPdf(page, button, testInfo.outputPath('a.pdf'), /\.pdf$/);

  const fonts: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('.subset.ttf')) fonts.push(req.url());
  });
  await region.getByRole('checkbox', { name: '附答案（放在最後）' }).check();
  const withKey = await downloadPdf(page, button, testInfo.outputPath('b.pdf'), /^學測英文中心_115學測英文_題本_含答案\.pdf$/);
  expect(withKey).toBe(without + 1);
  expect(fonts).toEqual([]);
  expect(errors).toEqual([]);
});

test('模擬考開考前：下載模擬考版 PDF', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/mock/gsat-115');
  const region = page.getByRole('region', { name: '下載考試格式 PDF' });
  await expect(region).toBeVisible();
  const pages = await downloadPdf(page, region.getByRole('button', { name: '下載 PDF' }), testInfo.outputPath('mock.pdf'), /^學測英文中心_模擬考_115學測英文\.pdf$/);
  expect(pages).toBeGreaterThanOrEqual(14);
  await expectNoHorizontalOverflow(page, '模擬考開考前');
  expect(errors).toEqual([]);
});
