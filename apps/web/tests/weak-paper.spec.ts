/**
 * 學習助手加強卷（docs/design/weak-paper.md §10.3；建置後的產物＋建置當下的真實題庫 /data/bank/*）：
 *   冷啟動 → 診斷卷；沒有明顯弱點 → 均衡加強卷；錯題清單的入口（焦點）；
 *   主流程：寫入本機作答紀錄 → 預覽的推論數字 → 組 40 分鐘的弱點加強卷 → 本卷針對、作答時間 → 作答、重新整理接續 → 交卷
 *     → 成績單的「這次的弱點表現」、沒有級分與難度建議 → 作答紀錄寫入 → 我的加強卷、預覽數字改變 → 再組一份不重複；
 *   學習報告加權（報告第 1 版第 1 優先）與報告讀不到；隨機抽題卷（閱讀 2 組、混合題 1 組 → 題號 1–12）；
 *   出版社題的出處（page.route 改寫組卷池與來源登記，加一組測試用的 pb 閱讀題組）：作答頁每組上方、卷子頁的題目來源，
 *     同一個組卷池下 /mock 的「組一份新卷」不含那一組；分享（新的 context 打開同一個網址，沒有本卷針對）；
 *   出版社題組的成績單（頁尾不提 AI、檢討試卷的出處與「解析：{出版社}提供」）；
 *   入口（學習助手首頁、/mock、學習報告的待加強與讀書計畫、錯題清單、真題模考成績單）；每個畫面都沒有「大考中心」與 CEEC；
 *   手機 320 px 沒有水平捲動；
 *   PDF（§10.3 的 pdf.spec 項目，W3）：出版社題組的加強卷在卷子頁下載學生卷與教師卷（檔名、%PDF-、下載過記在「我的加強卷」），
 *     有 pdftotext 時再檢查 PDF 的文字層有出處、卷名與作答時間。
 * 都用 ?weakpaper=preview&paperseed=<固定數字>；資料是建置當下的題庫，斷言不依賴某一組題目。
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { FEATURES_ASSISTANT_ON, collectErrors, expectNoHorizontalOverflow, fakeAssist, fakeBackend, fakeReports, signedInMe } from './support/backend';
import { reportDetail } from '../src/features/assistant/testing/report';

const PREVIEW = '?weakpaper=preview&paperseed=20261023';
const FEATURES_OFF = { auth: false, ai: false, ocr: false, aiPaused: false, customEssay: false };
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const CODES = ['vo', 'cz', 'wb', 'st', 'rd', 'mx', 'tr', 'cp'];
const DAY = 86_400_000;

/** bk2 代號 → 每一組的 uid（同 src/features/mock/bank/code2.ts 的 decodeBk2；測試裡自己解）。 */
function uidsOf(paperId: string): string[] {
  const body = paperId.slice(6);
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 7) {
    let value = 0;
    for (const ch of body.slice(i, i + 7)) value = value * 32 + ALPHABET.indexOf(ch);
    value = Math.floor(value / 32);
    const hex = (value % 0x1000000).toString(16).padStart(6, '0');
    const head = Math.floor(value / 0x1000000);
    out.push(`${Math.floor(head / 32) === 1 ? 'pb' : 'ai'}.${CODES[Math.floor(head / 4) % 8]}.${hex}`);
  }
  return out;
}

function paperIdOf(page: Page): string {
  return new URL(page.url()).pathname.split('/').pop() ?? '';
}

async function expectNoCeec(page: Page, where: string) {
  const text = (await page.locator('main').textContent()) ?? '';
  expect(text, `${where}出現了「大考中心」或 CEEC`).not.toMatch(/大考中心|大學入學考試中心|CEEC|ceec\.edu\.tw/i);
}

interface Seed {
  sec: string;
  n: number;
  wrong: number;
  k?: string[];
  t?: string;
}

/** 寫入本機作答紀錄（只在第一次載入時寫，重新整理不覆蓋）與偏好的練習難度。 */
async function seedOutcomes(page: Page, seeds: Seed[], extra: Record<string, string> = {}) {
  const now = Date.now();
  let n = 0;
  const items = seeds.flatMap((s) =>
    Array.from({ length: s.n }, (_, i) => {
      n += 1;
      const code = { vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx' }[s.sec] ?? 'rd';
      const uid = `ai.${code}.e2${n.toString(16).padStart(4, '0')}`;
      // 答錯的排前面（同一時間時依順序取「最近 6 題」），不會被當成最近有進步。
      return { s: 'bank', r: `${uid}@1`, g: uid, l: '1', sec: s.sec, t: s.t ?? 'advanced', k: s.k ?? [], ok: i < s.wrong ? 0 : 1, a: i < s.wrong ? 'B' : 'A', key: 'A', first: 1, at: now - DAY };
    }),
  );
  await page.addInitScript(
    ({ items, extra }) => {
      if (window.localStorage.getItem('e2e-seeded') === '1') return;
      window.localStorage.setItem('gsat-assist:v1:outcomes', JSON.stringify({ v: 1, items }));
      window.localStorage.setItem('gsat-assist:v1:prefs', JSON.stringify({ practice_tier: 'advanced' }));
      window.localStorage.setItem('gsat-assist:v1:backfilled', '1');
      for (const [k, v] of Object.entries(extra)) window.localStorage.setItem(k, v);
      window.localStorage.setItem('e2e-seeded', '1');
    },
    { items, extra },
  );
}

const PB_UID = 'pb.rd.e2e001';
const PB_ATTRIBUTION = '本題出自測試出版社《116 學測英文模擬試題（第一回）》，經授權使用';

/**
 * 組卷池（進階練習的閱讀）多一組測試用的出版社題組（ex: 'ns'，src: pub-e2e），來源登記多一個測試出版社，
 * 題組檔用一組本站閱讀題組的內容換成出版社的 uid 與出處。回傳取得那份題組檔內容的函式（分享的 context 要用）。
 */
async function routePublisherReading(page: Page): Promise<() => Record<string, unknown> | null> {
  let template: Record<string, unknown> | null = null;
  await page.route('**/data/bank/mock-pool.json', async (route) => {
    const res = await route.fetch();
    const pool = (await res.json()) as { tiers: Record<string, Record<string, Record<string, unknown>[]>> };
    // 正式資料裡的出版社題組先拿掉，這個測試只看自己塞的那一組（題庫有真的出版社題之後也不受影響）。
    for (const sections of Object.values(pool.tiers)) {
      for (const [k, list] of Object.entries(sections)) sections[k] = list.filter((e) => !e['src']);
    }
    const reading = pool.tiers['advanced']?.['reading'] ?? [];
    const ai = reading.find((e) => e['fig'] === null && e['form'] === 'continuous') ?? reading[0];
    reading.push({ ...ai, uid: PB_UID, v: 1, sw: [], theme: ['z:e2e出版社'], ex: 'ns', src: 'pub-e2e' });
    reading.sort((a, b) => String(a['uid']).localeCompare(String(b['uid'])));
    await route.fulfill({ response: res, json: pool });
  });
  await page.route('**/data/bank/sources.json', async (route) => {
    const res = await route.fetch();
    const reg = (await res.json()) as { sources: { ns?: string }[] };
    reg.sources = reg.sources.filter((s) => s.ns !== 'pb');
    reg.sources.push({
      id: 'pub-e2e',
      ns: 'pb',
      kind: 'publisher',
      label_zh: '測試出版社',
      publisher_zh: '測試出版股份有限公司',
      product_zh: '116 學測英文模擬試題（第一回）',
      attribution_zh: PB_ATTRIBUTION,
      scope: ['web', 'pdf', 'ai_assist'],
      active: true,
      retired_on: null,
      ends_on: null,
    });
    await route.fulfill({ response: res, json: reg });
  });
  await page.route(`**/data/bank/groups/${PB_UID}@1.json`, async (route) => {
    // 用一組本站閱讀題組當內容，換成出版社的 uid 與出處。
    const pool = (await (await page.request.get('/data/bank/mock-pool.json')).json()) as { tiers: Record<string, Record<string, { uid: string; v: number; fig: unknown; form: string }[]>> };
    const ai = (pool.tiers['advanced']?.['reading'] ?? []).find((e) => e.fig === null && e.form === 'continuous');
    template ??= (await (await page.request.get(`/data/bank/groups/${ai?.uid}@${ai?.v}.json`)).json()) as Record<string, unknown>;
    await route.fulfill({
      json: {
        ...template,
        uid: PB_UID,
        version: 1,
        source: { id: 'pub-e2e', label_zh: '測試出版社', product_zh: '116 學測英文模擬試題（第一回）', attribution_zh: PB_ATTRIBUTION, ref_text: '原卷第 41–44 題' },
        skills: {},
      },
    });
  });
  return () => template;
}

/** 組卷頁組一份隨機抽題卷：進階練習、只勾測試出版社、閱讀 1 組（一定是那一組出版社題組）。 */
async function buildPublisherPaper(page: Page): Promise<void> {
  await page.goto(`/assistant/papers${PREVIEW}&kind=r`);
  const settings = page.getByRole('region', { name: '設定（隨機抽題卷）' });
  for (const s of ['詞彙題', '綜合測驗', '文意選填', '篇章結構']) await settings.getByRole('button', { name: `減少${s}` }).click();
  await settings.getByRole('button', { name: '減少閱讀測驗' }).click();
  await settings.getByRole('checkbox', { name: '進階練習' }).check();
  await settings.getByRole('checkbox', { name: '穩定基礎' }).uncheck();
  await settings.getByRole('checkbox', { name: /測試出版社/ }).check();
  await settings.getByRole('checkbox', { name: /本站題庫/ }).uncheck();
  await page.getByRole('button', { name: /^組卷：隨機抽題卷/ }).click();
  await expect(page).toHaveURL(/\/mock\/bk2-r-/);
  expect(uidsOf(paperIdOf(page))).toEqual([PB_UID]);
}

/** 下載 PDF：檔名（無頭 Chromium 的 POSIX 語系會改成 download，兩種都接受）、%PDF- 開頭；回傳存檔的路徑。 */
async function downloadPdf(page: Page, button: ReturnType<Page['getByRole']>, outPath: string, expectedName: RegExp): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await button.click();
  const download = await downloadPromise;
  const name = download.suggestedFilename();
  expect(name === 'download' || expectedName.test(name), `檔名 ${name}`).toBe(true);
  await download.saveAs(outPath);
  expect((await readFile(outPath)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  return outPath;
}

/** PDF 的文字層（pdftotext；沒有安裝 poppler 時回傳 null，那一段檢查略過）。比對時去掉空白。 */
function pdfText(file: string): string | null {
  try {
    return execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }).replace(/\s+/gu, '');
  } catch {
    return null;
  }
}

const MAIN_FLOW: Seed[] = [
  { sec: 'reading', n: 10, wrong: 7, k: ['it:inference'] },
  { sec: 'reading', n: 20, wrong: 4, k: ['it:detail'] },
  { sec: 'structure', n: 10, wrong: 2, k: ['cl:contrast'] },
];

test.describe('加強卷', () => {
  test('冷啟動：弱點加強卷停用，先做一份診斷卷 → bk2-m，卷子頁寫「這份是診斷卷」', async ({ page }, testInfo) => {
    await fakeBackend(page, { features: FEATURES_OFF });
    const errors = collectErrors(page);
    await page.goto(`/assistant/papers${PREVIEW}`);
    await expect(page.getByRole('heading', { level: 1, name: '加強卷' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /弱點加強卷/ })).toBeDisabled();
    await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
    await page.getByRole('button', { name: '先做一份診斷卷' }).click();
    await expect(page).toHaveURL(/\/mock\/bk2-m-[0-9a-hjkmnp-tv-z]{77}$/);
    await expect(page.getByTestId('paper-info')).toContainText('這份是診斷卷');
    await expect(page.getByRole('heading', { level: 1, name: /^診斷卷（.+）$/ })).toBeVisible();
    await expect(page.getByText(/^100 分鐘・滿分 100 分・53 題$/)).toBeVisible();
    await expectNoCeec(page, '診斷卷的卷子頁');
    expect(errors).toEqual([]);
  });

  test('沒有明顯弱點：三個按鈕；組一份均衡加強卷 → bk2-w，卷子頁寫「這次不是針對弱點」', async ({ page }) => {
    await fakeBackend(page, { features: FEATURES_OFF });
    await seedOutcomes(page, [
      { sec: 'vocabulary', n: 10, wrong: 2 },
      { sec: 'cloze', n: 10, wrong: 2 },
      { sec: 'word_bank', n: 8, wrong: 2 },
      { sec: 'reading', n: 12, wrong: 3 },
    ]);
    await page.goto(`/assistant/papers${PREVIEW}`);
    const block = page.getByTestId('no-weakness');
    await expect(block).toContainText('沒有明顯的弱點');
    await expect(block.getByRole('button')).toHaveCount(3);
    await block.getByRole('button', { name: '組一份均衡加強卷' }).click();
    await expect(page).toHaveURL(/\/mock\/bk2-w-/);
    await expect(page.getByTestId('paper-targets')).toContainText('這次不是針對弱點');
  });

  test('錯題清單：用目前篩選的錯題組一份加強卷 → 預覽第一行「依你篩選的錯題」，組得出卷子', async ({ page }) => {
    await fakeBackend(page, { features: FEATURES_ASSISTANT_ON });
    await seedOutcomes(page, [
      { sec: 'vocabulary', n: 6, wrong: 6, k: ['sn:core'] },
      { sec: 'vocabulary', n: 20, wrong: 0, k: ['sn:core'] },
    ]);
    await page.goto(`/assistant/mistakes${PREVIEW}`);
    const link = page.getByRole('link', { name: '用目前篩選的錯題組一份加強卷' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/assistant\/papers\?.*from=mistakes/);
    const preview = page.getByTestId('paper-preview');
    await expect(preview.getByText(/^依你篩選的錯題（6 題）：詞彙題/)).toBeVisible();
    await preview.getByRole('button', { name: /^組卷：弱點加強卷/ }).click();
    await expect(page).toHaveURL(/\/mock\/bk2-w-/);
  });

  test('主流程：預覽 → 組卷 → 作答與接續 → 交卷 → 弱點表現 → 紀錄回流 → 再組一份不重複', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const mobile = testInfo.project.name === 'mobile';
    await fakeBackend(page, { features: FEATURES_OFF });
    const errors = collectErrors(page);
    await seedOutcomes(page, MAIN_FLOW);

    await page.goto(`/assistant/papers${PREVIEW}`);
    const preview = page.getByTestId('paper-preview');
    const inference = preview.getByText(/^推論（閱讀）：答對 30%（10 題）/);
    await expect(inference).toBeVisible();
    const before = (await inference.textContent()) ?? '';
    await expectNoCeec(page, '組卷頁');
    await expectNoHorizontalOverflow(page, mobile);

    await page.getByRole('radio', { name: '約 40 分鐘' }).check();
    // 按鈕寫預估的分鐘數，和組出來的卷子相同。
    const build = preview.getByRole('button', { name: /^組卷：弱點加強卷・約 (35|40|45) 分鐘$/ });
    const estimated = Number(/約 (\d+) 分鐘/.exec((await build.textContent()) ?? '')?.[1]);
    await build.click();
    await expect(page).toHaveURL(/\/mock\/bk2-w-[0-9a-hjkmnp-tv-z]+$/);
    const firstId = paperIdOf(page);
    await expect(page.getByRole('heading', { level: 1, name: '弱點加強卷' })).toBeVisible();
    await expect(page.getByTestId('paper-targets')).toContainText('推論');
    await expect(page.getByText(/^(35|40|45) 分鐘・滿分 \d+ 分・\d+ 題$/)).toBeVisible();
    const minutes = Number(((await page.getByText(/^(35|40|45) 分鐘・滿分/).textContent()) ?? '').slice(0, 2));
    expect(minutes).toBe(estimated);
    await expectNoCeec(page, '卷子頁');
    await expectNoHorizontalOverflow(page, mobile);

    // 開考、答第 1 題、重新整理接續；倒數從這份卷子自己的分鐘數起算。
    await page.getByRole('button', { name: '不預估，直接開始' }).click();
    await expect(page.getByRole('timer')).toHaveAccessibleName(new RegExp(`^剩餘時間 (${minutes} 分鐘|${minutes - 1} 分)`));
    const q1 = page.locator('#q-1').getByRole('radio').first();
    await q1.check();
    await page.reload();
    await expect(page.getByText(/已接續上次的作答進度/)).toBeVisible();
    await page.getByRole('navigation', { name: '大題導覽' }).getByRole('button', { name: /^1\. / }).click();
    await expect(page.locator('#q-1').getByRole('radio').first()).toBeChecked();
    await expectNoCeec(page, '作答頁');

    // 交卷 → 成績單。
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    await page.getByRole('dialog', { name: '確定要交卷嗎？' }).getByRole('button', { name: '確定交卷' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '弱點加強卷成績單' })).toBeVisible();
    await expect(page.getByTestId('drill-targets')).toContainText('這次的弱點表現');
    await expect(page.getByTestId('drill-targets')).toContainText('推論（閱讀）');
    await expect(page.getByRole('heading', { name: '下一步建議' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/\d\s*級分|五標位置/);
    await expectNoCeec(page, '成績單');
    await expectNoHorizontalOverflow(page, mobile);

    // 作答紀錄多了這份卷子的題目（s: bank_mock、p 是代號）。
    const recorded = await page.evaluate((id) => {
      const log = JSON.parse(window.localStorage.getItem('gsat-assist:v1:outcomes') ?? '{"items":[]}') as { items: { s: string; p?: string }[] };
      return log.items.filter((e) => e.s === 'bank_mock' && e.p === id).length;
    }, firstId);
    expect(recorded).toBeGreaterThan(10);

    // 回組卷頁：我的加強卷有這一份；預覽的推論數字改變；再組一份和第一份沒有交集。
    await page.goto(`/assistant/papers${PREVIEW}`);
    const mine = page.getByRole('region', { name: '我的加強卷（這台裝置）' });
    await expect(mine.getByText(/^弱點加強卷 W-[0-9A-Z]{5}$/)).toBeVisible();
    await expect(mine).toContainText('已交卷');
    const after = (await page.getByTestId('paper-preview').getByText(/^推論（閱讀）：/).textContent()) ?? '';
    expect(after).not.toBe(before);
    await page.getByTestId('paper-preview').getByRole('button', { name: /^組卷：弱點加強卷/ }).click();
    await expect(page).toHaveURL(/\/mock\/bk2-w-/);
    const second = uidsOf(paperIdOf(page));
    const first = new Set(uidsOf(firstId));
    expect(second.filter((u) => first.has(u))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('學習報告加權：第 1 版第 1 優先的延伸義出現在預覽；報告讀不到時照常能組卷', async ({ page }) => {
    const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: signedInMe({ ai_status: 'approved' }) });
    const reports = fakeReports(backend);
    const base = reportDetail();
    reports.reports.push({
      ...base,
      id: '00000000-0000-4000-8000-000000000001',
      version: 1,
      status: 'done',
      created_at: Math.floor(Date.now() / 1000) - 3600,
      report: base.report ? { ...base.report, weaknesses: [{ ...base.report.weaknesses[0]!, area: 'sn:extended', priority: 1 }] } : null,
    });
    backend.on('GET /api/assist/cases', { cases: [], next_cursor: null, error_counts: {} });
    await seedOutcomes(page, MAIN_FLOW);
    await page.goto(`/assistant/papers${PREVIEW}`);
    await expect(page.getByTestId('paper-preview').getByText(/學習報告第 1 版（\d+\/\d+）列為第 1 優先：延伸義/)).toBeVisible();

    backend.on('GET /api/assist/reports', () => ({ status: 500, json: { error: { code: 'internal', message: 'e2e' } } }));
    await page.reload();
    await expect(page.getByTestId('paper-preview')).toContainText('學習報告讀不到');
    await page.getByTestId('paper-preview').getByRole('button', { name: /^組卷：弱點加強卷/ }).click();
    await expect(page).toHaveURL(/\/mock\/bk2-w-/);
  });

  test('隨機抽題卷：閱讀 2 組、混合題 1 組 → 只有這兩個大題、題號 1–12', async ({ page }) => {
    await fakeBackend(page, { features: FEATURES_OFF });
    await page.goto(`/assistant/papers${PREVIEW}&kind=r`);
    const settings = page.getByRole('region', { name: '設定（隨機抽題卷）' });
    for (const s of ['詞彙題', '綜合測驗', '文意選填', '篇章結構']) await settings.getByRole('button', { name: `減少${s}` }).click();
    await settings.getByRole('button', { name: '增加混合題' }).click();
    await expect(settings).toContainText('約 30 分鐘、12 題');
    await page.getByRole('button', { name: '組卷：隨機抽題卷・約 30 分鐘' }).click();
    await expect(page).toHaveURL(/\/mock\/bk2-r-/);
    await expect(page.getByRole('heading', { level: 1, name: '隨機抽題卷' })).toBeVisible();
    await expect(page.getByText(/^30 分鐘・滿分 \d+ 分・12 題$/)).toBeVisible();
    // 開考前頁沒有實考模式（不到 60 分鐘）。
    await expect(page.getByText('實考模式', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '不預估，直接開始' }).click();
    const nav = page.getByRole('navigation', { name: '大題導覽' });
    await expect(nav.getByRole('button')).toHaveCount(2);
    await expect(page.locator('#q-1')).toBeAttached();
    await expect(page.locator('#q-13')).toHaveCount(0);
  });

  test('出版社題的出處：作答頁每組上方、卷子頁的題目來源；/mock 的自組卷不含它；分享的 context 沒有本卷針對', async ({ page, browser }) => {
    await fakeBackend(page, { features: FEATURES_OFF });
    const pbUid = PB_UID;
    const templateOf = await routePublisherReading(page);
    await buildPublisherPaper(page);
    const paperUrl = page.url();
    await expect(page.getByTestId('paper-sources')).toContainText(PB_ATTRIBUTION);
    await page.getByRole('button', { name: '不預估，直接開始' }).click();
    await expect(page.getByTestId('group-source').first()).toContainText('出處：測試出版社《116 學測英文模擬試題（第一回）》原卷第 41–44 題・經授權使用');

    // 交卷 → 成績單：全部是出版社題，頁尾不提 AI；檢討試卷每組上方有出處、解析標「解析：測試出版社提供」。
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    await page.getByRole('dialog', { name: '確定要交卷嗎？' }).getByRole('button', { name: '確定交卷' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '隨機抽題卷成績單' })).toBeVisible();
    const note = page.getByTestId('bank-source-note');
    await expect(note).toContainText('模擬分數僅供參考。');
    await expect(note).not.toContainText('AI 撰寫');
    await page.getByRole('button', { name: '展開檢討試卷（本站答案與解析）' }).click();
    await expect(page.getByTestId('group-source').first()).toContainText('出處：測試出版社《116 學測英文模擬試題（第一回）》原卷第 41–44 題・經授權使用');
    await expect(page.getByText('解析：測試出版社提供').first()).toBeVisible();
    await expect(page.getByTestId('explanation-card').getByText('AI 撰寫')).toHaveCount(0);

    // 同一個組卷池下，/mock 的「組一份新卷」（bk1）不含那一組。
    await page.goto('/mock?bankmock=preview&bankmockseed=20261020');
    const section = page.getByRole('region', { name: '本站自組模擬考' });
    await section.getByRole('radio', { name: /進階練習/ }).check();
    await section.getByRole('button', { name: '組一份新卷：進階練習' }).click();
    await expect(page).toHaveURL(/\/mock\/bk1-a-/);
    expect(page.url()).not.toContain('pb');

    // 分享：新的 context 打開同一個網址，題目相同、沒有本卷針對。
    const other = await browser.newContext();
    const shared = await other.newPage();
    await fakeBackend(shared, { features: FEATURES_OFF });
    const template = templateOf();
    await shared.route(`**/data/bank/groups/${pbUid}@1.json`, (route) => route.fulfill({ json: { ...template, uid: pbUid, version: 1, source: { id: 'pub-e2e', label_zh: '測試出版社', product_zh: null, attribution_zh: '本題出自測試出版社，經授權使用', ref_text: null }, skills: {} } }));
    await shared.route('**/data/bank/sources.json', async (route) => {
      const res = await route.fetch();
      const reg = (await res.json()) as { sources: unknown[] };
      reg.sources.push({ id: 'pub-e2e', ns: 'pb', kind: 'publisher', label_zh: '測試出版社', publisher_zh: null, product_zh: null, attribution_zh: '本題出自測試出版社，經授權使用', scope: ['web', 'pdf'], active: true, retired_on: null, ends_on: null });
      await route.fulfill({ response: res, json: reg });
    });
    await shared.route('**/data/bank/mock-pool.json', async (route) => {
      const res = await route.fetch();
      const pool = (await res.json()) as { tiers: Record<string, Record<string, Record<string, unknown>[]>> };
      const reading = pool.tiers['advanced']?.['reading'] ?? [];
      reading.push({ ...(reading[0] ?? {}), uid: pbUid, v: 1, sw: [], fig: null, form: 'continuous', theme: [], ex: 'ns', src: 'pub-e2e' });
      await route.fulfill({ response: res, json: pool });
    });
    await shared.goto(paperUrl);
    await expect(shared.getByRole('heading', { level: 1, name: '隨機抽題卷' })).toBeVisible();
    await expect(shared.getByTestId('paper-targets')).toHaveCount(0);
    expect(new URL(shared.url()).pathname).toBe(new URL(paperUrl).pathname);
    await other.close();
  });

  test('PDF：出版社題組的加強卷下載學生卷與教師卷；檔名、出處、卷名與作答時間；下載過記在我的加強卷', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await fakeBackend(page, { features: FEATURES_OFF });
    await page.addInitScript(() => window.localStorage.setItem('gsat-pdf-preview', '1'));
    const errors = collectErrors(page);
    await routePublisherReading(page);
    await buildPublisherPaper(page);
    const paperId = paperIdOf(page);
    const region = page.getByRole('region', { name: '下載考試格式 PDF' });
    await expect(region).toBeVisible();
    // 全部是出版社題：說明寫題目出自出版社，不寫 AI 撰寫。
    await expect(region.getByText(/本站自組試卷，題目出自出版社模擬試題（經授權）/)).toBeVisible();
    await expect(region.getByRole('radio', { name: /^學生卷/ })).toBeChecked();
    await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');

    const button = region.getByRole('button', { name: '下載 PDF' });
    const student = await downloadPdf(page, button, testInfo.outputPath('weak-student.pdf'), /^學測英文中心_加強卷_R-[0-9A-Z]{5}_學生卷\.pdf$/);
    await region.getByRole('radio', { name: /^教師卷/ }).check();
    const teacher = await downloadPdf(page, button, testInfo.outputPath('weak-teacher.pdf'), /^學測英文中心_加強卷_R-[0-9A-Z]{5}_教師卷\.pdf$/);

    const studentText = pdfText(student);
    const teacherText = pdfText(teacher);
    if (studentText === null || teacherText === null) {
      testInfo.annotations.push({ type: 'skip-text', description: '沒有 pdftotext，略過 PDF 文字層的檢查' });
    } else {
      // 封面：卷名、卷別、作答時間（閱讀 1 組 → 10 分鐘）、題目來源；題本那一組的出處；資料來源頁的出版社聲明；頁尾聲明。
      for (const expected of ['學習助手加強卷', '隨機抽題卷', '考試時間：10分鐘', '測試出版社《116學測英文模擬試題（第一回）》（經授權使用）', '測試出版社《116學測英文模擬試題（第一回）》原卷第41–44題・經授權使用', '不得另行轉載', '題目出自各出版社模擬試題（經授權），非官方試題']) {
        expect(studentText, `學生卷沒有「${expected}」`).toContain(expected);
      }
      expect(studentText).not.toMatch(/大考中心|CEEC|自組模擬考|題目由AI撰寫/i);
      expect(teacherText).toContain('教師卷：答案與解析');
      expect(teacherText).toContain('作答時間10分鐘');
      expect(teacherText).not.toMatch(/大考中心|CEEC|自組模擬考/i);
    }

    // 下載過（pdfAt）記在「我的加強卷」（加強卷自己的清單，不是自組模擬考的）。
    const pdfAt = await page.evaluate((id) => {
      const list = JSON.parse(window.localStorage.getItem('gsat-weakpaper:v1:papers') ?? '[]') as { id: string; pdfAt?: string }[];
      return list.find((p) => p.id === id)?.pdfAt ?? null;
    }, paperId);
    expect(pdfAt).not.toBeNull();
    expect(await page.evaluate(() => window.localStorage.getItem('gsat-bankmock:v1:papers'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('入口：學習助手首頁、/mock、學習報告（待加強、讀書計畫）、真題模考成績單；開關打開時都在', async ({ page }) => {
    const backend = await fakeBackend(page, { features: FEATURES_ASSISTANT_ON, me: signedInMe({ ai_status: 'approved' }) });
    fakeAssist(backend);
    const reports = fakeReports(backend);
    const id = '00000000-0000-4000-8000-000000000001';
    reports.reports.push({ ...reportDetail(), id, version: 1, status: 'done', created_at: Math.floor(Date.now() / 1000) - 3600 });
    await page.route('**/data/bank/index.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'e2e', count: 0, groups: [] }) }));
    await page.goto('/assistant');
    await expect(page.getByRole('link', { name: /加強卷/ }).first()).toHaveAttribute('href', '/assistant/papers');
    await page.goto('/mock');
    await expect(page.getByRole('link', { name: '依弱點組卷、隨機抽題 →' })).toHaveAttribute('href', '/assistant/papers');

    // 學習報告：「待加強」下方帶這一版的 id；讀書計畫的題型練習與模擬考項目有「組加強卷」。
    await page.goto('/assistant/report/1');
    await expect(page.getByRole('link', { name: '依這些弱點組一份加強卷' })).toHaveAttribute('href', `/assistant/papers?kind=w&from=report&report=${id}`);
    const plan = page.getByRole('link', { name: /^組加強卷（/ });
    expect(await plan.count()).toBeGreaterThan(0);
    await expect(plan.first()).toHaveAttribute('href', /^\/assistant\/papers\?kind=(w|f)/);

    // 真題模考的成績單（錯 3 題以上）：「針對這份的錯題組一份加強卷」帶 attempt。
    await page.evaluate(() => {
      const now = new Date();
      const started = new Date(now.getTime() - 90 * 60_000).toISOString();
      const at = now.toISOString();
      const attempt = { v: 1, examId: 'gsat-115', mode: 'exam', answers: { '1': 'B' }, revealed: [], timeLimitSec: 6000, elapsedSec: 5400, startedAt: started, updatedAt: at, submittedAt: at, submitReason: 'manual', result: { earned: 1, autoMax: 66 } };
      const record = { v: 1, id: 'e2e-weak-entry', paperId: 'gsat-115', strict: false, predictedScore: null, startedAt: started, deadlineAt: new Date(now.getTime() + 600_000).toISOString(), durationSec: 6000, status: 'submitted', submittedAt: at, submitReason: 'manual', activeSectionId: 's1', sectionTimeSec: {}, awaySec: 0, marked: [], selfScores: {}, selfDetail: {}, scaleYear: 115, attempt };
      window.localStorage.setItem('gsat-mock:v1:attempt:e2e-weak-entry', JSON.stringify(record));
    });
    await page.goto('/mock/report/e2e-weak-entry');
    await expect(page.getByRole('link', { name: '針對這份的錯題組一份加強卷' })).toHaveAttribute('href', '/assistant/papers?kind=w&from=attempt%3Ae2e-weak-entry');
  });
});
