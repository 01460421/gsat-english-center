/**
 * 國寫範文的獨立頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」）在建置後的產物上跑，桌機與手機都要過。
 * 後端用 tests/support/backend.ts 的假 Worker（fakeAssist 的 POST／GET /api/assist/zh-exemplars：歷屆題目用 repo 的
 * data/zh-writing/prompts.json 組題目、貼上的題目跑國文貼上的同一套檢查；範文用本站自寫的示範）。
 *
 *   1. 從導覽（桌機側邊欄、手機「更多」）進國寫範文 → 選歷屆題目（111 知性）→ 題目全文 → 行內確認（8 點、今天還有幾點、固定標籤、
 *      不能繳交）→ 等待 → 結果（固定標籤、問題（一）、方法卡；沒有複製或列印）→ 我的國寫範文列出這一題；
 *   2. 貼上題目：沒填時的說明 → 情意題＋題目＋素材＋字數規定 → 確認 → 結果；這一題也出現在學習助手的列表，案例頁指回國寫範文；
 *   3. 失敗：退還說明 →「再試一次（8 點）」→ POST {source:'case'} → 結果；
 *   4. 開關與核准：國寫範文沒開時導覽與學習助手首頁都沒有入口、直接打開是唯讀；沒核准時有入口但只說明怎麼申請；
 *   5. 手機 375／360／320 px 與桌機沒有水平捲動；
 *   6. 審查 2026-10-30：短的命題作文（不到 30 個漢字）不必填字數也能送、太短時的說法不提選項或改選科目；結果頁的程式還在下載
 *      （慢網路第一次打開）時按「上一頁」，確認面板不會卡在「送出中…」，這一題標成「示範產生中」（目前的外框在下載時顯示
 *      「載入中…」、回來時重新掛載這一頁，所以修正前也會過；留著防止外框的換頁方式改變後退步）。
 * 學習助手裡的「看一篇 AI 示範」照舊（assistant-zh.spec.ts）。
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CreateZhExemplarBody } from '@gsat/shared';
import { ZH_SAMPLE_QUESTIONS } from '../src/features/assistant/testing/zh';
import {
  FEATURES_SUBJECTS_ON,
  FEATURES_ZH_EXEMPLAR_ON,
  QUOTA,
  collectErrors,
  expectNoHorizontalOverflow,
  fakeAssist,
  fakeBackend,
  signedInMe,
  type FakeAssistOptions,
} from './support/backend';

const APPROVED = signedInMe({ ai_status: 'approved' });
const isMobile = (testInfo: TestInfo) => testInfo.project.name === 'mobile';

/** 學習助手的額度多國寫範文今天的篇數（國寫範文開放時才有）。 */
const QUOTA_ZH_EXEMPLAR = {
  ...QUOTA,
  assist: { reports: { day_used: 0, day_limit: 2 }, ocr: { day_used: 0, day_limit: 6 }, zh_exemplars: { day_used: 0, day_limit: 3 } },
};

async function setup(page: Page, options: FakeAssistOptions = {}, features = FEATURES_ZH_EXEMPLAR_ON, me = APPROVED) {
  const backend = await fakeBackend(page, { features, me, quota: QUOTA_ZH_EXEMPLAR });
  const assist = fakeAssist(backend, options);
  return { backend, assist };
}

/** 從導覽打開某一頁：桌機是側邊欄，手機是底部導覽的「更多」。 */
async function openFromNav(page: Page, testInfo: TestInfo, name: string) {
  const nav = page.getByRole('navigation', { name: '主要導覽' });
  if (isMobile(testInfo)) {
    await nav.getByRole('button', { name: '更多' }).click();
    await page.getByRole('dialog', { name: '全部功能' }).getByRole('link', { name }).click();
  } else {
    await nav.getByRole('link', { name }).click();
  }
}

/** 手機另外在 360 px 檢查一次（站主指定的最窄常見寬度；expectNoHorizontalOverflow 另檢查 375 與 320）。 */
async function expectNoOverflowAll(page: Page, testInfo: TestInfo) {
  await expectNoHorizontalOverflow(page, isMobile(testInfo));
  if (!isMobile(testInfo)) return;
  const original = page.viewportSize();
  await page.setViewportSize({ width: 360, height: original?.height ?? 667 });
  const { scrollWidth, viewport } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(scrollWidth, `360 px 時頁面寬 ${scrollWidth}px 超出視窗 ${viewport}px`).toBeLessThanOrEqual(viewport);
  if (original) await page.setViewportSize(original);
}

function postedBodies(backend: Awaited<ReturnType<typeof setup>>['backend']): CreateZhExemplarBody[] {
  return backend.callsTo('POST', '/api/assist/zh-exemplars').map((c) => c.json as CreateZhExemplarBody);
}

test('從導覽進國寫範文 → 選歷屆題目 → 確認 8 點 → 等待 → 結果；我的國寫範文列出這一題', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page, { pendingPolls: 2 });
  await page.goto('/');
  // 首頁的學習模組（手機是卡片，桌機是「全部功能」）也有國寫範文。
  await expect(page.locator('main a[href="/zh-writing"]').first()).toBeVisible();
  await openFromNav(page, testInfo, '國寫範文');
  await expect(page).toHaveURL(/\/zh-writing$/);
  await expect(page.getByRole('heading', { level: 1, name: '國寫範文' })).toBeVisible();
  await expect(page).toHaveTitle('國寫範文｜學測英文中心');
  await expect(page.getByTestId('zh-writing-records-note')).toHaveText('國寫範文和學習助手的紀錄存在一起：最後一次使用後保存 180 天，也可以隨時自己刪除。');
  await expect(page.getByRole('tab', { name: '選歷屆題目' })).toHaveAttribute('aria-selected', 'true');
  // 十題：111–115 每年知性、情意各一。
  for (const year of [115, 114, 113, 112, 111]) await expect(page.getByRole('heading', { name: `${year} 學年度` })).toBeVisible();
  await expect(page.locator('[data-zh-prompt]')).toHaveCount(10);
  await expectNoOverflowAll(page, testInfo);

  await page.getByRole('button', { name: /知性：樂齡活動/ }).click();
  const detail = page.getByRole('article', { name: '111 學測國寫・第一大題（知性）' });
  await expect(detail.getByText('問題（一）：文長限80字以內（至多4行）')).toBeVisible();
  await expect(detail.getByText('知性・樂齡活動・題目指定：以「樂齡出遊」為題')).toBeVisible();
  await expectNoOverflowAll(page, testInfo);

  await detail.getByRole('button', { name: '看一篇 AI 示範（8 點）' }).click();
  const panel = detail.getByRole('group', { name: '確認點數' });
  await expect(panel.getByText('這次會用 8 點（今天還有 20 點）；沒有完成會全額退還。')).toBeVisible();
  await expect(panel.getByText('國寫的 AI 示範每天最多 3 篇，今天已經看過 0 篇。')).toBeVisible();
  await expect(panel.getByTestId('zh-exemplar-confirm-label')).toHaveText('AI 示範，不是得獎作品');
  await expect(panel.getByText('示範是 AI 寫的，不是得獎作品，也不是官方佳作；請不要當成自己的作品繳交。')).toBeVisible();
  await expect(panel.getByRole('button', { name: '確定，用 8 點' })).toBeInViewport();
  await expectNoOverflowAll(page, testInfo);
  await panel.getByRole('button', { name: '確定，用 8 點' }).click();

  // 結果頁：進度列在「AI 示範」那一塊；完成後出現固定標籤。
  await expect(page).toHaveURL(/\/zh-writing\/case-1$/);
  const section = page.locator('section#zh-exemplar');
  await expect(section.getByText(/AI 正在寫示範…|排隊中…/).first()).toBeVisible();
  await expect(section.getByTestId('zh-exemplar-label')).toHaveText('AI 示範，不是得獎作品');
  expect(postedBodies(backend)).toEqual([{ source: 'past', prompt_id: 'zh-111-1' }]);
  await expect(page.getByRole('heading', { level: 1, name: '111 學測知性：樂齡活動' })).toBeVisible();
  await expect(section.getByRole('heading', { name: '問題（一）' })).toBeVisible();
  await section.locator('[data-zh-exemplar-paragraph="1"]').getByRole('button', { name: /^方法卡：/ }).click();
  await expect(page.getByRole('button', { name: /複製|列印/ })).toHaveCount(0);
  await expect(section.getByRole('button', { name: '再看一篇 AI 示範（8 點）' })).toBeVisible();
  await expect(page.getByTestId('zh-writing-result-footer').getByRole('link', { name: '在學習助手打開這一題（國寫指導、追問）' })).toHaveAttribute('href', '/assistant/case/case-1');
  await expectNoOverflowAll(page, testInfo);

  // 回到國寫範文：我的國寫範文列出這一題，歷屆題目標「1 篇示範」（同一句狀態）。
  await page.getByRole('link', { name: '國寫範文' }).first().click();
  const history = page.getByTestId('zh-writing-history');
  await expect(history.getByRole('link', { name: /111 學測知性：樂齡活動/ })).toContainText('1 篇示範');
  await expect(page.getByRole('button', { name: /知性：樂齡活動/ })).toContainText('1 篇示範');
  expect(errors).toEqual([]);
});

test('貼上題目：沒填時說明 → 情意題＋題目＋素材＋字數規定 → 確認 → 結果；也出現在學習助手，案例頁指回國寫範文', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/zh-writing');
  await page.getByRole('tab', { name: '貼上題目' }).click();
  await expect(page).toHaveURL(/\?tab=paste$/);
  await page.getByRole('button', { name: '下一步：確認點數' }).click();
  await expect(page.getByText('請選這題是知性題還是情意題。')).toBeVisible();
  await expect(page.getByText('請貼上題目（要你寫什麼的那一段）。')).toBeVisible();

  await page.getByRole('radio', { name: '情意題' }).check();
  await page.getByRole('textbox', { name: '題目（必填）' }).fill(ZH_SAMPLE_QUESTIONS.writing);
  await page.getByRole('textbox', { name: '素材（選填）' }).fill('每個人的生活裡都有一扇窗，有的看得見風景，有的只看得見對面的牆。');
  await page.getByRole('textbox', { name: '全文字數上限' }).fill('600');
  await page.getByRole('textbox', { name: '全文行數上限' }).fill('30');
  await expectNoOverflowAll(page, testInfo);
  await page.getByRole('button', { name: '下一步：確認點數' }).click();
  const panel = page.getByRole('group', { name: '確認點數' });
  await expect(panel.getByText('這次會用 8 點（今天還有 20 點）；沒有完成會全額退還。')).toBeVisible();
  await expect(panel.getByTestId('zh-exemplar-confirm-label')).toBeVisible();
  await expectNoOverflowAll(page, testInfo);
  await panel.getByRole('button', { name: '確定，用 8 點' }).click();

  await expect(page).toHaveURL(/\/zh-writing\/case-1$/);
  await expect(page.locator('section#zh-exemplar').getByTestId('zh-exemplar-label')).toBeVisible();
  await expect(page.locator('section#zh-exemplar').getByRole('heading', { name: '全文' })).toBeVisible();
  expect(postedBodies(backend)).toEqual([
    {
      source: 'paste',
      section: 'zh_writing_emotion',
      prompt: ZH_SAMPLE_QUESTIONS.writing,
      material: '每個人的生活裡都有一扇窗，有的看得見風景，有的只看得見對面的牆。',
      limits: { body_chars: 600, body_lines: 30 },
    },
  ]);
  // 題目（收合）裡有本站寫的字數規定那一行與素材。
  await page.getByRole('button', { name: '看完整題目' }).click();
  await expect(page.getByText('字數規定（你填的）：')).toBeVisible();

  // 資料存在學習助手：列表看得到這一題；案例頁說明示範在國寫範文頁。
  await page.goto('/assistant');
  await page.getByRole('link', { name: /國寫範文・你貼的題目/ }).click();
  const notice = page.getByTestId('zh-writing-case-notice').first();
  await expect(notice).toContainText('這一題的 AI 示範在國寫範文頁。');
  await notice.getByRole('link', { name: '看這一題的 AI 示範' }).click();
  await expect(page).toHaveURL(/\/zh-writing\/case-1$/);
  await expect(page.locator('section#zh-exemplar').getByTestId('zh-exemplar-label')).toBeVisible();
  expect(errors).toEqual([]);
});

test('貼上題目被擋下（答案或詳解段落）：問題放在素材欄並加亮，沒有送出', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/zh-writing?tab=paste');
  await page.getByRole('radio', { name: '知性題' }).check();
  await page.getByRole('textbox', { name: '題目（必填）' }).fill(ZH_SAMPLE_QUESTIONS.writingReason);
  await page.getByRole('textbox', { name: '素材（選填）' }).fill('一段素材。\n【解析】這題要先寫贊成的理由，再寫反對的理由。');
  await page.getByRole('button', { name: '下一步：確認點數' }).click();
  const material = page.getByRole('textbox', { name: '素材（選填）' });
  await expect(material).toHaveAttribute('aria-invalid', 'true');
  await expect(material).toBeFocused();
  await expect(page.getByText('命中的位置（刪掉這一段再送出）：')).toBeVisible();
  await expect(page.locator('mark').first()).toContainText('【解析】');
  await expect(page.getByRole('group', { name: '確認點數' })).toHaveCount(0);
  expect(postedBodies(backend)).toEqual([]);
  expect(errors).toEqual([]);
});

test('短的命題作文：不填字數也能送（不再被當成別科）；太短時說要貼引導文字，不提選項或改選科目', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page);
  await page.goto('/zh-writing?tab=paste');
  await page.getByRole('radio', { name: '情意題' }).check();
  const prompt = page.getByRole('textbox', { name: '題目（必填）' });
  await prompt.fill('以「窗」為題寫一篇文章。');
  await page.getByRole('button', { name: '下一步：確認點數' }).click();
  await expect(page.getByText('題目太短了，請把題目的引導文字一起貼上（題目與素材合計至少 10 個字）。')).toBeVisible();
  await expect(page.getByText(/改選科目|選項/)).toHaveCount(0);
  await expect(prompt).toBeFocused();
  await expectNoOverflowAll(page, testInfo);

  const short = '請以「我與一扇窗」為題，寫一篇文章，敘述你的經驗與感受，文長不限。';
  await prompt.fill(short);
  await page.getByRole('button', { name: '下一步：確認點數' }).click();
  const panel = page.getByRole('group', { name: '確認點數' });
  await panel.getByRole('button', { name: '確定，用 8 點' }).click();
  await expect(page).toHaveURL(/\/zh-writing\/case-1$/);
  await expect(page.locator('section#zh-exemplar').getByTestId('zh-exemplar-label')).toBeVisible();
  expect(postedBodies(backend)).toEqual([{ source: 'paste', section: 'zh_writing_emotion', prompt: short }]);
  expect(errors).toEqual([]);
});

test('結果頁的程式還在下載時按「上一頁」：確認面板不卡在「送出中…」，這一題標成「示範產生中」並連到進度', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend } = await setup(page, { pendingPolls: 50 });
  // 慢網路第一次打開：結果頁的程式晚 1.5 秒才到（React 在這段時間保留原本的頁面）。
  let delayed = 0;
  await page.route(/\/assets\/ZhWritingResultPage-[^/]+\.js$/, async (route) => {
    delayed += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.goto('/zh-writing?prompt=zh-111-2');
  const detail = page.getByRole('article', { name: '111 學測國寫・第二大題（情意）' });
  await detail.getByRole('button', { name: '看一篇 AI 示範（8 點）' }).click();
  await detail.getByRole('button', { name: '確定，用 8 點' }).click();
  await expect.poll(() => postedBodies(backend).length).toBe(1);
  // 結果頁的程式正在下載（還沒換頁）時按「上一頁」。
  await expect.poll(() => delayed).toBe(1);
  await expect(page.getByRole('heading', { level: 1, name: /111 學測情意/ })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/zh-writing\?prompt=zh-111-2$/);
  const actions = page.getByTestId('zh-prompt-actions');
  await expect(actions.getByRole('link', { name: '看這一題的進度' })).toHaveAttribute('href', '/zh-writing/case-1');
  await expect(actions.getByText('送出中…')).toHaveCount(0);
  await expect(actions.getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('zh-writing-history').getByRole('link', { name: /111 學測情意/ })).toContainText('示範產生中');
  // 沒有重複送出。
  expect(postedBodies(backend)).toEqual([{ source: 'past', prompt_id: 'zh-111-2' }]);
  expect(errors).toEqual([]);
});

test('失敗：退還說明 →「再試一次（8 點）」→ POST {source:case} → 結果', async ({ page }) => {
  const errors = collectErrors(page);
  const { backend, assist } = await setup(page, { zhExemplarFailure: 'timeout' });
  await page.goto('/zh-writing?prompt=zh-115-2');
  const detail = page.getByRole('article', { name: '115 學測國寫・第二大題（情意）' });
  await expect(detail.getByText('圖的文字描述（本站依題本整理，只抄錄圖上的字）').first()).toBeVisible();
  await detail.getByRole('button', { name: '看一篇 AI 示範（8 點）' }).click();
  await detail.getByRole('button', { name: '確定，用 8 點' }).click();
  const section = page.locator('section#zh-exemplar');
  await expect(section.getByTestId('zh-exemplar-failed')).toHaveText('AI 回應逾時，點數已經退還。');

  assist.options.zhExemplarFailure = undefined;
  await section.getByRole('button', { name: '再試一次（8 點）' }).click();
  await section.getByRole('button', { name: '確定，用 8 點' }).click();
  await expect(section.getByTestId('zh-exemplar-label')).toBeVisible();
  expect(postedBodies(backend)).toEqual([
    { source: 'past', prompt_id: 'zh-115-2' },
    { source: 'case', case_id: 'case-1' },
  ]);
  expect(errors).toEqual([]);
});

test('國寫範文沒開：導覽與學習助手首頁都沒有入口，直接打開是唯讀（說明暫停，沒有選題與貼上）', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await setup(page, {}, FEATURES_SUBJECTS_ON);
  await page.goto('/assistant');
  await expect(page.getByRole('link', { name: /問國文題/ })).toBeVisible();
  await expect(page.locator('a[href="/zh-writing"]')).toHaveCount(0);
  if (isMobile(testInfo)) {
    await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '更多' }).click();
    await expect(page.getByRole('dialog', { name: '全部功能' }).getByRole('link', { name: '國寫範文' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await page.goto('/zh-writing');
  await expect(page.getByText('國寫範文暫停使用中，暫時不能送出新的題目；你之前看過的示範仍然可以看與刪除。')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByTestId('zh-writing-history')).toBeVisible();
  expect(errors).toEqual([]);
});

test('還沒核准：導覽有國寫範文，頁面只說明怎麼申請（沒有選題與貼上）', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await setup(page, {}, FEATURES_ZH_EXEMPLAR_ON, signedInMe());
  await page.goto('/');
  await openFromNav(page, testInfo, '國寫範文');
  await expect(page.getByRole('heading', { level: 1, name: '國寫範文' })).toBeVisible();
  await expect(page.getByText('看 AI 示範要先申請使用 AI。')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expectNoOverflowAll(page, testInfo);
  expect(errors).toEqual([]);
});
