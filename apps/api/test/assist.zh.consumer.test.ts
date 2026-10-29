/**
 * 學習助手國文的 consumer（docs/design/assistant-subjects.md §2.3、§2.5、§5.1、§7.3；§11.1 assist.zh.consumer.test.ts）。
 * Anthropic 一律用假回應；題目與模型輸出都是本站自寫的句子（helpers/zh.ts）。
 *
 * 這個工作包（S1-worker-core）涵蓋：依科目分派、turn 的 meta_json {subject, kind, items} 決定任務設定、國文的請求（系統提示、
 * <task>、不加快取標記的追問上下文）、後處理骨架（小列舉正規化、題號、代碼、題型卡、多選計分、確定程度上限、簡答示範字數、
 * 國寫等第句）、結算寫回 section／verdict／wrong_count、科目不符以 invalid_output 退還並記 detected_subject、國文轉錄。
 * 引文總量、台灣標準、古文語料、提示洩答、選項覆蓋與 D8 比對本身由後處理的工作包補測試。
 */
import { assistPoints, ZH_SECTION_SPECS } from '@gsat/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueueHandler } from '../src/ai/consumer';
import { resetD8ForTests } from '../src/ai/d8';
import { assistZhFollowupSystemText, assistZhSystemText } from '../src/ai/prompts/assist-zh';
import { assistZhOcrSystemText } from '../src/ai/prompts/assist-zh-ocr';
import { ZH_D8_HIDDEN_TEXT } from '../src/assist/subjects/chinese/output';
import type { SessionUser } from '../src/auth/session';
import { batchOf, makeMessage, noopCtx, seedUser, type TestEnv } from './helpers/ai';
import { FakeAnthropic } from './helpers/anthropic';
import { seedAssistPhoto } from './helpers/assist';
import { bankSource, callAs, fakeSite, itemOutput, type FakeSite } from './helpers/assistSite';
import { fakeFingerprintFile } from './helpers/customEssay';
import {
  fakeZhFingerprints,
  zhBlocks,
  zhChoiceOutput,
  zhEnv,
  zhFollowupOutput,
  zhOcrOutput,
  zhShortOutput,
  zhTypedBody,
  zhWritingOutput,
  ZH_FORM_SINGLE,
  ZH_SHORT_PASSAGE,
  ZH_SHORT_QUESTION,
  ZH_SOCIAL_QUESTION,
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

interface Setup {
  env: TestEnv;
  site: FakeSite;
  user: SessionUser;
}

function setup(): Setup {
  const env = zhEnv();
  return { env, site: fakeSite(), user: seedUser(env.DB) };
}

async function createCase(s: Setup, body: Record<string, unknown>): Promise<string> {
  const created = await quiet(() => callAs(s.env, s.site, s.user, 'POST', '/api/assist/cases', body));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.id;
}

async function analyze(s: Setup, body: Record<string, unknown>): Promise<{ caseId: string; opId: string; points: number }> {
  const caseId = await createCase(s, body);
  const res = await quiet(() => callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/analyze`, {}));
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return { caseId, opId: res.body.op_id, points: res.body.points };
}

async function run(s: Setup, fake: FakeAnthropic, attempts = 1) {
  const msg = makeMessage(s.env.AI_QUEUE.sent[s.env.AI_QUEUE.sent.length - 1]!, attempts);
  await quiet(() => createQueueHandler({ fetch: fake.fetch })(batchOf('ai-tasks', [msg]), s.env, noopCtx));
  return msg;
}

async function detail(s: Setup, caseId: string) {
  const res = await quiet(() => callAs(s.env, s.site, s.user, 'GET', `/api/assist/cases/${caseId}`));
  expect(res.status).toBe(200);
  return res.body;
}

const json = (output: unknown) => {
  const fake: FakeAnthropic = new FakeAnthropic(() => fake.json(output));
  return fake;
};

const formBody = (extra: Partial<Parameters<typeof zhTypedBody>[0]> = {}, more: Record<string, unknown> = {}) =>
  zhTypedBody({ blocks: zhBlocks(['question', null, ZH_FORM_SINGLE]), ...extra }, more);

describe('國文解析：請求、後處理骨架與結算寫回（§3.7、§3.8、§5.1、§7.3）', () => {
  it('字形單選：國文的系統提示與 <task>；代碼、題型卡、確定程度上限、逐選項的「你」欄；案例寫回 section、verdict、wrong_count', async () => {
    const s = setup();
    const { caseId, opId, points } = await analyze(s, formBody({ answers: { '': 'A' } }));
    expect(points).toBe(assistPoints('chinese', 'assist_analyze', { kind: 'zh_choice', items: 1 }));
    const fake = json(zhChoiceOutput([{ label: '1', answer: '(C)', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]));
    const msg = await run(s, fake);
    expect(msg.acked).toBe(true);
    const req = fake.requests[0]!;
    expect(req.system).toBe(assistZhSystemText('zh_choice'));
    expect(req.body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(req.body.max_tokens).toBe(16_000);
    expect(req.userText).toContain('Subject: Chinese (國文). Output format: choice; mode: single-choice (4 options).');
    expect(req.userText).toContain('The program guesses the question types: the question zh_form');
    expect(req.userText).toContain('No answer key: answer yourself and set certainty honestly.');
    expect(req.userText).toContain("The student's answers: the question: A.");
    expect(req.userText).toContain(`<student_provided_question>\n[question]\n${ZH_FORM_SINGLE}\n</student_provided_question>`);
    expect(row(s.env, 'SELECT status, points_charged FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'settled', points_charged: points });

    const d = await detail(s, caseId);
    expect(d).toMatchObject({ status: 'analyzed', subject: 'chinese', section: 'zh_form', verdict: 'wrong', wrong_count: 1 });
    // 錯因只留這個格式可用的國文代碼；技能只留國文的代碼。
    expect(d.error_codes).toEqual(['zh_form_homophone', 'zh_sound_side']);
    expect(d.skill_codes).toEqual(['zs:A1']);
    const a = d.turns[0].analysis;
    expect(a.kind).toBe('zh_choice');
    expect(a.tested_zh).toBe('這題在考同音字與形近字的辨別，官方常考。');
    expect(a.cards.map((c: any) => [c.kind, c.for_label])).toEqual([['form', '']]);
    const it0 = a.items[0];
    expect(it0).toMatchObject({ label: '', item_type: 'zh_form', choice_mode: 'single', verdict: 'wrong', verdict_basis: 'ai_answer', student_answer: 'A' });
    // 字形預設在確定程度上限裡：最高「可能」，畫面加「請查教育部辭典」。
    expect(it0.answer_key).toEqual({ from: 'ai', text: 'C', certainty: 'likely' });
    expect(it0.warnings).toContain('cap_dictionary');
    expect(it0.options.map((o: any) => [o.option, o.verdict, o.student?.picked])).toEqual([
      ['A', 'no', true],
      ['B', 'no', false],
      ['C', 'yes', false],
      ['D', 'no', false],
    ]);
    expect(it0.options[0].student.mark).toBe('wrong_pick');
    expect(it0.options[2].student.mark).toBe('missed');
    // 引文在題目裡找得到才留（去標點比對）；模型自己寫的句子清空。
    expect(it0.solution_steps[0]).toMatchObject({ quote: '素「昧」平生', range: { where: 'blocks', ref: '0' } });
    expect(it0.solution_steps[1]).toMatchObject({ quote: '', range: null });
    expect(a.type_steps).toEqual([{ key: 'zh_form', title_zh: ZH_SECTION_SPECS.zh_form.steps_title_zh, steps_zh: [...ZH_SECTION_SPECS.zh_form.steps_zh], labels: [''] }]);
    const meta = JSON.parse(row(s.env, 'SELECT meta_json FROM assist_turns WHERE case_id = ?', caseId).meta_json);
    expect(meta).toMatchObject({ subject: 'chinese', kind: 'zh_choice', items: 1, zh_fp: 'test-zh-0001', cacheable: false });
    expect(meta.checks.quote_misses).toBe(1);
    expect(meta.checks.enum_normalized).toBeGreaterThanOrEqual(1);
    // 國文不寫共用快取。
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM ai_shared_cache').n).toBe(0);
  });

  it('多選＋學生提供的答案鍵：依答案鍵判定（student_key）、多選計分、矛盾的列加註、答案疑慮寫事件', async () => {
    const s = setup();
    const { caseId } = await analyze(s, zhTypedBody({ blocks: zhBlocks(['question', '26', ZH_WORD_MULTI]), answers: { '26': 'AC' }, known_key: { '26': 'AE' } }));
    const fake = json({
      ...zhChoiceOutput([{ label: '26', answer: 'AE', options: ['A', 'B', 'C', 'D', 'E'], yes: ['A', 'B'], item_type: 'zh_word' }], { section: 'zh_word', cards: [] }),
      key_concern_zh: '(B) 的兩個「之」我判斷相同，答案可能有誤。',
    });
    await run(s, fake);
    expect(fake.requests[0]!.userText).toContain('Answer key: given by the student and not verified by the website: 26: AE.');
    expect(fake.requests[0]!.userText).toContain('5 options; in the official Chinese test these are multiple-select.');
    const d = await detail(s, caseId);
    expect(d).toMatchObject({ section: 'zh_word', verdict: 'partial', wrong_count: 1 });
    const it0 = d.turns[0].analysis.items[0];
    expect(it0).toMatchObject({ choice_mode: 'multi', verdict_basis: 'student_key', answer_key: { from: 'student', text: 'AE' } });
    expect(it0.multi_score).toMatchObject({ wrong_picks: ['C'], missed: ['E'], k: 2, n: 5 });
    expect(it0.options.find((o: any) => o.option === 'B').flags).toEqual(['key_differs']);
    expect(it0.warnings).toContain('key_concern');
    expect(row(s.env, `SELECT COUNT(*) AS n FROM ops_events WHERE kind = 'assist_key_concern'`).n).toBe(1);
    expect(JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_key_concern'`).detail_json)).toMatchObject({ subject: 'chinese', labels: ['26'] });
  });

  it('簡答：覆蓋程度正規化（「部分符合」→ partial）、示範超過字數拿掉、案例判定 partial', async () => {
    const s = setup();
    const { caseId } = await analyze(
      s,
      zhTypedBody({ blocks: zhBlocks(['passage', null, ZH_SHORT_PASSAGE], ['question', '34', ZH_SHORT_QUESTION]), target_labels: ['34'], format: 'short', answers: { '34': '不要告訴外面的人' } }),
    );
    const out = zhShortOutput(['34']);
    out.parts[0]!.demo_zh = '希望保守村子裡的祕密，不讓外面的人知道，以免外人紛紛前來打擾大家平靜的生活。';
    const fake = json(out);
    await run(s, fake);
    const req = fake.requests[0]!;
    expect(req.system).toBe(assistZhSystemText('zh_short'));
    expect(req.body.max_tokens).toBe(13_000);
    expect(req.userText).toContain('Character limits found in the question: 34: 20 characters, no copying rule.');
    expect(req.userText).toContain('<student_text role="answer" label="34">\n不要告訴外面的人\n</student_text>');
    const d = await detail(s, caseId);
    expect(d).toMatchObject({ kind: 'zh_short', section: 'zh_short_answer', verdict: 'partial', wrong_count: 1 });
    const p = d.turns[0].analysis.parts[0];
    expect(p).toMatchObject({ label: '34', demo_zh: '', check: { coverage: 'partial' }, student_count: { chars: 8 }, over_limit: false });
    expect(d.turns[0].analysis.notices).toContainEqual({ kind: 'demo_removed', field: 'parts[0].demo_zh' });
    expect(p.key_points[0]).toMatchObject({ quote: '遂與外人間隔', range: { where: 'blocks', ref: '0' } });
  });

  it('國寫：拿掉等第句、判定 unknown（不給等第或分數）', async () => {
    const s = setup();
    const { caseId } = await analyze(s, zhTypedBody({ blocks: zhBlocks(['question', null, ZH_WRITING_PROMPT]), format: 'writing' }));
    const fake = json(zhWritingOutput());
    await run(s, fake);
    expect(fake.requests[0]!.body.max_tokens).toBe(16_000);
    const d = await detail(s, caseId);
    expect(d).toMatchObject({ kind: 'zh_writing', section: 'zh_writing_emotion', verdict: 'unknown', wrong_count: 0 });
    const a = d.turns[0].analysis;
    expect(a.pitfalls_zh).toEqual(['只寫窗的樣子沒有經驗。']);
    expect(a.q1).toBeNull();
    expect(a.requirements[0]).toMatchObject({ quote: '那一扇窗', range: { where: 'blocks' } });
  });

  it('D8：國文集合命中（比對由 d8.ts 實作；這裡換掉 zhD8Hit）的欄位換成固定說明、寫 assist_d8_output（detail 帶 subject）', async () => {
    const d8 = await import('../src/assist/subjects/chinese/d8');
    const spy = vi.spyOn(d8, 'zhD8Hit').mockImplementation((text: string) => text.includes('大考中心常考'));
    try {
      const s = setup();
      const { caseId } = await analyze(s, formBody());
      await run(s, json(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }])));
      const d = await detail(s, caseId);
      expect(d.turns[0].analysis.tested_zh).toBe(ZH_D8_HIDDEN_TEXT);
      expect(d.flags.d8_hidden).toBe(true);
      expect(JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_d8_output'`).detail_json)).toMatchObject({ subject: 'chinese', fields: 1 });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('科目不符：以 invalid_output 退還（§2.5）', () => {
  it('detected_subject 是 social：退還（算進每日退還上限）、turn failed、meta_json 與畫面帶 detected_subject、寫 assist_subject_mismatch', async () => {
    const s = setup();
    const { caseId, opId } = await analyze(s, zhTypedBody({ blocks: zhBlocks(['question', null, ZH_SOCIAL_QUESTION]) }));
    const fake = json({ ...zhChoiceOutput([]), detected_subject: 'social', items: [], cards: [] });
    const msg = await run(s, fake);
    expect(msg.acked).toBe(true);
    expect(row(s.env, 'SELECT status, refund_reason, points_charged FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output', points_charged: 0 });
    const turn = row(s.env, 'SELECT status, failure, meta_json FROM assist_turns WHERE case_id = ?', caseId);
    expect(turn).toMatchObject({ status: 'failed', failure: 'invalid_output' });
    expect(JSON.parse(turn.meta_json)).toEqual({ subject: 'chinese', kind: 'zh_choice', items: 1, detected_subject: 'social' });
    const d = await detail(s, caseId);
    expect(d.status).toBe('failed');
    expect(d.turns[0]).toMatchObject({ status: 'failed', failure: 'invalid_output', detected_subject: 'social' });
    expect(JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_subject_mismatch'`).detail_json)).toEqual({
      op_id: opId,
      subject: 'chinese',
      stage: 'analyze',
      detected_subject: 'social',
    });
    // 內容造成的退還（COUNTED_REFUND_REASONS）：算進每日退還上限。
    expect(row(s.env, `SELECT COUNT(*) AS n FROM ai_ops WHERE user_id = ? AND refund_reason IN ('refusal', 'invalid_output', 'max_tokens')`, s.user.id).n).toBe(1);
  });

  it('detected_subject 是 other 或 chinese：照常處理（不退還）', async () => {
    const s = setup();
    const { opId } = await analyze(s, formBody());
    await run(s, json({ ...zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]), detected_subject: 'other' }));
    expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', opId).status).toBe('settled');
  });
});

describe('任務設定與分派（§2.3、§2.4）', () => {
  it('國文 D8 指紋在 consumer 讀不到：以 internal 退還，不呼叫模型', async () => {
    const s = setup();
    const { opId } = await analyze(s, formBody());
    zh.value = null;
    const fake = json(zhChoiceOutput([]));
    await run(s, fake);
    expect(fake.requests).toHaveLength(0);
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'internal' });
  });

  it('英文：舊的 turn（meta_json 只有 items）和新的 turn（多了 subject、kind）送出的 max_tokens 相同', async () => {
    for (const meta of [{ items: 2 }, { subject: 'english', kind: 'item', items: 2 }]) {
      const s = setup();
      const caseId = await createCase(s, { source: bankSource() });
      const res = await quiet(() => callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/analyze`, {}));
      expect(res.status).toBe(202);
      s.env.DB.sqlite.prepare('UPDATE assist_turns SET meta_json = ? WHERE case_id = ?').run(JSON.stringify(meta), caseId);
      const fake = json(itemOutput(['2', '3']));
      await run(s, fake);
      expect(fake.requests[0]!.body.max_tokens).toBe(20_000);
      expect(row(s.env, 'SELECT status FROM ai_ops WHERE id = ?', res.body.op_id).status).toBe('settled');
    }
  });

  it('student_patterns 只帶國文的錯因（英文案例的錯因不進國文的請求）', async () => {
    const s = setup();
    const en = await createCase(s, { source: bankSource() });
    const older = await createCase(s, formBody());
    s.env.DB.sqlite.prepare(`UPDATE assist_cases SET errors_json = '["over_inference","careless"]' WHERE id = ?`).run(en);
    s.env.DB.sqlite.prepare(`UPDATE assist_cases SET errors_json = '["zh_form_homophone","careless"]' WHERE id = ?`).run(older);
    await analyze(s, formBody());
    const fake = json(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]));
    await run(s, fake);
    const text = fake.requests[0]!.userText;
    expect(text).toContain("<student_patterns>\nError codes on this student's earlier Chinese questions (most frequent first): careless 1, zh_form_homophone 1.\n</student_patterns>");
    expect(text).not.toContain('over_inference');
  });

  it('同一份題目問另一部分：新案例的 <task> 帶前一個案例的摘要', async () => {
    const s = setup();
    const { caseId: first } = await analyze(s, formBody());
    await run(s, json(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }])));
    const second = await createCase(s, formBody({}, { related_case_id: first }));
    const res = await quiet(() => callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${second}/analyze`, {}));
    expect(res.status).toBe(202);
    const fake = json(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }]));
    await run(s, fake);
    expect(fake.requests[0]!.userText).toMatch(/Related case: the student asked about other parts of this material earlier\. Summary: Tested: .+ \/ Question the question: zh_form; answer C（AI）/);
  });
});

describe('國文追問（§3.5）', () => {
  it('國文的追問提示；上下文不加快取標記；錯因只留這個格式可用的；案例的追問次數 +1', async () => {
    const s = setup();
    const { caseId } = await analyze(s, formBody({ answers: { '': 'A' } }));
    await run(s, json(zhChoiceOutput([{ label: '', answer: 'C', options: ['A', 'B', 'C', 'D'], yes: ['C'] }])));
    const res = await quiet(() => callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/followups`, { text: '「昧」還有哪些常考的詞？', mode: 'explain' }));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.points).toBe(assistPoints('chinese', 'assist_followup'));
    expect(JSON.parse(row(s.env, `SELECT meta_json FROM assist_turns WHERE case_id = ? AND kind = 'followup'`, caseId).meta_json)).toEqual({ subject: 'chinese' });
    const fake = json(zhFollowupOutput({ mode_used: '講解' }));
    await run(s, fake);
    const req = fake.requests[0]!;
    expect(req.system).toBe(assistZhFollowupSystemText());
    expect(req.body.max_tokens).toBe(5_000);
    const content = req.body.messages[0].content as Array<{ text: string; cache_control?: unknown }>;
    expect(content).toHaveLength(3);
    expect(content.every((b) => b.cache_control === undefined)).toBe(true);
    expect(content[0]!.text).toContain('<analysis_digest>');
    expect(content[2]!.text).toContain('<student_text role="question">\n「昧」還有哪些常考的詞？\n</student_text>');
    const d = await detail(s, caseId);
    expect(d.followups).toBe(1);
    const reply = d.turns[1].reply;
    expect(reply).toMatchObject({ kind: 'zh_followup', mode_used: 'explain', new_error_codes: ['zh_literal'] });
    expect(d.error_codes).toContain('zh_literal');
    expect(d.error_codes).not.toContain('zh_task_offtrack');
  });
});

describe('國文轉錄（§6）', () => {
  async function photoCase(s: Setup): Promise<{ caseId: string; opId: string; points: number }> {
    const caseId = await createCase(s, { source: { source: 'photo', subject: 'chinese' } });
    seedAssistPhoto(s.env.DB, s.user.id, caseId);
    const res = await quiet(() => callAs(s.env, s.site, s.user, 'POST', `/api/assist/cases/${caseId}/ocr`, {}));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return { caseId, opId: res.body.op_id, points: res.body.points };
  }

  it('成功：國文的轉錄提示、1 張 3 點；題號正規化、注釋寫進文字開頭、ocr_ready、刪照片', async () => {
    const s = setup();
    const { caseId, opId, points } = await photoCase(s);
    expect(points).toBe(3);
    const fake = json(zhOcrOutput());
    await run(s, fake);
    expect(fake.requests[0]!.system).toBe(assistZhOcrSystemText());
    expect(fake.requests[0]!.body.max_tokens).toBe(8_000);
    expect(row(s.env, 'SELECT status, points_charged FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'settled', points_charged: 3 });
    const d = await detail(s, caseId);
    expect(d.status).toBe('ocr_ready');
    const ocr = d.turns[0].ocr;
    expect(ocr.blocks.map((b: any) => [b.kind, b.label])).toEqual([
      ['question', '12'],
      ['options', '12'],
      ['passage', null],
    ]);
    expect(ocr.blocks[2].text).toBe('注釋：①素昧平生：向來不認識。');
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM assist_photos WHERE case_id = ?', caseId).n).toBe(0);
    // 確認題目：區塊照轉錄送回，國文的檢查通過。
    const put = await quiet(() =>
      callAs(s.env, s.site, s.user, 'PUT', `/api/assist/cases/${caseId}/question`, {
        question: { blocks: ocr.blocks.map((b: any) => ({ kind: b.kind, label: b.label, text: b.text })), target_labels: [] },
      }),
    );
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body).toMatchObject({ status: 'ready', kind: 'zh_choice', subject: 'chinese' });
    expect(put.body.title).toMatch(/^國文・你拍的題目：/);
  });

  it('不是國文（other_subject）：以 invalid_output 退還、刪照片、案例回到 draft、畫面帶 detected_subject', async () => {
    const s = setup();
    const { caseId, opId } = await photoCase(s);
    await run(s, json(zhOcrOutput({ status: 'other_subject', detected_subject: 'english', blocks: [] })));
    expect(row(s.env, 'SELECT status, refund_reason FROM ai_ops WHERE id = ?', opId)).toEqual({ status: 'refunded', refund_reason: 'invalid_output' });
    expect(row(s.env, 'SELECT COUNT(*) AS n FROM assist_photos WHERE case_id = ?', caseId).n).toBe(0);
    const d = await detail(s, caseId);
    expect(d.status).toBe('draft');
    expect(d.turns[0]).toMatchObject({ status: 'failed', failure: 'invalid_output', detected_subject: 'english' });
    expect(JSON.parse(row(s.env, `SELECT detail_json FROM ops_events WHERE kind = 'assist_subject_mismatch'`).detail_json)).toMatchObject({ stage: 'ocr', detected_subject: 'english' });
  });

  it('答案段落整塊隱藏（answer_section），確認時送回固定說明會被擋', async () => {
    const s = setup();
    const { caseId } = await photoCase(s);
    const out = zhOcrOutput();
    out.blocks.push({ kind: 'passage', label: '', text: '【解析】素昧平生是向來不認識的意思，所以這一句完全正確', unclear: [] });
    await run(s, json(out));
    const d = await detail(s, caseId);
    const hidden = d.turns[0].ocr.blocks.find((b: any) => b.hidden === 'answer_section');
    expect(hidden).toBeTruthy();
    const put = await quiet(() =>
      callAs(s.env, s.site, s.user, 'PUT', `/api/assist/cases/${caseId}/question`, {
        question: { blocks: d.turns[0].ocr.blocks.map((b: any) => ({ kind: b.kind, label: b.label, text: b.text })), target_labels: [] },
      }),
    );
    expect(put.status).toBe(400);
    expect(put.body.error.reason).toBe('blocks_invalid');
  });
});
