/**
 * 題庫練習（/practice、/practice/:section/:tier）在建置後的產物上跑一次，桌機與手機（playwright.config.ts 的兩個 project）都要過。
 *
 * /data/bank/* 一律用 page.route 提供假資料：題庫還在陸續出題，建置產生的 bank/index.json 可能是空的，
 * 測試不能跟著題庫的進度變。假資料是 build-data 的範例輸出（tests/fixtures/bank-public，scripts/lib/bank-data.test.ts
 * 確認它和建置真正產生的一致），所以這裡測到的形狀就是正式資料的形狀。
 *
 *   1. 選單：6 種題型 × 3 種難度、每格幾組、沒有題組的格子顯示「出題中」；
 *   2. 文意選填：作答、逐層看提示、重新整理後接續、交卷計分、四段式解析卡、證據句加亮、全文中譯、排除法表、再一組；
 *   3. 詞彙題：卡片內的提示（用鍵盤打開最後一層時焦點不會掉到 body）、答錯的正解字收進單字錯題本
 *      （正解是變化形 postponed、ingredients 時收原形；錯題本頁看得到「題庫練習」）；
 *   4. 篇章結構：點空格 → 點選項放句子（不靠拖放）、交卷後的排除法表；
 *   5. 深色模式：證據句與 AI 標示用主題色，不是瀏覽器預設的黃底黑字；
 *   6. 還沒有任何題組：選單與作答頁都正常顯示「出題中」，沒有 console error；
 *   7. localStorage 不能用（無痕模式、封鎖網站資料）：照樣可以作答、交卷，畫面說明存不了進度；
 *   8. 閱讀（圖表）：SVG 折線圖、圖例、讀數、資料來源、資料表、參考資料；作答、交卷、解析卡、證據引用的資料點；
 *   9. 混合題：多文本 A／B、摘要填空（只能一個字的即時提示）、多選、簡答；自動判分、每個選項的判斷、可接受答案；
 *  10. 深色模式的圖表：數列用深色主題的顏色、軸與數值是淺色字；
 *  11. 長表頭的表格（手機卡片）與長類別名稱的長條圖、折線圖（用 patch 改寫閱讀題組）。
 * 混合題另外測：簡答加了引號照樣算對、多文本切到 B 再定位 A 的證據句會自動切分頁。
 * 每個測試都檢查沒有 console error、未捕捉的例外與水平捲動（手機另外縮到 320px 再檢查一次）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bank-public');
const EMPTY_INDEX = { version: 'empty', count: 0, groups: [] };

type Json = Record<string, unknown>;

/**
 * 假的 /data/bank/*：empty 時索引是空的（題庫還沒有通過驗證的題組），題組檔一律 404。
 * patch：改寫某個檔案的內容（rel 是相對 /data/ 的路徑），用來測正式資料還沒出現的形狀（長表頭、長類別名稱）。
 */
async function mockBank(page: Page, { empty = false, patch }: { empty?: boolean; patch?: (rel: string, json: Json) => Json } = {}) {
  await page.route('**/data/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    if (empty) {
      return rel === 'bank/index.json' ? route.fulfill({ json: EMPTY_INDEX }) : route.fulfill({ status: 404, body: 'not found' });
    }
    const file = path.join(FIXTURE_DIR, rel);
    if (!rel.startsWith('bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    if (patch) return route.fulfill({ json: patch(rel, JSON.parse(readFileSync(file, 'utf8')) as Json) });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
}

async function mockBackend(page: Page) {
  await page.route(/\/(api|auth)\//, (route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'e2e' } } }));
  // 每一頁都會問 /api/features 決定要不要顯示登入與 AI；這裡回「全部關閉」，練習頁照常運作。
  // 後註冊的 route 先比對，所以這一條會蓋過上面的 404。
  await page.route('**/api/features', (route) =>
    route.fulfill({ json: { auth: false, ai: false, ocr: false, aiPaused: false } }),
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * 水平捲動。比對的寬度取 clientWidth 和設定的視窗寬度中較小的：手機模擬（isMobile）遇到比視窗寬的內容時，
 * 瀏覽器會把版面視窗（layout viewport）放寬來容納它，clientWidth 跟著變大，只比 clientWidth 會漏掉溢出
 * （排除法表的 sr-only 文字曾讓 375px 的頁面變成 383px，而 scrollWidth 和 clientWidth 都是 383）。
 */
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

/** 目前寬度檢查一次；手機再縮到 320px（WCAG 1.4.10 的重排基準）檢查一次，然後恢復原本的大小。 */
async function expectFitsWidth(page: Page, testInfo: TestInfo) {
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name !== 'mobile') return;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: size?.height ?? 667 });
  await expectNoHorizontalOverflow(page);
  if (size) await page.setViewportSize(size);
}

async function submit(page: Page) {
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  const result = page.getByRole('region', { name: '交卷結果' });
  await expect(result).toBeVisible();
  return result;
}

/** 文意選填、篇章結構：點空格 → 在空格下方的面板點選項。 */
async function fillBlank(page: Page, label: string, option: RegExp) {
  await page.getByRole('button', { name: `第 ${label} 題空格，未作答` }).click();
  await page.getByRole('group', { name: `第 ${label} 題的選項` }).getByRole('button', { name: option }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^第 ${label} 題空格，已填`) })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('選單：題型 × 難度，每格顯示幾組，沒有題組的顯示「出題中」', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/practice');
  await expect(page.getByRole('heading', { level: 1, name: '題庫練習' })).toBeVisible();
  await expect(page).toHaveTitle(/題庫練習/);
  await expect(page.getByRole('heading', { name: '三種難度給誰' })).toBeVisible();
  await expect(page.getByText('頂標到 15 級分的學生')).toBeVisible();

  const wb = page.getByRole('link', { name: '文意選填・進階練習：1 組，已做 0 組' });
  await expect(wb).toBeVisible();
  await expect(page.getByRole('link', { name: /組，已做/ })).toHaveCount(6);
  await expect(page.getByRole('group', { name: /：出題中$/ })).toHaveCount(12);
  await expect(page.getByRole('link', { name: '閱讀測驗・穩定基礎：1 組，已做 0 組' })).toBeVisible();
  await expect(page.getByRole('link', { name: '混合題・穩定基礎：1 組，已做 0 組' })).toBeVisible();
  await expect(page.getByRole('group', { name: '混合題・超越頂標：出題中' })).toContainText('出題中');
  await expect(page.getByRole('group', { name: '篇章結構・穩定基礎：出題中' })).toContainText('出題中');
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);

  await wb.click();
  await expect(page).toHaveURL(/\/practice\/word-bank\/advanced$/);
  await expect(page.getByRole('heading', { level: 1, name: '文意選填・進階練習' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('文意選填：作答、提示、接續、交卷、解析卡、證據句、全文中譯、排除法表、再一組', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/practice/word-bank/advanced');
  await expect(page.getByRole('heading', { level: 1, name: '文意選填・進階練習' })).toBeVisible();
  await expect(page.getByText('AI 出題・已通過自動驗證・人工審核中')).toBeVisible();
  await expect(page.getByText('本文由 AI 撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤')).toBeVisible();
  // 交卷前沒有全文中譯，也沒有「看答案」。
  await expect(page.getByText('全文中譯')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '看答案' })).toHaveCount(0);

  await fillBlank(page, '1', /^\(E\) colorful/);
  await fillBlank(page, '2', /^\(A\) practical/);

  // 提示：逐層打開。
  await page.getByText('需要提示嗎？').click();
  const hints = page.getByRole('group', { name: /第 1 題提示/ });
  await hints.getByRole('button', { name: '看第 1 層提示' }).click();
  await expect(hints).toContainText('先看空格前後的字，判斷需要的詞性。');
  await expect(hints).toContainText('1／3 層');
  await expectFitsWidth(page, testInfo);

  // 重新整理：接著做同一組，答案與提示都還在。
  await page.reload();
  await expect(page.getByText('已接續上次在這一格做的題組。')).toBeVisible();
  await expect(page.getByRole('button', { name: /^第 1 題空格，已填 \(E\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^第 2 題空格，已填 \(A\)/ })).toBeVisible();

  const result = await submit(page);
  await expect(result).toContainText('1／10 題');
  await expect(result).toContainText('1／10 分');
  await expect(result).toContainText('用了提示：第 1 題');

  await expect(page.getByTestId('explanation-card')).toHaveCount(10);
  const card2 = page.getByRole('region', { name: /第 2 題解析/ });
  await expect(card2).toContainText('你選的為什麼錯');
  await expect(card2).toContainText('practical 放進這一格語意或詞性不通。');
  await expect(card2).toContainText('provide protection from 是固定搭配');
  await expect(page.getByRole('region', { name: /第 1 題解析/ })).toContainText('作答時用了 1 層提示');

  // 證據句在選文中加亮；「在文中標出」捲過去並加深。
  expect(await page.locator('mark[data-evidence-label]').count()).toBeGreaterThanOrEqual(10);
  await card2.getByRole('button', { name: '在文中標出證據句' }).click();
  const evidence = page.locator('mark[data-evidence-label="2"]');
  await expect(evidence).toContainText('from the scorching sun');
  await expect(evidence).toHaveAttribute('data-active', 'true');
  await expect(evidence).toBeInViewport();
  // 焦點也移到證據句（鍵盤、螢幕閱讀器使用者被帶到選文裡）。
  await expect(evidence.first()).toBeFocused();
  // 證據句的每一段都沒有左右內距：被空格或另一題的證據切開時，標點前不會多出空隙。
  const paddings = await page.locator('mark[data-evidence-label]').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).paddingLeft + ' ' + getComputedStyle(el).paddingRight),
  );
  expect(new Set(paddings)).toEqual(new Set(['0px 0px']));

  // 全文中譯展開才看得到。
  const translation = page.getByText(/今天雨傘隨處可見/);
  await expect(translation).toBeHidden();
  await page.getByText('全文中譯').click();
  await expect(translation).toBeVisible();

  // 排除法表：正解、也放得進去、你的答案。
  const table = page.getByRole('table', { name: /每一格（列）放得進去的選項/ });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row', { name: /^5/ })).toContainText('I：正解');
  await expect(table.getByRole('row', { name: /^5/ })).toContainText('A：也放得進去');
  await expect(table.getByRole('row', { name: /^2/ })).toContainText('A：放不進去，你的答案');
  await expectFitsWidth(page, testInfo);

  // 再一組：這一格只有一組，重做同一組，作答清空。
  await expect(result).toContainText('這一格目前只有這一組');
  await result.getByRole('button', { name: '再一組' }).click();
  await expect(page.getByRole('button', { name: '第 1 題空格，未作答' })).toBeVisible();
  await expect(page.getByRole('region', { name: '交卷結果' })).toHaveCount(0);
  await expect(page.getByText(/這一格的 1 組你都做過了/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('詞彙題：卡片內看提示；答錯的正解字收進單字錯題本', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/practice/vocabulary/basic');
  await expect(page.getByRole('heading', { level: 1, name: '詞彙題・穩定基礎' })).toBeVisible();
  await expect(page.getByText('本組題目由 AI 撰寫；AI 撰寫的內容可能有誤')).toBeVisible();

  const q1 = page.locator('#q-1');
  await q1.getByRole('button', { name: '看第 1 層提示' }).click();
  await expect(q1).toContainText('空格要一個形容詞，描述 Tom 的感覺。');
  // 用鍵盤打開第 2、3 層：前一層按完焦點留在按鈕上；最後一層打開後按鈕消失，焦點移到剛打開的那一層，不會掉到 body。
  const hintButton = q1.getByRole('button', { name: /^看第 \d 層提示$/ });
  await hintButton.focus();
  await page.keyboard.press('Enter');
  await expect(q1).toContainText('看句子後半：他做了什麼？');
  await expect(q1.getByRole('button', { name: '看第 3 層提示' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(q1).toContainText('刪去 C、D：和身體感覺無關。');
  await expect(q1.getByRole('button', { name: /層提示$/ })).toHaveCount(0);
  await expect(q1.getByRole('listitem').filter({ hasText: '刪去 C、D：和身體感覺無關。' })).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('LI');

  await q1.getByRole('radio', { name: /\(B\) honest/ }).check();
  await page.locator('#q-2').getByRole('radio', { name: /\(C\) quiet/ }).check();
  // 第 4、5 題答錯：正解是變化形 postponed、ingredients（真實題庫的詞彙題常這樣）。
  await page.locator('#q-4').getByRole('radio', { name: /\(B\) celebrated/ }).check();
  await page.locator('#q-5').getByRole('radio', { name: /\(A\) customers/ }).check();
  await expectFitsWidth(page, testInfo);

  const result = await submit(page);
  await expect(result).toContainText('1／5 題');
  // 正解字用真的單字索引（/data/vocab/index.json）對到條目後收進錯題本；變化形收原形，畫面附上題目裡的字。
  await expect(result.getByText('thirsty、postpone（postponed）、ingredient（ingredients）')).toBeVisible();
  await expect(result).not.toContainText('沒能收進單字錯題本');
  await expect(result).toContainText('證據句列在每一題的解析卡裡。');
  const stored = await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('gsat-vocab-mistakes') ?? '{}') as { items?: object }).items ?? {}));
  expect(stored.sort()).toEqual(['ingredient|n.|4', 'postpone|v./(n.)|3', 'thirsty|adj.|2']);
  const card1 = q1.getByRole('region', { name: /第 1 題解析/ });
  await expect(card1).toContainText('你選的 (B) honest');
  await expect(card1).toContainText('找出空格前後的因果關係');
  await expect(page.getByText(/沒有大考中心公布的答對率統計/)).toHaveCount(0);
  await expectFitsWidth(page, testInfo);

  await result.getByRole('link', { name: '單字錯題本' }).click();
  await expect(page).toHaveURL(/\/words\?tab=mistakes/);
  await expect(page.getByText(/thirsty/).first()).toBeVisible();
  await expect(page.getByText(/postpone/).first()).toBeVisible();
  await expect(page.getByText(/ingredient/).first()).toBeVisible();
  await expect(page.getByText(/（題庫練習）/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('篇章結構：點空格再點句子作答，交卷後有排除法表與每題解析', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/practice/structure/top');
  await expect(page.getByRole('heading', { level: 1, name: '篇章結構・超越頂標' })).toBeVisible();
  await fillBlank(page, '1', /^\(B\) By watching the North Star/);
  await fillBlank(page, '2', /^\(C\) Many sailors/);
  await expectFitsWidth(page, testInfo);

  const result = await submit(page);
  await expect(result).toContainText('1／4 題');
  await expect(page.getByTestId('explanation-card')).toHaveCount(4);
  await expect(page.getByRole('heading', { level: 2, name: '排除法表' })).toBeVisible();
  await expect(page.getByText(/多出來的那一句 \(C\) 在每一格都放不進去。/)).toBeVisible();
  await expect(page.getByRole('table', { name: /每一格（列）放得進去的選項/ }).getByRole('row', { name: /^2/ })).toContainText(
    'C：放不進去，你的答案',
  );
  await expectFitsWidth(page, testInfo);
  expect(errors).toEqual([]);
});

test('深色模式：AI 標示、證據句與解析卡用深色主題的顏色', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockBank(page);
  await page.goto('/practice/cloze/advanced');
  await expect(page.getByRole('heading', { level: 1, name: '綜合測驗・進階練習' })).toBeVisible();
  await submit(page);
  await expect(page.getByTestId('explanation-card')).toHaveCount(3);

  const colors = await page.evaluate(() => {
    const style = (el: Element | null) => (el ? getComputedStyle(el) : null);
    const mark = style(document.querySelector('mark[data-evidence-label]'));
    const card = style(document.querySelector('[data-testid="explanation-card"]'));
    return {
      body: getComputedStyle(document.body).backgroundColor,
      markBg: mark?.backgroundColor ?? null,
      markFg: mark?.color ?? null,
      cardFg: card?.color ?? null,
    };
  });
  /** 'rgb(r, g, b)' 或 'color(srgb …)' 的亮度（0–255），抓不到數字時回傳 null。 */
  const luminance = (css: string | null) => {
    const nums = (css ?? '').match(/[\d.]+/g)?.map(Number) ?? [];
    if (nums.length < 3) return null;
    const [r = 0, g = 0, b = 0] = css?.startsWith('color(') ? nums.map((n) => n * 255) : nums;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect(luminance(colors.body), `背景 ${colors.body}`).toBeLessThan(60);
  // 證據句：淺色字、底色不是瀏覽器預設的亮黃色。
  expect(luminance(colors.markFg), `證據句字色 ${String(colors.markFg)}`).toBeGreaterThan(180);
  expect(colors.markBg).not.toBe('rgb(255, 255, 0)');
  expect(luminance(colors.cardFg), `解析卡字色 ${String(colors.cardFg)}`).toBeGreaterThan(180);
  expect(errors).toEqual([]);
});

test('還沒有任何題組：選單與作答頁都顯示「出題中」，沒有 console error', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page, { empty: true });
  await page.goto('/practice');
  await expect(page.getByRole('heading', { level: 1, name: '題庫練習' })).toBeVisible();
  await expect(page.getByText(/AI 題庫正在出題與驗證中/)).toBeVisible();
  await expect(page.getByRole('group', { name: /：出題中$/ })).toHaveCount(18);
  await expect(page.getByRole('link', { name: /組，已做/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);

  await page.goto('/practice/word-bank/basic');
  await expect(page.getByRole('heading', { level: 1, name: '文意選填・穩定基礎' })).toBeVisible();
  await expect(page.getByText('出題中', { exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: '回到題庫練習' }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);
  expect(errors).toEqual([]);
});

test('localStorage 不能用：照樣可以作答與交卷，畫面說明進度存不了', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    const deny = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
  });
  await mockBank(page);
  await page.goto('/practice/word-bank/advanced');
  await expect(page.getByRole('heading', { level: 1, name: '文意選填・進階練習' })).toBeVisible();
  await fillBlank(page, '1', /^\(E\) colorful/);
  await expect(page.getByText(/這個瀏覽器無法儲存作答進度/)).toBeVisible();
  const result = await submit(page);
  await expect(result).toContainText('1／10 題');
  await expect(page.getByTestId('explanation-card')).toHaveCount(10);
  expect(errors).toEqual([]);
});

test('閱讀（圖表）：折線圖、資料表、參考資料；作答、交卷、解析卡與證據引用的資料點', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/practice/reading/basic');
  await expect(page.getByRole('heading', { level: 1, name: '閱讀測驗・穩定基礎' })).toBeVisible();
  // 英文主題不顯示。
  await expect(page.getByText(/falling child death rates/)).toHaveCount(0);

  const chart = page.getByRole('img', { name: /^折線圖：Children who die before age 5/ });
  await expect(chart).toBeVisible();
  await expect(page.getByRole('list', { name: '圖例' })).toContainText('Sub-Saharan Africa');
  await expect(page.getByText(/^縱軸：/)).toContainText('per 1,000 live births');
  const source = page.getByTestId('chart-source');
  await expect(source).toContainText('資料來源：World Bank');
  await expect(source).toContainText('CC BY 4.0');
  await expect(source.getByRole('link', { name: /World Bank/ })).toHaveAttribute('href', 'https://data.worldbank.org/indicator/SH.DYN.MORT');
  // 圖的寬度不超過選文欄（手機也是），整頁不能水平捲動。
  const box = await chart.boundingBox();
  const frame = await page.getByTestId('chart-scroll').boundingBox();
  expect(box && frame && box.width <= frame.width + 1).toBe(true);

  // 點圖看數值。
  // 最右邊那一帶是 2020（右側留給最後一個點的數值標籤，點在標籤左邊一點）。
  await chart.click({ position: { x: (box?.width ?? 300) - 70, y: 80 } });
  await expect(page.getByTestId('chart-readout')).toContainText('2020');
  await expect(page.getByTestId('chart-readout')).toContainText('Sub-Saharan Africa 75.9');

  // 資料表展開才看得到。
  const table = page.getByTestId('chart-data-table').getByRole('table');
  await expect(table).toBeHidden();
  await page.getByTestId('chart-data-table').getByText('資料表').click();
  await expect(table).toBeVisible();
  await expect(table.getByRole('row', { name: /^1990/ })).toContainText('178.5');

  // 參考資料與聲明。
  await expect(page.getByText('本文由 AI 參考下列資料撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤，請以參考資料為準')).toBeVisible();
  // 三筆參考資料＋資料集來源（World Bank）的授權條款連結。
  await expect(page.getByTestId('references').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('references').getByRole('link')).toHaveCount(4);
  await expect(page.getByTestId('references').getByTestId('license-link')).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);

  await page.getByRole('radio', { name: /How the death rate of young children has changed since 1990/ }).check();
  await page.getByRole('radio', { name: /Sub-Saharan Africa\./ }).check();
  await page.getByRole('radio', { name: /Its rate in 1990 was the highest in the chart\./ }).check();
  await page.getByRole('radio', { name: /Possible to achieve soon\./ }).check();
  const result = await submit(page);
  await expect(result).toContainText('3／4 題');
  await expect(result).toContainText('6／8 分');
  await expect(page.getByTestId('explanation-card')).toHaveCount(4);
  const card3 = page.getByRole('region', { name: /第 3 題解析/ });
  await expect(card3).toContainText('你選的為什麼錯');
  await expect(card3).toContainText('誘答類型：細節錯置');
  // 證據句在選文裡加底線；引用圖表的證據在圖上加粗框、資料表那一列加底色。
  expect(await page.locator('mark[data-evidence-label]').count()).toBeGreaterThan(0);
  await expect(page.getByText(/粗框標出的是解析引用的數據/)).toBeVisible();
  await expect(table.getByRole('row', { name: /^2020/ })).toContainText('（解析引用）');
  await expectFitsWidth(page, testInfo);
  expect(errors).toEqual([]);
});

test('混合題：多文本、摘要填空、多選、簡答；自動判分、每個選項的判斷、可接受答案與字形變化', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page);
  await page.goto('/practice/mixed/basic');
  await expect(page.getByRole('heading', { level: 1, name: '混合題・穩定基礎' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'A' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'B' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^A\s+Mia: Clean the Fridge Night/ })).toBeVisible();
  // 切到 B 只看 Kevin 的短文。
  await page.getByRole('tab', { name: 'B' }).click();
  await expect(page.getByRole('region', { name: /^B\s+Kevin: Taste First/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /^A\s+Mia/ })).toHaveCount(0);
  await expect(page.getByTestId('references').getByRole('link')).toHaveCount(2);

  const blank1 = page.getByRole('textbox', { name: '第 1 題作答' });
  await blank1.fill('turned into');
  await expect(page.getByText(/第 1 題：每格只能填一個單詞/)).toBeVisible();
  await blank1.fill('Turned');
  await expect(page.getByText(/每格只能填一個單詞/)).toHaveCount(0);
  await page.getByRole('textbox', { name: '第 2 題作答' }).fill('filling');
  await page.getByRole('checkbox', { name: /They keep track of the food they throw away/ }).check();
  await page.getByRole('checkbox', { name: /They now spend less money on food/ }).check();
  await page.getByRole('checkbox', { name: /They now cook or serve smaller amounts of food/ }).check();
  // 簡答照抄時加了引號：照樣算對（正規化會去掉包住答案的引號）。
  await page.getByRole('textbox', { name: '你的答案' }).fill('“weigh”');
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);

  // 重新整理：答案還在。
  await page.reload();
  await expect(page.getByRole('textbox', { name: '第 1 題作答' })).toHaveValue('Turned');
  await expect(page.getByRole('checkbox', { name: /They now spend less money on food/ })).toBeChecked();

  const result = await submit(page);
  await expect(result).toContainText('2／4 題');
  await expect(result).toContainText('7.67／10 分');
  await expect(result).toContainText('另有 2 題部分給分');
  await expect(page.getByTestId('multi-select-formula')).toContainText('本題 6 個選項，你錯了 1 個 → 4 × (6 − 2 × 1) ÷ 6 ＝ 2.67 分。');
  await expect(page.getByTestId('option-verdict-C')).toContainText('不應選，你多選了');
  await expect(page.getByTestId('option-verdict-C')).toContainText('Our list is much shorter now');
  await expect(page.getByTestId('option-verdict-D')).toContainText('應選，你選了');
  const fb1 = page.getByTestId('question-feedback').filter({ hasText: '選字正確，但字形錯誤' });
  await expect(fb1).toContainText('部分給分 1／2 分');
  await expect(fb1.getByTestId('accepted-answers')).toContainText('turns、makes');
  await expect(fb1.getByTestId('transform-note')).toContainText('turn → turns');
  await expect(page.getByTestId('explanation-card')).toHaveCount(4);
  await expectFitsWidth(page, testInfo);

  // 多文本切到 B，再按第 1 題（證據在 A）的「在文中標出證據句」：自動切到 A、捲過去並移焦點。
  await page.getByRole('tab', { name: 'B' }).click();
  await expect(page.getByRole('region', { name: /^A\s+Mia/ })).toHaveCount(0);
  const card1 = page.getByRole('region', { name: /第 1 題解析/ });
  await card1.getByRole('button', { name: '在文中標出證據句' }).click();
  await expect(page.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
  const mark1 = page.locator('mark[data-evidence-label="1"]').first();
  await expect(mark1).toContainText('Third, we turn food');
  await expect(mark1).toHaveAttribute('data-active', 'true');
  await expect(mark1).toBeFocused();
  await expect(mark1).toBeInViewport();
  // 第 3 題（多選）的證據分散在 A、B：切到「全部」。
  await page.getByRole('region', { name: /第 3 題解析/ }).getByRole('button', { name: '在文中標出證據句' }).click();
  await expect(page.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('mark[data-evidence-label="3"]').first()).toBeFocused();
  expect(errors).toEqual([]);
});

/** 長表頭的表格（手機卡片）與長類別名稱的長條圖、折線圖：正式資料還沒有這種形狀，用 patch 改寫閱讀題組。 */
function longLabelsGroup(rel: string, json: Json): Json {
  if (!rel.endsWith('ai.rd.0c1d2e@1.json')) return json;
  const group = json['group'] as Json;
  const [figure] = group['figures'] as Json[];
  const chart = (figure as Json)['chart'] as Json;
  const countries = ['Bangladesh', 'Philippines', 'Indonesia', 'Vietnam', 'Thailand'];
  const regions = [
    'Sub-Saharan Africa', 'Latin America and the Caribbean', 'East Asia and Pacific', 'South Asia', 'Europe and Central Asia',
    'Middle East and North Africa', 'North America', 'Oceania', 'Western Europe', 'Eastern Europe', 'Central America', 'Internationalization',
  ];
  const chartFigure = (type: string, categories: string[], title: string): Json => ({
    ...(figure as Json),
    label: title,
    caption: title,
    chart: {
      ...chart,
      type,
      title,
      x: { label: 'Country or region', unit: null },
      categories,
      series: [
        { name: '2000', values: categories.map((_, i) => 10 + i * 3) },
        { name: '2020', values: categories.map((_, i) => 40 - i * 2) },
      ],
    },
  });
  const table = (head: string[], rows: string[][], caption: string): Json => ({
    kind: 'table',
    label: caption,
    caption,
    description: '測試用的長表頭表格。',
    rows: [head, ...rows],
    question_no: null,
  });
  return {
    ...json,
    group: {
      ...group,
      figures: [
        chartFigure('bar', countries, 'Countries'),
        chartFigure('line', regions, 'Regions'),
        table(['Year', 'Invention', "Price in today's US dollars"], [['1817', 'Running machine', '1,200'], ['1885', 'Safety bicycle', '2,500']], 'Inventions'),
        table(['Country', 'Number of bicycles sold worldwide each year'], [['China', 'About 70 million bicycles']], 'Bicycles'),
      ],
    },
  };
}

test('長表頭的表格與長類別名稱的圖：手機卡片的內容不被擠成一兩個字一行；橫軸標籤不重疊、不被裁掉', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await mockBank(page, { patch: longLabelsGroup });
  await page.goto('/practice/reading/basic');
  await expect(page.getByRole('heading', { level: 1, name: '閱讀測驗・穩定基礎' })).toBeVisible();
  await expect(page.locator('svg[role="img"]')).toHaveCount(2);

  /** 每張圖的橫軸標籤（有 tspan 的 text）用 getBBox 量：彼此不重疊、都在 SVG 的 0..width 裡。 */
  const checkAxisLabels = async () => {
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      for (const svg of Array.from(document.querySelectorAll<SVGSVGElement>('svg[role="img"]'))) {
        const width = Number(svg.getAttribute('width'));
        const labels = Array.from(svg.querySelectorAll<SVGTextElement>('text')).filter((t) => t.querySelector('tspan'));
        const boxes = labels.map((t) => ({ text: t.textContent ?? '', box: t.getBBox() }));
        boxes.forEach(({ text, box }, i) => {
          if (text.includes('…')) out.push(`${text} 被截斷`);
          if (box.x < -0.5 || box.x + box.width > width + 0.5) out.push(`${text} 超出 SVG（${Math.round(box.x)}..${Math.round(box.x + box.width)}，寬 ${width}）`);
          const next = boxes[i + 1];
          if (next && box.x + box.width > next.box.x) out.push(`${text} 和 ${next.text} 重疊`);
        });
        if (labels.length === 0) out.push('找不到橫軸標籤');
      }
      return out;
    });
    expect(problems).toEqual([]);
  };
  await checkAxisLabels();

  if (testInfo.project.name === 'mobile') {
    /** 手機卡片：每一格內容至少 100px 寬，「Running machine」「1,200」不會被拆成一兩個字一行。 */
    const checkCards = async () => {
      const cells = await page.locator('[data-testid="table-card-fields"] dd').evaluateAll((els) =>
        els.map((el) => {
          // 行數用文字本身的行框算（dd 會被同一列較高的表頭撐高，不能用 dd 的高度）。
          const range = document.createRange();
          range.selectNodeContents(el);
          const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
          return { text: el.textContent ?? '', width: Math.round(el.getBoundingClientRect().width), lines };
        }),
      );
      expect(cells.length).toBeGreaterThan(0);
      for (const c of cells) {
        expect(c.width, `${c.text} 的寬度`).toBeGreaterThanOrEqual(100);
        expect(c.lines, `${c.text} 的行數`).toBeLessThanOrEqual(c.text === 'About 70 million bicycles' ? 2 : 1);
      }
    };
    await checkCards();
    const size = page.viewportSize();
    await page.setViewportSize({ width: 320, height: size?.height ?? 667 });
    await checkCards();
    await checkAxisLabels();
    if (size) await page.setViewportSize(size);
  }
  await page.waitForLoadState('networkidle');
  await expectFitsWidth(page, testInfo);
  expect(errors).toEqual([]);
});

test('深色模式的圖表：數列用深色主題的顏色、軸與數值是淺色字、資料表也是深色', async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockBank(page);
  await page.goto('/practice/reading/basic');
  const chart = page.getByRole('img', { name: /^折線圖/ });
  await expect(chart).toBeVisible();
  await page.getByTestId('chart-data-table').getByText('資料表').click();
  const colors = await page.evaluate(() => {
    const svg = document.querySelector('svg[role="img"][data-chart-type="line"]');
    const line = Array.from(svg?.querySelectorAll('path') ?? []).find((p) => getComputedStyle(p).fill === 'none');
    const tick = svg?.querySelector('text');
    const scroll = document.querySelector('[data-testid="chart-scroll"]');
    const cell = document.querySelector('[data-testid="chart-data-table"] td');
    return {
      line: line ? getComputedStyle(line).stroke : null,
      tick: tick ? getComputedStyle(tick).fill : null,
      surface: scroll ? getComputedStyle(scroll).backgroundColor : null,
      cell: cell ? getComputedStyle(cell).color : null,
    };
  });
  const rgb = (css: string | null) => (css ?? '').match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  const lum = (css: string | null) => {
    const [r = 0, g = 0, b = 0] = rgb(css).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string | null, b: string | null) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  // 第 1 個數列是深色主題的 --chart-1（#3987e5），不是淺色主題的 #2a78d6。
  expect(rgb(colors.line)).toEqual([57, 135, 229]);
  expect(lum(colors.surface)).toBeLessThan(0.05);
  expect(contrast(colors.tick, colors.surface), `刻度字 ${String(colors.tick)} 對背景 ${String(colors.surface)}`).toBeGreaterThan(4.5);
  expect(contrast(colors.line, colors.surface), '數列對背景至少 3:1').toBeGreaterThan(3);
  expect(lum(colors.cell)).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});
