/**
 * 題庫練習（/practice、/practice/:section/:tier）在建置後的產物上跑一次，桌機與手機（playwright.config.ts 的兩個 project）都要過。
 *
 * /data/bank/* 一律用 page.route 提供假資料：題庫還在陸續出題，建置產生的 bank/index.json 可能是空的，
 * 測試不能跟著題庫的進度變。假資料是 build-data 的範例輸出（tests/fixtures/bank-public，scripts/lib/bank-data.test.ts
 * 確認它和建置真正產生的一致），所以這裡測到的形狀就是正式資料的形狀。
 *
 *   1. 選單：題型 × 難度、每格幾組、沒有題組的格子顯示「出題中」；
 *   2. 文意選填：作答、逐層看提示、重新整理後接續、交卷計分、四段式解析卡、證據句加亮、全文中譯、排除法表、再一組；
 *   3. 詞彙題：卡片內的提示（用鍵盤打開最後一層時焦點不會掉到 body）、答錯的正解字收進單字錯題本
 *      （正解是變化形 postponed、ingredients 時收原形；錯題本頁看得到「題庫練習」）；
 *   4. 篇章結構：點空格 → 點選項放句子（不靠拖放）、交卷後的排除法表；
 *   5. 深色模式：證據句與 AI 標示用主題色，不是瀏覽器預設的黃底黑字；
 *   6. 還沒有任何題組：選單與作答頁都正常顯示「出題中」，沒有 console error；
 *   7. localStorage 不能用（無痕模式、封鎖網站資料）：照樣可以作答、交卷，畫面說明存不了進度。
 * 每個測試都檢查沒有 console error、未捕捉的例外與水平捲動（手機另外縮到 320px 再檢查一次）。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bank-public');
const EMPTY_INDEX = { version: 'empty', count: 0, groups: [] };

/** 假的 /data/bank/*：empty 時索引是空的（題庫還沒有通過驗證的題組），題組檔一律 404。 */
async function mockBank(page: Page, { empty = false }: { empty?: boolean } = {}) {
  await page.route('**/data/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    if (empty) {
      return rel === 'bank/index.json' ? route.fulfill({ json: EMPTY_INDEX }) : route.fulfill({ status: 404, body: 'not found' });
    }
    const file = path.join(FIXTURE_DIR, rel);
    if (!rel.startsWith('bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
}

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
  await expect(page.getByRole('link', { name: /組，已做/ })).toHaveCount(4);
  await expect(page.getByRole('group', { name: /：出題中$/ })).toHaveCount(8);
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
  await expect(page.getByRole('group', { name: /：出題中$/ })).toHaveCount(12);
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
