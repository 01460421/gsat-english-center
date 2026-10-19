/**
 * 英文作文自訂題目的 e2e（docs/design/custom-essay.md §7.6）：建置後的產物，桌機與手機各跑一次；後端用 tests/support/backend.ts 的假 Worker。
 *
 *   1. 功能全關：從 /composition 的「自訂題目」區塊進來 → 填題目、寫作文、自評；只打了 /api/features；畫面沒有考試機構名稱；
 *      返回連結回到 /composition；
 *   1b. AI 開、自訂題目批改沒開（AI_CUSTOM_ESSAY 是 off：程式預設，或只關自訂題時）：已核准帳號也只能自我檢核，
 *      沒有送出按鈕、拍照區說明切回打字作答，不建立任何提交；題型頁的說明只提歷屆與本站題可以送 AI；
 *   1c. 同樣的狀態、沒登入或還沒申請：/composition 的模組說明與 /writing 的入口卡不說能送 AI；作答頁說「即將開放」，
 *      不出現登入或申請的說明（不讓學生申請、核准之後才發現不能送）；
 *   2–4、6 用 FEATURES_CUSTOM_ON（customEssay: true）測自訂題目送 AI 批改；
 *   2. AI 批改（打字）：已核准帳號，題目含一段很長、沒有空白的字串 → 「設成 2 段」→「題目設定好了」→ 寫作文 → 送出；
 *      POST 本體帶 custom_prompt、不帶 group_id → 輪詢 queued → graded → 題目與四項分數；寫作紀錄有「自訂題目 英文作文」與題目開頭；
 *      375 與 320 px 都不水平捲動；
 *   3. 驗證：「幫我寫」本機就擋下；後端回 400 custom_prompt_invalid／official_material 時在題目欄下方說明並標出位置；
 *   4. 手寫拍照：上傳 → 辨識 → 確認 → 送批改回 400 custom_prompt_invalid → 在結果頁就地修改題目（PUT）→ 再送 → 已批改；
 *   5. 入口與切換：/writing/essay 的第三格連到自訂頁，返回連結回到 /writing/essay；
 *   6. 深色模式：沒有 console error。
 * 環境變數 CUSTOM_ESSAY_SHOTS 設成資料夾時，另外把題目表單與批改結果截圖存進去（桌機與手機各一組）。
 * 既有的 writing.spec.ts、writing-bank.spec.ts 不改。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CreateSubmissionBody, CustomEssayPrompt, EssayGradingResult, FeaturesResponse, OcrResult, SubmissionDetail, SubmissionSummary } from '@gsat/shared';
import { FEATURES_CUSTOM_ON, collectErrors, expectNoHorizontalOverflow, fakeBackend, ok, signedInMe } from './support/backend';

const APPROVED = signedInMe({ ai_status: 'approved' });
const FEATURES_OFF: FeaturesResponse = { auth: false, ai: false, ocr: false, aiPaused: false };
const CUSTOM_GROUP = 'custom:essay@1';
const PATH = '/writing/essay/custom';

/** 題目（學生輸入的樣子）；URL 是一段很長、沒有空白的字串：不能撐破版面。 */
const LONG_TOKEN = `https://example.com/handout/${'abcdefghij'.repeat(28)}`;
const PROMPT_TEXT = `提示：你的學校即將舉辦「無手機日」，當天所有人都不能使用手機。請寫一篇英文作文，文分兩段，第一段說明你對這個活動的看法，第二段描述你那天會怎麼安排時間。\n講義網址：${LONG_TOKEN}`;
const FIGURE_TEXT = '一張學生把手機放進教室門口收納箱的照片。';
const ESSAY_PARAGRAPHS = [
  'No-Phone Day is a good idea for our school. Many students check their phones during every break, and some of them even use their phones in class. ' +
    'If we put our phones away for one day, we can talk to our friends face to face and pay more attention to our teachers. I believe this activity will help us notice how much time we usually waste on social media.',
  'On that day, I will arrive at school early and read a novel in the library. During lunch, I will play basketball with my classmates instead of watching videos. ' +
    'After school, I will write a short diary about how I felt without my phone. I think it will be a challenging but meaningful experience for everyone.',
];
const ESSAY = ESSAY_PARAGRAPHS.join('\n\n');

const GRADING: EssayGradingResult = {
  kind: 'essay',
  final_score: 15,
  max_score: 20,
  band: 'good',
  third_rater_used: false,
  off_topic: false,
  criteria: {
    content: { score: 4, explanation_zh: '兩段都回應了題目的要求，例子具體。' },
    organization: { score: 4, explanation_zh: '依題目分成兩段，段落之間銜接自然。' },
    grammar: { score: 3.5, explanation_zh: '句型大多正確，可以多用複合句。' },
    vocabulary: { score: 3.5, explanation_zh: '用字恰當，可以再多一些變化。' },
  },
  raters: [
    { role: 'primary', scores: { content: 4, organization: 4, grammar: 4, vocabulary: 4 }, off_topic: false, total: 16, comment_zh: '內容完整、分段清楚。' },
    { role: 'second', scores: { content: 4, organization: 4, grammar: 3, vocabulary: 3 }, off_topic: false, total: 14, comment_zh: '用字可以更精確。' },
  ],
  deductions: [],
  word_count: 131,
  paragraphs: 2,
  top_improvements: ['第一段多一個具體的理由。', '多用連接詞串起句子。', '注意 challenging 的拼法。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '結尾可以呼應第一段的看法。' }],
  errors: [{ paragraph_index: 0, start: 0, end: 0, excerpt: 'Many students', category: 'grammar', explanation_zh: '可以加上 In fact 讓語氣更自然。', suggestion: 'In fact, many students' }],
  rewrite: null,
  safety_flag: null,
};

function detail(patch: Partial<SubmissionDetail> & Pick<SubmissionDetail, 'id' | 'status'>): SubmissionDetail {
  return {
    kind: 'essay',
    group_id: CUSTOM_GROUP,
    input_mode: 'typed',
    final_score: null,
    final_band: null,
    created_at: 1_791_500_000,
    updated_at: 1_791_500_000,
    graded_at: null,
    body: null,
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
    ...patch,
  };
}

/** 假 Worker 存下的題目（測試只需要形狀；正規化交給真的 Worker）。 */
function stored(input: { text: string; figure_text?: string | null; paragraphs?: number | null; min_words?: number | null; max_words?: number | null }): CustomEssayPrompt {
  return {
    text: input.text.trim(),
    figure_text: input.figure_text ?? null,
    paragraphs: input.paragraphs ?? null,
    min_words: input.min_words ?? null,
    max_words: input.max_words ?? null,
    updated_at: 1_791_500_000,
  };
}

async function shot(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env['CUSTOM_ESSAY_SHOTS'];
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${testInfo.project.name}-${name}.png`), fullPage: true });
}

const promptBox = (page: Page) => page.getByRole('textbox', { name: '作文題目' });
const essayBox = (page: Page) => page.getByRole('textbox', { name: /你的作文/ });

// ───────────────────────── 1. 功能全關 ─────────────────────────

test('功能全關：從題型頁進入、填題目、寫作文與自評；只打 /api/features，畫面沒有考試機構名稱', async ({ page }, testInfo) => {
  const errors = collectErrors(page, [/\/api\/(features|health)$/]);
  const backend = await fakeBackend(page, { features: FEATURES_OFF });
  await page.goto('/composition');
  const custom = page.getByRole('region', { name: '自訂題目' });
  await expect(custom).toBeVisible();
  await custom.getByRole('link', { name: '輸入題目開始寫' }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(page.getByRole('heading', { level: 1, name: '自訂題目作文' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: '英文作文', exact: true })).toHaveAttribute('href', '/composition');

  await promptBox(page).fill(PROMPT_TEXT);
  await page.getByRole('button', { name: '設成 2 段' }).click();
  await expect(page.getByRole('radio', { name: '2 段' })).toBeChecked();
  await page.getByRole('button', { name: '題目設定好了' }).click();
  await essayBox(page).fill(ESSAY);
  await expect(page.getByText(/^\d+ 個單詞$/)).toBeVisible();
  await expect(page.getByText('AI 批改即將開放。')).toBeVisible();
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);

  await page.getByRole('button', { name: '自我檢核與自評（不用 AI）' }).click();
  const self = page.locator('#custom-essay-self');
  await expect(self.getByRole('heading', { name: '自我檢核與自評' })).toBeInViewport();
  const content = self.getByRole('group', { name: /^內容/ }).getByRole('radio', { name: '4 分' });
  // 圓鈕是包在 <label> 裡的視覺隱藏 radio：點標籤。
  await content.locator('xpath=..').click();
  await expect(content).toBeChecked();

  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/大考中心|CEEC|大學入學考試中心/);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect([...new Set(backend.calls.map((c) => c.path))].sort()).toEqual(['/api/features']);
  expect(errors).toEqual([]);
});

// ───────────────────────── 1b. AI 開、自訂題目批改沒開（上線時的預設） ─────────────────────────

test('AI 開、自訂題目批改沒開（評分對照達標前）：已核准也只能自我檢核，沒有送出按鈕、不建立提交；題型頁只說歷屆與本站題可以送 AI', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  // 假後端的預設 features 就是上線時的狀態（customEssay: false）。
  const backend = await fakeBackend(page, { me: APPROVED });
  await page.goto('/composition');
  const custom = page.getByRole('region', { name: '自訂題目' });
  await expect(custom).toContainText('寫完可以用檢核清單自我檢核。');
  await expect(custom).not.toContainText('送 AI 批改');
  await expect(page.getByText(/歷屆試題與本站仿真題都可以送。/)).toBeVisible();
  await custom.getByRole('link', { name: '輸入題目開始寫' }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));

  await promptBox(page).fill(PROMPT_TEXT);
  await page.getByRole('button', { name: '設成 2 段' }).click();
  await page.getByRole('button', { name: '題目設定好了' }).click();
  await essayBox(page).fill(ESSAY);
  await expect(page.getByText('自訂題目的 AI 批改即將開放，現在可以先用檢核清單自我檢核。').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);

  // 拍照區：說明檢核清單在打字作答，按鈕切回去（審查 ux-14）。
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  const photo = page.getByRole('region', { name: '拍照上傳手寫稿' });
  await expect(photo).toContainText('自訂題目的 AI 批改即將開放。現在可以切到「打字作答」，用檢核清單自我檢核。');
  await expect(photo.getByRole('button', { name: /上傳並辨識/ })).toHaveCount(0);
  await photo.getByRole('button', { name: '切到打字作答' }).click();

  await page.getByRole('button', { name: '自我檢核與自評（不用 AI）' }).click();
  await expect(page.locator('#custom-essay-self').getByRole('heading', { name: '自我檢核與自評' })).toBeVisible();
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  // 只有讀取（features、me、額度），沒有建立提交，也沒有送任何 AI 任務。
  expect(backend.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([]);
  expect(errors).toEqual([]);
});

// ───────────────────────── 1c. 上線時的狀態、沒登入或還沒申請 ─────────────────────────

test('AI 開、自訂題目批改沒開，沒登入或還沒申請：入口不說能送 AI；作答頁說「即將開放」，不叫學生登入或申請', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  // 預設：沒登入、features 是上線時的狀態（customEssay: false）。
  const backend = await fakeBackend(page);
  await page.goto('/composition');
  await expect(page.getByText(/也可以貼上自己的題目練習。/).first()).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('貼上自己的題目送 AI 批改');

  await page.goto('/writing');
  const own = page.getByRole('region', { name: '自己的題目' });
  await expect(own).toContainText('貼上老師或補習班的作文題目，寫完可以用檢核清單自我檢核。');
  await expect(own).not.toContainText('送 AI');
  await own.getByRole('link', { name: /^自訂題目/ }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));

  const main = page.getByRole('main');
  const notOpen = page.getByText('自訂題目的 AI 批改即將開放，現在可以先用檢核清單自我檢核。');
  const loginOrApply = /需要先登入|用 Google 登入|需要先申請|申請 AI 批改|等站主核准/;
  await expect(notOpen.first()).toBeVisible();
  await expect(page.getByText('把作文題目貼在下面（老師、補習班或其他考卷的題目都可以），寫完可以用檢核清單自我檢核。')).toBeVisible();
  await expect(main).not.toContainText(loginOrApply);
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);

  // 拍照區：同樣說即將開放、切回打字作答，不說「需要 AI 批改的權限」。
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  const photo = page.getByRole('region', { name: '拍照上傳手寫稿' });
  await expect(photo).toContainText('自訂題目的 AI 批改即將開放。現在可以切到「打字作答」，用檢核清單自我檢核。');
  await expect(photo).not.toContainText('需要 AI 批改的權限');
  await photo.getByRole('button', { name: '切到打字作答' }).click();
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');

  // 登入了、還沒申請 AI：一樣不叫學生去申請（申請、核准之後才發現自訂題目不能送，等於白跑一趟）。
  backend.me = signedInMe({ ai_status: 'none' });
  await page.reload();
  await expect(notOpen.first()).toBeVisible();
  await expect(main).not.toContainText(loginOrApply);
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);
  expect(backend.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([]);
  expect(errors).toEqual([]);
});

// ───────────────────────── 2. AI 批改（打字） ─────────────────────────

test('AI 批改（打字）：題目設定 → 送出 → 輪詢 → 結果頁顯示題目與四項分數 → 寫作紀錄有題目開頭', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { me: APPROVED, features: FEATURES_CUSTOM_ON });
  let created: CreateSubmissionBody | null = null;
  let polls = 0;
  const submission = () => {
    const input = created && 'custom_prompt' in created ? created.custom_prompt : { text: PROMPT_TEXT };
    return { id: 'c-1', custom_prompt: stored(input), custom_title: '你的學校即將舉辦「無手機日」，當天所有人都不能使用手機。…', body: { text: ESSAY } };
  };
  backend.on('POST /api/submissions', (call) => {
    created = call.json as CreateSubmissionBody;
    return ok(detail({ ...submission(), status: 'draft' }), 201);
  });
  backend.on('POST /api/ai/essay-grade', () => ok({ op_id: 'op-c1', submission_id: 'c-1', status: 'queued' }, 202));
  backend.on('GET /api/submissions/c-1', () => {
    polls += 1;
    if (polls === 1) return ok(detail({ ...submission(), status: 'queued', op_id: 'op-c1' }));
    return ok(detail({ ...submission(), status: 'graded', op_id: 'op-c1', final_score: 15, final_band: 'good', graded_at: 1_791_500_060, word_count: 131, paragraphs: 2, grading: GRADING }));
  });
  backend.on('GET /api/ai/ops/op-c1', {
    op_id: 'op-c1',
    task: 'essay_grade',
    status: 'settled',
    submission_id: 'c-1',
    submission_status: 'graded',
    points_reserved: 7,
    points_charged: 7,
    refund_reason: null,
    created_at: 1_791_500_000,
    settled_at: 1_791_500_060,
  });
  backend.on('GET /api/submissions', (call) => {
    if (call.query.get('kind') !== 'essay') return ok({ submissions: [], next_cursor: null });
    const { body: _b, self_assess: _s, word_count: _w, paragraphs: _p, op_id: _o, ocr: _ocr, photos: _ph, grading: _g, failure: _f, custom_prompt: _c, ...row } = detail({
      ...submission(),
      status: 'graded',
      final_score: 15,
      final_band: 'good',
    });
    return ok({ submissions: [row satisfies SubmissionSummary], next_cursor: null });
  });

  await page.goto(PATH);
  await promptBox(page).fill(PROMPT_TEXT);
  await page.getByRole('textbox', { name: '圖片或圖表的文字描述（選填）' }).fill(FIGURE_TEXT);
  await page.getByRole('button', { name: '設成 2 段' }).click();
  await page.getByRole('textbox', { name: '至少' }).fill('120');
  await expect(page.getByRole('button', { name: '題目設定好了' })).toBeEnabled();
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  await shot(page, testInfo, 'custom-form');

  await page.getByRole('button', { name: '題目設定好了' }).click();
  const promptSection = page.getByRole('region', { name: '題目' });
  await expect(promptSection.getByText('要求：2 段・至少 120 個單詞')).toBeVisible();
  await essayBox(page).fill(ESSAY);
  await expect(page.getByTestId('quota-summary')).toContainText('今天剩 20／30 點');
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  await shot(page, testInfo, 'custom-collapsed');
  await page.getByRole('button', { name: '送出 AI 批改（7 點）' }).click();

  await expect(page).toHaveURL(/\/writing\/submissions\/c-1$/);
  await expect(page.getByText('排隊等待批改…')).toBeVisible();
  const total = page.getByRole('region', { name: '總分' });
  await expect(total).toBeVisible({ timeout: 10_000 });
  expect(created).toEqual({
    kind: 'essay',
    input_mode: 'typed',
    custom_prompt: { text: PROMPT_TEXT, figure_text: FIGURE_TEXT, paragraphs: 2, min_words: 120, max_words: null },
    body: { text: ESSAY },
  });
  expect(backend.callsTo('POST', '/api/ai/essay-grade')[0]?.json).toEqual({ submission_id: 'c-1' });

  await expect(page.getByRole('heading', { level: 1, name: '自訂題目 英文作文' })).toBeVisible();
  await expect(page).toHaveTitle('自訂題目 英文作文｜批改結果｜學測英文中心');
  await expect(total).toContainText('15');
  for (const [label, score] of [['內容', '4／5'], ['組織', '4／5'], ['文法句構', '3.5／5'], ['字彙拼字', '3.5／5']] as const) {
    await expect(total.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })).toContainText(score);
  }
  await expect(page.getByText('你正在和 AI 互動：AI 評分僅供參考，不是正式考試的評分。')).toBeVisible();
  await expect(page.getByText('這是你提供的題目：AI 依你貼的題目判斷內容與切題，題目不完整時可能判斷不準。')).toBeVisible();
  await page.getByText('你提供的題目', { exact: true }).click();
  await expect(page.getByText('一張學生把手機放進教室門口收納箱的照片。')).toBeVisible();
  await expect(page.getByText(LONG_TOKEN, { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: '用同一個題目再寫一次' })).toHaveAttribute('href', `${PATH}?from=c-1`);
  await expect(page.getByRole('link', { name: '修改題目後重新批改這篇（7 點）' })).toHaveAttribute('href', `${PATH}?from=c-1&reuse=essay`);
  expect(await page.locator('body').innerText()).not.toMatch(/大考中心|CEEC/);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  await shot(page, testInfo, 'custom-result');

  // 寫作紀錄：預設是中譯英，切到英文作文。
  await page.goto('/writing');
  const history = page.getByRole('region', { name: '我的寫作紀錄' });
  await history.getByRole('button', { name: '英文作文' }).click();
  const row = history.getByRole('link', { name: /自訂題目 英文作文/ });
  await expect(row).toContainText('「你的學校即將舉辦「無手機日」');
  await expect(row).toHaveAttribute('href', '/writing/submissions/c-1');
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect(errors).toEqual([]);
});

// ───────────────────────── 3. 驗證 ─────────────────────────

test('驗證：「幫我寫」本機擋下；後端回 official_material 時在題目欄下方說明並標出位置', async ({ page }, testInfo) => {
  // 這個測試刻意讓建立提交回 400：瀏覽器的網路層紀錄不算程式錯誤。
  const errors = collectErrors(page, [/\/api\/submissions$/]);
  const backend = await fakeBackend(page, { me: APPROVED, features: FEATURES_CUSTOM_ON });
  // 假裝這一行和官方文字的指紋相同（比對只在 Worker 做；這裡只驗證前端怎麼顯示）。
  const pasted = '整篇內容要切合主題並且舉出具體的例子';
  const prompt = `請寫一篇英文作文，描述你最難忘的一次旅行。\n${pasted}`;
  const start = prompt.indexOf('切合主題並且舉出');
  backend.on('POST /api/submissions', () => ({
    status: 400,
    json: { error: { code: 'custom_prompt_invalid', message: 'e2e', reason: 'official_material', field: 'text', ranges: [[start, start + 8]] } },
  }));

  await page.goto(PATH);
  await essayBox(page).fill(ESSAY);
  await promptBox(page).fill('請幫我寫一篇英文作文，題目是我的夢想。');
  const error = page.locator('#custom-prompt-error');
  await expect(error).toContainText('題目欄只放題目本身。本站只批改你自己寫的作文，不代寫、也不產生範文。');
  await expect(error.locator('mark', { hasText: '幫我寫' })).toBeVisible();
  await expect(page.getByRole('button', { name: '題目設定好了' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '送出 AI 批改（7 點）' })).toBeDisabled();

  await promptBox(page).fill(prompt);
  await page.getByRole('button', { name: '送出 AI 批改（7 點）' }).click();
  await expect(error).toContainText('標出的文字和官方評分說明或參考答案相同，請刪掉後再試。');
  await expect(error.locator('mark', { hasText: '切合主題並且舉出' })).toBeVisible();
  await expect(error).toContainText('第 2 行：');
  await expect(promptBox(page)).toBeFocused();
  expect(backend.callsTo('POST', '/api/ai/essay-grade')).toHaveLength(0);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  await shot(page, testInfo, 'custom-error');
  expect(errors).toEqual([]);
});

// ───────────────────────── 4. 手寫拍照 ─────────────────────────

/** 測試用的「手寫稿照片」：1800×1350 的 PNG（前端會先縮圖再上傳）。 */
async function handwritingPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1800;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 不可用');
    ctx.fillStyle = '#fdfdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1b2a4a';
    ctx.font = 'italic 60px serif';
    ['No-Phone Day is a good idea for our school.', 'We can talk to our friends face to face.', '', 'On that day, I will read a novel.'].forEach((line, i) => ctx.fillText(line, 100, 150 + i * 110));
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

test('手寫拍照：上傳 → 辨識 → 確認 → 送批改被題目規則擋下 → 在結果頁就地修改題目 → 再送 → 已批改', async ({ page }, testInfo) => {
  const errors = collectErrors(page, [/\/api\/ai\/essay-grade$/]);
  const backend = await fakeBackend(page, { me: APPROVED, features: FEATURES_CUSTOM_ON });
  const OCR_TEXT = `${ESSAY_PARAGRAPHS[0]}\n\n${ESSAY_PARAGRAPHS[1]}`;
  const ocr: OcrResult = { text: OCR_TEXT, uncertain: [], confirmed_at: null };
  let stage: 'draft' | 'ocr' | 'confirmed' | 'grading' = 'draft';
  let prompt = stored({ text: '請寫一篇英文作文，描述你對無手機日的看法。' });
  let gradeCalls = 0;
  let confirmed = '';
  const base = () => ({ id: 'c-p', input_mode: 'photo' as const, custom_prompt: prompt });
  backend.on('POST /api/submissions', (call) => {
    const create = call.json as CreateSubmissionBody;
    if ('custom_prompt' in create) prompt = stored(create.custom_prompt);
    return ok(detail({ ...base(), status: 'draft', body: { text: '' } }), 201);
  });
  backend.on('POST /api/submissions/c-p/photos', () => ok({ photos: [{ id: 'ph-1', ord: 1, bytes: 1000, width: 1600, height: 1200, created_at: 1_791_500_010 }] }));
  backend.on('POST /api/ai/essay-ocr', () => {
    stage = 'ocr';
    return ok({ op_id: 'op-o', submission_id: 'c-p', status: 'ocr_queued' }, 202);
  });
  backend.on('PUT /api/submissions/c-p/confirm', (call) => {
    confirmed = (call.json as { text: string }).text;
    stage = 'confirmed';
    return ok(detail({ ...base(), status: 'confirmed', body: { text: confirmed }, word_count: 131, paragraphs: 2, ocr: { ...ocr, confirmed_at: 1_791_500_050 } }));
  });
  backend.on('PUT /api/submissions/c-p', (call) => {
    const body = call.json as { custom_prompt?: Parameters<typeof stored>[0] };
    if (body.custom_prompt) prompt = stored(body.custom_prompt);
    return ok(detail({ ...base(), status: 'confirmed', body: { text: confirmed }, word_count: 131, paragraphs: 2 }));
  });
  backend.on('POST /api/ai/essay-grade', () => {
    gradeCalls += 1;
    if (gradeCalls === 1) {
      return { status: 400, json: { error: { code: 'custom_prompt_invalid', message: 'e2e', reason: 'official_material', field: 'text', ranges: [[0, 6]] } } };
    }
    stage = 'grading';
    return ok({ op_id: 'op-g', submission_id: 'c-p', status: 'queued' }, 202);
  });
  backend.on('GET /api/submissions/c-p', () => {
    if (stage === 'ocr') return ok(detail({ ...base(), status: 'ocr_ready', body: { text: '' }, ocr }));
    if (stage === 'confirmed') return ok(detail({ ...base(), status: 'confirmed', body: { text: confirmed }, word_count: 131, paragraphs: 2 }));
    if (stage === 'grading') return ok(detail({ ...base(), status: 'graded', body: { text: confirmed }, final_score: 15, final_band: 'good', grading: GRADING, op_id: 'op-g' }));
    return ok(detail({ ...base(), status: 'draft', body: { text: '' } }));
  });
  backend.on('GET /api/ai/ops/op-g', { op_id: 'op-g', task: 'essay_grade', status: 'settled', submission_id: 'c-p', submission_status: 'graded', points_reserved: 7, points_charged: 7, refund_reason: null, created_at: 1, settled_at: 2 });

  await page.goto(PATH);
  await promptBox(page).fill('請寫一篇英文作文，描述你對無手機日的看法。');
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  const photoSection = page.getByRole('region', { name: '拍照上傳手寫稿' });
  await expect(photoSection).toContainText('自訂題目的作文至少要 30 個英文單詞、用英文寫，才能送 AI 批改；辨識的 2 點不會因為這個原因退還。');
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'essay.png', mimeType: 'image/png', buffer: await handwritingPhoto(page) });
  await expect(page.getByRole('img', { name: '第 1 張作文照片預覽' })).toBeVisible();
  await page.getByRole('button', { name: '上傳並辨識（2 點）' }).click();

  await expect(page).toHaveURL(/\/writing\/submissions\/c-p$/);
  expect(backend.callsTo('POST', '/api/submissions')[0]?.json).toMatchObject({
    kind: 'essay',
    input_mode: 'photo',
    custom_prompt: { text: '請寫一篇英文作文，描述你對無手機日的看法。', figure_text: null, paragraphs: null },
  });
  const confirmBox = page.getByRole('region', { name: '確認辨識文字' });
  await expect(confirmBox).toBeVisible({ timeout: 10_000 });
  await confirmBox.getByRole('button', { name: '確認文字' }).click();
  await expect(page.getByRole('heading', { name: '已確認的作文' })).toBeVisible();
  await page.getByRole('button', { name: '送出 AI 批改（7 點）' }).click();

  // 題目被擋下：說明＋自動展開「修改題目」並標出位置；就地修改後存檔，再送一次。
  await expect(page.getByRole('alert').filter({ hasText: '請在上方「你提供的題目」修改後再送出' })).toBeVisible();
  await expect(page.locator('#custom-prompt-error mark')).toHaveText('請寫一篇英文');
  await promptBox(page).fill('Write an essay about how you would spend a day without your phone at school.');
  await page.getByRole('button', { name: '儲存題目' }).click();
  await expect(page.getByText('已更新題目，可以再送出批改。')).toBeVisible();
  expect(backend.callsTo('PUT', '/api/submissions/c-p').at(-1)?.json).toMatchObject({
    custom_prompt: { text: 'Write an essay about how you would spend a day without your phone at school.' },
  });
  await page.getByRole('button', { name: '送出 AI 批改（7 點）' }).click();
  await expect(page.getByRole('region', { name: '總分' })).toContainText('15', { timeout: 10_000 });
  expect(gradeCalls).toBe(2);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect(errors).toEqual([]);
});

// ───────────────────────── 5. 入口與切換 ─────────────────────────

test('入口：/writing/essay 的第三格連到自訂頁，返回連結回到英文作文題目；/writing 有「自己的題目」入口卡', async ({ page }, testInfo) => {
  const errors = collectErrors(page, [/\/api\/(features|health)$/]);
  await fakeBackend(page, { features: FEATURES_OFF });
  await page.goto('/writing');
  const own = page.getByRole('region', { name: '自己的題目' });
  await expect(own.getByRole('link', { name: /^自訂題目/ })).toHaveAttribute('href', PATH);
  // 入口卡不能超出自己的 section、蓋到「兩種批改方式」（曾因 h-full 撐到整個 section 高）。手機上「兩種批改方式」在下面；
  // 桌機（docs/design/desktop-ui.md §5.5）在右欄，兩塊左右並排：檢查的是兩塊不重疊。
  const cardBox = await own.getByRole('link', { name: /^自訂題目/ }).boundingBox();
  const modesBox = await page.getByRole('region', { name: '兩種批改方式' }).boundingBox();
  if (!cardBox || !modesBox) throw new Error('量不到位置');
  const below = cardBox.y + cardBox.height <= modesBox.y;
  const beside = cardBox.x + cardBox.width <= modesBox.x;
  expect(below || beside).toBe(true);
  if (testInfo.project.name === 'mobile') expect(below).toBe(true);
  await page.goto('/writing/essay');
  const tabs = page.getByRole('navigation', { name: '題目來源' });
  await expect(tabs.getByRole('link')).toHaveText(['歷屆試題', '本站仿真', '自訂題目']);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  await tabs.getByRole('link', { name: '自訂題目' }).click();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(page.getByRole('navigation', { name: '題目來源' }).getByRole('link', { name: '自訂題目' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main').getByRole('link', { name: '英文作文題目' })).toHaveAttribute('href', '/writing/essay');
  expect(errors).toEqual([]);
});

// ───────────────────────── 6. 深色模式 ─────────────────────────

test('深色模式：作答頁與結果頁沒有 console error', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  const backend = await fakeBackend(page, { me: APPROVED, features: FEATURES_CUSTOM_ON });
  backend.on('GET /api/submissions/c-d', () =>
    ok(detail({ id: 'c-d', status: 'graded', custom_prompt: stored({ text: PROMPT_TEXT, paragraphs: 2 }), body: { text: ESSAY }, final_score: 15, final_band: 'good', grading: GRADING })),
  );
  await page.goto(PATH);
  await promptBox(page).fill('請寫一篇英文作文，文分兩段，描述你的暑假。');
  await expect(page.getByRole('button', { name: '設成 2 段' })).toBeVisible();
  await shot(page, testInfo, 'custom-form-dark');
  await page.goto('/writing/submissions/c-d');
  await expect(page.getByRole('region', { name: '總分' })).toBeVisible();
  await shot(page, testInfo, 'custom-result-dark');
  expect(errors).toEqual([]);
});
