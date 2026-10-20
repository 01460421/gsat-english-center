/**
 * 本站自組模擬考（docs/design/bank-mock.md §10.4；建置後的產物＋建置當下的真實題庫 /data/bank/mock-pool.json）：
 *   /mock 的區塊與跳轉連結 → 組一份穩定基礎卷（預覽模式的固定種子）→ 卷子頁（卷號、AI 標示、本站的規則文字）→ 作答、閱讀的圖表或表格
 *   → 重新整理後接續 → 交卷 → 成績單（原得總分、難度建議、沒有級分）→ /mock 的「我組過的卷子」與作答紀錄 → 再組一份（題組不重複）
 *   → 本卷資訊的「組一份新卷」回到 /mock 時捲到區塊；
 *   分享連結（新的 context 打開同一份；大寫＋.p 的網址轉到標準網址）、格式不對的代號、每個畫面都沒有「大考中心」與 CEEC。
 * 資料是建置當下的題庫，所以斷言不依賴某一組題目（題組的內容從 /data 讀）。PDF 的流程在 WP3（tests/pdf.spec.ts）。
 * 桌機與手機（playwright.config.ts 的兩個 project）各跑一次；手機另外在 320px 檢查沒有水平捲動。
 */
import { expect, test, type Page } from '@playwright/test';
import { collectErrors, expectNoHorizontalOverflow, fakeBackend } from './support/backend';

/** 預覽模式＋固定種子（只給 e2e 用，src/features/mock/bank/flags.ts）。 */
const PREVIEW = '?bankmock=preview&bankmockseed=20261020';
/** 主流程裡第二份卷子的固定種子。 */
const PREVIEW_SECOND = '?bankmock=preview&bankmockseed=20261021';

/** 不登入、AI 關閉：模擬考不需要後端（SessionProvider 每一頁都會讀 /api/features）。 */
const FEATURES_OFF = { auth: false, ai: false, ocr: false, aiPaused: false, customEssay: false };

/** 標準代號：bk1-{難度}-66 個 base32 字元。 */
const PAPER_URL = /\/mock\/bk1-b-[0-9a-hjkmnp-tv-z]{66}$/;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const SLOT_CODES = ['vo', 'cz', 'cz', 'wb', 'st', 'rd', 'rd', 'rd', 'mx', 'tr', 'cp'];

/** 代號 → 11 個題組（uid@版本），同 src/features/mock/bank/code.ts 的 decodePaperId（測試裡自己解，不匯入 App 的程式）。 */
function slotsOf(paperId: string): { uid: string; v: number }[] {
  const body = paperId.slice(6);
  return SLOT_CODES.map((code, i) => {
    let value = 0;
    for (const ch of body.slice(i * 6, i * 6 + 6)) value = value * 32 + ALPHABET.indexOf(ch);
    return { uid: `ai.${code}.${Math.floor(value / 64).toString(16).padStart(6, '0')}`, v: value % 64 };
  });
}

function paperIdOf(page: Page): string {
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

/** 頁面主要內容（<main>）的文字沒有「大考中心」與 CEEC。 */
async function expectNoCeec(page: Page, where: string) {
  const text = (await page.locator('main').textContent()) ?? '';
  expect(text, `${where}出現了「大考中心」或 CEEC`).not.toMatch(/大考中心|大學入學考試中心|CEEC|ceec\.edu\.tw/i);
}

test.beforeEach(async ({ page }) => {
  await fakeBackend(page, { features: FEATURES_OFF });
});

test('/mock：本站自組模擬考的區塊、頁首的跳轉連結；region「卷別」仍是 6 張卡片', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.goto('/mock');
  const section = page.getByRole('region', { name: '本站自組模擬考' });
  await expect(section).toBeVisible();
  await expect(page.getByRole('region', { name: '卷別' }).getByRole('article')).toHaveCount(6);
  await expect(page.getByRole('link', { name: /也可以從本站題庫依難度組一份新卷/ })).toHaveAttribute('href', '#bank-mock');
  await expect(page.getByText('級分與五標只適用於歷屆卷。', { exact: false })).toBeVisible();
  await expect(page.getByText(/本站自組模擬考的題目由 AI 撰寫/)).toBeVisible();
  // 組卷池下載完才顯示「還可以組約 N 份全新的卷子」。
  await expect(section.getByText(/還可以組約 \d+ 份全新的卷子/).first()).toBeVisible();
  await expect(section.getByRole('radio')).toHaveCount(3);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect(errors).toEqual([]);
});

test('組卷 → 作答 → 重新整理接續 → 交卷 → 成績單 → 我組過的卷子 → 再組一份不重複', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const mobile = testInfo.project.name === 'mobile';
  const errors = collectErrors(page);

  await page.goto(`/mock${PREVIEW}`);
  const section = page.getByRole('region', { name: '本站自組模擬考' });
  await section.getByRole('radio', { name: /穩定基礎/ }).check();
  await section.getByRole('button', { name: '組一份新卷：穩定基礎' }).click();

  // 卷子頁：卷號、AI 標示；開考前的規則沒有「全國答對率」，有本站的規則文字。
  await expect(page).toHaveURL(PAPER_URL);
  const firstId = paperIdOf(page);
  await expect(page.getByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考' })).toBeVisible();
  const info = page.getByTestId('paper-info');
  await expect(info).toContainText(/卷號\s*B-[0-9A-Z]{5}/);
  const code = ((await info.textContent()) ?? '').match(/B-[0-9A-Z]{5}/)?.[0] ?? '';
  await expect(info).toContainText('AI 出題・已通過自動驗證・人工審核中');
  await expect(page.getByText('考試中不提供答案與提示；交卷後在成績單看本站的答案與解析。')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('全國答對率');
  await expectNoCeec(page, '卷子頁');
  await expectNoHorizontalOverflow(page, mobile);

  // 開始作答，答第 1 題（第一個選項）。
  await page.getByRole('button', { name: '不預估，直接開始' }).click();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/^剩餘時間 (100 分鐘|99 分)/);
  const q1 = page.locator('#q-1').getByRole('radio').first();
  await q1.check();
  await expect(q1).toBeChecked();

  // 每個大題的作答畫面都沒有「大考中心」；閱讀測驗有圖表（svg）或表格，畫面上沒有它的文字描述（描述可能洩漏答案）。
  const nav = page.getByRole('navigation', { name: '大題導覽' });
  for (let i = 1; i <= 8; i += 1) {
    await nav.getByRole('button', { name: new RegExp(`^${i}\\. `) }).click();
    await expectNoCeec(page, `第 ${i} 個大題`);
  }
  await nav.getByRole('button', { name: /^5\. 閱讀測驗/ }).click();
  const figure = page.locator('[data-testid="chart-figure"], [data-testid="table-figure"]').first();
  await expect(figure).toBeVisible();
  const reading = slotsOf(firstId)[5];
  const groupFile = await page.request.get(`/data/bank/groups/${reading?.uid}@${reading?.v}.json`);
  expect(groupFile.ok()).toBe(true);
  const group = (await groupFile.json()) as { group: { figures: { description: string }[] } };
  const description = group.group.figures[0]?.description.trim() ?? '';
  // 描述的第一句常是「折線圖」「表格」之類的通用詞，所以比對後面帶資料的片段。
  const fragment = description.slice(10, 40);
  if (fragment.length >= 8) expect((await page.locator('main').textContent()) ?? '').not.toContain(fragment);
  await expectNoHorizontalOverflow(page, mobile);

  // 重新整理：答案與剩餘時間都還在。
  await page.reload();
  await expect(page.getByText(/已接續上次的作答進度/)).toBeVisible();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/^剩餘時間 (100 分鐘|99 分)/);
  await page.getByRole('navigation', { name: '大題導覽' }).getByRole('button', { name: /^1\. / }).click();
  await expect(page.locator('#q-1').getByRole('radio').first()).toBeChecked();

  // 交卷。
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
  await expect(dialog).toContainText('還有 52 題沒有作答');
  await dialog.getByRole('button', { name: '確定交卷' }).click();

  // 成績單：原得總分、難度建議；沒有級分、五標。
  await expect(page.getByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考成績單' })).toBeVisible();
  await expect(page).toHaveURL(/\/mock\/report\/[\w-]+$/);
  await expect(page.getByRole('region', { name: '原得總分' })).toContainText(/[01]／100/);
  await expect(page.getByRole('heading', { name: '下一步建議' })).toBeVisible();
  await expect(page.getByRole('region', { name: '級分（非官方換算）' })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/\d\s*級分|五標位置/);
  await expect(page.getByTestId('bank-translation-key').first()).toBeVisible();
  await expectNoCeec(page, '成績單');
  await page.getByRole('button', { name: /展開檢討試卷/ }).click();
  await expect(page.locator('#q-1').getByTestId('question-feedback')).toBeVisible();
  await expectNoCeec(page, '檢討試卷');
  await expectNoHorizontalOverflow(page, mobile);

  // 回 /mock：我組過的卷子有這一份（已交卷 1 次），作答紀錄的名稱是卷名、不是代號。
  await page.getByRole('link', { name: '回模擬考列表' }).click();
  const mine = page.getByRole('region', { name: '我組過的卷子（這台裝置）' });
  await expect(mine).toContainText(`穩定基礎 ${code}`);
  await expect(mine).toContainText('已交卷 1 次');
  const history = page.getByRole('region', { name: '作答紀錄' });
  await expect(history).toContainText(`本站自組（穩定基礎）${code}`);
  await expect(history).not.toContainText('bk1-');

  // 再組一份（第一份已經開考過）：11 個題組和第一份沒有交集。「回模擬考列表」的連結不帶預覽參數，
  // 所以重新打開帶第二個固定種子的網址（同一個 context，第一份仍記為做過），每次跑都是同一份卷子。
  await page.goto(`/mock${PREVIEW_SECOND}`);
  await page.getByRole('region', { name: '本站自組模擬考' }).getByRole('button', { name: '組一份新卷：穩定基礎' }).click();
  await expect(page).toHaveURL(PAPER_URL);
  const secondId = paperIdOf(page);
  expect(secondId).not.toBe(firstId);
  const firstUids = new Set(slotsOf(firstId).map((s) => s.uid));
  expect(slotsOf(secondId).filter((s) => firstUids.has(s.uid))).toEqual([]);

  // 本卷資訊的「組一份新卷（穩定基礎）」：回到 /mock 時直接捲到區塊（程式已經載入過，Layout 換頁回到頂端不能把它蓋掉），
  // 焦點在區塊標題上。
  await page.getByTestId('paper-info').getByRole('link', { name: '組一份新卷（穩定基礎）' }).click();
  await expect(page).toHaveURL(/\/mock\?tier=basic#bank-mock$/);
  await expect(page.getByRole('heading', { level: 2, name: '本站自組模擬考' })).toBeFocused();
  await expect(page.getByRole('region', { name: '本站自組模擬考' })).toBeInViewport();
  expect(errors).toEqual([]);
});

test('分享：新的瀏覽器打開同一個網址是同一份卷子；大寫＋.p 的網址轉到標準網址', async ({ page, browser }) => {
  const errors = collectErrors(page);
  await page.goto(`/mock${PREVIEW}`);
  await page.getByRole('region', { name: '本站自組模擬考' }).getByRole('button', { name: /^組一份新卷：/ }).click();
  await expect(page).toHaveURL(/\/mock\/bk1-[bat]-[0-9a-hjkmnp-tv-z]{66}$/);
  const paperId = paperIdOf(page);
  const info = page.getByTestId('paper-info');
  await expect(info).toContainText(/卷號\s*[BAT]-[0-9A-Z]{5}/);
  const code = ((await info.textContent()) ?? '').match(/[BAT]-[0-9A-Z]{5}/)?.[0] ?? '';
  await page.getByRole('button', { name: '不預估，直接開始' }).click();
  const stem = ((await page.locator('#q-1').textContent()) ?? '').trim();

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await fakeBackend(page2, { features: FEATURES_OFF });
  const errors2 = collectErrors(page2);
  await page2.goto(`/mock/${paperId}`);
  await expect(page2.getByTestId('paper-info')).toContainText(code);
  await page2.getByRole('button', { name: '不預估，直接開始' }).click();
  expect(((await page2.locator('#q-1').textContent()) ?? '').trim()).toBe(stem);

  // 從 PDF 的 QR code 進來：大寫網址＋.p，轉成標準網址（代號不變）。
  await page2.goto(`/mock/${paperId.toUpperCase()}.p`);
  await expect(page2).toHaveURL(new RegExp(`/mock/${paperId}$`));
  await expect(page2.getByRole('heading', { level: 1, name: /模擬考$/ })).toBeVisible();
  await other.close();
  expect(errors).toEqual([]);
  expect(errors2).toEqual([]);
});

test('格式不對的代號：找不到這份試卷，不發任何資料請求', async ({ page }) => {
  const errors = collectErrors(page);
  const dataRequests: string[] = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/data/bank')) dataRequests.push(req.url());
  });
  // 合法代號的最後一個字元換成不在 base32 字母表裡的 u。
  await page.goto(`/mock/bk1-b-${'0'.repeat(65)}u`);
  await expect(page.getByRole('heading', { level: 1, name: '找不到這份試卷' })).toBeVisible();
  await expect(page.getByRole('link', { name: '回模擬考列表' }).last()).toBeVisible();
  expect(dataRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('功能已上線：沒開預覽也看得到區塊（BANK_MOCK_ENABLED），?bankmock=off 只關掉預覽', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/mock?bankmock=off');
  await expect(page.getByRole('region', { name: '本站自組模擬考' })).toBeVisible();
  const history = await page.evaluate(() => window.localStorage.getItem('gsat-bankmock-preview'));
  expect(history).toBeNull();
  expect(errors).toEqual([]);
});
