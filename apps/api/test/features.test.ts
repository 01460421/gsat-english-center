/**
 * 學習助手的開關與公開資訊（docs/design/learning-assistant.md §4.14、§6.2）：
 *   - 公開的 /api/features（不讀 session）只在 AI_ASSISTANT 是 on 時多 assistant（拍照也 on 時多 assistantPhoto）；
 *     admin 模式下匿名、一般學生、管理員拿到的回應都一樣，而且和沒有這個功能時逐字相同（不透露有預覽）；
 *   - 要登入的 /api/me 只對管理員回 assistant_preview（admin 模式；拍照的 admin 模式也算），學生一律沒有；
 *   - assistantAccess：學習助手的端點、/api/ai/quota 的 assist 共用的開關判斷；值不認得一律當成關。
 *   - /api/ai/quota 只在學習助手對這位使用者開放時多 assist（報告與拍照轉錄的今日次數與上限）。
 * 作文範文的開關（docs/design/model-essays.md §7.5）同樣三態：/api/features 只在 on 時多 essayExemplars；/api/me 只對管理員回
 * exemplars_preview（admin 模式）；exemplarsAccess 是共用的判斷。
 */
import type { AiQuotaResponse, FeaturesResponse, MeResponseSignedIn } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { AiQueueMessage, Env } from '../src/env';
import { UNLIMITED } from '../src/ai/guard';
import { assistantAccess, assistantPreview, exemplarsAccess, exemplarsPreview } from '../src/features';
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

describe('作文範文的開關（AI_ESSAY_EXEMPLARS；docs/design/model-essays.md §7.5）', () => {
  it('/api/features：off（程式預設）沒有 essayExemplars，回應和沒有這個功能時逐字相同', async () => {
    const off = await features(aiEnv());
    expect(off.body).not.toHaveProperty('essayExemplars');
    expect(off.body).toEqual({ auth: true, ai: true, ocr: true, aiPaused: false, customEssay: false });
    expect((await features(aiEnv({ AI_ESSAY_EXEMPLARS: 'off' }))).text).toBe(off.text);
    // 學習助手開著時也一樣：範文的開關只在 on 時加一個欄位。
    const assistOn = await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on' }));
    expect(assistOn.body).toEqual({ auth: true, ai: true, ocr: true, aiPaused: false, customEssay: false, assistant: true, assistantPhoto: true });
  });

  it('/api/features：admin 模式時匿名、學生、管理員拿到的回應都一樣，而且和 off 逐字相同（公開端點不透露有預覽）', async () => {
    const env = aiEnv({ AI_ESSAY_EXEMPLARS: 'admin' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const anonymous = await features(env);
    expect(anonymous.body).not.toHaveProperty('essayExemplars');
    expect((await features(env, await cookieFor(student))).text).toBe(anonymous.text);
    expect((await features(env, await cookieFor(admin))).text).toBe(anonymous.text);
    expect(anonymous.text).toBe((await features(aiEnv())).text);
  });

  it('/api/features：on 時 essayExemplars: true；AI 沒設定時就算 on 也沒有；打錯的值當成關', async () => {
    expect((await features(aiEnv({ AI_ESSAY_EXEMPLARS: 'on' }))).body).toMatchObject({ essayExemplars: true });
    const { ANTHROPIC_API_KEY: _k, ...noKey } = aiEnv({ AI_ESSAY_EXEMPLARS: 'on' });
    expect((await features(noKey as TestEnv)).body).not.toHaveProperty('essayExemplars');
    for (const value of ['onn', 'true', 'yes', ' On ']) {
      const { body } = await quietWarn(() => features(aiEnv({ AI_ESSAY_EXEMPLARS: value })));
      if (value.trim().toLowerCase() === 'on') expect(body, value).toMatchObject({ essayExemplars: true });
      else expect(body, value).not.toHaveProperty('essayExemplars');
    }
  });

  it('/api/me：admin 模式只有管理員有 exemplars_preview: true；學生、off、on、AI 沒設定時都沒有', async () => {
    const env = aiEnv({ AI_ESSAY_EXEMPLARS: 'admin' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    expect((await me(env, admin)).exemplars_preview).toBe(true);
    expect(await me(env, student)).not.toHaveProperty('exemplars_preview');
    // 學習助手的預覽與範文的預覽各自獨立。
    expect(await me(env, admin)).not.toHaveProperty('assistant_preview');
    const both = aiEnv({ AI_ESSAY_EXEMPLARS: 'admin', AI_ASSISTANT: 'admin' });
    const admin2 = insertUser(both.DB, { role: 'admin', aiStatus: 'approved' });
    expect(await me(both, admin2)).toMatchObject({ exemplars_preview: true, assistant_preview: { photo: false } });
    for (const vars of [{}, { AI_ESSAY_EXEMPLARS: 'off' }, { AI_ESSAY_EXEMPLARS: 'on' }]) {
      const e = aiEnv(vars);
      const a = insertUser(e.DB, { role: 'admin', aiStatus: 'approved' });
      expect(await me(e, a), JSON.stringify(vars)).not.toHaveProperty('exemplars_preview');
    }
    const { ANTHROPIC_API_KEY: _k, ...rest } = aiEnv({ AI_ESSAY_EXEMPLARS: 'admin' });
    const noKey = rest as TestEnv;
    const a3 = insertUser(noKey.DB, { role: 'admin', aiStatus: 'approved' });
    expect(await me(noKey, a3)).not.toHaveProperty('exemplars_preview');
  });

  it('/api/me：off 時管理員與學生的回應和這個功能加上之前相同（沒有多任何欄位）', async () => {
    const env = aiEnv();
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const body = await me(env, admin);
    expect(Object.keys(body).sort()).toEqual(['consent_versions', 'login_at', 'onboarded', 'pending_ai_consents', 'pending_consents', 'user']);
  });

  it('exemplarsAccess／exemplarsPreview：on 所有人；admin 只有管理員；off 沒有人；AI 沒設定時沒有人', () => {
    const config = (vars: Partial<Env>) => loadConfig(aiEnv(vars));
    expect(exemplarsAccess(config({ AI_ESSAY_EXEMPLARS: 'on' }), 'student')).toEqual({ enabled: true });
    expect(exemplarsAccess(config({ AI_ESSAY_EXEMPLARS: 'on' }), null)).toEqual({ enabled: true });
    expect(exemplarsAccess(config({ AI_ESSAY_EXEMPLARS: 'admin' }), 'student')).toEqual({ enabled: false });
    expect(exemplarsAccess(config({ AI_ESSAY_EXEMPLARS: 'admin' }), null)).toEqual({ enabled: false });
    expect(exemplarsAccess(config({ AI_ESSAY_EXEMPLARS: 'admin' }), 'admin')).toEqual({ enabled: true });
    expect(exemplarsAccess(config({}), 'admin')).toEqual({ enabled: false });
    // 學習助手的開關不影響範文。
    expect(exemplarsAccess(config({ AI_ASSISTANT: 'on' }), 'admin')).toEqual({ enabled: false });
    const { ANTHROPIC_API_KEY: _k, ...noKey } = aiEnv({ AI_ESSAY_EXEMPLARS: 'on' });
    expect(exemplarsAccess(loadConfig(noKey as TestEnv), 'admin')).toEqual({ enabled: false });
    expect(exemplarsPreview(config({ AI_ESSAY_EXEMPLARS: 'admin' }), 'admin')).toBe(true);
    expect(exemplarsPreview(config({ AI_ESSAY_EXEMPLARS: 'admin' }), 'student')).toBe(false);
    expect(exemplarsPreview(config({ AI_ESSAY_EXEMPLARS: 'on' }), 'admin')).toBe(false);
    expect(exemplarsPreview(config({}), 'admin')).toBe(false);
  });

  it('/api/ai/quota：task_points 列出作文範文的點數；開關關著時沒有 exemplars，其他欄位照舊', async () => {
    const env = aiEnv();
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    const body = (await (await call(env, 'GET', '/api/ai/quota', { cookie: await cookieFor(student) })).json()) as AiQuotaResponse;
    expect(body.task_points.essay_exemplars).toBe(8);
    expect(body).not.toHaveProperty('exemplars');
    expect(body).not.toHaveProperty('assist');
  });
});

describe('學習助手英文以外的科目（AI_ASSISTANT_SUBJECTS、AI_ASSISTANT_SUBJECTS_PHOTO；docs/design/assistant-subjects.md §7.2、§7.5）', () => {
  it('/api/features：只在 AI_ASSISTANT 與 AI_ASSISTANT_SUBJECTS 都是 on 時有 assistantSubjects；photo 要兩個拍照開關都 on；off、admin 時回應逐字相同', async () => {
    const base = await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on' }));
    expect(base.body).not.toHaveProperty('assistantSubjects');
    for (const mode of ['off', 'admin', 'onn']) {
      expect((await quietWarn(() => features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: mode })))).text, mode).toBe(base.text);
    }
    expect((await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'on' }))).body.assistantSubjects).toEqual([{ subject: 'chinese', photo: false }]);
    expect((await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'on', AI_ASSISTANT_SUBJECTS_PHOTO: 'on' }))).body.assistantSubjects).toEqual([{ subject: 'chinese', photo: true }]);
    // 國文拍照另外要英文的拍照開關。
    expect((await features(aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'off', AI_ASSISTANT_SUBJECTS: 'on', AI_ASSISTANT_SUBJECTS_PHOTO: 'on' }))).body.assistantSubjects).toEqual([{ subject: 'chinese', photo: false }]);
    // 學習助手本身沒開：國文開著也沒有。
    expect((await features(aiEnv({ AI_ASSISTANT: 'admin', AI_ASSISTANT_SUBJECTS: 'on' }))).body).not.toHaveProperty('assistantSubjects');
  });

  it('assistantSubjectAccess：英文就是 assistantAccess；國文要學習助手本身開放、admin 只有管理員；拍照另外要兩個拍照開關', async () => {
    const { assistantSubjectAccess } = await import('../src/features');
    const cfg = (vars: Partial<Env>) => loadConfig(aiEnv(vars));
    const on = cfg({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'on', AI_ASSISTANT_SUBJECTS_PHOTO: 'on' });
    expect(assistantSubjectAccess(on, 'student', 'chinese')).toEqual({ enabled: true, photo: true });
    expect(assistantSubjectAccess(on, 'student', 'english')).toEqual(assistantAccess(on, 'student'));
    const admin = cfg({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'admin', AI_ASSISTANT_SUBJECTS_PHOTO: 'on' });
    expect(assistantSubjectAccess(admin, 'student', 'chinese')).toEqual({ enabled: false, photo: false });
    expect(assistantSubjectAccess(admin, 'admin', 'chinese')).toEqual({ enabled: true, photo: true });
    expect(assistantSubjectAccess(admin, null, 'chinese')).toEqual({ enabled: false, photo: false });
    const noBase = cfg({ AI_ASSISTANT: 'off', AI_ASSISTANT_SUBJECTS: 'on' });
    expect(assistantSubjectAccess(noBase, 'admin', 'chinese').enabled).toBe(false);
    const noPhoto = cfg({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'on', AI_ASSISTANT_SUBJECTS_PHOTO: 'off' });
    expect(assistantSubjectAccess(noPhoto, 'student', 'chinese')).toEqual({ enabled: true, photo: false });
  });

  it('/api/me：國文是 admin 模式時管理員的 assistant_preview 多 subjects；學生沒有；科目都是 off 或 on 時沒有 subjects（回應和以前相同）', async () => {
    const env = aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'admin', AI_ASSISTANT_SUBJECTS_PHOTO: 'admin' });
    const admin = insertUser(env.DB, { role: 'admin', aiStatus: 'approved' });
    const student = insertUser(env.DB, { aiStatus: 'approved' });
    expect((await me(env, admin)).assistant_preview).toEqual({ photo: true, subjects: [{ subject: 'chinese', photo: true }] });
    expect(await me(env, student)).not.toHaveProperty('assistant_preview');
    // 國文開放、只有國文拍照是 admin：管理員的 subjects 和公開的不同（拍照只有他能用）。
    const photoAdmin = aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: 'on', AI_ASSISTANT_SUBJECTS_PHOTO: 'admin' });
    const admin2 = insertUser(photoAdmin.DB, { role: 'admin', aiStatus: 'approved' });
    expect((await me(photoAdmin, admin2)).assistant_preview).toEqual({ photo: true, subjects: [{ subject: 'chinese', photo: true }] });
    for (const mode of ['off', 'on'] as const) {
      const e = aiEnv({ AI_ASSISTANT: 'on', AI_ASSISTANT_PHOTO: 'on', AI_ASSISTANT_SUBJECTS: mode, AI_ASSISTANT_SUBJECTS_PHOTO: mode });
      const a = insertUser(e.DB, { role: 'admin', aiStatus: 'approved' });
      expect(await me(e, a), mode).not.toHaveProperty('assistant_preview');
    }
    // 學習助手本身是 admin、國文 off：和以前一樣只有 { photo }。
    const baseAdmin = aiEnv({ AI_ASSISTANT: 'admin', AI_ASSISTANT_PHOTO: 'on' });
    const a3 = insertUser(baseAdmin.DB, { role: 'admin', aiStatus: 'approved' });
    expect((await me(baseAdmin, a3)).assistant_preview).toEqual({ photo: true });
    expect(assistantPreview(loadConfig(baseAdmin), 'student')).toBeNull();
  });
});
