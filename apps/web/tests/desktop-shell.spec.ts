/**
 * 桌機殼層（docs/design/desktop-ui.md §3、§11.3）：在建置後的產物上跑，project 是 desktop-ui（1366×640）與 desktop-lg（1024×600）。
 * 頁面各自的桌機版面（首頁儀表板、/exams 表格、/practice 矩陣…）的斷言跟著 PR A2 加。
 *
 *   1. 側邊欄的高度：1366×640 已登入與未登入都不用捲；1280×600 已登入不用捲，未登入可以捲但一定有淡出遮罩、捲到底後遮罩消失。
 *   2. 頁尾貼底（短頁）；工作區路由的內距與寬度模式。
 *   3. 收合：[ 鍵與按鈕、重新整理後仍是收合、收合時鍵盤聚焦看得到提示泡泡；觸控為主的裝置沒有收合。
 *   4. 工作區路由的自動收合（寬度不夠、沒設定過）；自己按過展開之後不再自動收合。
 *   5. 鍵盤快捷鍵說明：? 開、Esc 關、焦點回原處、開著時背景不捲動也不接快捷鍵；輸入框裡的 ? 不開；
 *      在 /words 每日學習開著說明按 1，背後的卡片沒有被評分。
 *   6. 寬度：非工作區路由（含寫作題目列表）上的 p、li 都不超過 60rem；每條路由在 1024、1366、1920 沒有水平捲動；
 *      /privacy 內文不超過 65 字元；/exams 的表格放寬、沒放寬的說明區塊維持 944px。
 *   7. 目前位置：/writing/translation/… 亮「中譯英」。回到頂端按鈕。
 *   8. 頁面（PR A2，§5）：首頁儀表板、/practice 矩陣、題型頁的難度切換在頁首右邊、/exams 資料表（每列一個連結、篩選帶進作答頁再回來、
 *      Shift+Tab 時焦點不會停在 sticky 篩選列與表頭底下）、題目列表的 sticky 篩選列、/mock 列式卡片對齊、/writing 右欄、設定頁。
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PAGES } from '../src/modules';
import { collectErrors, fakeBackend, ok, signedInMe } from './support/backend';

const sidebar = (page: Page) => page.locator('aside[data-sidebar]');
const sidebarList = (page: Page) => page.locator('[data-sidebar-list]');

async function listOverflow(page: Page) {
  return sidebarList(page).evaluate((el) => ({ overflowing: el.scrollHeight > el.clientHeight, masked: el.hasAttribute('data-overflow') }));
}

/** 只在 desktop-ui 跑：測試自己指定視窗，在 desktop-lg 再跑一次只是重複。 */
function onlyDesktopUi() {
  test.skip(test.info().project.name !== 'desktop-ui', '這個測試自己指定視窗，只在 desktop-ui 跑');
}

/**
 * 元素裡第一段字真的畫出來的像素數（字的筆畫）：截下那段字的範圍，數和範圍裡最常見的顏色明顯不同的像素。
 * 高對比模式只比 computed style 不夠：Chromium 在 forced-colors 會在字後面墊一塊 Canvas 色的底（readability backplate），
 * 選中的膠囊若是 HighlightText 的字，白字壓在白底上整塊同一個顏色，底色卻和沒選中的不同（§16.7）。
 */
async function inkPixels(page: Page, el: Locator): Promise<number> {
  const rect = await el.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (t.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    const text = walker.nextNode();
    if (!text) throw new Error('元素裡沒有字');
    const range = document.createRange();
    range.selectNodeContents(text);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // 往內縮 1px：只看字的範圍，不碰到膠囊的框線。
  const png = await page.screenshot({ clip: { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 } });
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('沒有 2d canvas');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const counts = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      const diff = Math.abs((data[i] ?? 0) - ((bg >> 16) & 255)) + Math.abs((data[i + 1] ?? 0) - ((bg >> 8) & 255)) + Math.abs((data[i + 2] ?? 0) - (bg & 255));
      if (diff > 96) ink++;
    }
    return ink;
  }, `data:image/png;base64,${png.toString('base64')}`);
}

test.describe('側邊欄', () => {
  test('1366×640：已登入與未登入的導覽清單都不用捲', async ({ page }) => {
    onlyDesktopUi();
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1366, height: 640 });
    const backend = await fakeBackend(page, { me: { user: null } });
    await page.goto('/');
    await expect(page.getByRole('link', { name: '使用 Google 登入', exact: true })).toBeVisible();
    expect(await listOverflow(page)).toEqual({ overflowing: false, masked: false });

    backend.me = signedInMe({ ai_status: 'approved' });
    await page.reload();
    await expect(page.getByRole('button', { name: '小明（帳號選單）' })).toBeVisible();
    expect(await listOverflow(page)).toEqual({ overflowing: false, masked: false });
    expect(errors).toEqual([]);
  });

  test('1280×600：已登入不用捲；未登入時有淡出遮罩，捲到底後最後一項看得到、遮罩消失', async ({ page }) => {
    onlyDesktopUi();
    await page.setViewportSize({ width: 1280, height: 600 });
    const backend = await fakeBackend(page, { me: signedInMe() });
    await page.goto('/');
    await expect(page.getByRole('button', { name: '小明（帳號選單）' })).toBeVisible();
    expect(await listOverflow(page)).toEqual({ overflowing: false, masked: false });

    backend.me = { user: null };
    await page.reload();
    await expect(page.getByRole('link', { name: '使用 Google 登入', exact: true })).toBeVisible();
    // 未登入的清單 489px、可用 449px（§16.5），一定溢出：不溢出表示版面或量法變了，遮罩的檢查就沒有意義，要先修這個測試。
    expect((await listOverflow(page)).overflowing).toBe(true);
    await expect(sidebarList(page)).toHaveAttribute('data-overflow', '');
    await sidebarList(page).evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(sidebarList(page)).not.toHaveAttribute('data-overflow');
    await expect(sidebarList(page).getByRole('link', { name: '模擬考' })).toBeInViewport();
  });

  test('600 高、未登入：換到清單下面的頁（模擬考、歷屆試題），目前頁自動捲進清單的可見範圍、不壓在淡出遮罩底下', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page, { me: { user: null } });
    for (const [width, path, name] of [
      [1280, '/mock', '模擬考'],
      [1024, '/exams', '歷屆試題'],
      [1024, '/mock', '模擬考'],
    ] as const) {
      await page.setViewportSize({ width, height: 600 });
      await page.goto(path);
      await expect(page.getByRole('link', { name: '使用 Google 登入', exact: true })).toBeVisible();
      const current = sidebarList(page).getByRole('link', { name });
      await expect(current).toHaveAttribute('aria-current', 'page');
      await expect
        .poll(() =>
          sidebarList(page).evaluate((list) => {
            const item = list.querySelector('[aria-current="page"]') as HTMLElement;
            const fade = list.hasAttribute('data-overflow') ? 32 : 0;
            return item.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom - fade + 0.5;
          }),
          { message: `${width}×600 ${path}` },
        )
        .toBe(true);
    }
  });

  test('三段：目前頁、設定與關於在底部工具列（仍在「主要導覽」裡）、未登入是外框的登入按鈕', async ({ page }) => {
    await fakeBackend(page, { me: { user: null } });
    await page.goto('/settings');
    const nav = page.getByRole('navigation', { name: '主要導覽' });
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: '關於' })).toBeVisible();
    await expect(nav.getByRole('button', { name: /^切換為深色主題（目前跟隨系統：淺色）$/ })).toBeVisible();
    const login = page.getByRole('link', { name: '使用 Google 登入', exact: true });
    await expect(login).toBeVisible();
    // 外框樣式，不是實心主色。
    expect(await login.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByText('學校帳號不能用時請改用個人 Gmail')).toBeVisible();
  });

  test('從 /writing/translation/gsat-115 進來，目前位置是「中譯英」，而且只有一項', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/writing/translation/gsat-115');
    const nav = page.getByRole('navigation', { name: '主要導覽' });
    await expect(nav.getByRole('link', { name: '中譯英' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test('收合：按鈕與 [ 鍵切換、重新整理後仍是收合；收合時鍵盤聚焦看得到提示泡泡', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
    await page.keyboard.press('[');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    expect(await sidebar(page).evaluate((el) => el.getBoundingClientRect().width)).toBe(64);
    await page.reload();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');

    // 鍵盤聚焦（:focus-visible）一項：右邊出現同名的提示泡泡；按 Esc 收起。
    const words = sidebar(page).getByRole('link', { name: '單字' });
    await words.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(words).toBeFocused();
    const tip = page.getByTestId('sidebar-tooltip');
    await expect(tip).toHaveText('單字');
    const [tipBox, linkBox] = await Promise.all([tip.boundingBox(), words.boundingBox()]);
    expect(tipBox && linkBox && tipBox.x).toBeGreaterThan((linkBox?.x ?? 0) + (linkBox?.width ?? 0));
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);

    await page.getByRole('button', { name: '展開側邊欄' }).click();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
  });

  test('工作區路由寬度不夠、沒設定過：自動收合，回首頁恢復展開；自己按過展開之後不再自動收合', async ({ page }) => {
    onlyDesktopUi();
    await page.setViewportSize({ width: 1100, height: 640 });
    await fakeBackend(page);
    await page.goto('/writing/essay/gsat-115');
    await expect(page.getByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    await sidebar(page).getByRole('link', { name: '首頁' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '學測英文中心' })).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');

    await page.goBack();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    await page.getByRole('button', { name: '展開側邊欄' }).click();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
    await page.goto('/writing/translation/gsat-115');
    await expect(page.getByRole('heading', { level: 1, name: '115 學測 中譯英' })).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
  });

  test('1024×600（desktop-lg）：工作區路由自動收合後內容是「版面寬 − 收合的側邊欄 − 左右內距」（沒有捲軸時 896px），一般頁維持展開', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-lg', '只在 1024 寬');
    await fakeBackend(page);
    await page.goto('/exams/gsat-115');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    const content = page.locator('main > div').first();
    // 1024 − 捲軸位置（無頭瀏覽器隱藏捲軸但保留 15px）− 收合的側邊欄 64 − 左右 --page-px 2rem。
    const width = await content.evaluate((el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) * 2);
    const expected = await page.evaluate(() => document.body.clientWidth - 64 - 64);
    expect(width).toBe(expected);
    await page.goto('/exams');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
  });
});

test.describe('觸控為主的裝置', () => {
  test.use({ hasTouch: true });

  test('沒有收合鈕，[ 不作用，已存的「收合」也不套用', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.addInitScript(() => window.localStorage.setItem('gsat-ui:v1:sidebar', 'collapsed'));
    await page.goto('/');
    expect(await page.evaluate(() => window.matchMedia('(pointer: fine)').matches)).toBe(false);
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
    await expect(page.getByRole('button', { name: /側邊欄/ })).toHaveCount(0);
    await page.keyboard.press('[');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
  });
});

test.describe('頁尾與版面寬度', () => {
  test('短頁（404、設定）的頁尾貼在視窗底部；框線和內容對齊', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    for (const [path, size] of [
      ['/no-such-page', { width: 1366, height: 640 }],
      ['/settings', { width: 1920, height: 960 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      const footer = page.locator('main > footer');
      const { bottom, docHeight } = await footer.evaluate((el) => ({
        bottom: el.getBoundingClientRect().bottom + window.scrollY,
        docHeight: document.documentElement.scrollHeight,
      }));
      // 內容比視窗短：頁尾在視窗底部；內容比視窗長（設定頁在桌機多了「電腦版介面」）：頁尾在內容後面、文件的最底部。
      if (path === '/no-such-page') expect(docHeight).toBe(size.height);
      else expect(docHeight).toBeGreaterThanOrEqual(size.height);
      expect(Math.round(bottom)).toBe(docHeight);
    }
    // 頁尾的框線（在 nav 上）和內容卡片同寬：/settings 是窄版（max-w-4xl，左右 --page-px 2.5rem）。
    const [navBox, card] = await Promise.all([
      page.getByRole('navigation', { name: '網站資訊' }).boundingBox(),
      page.locator('main section').first().boundingBox(),
    ]);
    expect(Math.round(navBox?.x ?? 0)).toBe(Math.round(card?.x ?? -1));
    expect(Math.round(navBox?.width ?? 0)).toBe(Math.round(card?.width ?? -1));
  });

  test('非工作區路由上任何 p、li 都不超過 60rem；1024、1366 與 1920 都沒有水平捲動', async ({ page }) => {
    onlyDesktopUi();
    test.setTimeout(300_000);
    const errors = collectErrors(page);
    await fakeBackend(page);
    // 側邊欄的頁面，加上沒有在側邊欄的列表頁與靜態頁。
    const routes = [
      ...PAGES.map((meta) => ({ path: meta.path, title: meta.title })),
      { path: '/writing/translation', title: '中譯英題目' },
      { path: '/writing/essay', title: '英文作文題目' },
      { path: '/writing/translation/ai', title: '本站仿真中譯英' },
      { path: '/writing/essay/ai', title: '本站仿真作文' },
      { path: '/privacy', title: '隱私權說明' },
      { path: '/terms', title: '服務條款' },
    ];
    for (const [width, height] of [
      [1024, 600],
      [1366, 640],
      [1920, 960],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const route of routes) {
        await page.goto(route.path);
        await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible();
        await page.waitForLoadState('networkidle');
        const { scrollWidth, clientWidth, widest } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.body.clientWidth,
          widest: Math.max(0, ...Array.from(document.querySelectorAll('main p, main li'), (el) => el.getBoundingClientRect().width)),
        }));
        expect(scrollWidth, `${route.path} 在 ${width} 寬有水平捲動`).toBeLessThanOrEqual(clientWidth);
        const workspace = ['/vocabulary', '/cloze', '/word-bank', '/structure', '/reading', '/mixed'].includes(route.path);
        if (!workspace) expect(widest, `${route.path} 在 ${width} 寬有超過 60rem 的段落`).toBeLessThanOrEqual(960);
      }
    }
    expect(errors).toEqual([]);
  });

  test('/privacy 內文不超過 65 字元；/exams 的表格在 1440 放寬（> 944px），沒放寬的說明區塊維持 944px', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: '隱私權說明' })).toBeVisible();
    const overLimit = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('main article p, main article li'))
        .filter((el) => {
          const max = parseFloat(getComputedStyle(el).maxWidth);
          return !(max > 0) || el.getBoundingClientRect().width > max + 0.5;
        })
        .map((el) => el.textContent?.slice(0, 20)),
    );
    expect(overLimit).toEqual([]);
    // 65ch：中文一行約 36–40 字（設計文件 §2.4）。
    const fullText = page.getByRole('region', { name: '全文' }).locator('p').first();
    expect((await fullText.boundingBox())?.width).toBeLessThanOrEqual(640);
    await expect(page.locator('#s-1')).toHaveCount(1);

    await page.goto('/exams');
    const table = page.getByRole('table', { name: '歷屆試題' });
    await expect(table).toBeVisible();
    expect((await table.boundingBox())?.width).toBeGreaterThan(944);
    await page.goto('/translation');
    const info = page.getByRole('region', { name: '學測怎麼考' });
    await expect(info).toBeVisible();
    expect(Math.round((await info.boundingBox())?.width ?? 0)).toBe(944);
  });
});

test.describe('鍵盤快捷鍵說明', () => {
  test('? 打開、Esc 關閉，焦點回到原處；開著時背景不捲動、[ 不作用；輸入框裡的 ? 不打開', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/words');
    const search = page.getByRole('searchbox').or(page.getByRole('textbox')).first();
    await search.fill('');
    await search.press('?');
    await expect(search).toHaveValue('?');
    await expect(page.getByRole('dialog', { name: '鍵盤快捷鍵' })).toHaveCount(0);

    const link = sidebar(page).getByRole('link', { name: '單字' });
    await link.focus();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: '鍵盤快捷鍵' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('開啟快捷鍵說明')).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    // 保留的捲軸槽不在 ::backdrop 的範圍裡：html 的底色調成和遮罩一樣暗，右緣沒有亮條（--bg 是 #f6f7f9）。
    const gutter = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(gutter).not.toBe('rgba(0, 0, 0, 0)');
    expect(gutter).not.toBe('rgb(246, 247, 249)');
    const before = await sidebar(page).getAttribute('data-sidebar');
    await page.keyboard.press('[');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', before ?? '');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(link).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
  });

  test('側邊欄的快捷鍵按鈕與頁尾的「鍵盤快捷鍵」都能打開；可以關掉單鍵快捷鍵', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/');
    await sidebar(page).getByRole('button', { name: '鍵盤快捷鍵' }).click();
    const dialog = page.getByRole('dialog', { name: '鍵盤快捷鍵' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: '單鍵快捷鍵' }).uncheck();
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toHaveCount(0);
    // 關掉之後按 ? 不再打開，頁尾的按鈕照樣可以打開。
    await page.locator('body').press('?');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('navigation', { name: '網站資訊' }).getByRole('button', { name: '鍵盤快捷鍵' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: '單鍵快捷鍵' })).not.toBeChecked();
  });

  test('/words 每日學習：開著說明按 1，背後的單字卡沒有被評分', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/words?tab=study');
    await page.getByRole('button', { name: /開始學習（\d+ 張）/ }).click();
    await page.getByRole('button', { name: '顯示答案' }).click();
    const rating = page.getByRole('group', { name: '評分：這個字記得多熟？' });
    await expect(rating).toBeVisible();
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: '鍵盤快捷鍵' });
    await expect(help).toBeVisible();
    // 說明列出這一頁原本就有的按鍵，並照實說明它們不受單鍵快捷鍵開關影響。
    const thisPage = help.getByRole('region', { name: '這一頁' });
    await expect(thisPage.getByText('翻卡', { exact: true })).toBeVisible();
    await expect(thisPage.getByText(/^評分（1 重來/)).toBeVisible();
    await expect(thisPage.getByText('這一頁原本就有的按鍵，不受下面的單鍵快捷鍵開關影響。')).toBeVisible();
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '鍵盤快捷鍵' })).toHaveCount(0);
    await expect(rating).toBeVisible();
    // 說明關掉之後，1 照常評分（既有的快捷鍵不變）。
    await page.keyboard.press('1');
    await expect(rating).toBeHidden();
  });
});

test('回到頂端：捲過兩個視窗高才出現，按下後回到頂端、焦點在頁面標題', async ({ page }) => {
  onlyDesktopUi();
  await fakeBackend(page);
  await page.goto('/exams');
  await expect(page.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeVisible();
  // 考卷列表是按需載入的：等列表出來（頁面夠長）再捲。
  await expect(page.getByRole('main').getByRole('link', { name: /115 學測/ }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const toTop = page.getByRole('button', { name: '回到頂端' });
  await expect(toTop).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 3));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(640 * 2);
  await expect(toTop).toBeVisible();
  await toTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeFocused();
  await expect(toTop).toHaveCount(0);
});

// ───────────────────────── 頁面（PR A2，設計文件 §5、§11.3） ─────────────────────────

test.describe('首頁與列表頁（桌機）', () => {
  test('首頁儀表板（1366×640）：問候、全部功能在第一個畫面、右欄的學習進度、AI 點數與後端狀態；不下載 /data/', async ({ page }) => {
    onlyDesktopUi();
    const errors = collectErrors(page);
    const dataRequests: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname.startsWith('/data/')) dataRequests.push(req.url());
    });
    await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
    await page.goto('/');
    await expect(page.getByText('小明，今天練什麼？')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: '學測英文中心' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '全部功能' })).toBeInViewport();
    const rail = page.getByRole('complementary', { name: '我的學習' });
    await expect(rail.getByRole('region', { name: '學習進度' })).toBeVisible();
    await expect(rail.getByTestId('quota-meters')).toContainText('今日剩 20／30 點');
    await expect(rail.getByText('後端已連線')).toBeVisible();
    // 右欄在主要內容後面（DOM 順序），不 sticky。
    expect(await rail.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    await page.waitForLoadState('networkidle');
    expect(dataRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('/practice（1366）：題型 × 難度矩陣在左、三種難度給誰在右欄；名稱格式和手機相同', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/practice');
    const table = page.getByRole('table', { name: '題型 × 難度' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('link', { name: /^詞彙題・穩定基礎：\d+ 組，已做 \d+ 組$/ })).toBeVisible();
    const aside = page.getByRole('complementary', { name: '難度與題目說明' });
    await expect(aside.getByText('頂標到 15 級分的學生')).toBeVisible();
    const [tableBox, asideBox] = await Promise.all([table.boundingBox(), aside.boundingBox()]);
    expect((asideBox?.x ?? 0) > (tableBox?.x ?? 0) + (tableBox?.width ?? 0)).toBe(true);
  });

  test('題型頁（1366×640）：頁首兩列，難度切換在頁首右邊（仍在題庫練習區塊裡），題組標題緊接在下面', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/cloze');
    const h1 = page.getByRole('heading', { level: 1, name: '綜合測驗' });
    const region = page.getByRole('region', { name: '綜合測驗題庫練習' });
    const nav = region.getByRole('navigation', { name: '綜合測驗的難度' });
    await expect(nav).toBeVisible();
    const [h1Box, navBox, groupBox] = await Promise.all([
      h1.boundingBox(),
      nav.boundingBox(),
      region.getByRole('heading', { level: 2 }).first().boundingBox(),
    ]);
    if (!h1Box || !navBox || !groupBox) throw new Error('量不到位置');
    expect(navBox.x).toBeGreaterThan(h1Box.x + h1Box.width);
    expect(navBox.y).toBeLessThan(h1Box.y + h1Box.height);
    expect(groupBox.y).toBeGreaterThan(navBox.y + navBox.height);
    // 第一題之前的頁首比改版前（360–450px）矮得多。
    expect(groupBox.y).toBeLessThan(260);
  });

  test('/exams：資料表每列一個連結；篩選學測＋112 → 進入考卷 → 返回，網址與篩選都還在', async ({ page }) => {
    const errors = collectErrors(page);
    await fakeBackend(page);
    await page.goto('/exams');
    const table = page.getByRole('table', { name: '歷屆試題' });
    await expect(table.getByRole('link', { name: /^115 學測/ })).toBeVisible();
    const counts = await table.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.querySelectorAll('a').length).filter((n) => n > 0));
    expect(counts.length).toBeGreaterThan(60);
    expect(new Set(counts)).toEqual(new Set([1]));

    await page.locator('label').filter({ hasText: /^學測/ }).click();
    await page.getByRole('combobox', { name: '學年度' }).selectOption('112');
    await expect(page).toHaveURL(/\/exams\?kind=gsat&year=112$/);
    const links = table.getByRole('link');
    await expect(links).toHaveCount(1);
    await links.first().click();
    await expect(page.getByRole('heading', { level: 1, name: '112學年度學科能力測驗英文考科' })).toBeVisible();
    await page.getByRole('link', { name: '歷屆試題列表' }).click();
    await expect(page).toHaveURL(/\/exams\?kind=gsat&year=112$/);
    await expect(page.getByRole('combobox', { name: '學年度' })).toHaveValue('112');
    await expect(page.locator('label').filter({ hasText: /^學測/ }).locator('input')).toBeChecked();
    expect(errors).toEqual([]);
  });

  test('/exams：從表格最後一列往上 Shift+Tab 走過每一列，焦點都不會停在 sticky 篩選列與表頭底下', async ({ page }) => {
    // 表頭的 sticky 是 th（thead 本身照常捲走）：量 th 的底，不是 thead 的（以前量 thead，捲動後是負的，這個檢查永遠成立）。
    test.setTimeout(120_000);
    await fakeBackend(page);
    const sizes = test.info().project.name === 'desktop-ui' ? [null, { width: 1280, height: 600 }, { width: 1920, height: 960 }] : [null];
    for (const size of sizes) {
      if (size) await page.setViewportSize(size);
      await page.goto('/exams');
      const table = page.getByRole('table', { name: '歷屆試題' });
      const links = table.getByRole('link');
      await expect(links.first()).toBeVisible();
      const count = await links.count();
      expect(count).toBeGreaterThan(60);
      const last = links.last();
      await last.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(last).toBeFocused();
      for (let i = 0; i < count - 1; i += 1) {
        await page.keyboard.press('Shift+Tab');
        const { focusTop, focusBottom, barBottom, headBottom, inTable, hit } = await page.evaluate(() => {
          const active = document.activeElement as HTMLElement;
          const box = active.getBoundingClientRect();
          const bar = document.querySelector('[data-sticky-bar]') as HTMLElement;
          const head = document.querySelector('table thead th') as HTMLElement;
          const atCenter = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return {
            focusTop: box.top,
            focusBottom: box.bottom,
            barBottom: bar.getBoundingClientRect().bottom,
            headBottom: head.getBoundingClientRect().bottom,
            inTable: active.closest('tbody') !== null,
            hit: atCenter === active || active.contains(atCenter),
          };
        });
        const step = `${size ? `${size.width}×${size.height}` : '預設視窗'} 第 ${i + 1} 次 Shift+Tab`;
        expect(focusTop, step).toBeGreaterThanOrEqual(Math.round(barBottom) - 1);
        if (!inTable) break;
        expect(focusTop, step).toBeGreaterThanOrEqual(Math.round(headBottom) - 1);
        expect(focusBottom, step).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
        // 連結的中心點就是它自己（沒有被表頭或篩選列蓋住）。
        expect(hit, step).toBe(true);
      }
    }
  });

  test('題目列表（/writing/essay）：返回連結、標題、來源分頁與篩選在 sticky 篩選列，捲到下面篩選仍看得到；篩選只有一份', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/writing/essay');
    const bar = page.locator('[data-sticky-bar]');
    await expect(bar.getByRole('heading', { level: 1, name: '英文作文題目' })).toBeVisible();
    await expect(bar.getByRole('navigation', { name: '題目來源' })).toBeVisible();
    await expect(bar.getByRole('radio', { name: /^指考/ })).toHaveCount(1);
    await expect(page.getByRole('radio', { name: /^指考/ })).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
    await expect(bar.locator('label').filter({ hasText: /^指考/ })).toBeInViewport();
    // 一行放得下（1366）時標題也黏著；1024 寬換成兩行時，第一行（返回連結、標題、來源分頁）跟著捲走（§16.7）。
    if (test.info().project.name === 'desktop-ui') await expect(bar.getByRole('heading', { level: 1, name: '英文作文題目' })).toBeInViewport();
    else await expect(bar.getByRole('heading', { level: 1, name: '英文作文題目' })).not.toBeInViewport();
    await bar.locator('label').filter({ hasText: /^指考/ }).click();
    await expect(page).toHaveURL(/kind=ast/);
    await expect(page.getByRole('heading', { name: /^學測/ })).toHaveCount(0);
  });

  test('/translation：sticky 篩選列有頁內跳轉與歷屆試題的篩選；原本的「跳到歷屆試題」不再出現', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/translation');
    const bar = page.locator('[data-sticky-bar]');
    await expect(bar.getByRole('navigation', { name: '頁內跳轉' }).getByRole('link', { name: '歷屆試題' })).toHaveAttribute('href', '#exam-questions');
    await expect(page.getByRole('link', { name: '跳到歷屆試題' })).toHaveCount(0);
    await expect(bar.getByRole('radio', { name: /^學測/ })).toHaveCount(1);
    await bar.getByRole('link', { name: '歷屆試題' }).click();
    await expect(page.getByRole('heading', { level: 2, name: '歷屆試題' })).toBeInViewport();
    const [barBox, headingBox] = await Promise.all([bar.boundingBox(), page.getByRole('heading', { level: 2, name: '歷屆試題' }).boundingBox()]);
    expect((headingBox?.y ?? 0) >= (barBox?.y ?? 0) + (barBox?.height ?? 0)).toBe(true);
  });

  test('/mock（1920）：6 張列式卡片，每列的動作欄左右對齊；考前節奏建議在右欄', async ({ page }) => {
    onlyDesktopUi();
    await page.setViewportSize({ width: 1920, height: 960 });
    await fakeBackend(page);
    await page.goto('/mock');
    const cards = page.getByRole('region', { name: '卷別' }).getByRole('article');
    await expect(cards).toHaveCount(6);
    // 每一列是同樣欄寬的 grid：狀態欄的左緣、動作欄（開始按鈕）的位置都一樣。
    const columns = await cards.evaluateAll((els) =>
      els.map((el) => {
        const status = el.querySelector(':scope > p') as HTMLElement;
        const start = el.querySelector('a[href^="/mock/"]') as HTMLElement;
        return { display: getComputedStyle(el).display, status: Math.round(status.getBoundingClientRect().left), start: Math.round(start.getBoundingClientRect().left) };
      }),
    );
    expect(new Set(columns.map((c) => c.display))).toEqual(new Set(['grid']));
    expect(new Set(columns.map((c) => c.status)).size).toBe(1);
    expect(new Set(columns.map((c) => c.start)).size).toBe(1);
    await expect(page.getByRole('complementary', { name: '考前準備' }).getByRole('heading', { name: '考前節奏建議' })).toBeVisible();
  });

  test('/writing（1366，已核准）：右欄是 AI 點數與收起來的兩種批改方式；寫作紀錄是表格', async ({ page }) => {
    onlyDesktopUi();
    const backend = await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
    backend.on('GET /api/submissions', (call) =>
      ok({
        submissions:
          call.query.get('kind') === 'translation'
            ? [{ id: 's-1', kind: 'translation', group_id: 'gsat-115.s7g1@1', input_mode: 'typed', status: 'graded', final_score: 6, final_band: null, created_at: 1_791_000_000, updated_at: 1_791_000_100, graded_at: 1_791_000_100, custom_title: null }]
            : [],
        next_cursor: null,
      }),
    );
    await page.goto('/writing');
    const aside = page.getByRole('complementary', { name: 'AI 批改' });
    await expect(aside.getByTestId('quota-meters')).toContainText('今日剩 20／30 點');
    const modes = aside.getByRole('region', { name: '兩種批改方式' });
    await expect(modes).toBeVisible();
    await expect(modes.getByText('自我檢核', { exact: true })).toBeHidden();
    const history = page.getByRole('region', { name: '我的寫作紀錄' });
    const table = history.getByRole('table', { name: '我的中譯英紀錄' });
    await expect(table.getByRole('link', { name: '115 學測 中譯英' })).toHaveAttribute('href', '/writing/submissions/s-1');
  });
});

// ───────────────────────── 審查修正（設計文件 §16.7） ─────────────────────────

test.describe('審查修正：版面', () => {
  test('/writing 的寫作紀錄表格（1216–1366 寬的左欄）：表頭一行、每列最多兩行，不會一個字一行；不超出卡片', async ({ page }) => {
    onlyDesktopUi();
    const backend = await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
    const row = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
      id,
      kind: 'translation',
      group_id: 'gsat-115.s7g1@1',
      input_mode: 'typed',
      status,
      final_score: status === 'graded' ? 6.5 : null,
      final_band: null,
      created_at: 1_791_000_000,
      updated_at: 1_791_000_100,
      graded_at: null,
      custom_title: null,
      ...extra,
    });
    const essay = (id: string, status: string, extra: Record<string, unknown> = {}) =>
      row(id, status, { kind: 'essay', group_id: 'custom:essay@1', final_score: status === 'graded' ? 15 : null, final_band: status === 'graded' ? 'good' : null, ...extra });
    backend.on('GET /api/submissions', (call) =>
      ok({
        submissions:
          call.query.get('kind') === 'translation'
            ? [row('a', 'queued'), row('b', 'draft', { group_id: 'ai.tr.1b2c4e@1' }), row('c', 'graded'), row('d', 'confirmed', { input_mode: 'photo' }), row('e', 'failed')]
            : [
                essay('f', 'graded', { custom_title: '你的學校即將舉辦「無手機日」活動，請寫一篇英文作文，說明你的看法與理由' }),
                essay('g', 'draft', { group_id: 'ai.cp.0e89ae@1' }),
                essay('h', 'ocr_ready', { input_mode: 'photo', custom_title: '我的夢想職業' }),
              ],
        next_cursor: null,
      }),
    );
    // 更新時間是「10/3 12:01」（和現在同一年時省略年份）：固定「現在」，明年跑也一樣寬。
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00+08:00'));
    for (const [width, height] of [
      [1216, 640],
      [1242, 640],
      [1280, 600],
      [1366, 640],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/writing');
      for (const kind of ['中譯英', '英文作文'] as const) {
        await page.getByRole('region', { name: '我的寫作紀錄' }).getByRole('button', { name: kind }).click();
        const table = page.getByRole('table', { name: `我的${kind}紀錄` });
        await expect(table.getByRole('link')).toHaveCount(kind === '中譯英' ? 5 : 3);
        const m = await table.evaluate((t) => ({
          heads: Array.from(t.querySelectorAll('thead th'), (th) => th.getBoundingClientRect().height).filter((h) => h > 0),
          // 狀態、更新時間兩欄的內容最多兩行（20px 一行）；每一段（「草稿」「（尚未送出）」「10/3 12:01」）都不在字中間斷開。
          cells: Array.from(t.querySelectorAll('tbody tr'), (tr) => [2, 3].map((i) => (tr.children[i]?.firstElementChild as HTMLElement).getBoundingClientRect().height)).flat(),
          phrases: Array.from(t.querySelectorAll('tbody span.whitespace-nowrap'), (el) => el.getClientRects().length),
          rows: Array.from(t.querySelectorAll('tbody tr'), (tr) => tr.getBoundingClientRect().height),
          tableRight: t.getBoundingClientRect().right,
          cardRight: (t.closest('section') as HTMLElement).getBoundingClientRect().right,
        }));
        // 表頭一行約 41px。改之前 1242 寬「方式」「狀態」逐字直排、「排隊批改中」一個字一行，列高約 130px。
        for (const h of m.heads) expect(h, `${width} 寬 ${kind} 的表頭`).toBeLessThan(48);
        for (const h of m.cells) expect(h, `${width} 寬 ${kind} 的狀態／時間`).toBeLessThanOrEqual(52);
        expect(new Set(m.phrases), `${width} 寬 ${kind}`).toEqual(new Set([1]));
        // 最窄（1216，main 剛到 ws）時自訂題目＋手寫的列也不超過四行。
        for (const h of m.rows) expect(h, `${width} 寬 ${kind} 的列`).toBeLessThanOrEqual(120);
        // 很長的自訂題目跟著欄寬截斷，表格不比卡片寬。
        expect(m.tableRight, `${width} 寬 ${kind}`).toBeLessThanOrEqual(m.cardRight);
      }
      await page.getByRole('region', { name: '我的寫作紀錄' }).getByRole('button', { name: '中譯英' }).click();
    }
    // 1366 寬：每列一行。
    const tall = await page.getByRole('table', { name: '我的中譯英紀錄' }).evaluate((t) => Array.from(t.querySelectorAll('tbody tr'), (tr) => tr.getBoundingClientRect().height));
    for (const h of tall) expect(h).toBeLessThan(48);
  });

  test('/practice 矩陣（1242 寬）：每一格一樣高、第二行（已做・答對率）不換行', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.addInitScript(() =>
      window.localStorage.setItem(
        'gsat-bank-practice:v1',
        JSON.stringify({ v: 1, done: { 'ai.vo.029307': { version: 1, section: 'vocabulary', tier: 'basic', at: '2026-10-08T00:00:00Z', correct: 7, total: 10, hinted: 0 } }, current: {}, hints: {} }),
      ),
    );
    await page.setViewportSize({ width: 1242, height: 640 });
    await page.goto('/practice');
    const table = page.getByRole('table', { name: '題型 × 難度' });
    const done = table.getByRole('link', { name: /^詞彙題・穩定基礎：\d+ 組，已做 1 組$/ });
    // 畫面上是「已做 1・70%」（「答對」是 sr-only，讀屏從 aria-describedby 聽到）。
    await expect(done).toContainText('已做 1・答對 70%');
    await expect(done).toHaveAccessibleDescription('答對 70%');
    const m = await table.evaluate((t) => ({
      heights: [...new Set(Array.from(t.querySelectorAll('tbody td > *'), (el) => Math.round(el.getBoundingClientRect().height)))],
      secondLines: [...new Set(Array.from(t.querySelectorAll('tbody td > a > span:last-child'), (el) => Math.round(el.getBoundingClientRect().height)))],
    }));
    expect(m.heights).toHaveLength(1);
    expect(m.secondLines).toEqual([16]);
  });

  test('1024×600：sticky 篩選列維持一行（≤ 64px）；題目列表換成兩行時只有篩選那一行黏住，鍵盤回到第一行時整條列回來', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.setViewportSize({ width: 1024, height: 600 });
    for (const path of ['/exams', '/translation', '/composition', '/writing/essay', '/writing/essay/ai', '/writing/translation/ai']) {
      await page.goto(path);
      await expect(page.locator('main h1').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => window.scrollTo(0, 1500));
      const visible = await page.locator('[data-sticky-bar]').evaluate((bar) => {
        const r = bar.getBoundingClientRect();
        return Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      });
      expect(visible, path).toBeLessThanOrEqual(64);
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-bar-h'))), path).toBeLessThanOrEqual(64);
    }
    // /writing/essay/ai：Shift+Tab 從難度切換回到來源分頁，整條列回到 top: 0，分頁連結在畫面裡。
    const radio = page.locator('[data-sticky-bar]').getByRole('radio').first();
    await radio.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(radio).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('href', /\/writing\//);
    await expect(focused).toBeInViewport();
  });

  test('1920 寬：放寬的列表頁，頁尾和頁首、沒放寬的說明區塊同一條左緣', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page, { me: signedInMe({ ai_status: 'approved' }) });
    await page.setViewportSize({ width: 1920, height: 960 });
    for (const path of ['/', '/practice', '/translation', '/composition', '/writing', '/exams', '/mock']) {
      await page.goto(path);
      const header = page.locator('main header').first();
      await expect(header).toBeVisible();
      const [headerBox, footerBox] = await Promise.all([header.boundingBox(), page.getByRole('navigation', { name: '網站資訊' }).boundingBox()]);
      expect(Math.round(footerBox?.x ?? 0), path).toBe(Math.round(headerBox?.x ?? -1));
    }
    // /translation：InfoSection 維持 944px，但靠左對齊放寬的欄。
    await page.goto('/translation');
    const info = page.getByRole('region', { name: '學測怎麼考' });
    const [infoBox, headerBox] = await Promise.all([info.boundingBox(), page.locator('main header').first().boundingBox()]);
    expect(Math.round(infoBox?.width ?? 0)).toBe(944);
    expect(Math.round(infoBox?.x ?? 0)).toBe(Math.round(headerBox?.x ?? -1));
  });

  test('/translation：sticky 列的篩選有看得到的「歷屆試題」標籤（legend 寫清楚範圍）；改了篩選，歷屆試題區捲進畫面、焦點留在篩選上', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/translation');
    const bar = page.locator('[data-sticky-bar]');
    await expect(bar.getByText('歷屆試題', { exact: true }).last()).toBeVisible();
    const group = bar.getByRole('group', { name: '歷屆試題的考試' });
    await expect(group).toBeVisible();
    await group.locator('label').filter({ hasText: /^學測/ }).click();
    await expect(page).toHaveURL(/kind=gsat/);
    const heading = page.getByRole('heading', { level: 2, name: '歷屆試題' });
    await expect(heading).toBeInViewport();
    const [barBox, headingBox] = await Promise.all([bar.boundingBox(), heading.boundingBox()]);
    expect((headingBox?.y ?? 0) >= (barBox?.y ?? 0) + (barBox?.height ?? 0) - 1).toBe(true);
    await expect(group.getByRole('radio', { name: /^學測/ })).toBeFocused();
  });

  test('/mock 列式卡片（1366）：「級分對照 115 學年度」不拆開', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/mock');
    const card = page.getByRole('region', { name: '卷別' }).getByRole('article').first();
    const phrase = card.getByText(/^級分對照 \d+ 學年度$/);
    await expect(phrase).toBeVisible();
    // 一行（text-sm 的行高 20px）：沒有斷成「級／分對照」。
    expect((await phrase.boundingBox())?.height).toBeLessThanOrEqual(24);
  });

  test('desktop-lg（1024）：側邊欄收合時 main 943–945px 也到 ws（58.5rem），首頁是儀表板', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-lg', '只在 1024 寬');
    await fakeBackend(page);
    await page.addInitScript(() => window.localStorage.setItem('gsat-ui:v1:sidebar', 'collapsed'));
    await page.goto('/');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    const mainWidth = await page.locator('main').evaluate((el) => el.clientWidth - 64);
    expect(mainWidth).toBeLessThan(960);
    await expect(page.getByRole('complementary', { name: '我的學習' })).toBeVisible();
  });
});

test.describe('審查修正：鍵盤、焦點與高對比', () => {
  test('1100×640：焦點在 /practice 矩陣與首頁卡片上按 [，換樹之後焦點回到同一個連結（不掉到 body），[ 照常作用', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.setViewportSize({ width: 1100, height: 640 });
    await page.goto('/practice');
    const cell = page.getByRole('link', { name: /^綜合測驗・進階練習：/ });
    await cell.focus();
    await page.keyboard.press('[');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(page.getByRole('complementary', { name: '難度與題目說明' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^綜合測驗・進階練習：/ })).toBeFocused();
    await page.keyboard.press('[');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
    await expect(page.getByRole('link', { name: /^綜合測驗・進階練習：/ })).toBeFocused();

    await page.goto('/');
    // 首頁的卡片（li 裡；學習進度的空白狀態另有一個同網址的按鈕）。
    const card = page.locator('main li a[href="/practice"]');
    await card.focus();
    await page.keyboard.press('[');
    // 儀表板是按需載入的：等它出來之後焦點回到「全部功能」裡同一個連結（網址與名稱相同）。
    await expect(page.getByRole('complementary', { name: '我的學習' })).toBeVisible();
    await expect(page.locator('main li a[href="/practice"]')).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });

  test('說明的程式載入失敗（網站剛更新）：按 ? 頁面內容還在，只顯示請重新整理的對話框', async ({ page }) => {
    await fakeBackend(page);
    await page.route(/\/assets\/ShortcutHelp-[^/]+\.js$/, (route) => route.abort());
    await page.goto('/exams');
    await expect(page.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeVisible();
    await page.locator('body').press('?');
    const dialog = page.getByRole('dialog', { name: '鍵盤快捷鍵' });
    await expect(dialog).toContainText('說明暫時載入不了');
    await expect(page.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeVisible();
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible();
  });

  test('說明開著時視窗縮到 < lg、再放大回桌機：對話框不會自己跳出來', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/exams');
    await page.locator('body').press('?');
    const dialog = page.getByRole('dialog', { name: '鍵盤快捷鍵' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 900, height: 640 });
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1366, height: 640 });
    await page.waitForTimeout(300);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('/exams：雙擊選字不換頁（第一下 click 不立刻觸發列連結）；單擊列上沒有連結的地方照常進入考卷', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/exams');
    const table = page.getByRole('table', { name: '歷屆試題' });
    const cell = table.locator('tbody tr').filter({ has: page.getByRole('link', { name: /^115 學測/ }) }).locator('td').nth(3);
    await cell.dblclick();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/exams$/);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await cell.click();
    await expect(page).toHaveURL(/\/exams\/gsat-115$/);
  });

  test('非美式鍵盤：在 [ 的位置按 ü、在 / 的位置按 Shift+-，不會收合側邊欄、打開說明', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/exams');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ü', code: 'BracketLeft', bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '_', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'expanded');
    expect(await page.evaluate(() => window.localStorage.getItem('gsat-ui:v1:sidebar'))).toBeNull();
    await expect(page.getByRole('dialog', { name: '鍵盤快捷鍵' })).toHaveCount(0);
  });

  test('提示泡泡：用鍵盤按收合鈕之後換成「展開側邊欄（[）」、跟著按鈕移到左邊；焦點在主要內容時 Esc 也收得起來；滑鼠可以移到泡泡上', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/exams');
    const toggle = page.getByRole('button', { name: '收合側邊欄' });
    await toggle.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const tip = page.getByTestId('sidebar-tooltip');
    await expect(tip).toHaveText('收合側邊欄（[）');
    await page.keyboard.press('Enter');
    const expandButton = page.getByRole('button', { name: '展開側邊欄' });
    await expect(expandButton).toBeFocused();
    await expect(tip).toHaveText('展開側邊欄（[）');
    const [tipBox, buttonBox] = await Promise.all([tip.boundingBox(), expandButton.boundingBox()]);
    expect(tipBox?.x ?? 0).toBeGreaterThan((buttonBox?.x ?? 0) + (buttonBox?.width ?? 0));
    expect(tipBox?.x ?? 999).toBeLessThan(120);

    // 焦點在主要內容的連結，滑鼠停在側邊欄的圖示上：Esc 收起。
    await page.getByRole('table', { name: '歷屆試題' }).getByRole('link').first().focus();
    const examsIcon = sidebar(page).getByRole('link', { name: '歷屆試題' });
    await examsIcon.hover();
    await expect(tip).toHaveText('歷屆試題');
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);

    // 滑鼠從圖示移到泡泡上：泡泡不消失（WCAG 1.4.13）。
    await page.mouse.move(0, 300);
    await examsIcon.hover();
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    if (!box) throw new Error('量不到泡泡');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await expect(tip).toHaveText('歷屆試題');
  });

  test('高對比（forced-colors）：側邊欄目前頁的色條和其他項不同（展開與收合）；設定頁的圖示有底線', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/exams');
    const border = (name: string) => sidebar(page).getByRole('link', { name }).evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(await border('歷屆試題')).not.toBe(await border('模擬考'));
    await page.keyboard.press('[');
    await expect(sidebar(page)).toHaveAttribute('data-sidebar', 'collapsed');
    expect(await border('歷屆試題')).not.toBe(await border('模擬考'));

    await page.goto('/settings');
    const tool = (name: string) => sidebar(page).getByRole('link', { name }).evaluate((el) => getComputedStyle(el).borderBottomWidth);
    expect(await tool('設定')).toBe('2px');
    expect(await tool('關於')).toBe('0px');
  });

  test('高對比（forced-colors）：sticky 篩選列裡選中的膠囊（考試、難度）和沒選中的看得出差別，字也看得到', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.emulateMedia({ forcedColors: 'active' });
    // /exams 是 ExamList 的 pillCls；/translation、/writing/essay 是 KindFilter；/writing/essay/ai 是 BankListPage 的精簡難度切換。
    for (const [path, checked, other] of [
      ['/exams', /^全部/, /^學測/],
      ['/translation', /^全部/, /^學測/],
      ['/writing/essay', /^全部/, /^指考/],
      ['/writing/essay/ai', /^穩定基礎/, /^進階練習/],
    ] as const) {
      await page.goto(path);
      const label = (name: RegExp) => page.locator('[data-sticky-bar] label').filter({ hasText: name });
      await expect(label(checked).getByRole('radio'), path).toBeChecked();
      const bg = (name: RegExp) => label(name).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await bg(checked), path).not.toBe(await bg(other));
      // 沒選中的一定看得到（量法本身的對照組）；選中的修正前是白字壓在白色的 backplate 上，0 個像素。
      expect(await inkPixels(page, label(other)), `${path} 沒選中的`).toBeGreaterThan(20);
      expect(await inkPixels(page, label(checked)), `${path} 選中的`).toBeGreaterThan(20);
    }
  });

  test('篩選膠囊的焦點框離開膠囊 2px（選中的實心膠囊上也看得到）', async ({ page }) => {
    onlyDesktopUi();
    await fakeBackend(page);
    await page.goto('/exams');
    const radio = page.locator('[data-sticky-bar]').getByRole('radio', { name: /^全部/ });
    await radio.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(radio).toBeFocused();
    const label = page.locator('[data-sticky-bar] label').filter({ hasText: /^全部/ });
    expect(await label.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineOffset])).toEqual(['solid', '2px']);
  });
});
