/**
 * AI 批改測試的共用工具：假 D1（helpers/d1.ts）＋假 Queue＋注入登入者的 app＋測試用的模型輸出。負責：後端 AI A2。
 *
 * 登入者：直接在 context 放 sessionUser（src/auth/session.ts 的 getSessionUser 先讀快取），
 * 不依賴 cookie 的實作，A1 的登入流程改動不會影響這些測試。
 */
import type { AiTask } from '@gsat/shared';
import { Hono } from 'hono';
import { app } from '../../src/app';
import type { SessionUser } from '../../src/auth/session';
import type { AiQueueMessage, AppEnv, Env } from '../../src/env';
import { handleError, handleNotFound } from '../../src/errors';
import type { EssayAnalyticOutput, EssayHolisticOutput } from '../../src/ai/prompts/essay';
import type { TranslationModelOutput } from '../../src/ai/prompts/translation';
import { createTestD1, type TestD1 } from './d1';

export const ORIGIN = 'https://gsat.example';
export const TRANSLATION_GROUP = 'gsat-115.s7g1@1';
export const ESSAY_GROUP = 'gsat-115.s8g1@1';

export interface FakeQueue extends Queue<AiQueueMessage> {
  sent: AiQueueMessage[];
  fail: boolean;
}

export function fakeQueue(): FakeQueue {
  const q = {
    sent: [] as AiQueueMessage[],
    fail: false,
    async send(body: AiQueueMessage) {
      if (q.fail) throw new Error('queue down');
      q.sent.push(body);
    },
    async sendBatch(messages: Iterable<{ body: AiQueueMessage }>) {
      for (const m of messages) q.sent.push(m.body);
    },
  };
  return q as unknown as FakeQueue;
}

export interface TestEnv extends Env {
  DB: TestD1;
  AI_QUEUE: FakeQueue;
}

export function makeEnv(overrides: Partial<Env> = {}, db: TestD1 = createTestD1()): TestEnv {
  return {
    DB: db,
    ALLOWED_ORIGINS: ORIGIN,
    APP_ORIGIN: ORIGIN,
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    SESSION_SECRET: 's'.repeat(48),
    LEDGER_SALT: 'ledger-salt-for-tests',
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    ANTHROPIC_BASE_URL: 'https://anthropic.test',
    AI_QUEUE: fakeQueue(),
    ...overrides,
  } as TestEnv;
}

let seq = 0;

/** 建一個使用者（email、暱稱刻意用好認的字串，規則測試會確認它們沒有送給 Claude）。 */
export function seedUser(db: TestD1, opts: Partial<Pick<SessionUser, 'role' | 'aiStatus' | 'aiTier' | 'aiPointsDay' | 'aiPointsMonth'>> = {}): SessionUser {
  seq++;
  const publicId = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  const email = `student${seq}.secret@example.com`;
  const displayName = `暱稱小明${seq}`;
  const row = db.sqlite
    .prepare(
      `INSERT INTO users (public_id, google_sub, email, display_name, role, ai_status, ai_tier, ai_points_day, ai_points_month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(publicId, `google-sub-${seq}`, email, displayName, opts.role ?? 'student', opts.aiStatus ?? 'approved', opts.aiTier ?? 'standard', opts.aiPointsDay ?? null, opts.aiPointsMonth ?? null) as { id: number };
  return {
    id: row.id,
    publicId,
    email,
    displayName,
    role: opts.role ?? 'student',
    status: 'active',
    ageBand: '18plus',
    aiStatus: opts.aiStatus ?? 'approved',
    aiTier: opts.aiTier ?? 'standard',
    aiPointsDay: opts.aiPointsDay ?? null,
    aiPointsMonth: opts.aiPointsMonth ?? null,
    sessionVer: 1,
    loginAt: Math.floor(Date.now() / 1000),
    consentsCurrent: true,
  };
}

/** 以指定使用者的身分呼叫 app（null＝未登入）。 */
export function appAs(user: SessionUser | null) {
  const wrapper = new Hono<AppEnv>();
  wrapper.use('*', async (c, next) => {
    c.set('sessionUser', user);
    await next();
  });
  wrapper.route('/', app);
  wrapper.onError(handleError);
  wrapper.notFound(handleNotFound);
  return wrapper;
}

/** 發 JSON 請求（非 GET 自動帶允許的 Origin）。 */
export async function call(env: TestEnv, user: SessionUser | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await appAs(user).request(path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

export interface FakeMessage {
  body: AiQueueMessage;
  attempts: number;
  acked: boolean;
  retried: { delaySeconds?: number } | null;
}

export function makeMessage(body: AiQueueMessage, attempts = 1): Message<AiQueueMessage> & FakeMessage {
  const m = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    body,
    attempts,
    acked: false,
    retried: null as { delaySeconds?: number } | null,
    ack() {
      m.acked = true;
    },
    retry(opts?: { delaySeconds?: number }) {
      m.retried = opts ?? {};
    },
  };
  return m as unknown as Message<AiQueueMessage> & FakeMessage;
}

export function batchOf(queue: string, messages: Array<Message<AiQueueMessage>>): MessageBatch<AiQueueMessage> {
  return { queue, messages, ackAll() {}, retryAll() {} } as unknown as MessageBatch<AiQueueMessage>;
}

export const noopCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

/** 某任務的 ai_ops 列。 */
export function opsOf(db: TestD1, task?: AiTask): Array<Record<string, any>> {
  return (task ? db.sqlite.prepare('SELECT * FROM ai_ops WHERE task = ? ORDER BY created_at').all(task) : db.sqlite.prepare('SELECT * FROM ai_ops').all()) as Array<Record<string, any>>;
}

// ───────────────────────── 測試用的學生作答與模型輸出（本站自己寫的句子，不是官方譯文或範文） ─────────────────────────

/** 中譯英兩句（故意有錯：第 1 句單複數；第 2 句句首小寫、沒有句號、單複數與大小寫）。 */
export const STUDENT_TRANSLATION = [
  'Nowadays more high school English teacher has raised how often they speak English in class.',
  'they put students in groups by their english level and do many listening and speaking activity',
];

function parts(texts: [string, string, string, string], missing: boolean[] = [false, false, false, false]) {
  return texts.map((t, i) => ({ part: i + 1, source_zh: `第${i + 1}段`, student_excerpt: t, missing: missing[i] ?? false }));
}

/** 第一位（analytic）：第 1 句 1 個錯、第 2 句 2 個錯 → 程式算 3.5＋(4−1−1)＝5.5。 */
export function translationAnalyticOutput(): TranslationModelOutput {
  return {
    sentences: [
      { sentence_index: 0, parts: parts(['Nowadays', 'more high school English teacher has raised', 'how often they speak English', 'in class.']), corrected: 'Nowadays more high school English teachers have raised how often they speak English in class.', explanation_zh: '主詞是複數，動詞要配合。' },
      { sentence_index: 1, parts: parts(['they put students in groups', 'by their english level', 'and do', 'many listening and speaking activity']), corrected: 'They put students in groups by their English level and do many listening and speaking activities.', explanation_zh: '注意大小寫與名詞複數。' },
    ],
    errors: [
      { sentence_index: 0, part: 2, category: 'grammar', excerpt: 'teacher has', explanation_zh: '主詞應為複數 teachers，動詞用 have。', suggestion: 'teachers have', repeat_of: null },
      { sentence_index: 1, part: 2, category: 'other', excerpt: 'english', explanation_zh: '語言名稱要大寫。', suggestion: 'English', repeat_of: null },
      { sentence_index: 1, part: 4, category: 'grammar', excerpt: 'activity', explanation_zh: 'many 後面要接複數名詞。', suggestion: 'activities', repeat_of: null },
    ],
  };
}

/** 第二位（holistic）：每句 1 個錯 → 3.5＋(3.5−1)＝6；和第一位差 0.5，不需要第三位。 */
export function translationHolisticOutput(opts: { allMissing?: boolean } = {}): TranslationModelOutput {
  const missing = opts.allMissing ? [true, true, true, false] : [false, false, false, false];
  return {
    sentences: [
      { sentence_index: 0, explanation_zh: '大致達意。', parts: parts(['Nowadays', 'more high school English teacher has raised', 'how often they speak English', 'in class.'], missing), corrected: 'Nowadays more high school English teachers have raised how often they speak English in class.' },
      { sentence_index: 1, explanation_zh: '意思正確但有小錯。', parts: parts(['they put students in groups', 'by their english level', 'and do', 'many listening and speaking activity'], missing), corrected: 'They put students in groups by their English level and do many listening and speaking activities.' },
    ],
    errors: [
      { sentence_index: 0, part: 2, category: 'grammar', excerpt: 'teacher has', explanation_zh: '單複數。', suggestion: 'teachers have', repeat_of: null },
      { sentence_index: 1, part: 4, category: 'grammar', excerpt: 'activity', explanation_zh: '單複數。', suggestion: 'activities', repeat_of: null },
    ],
  };
}

/** 作文：兩段、約 130 字（本站自己寫的練習作文）。 */
export const STUDENT_ESSAY = [
  'In the pictures, people treat their pets like children. A man carries a small dog on his shoulder, and a woman pushes two dogs in a stroller. In another picture, a young couple feeds a puppy with a spoon, just like the parents who feed their baby. Pets are no longer only animals in the yard; they have become members of the family.',
  'I think there are two reasons for this change. First, many young people in Taiwan live alone and feel lonely after work, so a pet gives them company. Second, raising a child costs a lot of money, so some couples choose to keep a dog instead. However, this trend may cause problems, because pets cannot replace real human relationships, and some owners spend too much money on them.',
].join('\n\n');

export function essayAnalyticOutput(scores: [number, number, number, number] = [4, 3, 3, 4], extra: Partial<EssayAnalyticOutput> = {}): EssayAnalyticOutput {
  return {
    off_topic: false,
    criteria: {
      content: { score: scores[0], explanation_zh: '有回應圖片與原因。' },
      organization: { score: scores[1], explanation_zh: '兩段結構清楚。' },
      grammar: { score: scores[2], explanation_zh: '偶有小錯。' },
      vocabulary: { score: scores[3], explanation_zh: '用字恰當。' },
    },
    comment_zh: '整體表現不錯。',
    top_improvements: ['第二段加一個具體的例子', '多用轉承詞', '注意冠詞'],
    paragraph_advice: [
      { paragraph_index: 0, advice_zh: '描述可以更具體。' },
      { paragraph_index: 1, advice_zh: '影響可以多寫一點。' },
    ],
    errors: [{ paragraph_index: 1, category: 'grammar', excerpt: 'feel lonely after work', explanation_zh: '可以更自然。', suggestion: 'feel lonely after work every day' }],
    rewrite: null,
    safety_flag: 'none',
    ...extra,
  };
}

export function essayHolisticOutput(scores: [number, number, number, number] = [3, 3, 3, 3]): EssayHolisticOutput {
  return {
    holistic_total: scores.reduce((a, b) => a + b, 0),
    off_topic: false,
    scores: { content: scores[0], organization: scores[1], grammar: scores[2], vocabulary: scores[3] },
    comment_zh: '內容完整。',
    safety_flag: 'none',
  };
}

/** 最小的合法 JPEG（含一段 APP1／EXIF，測試會確認存進 D1 之前被剝除）。 */
export function tinyJpeg(width = 1200, height = 1600, padding = 0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const exifPayload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53]; // "Exif\0\0GPS"
  const app1 = [0xff, 0xe1, 0x00, exifPayload.length + 2, ...exifPayload];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  const data = new Array(16 + padding).fill(0x55);
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, ...sof0, ...sos, ...data, 0xff, 0xd9]);
}

/** multipart 上傳一張照片。 */
export async function uploadPhoto(env: TestEnv, user: SessionUser, submissionId: string, ord: number, bytes: Uint8Array, type = 'image/jpeg') {
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type }), 'photo.jpg');
  const res = await appAs(user).request(`/api/submissions/${submissionId}/photos?ord=${ord}`, { method: 'POST', headers: { Origin: ORIGIN }, body: form }, env);
  return { status: res.status, body: (await res.json()) as any };
}
