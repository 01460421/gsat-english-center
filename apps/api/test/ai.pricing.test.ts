/**
 * 計價（docs/design/learning-assistant.md §4.16；§6.2 ai.pricing.test.ts）：
 *   - server-side fallback 的接手模型在價格表（FALLBACK_MODEL_PRICING）裡、單價完整，但不能直接設成 AI_MODEL_* 呼叫；
 *   - usage 裡有不認得的模型（price_pending）時，那一筆改用這個操作的預扣額入帳（加在其他嘗試照實算的成本上），
 *     全站預算也照這個數字累加，並寫 ops 事件 price_pending。
 */
import { describe, expect, it } from 'vitest';
import { buildClaudeRequest, ModelNotAllowedError } from '../src/ai/client';
import { createQueueHandler } from '../src/ai/consumer';
import { costOfUsage, FALLBACK_MODEL_PRICING, isPricedModel, MODEL_PRICING, pricingOf, PRICING_VERSION, usagePricingOf } from '../src/ai/pricing';
import { translationCallInput } from '../src/ai/requests';
import { taskConfig } from '../src/ai/tasks';
import { getWritingGroup } from '../src/ai/bank';
import { loadConfig } from '../src/config';
import { FakeAnthropic, frameworkOf, sseResponse } from './helpers/anthropic';
import { batchOf, call, makeEnv, makeMessage, noopCtx, seedUser, STUDENT_TRANSLATION, TRANSLATION_GROUP, translationAnalyticOutput, translationHolisticOutput } from './helpers/ai';

/** 官方價目（美元／百萬 tokens）→ 每 token 奈美元。 */
const perToken = (usd: number) => Math.round(usd * 1000);
/** 設定的預設模型（測試的假回應用它當第一次嘗試；單價見 MODEL_PRICING）。 */
const DEFAULT_MODEL = loadConfig(makeEnv()).ai.models.default;

describe('接手模型的單價', () => {
  it('每一個接手模型都有完整的整數單價（輸入 5、輸出 25、5 分鐘寫入 6.25、1 小時寫入 10、讀取 0.5、批次 2.5／12.5 美元）', () => {
    expect(Object.keys(FALLBACK_MODEL_PRICING).length).toBeGreaterThan(0);
    for (const [model, p] of Object.entries(FALLBACK_MODEL_PRICING)) {
      for (const v of Object.values(p.base)) expect(Number.isInteger(v), model).toBe(true);
      expect(p.base).toEqual({
        input: perToken(5),
        output: perToken(25),
        cacheWrite5m: perToken(6.25),
        cacheWrite1h: perToken(10),
        cacheRead: perToken(0.5),
        batchInput: perToken(2.5),
        batchOutput: perToken(12.5),
      });
      expect(usagePricingOf(model)).toBe(p);
    }
    expect(PRICING_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('接手模型只用來計價：不在可呼叫的價格表、pricingOf 回 null、設成 AI_MODEL_* 時組請求就拒絕', async () => {
    for (const model of Object.keys(FALLBACK_MODEL_PRICING)) {
      expect(isPricedModel(model)).toBe(false);
      expect(Object.hasOwn(MODEL_PRICING, model)).toBe(false);
      expect(pricingOf(model)).toBeNull();
    }
    const env = makeEnv();
    const group = getWritingGroup(TRANSLATION_GROUP);
    expect(group).not.toBeNull();
    const tc = taskConfig('translation_grade', loadConfig(env));
    const input = translationCallInput(tc, 'primary', group!, STUDENT_TRANSLATION);
    const model = Object.keys(FALLBACK_MODEL_PRICING)[0]!;
    await expect(buildClaudeRequest({ ...input, spec: { ...input.spec, model } })).rejects.toBeInstanceOf(ModelNotAllowedError);
  });

  it('usage.iterations 裡的接手模型照它的單價計價，不是 price_pending', () => {
    const model = Object.keys(FALLBACK_MODEL_PRICING)[0]!;
    const cost = costOfUsage([
      { model: DEFAULT_MODEL, inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
      { model, inputTokens: 1_200, outputTokens: 800, cacheReadTokens: 1_000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 100 },
    ]);
    // 預設模型 1000×輸入＋200×輸出；接手 1200×5＋800×25＋1000×0.5＋100×10＝27,500（奈美元／1000）
    const first = MODEL_PRICING[DEFAULT_MODEL]!.base;
    expect(cost).toMatchObject({ costMicros: Math.ceil((1_000 * first.input + 200 * first.output) / 1000) + 27_500, pricePending: false, attempts: 2 });
  });
});

describe('price_pending 入帳', () => {
  async function gradeWithIterations(fallbackModel: string) {
    const env = makeEnv();
    const user = seedUser(env.DB);
    const created = await call(env, user, 'POST', '/api/submissions', {
      kind: 'translation',
      group_id: TRANSLATION_GROUP,
      input_mode: 'typed',
      body: { items: STUDENT_TRANSLATION.map((text, i) => ({ item_id: String(i + 1), text })) },
    });
    const queued = await call(env, user, 'POST', '/api/ai/translation-grade', { submission_id: created.body.id });
    expect(queued.status).toBe(202);
    const zeroCache = { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } };
    const iterations = [
      { type: 'message', model: DEFAULT_MODEL, input_tokens: 1_000, output_tokens: 200, ...zeroCache },
      { type: 'fallback_message', model: fallbackModel, input_tokens: 1_200, output_tokens: 800, ...zeroCache },
    ];
    const fake: FakeAnthropic = new FakeAnthropic((req) =>
      frameworkOf(req) === 'analytic'
        ? sseResponse(JSON.stringify(translationAnalyticOutput()), { midStreamFallback: { at: 40, from: DEFAULT_MODEL, to: fallbackModel, mode: 'restart' }, iterations })
        : fake.json(translationHolisticOutput()),
    );
    const log = console.log;
    console.log = () => {};
    try {
      await createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks', [makeMessage(env.AI_QUEUE.sent[0]!)]), env, noopCtx);
    } finally {
      console.log = log;
    }
    const op = env.DB.sqlite.prepare('SELECT status, usd_reserved_micros, usd_actual_micros FROM ai_ops WHERE id = ?').get(queued.body.op_id) as Record<string, number | string>;
    const primary = env.DB.sqlite.prepare(`SELECT cost_micros, price_pending FROM ai_calls WHERE role = 'primary'`).get() as { cost_micros: number; price_pending: number };
    const total = env.DB.sqlite.prepare('SELECT SUM(cost_micros) AS s FROM ai_calls').get() as { s: number };
    const budget = env.DB.sqlite.prepare('SELECT online_usd_micros FROM ai_budget_daily').get() as { online_usd_micros: number };
    const events = env.DB.sqlite.prepare(`SELECT detail_json FROM ops_events WHERE kind = 'price_pending'`).all() as Array<{ detail_json: string }>;
    return { op, primary, total: total.s, budget: budget.online_usd_micros, events };
  }

  it('已知的接手模型：照實計價、不標 price_pending、沒有告警', async () => {
    const r = await gradeWithIterations(Object.keys(FALLBACK_MODEL_PRICING)[0]!);
    // 第一次嘗試＋接手 1200×5＋800×25＝26,000
    const first = MODEL_PRICING[DEFAULT_MODEL]!.base;
    expect(r.primary).toEqual({ cost_micros: Math.ceil((1_000 * first.input + 200 * first.output) / 1000) + 26_000, price_pending: 0 });
    expect(r.events).toEqual([]);
    expect(r.op.usd_actual_micros).toBe(r.total);
  });

  it('不認得的模型：那一筆改用操作的預扣額入帳（加在照實算的那一筆上），整列標 price_pending、寫告警；實際成本與全站預算都用這個數字', async () => {
    const r = await gradeWithIterations('claude-unknown-9');
    expect(r.op.status).toBe('settled');
    const reserved = r.op.usd_reserved_micros as number;
    expect(reserved).toBeGreaterThan(0);
    const first = MODEL_PRICING[DEFAULT_MODEL]!.base;
    expect(r.primary).toEqual({ cost_micros: Math.ceil((1_000 * first.input + 200 * first.output) / 1000) + reserved, price_pending: 1 });
    expect(r.op.usd_actual_micros).toBe(r.total);
    expect(r.budget).toBe(r.total);
    expect(r.events).toHaveLength(1);
    expect(JSON.parse(r.events[0]!.detail_json)).toMatchObject({ served_model: 'claude-unknown-9' });
  });
});
