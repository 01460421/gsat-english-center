/**
 * 首頁學習進度與各說明頁的「已上線」內容，在建置後的產物上跑，桌機與手機（playwright.config.ts 的兩個 project）都要過：
 *
 *   1. 首頁學習進度：沒有紀錄時顯示從哪裡開始；這台裝置有紀錄（先寫進 localStorage）時，三格統計（今日待複習單字、
 *      題庫練習、單字錯題本）的數字正確、各自連到對應的頁面；首頁不下載任何資料檔（單字索引、題庫），只讀 localStorage。
 *   2. 在題型頁（詞彙題）直接作答、交卷，回到首頁看得到這一組的紀錄（整條路徑接起來）。
 *   3. 六個題型頁：標題旁沒有「開發中」、沒有「規劃中的功能」；頁首下面就是練習（三種難度的切換＋抽到的題組），
 *      下面有題庫練習與歷屆試題的連結、學測怎麼考、收合的「題庫練習有什麼」；閱讀、混合題直接看得到題組，
 *      從題庫練習選同一格也接著做同一組。
 *   4. 中譯英、英文作文題型頁（後端功能全開）：頁首下面就是題目列表（本站仿真題、歷屆試題兩區），說明 AI 批改與實際的拍照流程，
 *      沒有「即將開放」。
 * 每個測試都檢查沒有 console error、未捕捉的例外與水平捲動（手機另外縮到 320px 再檢查一次）。
 *
 * localStorage 的鍵與格式照抄各模組（vocab/lib/srs.ts、vocab/lib/mistakes.ts、practice/history.ts）：
 * e2e 在 Node 跑，不直接 import 那些會連帶載入前端資料模組的檔案；格式改了這裡要一起改。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { FEATURES_ON } from './support/backend';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bank-public');
const DAY = 86_400_000;
/** 三種難度（@gsat/shared 的 TIERS、TIER_LABELS；e2e 不在執行期 import 共用套件的原始碼）。 */
const TIERS = [
  ['basic', '穩定基礎'],
  ['advanced', '進階練習'],
  ['top', '超越頂標'],
] as const;

async function mockBackend(page: Page, features: object = { auth: false, ai: false, ocr: false, aiPaused: false }) {
  await page.route(/\/(api|auth)\//, (route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'e2e' } } }));
  await page.route('**/api/features', (route) => route.fulfill({ json: features }));
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ok: true, service: 'gsat-english-api', version: '0.0.0-e2e', time: '2026-10-09T00:00:00.000Z' } }),
  );
  // 已登入的頁面不在這裡測：未登入（/api/me 回 user: null）。
  await page.route('**/api/me', (route) => route.fulfill({ json: { user: null } }));
}

/** 假的 /data/bank/*：用 build-data 的範例輸出（同 practice.spec.ts）。 */
async function mockBank(page: Page) {
  await page.route('**/data/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    const file = path.join(FIXTURE_DIR, rel);
    if (!rel.startsWith('bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
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
  const configured = page.viewportSize()?.width ?? Number.POSITIVE_INFINITY;
  const { scrollWidth, clientWidth, offenders } = await page.evaluate((limit) => {
    const root = document.documentElement;
    const width = Math.min(root.clientWidth, limit);
    const out: string[] = [];
    if (root.scrollWidth > width) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const rect = el.getBoundingClientRect();
        if (rect.right > width + 1) {
          const cls = Array.from(el.classList).slice(0, 4).join('.');
          out.push(`<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> right=${Math.round(rect.right)}`);
          if (out.length >= 8) break;
        }
      }
    }
    return { scrollWidth: root.scrollWidth, clientWidth: width, offenders: out };
  }, configured);
  expect(scrollWidth, `頁面寬 ${scrollWidth}px 超出視窗 ${clientWidth}px：\n${offenders.join('\n')}`).toBeLessThanOrEqual(clientWidth);
}

async function expectFitsWidth(page: Page, testInfo: TestInfo) {
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name !== 'mobile') return;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: size?.height ?? 667 });
  await expectNoHorizontalOverflow(page);
  if (size) await page.setViewportSize(size);
}

/** 和 srs.ts 的 dayKey 相同：台北時間（playwright.config.ts 的 timezoneId）凌晨 4 點換日。 */
function taipeiDay(ms: number): string {
  return new Date(ms + (8 - 4) * 3_600_000).toISOString().slice(0, 10);
}

function reviewCard(due: number) {
  return {
    due,
    stability: 3,
    difficulty: 5,
    elapsed_days: 3,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    last_review: due - 3 * DAY,
    added_at: due - 10 * DAY,
    updated_at: due - 3 * DAY,
  };
}

/** 這台裝置的紀錄：3 張單字卡（2 張已到期）、連續 2 天；題庫做完 2 組（12／20 題）；錯題本 1 個字。 */
function storedRecords(now: number): Record<string, string> {
  return {
    'gsat-vocab-srs': JSON.stringify({
      schema: 'gsat-vocab-srs',
      version: 1,
      settings: { daily_new: 10, levels: [3, 4, 5] },
      cards: {
        'apple|n.|3': reviewCard(now - 2 * DAY),
        'bridge|n.|3': reviewCard(now - DAY),
        'candle|n.|4': reviewCard(now + 5 * DAY),
      },
      today: { day: taipeiDay(now), new_count: 0, review_count: 0 },
      streak: { current: 2, longest: 2, last_day: taipeiDay(now - DAY) },
      updated_at: now,
    }),
    'gsat-bank-practice:v1': JSON.stringify({
      v: 1,
      done: {
        'ai.vo.aaa': { version: 1, section: 'vocabulary', tier: 'basic', at: new Date(now - DAY).toISOString(), correct: 8, total: 10, hinted: 0 },
        'ai.wb.bbb': { version: 1, section: 'word_bank', tier: 'advanced', at: new Date(now).toISOString(), correct: 4, total: 10, hinted: 2 },
      },
      current: {},
      hints: {},
    }),
    'gsat-vocab-mistakes': JSON.stringify({
      schema: 'gsat-vocab-mistakes',
      version: 1,
      items: { 'desert|n.|5': { entry_id: 'desert|n.|5', word: 'desert', wrong_count: 1, last_wrong_at: now, last_mode: 'cloze', last_source: 'bank_practice' } },
      updated_at: now,
    }),
  };
}

function progressRegion(page: Page) {
  return page.getByRole('region', { name: '學習進度' });
}

test.describe('首頁學習進度', () => {
  test('沒有紀錄：提示從哪裡開始，沒有「開發中」，也不下載任何資料檔', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const dataRequests: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/data/')) dataRequests.push(req.url());
    });
    await mockBackend(page);
    await page.goto('/');
    const region = progressRegion(page);
    await expect(region.getByText('還沒有紀錄，從單字或題庫練習開始吧')).toBeVisible();
    await expect(region.getByRole('link', { name: '開始每日學習' })).toHaveAttribute('href', '/words?tab=study');
    await expect(region.getByRole('link', { name: '題庫練習' })).toHaveAttribute('href', '/practice');
    await expect(page.getByText('開發中', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/登入與作答紀錄完成後/)).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(dataRequests).toEqual([]);
    await expectFitsWidth(page, testInfo);
    expect(errors).toEqual([]);
  });

  test('有紀錄：三格統計的數字與連結；點「題庫練習」進到題庫練習', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const dataRequests: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (pathname.startsWith('/data/')) dataRequests.push(pathname);
    });
    await mockBackend(page);
    await mockBank(page);
    const records = storedRecords(Date.now());
    await page.addInitScript((entries) => {
      // 只在第一次載入時寫入：之後的頁面（點進題庫練習）沿用同一份紀錄。
      if (sessionStorage.getItem('seeded')) return;
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
      sessionStorage.setItem('seeded', '1');
    }, records);
    await page.goto('/');

    const tiles = progressRegion(page).getByTestId('progress-stat');
    await expect(tiles).toHaveCount(3);
    const vocab = tiles.nth(0);
    await expect(vocab).toHaveAttribute('href', '/words?tab=study');
    await expect(vocab).toContainText('今日待複習單字');
    await expect(vocab).toContainText(/2\s*個/);
    await expect(vocab).toContainText('已學過 3 個字・連續 2 天');
    const practice = tiles.nth(1);
    await expect(practice).toHaveAttribute('href', '/practice');
    await expect(practice).toContainText(/2\s*組\s*已完成的題組・/);
    await expect(practice).toContainText('答對率 60%（12／20 題）');
    const mistakes = tiles.nth(2);
    await expect(mistakes).toHaveAttribute('href', '/words?tab=mistakes');
    await expect(mistakes).toContainText(/1\s*個字/);
    await expect(progressRegion(page).getByText('還沒有紀錄', { exact: false })).toHaveCount(0);
    await expect(page.getByText('開發中', { exact: true })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(dataRequests, '首頁只讀 localStorage，不下載資料檔').toEqual([]);
    await expectFitsWidth(page, testInfo);

    await practice.click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole('heading', { level: 1, name: '題庫練習' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('在詞彙題頁直接作答、交卷，回到首頁看得到這一組', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await mockBackend(page);
    await mockBank(page);
    await page.goto('/vocabulary');
    const inline = page.getByRole('region', { name: '詞彙題題庫練習' });
    await expect(inline.getByRole('heading', { level: 2, name: '詞彙題・穩定基礎' })).toBeVisible();
    await expect(page).toHaveURL(/\/vocabulary\?tier=basic$/);
    await expect(inline.getByText('AI 出題・已通過自動驗證・人工審核中').first()).toBeVisible();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    await page.getByRole('button', { name: '確定交卷' }).click();
    await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();

    await page.goto('/');
    const practice = progressRegion(page).getByTestId('progress-stat').nth(1);
    await expect(practice).toContainText(/1\s*組\s*已完成的題組・/);
    await expect(practice).toContainText('答對率 0%（0／5 題）');
    await expectFitsWidth(page, testInfo);
    expect(errors).toEqual([]);
  });
});

const SECTION_PAGES = [
  { path: '/vocabulary', title: '詞彙題', slug: 'vocabulary' },
  { path: '/cloze', title: '綜合測驗', slug: 'cloze' },
  { path: '/word-bank', title: '文意選填', slug: 'word-bank' },
  { path: '/structure', title: '篇章結構', slug: 'structure' },
  { path: '/reading', title: '閱讀測驗', slug: 'reading' },
  { path: '/mixed', title: '混合題', slug: 'mixed' },
] as const;

test.describe('題型頁：頁首下面就是題庫練習', () => {
  for (const meta of SECTION_PAGES) {
    test(`${meta.title}：沒有開發中與規劃中；難度切換、題組、連結與收合的功能說明`, async ({ page }, testInfo) => {
      const errors = collectErrors(page);
      await mockBackend(page);
      await mockBank(page);
      await page.goto(meta.path);
      const h1 = page.getByRole('heading', { level: 1, name: meta.title });
      await expect(h1).toBeVisible();
      await expect(page.getByText('開發中', { exact: true })).toHaveCount(0);
      await expect(page.getByText('這個模組還在開發中')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '規劃中的功能' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 2, name: '學測怎麼考' })).toBeVisible();
      const region = page.getByRole('region', { name: `${meta.title}題庫練習` });
      // 三種難度：連到這一頁的 ?tier=；範例題庫每個題型只有一個難度有題組，其他顯示出題中。
      const nav = region.getByRole('navigation', { name: `${meta.title}的難度` });
      for (const [tier, label] of TIERS) {
        await expect(nav.getByRole('link', { name: new RegExp(`^${label}：`) })).toHaveAttribute('href', `${meta.path}?tier=${tier}`);
      }
      await expect(nav.getByRole('link', { name: /：1 組，已做 0 組$/ })).toHaveAttribute('aria-current', 'page');
      await expect(nav.getByRole('link', { name: /：出題中$/ })).toHaveCount(2);
      // 抽到的題組就在這一頁（題組標題是 <h2>，頁面只有一個 <h1>）。
      await expect(region.getByRole('heading', { level: 2, name: new RegExp(`^${meta.title}・`) })).toBeVisible();
      await expect(region.getByRole('button', { name: '交卷', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page).toHaveTitle(`${meta.title}｜學測英文中心`);
      await expect(region.getByRole('link', { name: '題庫練習' })).toHaveAttribute('href', '/practice');
      await expect(region.getByRole('link', { name: '歷屆試題' })).toHaveAttribute('href', '/exams');
      // 「題庫練習有什麼」收合在下面，打開才看得到。
      const offers = page.getByRole('list', { name: '題庫練習有什麼' });
      await expect(offers).toBeHidden();
      await page.getByText('題庫練習有什麼', { exact: true }).click();
      await expect(offers).toContainText('AI 出題・已通過自動驗證・人工審核中');
      await page.waitForLoadState('networkidle');
      await expectFitsWidth(page, testInfo);
      expect(errors).toEqual([]);
    });
  }

  for (const meta of SECTION_PAGES.filter((m) => m.slug === 'reading' || m.slug === 'mixed')) {
    test(`${meta.title}：頁面上直接看得到題組；從題庫練習選同一格接著做同一組`, async ({ page }) => {
      const errors = collectErrors(page);
      await mockBackend(page);
      await mockBank(page);
      await page.goto(meta.path);
      await expect(page).toHaveURL(new RegExp(`${meta.path}\\?tier=basic$`));
      const region = page.getByRole('region', { name: `${meta.title}題庫練習` });
      await expect(region.getByRole('heading', { level: 2, name: `${meta.title}・穩定基礎` })).toBeVisible();
      await expect(region.getByText('AI 出題・已通過自動驗證・人工審核中').first()).toBeVisible();
      if (meta.slug === 'reading') await expect(region.getByRole('img', { name: /^折線圖：/ })).toBeVisible();
      else await expect(region.getByRole('tab', { name: 'A' })).toBeVisible();
      // 在這裡先答一題，再從「全部題型」的題庫練習點同一格：作答頁接著做同一組（同一份練習紀錄與作答紀錄）。
      const answered =
        meta.slug === 'reading'
          ? page.getByRole('radio', { name: /How the death rate of young children has changed since 1990/ })
          : page.getByRole('textbox', { name: '第 1 題作答' });
      if (meta.slug === 'reading') await answered.check();
      else await answered.fill('turns');
      await region.getByRole('link', { name: '題庫練習' }).click();
      await page.getByRole('link', { name: `${meta.title}・穩定基礎：1 組，已做 0 組` }).click();
      await expect(page).toHaveURL(new RegExp(`/practice/${meta.slug}/basic$`));
      await expect(page.getByRole('heading', { level: 1, name: `${meta.title}・穩定基礎` })).toBeVisible();
      await expect(page.getByText('已接續上次在這一格做的題組。')).toBeVisible();
      if (meta.slug === 'reading') await expect(answered).toBeChecked();
      else await expect(answered).toHaveValue('turns');
      await expect(page.getByRole('button', { name: '交卷', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});

test.describe('中譯英、英文作文題型頁（後端功能全開）', () => {
  test('中譯英：頁首下面就是題目；說明 AI 逐句批改與點數，沒有即將開放、規劃中', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await mockBackend(page, FEATURES_ON);
    await page.goto('/translation');
    await expect(page.getByRole('region', { name: '本站仿真題' }).locator('a[href^="/writing/translation/ai/"]').first()).toBeVisible();
    await expect(page.getByRole('region', { name: '本站仿真題' })).toContainText('登入並通過申請後，也能送 AI 批改');
    await expect(page.getByRole('region', { name: /^學測\s*\d+ 組$/ }).getByRole('link').first()).toHaveAttribute('href', /^\/writing\/translation\//);
    await expect(page.getByText(/登入並通過申請後，由兩位 AI 評分者依大考評分原則逐句給分/)).toBeVisible();
    await expect(page.getByRole('region', { name: '作答與批改方式' }).getByRole('link', { name: '寫作練習' })).toHaveAttribute('href', '/writing');
    await expect(page.getByText(/即將開放|規劃中/)).toHaveCount(0);
    await expect(page.getByText('開發中', { exact: true })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectFitsWidth(page, testInfo);
    expect(errors).toEqual([]);
  });

  test('英文作文：頁首下面就是題目；拍照上傳的實際流程與照片保存規則', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    await mockBackend(page, FEATURES_ON);
    await page.goto('/composition');
    await expect(page.getByRole('region', { name: '本站仿真題' }).locator('a[href^="/writing/essay/ai/"]').first()).toBeVisible();
    await expect(page.getByRole('region', { name: /^學測\s*\d+ 題$/ }).getByRole('link').first()).toHaveAttribute('href', /^\/writing\/essay\//);
    const photo = page.getByRole('region', { name: '拍照上傳手寫作文' });
    await expect(photo.getByRole('listitem').first()).toContainText('拍照上傳手寫稿');
    await expect(photo).toContainText('縮小、轉成 JPEG');
    await expect(photo).toContainText('逐行確認、修正辨識結果');
    await expect(photo).toContainText('最長也只保留 24 小時');
    await expect(photo.getByRole('link', { name: '隱私權說明' })).toHaveAttribute('href', '/privacy');
    await expect(page.getByText(/即將開放|規劃中/)).toHaveCount(0);
    await expect(page.getByText('開發中', { exact: true })).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    await expectFitsWidth(page, testInfo);
    expect(errors).toEqual([]);
  });
});
