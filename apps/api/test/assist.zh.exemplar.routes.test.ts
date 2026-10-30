/**
 * 國寫範文的端點與 consumer（國寫範文設計 §6、§7、§9）：POST /api/assist/cases/:id/zh-exemplar 的檢查順序與上限、預扣 8 點、
 * consumer 的重寫（同一次投遞與跨投遞）、退還、結算寫回，以及詳情、進行中、匯出、刪除與追問上下文。
 * Anthropic 一律用假回應；題目與模型輸出都是本站自寫的句子（helpers/zh.ts）；比賽語料是本站自寫的誘餌造的集合。
 */
import { ZH_EXEMPLAR_OVERLAP_TEXT } from '@gsat/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExport } from '../src/account/export';
import { createQueueHandler } from '../src/ai/consumer';
import { resetD8ForTests } from '../src/ai/d8';
import { assistZhExemplarSystemText } from '../src/ai/prompts/assist-zh';
import type { SessionUser } from '../src/auth/session';
import type { Env } from '../src/env';
import { batchOf, makeMessage, noopCtx, seedUser, type TestEnv } from './helpers/ai';
import { FakeAnthropic } from './helpers/anthropic';
import { seedAssistOp } from './helpers/assist';
import { callAs, fakeSite, type FakeSite } from './helpers/assistSite';
import { fakeFingerprintFile } from './helpers/customEssay';
import {
  fakeZhFingerprints,
  zhBlocks,
  zhChoiceOutput,
  zhEnv,
  zhExemplarFingerprints,
  zhExemplarOutput,
  zhFollowupOutput,
  zhTypedBody,
  zhWritingOutput,
  ZH_DECOY_CONTEST,
  ZH_EXEMPLAR_PARAGRAPHS,
  ZH_FORM_SINGLE,
  ZH_WRITING_PROMPT,
} from './helpers/zh';

const fp = vi.hoisted(() => ({ file: {} as Record<string, unknown> }));
vi.mock('../src/generated/d8-fingerprints.json', () => ({ default: fp.file }));
const zh = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../src/assist/subjects/chinese/d8', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/assist/subjects/chinese/d8')>();
  return { ...actual, requireZhFingerprints: async () => zh.value, zhFingerprints: () => zh.value };
});

beforeEach(() => {
  for (const k of Object.keys(fp.file)) delete fp.file[k];
  Object.assign(fp.file, fakeFingerprintFile());
  resetD8ForTests();
  zh.value = zhExemplarFingerprints();
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

function row(env: TestEnv, sql: string, ...args: unknown[]): Record<string, any> {
  return env.DB.sqlite.prepare(sql).get(...(args as never[])) as Record<string, any>;
}

interface Setup {
  env: TestEnv;
  site: FakeSite;
  user: SessionUser;
}

function setup(overrides: Partial<Env> = {}, role: 'student' | 'admin' = 'student'): Setup {
  const env = zhEnv({ AI_ZH_EXEMPLAR: 'on', ...overrides });
  return { env, site: fakeSite(), user: seedUser(env.DB, { role }) };
}

const json = (...outputs: unknown[]) => {
  let i = 0;
  const fake: FakeAnthropic = new FakeAnthropic(() => fake.json(outputs[Math.min(i++, outputs.length - 1)]));
  return fake;
};

async function run(s: Setup, fake: FakeAnthropic, attempts = 1) {
  const msg = makeMessage(s.env.AI_QUEUE.sent[s.env.AI_QUEUE.sent.length - 1]!, attempts);
  await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks', [msg]), s.env, noopCtx));
  return msg;
}

const post = (s: Setup, path: string, body: unknown = {}) => quiet(() => callAs(s.env, s.site, s.user, 'POST', path, body));

async function detail(s: Setup, caseId: string) {
  const res = await quiet(() => callAs(s.env, s.site, s.user, 'GET', `/api/assist/cases/${caseId}`));
  expect(res.status).toBe(200);
  return res.body;
}

/** 建一個國寫案例並完成國寫指導。 */
async function writingCase(s: Setup, analysis = zhWritingOutput()): Promise<string> {
  const created = await post(s, '/api/assist/cases', zhTypedBody({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]), format: 'writing' }));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const caseId = created.body.id as string;
  const res = await post(s, `/api/assist/cases/${caseId}/analyze`);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await run(s, json(analysis));
  return caseId;
}

async function requestExemplar(s: Setup, caseId: string) {
  return post(s, `/api/assist/cases/${caseId}/zh-exemplar`);
}

const caseState = (s: Setup, caseId: string) => row(s.env, 'SELECT status, analyses, followups, section, verdict FROM assist_cases WHERE id = ?', caseId);

describe('POST /api/assist/cases/:id/zh-exemplar 的檢查（§7）', () => {
  it('AI_ZH_EXEMPLAR 是 off（程式預設）：503；admin 模式只有管理員能用', async () => {
    const off = setup({ AI_ZH_EXEMPLAR: undefined });
    const caseId = await writingCase(off);
    expect((await requestExemplar(off, caseId)).status).toBe(503);
    const admin = setup({ AI_ZH_EXEMPLAR: 'admin' });
    const c2 = await writingCase(admin);
    expect((await requestExemplar(admin, c2)).status).toBe(503);
    const boss = setup({ AI_ZH_EXEMPLAR: 'admin' }, 'admin');
    const c3 = await writingCase(boss);
    expect((await requestExemplar(boss, c3)).status).toBe(202);
  });

  it('不是國文的國寫案例：400（選擇題也是）；別人的案例 404', async () => {
    const s = setup();
    const created = await post(s, '/api/assist/cases', zhTypedBody({ blocks: zhBlocks(['question', null, ZH_FORM_SINGLE]) }));
    await post(s, `/api/assist/cases/${created.body.id}/analyze`);
    await run(s, json(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }])));
    const res = await requestExemplar(s, created.body.id);
    expect(res.status).toBe(400);
    const caseId = await writingCase(s);
    const other = await quiet(() => callAs(s.env, s.site, seedUser(s.env.DB), 'POST', `/api/assist/cases/${caseId}/zh-exemplar`, {}));
    expect(other.status).toBe(404);
  });

  it('國寫指導還沒完成或是離題：409（不扣點）', async () => {
    const s = setup();
    const created = await post(s, '/api/assist/cases', zhTypedBody({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]), format: 'writing' }));
    expect((await requestExemplar(s, created.body.id)).status).toBe(409);
    const offTopic = await writingCase(s, zhWritingOutput({ off_topic: true }));
    const res = await requestExemplar(s, offTopic);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('請先等國寫指導完成');
    expect(row(s.env, `SELECT COUNT(*) AS n FROM ai_ops WHERE task = 'assist_zh_exemplar'`).n).toBe(0);
  });

  it('202：預扣 8 點；turn 是 followup、meta_json.task＝zh_exemplar、沒有學生文字；案例的狀態與追問次數不變；進行中的 kind 是 zh_exemplar', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const before = caseState(s, caseId);
    const res = await requestExemplar(s, caseId);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({ case_id: caseId, status: 'queued', points: 8 });
    expect(row(s.env, 'SELECT task, points_reserved, ref_id FROM ai_ops WHERE id = ?', res.body.op_id)).toEqual({ task: 'assist_zh_exemplar', points_reserved: 8, ref_id: res.body.turn_id });
    const turn = row(s.env, 'SELECT kind, status, input_text, label, mode, meta_json FROM assist_turns WHERE id = ?', res.body.turn_id);
    expect(turn).toMatchObject({ kind: 'followup', status: 'queued', input_text: null, label: null, mode: null });
    expect(JSON.parse(turn.meta_json)).toEqual({ subject: 'chinese', task: 'zh_exemplar' });
    expect(caseState(s, caseId)).toEqual(before);
    const d = await detail(s, caseId);
    expect(d.pending).toMatchObject({ turn_id: res.body.turn_id, kind: 'zh_exemplar', status: 'queued' });
    // 進行中時再要一篇：409。
    expect((await requestExemplar(s, caseId)).status).toBe(409);
  });

  it('每案例 2 篇（完成＋進行中）：第 3 篇 429 assist_limit（reason zh_exemplars_per_case）；失敗退還的不算', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    // 第一篇失敗（離題 → 退還），不算。
    expect((await requestExemplar(s, caseId)).status).toBe(202);
    await run(s, json(zhExemplarOutput({ off_topic: true })));
    for (let i = 0; i < 2; i += 1) {
      expect((await requestExemplar(s, caseId)).status).toBe(202);
      await run(s, json(zhExemplarOutput()));
    }
    const res = await requestExemplar(s, caseId);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: 'assist_limit', reason: 'zh_exemplars_per_case' });
  });

  it('每天 3 篇（任務家族上限）：429 daily_limit，reason 是 assist_zh_exemplar', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    // 今天已經結算 3 篇（點數記 0，只測篇數的上限，不碰每日點數上限）。
    for (let i = 0; i < 3; i += 1) {
      const id = seedAssistOp(s.env.DB, s.user.id, 'assist_zh_exemplar', crypto.randomUUID(), { points: 0 });
      s.env.DB.sqlite.prepare("UPDATE ai_ops SET status = 'settled', points_charged = 0 WHERE id = ?").run(id);
    }
    const res = await requestExemplar(s, caseId);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ code: 'daily_limit', reason: 'assist_zh_exemplar', message: '今天已經產生 3 篇國寫範文，明天再試' });
  });
});

describe('consumer：請求、結算與重寫（§2、§5.6）', () => {
  it('成功：範文的系統提示、<task> 與摘要；turn done、詳情的 kind 是 zh_exemplar；案例只更新時間', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const before = caseState(s, caseId);
    const { body } = await requestExemplar(s, caseId);
    const fake = json(zhExemplarOutput());
    const msg = await run(s, fake);
    expect(msg.acked).toBe(true);
    const req = fake.requests[0]!;
    expect(req.system).toBe(assistZhExemplarSystemText());
    expect(req.body.max_tokens).toBe(14_000);
    expect(req.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(req.userText).toContain('Title given: 「那一扇窗」');
    expect(req.userText).toContain(`<student_provided_question>\n[question]\n${ZH_WRITING_PROMPT}\n</student_provided_question>`);
    expect(req.userText).toContain('<analysis_digest>');
    expect(row(s.env, 'SELECT status, points_charged FROM ai_ops WHERE id = ?', body.op_id)).toEqual({ status: 'settled', points_charged: 8 });
    expect(caseState(s, caseId)).toEqual(before);
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE id = ?', body.turn_id).meta_json);
    expect(meta).toMatchObject({ subject: 'chinese', task: 'zh_exemplar', section: 'zh_writing_emotion', content_failures: 0, zh_fp: 'test-zh-0001' });
    const d = await detail(s, caseId);
    expect(d.pending).toBeNull();
    const t = d.turns[1];
    expect(t).toMatchObject({ kind: 'zh_exemplar', status: 'done' });
    expect(t.exemplar).toMatchObject({ kind: 'zh_exemplar', title_zh: '那一扇窗', section: 'zh_writing_emotion' });
    expect(t.exemplar.paragraphs.map((p: any) => p.text)).toEqual([...ZH_EXEMPLAR_PARAGRAPHS]);
    expect(d.followups).toBe(0);
  });

  it('比賽指紋：第一次命中 → 同一次投遞重寫一次；第二次乾淨就結算（content_failures 1）', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    const overlap = zhExemplarOutput();
    overlap.paragraphs[1]!.text += ZH_DECOY_CONTEST.slice(5, 22);
    const fake = json(overlap, zhExemplarOutput());
    await run(s, fake);
    expect(fake.requests).toHaveLength(2);
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', body.op_id).status).toBe('settled');
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE id = ?', body.turn_id).meta_json);
    // 重寫的次數記在 content_failures（checks 是最後一次的計數）。
    expect(meta.content_failures).toBe(1);
    expect((await detail(s, caseId)).turns[1].exemplar.paragraphs.every((p: any) => p.hidden === null)).toBe(true);
  });

  it('兩次都命中：最後一次把那一段換成固定說明並結算，寫 assist_zh_exemplar_overlap（只有 op id、段數與第幾次）', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    const overlap = zhExemplarOutput();
    overlap.paragraphs[1]!.text += ZH_DECOY_CONTEST.slice(5, 22);
    const fake = json(overlap);
    await run(s, fake);
    expect(fake.requests).toHaveLength(2);
    const d = await detail(s, caseId);
    expect(d.turns[1].exemplar.paragraphs[1]).toMatchObject({ text: ZH_EXEMPLAR_OVERLAP_TEXT, hidden: 'contest' });
    const ev = JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_zh_exemplar_overlap'`).detail_json);
    expect(ev).toEqual({ op_id: body.op_id, paragraphs: 1, attempt: 2 });
  });

  it('同一次投遞：第一次截斷（max_tokens）、第二次命中比賽指紋 → 第二次就是最後一次：隱藏那一段並結算（不退還）', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    const overlap = zhExemplarOutput();
    overlap.paragraphs[1]!.text += ZH_DECOY_CONTEST.slice(5, 22);
    let i = 0;
    const fake: FakeAnthropic = new FakeAnthropic(() => (i++ === 0 ? fake.json(zhExemplarOutput(), { stopReason: 'max_tokens' }) : fake.json(overlap)));
    await run(s, fake);
    expect(fake.requests).toHaveLength(2);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', body.op_id)).toEqual({ status: 'settled', refund_reason: null });
    const d = await detail(s, caseId);
    expect(d.turns[1].exemplar.paragraphs[1]).toMatchObject({ text: ZH_EXEMPLAR_OVERLAP_TEXT, hidden: 'contest' });
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE id = ?', body.turn_id).meta_json);
    expect(meta.content_failures).toBe(1);
    expect(JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_zh_exemplar_overlap'`).detail_json)).toEqual({ op_id: body.op_id, paragraphs: 1, attempt: 2 });
  });

  it('同一次投遞：第一次截斷、第二次超過上限 ≤ 10% → 照顯示並加提醒（不退還）', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    // 情意 836 格；四段各 200 字（每段 10 行 220 格）＝ 880 格，超過約 5%。句子是本站自寫的。
    const long = zhExemplarOutput();
    const filler = '我在窗邊坐了很久，看著外面的街燈一盞一盞亮起來，心裡慢慢安定下來，覺得明天也可以再試一次。';
    long.paragraphs = long.paragraphs.slice(0, 4).map((p) => {
      let t = '';
      while ([...t].length < 200) t += filler;
      return { ...p, text: `${[...t].slice(0, 199).join('')}。` };
    });
    let i = 0;
    const fake: FakeAnthropic = new FakeAnthropic(() => (i++ === 0 ? fake.json(zhExemplarOutput(), { stopReason: 'max_tokens' }) : fake.json(long)));
    await run(s, fake);
    expect(fake.requests).toHaveLength(2);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', body.op_id)).toEqual({ status: 'settled', refund_reason: null });
    const ex = (await detail(s, caseId)).turns[1].exemplar;
    expect(ex.notices.map((n: any) => n.kind)).toContain('exemplar_over_limit');
    expect(ex.totals.cells).toBe(880);
  });

  it('國寫指導附了段落：範文的摘要不帶大綱提示（段落裡的事不會經由摘要送進範文的請求）', async () => {
    const s = setup();
    // 學生的段落與國寫指導的大綱提示都提到「外婆的菜園」（本站自寫）。
    const created = await post(
      s,
      '/api/assist/cases',
      zhTypedBody({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]), format: 'writing', draft: '每年暑假我都在外婆的菜園旁那扇窗邊寫作業，聽外面的蟬叫。', draft_target: 'q2' }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const caseId = created.body.id as string;
    await post(s, `/api/assist/cases/${caseId}/analyze`);
    await run(s, json(zhWritingOutput({ outline: [{ part_zh: '場景', hint_zh: '寫外婆的菜園旁那扇窗。' }] })));
    const { body } = await requestExemplar(s, caseId);
    expect(body.status).toBe('queued');
    const fake = json(zhExemplarOutput());
    await run(s, fake);
    const userText = fake.requests[0]!.userText;
    expect(userText).toContain('<analysis_digest>\nRequirement: 寫一扇具體的窗「那一扇窗」\nOutline: 場景\n</analysis_digest>');
    expect(userText).not.toContain('外婆');
  });

  it('情意範文寫到敏感事件：照常結算，checks 記 sensitive_event，寫 assist_zh_exemplar_sensitive（只有 op id 與句數）', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    const out = zhExemplarOutput();
    out.paragraphs[1]!.text += '那年冬天外婆住院，我每天放學都去病房陪她。';
    await run(s, json(out));
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', body.op_id).status).toBe('settled');
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE id = ?', body.turn_id).meta_json);
    expect(meta.checks.sensitive_event).toBe(1);
    expect(JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_zh_exemplar_sensitive'`).detail_json)).toEqual({ op_id: body.op_id, sentences: 1 });
  });

  it('跨投遞：上一次投遞已經重寫過一次（content_failures 1），這一次命中就不再重寫，直接用最後一次的處理', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    s.env.DB.sqlite.prepare(`UPDATE assist_turns SET meta_json = json_set(meta_json, '$.content_failures', 1) WHERE id = ?`).run(body.turn_id);
    const overlap = zhExemplarOutput();
    overlap.paragraphs[1]!.text += ZH_DECOY_CONTEST.slice(5, 22);
    const fake = json(overlap);
    await run(s, fake, 2);
    expect(fake.requests).toHaveLength(1);
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', body.op_id).status).toBe('settled');
    expect((await detail(s, caseId)).turns[1].exemplar.paragraphs[1].hidden).toBe('contest');
    // 已經用完兩次（content_failures 2）：不呼叫模型，以 invalid_output 退還。
    const s2 = setup();
    const c2 = await writingCase(s2);
    const r2 = await requestExemplar(s2, c2);
    s2.env.DB.sqlite.prepare(`UPDATE assist_turns SET meta_json = json_set(meta_json, '$.content_failures', 2) WHERE id = ?`).run(r2.body.turn_id);
    const none = json(zhExemplarOutput());
    await run(s2, none, 3);
    expect(none.requests).toHaveLength(0);
    expect(row(s2.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', r2.body.op_id)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
  });

  it('內容失敗（離題）：退還 invalid_output、turn failed、案例不變；身心安全旗標照記', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const before = caseState(s, caseId);
    const { body } = await requestExemplar(s, caseId);
    await run(s, json(zhExemplarOutput({ off_topic: true, safety_flag: 'self_harm_risk' })));
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', body.op_id)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
    expect(row(s.env, 'SELECT status, failure FROM assist_turns WHERE id = ?', body.turn_id)).toEqual({ status: 'failed', failure: 'invalid_output' });
    expect(caseState(s, caseId)).toEqual(before);
    expect(row(s.env, `SELECT COUNT(*) AS n FROM ai_safety_events WHERE op_id = ? AND kind = 'wellbeing_flag'`, body.op_id).n).toBe(1);
    const d = await detail(s, caseId);
    expect(d.turns[1]).toMatchObject({ kind: 'zh_exemplar', status: 'failed' });
  });

  it('讀不到比賽語料指紋：以 internal 退還，不呼叫模型', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    zh.value = fakeZhFingerprints();
    const fake = json(zhExemplarOutput());
    await run(s, fake);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', body.op_id)).toEqual({ status: 'refunded', refund_reason: 'internal' });
  });

  it('任務與 turn 不符（追問的操作指到範文的 turn）：以 internal 退還', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    const { body } = await requestExemplar(s, caseId);
    s.env.DB.sqlite.prepare(`UPDATE ai_ops SET task = 'assist_followup' WHERE id = ?`).run(body.op_id);
    const fake = json(zhFollowupOutput());
    await run(s, fake);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', body.op_id)).toEqual({ status: 'refunded', refund_reason: 'internal' });
  });
});

describe('範文之後：追問、匯出與刪除（§9）', () => {
  it('追問的上下文不帶範文；追問次數照舊只算追問', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    await requestExemplar(s, caseId);
    await run(s, json(zhExemplarOutput()));
    const res = await post(s, `/api/assist/cases/${caseId}/followups`, { text: '第二段可以怎麼寫得更具體？', mode: 'explain' });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const fake = json(zhFollowupOutput());
    await run(s, fake);
    const content = fake.requests[0]!.body.messages[0].content as Array<{ text: string }>;
    const all = content.map((b) => b.text).join('\n');
    expect(all).not.toContain(ZH_EXEMPLAR_PARAGRAPHS[0].slice(0, 12));
    expect(all).not.toContain('那一扇窗」的示範');
    const d = await detail(s, caseId);
    expect(d.followups).toBe(1);
    expect(d.turns.map((t: any) => t.kind)).toEqual(['analyze', 'zh_exemplar', 'followup']);
  });

  it('匯出：範文的 turn kind 寫成 zh_exemplar（output_json 照常匯出）；刪除案例連範文一起刪', async () => {
    const s = setup();
    const caseId = await writingCase(s);
    await requestExemplar(s, caseId);
    await run(s, json(zhExemplarOutput()));
    const data = (await buildExport(s.env.DB, s.user.id)) as any;
    const turns = data.assist.cases.find((c: any) => c.id === caseId).turns;
    expect(turns.map((t: any) => t.kind)).toEqual(['analyze', 'zh_exemplar']);
    expect(turns[1].output.kind).toBe('zh_exemplar');
    expect(turns[1]).not.toHaveProperty('meta');
    const del = await quiet(() => callAs(s.env, s.site, s.user, 'DELETE', `/api/assist/cases/${caseId}`));
    expect(del.status).toBe(204);
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM assist_turns WHERE case_id = ?', caseId).n).toBe(0);
  });
});
