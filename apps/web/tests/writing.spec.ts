/**
 * 寫作練習＋AI 批改的 e2e（建置後的產物＋真的 /data/writing/*.json；後端用 tests/support/backend.ts 的假 Worker）：
 *   1. 後端沒部署（/api/* 回 HTML 404）：首頁、寫作頁照常，沒有登入按鈕、沒有 AI 送出按鈕，中譯英自我檢核可用；
 *   2. 中譯英 AI 批改：建立提交 → 202 → 輪詢（queued → graded）→ 分數、錯誤加亮、AI 標示；
 *   3. 手寫作文拍照：上傳（前端縮圖成 JPEG）→ 辨識 → 逐行確認 → 批改 → 四項分數；
 *   4. 額度不足：顯示中文原因與下次重置時間，重送沿用同一份草稿。
 * 每個流程都檢查畫面上沒有大考中心的官方參考譯文（站主決定 D8）。桌機與手機各跑一次。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type {
  CreateSubmissionBody,
  EssayGradingResult,
  OcrResult,
  SubmissionDetail,
  TranslationBody,
  TranslationGradingResult,
} from '@gsat/shared';
import { QUOTA, apiError, collectErrors, expectNoHorizontalOverflow, fakeBackend, ok, signedInMe } from './support/backend';

const APPROVED = signedInMe({ ai_status: 'approved' });
const TRANSLATION_GROUP = 'gsat-115.s7g1@1';
const ESSAY_GROUP = 'gsat-115.s8g1@1';

/** 115 學測中譯英的官方參考譯文：只在 repo 的原始資料裡，公開的資料檔與畫面都不能出現（D8）。 */
function officialTranslations(): string[] {
  const raw = readFileSync(new URL('../../../data/exams/parsed/gsat-115.json', import.meta.url), 'utf8');
  const exam = JSON.parse(raw) as { sections: { groups: { questions: Record<string, unknown>[] }[] }[] };
  const answers: string[] = [];
  for (const q of exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions))) {
    if (q['mode'] !== 'translation') continue;
    if (typeof q['answer'] === 'string') answers.push(q['answer']);
    if (Array.isArray(q['accepted_answers'])) answers.push(...q['accepted_answers'].filter((a): a is string => typeof a === 'string'));
  }
  return answers;
}

async function expectNoOfficialTranslation(page: Page) {
  const official = officialTranslations();
  expect(official.length).toBeGreaterThan(0);
  const text = await page.locator('body').innerText();
  for (const answer of official) expect(text, '畫面上出現了官方參考譯文').not.toContain(answer);
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

// ───────────────────────── 中譯英 ─────────────────────────

const T1 = 'More and more high school English teacher have increase the percentage of using English in class.';
const T2 = 'they divide students into different groups.';

const TRANSLATION_GRADING: TranslationGradingResult = {
  kind: 'translation',
  final_score: 5.75,
  max_score: 8,
  sentence_scores: [3, 2.75],
  third_rater_used: false,
  raters: [
    {
      role: 'primary',
      score: 5.5,
      sentences: [
        { sentence_index: 0, score: 3, part_scores: [1, 0.5, 0.5, 1], mechanics_deduction: 0 },
        { sentence_index: 1, score: 2.5, part_scores: [1, 1, 0.5, 0.5], mechanics_deduction: 0.5 },
      ],
    },
    {
      role: 'second',
      score: 6,
      sentences: [
        { sentence_index: 0, score: 3, part_scores: null, mechanics_deduction: 0 },
        { sentence_index: 1, score: 3, part_scores: null, mechanics_deduction: 0 },
      ],
    },
  ],
  errors: [
    { sentence_index: 0, start: 34, end: 41, excerpt: 'teacher', part: 1, category: 'grammar', explanation_zh: 'more and more 後面接複數名詞。', suggestion: 'teachers', repeat_of: null, deducted: 0.5 },
    { sentence_index: 0, start: 47, end: 55, excerpt: 'increase', part: 2, category: 'grammar', explanation_zh: '完成式要用過去分詞。', suggestion: 'increased', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, start: 0, end: 4, excerpt: 'they', part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'They', repeat_of: null, deducted: 0.5 },
  ],
  corrected: ['More and more high school English teachers have increased the percentage of English used in class.', 'They divide students into different groups.'],
  explanation_zh: ['注意單複數與完成式。', '句首要大寫。'],
};

async function fillTranslation(page: Page) {
  const inputs = page.getByRole('textbox', { name: '英文譯文' });
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(T1);
  await inputs.nth(1).fill(T2);
}

test('後端沒部署：首頁與寫作頁照常、沒有登入按鈕，中譯英可以自我檢核', async ({ page }, testInfo) => {
  // /api/* 回 HTML 404 時瀏覽器會印「Failed to load resource」（網路層紀錄）；程式自己不能有任何 console error。
  const errors = collectErrors(page, [/\/api\/(features|health)$/]);
  const backend = await fakeBackend(page, { features: 'not-deployed' });
  const noLogin = async () => {
    // 等 /api/features 的結果回來（載入中本來就不顯示登入按鈕，太早檢查等於沒檢查）。
    await page.waitForLoadState('networkidle');
    // 任何連到 Worker 登入端點的連結都不該出現（首頁卡片的說明文字提到「登入」不算）。
    await expect(page.locator('a[href*="/auth/"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^(登入|使用 Google 登入|用 Google 登入)$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /帳號選單/ })).toHaveCount(0);
  };

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '學測英文中心' })).toBeVisible();
  await expect(page.getByText('後端未連線')).toBeVisible();
  await noLogin();

  await page.goto('/writing');
  await expect(page.getByRole('heading', { level: 1, name: '寫作練習' })).toBeVisible();
  await expect(page.getByText('AI 批改即將開放。')).toBeVisible();
  await noLogin();
  await page.getByRole('main').getByRole('link', { name: /^中譯英/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '中譯英題目' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: /115 學測/ }).first().click();

  await expect(page).toHaveURL(/\/writing\/translation\/gsat-115$/);
  await expect(page.getByRole('heading', { level: 1, name: '115 學測 中譯英' })).toBeVisible();
  await fillTranslation(page);
  await expect(page.getByRole('button', { name: /送出 AI 批改/ })).toHaveCount(0);
  await expect(page.getByText('AI 批改即將開放。')).toBeVisible();

  await page.getByRole('button', { name: '自我檢核（不用 AI）' }).click();
  const selfCheck = page.locator('#t-self-check');
  // 面板在送出卡片下方：打開後要捲進畫面、焦點移到標題（手機上原本會落在底部導覽列後面，像沒反應）。
  await expect(selfCheck.getByRole('heading', { name: '自我檢核' })).toBeInViewport();
  await expect(selfCheck.getByRole('heading', { name: '自我檢核' })).toBeFocused();
  // 程式找到的機械性問題：第 2 句句首沒大寫。
  await expect(selfCheck.getByText(/第 2 句：/).locator('..')).toContainText('大寫');
  const checklist = selfCheck.getByRole('group', { name: /^檢核清單/ });
  await checklist.getByRole('checkbox').first().check();
  await expect(checklist).toHaveAccessibleName(/^檢核清單（1／\d+）$/);
  await selfCheck.getByRole('group', { name: '第 1 句找到的錯誤數' }).getByRole('button', { name: '多一個錯誤' }).click();
  await selfCheck.getByRole('group', { name: '第 2 句找到的錯誤數' }).getByRole('button', { name: '多一個錯誤' }).click();
  await selfCheck.getByRole('group', { name: '第 2 句找到的錯誤數' }).getByRole('button', { name: '多一個錯誤' }).click();
  await expect(selfCheck.getByText('自評總分：6.5／8')).toBeVisible();

  await expectNoOfficialTranslation(page);
  // 公開的資料檔本身也不能有（靜態檔任何人都下載得到）。
  const data = await (await page.request.get('/data/writing/translation.json')).text();
  for (const answer of officialTranslations()) expect(data).not.toContain(answer);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');

  // 功能全關時只打 /api/features（和首頁的 /api/health），不打 /api/me 或任何 AI 端點。
  expect([...new Set(backend.calls.map((c) => c.path))].sort()).toEqual(['/api/features', '/api/health']);
  expect(errors).toEqual([]);
});

test('中譯英 AI 批改：建立提交、202、輪詢 queued → graded，顯示分數與錯誤加亮', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { me: APPROVED });
  let body: TranslationBody | null = null;
  let polls = 0;
  backend.on('POST /api/submissions', (call) => {
    const create = call.json as CreateSubmissionBody;
    body = (create.body as TranslationBody | undefined) ?? null;
    return ok(detail({ id: 'sub-t1', kind: 'translation', group_id: create.group_id, status: 'draft', body }), 201);
  });
  backend.on('POST /api/ai/translation-grade', () => ok({ op_id: 'op-t1', submission_id: 'sub-t1', status: 'queued' }, 202));
  backend.on('GET /api/submissions/sub-t1', () => {
    polls += 1;
    const base = { id: 'sub-t1', kind: 'translation' as const, group_id: TRANSLATION_GROUP, body, op_id: 'op-t1' };
    // 第一次輪詢還在排隊，之後就批改完成。
    if (polls === 1) return ok(detail({ ...base, status: 'queued' }));
    return ok(detail({ ...base, status: 'graded', final_score: 5.75, graded_at: 1_791_500_060, grading: TRANSLATION_GRADING }));
  });
  backend.on('GET /api/ai/ops/op-t1', {
    op_id: 'op-t1',
    task: 'translation_grade',
    status: 'settled',
    submission_id: 'sub-t1',
    submission_status: 'graded',
    points_reserved: 3,
    points_charged: 3,
    refund_reason: null,
    created_at: 1_791_500_000,
    settled_at: 1_791_500_060,
  });

  await page.goto('/writing/translation/gsat-115');
  await fillTranslation(page);
  await expect(page.getByTestId('quota-summary')).toContainText('今天剩 20／30 點');
  await page.getByRole('button', { name: '送出 AI 批改（3 點）' }).click();

  await expect(page).toHaveURL(/\/writing\/submissions\/sub-t1$/);
  await expect(page.getByText('排隊等待批改…')).toBeVisible();
  const total = page.getByRole('region', { name: '總分' });
  await expect(total).toBeVisible({ timeout: 10_000 });
  expect(polls).toBeGreaterThanOrEqual(2);

  // 送出的內容：題組 id、小題 id 照契約（writingGroupId／writingItemId），送出任務只帶提交 id。
  const [create] = backend.callsTo('POST', '/api/submissions');
  expect(create?.json).toEqual({
    kind: 'translation',
    group_id: TRANSLATION_GROUP,
    input_mode: 'typed',
    body: { items: [{ item_id: `${TRANSLATION_GROUP}#中譯英1`, text: T1 }, { item_id: `${TRANSLATION_GROUP}#中譯英2`, text: T2 }] },
  });
  expect(backend.callsTo('POST', '/api/ai/translation-grade')[0]?.json).toEqual({ submission_id: 'sub-t1' });

  // 分數與 AI 標示。
  await expect(total).toContainText('5.75');
  await expect(total).toContainText('／ 8');
  await expect(total.getByText('AI 批改，僅供參考')).toBeVisible();
  await expect(page.getByText('你正在和 AI 互動').first()).toBeVisible();
  await expect(page.getByText('這次批改扣 3 點')).toBeVisible();

  // 錯誤在學生原文上加亮（位置依 excerpt 找回），旁邊有編號，下方列出說明與建議。
  const s1 = page.getByRole('region', { name: '第 1 句', exact: true });
  await expect(s1).toContainText('3／4 分');
  await expect(s1.locator('mark', { hasText: /^teacher$/ })).toBeVisible();
  await expect(s1.locator('mark', { hasText: /^increase$/ })).toBeVisible();
  await expect(s1.getByRole('listitem').filter({ hasText: 'more and more 後面接複數名詞。' })).toContainText('扣 0.5 分');
  await expect(s1.getByText('保留你原意的修正版')).toBeVisible();
  const s2 = page.getByRole('region', { name: '第 2 句', exact: true });
  await expect(s2).toContainText('2.75／4 分');
  await expect(s2.locator('mark', { hasText: /^they$/ })).toBeVisible();
  await expect(s2.getByRole('listitem').filter({ hasText: '句首要大寫。' })).toContainText('大小寫');

  await expectNoOfficialTranslation(page);
  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect(errors).toEqual([]);
});

test('批改中閘道回 HTML 502 不會停住；登入過期時說明原因並給重新登入與再試一次', async ({ page }) => {
  // 這個測試刻意讓輪詢回 502 與 401：瀏覽器的網路層紀錄不算程式錯誤。
  const errors = collectErrors(page, [/\/api\/submissions\/sub-r[12]$/]);
  const backend = await fakeBackend(page, { me: APPROVED });
  const base = { kind: 'translation' as const, group_id: TRANSLATION_GROUP, body: { items: [{ item_id: `${TRANSLATION_GROUP}#中譯英1`, text: T1 }, { item_id: `${TRANSLATION_GROUP}#中譯英2`, text: T2 }] } };
  const graded = (id: string) => ok(detail({ ...base, id, status: 'graded', final_score: 5.75, grading: TRANSLATION_GRADING }));

  // 1. 第 2 次輪詢遇到 Vercel／Cloudflare 的 HTML 502：顯示「連線不穩」、照節奏重試，之後拿到結果。
  let polls1 = 0;
  backend.on('GET /api/submissions/sub-r1', () => {
    polls1 += 1;
    if (polls1 === 1) return ok(detail({ ...base, id: 'sub-r1', status: 'queued' }));
    if (polls1 === 2) return { status: 502, body: '<!doctype html><title>502 Bad Gateway</title>', contentType: 'text/html' };
    return graded('sub-r1');
  });
  await page.goto('/writing/submissions/sub-r1');
  await expect(page.getByText('排隊等待批改…')).toBeVisible();
  await expect(page.getByText('連線不穩，正在重試…')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/尚未開放/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: '總分' })).toContainText('5.75', { timeout: 5_000 });
  expect(polls1).toBe(3);

  // 2. 批改中 session 過期（401）：停止輪詢，畫面不再說「會自動更新」，有重新登入與再試一次；批改中不給刪除。
  let polls2 = 0;
  let expired = true;
  backend.on('GET /api/submissions/sub-r2', () => {
    polls2 += 1;
    if (polls2 === 1) return ok(detail({ ...base, id: 'sub-r2', status: 'grading' }));
    if (expired) return apiError(401, 'unauthorized');
    return graded('sub-r2');
  });
  await page.goto('/writing/submissions/sub-r2');
  await expect(page.getByText(/這一頁會自動更新/)).toBeVisible();
  const alert = page.getByRole('alert').filter({ hasText: '登入已過期' });
  await expect(alert).toBeVisible({ timeout: 5_000 });
  await expect(alert.getByRole('link', { name: '重新登入' })).toHaveAttribute('href', '/auth/google/start?next=%2Fwriting%2Fsubmissions%2Fsub-r2');
  await expect(page.getByText(/這一頁會自動更新/)).toHaveCount(0);
  await expect(page.getByText(/自動更新已停止/)).toBeVisible();
  await expect(page.getByRole('button', { name: '刪除這份紀錄' })).toHaveCount(0);
  expired = false;
  await page.getByRole('button', { name: '再試一次' }).click();
  await expect(page.getByRole('region', { name: '總分' })).toContainText('5.75');

  await expectNoOfficialTranslation(page);
  expect(errors).toEqual([]);
});

// ───────────────────────── 手寫作文 ─────────────────────────

const OCR_TEXT =
  'In recent years, more and more people treat pets like [[?]].\nIn the pictures, we can see a man carry his dog.\n\nI think there are two reason for this.';
const CONFIRMED_TEXT = OCR_TEXT.replace('[[?]]', 'children');
const OCR: OcrResult = {
  text: OCR_TEXT,
  uncertain: [{ start: OCR_TEXT.indexOf('[[?]]'), end: OCR_TEXT.indexOf('[[?]]') + 5, candidates: ['children', 'chidren'] }],
  confirmed_at: null,
};

const ESSAY_GRADING: EssayGradingResult = {
  kind: 'essay',
  final_score: 12.5,
  max_score: 20,
  band: 'fair',
  third_rater_used: false,
  off_topic: false,
  criteria: {
    content: { score: 3.5, explanation_zh: '內容切題但細節不足。' },
    organization: { score: 3.5, explanation_zh: '分兩段、有轉折。' },
    grammar: { score: 3, explanation_zh: '感官動詞後的動詞形式錯誤。' },
    vocabulary: { score: 2.5, explanation_zh: '用字重複。' },
  },
  raters: [
    { role: 'primary', scores: { content: 4, organization: 4, grammar: 3, vocabulary: 3 }, off_topic: false, total: 13, comment_zh: '第一位的評語。' },
    { role: 'second', scores: { content: 3, organization: 3, grammar: 3, vocabulary: 2 }, off_topic: false, total: 12, comment_zh: '第二位的評語。' },
  ],
  deductions: [{ code: 'too_short', points: 1 }],
  word_count: 32,
  paragraphs: 2,
  top_improvements: ['加一個具體經驗。', '注意感官動詞。', '寫到 120 個單詞。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '第二段要說明影響。' }],
  errors: [
    { paragraph_index: 0, start: 0, end: 0, excerpt: 'carry', category: 'grammar', explanation_zh: 'see + 受詞 + V-ing。', suggestion: 'carrying' },
    { paragraph_index: 1, start: 0, end: 0, excerpt: 'reason', category: 'spelling', explanation_zh: 'two 後面接複數。', suggestion: 'reasons' },
  ],
  rewrite: null,
  safety_flag: null,
};

/** 測試用的「手寫稿照片」：2000×1500 的 PNG（比上限 1600 px 大，前端要先縮圖再上傳）。 */
async function handwritingPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1500;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d 不可用');
    ctx.fillStyle = '#fdfdf8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#c8d4e8';
    for (let y = 160; y < canvas.height; y += 110) {
      ctx.beginPath();
      ctx.moveTo(80, y);
      ctx.lineTo(canvas.width - 80, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#1b2a4a';
    ctx.font = 'italic 64px serif';
    const lines = ['In recent years, more and more people', 'treat pets like children. In the pictures,', 'we can see a man carry his dog.', '', 'I think there are two reason for this.'];
    lines.forEach((line, i) => ctx.fillText(line, 120, 145 + i * 110));
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** JPEG 的寬高（讀 SOF 區段）。不是 JPEG 回 null。 */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1] ?? 0;
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

/** multipart 本體裡的第一個 JPEG（從 SOI 到 EOI）。 */
function jpegInMultipart(body: Buffer): Buffer | null {
  const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const end = body.lastIndexOf(Buffer.from([0xff, 0xd9]));
  return start >= 0 && end > start ? body.subarray(start, end + 2) : null;
}

test('手寫作文拍照：上傳縮圖後的照片 → 確認辨識文字 → 批改 → 四項分數', async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const backend = await fakeBackend(page, { me: APPROVED });
  let stage: 'draft' | 'ocr' | 'confirmed' | 'grading' = 'draft';
  let ocrPolls = 0;
  let gradePolls = 0;
  let confirmedText = '';
  const base = { id: 'sub-e1', kind: 'essay' as const, group_id: ESSAY_GROUP, input_mode: 'photo' as const };
  const photoMeta = { id: 'ph-1', ord: 1, bytes: 0, width: 1600, height: 1200, created_at: 1_791_500_010 };

  backend.on('POST /api/submissions', () => ok(detail({ ...base, status: 'draft', body: { text: '' } }), 201));
  backend.on('POST /api/submissions/sub-e1/photos', (call) => {
    photoMeta.bytes = call.request.postDataBuffer()?.length ?? 0;
    return ok({ photos: [photoMeta] });
  });
  backend.on('POST /api/ai/essay-ocr', () => {
    stage = 'ocr';
    return ok({ op_id: 'op-o1', submission_id: 'sub-e1', status: 'ocr_queued' }, 202);
  });
  backend.on('PUT /api/submissions/sub-e1/confirm', (call) => {
    confirmedText = (call.json as { text: string }).text;
    stage = 'confirmed';
    return ok(
      detail({ ...base, status: 'confirmed', body: { text: confirmedText }, op_id: 'op-o1', word_count: 32, paragraphs: 2, ocr: { ...OCR, confirmed_at: 1_791_500_050 } }),
    );
  });
  backend.on('POST /api/ai/essay-grade', () => {
    stage = 'grading';
    return ok({ op_id: 'op-e1', submission_id: 'sub-e1', status: 'queued' }, 202);
  });
  backend.on('GET /api/submissions/sub-e1', () => {
    if (stage === 'ocr') {
      ocrPolls += 1;
      return ok(
        ocrPolls === 1
          ? detail({ ...base, status: 'ocr_queued', body: { text: '' }, op_id: 'op-o1', photos: [photoMeta] })
          : detail({ ...base, status: 'ocr_ready', body: { text: '' }, op_id: 'op-o1', ocr: OCR }),
      );
    }
    if (stage === 'grading') {
      gradePolls += 1;
      const graded = { ...base, body: { text: confirmedText }, op_id: 'op-e1', word_count: 32, paragraphs: 2 };
      return ok(
        gradePolls === 1
          ? detail({ ...graded, status: 'queued' })
          : detail({ ...graded, status: 'graded', final_score: 12.5, final_band: 'fair', graded_at: 1_791_500_120, grading: ESSAY_GRADING }),
      );
    }
    return ok(detail({ ...base, status: stage === 'confirmed' ? 'confirmed' : 'draft', body: { text: confirmedText } }));
  });
  backend.on('GET /api/ai/ops/op-e1', {
    op_id: 'op-e1',
    task: 'essay_grade',
    status: 'settled',
    submission_id: 'sub-e1',
    submission_status: 'graded',
    points_reserved: 7,
    points_charged: 7,
    refund_reason: null,
    created_at: 1_791_500_060,
    settled_at: 1_791_500_120,
  });

  await page.goto('/writing/essay/gsat-115');
  await expect(page.getByRole('heading', { level: 1, name: '115 學測 英文作文' })).toBeVisible();
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  const photo = await handwritingPhoto(page);
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'essay.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('img', { name: '第 1 張作文照片預覽' })).toBeVisible();
  // 前端先縮到長邊 1600 px。
  await expect(page.getByText(/第 1 張・1600×1200・/)).toBeVisible();
  await page.getByRole('button', { name: '上傳並辨識（2 點）' }).click();

  await expect(page).toHaveURL(/\/writing\/submissions\/sub-e1$/);
  await expect(page.getByText('AI 正在辨識你的手寫字…')).toBeVisible();

  // 上傳的是重新編碼過的 JPEG（去掉 EXIF）、長邊 ≤1600、每張 ≤1.2 MB，一次一張（ord=1）。
  const [upload] = backend.callsTo('POST', '/api/submissions/sub-e1/photos');
  expect(upload?.query.get('ord')).toBe('1');
  const multipart = upload?.request.postDataBuffer() ?? Buffer.alloc(0);
  expect(multipart.toString('latin1')).toContain('name="photo"');
  expect(multipart.toString('latin1')).toMatch(/Content-Type: image\/jpeg/i);
  const jpeg = jpegInMultipart(multipart);
  expect(jpeg, '上傳的內容不是 JPEG').not.toBeNull();
  expect(jpeg?.length ?? Infinity).toBeLessThanOrEqual(1_200_000);
  expect(jpegSize(jpeg ?? Buffer.alloc(0))).toEqual({ width: 1600, height: 1200 });
  expect(backend.callsTo('POST', '/api/submissions')[0]?.json).toMatchObject({ kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'photo' });

  // 逐行確認：看不清楚的地方（[[?]]）加亮、點候選字換上，全部處理完才能確認。
  const confirmBox = page.getByRole('region', { name: '確認辨識文字' });
  await expect(confirmBox).toBeVisible({ timeout: 10_000 });
  await expect(confirmBox.getByText('AI 批改，僅供參考')).toBeVisible();
  await expect(confirmBox).toContainText('還有 1 個看不清楚的地方沒處理');
  const confirmButton = confirmBox.getByRole('button', { name: '確認文字' });
  await expect(confirmButton).toBeDisabled();
  await confirmBox.getByRole('button', { name: 'children', exact: true }).click();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(page.getByRole('heading', { name: '已確認的作文' })).toBeVisible();
  expect(confirmedText).toBe(CONFIRMED_TEXT);
  await page.getByRole('button', { name: '送出 AI 批改（7 點）' }).click();
  await expect(page.getByText('排隊等待批改…')).toBeVisible();

  const total = page.getByRole('region', { name: '總分' });
  await expect(total).toBeVisible({ timeout: 10_000 });
  await expect(total).toContainText('12.5');
  await expect(total).toContainText('／ 20');
  await expect(total).toContainText('等級：可');
  await expect(total.getByText('AI 批改，僅供參考')).toBeVisible();
  const criteria: Array<[string, string]> = [
    ['內容', '3.5／5'],
    ['組織', '3.5／5'],
    ['文法句構', '3／5'],
    ['字彙拼字', '2.5／5'],
  ];
  for (const [label, score] of criteria) {
    await expect(total.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })).toContainText(score);
  }
  await expect(page.getByText('這次批改扣 7 點（照片辨識另計 2 點）')).toBeVisible();
  expect(backend.callsTo('POST', '/api/ai/essay-grade')[0]?.json).toEqual({ submission_id: 'sub-e1' });

  await expectNoHorizontalOverflow(page, testInfo.project.name === 'mobile');
  expect(errors).toEqual([]);
});

// ───────────────────────── 額度不足 ─────────────────────────

test('額度不足：顯示中文原因與下次重置時間，重送沿用同一份草稿', async ({ page }) => {
  // 這個測試刻意讓送出任務回 429：瀏覽器的網路層紀錄不算程式錯誤。
  const errors = collectErrors(page, [/\/api\/ai\/translation-grade$/]);
  const backend = await fakeBackend(page, {
    me: APPROVED,
    quota: { ...QUOTA, points: { day_used: 30, day_limit: 30, month_used: 120, month_limit: 300 } },
  });
  const draft = (body: TranslationBody | undefined) =>
    ok(detail({ id: 'sub-q1', kind: 'translation', group_id: TRANSLATION_GROUP, status: 'draft', body: body ?? null }));
  backend.on('POST /api/submissions', (call) => ({ ...draft((call.json as { body?: TranslationBody }).body), status: 201 }));
  backend.on('PUT /api/submissions/sub-q1', (call) => draft((call.json as { body?: TranslationBody }).body));
  backend.on('POST /api/ai/translation-grade', () => apiError(429, 'quota_day'));

  await page.goto('/writing/translation/gsat-115');
  await fillTranslation(page);
  await expect(page.getByTestId('quota-summary')).toContainText('今天剩 0／30 點');
  await expect(page.getByTestId('quota-summary')).toContainText('10/10（週六）00:00 重置');
  await page.getByRole('button', { name: '送出 AI 批改（3 點）' }).click();

  const alert = page.getByRole('alert').filter({ hasText: '今日點數已用完' });
  await expect(alert).toHaveText('今日點數已用完，10/10（週六）00:00（台灣時間）重置');
  await expect(page).toHaveURL(/\/writing\/translation\/gsat-115$/);
  // 作答內容還在，可以等重置後再送。
  await expect(page.getByRole('textbox', { name: '英文譯文' }).nth(0)).toHaveValue(T1);

  // 再送一次：沿用剛才建立的草稿（PUT），不會在後端多建一份。
  await page.getByRole('button', { name: '送出 AI 批改（3 點）' }).click();
  await expect.poll(() => backend.callsTo('PUT', '/api/submissions/sub-q1').length).toBe(1);
  await expect(alert).toBeVisible();
  expect(backend.callsTo('POST', '/api/submissions')).toHaveLength(1);
  expect(backend.callsTo('POST', '/api/ai/translation-grade')).toHaveLength(2);
  expect(errors).toEqual([]);
});
