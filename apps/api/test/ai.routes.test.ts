/**
 * /api/ai/quota、/api/ai/ops/:id、AI 端點的權限與設定檢查、後台 /api/admin/ai/pause 與 /api/admin/usage，
 * 以及題目庫（scripts/build-writing-prompts.mjs 的白名單與受保護內容檢查）。
 */
import { isAiGradableTranslation } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { buildBank, extractGroups, findLeaks, restrictedFragments } from '../scripts/build-writing-prompts.mjs';
import { getWritingGroup, resolveItemId, writingGroupCount, type WritingGroup } from '../src/ai/bank';
import bankJson from '../src/generated/writing-prompts.json';
import { createQueueHandler } from '../src/ai/consumer';
import { FakeAnthropic, frameworkOf } from './helpers/anthropic';
import {
  ESSAY_GROUP,
  STUDENT_ESSAY,
  TRANSLATION_GROUP,
  batchOf,
  call,
  essayAnalyticOutput,
  essayHolisticOutput,
  makeEnv,
  makeMessage,
  noopCtx,
  seedUser,
} from './helpers/ai';

describe('GET /api/ai/quota', () => {
  it('剩餘點數、今日篇數、同時任務、全站狀態、名額、重置時間（台灣 00:00）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    seedUser(env.DB, { aiStatus: 'pending' });
    seedUser(env.DB, { role: 'admin' }); // 管理員不佔名額（和 A1 的 approvalSummary 同一套算法）
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: STUDENT_ESSAY } });
    await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: created.body.id });
    const res = await call(env, user, 'GET', '/api/ai/quota');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ai_status: 'approved',
      tier: 'standard',
      points: { day_used: 7, day_limit: 30, month_used: 7, month_limit: 300 },
      essays: { day_used: 1, day_limit: 3 },
      concurrent: { active: 1, limit: 2 },
      site: { paused: false, budget_available: true },
      approval: { cap: 49, approved: 1, full: false },
      task_points: { translation_grade: 3, essay_grade: 7, essay_ocr: 2 },
    });
    expect(res.body.resets_at.day).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+08:00$/);
    expect(res.body.resets_at.month).toMatch(/^\d{4}-\d{2}-01T00:00:00\+08:00$/);
  });

  it('沒核准的人也能看（ai_status 告訴前端要先申請）；未登入 401', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB, { aiStatus: 'none', aiTier: 'trial' });
    const res = await call(env, user, 'GET', '/api/ai/quota');
    expect(res.body).toMatchObject({ ai_status: 'none', tier: 'trial', points: { day_limit: 10 } });
    expect((await call(env, null, 'GET', '/api/ai/quota')).status).toBe(401);
  });
});

describe('AI 端點的權限與設定', () => {
  it('AI 沒設定（缺金鑰或 Queue）：503 not_configured', async () => {
    const env = makeEnv({ ANTHROPIC_API_KEY: '' });
    const user = seedUser(env.DB);
    const res = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not_configured');
  });

  it('未核准 403 not_approved；請求不是 JSON 400；中譯英格式不支援的題組 409', async () => {
    const env = makeEnv();
    const pending = seedUser(env.DB, { aiStatus: 'pending' });
    expect((await call(env, pending, 'POST', '/api/ai/translation-grade', { submission_id: 'x' })).body.error.code).toBe('not_approved');
    const user = seedUser(env.DB);
    const res = await (await import('./helpers/ai')).appAs(user).request('/api/ai/essay-grade', { method: 'POST', headers: { Origin: 'https://gsat.example' }, body: 'not json' }, env);
    expect(res.status).toBe(400);
    // 83 學測的中譯英是 5 句一組：可以存草稿，但不能送 AI 批改。
    const old = Object.keys((await import('../src/generated/writing-prompts.json')).default.groups).find((g) => g.startsWith('gsat-83.') && getWritingGroup(g)?.kind === 'translation')!;
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: old, input_mode: 'typed' });
    expect(created.status).toBe(201);
    expect((await call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: created.body.id })).status).toBe(409);
  });

  it('中譯英每一句都要作答才能送出（400）', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'translation', group_id: TRANSLATION_GROUP, input_mode: 'typed', body: { items: [{ item_id: '1', text: 'Only one.' }] } });
    const res = await call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: created.body.id });
    expect(res.status).toBe(400);
    expect(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ai_ops').get()).toEqual({ n: 0 });
  });

  it('GET /api/ai/ops/:id：自己的看得到（含退還原因），別人的或不存在 404', async () => {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await call(env, user, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: STUDENT_ESSAY } });
    const queued = await call(env, user, 'POST', '/api/ai/essay-grade', { submission_id: created.body.id });
    const fake = new FakeAnthropic((req) => (frameworkOf(req) === 'analytic' ? fake.json(essayAnalyticOutput()) : fake.json(essayHolisticOutput())));
    const log = console.log;
    console.log = () => {};
    try {
      await createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks', [makeMessage({ op_id: queued.body.op_id })]), env, noopCtx);
    } finally {
      console.log = log;
    }
    const res = await call(env, user, 'GET', `/api/ai/ops/${queued.body.op_id}`);
    expect(res.body).toMatchObject({ op_id: queued.body.op_id, task: 'essay_grade', status: 'settled', submission_status: 'graded', points_reserved: 7, points_charged: 7, refund_reason: null });
    expect(res.body.settled_at).toBeGreaterThan(0);
    expect((await call(env, user, 'GET', '/api/ai/ops/nope')).status).toBe(404);
  });
});

describe('後台：/api/admin/ai/pause、/api/admin/usage', () => {
  it('非管理員 403；管理員要 12 小時內登入過（401 reauth_required）', async () => {
    const env = makeEnv();
    const student = seedUser(env.DB);
    expect((await call(env, student, 'POST', '/api/admin/ai/pause', { paused: true })).status).toBe(403);
    expect((await call(env, student, 'GET', '/api/admin/usage')).status).toBe(403);
    const admin = { ...seedUser(env.DB, { role: 'admin' }), loginAt: Math.floor(Date.now() / 1000) - 13 * 3600 };
    const stale = await call(env, admin, 'POST', '/api/admin/ai/pause', { paused: true });
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('reauth_required');
  });

  it('暫停 → 寫 ai_budget_daily.paused、admin_audit、ops_events；新的預扣被擋（503 ai_paused）；恢復', async () => {
    const env = makeEnv();
    const admin = seedUser(env.DB, { role: 'admin' });
    expect((await call(env, admin, 'POST', '/api/admin/ai/pause', { paused: 'yes' })).status).toBe(400);
    expect((await call(env, admin, 'POST', '/api/admin/ai/pause', { paused: true })).status).toBe(204);
    expect(env.DB.sqlite.prepare('SELECT paused FROM ai_budget_daily').get()).toEqual({ paused: 1 });
    expect(env.DB.sqlite.prepare('SELECT actor_id, action FROM admin_audit').get()).toEqual({ actor_id: admin.id, action: 'ai.pause' });
    expect((await call(env, admin, 'GET', '/api/features')).body.aiPaused).toBe(true);
    const student = seedUser(env.DB);
    const created = await call(env, student, 'POST', '/api/submissions', { kind: 'essay', group_id: ESSAY_GROUP, input_mode: 'typed', body: { text: STUDENT_ESSAY } });
    const blocked = await call(env, student, 'POST', '/api/ai/essay-grade', { submission_id: created.body.id });
    expect(blocked.status).toBe(503);
    expect(blocked.body.error.code).toBe('ai_paused');
    expect((await call(env, admin, 'POST', '/api/admin/ai/pause', { paused: false })).status).toBe(204);
    expect((await call(env, student, 'POST', '/api/ai/essay-grade', { submission_id: created.body.id })).status).toBe(202);
  });

  it('用量彙總：依日、依任務；退還的不算點數但美元照算', async () => {
    const env = makeEnv();
    const admin = seedUser(env.DB, { role: 'admin' });
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const insert = env.DB.sqlite.prepare(
      `INSERT INTO ai_ops (id, user_id, task, status, points_reserved, points_charged, usd_reserved_micros, usd_actual_micros, tw_day, tw_month, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)`,
    );
    insert.run('a', admin.id, 'essay_grade', 'settled', 7, 7, 150_000, today, today.slice(0, 7));
    insert.run('b', admin.id, 'translation_grade', 'refunded', 3, 0, 20_000, today, today.slice(0, 7));
    insert.run('c', admin.id, 'translation_grade', 'settled', 3, 3, 60_000, '2026-01-05', '2026-01');
    env.DB.sqlite.prepare('INSERT INTO ai_budget_daily (tw_day, online_usd_micros, updated_at) VALUES (?, ?, 0)').run(today, 170_000);
    const res = await call(env, admin, 'GET', '/api/admin/usage');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ ops: 2, points: 7, usd_micros: 170_000, refunded_ops: 1 });
    expect(res.body.by_task).toEqual([
      { task: 'essay_grade', ops: 1, points: 7, usd_micros: 150_000 },
      { task: 'translation_grade', ops: 1, points: 0, usd_micros: 20_000 },
    ]);
    expect(res.body.budget).toEqual({ site_day_usd: 20, site_month_usd: 400, today_usd_micros: 170_000, month_usd_micros: 170_000 });
    const jan = await call(env, admin, 'GET', '/api/admin/usage?from=2026-01-01&to=2026-01-31');
    expect(jan.body.by_day).toEqual([{ tw_day: '2026-01-05', ops: 1, points: 3, usd_micros: 60_000 }]);
    expect((await call(env, admin, 'GET', '/api/admin/usage?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await call(env, admin, 'GET', '/api/admin/usage?from=2024-01-01&to=2026-01-01')).status).toBe(400);
  });
});

describe('題目庫（src/generated/writing-prompts.json）', () => {
  it('包含歷屆中譯英與作文題組；只有白名單欄位', () => {
    expect(writingGroupCount()).toBeGreaterThan(100);
    const t = getWritingGroup(TRANSLATION_GROUP)!;
    expect(t).toMatchObject({ kind: 'translation', section_type: 'translation', ai_gradable: true });
    expect(t.items.map((i) => i.item_id)).toEqual([`${TRANSLATION_GROUP}#中譯英1`, `${TRANSLATION_GROUP}#中譯英2`]);
    for (const item of t.items) expect(Object.keys(item).sort()).toEqual(['item_id', 'label', 'no', 'points', 'stem']);
    const e = getWritingGroup(ESSAY_GROUP)!;
    expect(e.essay).toMatchObject({ paragraphs: 2, min_words: 120 });
    expect(e.figures.length).toBeGreaterThan(0);
    expect(Object.keys(e).sort()).toEqual(
      ['ai_gradable', 'content_hash', 'context', 'essay', 'exam_id', 'exam_title', 'figures', 'group_id', 'instructions', 'items', 'kind', 'section_type', 'source_group', 'uid', 'version'].sort(),
    );
  });

  it('中譯英的 ai_gradable 和 shared 的 isAiGradableTranslation 同一條規則（前端據此顯示「AI 批改」按鈕）', () => {
    const groups = Object.values((bankJson as unknown as { groups: Record<string, WritingGroup> }).groups);
    const translation = groups.filter((g) => g.kind === 'translation');
    expect(translation.length).toBeGreaterThan(40);
    for (const g of translation) expect(g.ai_gradable, g.group_id).toBe(isAiGradableTranslation(g.items));
    // 83–85 學測一組 5 句、93 學測每句 5 分：可以作答與自評，但不能送 AI 批改。
    expect(translation.filter((g) => !g.ai_gradable).map((g) => g.group_id)).toEqual(
      expect.arrayContaining(['gsat-83.s5g1@1', 'gsat-84.s5g1@1', 'gsat-85.s4g1@1', 'gsat-93.s5g1@1']),
    );
  });

  it('item_id 接受完整格式、label 或題號字串', () => {
    const t = getWritingGroup(TRANSLATION_GROUP)!;
    expect(resolveItemId(t, '2')?.label).toBe('中譯英2');
    expect(resolveItemId(t, '中譯英1')?.no).toBe(1);
    expect(resolveItemId(t, `${TRANSLATION_GROUP}#中譯英2`)?.no).toBe(2);
    expect(resolveItemId(t, '3')).toBeNull();
  });

  it('產生器只挑白名單欄位；輸出含官方譯文或評分原則片段時檢查得到（fail closed）', () => {
    const official = 'An entirely fictional official reference sentence for this unit test.';
    const notes = '評分原則測試：這是一段完全虛構、只用來測試掃描功能的評分原則文字，長度超過三十個字元。';
    const exam = {
      id: 'gsat-999',
      title: '測試卷',
      sections: [
        {
          id: 's1',
          type: 'translation',
          instructions: '說明：測試。',
          groups: [
            {
              id: 's1g1',
              passage: null,
              figures: [],
              questions: [
                { no: 1, label: '1', mode: 'translation', stem: '第一句。', points: 4, answer: official, accepted_answers: [official], scoring_notes: notes },
                { no: 2, label: '2', mode: 'translation', stem: '第二句。', points: 4, answer: official },
              ],
            },
          ],
        },
      ],
    };
    const warnings: string[] = [];
    const groups = extractGroups(exam, warnings);
    expect(groups).toHaveLength(1);
    expect(JSON.stringify(groups)).not.toContain(official);
    expect(JSON.stringify(groups)).not.toContain('scoring_notes');
    const { leaks, bank } = buildBank([exam]);
    expect(leaks).toEqual([]);
    expect(bank.count).toBe(1);
    const { fragments } = restrictedFragments(exam);
    expect(fragments).toContain(official);
    // 有人把譯文塞進輸出時，檢查要抓得到。
    expect(findLeaks(JSON.stringify({ x: `前綴 ${official} 後綴` }), fragments)).toEqual([official]);
    expect(findLeaks(JSON.stringify({ x: notes }), fragments).length).toBeGreaterThan(0);
  });
});
