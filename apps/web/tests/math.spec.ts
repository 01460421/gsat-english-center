/**
 * 學測數學（/math，docs/design/math.md P2）的端對端測試，桌機（desktop）與手機（mobile）各跑一次：
 *   1. 入口：數A／數B 分頁、卷子卡片、課綱標記；
 *   2. 練習模式：作答、看答案與詳解（詳解檔用 page.route 假造一題，檢查 Markdown＋KaTeX）；非選擇題的拍照批改預告；
 *   3. 考試模式：整份作答（單選、多選、仿答題卷的選填格，選填用滑鼠點與鍵盤輸入兩種方式）→ 交卷 → 成績頁的分數與逐題結果；
 *   4. 版面：手機 360 px 與 320 px 不水平捲動；KaTeX 只在卷子頁載入（入口頁沒有 .katex，也沒有下載 KaTeX 的 chunk）。
 *   5. 舊課綱（100–110）：分頁、選填格用題本列號（⑭⑮）、整份作答交卷得滿分、詳解準備中。
 *
 * 用的是建置產生的真實資料（public/data/math/），答案直接讀 data/exams/parsed-math/gsat-matha-115.json。
 * 設環境變數 MATH_SHOTS_DIR 時另外存截圖（手動檢查用，不進版控）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PAPER_ID = 'gsat-matha-115';

interface RawItem {
  label: string;
  type: 'single' | 'multi' | 'fill' | 'constructed';
  answer: string | string[] | null;
  points: number;
  fill?: { cells: string[]; answer_cells: Record<string, string> };
}
interface RawPaper {
  title: string;
  sections: { groups: { items: RawItem[] }[] }[];
}

const paper = JSON.parse(readFileSync(path.join(ROOT, 'data', 'exams', 'parsed-math', `${PAPER_ID}.json`), 'utf8')) as RawPaper;
const items = paper.sections.flatMap((s) => s.groups.flatMap((g) => g.items));

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

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `頁面寬 ${scrollWidth}px 超出視窗 ${clientWidth}px`).toBeLessThanOrEqual(clientWidth);
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env['MATH_SHOTS_DIR'];
  if (!dir) return;
  await page.screenshot({ path: path.join(dir, `${name}-${testInfo.project.name}.png`), fullPage: true });
}

function card(page: Page, label: string): Locator {
  return page.locator(`#mq-${label}`);
}

/** 選填：每一格在它那一列點正確的值（負號、正負號的無障礙名稱是「負號」「正負號」）。 */
function cellName(v: string): string {
  return v === '-' ? '負號' : v === '±' ? '正負號' : v;
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

test('入口：數A／數B 分頁與卷子列表；不載入 KaTeX', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const katexRequests: string[] = [];
  page.on('request', (req) => {
    if (/katex/i.test(req.url())) katexRequests.push(req.url());
  });
  await page.goto('/math');
  await expect(page.getByRole('heading', { level: 1, name: '學測數學' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /數學A/ })).toBeChecked();
  await expect(page.locator('main a[href^="/math/gsat-matha-"]')).toHaveCount(5);
  await expect(page.getByRole('link', { name: /115 學年度/ }).getByText('108課綱')).toBeVisible();
  await page.getByText(/^數學B/).click();
  await expect(page).toHaveURL(/\?subject=b$/);
  await expect(page.locator('main a[href^="/math/gsat-mathb-"]')).toHaveCount(5);
  await page.waitForLoadState('networkidle');
  expect(katexRequests).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await shot(page, testInfo, 'landing');
  expect(errors).toEqual([]);
});

test('練習模式：看答案與詳解（Markdown＋公式），非選擇題的拍照批改預告', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.route(`**/data/math/solutions/${PAPER_ID}.json`, (route) =>
    route.fulfill({
      json: {
        version: 'e2e',
        id: PAPER_ID,
        count: 1,
        items: { '1': { no: 1, unit: 'probability', difficulty: '穩定基礎', solution_md: '**期望值**：$E=180\\cdot\\frac{1}{9}+90\\cdot\\frac{1}{9}$\n\n$$E=30$$', answer_display: '(2)', checked: true } },
      },
    }),
  );
  await page.goto(`/math/${PAPER_ID}`);
  await expect(page.getByRole('heading', { level: 1, name: paper.title })).toBeVisible();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(card(page, '1').locator('.katex').first()).toBeVisible();

  const q1 = card(page, '1');
  await q1.getByRole('radio', { name: /^\(2\)/ }).check();
  await q1.getByRole('button', { name: '看答案與詳解' }).click();
  await expect(q1.getByText('答對', { exact: true })).toBeVisible();
  await expect(q1.getByText('期望值', { exact: true })).toBeVisible();
  await expect(q1.locator('.katex-display')).toBeVisible();
  await expect(q1.getByText('AI 撰寫・已獨立驗算')).toBeVisible();

  const q2 = card(page, '2');
  await q2.getByRole('button', { name: '看答案與詳解' }).click();
  await expect(q2.getByText('未作答', { exact: true })).toBeVisible();
  await expect(q2.getByText('詳解準備中')).toBeVisible();

  const q19 = card(page, '19');
  await expect(q19.getByText('拍照 AI 批改即將推出')).toBeVisible();
  await expect(q19.getByText(/請在紙上作答/)).toBeVisible();

  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page);
  }
  await shot(page, testInfo, 'practice');
  expect(errors).toEqual([]);
});

test('考試模式：整份作答、交卷、成績頁的分數與逐題結果', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto(`/math/${PAPER_ID}`);
  await page.getByRole('radio', { name: /考試模式/ }).check();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/剩餘時間/);
  await expect(page.getByRole('button', { name: '看答案與詳解' })).toHaveCount(0);

  let expected = 0;
  let autoMax = 0;
  for (const item of items) {
    const c = card(page, item.label);
    if (item.type === 'constructed') continue;
    autoMax += item.points;
    if (item.type === 'single') {
      await c.getByRole('radio', { name: new RegExp(`^\\(${String(item.answer)}\\)`) }).check();
      expected += item.points;
    } else if (item.type === 'multi') {
      const answer = item.answer as string[];
      // 第 7 題多勾一個錯的選項（錯 1 個得 3/5），其餘全對。
      const chosen = item.label === '7' ? [...answer, ['1', '2', '5'].find((o) => !answer.includes(o)) ?? '5'] : answer;
      for (const o of chosen) await c.getByRole('checkbox', { name: new RegExp(`^\\(${o}\\)`) }).check();
      expected += item.label === '7' ? (item.points * 3) / 5 : item.points;
    } else if (item.fill) {
      const cells = item.fill.cells;
      if (item.label === '13') {
        // 鍵盤：焦點放進第一列，直接打數字（自動跳到下一列）。
        await c.getByRole('group', { name: new RegExp(`${cells[0]} 格`) }).getByRole('radio').first().focus();
        for (const cell of cells) await page.keyboard.press(item.fill.answer_cells[cell] ?? '');
      } else {
        for (const cell of cells) {
          await c.getByRole('group', { name: new RegExp(`${cell} 格`) }).getByRole('radio', { name: cellName(item.fill.answer_cells[cell] ?? ''), exact: true }).check();
        }
      }
      expected += item.points;
    }
  }
  await expect(card(page, '13').getByRole('group', { name: /13-3 格，目前 0/ })).toBeVisible();
  await expect(page.getByText(`已答 ${items.filter((i) => i.type !== 'constructed').length}／${items.filter((i) => i.type !== 'constructed').length}`)).toBeVisible();
  await shot(page, testInfo, 'exam-answered');

  await page.getByRole('button', { name: '交卷' }).click();
  const confirm = page.getByRole('group', { name: '確認交卷' });
  await expect(confirm.getByRole('button', { name: '繼續作答' })).toBeFocused();
  await confirm.getByRole('button', { name: '確定交卷' }).click();

  await expect(page).toHaveURL(new RegExp(`/math/${PAPER_ID}/results$`));
  const summary = page.locator('section', { has: page.getByRole('heading', { name: '交卷結果' }) });
  await expect(summary.getByText('自動批改（選擇＋選填）').locator('..')).toContainText(`${expected}／${autoMax}`);
  const table = page.getByRole('table', { name: '逐題結果' });
  await expect(table.getByRole('row')).toHaveCount(items.length + 1);
  await expect(table.getByRole('row').nth(7)).toContainText('部分');
  await expect(card(page, '7').getByText('部分得分')).toBeVisible();
  // 111–115 有本站詳解（data/exams/math-solutions/），交卷後直接顯示，並有全國答對率。
  await expect(card(page, '1').getByText('本站詳解', { exact: true })).toBeVisible();
  await expect(card(page, '1').getByText('解題關鍵').first()).toBeVisible();
  await expect(card(page, '1').getByText(/全國答對率 \d+%（官方統計）/)).toBeVisible();

  // 非選擇題自評，合計含自評。
  await card(page, '19').getByRole('combobox', { name: '自評分數' }).selectOption('4');
  await expect(summary.getByText(/合計（含自評）/)).toContainText(`${expected + 4}／100`);

  // 回到列表：卡片顯示已交卷與分數。
  await page.getByRole('link', { name: '回到卷子列表' }).click();
  await expect(page.getByRole('link', { name: /115 學年度/ }).getByText(`已交卷・${expected}／${autoMax}`)).toBeVisible();
  await page.goBack();

  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 740 });
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page);
  }
  await shot(page, testInfo, 'results');
  expect(errors).toEqual([]);
});

const OLD_ID = 'gsat-math-110';
const oldPaper = JSON.parse(readFileSync(path.join(ROOT, 'data', 'exams', 'parsed-math', `${OLD_ID}.json`), 'utf8')) as RawPaper & {
  sections: { groups: { items: (RawItem & { fill?: { official_cells?: string[] } })[] }[] }[];
};
const oldItems = oldPaper.sections.flatMap((s) => s.groups.flatMap((g) => g.items));

test('舊課綱：分頁、選填格標題本列號、整份作答交卷滿分、詳解準備中', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('/math?subject=old');
  await expect(page.getByRole('radio', { name: /舊課綱/ })).toBeChecked();
  await expect(page.locator('main a[href^="/math/gsat-math-1"]')).toHaveCount(11);
  await expect(page.getByRole('link', { name: /110 學年度/ }).getByText('詳解準備中')).toBeVisible();
  await expect(page.getByRole('link', { name: /110 學年度/ })).not.toContainText('非選擇題');

  await page.getByRole('link', { name: /110 學年度/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: oldPaper.title })).toBeVisible();
  await page.getByRole('radio', { name: /考試模式/ }).check();
  await page.getByRole('button', { name: '開始作答' }).click();

  // 第 A 題（列號 14、15）：格名是題本的圈號。
  const a = card(page, 'A');
  await expect(a.locator('[data-fill-row]').first()).toContainText('⑭');
  await expect(a.locator('[data-fill-row]').nth(1)).toContainText('⑮');
  await expect(a.getByRole('group', { name: /第 A 題第 14 列/ })).toBeVisible();

  for (const item of oldItems) {
    const c = card(page, item.label);
    if (item.type === 'single') await c.getByRole('radio', { name: new RegExp(`^\\(${String(item.answer)}\\)`) }).check();
    else if (item.type === 'multi') for (const o of item.answer as string[]) await c.getByRole('checkbox', { name: new RegExp(`^\\(${o}\\)`) }).check();
    else if (item.fill) {
      const rows = item.fill.official_cells ?? [];
      for (const [i, cell] of item.fill.cells.entries()) {
        await c
          .getByRole('group', { name: new RegExp(`第 ${rows[i] ?? ''} 列`) })
          .getByRole('radio', { name: cellName(item.fill.answer_cells[cell] ?? ''), exact: true })
          .check();
      }
    }
  }
  await shot(page, testInfo, 'old-answered');
  await page.getByRole('button', { name: '交卷' }).click();
  await page.getByRole('group', { name: '確認交卷' }).getByRole('button', { name: '確定交卷' }).click();
  await expect(page).toHaveURL(new RegExp(`/math/${OLD_ID}/results$`));
  const summary = page.locator('section', { has: page.getByRole('heading', { name: '交卷結果' }) });
  await expect(summary.getByText('自動批改（選擇＋選填）').locator('..')).toContainText('100／100');
  await expect(summary.getByText('非選擇題（自評）')).toHaveCount(0);
  await expect(card(page, 'A').getByText('詳解準備中')).toBeVisible();
  await expect(card(page, '1').getByText(/全國答對率 \d+%（官方統計）/)).toBeVisible();

  await page.waitForLoadState('networkidle');
  await expectNoHorizontalOverflow(page);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 667 });
    await expectNoHorizontalOverflow(page);
  }
  await shot(page, testInfo, 'old-results');
  expect(errors).toEqual([]);
});
