/**
 * 學習助手的國文（docs/design/assistant-subjects.md §11.1 前端 e2e）在建置後的產物上跑，桌機與手機都要過。
 * 後端用 tests/support/backend.ts 的假 Worker（fakeAssist 的國文路由：依格式與子模式回範例 A–F 的假解析）。
 *
 *   1. 首頁「問國文題」→ 貼上字形題（字形題提醒、單選預填、6 點）→ 送出 → 解析：頁首標籤、字形卡、逐選項、查辭典 → 追問一次；
 *   2. 多選：5 個選項預設多選、「我有講義答案」→ 多選計分（誤選、漏選）與「依你提供的答案」；
 *   3. 文言：沒填答案先看提示，「看完整解析」才展開文言對照卡；
 *   4. 推論研判：用題目自己的標籤與「你判」；
 *   5. 簡答：題號 34、每小題的作答與字數 → 要點、句型、示範先收合；國寫：附一段 → 要件檢核與錯別字，不打分數；
 *   6. 單選判出兩個「該選」→ 改成多選重看（0 點，PATCH choice_mode）；
 *   7. 科目不符：解析時判定是社會科 → 退還說明；是英文 → 「改用英文重新建立」預填題目；
 *   8. 首頁的國文篩選與錯因統計；用同一份題目問另一部分（related_case_id）；
 *   9. 開關關著：沒有科目 chip、首頁只有一個按鈕；英文的送出內容不變；
 *  10. 手機 375／320 px 與桌機沒有水平捲動；
 *  11. 國文拍照：拍照前的點數確認（轉錄＋解析＝總點數）、確認畫面的字形題提醒與國文欄位；轉錄判定是英文時請學生換科目再拍。
 * 題目與解析都是本站自寫的範例（src/features/assistant/testing/zh.ts），不含任何官方解析或參考答案。
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CreateAssistCaseBody, CreateAssistFollowupBody, PatchAssistCaseBody, UpdateAssistQuestionBody } from '@gsat/shared';
import { ZH_SAMPLE_QUESTIONS } from '../src/features/assistant/testing/zh';
import {
  FEATURES_ASSISTANT_ON,
  FEATURES_SUBJECTS_ON,
  FEATURES_SUBJECTS_PHOTO_ON,
  collectErrors,
  expectNoHorizontalOverflow,
  fakeAssist,
  fakeBackend,
  signedInMe,
  type FakeAssistOptions,
} from './support/backend';

const APPROVED = signedInMe({ ai_status: 'approved' });

const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

async function setup(page: Page, options: FakeAssistOptions = {}, features = FEATURES_SUBJECTS_ON) {
  const backend = await fakeBackend(page, { features, me: APPROVED });
  const assist = fakeAssist(backend, options);
  return { backend, assist };
}

/** 國文表單：貼上題目（textarea 用 fill，換行照原樣）。 */
async function paste(page: Page, text: string) {
  await page.getByRole('textbox', { name: '題目全文（必填）' }).fill(text);
}

async function submitAndWait(page: Page) {
  await page.getByRole('button', { name: /^送出(解析|國寫指導)$/ }).click();
  await expect(page).toHaveURL(/\/assistant\/case\//);
  await expect(page.getByTestId('zh-case-tag')).toBeVisible();
}

/** 桌機的案例頁右欄是「解析｜追問」分頁；手機是一頁往下。 */
async function openFollowups(page: Page, testInfo: TestInfo) {
  if (!isMobile(testInfo)) await page.getByRole('tab', { name: /^追問/ }).click();
}

test('首頁「問國文題」→ 貼上字形題 → 解析（字形卡、逐選項、查辭典）→ 追問', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/assistant');
  await expect(page.getByRole('link', { name: /問英文題/ })).toBeVisible();
  await page.getByRole('link', { name: /問國文題/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '貼上國文題目' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '國文' })).toBeChecked();
  await expect(page.getByText('數學、社會、自然還沒開放')).toBeVisible();

  await paste(page, ZH_SAMPLE_QUESTIONS.form);
  await expect(page.getByTestId('zh-form-reminder')).toBeVisible();
  await expect(page.getByTestId('zh-format-summary')).toHaveText('單選題（依題目判斷）');
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('A');
  await expect(page.getByTestId('zh-points')).toContainText('這次會用 6 點');
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await submitAndWait(page);

  const created = backend.callsTo('POST', '/api/assist/cases')[0]?.json as CreateAssistCaseBody;
  expect(created.source).toMatchObject({ source: 'typed', subject: 'chinese', question: { format: 'choice', choice_mode: 'single', answers: { '': 'A' } } });

  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜字形・單選');
  await expect(page.getByRole('region', { name: '字形卡：錯字對照' })).toBeVisible();
  await expect(page.getByText('AI 判斷，請查教育部辭典')).toBeVisible();
  await expect(page.getByText('「不斐」→「不菲」').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /推薦練習/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  await openFollowups(page, testInfo);
  await page.getByRole('textbox', { name: '還有問題？繼續追問' }).fill('「昧」還有哪些常考的詞？');
  await page.getByRole('button', { name: '送出追問（用 3 點）' }).click();
  await expect(page.getByText('「昧」是不明白、不清楚的意思；「素昧平生」就是向來不認識。')).toBeVisible();
  const followup = backend.callsTo('POST', '/api/assist/cases/case-1/followups')[0]?.json as CreateAssistFollowupBody;
  expect(followup.text).toBe('「昧」還有哪些常考的詞？');
  expect(errors).toEqual([]);
});

test('多選：5 個選項預設多選，填講義答案 → 誤選、漏選與得分（依你提供的答案）', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.word);
  await expect(page.getByTestId('zh-format-summary')).toHaveText('多選題（依題目判斷）');
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('AC');
  await page.getByText('我有講義答案').click();
  await page.getByRole('textbox', { name: '講義或考卷的答案' }).fill('AE');
  await submitAndWait(page);
  const created = backend.callsTo('POST', '/api/assist/cases')[0]?.json as CreateAssistCaseBody;
  expect(created.source).toMatchObject({ question: { choice_mode: 'multi', answers: { '': 'AC' }, known_key: { '': 'AE' } } });
  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜字詞義・多選');
  await expect(page.getByTestId('zh-multi-score')).toHaveText('你誤選 (C)、漏選 (E)：答錯 2 個選項，得 1/5（每題 4 分時是 0.8 分）。');
  await expect(page.getByText('（你提供的答案）')).toBeVisible();
  await expect(page.getByText('你誤選').first()).toBeVisible();
  await expect(page.getByText('多選題策略')).toBeVisible();
  expect(errors).toEqual([]);
});

test('文言：沒填答案先看提示，「看完整解析」才展開文言對照卡', async ({ page }) => {
  const errors = collectErrors(page);
  await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.classical);
  await expect(page.getByRole('checkbox', { name: /先給提示就好/ })).toBeChecked();
  await submitAndWait(page);
  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜文言・單選');
  await expect(page.getByText('題幹問的是「理由」：找原文裡說明「為什麼」的句子。')).toBeVisible();
  await expect(page.getByRole('region', { name: '文言對照卡：逐句白話' })).toBeHidden();
  await page.getByRole('button', { name: '看完整解析' }).click();
  await expect(page.getByRole('region', { name: '文言對照卡：逐句白話' })).toBeVisible();
  // 證據鏈的引文在左欄（手機是題目卡）的原文裡標出來。
  await page.getByRole('button', { name: '在題目中標出這句' }).first().click();
  await expect(page.locator('mark[data-active="true"]')).toContainText('人非生而知之者');
  expect(errors).toEqual([]);
});

test('沒填題號、先看提示：提示上方沒有字形卡與診斷，左欄不先標引文；「看完整解析」才出現', async ({ page }) => {
  const errors = collectErrors(page);
  await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.form);
  await expect(page.getByRole('checkbox', { name: /先給提示就好/ })).toBeChecked();
  await submitAndWait(page);
  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜字形・單選');
  await expect(page.getByText('每句只找成語或關鍵詞。')).toBeVisible();
  // 字形卡的正字、模型的診斷、逐選項的關鍵都等於答案：先看提示時一律收合（Worker 的題號是空字串，卡片也算這一題的）。
  await expect(page.getByRole('region', { name: '字形卡：錯字對照' })).toBeHidden();
  await expect(page.getByText('(A)「價格卻不斐」有錯字，應該寫「不菲」。')).toBeHidden();
  await expect(page.getByText('「不斐」→「不菲」').filter({ visible: true })).toHaveCount(0);
  await expect(page.locator('[data-zh-shared-cards]')).toHaveCount(0);
  await expect(page.locator('mark')).toHaveCount(0);
  await page.getByRole('button', { name: '看完整解析' }).click();
  await expect(page.getByRole('region', { name: '字形卡：錯字對照' })).toBeVisible();
  await expect(page.getByText('(A)「價格卻不斐」有錯字，應該寫「不菲」。')).toBeVisible();
  // 按下「在題目中標出這句」才在左欄標出那一句。
  await page.getByRole('button', { name: '在題目中標出這句' }).first().click();
  await expect(page.locator('mark[data-active="true"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('推論研判：判定用題目自己的標籤，學生的組合拆成「你判」', async ({ page }) => {
  const errors = collectErrors(page);
  await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.judge);
  await expect(page.getByTestId('zh-format-summary')).toHaveText('推論研判（依題目判斷）');
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('D');
  await submitAndWait(page);
  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜推論研判・單選');
  await expect(page.getByText('用題目的標籤：符合／不符合／無法判斷')).toBeVisible();
  await expect(page.getByText('你判：無法判斷')).toBeVisible();
  await expect(page.getByText('該選')).toHaveCount(0);
  // 敘述判定表 → 推出組合 → 答案：逐句判定對到哪一個選項（選項文字取自題目）。
  await expect(page.getByText('① 不符合、② 不符合 → (B)「①、②皆不符合」')).toBeVisible();
  expect(errors).toEqual([]);
});

test('簡答與國寫：每小題的作答與字數、示範先收合；國寫附一段，不打分數', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.short);
  await page.getByRole('textbox', { name: '要問的題號（選填）' }).fill('34');
  await expect(page.getByTestId('zh-format-summary')).toHaveText('簡答（依題目判斷）');
  await page.getByRole('textbox', { name: '第 34 題你的答案' }).fill('不要告訴外面的人');
  await expect(page.getByText('8 字（含標點；漢字 8）／20 字以內')).toBeVisible();
  await submitAndWait(page);
  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜非選擇題・簡答');
  await expect(page.getByText('要點與原文依據')).toBeVisible();
  await expect(page.getByText('希望＿＿，以免＿＿。')).toBeVisible();
  await expect(page.getByText('本站 AI 示範，不是官方答案')).toBeHidden();
  await page.getByText('AI 示範答案（先自己改寫一次再看）').click();
  await expect(page.getByText('本站 AI 示範，不是官方答案')).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));

  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.writing);
  await expect(page.getByTestId('zh-format-summary')).toHaveText('國寫指導（依題目判斷）');
  await page.getByRole('textbox', { name: '你寫的一段（選填）' }).fill('那年夏天我在病房裡渡過暑假，窗外只有一棵樹。');
  await submitAndWait(page);
  const created = backend.callsTo('POST', '/api/assist/cases')[1]?.json as CreateAssistCaseBody;
  expect(created.source).toMatchObject({ question: { format: 'writing', draft_target: 'q2' } });
  expect(created.hint_first).toBe(false);
  await expect(page.getByText('AI 不打分數，示範不是佳作。')).toBeVisible();
  await expect(page.getByText('「渡過」→「度過」', { exact: false })).toBeVisible();
  // 程式檢查（不花點數）用題目裡的段落原文算；這一段沒有常見問題。國寫方法卡先收合，打開後看得到情意題的做法。
  await expect(page.getByRole('heading', { name: '程式檢查（不花點數）' })).toBeVisible();
  await expect(page.getByText(/^程式沒有找到這幾種常見問題：/)).toBeVisible();
  await expect(page.getByText('審題：圈出關鍵詞，問它排除了什麼')).toBeHidden();
  await page.getByText('國寫方法卡', { exact: true }).click();
  await expect(page.getByText('審題：圈出關鍵詞，問它排除了什麼')).toBeVisible();
  await expect(page.getByText('情意題：').first()).toBeVisible();
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('單選判出兩個「該選」：改成多選重看（0 點，PATCH choice_mode），依已存的判定重算計分', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page, { zhMultiSuspect: true });
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.form);
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('A');
  await submitAndWait(page);
  await page.getByRole('button', { name: '改成多選重看（0 點）' }).click();
  await expect(page.getByTestId('zh-multi-score')).toContainText('你誤選 (A)、漏選 (C)');
  const patch = backend.callsTo('PATCH', '/api/assist/cases/case-1')[0]?.json as PatchAssistCaseBody;
  expect(patch).toEqual({ choice_mode: 'multi' });
  expect(errors).toEqual([]);
});

test('科目不符：社會科說明已退還；英文附「改用英文重新建立」並預填題目', async ({ page }) => {
  const errors = collectErrors(page);
  const { assist } = await setup(page, { zhMismatch: 'social' });
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.classical);
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page.getByTestId('assist-subject-mismatch')).toHaveText('這題看起來是社會科；學習助手目前只開放英文、國文。這次的點數已經退還。');
  await expect(page.getByRole('button', { name: /再試一次/ })).toHaveCount(0);

  // 判定是英文：連到英文的貼上，題目預填。
  (assist as unknown as { options: FakeAssistOptions }).options.zhMismatch = 'english';
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.form);
  await page.getByRole('button', { name: '送出解析' }).click();
  await page.getByRole('link', { name: '改用英文重新建立' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '貼上題目' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '題目全文（必填）' })).toHaveValue(ZH_SAMPLE_QUESTIONS.form);
  expect(errors).toEqual([]);
});

test('首頁的國文篩選與錯因統計；用同一份題目問另一部分（related_case_id）', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await paste(page, ZH_SAMPLE_QUESTIONS.form);
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('A');
  await submitAndWait(page);

  await page.getByRole('link', { name: '用同一份題目問另一部分' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: '貼上國文題目' })).toBeVisible();
  await expect(page.getByText(/題目已經帶入上一題確認過的文字/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: '題目全文（必填）' })).toHaveValue(/下列文句，何者完全沒有錯別字？/);
  await submitAndWait(page);
  const second = backend.callsTo('POST', '/api/assist/cases')[1]?.json as CreateAssistCaseBody;
  expect(second.source).toMatchObject({ source: 'typed', subject: 'chinese', related_case_id: 'case-1' });

  await page.goto('/assistant');
  const recent = page.getByRole('region', { name: '最近的解析' });
  await expect(recent.getByText('國文・你貼的題目', { exact: false }).first()).toBeVisible();
  await recent.getByRole('group', { name: '依科目篩選' }).getByText('國文', { exact: true }).click();
  // 第一題答錯（同音、音近字誤用）；第二題沒作答，沒有錯因。
  await expect(page.getByTestId('zh-error-stats')).toContainText('字音字形 1 次');
  expect(backend.calls.some((c) => c.path === '/api/assist/cases' && c.query.get('subject') === 'chinese')).toBe(true);
  expect(errors).toEqual([]);
});

test('國文開關關著：沒有科目 chip、首頁只有一個按鈕；英文的送出內容和原本相同', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page, {}, FEATURES_ASSISTANT_ON);
  await page.goto('/assistant');
  await expect(page.getByRole('link', { name: /貼上題目/ })).toHaveAttribute('href', '/assistant/new');
  await expect(page.getByRole('link', { name: /問國文題/ })).toHaveCount(0);
  await page.goto('/assistant/new?subject=chinese');
  await expect(page.getByRole('heading', { level: 1, name: '貼上題目' })).toBeVisible();
  await expect(page.getByRole('group', { name: '科目' })).toHaveCount(0);
  const text = 'The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend';
  await page.getByRole('textbox', { name: '題目全文（必填）' }).fill(text);
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\//);
  const created = backend.callsTo('POST', '/api/assist/cases')[0]?.json as CreateAssistCaseBody;
  expect(created.source).toEqual({ source: 'typed', question: { blocks: [{ kind: 'question', label: null, text }], target_labels: [], student_answer: null } });
  await expect(page.getByTestId('zh-case-tag')).toHaveCount(0);
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  expect(errors).toEqual([]);
});

test('國文開放、選英文：英文表單與送出的內容和原本相同', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/assistant/new?subject=chinese');
  await page.getByRole('group', { name: '科目' }).getByText('英文', { exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '貼上題目' })).toBeVisible();
  const text = 'The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend';
  await page.getByRole('textbox', { name: '題目全文（必填）' }).fill(text);
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\//);
  const created = backend.callsTo('POST', '/api/assist/cases')[0]?.json as CreateAssistCaseBody;
  expect(created.source).toEqual({ source: 'typed', question: { blocks: [{ kind: 'question', label: null, text }], target_labels: [], student_answer: null } });
  // 下次進來記得上次選的英文。
  await page.goto('/assistant/new');
  await expect(page.getByRole('radio', { name: '英文' })).toBeChecked();
  expect(errors).toEqual([]);
});

/** 在瀏覽器裡畫一張「講義」照片（JPEG），選取後用整張。 */
async function pickPhoto(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#111111';
    g.font = '40px serif';
    g.fillText('1. 下列文句，何者完全沒有錯別字？', 60, 300);
    return canvas.toDataURL('image/jpeg', 0.9);
  });
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'handout.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(dataUrl.split(',')[1] ?? '', 'base64') });
  await page.getByRole('button', { name: '確定框選' }).click();
  await expect(page.getByRole('img', { name: '第 1 張題目照片（框選後）' })).toBeVisible();
}

test('國文拍照：拍照前列出總點數 → 轉錄（3 點）→ 確認畫面（字形題提醒、底線、國文欄位）→ 送出解析', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page, {}, FEATURES_SUBJECTS_PHOTO_ON);
  await page.goto('/assistant/new?subject=chinese');
  await expect(page.getByRole('heading', { level: 1, name: '拍照問國文題' })).toBeVisible();
  await expect(page.getByTestId('zh-photo-budget')).toContainText('轉錄 3 點＋解析約 6 點＝9 點；你今天還有 20 點。');
  await pickPhoto(page);
  await page.getByRole('button', { name: '上傳並轉錄（3 點）' }).click();
  await expect(page).toHaveURL(/\/assistant\/new\?subject=chinese&mode=photo&case=case-1$/);
  expect(backend.callsTo('POST', '/api/assist/cases').map((c) => c.json as CreateAssistCaseBody)).toEqual([{ source: { source: 'photo', subject: 'chinese' }, hint_first: true }]);

  await expect(page.getByRole('heading', { name: '確認轉錄的題目' })).toBeVisible();
  await expect(page.getByTestId('zh-ocr-form-reminder')).toContainText('這題的錯字是題目的一部分，請確認轉錄沒有改正它。');
  await expect(page.getByText('這段像答案或詳解，已隱藏。')).toBeVisible();
  const options = page.getByRole('textbox', { name: '選項 1的文字' });
  await expect(options).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.getByRole('button', { name: '標示底線' }).first()).toBeVisible();
  await expect(page.getByTestId('zh-format-summary')).toHaveText('單選題（依題目判斷）');
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('A');
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  await page.getByRole('button', { name: '看起來正確，送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);
  const put = backend.callsTo('PUT', '/api/assist/cases/case-1/question')[0]?.json as UpdateAssistQuestionBody;
  expect(put.question).toMatchObject({ format: 'choice', choice_mode: 'single', target_labels: ['1'], answers: { '1': 'A' } });
  await expect(page.getByTestId('zh-case-tag')).toHaveText('國文｜字形・單選');
  expect(errors).toEqual([]);
});

test('國文拍照：轉錄判定是英文題目 → 退點、刪照片，請學生換科目再拍', async ({ page }) => {
  const errors = collectErrors(page);
  await setup(page, { zhOcr: 'other_subject' }, FEATURES_SUBJECTS_PHOTO_ON);
  await page.goto('/assistant/new?subject=chinese');
  await pickPhoto(page);
  await page.getByRole('button', { name: '上傳並轉錄（3 點）' }).click();
  await expect(page.getByRole('alert')).toContainText('這張看起來是英文題目，請把科目改成「英文」再拍一次。點數已經退還，照片也已經刪除。');
  await expect(page.getByRole('button', { name: /用剛才的照片再轉錄一次/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
