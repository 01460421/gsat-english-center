/**
 * 煙霧測試：每個路由在桌機與手機各開一次（專案設定見 playwright.config.ts），檢查：
 *   1. 沒有 console error 與未捕捉的例外（pageerror）；
 *   2. 頁面標題（<title> 與 <h1>）存在且正確；
 *   3. 沒有水平捲動（手機最常見的版面問題：長字串、固定寬度的表格把頁面撐寬）；手機專案另外在 320px 再檢查一次。
 * 標準沿用 Sekai Center 的 tests/smoke.mjs（docs/research/05-sekai-center-patterns.md §2.9）。
 *
 * 後端一律用 page.route 假造：煙霧測試不能依賴 wrangler 或線上 API，
 * 否則後端一出問題前端的 CI 就跟著紅（05 文件 §3.5 第 7 點）。
 */
import { expect, test, type Page } from '@playwright/test';
import { APP_NAME, BOTTOM_NAV_PATHS, PAGES, documentTitle, getPage } from '../src/modules';

const HEALTH = { ok: true, service: 'gsat-english-api', version: '0.0.0-smoke', time: '2026-10-07T00:00:00.000Z' };

async function mockBackend(page: Page, health: 'ok' | 'down' = 'ok') {
  // 先註冊的規則優先度較低：其他 /api、/auth 一律回統一格式的 404，最後才覆寫 /api/health。
  await page.route(/\/(api|auth)\//, (route) =>
    route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'smoke test' } } }),
  );
  // 功能開關：登入與 AI 都關閉（SessionProvider 載入時會讀；回 404 的話瀏覽器會印 console error）。
  await page.route('**/api/features', (route) =>
    route.fulfill({ json: { auth: false, ai: false, ocr: false, aiPaused: false } }),
  );
  await page.route('**/api/health', (route) =>
    health === 'ok'
      ? route.fulfill({ json: HEALTH })
      : route.fulfill({ status: 503, json: { error: { code: 'internal_error', message: 'down' } } }),
  );
}

/** 收集 console error 與未捕捉的例外；在 goto 之前呼叫，才不會漏掉載入期間的錯誤。 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** 頁面寬度是否超出視窗；超出時列出肇事元素，失敗訊息直接告訴你要修哪裡。 */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const viewport = root.clientWidth;
    const offenders: string[] = [];
    if (root.scrollWidth > viewport) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewport + 1) {
          const cls = Array.from(el.classList).slice(0, 4).join('.');
          offenders.push(`<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> right=${Math.round(rect.right)}`);
          if (offenders.length >= 8) break;
        }
      }
    }
    return { scrollWidth: root.scrollWidth, viewport, offenders };
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, viewport, offenders } = await horizontalOverflow(page);
  expect(scrollWidth, `頁面寬 ${scrollWidth}px 超出視窗 ${viewport}px：\n${offenders.join('\n')}`).toBeLessThanOrEqual(viewport);
}

test.describe('每個路由', () => {
  for (const meta of PAGES) {
    test(`${meta.title}（${meta.path}）`, async ({ page }, testInfo) => {
      const errors = collectErrors(page);
      await mockBackend(page);
      await page.goto(meta.path);

      await expect(page.getByRole('heading', { level: 1, name: meta.title })).toBeVisible();
      await expect(page).toHaveTitle(documentTitle(meta));
      if (meta.path === '/') await expect(page.getByText('後端已連線')).toBeVisible();
      if (meta.status === 'dev' && meta.path !== '/') await expect(page.getByText('開發中').first()).toBeVisible();

      // 版面：桌機看得到側邊欄、手機看得到底部導覽的「更多」（另一個用 CSS 隱藏，不在無障礙樹裡）。
      const nav = page.getByRole('navigation', { name: '主要導覽' });
      await expect(nav).toHaveCount(1);
      if (testInfo.project.name === 'mobile') {
        await expect(nav.getByRole('button', { name: '更多' })).toBeVisible();
      } else {
        await expect(nav.getByRole('link', { name: '關於' })).toBeVisible();
      }

      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
      if (testInfo.project.name === 'mobile') {
        // 再縮到 320px：WCAG 1.4.10（重排）的基準寬度，等同 1280px 螢幕放大 400%，也涵蓋小尺寸 Android 手機。
        await page.setViewportSize({ width: 320, height: 667 });
        await expectNoHorizontalOverflow(page);
      }
      expect(errors).toEqual([]);
    });
  }

  test('未知路徑顯示找不到頁面', async ({ page }) => {
    const errors = collectErrors(page);
    await mockBackend(page);
    await page.goto('/no-such-page');
    await expect(page.getByRole('heading', { level: 1, name: '找不到這個頁面' })).toBeVisible();
    await expect(page).toHaveTitle(`找不到這個頁面｜${APP_NAME}`);
    expect(errors).toEqual([]);
  });
});

test('後端未連線時首頁優雅降級', async ({ page }) => {
  // 這個測試刻意讓 /api/health 回 503，瀏覽器會為失敗的請求印一行 console error，所以不檢查 console。
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await mockBackend(page, 'down');
  await page.goto('/');
  await expect(page.getByText('後端未連線')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新檢查' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('選擇的主題在重新整理後仍然生效（index.html 的繪製前腳本）', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/settings');
  await page.getByRole('radio', { name: /^深色/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: /^深色/ })).toBeChecked();
  // 手機網址列顏色也要跟著選定的主題，而不是系統主題（瀏覽器預設是淺色，這裡選了深色）。
  for (const meta of await page.locator('meta[name="theme-color"]').all()) {
    await expect(meta).toHaveAttribute('content', '#171c23');
  }
  await page.getByRole('radio', { name: /^跟隨系統/ }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
});

test('手機導覽：底部導覽每一項都能點，「更多」面板列出全部頁面且最後一項點得到', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', '底部導覽與「更多」面板只在手機版面出現');
  const errors = collectErrors(page);
  await mockBackend(page);
  await page.goto('/settings');

  const nav = page.getByRole('navigation', { name: '主要導覽' });
  for (const path of BOTTOM_NAV_PATHS) {
    const meta = getPage(path);
    await nav.getByRole('link', { name: meta.navLabel }).click();
    await expect(page.getByRole('heading', { level: 1, name: meta.title })).toBeVisible();
  }

  await nav.getByRole('button', { name: '更多' }).click();
  const dialog = page.getByRole('dialog', { name: '全部功能' });
  await expect(dialog).toBeVisible();
  for (const meta of PAGES) await expect(dialog.getByRole('link', { name: meta.navLabel })).toHaveCount(1);
  // 最後一項在矮螢幕（667px）上要捲動面板才看得到；Playwright 點擊前會自動捲入視窗，點不到代表面板沒辦法捲動。
  const last = PAGES[PAGES.length - 1];
  if (!last) throw new Error('PAGES 是空的');
  await dialog.getByRole('link', { name: last.navLabel }).click();
  await expect(page).toHaveURL(new RegExp(`${last.path}$`));
  await expect(page.getByRole('heading', { level: 1, name: last.title })).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
