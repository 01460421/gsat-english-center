/**
 * 考試格式 PDF（docs/design/mock-exam-pdf.md §4.6、§9.1 P1／P5／P7）：在建置後的產物上真的產生 PDF。
 *   1. 歷屆試題 gsat-115：開始畫面的「下載 PDF」→ download 事件 → 檔案以 %PDF- 開頭、頁數合理；
 *   2. 按下前不載入 PDF 引擎與字型，一般頁面的 JS 不含 pdfmake、字型網址（P5）；
 *   3. 模擬考開考前的「下載 PDF」也能產生；模擬考列表展開「下載 PDF（考試格式）」也能產生（ref-115，封面有沿用題提醒）；
 *   4. 下載區塊在手機 375 與 320 px 沒有水平捲動（P7）；
 *   5. 本站自組卷（bank-mock §10.4）：/mock 組一份卷 → 卷子頁下載學生卷與教師卷（檔名、%PDF-）→ 回 /mock「我組過的卷子」記得下載過。
 * 測試仍先打開預覽開關（localStorage gsat-pdf-preview）：PDF_DOWNLOAD_ENABLED 改回 false 時這些測試照樣能跑。
 * 非 ASCII 檔名：POSIX 語系的無頭 Chromium 會把檔名改成 download（設計文件 §4.4），所以檔名兩種都接受。
 */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function mockBackend(page: Page) {
  await page.route(/\/(api|auth)\//, (route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'e2e' } } }));
  // 功能開關：登入與 AI 都關閉（SessionProvider 每一頁都會讀；回 404 的話瀏覽器會印 console error）。
  // 後註冊的 route 先比對，所以這一條會蓋過上面的 404。模擬考與 PDF 都不需要後端。
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

test('模擬考列表：展開 115 參考試卷的「下載 PDF（考試格式）」並下載', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/mock');
  // 預覽開關打開時，列表的說明與每份卷子的下載按鈕都要出現（和 ExamPdfDownload 用同一個判斷）。
  await expect(page.getByText('想寫紙本：每份卷子都能下載考試格式 PDF')).toBeVisible();
  await page.getByRole('button', { name: /^下載 PDF（考試格式）\s*：115 參考試卷$/ }).click();
  const region = page.getByRole('region', { name: '下載考試格式 PDF' });
  await expect(region).toBeVisible();
  const pages = await downloadPdf(page, region.getByRole('button', { name: '下載 PDF' }), testInfo.outputPath('ref-115.pdf'), /^學測英文中心_模擬考_115參考試卷（學測）英文\.pdf$/);
  expect(pages).toBeGreaterThanOrEqual(14);
  await expectNoHorizontalOverflow(page, '模擬考列表');
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page, '模擬考列表（320px）');
  }
  expect(errors).toEqual([]);
});

/**
 * 本站自組卷（docs/design/bank-mock.md §10.4）：卷子頁的 PDF 區塊有三種版本，下載學生卷與教師卷，下載後「我組過的卷子」記得下載過。
 * 種子用 ?bankmockseed= 固定（只在預覽模式有效）；資料是建置當下的題庫，所以只斷言檔名格式與檔案開頭。
 * 成績單的「題本＋答案＋解析」在 tests/bank-mock.spec.ts 的主流程裡下載。
 */
test('本站自組卷：卷子頁下載學生卷與教師卷；「我組過的卷子」記得下載過', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  const lazyRequests: string[] = [];
  page.on('request', (req) => {
    if (LAZY.test(req.url())) lazyRequests.push(req.url());
  });
  await page.goto('/mock?bankmock=preview&bankmockseed=20261019');
  const bank = page.getByRole('region', { name: '本站自組模擬考' });
  await expect(bank).toBeVisible();

  await bank.getByRole('radio', { name: /穩定基礎/ }).check();
  await bank.getByRole('button', { name: /組一份新卷/ }).click();
  await expect(page).toHaveURL(/\/mock\/bk1-b-[0-9a-z]{66}$/);
  const region = page.getByRole('region', { name: '下載考試格式 PDF' });
  await expect(region).toBeVisible();
  await expect(region.getByText(/本站自組試卷，題目由 AI 撰寫/)).toBeVisible();
  await expect(region.getByRole('radio', { name: /^學生卷/ })).toBeChecked();
  await expect(region.getByRole('checkbox', { name: '雙面列印（每段從單數頁開始）' })).toBeVisible();
  await expectNoHorizontalOverflow(page, '自組卷的卷子頁');
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page, '自組卷的卷子頁（320px）');
    await page.setViewportSize({ width: 375, height: 667 });
  }
  // P5：按下之前不下載 PDF 引擎與字型。
  expect(lazyRequests).toEqual([]);

  const button = region.getByRole('button', { name: '下載 PDF' });
  const student = await downloadPdf(page, button, testInfo.outputPath('bank-student.pdf'), /^學測英文中心_自組模擬考_穩定基礎_B-[0-9A-Z]{5}_學生卷\.pdf$/);
  expect(student).toBeGreaterThanOrEqual(14);
  await region.getByRole('radio', { name: /^教師卷/ }).check();
  await region.getByRole('checkbox', { name: '雙面列印（每段從單數頁開始）' }).check();
  const teacher = await downloadPdf(page, button, testInfo.outputPath('bank-teacher.pdf'), /^學測英文中心_自組模擬考_穩定基礎_B-[0-9A-Z]{5}_教師卷\.pdf$/);
  expect(teacher).toBeGreaterThanOrEqual(3);
  const paperId = new URL(page.url()).pathname.split('/').at(-1);

  // 下載過（pdfAt）記在「我組過的卷子」，回到 /mock 也還在；清單上標「下載過 PDF」。
  await page.goto('/mock');
  const mine = page.getByRole('region', { name: '我組過的卷子（這台裝置）' });
  await expect(mine).toContainText(/下載過 PDF/);
  const pdfAt = await page.evaluate((id) => {
    const list = JSON.parse(window.localStorage.getItem('gsat-bankmock:v1:papers') ?? '[]') as { id: string; pdfAt?: string }[];
    return list.find((p) => p.id === id)?.pdfAt ?? null;
  }, paperId);
  expect(pdfAt).not.toBeNull();
  expect(errors).toEqual([]);
});
