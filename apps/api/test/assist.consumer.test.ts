/**
 * 學習助手的 consumer（docs/design/learning-assistant.md §4.8、§4.11；§6.2 assist.consumer.test.ts）。Anthropic 一律用假回應。
 * 涵蓋：解析的後處理（代碼過濾、題號對應、證據句定位、英文字數、品牌字樣、輸出 D8、答案疑慮、離題、身心安全、內容過濾）、
 * 寫作與單字、學生提供的題目（答案清空、較嚴的例句上限、student_patterns）、max_tokens 重試一次、拒答退還與內容退還告警、
 * 租約互斥、全站暫停、同一則訊息送兩次只結算一次、結算時 analyses 已經是 2、追問（模式、錯因合併、上下文區塊逐位元相同）。
 */
import { AI_TASK_POINTS } from '@gsat/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueueHandler } from '../src/ai/consumer';
import { resetD8ForTests } from '../src/ai/d8';
import { FILTERED_PLACEHOLDER } from '../src/ai/filter';
import { setPausedStatement } from '../src/ai/guard';
import { assistFollowupSystemText } from '../src/ai/prompts/assist-followup';
import { ASSIST_CONTENT_REFUND_ALERT, ASSIST_CONTENT_REFUND_MARK } from '../src/assist/consumer';
import { D8_HIDDEN_TEXT, OFF_TOPIC_TEXT } from '../src/assist/output';
import type { SessionUser } from '../src/auth/session';
import { batchOf, call, makeMessage, noopCtx, seedUser, STUDENT_TRANSLATION, TRANSLATION_GROUP, translationAnalyticOutput, translationHolisticOutput, type TestEnv } from './helpers/ai';
import { FakeAnthropic, frameworkOf } from './helpers/anthropic';
import { seedAssistCase } from './helpers/assist';
import { assistEnv, bankSource, callAs, fakeSite, followupOutput, itemOutput, RD_REF, vocabOutput, WB_REF, writingOutput, type FakeSite } from './helpers/assistSite';
import { FAKE_OFFICIAL_EN, FAKE_OFFICIAL_ZH, fakeFingerprintFile } from './helpers/customEssay';

const fp = vi.hoisted(() => ({ file: {} as Record<string, unknown> }));
vi.mock('../src/generated/d8-fingerprints.json', () => ({ default: fp.file }));

beforeEach(() => {
  for (const k of Object.keys(fp.file)) delete fp.file[k];
  Object.assign(fp.file, fakeFingerprintFile());
  resetD8ForTests();
});

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

function row(env: TestEnv, sql: string, ...args: unknown[]): Record<string, any> {
  return env.DB.sqlite.prepare(sql).get(...(args as never[])) as Record<string, any>;
}

function rows(env: TestEnv, sql: string, ...args: unknown[]): Array<Record<string, any>> {
  return env.DB.sqlite.prepare(sql).all(...(args as never[])) as Array<Record<string, any>>;
}

interface Setup {
  env: TestEnv;
  site: FakeSite;
  user: SessionUser;
}

function setup(): Setup {
  const env = assistEnv();
  return { env, site: fakeSite(), user: seedUser(env.DB) };
}

/** 建案例並送出解析，回傳案例 id 與操作 id。 */
async function analyze(s: Setup, body: Record<string, unknown>): Promise<{ caseId: string; opId: string; points: number }> {
  const created = await callAs(s.env, s.site, s.user, 'POST', '/api/assist/cases', body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const res = await callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${created.body.id}/analyze`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return { caseId: created.body.id, opId: res.body.op_id, points: res.body.points };
}

/** 跑一則訊息（預設是佇列裡最後一則）。 */
async function run(s: Setup, fake: FakeAnthropic, opts: { opId?: string; attempts?: number; now?: () => number } = {}) {
  const body = opts.opId ? { op_id: opts.opId } : s.env.AI_QUEUE.sent[s.env.AI_QUEUE.sent.length - 1]!;
  const msg = makeMessage(body, opts.attempts ?? 1);
  await quiet(() => createQueueHandler({ fetch: fake.fetch, ...(opts.now ? { now: opts.now } : {}) })(batchOf('ai-tasks', [msg]), s.env, noopCtx));
  return msg;
}

/** 讀案例詳情（路由回給前端的形狀）。 */
async function detail(s: Setup, caseId: string) {
  const res = await callAs(s.env, s.site, s.user, 'GET', `/api/assist/cases/${caseId}`);
  expect(res.status).toBe(200);
  return res.body;
}

const json = (output: unknown) => {
  const fake: FakeAnthropic = new FakeAnthropic(() => fake.json(output));
  return fake;
};

describe('解析：站內題的後處理（§4.11）', () => {
  it('文意選填兩格：代碼過濾、答案用程式的、證據句定位、陷阱代碼不在本站解析裡就丟、品牌字樣、寫進共用快取、依題數結算', async () => {
    const s = setup();
    const { caseId, opId, points } = await analyze(s, { source: bankSource() });
    // 兩題比一題多（每多一題加點；§1.7）。
    expect(points).toBeGreaterThan(AI_TASK_POINTS.assist_analyze);
    const fake = json(itemOutput(['2', '3'], { tested_zh: '大考中心常考的搭配詞與詞性。' }));
    const msg = await run(s, fake);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    // 站內題、沒有自由輸入的疑問：可以共用，所以請求裡沒有學生的文字與學生的錯因歷史。
    expect(req.userText).not.toContain('<student_text');
    expect(req.userText).not.toContain('<student_patterns>');
    expect(req.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });

    expect(row(s.env, 'SELECT status, points_charged FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'settled', points_charged: points });
    const d = await detail(s, caseId);
    expect(d).toMatchObject({ status: 'analyzed', error_codes: ['word_form'] });
    expect(d.skill_codes).toEqual(expect.arrayContaining(['tp:collocation', 'ct:cause_effect']));
    expect(d.skill_codes).not.toContain('xx:not_a_code');
    const a = d.turns[0].analysis;
    expect(a.kind).toBe('item');
    expect(a.skill_codes).toEqual(['tp:collocation', 'ct:cause_effect']);
    expect(a.tested_zh).toBe('官方常考的搭配詞與詞性。');
    expect(a.items.map((it: any) => it.label)).toEqual(['2', '3']);
    const first = a.items[0];
    expect(first.answer_key).toEqual({ from: 'site', accepted: ['B'] });
    expect(first.student_answer).toBe('F');
    expect(first.diagnosis.error_codes).toEqual(['word_form']);
    // 第一個證據句在選文裡找得到（寫上位置），第二個是模型自己寫的句子：清空。
    expect(first.solution_steps[0].quote).toBe('a neighbor [[2]] to take a look');
    expect(first.solution_steps[0].range).toMatchObject({ where: 'passage' });
    expect(first.solution_steps[1]).toMatchObject({ quote: '', range: null });
    // 文意選填的本站解析沒有 option_codes：模型寫的陷阱代碼丟掉，說明留著。
    expect(first.traps[0]).toMatchObject({ option: 'F', trap_code: '' });
    expect(first.traps[0].explain_zh).toContain('refused');
    expect(a.cache_hit).toBe(false);
    // 共用快取：寫一筆，案例記下快取鍵（不回給前端）。
    expect(row(s.env, 'SELECT COUNT(*) AS n, MAX(ref_id) AS ref FROM ai_shared_cache')).toEqual({ n: 1, ref: `${WB_REF}#2,3` });
    expect(row(s.env, 'SELECT cache_key FROM assist_cases WHERE id = ?', caseId).cache_key).toMatch(/^[0-9a-f]{64}$/);
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE case_id = ?', caseId).meta_json);
    expect(meta).toMatchObject({ filter_version: 'f4', d8_fp: 'test-fp-0001', cacheable: true, patterns: false });
    // 丟掉的代碼：技能 1 個、兩題各 1 個錯因、兩題各 1 個陷阱代碼。
    expect(meta.counts).toMatchObject({ codes_dropped: 5, quotes_cleared: 2, exam_board_replaced: 1 });
  });

  it('自組卷的卷面題號：模型寫「第 37 題」也對得回原始題號；多寫的題丟掉；閱讀題的陷阱代碼要在本站解析的 option_codes 裡', async () => {
    const s = setup();
    const { caseId } = await analyze(s, {
      source: { source: 'bank_mock', paper_id: `bk1-a-${'0'.repeat(66)}`, ref: RD_REF, labels: ['1'], label_map: { '1': '37', '2': '38' }, swap: null, answers: { '1': 'B' } },
    });
    const out = itemOutput(['第 37 題', '99'], { section: 'reading' });
    out.items[0]!.traps = [
      { option: 'B', trap_code: 'DT', explain_zh: '細節錯置。', spot_zh: '回原文找這個細節。' },
      { option: 'D', trap_code: 'XX', explain_zh: '不在清單的代碼。', spot_zh: '' },
    ];
    await run(s, json(out));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({ label: '1', display_label: '37', verdict: 'wrong', answer_key: { from: 'site', accepted: ['A'] } });
    expect(a.items[0].diagnosis.summary_zh).toContain('37');
    expect(a.items[0].traps.map((t: any) => t.trap_code)).toEqual(['DT', '']);
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE case_id = ?', caseId).meta_json);
    expect(meta.counts.items_extra).toBe(1);
  });

  it('模型漏了一題：那一題補空白並標 missing_item（不退還）', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['3'])));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.items[0]).toMatchObject({ label: '2', solution_steps: [], hints_zh: [] });
    expect(a.items[0].answer_key).toEqual({ from: 'site', accepted: ['B'] });
    expect(a.notices).toContainEqual({ kind: 'missing_item', field: 'items[0]' });
    expect(a.items[1].diagnosis.summary_zh).toContain('第 3 格');
  });

  it('英文字數：_zh 欄位的英文超過 40 個單詞整欄清空；站內題的例句超過 25 個單詞丟掉', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    const longEnglish = Array.from({ length: 45 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(' ');
    // 短字組成（不碰 120 字元的長度上限），只測單詞數：22 個單詞留下、30 個單詞丟掉。
    const words = (n: number) => `${Array.from({ length: n }, (_, i) => ['we', 'go', 'to', 'it', 'so', 'do'][i % 6]).join(' ')}.`;
    const example22 = words(22);
    const example30 = words(30);
    await run(
      s,
      json(
        itemOutput(['2', '3'], {
          structure_zh: `這篇的結構：${longEnglish}`,
          knowledge: [{ kind: 'collocation', title_zh: 'offer to V', explain_zh: 'offer 後面接不定詞。', examples: [{ en: example22, zh: '例句一。' }, { en: example30, zh: '例句二。' }] }],
        }),
      ),
    );
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.structure_zh).toBe('');
    expect(a.notices).toContainEqual({ kind: 'english_trimmed', field: 'structure_zh' });
    expect(a.knowledge[0].examples.map((e: any) => e.en)).toEqual([example22]);
  });

  it('輸出命中 D8：那一欄換成固定說明、寫 ops 事件 assist_d8_output（只有 op id 與欄位數）、案例 d8_hidden、不寫共用快取', async () => {
    const s = setup();
    const { caseId, opId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['2', '3'], { tested_zh: `參考：${FAKE_OFFICIAL_ZH}`, score_tips_zh: [`Try: ${FAKE_OFFICIAL_EN}`, '每週練一組。'] })));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.tested_zh).toBe(D8_HIDDEN_TEXT);
    expect(a.score_tips_zh).toEqual([D8_HIDDEN_TEXT, '每週練一組。']);
    expect(a.notices).toEqual(expect.arrayContaining([{ kind: 'd8_hidden', field: 'tested_zh' }, { kind: 'd8_hidden', field: 'score_tips_zh[0]' }]));
    const events = rows(s.env, `SELECT severity, detail_json FROM ops_events WHERE kind = 'assist_d8_output'`);
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.detail_json)).toEqual({ op_id: opId, fields: 2 });
    expect(events[0]!.detail_json).not.toContain(FAKE_OFFICIAL_ZH);
    expect(row(s.env, 'SELECT d8_hidden, cache_key FROM assist_cases WHERE id = ?', caseId)).toEqual({ d8_hidden: 1, cache_key: null });
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
    expect((await detail(s, caseId)).flags.d8_hidden).toBe(true);
  });

  it('答案疑慮（key_concern_zh）：照常顯示、寫 ops 事件 assist_key_concern（題組與題號），不寫共用快取', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['2', '3'], { key_concern_zh: '第 3 格的 (E) 似乎也說得通，請老師確認。' })));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.key_concern_zh).toContain('第 3 格');
    const ev = row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_key_concern'`);
    expect(JSON.parse(ev.detail_json)).toMatchObject({ ref: `${WB_REF}#2,3`, labels: ['2', '3'] });
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it('離題：整則換成固定說明，案例的錯因不更新', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['2', '3'], { off_topic: true })));
    const d = await detail(s, caseId);
    const a = d.turns[0].analysis;
    expect(a.notices).toEqual([{ kind: 'off_topic', field: '' }]);
    expect(a.items[0].diagnosis).toEqual({ error_codes: [], summary_zh: '', detail_zh: '' });
    expect(a.tested_zh).toBe('');
    expect(d.error_codes).toEqual([]);
    expect(OFF_TOPIC_TEXT).toContain('英文');
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it('身心安全旗標：照常完成、案例 safety_flag、安全事件只存類別、不寫共用快取', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['2', '3'], { safety_flag: 'self_harm_risk' })));
    expect(row(s.env, 'SELECT safety_flag FROM assist_cases WHERE id = ?', caseId).safety_flag).toBe('self_harm_risk');
    expect(row(s.env, 'SELECT kind, category FROM ai_safety_events')).toEqual({ kind: 'wellbeing_flag', category: 'self_harm_risk' });
    expect((await detail(s, caseId)).flags.safety).toBe('self_harm_risk');
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it('不當內容：那一欄換成固定文案、寫安全事件 output_filtered、不寫共用快取', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['2', '3'], { tested_zh: '教你 how to make a bomb。' })));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.tested_zh).toBe(FILTERED_PLACEHOLDER);
    expect(a.notices).toContainEqual({ kind: 'filtered', field: 'tested_zh' });
    expect(row(s.env, 'SELECT kind, category FROM ai_safety_events')).toEqual({ kind: 'output_filtered', category: 'violence' });
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it('server-side fallback 由接手模型回的解析：照常完成、記下實際服務的模型，但不寫共用快取（快取鍵是請求的模型）', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    const fake: FakeAnthropic = new FakeAnthropic(() => fake.json(itemOutput(['2', '3']), { model: 'claude-opus-4-8' }));
    await run(s, fake);
    expect(row(s.env, 'SELECT status, served_model FROM assist_turns WHERE case_id = ?', caseId)).toEqual({ status: 'done', served_model: 'claude-opus-4-8' });
    expect(row(s.env, 'SELECT cache_key FROM assist_cases WHERE id = ?', caseId).cache_key).toBeNull();
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });
});

describe('解析：學生提供的題目（§4.11 第 7 步）', () => {
  const typed = (text: string, extra: Record<string, unknown> = {}) => ({ source: { source: 'typed', question: { blocks: [{ kind: 'question', label: null, text }], target_labels: [] } }, ...extra });
  const MCQ = 'Choose the best answer. The meeting was ___ because of the storm. (A) postponed (B) posted (C) poured (D) polished';

  it('答案用模型的（≤ 8 個單詞）；例句上限 20 個單詞；不採用 key_concern；請求帶學生的錯因歷史', async () => {
    const s = setup();
    seedAssistCase(s.env.DB, s.user.id); // 另一個案例：錯因 over_inference
    const { caseId } = await analyze(s, typed(MCQ, { doubt: '為什麼不是 (B)？' }));
    const example22 = `${Array.from({ length: 22 }, (_, i) => ['we', 'go', 'to', 'it', 'so', 'do'][i % 6]).join(' ')}.`;
    const out = itemOutput([''], {
      section: 'vocabulary',
      key_concern_zh: '題目可能有兩個答案。',
      knowledge: [{ kind: 'vocab', title_zh: 'postpone', explain_zh: '延後。', examples: [{ en: example22, zh: '太長。' }, { en: 'They postponed the game.', zh: '他們延後比賽。' }] }],
    });
    out.items[0]!.answer = { text: '(A) postponed', certainty: 'likely' };
    const fake = json(out);
    await run(s, fake);
    const req = fake.requests[0]!;
    expect(req.userText).toContain('<student_provided_question>');
    expect(req.userText).toContain('<student_text role="doubt">');
    expect(req.userText).toContain('<student_patterns>');
    expect(req.userText).toContain('over_inference 1');
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.section).toBe('vocabulary');
    expect(a.items[0].answer_key).toEqual({ from: 'ai', text: '(A) postponed', certainty: 'likely' });
    expect(a.key_concern_zh).toBe('');
    expect(a.knowledge[0].examples.map((e: any) => e.en)).toEqual(['They postponed the game.']);
    expect(rows(s.env, `SELECT 1 FROM ops_events WHERE kind = 'assist_key_concern'`)).toHaveLength(0);
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it.each([
    ['模型判成中譯英', 'translation', 'Many teachers speak English.'],
    ['答案超過 8 個單詞', 'vocabulary', 'The meeting was postponed because of the heavy storm last night.'],
  ])('%s：答案清空並標 answer_cleared', async (_name, section, text) => {
    const s = setup();
    const { caseId } = await analyze(s, typed(MCQ));
    const out = itemOutput([''], { section: section as never });
    out.items[0]!.answer = { text, certainty: 'sure' };
    await run(s, json(out));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.items[0].answer_key).toBeNull();
    expect(a.notices).toContainEqual({ kind: 'answer_cleared', field: 'items[0].answer' });
  });
});

describe('解析：寫作與單字（§2.6、§2.8）', () => {
  async function gradedTranslation(s: Setup): Promise<string> {
    const created = await call(s.env, s.user, 'POST', '/api/submissions', {
      kind: 'translation',
      group_id: TRANSLATION_GROUP,
      input_mode: 'typed',
      body: { items: STUDENT_TRANSLATION.map((text, i) => ({ item_id: String(i + 1), text })) },
    });
    expect((await call(s.env, s.user, 'POST', '/api/ai/translation-grade', { submission_id: created.body.id })).status).toBe(202);
    const fake: FakeAnthropic = new FakeAnthropic((req) => (frameworkOf(req) === 'analytic' ? fake.json(translationAnalyticOutput()) : fake.json(translationHolisticOutput())));
    await run(s, fake);
    return created.body.id;
  }

  it('中譯英：student_quote 只在學生的作答裡找；中譯英沒有作文的四項；句子計畫只留存在的句子；分數從批改讀', async () => {
    const s = setup();
    const id = await gradedTranslation(s);
    const { caseId } = await analyze(s, { source: { source: 'writing', submission_id: id } });
    const fake = json(writingOutput());
    await run(s, fake);
    expect(fake.requests[0]!.userText).toContain('<student_text role="answer"');
    const d = await detail(s, caseId);
    const a = d.turns[0].analysis;
    expect(a.kind).toBe('writing');
    expect(a.by_category[0]).toMatchObject({ student_quote: 'teacher has raised', trap_code: 'tt:plural_countable', error_code: 'grammar' });
    expect(a.by_category[0].range).toMatchObject({ where: 'student_text' });
    expect(a.by_category[1]).toMatchObject({ student_quote: '', range: null, trap_code: '' });
    expect(a.criteria).toEqual([]);
    expect(a.sentence_plan.map((p: any) => p.sentence_index)).toEqual([0]);
    expect(a.score).toEqual({ final: 5.75, max: 8 });
    // 寫作只留 ts:、tt:、wc:、gp: 開頭的技能代碼。
    expect(a.skill_codes).toEqual(['ts:PERF']);
    expect(d.error_codes).toEqual(['grammar']);
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it('單字：依 entry_id 對回輸入的條目（順序照輸入、詞從索引來）；不在輸入裡的條目與分組成員丟掉', async () => {
    const s = setup();
    const { caseId } = await analyze(s, {
      source: { source: 'vocab', entries: [{ entry_id: 'postpone|v.|3', mode: 'en2zh', wrong_count: 3 }, { entry_id: 'cancel|v.|2', mode: 'cloze', wrong_count: 1 }] },
    });
    await run(s, json(vocabOutput()));
    const a = (await detail(s, caseId)).turns[0].analysis;
    expect(a.kind).toBe('vocab');
    expect(a.entries.map((e: any) => [e.entry_id, e.word])).toEqual([
      ['postpone|v.|3', 'postpone'],
      ['cancel|v.|2', 'cancel'],
    ]);
    expect(a.groups[0].entry_ids).toEqual(['postpone|v.|3', 'cancel|v.|2']);
    expect(a.entries[0].example.en).toBe('They postponed the game because of the rain.');
  });
});

describe('呼叫政策、退還與結算', () => {
  it('max_tokens 截斷：在這次投遞重試一次，成功就正常結算（兩次呼叫都記帳）', async () => {
    const s = setup();
    const { opId } = await analyze(s, { source: bankSource() });
    let n = 0;
    const fake: FakeAnthropic = new FakeAnthropic(() => (++n === 1 ? fake.json({ items: [] }, { stopReason: 'max_tokens' }) : fake.json(itemOutput(['2', '3']))));
    await run(s, fake);
    expect(fake.requests).toHaveLength(2);
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('settled');
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?', opId).n).toBe(2);
  });

  it('拒答：點數全退、成本照記、turn 與案例改 failed（failure=refusal）、安全事件只存類別；之後可以再送', async () => {
    const s = setup();
    const { caseId, opId } = await analyze(s, { source: bankSource() });
    const fake: FakeAnthropic = new FakeAnthropic(() => fake.json({}, { stopReason: 'refusal', refusalCategory: 'cyber', outputTokens: 5 }));
    const msg = await run(s, fake);
    expect(msg.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
    const op = row(s.env, 'SELECT status, points_charged, refund_reason, usd_actual_micros FROM ai_ops WHERE id = ?', opId);
    expect(op).toMatchObject({ status: 'refunded', points_charged: 0, refund_reason: 'refusal' });
    expect(op.usd_actual_micros).toBeGreaterThan(0);
    expect(row(s.env, 'SELECT kind, category FROM ai_safety_events')).toEqual({ kind: 'refusal', category: 'cyber' });
    const d = await detail(s, caseId);
    expect(d.status).toBe('failed');
    expect(d.turns[0]).toMatchObject({ status: 'failed', failure: 'refusal' });
    const again = await callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/analyze`, {});
    expect(again.status).toBe(202);
  });

  it('內容退還告警：同一人 7 天內第 3 次內容退還寫 assist_content_refunds（只有 user_ref 與次數），同一天不重寫', async () => {
    const s = setup();
    const now = Math.floor(Date.now() / 1000);
    const insertOp = s.env.DB.sqlite.prepare(
      `INSERT INTO ai_ops (id, user_id, task, ref_id, status, points_reserved, points_charged, usd_reserved_micros, refund_reason, tw_day, tw_month, created_at, settled_at)
       VALUES (?, ?, 'assist_analyze', ?, 'refunded', 4, 0, 1000, 'invalid_output', '2000-01-01', '2000-01', ?, ?)`,
    );
    const mark = s.env.DB.sqlite.prepare(`INSERT INTO ops_events (kind, severity, detail_json, created_at, acked_at) VALUES (?, 'info', ?, ?, ?)`);
    for (const id of ['old-1', 'old-2']) {
      insertOp.run(id, s.user.id, `turn-${id}`, now - 86_400, now - 86_400);
      mark.run(ASSIST_CONTENT_REFUND_MARK, JSON.stringify({ op_id: id }), now - 86_400, now - 86_400);
    }
    const refusal = () => {
      const f: FakeAnthropic = new FakeAnthropic(() => f.json({}, { stopReason: 'refusal', outputTokens: 5 }));
      return f;
    };
    const alerts = () => rows(s.env, `SELECT severity, detail_json FROM ops_events WHERE kind = ?`, ASSIST_CONTENT_REFUND_ALERT);
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, refusal());
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.severity).toBe('warn');
    const detailJson = JSON.parse(alerts()[0]!.detail_json);
    expect(detailJson).toEqual({ user_ref: expect.stringMatching(/^[0-9a-f]{64}$/), count: 3 });
    expect(alerts()[0]!.detail_json).not.toContain(s.user.email);
    expect((await callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/analyze`, {})).status).toBe(202);
    await run(s, refusal());
    expect(alerts()).toHaveLength(1);
  });

  it('租約：另一個 consumer 正在處理時不呼叫模型，延後重送', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    s.env.DB.sqlite.prepare(`UPDATE assist_turns SET status = 'running', lease_until = ? WHERE case_id = ?`).run(Math.floor(Date.now() / 1000) + 300, caseId);
    const fake = json(itemOutput(['2', '3']));
    const msg = await run(s, fake);
    expect(fake.requests).toHaveLength(0);
    expect(msg.acked).toBe(false);
    expect(msg.retried?.delaySeconds).toBeGreaterThanOrEqual(300);
  });

  it('全站暫停：還沒開始的解析退還 paused，不呼叫模型', async () => {
    const s = setup();
    const { opId } = await analyze(s, { source: bankSource() });
    await setPausedStatement(s.env.DB, true, Date.now()).run();
    const fake = json(itemOutput(['2', '3']));
    await run(s, fake);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'paused' });
  });

  it('同一則訊息送兩次：只呼叫一次、只結算一次（analyses 1、點數只扣一次、快取只寫一筆）', async () => {
    const s = setup();
    const { caseId, opId, points } = await analyze(s, { source: bankSource() });
    const fake = json(itemOutput(['2', '3']));
    await run(s, fake, { opId });
    const second = await run(s, fake, { opId });
    expect(second.acked).toBe(true);
    expect(fake.requests).toHaveLength(1);
    expect(row(s.env, 'SELECT analyses, status FROM assist_cases WHERE id = ?', caseId)).toEqual({ analyses: 1, status: 'analyzed' });
    expect(row(s.env, 'SELECT SUM(points_charged) AS p FROM ai_ops').p).toBe(points);
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(1);
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM assist_turns WHERE case_id = ?', caseId).n).toBe(1);
  });

  it('結算時案例的 analyses 已經是 2（和快取命中併發）：照常結算，analyses 不超過 2', async () => {
    const s = setup();
    const { caseId, opId } = await analyze(s, { source: bankSource() });
    s.env.DB.sqlite.prepare('UPDATE assist_cases SET analyses = 2 WHERE id = ?').run(caseId);
    await run(s, json(itemOutput(['2', '3'])));
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('settled');
    expect(row(s.env, 'SELECT analyses FROM assist_cases WHERE id = ?', caseId).analyses).toBe(2);
  });

  it('題目資料壞掉：不呼叫模型，以 internal 退還', async () => {
    const s = setup();
    const { caseId, opId } = await analyze(s, { source: bankSource() });
    s.env.DB.sqlite.prepare(`UPDATE assist_cases SET question_json = '{"kind":"item"}' WHERE id = ?`).run(caseId);
    const fake = json(itemOutput(['2', '3']));
    await run(s, fake);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'internal' });
  });
});

describe('追問（§1.7、§4.8）', () => {
  it('提示模式：mode_used 以請求為準；錯因併進案例；上下文區塊每輪逐位元相同並標快取；對話記錄帶前一輪的問題', async () => {
    const s = setup();
    const { caseId } = await analyze(s, { source: bankSource() });
    await run(s, json(itemOutput(['2', '3'])));
    const ask = async (text: string, mode: 'hint' | 'explain', label: string | null) => {
      const res = await callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/followups`, { text, mode, ...(label ? { label } : {}) });
      expect(res.status, JSON.stringify(res.body)).toBe(202);
      return res.body;
    };
    const first = await ask('那 offer 呢？', 'hint', '2');
    expect(first.points).toBe(AI_TASK_POINTS.assist_followup);
    const fake = json(followupOutput({ mode_used: 'explain' }));
    await run(s, fake);
    const req1 = fake.requests[0]!;
    expect(req1.system).toBe(assistFollowupSystemText());
    const blocks1 = req1.body.messages[0].content as Array<{ type: string; text: string; cache_control?: unknown }>;
    expect(blocks1).toHaveLength(3);
    expect(blocks1[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks1[0]!.text).toContain('<analysis_digest>');
    expect(blocks1[2]!.text).toContain('Mode: hint.');
    expect(blocks1[2]!.text).toContain('Question: question 2.');
    expect(blocks1[2]!.text).toContain('<student_text role="question">');

    let d = await detail(s, caseId);
    expect(d.followups).toBe(1);
    const reply = d.turns.find((t: any) => t.kind === 'followup').reply;
    expect(reply).toMatchObject({ mode_used: 'hint', new_error_codes: ['collocation'] });
    expect(reply.points[0]).toEqual({ text_zh: 'offer to V', example_en: 'She offered to drive.' });
    expect(d.error_codes).toEqual(['word_form', 'collocation']);

    await ask('所以 suggest 不能接 to V？', 'explain', null);
    const fake2 = json(followupOutput({ off_topic: true }));
    await run(s, fake2);
    const blocks2 = fake2.requests[0]!.body.messages[0].content as Array<{ text: string }>;
    expect(blocks2[0]!.text).toBe(blocks1[0]!.text);
    expect(blocks2[1]!.text).toContain('那 offer 呢?');
    expect(blocks2[2]!.text).toContain('Question: the whole group.');
    d = await detail(s, caseId);
    expect(d.followups).toBe(2);
    const last = d.turns.filter((t: any) => t.kind === 'followup')[1].reply;
    expect(last).toMatchObject({ reply_zh: OFF_TOPIC_TEXT, points: [], new_error_codes: [], notices: [{ kind: 'off_topic', field: '' }] });
  });
});
