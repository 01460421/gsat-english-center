/**
 * 作文範文的 consumer（docs/design/model-essays.md §7.4 第 2 點、§3.5、§3.6、§4.3；§9.2 exemplars.consumer.test.ts）。
 * Anthropic 一律用假回應；範文是本站自己寫的句子（helpers/exemplars.ts），誘餌也是本站自寫的英文。
 * 後處理的每一條規則在 exemplars.output.test.ts；這裡測整條路：結算、事件、共用快取的寫入條件、§3.6 跨投遞的三個情境、
 * 不是寫作題、題目讀不到、全站暫停、拒答、重送只結算一次。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueueHandler } from '../src/ai/consumer';
import { resetD8ForTests } from '../src/ai/d8';
import { setPausedStatement } from '../src/ai/guard';
import { MODEL_PRICING } from '../src/ai/pricing';
import { EXEMPLAR_ROLE } from '../src/ai/prompts/exemplars';
import { loadConfig } from '../src/config';
import { EXEMPLAR_CONTENT_REFUND_MARK } from '../src/exemplars/consumer';
import type { SessionUser } from '../src/auth/session';
import { batchOf, call, ESSAY_GROUP, makeMessage, noopCtx, seedUser, type TestEnv } from './helpers/ai';
import { FakeAnthropic, type Responder } from './helpers/anthropic';
import { CUSTOM_TASK, FAKE_OFFICIAL_EN, fakeFingerprintFile } from './helpers/customEssay';
import { essayText, exemplarOutput, exemplarsEnv } from './helpers/exemplars';

const fp = vi.hoisted(() => ({ file: {} as Record<string, unknown> }));
vi.mock('../src/generated/d8-fingerprints.json', () => ({ default: fp.file }));

beforeEach(() => {
  for (const k of Object.keys(fp.file)) delete fp.file[k];
  Object.assign(fp.file, fakeFingerprintFile());
  resetD8ForTests();
});

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  return fn().finally(() => {
    console.log = log;
    console.error = error;
  });
}

const row = (env: TestEnv, sql: string, ...args: unknown[]) => env.DB.sqlite.prepare(sql).get(...(args as never[])) as Record<string, any>;
const count = (env: TestEnv, sql: string, ...args: unknown[]) => Number(row(env, sql, ...args)['n']);

/** 預設模型與另一個價格表裡的模型（模擬 server-side fallback 接手；測試不寫死模型代號）。 */
const DEFAULT_MODEL = loadConfig(exemplarsEnv()).ai.models.default;
const OTHER_MODEL = Object.keys(MODEL_PRICING).find((m) => m !== DEFAULT_MODEL)!;

/** 本站自寫的英文誘餌（模擬學生貼進自訂題的一段文字；不是任何佳作或範文）。 */
const BAIT = 'Our robotics club spent three rainy weekends building a tiny boat that could sail across the school pond without help.';

interface Setup {
  env: TestEnv;
  user: SessionUser;
  clock: { t: number };
}

function setup(): Setup {
  const env = exemplarsEnv();
  return { env, user: seedUser(env.DB), clock: { t: Date.now() } };
}

async function create(s: Setup, body: Record<string, unknown> = { source: 'site', group_id: ESSAY_GROUP }): Promise<{ id: string; opId: string }> {
  const res = await quiet(() => call(s.env, s.user, 'POST', '/api/exemplars', body));
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return { id: res.body.id, opId: res.body.op_id };
}

/** 跑一則訊息（時間用 s.clock；回應可以把時間往前撥，模擬一次呼叫花了多久）。 */
async function run(s: Setup, fake: FakeAnthropic, opId: string, attempts = 1) {
  const msg = makeMessage({ op_id: opId }, attempts);
  await quiet(() => createQueueHandler({ fetch: fake.fetch, now: () => s.clock.t })(batchOf('ai-tasks', [msg]), s.env, noopCtx));
  return msg;
}

/** 回應前把時間往前撥 seconds 秒。 */
function taking(s: Setup, seconds: number, responder: Responder): Responder {
  return (req, i) => {
    s.clock.t += seconds * 1_000;
    return responder(req, i);
  };
}

const json = (output: unknown, o: Parameters<FakeAnthropic['json']>[1] = {}) => {
  const fake: FakeAnthropic = new FakeAnthropic(() => fake.json(output, { model: DEFAULT_MODEL, ...o }));
  return fake;
};

async function detail(s: Setup, id: string) {
  const res = await call(s.env, s.user, 'GET', `/api/exemplars/${id}`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('正常結算（網站題目）', () => {
  it('列改 done、output_json 是 ExemplarSetView、點數實扣 8、ai_calls 1 列；請求：系統提示 1 小時快取、max_tokens 16,000、effort、schema 沒有 $ref、沒有個資；寫進共用快取並記下鍵與代', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    const fake = json(exemplarOutput());
    const msg = await run(s, fake, opId);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect(req.system.startsWith(EXEMPLAR_ROLE)).toBe(true);
    expect(req.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(req.body.max_tokens).toBe(16_000);
    expect(req.body.output_config.effort).toBe('medium');
    const schema = JSON.stringify(req.body.output_config.format.schema);
    expect(schema).not.toContain('$ref');
    expect(schema).not.toContain('$defs');
    const body = JSON.stringify(req.body);
    expect(body).not.toContain(s.user.email);
    expect(body).not.toContain(s.user.displayName);
    expect(body).not.toContain(s.user.publicId);
    expect(req.userText).not.toContain('115');

    expect(row(s.env, 'SELECT status, points_charged FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'settled', points_charged: 8 });
    const r = row(s.env, 'SELECT * FROM exemplar_sets WHERE id = ?', id);
    expect(r).toMatchObject({ status: 'done', lease_until: null, d8_hidden: 0, safety_flag: null, failure: null, content_failures: 0 });
    expect(r['prompt_version']).toMatch(/^[0-9a-f]{12}$/);
    expect(r['served_model']).toBe(DEFAULT_MODEL);
    const meta = JSON.parse(r['meta_json']);
    expect(meta).toMatchObject({ levels: 'lv1', filter_version: 'f4', d8_fp: 'test-fp-0001', template: 'exemplar-user-site@1', counts: { words_soft: 0 } });
    expect(meta.details.words).toEqual({ basic: 150, steady: 210, top: 340 });
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?', opId)).toBe(1);
    expect(row(s.env, 'SELECT task, role FROM ai_calls WHERE op_id = ?', opId)).toEqual({ task: 'essay_exemplars', role: 'writer' });

    const d = await detail(s, id);
    expect(d).toMatchObject({ status: 'done', cache_hit: false, failure: null });
    expect(d.view.essays.map((e: { metrics: { words: number } }) => e.metrics.words)).toEqual([150, 210, 340]);
    expect(d.view.typical_errors).toHaveLength(2);

    const cache = row(s.env, 'SELECT cache_key, kind, ref_id, status, created_at, result_json FROM ai_shared_cache');
    expect(cache).toMatchObject({ kind: 'explain_template', ref_id: `exemplar:${ESSAY_GROUP}`, status: 'active' });
    expect(JSON.parse(cache['result_json'])).toEqual(d.view);
    expect(row(s.env, 'SELECT cache_key, cache_gen FROM exemplar_sets WHERE id = ?', id)).toEqual({ cache_key: cache['cache_key'], cache_gen: cache['created_at'] });

    // 下一位學生產生同一題：共用快取命中（0 點、同一份內容）。
    const other = seedUser(s.env.DB);
    const hit = await quiet(() => call(s.env, other, 'POST', '/api/exemplars', { source: 'site', group_id: ESSAY_GROUP }));
    expect(hit.status).toBe(200);
    expect(hit.body).toMatchObject({ cache_hit: true, view: d.view });

    // 同一則訊息再送一次：已結算，直接 ack、不呼叫。
    const again = await run(s, fake, opId, 2);
    expect(again.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
  });

  it('D8 隱藏一篇：照常結算（照扣）、d8_hidden=1、exemplar_d8_output 事件（只有 op id 與層級）、不寫共用快取', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    const o = exemplarOutput();
    const [p1, p2] = o.top_text.split('\n');
    await run(s, json({ ...o, top_text: `${p1} ${FAKE_OFFICIAL_EN}.\n${p2}` }), opId);
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('settled');
    expect(row(s.env, 'SELECT d8_hidden FROM exemplar_sets WHERE id = ?', id).d8_hidden).toBe(1);
    const ev = JSON.parse(row(s.env, "SELECT detail_json FROM ops_events WHERE kind = 'exemplar_d8_output'").detail_json);
    expect(ev).toEqual({ op_id: opId, levels: ['top'] });
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache')).toBe(0);
    const d = await detail(s, id);
    expect(d.view.essays[2]).toMatchObject({ text: null, hidden: 'd8' });
  });

  it('共用快取的寫入條件：safety_flag、server-side fallback 接手、重新產生都不寫；被停用的列由新的結果取代', async () => {
    const s = setup();
    const a = await create(s);
    await run(s, json(exemplarOutput({ safety_flag: 'other' })), a.opId);
    expect(row(s.env, 'SELECT safety_flag, status FROM exemplar_sets WHERE id = ?', a.id)).toEqual({ safety_flag: 'other', status: 'done' });
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'wellbeing_flag'")).toBe(1);
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache')).toBe(0);

    const s2 = setup();
    const b = await create(s2);
    await run(s2, json(exemplarOutput(), { model: OTHER_MODEL }), b.opId);
    expect(row(s2.env, 'SELECT status, served_model FROM exemplar_sets WHERE id = ?', b.id)).toEqual({ status: 'done', served_model: OTHER_MODEL });
    expect(JSON.parse(row(s2.env, 'SELECT meta_json FROM exemplar_sets WHERE id = ?', b.id).meta_json).served_fallback).toBe(true);
    expect(count(s2.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache')).toBe(0);

    const s3 = setup();
    const c = await create(s3, { source: 'site', group_id: ESSAY_GROUP, fresh: true });
    await run(s3, json(exemplarOutput()), c.opId);
    expect(row(s3.env, 'SELECT status, cache_key FROM exemplar_sets WHERE id = ?', c.id)).toEqual({ status: 'done', cache_key: null });
    expect(count(s3.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache')).toBe(0);

    // 被停用的列：下一次產生的結果取代它（新的一代）。
    const s4 = setup();
    const first = await create(s4);
    await run(s4, json(exemplarOutput()), first.opId);
    const old = row(s4.env, 'SELECT cache_key, created_at FROM ai_shared_cache');
    s4.env.DB.sqlite.prepare(`UPDATE ai_shared_cache SET status = 'flagged', created_at = created_at - 100`).run();
    const other = seedUser(s4.env.DB);
    const res = await quiet(() => call(s4.env, other, 'POST', '/api/exemplars', { source: 'site', group_id: ESSAY_GROUP }));
    expect(res.status).toBe(202);
    s4.clock.t += 5_000;
    await run(s4, json(exemplarOutput({ plan_zh: '新的構想。' })), res.body.op_id);
    const replaced = row(s4.env, 'SELECT cache_key, status, created_at, hits, result_json FROM ai_shared_cache');
    expect(replaced).toMatchObject({ cache_key: old['cache_key'], status: 'active', hits: 0 });
    expect(replaced['created_at']).toBeGreaterThan(old['created_at'] - 100);
    expect(JSON.parse(replaced['result_json']).plan_zh).toBe('新的構想。');
    expect(row(s4.env, 'SELECT cache_gen FROM exemplar_sets WHERE id = ?', res.body.id).cache_gen).toBe(replaced['created_at']);
  });
});

describe('自訂題', () => {
  it('結算、不寫共用快取；照抄題目的那一篇隱藏（連同它的說明）、寫 exemplar_task_copy（op id、層級、窗口數）', async () => {
    const s = setup();
    const { id, opId } = await create(s, { source: 'custom', prompt: { text: `${CUSTOM_TASK}\n${BAIT}`, paragraphs: 2, min_words: 120 } });
    const o = exemplarOutput();
    const [p1, p2] = o.steady_text.split('\n');
    const fake = json({ ...o, steady_text: `${p1} ${BAIT}\n${p2}` });
    await run(s, fake, opId);
    expect(fake.requests[0]!.userText).toContain('<student_text role="task">');
    expect(row(s.env, 'SELECT status FROM exemplar_sets WHERE id = ?', id).status).toBe('done');
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache')).toBe(0);
    const ev = JSON.parse(row(s.env, "SELECT detail_json FROM ops_events WHERE kind = 'exemplar_task_copy'").detail_json);
    expect(ev).toMatchObject({ op_id: opId, level: 'steady' });
    expect(ev.windows).toBeGreaterThanOrEqual(2);
    const d = await detail(s, id);
    // 被隱藏的那一篇只有固定說明：四項說明、升級說明、亮點都不留（它們引用那一篇）。
    expect(d.view.essays[1]).toMatchObject({ text: null, hidden: 'task_copy', highlights: [], next_zh: '', criteria: { content: '', organization: '', grammar: '', vocabulary: '' } });
    expect(d.view.essays[0].criteria.content).not.toBe('');
    expect(JSON.parse(row(s.env, 'SELECT meta_json FROM exemplar_sets WHERE id = ?', id).meta_json)).toMatchObject({ custom_rules: 'cp2', template: 'exemplar-user-custom@1' });
  });

  it('不是寫作題：不重試，以 invalid_output 退還；meta.not_writing_task、詳情帶 not_writing_task；算進每日內容退還', async () => {
    const s = setup();
    const { id, opId } = await create(s, { source: 'custom', prompt: { text: '請解方程式 x 的平方減 5x 加 6 等於 0，寫出每一個步驟。', paragraphs: null } });
    const fake = json(exemplarOutput({ is_writing_task: false, basic_text: '', steady_text: '', top_text: '', highlights: [], typical_errors: [] }));
    const msg = await run(s, fake, opId);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
    const d = await detail(s, id);
    expect(d).toMatchObject({ status: 'failed', failure: 'invalid_output', not_writing_task: true, view: null });
    expect(count(s.env, `SELECT COUNT(*) AS n FROM ops_events WHERE kind = '${EXEMPLAR_CONTENT_REFUND_MARK}'`)).toBe(1);
    expect(d.safety_flag).toBeUndefined();
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'wellbeing_flag'")).toBe(0);
  });

  it('不是寫作題但標了身心安全旗標（題目欄寫的是心裡的話）：照樣退還，但旗標留在列上、寫 wellbeing_flag 事件，詳情帶 safety_flag（§1.11）', async () => {
    const s = setup();
    const { id, opId } = await create(s, { source: 'custom', prompt: { text: '我最近壓力很大，覺得不想活了，沒有人在乎我。', paragraphs: null } });
    const fake = json(exemplarOutput({ is_writing_task: false, basic_text: '', steady_text: '', top_text: '', highlights: [], typical_errors: [], safety_flag: 'self_harm_risk' }));
    await run(s, fake, opId);
    expect(fake.requests).toHaveLength(1);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
    expect(row(s.env, 'SELECT status, failure, safety_flag FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'failed', failure: 'invalid_output', safety_flag: 'self_harm_risk' });
    const events = s.env.DB.sqlite.prepare("SELECT op_id, category, user_ref FROM ai_safety_events WHERE kind = 'wellbeing_flag'").all() as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ op_id: opId, category: 'self_harm_risk' });
    expect(events[0]!['user_ref']).toEqual(expect.any(String));
    const d = await detail(s, id);
    expect(d).toMatchObject({ status: 'failed', failure: 'invalid_output', not_writing_task: true, view: null, safety_flag: 'self_harm_risk' });
    // 同一則訊息再送一次：已退還，不再呼叫、不重複寫事件。
    await run(s, fake, opId, 2);
    expect(fake.requests).toHaveLength(1);
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'wellbeing_flag'")).toBe(1);
  });

  it('標了旗標的寫作題，兩次產生都過不了硬性檢查（跨投遞）而退還：旗標與事件都在（第二次沒標也一樣）', async () => {
    const s = setup();
    const { id, opId } = await create(s, { source: 'custom', prompt: { text: `${CUSTOM_TASK}\n最近我常常覺得很難過，不想活了。`, paragraphs: 2, min_words: 120 } });
    const bad = (safety_flag: 'self_harm_risk' | 'none') => exemplarOutput({ safety_flag }, { basic: 60, steady: 210, top: 340 });
    const fake: FakeAnthropic = new FakeAnthropic(taking(s, 150, (_req, i) => fake.json(bad(i === 0 ? 'self_harm_risk' : 'none'), { model: DEFAULT_MODEL })));
    expect((await run(s, fake, opId, 1)).retried).not.toBeNull();
    expect(row(s.env, 'SELECT status, safety_flag FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'running', safety_flag: 'self_harm_risk' });
    expect((await run(s, fake, opId, 2)).acked).toBe(true);
    expect(fake.requests).toHaveLength(2);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
    expect(row(s.env, 'SELECT status, safety_flag FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'failed', safety_flag: 'self_harm_risk' });
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'wellbeing_flag' AND category = 'self_harm_risk'")).toBe(1);
    expect((await detail(s, id)).safety_flag).toBe('self_harm_risk');
  });

  it('第一次產生標了旗標但內容失敗、同一次投遞重試成功（沒標）：結算的列與 view 都帶最嚴重的旗標，事件只有一筆', async () => {
    const s = setup();
    const { id, opId } = await create(s, { source: 'custom', prompt: { text: `${CUSTOM_TASK}\n我在家裡常常被打，不知道可以跟誰說。`, paragraphs: 2, min_words: 120 } });
    const fake: FakeAnthropic = new FakeAnthropic(
      taking(s, 60, (_req, i) => fake.json(i === 0 ? exemplarOutput({ safety_flag: 'abuse_disclosure' }, { basic: 60, steady: 210, top: 340 }) : exemplarOutput(), { model: DEFAULT_MODEL })),
    );
    await run(s, fake, opId, 1);
    expect(fake.requests).toHaveLength(2);
    expect(row(s.env, 'SELECT status, safety_flag FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'done', safety_flag: 'abuse_disclosure' });
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'wellbeing_flag'")).toBe(1);
    const d = await detail(s, id);
    expect(d.view.safety_flag).toBe('abuse_disclosure');
    expect(d.safety_flag).toBe('abuse_disclosure');
  });
});

describe('§3.6 內容失敗跨 Queue 投遞累計（一個操作最多付費產生 2 次）', () => {
  it('(a) 第一次呼叫 150 秒後硬性檢查不過 → 交回 Queue；第二次投遞仍不過 → 退還；ai_calls 總共 2 列、content_failures 2', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    const bad = exemplarOutput({}, { basic: 60, steady: 210, top: 340 });
    const fake: FakeAnthropic = new FakeAnthropic(taking(s, 150, () => fake.json(bad, { model: DEFAULT_MODEL })));
    const first = await run(s, fake, opId, 1);
    expect(first.retried).not.toBeNull();
    expect(first.acked).toBe(false);
    expect(row(s.env, 'SELECT status, content_failures, lease_until FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'running', content_failures: 1, lease_until: null });
    const second = await run(s, fake, opId, 2);
    expect(second.acked).toBe(true);
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?', opId)).toBe(2);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
    const r = row(s.env, 'SELECT status, failure, content_failures, meta_json FROM exemplar_sets WHERE id = ?', id);
    expect(r).toMatchObject({ status: 'failed', failure: 'invalid_output', content_failures: 2 });
    expect(JSON.parse(r['meta_json']).last_problem).toBe('word_count');
    // 第三次投遞（例如 Queue 重送）：已退還，不再呼叫。
    await run(s, fake, opId, 3);
    expect(fake.requests).toHaveLength(2);
  });

  it('(b) 第一次投遞截斷（max_tokens）→ 第二次投遞格式不符 → 退還；ai_calls 2 列', async () => {
    const s = setup();
    const { opId } = await create(s);
    const fake: FakeAnthropic = new FakeAnthropic(
      taking(s, 150, (_req, i) => (i === 0 ? fake.json(exemplarOutput(), { stopReason: 'max_tokens', model: DEFAULT_MODEL }) : fake.json({ is_writing_task: true }, { model: DEFAULT_MODEL }))),
    );
    expect((await run(s, fake, opId, 1)).retried).not.toBeNull();
    expect((await run(s, fake, opId, 2)).acked).toBe(true);
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?', opId)).toBe(2);
    expect(row(s.env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('invalid_output');
    expect(row(s.env, "SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ? AND (stop_reason = 'max_tokens' OR error_code = 'schema_mismatch')", opId).n).toBe(2);
  });

  it('(c) 第一次 60 秒失敗 → 同一次投遞重試成功 → 結算（1 次失敗＋1 次成功）', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    const bad = exemplarOutput({}, { basic: 150, steady: 210, top: 500 });
    const fake: FakeAnthropic = new FakeAnthropic(taking(s, 60, (_req, i) => fake.json(i === 0 ? bad : exemplarOutput(), { model: DEFAULT_MODEL })));
    const msg = await run(s, fake, opId, 1);
    expect(msg.acked).toBe(true);
    expect(count(s.env, 'SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?', opId)).toBe(2);
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('settled');
    expect(row(s.env, 'SELECT status, content_failures FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'done', content_failures: 1 });
  });

  it('三篇都被隱藏＝內容失敗；已有 1 次內容失敗時這次就是最後一次', async () => {
    const s = setup();
    const { opId } = await create(s);
    s.env.DB.sqlite.prepare('UPDATE exemplar_sets SET content_failures = 1').run();
    const o = exemplarOutput();
    const all = (t: string) => `${t.split('\n')[0]} ${FAKE_OFFICIAL_EN}.\n${t.split('\n')[1]}`;
    const fake = json({ ...o, basic_text: all(o.basic_text), steady_text: all(o.steady_text), top_text: all(o.top_text) });
    const msg = await run(s, fake, opId, 1);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
    expect(row(s.env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('invalid_output');
  });

  it('API 錯誤不算內容失敗：交給 Queue 重送，最後一次仍失敗退還 api_error、寫 anthropic_error 事件', async () => {
    const s = setup();
    const { opId } = await create(s);
    const fake = new FakeAnthropic(() => new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), { status: 529, headers: { 'retry-after-ms': '1' } }));
    expect((await run(s, fake, opId, 1)).retried).not.toBeNull();
    expect((await run(s, fake, opId, 4)).acked).toBe(true);
    expect(row(s.env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('api_error');
    expect(row(s.env, 'SELECT content_failures FROM exemplar_sets').content_failures).toBe(0);
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ops_events WHERE kind = 'anthropic_error'")).toBe(1);
  });
});

describe('其他失敗路徑', () => {
  it('拒答：不重試、退還 refusal、寫 refusal 安全事件與內容退還的計數', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    const fake = json(exemplarOutput(), { stopReason: 'refusal' });
    await run(s, fake, opId);
    expect(fake.requests).toHaveLength(1);
    expect(row(s.env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('refusal');
    expect(row(s.env, 'SELECT status, failure FROM exemplar_sets WHERE id = ?', id)).toEqual({ status: 'failed', failure: 'refusal' });
    expect(count(s.env, "SELECT COUNT(*) AS n FROM ai_safety_events WHERE kind = 'refusal'")).toBe(1);
  });

  it('題目庫讀不到這一題（Worker 回滾等）：不呼叫模型，退還 internal', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    s.env.DB.sqlite.prepare(`UPDATE exemplar_sets SET group_id = 'gsat-999.s8g1@1' WHERE id = ?`).run(id);
    const fake = json(exemplarOutput());
    await run(s, fake, opId);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('internal');
  });

  it('全站暫停而且還沒開始：退還 paused、不呼叫', async () => {
    const s = setup();
    const { opId } = await create(s);
    await setPausedStatement(s.env.DB, true, Date.now()).run();
    const fake = json(exemplarOutput());
    await run(s, fake, opId);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('paused');
  });

  it('另一個 consumer 正在處理（有效租約）：延後重送，不重複呼叫', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    s.env.DB.sqlite.prepare(`UPDATE exemplar_sets SET status = 'running', lease_until = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000) + 600, id);
    const fake = json(exemplarOutput());
    const msg = await run(s, fake, opId);
    expect(fake.requests).toHaveLength(0);
    expect(msg.retried?.delaySeconds).toBeGreaterThanOrEqual(30);
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
  });

  it('列表與詳情在處理中顯示 running；完成後 done', async () => {
    const s = setup();
    const { id, opId } = await create(s);
    expect((await detail(s, id)).status).toBe('queued');
    await run(s, json(exemplarOutput({}, { basic: 150, steady: 210, top: 340 })), opId);
    const list = await call(s.env, s.user, 'GET', '/api/exemplars');
    expect(list.body.sets[0]).toMatchObject({ id, status: 'done', title: '115 學測 英文作文' });
  });

  it('essayText 的測試資料本身：字數與段數照指定（確保上面的情境不是碰巧通過）', () => {
    expect(essayText(150, 2).split('\n')).toHaveLength(2);
    expect(essayText(150, 2).split(/\s+/)).toHaveLength(150);
  });
});
