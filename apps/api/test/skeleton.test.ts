/**
 * AI＋登入 MVP 的骨架測試（docs/design/ai-auth-mvp.md）：路由都掛上了、尚未實作的回 501、
 * 公開的 /api/features 只回布林、設定預設值與 wrangler.toml 一致、§6.6 名額與 §6.3 啟動檢查。
 * 各 agent 實作端點後，把對應的「回 501」案例換成真正的行為測試。
 */
import { isApiErrorBody, isFeaturesResponse } from '@gsat/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { assistantSwitch, autoApprovalCap, CONFIG_DEFAULTS, customEssaySwitch, featureModeSwitch, loadConfig, startupChecks } from '../src/config';
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
    expect(await res.json()).toEqual({ auth: true, ai: false, ocr: false, aiPaused: false, customEssay: false });
  });

  it('全部設定：讀全站暫停開關；回應只有五個布林、不含任何設定值', async () => {
    const res = await app.request('/api/features', {}, { ...configuredEnv, DB: fakeDb(1), AI_CUSTOM_ESSAY: 'on' });
    const text = await res.text();
    const body: unknown = JSON.parse(text);
    expect(isFeaturesResponse(body)).toBe(true);
    expect(body).toEqual({ auth: true, ai: true, ocr: true, aiPaused: true, customEssay: true });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('sk-ant');
  });

  it('customEssay：AI 能用而且 AI_CUSTOM_ESSAY 是 on 才是 true；沒設定時用預設值 off；AI 沒設定時一律 false（docs/design/custom-essay.md §5.3）', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const on = await app.request('/api/features', {}, { ...configuredEnv, DB: fakeDb(0), AI_CUSTOM_ESSAY: 'on' });
      expect(await on.json()).toEqual({ auth: true, ai: true, ocr: true, aiPaused: false, customEssay: true });
      // 評分對照（真模型）通過之前，正式環境的預設是關：[vars] 漏設時也不會開。
      const unset = await app.request('/api/features', {}, { ...configuredEnv, DB: fakeDb(0) });
      expect(await unset.json()).toEqual({ auth: true, ai: true, ocr: true, aiPaused: false, customEssay: false });
      const off = await app.request('/api/features', {}, { ...configuredEnv, DB: fakeDb(0), AI_CUSTOM_ESSAY: 'off' });
      expect(await off.json()).toMatchObject({ ai: true, customEssay: false });
      const typo = await app.request('/api/features', {}, { ...configuredEnv, DB: fakeDb(0), AI_CUSTOM_ESSAY: 'onn' });
      expect(await typo.json()).toMatchObject({ ai: true, customEssay: false });
      const { ANTHROPIC_API_KEY: _k, ...noAi } = configuredEnv;
      const res = await app.request('/api/features', {}, { ...noAi, AI_CUSTOM_ESSAY: 'on' });
      expect(await res.json()).toMatchObject({ ai: false, customEssay: false });
    } finally {
      console.warn = warn;
    }
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

  it('AI_CUSTOM_ESSAY 的解析是 fail closed：沒設、空字串、只有空白用預設值 off；去頭尾空白、不分大小寫等於 on 才開，其他一律關並寫 log（S5）', () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      for (const v of ['on', 'ON', ' on ', 'On']) expect(loadConfig({ ...baseEnv, AI_CUSTOM_ESSAY: v }).ai.customEssay, JSON.stringify(v)).toBe(true);
      expect(warnings).toEqual([]);
      for (const v of [undefined, '', '   ', 'off', 'Off']) expect(loadConfig({ ...baseEnv, AI_CUSTOM_ESSAY: v }).ai.customEssay, JSON.stringify(v)).toBe(false);
      expect(warnings).toEqual([]);
      for (const v of ['false', '0', 'yes', 'onn', 'true', '1']) expect(loadConfig({ ...baseEnv, AI_CUSTOM_ESSAY: v }).ai.customEssay, v).toBe(false);
      expect(warnings).toHaveLength(6);
      // 預設值是參數：之後預設改回 on 時，沒設、空白也要跟著開（解析規則本身不變）。
      for (const v of [undefined, '', '   ']) expect(customEssaySwitch(v, 'on'), JSON.stringify(v)).toBe(true);
      expect(customEssaySwitch('off', 'on')).toBe(false);
      expect(customEssaySwitch('onn', 'on')).toBe(false);
    } finally {
      console.warn = warn;
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

  it('wrangler.toml 的 [vars] 與 CONFIG_DEFAULTS 一致（避免兩邊預設值走鐘；AI_CUSTOM_ESSAY、AI_ASSISTANT、AI_ASSISTANT_PHOTO、AI_ESSAY_EXEMPLARS、AI_ASSISTANT_SUBJECTS、AI_ASSISTANT_SUBJECTS_PHOTO、AI_ZH_EXEMPLAR 例外，見下面的測試）', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const exceptions = ['AI_CUSTOM_ESSAY', 'AI_ASSISTANT', 'AI_ASSISTANT_PHOTO', 'AI_ESSAY_EXEMPLARS', 'AI_ASSISTANT_SUBJECTS', 'AI_ASSISTANT_SUBJECTS_PHOTO', 'AI_ZH_EXEMPLAR'];
    for (const [name, value] of Object.entries(CONFIG_DEFAULTS)) {
      if (exceptions.includes(name)) continue;
      const m = toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
      expect(m?.[1], `wrangler.toml 缺少或不一致：${name}`).toBe(String(value));
    }
  });

  it('AI_CUSTOM_ESSAY：程式預設固定是 off（[vars] 漏設時偏向關）；wrangler.toml 明確寫 "on" 或 "off"，站主只改這一行就能開關', () => {
    // 評分對照（docs/design/custom-essay.md §7.8）通過之前 wrangler.toml 是 "off"；達標後只把那一行改成 "on"
    // （docs/SETUP-KEYS.md §8.2），出問題時再改回 "off"（§8.1）。兩個方向都只改一行，部署前的測試不會擋。
    expect(CONFIG_DEFAULTS.AI_CUSTOM_ESSAY).toBe('off');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const m = toml.match(/^AI_CUSTOM_ESSAY\s*=\s*"([^"]*)"/m);
    expect(m?.[1], 'wrangler.toml 的 [vars] 要明確寫 AI_CUSTOM_ESSAY = "on" 或 "off"').toMatch(/^(on|off)$/);
  });

  it('AI_ASSISTANT、AI_ASSISTANT_PHOTO：程式預設固定是 off；wrangler.toml 明確寫 "off"、"admin" 或 "on"（docs/design/learning-assistant.md §4.14）', () => {
    // 目前是 on（2026-10-23 上線）；緊急關閉（off）或只留給管理員（admin）都只改 wrangler.toml 那一行，部署前的測試
    // 不擋任何一種，所以這裡不把值寫死。漏設時偏向關。SITE_DATA_ORIGIN 選填、不在 [vars]。
    expect(CONFIG_DEFAULTS.AI_ASSISTANT).toBe('off');
    expect(CONFIG_DEFAULTS.AI_ASSISTANT_PHOTO).toBe('off');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    for (const name of ['AI_ASSISTANT', 'AI_ASSISTANT_PHOTO']) {
      const m = toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'));
      expect(m?.[1], `wrangler.toml 的 [vars] 要明確寫 ${name} = "off"、"admin" 或 "on"`).toMatch(/^(off|admin|on)$/);
    }
    expect(toml).not.toMatch(/^SITE_DATA_ORIGIN\s*=/m);
    const config = loadConfig(baseEnv);
    expect(config.ai.assistant).toBe('off');
    expect(config.ai.assistantPhoto).toBe('off');
    expect(config.ai.effort).toMatchObject({ assist: 'medium', chat: 'low' });
  });

  it('學習助手的開關是 fail closed：沒設、空白用預設值 off；去頭尾空白、不分大小寫只認 on、admin，其他一律關並寫 log', () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      for (const v of ['on', 'ON', ' on ']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT: v }).ai.assistant, v).toBe('on');
      for (const v of ['admin', 'Admin', ' ADMIN ']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT_PHOTO: v }).ai.assistantPhoto, v).toBe('admin');
      for (const v of [undefined, '', '   ', 'off', 'OFF']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT: v }).ai.assistant, JSON.stringify(v)).toBe('off');
      expect(warnings).toEqual([]);
      for (const v of ['true', '1', 'yes', 'onn', 'admins']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT: v }).ai.assistant, v).toBe('off');
      expect(warnings).toHaveLength(5);
      // 預設值是參數：解析規則本身不變。
      expect(assistantSwitch('AI_ASSISTANT', undefined, 'admin')).toBe('admin');
      expect(assistantSwitch('AI_ASSISTANT_PHOTO', 'onn', 'on')).toBe('off');
    } finally {
      console.warn = warn;
    }
  });

  it('AI_ASSISTANT_SUBJECTS、AI_ASSISTANT_SUBJECTS_PHOTO：程式預設固定是 off；wrangler.toml 明確寫 "off"、"admin" 或 "on"（docs/design/assistant-subjects.md §7.5）', () => {
    // 目前是 on（2026-10-30 上線）；緊急關閉（off）、只關國文拍照、只留給管理員（admin）都只改 wrangler.toml 那一行，
    // 部署前的測試不擋任何一種，所以這裡不把值寫死（同學習助手的測試）。漏設時偏向關。
    expect(CONFIG_DEFAULTS.AI_ASSISTANT_SUBJECTS).toBe('off');
    expect(CONFIG_DEFAULTS.AI_ASSISTANT_SUBJECTS_PHOTO).toBe('off');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    for (const name of ['AI_ASSISTANT_SUBJECTS', 'AI_ASSISTANT_SUBJECTS_PHOTO']) {
      expect(toml.match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm'))?.[1], `wrangler.toml 的 [vars] 要明確寫 ${name} = "off"、"admin" 或 "on"`).toMatch(/^(off|admin|on)$/);
    }
    // 國文不需要新的 secret（短答比對的雜湊不帶金鑰）：wrangler.toml 沒有任何國文 D8 的金鑰設定。
    expect(toml).not.toMatch(/D8_ZH|ZH_D8_KEY/);
    const config = loadConfig(baseEnv);
    expect([config.ai.assistantSubjects, config.ai.assistantSubjectsPhoto]).toEqual(['off', 'off']);
    for (const v of ['on', 'ON', ' on ']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT_SUBJECTS: v }).ai.assistantSubjects, v).toBe('on');
    for (const v of ['admin', ' Admin ']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT_SUBJECTS_PHOTO: v }).ai.assistantSubjectsPhoto, v).toBe('admin');
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const v of ['true', 'onn', 'yes']) expect(loadConfig({ ...baseEnv, AI_ASSISTANT_SUBJECTS: v }).ai.assistantSubjects, v).toBe('off');
    } finally {
      console.warn = warn;
    }
  });

  it('AI_ZH_EXEMPLAR：程式預設固定是 off；wrangler.toml 明確寫 "off"、"admin" 或 "on"（國寫範文設計 §7）；fail closed，不影響其他開關', () => {
    // 後端先以 "off" 合併，前端完成後改成 "on"；緊急關閉或只留給管理員都只改 wrangler.toml 那一行，部署前的測試不擋任何一種。
    expect(CONFIG_DEFAULTS.AI_ZH_EXEMPLAR).toBe('off');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml.match(/^AI_ZH_EXEMPLAR\s*=\s*"([^"]*)"/m)?.[1], 'wrangler.toml 的 [vars] 要明確寫 AI_ZH_EXEMPLAR = "off"、"admin" 或 "on"').toMatch(/^(off|admin|on)$/);
    expect(loadConfig(baseEnv).ai.zhExemplar).toBe('off');
    for (const v of ['on', ' ON ']) expect(loadConfig({ ...baseEnv, AI_ZH_EXEMPLAR: v }).ai.zhExemplar, v).toBe('on');
    expect(loadConfig({ ...baseEnv, AI_ZH_EXEMPLAR: 'Admin' }).ai.zhExemplar).toBe('admin');
    const warn = console.warn;
    console.warn = () => {};
    try {
      for (const v of ['true', 'onn', 'yes']) expect(loadConfig({ ...baseEnv, AI_ZH_EXEMPLAR: v }).ai.zhExemplar, v).toBe('off');
    } finally {
      console.warn = warn;
    }
    const mixed = loadConfig({ ...baseEnv, AI_ZH_EXEMPLAR: 'on' });
    expect([mixed.ai.assistantSubjects, mixed.ai.essayExemplars]).toEqual(['off', 'off']);
  });

  it('AI_ESSAY_EXEMPLARS：程式預設固定是 off；wrangler.toml 明確寫 "off"、"admin" 或 "on"（docs/design/model-essays.md §7.5）；effort 兩邊都是 medium', () => {
    // 目前是 on（2026-10-30 上線）；緊急關閉（off）或只留給管理員（admin）都只改 wrangler.toml 那一行，部署前的測試
    // 不擋任何一種，所以這裡不把值寫死（同上面學習助手的測試）。漏設時偏向關。
    expect(CONFIG_DEFAULTS.AI_ESSAY_EXEMPLARS).toBe('off');
    expect(CONFIG_DEFAULTS.AI_EFFORT_EXEMPLARS).toBe('medium');
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml.match(/^AI_ESSAY_EXEMPLARS\s*=\s*"([^"]*)"/m)?.[1], 'wrangler.toml 的 [vars] 要明確寫 AI_ESSAY_EXEMPLARS = "off"、"admin" 或 "on"').toMatch(/^(off|admin|on)$/);
    expect(toml.match(/^AI_EFFORT_EXEMPLARS\s*=\s*"([^"]*)"/m)?.[1]).toBe('medium');
    const config = loadConfig(baseEnv);
    expect(config.ai.essayExemplars).toBe('off');
    expect(config.ai.effort.exemplars).toBe('medium');
    expect(loadConfig({ ...baseEnv, AI_EFFORT_EXEMPLARS: 'low' }).ai.effort.exemplars).toBe('low');
  });

  it('作文範文的開關是 fail closed（同學習助手）：沒設、空白用預設值 off；只認 on、admin，其他一律關並寫 log；featureModeSwitch 三個開關共用', () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      for (const v of ['on', 'ON', ' on ']) expect(loadConfig({ ...baseEnv, AI_ESSAY_EXEMPLARS: v }).ai.essayExemplars, v).toBe('on');
      for (const v of ['admin', 'Admin', ' ADMIN ']) expect(loadConfig({ ...baseEnv, AI_ESSAY_EXEMPLARS: v }).ai.essayExemplars, v).toBe('admin');
      for (const v of [undefined, '', '   ', 'off', 'OFF']) expect(loadConfig({ ...baseEnv, AI_ESSAY_EXEMPLARS: v }).ai.essayExemplars, JSON.stringify(v)).toBe('off');
      expect(warnings).toEqual([]);
      for (const v of ['true', '1', 'yes', 'onn', 'admins']) expect(loadConfig({ ...baseEnv, AI_ESSAY_EXEMPLARS: v }).ai.essayExemplars, v).toBe('off');
      expect(warnings).toHaveLength(5);
      expect(String((warnings[0] as unknown[])[0])).toContain('AI_ESSAY_EXEMPLARS');
      // 範文的開關不影響學習助手的兩個開關（反過來也是）。
      const mixed = loadConfig({ ...baseEnv, AI_ESSAY_EXEMPLARS: 'on', AI_ASSISTANT: 'off' });
      expect([mixed.ai.essayExemplars, mixed.ai.assistant, mixed.ai.assistantPhoto]).toEqual(['on', 'off', 'off']);
      // 舊名 assistantSwitch 和 featureModeSwitch 同一條規則。
      for (const v of [undefined, 'on', 'admin', 'onn']) expect(assistantSwitch('AI_ASSISTANT', v)).toBe(featureModeSwitch('AI_ASSISTANT', v));
      expect(featureModeSwitch('AI_ESSAY_EXEMPLARS', undefined, 'admin')).toBe('admin');
    } finally {
      console.warn = warn;
    }
  });

  it('SITE_DATA_ORIGIN 選填：沒設等於 APP_ORIGIN（去掉結尾斜線）；有設就用它', () => {
    expect(loadConfig({ ...baseEnv, APP_ORIGIN: 'https://app.example/' }).urls.siteDataOrigin).toBe('https://app.example');
    expect(loadConfig({ ...baseEnv, APP_ORIGIN: 'https://app.example', SITE_DATA_ORIGIN: 'http://127.0.0.1:4599/' }).urls.siteDataOrigin).toBe('http://127.0.0.1:4599');
    expect(loadConfig(baseEnv).urls.siteDataOrigin).toBeNull();
  });
});

describe('台灣日期', () => {
  it('UTC 16:00 已是台灣隔天', () => {
    expect(taiwanDay(Date.parse('2026-10-31T15:59:59Z'))).toBe('2026-10-31');
    expect(taiwanDay(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11-01');
    expect(taiwanMonth(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11');
  });
});
