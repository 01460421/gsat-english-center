/**
 * 審查發現的修正（設計文件 §10「A2 修正（第二輪審查）」）：預扣不會卡住、退還不能被無限利用、本體大小與型別、
 * 串流中途的錯誤可以重送、照片暫存的上限與期限、租約長度。負責：後端 AI A2。
 * Anthropic 一律用假回應（SDK 的 fetch 注入）；D1 的暫時失敗用包一層 prepare／batch 模擬。
 */
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { ASSIST_TASKS } from '@gsat/shared';
import { releaseLeaseStatement } from '../src/ai/callPolicy';
import { CONSUMER_WALL_BUDGET_MS, createQueueHandler } from '../src/ai/consumer';
import { AI_REFUNDS_PER_DAY, refundForOp, refundWithSubmission } from '../src/ai/guard';
import {
  purgeExpiredAssist,
  purgeExpiredPhotos,
  reclaimStaleOps,
  STALE_ASSIST_OPS_SQL,
  STALE_OPS_SQL,
  STALE_RESERVE_HARD_SECONDS,
  STALE_RESERVE_SECONDS,
} from '../src/ai/housekeeping';
import { refundWithAssistRef } from '../src/assist/refund';
import { LEASE_SECONDS } from '../src/ai/tasks';
import { nowS, seedAssistCase, seedAssistOp, seedAssistPhoto, seedAssistReport, seedAssistTurn } from './helpers/assist';
import { errorResponse, FakeAnthropic, frameworkOf, type Responder } from './helpers/anthropic';
import {
  ESSAY_GROUP,
  ORIGIN,
  STUDENT_ESSAY,
  STUDENT_TRANSLATION,
  TRANSLATION_GROUP,
  appAs,
  batchOf,
  call,
  essayAnalyticOutput,
  essayHolisticOutput,
  makeEnv,
  makeMessage,
  noopCtx,
  seedUser,
  tinyJpeg,
  translationAnalyticOutput,
  translationHolisticOutput,
  uploadPhoto,
  type TestEnv,
} from './helpers/ai';

type User = ReturnType<typeof seedUser>;

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

function newFake(responder: (fake: FakeAnthropic) => Responder): FakeAnthropic {
  const fake: FakeAnthropic = new FakeAnthropic(() => {
    throw new Error('尚未設定');
  });
  fake.responder = responder(fake);
  return fake;
}

async function run(env: TestEnv, fake: FakeAnthropic, opId: string, attempts = 1, queue = 'ai-tasks') {
  const msg = makeMessage({ op_id: opId }, attempts);
  await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf(queue, [msg]), env, noopCtx));
  return msg;
}

function row(env: TestEnv, sql: string, ...params: Array<string | number>) {
  return env.DB.sqlite.prepare(sql).get(...params) as Record<string, any>;
}

async function createTranslation(env: TestEnv, user: User): Promise<string> {
  const created = await call(env, user, 'POST', '/api/submissions', {
    kind: 'translation',
    group_id: TRANSLATION_GROUP,
    input_mode: 'typed',
    body: { items: STUDENT_TRANSLATION.map((text, i) => ({ item_id: `${TRANSLATION_GROUP}#中譯英${i + 1}`, text })) },
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function queueTranslation(env: TestEnv, user: User) {
  const id = await createTranslation(env, user);
  const res = await call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: id });
  expect(res.status).toBe(202);
  return { id, opId: res.body.op_id as string };
}

async function createPhotoEssay(env: TestEnv, user: User): Promise<string> {
  const created = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'photo' });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

/** 組一段 SSE（message_start → 一段文字），之後由呼叫端決定怎麼結束。 */
function sseHead(inputTokens = 1_000): string {
  const message = {
    id: 'msg_partial',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: inputTokens, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, iterations: null },
  };
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    ev('message_start', { type: 'message_start', message }),
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"sentences":[{"sentence_index":0,' } }),
  ].join('');
}

describe('發現 1：退還不能被無限利用（照片看不出是作文、拒答、截斷、格式不符）', () => {
  it(`照片辨識「看不出是作文」照樣退還，但每人每天最多 ${AI_REFUNDS_PER_DAY} 次；之後 429 rate_limited、告警一次`, async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createPhotoEssay(env, user);
    const fake = newFake((f) => () => f.json({ readable: false, paragraphs: [] }));
    for (let i = 0; i < AI_REFUNDS_PER_DAY; i++) {
      expect((await uploadPhoto(env, user, id, 1, tinyJpeg())).status).toBe(200);
      const queued = await call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: id });
      expect(queued.status).toBe(202);
      await run(env, fake, queued.body.op_id);
      expect(row(env, 'SELECT status FROM submissions WHERE id = ?', id).status).toBe('failed');
    }
    expect((await uploadPhoto(env, user, id, 1, tinyJpeg())).status).toBe(200);
    const blocked = await quiet(() => call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: id }));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(env.AI_QUEUE.sent).toHaveLength(AI_REFUNDS_PER_DAY);
    expect(row(env, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(AI_REFUNDS_PER_DAY);
    await quiet(() => call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: id }));
    expect(row(env, `SELECT COUNT(*) AS n FROM ops_events WHERE kind = 'ai_refund_limit'`).n).toBe(1);
    // 其他人不受影響；系統原因的退還（排隊太久、暫停、API 錯誤）不算在這個上限裡。
    const other = seedUser(env.DB);
    expect((await call(env, other, 'POST', '/api/ai/translation-grade', { submission_id: await createTranslation(env, other) })).status).toBe(202);
  });

  it('拒答也算同一個上限（中譯英反覆送出會被拒答的內容）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createTranslation(env, user);
    const fake = newFake((f) => (req) => (frameworkOf(req) === 'analytic' ? f.json({}, { stopReason: 'refusal', outputTokens: 10 }) : f.json(translationHolisticOutput())));
    for (let i = 0; i < AI_REFUNDS_PER_DAY; i++) {
      const queued = await call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: id });
      expect(queued.status).toBe(202);
      await run(env, fake, queued.body.op_id);
    }
    const blocked = await quiet(() => call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: id }));
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });

  it('API 錯誤的退還不算；管理員不受這個上限', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const fail = newFake(() => () => errorResponse(529, 'overloaded_error', 'overloaded'));
    for (let i = 0; i < AI_REFUNDS_PER_DAY + 1; i++) {
      const { opId } = await queueTranslation(env, user);
      await run(env, fail, opId, 4);
      expect(row(env, 'SELECT refund_reason FROM ai_ops WHERE id = ?', opId).refund_reason).toBe('api_error');
    }
    const admin = seedUser(env.DB, { role: 'admin' });
    const refuse = newFake((f) => () => f.json({}, { stopReason: 'refusal' }));
    const adminSub = await createTranslation(env, admin);
    for (let i = 0; i < AI_REFUNDS_PER_DAY + 1; i++) {
      const queued = await call(env, admin, 'POST', '/api/ai/translation-grade', { submission_id: adminSub });
      expect(queued.status).toBe(202);
      await run(env, refuse, queued.body.op_id);
    }
  });
});

describe('發現 2、7：預扣之後的步驟失敗，不會留下永遠 reserved 的預扣', () => {
  it('注入事件寫不進去（D1 暫時失敗）：退還、提交回到原狀態、不排入 Queue；之後可以再送', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await call(env, user, 'POST', '/api/submissions', {
      kind: 'essay',
      group_id: ESSAY_GROUP,
      input_mode: 'typed',
      body: { text: `${STUDENT_ESSAY}\n\nSome students ignore the rules in class.` },
    });
    const id = created.body.id as string;
    const original = env.DB.prepare.bind(env.DB);
    env.DB.prepare = ((sql: string) => {
      if (sql.includes('ai_safety_events')) throw new Error('D1_ERROR: Network connection lost');
      return original(sql);
    }) as typeof env.DB.prepare;
    const res = await quiet(() => call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: id }));
    env.DB.prepare = original;
    expect(res.status).toBe(500);
    expect(row(env, 'SELECT status, refund_reason, points_charged FROM ai_ops')).toEqual({ status: 'refunded', refund_reason: 'internal', points_charged: 0 });
    expect(row(env, 'SELECT status FROM submissions WHERE id = ?', id).status).toBe('draft');
    expect(env.AI_QUEUE.sent).toHaveLength(0);
    const again = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: id });
    expect(again.status).toBe(202);
    expect(row(env, `SELECT kind, category FROM ai_safety_events`)).toEqual({ kind: 'injection_flag', category: 'ignore_instructions' });
  });

  it('更新提交的 batch 失敗：退還、提交不變', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createTranslation(env, user);
    const original = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (statements: Array<{ sql: string }>) => {
      if (statements.some((s) => s.sql.includes('tries = 0'))) throw new Error('D1_ERROR: Network connection lost');
      return original(statements as never);
    }) as unknown as typeof env.DB.batch;
    const res = await quiet(() => call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: id }));
    env.DB.batch = original;
    expect(res.status).toBe(500);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops')).toEqual({ status: 'refunded', refund_reason: 'internal' });
    expect(row(env, 'SELECT status, op_id FROM submissions WHERE id = ?', id)).toEqual({ status: 'draft', op_id: null });
  });

  it('isolate 在排入 Queue 前被終止（模擬：訊息沒送出）：30 分鐘後下一次送出 AI 任務時先回收，同時任務的名額回來', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const stuck = [await queueTranslation(env, user), await queueTranslation(env, user)];
    env.AI_QUEUE.sent.length = 0;
    // 兩個同時任務的名額都被佔住：還沒到 30 分鐘時第三個是 busy。
    const third = await createTranslation(env, user);
    expect((await quiet(() => call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: third }))).body.error.code).toBe('busy');
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = created_at - ?').run(STALE_RESERVE_SECONDS + 60);
    const res = await quiet(() => call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: third }));
    expect(res.status).toBe(202);
    for (const s of stuck) {
      expect(row(env, 'SELECT status, refund_reason, points_charged FROM ai_ops WHERE id = ?', s.opId)).toEqual({ status: 'refunded', refund_reason: 'expired', points_charged: 0 });
      expect(row(env, 'SELECT status FROM submissions WHERE id = ?', s.id).status).toBe('failed');
    }
    expect(row(env, `SELECT COUNT(*) AS n FROM ops_events WHERE kind = 'ai_reserve_reclaimed'`).n).toBe(2);
    // 晚到的訊息：操作已退還 → 直接 ack，不呼叫 Claude。
    const fake = newFake((f) => (req) => (frameworkOf(req) === 'analytic' ? f.json(translationAnalyticOutput()) : f.json(translationHolisticOutput())));
    const late = await run(env, fake, stuck[0]!.opId);
    expect(late.acked).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it('回收只動真的卡住的：租約有效、或已開始處理且未滿 6 小時的不回收；帳號已刪除的預扣也會回收', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const leased = await queueTranslation(env, user);
    const started = await queueTranslation(env, user);
    const nowS = Math.floor(Date.now() / 1000);
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = created_at - ?').run(STALE_RESERVE_SECONDS + 60);
    env.DB.sqlite.prepare(`UPDATE submissions SET status = 'grading', lease_until = ?, tries = 1 WHERE id = ?`).run(nowS + 300, leased.id);
    env.DB.sqlite.prepare(`UPDATE submissions SET status = 'grading', lease_until = NULL, tries = 2 WHERE id = ?`).run(started.id);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(0);
    // 已開始處理、但超過 6 小時仍沒結算（死信佇列也沒處理到）：回收。
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = created_at - ? WHERE id = ?').run(STALE_RESERVE_HARD_SECONDS, started.opId);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', started.opId).status).toBe('refunded');
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', leased.opId).status).toBe('reserved');
    // 帳號刪除（ai_ops.user_id 設為 NULL、提交 CASCADE 刪除）留下的預扣。
    const gone = seedUser(env.DB);
    const goneOp = await queueTranslation(env, gone);
    env.DB.sqlite.prepare('DELETE FROM users WHERE id = ?').run(gone.id);
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = created_at - ? WHERE id = ?').run(STALE_RESERVE_SECONDS + 60, goneOp.opId);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status, user_id FROM ai_ops WHERE id = ?', goneOp.opId)).toEqual({ status: 'refunded', user_id: null });
  });

  it('回收與 consumer 互斥：已退還的操作 consumer 搶不到租約、不呼叫 Claude', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { id, opId } = await queueTranslation(env, user);
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = created_at - ?').run(STALE_RESERVE_SECONDS + 60);
    // consumer 讀完 ai_ops（還是 reserved）之後、搶租約之前，回收先退還了。
    const original = env.DB.prepare.bind(env.DB);
    let reclaimed = false;
    env.DB.prepare = ((sql: string) => {
      if (!reclaimed && sql.includes('SET lease_until = ?1')) {
        reclaimed = true;
        env.DB.prepare = original;
        return {
          bind: (...args: unknown[]) => ({
            run: async () => {
              await reclaimStaleOps(env.DB, Date.now());
              return original(sql).bind(...args).run();
            },
          }),
        } as never;
      }
      return original(sql);
    }) as typeof env.DB.prepare;
    const fake = newFake((f) => (req) => (frameworkOf(req) === 'analytic' ? f.json(translationAnalyticOutput()) : f.json(translationHolisticOutput())));
    const msg = await run(env, fake, opId);
    expect(reclaimed).toBe(true);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(0);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops')).toEqual({ status: 'refunded', refund_reason: 'expired' });
    expect(row(env, 'SELECT status, lease_until FROM submissions WHERE id = ?', id)).toEqual({ status: 'failed', lease_until: null });
  });

  it('反方向的競爭：consumer 已經搶到租約時，回收的退還不會成立（只退沒有有效租約的）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { id, opId } = await queueTranslation(env, user);
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = created_at - ?').run(STALE_RESERVE_SECONDS + 60);
    const op = row(env, 'SELECT id, user_id, task, ref_id FROM ai_ops WHERE id = ?', opId) as { id: string; user_id: number; task: string; ref_id: string };
    // 回收查到它之後、退還之前，consumer 搶到了租約。
    env.DB.sqlite.prepare(`UPDATE submissions SET status = 'grading', lease_until = ?, tries = 1 WHERE id = ?`).run(Math.floor(Date.now() / 1000) + LEASE_SECONDS, id);
    expect(await refundWithSubmission(env.DB, op, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(false);
    expect(row(env, 'SELECT status FROM ai_ops').status).toBe('reserved');
    expect(row(env, 'SELECT status FROM submissions WHERE id = ?', id).status).toBe('grading');
  });

  it('死信佇列逐則處理：其中一則退還失敗只重送那一則，其他照常退還並 ack', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const a = await queueTranslation(env, user);
    const b = await queueTranslation(env, user);
    const original = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (statements: Array<{ params?: unknown[] }>) => {
      if (statements.some((s) => (s.params ?? []).includes(a.opId))) throw new Error('D1_ERROR: Network connection lost');
      return original(statements as never);
    }) as unknown as typeof env.DB.batch;
    const ma = makeMessage({ op_id: a.opId }, 4);
    const mb = makeMessage({ op_id: b.opId }, 4);
    const fake = newFake(() => () => errorResponse(500, 'api_error', 'x'));
    await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks-dlq', [ma, mb]), env, noopCtx));
    env.DB.batch = original;
    expect(ma.acked).toBe(false);
    expect(ma.retried).not.toBeNull();
    expect(mb.acked).toBe(true);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', a.opId).status).toBe('reserved');
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', b.opId).status).toBe('refunded');
  });
});

describe('發現 3、14：寫入類 API 只收 application/json，本體邊讀邊數', () => {
  it('text/plain 的 JSON 一律 400（提交、AI 任務、後台暫停），不預扣', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const admin = seedUser(env.DB, { role: 'admin' });
    const id = await createTranslation(env, user);
    const send = (who: User, method: string, path: string, body: unknown) =>
      appAs(who).request(path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }, env);
    expect((await send(user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP })).status).toBe(400);
    expect((await send(user, 'PUT', `/api/submissions/${id}`, { self_assess: null })).status).toBe(400);
    expect((await send(user, 'POST', '/api/ai/translation-grade', { submission_id: id })).status).toBe(400);
    expect((await send(admin, 'POST', '/api/admin/ai/pause', { paused: true })).status).toBe(400);
    expect(row(env, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(0);
    expect(row(env, 'SELECT COUNT(*) AS n FROM ai_budget_daily').n).toBe(0);
  });

  it('沒有 Content-Length 的超大本體：讀到上限就停、回 413（不會整個讀進記憶體）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createTranslation(env, user);
    const chunk = new TextEncoder().encode(`{"body":{"text":"${'a'.repeat(16_000)}`);
    const streamed = (total: number) => {
      let sent = 0;
      const counter = { sent: 0 };
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= total) {
            controller.close();
            return;
          }
          sent += chunk.length;
          counter.sent = sent;
          controller.enqueue(chunk);
        },
      });
      return { stream, counter };
    };
    for (const [method, path] of [
      ['PUT', `/api/submissions/${id}`],
      ['POST', '/api/ai/translation-grade'],
    ] as const) {
      const { stream, counter } = streamed(50_000_000);
      const res = await appAs(user).request(path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit, env);
      expect(res.status).toBe(413);
      expect(counter.sent).toBeLessThan(200_000);
    }
    // 照片上傳也一樣（沒有 Content-Length 時邊讀邊數到 1.2 MB＋64 KB）。
    const photo = await createPhotoEssay(env, user);
    const { stream, counter } = streamed(50_000_000);
    const res = await appAs(user).request(
      `/api/submissions/${photo}/photos?ord=1`,
      { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'multipart/form-data; boundary=x' }, body: stream, duplex: 'half' } as RequestInit,
      env,
    );
    expect(res.status).toBe(413);
    expect(counter.sent).toBeLessThan(1_400_000);
  });
});

describe('發現 4：照片暫存每人有上限', () => {
  it('上傳到新的提交時，同一人其他提交（不在辨識中）的暫存照片先刪掉；辨識中的保留，但每人最多 4 張', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const a = await createPhotoEssay(env, user);
    await uploadPhoto(env, user, a, 1, tinyJpeg());
    await uploadPhoto(env, user, a, 2, tinyJpeg());
    const b = await createPhotoEssay(env, user);
    expect((await uploadPhoto(env, user, b, 1, tinyJpeg())).status).toBe(200);
    expect(env.DB.sqlite.prepare('SELECT submission_id FROM submission_photo_temp').all().map((r: any) => r.submission_id)).toEqual([b]);
    // 兩份都在辨識中（同時任務最多 2 個）時，第三份不能再上傳。
    await uploadPhoto(env, user, b, 2, tinyJpeg());
    expect((await call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: b })).status).toBe(202);
    const c = await createPhotoEssay(env, user);
    await uploadPhoto(env, user, c, 1, tinyJpeg());
    await uploadPhoto(env, user, c, 2, tinyJpeg());
    expect((await call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: c })).status).toBe(202);
    const d = await createPhotoEssay(env, user);
    const res = await uploadPhoto(env, user, d, 1, tinyJpeg());
    expect(res.status).toBe(409);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM submission_photo_temp WHERE user_id = ?').get(user.id)).toEqual({ n: 4 });
    // 別人不受影響。
    const other = seedUser(env.DB);
    expect((await uploadPhoto(env, other, await createPhotoEssay(env, other), 1, tinyJpeg())).status).toBe(200);
  });
});

describe('發現 6、9：串流中途的錯誤可以重送；成本照 message_start 的 usage 記帳', () => {
  it('SSE 的 error 事件（overloaded_error）：可重試 → Queue 重送，不退還', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { id, opId } = await queueTranslation(env, user);
    const fake = newFake((f) => (req) => {
      if (frameworkOf(req) === 'holistic') return f.json(translationHolisticOutput());
      const body = `${sseHead()}event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })}\n\n`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_mid' } });
    });
    const msg = await run(env, fake, opId);
    expect(msg.acked).toBe(false);
    expect(msg.retried).toEqual({ delaySeconds: 30 });
    expect(row(env, 'SELECT status FROM ai_ops').status).toBe('reserved');
    expect(row(env, 'SELECT lease_until FROM submissions WHERE id = ?', id).lease_until).toBeNull();
    const failed = row(env, `SELECT error_code, input_tokens, cost_micros, served_model FROM ai_calls WHERE role = 'primary'`);
    expect(failed.error_code).toBe('stream_overloaded_error');
    // 已經開始處理輸入：輸入 1000 tokens × 4 微美元＝4000 起跳（不是 0）。
    expect(failed.input_tokens).toBe(1_000);
    expect(failed.cost_micros).toBeGreaterThanOrEqual(4_000);
    expect(failed.served_model).toBe('claude-opus-5-5');
  });

  it('串流讀到一半斷線（TypeError: Network connection lost.）：可重試', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { opId } = await queueTranslation(env, user);
    const fake = newFake((f) => (req) => {
      if (frameworkOf(req) === 'holistic') return f.json(translationHolisticOutput());
      const head = new TextEncoder().encode(sseHead());
      let step = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (step++ === 0) controller.enqueue(head);
          else controller.error(new TypeError('Network connection lost.'));
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const msg = await run(env, fake, opId);
    expect(msg.acked).toBe(false);
    expect(msg.retried).toEqual({ delaySeconds: 30 });
    expect(row(env, 'SELECT status FROM ai_ops').status).toBe('reserved');
    expect(row(env, `SELECT error_code FROM ai_calls WHERE role = 'primary'`).error_code).toBe('stream_interrupted');
    expect(row(env, `SELECT input_tokens FROM ai_calls WHERE role = 'primary'`).input_tokens).toBe(1_000);
  });

  it('SSE 的 error 事件是 invalid_request_error：不可重試（退還 api_error）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { opId } = await queueTranslation(env, user);
    const fake = newFake(() => () => {
      const body = `${sseHead()}event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } })}\n\n`;
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const msg = await run(env, fake, opId);
    expect(msg.acked).toBe(true);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops')).toEqual({ status: 'refunded', refund_reason: 'api_error' });
  });
});

describe('發現 8：租約涵蓋一次 consumer 呼叫的牆鐘預算', () => {
  it('LEASE_SECONDS ≥ 牆鐘預算＋60 秒', () => {
    expect(LEASE_SECONDS).toBeGreaterThanOrEqual(CONSUMER_WALL_BUDGET_MS / 1000 + 60);
  });

  it('搶到的租約到期時間＝現在＋LEASE_SECONDS', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { id, opId } = await queueTranslation(env, user);
    let seen: number | null = null;
    const fake = newFake((f) => (req) => {
      seen ??= row(env, 'SELECT lease_until FROM submissions WHERE id = ?', id).lease_until as number;
      return frameworkOf(req) === 'analytic' ? f.json(translationAnalyticOutput()) : f.json(translationHolisticOutput());
    });
    const before = Math.floor(Date.now() / 1000);
    await run(env, fake, opId);
    expect(seen).toBeGreaterThanOrEqual(before + LEASE_SECONDS);
  });
});

describe('發現 11：過期的暫存照片不靠上傳也會清掉', () => {
  it('purgeExpiredPhotos 刪掉所有過期照片；任何 /api 請求（waitUntil、每個 isolate 每分鐘最多一次）都會觸發', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createPhotoEssay(env, user);
    await uploadPhoto(env, user, id, 1, tinyJpeg());
    env.DB.sqlite.prepare('UPDATE submission_photo_temp SET created_at = created_at - 90000, expires_at = expires_at - 90000').run();
    const pending: Array<Promise<unknown>> = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const res = await app.request('/api/features', {}, env, ctx);
    expect(res.status).toBe(200);
    await Promise.all(pending);
    expect(pending.length).toBe(1);
    expect(row(env, 'SELECT COUNT(*) AS n FROM submission_photo_temp').n).toBe(0);
    // 直接呼叫也可以。
    await uploadPhoto(env, user, id, 1, tinyJpeg());
    env.DB.sqlite.prepare('UPDATE submission_photo_temp SET created_at = created_at - 90000, expires_at = expires_at - 90000').run();
    expect(await purgeExpiredPhotos(env.DB, Date.now())).toBe(1);
    // Queue consumer 每處理完一批也會跑（不論訊息是什麼）。
    await uploadPhoto(env, user, id, 1, tinyJpeg());
    env.DB.sqlite.prepare('UPDATE submission_photo_temp SET created_at = created_at - 90000, expires_at = expires_at - 90000').run();
    const msg = await run(env, newFake(() => () => errorResponse(500, 'api_error', 'x')), 'no-such-op');
    expect(msg.acked).toBe(true);
    expect(row(env, 'SELECT COUNT(*) AS n FROM submission_photo_temp').n).toBe(0);
  });

  it('OCR 不會用到已過期的照片（退還 expired）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createPhotoEssay(env, user);
    await uploadPhoto(env, user, id, 1, tinyJpeg());
    const queued = await call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: id });
    const nowS = Math.floor(Date.now() / 1000);
    env.DB.sqlite.prepare('UPDATE submission_photo_temp SET created_at = ?, expires_at = ?').run(nowS - 86_401, nowS - 1);
    const fake = newFake((f) => () => f.json({ readable: true, paragraphs: [{ lines: [{ text: STUDENT_ESSAY, unclear: [] }] }] }));
    await run(env, fake, queued.body.op_id);
    expect(fake.requests).toHaveLength(0);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops')).toEqual({ status: 'refunded', refund_reason: 'expired' });
  });
});

describe('發現 5、13：OCR 的候選字經過輸出過濾', () => {
  it('候選字的網址與 HTML 被剝掉、不當內容的候選丟掉並寫 output_filtered；轉錄本文只剝 HTML 標籤', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await createPhotoEssay(env, user);
    await uploadPhoto(env, user, id, 1, tinyJpeg());
    const queued = await call(env, user, 'POST', '/api/ai/essay-ocr', { submission_id: id });
    const fake = newFake((f) => () =>
      f.json({
        readable: true,
        paragraphs: [{ lines: [{ text: 'I like <b>[[?]]</b> very much.', unclear: [{ candidates: ['dogs https://evil.example', 'how to make a bomb', '<i>cats</i>'] }] }] }],
      }),
    );
    await run(env, fake, queued.body.op_id);
    const detail = await call(env, user, 'GET', `/api/submissions/${id}`);
    expect(detail.body.status).toBe('ocr_ready');
    expect(detail.body.ocr.text).toBe('I like [[?]] very much.');
    expect(detail.body.ocr.uncertain[0].candidates).toEqual(['dogs', 'cats']);
    expect(row(env, `SELECT kind, category FROM ai_safety_events`)).toEqual({ kind: 'output_filtered', category: 'violence' });
  });
});

describe('發現 12：被排除的評分者的說明不會配上另一組分數', () => {
  it('作文：第一位是離群值時，各項說明不採用第一位（結果帶 explanations_from_excluded_rater）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: STUDENT_ESSAY } });
    const queued = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: created.body.id });
    let holistic = 0;
    const fake = newFake((f) => (req) => {
      if (frameworkOf(req) === 'analytic') return f.json(essayAnalyticOutput([1, 1, 1, 1]));
      holistic++;
      return f.json(essayHolisticOutput(holistic === 1 ? [4, 3, 3, 3] : [4, 4, 3, 3]));
    });
    await run(env, fake, queued.body.op_id);
    await run(env, fake, queued.body.op_id);
    const detail = await call(env, user, 'GET', `/api/submissions/${created.body.id}`);
    expect(detail.body.grading.final_score).toBe(13.5);
    expect(detail.body.grading.explanations_from_excluded_rater).toBe(true);
    expect(detail.body.grading.criteria.content.explanation_zh).toBe('');
    expect(detail.body.grading.top_improvements).toEqual([]);
  });
});

describe('學習助手的租約、回收與退還（docs/design/learning-assistant.md §4.8）', () => {
  const MIN31 = 31 * 60;

  /** 一個「進行中」的學習助手操作：案例 analyzing、turn running（有效租約、處理過一次）、31 分鐘前預扣。 */
  function runningAnalyze(env: TestEnv, user: User, opts: { lease?: number | null; tries?: number; age?: number; status?: 'queued' | 'running' } = {}) {
    const caseId = seedAssistCase(env.DB, user.id, { status: 'analyzing', analyses: 0 });
    const turnId = crypto.randomUUID();
    const opId = seedAssistOp(env.DB, user.id, 'assist_analyze', turnId, { createdAt: nowS() - (opts.age ?? MIN31) });
    seedAssistTurn(env.DB, user.id, caseId, {
      id: turnId,
      status: opts.status ?? 'running',
      opId,
      leaseUntil: opts.lease === undefined ? nowS() + 600 : opts.lease,
      tries: opts.tries ?? 1,
    });
    return { caseId, turnId, opId };
  }

  it('回歸：處理中（有效租約）的學習助手解析在 31 分鐘時不會被回收；舊的 STALE_OPS_SQL 沒有排除時會被誤認', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { turnId, opId } = runningAnalyze(env, user);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(0);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
    expect(row(env, 'SELECT status, lease_until FROM assist_turns WHERE id = ?', turnId).status).toBe('running');
    // 兩條查詢各自確認：提交版本排除了學習助手的任務（沒有排除時它找不到提交、會被當成卡住）；學習助手版本看得到有效租約。
    const now = nowS();
    const args = (tasks: string) => [now - STALE_RESERVE_SECONDS, now - STALE_RESERVE_HARD_SECONDS, now, 20, tasks] as const;
    expect(env.DB.sqlite.prepare(STALE_OPS_SQL).all(...args('[]')).map((r) => (r as { id: string }).id)).toEqual([opId]);
    expect(env.DB.sqlite.prepare(STALE_OPS_SQL).all(...args(JSON.stringify(ASSIST_TASKS)))).toEqual([]);
    expect(env.DB.sqlite.prepare(STALE_ASSIST_OPS_SQL).all(...args(JSON.stringify(ASSIST_TASKS)))).toEqual([]);
  });

  it('回歸：處理中的報告（有效租約）在 31 分鐘時不會被回收', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const reportId = crypto.randomUUID();
    const opId = seedAssistOp(env.DB, user.id, 'assist_report', reportId, { createdAt: nowS() - MIN31, points: 10 });
    seedAssistReport(env.DB, user.id, { id: reportId, status: 'running', opId, leaseUntil: nowS() + 600, tries: 1 });
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(0);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
    expect(row(env, 'SELECT status FROM assist_reports WHERE id = ?', reportId).status).toBe('running');
  });

  it('沒有 turn 的預扣（寫 turn 前 isolate 被終止）30 分鐘後被回收；29 分鐘時還不會', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const young = seedAssistOp(env.DB, user.id, 'assist_analyze', crypto.randomUUID(), { createdAt: nowS() - 29 * 60 });
    const old = seedAssistOp(env.DB, user.id, 'assist_followup', crypto.randomUUID(), { createdAt: nowS() - MIN31 });
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', young).status).toBe('reserved');
    expect(row(env, 'SELECT status, refund_reason, points_charged FROM ai_ops WHERE id = ?', old)).toEqual({ status: 'refunded', refund_reason: 'expired', points_charged: 0 });
    expect(row(env, "SELECT COUNT(*) AS n FROM ops_events WHERE kind = 'ai_reserve_reclaimed'").n).toBe(1);
  });

  it('排隊太久（沒處理過、沒有租約）的解析 30 分鐘後被回收：turn failed、沒有成功過的案例 failed；處理過但租約到期的要 6 小時', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const never = runningAnalyze(env, user, { status: 'queued', lease: null, tries: 0 });
    const retried = runningAnalyze(env, user, { lease: nowS() - 10, tries: 1 });
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', never.opId)).toEqual({ status: 'refunded', refund_reason: 'expired' });
    expect(row(env, 'SELECT status, failure, lease_until FROM assist_turns WHERE id = ?', never.turnId)).toEqual({ status: 'failed', failure: 'expired', lease_until: null });
    expect(row(env, 'SELECT status FROM assist_cases WHERE id = ?', never.caseId).status).toBe('failed');
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', retried.opId).status).toBe('reserved');
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = ? WHERE id = ?').run(nowS() - STALE_RESERVE_HARD_SECONDS - 60, retried.opId);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status FROM assist_turns WHERE id = ?', retried.turnId).status).toBe('failed');
  });

  it('turn 指向別的操作、或已經不在進行中：回收（不讓預扣卡住）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const caseId = seedAssistCase(env.DB, user.id);
    const turnId = crypto.randomUUID();
    const opId = seedAssistOp(env.DB, user.id, 'assist_analyze', turnId, { createdAt: nowS() - MIN31 });
    seedAssistTurn(env.DB, user.id, caseId, { id: turnId, status: 'done', opId });
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('refunded');
    // 已完成的 turn 不被改成 failed（只改還在進行中的）。
    expect(row(env, 'SELECT status FROM assist_turns WHERE id = ?', turnId).status).toBe('done');
  });

  it('FINISH_UNLEASED_SQL：turn 或報告有有效租約時，回收的退還不成立（提交的操作不受影響）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { turnId, opId } = runningAnalyze(env, user);
    const op = { id: opId, user_id: user.id, task: 'assist_analyze', ref_id: turnId };
    expect(await refundForOp(env.DB, op, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(false);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
    env.DB.sqlite.prepare('UPDATE assist_turns SET lease_until = ? WHERE id = ?').run(nowS() - 1, turnId);
    expect(await refundForOp(env.DB, op, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(true);
    // 寫作批改的操作照舊（找不到 turn 或報告，NOT EXISTS 成立）。
    const { id, opId: subOp } = await queueTranslation(env, user);
    expect(await refundWithSubmission(env.DB, { id: subOp, user_id: user.id, task: 'translation_grade', ref_id: id }, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(true);
  });

  it('死信佇列依任務退還：學習助手的 turn 改 failed、不碰提交；寫作批改照舊', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const assist = runningAnalyze(env, user, { lease: null, age: 60 });
    const writing = await queueTranslation(env, user);
    const ma = makeMessage({ op_id: assist.opId }, 4);
    const mw = makeMessage({ op_id: writing.opId }, 4);
    const fake = newFake(() => () => errorResponse(500, 'api_error', 'x'));
    await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks-dlq', [ma, mw]), env, noopCtx));
    expect(ma.acked && mw.acked).toBe(true);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', assist.opId)).toEqual({ status: 'refunded', refund_reason: 'api_error' });
    expect(row(env, 'SELECT status, failure FROM assist_turns WHERE id = ?', assist.turnId)).toEqual({ status: 'failed', failure: 'api_error' });
    expect(row(env, 'SELECT status FROM assist_cases WHERE id = ?', assist.caseId).status).toBe('failed');
    expect(row(env, 'SELECT status FROM submissions WHERE id = ?', writing.id).status).toBe('failed');
    expect(fake.requests).toHaveLength(0);
  });

  it('consumer 分流：學習助手的任務不找提交；題目資料不完整（這裡的案例只有一段選文）時不呼叫 Claude，以 internal 退還並放掉租約', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { turnId, opId, caseId } = runningAnalyze(env, user, { status: 'queued', lease: null, tries: 0, age: 5 });
    const fake = newFake(() => () => {
      throw new Error('不應呼叫 Claude');
    });
    const msg = await run(env, fake, opId);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(0);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'internal' });
    expect(row(env, 'SELECT status, failure, lease_until, tries FROM assist_turns WHERE id = ?', turnId)).toEqual({ status: 'failed', failure: 'internal', lease_until: null, tries: 1 });
    expect(row(env, 'SELECT status FROM assist_cases WHERE id = ?', caseId).status).toBe('failed');
    // 讀不到 turn（帳號刪除的 CASCADE）：一樣退還 internal、ack。
    const orphan = seedAssistOp(env.DB, user.id, 'assist_report', crypto.randomUUID(), { createdAt: nowS() - 5 });
    const m2 = await run(env, fake, orphan);
    expect(m2.acked).toBe(true);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', orphan)).toEqual({ status: 'refunded', refund_reason: 'internal' });
  });

  it('LeaseHeld 依表別放掉租約：搶到 turn 的租約後 D1 丟錯 → 外層放掉 assist_turns 的租約，下一次投遞立刻處理（不被自己的 15 分鐘租約擋住）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { turnId, opId } = runningAnalyze(env, user, { status: 'queued', lease: null, tries: 0, age: 5 });
    const original = env.DB.batch.bind(env.DB);
    let failOnce = true;
    env.DB.batch = (async (statements: Array<{ sql: string }>) => {
      if (failOnce && statements.some((st) => st.sql.includes("UPDATE assist_turns SET status = 'failed'"))) {
        failOnce = false;
        throw new Error('D1_ERROR: Network connection lost');
      }
      return original(statements as never);
    }) as unknown as typeof env.DB.batch;
    const fake = newFake(() => () => {
      throw new Error('不應呼叫 Claude');
    });
    const first = await run(env, fake, opId);
    expect(first.acked).toBe(false);
    expect(first.retried).toEqual({ delaySeconds: 30 });
    expect(row(env, 'SELECT status, lease_until, tries FROM assist_turns WHERE id = ?', turnId)).toEqual({ status: 'running', lease_until: null, tries: 1 });
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
    const second = await run(env, fake, opId, 2);
    env.DB.batch = original;
    expect(second.acked).toBe(true);
    expect(row(env, 'SELECT status, tries FROM assist_turns WHERE id = ?', turnId)).toEqual({ status: 'failed', tries: 2 });
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('refunded');
  });

  it('releaseLeaseStatement：三張表各一句固定的 SQL，只放掉還指向這個操作的那一列', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { turnId, opId } = runningAnalyze(env, user);
    const reportId = crypto.randomUUID();
    seedAssistReport(env.DB, user.id, { id: reportId, status: 'running', opId: 'op-report', leaseUntil: nowS() + 600 });
    await releaseLeaseStatement(env.DB, { table: 'assist_turns', id: turnId, userId: user.id, opId: 'other-op' }).run();
    expect(row(env, 'SELECT lease_until FROM assist_turns WHERE id = ?', turnId).lease_until).not.toBeNull();
    await releaseLeaseStatement(env.DB, { table: 'assist_turns', id: turnId, userId: user.id, opId }).run();
    expect(row(env, 'SELECT lease_until FROM assist_turns WHERE id = ?', turnId).lease_until).toBeNull();
    await releaseLeaseStatement(env.DB, { table: 'assist_reports', id: reportId, userId: user.id, opId: 'op-report' }).run();
    expect(row(env, 'SELECT lease_until FROM assist_reports WHERE id = ?', reportId).lease_until).toBeNull();
    const { id, opId: subOp } = await queueTranslation(env, user);
    env.DB.sqlite.prepare('UPDATE submissions SET lease_until = ? WHERE id = ?').run(nowS() + 600, id);
    await releaseLeaseStatement(env.DB, { table: 'submissions', id, userId: user.id, opId: subOp }).run();
    expect(row(env, 'SELECT lease_until FROM submissions WHERE id = ?', id).lease_until).toBeNull();
  });

  it('refundWithAssistRef：解析失敗時有成功過的案例維持 analyzed；轉錄的內容退還刪照片、系統原因保留；報告改 failed；重送不重複', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const analyzed = seedAssistCase(env.DB, user.id, { status: 'analyzing', analyses: 1 });
    const t1 = crypto.randomUUID();
    const o1 = seedAssistOp(env.DB, user.id, 'assist_analyze', t1);
    seedAssistTurn(env.DB, user.id, analyzed, { id: t1, seq: 2, status: 'running', opId: o1 });
    const op1 = { id: o1, user_id: user.id, task: 'assist_analyze', ref_id: t1 };
    expect(await refundWithAssistRef(env.DB, op1, 'refusal', Date.now())).toBe(true);
    expect(await refundWithAssistRef(env.DB, op1, 'refusal', Date.now())).toBe(false);
    expect(row(env, 'SELECT status FROM assist_cases WHERE id = ?', analyzed).status).toBe('analyzed');

    const photo = (reason: string) => {
      const caseId = seedAssistCase(env.DB, user.id, { status: 'ocr_queued', source: 'photo', analyses: 0 });
      seedAssistPhoto(env.DB, user.id, caseId);
      const t = crypto.randomUUID();
      const o = seedAssistOp(env.DB, user.id, 'assist_ocr', t, { points: 2 });
      seedAssistTurn(env.DB, user.id, caseId, { id: t, kind: 'ocr', status: 'running', opId: o });
      return { caseId, op: { id: o, user_id: user.id, task: 'assist_ocr', ref_id: t }, reason };
    };
    for (const p of [photo('invalid_output'), photo('timeout')]) {
      expect(await refundWithAssistRef(env.DB, p.op, p.reason, Date.now())).toBe(true);
      expect(row(env, 'SELECT status FROM assist_cases WHERE id = ?', p.caseId).status).toBe('draft');
      expect(row(env, 'SELECT COUNT(*) AS n FROM assist_photos WHERE case_id = ?', p.caseId).n).toBe(p.reason === 'invalid_output' ? 0 : 1);
    }

    const reportId = crypto.randomUUID();
    const o3 = seedAssistOp(env.DB, user.id, 'assist_report', reportId, { points: 10 });
    seedAssistReport(env.DB, user.id, { id: reportId, status: 'queued', opId: o3 });
    expect(await refundWithAssistRef(env.DB, { id: o3, user_id: user.id, task: 'assist_report', ref_id: reportId }, 'api_error', Date.now())).toBe(true);
    expect(row(env, 'SELECT status, failure FROM assist_reports WHERE id = ?', reportId)).toEqual({ status: 'failed', failure: 'api_error' });
  });

  it('purgeExpiredAssist：過期的照片、案例（CASCADE turn）、報告、共用快取；進行中的案例與報告不刪；沒過期的不動', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const past = nowS() - 10;
    const created = nowS() - 200 * 86_400;
    const expired = seedAssistCase(env.DB, user.id, { createdAt: created, expiresAt: past });
    seedAssistTurn(env.DB, user.id, expired, { seq: 1 });
    const inflight = seedAssistCase(env.DB, user.id, { createdAt: created, expiresAt: past, status: 'analyzing' });
    seedAssistTurn(env.DB, user.id, inflight, { seq: 1, status: 'running', opId: 'op-x' });
    const fresh = seedAssistCase(env.DB, user.id);
    seedAssistPhoto(env.DB, user.id, fresh, { createdAt: nowS() - 2 * 86_400, expiresAt: nowS() - 86_400 });
    seedAssistPhoto(env.DB, user.id, fresh, { ord: 2 });
    seedAssistReport(env.DB, user.id, { version: 1, createdAt: created, expiresAt: past });
    seedAssistReport(env.DB, user.id, { version: 2, createdAt: created, expiresAt: past, status: 'running' });
    seedAssistReport(env.DB, user.id, { version: 3 });
    env.DB.sqlite
      .prepare(`INSERT INTO ai_shared_cache (cache_key, kind, ref_id, prompt_version, model, result_json, expires_at) VALUES (?, 'explain_template', 'r', 'p', 'm', '{}', ?)`)
      .run('old', past);
    env.DB.sqlite
      .prepare(`INSERT INTO ai_shared_cache (cache_key, kind, ref_id, prompt_version, model, result_json, expires_at) VALUES (?, 'explain_template', 'r', 'p', 'm', '{}', ?)`)
      .run('new', nowS() + 86_400);
    expect(await purgeExpiredAssist(env.DB, Date.now())).toEqual({ photos: 1, ocr: 0, cases: 1, reports: 1, cache: 1 });
    expect(env.DB.sqlite.prepare('SELECT id FROM assist_cases ORDER BY created_at').all().map((r) => (r as { id: string }).id).sort()).toEqual([inflight, fresh].sort());
    expect(row(env, 'SELECT COUNT(*) AS n FROM assist_turns WHERE case_id = ?', expired).n).toBe(0);
    expect(row(env, 'SELECT COUNT(*) AS n FROM assist_photos').n).toBe(1);
    expect(env.DB.sqlite.prepare('SELECT version FROM assist_reports ORDER BY version').all()).toEqual([{ version: 2 }, { version: 3 }]);
    expect(env.DB.sqlite.prepare('SELECT cache_key FROM ai_shared_cache').all()).toEqual([{ cache_key: 'new' }]);
  });
});
