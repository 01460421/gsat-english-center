/**
 * 原子預扣、結算、退還（src/ai/guard.ts；DB_SCHEMA §3.7、ARCHITECTURE §6.4）。
 * 預扣是一句 INSERT … SELECT … WHERE；失敗原因的六種代碼、並行送 N 個請求不超扣、結算與退還的冪等都要測。
 */
import { describe, expect, it } from 'vitest';
import { refundOp, reserveOp, settleOp, setPausedStatement, siteLimitsMicros, UNLIMITED, userLimits, type ReserveInput } from '../src/ai/guard';
import { loadConfig } from '../src/config';
import { taiwanDay } from '../src/time';
import type { TestD1 } from './helpers/d1';
import { ESSAY_GROUP, STUDENT_ESSAY, call, makeEnv, seedUser } from './helpers/ai';

const NOW = Date.parse('2026-10-08T04:00:00Z');

function input(db: TestD1, userId: number, over: Partial<ReserveInput> = {}): ReserveInput {
  const config = loadConfig(makeEnv({}, db));
  return {
    opId: crypto.randomUUID(),
    userId,
    task: 'translation_grade',
    refId: 'sub-1',
    points: 3,
    usdMicros: 312_000,
    family: null,
    limits: { capDay: 30, capMonth: 300, familyCap: 3, capConc: 2, unlimited: false },
    site: siteLimitsMicros(config),
    nowMs: NOW,
    ...over,
  };
}

function finishAll(db: TestD1) {
  db.sqlite.prepare(`UPDATE ai_ops SET status = 'settled', points_charged = points_reserved WHERE status = 'reserved'`).run();
}

describe('原子預扣（一句 SQL）', () => {
  it('成功：寫入一列 reserved，記台灣日期與月份', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const r = await reserveOp(env.DB, input(env.DB, user.id));
    expect(r).toEqual({ ok: true });
    const row = env.DB.sqlite.prepare('SELECT * FROM ai_ops').get() as Record<string, unknown>;
    expect(row).toMatchObject({ status: 'reserved', points_reserved: 3, usd_reserved_micros: 312_000, tw_day: '2026-10-08', tw_month: '2026-10' });
  });

  it('quota_day：今天的點數不夠', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const limits = { capDay: 7, capMonth: 300, familyCap: 0, capConc: 9, unlimited: false };
    expect(await reserveOp(env.DB, input(env.DB, user.id, { limits, points: 3 }))).toEqual({ ok: true });
    expect(await reserveOp(env.DB, input(env.DB, user.id, { limits, points: 3 }))).toEqual({ ok: true });
    expect(await reserveOp(env.DB, input(env.DB, user.id, { limits, points: 3 }))).toEqual({ ok: false, code: 'quota_day' });
  });

  it('退還的操作不算用掉的點數', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const limits = { capDay: 3, capMonth: 300, familyCap: 0, capConc: 9, unlimited: false };
    const first = input(env.DB, user.id, { limits });
    await reserveOp(env.DB, first);
    await refundOp(env.DB, { opId: first.opId, reason: 'refusal', nowMs: NOW });
    expect(await reserveOp(env.DB, input(env.DB, user.id, { limits }))).toEqual({ ok: true });
  });

  it('quota_month：本月點數不夠（前幾天用掉的也算）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const limits = { capDay: 30, capMonth: 5, familyCap: 0, capConc: 9, unlimited: false };
    await reserveOp(env.DB, input(env.DB, user.id, { limits, nowMs: Date.parse('2026-10-02T04:00:00Z') }));
    finishAll(env.DB);
    expect(await reserveOp(env.DB, input(env.DB, user.id, { limits }))).toEqual({ ok: false, code: 'quota_month' });
    // 下個月重置。
    expect(await reserveOp(env.DB, input(env.DB, user.id, { limits, nowMs: Date.parse('2026-11-01T04:00:00Z') }))).toEqual({ ok: true });
  });

  it('daily_limit：作文家族每天篇數（OCR 不算篇數）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const limits = { capDay: 100, capMonth: 1000, familyCap: 2, capConc: 9, unlimited: false };
    const essay = { task: 'essay_grade' as const, family: ['essay_grade'] as const, points: 7, limits };
    expect(await reserveOp(env.DB, input(env.DB, user.id, essay))).toEqual({ ok: true });
    expect(await reserveOp(env.DB, input(env.DB, user.id, essay))).toEqual({ ok: true });
    finishAll(env.DB);
    expect(await reserveOp(env.DB, input(env.DB, user.id, essay))).toEqual({ ok: false, code: 'daily_limit' });
    expect(await reserveOp(env.DB, input(env.DB, user.id, { task: 'essay_ocr', points: 2, limits }))).toEqual({ ok: true });
  });

  it('busy：同時進行中的任務已達上限', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    await reserveOp(env.DB, input(env.DB, user.id));
    await reserveOp(env.DB, input(env.DB, user.id));
    expect(await reserveOp(env.DB, input(env.DB, user.id))).toEqual({ ok: false, code: 'busy' });
  });

  it('ai_paused：今天全站暫停（優先於其他原因）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    await setPausedStatement(env.DB, true, NOW).run();
    expect(await reserveOp(env.DB, input(env.DB, user.id, { points: 999 }))).toEqual({ ok: false, code: 'ai_paused' });
  });

  it('site_budget：全站今日美元＝已結算＋所有進行中的預扣＋這次 ≤ 上限', async () => {
    const env = makeEnv({ AI_BUDGET_SITE_USD_DAY: '1' });
    const a = seedUser(env.DB);
    const b = seedUser(env.DB);
    const site = siteLimitsMicros(loadConfig(env));
    expect(site.day).toBe(1_000_000);
    env.DB.sqlite.prepare('INSERT INTO ai_budget_daily (tw_day, online_usd_micros, updated_at) VALUES (?, ?, 0)').run(taiwanDay(NOW), 400_000);
    expect(await reserveOp(env.DB, input(env.DB, a.id, { site }))).toEqual({ ok: true }); // 0.4 ＋ 0.312
    // 另一個人的預扣也算進去：0.4 ＋ 0.312 ＋ 0.312 > 1
    expect(await reserveOp(env.DB, input(env.DB, b.id, { site }))).toEqual({ ok: false, code: 'site_budget' });
  });

  it('site_budget：本月美元', async () => {
    const env = makeEnv({ AI_BUDGET_SITE_USD_MONTH: '1' });
    const user = seedUser(env.DB);
    env.DB.sqlite.prepare('INSERT INTO ai_budget_daily (tw_day, online_usd_micros, updated_at) VALUES (?, ?, 0)').run('2026-10-01', 900_000);
    expect(await reserveOp(env.DB, input(env.DB, user.id, { site: siteLimitsMicros(loadConfig(env)) }))).toEqual({ ok: false, code: 'site_budget' });
  });

  it('並行送 10 個請求也不會超扣（每天 9 點、每次 3 點 → 剛好 3 個成功）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const limits = { capDay: 9, capMonth: 300, familyCap: 0, capConc: 100, unlimited: false };
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveOp(env.DB, input(env.DB, user.id, { limits }))));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'quota_day')).toBe(true);
    expect(env.DB.sqlite.prepare('SELECT SUM(points_reserved) AS p FROM ai_ops').get()).toEqual({ p: 9 });
  });

  it('等級與個別覆寫：試用 10 點／天；管理員不限點數與篇數；users.ai_points_day 覆寫', () => {
    const config = loadConfig(makeEnv());
    expect(userLimits(config, { role: 'student', aiTier: 'trial', aiPointsDay: null, aiPointsMonth: null })).toMatchObject({ capDay: 10, capMonth: 300 });
    expect(userLimits(config, { role: 'student', aiTier: 'standard', aiPointsDay: 5, aiPointsMonth: null })).toMatchObject({ capDay: 5, familyCap: 3, capConc: 2 });
    expect(userLimits(config, { role: 'admin', aiTier: 'standard', aiPointsDay: null, aiPointsMonth: null })).toMatchObject({ capDay: UNLIMITED, familyCap: 0, capConc: 2 });
  });
});

describe('結算與退還（同一個 db.batch，settle_token 冪等）', () => {
  function addCall(db: TestD1, opId: string, cost: number) {
    db.sqlite
      .prepare(`INSERT INTO ai_calls (op_id, channel, workspace, task, model, prompt_version, pricing_version, cost_micros, tw_day) VALUES (?, 'online', 'online', 'translation_grade', 'claude-opus-5-5', 'p', 'v', ?, ?)`)
      .run(opId, cost, taiwanDay(NOW));
  }

  it('結算：實扣點數、累加實際美元；重送不重複累加', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const r = input(env.DB, user.id);
    await reserveOp(env.DB, r);
    addCall(env.DB, r.opId, 50_000);
    addCall(env.DB, r.opId, 20_000);
    expect(await settleOp(env.DB, { opId: r.opId, nowMs: NOW })).toBe(true);
    expect(await settleOp(env.DB, { opId: r.opId, nowMs: NOW })).toBe(false);
    expect(await refundOp(env.DB, { opId: r.opId, reason: 'internal', nowMs: NOW })).toBe(false);
    expect(env.DB.sqlite.prepare('SELECT status, points_charged, usd_actual_micros FROM ai_ops').get()).toEqual({ status: 'settled', points_charged: 3, usd_actual_micros: 70_000 });
    expect(env.DB.sqlite.prepare('SELECT online_usd_micros, calls FROM ai_budget_daily').get()).toEqual({ online_usd_micros: 70_000, calls: 2 });
  });

  it('退還：點數 0、實際成本照記並累加進全站預算（拒答也收費）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const r = input(env.DB, user.id);
    await reserveOp(env.DB, r);
    addCall(env.DB, r.opId, 12_345);
    expect(await refundOp(env.DB, { opId: r.opId, reason: 'refusal', nowMs: NOW })).toBe(true);
    expect(env.DB.sqlite.prepare('SELECT status, points_charged, usd_actual_micros, refund_reason FROM ai_ops').get()).toEqual({
      status: 'refunded',
      points_charged: 0,
      usd_actual_micros: 12_345,
      refund_reason: 'refusal',
    });
    expect(env.DB.sqlite.prepare('SELECT online_usd_micros FROM ai_budget_daily').get()).toEqual({ online_usd_micros: 12_345 });
  });
});

describe('POST /api/ai/* 的預扣失敗回應', () => {
  async function essayDraft(env: ReturnType<typeof makeEnv>, user: ReturnType<typeof seedUser>) {
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: STUDENT_ESSAY } });
    return created.body.id as string;
  }

  it('個人額度 429＋中文訊息；全站 503', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB, { aiPointsDay: 5 });
    const id = await essayDraft(env, user);
    const res = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: id });
    expect(res.status).toBe(429);
    expect(res.body.error).toEqual({ code: 'quota_day', message: '今日點數已用完，台灣時間 00:00 重置' });
    // 沒有預扣成功就不改提交狀態。
    expect((await call(env, user, 'GET', `/api/submissions/${id}`)).body.status).toBe('draft');

    const paused = makeEnv();
    const u2 = seedUser(paused.DB);
    await setPausedStatement(paused.DB, true, Date.now()).run();
    const id2 = await essayDraft(paused, u2);
    const res2 = await call(paused, u2, 'POST', '/api/ai/essay-grade', { submission_id: id2 });
    expect(res2.status).toBe(503);
    expect(res2.body.error.code).toBe('ai_paused');
  });

  it('排入 Queue 失敗：點數退還、提交回到原狀態、回 500', async () => {
    const env = makeEnv();
    env.AI_QUEUE.fail = true;
    const user = seedUser(env.DB);
    const id = await essayDraft(env, user);
    const original = console.error;
    console.error = () => {};
    try {
      const res = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: id });
      expect(res.status).toBe(500);
    } finally {
      console.error = original;
    }
    expect(env.DB.sqlite.prepare('SELECT status, points_charged FROM ai_ops').get()).toEqual({ status: 'refunded', points_charged: 0 });
    expect((await call(env, user, 'GET', `/api/submissions/${id}`)).body.status).toBe('draft');
  });

  it('同一份提交連送兩次：第二次 409（已在排隊），不會扣兩次', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const id = await essayDraft(env, user);
    expect((await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: id })).status).toBe(202);
    const again = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: id });
    expect(again.status).toBe(409);
    expect(env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ai_ops WHERE status = 'reserved'`).get()).toEqual({ n: 1 });
  });
});
