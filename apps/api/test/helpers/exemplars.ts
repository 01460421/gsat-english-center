/**
 * 作文範文的測試小工具（docs/design/model-essays.md §6.1）：直接在假 D1 建 exemplar_sets 的列與它的預扣（E1：帳號匯出與刪除、
 * housekeeping 的回收與清理、consumer 的分流），以及 E2 的端點與 consumer 用的 env 與模型輸出。
 * 範文內容是本站自己寫的短句，不是任何官方或公開的範文。
 */
import type { ExemplarEssayView, ExemplarLevel, ExemplarSetView } from '@gsat/shared';
import { exemplarMetrics } from '@gsat/shared';
import type { Env } from '../../src/env';
import { makeEnv, type TestEnv } from './ai';
import { nowS, seedAssistOp } from './assist';
import type { TestD1 } from './d1';

const DAY = 86_400;

export interface SeedExemplarSet {
  id?: string;
  status?: 'queued' | 'running' | 'done' | 'failed';
  source?: 'exam' | 'bank' | 'custom';
  groupId?: string | null;
  prompt?: Record<string, unknown> | null;
  opId?: string | null;
  leaseUntil?: number | null;
  tries?: number;
  contentFailures?: number;
  output?: ExemplarSetView | null;
  meta?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
  title?: string;
}

/** 建一列（預設：網站題目 gsat-115.s8g1@1、已完成、沒有內容、180 天後到期）。 */
export function seedExemplarSet(db: TestD1, userId: number, opts: SeedExemplarSet = {}): string {
  const id = opts.id ?? crypto.randomUUID();
  const created = opts.createdAt ?? nowS();
  const source = opts.source ?? 'exam';
  const prompt = opts.prompt === undefined ? (source === 'custom' ? { text: '請寫一篇英文作文，談談你最喜歡的季節。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null } : null) : opts.prompt;
  db.sqlite
    .prepare(
      `INSERT INTO exemplar_sets (id, user_id, source, group_id, prompt_json, dedupe_key, title, status, op_id, cache_key, cache_gen, output_json,
                                  rating, injection_flag, prompt_version, served_model, meta_json, lease_until, tries, content_failures,
                                  created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cache-key-secret', 1700000000, ?, NULL, 1, 'pv-secret', 'served-model-secret', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      source,
      opts.groupId === undefined ? (source === 'custom' ? null : 'gsat-115.s8g1@1') : opts.groupId,
      prompt === null ? null : JSON.stringify(prompt),
      `dedupe-${id}`,
      opts.title ?? (source === 'custom' ? '請寫一篇英文作文，談談你最喜歡的季節。' : '115 學測 英文作文'),
      opts.status ?? 'done',
      opts.opId ?? null,
      opts.output ? JSON.stringify(opts.output) : null,
      JSON.stringify(opts.meta ?? { rules: 'lv1', secret: 'meta-secret' }),
      opts.leaseUntil ?? null,
      opts.tries ?? 0,
      opts.contentFailures ?? 0,
      created,
      opts.updatedAt ?? created,
      opts.expiresAt ?? created + 180 * DAY,
    );
  return id;
}

/** 建一筆作文範文的預扣（ai_ops，reserved，8 點；created_at 可以往前調模擬卡住）。 */
export function seedExemplarOp(db: TestD1, userId: number, refId: string, opts: { id?: string; createdAt?: number } = {}): string {
  return seedAssistOp(db, userId, 'essay_exemplars', refId, { ...opts, points: 8 });
}

/** 一個「進行中」的範文操作：列是 running（有效租約、處理過一次）、31 分鐘前預扣。 */
export function runningExemplar(db: TestD1, userId: number, opts: { lease?: number | null; tries?: number; age?: number; status?: 'queued' | 'running' } = {}) {
  const setId = crypto.randomUUID();
  const opId = seedExemplarOp(db, userId, setId, { createdAt: nowS() - (opts.age ?? 31 * 60) });
  seedExemplarSet(db, userId, { id: setId, status: opts.status ?? 'running', opId, leaseUntil: opts.lease === undefined ? nowS() + 600 : opts.lease, tries: opts.tries ?? 1 });
  return { setId, opId };
}

/** 一篇範文的顯示形狀（本站自己寫的短文）。 */
function essay(level: ExemplarLevel, text: string): ExemplarEssayView {
  return {
    level,
    text,
    hidden: null,
    targets: { words: [130, 170], paragraphs: 2 },
    metrics: exemplarMetrics(text),
    criteria: { content: '每一項要求都有回應。', organization: '兩段結構清楚。', grammar: '句型正確。', vocabulary: '用字正確。' },
    highlights: [{ kind: 'connective', text: 'However', zh: '轉折。' }],
    next_zh: '多寫一個具體的例子。',
  };
}

/** 一組範文（三篇都是本站自己寫的句子）。 */
export function sampleExemplarView(): ExemplarSetView {
  const p1 = 'My favorite season is autumn because the air is cool and the sky is clear. I often walk to school with my friends.';
  const p2 = 'However, autumn is also a busy season for students. We have many tests, so I plan my time carefully every week.';
  return {
    task_reading_zh: '題目要你寫兩段：喜歡的季節與原因、這個季節的生活。',
    plan_zh: '第一段寫秋天的天氣，第二段寫秋天的考試與時間安排。',
    essays: [essay('basic', `${p1}\n${p2}`), essay('steady', `${p1}\n${p2}`), essay('top', `${p1}\n${p2}`)],
    typical_errors: [{ wrong: 'I am very like autumn.', right: 'I really like autumn.', zh: 'like 是動詞，前面不加 be 動詞。' }],
    safety_flag: null,
  };
}

// ───────────────────────── E2：產生範文的端點與 consumer 用的測試資料 ─────────────────────────

/** 作文範文打開的 env（AI_ESSAY_EXEMPLARS=on；正式環境的預設是 off）。 */
export function exemplarsEnv(overrides: Partial<Env> = {}, db?: TestD1): TestEnv {
  return makeEnv({ AI_ESSAY_EXEMPLARS: 'on', ...overrides }, db);
}

/** 本站自己寫的句子（不是任何官方或公開範文），依序取用湊出指定字數的範文。 */
const SENTENCES = [
  'Many families in my neighborhood now treat their pets like real children.',
  'However, this change also brings some problems that we should not ignore.',
  'For example, my aunt spends a lot of money on special food for her dog.',
  'She says that her dog makes her feel less lonely after a long day at work.',
  'In addition, some young couples decide to raise a cat instead of a baby.',
  'As a result, pet shops and animal hospitals have become very busy in recent years.',
  'I think this trend shows how much people need love and company in a busy city.',
  'On the other hand, pets cannot replace the warm relationships between people.',
  'Therefore, we should take good care of our pets and our friends at the same time.',
  'Last summer, I helped my neighbor walk her old dog every evening after dinner.',
  'Because of that experience, I learned that caring for an animal takes patience.',
  'In my opinion, a pet is a responsibility as well as a source of happiness.',
];

/** 湊出剛好 words 個英文單詞、paragraphs 段的範文（段落之間一個換行；每段至少 8 個單詞）。 */
export function essayText(words: number, paragraphs = 2, offset = 0): string {
  const out: string[] = [];
  let count = 0;
  let i = offset;
  while (count < words) {
    const sentence = SENTENCES[i % SENTENCES.length]!;
    const ws = sentence.split(' ');
    const need = words - count;
    out.push(ws.length <= need ? sentence : `${ws.slice(0, need).join(' ').replace(/[.,]$/, '')}.`);
    count += Math.min(ws.length, need);
    i += 1;
  }
  const per = Math.ceil(out.length / paragraphs);
  const paras: string[] = [];
  for (let p = 0; p < paragraphs; p += 1) paras.push(out.slice(p * per, (p + 1) * per).join(' '));
  return paras.filter((p) => p !== '').join('\n');
}

export interface ExemplarOutputShape {
  is_writing_task: boolean;
  task_reading_zh: string;
  plan_zh: string;
  basic_text: string;
  steady_text: string;
  top_text: string;
  highlights: Array<{ level: ExemplarLevel; kind: 'connective' | 'detail' | 'experience' | 'pattern' | 'phrase'; text: string; zh: string }>;
  typical_errors: Array<{ wrong: string; right: string; zh: string }>;
  safety_flag: 'none' | 'self_harm_risk' | 'abuse_disclosure' | 'other';
  [key: string]: unknown;
}

/**
 * 一份會通過後處理的模型輸出（預設：歷屆題的預設階梯 150／210／340 字、兩段）。字數與段數可以改，用來測硬性檢查。
 */
export function exemplarOutput(overrides: Partial<ExemplarOutputShape> = {}, words: Record<ExemplarLevel, number> = { basic: 150, steady: 210, top: 340 }, paragraphs = 2): ExemplarOutputShape {
  const criteria = (level: string) =>
    Object.fromEntries(['content', 'organization', 'grammar', 'vocabulary'].map((c) => [`${level}_${c}_zh`, `${level} 的 ${c}：每一項要求都有回應，例如 "pets"。`]));
  return {
    is_writing_task: true,
    task_reading_zh: '題目要你寫兩段：描述圖片的現象，再說明原因與影響。',
    plan_zh: '第一段寫寵物像孩子的現象；第二段寫原因（陪伴、花費）與影響。',
    basic_text: essayText(words.basic, paragraphs, 0),
    steady_text: essayText(words.steady, paragraphs, 1),
    top_text: essayText(words.top, paragraphs, 2),
    ...criteria('basic'),
    ...criteria('steady'),
    ...criteria('top'),
    basic_next_zh: '第二段加一個具體的例子，並換掉重複的 and。',
    steady_next_zh: '加入自己的反思，讓結尾回應題目。',
    top_next_zh: '時間不夠時先保住兩段的主題句與例子，刪掉第二個例子。',
    highlights: [
      { level: 'basic', kind: 'detail', text: 'Many families in my neighborhood now treat their pets like real children.', zh: '開頭直接描述現象。' },
      { level: 'steady', kind: 'connective', text: 'However', zh: '轉折。' },
      { level: 'top', kind: 'pattern', text: 'this change also brings some problems', zh: '好用的句型。' },
    ],
    typical_errors: [
      { wrong: 'Pets is very important for many people.', right: 'Pets are very important to many people.', zh: '主詞是複數，動詞用 are。' },
      { wrong: 'I am very like my dog.', right: 'I really like my dog.', zh: 'like 是動詞，前面不加 be 動詞。' },
    ],
    safety_flag: 'none',
    ...overrides,
  };
}
