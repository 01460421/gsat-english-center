/**
 * 作文範文的 e2e（docs/design/model-essays.md §9.4）：建置後的產物＋真的 /data/writing/essay.json；本站仿真題用
 * tests/fixtures/bank-writing-public；後端用 tests/support/backend.ts 的假 Worker（fakeExemplars：建立 → 排隊中 → 完成；
 * 同一個網站題目完成後再建立＝共用快取命中 0 點）。三篇範文是本站為測試自己寫的短文。桌機（1280）與手機（375）各跑一次。
 *
 *   1. /writing 卡片 → 輸入題目 → 確認 8 點 → 結果（手機分頁、桌機三欄）→ 逐段對照（手機也能逐段比較三級）；列印按鈕在（不實際列印）；
 *   2. 歷屆作答頁的按鈕 → 這一題已經有共用的範文：0 點 → 直接看到結果；
 *   3. 批改結果頁 → 範文：帶 ?sub=，對照表多「你的作文」欄、預設打開比你高一級的那一篇；
 *   4. 本站仿真題沒對照時先看到鎖的說明；按產生送出之後作答頁才唯讀；
 *   5. 試用帳號剩 3 點：產生按鈕停用並說明，草稿不會被鎖住；
 *   6. 自訂作答頁的題目交接到範文頁；網站題目比對的二選一；
 *   7. 開關關著：入口不存在、範文頁唯讀（之前的範文可以看與刪除）；
 *   8. 刪除；手機 375／320 px 沒有水平捲動；畫面沒有考試單位的名稱。
 * 既有的 writing.spec.ts、writing-bank.spec.ts、writing-custom.spec.ts 在開關關著的預設下一行都不用改。
 * 環境變數 EXEMPLARS_SHOTS 設成資料夾時，另外把確認畫面、逐篇與逐段對照的結果截圖存進去（桌機與手機各一組）。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { EssayGradingResult, SubmissionDetail } from '@gsat/shared';
import {
  FEATURES_EXEMPLARS_ON,
  FEATURES_ON,
  QUOTA,
  collectErrors,
  expectNoHorizontalOverflow,
  fakeBackend,
  fakeExemplars,
  ok,
  signedInMe,
} from './support/backend';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK_FIXTURE_DIR = path.join(HERE, 'fixtures', 'bank-writing-public');
const APPROVED = signedInMe({ ai_status: 'approved' });
const ESSAY_GROUP = 'gsat-115.s8g1@1';
const BANK_GROUP = 'ai.cp.0e1f2a@1';
const CUSTOM_TEXT = '請寫一篇英文作文，談談你對學生養寵物的看法。第一段寫你的經驗，第二段寫你的建議。';

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env['EXEMPLARS_SHOTS'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${name}.png`), fullPage: true });
}

/** 假的 /data/writing/bank/*（同 writing-bank.spec.ts）。 */
async function mockBank(page: Page) {
  await page.route('**/data/writing/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    const file = path.join(BANK_FIXTURE_DIR, rel);
    if (!rel.startsWith('writing/bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
}

async function expectNoExamBoardName(page: Page) {
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/大考中心|CEEC/i);
}

/** 三篇範文的檢視：手機是分頁、桌機 1280（main ≥ 58.5rem）是三欄。 */
async function expectEssayView(page: Page, testInfo: TestInfo) {
  await expect(page.getByRole('heading', { level: 2, name: '三篇範文' })).toBeVisible();
  if (isMobile(testInfo)) {
    const tabs = page.getByRole('tablist', { name: '三篇範文' });
    await expect(tabs.getByRole('tab')).toHaveText(['基礎版', '穩健版', '頂標版']);
  } else {
    await expect(page.getByRole('tablist', { name: '三篇範文' })).toHaveCount(0);
    for (const name of ['基礎版・目標 12–13 分（可）', '穩健版・目標 15–16 分（優）', '頂標版・目標 19–20 分（特優）']) {
      await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
    }
  }
}

test('輸入題目 → 確認 8 點 → 結果（分頁或三欄）→ 逐段對照', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_EXEMPLARS_ON, me: APPROVED });
  fakeExemplars(backend);
  await page.goto('/writing');
  await page.getByRole('link', { name: /^作文範文/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '作文範文' })).toBeVisible();
  await expect(page.getByText(/你正在和 AI 互動：範文由 AI 產生/)).toBeVisible();

  await page.getByLabel('作文題目', { exact: true }).fill(CUSTOM_TEXT);
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByText('產生三個層級的範文會用 8 點（今天還剩 20 點）；失敗會全額退還。')).toBeVisible();
  await shot(page, testInfo, 'confirm');
  await page.getByRole('button', { name: '產生三個層級的範文' }).click();

  await expect(page).toHaveURL(/\/writing\/essay\/exemplars\/[0-9a-f-]+$/);
  await expectEssayView(page, testInfo);
  await shot(page, testInfo, 'essays');
  expect(backend.callsTo('POST', '/api/exemplars')[0]?.json).toMatchObject({ source: 'custom' });
  await expect(page.getByRole('button', { name: '列印／存成 PDF' })).toBeVisible();
  await expect(page.getByRole('table', { name: '三版對照（本站計算）' })).toBeVisible();

  // 常見的錯：文字標籤，不只靠顏色。
  await expect(page.getByText('✗ 錯誤示範').first()).toBeVisible();
  await expect(page.getByText('✓ 正確').first()).toBeVisible();

  // 逐段對照：手機也能逐段比較三級。
  await page.getByText('逐段對照', { exact: true }).click();
  await expect(page).toHaveURL(/view=paragraph/);
  const p1 = page.getByRole('region', { name: '第 1 段' });
  await expect(p1.getByRole('heading', { level: 4 })).toHaveText([/^基礎版・\d+ 字$/, /^穩健版・\d+ 字$/, /^頂標版・\d+ 字$/]);
  await shot(page, testInfo, 'paragraphs');
  await expectNoExamBoardName(page);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('歷屆作答頁的按鈕 → 已經有共用的範文：0 點 → 直接看到結果', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_EXEMPLARS_ON, me: APPROVED });
  fakeExemplars(backend, { cachedGroups: [ESSAY_GROUP] });
  await page.goto('/writing/essay/gsat-115');
  await expect(page.getByText('建議先自己寫一次再看範文，比較看得出差在哪裡。')).toBeVisible();
  await page.getByRole('link', { name: '看這題的三個層級範文：115 學測 英文作文' }).click();
  await expect(page.getByText('這一題已經有共用的範文：0 點。')).toBeVisible();
  await page.getByRole('button', { name: '產生三個層級的範文' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeVisible();
  await expect(page.getByText('0 點（共用）')).toBeVisible();
  await expectEssayView(page, testInfo);
  expect(errors).toEqual([]);
});

const ESSAY_TEXT =
  'Many people in Taiwan keep pets. I have a dog and I walk him every day after school.\n\nPets need time and money. Students should think before they get one.';

function gradedSubmission(): SubmissionDetail {
  const grading: EssayGradingResult = {
    kind: 'essay',
    final_score: 12.5,
    max_score: 20,
    band: 'fair',
    third_rater_used: false,
    off_topic: false,
    criteria: {
      content: { score: 3, explanation_zh: '內容切題但細節不足。' },
      organization: { score: 3, explanation_zh: '分兩段。' },
      grammar: { score: 3.5, explanation_zh: '句型簡單。' },
      vocabulary: { score: 3, explanation_zh: '用字重複。' },
    },
    raters: [
      { role: 'primary', scores: { content: 3, organization: 3, grammar: 4, vocabulary: 3 }, off_topic: false, total: 13, comment_zh: '評語。' },
      { role: 'second', scores: { content: 3, organization: 3, grammar: 3, vocabulary: 3 }, off_topic: false, total: 12, comment_zh: '評語。' },
    ],
    deductions: [],
    word_count: 30,
    paragraphs: 2,
    top_improvements: ['加一個具體經驗。'],
    paragraph_advice: [],
    errors: [],
    rewrite: null,
    safety_flag: null,
  };
  return {
    id: 'sub-e2e',
    kind: 'essay',
    group_id: ESSAY_GROUP,
    status: 'graded',
    input_mode: 'typed',
    final_score: 12.5,
    final_band: 'fair',
    created_at: 1_791_500_000,
    updated_at: 1_791_500_100,
    graded_at: 1_791_500_100,
    body: { text: ESSAY_TEXT, plan: null },
    self_assess: null,
    word_count: 30,
    paragraphs: 2,
    op_id: null,
    ocr: null,
    photos: [],
    grading,
    failure: null,
  };
}

test('批改結果頁 → 範文：你的作文欄、預設打開比你高一級的那一篇', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_EXEMPLARS_ON, me: APPROVED });
  fakeExemplars(backend);
  backend.on('GET /api/submissions/sub-e2e', () => ok(gradedSubmission()));
  backend.on('GET /api/ai/ops/:id', () => ok({ id: 'op', task: 'essay_grade', status: 'settled', points: 7 }));
  await page.goto('/writing/submissions/sub-e2e');
  const entry = page.getByRole('link', { name: /^看這題的三個層級範文：/ });
  await expect(entry).toHaveAttribute('href', `/writing/essay/exemplars?group=${encodeURIComponent(ESSAY_GROUP)}&sub=sub-e2e`);
  await entry.click();
  await page.getByRole('button', { name: '產生三個層級的範文' }).click();
  await expect(page).toHaveURL(/sub=sub-e2e/);
  const table = page.getByRole('table', { name: '三版對照（本站計算）' });
  await expect(table.getByRole('columnheader', { name: '你的作文' })).toBeVisible();
  await expect(table.getByText('你的分數 12.5／20')).toBeVisible();
  if (isMobile(testInfo)) await expect(page.getByRole('tab', { name: '穩健版' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('本站仿真題沒對照：先看到鎖的說明；試用帳號剩 3 點：產生按鈕停用，草稿不會被鎖住', async ({ page }) => {
  const errors = collectErrors(page);
  await mockBank(page);
  const trial = { ...QUOTA, tier: 'trial' as const, points: { day_used: 7, day_limit: 10, month_used: 7, month_limit: 300 } };
  const backend = await fakeBackend(page, { features: FEATURES_EXEMPLARS_ON, me: APPROVED, quota: trial });
  fakeExemplars(backend);
  await page.goto(`/writing/essay/exemplars?group=${encodeURIComponent(BANK_GROUP)}`);
  await expect(page.getByText(/本站仿真題的設計是先寫完、對照評分重點與兩篇範文之後再看更多範文/)).toBeVisible();
  await expect(page.getByRole('link', { name: '去作答頁寫這一題' })).toHaveAttribute('href', '/writing/essay/ai/0e1f2a');
  await page.getByRole('button', { name: '我已經寫過了，直接看（這台裝置上這一題的作答會鎖定）' }).click();
  await expect(page.getByText('今天剩 3 點，產生範文要 8 點。明天再來，或選已經有共用範文（0 點）的題目。')).toBeVisible();
  await expect(page.getByRole('button', { name: '產生三個層級的範文' })).toBeDisabled();
  await expect(page.getByText(/按「產生三個層級的範文」之後/)).toHaveCount(0);
  // 拿不到範文就不鎖：作答頁照樣可以寫（鎖在真的送出產生範文時才寫，§12.5）。
  await page.goto('/writing/essay/ai/0e1f2a');
  await expect(page.getByLabel(/你的作文/)).toBeEditable();
  expect(errors).toEqual([]);
});

test('本站仿真題：「我已經寫過了」→ 字數目標與鎖的提醒 → 產生之後作答頁唯讀', async ({ page }) => {
  const errors = collectErrors(page);
  await mockBank(page);
  const backend = await fakeBackend(page, { features: FEATURES_EXEMPLARS_ON, me: APPROVED });
  fakeExemplars(backend);
  await page.goto(`/writing/essay/exemplars?group=${encodeURIComponent(BANK_GROUP)}`);
  await page.getByRole('button', { name: '我已經寫過了，直接看（這台裝置上這一題的作答會鎖定）' }).click();
  await expect(page.getByText(/^三篇的字數目標：基礎版 \d+–\d+、穩健版 \d+–\d+、頂標版 \d+–\d+ 字。$/)).toBeVisible();
  await expect(page.getByText('按「產生三個層級的範文」之後，這台裝置上這一題的作答會鎖定（之後只能看、不能改）。')).toBeVisible();
  await page.getByRole('button', { name: '產生三個層級的範文' }).click();
  await expect(page).toHaveURL(/\/writing\/essay\/exemplars\/[^/?]+/);
  await page.goto('/writing/essay/ai/0e1f2a');
  await expect(page.getByLabel(/你的作文/)).toHaveAttribute('readonly', '');
  expect(errors).toEqual([]);
});

test('自訂作答頁交接題目；和網站題目相同時二選一', async ({ page }) => {
  const errors = collectErrors(page, [/\/api\/exemplars$/]);
  const backend = await fakeBackend(page, { features: FEATURES_EXEMPLARS_ON, me: APPROVED });
  fakeExemplars(backend, { siteMatch: { includes: '養寵物', group_id: ESSAY_GROUP, title: '115 學測 英文作文' } });
  await page.goto('/writing/essay/custom');
  await page.getByLabel('作文題目', { exact: true }).fill(CUSTOM_TEXT);
  await page.getByRole('link', { name: '看這題的三個層級範文：自訂題目' }).click();
  await expect(page.getByRole('heading', { name: '確認題目與點數' })).toBeVisible();
  await expect(page).toHaveURL(/\/writing\/essay\/exemplars$/);
  await page.getByRole('button', { name: '產生三個層級的範文' }).click();
  const dialog = page.getByRole('dialog', { name: '這一題和網站上的題目相同' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '改用網站題目' }).click();
  await expect(page).toHaveURL(new RegExp(`group=${encodeURIComponent(ESSAY_GROUP)}`));
  await expect(page.getByText('產生三個層級的範文會用 8 點（今天還剩 20 點）；失敗會全額退還。')).toBeVisible();
  expect(errors).toEqual([]);
});

test('開關關著：入口不存在，範文頁唯讀（之前的範文可以看與刪除）', async ({ page }) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_ON, me: APPROVED });
  const ex = fakeExemplars(backend, { cachedGroups: [ESSAY_GROUP] });
  // 之前產生過的一組（開關打開時建立的）。
  backend.features = FEATURES_EXEMPLARS_ON;
  await page.goto('/writing');
  await page.evaluate(async (group) => {
    await fetch('/api/exemplars', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'site', group_id: group }) });
  }, ESSAY_GROUP);
  backend.features = FEATURES_ON;

  await page.goto('/writing');
  await expect(page.getByRole('link', { name: /^自訂題目/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^作文範文/ })).toHaveCount(0);
  await page.goto('/writing/essay/gsat-115');
  await expect(page.getByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^看這題的三個層級範文/ })).toHaveCount(0);

  await page.goto('/writing/essay/exemplars');
  await expect(page.getByText('作文範文暫停使用中；之前的範文仍然可以看與刪除。')).toBeVisible();
  await expect(page.getByRole('tab', { name: '輸入題目' })).toHaveCount(0);
  const history = page.getByRole('region', { name: '我的範文' });
  await history.getByRole('link', { name: /115 學測 英文作文/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: '三篇範文' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新產生（8 點）' })).toHaveCount(0);
  await page.getByRole('button', { name: '刪除這一組' }).click();
  await page.getByRole('button', { name: '確定刪除' }).click();
  await expect(page).toHaveURL(/\/writing\/essay\/exemplars$/);
  await expect(page.getByText('還沒有範文。選一個題目，產生第一組吧。')).toBeVisible();
  expect(ex.sets.size).toBe(0);
  expect(errors).toEqual([]);
});
