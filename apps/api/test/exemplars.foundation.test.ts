/**
 * 作文範文的基礎（docs/design/model-essays.md §6.1、§7.4、§3.6；工作包 E1）：遷移 0005 的 CHECK 與索引、consumer 分流、
 * 死信佇列、回收卡住的預扣（寫作批改的回收 SQL 排除範文、範文自己的對稱 SQL）、FINISH_UNLEASED_SQL、到期清理、
 * 退還、租約，以及 callWithPolicy 的 contentAttempts（一個操作跨 Queue 投遞最多付費產生 2 次內容失敗的結果）。
 * 顯示時重查 D8 用測試自己造的假指紋（同 custom-essay.test.ts）。Anthropic 一律用假回應。
 */
import { CUSTOM_TITLE_HIDDEN, CUSTOM_TITLE_UNAVAILABLE, EXEMPLAR_NOTE_HIDDEN_TEXT, type ExemplarSetView } from '@gsat/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as z from 'zod/v4';
import { callWithPolicy, CONSUMER_WALL_BUDGET_MS, releaseLeaseStatement, type CallContext, type CallResult } from '../src/ai/callPolicy';
import type { ClaudeCallInput } from '../src/ai/client';
import { createQueueHandler } from '../src/ai/consumer';
import { resetD8ForTests } from '../src/ai/d8';
import { refundForOp, refundWithSubmission } from '../src/ai/guard';
import {
  NON_WRITING_TASKS,
  purgeExpiredAssist,
  purgeExpiredExemplars,
  reclaimStaleOps,
  runHousekeeping,
  STALE_ASSIST_OPS_SQL,
  STALE_EXEMPLAR_OPS_SQL,
  STALE_OPS_SQL,
  STALE_RESERVE_HARD_SECONDS,
  STALE_RESERVE_SECONDS,
} from '../src/ai/housekeeping';
import { taskConfig } from '../src/ai/tasks';
import { loadConfig } from '../src/config';
import { bumpContentFailureStatement, CONTENT_FAILURES_SQL, exemplarContentFailures, remainingContentAttempts } from '../src/exemplars/attempts';
import { EXEMPLAR_RETENTION_SECONDS, refundWithExemplarSet } from '../src/exemplars/refund';
import { visibleExemplarPrompt, visibleExemplarView } from '../src/exemplars/visible';
import { ASSIST_TASKS, EXEMPLAR_TASKS } from '@gsat/shared';
import { errorResponse, FakeAnthropic } from './helpers/anthropic';
import { nowS, seedAssistOp, seedAssistReport } from './helpers/assist';
import { FAKE_OFFICIAL_EN, FAKE_OFFICIAL_ZH, fakeFingerprintFile } from './helpers/customEssay';
import { runningExemplar, sampleExemplarView, seedExemplarOp, seedExemplarSet } from './helpers/exemplars';
import { batchOf, call, makeEnv, makeMessage, noopCtx, seedUser, STUDENT_TRANSLATION, TRANSLATION_GROUP, type TestEnv } from './helpers/ai';

const fp = vi.hoisted(() => ({ file: {} as Record<string, unknown> }));
vi.mock('../src/generated/d8-fingerprints.json', () => ({ default: fp.file }));

beforeEach(() => {
  for (const k of Object.keys(fp.file)) delete fp.file[k];
  Object.assign(fp.file, fakeFingerprintFile());
  resetD8ForTests();
});

type User = ReturnType<typeof seedUser>;
const MIN31 = 31 * 60;

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

function row(env: TestEnv, sql: string, ...params: Array<string | number>) {
  return env.DB.sqlite.prepare(sql).get(...params) as Record<string, any>;
}

function noClaude(): FakeAnthropic {
  return new FakeAnthropic(() => {
    throw new Error('不應呼叫 Claude');
  });
}

async function run(env: TestEnv, fake: FakeAnthropic, opId: string, attempts = 1, queue = 'ai-tasks') {
  const msg = makeMessage({ op_id: opId }, attempts);
  await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf(queue, [msg]), env, noopCtx));
  return msg;
}

/** 送出一份中譯英批改（寫作批改的預扣與提交；回收的對照組）。 */
async function queueTranslation(env: TestEnv, user: User): Promise<{ id: string; opId: string }> {
  const created = await call(env, user, 'POST', '/api/submissions', {
    kind: 'translation',
    group_id: TRANSLATION_GROUP,
    input_mode: 'typed',
    body: { items: STUDENT_TRANSLATION.map((text, i) => ({ item_id: `${TRANSLATION_GROUP}#中譯英${i + 1}`, text })) },
  });
  const res = await call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: created.body.id });
  return { id: created.body.id, opId: res.body.op_id };
}

describe('遷移 0005：exemplar_sets 的 CHECK 與索引', () => {
  it('建得起來；CHECK：標題 ≤ 60、JSON 合法與長度上限、網站題目或自訂題至少一個、content_failures 0–4、到期晚於建立', () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    expect(seedExemplarSet(env.DB, user.id)).toMatch(/^[0-9a-f-]{36}$/);
    const bad = (opts: Parameters<typeof seedExemplarSet>[2], label: string) => expect(() => seedExemplarSet(env.DB, user.id, opts), label).toThrow(/CHECK/);
    bad({ title: 'x'.repeat(61) }, 'title');
    bad({ source: 'exam', groupId: null, prompt: null }, 'group_id 或 prompt_json');
    bad({ contentFailures: 5 }, 'content_failures');
    bad({ createdAt: nowS(), expiresAt: nowS() }, 'expires_at');
    bad({ meta: { pad: 'x'.repeat(2_100) } }, 'meta_json ≤ 2048');
    bad({ source: 'custom', prompt: { text: 'y'.repeat(4_100) } }, 'prompt_json ≤ 4096');
    expect(() => env.DB.sqlite.prepare("UPDATE exemplar_sets SET output_json = '{bad' WHERE user_id = ?").run(user.id)).toThrow(/CHECK/);
    expect(() => env.DB.sqlite.prepare("UPDATE exemplar_sets SET rating = 'unclear' WHERE user_id = ?").run(user.id)).toThrow(/CHECK/);
    expect(() => env.DB.sqlite.prepare("UPDATE exemplar_sets SET status = 'grading' WHERE user_id = ?").run(user.id)).toThrow(/CHECK/);
    expect(() => env.DB.sqlite.prepare(`UPDATE exemplar_sets SET output_json = ? WHERE user_id = ?`).run(JSON.stringify({ s: 'x'.repeat(32_800) }), user.id)).toThrow(/CHECK/);
  });

  it('同一個使用者、同一題同時只能有一個進行中（idx_exemplar_sets_inflight）；完成或失敗的不算；別人不受影響', () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const other = seedUser(env.DB);
    const insert = (userId: number, status: string) =>
      env.DB.sqlite
        .prepare(
          `INSERT INTO exemplar_sets (id, user_id, source, group_id, dedupe_key, title, status, expires_at)
           VALUES (?, ?, 'exam', 'gsat-115.s8g1@1', 'same-key', '115 學測 英文作文', ?, ?)`,
        )
        .run(crypto.randomUUID(), userId, status, nowS() + 100);
    insert(user.id, 'queued');
    expect(() => insert(user.id, 'running')).toThrow(/UNIQUE/);
    insert(user.id, 'done');
    insert(user.id, 'failed');
    insert(other.id, 'queued');
    const indexes = (env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'exemplar_sets' AND name LIKE 'idx_%' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes).toEqual(['idx_exemplar_sets_cache', 'idx_exemplar_sets_expire', 'idx_exemplar_sets_inflight', 'idx_exemplar_sets_user', 'idx_exemplar_sets_work']);
  });

  it('使用者刪除時 CASCADE', () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    seedExemplarSet(env.DB, user.id);
    env.DB.sqlite.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    expect(row(env, 'SELECT COUNT(*) AS n FROM exemplar_sets').n).toBe(0);
  });
});

describe('回收卡住的預扣（§7.4 第 6 點；學習助手遇過同樣的事）', () => {
  it('回歸：處理中（有效租約）的範文在 31 分鐘時不會被回收；寫作批改的回收 SQL 沒有排除範文時會誤認它', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { setId, opId } = runningExemplar(env.DB, user.id);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(0);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
    expect(row(env, 'SELECT status, lease_until FROM exemplar_sets WHERE id = ?', setId).status).toBe('running');
    // 三條查詢各自確認：提交版本排除了範文（只排除學習助手時，它找不到提交、會被當成卡住）；範文版本看得到有效租約。
    const now = nowS();
    const args = (tasks: readonly string[]) => [now - STALE_RESERVE_SECONDS, now - STALE_RESERVE_HARD_SECONDS, now, 20, JSON.stringify(tasks)] as const;
    expect(env.DB.sqlite.prepare(STALE_OPS_SQL).all(...args(ASSIST_TASKS)).map((r) => (r as { id: string }).id)).toEqual([opId]);
    expect(env.DB.sqlite.prepare(STALE_OPS_SQL).all(...args(NON_WRITING_TASKS))).toEqual([]);
    expect(env.DB.sqlite.prepare(STALE_EXEMPLAR_OPS_SQL).all(...args(EXEMPLAR_TASKS))).toEqual([]);
    // 學習助手的回收 SQL 也不會碰到範文（任務清單不同）。
    expect(env.DB.sqlite.prepare(STALE_ASSIST_OPS_SQL).all(...args(ASSIST_TASKS))).toEqual([]);
    expect(NON_WRITING_TASKS).toEqual([...ASSIST_TASKS, ...EXEMPLAR_TASKS]);
  });

  it('回歸：有效租約的範文在 6 小時之後也不會被回收（第一次呼叫可能要好幾分鐘）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { opId } = runningExemplar(env.DB, user.id, { age: STALE_RESERVE_HARD_SECONDS + 600 });
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(0);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
  });

  it('沒有被處理過（queued、沒有租約）的範文 30 分鐘後被回收：列改 failed、退還 expired、點數全退；29 分鐘時還不會', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const young = runningExemplar(env.DB, user.id, { status: 'queued', lease: null, tries: 0, age: 29 * 60 });
    const never = runningExemplar(env.DB, user.id, { status: 'queued', lease: null, tries: 0 });
    // 兩組的 dedupe_key 各自不同，不會撞到 inflight 索引。
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', young.opId).status).toBe('reserved');
    expect(row(env, 'SELECT status, refund_reason, points_charged FROM ai_ops WHERE id = ?', never.opId)).toEqual({ status: 'refunded', refund_reason: 'expired', points_charged: 0 });
    expect(row(env, 'SELECT status, failure, lease_until FROM exemplar_sets WHERE id = ?', never.setId)).toEqual({ status: 'failed', failure: 'expired', lease_until: null });
    expect(row(env, "SELECT COUNT(*) AS n FROM ops_events WHERE kind = 'ai_reserve_reclaimed'").n).toBe(1);
  });

  it('處理過但租約到期：要 6 小時才回收；列不存在、指向別的操作、已經不在進行中：30 分鐘就回收（已完成的列不被改成 failed）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const retried = runningExemplar(env.DB, user.id, { lease: nowS() - 10, tries: 1 });
    const orphan = seedExemplarOp(env.DB, user.id, crypto.randomUUID(), { createdAt: nowS() - MIN31 });
    const doneSet = crypto.randomUUID();
    const doneOp = seedExemplarOp(env.DB, user.id, doneSet, { createdAt: nowS() - MIN31 });
    seedExemplarSet(env.DB, user.id, { id: doneSet, status: 'done', opId: doneOp });
    const otherSet = crypto.randomUUID();
    const otherOp = seedExemplarOp(env.DB, user.id, otherSet, { createdAt: nowS() - MIN31 });
    seedExemplarSet(env.DB, user.id, { id: otherSet, status: 'running', opId: 'another-op', leaseUntil: nowS() + 600, tries: 1 });
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(3);
    for (const op of [orphan, doneOp, otherOp]) expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', op).status).toBe('refunded');
    expect(row(env, 'SELECT status FROM exemplar_sets WHERE id = ?', doneSet).status).toBe('done');
    expect(row(env, 'SELECT status FROM exemplar_sets WHERE id = ?', otherSet).status).toBe('running');
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', retried.opId).status).toBe('reserved');
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = ? WHERE id = ?').run(nowS() - STALE_RESERVE_HARD_SECONDS - 60, retried.opId);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(1);
    expect(row(env, 'SELECT status, failure FROM exemplar_sets WHERE id = ?', retried.setId)).toEqual({ status: 'failed', failure: 'expired' });
  });

  it('三條回收各自正確：卡住的寫作批改、學習助手報告、範文同一次全部回收；處理中的報告與範文都不動', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const writing = await queueTranslation(env, user);
    env.DB.sqlite.prepare('UPDATE ai_ops SET created_at = ? WHERE id = ?').run(nowS() - MIN31, writing.opId);
    const reportId = crypto.randomUUID();
    const reportOp = seedAssistOp(env.DB, user.id, 'assist_report', reportId, { createdAt: nowS() - MIN31, points: 10 });
    seedAssistReport(env.DB, user.id, { id: reportId, status: 'queued', opId: reportOp });
    // 同一人同時只能有一份進行中的報告：處理中的那一份放在另一位學生。
    const peer = seedUser(env.DB);
    const liveReport = crypto.randomUUID();
    const liveReportOp = seedAssistOp(env.DB, peer.id, 'assist_report', liveReport, { createdAt: nowS() - MIN31, points: 10 });
    seedAssistReport(env.DB, peer.id, { id: liveReport, status: 'running', opId: liveReportOp, leaseUntil: nowS() + 600, tries: 1 });
    const stuck = runningExemplar(env.DB, user.id, { status: 'queued', lease: null, tries: 0 });
    const live = runningExemplar(env.DB, user.id);
    expect(await quiet(() => reclaimStaleOps(env.DB, Date.now()))).toBe(3);
    expect(row(env, 'SELECT status FROM submissions WHERE id = ?', writing.id).status).toBe('failed');
    expect(row(env, 'SELECT status, failure FROM assist_reports WHERE id = ?', reportId)).toEqual({ status: 'failed', failure: 'expired' });
    expect(row(env, 'SELECT status FROM exemplar_sets WHERE id = ?', stuck.setId).status).toBe('failed');
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', liveReportOp).status).toBe('reserved');
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', live.opId).status).toBe('reserved');
  });

  it('FINISH_UNLEASED_SQL：範文有有效租約時，回收的退還不成立；租約到期後才成立（寫作批改的操作不受影響）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { setId, opId } = runningExemplar(env.DB, user.id);
    const op = { id: opId, user_id: user.id, task: 'essay_exemplars', ref_id: setId };
    expect(await refundForOp(env.DB, op, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(false);
    expect(row(env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('reserved');
    expect(row(env, 'SELECT status FROM exemplar_sets WHERE id = ?', setId).status).toBe('running');
    env.DB.sqlite.prepare('UPDATE exemplar_sets SET lease_until = ? WHERE id = ?').run(nowS() - 1, setId);
    expect(await refundForOp(env.DB, op, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(true);
    expect(row(env, 'SELECT status FROM exemplar_sets WHERE id = ?', setId).status).toBe('failed');
    const { id, opId: subOp } = await queueTranslation(env, user);
    expect(await refundWithSubmission(env.DB, { id: subOp, user_id: user.id, task: 'translation_grade', ref_id: id }, 'expired', Date.now(), { onlyIfUnleased: true })).toBe(true);
  });
});

describe('退還、死信佇列與 consumer 分流（§7.4 第 1、5、10 點）', () => {
  it('refundWithExemplarSet：列改 failed、寫退還原因、放掉租約、保存期限重算；重送不重複；已完成的列不動；列不存在時只退還點數', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { setId, opId } = runningExemplar(env.DB, user.id);
    const op = { id: opId, user_id: user.id, task: 'essay_exemplars', ref_id: setId };
    const at = Date.now();
    expect(await refundWithExemplarSet(env.DB, op, 'invalid_output', at)).toBe(true);
    expect(await refundWithExemplarSet(env.DB, op, 'invalid_output', at)).toBe(false);
    const r = row(env, 'SELECT status, failure, lease_until, updated_at, expires_at FROM exemplar_sets WHERE id = ?', setId);
    expect(r).toMatchObject({ status: 'failed', failure: 'invalid_output', lease_until: null });
    expect(r.expires_at - r.updated_at).toBe(EXEMPLAR_RETENTION_SECONDS);
    expect(EXEMPLAR_RETENTION_SECONDS).toBe(180 * 86_400);
    expect(row(env, 'SELECT status, refund_reason, points_charged FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output', points_charged: 0 });
    // 已完成的列不被改成 failed（只改還在進行中、還指向這個操作的那一列）。
    const doneSet = crypto.randomUUID();
    const doneOp = seedExemplarOp(env.DB, user.id, doneSet);
    seedExemplarSet(env.DB, user.id, { id: doneSet, status: 'done', opId: doneOp });
    expect(await refundWithExemplarSet(env.DB, { id: doneOp, user_id: user.id, task: 'essay_exemplars', ref_id: doneSet }, 'internal', at)).toBe(true);
    expect(row(env, 'SELECT status, failure FROM exemplar_sets WHERE id = ?', doneSet)).toEqual({ status: 'done', failure: null });
    // 列不存在（帳號刪除的 CASCADE）：只退還點數。
    const orphan = seedExemplarOp(env.DB, user.id, crypto.randomUUID());
    expect(await refundWithExemplarSet(env.DB, { id: orphan, user_id: user.id, task: 'essay_exemplars', ref_id: 'missing' }, 'internal', at)).toBe(true);
  });

  it('死信佇列依任務退還：範文的那一列改 failed、不碰提交；寫作批改照舊', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const exemplar = runningExemplar(env.DB, user.id, { lease: null, age: 60 });
    const writing = await queueTranslation(env, user);
    const me = makeMessage({ op_id: exemplar.opId }, 4);
    const mw = makeMessage({ op_id: writing.opId }, 4);
    const fake = new FakeAnthropic(() => errorResponse(500, 'api_error', 'x'));
    await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks-dlq', [me, mw]), env, noopCtx));
    expect(me.acked && mw.acked).toBe(true);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', exemplar.opId)).toEqual({ status: 'refunded', refund_reason: 'api_error' });
    expect(row(env, 'SELECT status, failure FROM exemplar_sets WHERE id = ?', exemplar.setId)).toEqual({ status: 'failed', failure: 'api_error' });
    expect(row(env, 'SELECT status FROM submissions WHERE id = ?', writing.id).status).toBe('failed');
    expect(fake.requests).toHaveLength(0);
  });

  it('consumer 分流：範文的任務交給 exemplars/consumer、不找提交；題目讀不到（不在白名單的題組）時不呼叫模型：以 internal 退還、列改 failed、ack', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    // E2 起 consumer 會真的產生範文（exemplars.consumer.test.ts）；這裡用中譯英的題組（不在白名單）確認分流與退還路徑。
    const setId = crypto.randomUUID();
    const opId = seedExemplarOp(env.DB, user.id, setId, { createdAt: nowS() - 5 });
    seedExemplarSet(env.DB, user.id, { id: setId, status: 'queued', opId, groupId: TRANSLATION_GROUP });
    const fake = noClaude();
    const msg = await run(env, fake, opId);
    expect(msg.acked).toBe(true);
    expect(msg.retried).toBeNull();
    expect(fake.requests).toHaveLength(0);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'internal' });
    expect(row(env, 'SELECT status, failure FROM exemplar_sets WHERE id = ?', setId)).toEqual({ status: 'failed', failure: 'internal' });
    // 同一則訊息再送一次：操作已退還，直接 ack。
    const again = await run(env, fake, opId, 2);
    expect(again.acked).toBe(true);
    expect(row(env, "SELECT COUNT(*) AS n FROM ai_ops WHERE id = ? AND status = 'refunded'", opId).n).toBe(1);
    // 讀不到列（帳號刪除的 CASCADE）：一樣退還 internal、ack。
    const orphan = seedExemplarOp(env.DB, user.id, crypto.randomUUID(), { createdAt: nowS() - 5 });
    expect((await run(env, fake, orphan)).acked).toBe(true);
    expect(row(env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', orphan)).toEqual({ status: 'refunded', refund_reason: 'internal' });
  });

  it('releaseLeaseStatement：exemplar_sets 一句固定的 SQL，只放掉還指向這個操作的那一列', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { setId, opId } = runningExemplar(env.DB, user.id);
    await releaseLeaseStatement(env.DB, { table: 'exemplar_sets', id: setId, userId: user.id, opId: 'other-op' }).run();
    expect(row(env, 'SELECT lease_until FROM exemplar_sets WHERE id = ?', setId).lease_until).not.toBeNull();
    await releaseLeaseStatement(env.DB, { table: 'exemplar_sets', id: setId, userId: user.id + 1, opId }).run();
    expect(row(env, 'SELECT lease_until FROM exemplar_sets WHERE id = ?', setId).lease_until).not.toBeNull();
    await releaseLeaseStatement(env.DB, { table: 'exemplar_sets', id: setId, userId: user.id, opId }).run();
    expect(row(env, 'SELECT lease_until FROM exemplar_sets WHERE id = ?', setId).lease_until).toBeNull();
  });
});

describe('到期清理（§6.2）', () => {
  it('purgeExpiredExemplars：刪最後一次更新後 180 天的組；進行中的不刪；沒過期的不動；runHousekeeping 會跑它', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = nowS() - 200 * 86_400;
    const past = nowS() - 10;
    seedExemplarSet(env.DB, user.id, { createdAt: created, expiresAt: past });
    seedExemplarSet(env.DB, user.id, { status: 'failed', createdAt: created, expiresAt: past });
    const inflight = seedExemplarSet(env.DB, user.id, { status: 'running', opId: 'op-x', createdAt: created, expiresAt: past });
    const fresh = seedExemplarSet(env.DB, user.id);
    expect(await purgeExpiredExemplars(env.DB, Date.now())).toBe(2);
    expect((env.DB.sqlite.prepare('SELECT id FROM exemplar_sets').all() as Array<{ id: string }>).map((r) => r.id).sort()).toEqual([inflight, fresh].sort());
    // 學習助手的清理結果不受影響（範文另一步）。
    expect(await purgeExpiredAssist(env.DB, Date.now())).toEqual({ photos: 0, ocr: 0, cases: 0, reports: 0, cache: 0 });
    seedExemplarSet(env.DB, user.id, { createdAt: created, expiresAt: past });
    await quiet(() => runHousekeeping(env.DB, Date.now()));
    expect(row(env, 'SELECT COUNT(*) AS n FROM exemplar_sets').n).toBe(2);
  });

  it('一次最多刪 200 列', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = nowS() - 200 * 86_400;
    for (let i = 0; i < 205; i++) seedExemplarSet(env.DB, user.id, { createdAt: created, expiresAt: nowS() - 10 });
    expect(await purgeExpiredExemplars(env.DB, Date.now())).toBe(200);
    expect(await purgeExpiredExemplars(env.DB, Date.now())).toBe(5);
  });
});

describe('內容失敗的次數跨 Queue 投遞累計（§3.6）', () => {
  const schema = z.object({ answer: z.string() });

  /** 一次投遞的呼叫脈絡：時鐘由假模型推進（firstCallMs＝第一次呼叫花多久）。 */
  function setup() {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const { setId, opId } = runningExemplar(env.DB, user.id, { age: 60 });
    const tc = taskConfig('essay_exemplars', loadConfig(env));
    const input: ClaudeCallInput = { task: 'essay_exemplars', spec: tc.calls[0]!, timeoutMs: tc.timeoutMs, maxRetries: tc.maxRetries, system: 'test system', schema, content: '<task>\ntest\n</task>', templateVersion: 'test@1' };
    const ref = { opId, setId, userId: user.id };
    return { env, user, setId, opId, tc, input, ref };
  }

  type Reply = 'ok' | 'bad_schema' | 'bad_json' | 'max_tokens' | 'semantic' | 'api_error';

  /** 一次投遞：先算已有的內容失敗次數，再照 §3.6 傳 contentAttempts（不傳＝批改與學習助手的既有行為）。 */
  async function delivery(s: ReturnType<typeof setup>, replies: Reply[], opts: { callMs?: number; legacy?: boolean } = {}): Promise<CallResult & { calls: number; failuresBefore: number }> {
    let clock = Date.now();
    const startedAt = clock;
    const queue = [...replies];
    let calls = 0;
    const fake = new FakeAnthropic(() => {
      calls++;
      clock += opts.callMs ?? 10_000;
      const r = queue.shift() ?? 'ok';
      if (r === 'api_error') return errorResponse(529, 'overloaded_error', 'busy');
      if (r === 'bad_json') return fake.json('not json at all {');
      if (r === 'bad_schema') return fake.json({ wrong: 1 });
      if (r === 'max_tokens') return fake.json({ answer: 'cut' }, { stopReason: 'max_tokens' });
      return fake.json({ answer: r });
    });
    const failuresBefore = await exemplarContentFailures(s.env.DB, s.ref);
    const ctx: CallContext = {
      env: s.env,
      db: s.env.DB,
      deps: { fetch: fake.fetch, now: () => clock },
      now: () => clock,
      op: { id: s.opId, user_id: s.ref.userId, task: 'essay_exemplars', ref_id: s.setId, status: 'reserved' },
      startedAt,
      tc: s.tc,
      userRef: null,
      callInput: () => s.input,
    };
    const onSuccess = async (data: unknown) => {
      if ((data as { answer: string }).answer !== 'semantic') return null;
      await bumpContentFailureStatement(s.env.DB, s.ref).run();
      return 'semantic check failed';
    };
    const result = await quiet(() =>
      opts.legacy ? callWithPolicy(ctx, s.input, onSuccess) : callWithPolicy(ctx, s.input, onSuccess, { contentAttempts: remainingContentAttempts(failuresBefore) }),
    );
    return { ...result, calls, failuresBefore };
  }

  const callsOf = (s: ReturnType<typeof setup>) => row(s.env, 'SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?', s.opId).n as number;
  const failuresOf = (s: ReturnType<typeof setup>) => row(s.env, 'SELECT content_failures AS n FROM exemplar_sets WHERE id = ?', s.setId).n as number;

  it('(a) 第一次呼叫 150 秒後語意檢查不過 → 交回 Queue；第二次投遞仍不過 → 退還；ai_calls 總共 2 列、content_failures 2', async () => {
    const s = setup();
    const first = await delivery(s, ['semantic'], { callMs: 150_000 });
    expect(first).toMatchObject({ ok: false, retryable: true, reason: 'invalid_output', calls: 1, failuresBefore: 0 });
    const second = await delivery(s, ['semantic', 'semantic'], { callMs: 10_000 });
    // 第二次投遞已有 1 次內容失敗：這次就是最後一次（就算時間夠，也不在這次投遞裡再付一次錢）。
    expect(second).toMatchObject({ ok: false, retryable: false, reason: 'invalid_output', calls: 1, failuresBefore: 1 });
    expect(callsOf(s)).toBe(2);
    expect(failuresOf(s)).toBe(2);
    expect(remainingContentAttempts(await exemplarContentFailures(s.env.DB, s.ref))).toBe(0);
  });

  it('(b) 第一次投遞截斷（ai_calls.stop_reason=max_tokens）→ 第二次投遞格式不符 → 退還；ai_calls 2 列；格式不符與 JSON 壞掉也算', async () => {
    const s = setup();
    const first = await delivery(s, ['max_tokens'], { callMs: 150_000 });
    expect(first).toMatchObject({ ok: false, retryable: true, reason: 'max_tokens', calls: 1 });
    expect(await exemplarContentFailures(s.env.DB, s.ref)).toBe(1);
    expect(failuresOf(s)).toBe(0);
    const second = await delivery(s, ['bad_schema', 'ok']);
    expect(second).toMatchObject({ ok: false, retryable: false, reason: 'invalid_output', calls: 1, failuresBefore: 1 });
    expect(callsOf(s)).toBe(2);
    expect(await exemplarContentFailures(s.env.DB, s.ref)).toBe(2);
    // invalid_json、unexpected_stop 也算內容失敗（error_code 清單）。
    const t = setup();
    await delivery(t, ['bad_json'], { callMs: 150_000 });
    expect(await exemplarContentFailures(t.env.DB, t.ref)).toBe(1);
  });

  it('(c) 第一次 60 秒失敗 → 同一次投遞重試成功 → ok（1 次失敗＋1 次成功）', async () => {
    const s = setup();
    const result = await delivery(s, ['bad_schema', 'ok'], { callMs: 60_000 });
    expect(result).toMatchObject({ ok: true, calls: 2, failuresBefore: 0 });
    expect(callsOf(s)).toBe(2);
    expect(await exemplarContentFailures(s.env.DB, s.ref)).toBe(1);
  });

  it('120 秒是界線：第一次呼叫 120 秒內結束才在同一次投遞裡重試（240 × 3＝720 秒，牆鐘預算 840 秒）', async () => {
    expect(CONSUMER_WALL_BUDGET_MS).toBe(840_000);
    const fast = setup();
    expect(await delivery(fast, ['semantic', 'ok'], { callMs: 120_000 })).toMatchObject({ ok: true, calls: 2 });
    const slow = setup();
    expect(await delivery(slow, ['semantic', 'ok'], { callMs: 120_001 })).toMatchObject({ ok: false, retryable: true, calls: 1 });
  });

  it('API 錯誤、逾時、429 不算內容失敗（照既有規則交給 Queue，最多 4 次投遞）；拒答照舊不重試', async () => {
    const s = setup();
    const result = await delivery(s, ['api_error', 'api_error', 'api_error']);
    expect(result).toMatchObject({ ok: false, retryable: true, reason: 'api_error' });
    expect(await exemplarContentFailures(s.env.DB, s.ref)).toBe(0);
    expect(remainingContentAttempts(0)).toBe(2);
  });

  it('對照：不傳 contentAttempts（批改與學習助手的既有行為）時，每次投遞都重新從 0 算，同樣的情境會付費 3 次以上', async () => {
    const s = setup();
    expect(await delivery(s, ['semantic'], { callMs: 150_000, legacy: true })).toMatchObject({ ok: false, retryable: true, calls: 1 });
    const second = await delivery(s, ['semantic', 'semantic'], { legacy: true });
    expect(second).toMatchObject({ ok: false, retryable: false, calls: 2 });
    expect(callsOf(s)).toBe(3);
  });

  it('contentAttempts 夾到 1–2；還剩 0 次時 consumer 不呼叫（remainingContentAttempts）', async () => {
    expect([0, 1, 2, 3, 7].map(remainingContentAttempts)).toEqual([2, 1, 0, 0, 0]);
    expect(remainingContentAttempts(-1)).toBe(2);
    const s = setup();
    // 傳 5 也只當 2：第一次失敗、時間夠就在這次重試，第二次失敗退還。
    let clock = Date.now();
    const fake = new FakeAnthropic(() => {
      clock += 1_000;
      return fake.json({ wrong: true });
    });
    const ctx: CallContext = {
      env: s.env,
      db: s.env.DB,
      deps: { fetch: fake.fetch, now: () => clock },
      now: () => clock,
      op: { id: s.opId, user_id: s.ref.userId, task: 'essay_exemplars', ref_id: s.setId, status: 'reserved' },
      startedAt: clock,
      tc: s.tc,
      userRef: null,
      callInput: () => s.input,
    };
    const r = await quiet(() => callWithPolicy(ctx, s.input, async () => null, { contentAttempts: 5 }));
    expect(r).toMatchObject({ ok: false, retryable: false, reason: 'invalid_output' });
    expect(fake.requests).toHaveLength(2);
    const r0 = await quiet(() => callWithPolicy(ctx, s.input, async () => null, { contentAttempts: 0 }));
    expect(r0).toMatchObject({ ok: false, retryable: false });
    expect(fake.requests).toHaveLength(3);
  });

  it('計數只算這個操作、這一列：別的操作的截斷不算；列被刪掉時只算 ai_calls；bump 只改進行中的列、上限 4', async () => {
    const s = setup();
    const other = runningExemplar(s.env.DB, s.ref.userId, { age: 60 });
    s.env.DB.sqlite
      .prepare(
        `INSERT INTO ai_calls (op_id, channel, workspace, task, role, model, prompt_version, pricing_version, stop_reason, cost_micros, tw_day)
         VALUES (?, 'online', 'online', 'essay_exemplars', 'writer', 'm', 'p', 'v', 'max_tokens', 0, '2026-10-23')`,
      )
      .run(other.opId);
    expect(await exemplarContentFailures(s.env.DB, s.ref)).toBe(0);
    for (let i = 0; i < 6; i++) await bumpContentFailureStatement(s.env.DB, s.ref).run();
    expect(failuresOf(s)).toBe(4);
    expect(await exemplarContentFailures(s.env.DB, { ...s.ref, userId: s.ref.userId + 1 })).toBe(0);
    s.env.DB.sqlite.prepare("UPDATE exemplar_sets SET status = 'done' WHERE id = ?").run(s.setId);
    await bumpContentFailureStatement(s.env.DB, { ...s.ref }).run();
    expect(failuresOf(s)).toBe(4);
    expect(CONTENT_FAILURES_SQL).toContain("'schema_mismatch', 'invalid_json', 'unexpected_stop'");
  });
});

describe('顯示時重查 D8（§6.2；匯出用，E2 的詳情也用）', () => {
  function view(text: string, note: string): ExemplarSetView {
    const v = sampleExemplarView();
    v.essays[2] = { ...v.essays[2], text, next_zh: note };
    v.plan_zh = note;
    v.typical_errors = [...v.typical_errors, { wrong: FAKE_OFFICIAL_EN, right: 'x', zh: 'y' }];
    v.essays[1] = { ...v.essays[1], highlights: [...v.essays[1].highlights, { kind: 'phrase', text: 'However', zh: FAKE_OFFICIAL_ZH }] };
    return v;
  }

  it('指紋版本和結算時相同：原樣；不同：逐欄重跑——命中的範文 hidden d8（本文 null、亮點與四項說明、升級說明都不留），說明換固定說明，亮點與常見的錯整則丟掉', () => {
    const v = view(`Intro sentence here. ${FAKE_OFFICIAL_EN}.`, `說明：${FAKE_OFFICIAL_ZH}`);
    const same = visibleExemplarView(JSON.stringify(v), JSON.stringify({ d8_fp: 'test-fp-0001' }));
    expect(same).toEqual({ view: v, unavailable: false });
    const re = visibleExemplarView(JSON.stringify(v), JSON.stringify({ d8_fp: 'old-version' }));
    expect(re.unavailable).toBe(false);
    const out = re.view!;
    const blank = { content: '', organization: '', grammar: '', vocabulary: '' };
    expect(out.essays[2]).toMatchObject({ level: 'top', text: null, hidden: 'd8', highlights: [], criteria: blank, next_zh: '' });
    expect(out.plan_zh).toBe(EXEMPLAR_NOTE_HIDDEN_TEXT);
    expect(out.task_reading_zh).toBe(v.task_reading_zh);
    expect(out.essays[0]).toEqual(v.essays[0]);
    expect(out.essays[1].highlights).toEqual(v.essays[0].highlights);
    expect(out.typical_errors).toEqual(sampleExemplarView().typical_errors);
    // 沒有 meta（或壞掉）也重查。
    expect(visibleExemplarView(JSON.stringify(v), '{bad').view!.essays[2].hidden).toBe('d8');
    // 結算時已經隱藏的那一篇（舊資料還留著說明）：版本相同也不顯示它的說明與亮點。
    const stale = sampleExemplarView();
    stale.essays[1] = { ...stale.essays[1], text: null, hidden: 'task_copy' };
    const shown = visibleExemplarView(JSON.stringify(stale), JSON.stringify({ d8_fp: 'test-fp-0001' })).view!;
    expect(shown.essays[1]).toMatchObject({ text: null, hidden: 'task_copy', highlights: [], criteria: blank, next_zh: '' });
    expect(shown.essays[0]).toEqual(stale.essays[0]);
    expect(visibleExemplarView(JSON.stringify(stale), JSON.stringify({ d8_fp: 'old-version' })).view!.essays[1]).toMatchObject({ hidden: 'task_copy', criteria: blank, next_zh: '' });
  });

  it('指紋檔壞掉：不顯示內容（unavailable）；沒有內容或 JSON 壞掉：view null', () => {
    expect(visibleExemplarView(null, '{}')).toEqual({ view: null, unavailable: false });
    expect(visibleExemplarView('{"essays":[]}', '{}')).toEqual({ view: null, unavailable: false });
    for (const k of Object.keys(fp.file)) delete fp.file[k];
    resetD8ForTests();
    const quietError = console.error;
    console.error = () => {};
    try {
      expect(visibleExemplarView(JSON.stringify(sampleExemplarView()), JSON.stringify({ d8_fp: 'test-fp-0001' }))).toEqual({ view: null, unavailable: true });
    } finally {
      console.error = quietError;
    }
  });

  it('自訂題的題目：命中就隱藏（同自訂作文題目）；網站題目或壞掉時 null', () => {
    const ok = visibleExemplarPrompt(JSON.stringify({ text: '請寫一篇英文作文。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null }), 1_700_000_000);
    expect(ok).toEqual({ text: '請寫一篇英文作文。', figure_text: null, paragraphs: 2, min_words: 120, max_words: null, updated_at: 1_700_000_000 });
    const hit = visibleExemplarPrompt(JSON.stringify({ text: `題目：${FAKE_OFFICIAL_ZH}`, figure_text: '圖', paragraphs: null, min_words: null, max_words: 200 }), 1);
    expect(hit).toMatchObject({ figure_text: null, hidden: true, max_words: 200 });
    expect(hit!.text).not.toContain(FAKE_OFFICIAL_ZH);
    expect(visibleExemplarPrompt(null, 1)).toBeNull();
    expect(visibleExemplarPrompt('{bad', 1)).toBeNull();
  });

  it('匯出套用重查：命中的範文不出現在匯出裡', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    seedExemplarSet(env.DB, user.id, { output: view(`Intro. ${FAKE_OFFICIAL_EN}.`, '說明'), meta: { d8_fp: 'old-version' } });
    const res = await call(env, user, 'GET', '/api/me/export');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body.exemplars);
    expect(text).not.toContain(FAKE_OFFICIAL_EN);
    expect(text).not.toContain(FAKE_OFFICIAL_ZH);
    expect(res.body.exemplars[0].output.essays[2]).toMatchObject({ hidden: 'd8', text: null });
  });

  it('匯出的標題也重查（自訂題的標題是題目開頭；和列表、詳情同一支 visibleTitle）：命中換成「（題目已隱藏）」，指紋檔壞掉時「（題目暫時無法顯示）」', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const title = `題目：${FAKE_OFFICIAL_ZH}`;
    seedExemplarSet(env.DB, user.id, { source: 'custom', title, prompt: { text: title, figure_text: null, paragraphs: 2, min_words: 120, max_words: null } });
    seedExemplarSet(env.DB, user.id, { title: '115 學測 英文作文', createdAt: nowS() + 5 });
    const res = await call(env, user, 'GET', '/api/me/export');
    expect(res.status).toBe(200);
    expect(res.body.exemplars.map((e: { title: string }) => e.title)).toEqual([CUSTOM_TITLE_HIDDEN, '115 學測 英文作文']);
    expect(JSON.stringify(res.body.exemplars)).not.toContain(FAKE_OFFICIAL_ZH);
    // 列表用的是同一支：標題一致。
    const list = await call(env, user, 'GET', '/api/exemplars');
    expect(list.status).toBe(200);
    expect(list.body.sets.map((e: { title: string }) => e.title)).toContain(CUSTOM_TITLE_HIDDEN);

    for (const k of Object.keys(fp.file)) delete fp.file[k];
    resetD8ForTests();
    const quietError = console.error;
    console.error = () => {};
    try {
      const broken = await call(env, user, 'GET', '/api/me/export');
      expect(broken.status).toBe(200);
      expect(broken.body.exemplars.map((e: { title: string }) => e.title)).toEqual([CUSTOM_TITLE_UNAVAILABLE, '115 學測 英文作文']);
    } finally {
      console.error = quietError;
    }
  });
});
