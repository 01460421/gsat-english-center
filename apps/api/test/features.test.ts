/**
 * 學習助手的開關與公開資訊（docs/design/learning-assistant.md §4.14、§6.2）：
 *   - 公開的 /api/features（不讀 session）只在 AI_ASSISTANT 是 on 時多 assistant（拍照也 on 時多 assistantPhoto）；
 *     admin 模式下匿名、一般學生、管理員拿到的回應都一樣，而且和沒有這個功能時逐字相同（不透露有預覽）；
 *   - 要登入的 /api/me 只對管理員回 assistant_preview（admin 模式；拍照的 admin 模式也算），學生一律沒有；
 *   - assistantAccess：學習助手的端點、/api/ai/quota 的 assist 共用的開關判斷；值不認得一律當成關。
 *   - /api/ai/quota 只在學習助手對這位使用者開放時多 assist（報告與拍照轉錄的今日次數與上限）。
 */
import type { AiQuotaResponse, FeaturesResponse, MeResponseSignedIn } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { AiQueueMessage, Env } from '../src/env';
import { UNLIMITED } from '../src/ai/guard';
import { assistantAccess, assistantPreview } from '../src/features';
import { seedAssistOp } from './helpers/assist';
import { authEnv, call, cookieFor, insertUser, type TestEnv } from './helpers/auth';

/** 登入與 AI 都設定好（有金鑰與 Queue）的 env。 */
function aiEnv(overrides: Partial<Env> = {}): TestEnv {
  return authEnv({ ANTHROPIC_API_KEY: 'sk-ant-test', AI_QUEUE: {} as Queue<AiQueueMessage>, ...overrides });
}

async function features(env: TestEnv, cookie?: string): Promise<{ text: string; body: FeaturesResponse }> {
  const res = await call(env, 'GET', '/api/features', cookie ? { cookie } : {});
  const text = await res.text();
  return { text, body: JSON.parse(text) as FeaturesResponse };
}

async function me(env: TestEnv, user: Parameters<typeof cookieFor>[0]): Promise<MeResponseSignedIn> {
  return (await (await call(env, 'GET', '/api/me', { cookie: await cookieFor(user) })).json()) as MeResponseSignedIn;
}

function quietWarn<T>(fn: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => {};
  return fn().finally(() => {
    console.warn = warn;
  });
}

describe('GET /api/features 的學習助手欄位', () => {
  it('off（程式預設）：沒有 assistant、assistantPhoto；回應和沒有這個功能時相同', async () => {
    const { body } = await features(aiEnv());
    expect(body).toEqual({ auth: true, ai: true, ocr: true, aiPaused: false, customEssay: false });
  });

  it('admin 模式：匿名、一般學生、管理員的 /api/features 都沒有 assistant（公開端點不透露有預覽），回應逐字相同', async () => {
    const env = aiEnv({ AI_ASSISTANT: 'admin', AI_ASSISTANT_PHOTO: 'admin' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const anonymous = await features(env);
    expect(anonymous.body).not.toHaveProperty('assistant');
    expect(anonymous.body).not.toHaveProperty('assistantPhoto');
    expect((await features(env, await cookieFor(student))).text).toBe(anonymous.text);
    expect((await features(env, await cookieFor(admin))).text).toBe(anonymous.text);
    expect(anonymous.text).toBe((await features(aiEnv())).text);
  });

  it('on：assistant: true；拍照也 on 才有 assistantPhoto: true（拍照 admin 時不出現）', async () => {
    expect((await features(aiEnv({ AI_ASSISTANT: 'on' }))).body).toMatchObject({ assistant: true });
    expect((await features(aiEnv({ AI_ASSISTANT: 'on' }))).body).not.toHaveProperty('assistantPhoto');
    expect((await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on' }))).body).toMatchObject({ assistant: true, assistantPhoto: true });
    expect((await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'admin' }))).body).not.toHaveProperty('assistantPhoto');
    // 拍照開關單獨打開沒有用：學習助手本身要是 on。
    expect((await features(aiEnv({ AI_ASSISTANT_PHOTO: 'on' }))).body).not.toHaveProperty('assistantPhoto');
  });

  it('AI 沒設定（缺金鑰）時就算 on 也沒有；打錯的值當成關（fail closed）', async () => {
    const { ANTHROPIC_API_KEY: _k, ...noKey } = aiEnv({ AI_ASSISTANT: 'on' });
    expect((await features(noKey as TestEnv)).body).not.toHaveProperty('assistant');
    for (const value of ['onn', 'true', 'yes', 'ADMIN ', ' On ']) {
      const { body } = await quietWarn(() => features(aiEnv({ AI_ASSISTANT: value })));
      if (value.trim().toLowerCase() === 'on') expect(body, value).toMatchObject({ assistant: true });
      else expect(body, value).not.toHaveProperty('assistant');
    }
  });
});

describe('GET /api/me 的 assistant_preview', () => {
  it('admin 模式：只有管理員有 assistant_preview（photo 依拍照開關）；學生沒有', async () => {
    const env = aiEnv({ AI_ASSISTANT: 'admin', AI_ASSISTANT_PHOTO: 'admin' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    expect((await me(env, admin)).assistant_preview).toEqual({ photo: true });
    expect(await me(env, student)).not.toHaveProperty('assistant_preview');
    const noPhoto = aiEnv({ AI_ASSISTANT: 'admin', AI_ASSISTANT_PHOTO: 'off' });
    const admin2 = insertUser(noPhoto.DB, { role: 'admin', aiStatus: 'approved' });
    expect((await me(noPhoto, admin2)).assistant_preview).toEqual({ photo: false });
  });

  it('off、on（拍照也 on）：誰都沒有 assistant_preview（on 的時候看 /api/features）；未登入是 { user: null }', async () => {
    for (const vars of [{}, { AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on' }]) {
      const env = aiEnv(vars);
      const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
      expect(await me(env, admin), JSON.stringify(vars)).not.toHaveProperty('assistant_preview');
      expect(await (await call(env, 'GET', '/api/me')).json()).toEqual({ user: null });
    }
  });

  it('on＋拍照 admin：管理員多一個 assistant_preview（拍照只有他能用）；學生沒有', async () => {
    const env = aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'admin' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    expect((await me(env, admin)).assistant_preview).toEqual({ photo: true });
    expect(await me(env, student)).not.toHaveProperty('assistant_preview');
  });

  it('AI 沒設定時管理員也沒有（預覽不了）；PATCH /api/me 的回應同樣帶上', async () => {
    const { ANTHROPIC_API_KEY: _k, ...rest } = aiEnv({ AI_ASSISTANT: 'admin' });
    const noKey = rest as TestEnv;
    const admin = insertUser(noKey.DB, { role: 'admin', aiStatus: 'approved' });
    expect(await me(noKey, admin)).not.toHaveProperty('assistant_preview');
    const env = aiEnv({ AI_ASSISTANT: 'admin' });
    const a = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const res = await call(env, 'PATCH', '/api/me', { cookie: await cookieFor(a), json: { display_name: '站主' } });
    expect(((await res.json()) as MeResponseSignedIn).assistant_preview).toEqual({ photo: false });
  });
});

describe('assistantAccess／assistantPreview（開關的規則只寫一份）', () => {
  const config = (vars: Partial<Env>) => loadConfig(aiEnv(vars));
  it('on：所有人；admin：只有管理員；off：沒有人；拍照另外要學習助手本身開放', () => {
    expect(assistantAccess(config({ AI_ASSISTANT: 'on' }), 'student')).toEqual({ enabled: true, photo: false });
    expect(assistantAccess(config({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on' }), null)).toEqual({ enabled: true, photo: true });
    expect(assistantAccess(config({ AI_ASSISTANT: 'admin', AI_ASSISTANT_PHOTO: 'on' }), 'student')).toEqual({ enabled: false, photo: false });
    expect(assistantAccess(config({ AI_ASSISTANT: 'admin', AI_ASSISTANT_PHOTO: 'admin' }), 'admin')).toEqual({ enabled: true, photo: true });
    expect(assistantAccess(config({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'admin' }), 'student')).toEqual({ enabled: true, photo: false });
    expect(assistantAccess(config({}), 'admin')).toEqual({ enabled: false, photo: false });
    expect(assistantAccess(config({ AI_ASSISTANT_PHOTO: 'on' }), 'admin')).toEqual({ enabled: false, photo: false });
  });

  it('assistantPreview 只對管理員、只在有 admin 模式時', () => {
    expect(assistantPreview(config({ AI_ASSISTANT: 'admin' }), 'admin')).toEqual({ photo: false });
    expect(assistantPreview(config({ AI_ASSISTANT: 'admin' }), 'student')).toBeNull();
    expect(assistantPreview(config({ AI_ASSISTANT: 'on' }), 'admin')).toBeNull();
    expect(assistantPreview(config({ AI_ASSISTANT: 'off', AI_ASSISTANT_PHOTO: 'admin' }), 'admin')).toBeNull();
  });
});

describe('GET /api/ai/quota 的 assist', () => {
  async function quota(env: TestEnv, user: Parameters<typeof cookieFor>[0]): Promise<AiQuotaResponse> {
    return (await (await call(env, 'GET', '/api/ai/quota', { cookie: await cookieFor(user) })).json()) as AiQuotaResponse;
  }

  it('off：沒有 assist（task_points 照樣列出全部任務的點數）', async () => {
    const env = aiEnv();
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const body = await quota(env, admin);
    expect(body).not.toHaveProperty('assist');
    expect(body.task_points).toMatchObject({ assist_ocr: 2, assist_analyze: 6, assist_followup: 3, assist_report: 10 });
  });

  it('admin 模式：管理員有 assist（不限次數，已用的照算）；學生沒有', async () => {
    const env = aiEnv({ AI_ASSISTANT: 'admin' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    seedAssistOp(env.DB, admin.id, 'assist_report', crypto.randomUUID());
    expect(await quota(env, student)).not.toHaveProperty('assist');
    expect((await quota(env, admin)).assist).toEqual({ reports: { day_used: 1, day_limit: UNLIMITED }, ocr: { day_used: 0, day_limit: UNLIMITED } });
  });

  it('on：學生有 assist（報告每天 2 份、拍照轉錄 6 次；退還的不算）', async () => {
    const env = aiEnv({ AI_ASSISTANT: 'on' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    seedAssistOp(env.DB, student.id, 'assist_ocr', crypto.randomUUID());
    const refunded = seedAssistOp(env.DB, student.id, 'assist_ocr', crypto.randomUUID());
    env.DB.sqlite.prepare("UPDATE ai_ops SET status = 'refunded', points_charged = 0 WHERE id = ?").run(refunded);
    expect((await quota(env, student)).assist).toEqual({ reports: { day_used: 0, day_limit: 2 }, ocr: { day_used: 1, day_limit: 6 } });
  });
});
