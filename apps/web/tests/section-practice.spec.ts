/**
 * 題型頁內嵌的題庫練習（/cloze 等）與中譯英、英文作文題型頁的題目列表，在建置後的產物上跑，桌機與手機都要過。
 *
 *   1. /cloze：打開就是練習（手機上難度切換與題組開頭在第一個畫面裡），作答、交卷、解析、再一組；
 *      網址寫回 ?tier=；切到 ?tier=advanced 再切回來，做到一半的答案還在；/practice/cloze/basic 接著做同一組；
 *      網址沒有難度時回到最近練過的難度；
 *   2. 題庫索引載入失敗：練習區就地顯示錯誤，「再試一次」後出現題組；
 *   3. /translation、/composition：頁首下面就是歷屆題目，點一組進到作答頁，作答頁的返回連結回到題型頁。
 *
 * /data/bank/* 用 build-data 的範例輸出（同 practice.spec.ts），另外把綜合測驗的範例題組複製一份放到「穩定基礎」
 * （範例只有進階練習有綜合測驗），才測得到切換難度。寫作題目用建置產生的真實資料（歷屆試題整理出來的，不會是空的）。
 * 每個測試都檢查沒有 console error、未捕捉的例外與水平捲動（手機另外縮到 320px 再檢查一次）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bank-public');
/** 複製出來放在「綜合測驗・穩定基礎」的題組。 */
const CLOZE_BASIC_UID = 'ai.cz.0b0b0b';

type Json = Record<string, unknown>;

function fixture(rel: string): Json {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, rel), 'utf8')) as Json;
}

async function mockBank(page: Page, { indexStatus = () => 200 }: { indexStatus?: () => number } = {}) {
  const czRel = 'bank/groups/ai.cz.2b3c4d@1.json';
  await page.route('**/data/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    if (rel === 'bank/index.json') {
      if (indexStatus() !== 200) return route.fulfill({ status: indexStatus(), body: 'error' });
      const index = fixture(rel) as { groups: Json[]; count: number };
      const cz = index.groups.find((g) => g['uid'] === 'ai.cz.2b3c4d');
      if (!cz) throw new Error('範例索引沒有綜合測驗');
      const groups = [...index.groups, { ...cz, uid: CLOZE_BASIC_UID, tier: 'basic' }];
      return route.fulfill({ json: { ...index, count: groups.length, groups } });
    }
    if (rel === `bank/groups/${CLOZE_BASIC_UID}@1.json`) return route.fulfill({ json: { ...fixture(czRel), uid: CLOZE_BASIC_UID, tier: 'basic' } });
    const file = path.join(FIXTURE_DIR, rel);
    if (!rel.startsWith('bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
}

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

/** 水平捲動（比對 clientWidth 和設定的視窗寬度中較小的，理由見 practice.spec.ts）。 */
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

const tierNav = (page: Page) => page.getByRole('navigation', { name: '綜合測驗的難度' });
const region = (page: Page) => page.getByRole('region', { name: '綜合測驗題庫練習' });

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('綜合測驗頁：打開就是練習；作答、交卷、解析、再一組；切換難度、和題庫練習的作答頁共用進度', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/cloze');

  // 頁首是題型名稱；練習區直接出現題組，網址寫回預設的難度（沒練過＝穩定基礎）。
  await expect(page.getByRole('heading', { level: 1, name: '綜合測驗' })).toBeVisible();
  await expect(page).toHaveTitle('綜合測驗｜學測英文中心');
  const heading = page.getByRole('heading', { level: 2, name: '綜合測驗・穩定基礎' });
  await expect(heading).toBeVisible();
  await expect(page).toHaveURL(/\/cloze\?tier=basic$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  const nav = tierNav(page);
  await expect(nav.getByRole('link', { name: '穩定基礎：1 組，已做 0 組' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: '進階練習：1 組，已做 0 組' })).toHaveAttribute('href', '/cloze?tier=advanced');
  await expect(nav.getByRole('link', { name: '超越頂標：出題中' })).toBeVisible();
  // 第一個畫面（手機 375×667）就看得到難度切換、題組標題與交卷按鈕，不必先捲過一長段說明。
  await expect(nav).toBeInViewport();
  await expect(heading).toBeInViewport();
  await expect(page.getByRole('button', { name: '交卷', exact: true })).toBeInViewport();
  await expect(region(page).getByText('AI 出題・已通過自動驗證・人工審核中').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);
  // 打開頁面還沒作答：不計時（只是來看說明不算進用時），第一次作答才開始。
  const timer = page.getByRole('timer');
  await expect(timer).toHaveAccessibleName('已用時間 0 秒，作答後開始計時');
  await expect(timer).toHaveText('0:00');

  // 作答、交卷：成績、解析卡；難度切換的「已做」跟著更新；分頁標題不變。
  await page.getByRole('radio', { name: /^\(A\) but/ }).check();
  await expect(timer).toHaveAccessibleName(/^已用時間 \d+ 秒$/);
  await page.getByRole('radio', { name: /^\(B\) eager/ }).check();
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  const result = page.getByRole('region', { name: '交卷結果' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('1／3 題');
  await expect(result).toBeInViewport();
  // 題型頁的說明用難度名稱（不說「這一格」）；學生不是從題庫練習進來的，結果面板沒有「回到題庫練習」。
  await expect(result).toContainText('穩定基礎目前只有這一組');
  await expect(result.getByRole('link', { name: '回到題庫練習' })).toHaveCount(0);
  await expect(page.getByTestId('explanation-card')).toHaveCount(3);
  await expect(region(page).getByText('全文中譯（AI 翻譯）', { exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '穩定基礎：1 組，已做 1 組' })).toBeVisible();
  await expect(page).toHaveTitle('綜合測驗｜學測英文中心');
  await expectFitsWidth(page, testInfo);

  // 再一組：這一格只有一組 → 重做同一組，從空白開始，題組標題捲回畫面裡。
  await page.getByRole('button', { name: '再一組' }).first().click();
  await expect(page.getByText('穩定基礎的 1 組你都做過了，這是比較早做的一組，再練一次。')).toBeVisible();
  await expect(region(page).getByText(/這一格/)).toHaveCount(0);
  await expect(result).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^\(A\) but/ })).not.toBeChecked();
  await expect(heading).toBeInViewport();

  // 做到一半切到進階練習（網址 ?tier=advanced），再切回來：答案還在。
  await page.getByRole('radio', { name: /^\(C\) remain/ }).check();
  await nav.getByRole('link', { name: /^進階練習/ }).click();
  await expect(page).toHaveURL(/\/cloze\?tier=advanced$/);
  await expect(page.getByRole('heading', { level: 2, name: '綜合測驗・進階練習' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /^進階練習/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('radio', { name: /^\(C\) remain/ })).not.toBeChecked();
  await page.goBack();
  await expect(page).toHaveURL(/\/cloze\?tier=basic$/);
  await expect(heading).toBeVisible();
  await expect(page.getByRole('radio', { name: /^\(C\) remain/ })).toBeChecked();
  await expect(page.getByText('已接續上次在穩定基礎做的題組。')).toBeVisible();

  // 題庫練習的作答頁：同一份練習紀錄，接著做同一組。
  await page.goto('/practice/cloze/basic');
  await expect(page.getByRole('heading', { level: 1, name: '綜合測驗・穩定基礎' })).toBeVisible();
  await expect(page.getByRole('link', { name: '題庫練習' }).first()).toHaveAttribute('href', '/practice');
  await expect(page.getByText('已接續上次在這一格做的題組。')).toBeVisible();
  await expect(page.getByRole('radio', { name: /^\(C\) remain/ })).toBeChecked();

  // 在進階練習作答，之後網址沒有難度地打開綜合測驗頁：回到最近練過的進階練習。
  await page.goto('/cloze?tier=advanced');
  await page.getByRole('radio', { name: /^\(D\) rare/ }).check();
  await page.goto('/cloze');
  await expect(page).toHaveURL(/\/cloze\?tier=advanced$/);
  await expect(page.getByRole('heading', { level: 2, name: '綜合測驗・進階練習' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^\(D\) rare/ })).toBeChecked();

  // 練習區下面：全部題型、歷屆試題各一個連結；學測怎麼考；收合的「題庫練習有什麼」。
  await expect(region(page).getByRole('link', { name: '題庫練習' })).toHaveAttribute('href', '/practice');
  await expect(region(page).getByRole('link', { name: '歷屆試題' })).toHaveAttribute('href', '/exams');
  await expect(page.getByRole('region', { name: '學測怎麼考' })).toContainText('第 11–20 題');
  const offers = page.getByRole('list', { name: '題庫練習有什麼' });
  await expect(offers).toBeHidden();
  await page.getByText('題庫練習有什麼', { exact: true }).click();
  await expect(offers).toBeVisible();
  await expect(offers).toContainText('四段式解析');
  expect(errors).toEqual([]);
});

test('深色模式：難度切換（目前的難度）與題組用深色主題的顏色', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockBank(page);
  await page.goto('/cloze?tier=advanced');
  await expect(page.getByRole('heading', { level: 2, name: '綜合測驗・進階練習' })).toBeVisible();
  const current = tierNav(page).getByRole('link', { name: /^進階練習/ });
  const colors = await current.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color, body: getComputedStyle(document.body).backgroundColor };
  });
  // 深色主題：頁面背景是深色，目前的難度是主題色底（淺藍）配深色字，對比清楚。
  /** 'rgb(r, g, b)' 或 'color(srgb …)' 的亮度（0–1）。 */
  const lum = (css: string) => {
    const nums = (css.match(/[\d.]+/g) ?? []).map(Number);
    const [r = 0, g = 0, b = 0] = css.startsWith('color(') ? nums.map((n) => n * 255) : nums;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  expect(lum(colors.body)).toBeLessThan(0.2);
  expect(lum(colors.bg) - lum(colors.fg)).toBeGreaterThan(0.4);
  expect(errors).toEqual([]);
});

test('題庫索引載入失敗：練習區就地顯示錯誤，「再試一次」後出現題組；頁首與考試說明照常', async ({ page }) => {
  // 這個測試刻意讓 index.json 回 500，瀏覽器會為失敗的請求印一行 console error，所以只檢查未捕捉的例外。
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  let status = 500;
  await mockBank(page, { indexStatus: () => status });
  await page.goto('/reading');
  const practice = page.getByRole('region', { name: '閱讀測驗題庫練習' });
  await expect(practice.getByRole('alert')).toContainText('資料載入失敗');
  await expect(page.getByRole('heading', { level: 1, name: '閱讀測驗' })).toBeVisible();
  await expect(page.getByRole('region', { name: '學測怎麼考' })).toBeVisible();
  status = 200;
  await practice.getByRole('button', { name: '再試一次' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '閱讀測驗・穩定基礎' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^折線圖：/ })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('中譯英頁：頁首下面就是歷屆題目，點一組進到作答頁', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/translation');
  await expect(page.getByRole('heading', { level: 1, name: '中譯英' })).toBeVisible();
  const gsat = page.getByRole('region', { name: /^學測\s*\d+ 組$/ });
  const first = gsat.getByRole('link').first();
  await expect(first).toBeVisible();
  await expect(first).toBeInViewport();
  await expect(first).toHaveAttribute('href', /^\/writing\/translation\/gsat-\d+$/);
  await expect(page.getByRole('radio', { name: /^全部/ })).toBeChecked();
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);
  const href = await first.getAttribute('href');
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1, name: /學測 中譯英$/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '英文譯文' }).first()).toBeVisible();
  // 返回連結回到題型頁（不是寫作練習底下的 /writing/translation）。
  const back = page.getByRole('main').getByRole('link', { name: '中譯英', exact: true });
  await expect(back).toHaveAttribute('href', '/translation');
  await back.click();
  await expect(page).toHaveURL(/\/translation$/);
  await expect(page.getByRole('heading', { level: 1, name: '中譯英' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('英文作文頁：頁首下面就是歷屆題目，點一題進到作答頁', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/composition');
  await expect(page.getByRole('heading', { level: 1, name: '英文作文' })).toBeVisible();
  const gsat = page.getByRole('region', { name: /^學測\s*\d+ 題$/ });
  const first = gsat.getByRole('link').first();
  await expect(first).toBeInViewport();
  await expect(first).toHaveAttribute('href', /^\/writing\/essay\/gsat-\d+$/);
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);
  await first.click();
  await expect(page).toHaveURL(/\/writing\/essay\/gsat-\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: '英文作文', exact: true })).toHaveAttribute('href', '/composition');
  expect(errors).toEqual([]);
});
