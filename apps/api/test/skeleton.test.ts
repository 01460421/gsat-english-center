/**
 * AI＋登入 MVP 的骨架測試（docs/design/ai-auth-mvp.md）：路由都掛上了、尚未實作的回 501、
 * 公開的 /api/features 只回布林、設定預設值與 wrangler.toml 一致、§6.6 名額與 §6.3 啟動檢查。
 * 各 agent 實作端點後，把對應的「回 501」案例換成真正的行為測試。
 */
import { isApiErrorBody, isFeaturesResponse } from '@gsat/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { autoApprovalCap, CONFIG_DEFAULTS, loadConfig, startupChecks } from '../src/config';
import type { AiQueueMessage, Env } from '../src/env';
import { taiwanDay, taiwanMonth } from '../src/time';

const ORIGIN = 'https://gsat.example';
const baseEnv: Env = { DB: {} as D1Database, ALLOWED_ORIGINS: ORIGIN };

/** 假的 D1：只回應 ai_budget_daily.paused 的查詢。 */
function fakeDb(paused: number | null): D1Database {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => (paused === null ? null : { paused }) }),
    }),
  } as unknown as D1Database;
}

const configuredEnv: Env = {
  ...baseEnv,
  APP_ORIGIN: ORIGIN,
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'x'.repeat(48),
  ANTHROPIC_API_KEY: 'sk-ant-test',
  AI_QUEUE: {} as Queue<AiQueueMessage>,
};

describe('GET /api/features', () => {
  it('什麼都沒設定：全部 false', async () => {
    const res = await app.request('/api/features', {}, baseEnv);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({ auth: false, ai: false, ocr: false, aiPaused: false });
  });

  it('只設定登入：auth true、ai false', async () => {
    const { ANTHROPIC_API_KEY: _k, AI_QUEUE: _q, ...authOnly } = configuredEnv;
    const res = await app.request('/api/features', {}, authOnly);
    expect(await res.json()).toEqual({ auth: true, ai: false, ocr: false, aiPaused: false });
  });

  it('全部設定：讀全站暫停開關；回應只有四個布林、不含任何設定值', async () => {
    const res = await app.request('/api/features', {}, { ...configuredEnv, DB: fakeDb(1) });
    const text = await res.text();
    const body: unknown = JSON.parse(text);
    expect(isFeaturesResponse(body)).toBe(true);
    expect(body).toEqual({ auth: true, ai: true, ocr: true, aiPaused: true });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('sk-ant');
  });

  it('暫停開關查詢失敗（例如遷移未套用）時當成暫停', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const res = await app.request('/api/features', {}, configuredEnv); // DB 是空物件，prepare 會丟錯
      expect(await res.json()).toMatchObject({ ai: true, aiPaused: true });
    } finally {
      console.error = original;
    }
  });
});

describe('骨架路由：全部端點都已實作（不再回 501）', () => {
  // /auth/*、/api/me*、/api/ai/apply、/api/admin/health、/api/admin/users* 已實作（A1；行為測試在 auth／account／admin.test.ts）。
  // 以下是 A2 的端點（行為測試在 ai.*.test.ts、submissions.test.ts）：沒登入時一律 401，而不是 501。
  const cases: Array<[string, string]> = [
    ['GET', '/api/ai/quota'],
    ['POST', '/api/ai/translation-grade'],
    ['POST', '/api/ai/essay-grade'],
    ['POST', '/api/ai/essay-ocr'],
    ['GET', '/api/ai/ops/abc'],
    ['POST', '/api/submissions'],
    ['GET', '/api/submissions'],
    ['GET', '/api/submissions/abc'],
    ['PUT', '/api/submissions/abc'],
    ['DELETE', '/api/submissions/abc'],
    ['POST', '/api/submissions/abc/photos'],
    ['DELETE', '/api/submissions/abc/photos'],
    ['PUT', '/api/submissions/abc/confirm'],
    ['POST', '/api/admin/ai/pause'],
    ['GET', '/api/admin/usage'],
  ];

  it.each(cases)('%s %s', async (method, path) => {
    const res = await app.request(path, { method, headers: { Origin: ORIGIN } }, baseEnv);
    expect(res.status).toBe(401);
    const body: unknown = await res.json();
    expect(isApiErrorBody(body) && body.error.code).toBe('unauthorized');
  });
});

describe('設定（src/config.ts）', () => {
  it('預設值：§6.3 正式開放的數字、名額自動計算＝49', () => {
    const config = loadConfig(baseEnv);
    expect(config.auth.configured).toBe(false);
    expect(config.ai.configured).toBe(false);
    expect(config.ai.limits).toEqual({ pointsUserDay: 30, pointsUserMonth: 300, pointsTrialDay: 10, essayUserDay: 3, concurrentUser: 2 });
    expect(config.ai.budget.siteUsdMonth).toBe(400);
    expect(config.ai.approvalCap).toBe(49);
    expect(config.ai.approvalCapIsAuto).toBe(true);
    expect(config.ai.baseUrl).toBe('https://api.anthropic.com');
    expect(config.ai.models.default).toBe('claude-opus-5-5');
  });

  it('空字串視為沒設；數字格式錯誤時用預設值', () => {
    const original = console.warn;
    console.warn = () => {};
    try {
      const config = loadConfig({ ...configuredEnv, ANTHROPIC_API_KEY: '  ', AI_POINTS_USER_DAY: 'abc', AI_APPROVAL_CAP: '' });
      expect(config.ai.apiKey).toBeNull();
      expect(config.ai.configured).toBe(false);
      expect(config.ai.limits.pointsUserDay).toBe(30);
      expect(config.ai.approvalCapIsAuto).toBe(true);
    } finally {
      console.warn = original;
    }
  });

  it('AI_APPROVAL_CAP 有設就用它', () => {
    expect(loadConfig({ ...baseEnv, AI_APPROVAL_CAP: '10' }).ai.approvalCap).toBe(10);
  });

  it('autoApprovalCap：⌊400 ÷ (300 × 0.19/7)⌋ ＝ 49；分母不合法時 0', () => {
    expect(autoApprovalCap(400, 300)).toBe(49);
    expect(autoApprovalCap(200, 300)).toBe(24);
    expect(autoApprovalCap(400, 0)).toBe(0);
  });

  it('§6.3 啟動檢查：預設值全部通過；校準月份 online 250＋dev 250、站內 200 也通過；online 450＋pipeline 150 不通過', () => {
    expect(startupChecks(loadConfig(baseEnv)).every((c) => c.ok)).toBe(true);
    const calibration = loadConfig({
      ...baseEnv,
      ANTHROPIC_ONLINE_SPEND_LIMIT_USD: '250',
      ANTHROPIC_DEV_SPEND_LIMIT_USD: '250',
      AI_BUDGET_SITE_USD_MONTH: '200',
    });
    expect(startupChecks(calibration).every((c) => c.ok)).toBe(true);
    const bad = startupChecks(loadConfig({ ...baseEnv, ANTHROPIC_PIPELINE_SPEND_LIMIT_USD: '150' }));
    expect(bad.find((c) => c.id === 'workspaces_vs_tier')?.ok).toBe(false);
  });

  it('wrangler.toml 的 [vars] 與 CONFIG_DEFAULTS 一致（避免兩邊預設值走鐘）', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    for (const [name, value] of Object.entries(CONFIG_DEFAULTS)) {
      const m = toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
      expect(m?.[1], `wrangler.toml 缺少或不一致：${name}`).toBe(String(value));
    }
  });
});

describe('台灣日期', () => {
  it('UTC 16:00 已是台灣隔天', () => {
    expect(taiwanDay(Date.parse('2026-10-31T15:59:59Z'))).toBe('2026-10-31');
    expect(taiwanDay(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11-01');
    expect(taiwanMonth(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11');
  });
});
