/**
 * 學習助手的出版社題（docs/design/weak-paper.md §7.6、§8.7、§9.6）：pb 題組可以建立案例（出處寫出版社與書名、技能讀題組檔的
 * skills、沒有出版社解析時不送解析）；授權不含 ai_assist 或已經結束時拒收、不扣點；授權結束後（不重建網站也一樣）列表帶
 * source_ended、詳情遮住題目與解析、解析與追問拒收；本站題的案例不讀來源登記。到期當天的清理腳本只動那個來源的列。
 *
 * 題目、選文全部是本站為測試自己寫的句子（helpers/assistSite.ts 的文意選填改成出版社題組的形狀），不是任何出版社的內容。
 */
import { ITEM_SOURCE_ID_PATTERN, PUBLISHER_ASSIST_ENDED_TEXT, PUBLISHER_FILENAME_PATTERN, AI_BANK_SOURCE } from '@gsat/shared';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISHER_FILE_PATTERN, SOURCE_ID_PATTERN, publisherUids, retireSql, RetireError } from '../scripts/retire-publisher-source.mjs';
import { resetD8ForTests } from '../src/ai/d8';
import { maskQuestionView } from '../src/assist/publisher';
import type { SessionUser } from '../src/auth/session';
import { opsOf, seedUser, type TestEnv } from './helpers/ai';
import { seedAssistTurn } from './helpers/assist';
import { assistEnv, callAs, defaultSiteFiles, fakeSite, wordBankGroup, type FakeSite, type SiteFiles } from './helpers/assistSite';
import { fakeFingerprintFile } from './helpers/customEssay';

const fp = vi.hoisted(() => ({ file: {} as Record<string, unknown> }));
vi.mock('../src/generated/d8-fingerprints.json', () => ({ default: fp.file }));

beforeEach(() => {
  for (const k of Object.keys(fp.file)) delete fp.file[k];
  Object.assign(fp.file, fakeFingerprintFile());
  resetD8ForTests();
});

const PB_UID = 'pb.wb.5a6b7c';
const PB_REF = `${PB_UID}@1`;

/** 文意選填改成出版社題組：pb 代號、出處、每題的 skills；第 2 格只有計分欄位（沒有出版社解析），第 3 格有。 */
function publisherGroup(): Record<string, unknown> {
  const base = wordBankGroup() as Record<string, any>;
  const items = base['annotations'].explanations.items as Record<string, Record<string, unknown>>;
  const { auto_verified: _a, provenance: _p, ...rest } = base;
  return {
    ...rest,
    uid: PB_UID,
    version: 1,
    source: { id: 'pub-test', label_zh: '測試出版', product_zh: '測試模擬試題', attribution_zh: '本題出自測試出版《測試模擬試題》，經授權使用', ref_text: '原卷第 21–24 題' },
    skills: { '1': ['tp:collocation'], '2': ['tp:collocation', 'ct:collocation'], '3': ['tp:word_meaning', 'ct:cause_effect'], '4': ['tp:collocation'] },
    annotations: {
      ...base['annotations'],
      explanations: { items: { ...items, '2': { explanation_zh: '', evidence: [] }, '3': { ...items['3'], explanation_zh: '出版社的解析：第 3 格看因果。' } } },
      translation_zh: null,
      elimination: null,
    },
  };
}

function registry(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'test',
    sources: [
      AI_BANK_SOURCE,
      {
        id: 'pub-test',
        ns: 'pb',
        kind: 'publisher',
        label_zh: '測試出版',
        publisher_zh: '測試出版股份有限公司',
        product_zh: '測試模擬試題',
        attribution_zh: '本題出自測試出版《測試模擬試題》，經授權使用',
        scope: ['web', 'pdf', 'ai_assist'],
        active: true,
        retired_on: null,
        ends_on: null,
        ...change,
      },
    ],
  };
}

function site(change: Record<string, unknown> | null = {}, extra: SiteFiles = {}): FakeSite {
  return fakeSite({
    ...defaultSiteFiles(),
    [`bank/groups/${PB_REF}.json`]: publisherGroup(),
    ...(change === null ? {} : { 'bank/sources.json': registry(change) }),
    ...extra,
  });
}

const pbSource = (labels = ['2', '3']) => ({ source: 'bank', ref: PB_REF, labels, answers: { '1': 'A', '2': 'F', '3': 'E', '4': 'D' } });

function create(env: TestEnv, s: FakeSite, user: SessionUser, body: unknown) {
  return callAs(env, s, user, 'POST', '/api/assist/cases', body);
}

function caseCount(env: TestEnv): number {
  return (env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM assist_cases').get() as { n: number }).n;
}

describe('建立出版社題的案例', () => {
  it('出處寫出版社與書名（不是本站題庫）；技能讀題組檔的 skills；沒有出版社解析的那一格不送解析；ref_json 記下來源 id', async () => {
    const env = assistEnv();
    const s = site();
    const user = seedUser(env.DB);
    const res = await create(env, s, user, { source: pbSource() });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('測試出版《測試模擬試題》・進階練習・文意選填：第 2、3 格');
    expect(res.body.question.origin_label).toBe('測試出版《測試模擬試題》・進階練習・經授權使用');
    expect(res.body.title).not.toMatch(/本站題庫|大考中心|CEEC/);
    expect([...res.body.skill_codes].sort()).toEqual(['ct:cause_effect', 'ct:collocation', 'tp:collocation', 'tp:word_meaning']);
    const [t2, t3] = res.body.question.targets;
    expect(t2.explanation).toBeNull();
    expect(t3.explanation.explanation_zh).toBe('出版社的解析：第 3 格看因果。');
    expect(t2.verdict).toBe('wrong');
    const ref = JSON.parse((env.DB.sqlite.prepare('SELECT ref_json FROM assist_cases').get() as { ref_json: string }).ref_json);
    expect(ref).toMatchObject({ source: 'bank', ref: PB_REF, src: 'pub-test' });
    expect(s.requests).toContain('https://site.test/data/bank/sources.json');
  });

  it('授權不含 ai_assist：400 source_no_ai，不建立、不扣點', async () => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const res = await create(env, site({ scope: ['web', 'pdf'] }), user, { source: pbSource() });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'assist_source_unavailable', reason: 'source_no_ai', message: '這一題的出版社授權不包含 AI 解析' });
    expect(caseCount(env)).toBe(0);
    expect(opsOf(env.DB)).toEqual([]);
  });

  it.each([
    ['停用', { active: false }],
    ['過了到期日（今天以台灣日期比，不必重建網站）', { ends_on: '2020-01-01' }],
  ])('%s：409 source_ended，不建立', async (_name, change) => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const res = await create(env, site(change), user, { source: pbSource() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'assist_source_unavailable', reason: 'source_ended' });
    expect(caseCount(env)).toBe(0);
  });

  it('到期日當天仍可以用（授權的最後一天）', async () => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    expect((await create(env, site({ ends_on: today }), user, { source: pbSource() })).status).toBe(201);
  });

  it('來源登記讀不到：檔案不存在 → 停用（fail closed，409）；網路錯誤 → 502（請稍後再試）', async () => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const missing = await create(env, site(null), user, { source: pbSource() });
    expect(missing.status).toBe(409);
    expect(missing.body.error.reason).toBe('source_ended');
    const down = await create(env, site(null, { 'bank/sources.json': 'throw' }), user, { source: pbSource() });
    expect(down.status).toBe(502);
    expect(down.body.error.reason).toBe('unreachable');
    // 登記檔裡沒有這個來源 → 停用。
    const absent = await create(env, fakeSite({ ...defaultSiteFiles(), [`bank/groups/${PB_REF}.json`]: publisherGroup(), 'bank/sources.json': { version: 'x', sources: [AI_BANK_SOURCE] } }), user, { source: pbSource() });
    expect(absent.status).toBe(409);
    expect(caseCount(env)).toBe(0);
  });

  it('pb 題組檔少了出處：當成壞檔（502），不會被當成本站題', async () => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const { source: _s, ...noSource } = publisherGroup();
    const res = await create(env, site({}, { [`bank/groups/${PB_REF}.json`]: noSource }), user, { source: pbSource() });
    expect(res.status).toBe(502);
  });

  it('本站題的案例不讀來源登記，ref_json 不變（沒有 src）', async () => {
    const env = assistEnv();
    const s = site();
    const user = seedUser(env.DB);
    const res = await create(env, s, user, { source: { source: 'bank', ref: 'ai.wb.3f9a1c@2', labels: ['2'], answers: { '2': 'F' } } });
    expect(res.status).toBe(201);
    const list = await callAs(env, s, user, 'GET', '/api/assist/cases');
    const detail = await callAs(env, s, user, 'GET', `/api/assist/cases/${res.body.id}`);
    expect(list.body.cases[0].source_ended).toBeUndefined();
    expect(detail.body.source_ended).toBeUndefined();
    expect(s.requests.some((u) => u.endsWith('/bank/sources.json'))).toBe(false);
    const ref = JSON.parse((env.DB.sqlite.prepare('SELECT ref_json FROM assist_cases').get() as { ref_json: string }).ref_json);
    expect('src' in ref).toBe(false);
  });
});

describe('授權結束之後的案例（不重建網站也一樣）', () => {
  async function seeded() {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const created = await create(env, site(), user, { source: pbSource() });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    seedAssistTurn(env.DB, user.id, id, { seq: 1, kind: 'analyze' });
    seedAssistTurn(env.DB, user.id, id, { seq: 2, kind: 'followup' });
    env.DB.sqlite.prepare(`UPDATE assist_cases SET status = 'analyzed', analyses = 1 WHERE id = ?`).run(id);
    return { env, user, id };
  }

  it('來源還有效：照常顯示題目與解析', async () => {
    const { env, user, id } = await seeded();
    const detail = await callAs(env, site(), user, 'GET', `/api/assist/cases/${id}`);
    expect(detail.body.source_ended).toBeUndefined();
    expect(detail.body.question.passage).toContain('Mina wanted to');
    expect(detail.body.turns[0].analysis).toBeTruthy();
    expect(detail.body.turns[1].reply).toBeTruthy();
  });

  it('過了到期日：列表帶 source_ended；詳情只留題號、作答與對錯，選文、題幹、選項、解析與回覆都不回', async () => {
    const { env, user, id } = await seeded();
    const ended = site({ ends_on: '2020-01-01' });
    const list = await callAs(env, ended, user, 'GET', '/api/assist/cases');
    expect(list.status).toBe(200);
    expect(list.body.cases[0]).toMatchObject({ id, source_ended: true });
    const detail = await callAs(env, ended, user, 'GET', `/api/assist/cases/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.source_ended).toBe(true);
    const q = detail.body.question;
    expect(q.passage).toBeNull();
    expect(q.shared_options).toBeNull();
    expect(q.targets.map((t: any) => [t.label, t.student_answer, t.verdict, t.accepted])).toEqual([
      ['2', 'F', 'wrong', ['B']],
      ['3', 'E', 'wrong', ['C']],
    ]);
    expect(q.targets.every((t: any) => t.stem === null && t.options === null && t.explanation === null)).toBe(true);
    const text = JSON.stringify(detail.body);
    expect(text).not.toContain('Mina wanted to');
    expect(text).not.toContain('refused');
    expect(text).not.toContain('出版社的解析');
    expect(detail.body.turns.map((t: any) => [t.kind, 'analysis' in t, 'reply' in t])).toEqual([
      ['analyze', false, false],
      ['followup', false, false],
    ]);
    // 學生自己寫的追問留著；資料庫不改（清理腳本另外跑）。
    expect(detail.body.turns[1].question).toBe('那 (B) 呢？');
    expect((env.DB.sqlite.prepare('SELECT question_json FROM assist_cases WHERE id = ?').get(id) as { question_json: string }).question_json).toContain('Mina wanted to');
  });

  it('解析與追問：409 source_ended，在預扣之前（不扣點、不排隊）', async () => {
    const { env, user, id } = await seeded();
    const ended = site({ active: false });
    const analyze = await callAs(env, ended, user, 'POST', `/api/assist/cases/${id}/analyze`, {});
    expect(analyze.status).toBe(409);
    expect(analyze.body.error).toMatchObject({ code: 'assist_source_unavailable', reason: 'source_ended', message: PUBLISHER_ASSIST_ENDED_TEXT });
    const followup = await callAs(env, ended, user, 'POST', `/api/assist/cases/${id}/followups`, { text: '為什麼不是 (E)？', mode: 'explain' });
    expect(followup.status).toBe(409);
    expect(followup.body.error.reason).toBe('source_ended');
    expect(opsOf(env.DB)).toEqual([]);
    expect(env.AI_QUEUE.sent).toEqual([]);
  });

  it('授權後來不含 ai_assist：題目照常顯示，但解析與追問 400 source_no_ai', async () => {
    const { env, user, id } = await seeded();
    const noAi = site({ scope: ['web', 'pdf'] });
    const detail = await callAs(env, noAi, user, 'GET', `/api/assist/cases/${id}`);
    expect(detail.body.source_ended).toBeUndefined();
    const followup = await callAs(env, noAi, user, 'POST', `/api/assist/cases/${id}/followups`, { text: '為什麼不是 (E)？', mode: 'explain' });
    expect(followup.status).toBe(400);
    expect(followup.body.error.reason).toBe('source_no_ai');
    expect(opsOf(env.DB)).toEqual([]);
  });

  it('題組檔已經下架（404）：當成授權結束；讀不到登記檔時也遮住（fail closed）', async () => {
    const { env, user, id } = await seeded();
    const gone = fakeSite({ ...defaultSiteFiles(), 'bank/sources.json': registry() });
    expect((await callAs(env, gone, user, 'GET', `/api/assist/cases/${id}`)).body.source_ended).toBe(true);
    const down = site(null, { 'bank/sources.json': 'throw' });
    expect((await callAs(env, down, user, 'GET', `/api/assist/cases/${id}`)).body.source_ended).toBe(true);
    expect((await callAs(env, down, user, 'GET', '/api/assist/cases')).body.cases[0].source_ended).toBe(true);
    // 解析與追問在讀不到時回 502（請稍後再試），不扣點。
    expect((await callAs(env, down, user, 'POST', `/api/assist/cases/${id}/analyze`, {})).status).toBe(502);
    expect(opsOf(env.DB)).toEqual([]);
  });

  it('PATCH（懂了嗎）回傳的詳情也遮住', async () => {
    const { env, user, id } = await seeded();
    const res = await callAs(env, site({ active: false }), user, 'PATCH', `/api/assist/cases/${id}`, { understood: 'yes' });
    expect(res.status).toBe(200);
    expect(res.body.source_ended).toBe(true);
    expect(res.body.question.passage).toBeNull();
  });
});

describe('maskQuestionView', () => {
  it('填充、簡答的可接受寫法（出版社文字）也遮掉；選擇題的答案字母留著', () => {
    const view = maskQuestionView({
      kind: 'item',
      trust: 'site',
      origin_label: 'x',
      section: 'mixed',
      instructions: '說明',
      passage: 'p',
      figure_text: 'f',
      targets: [
        { label: '1', display_label: '1', mode: 'fill_in_blank', stem: 's', options: null, accepted: ['early'], student_answer: 'late', verdict: 'wrong', verdict_basis: 'program', explanation: null, stats: null, tags: { key_phrase: 'k' } },
        { label: '2', display_label: '2', mode: 'multi_select', stem: 's', options: { A: 'a' }, accepted: ['A', 'C'], student_answer: ['A'], verdict: 'partial', verdict_basis: 'program', explanation: null, stats: null, tags: null },
      ],
      siblings: [{ label: '3', display_label: '3', stem: 'sib' }],
      shared_options: null,
      group_answers: null,
      elimination: { x: 1 },
      tier: 'advanced',
    });
    expect(view?.targets.map((t) => t.accepted)).toEqual([null, ['A', 'C']]);
    expect(view?.targets.every((t) => t.tags === null && t.stem === null)).toBe(true);
    expect(view?.siblings[0]?.stem).toBeNull();
    expect([view?.instructions, view?.passage, view?.figure_text, view?.elimination]).toEqual([null, null, null, null]);
  });
});

// ───────────────────────── 清理腳本 ─────────────────────────

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe('retire-publisher-source.mjs（到期當天的一次性清理）', () => {
  it('格式和 shared 的一致', () => {
    expect(SOURCE_ID_PATTERN.source).toBe(ITEM_SOURCE_ID_PATTERN.source);
    expect(PUBLISHER_FILE_PATTERN.source).toBe(PUBLISHER_FILENAME_PATTERN.source);
  });

  it('uid 清單取自 data/publisher/{來源}/v1/** 的檔名（去重、排序）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'retire-'));
    tmpDirs.push(dir);
    const v1 = path.join(dir, 'pub-test', 'v1');
    mkdirSync(path.join(v1, 'word_bank', 'advanced'), { recursive: true });
    mkdirSync(path.join(v1, 'reading', 'basic'), { recursive: true });
    for (const f of ['word_bank/advanced/pb.wb.5a6b7c@1.json', 'word_bank/advanced/pb.wb.5a6b7c@2.json', 'reading/basic/pb.rd.0f0001@1.json', 'reading/basic/notes.txt']) {
      writeFileSync(path.join(v1, f), '{}');
    }
    expect(publisherUids(v1)).toEqual(['pb.rd.0f0001', 'pb.wb.5a6b7c']);
    expect(publisherUids(path.join(dir, 'missing'))).toEqual([]);
  });

  it('只有 UPDATE；只動那個來源的案例、turn 與共用快取；可以重複執行；本站題與其他來源不受影響', async () => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const pb = await create(env, site(), user, { source: pbSource() });
    const ai = await create(env, site(), user, { source: { source: 'bank', ref: 'ai.wb.3f9a1c@2', labels: ['2'], answers: { '2': 'F' } } });
    for (const id of [pb.body.id, ai.body.id]) seedAssistTurn(env.DB, user.id, id, { seq: 1, kind: 'analyze' });
    const cache = env.DB.sqlite.prepare(
      `INSERT INTO ai_shared_cache (cache_key, kind, ref_id, prompt_version, model, result_json, status, hits, created_at, expires_at) VALUES (?, 'explain_template', ?, 'v', 'm', '{}', 'active', 0, 0, 9999999999)`,
    );
    cache.run('k-pb', `${PB_REF}#2,3`);
    cache.run('k-ai', 'ai.wb.3f9a1c@2#2');
    cache.run('k-other', 'pb.rd.ffffff@1#1');

    const sql = retireSql('pub-test', ['pb.wb.5a6b7c']);
    const statements = sql.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('--'));
    expect(statements.every((l) => l.startsWith('UPDATE '))).toBe(true);
    expect(sql).not.toMatch(/\b(DELETE|DROP|ALTER|INSERT|CREATE)\b/);
    env.DB.sqlite.exec(sql);
    env.DB.sqlite.exec(sql);

    const q = (id: string) => env.DB.sqlite.prepare('SELECT question_json FROM assist_cases WHERE id = ?').get(id) as { question_json: string | null };
    const t = (id: string) => env.DB.sqlite.prepare('SELECT output_json FROM assist_turns WHERE case_id = ?').get(id) as { output_json: string | null };
    expect(q(pb.body.id).question_json).toBeNull();
    expect(t(pb.body.id).output_json).toBeNull();
    expect(q(ai.body.id).question_json).not.toBeNull();
    expect(t(ai.body.id).output_json).not.toBeNull();
    const status = (k: string) => (env.DB.sqlite.prepare('SELECT status FROM ai_shared_cache WHERE cache_key = ?').get(k) as { status: string }).status;
    expect([status('k-pb'), status('k-ai'), status('k-other')]).toEqual(['disabled', 'active', 'active']);
  });

  it('正規化檔已經移除時仍用 ref_json 的來源 id 認案例；格式不對的 id 直接拒絕', async () => {
    const env = assistEnv();
    const user = seedUser(env.DB);
    const pb = await create(env, site(), user, { source: pbSource() });
    env.DB.sqlite.exec(retireSql('pub-test', []));
    expect((env.DB.sqlite.prepare('SELECT question_json FROM assist_cases WHERE id = ?').get(pb.body.id) as { question_json: string | null }).question_json).toBeNull();
    expect(() => retireSql("x'; DROP TABLE assist_cases; --", [])).toThrow(RetireError);
    expect(() => retireSql('pub-test', ["pb.wb.5a6b7c' OR 1=1"])).toThrow(RetireError);
  });

  it('uid 很多時分成幾句（每句 IN 的數量有上限）', () => {
    const uids = Array.from({ length: 5 }, (_, i) => `pb.rd.00000${i}`);
    const sql = retireSql('pub-test', uids, { perStatement: 2 });
    expect(sql.match(/UPDATE ai_shared_cache/g)).toHaveLength(3);
    expect(sql.match(/UPDATE assist_cases/g)).toHaveLength(3);
  });
});
