/**
 * 桌機的防誤觸與語言標記（docs/design/desktop-polish.md §5.1 PR 1 的驗收；desktop-ui project，1366×640）：
 *   1. 歷屆交卷後「清除作答，重新開始」先確認、焦點在「取消」，按 Enter 不清除；
 *   2. 歷屆與題庫練習的交卷確認列：焦點在「繼續作答」，連按兩次 Enter 不會交卷；未作答題號點了回到那一題；
 *   3. 模擬考還有 50 題以上沒答時，交卷對話框的「確定交卷」「繼續作答」都在視窗內，焦點在「繼續作答」；
 *   4. 作文字數不足時按送出：沒有 POST、出現確認列、焦點在「再改一下」；沒有提醒時直接送出；
 *   5. 模擬考作答中點側邊欄的「首頁」先問；「留下來作答」網址不變，「離開」才換頁；練習模式（不限時）不問；
 *   6. 選文、選項標 lang="en"；側邊欄的每個清單都有名稱。
 * 手機上的對應行為（只有交卷確認的焦點與交卷後清除的確認一起改，其他不變）在 mobile-guard.spec.ts。
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, fakeBackend, ok, signedInMe } from './support/backend';

const ATTEMPT_KEY = 'gsat-exam-attempt:v1:gsat-115';

async function storedAttempt(page: Page): Promise<{ submittedAt: string | null } | null> {
  return page.evaluate((key) => {
    const text = window.localStorage.getItem(key);
    return text ? (JSON.parse(text) as { submittedAt: string | null }) : null;
  }, ATTEMPT_KEY);
}

/** 歷屆 115 學測、考試模式開始作答，第 1 題選 (B)。 */
async function startExamMode(page: Page) {
  await page.goto('/exams/gsat-115');
  await page.locator('label').filter({ hasText: '考試模式' }).click();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await expect(page.getByText(/已答 1／53/)).toBeVisible();
}

/** 元素整個在視窗內。 */
async function expectInViewport(page: Page, locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, '找不到元素的位置').not.toBeNull();
  if (!box || !viewport) return;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
}

test.describe('交卷與清除', () => {
  test('歷屆交卷後「清除作答，重新開始」：卡片底部右側的紅字按鈕，先確認、焦點在「取消」，按 Enter 不清除；「確定清除」才清除', async ({ page }) => {
    const errors = collectErrors(page);
    await fakeBackend(page);
    await startExamMode(page);
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    await page.getByRole('button', { name: '確定交卷' }).click();
    const result = page.getByRole('region', { name: '交卷結果' });
    await expect(result).toBeVisible();

    const restart = result.getByRole('button', { name: '清除作答，重新開始' });
    // 桌機：紅字（danger-ghost）、靠卡片右側（和其他動作分開）。
    const look = await restart.evaluate((el) => {
      const card = el.closest('section') as HTMLElement;
      const bad = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim();
      const probe = document.createElement('span');
      probe.style.color = bad;
      document.body.appendChild(probe);
      const badRgb = getComputedStyle(probe).color;
      probe.remove();
      // 卡片內容區的右緣＝外框右緣－框線－內距。
      const inset = parseFloat(getComputedStyle(card).paddingRight) + parseFloat(getComputedStyle(card).borderRightWidth);
      return { color: getComputedStyle(el).color, badRgb, gap: card.getBoundingClientRect().right - inset - el.getBoundingClientRect().right };
    });
    expect(look.color).toBe(look.badRgb);
    expect(Math.abs(look.gap)).toBeLessThanOrEqual(1);

    await restart.click();
    const confirm = result.getByRole('group', { name: '確定要清除這份考卷的作答與成績嗎？清除後無法復原。' });
    await expect(confirm.getByRole('button', { name: '取消' })).toBeFocused();
    // 連按兩次 Enter：第一次「取消」、焦點回到按鈕，第二次只是再打開確認，都不會清除。
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    await expect(restart).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(confirm.getByRole('button', { name: '取消' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    expect((await storedAttempt(page))?.submittedAt).not.toBeNull();

    await restart.click();
    await confirm.getByRole('button', { name: '確定清除' }).click();
    await expect(page.getByRole('button', { name: '開始作答' })).toBeVisible();
    expect(await storedAttempt(page)).toBeNull();
    expect(errors).toEqual([]);
  });

  test('歷屆：按「交卷」焦點在「繼續作答」，連按兩次 Enter 不會交卷；確認列寫出剩餘時間、列出未作答題號，點了回到那一題', async ({ page }) => {
    const errors = collectErrors(page);
    await fakeBackend(page);
    await startExamMode(page);
    const submit = page.getByRole('button', { name: '交卷', exact: true });
    await submit.focus();
    await page.keyboard.press('Enter');
    const confirm = page.getByRole('group', { name: '確認交卷' });
    await expect(confirm.getByRole('button', { name: '繼續作答' })).toBeFocused();
    await expect(confirm).toContainText(/還有 52 題沒有作答；剩餘時間 1:\d\d:\d\d。交卷後就不能再修改答案。/);
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    await expect(submit).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: '交卷結果' })).toHaveCount(0);
    expect((await storedAttempt(page))?.submittedAt).toBeNull();

    // 未作答題號：詞彙題第 2–10 題列成按鈕；閱讀測驗（12 題）先收成一行。
    await submit.click();
    const list = confirm.getByRole('region', { name: '未作答（點題號回去作答）' });
    await expect(list.getByRole('button', { name: '回到第 1 題' })).toHaveCount(0);
    await expect(list).toContainText('第 35–46 題（12 題）');
    await list.getByRole('button', { name: '回到第 7 題' }).click();
    await expect(confirm).toHaveCount(0);
    const q7 = page.locator('#q-7');
    await expect(q7.getByRole('radio').first()).toBeFocused();
    // 平滑捲動：等捲完（toBeInViewport 會重試）。
    await expect(q7.getByRole('radio').first()).toBeInViewport({ ratio: 1 });
    // 也沒有被 sticky 工具列蓋住：選項正中央那一點就是這個選項（或包著它的 label）。
    await expect
      .poll(() =>
        q7.getByRole('radio').first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && (hit === el || el.contains(hit) || !!hit.closest('label')?.contains(el));
        }),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test('題庫練習：按「交卷」焦點在「繼續作答」；確認列列出未作答題號（不限時，沒有剩餘時間）', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/practice/reading/basic');
    await page.locator('[id^="q-"]').filter({ has: page.getByRole('radio') }).first().getByRole('radio').first().check();
    await expect(page.getByText(/已答 1／\d+/)).toBeVisible();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    const confirm = page.getByRole('group', { name: '確認交卷' });
    await expect(confirm.getByRole('button', { name: '繼續作答' })).toBeFocused();
    await expect(confirm).not.toContainText('剩餘時間');
    await expect(confirm.getByRole('region', { name: '未作答（點題號回去作答）' }).getByRole('button')).not.toHaveCount(0);
  });

  test('模擬考還有很多題沒答：交卷對話框的「確定交卷」「繼續作答」都在視窗內，焦點在「繼續作答」，右上角可以關閉', async ({ page }) => {
    const errors = collectErrors(page);
    await fakeBackend(page);
    await page.goto('/mock/gsat-115');
    await page.getByRole('button', { name: '不預估，直接開始' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
    await page.locator('#q-1').getByRole('button', { name: '標記第 1 題，稍後檢查' }).click();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/還有 52 題沒有作答、標記 1 題；剩餘時間 1:\d\d:\d\d。/);
    const stay = dialog.getByRole('button', { name: '繼續作答' });
    await expect(stay).toBeFocused();
    await expectInViewport(page, stay);
    await expectInViewport(page, dialog.getByRole('button', { name: '確定交卷' }));
    await dialog.getByRole('button', { name: '關閉' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: '交卷', exact: true })).toBeFocused();
    expect(errors).toEqual([]);
  });
});

test.describe('送出 AI 批改前的確認', () => {
  const APPROVED = signedInMe({ ai_status: 'approved' });
  const words = (n: number) => Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 'Students' : 'learn')).join(' ');

  async function essayBackend(page: Page) {
    const backend = await fakeBackend(page, { me: APPROVED });
    backend.on('POST /api/submissions', () =>
      ok(
        {
          id: 'sub-e9',
          kind: 'essay',
          group_id: 'gsat-115.s8g1@1',
          input_mode: 'typed',
          status: 'draft',
          final_score: null,
          final_band: null,
          created_at: 1,
          updated_at: 1,
          graded_at: null,
          body: { text: '' },
          self_assess: null,
          word_count: null,
          paragraphs: null,
          op_id: null,
          ocr: null,
          photos: [],
          grading: null,
          failure: null,
          custom_title: null,
          custom_prompt: null,
        },
        201,
      ),
    );
    backend.on('POST /api/ai/essay-grade', () => ok({ op_id: 'op-e9', submission_id: 'sub-e9', status: 'queued' }, 202));
    return backend;
  }

  test('108 個單詞：按送出沒有 POST、出現確認列（點數與提醒）、焦點在「再改一下」；再改一下回到作答框', async ({ page }) => {
    const backend = await essayBackend(page);
    await page.goto('/writing/essay/gsat-115');
    const editor = page.getByRole('textbox', { name: /你的作文/ });
    await editor.fill(`${words(54)}\n\n${words(54)}`);
    await expect(page.getByTestId('quota-summary')).toBeVisible();
    await page.getByRole('button', { name: /^送出 AI 批改（\d+ 點）$/ }).click();
    const confirm = page.getByRole('group', { name: /^送出 AI 批改會用 7 點，今天剩 20 點。確定要送出嗎？$/ });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('listitem')).toHaveText(['只有 108 個單詞，少於 120（少於 100 會扣 1 分）']);
    await expect(confirm.getByRole('button', { name: '再改一下' })).toBeFocused();
    expect(backend.callsTo('POST', '/api/submissions')).toHaveLength(0);
    await page.keyboard.press('Enter');
    await expect(confirm).toHaveCount(0);
    await expect(editor).toBeFocused();
    expect(backend.callsTo('POST', '/api/submissions')).toHaveLength(0);
  });

  test('130 個單詞、2 段：按送出直接 POST（沒有提醒時行為不變）', async ({ page }) => {
    const backend = await essayBackend(page);
    await page.goto('/writing/essay/gsat-115');
    await page.getByRole('textbox', { name: /你的作文/ }).fill(`${words(65)}\n\n${words(65)}`);
    await expect(page.getByTestId('quota-summary')).toBeVisible();
    await page.getByRole('button', { name: /^送出 AI 批改（\d+ 點）$/ }).click();
    await expect(page).toHaveURL(/\/writing\/submissions\/sub-e9$/);
    expect(backend.callsTo('POST', '/api/submissions')).toHaveLength(1);
    await expect(page.getByRole('group', { name: /送出 AI 批改會用/ })).toHaveCount(0);
  });
});

test.describe('計時中離開確認', () => {
  test('模擬考作答中點側邊欄「首頁」：先問；「留下來作答」網址不變、焦點回到連結；「離開」才換頁', async ({ page }) => {
    const errors = collectErrors(page);
    await fakeBackend(page);
    await page.goto('/mock/gsat-115');
    await page.getByRole('button', { name: '不預估，直接開始' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    const home = page.locator('aside[data-sidebar]').getByRole('link', { name: '首頁', exact: true });
    await home.click();
    const dialog = page.getByRole('dialog', { name: '要離開作答頁嗎？' });
    await expect(dialog).toContainText(/計時還在進行（剩 1:\d\d:\d\d），作答已存在這台裝置。離開之後時間照樣倒數/);
    await expect(dialog.getByRole('button', { name: '留下來作答' })).toBeFocused();
    await dialog.getByRole('button', { name: '留下來作答' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/mock\/gsat-115$/);
    await expect(home).toBeFocused();
    // Esc 也是留下來。
    await home.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/mock\/gsat-115$/);
    await home.click();
    await dialog.getByRole('button', { name: '離開' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: '學測英文中心' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('歷屆試題：考試模式作答中要問（計時會暫停）；練習模式（不限時）直接換頁', async ({ page }) => {
    await fakeBackend(page);
    await startExamMode(page);
    const sidebar = page.locator('aside[data-sidebar]');
    await sidebar.getByRole('link', { name: '模擬考', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '要離開作答頁嗎？' });
    await expect(dialog).toContainText('離開這一頁計時會暫停，回來可以接著寫。');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/exams\/gsat-115$/);

    // 換一份、練習模式：不問。
    await page.goto('/exams/gsat-114');
    await page.getByRole('button', { name: '開始作答' }).click();
    await page.locator('#q-1').getByRole('radio').first().check();
    await sidebar.getByRole('link', { name: '模擬考', exact: true }).click();
    await expect(page).toHaveURL(/\/mock$/);
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('語言標記與清單名稱', () => {
  test('選文、題幹、選項標 lang="en"；選文裡的空格（中文名稱）標回 zh-Hant-TW；側邊欄每個清單都有名稱', async ({ page }) => {
    await fakeBackend(page);
    await page.goto('/practice/reading/basic');
    const passage = page.getByRole('region', { name: '選文' }).first();
    await expect(passage.locator('[lang="en"]').first()).toBeVisible();
    // 區域本身（名稱「選文」）不標 en，裡面的英文文字才標。
    await expect(passage).not.toHaveAttribute('lang', 'en');
    const firstCard = page.locator('[id^="q-"]').filter({ has: page.getByRole('radio') }).first();
    await expect(firstCard.locator('legend [lang="en"]').first()).toBeVisible();
    await expect(firstCard.locator('label [lang="en"]')).not.toHaveCount(0);

    await page.goto('/exams/gsat-115');
    await page.getByRole('button', { name: '開始作答' }).click();
    const blank = page.getByRole('button', { name: '第 11 題空格，未作答' });
    await expect(blank).toHaveAttribute('lang', 'zh-Hant-TW');
    expect(await blank.evaluate((el) => el.parentElement?.closest('[lang]')?.getAttribute('lang'))).toBe('en');

    await expect(page.locator('aside[data-sidebar]').getByRole('navigation', { name: '主要導覽' })).toMatchAriaSnapshot(`
      - navigation "主要導覽":
        - list "開始"
        - list "單字"
        - list "選擇題型"
        - list "混合題與非選擇題"
        - list "實戰"
    `);
  });
});
