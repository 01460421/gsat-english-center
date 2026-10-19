/**
 * 版面截圖：全站每個路由（含帶參數的子頁）在幾種有意義的狀態下各截一張整頁圖，每個視窗（visual.config.ts 的 project）各一套。
 *
 * 用途（docs/design/desktop-ui.md §11.1、§11.2）：桌機介面改版前先截一次「基準」，改版後再截一次，用 compare.mjs 逐像素比對
 * 320／375／768 三個視窗（手機與平板必須完全不變）；1024 以上的圖給設計審查前後對照。
 * 除了進頁面就截的狀態，也截改版會重構的元件的展開、有無紀錄與鍵盤聚焦（§11.1「開工前要補截的基準情境」）。
 * 執行方式見 README.md（scripts/visual-run.sh、visual-baseline.sh）；不在 `npm run test:e2e` 裡。
 *
 * 確定性：
 *   - 時間固定在 2026-10-18 10:00（台灣時間；page.clock.setFixedTime，計時器照常跑）；
 *   - Math.random 固定回傳 0.5、crypto.randomUUID 換成遞增的假 UUID（題庫練習抽到的題組、單字測驗的題目每次都一樣，
 *     而且不受載入時序與改版後程式呼叫次數影響；理由見 determinism()）；
 *   - 關掉動畫與轉場、隱藏游標，截圖前等 networkidle、字型、圖片載入與兩個 animation frame，滑鼠移到左上角；
 *   - 後端一律用 tests/support/backend.ts 的 FakeBackend（不連任何真的 API）；/data/* 用建置產物裡的真資料。
 *
 * 檔名：<序號>-<路由>__<狀態>.png，放在 SHOTS_OUT/<視窗>/；每張圖的網址、標題、console error 寫在 SHOTS_OUT/_meta/。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type {
  CustomEssayPrompt,
  EssayGradingResult,
  FeaturesResponse,
  MeResponse,
  SubmissionDetail,
  SubmissionSummary,
  TranslationGradingResult,
} from '@gsat/shared';
import {
  ADMIN_HEALTH,
  ADMIN_USAGE,
  FEATURES_CUSTOM_ON,
  QUOTA,
  adminUserRow,
  fakeBackend,
  ok,
  signedInMe,
  type FakeBackend,
} from '../support/backend';

// visual.config.ts 一定會設（沒指定時用預設資料夾）；直接用別的設定檔跑這個檔案時才會缺。
const OUT = process.env['SHOTS_OUT'];
if (!OUT) throw new Error('SHOTS_OUT 沒有設定（截圖輸出資料夾）：請用 tests/visual/visual.config.ts 執行');

// ───────────────────────── 固定的時間與帳號狀態 ─────────────────────────

const FIXED_NOW = new Date('2026-10-18T10:00:00+08:00');
const NOW_S = Math.floor(FIXED_NOW.getTime() / 1000);
const QUOTA_NOW = { ...QUOTA, resets_at: { day: '2026-10-18T16:00:00Z', month: '2026-10-31T16:00:00Z' } };

/**
 * 帳號狀態：
 *   anon         沒登入（登入、AI、自訂題目批改都開著：正式站的設定），版面上看得到登入按鈕；
 *   student      已登入、AI 已核准（features 含 customEssay: true），有寫作紀錄；
 *   student-none 已登入、還沒申請 AI；
 *   admin        站主（後台）；
 *   welcome      第一次登入、還沒同意條款（會被導到 /account/welcome）。
 */
type Who = 'anon' | 'student' | 'student-none' | 'admin' | 'welcome';

function meFor(who: Who): MeResponse {
  const rest = { login_at: NOW_S - 3600 };
  switch (who) {
    case 'anon':
      return { user: null };
    case 'student':
      return signedInMe({ ai_status: 'approved' }, rest);
    case 'student-none':
      return signedInMe({ ai_status: 'none' }, rest);
    case 'admin':
      return signedInMe({ id: 'u-admin', display_name: '站主', role: 'admin', ai_status: 'approved', ai_tier: 'unlimited' }, rest);
    case 'welcome':
      return signedInMe({ display_name: 'Wang Xiao-Ming', age_band: null }, { ...rest, pending_consents: ['privacy', 'terms'], onboarded: false });
  }
}

// ───────────────────────── 寫作的假資料（批改結果頁、寫作紀錄） ─────────────────────────

const EXAM_TR_GROUP = 'gsat-115.s7g1@1';
const EXAM_ES_GROUP = 'gsat-115.s8g1@1';
const BANK_TR_CODE = '1d423d';
const BANK_TR_GROUP = `ai.tr.${BANK_TR_CODE}@1`;
const BANK_CP_CODE = '0e89ae';
const BANK_CP_GROUP = `ai.cp.${BANK_CP_CODE}@1`;
const CUSTOM_GROUP = 'custom:essay@1';

const T1 = 'More and more high school English teacher have increase the percentage of using English in class.';
const T2 = 'they divide students into different groups.';
const B1 = 'Since last year, I have been learn to play the guitar at home by myself.';
const B2 = 'to learn new songs, I often watch guitar teaching video on the Internet.';

const EXAM_ESSAY = [
  'In recent years, more and more people treat their pets like children. In the pictures, we can see a man carry his dog in a baby carrier, ' +
    'and a woman buying expensive clothes for her cat. Some people even hold birthday parties for their pets and spend a lot of money on special food.',
  'I think there are two reason for this. First, many young couples decide not to have children, so pets become important members of their families. ' +
    'Second, pets give us comfort when we feel lonely or stressed. However, we should remember that pets are animals, not toys, and we must take care of them responsibly.',
].join('\n\n');

const CUSTOM_ESSAY = [
  'No-Phone Day is a good idea for our school. Many students check their phones during every break, and some of them even use their phones in class. ' +
    'If we put our phones away for one day, we can talk to our friends face to face and pay more attention to our teachers.',
  'On that day, I will arrive at school early and read a novel in the library. During lunch, I will play basketball with my classmates instead of watching videos. ' +
    'After school, I will write a short diary about how I felt without my phone. I think it will be a challenging but meaningful experience for everyone.',
].join('\n\n');
const CUSTOM_PROMPT_TEXT =
  '提示：你的學校即將舉辦「無手機日」，當天所有人都不能使用手機。請寫一篇英文作文，文分兩段，第一段說明你對這個活動的看法，第二段描述你那天會怎麼安排時間。';

const span = (text: string, word: string) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length, excerpt: word });

const EXAM_TR_GRADING: TranslationGradingResult = {
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
    { sentence_index: 0, ...span(T1, 'teacher'), part: 1, category: 'grammar', explanation_zh: 'more and more 後面接複數名詞。', suggestion: 'teachers', repeat_of: null, deducted: 0.5 },
    { sentence_index: 0, ...span(T1, 'increase'), part: 2, category: 'grammar', explanation_zh: '完成式要用過去分詞。', suggestion: 'increased', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, ...span(T2, 'they'), part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'They', repeat_of: null, deducted: 0.5 },
  ],
  corrected: ['More and more high school English teachers have increased the percentage of English used in class.', 'They divide students into different groups.'],
  explanation_zh: ['注意單複數與完成式。', '句首要大寫。'],
};

const BANK_TR_GRADING: TranslationGradingResult = {
  ...EXAM_TR_GRADING,
  final_score: 6.5,
  sentence_scores: [3.5, 3],
  errors: [
    { sentence_index: 0, ...span(B1, 'learn'), part: 2, category: 'grammar', explanation_zh: '現在完成進行式是 have been + V-ing。', suggestion: 'learning', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, ...span(B2, 'to'), part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'To', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, ...span(B2, 'video'), part: 4, category: 'grammar', explanation_zh: '泛指時用複數。', suggestion: 'videos', repeat_of: null, deducted: 0.5 },
  ],
  corrected: ['Since last year, I have been learning to play the guitar at home by myself.', 'To learn new songs, I often watch guitar tutorial videos on the Internet.'],
  explanation_zh: ['完成進行式的動詞形式。', '句首大寫、名詞單複數。'],
};

const EXAM_ES_GRADING: EssayGradingResult = {
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
  deductions: [],
  word_count: 118,
  paragraphs: 2,
  top_improvements: ['加一個具體經驗。', '注意感官動詞。', '第二段的理由再多一點說明。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '第二段要說明影響。' }],
  errors: [
    { paragraph_index: 0, start: 0, end: 0, excerpt: 'carry', category: 'grammar', explanation_zh: 'see + 受詞 + V-ing。', suggestion: 'carrying' },
    { paragraph_index: 1, start: 0, end: 0, excerpt: 'reason', category: 'grammar', explanation_zh: 'two 後面接複數。', suggestion: 'reasons' },
  ],
  rewrite: null,
  safety_flag: null,
};

const CUSTOM_GRADING: EssayGradingResult = {
  ...EXAM_ES_GRADING,
  final_score: 15,
  band: 'good',
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
  word_count: 112,
  top_improvements: ['第一段多一個具體的理由。', '多用連接詞串起句子。', '注意 challenging 的拼法。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '結尾可以呼應第一段的看法。' }],
  errors: [{ paragraph_index: 0, start: 0, end: 0, excerpt: 'Many students', category: 'grammar', explanation_zh: '可以加上 In fact 讓語氣更自然。', suggestion: 'In fact, many students' }],
};

const CUSTOM_PROMPT: CustomEssayPrompt = {
  text: CUSTOM_PROMPT_TEXT,
  figure_text: '一張學生把手機放進教室門口收納箱的照片。',
  paragraphs: 2,
  min_words: 120,
  max_words: null,
  updated_at: NOW_S - 7200,
};
const CUSTOM_TITLE = '你的學校即將舉辦「無手機日」，當天所有人都不能使用手機。…';

function detail(patch: Partial<SubmissionDetail> & Pick<SubmissionDetail, 'id' | 'kind' | 'group_id' | 'status'>): SubmissionDetail {
  return {
    input_mode: 'typed',
    final_score: null,
    final_band: null,
    created_at: NOW_S - 7200,
    updated_at: NOW_S - 7100,
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

const SUBMISSIONS: Record<string, SubmissionDetail> = {
  'sub-t1': detail({
    id: 'sub-t1',
    kind: 'translation',
    group_id: EXAM_TR_GROUP,
    status: 'graded',
    op_id: 'op-t1',
    final_score: 5.75,
    graded_at: NOW_S - 7000,
    body: { items: [{ item_id: `${EXAM_TR_GROUP}#中譯英1`, text: T1 }, { item_id: `${EXAM_TR_GROUP}#中譯英2`, text: T2 }] },
    grading: EXAM_TR_GRADING,
  }),
  'sub-b1': detail({
    id: 'sub-b1',
    kind: 'translation',
    group_id: BANK_TR_GROUP,
    status: 'graded',
    op_id: 'op-b1',
    final_score: 6.5,
    graded_at: NOW_S - 6000,
    body: { items: [{ item_id: `${BANK_TR_GROUP}#1`, text: B1 }, { item_id: `${BANK_TR_GROUP}#2`, text: B2 }] },
    grading: BANK_TR_GRADING,
  }),
  'sub-e1': detail({
    id: 'sub-e1',
    kind: 'essay',
    group_id: EXAM_ES_GROUP,
    status: 'graded',
    op_id: 'op-e1',
    final_score: 12.5,
    final_band: 'fair',
    graded_at: NOW_S - 5000,
    word_count: 118,
    paragraphs: 2,
    body: { text: EXAM_ESSAY },
    grading: EXAM_ES_GRADING,
  }),
  'sub-c1': detail({
    id: 'sub-c1',
    kind: 'essay',
    group_id: CUSTOM_GROUP,
    status: 'graded',
    op_id: 'op-c1',
    final_score: 15,
    final_band: 'good',
    graded_at: NOW_S - 4000,
    word_count: 112,
    paragraphs: 2,
    body: { text: CUSTOM_ESSAY },
    grading: CUSTOM_GRADING,
    custom_title: CUSTOM_TITLE,
    custom_prompt: CUSTOM_PROMPT,
  }),
  'sub-q1': detail({
    id: 'sub-q1',
    kind: 'translation',
    group_id: EXAM_TR_GROUP,
    status: 'queued',
    op_id: 'op-q1',
    body: { items: [{ item_id: `${EXAM_TR_GROUP}#中譯英1`, text: T1 }, { item_id: `${EXAM_TR_GROUP}#中譯英2`, text: T2 }] },
  }),
};

const OPS: Record<string, { task: string; points: number; status: 'settled' | 'queued' }> = {
  'op-t1': { task: 'translation_grade', points: 3, status: 'settled' },
  'op-b1': { task: 'translation_grade', points: 3, status: 'settled' },
  'op-e1': { task: 'essay_grade', points: 7, status: 'settled' },
  'op-c1': { task: 'essay_grade', points: 7, status: 'settled' },
  'op-q1': { task: 'translation_grade', points: 3, status: 'queued' },
};

function summary(d: SubmissionDetail): SubmissionSummary {
  return {
    id: d.id,
    kind: d.kind,
    group_id: d.group_id,
    input_mode: d.input_mode,
    status: d.status,
    final_score: d.final_score,
    final_band: d.final_band,
    created_at: d.created_at,
    updated_at: d.updated_at,
    graded_at: d.graded_at,
    custom_title: d.custom_title ?? null,
  };
}

/** 寫作紀錄：中譯英 4 筆（含 1 筆草稿、1 筆排隊中）、作文 3 筆（歷屆、自訂、本站仿真草稿）。 */
function historyRows(kind: string | null): SubmissionSummary[] {
  const draftTr = summary(detail({ id: 'sub-d1', kind: 'translation', group_id: 'gsat-114.s7g1@1', status: 'draft', created_at: NOW_S - 86_400 * 3, updated_at: NOW_S - 86_400 * 3 }));
  const draftEs = summary(detail({ id: 'sub-d2', kind: 'essay', group_id: BANK_CP_GROUP, status: 'draft', created_at: NOW_S - 86_400 * 2, updated_at: NOW_S - 86_400 * 2 }));
  const s = SUBMISSIONS;
  const tr = [s['sub-q1'], s['sub-b1'], s['sub-t1']].filter((d): d is SubmissionDetail => d !== undefined).map(summary);
  const es = [s['sub-c1'], s['sub-e1']].filter((d): d is SubmissionDetail => d !== undefined).map(summary);
  if (kind === 'essay') return [...es, draftEs];
  if (kind === 'translation') return [...tr, draftTr];
  return [...tr, draftTr, ...es, draftEs];
}

async function backendFor(page: Page, who: Who, features: FeaturesResponse = FEATURES_CUSTOM_ON): Promise<FakeBackend> {
  const backend = await fakeBackend(page, {
    features,
    me: meFor(who),
    quota: who === 'student-none' ? { ...QUOTA_NOW, ai_status: 'none' } : QUOTA_NOW,
  });
  backend.on('GET /api/health', () => ok({ ok: true, service: 'gsat-english-api', version: '0.0.0-shots', time: FIXED_NOW.toISOString() }));
  if (who === 'student' || who === 'admin') {
    backend.on('GET /api/submissions', (call) => ok({ submissions: historyRows(call.query.get('kind')), next_cursor: null }));
    for (const [id, d] of Object.entries(SUBMISSIONS)) backend.on(`GET /api/submissions/${id}`, () => ok(d));
    for (const [id, op] of Object.entries(OPS)) {
      const sub = Object.values(SUBMISSIONS).find((d) => d.op_id === id);
      backend.on(`GET /api/ai/ops/${id}`, {
        op_id: id,
        task: op.task,
        status: op.status,
        submission_id: sub?.id ?? null,
        submission_status: sub?.status ?? null,
        points_reserved: op.points,
        points_charged: op.status === 'settled' ? op.points : null,
        refund_reason: null,
        created_at: NOW_S - 7200,
        settled_at: op.status === 'settled' ? NOW_S - 7000 : null,
      });
    }
  }
  if (who === 'admin') {
    const pending = [
      adminUserRow('u-101', '學生甲', { ai_applied_at: NOW_S - 86_400, last_active_day: '2026-10-17' }),
      adminUserRow('u-102', '學生乙', { age_band: 'under18', ai_applied_at: NOW_S - 3600, last_active_day: '2026-10-18' }),
      adminUserRow('u-103', '學生丙', { ai_applied_at: NOW_S - 600, last_active_day: '2026-10-18' }),
    ];
    backend.on('GET /api/admin/health', () => ok(ADMIN_HEALTH));
    backend.on('GET /api/admin/users', (call) =>
      ok({ users: call.query.get('ai_status') === 'pending' ? pending : [], next_cursor: null, approval: { cap: 49, approved: 12 } }),
    );
    backend.on('GET /api/admin/usage', (call) => ok({ from: call.query.get('from'), to: call.query.get('to'), ...ADMIN_USAGE }));
  }
  return backend;
}

// ───────────────────────── 確定性與截圖 ─────────────────────────

/**
 * 每次載入頁面都重設：Math.random 固定回傳 0.5、crypto.randomUUID 回傳遞增的假 UUID（計數放 sessionStorage，同一個分頁內換頁不重複）。
 *
 * Math.random 用常數而不是固定種子的數列：react-router 每次換頁都會呼叫它產生 location key，呼叫次數隨載入時序變動，
 * 用數列的話題庫練習抽到第幾組會跟著飄（實測同一個網址兩次抽到不同的題組）；改版後的程式多呼叫或少呼叫幾次也會讓抽題改變，
 * 基準與對照就比不起來。常數讓抽題只取決於題庫索引（pick.ts：第 floor(0.5 × 組數) 組）、單字測驗的種子固定。
 * 目前 bundle 裡用到 Math.random 的地方（React 內部屬性名、react-router 的 key、題庫抽題、單字測驗的種子、模擬考 id 的備援）
 * 都不會因為回傳常數而卡住；之後若有「重抽直到不同」的迴圈要改這裡。
 */
function determinism() {
  Math.random = () => 0.5;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    crypto.randomUUID = () => {
      let n = 0;
      try {
        n = Number(sessionStorage.getItem('__shots_uuid') ?? '0') + 1;
        sessionStorage.setItem('__shots_uuid', String(n));
      } catch {
        n = Date.now();
      }
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
    };
  }
}

const STABLE_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

interface Ctx {
  page: Page;
  testInfo: TestInfo;
  /** 這個頁面的假後端；測試可以再用 backend.on() 覆寫回應（後登記的優先）。 */
  backend: FakeBackend;
  errors: string[];
  /** 這個視窗是不是手機／平板版面（< lg，1024px）。 */
  narrow: boolean;
  shot: (name: string, opts?: { fullPage?: boolean }) => Promise<void>;
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // 按需載入的頁面元件與資料：等「載入中…」消失（最多 15 秒；有些區塊本來就一直顯示載入中時不卡住）。
  await expect(page.getByText(/^載入中…$/)).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(async (css) => {
    if (!document.getElementById('__shots_style')) {
      const style = document.createElement('style');
      style.id = '__shots_style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    for (const img of Array.from(document.images)) if (img.loading === 'lazy') img.loading = 'eager';
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 5_000);
            }),
        ),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, STABLE_CSS);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.mouse.move(0, 0);
}

async function setup(page: Page, testInfo: TestInfo, who: Who, options: { features?: FeaturesResponse; dark?: boolean } = {}): Promise<Ctx> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()} ${msg.location().url ?? ''}`.trim());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(determinism);
  if (options.dark) await page.emulateMedia({ colorScheme: 'dark' });
  const backend = await backendFor(page, who, options.features);
  const vp = testInfo.project.name;
  const width = page.viewportSize()?.width ?? 0;
  const ctx: Ctx = {
    page,
    testInfo,
    backend,
    errors,
    narrow: width < 1024,
    shot: async (name, opts = {}) => {
      const fullPage = opts.fullPage ?? true;
      await settle(page);
      if (fullPage) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      }
      const file = path.join(OUT as string, vp, `${name}.png`);
      mkdirSync(path.dirname(file), { recursive: true });
      // 桌機的整頁圖不用 Playwright 的 fullPage：Chromium 截超出視窗的範圍時會暫時把視窗縮成 1×1，(min-width: 64rem)
      // 先變 false 再變 true，頁面換到手機的樹再換回來——切到的分頁、展開的狀態重設，API 也重打一次（實測：寫作紀錄切到
      // 「英文作文」截出來卻是「中譯英」）。改成把視窗拉高到整頁的高度、截一般的視窗圖，再改回原本的大小；寬度沒變，
      // 媒體查詢與 main 的寬度層級都不會動。側邊欄（fixed、撐滿視窗高）先固定成原本的視窗高，畫面和整頁截圖一樣。
      // 手機與平板照舊用 fullPage（基準就是這樣截的，比對要逐像素相同）。
      const viewport = page.viewportSize();
      const tall = fullPage && width >= 1024 && viewport !== null;
      if (tall) {
        await page.evaluate((h) => {
          const style = document.createElement('style');
          style.id = '__shots_tall';
          style.textContent = `aside[data-sidebar]{bottom:auto!important;height:${h}px!important}`;
          document.head.appendChild(style);
        }, viewport.height);
        let height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let i = 0; i < 3; i += 1) {
          await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
          await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
          const next = await page.evaluate(() => document.documentElement.scrollHeight);
          if (next === height) break;
          height = next;
        }
      }
      // 連續兩次截到一模一樣才算數（同 toHaveScreenshot 的做法）：輪詢、重繪中的畫面不會被截成半套。
      const shotOpts = { fullPage: fullPage && !tall, animations: 'disabled', caret: 'hide', scale: 'css' } as const;
      let png = await page.screenshot(shotOpts);
      let stable = false;
      for (let i = 0; i < 4 && !stable; i += 1) {
        await page.waitForTimeout(200);
        const again = await page.screenshot(shotOpts);
        stable = again.equals(png);
        png = again;
      }
      if (tall) {
        await page.evaluate(() => document.getElementById('__shots_tall')?.remove());
        await page.setViewportSize(viewport);
      }
      writeFileSync(file, png);
      const info = await page.evaluate(() => ({
        title: document.title,
        docWidth: document.documentElement.scrollWidth,
        docHeight: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
      }));
      const metaFile = path.join(OUT as string, '_meta', vp, `${name}.json`);
      mkdirSync(path.dirname(metaFile), { recursive: true });
      const url = new URL(page.url());
      writeFileSync(
        metaFile,
        JSON.stringify(
          { name, viewport: vp, who, dark: Boolean(options.dark), url: `${url.pathname}${url.search}`, fullPage, stable, ...info, errors: [...errors] },
          null,
          2,
        ),
      );
    },
  };
  return ctx;
}

/** 進頁面、等 <h1> 出現，再等資料與按需載入的元件都到齊（太早作答會被之後的初始化蓋掉，實測發生過）。 */
async function open(c: Ctx, url: string) {
  await c.page.goto(url);
  await expect(c.page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
  await settle(c.page);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 工具列的「已答 n／總題數」（題庫練習、歷屆試題、模擬考都有）；用來確認作答真的記下來了。 */
async function expectAnswered(page: Page, n: number) {
  await expect(page.getByText(new RegExp(`已答 ${n}／\\d+`)).first()).toBeVisible();
}

/** 題目卡（id="q-…"）的前 n 題各選一個選項（第 i 題選第 i % 選項數 個，畫面上看得出選了不同的選項）；回傳實際作答幾題。 */
async function answerRadios(page: Page, n: number): Promise<number> {
  const cards = page.locator('[id^="q-"]').filter({ has: page.getByRole('radio') });
  const count = Math.min(n, await cards.count());
  for (let i = 0; i < count; i += 1) {
    const radios = cards.nth(i).getByRole('radio');
    const total = await radios.count();
    const radio = radios.nth(i % Math.max(total, 1));
    await radio.check();
    await expect(radio).toBeChecked();
  }
  return count;
}

/**
 * 文意選填、篇章結構、綜合測驗：前 n 個還沒填的空格，各點開面板、選第 i 個選項（各格選不同的選項，不會互相搶），
 * 每一格都等到「已填」才繼續。面板第一個按鈕是「收起選項」，所以用選項的名稱（「(A) …」）找。
 */
async function fillBlanks(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) {
    const blank = page.getByRole('button', { name: /^第 \S+ 題空格，未作答/ }).first();
    if ((await blank.count()) === 0) return;
    const label = /^第 (\S+) 題空格/.exec((await blank.getAttribute('aria-label')) ?? '')?.[1];
    if (!label) throw new Error('空格的 aria-label 讀不到題號');
    await blank.click();
    const group = page.getByRole('group', { name: `第 ${label} 題的選項`, exact: true });
    await expect(group).toBeVisible();
    const options = group.getByRole('button', { name: /^\([A-Z]\)/ });
    await options.nth(i % Math.max(await options.count(), 1)).click();
    await expect(page.getByRole('button', { name: new RegExp(`^第 ${escapeRe(label)} 題空格，已填`) })).toBeVisible();
    await expect(group).toBeHidden();
  }
}

async function submitPractice(page: Page) {
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();
}

/**
 * 用鍵盤把焦點移到 target，截 :focus-visible 的樣子：先用程式聚焦，再按 Shift+Tab、Tab 回到它。
 * 只呼叫 focus() 時，Chromium 依「之前是用滑鼠還是鍵盤」決定要不要畫焦點框；經過真的按鍵就一定是鍵盤聚焦。
 * target 若在一組 radio 裡，要是選中的那一個（Tab 進一組 radio 時停在選中的那個）。
 */
async function keyboardFocus(page: Page, target: Locator) {
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
  expect(await target.evaluate((el) => el.matches(':focus-visible')), '焦點框沒有出現（:focus-visible 不成立）').toBe(true);
}

// ───────────────────────── 路由與狀態 ─────────────────────────

/**
 * 單純的「進頁面就截」：[檔名, 網址, 帳號狀態, 選項]。
 * 帶參數的子頁用建置資料裡真的 id：歷屆 gsat-115、本站仿真中譯英 1d423d、本站仿真作文 0e89ae（附圖）。
 */
const STATIC: Array<[string, string, Who, { dark?: boolean }?]> = [
  ['01-home__anon', '/', 'anon'],
  ['01-home__student', '/', 'student'],
  ['01-home__anon-dark', '/', 'anon', { dark: true }],
  ['02-words__library', '/words', 'anon'],
  ['02-words__study', '/words?tab=study', 'anon'],
  ['02-words__quiz', '/words?tab=quiz', 'anon'],
  ['02-words__mistakes', '/words?tab=mistakes', 'anon'],
  ['02-words__word-card', `/words?word=${encodeURIComponent('abandon|v.|4')}`, 'anon'],
  ['03-practice__menu', '/practice', 'anon'],
  ['04-vocabulary__section', '/vocabulary', 'anon'],
  ['05-cloze__section', '/cloze', 'anon'],
  ['06-word-bank__section', '/word-bank', 'anon'],
  ['07-structure__section', '/structure', 'anon'],
  ['08-reading__section', '/reading', 'anon'],
  ['08-reading__section-dark', '/reading', 'anon', { dark: true }],
  ['09-mixed__section', '/mixed', 'anon'],
  ['10-translation__anon', '/translation', 'anon'],
  ['10-translation__student', '/translation', 'student'],
  ['11-composition__anon', '/composition', 'anon'],
  ['11-composition__student', '/composition', 'student'],
  ['12-writing__anon', '/writing', 'anon'],
  ['12-writing__student', '/writing', 'student'],
  ['13-exams__list', '/exams', 'anon'],
  ['14-mock__list', '/mock', 'anon'],
  ['15-settings__anon', '/settings', 'anon'],
  ['15-settings__student', '/settings', 'student'],
  ['16-about', '/about', 'anon'],
  ['17-privacy', '/privacy', 'anon'],
  ['18-terms', '/terms', 'anon'],
  ['19-account__anon', '/account', 'anon'],
  ['19-account__student', '/account', 'student'],
  ['20-account-welcome__first-login', '/account/welcome', 'welcome'],
  ['21-ai-apply__not-applied', '/ai/apply', 'student-none'],
  ['21-ai-apply__approved', '/ai/apply', 'student'],
  ['22-admin__admin', '/admin', 'admin'],
  ['23-writing-translation__list', '/writing/translation', 'anon'],
  ['24-writing-translation-ai__list', '/writing/translation/ai', 'anon'],
  ['25-writing-translation-ai-code__anon', `/writing/translation/ai/${BANK_TR_CODE}`, 'anon'],
  ['25-writing-translation-ai-code__student', `/writing/translation/ai/${BANK_TR_CODE}`, 'student'],
  ['26-writing-translation-exam__anon', '/writing/translation/gsat-115', 'anon'],
  ['26-writing-translation-exam__student', '/writing/translation/gsat-115', 'student'],
  ['27-writing-essay__list', '/writing/essay', 'anon'],
  ['28-writing-essay-ai__list', '/writing/essay/ai', 'anon'],
  ['29-writing-essay-ai-code__anon', `/writing/essay/ai/${BANK_CP_CODE}`, 'anon'],
  ['29-writing-essay-ai-code__student', `/writing/essay/ai/${BANK_CP_CODE}`, 'student'],
  ['30-writing-essay-custom__anon', '/writing/essay/custom', 'anon'],
  ['30-writing-essay-custom__student', '/writing/essay/custom', 'student'],
  ['31-writing-essay-exam__anon', '/writing/essay/gsat-115', 'anon'],
  ['31-writing-essay-exam__student', '/writing/essay/gsat-115', 'student'],
  ['32-writing-submission__translation-graded', '/writing/submissions/sub-t1', 'student'],
  ['32-writing-submission__bank-translation-graded', '/writing/submissions/sub-b1', 'student'],
  ['32-writing-submission__essay-graded', '/writing/submissions/sub-e1', 'student'],
  ['32-writing-submission__custom-essay-graded', '/writing/submissions/sub-c1', 'student'],
  ['32-writing-submission__translation-queued', '/writing/submissions/sub-q1', 'student'],
  ['33-exam-paper__start', '/exams/gsat-115', 'anon'],
  ['34-mock-session__start-screen', '/mock/gsat-115', 'anon'],
  ['35-practice-session__vocabulary-basic', '/practice/vocabulary/basic', 'anon'],
  ['35-practice-session__cloze-advanced', '/practice/cloze/advanced', 'anon'],
  ['35-practice-session__word-bank-advanced', '/practice/word-bank/advanced', 'anon'],
  ['35-practice-session__structure-top', '/practice/structure/top', 'anon'],
  ['35-practice-session__reading-basic', '/practice/reading/basic', 'anon'],
  ['35-practice-session__mixed-basic', '/practice/mixed/basic', 'anon'],
  ['36-not-found', '/no-such-page', 'anon'],
];

test.describe.configure({ mode: 'parallel' });

for (const [name, url, who, opts] of STATIC) {
  test(name, async ({ page }, testInfo) => {
    const c = await setup(page, testInfo, who, opts);
    await open(c, url);
    await c.shot(name);
  });
}

// ── 版面：「更多」面板（只有 < lg）與帳號選單 ──

test('01-home__more-sheet', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  test.skip(!c.narrow, '「更多」面板只在 < 1024px 出現');
  await open(c, '/');
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('dialog', { name: '全部功能' })).toBeVisible();
  // 面板是固定在視窗底部的對話框：截視窗（不是整頁）。
  await c.shot('01-home__more-sheet', { fullPage: false });
});

test('01-home__account-menu', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/');
  await page.getByRole('button', { name: '小明（帳號選單）' }).filter({ visible: true }).click();
  await expect(page.getByRole('link', { name: '我的帳號' }).filter({ visible: true }).first()).toBeVisible();
  await c.shot('01-home__account-menu', { fullPage: false });
});

// 主題切換按下後（手機在頂端列、桌機在側邊欄；系統是淺色，按了變深色，按鈕換成「切換為淺色主題」）。
test('01-home__theme-toggled', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/');
  await page.getByRole('button', { name: '切換為深色主題' }).filter({ visible: true }).click();
  await expect(page.getByRole('button', { name: '切換為淺色主題' }).filter({ visible: true })).toBeVisible();
  await c.shot('01-home__theme-toggled');
});

// ── 單字：每日學習翻卡、測驗作答中 ──

test('02-words__study-card', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/words?tab=study');
  await page.getByRole('button', { name: /開始學習（\d+ 張）/ }).click();
  await page.getByRole('button', { name: '顯示答案' }).click();
  await c.shot('02-words__study-card');
});

test('02-words__quiz-question', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/words?tab=quiz');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await expect(page.getByRole('heading', { name: /第 1 題/ })).toBeVisible();
  await page.getByRole('list', { name: '選項' }).getByRole('button').nth(1).click();
  await expect(page.getByText(/^(答對了！|答錯了)$/)).toBeVisible();
  await c.shot('02-words__quiz-question');
});

// ── 題庫練習：作答到一半、交卷後 ──

test('35-practice-session__reading-basic-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/practice/reading/basic');
  await expectAnswered(page, await answerRadios(page, 2));
  await c.shot('35-practice-session__reading-basic-midway');
  await submitPractice(page);
  await c.shot('35-practice-session__reading-basic-submitted');
});

test('35-practice-session__vocabulary-basic-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/practice/vocabulary/basic');
  await expectAnswered(page, await answerRadios(page, 4));
  await c.shot('35-practice-session__vocabulary-basic-midway');
});

test('35-practice-session__word-bank-advanced-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/practice/word-bank/advanced');
  await fillBlanks(page, 3);
  await expectAnswered(page, 3);
  // 再點開下一個空格：選項面板開著的樣子。
  await page.getByRole('button', { name: /^第 \S+ 題空格，未作答/ }).first().click();
  await expect(page.getByRole('group', { name: /^第 \S+ 題的選項$/ }).first()).toBeVisible();
  await c.shot('35-practice-session__word-bank-advanced-midway');
  await submitPractice(page);
  await c.shot('35-practice-session__word-bank-advanced-submitted');
});

test('35-practice-session__structure-top-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/practice/structure/top');
  await fillBlanks(page, 2);
  await expectAnswered(page, 2);
  await c.shot('35-practice-session__structure-top-midway');
});

test('35-practice-session__mixed-basic-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/practice/mixed/basic');
  await expectAnswered(page, await answerRadios(page, 1));
  await submitPractice(page);
  await c.shot('35-practice-session__mixed-basic-submitted');
});

// ── 歷屆試題：練習模式看答案、考試模式作答中與交卷 ──

test('33-exam-paper__practice-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/exams/gsat-115');
  await page.getByRole('button', { name: '開始作答' }).click();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  const q35 = page.locator('#q-35');
  await q35.getByRole('radio', { name: /^\(C\)/ }).check();
  await q35.getByRole('button', { name: '看答案' }).click();
  await expect(q35.getByTestId('question-feedback')).toContainText('全國答對率');
  await c.shot('33-exam-paper__practice-answered');
});

test('33-exam-paper__exam-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/exams/gsat-115');
  await page.locator('label').filter({ hasText: '考試模式' }).click();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await page.getByRole('button', { name: '第 11 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 11 題的選項' }).getByRole('button', { name: /it turns out/ }).click();
  await page.getByRole('button', { name: '第 21 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 21 題的選項' }).getByRole('button', { name: /^\(E\)/ }).click();
  await expect(page.getByRole('button', { name: /^第 21 題空格，已填 \(E\)/ })).toBeVisible();
  await expectAnswered(page, 3);
  await c.shot('33-exam-paper__exam-midway');
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();
  await c.shot('33-exam-paper__exam-submitted');
});

// ── 模擬考：作答中、閱讀大題、成績單、檢討、列表顯示已完成 ──

test('34-mock-session__flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/mock/gsat-115');
  await page.getByRole('spinbutton', { name: /你覺得這次會考幾分/ }).fill('60');
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await page.locator('#q-1').getByRole('button', { name: '標記第 1 題，稍後檢查' }).click();
  await page.locator('#q-2').getByRole('radio').first().check();
  await expectAnswered(page, 2);
  await c.shot('34-mock-session__in-progress');
  const nav = page.getByRole('navigation', { name: '大題導覽' });
  await nav.getByRole('button', { name: /^3\. 文意選填/ }).click();
  await page.getByRole('button', { name: '第 21 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 21 題的選項' }).getByRole('button', { name: /^\(E\)/ }).click();
  await expectAnswered(page, 3);
  await c.shot('34-mock-session__word-bank-section');
  await nav.getByRole('button', { name: /^5\. / }).click();
  await c.shot('34-mock-session__reading-section');
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
  await expect(dialog).toBeVisible();
  await c.shot('34-mock-session__submit-dialog', { fullPage: false });
  await dialog.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeVisible();
  await c.shot('34-mock-report__report');
  await page.getByRole('button', { name: /展開檢討試卷/ }).click();
  await expect(page.locator('#q-1').getByTestId('question-feedback')).toBeVisible();
  await c.shot('34-mock-report__review');
  await page.getByRole('link', { name: '回模擬考列表' }).click();
  await expect(page.getByRole('region', { name: '作答紀錄' })).toBeVisible();
  await c.shot('14-mock__list-completed');
});

// ── 寫作：作答中、自我檢核、對照參考內容、自訂題目 ──

async function fillTranslation(page: Page, a: string, b: string) {
  const inputs = page.getByRole('textbox', { name: /英文譯文/ });
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(a);
  await inputs.nth(1).fill(b);
}

test('26-writing-translation-exam__flows', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/writing/translation/gsat-115');
  await fillTranslation(page, T1, T2);
  await page.getByRole('button', { name: '自我檢核（不用 AI）' }).click();
  await expect(page.locator('#t-self-check').getByRole('heading', { name: '自我檢核' })).toBeVisible();
  await c.shot('26-writing-translation-exam__anon-self-check');
});

test('26-writing-translation-exam__student-filled', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/translation/gsat-115');
  await fillTranslation(page, T1, T2);
  await expect(page.getByTestId('quota-summary')).toBeVisible();
  await c.shot('26-writing-translation-exam__student-filled');
});

test('25-writing-translation-ai-code__revealed', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, `/writing/translation/ai/${BANK_TR_CODE}`);
  await page.getByRole('button', { name: '第 1 句的提示：看第 1 層（共 3 層）' }).click();
  await fillTranslation(page, B1, B2);
  await page.getByRole('button', { name: '寫好了，對照參考譯文' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '對照與自評' })).toBeVisible();
  await c.shot('25-writing-translation-ai-code__anon-revealed');
});

test('29-writing-essay-ai-code__revealed', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, `/writing/essay/ai/${BANK_CP_CODE}`);
  await page.getByRole('textbox', { name: /你的作文/ }).fill(EXAM_ESSAY);
  await page.getByRole('button', { name: '寫好了，看評分規準與範文' }).click();
  await expect(page.getByRole('region', { name: '本題的評分規準' })).toBeVisible();
  await c.shot('29-writing-essay-ai-code__anon-revealed');
});

test('31-writing-essay-exam__student-filled', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/gsat-115');
  await page.getByRole('textbox', { name: /你的作文/ }).fill(EXAM_ESSAY);
  await expect(page.getByTestId('quota-summary')).toBeVisible();
  await c.shot('31-writing-essay-exam__student-filled');
});

test('31-writing-essay-exam__student-photo', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/gsat-115');
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  await expect(page.getByRole('region', { name: '拍照上傳手寫稿' })).toBeVisible();
  await c.shot('31-writing-essay-exam__student-photo');
});

test('30-writing-essay-custom__student-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/custom');
  await page.getByRole('textbox', { name: '作文題目' }).fill(CUSTOM_PROMPT_TEXT);
  await page.getByRole('button', { name: '設成 2 段' }).click();
  await c.shot('30-writing-essay-custom__student-prompt-filled');
  await page.getByRole('button', { name: '題目設定好了' }).click();
  await page.getByRole('textbox', { name: /你的作文/ }).fill(CUSTOM_ESSAY);
  await expect(page.getByTestId('quota-summary')).toBeVisible();
  await c.shot('30-writing-essay-custom__student-writing');
});

// ───────────────────────── 改版會重構的元件：有無紀錄、載入更多、鍵盤聚焦 ─────────────────────────
// docs/design/desktop-ui.md §11.1「開工前要補截的基準情境」中 PR A 的部分。沒有紀錄的樣子就是上面的
// 01-home__anon（學習進度）、03-practice__menu、13-exams__list、14-mock__list；模擬考有紀錄的是 14-mock__list-completed。

/**
 * 這台裝置有學習紀錄：每日學習評了 1 張卡、題庫練習交卷 1 組（答錯的詞彙收進錯題本）、歷屆試題 1 份交卷（考試模式）＋1 份作答中（練習模式），
 * 再截首頁的學習進度（ProgressStats）、題庫練習選單（PracticeHome）、歷屆試題列表（ExamList）。
 */
test('records__flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/words?tab=study');
  await page.getByRole('button', { name: /開始學習（\d+ 張）/ }).click();
  await page.getByRole('button', { name: '顯示答案' }).click();
  await page.getByRole('group', { name: '評分：這個字記得多熟？' }).getByRole('button').nth(2).click();
  await expect(page.getByRole('group', { name: '評分：這個字記得多熟？' })).toBeHidden();

  await open(c, '/practice/vocabulary/basic');
  await expectAnswered(page, await answerRadios(page, 4));
  await submitPractice(page);
  // 答錯的詞彙題正解字是交卷後下載單字索引才收進錯題本（非同步）：等它寫完再離開，首頁的錯題本數字才固定。
  await expect(page.getByText(/^答錯的正解字已收進/)).toBeVisible({ timeout: 30_000 });

  await open(c, '/exams/gsat-115');
  await page.locator('label').filter({ hasText: '考試模式' }).click();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await expectAnswered(page, 1);
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();

  await open(c, '/exams/gsat-114');
  await page.getByRole('button', { name: '開始作答' }).click();
  await expectAnswered(page, await answerRadios(page, 2));

  await open(c, '/exams');
  await expect(page.getByText(/^已交卷・/)).toBeVisible();
  await expect(page.getByText(/^作答中・2／/)).toBeVisible();
  await c.shot('13-exams__list-records');
  await open(c, '/practice');
  await expect(page.getByRole('link', { name: /：\d+ 組，已做 1 組$/ })).toBeVisible();
  await c.shot('03-practice__menu-records');
  await open(c, '/');
  await expect(page.getByTestId('progress-stat')).toHaveCount(3);
  await c.shot('01-home__records');
});

// 寫作紀錄（SubmissionHistory）：沒有紀錄、切到英文作文（含自訂題目的列）、按「載入更多」之後。
// 有紀錄的中譯英就是上面的 12-writing__student。

test('12-writing__student-history-empty', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  c.backend.on('GET /api/submissions', () => ok({ submissions: [], next_cursor: null }));
  await open(c, '/writing');
  await expect(page.getByText('還沒有中譯英的紀錄。')).toBeVisible();
  await c.shot('12-writing__student-history-empty');
});

test('12-writing__student-history-essay', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing');
  const history = page.getByRole('region', { name: '我的寫作紀錄' });
  await history.getByRole('button', { name: '英文作文' }).click();
  await expect(history.getByRole('link', { name: /自訂題目 英文作文/ })).toBeVisible();
  await c.shot('12-writing__student-history-essay');
});

test('12-writing__student-history-more', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  // 一頁 2 筆：按一次「載入更多」之後列表接上第二頁，而且還有下一頁（按鈕仍在）。中譯英另外多兩筆較早的草稿，才有第三頁。
  const older = [113, 112].map((year, i) =>
    summary(detail({ id: `sub-old${i}`, kind: 'translation', group_id: `gsat-${year}.s7g1@1`, status: 'draft', created_at: NOW_S - 86_400 * (10 + i), updated_at: NOW_S - 86_400 * (10 + i) })),
  );
  c.backend.on('GET /api/submissions', (call) => {
    const kind = call.query.get('kind');
    const rows = [...historyRows(kind), ...(kind === 'translation' ? older : [])];
    const n = Number(/^page-(\d+)$/.exec(call.query.get('cursor') ?? '')?.[1] ?? 1);
    return ok({ submissions: rows.slice((n - 1) * 2, n * 2), next_cursor: rows.length > n * 2 ? `page-${n + 1}` : null });
  });
  await open(c, '/writing');
  const history = page.getByRole('region', { name: '我的寫作紀錄' });
  await expect(history.getByRole('link')).toHaveCount(2);
  // 桌機（≥ lg）的寫作紀錄是表格，按鈕寫「再載入 20 筆」（docs/design/desktop-ui.md §5.5）。
  const more = history.getByRole('button', { name: /^(載入更多|再載入 20 筆)$/ });
  await more.click();
  await expect(history.getByRole('link')).toHaveCount(4);
  await expect(more).toBeVisible();
  await c.shot('12-writing__student-history-more');
});

// 鍵盤聚焦（:focus-visible）：難度切換、篩選膠囊、送出按鈕各一張。

test('04-vocabulary__focus-tier', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/vocabulary');
  // 沒選中的難度（選中的是實心主色，焦點框的樣子不同；兩種都會出現在改版後的畫面）。
  const tier = page.getByRole('navigation', { name: /的難度$/ }).locator('a:not([aria-current])').first();
  await keyboardFocus(page, tier);
  await c.shot('04-vocabulary__focus-tier');
});

test('13-exams__focus-filter', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/exams');
  // 膠囊裡是隱藏的 radio，焦點框畫在外面的 label（has-[:focus-visible]）；Tab 進這組 radio 會停在選中的「全部」。
  const pill = page.getByRole('group', { name: '考試' }).getByRole('radio', { name: /^全部/ });
  await expect(pill).toBeChecked();
  await keyboardFocus(page, pill);
  await c.shot('13-exams__focus-filter');
});

test('31-writing-essay-exam__focus-submit', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/gsat-115');
  await page.getByRole('textbox', { name: /你的作文/ }).fill(EXAM_ESSAY);
  const submit = page.getByRole('button', { name: /^送出 AI 批改（\d+ 點）$/ });
  await expect(submit).toBeEnabled();
  await keyboardFocus(page, submit);
  await c.shot('31-writing-essay-exam__focus-submit');
});
