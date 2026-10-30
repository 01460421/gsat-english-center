/**
 * 學習助手多科目的端點（docs/design/assistant-subjects.md §2.3、§4、§7；§11.1 assist.subjects.routes.test.ts）。
 * 題目是本站自寫的句子（helpers/zh.ts）；英文的 D8 指紋與國文的 D8 指紋都由測試換掉（vi.mock）。
 *
 *   建案例：科目白名單、ref_json 的 subject 往返、開關 off／admin／on（非 on 的一般學生 503，在預扣之前）、國文指紋讀不到 503。
 *   拒收不扣點：subject_mismatch、zh_answer_section、國文指紋（同一區塊 ≥ 2 個窗口才拒收 official_material；比對是真的 d8.ts，
 *   指紋是本站自寫的誘餌）。
 *   確認題目：格式、作答、答案鍵、國寫片段；item_count 與 kind 依格式。
 *   related_case_id：同一位使用者、同一科、已確認題目才收。
 *   列表：科目篩選、每列 subject；不帶 subject 時 error_counts 只算英文（加強卷不吃國文案例）；歷史一行只數同一科。
 *   解析：turn 的 meta_json 存 {subject, kind, items}、點數依格式；英文的 turn 多了 subject、kind，點數不變。
 *   PATCH 單選改多選（0 點）；國文開關關掉時已有的國文案例照樣可以看與刪（唯讀）。
 */
import { assistPoints } from '@gsat/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetD8ForTests } from '../src/ai/d8';
import type { SessionUser } from '../src/auth/session';
import { seedUser, type TestEnv } from './helpers/ai';
import { assistEnv, bankSource, callAs, fakeSite, type FakeSite } from './helpers/assistSite';
import { fakeFingerprintFile } from './helpers/customEssay';
import {
  fakeZhFingerprints,
  zhBlocks,
  zhDecoyFingerprints,
  zhEnv,
  zhTypedBody,
  ZH_DECOY_OFFICIAL,
  ZH_FORM_SINGLE,
  ZH_SHORT_PASSAGE,
  ZH_SHORT_QUESTION,
  ZH_WORD_MULTI,
  ZH_WRITING_PROMPT,
} from './helpers/zh';

const fp = vi.hoisted(() => ({ file: {} as Record<string, unknown> }));
vi.mock('../src/generated/d8-fingerprints.json', () => ({ default: fp.file }));
const zh = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../src/assist/subjects/chinese/d8', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/assist/subjects/chinese/d8')>();
  return { ...actual, requireZhFingerprints: async () => zh.value, zhFingerprints: () => zh.value };
});

beforeEach(() => {
  for (const k of Object.keys(fp.file)) delete fp.file[k];
  Object.assign(fp.file, fakeFingerprintFile());
  resetD8ForTests();
  zh.value = fakeZhFingerprints();
});

function rowOf(env: TestEnv, sql: string, ...args: unknown[]): Record<string, any> {
  return env.DB.sqlite.prepare(sql).get(...(args as never[])) as Record<string, any>;
}

function create(env: TestEnv, site: FakeSite, user: SessionUser | null, body: unknown) {
  return callAs(env, site, user, 'POST', '/api/assist/cases', body);
}

const formBody = (extra: Record<string, unknown> = {}) => zhTypedBody({ blocks: zhBlocks(['question', null, ZH_FORM_SINGLE]) }, extra);

describe('建立國文案例：科目白名單、ref_json、開關（§2.3、§7.1、§7.5）', () => {
  it('貼上國文題目：kind 由格式決定、ref_json 寫 subject、列表與詳情帶 subject、標題是「國文・你貼的題目：…」', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const res = await create(env, site, user, formBody());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ source: 'typed', kind: 'zh_choice', subject: 'chinese', status: 'ready', trust: 'student', item_count: 1 });
    expect(res.body.title).toMatch(/^國文・你貼的題目：下列各句/);
    const ref = JSON.parse(rowOf(env, 'SELECT ref_json FROM assist_cases WHERE id = ?', res.body.id).ref_json);
    expect(ref).toEqual({ source: 'typed', subject: 'chinese' });
    const t = res.body.question.targets[0];
    expect(t).toMatchObject({ label: '', choice_mode: 'single', mode: 'single_choice' });
    expect(Object.keys(t.options)).toEqual(['A', 'B', 'C', 'D']);
    expect(res.body.question.subject).toBe('chinese');
    // 國文路徑的正規化不用 NFKC：全形標點、「」原樣保留。
    expect(res.body.question.blocks[0].text).toBe(ZH_FORM_SINGLE);
  });

  it('英文的貼上：ref_json 和以前一樣只有 {source}；送了不認得的科目回 400；站內題帶 subject 也不採用', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const en = await create(env, site, user, { source: { source: 'typed', question: { blocks: [{ kind: 'question', label: null, text: 'Which word best completes the sentence? He ___ to help me. (A) offered (B) suggested (C) avoided (D) denied' }], target_labels: [] } } });
    expect(en.status, JSON.stringify(en.body)).toBe(201);
    expect(en.body.subject).toBe('english');
    expect(JSON.parse(rowOf(env, 'SELECT ref_json FROM assist_cases WHERE id = ?', en.body.id).ref_json)).toEqual({ source: 'typed' });
    const bad = await create(env, site, user, { source: { source: 'typed', subject: 'math', question: { blocks: [], target_labels: [] } } });
    expect(bad.status).toBe(400);
    const bank = await create(env, site, user, { source: { ...bankSource(), subject: 'chinese' } });
    expect(bank.status).toBe(201);
    expect(bank.body).toMatchObject({ subject: 'english', kind: 'item' });
  });

  it.each([
    ['off', 'student', 503],
    ['off', 'admin', 503],
    ['admin', 'student', 503],
    ['admin', 'admin', 201],
    ['on', 'student', 201],
    ['On ', 'student', 201],
    ['onn', 'student', 503],
  ] as const)('AI_ASSISTANT_SUBJECTS=%s、%s → %i（在預扣之前；英文照常）', async (mode, role, status) => {
    const env = zhEnv({ AI_ASSISTANT_SUBJECTS: mode });
    const user = seedUser(env.DB, { role });
    const site = fakeSite();
    const res = await create(env, site, user, formBody());
    expect(res.status).toBe(status);
    if (status === 503) expect(res.body.error.code).toBe('not_configured');
    expect((await create(env, site, user, { source: bankSource() })).status).toBe(201);
    expect(rowOf(env, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(0);
  });

  it('國文拍照：要 AI_ASSISTANT_PHOTO 與 AI_ASSISTANT_SUBJECTS_PHOTO 都開；只關國文拍照不影響英文拍照與國文貼上', async () => {
    const env = zhEnv({ AI_ASSISTANT_SUBJECTS_PHOTO: 'off' });
    const site = fakeSite();
    const user = seedUser(env.DB);
    expect((await create(env, site, user, { source: { source: 'photo', subject: 'chinese' } })).status).toBe(503);
    expect((await create(env, site, user, { source: { source: 'photo' } })).status).toBe(201);
    expect((await create(env, site, user, formBody())).status).toBe(201);
    const env2 = zhEnv({ AI_ASSISTANT_PHOTO: 'off' });
    const u2 = seedUser(env2.DB);
    expect((await create(env2, site, u2, { source: { source: 'photo', subject: 'chinese' } })).status).toBe(503);
    const env3 = zhEnv();
    const u3 = seedUser(env3.DB);
    const photo = await create(env3, site, u3, { source: { source: 'photo', subject: 'chinese' } });
    expect(photo.status).toBe(201);
    expect(photo.body).toMatchObject({ source: 'photo', kind: 'zh_choice', subject: 'chinese', status: 'draft', question: null, title: '國文・你拍的題目' });
    expect(JSON.parse(rowOf(env3, 'SELECT ref_json FROM assist_cases WHERE id = ?', photo.body.id).ref_json)).toEqual({ source: 'photo', subject: 'chinese' });
  });

  it('國文 D8 指紋讀不到：國文的寫入端點 503（fail closed，不預扣）；英文照常', async () => {
    zh.value = null;
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const res = await create(env, site, user, formBody());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not_configured');
    expect((await create(env, site, user, { source: bankSource() })).status).toBe(201);
  });
});

describe('拒收不扣點（§4.2）', () => {
  it('不是國文（漢字太少）回 400 subject_mismatch；附了答案與詳解回 400 zh_answer_section（附位置）；都不建案例', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const english = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', null, 'Choose the best answer for the blank. He ___ to help me. (A) offered (B) suggested (C) avoided (D) denied']) }));
    expect(english.status).toBe(400);
    expect(english.body.error).toMatchObject({ code: 'assist_input_invalid', reason: 'subject_mismatch' });
    const withAnswer = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', null, `${ZH_FORM_SINGLE}\n【解析】素昧平生是向來不認識的意思，所以這一句完全正確`]) }));
    expect(withAnswer.status).toBe(400);
    expect(withAnswer.body.error).toMatchObject({ code: 'assist_input_invalid', reason: 'zh_answer_section' });
    expect(withAnswer.body.error.ranges).toHaveLength(1);
    expect(rowOf(env, 'SELECT COUNT(*) AS n FROM assist_cases').n).toBe(0);
    expect(rowOf(env, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(0);
    // 科目不符寫一筆 assist_subject_mismatch（只有假名、階段與科目）。
    expect(JSON.parse(rowOf(env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_subject_mismatch'`).detail_json)).toMatchObject({ where: 'typed', subject: 'chinese', stage: 'input', rejected: true });
  });

  it('國文指紋：同一區塊 ≥ 2 個窗口命中回 400 official_material（附學生文字裡的位置，不建案例、不扣點）；只命中 1 個窗口照常建立', async () => {
    zh.value = zhDecoyFingerprints();
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const pasted = `${ZH_FORM_SINGLE}
講義的說明：${ZH_DECOY_OFFICIAL}`;
    const hit = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', null, pasted]) }));
    expect(hit.status).toBe(400);
    expect(hit.body.error).toMatchObject({ code: 'assist_input_invalid', reason: 'official_material', field: 'blocks[0].text' });
    const [start, end] = hit.body.error.ranges[0];
    expect(pasted.slice(start, end)).toBe(ZH_DECOY_OFFICIAL);
    expect(rowOf(env, 'SELECT COUNT(*) AS n FROM assist_cases').n).toBe(0);
    expect(rowOf(env, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(0);
    const one = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', null, `${ZH_FORM_SINGLE}
講義的說明：${ZH_DECOY_OFFICIAL.slice(0, 8)}`]) }));
    expect(one.status, JSON.stringify(one.body)).toBe(201);
  });
});

describe('格式、作答與題數（§2.2、§7.2）', () => {
  it('5 個選項預設多選；作答與「我有講義答案」寫進 targets；item_count 是題數', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const res = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', '26', ZH_WORD_MULTI]), answers: { '26': 'A,C' }, known_key: { '26': '(A)(E)' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const t = res.body.question.targets[0];
    expect(t).toMatchObject({ label: '26', choice_mode: 'multi', mode: 'multi_select', student_answer: 'AC', accepted: ['A', 'E'], key_source: 'student' });
    expect(res.body.item_count).toBe(1);
  });

  it('簡答：小題數是題數、字數限制與抄錄規定寫進 targets；國寫：一題、片段寫進 draft', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const short = await create(
      env,
      site,
      user,
      zhTypedBody({ blocks: zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', `${ZH_SHORT_QUESTION}\n(1)村人的處境為何？（10字以內）\n(2)叮嚀的用意為何？（20字以內）`]), target_labels: ['34'], format: 'short', answers: { '34(2)': '不要告訴外面的人' } }),
    );
    expect(short.status, JSON.stringify(short.body)).toBe(201);
    expect(short.body.kind).toBe('zh_short');
    expect(short.body.item_count).toBe(2);
    expect(short.body.question.targets.map((t: any) => [t.label, t.char_limit?.max, t.student_answer])).toEqual([
      ['34(1)', 10, null],
      ['34(2)', 20, '不要告訴外面的人'],
    ]);
    const writing = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]), format: 'writing', draft: '補習班的窗戶永遠關著，我只能從縫隙裡看天色。', draft_target: 'q2' }));
    expect(writing.status, JSON.stringify(writing.body)).toBe(201);
    expect(writing.body).toMatchObject({ kind: 'zh_writing', item_count: 1 });
    expect(writing.body.question.draft).toEqual({ text: '補習班的窗戶永遠關著，我只能從縫隙裡看天色。', target: 'q2' });
  });

  it('確認題目（PUT …/question）：國文可以改格式，kind 與 item_count 跟著改；英文的 kind 不變', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const created = await create(env, site, user, formBody());
    const put = await callAs(env, site, user, 'PUT', `/api/assist/cases/${created.body.id}/question`, {
      question: { blocks: zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', null, ZH_SHORT_QUESTION]), target_labels: [], format: 'short' },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ kind: 'zh_short', item_count: 1, subject: 'chinese' });
    expect(put.body.title).toMatch(/^國文・你貼的題目：/);
  });
});

describe('同一份題目問另一部分（related_case_id；§1.6）', () => {
  it('同一位使用者、同一科、已確認題目才收；寫進 ref_json；其他一律 400', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const other = seedUser(env.DB);
    const first = await create(env, site, user, formBody());
    const ok = await create(env, site, user, formBody({ related_case_id: first.body.id }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(JSON.parse(rowOf(env, 'SELECT ref_json FROM assist_cases WHERE id = ?', ok.body.id).ref_json)).toEqual({ source: 'typed', subject: 'chinese', related_case_id: first.body.id });
    expect((await create(env, site, other, formBody({ related_case_id: first.body.id }))).status).toBe(400);
    const english = await create(env, site, user, { source: bankSource() });
    expect((await create(env, site, user, formBody({ related_case_id: english.body.id }))).status).toBe(400);
    const photo = await create(env, site, user, { source: { source: 'photo', subject: 'chinese' } });
    expect((await create(env, site, user, formBody({ related_case_id: photo.body.id }))).status).toBe(400);
    expect((await create(env, site, user, formBody({ related_case_id: 'not-a-uuid' }))).status).toBe(400);
  });
});

describe('列表、錯因次數與歷史一行（§7.3）', () => {
  it('不帶 subject：列全部科目、每列帶 subject，但 error_counts 只算英文；帶 subject 只列那一科、算那一科', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const en = await create(env, site, user, { source: bankSource() });
    const zhCase = await create(env, site, user, formBody());
    env.DB.sqlite.prepare(`UPDATE assist_cases SET errors_json = '["careless","over_inference"]', understood = 'no' WHERE id = ?`).run(en.body.id);
    env.DB.sqlite.prepare(`UPDATE assist_cases SET errors_json = '["careless","zh_form_homophone"]', understood = 'no' WHERE id = ?`).run(zhCase.body.id);
    const all = await callAs(env, site, user, 'GET', '/api/assist/cases');
    expect(all.status).toBe(200);
    expect(all.body.cases.map((c: any) => c.subject).sort()).toEqual(['chinese', 'english']);
    // 加強卷（papers/data.ts）讀的就是這個：國文的 careless 不算進英文的弱點。
    expect(all.body.error_counts).toEqual({ careless: 1, over_inference: 1 });
    const zhOnly = await callAs(env, site, user, 'GET', '/api/assist/cases?subject=chinese');
    expect(zhOnly.body.cases.map((c: any) => c.id)).toEqual([zhCase.body.id]);
    expect(zhOnly.body.error_counts).toEqual({ careless: 1, zh_form_homophone: 1 });
    const enOnly = await callAs(env, site, user, 'GET', '/api/assist/cases?subject=english');
    expect(enOnly.body.cases.map((c: any) => c.id)).toEqual([en.body.id]);
    expect(enOnly.body.error_counts).toEqual({ careless: 1, over_inference: 1 });
    expect((await callAs(env, site, user, 'GET', '/api/assist/cases?subject=math')).status).toBe(400);
    // 國文的題型也可以當 section 篩選。
    env.DB.sqlite.prepare(`UPDATE assist_cases SET section = 'zh_form' WHERE id = ?`).run(zhCase.body.id);
    expect((await callAs(env, site, user, 'GET', '/api/assist/cases?section=zh_form')).body.cases.map((c: any) => c.id)).toEqual([zhCase.body.id]);
  });

  it('歷史一行只數同一科：英文、國文各有一題 careless 時，兩邊都沒有歷史（各只有 1 題）', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const en = await create(env, site, user, { source: bankSource() });
    const zhCase = await create(env, site, user, formBody());
    for (const id of [en.body.id, zhCase.body.id]) env.DB.sqlite.prepare(`UPDATE assist_cases SET errors_json = '["careless"]' WHERE id = ?`).run(id);
    expect((await callAs(env, site, user, 'GET', `/api/assist/cases/${en.body.id}`)).body.history_line).toBeNull();
    expect((await callAs(env, site, user, 'GET', `/api/assist/cases/${zhCase.body.id}`)).body.history_line).toBeNull();
    const zh2 = await create(env, site, user, formBody());
    env.DB.sqlite.prepare(`UPDATE assist_cases SET errors_json = '["careless"]' WHERE id = ?`).run(zh2.body.id);
    expect((await callAs(env, site, user, 'GET', `/api/assist/cases/${zhCase.body.id}`)).body.history_line).toMatchObject({ code: 'careless', count: 2, case_ids: [zh2.body.id] });
  });
});

describe('解析的預扣與 turn 的 meta_json（§2.3、§9.3）', () => {
  it('國文：meta_json 存 {subject, kind, items}；點數依格式與題數（選擇 1 題 6、簡答 2 個小題 7、國寫 7）', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const cases = [
      [formBody(), 'zh_choice', 1],
      [zhTypedBody({ blocks: zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', `${ZH_SHORT_QUESTION}\n(1)處境？（10字以內）\n(2)用意？（20字以內）`]), target_labels: ['34'], format: 'short' }), 'zh_short', 2],
      [zhTypedBody({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]), format: 'writing' }), 'zh_writing', 1],
    ] as const;
    for (const [body, kind, items] of cases) {
      // 每人同時進行中的任務有上限：每一種格式用一位學生。
      const user = seedUser(env.DB);
      const created = await create(env, site, user, body);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const res = await callAs(env, site, user, 'POST', `/api/assist/cases/${created.body.id}/analyze`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      expect(res.body.points).toBe(assistPoints('chinese', 'assist_analyze', { kind, items }));
      const turn = rowOf(env, 'SELECT meta_json FROM assist_turns WHERE case_id = ?', created.body.id);
      expect(JSON.parse(turn.meta_json)).toEqual({ subject: 'chinese', kind, items });
      expect(rowOf(env, 'SELECT points_reserved FROM ai_ops WHERE ref_id = (SELECT id FROM assist_turns WHERE case_id = ?)', created.body.id).points_reserved).toBe(res.body.points);
    }
  });

  it('英文：meta_json 多了 subject、kind，題數與點數和以前相同', async () => {
    const env = assistEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const created = await create(env, site, user, { source: bankSource() });
    const res = await callAs(env, site, user, 'POST', `/api/assist/cases/${created.body.id}/analyze`, {});
    expect(res.status).toBe(202);
    expect(res.body.points).toBe(8);
    expect(JSON.parse(rowOf(env, 'SELECT meta_json FROM assist_turns WHERE case_id = ?', created.body.id).meta_json)).toEqual({ subject: 'english', kind: 'item', items: 2 });
  });

  it('國文開關關掉：解析、追問、確認回 503（不預扣）；已有的國文案例照樣可以看、評分與刪除（唯讀）', async () => {
    const db = zhEnv().DB;
    const on = zhEnv({}, db);
    const site = fakeSite();
    const user = seedUser(db);
    const created = await create(on, site, user, formBody());
    const off = zhEnv({ AI_ASSISTANT_SUBJECTS: 'off' }, db);
    expect((await callAs(off, site, user, 'POST', `/api/assist/cases/${created.body.id}/analyze`, {})).status).toBe(503);
    expect((await callAs(off, site, user, 'POST', `/api/assist/cases/${created.body.id}/followups`, { text: '為什麼？', mode: 'explain' })).status).toBe(503);
    expect((await callAs(off, site, user, 'PUT', `/api/assist/cases/${created.body.id}/question`, { question: { blocks: zhBlocks(['question', null, ZH_FORM_SINGLE]), target_labels: [] } })).status).toBe(503);
    expect(rowOf(off, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(0);
    expect((await callAs(off, site, user, 'GET', `/api/assist/cases/${created.body.id}`)).status).toBe(200);
    expect((await callAs(off, site, user, 'PATCH', `/api/assist/cases/${created.body.id}`, { rating: 'helpful' })).status).toBe(200);
    expect((await callAs(off, site, user, 'DELETE', `/api/assist/cases/${created.body.id}`)).status).toBe(204);
  });
});

describe('PATCH：國文已解析的單選改成多選（§5.3、§7.2）', () => {
  it('只接受 multi、只限國文已解析的選擇題；題目改成多選、判定依已存的逐選項判定重算（0 點）', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    const created = await create(env, site, user, zhTypedBody({ blocks: zhBlocks(['question', null, ZH_FORM_SINGLE]), answers: { '': 'C' } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    // 還沒解析：409。
    expect((await callAs(env, site, user, 'PATCH', `/api/assist/cases/${id}`, { choice_mode: 'multi' })).status).toBe(409);
    // 假裝解析完成：AI 的答案是 (C)(D)，學生選 C（單選＝答錯；改多選後漏選 1 個＝部分給分）。
    const view = {
      kind: 'zh_choice',
      items: [{ label: '', student_answer: 'C', answer_key: { from: 'ai', text: 'CD', certainty: 'sure' }, choice_mode: 'single', options: ['A', 'B', 'C', 'D'].map((option) => ({ option })) }],
    };
    env.DB.sqlite.prepare(`UPDATE assist_cases SET status = 'analyzed', analyses = 1, verdict = 'wrong', wrong_count = 1 WHERE id = ?`).run(id);
    env.DB.sqlite
      .prepare(`INSERT INTO assist_turns (id, case_id, user_id, seq, kind, status, output_json, meta_json) VALUES (?, ?, ?, 1, 'analyze', 'done', ?, '{}')`)
      .run(crypto.randomUUID(), id, user.id, JSON.stringify(view));
    expect((await callAs(env, site, user, 'PATCH', `/api/assist/cases/${id}`, { choice_mode: 'judge' })).status).toBe(400);
    const res = await callAs(env, site, user, 'PATCH', `/api/assist/cases/${id}`, { choice_mode: 'multi' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.question.targets[0]).toMatchObject({ choice_mode: 'multi', mode: 'multi_select' });
    expect(res.body).toMatchObject({ verdict: 'partial', wrong_count: 1 });
    expect((await callAs(env, site, user, 'PATCH', `/api/assist/cases/${id}`, { choice_mode: 'multi' })).status).toBe(409);
    expect(rowOf(env, 'SELECT COUNT(*) AS n FROM ai_ops').n).toBe(0);
    // 英文的案例不收。
    const en = await create(env, site, user, { source: bankSource() });
    expect((await callAs(env, site, user, 'PATCH', `/api/assist/cases/${en.body.id}`, { choice_mode: 'multi' })).status).toBe(400);
  });
});

describe('匯出（§7.6）', () => {
  it('每個案例多一個 subject（由 ref_json 算出）', async () => {
    const env = zhEnv();
    const site = fakeSite();
    const user = seedUser(env.DB);
    await create(env, site, user, formBody());
    await create(env, site, user, { source: bankSource() });
    const { buildExport } = await import('../src/account/export');
    const data = (await buildExport(env.DB, user.id)) as { assist?: { cases: Array<Record<string, unknown>> } };
    expect(data.assist!.cases.map((c) => c['subject']).sort()).toEqual(['chinese', 'english']);
  });
});
