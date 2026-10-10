/**
 * 本站仿真中譯英與作文的 e2e（docs/design/bank-writing.md §7.5）：建置後的產物，桌機與手機各跑一次。
 *
 * /data/writing/bank/* 一律用 page.route 提供 tests/fixtures/bank-writing-public（build-data 的範例輸出，
 * scripts/lib/writing-bank.test.ts 確認它和建置真正產生的一致），不存在的檔回 404；後端用 tests/support/backend.ts 的假 Worker。
 *
 *   1. 功能全關：從 /writing 進列表（依難度、沒有題的難度顯示「出題中」）→ 作答、提示一次一層 → 按對照之前沒有下載 answers 檔
 *      → 對照：參考譯文出現、作答唯讀、自評分隨錯誤數改變 → 重新整理仍是已對照；畫面沒有官方參考譯文、沒有「題目來源：大學入學考試中心」；
 *   2. 作文：圖是 <img alt="">（data: URL），<figure> 裡沒有 <svg>；列表、作答、放大圖、對照區在 375 與 320 px 都不水平捲動；
 *   3. 不可信的 SVG：就算資料檔被竄改（<script>、onload、外部連結），只當圖片載入，腳本不會執行、DOM 裡不會出現 SVG 元素；
 *   4. 深色模式：沒有 console error，圖框維持白底；
 *   5. AI 批改（已核准）：POST /api/submissions 的 group_id 是 ai.tr.0b1c2d@1、小題 #1／#2 → translation-grade → 結果頁輪詢到 graded，
 *      中文題目、AI 出題標示、回到作答頁、參考內容展開才下載；回到列表那張卡是「已完成」；
 *   6. Worker 還不認得這題（400「沒有這個題組」）：說明 AI 批改還在準備中；
 *   7. 題型頁 /translation、/composition：頁首下面的「本站仿真題」就是列表（難度切換、出題中、卡片），點進作答頁，
 *      作答頁的返回連結回到題型頁、停在同一個難度；
 *   8. 正式建置的 /data/writing/bank/*（不是測試資料）裡沒有任何一份歷屆試題的官方參考譯文（D8）。
 * 歷屆題的寫作 e2e（writing.spec.ts）不改，照樣要通過。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CreateSubmissionBody, FeaturesResponse, SubmissionDetail, TranslationBody, TranslationGradingResult } from '@gsat/shared';
import { apiError, collectErrors, fakeBackend, ok, signedInMe } from './support/backend';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(HERE, 'fixtures', 'bank-writing-public');
const PARSED_DIR = path.join(HERE, '..', '..', '..', 'data', 'exams', 'parsed');

const FEATURES_OFF: FeaturesResponse = { auth: false, ai: false, ocr: false, aiPaused: false };
const APPROVED = signedInMe({ ai_status: 'approved' });
const TR_GROUP = 'ai.tr.0b1c2d@1';
const TR_PATH = '/writing/translation/ai/0b1c2d';
const CP_PATH = '/writing/essay/ai/0e1f2a';
const AI_GROUP_LABEL = 'AI 出題・已通過自動驗證・人工審核中';
const REFERENCE_1 = 'In recent years, many students have started to bring their own water bottles to school.';
const BANK_AI_NOT_READY = '這題的 AI 批改還在準備中（網站剛更新），請先用自我檢核，幾分鐘後再試。';
const A1 = 'Many students bring their own water bottles to school.';
const A2 = 'the school store no longer sells bottled water';

type Json = Record<string, unknown>;

/** 假的 /data/writing/bank/*：回測試資料；patch 可以改寫某個檔（rel 是相對 /data/ 的路徑）。 */
async function mockWritingBank(page: Page, patch?: (rel: string, json: Json) => Json) {
  await page.route('**/data/writing/bank/**', (route) => {
    const rel = new URL(route.request().url()).pathname.replace(/^\/data\//, '');
    const file = path.join(FIXTURE_DIR, rel);
    if (!rel.startsWith('writing/bank/') || rel.includes('..') || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    if (patch) return route.fulfill({ json: patch(rel, JSON.parse(readFileSync(file, 'utf8')) as Json) });
    return route.fulfill({ contentType: 'application/json', body: readFileSync(file) });
  });
}

/** 這一頁下載過哪些 /data/writing/bank/ 的檔（相對路徑）。 */
function trackBankRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (req) => {
    const p = new URL(req.url()).pathname;
    if (p.startsWith('/data/writing/bank/')) seen.push(p.replace('/data/writing/bank/', ''));
  });
  return seen;
}

/** 所有歷屆試題的官方參考譯文（只在 repo 的原始資料裡，公開的檔案與畫面都不能出現；D8）。 */
function officialTranslations(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(PARSED_DIR).filter((f) => f.endsWith('.json'))) {
    const exam = JSON.parse(readFileSync(path.join(PARSED_DIR, name), 'utf8')) as { sections: { groups: { questions: Record<string, unknown>[] }[] }[] };
    for (const q of exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions))) {
      if (q['mode'] !== 'translation') continue;
      if (typeof q['answer'] === 'string') out.push(q['answer']);
      if (Array.isArray(q['accepted_answers'])) out.push(...q['accepted_answers'].filter((a): a is string => typeof a === 'string'));
    }
  }
  return out.filter((t) => t.trim().length >= 20);
}

async function expectNoOfficialText(page: Page) {
  const official = officialTranslations();
  expect(official.length).toBeGreaterThan(0);
  const text = await page.locator('body').innerText();
  for (const answer of official) expect(text, '畫面上出現了官方參考譯文').not.toContain(answer);
  expect(text).not.toContain('題目來源：大學入學考試中心');
}

/**
 * 水平捲動（同 practice.spec：比對的寬度取 clientWidth 與設定的視窗寬度中較小的，手機模擬放寬版面視窗時也抓得到）；
 * 手機專案另外縮到 320 px 再檢查一次（WCAG 1.4.10）。
 */
async function expectFitsWidth(page: Page, testInfo: TestInfo) {
  const check = async () => {
    const configured = page.viewportSize()?.width ?? Number.POSITIVE_INFINITY;
    const { scrollWidth, width, offenders } = await page.evaluate((limit) => {
      const root = document.documentElement;
      const w = Math.min(root.clientWidth, limit);
      const out: string[] = [];
      if (root.scrollWidth > w) {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const rect = el.getBoundingClientRect();
          // 放大檢視的圖在自己的捲動框裡，超出的部分不算頁面溢出。
          if (rect.right > w + 1 && !el.closest('.overflow-x-auto')) {
            out.push(`<${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 4).join('.')}> right=${Math.round(rect.right)}`);
            if (out.length >= 8) break;
          }
        }
      }
      return { scrollWidth: root.scrollWidth, width: w, offenders: out };
    }, configured);
    expect(scrollWidth, `頁面寬 ${scrollWidth}px 超出視窗 ${width}px：\n${offenders.join('\n')}`).toBeLessThanOrEqual(width);
  };
  await check();
  if (testInfo.project.name !== 'mobile') return;
  const size = page.viewportSize();
  await page.setViewportSize({ width: 320, height: size?.height ?? 667 });
  await check();
  if (size) await page.setViewportSize(size);
}

function detail(patch: Partial<SubmissionDetail> & Pick<SubmissionDetail, 'id' | 'kind' | 'group_id' | 'status'>): SubmissionDetail {
  return {
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
    ...patch,
  };
}

const BANK_GRADING: TranslationGradingResult = {
  kind: 'translation',
  final_score: 7,
  max_score: 8,
  sentence_scores: [4, 3],
  third_rater_used: false,
  raters: [
    {
      role: 'primary',
      score: 7,
      sentences: [
        { sentence_index: 0, score: 4, part_scores: [1, 1, 1, 1], mechanics_deduction: 0 },
        { sentence_index: 1, score: 3, part_scores: [1, 1, 1, 1], mechanics_deduction: 1 },
      ],
    },
    {
      role: 'second',
      score: 7,
      sentences: [
        { sentence_index: 0, score: 4, part_scores: null, mechanics_deduction: 0 },
        { sentence_index: 1, score: 3, part_scores: null, mechanics_deduction: 1 },
      ],
    },
  ],
  errors: [{ sentence_index: 1, start: 0, end: 3, excerpt: 'the', part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'The', repeat_of: null, deducted: 0.5 }],
  corrected: [A1, 'The school store no longer sells bottled water.'],
  explanation_zh: ['意思完整。', '句首要大寫、句尾要有句點。'],
};

async function fillTranslation(page: Page) {
  const inputs = page.getByRole('textbox', { name: /英文譯文/ });
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(A1);
  await inputs.nth(1).fill(A2);
}

// ───────────────────────── 1. 功能全關：列表、作答、對照 ─────────────────────────

test('功能全關：列表依難度 → 作答、提示 → 對照前不下載 answers → 對照後唯讀與自評 → 重新整理仍是已對照', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { features: FEATURES_OFF });
  await mockWritingBank(page);
  const bankFiles = trackBankRequests(page);

  await page.goto('/writing');
  await page.getByRole('main').getByRole('link', { name: /^本站仿真中譯英/ }).click();
  await expect(page).toHaveURL(/\/writing\/translation\/ai$/);
  await expect(page.getByRole('heading', { level: 1, name: '本站仿真中譯英' })).toBeVisible();
  await expect(page.getByText(AI_GROUP_LABEL).first()).toBeVisible();
  const tiers = page.getByRole('group', { name: '難度' });
  await expect(tiers.getByRole('radio', { name: /穩定基礎/ })).toBeChecked();
  const card = page.getByRole('link', { name: /自備水壺上學/ });
  await expect(card).toHaveAttribute('href', TR_PATH);
  await expectFitsWidth(page, testInfo);

  // 沒有題組的難度：「出題中」，網址記住難度。
  await tiers.getByText(/進階練習/).click();
  await expect(page).toHaveURL(/\?tier=advanced$/);
  await expect(page.getByText(/這個難度還在出題中/)).toBeVisible();
  await page.getByRole('link', { name: '穩定基礎（1）' }).click();
  await expect(page).toHaveURL(/\?tier=basic$/);

  await page.getByRole('link', { name: /自備水壺上學/ }).click();
  await expect(page).toHaveURL(new RegExp(`${TR_PATH}$`));
  await expect(page.getByRole('heading', { level: 1, name: '中譯英：自備水壺上學' })).toBeVisible();
  await expect(page.getByText('近年來，許多學生已經開始自己帶水壺到學校。')).toBeVisible();

  // 提示一次開一層。
  await page.getByRole('button', { name: '第 1 句的提示：看第 1 層（共 3 層）' }).click();
  await page.getByRole('button', { name: '第 1 句的提示：看第 2 層（共 3 層）' }).click();
  await expect(page.getByRole('list', { name: '第 1 句的提示' }).getByRole('listitem')).toHaveCount(2);

  const reveal = page.getByRole('button', { name: '寫好了，對照參考譯文' });
  await expect(reveal).toBeDisabled();
  await fillTranslation(page);
  await expect(reveal).toBeEnabled();
  expect(bankFiles.filter((f) => f.startsWith('answers/'))).toEqual([]);
  await expect(page.getByText(REFERENCE_1)).toHaveCount(0);

  await reveal.click();
  const panelHeading = page.getByRole('heading', { level: 2, name: '對照與自評' });
  await expect(panelHeading).toBeFocused();
  await expect(panelHeading).toBeInViewport();
  await expect(page.getByText(REFERENCE_1)).toBeVisible();
  expect(bankFiles.filter((f) => f.startsWith('answers/'))).toEqual([`answers/${TR_GROUP}.json`]);
  for (const box of await page.getByRole('textbox', { name: /英文譯文/ }).all()) await expect(box).toHaveAttribute('readonly', '');
  // 第 2 句句首小寫、沒有句號：程式各扣 0.5。
  const total = page.getByRole('status').filter({ hasText: /^合計自評/ });
  await expect(total).toHaveText('合計自評 7／8');
  await page.getByRole('button', { name: '第 1 句第 2 部分的錯誤數加一' }).click();
  await expect(total).toHaveText('合計自評 6.5／8');
  await expectFitsWidth(page, testInfo);

  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: '對照與自評' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /英文譯文/ }).first()).toHaveAttribute('readonly', '');
  await expect(page.getByRole('textbox', { name: /英文譯文/ }).first()).toHaveValue(A1);
  await expect(page.getByRole('status').filter({ hasText: /^合計自評/ })).toHaveText('合計自評 6.5／8');

  await expectNoOfficialText(page);
  // 功能全關時不打寫作 API。
  expect(backend.calls.filter((c) => c.path.startsWith('/api/submissions') || c.path.startsWith('/api/ai/'))).toEqual([]);
  expect(errors).toEqual([]);
});

// ───────────────────────── 2–4. 作文：圖、版面、深色模式 ─────────────────────────

test('作文：圖是 <img alt="">（data: URL），figure 裡沒有 svg；列表、作答、放大圖、對照區都不水平捲動', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await fakeBackend(page, { features: FEATURES_OFF });
  await mockWritingBank(page);
  const bankFiles = trackBankRequests(page);

  await page.goto('/writing/essay/ai');
  await expect(page.getByRole('heading', { level: 1, name: '本站仿真作文' })).toBeVisible();
  const card = page.getByRole('link', { name: /打掃時間的分工/ });
  await expect(card).toContainText('附圖 1 張');
  await expectFitsWidth(page, testInfo);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${CP_PATH}$`));
  await expect(page.getByRole('heading', { level: 1, name: '作文：打掃時間的分工' })).toBeVisible();

  const img = page.locator('figure img');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('alt', '');
  await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml;charset=utf-8,/);
  await expect(page.locator('figure svg')).toHaveCount(0);
  await expect(page.locator('figure figcaption')).toContainText('一間高中教室在打掃時間的情景');
  // 圖真的畫得出來（清理過的 SVG 是合法的圖檔）。
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expectFitsWidth(page, testInfo);

  await page.getByRole('button', { name: '放大檢視第 1 張圖' }).click();
  await expect(page.getByRole('button', { name: '縮回第 1 張圖' })).toHaveAttribute('aria-pressed', 'true');
  await expectFitsWidth(page, testInfo);

  await page.getByRole('button', { name: '打開構思圖、大綱與句型開頭' }).click();
  await expect(page.getByRole('heading', { name: '構思圖：打掃時間' })).toBeVisible();
  await expectFitsWidth(page, testInfo);

  const para = Array.from({ length: 65 }, (_, i) => (i === 0 ? 'Students' : 'clean')).join(' ') + '.';
  await page.getByRole('textbox', { name: /你的作文/ }).fill(`${para}\n${para}`);
  expect(bankFiles.some((f) => f.startsWith('answers/'))).toBe(false);
  await page.getByRole('button', { name: '寫好了，看評分規準與範文' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '評分規準與範文' })).toBeFocused();
  await expect(page.getByRole('heading', { name: '內容（0–5 分）' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /你的作文/ })).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '看範文（穩健版、頂標版）' }).click();
  await expect(page.getByRole('region', { name: '穩健版' })).toContainText('AI 生成範文，僅供參考');
  await expect(page.getByRole('region', { name: '穩健版' })).toContainText('The picture shows a classroom during cleaning time.');
  expect(bankFiles.filter((f) => f.startsWith('answers/'))).toEqual(['answers/ai.cp.0e1f2a@1.json']);
  await expectFitsWidth(page, testInfo);
  await expectNoOfficialText(page);
  expect(errors).toEqual([]);
});

test('不可信的 SVG：資料檔被竄改也只當圖片載入，腳本不執行、DOM 裡沒有 SVG 元素', async ({ page }) => {
  const errors = collectErrors(page);
  await fakeBackend(page, { features: FEATURES_OFF });
  const evil =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="window.__pwned=1"><script>window.__pwned=2</script>' +
    '<foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:parent.__pwned=3"></iframe></foreignObject>' +
    '<image href="https://example.invalid/x.png"/><a href="javascript:window.__pwned=4"><rect width="10" height="10"/></a></svg>';
  await mockWritingBank(page, (rel, json) => {
    if (rel !== 'writing/bank/prompts/ai.cp.0e1f2a@1.json') return json;
    const figures = json['figures'] as Json[];
    return { ...json, figures: figures.map((f) => ({ ...f, svg: evil })) };
  });
  const external: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('example.invalid')) external.push(req.url());
  });
  await page.goto(CP_PATH);
  const img = page.locator('figure img');
  await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await img.scrollIntoViewIfNeeded();
  await img.click({ force: true });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator('figure svg, figure script, svg[viewBox="0 0 10 10"], foreignObject, iframe')).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('深色模式：沒有 console error，圖框維持白底，頁面是深色背景', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await fakeBackend(page, { features: FEATURES_OFF });
  await mockWritingBank(page);
  await page.goto('/writing/translation/ai');
  await expect(page.getByRole('link', { name: /自備水壺上學/ })).toBeVisible();
  await page.goto(CP_PATH);
  const img = page.locator('figure img');
  await img.scrollIntoViewIfNeeded();
  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    frame: getComputedStyle(document.querySelector('figure img')?.parentElement ?? document.body).backgroundColor,
  }));
  const luminance = (css: string) => {
    const nums = css.match(/[\d.]+/g)?.map(Number) ?? [];
    const [r = 0, g = 0, b = 0] = css.startsWith('color(') ? nums.map((n) => n * 255) : nums;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  expect(luminance(colors.body), `背景 ${colors.body}`).toBeLessThan(60);
  expect(colors.frame).toBe('rgb(255, 255, 255)');
  await expectFitsWidth(page, testInfo);
  expect(errors).toEqual([]);
});

// ───────────────────────── 5–6. AI 批改 ─────────────────────────

test('AI 批改：group_id 是 ai.tr.0b1c2d@1、小題 #1／#2 → 結果頁有中文題目、AI 出題標示、參考內容；列表顯示「已完成」', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { me: APPROVED });
  await mockWritingBank(page);
  const bankFiles = trackBankRequests(page);
  let body: TranslationBody | null = null;
  let polls = 0;
  backend.on('POST /api/submissions', (call) => {
    const create = call.json as CreateSubmissionBody;
    body = (create.body as TranslationBody | undefined) ?? null;
    return ok(detail({ id: 'sub-b1', kind: 'translation', group_id: create.group_id, status: 'draft', body }), 201);
  });
  backend.on('POST /api/ai/translation-grade', () => ok({ op_id: 'op-b1', submission_id: 'sub-b1', status: 'queued' }, 202));
  backend.on('GET /api/submissions/sub-b1', () => {
    polls += 1;
    const base = { id: 'sub-b1', kind: 'translation' as const, group_id: TR_GROUP, body, op_id: 'op-b1' };
    if (polls === 1) return ok(detail({ ...base, status: 'queued' }));
    return ok(detail({ ...base, status: 'graded', final_score: 7, graded_at: 1_791_500_060, grading: BANK_GRADING }));
  });
  backend.on('GET /api/ai/ops/op-b1', {
    op_id: 'op-b1',
    task: 'translation_grade',
    status: 'settled',
    submission_id: 'sub-b1',
    submission_status: 'graded',
    points_reserved: 3,
    points_charged: 3,
    refund_reason: null,
    created_at: 1_791_500_000,
    settled_at: 1_791_500_060,
  });

  await page.goto(TR_PATH);
  await fillTranslation(page);
  await page.getByRole('button', { name: '送出 AI 批改（3 點）' }).click();
  await expect(page).toHaveURL(/\/writing\/submissions\/sub-b1$/);
  const total = page.getByRole('region', { name: '總分' });
  await expect(total).toBeVisible({ timeout: 10_000 });
  await expect(total).toContainText('7');

  const [create] = backend.callsTo('POST', '/api/submissions');
  expect(create?.json).toEqual({
    kind: 'translation',
    group_id: TR_GROUP,
    input_mode: 'typed',
    body: { items: [{ item_id: `${TR_GROUP}#1`, text: A1 }, { item_id: `${TR_GROUP}#2`, text: A2 }] },
  });
  expect(backend.callsTo('POST', '/api/ai/translation-grade')[0]?.json).toEqual({ submission_id: 'sub-b1' });

  await expect(page.getByRole('heading', { level: 1, name: '本站仿真 中譯英：自備水壺上學' })).toBeVisible();
  await expect(page.getByText(AI_GROUP_LABEL)).toBeVisible();
  await expect(page.getByText('近年來，許多學生已經開始自己帶水壺到學校。')).toBeVisible();
  await expect(page.getByRole('link', { name: '回到題目再練一次' })).toHaveAttribute('href', TR_PATH);
  // 送出前沒有對照：answers 檔要等學生展開參考內容才下載。
  expect(bankFiles.filter((f) => f.startsWith('answers/'))).toEqual([]);
  await page.getByRole('button', { name: '看本站參考譯文與評分規準' }).click();
  await expect(page.getByText(REFERENCE_1)).toBeVisible();
  expect(bankFiles.filter((f) => f.startsWith('answers/'))).toEqual([`answers/${TR_GROUP}.json`]);
  await expectFitsWidth(page, testInfo);
  await expectNoOfficialText(page);

  await page.goto('/writing/translation/ai');
  await expect(page.getByRole('link', { name: /自備水壺上學/ })).toContainText('已完成');
  expect(errors).toEqual([]);
});

test('Worker 還不認得這題（400「沒有這個題組」）：說明 AI 批改還在準備中', async ({ page }) => {
  const errors = collectErrors(page, [/\/api\/submissions$/]);
  const backend = await fakeBackend(page, { me: APPROVED });
  await mockWritingBank(page);
  backend.on('POST /api/submissions', () => ({ status: 400, json: { error: { code: 'bad_request', message: '沒有這個題組' } } }));
  await page.goto(TR_PATH);
  await fillTranslation(page);
  await page.getByRole('button', { name: '送出 AI 批改（3 點）' }).click();
  await expect(page.getByRole('alert')).toContainText(BANK_AI_NOT_READY);
  expect(backend.callsTo('POST', '/api/ai/translation-grade')).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`${TR_PATH}$`));
  expect(errors).toEqual([]);
});

test('其他錯誤（額度不足）照歷屆題的說明', async ({ page }) => {
  const errors = collectErrors(page, [/\/api\/ai\/translation-grade$/]);
  const backend = await fakeBackend(page, { me: APPROVED });
  await mockWritingBank(page);
  backend.on('POST /api/submissions', (call) => ok(detail({ id: 'sub-q', kind: 'translation', group_id: (call.json as CreateSubmissionBody).group_id, status: 'draft' }), 201));
  backend.on('POST /api/ai/translation-grade', () => apiError(429, 'quota_day'));
  await page.goto(TR_PATH);
  await fillTranslation(page);
  await page.getByRole('button', { name: '送出 AI 批改（3 點）' }).click();
  await expect(page.getByRole('alert')).toContainText('今日點數已用完');
  expect(errors).toEqual([]);
});

// ───────────────────────── 7. 資訊頁 ─────────────────────────

test('題型頁：/translation、/composition 頁首下面就是本站仿真題，點進作答頁，返回連結回到題型頁、停在同一個難度', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await fakeBackend(page, { features: FEATURES_OFF });
  await mockWritingBank(page);
  const bankFiles = trackBankRequests(page);
  await page.goto('/translation');
  const bank = page.getByRole('region', { name: '本站仿真題' });
  await expect(bank.getByText(AI_GROUP_LABEL).first()).toBeVisible();
  const tiers = bank.getByRole('group', { name: '難度' });
  await expect(tiers.getByRole('radio', { name: /^穩定基礎/ })).toBeChecked();
  await expect(bank.getByRole('link', { name: /自備水壺上學/ })).toHaveAttribute('href', TR_PATH);
  await expectFitsWidth(page, testInfo);
  // 沒有題組的難度：「出題中」；其他難度的連結留在題型頁。
  await tiers.getByText(/進階練習/).click();
  await expect(page).toHaveURL(/\/translation\?tier=advanced$/);
  await expect(bank.getByText(/這個難度還在出題中/)).toBeVisible();
  await bank.getByRole('link', { name: '穩定基礎（1）' }).click();
  await expect(page).toHaveURL(/\/translation\?tier=basic$/);
  await bank.getByRole('link', { name: /自備水壺上學/ }).click();
  await expect(page).toHaveURL(new RegExp(`${TR_PATH}$`));
  await expect(page.getByRole('heading', { level: 1, name: '中譯英：自備水壺上學' })).toBeVisible();
  const back = page.getByRole('main').getByRole('link', { name: '中譯英', exact: true });
  await expect(back).toHaveAttribute('href', '/translation?tier=basic');
  await back.click();
  await expect(page).toHaveURL(/\/translation\?tier=basic$/);
  // 題型頁只下載列表；作答前的 prompts 是點進作答頁才下載，answers 從頭到尾都沒下載。
  expect(bankFiles.filter((f) => f.startsWith('answers/'))).toEqual([]);

  await page.goto('/composition');
  const cpBank = page.getByRole('region', { name: '本站仿真題' });
  await expect(cpBank).toContainText('兩篇範文（穩健版、頂標版）');
  await cpBank.getByRole('link', { name: /打掃時間的分工/ }).click();
  await expect(page).toHaveURL(new RegExp(`${CP_PATH}$`));
  await expect(page.getByRole('main').getByRole('link', { name: '英文作文', exact: true })).toHaveAttribute('href', '/composition?tier=basic');
  expect(errors).toEqual([]);
});

// ───────────────────────── 8. 正式建置的資料（D8） ─────────────────────────

test('正式建置的 /data/writing/bank/* 沒有任何官方參考譯文；作答前的檔案沒有參考內容', async ({ request }) => {
  const index = (await (await request.get('/data/writing/bank/index.json')).json()) as { groups: Array<{ uid: string; version: number }> };
  expect(index.groups.length).toBeGreaterThan(0);
  const official = officialTranslations();
  expect(official.length).toBeGreaterThan(0);
  const leaks: string[] = [];
  const preAnswerKeys: string[] = [];
  for (const g of index.groups) {
    const prompt = await (await request.get(`/data/writing/bank/prompts/${g.uid}@${g.version}.json`)).text();
    const answers = await (await request.get(`/data/writing/bank/answers/${g.uid}@${g.version}.json`)).text();
    for (const t of official) {
      if (prompt.includes(t)) leaks.push(`prompts/${g.uid}: ${t}`);
      if (answers.includes(t)) leaks.push(`answers/${g.uid}: ${t}`);
    }
    // 作答前就下載的檔不能帶參考內容（對照前不能偷看）。
    for (const key of ['references', 'parts', 'model_texts', 'criteria']) if (prompt.includes(`"${key}"`)) preAnswerKeys.push(`prompts/${g.uid}: ${key}`);
  }
  expect(leaks, '公開的寫作題庫檔裡有官方參考譯文').toEqual([]);
  expect(preAnswerKeys, '題目檔帶了參考內容').toEqual([]);
});
