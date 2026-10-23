/**
 * 錯題來源的轉接器（docs/design/learning-assistant.md §5.3、§6.3）：用各模組固定的 localStorage 形狀測 list() 與 resolve()。
 *   - 題庫練習按「再一組」之後只剩作答紀錄（outcomes）；
 *   - 歷屆試題重新開始後（作答被覆蓋）改讀作答紀錄；
 *   - 真題模考的填充（自評 → client_status）、中譯英與作文的「先送 AI 批改」列、紀錄超過 30 筆被刪掉後讀作答紀錄；
 *   - 自組卷：卷面題號 ↔ 原始題號、letterSwaps 的那一對；
 *   - 單字錯題本：多選、預設勾網址帶的字、題型與錯誤次數。
 * 題目資料用迷你考卷（exams/testFixtures.ts）、題庫範例輸出（practice/testFixtures.ts）與假自組卷（mock/bank/uiTestFixtures.ts）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { createAttempt, saveAttempt } from '../../exams/attempt';
import { MINI_EXAM, jsonResponse } from '../../exams/testFixtures';
import { bankRecord, fakeBankPaper } from '../../mock/bank/uiTestFixtures';
import { createMemorySnapshotStore, getSnapshotStore, setSnapshotStoreForTests, snapshotOf } from '../../mock/bank/snapshots';
import { findMockPaper } from '../../mock/papers';
import { HISTORY_KEY, createRecord, recordKey, saveRecord, type MockAttemptRecord } from '../../mock/storage';
import { resetPracticeHistoryForTests } from '../../practice/history';
import { GROUPS, MINI_VOCAB_INDEX } from '../../practice/testFixtures';
import { MISTAKES_STORAGE_KEY } from '../../vocab/lib/mistakes';
import { resetVocabStoresForTests } from '../../vocab/state';
import { bankSlotMappings } from '../outcomeBuilders';
import { recordOutcomes, resetOutcomesForTests, type OutcomeInput } from '../outcomes';
import { ADAPTERS, listMistakes, resolveAsk } from './index';

const T = Date.parse('2026-10-20T08:00:00.000Z');
const ISO = new Date(T).toISOString();
const WB = 'ai.wb.0a1b2c@1';

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.endsWith('/data/exams/gsat-115.json')) return jsonResponse(MINI_EXAM);
      if (url.endsWith('/data/vocab/index.json')) return jsonResponse(MINI_VOCAB_INDEX);
      const m = /\/data\/bank\/groups\/(.+)\.json$/.exec(url);
      const group = m?.[1] ? GROUPS[decodeURIComponent(m[1])] : undefined;
      if (group) return jsonResponse(group);
      return new Response('not found', { status: 404 });
    }),
  );
  resetOutcomesForTests();
  resetPracticeHistoryForTests();
  resetVocabStoresForTests();
});

afterEach(() => {
  clearDataCache();
  resetOutcomesForTests();
  setSnapshotStoreForTests(null);
});

function bankEntry(label: string, ok: 0 | 1, a: string, extra: Partial<OutcomeInput> = {}): OutcomeInput {
  return { s: 'bank', r: WB, g: 'ai.wb.0a1b2c', l: label, sec: 'word_bank', t: 'advanced', k: [], ok, a, at: T, ...extra };
}

describe('題庫練習', () => {
  it('按了「再一組」之後只剩作答紀錄：清單一組一列、確認頁照樣組得出來', async () => {
    const keys: Record<string, string> = { '1': 'E', '2': 'G', '3': 'B', '4': 'D', '5': 'I', '6': 'H', '7': 'C', '8': 'A', '9': 'F', '10': 'J' };
    recordOutcomes(
      Object.entries(keys).map(([l, k]) => {
        if (l === '1') return bankEntry(l, 0, 'G');
        if (l === '2') return bankEntry(l, 0, 'E');
        return bankEntry(l, 1, k, l === '4' ? { h: 2 } : {});
      }),
    );

    const rows = await ADAPTERS.bank.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'bank', section: 'word_bank', tier: 'advanced', wrong: 2, doubts: 1, kind: 'mistake', maybeFree: true });
    expect(rows[0]?.title).toMatch(/^本站題庫・文意選填（進階練習）：/);
    expect(rows[0]?.askHref).toBe('/assistant/ask?src=bank&ref=ai.wb.0a1b2c%401&label=1&label=2&label=4');
    // 本站解析：唯讀檢視那一次的作答（按了「再一組」也看得到），不是重新開一組空白的作答。
    expect(rows[0]?.links[0]).toEqual({ label: '本站解析（免費）', to: '/practice/word-bank/advanced?review=ai.wb.0a1b2c%401' });

    const resolved = await resolveAsk({ src: 'bank', ref: WB, labels: ['1', '2'] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.kind).toBe('item');
    // 預設：網址帶的兩格，再加同組的疑點（用了提示）；文意選填一次最多 5 格。
    expect(resolved.group).toMatchObject({ max: 5, defaults: ['1', '2', '4'], single: false });
    expect(resolved.preview.items.find((i) => i.label === '4')).toMatchObject({ status: 'doubt', hints: 2 });
    const source = resolved.sourceFor(['2', '1']);
    expect(source).toMatchObject({ source: 'bank', ref: WB, labels: ['1', '2'] });
    expect(source.source === 'bank' && source.answers).toMatchObject({ '1': 'G', '2': 'E', '3': 'B' });
    expect(resolved.signalsFor(['4'])).toMatchObject({ hints_used: 2 });
  });

  it('按了「再一組」之後：填充題的對錯與 client_status 用作答紀錄記下的（不重新判分）', async () => {
    const MX = 'ai.mx.0f1a2b@1';
    const entry = (label: string, ok: 0 | 0.5 | 1, a: string | string[] | null, extra: Partial<OutcomeInput> = {}): OutcomeInput => ({
      s: 'bank',
      r: MX,
      g: 'ai.mx.0f1a2b',
      l: label,
      sec: 'mixed',
      t: 'basic',
      k: [],
      ok,
      a,
      at: T,
      ...extra,
    });
    // 練習頁（有單字索引）判第 2 題 filing 錯（0 分）、第 4 題 weight 部分給分；沒有索引重新判分會得到不同的結果。
    recordOutcomes([entry('1', 1, 'turns'), entry('2', 0, 'filing', { cs: 'wrong' }), entry('3', 1, ['A', 'D']), entry('4', 0.5, 'weight', { cs: 'partial' })]);
    const resolved = await resolveAsk({ src: 'bank', ref: MX, labels: ['2'] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.preview.items.find((i) => i.label === '2')).toMatchObject({ status: 'wrong', clientJudged: true });
    expect(resolved.preview.items.find((i) => i.label === '4')).toMatchObject({ status: 'partial', clientJudged: true });
    expect(resolved.sourceFor(['2', '4'])).toMatchObject({ client_status: { '2': 'wrong', '4': 'partial' } });
  });

  it('這台裝置沒有這一組的作答：回 null（確認頁改提供貼上題目）', async () => {
    expect(await resolveAsk({ src: 'bank', ref: WB, labels: ['1'] })).toBeNull();
  });
});

describe('歷屆試題', () => {
  it('交卷後讀作答；重新開始（作答被覆蓋）之後改讀作答紀錄', async () => {
    const first = createAttempt('gsat-115', 'exam', 6000, new Date(T));
    saveAttempt({ ...first, answers: { '21': 'A', '22': 'A', '23': 'D' }, submittedAt: ISO, submitReason: 'manual' });
    const resolved = await resolveAsk({ src: 'exam', exam: 'gsat-115', labels: ['21'] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.preview.items.map((i) => [i.label, i.status])).toEqual([
      ['21', 'wrong'],
      ['22', 'correct'],
      ['23', 'correct'],
    ]);
    expect(resolved.group.defaults).toEqual(['21']);
    expect(resolved.sourceFor(['21'])).toEqual({ source: 'exam', exam_id: 'gsat-115', labels: ['21'], via: 'exam', answers: { '21': 'A', '22': 'A', '23': 'D' } });

    // 交卷時寫了作答紀錄；重新開始覆蓋了 gsat-exam-attempt:v1:gsat-115。
    recordOutcomes(
      (['21', '22', '23'] as const).map((l) => ({ s: 'exam' as const, r: 'gsat-115', g: 'gsat-115.s3g1', l, sec: 'word_bank' as const, k: [], ok: l === '21' ? (0 as const) : (1 as const), a: l === '21' ? 'A' : l === '22' ? 'A' : 'D', at: T })),
    );
    saveAttempt(createAttempt('gsat-115', 'exam', 6000, new Date(T + 1000)));
    const again = await resolveAsk({ src: 'exam', exam: 'gsat-115', labels: ['21'] });
    expect(again?.preview.items.find((i) => i.label === '21')).toMatchObject({ studentAnswer: 'A', status: 'wrong' });
    expect(again?.sourceFor(['21'])).toMatchObject({ answers: { '21': 'A', '22': 'A', '23': 'D' } });
  });
});

describe('歷屆試題：重新開始之後', () => {
  it('新的作答只看了別題的答案：錯題清單帶來的題改讀作答紀錄（不是「未作答」）', async () => {
    recordOutcomes(
      (['21', '22', '23'] as const).map((l) => ({ s: 'exam' as const, r: 'gsat-115', g: 'gsat-115.s3g1', l, sec: 'word_bank' as const, k: [], ok: l === '21' ? (0 as const) : (1 as const), a: l === '21' ? 'A' : l === '22' ? 'A' : 'D', at: T })),
    );
    // 重新開始（練習模式），只看了第 1 題的答案。
    const again = createAttempt('gsat-115', 'practice', null, new Date(T + 1000));
    saveAttempt({ ...again, answers: { '1': 'B' }, revealed: ['1'] });
    const resolved = await resolveAsk({ src: 'exam', exam: 'gsat-115', labels: ['21'] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.preview.items.find((i) => i.label === '21')).toMatchObject({ studentAnswer: 'A', status: 'wrong' });
    expect(resolved.sourceFor(['21'])).toMatchObject({ answers: { '21': 'A', '22': 'A', '23': 'D' } });
  });
});

describe('真題模考', () => {
  function submittedMock(answers: Record<string, string>, selfScores: Record<string, number> = {}): MockAttemptRecord {
    const paper = findMockPaper('gsat-115');
    if (!paper) throw new Error('找不到 115 學測模考');
    const r = createRecord(paper, 's1', { strict: false, predictedScore: null });
    return {
      ...r,
      status: 'submitted',
      submittedAt: ISO,
      submitReason: 'manual',
      selfScores,
      attempt: { ...r.attempt, answers, submittedAt: ISO, submitReason: 'manual' },
    };
  }

  it('填充題：自評的分數當成裝置上的判分（client_status）；via 是 mock', async () => {
    const record = submittedMock({ '47': 'innovate', '48': 'blended' }, { '47': 0 });
    saveRecord(record);
    const resolved = await resolveAsk({ src: 'mock', attempt: record.id, labels: ['47'] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.preview.items.find((i) => i.label === '47')).toMatchObject({ status: 'wrong', clientJudged: true });
    expect(resolved.preview.items.find((i) => i.label === '48')?.status).toBe('correct');
    expect(resolved.sourceFor(['47'])).toMatchObject({ source: 'exam', exam_id: 'gsat-115', via: 'mock', labels: ['47'], client_status: { '47': 'wrong' } });
  });

  it('中譯英、作文列成「先送 AI 批改」（不能直接問，連到成績單）', async () => {
    const record = submittedMock({ 英文作文: 'My essay about pets.' });
    saveRecord(record);
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([{ id: record.id, paperId: 'gsat-115', submittedAt: ISO, raw: 0, level: null, scaleYear: 115, predictedScore: null, pendingMax: 20 }]),
    );
    const rows = await ADAPTERS.mock.list();
    const writing = rows.filter((r) => r.key.startsWith('mock-writing|'));
    expect(writing).toHaveLength(1);
    expect(writing[0]).toMatchObject({ section: 'composition', askHref: null, maybeFree: false });
    expect(writing[0]?.title).toMatch(/英文作文（先送 AI 批改）$/);
    expect(writing[0]?.links[0]).toEqual({ label: '先送 AI 批改，再問學習助手', to: `/mock/report/${encodeURIComponent(record.id)}#self-assessment` });
  });

  it('模考紀錄超過 30 筆被刪掉：改讀作答紀錄（p＝作答紀錄 id）', async () => {
    const record = submittedMock({ '21': 'A' });
    recordOutcomes([{ s: 'mock', r: 'gsat-115', g: 'gsat-115.s3g1', l: '21', p: record.id, sec: 'word_bank', k: [], ok: 0, a: 'A', at: T }]);
    window.localStorage.removeItem(recordKey(record.id));
    const resolved = await resolveAsk({ src: 'mock', attempt: record.id, labels: ['21'] });
    expect(resolved?.preview.items.find((i) => i.label === '21')).toMatchObject({ studentAnswer: 'A', status: 'wrong' });
    expect(resolved?.sourceFor(['21'])).toMatchObject({ via: 'mock', answers: { '21': 'A' } });
    const rows = await ADAPTERS.mock.list();
    expect(rows[0]?.askHref).toBe(`/assistant/ask?src=mock&attempt=${record.id}&label=21`);
  });
});

describe('自組模考', () => {
  it('卷面題號 ↔ 原始題號、letterSwaps 的那一對、作答以原始題號為鍵（值是卷面字母）', async () => {
    setSnapshotStoreForTests(createMemorySnapshotStore());
    const paper = fakeBankPaper();
    await getSnapshotStore().put(snapshotOf(paper));
    const slot = bankSlotMappings(paper).find((s) => s.swap !== null);
    if (!slot?.swap) throw new Error('假卷子應該有一組閱讀交換了選項');
    const [qa, qb] = slot.swap;
    const displayA = slot.questions.find((q) => q.label === qa)?.display ?? '';
    expect(displayA).not.toBe('');
    const base = bankRecord(paper, { [displayA]: 'A' });
    const record: MockAttemptRecord = { ...base, status: 'submitted', submittedAt: ISO, submitReason: 'manual', attempt: { ...base.attempt, submittedAt: ISO, submitReason: 'manual' } };
    saveRecord(record);

    const resolved = await resolveAsk({ src: 'bankmock', attempt: record.id, labels: [displayA] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.displayOf(qa)).toBe(displayA);
    expect(resolved.group.defaults[0]).toBe(qa);
    expect(resolved.sourceFor([qa])).toEqual({
      source: 'bank_mock',
      paper_id: paper.id,
      ref: slot.key,
      labels: [qa],
      label_map: Object.fromEntries(slot.questions.map((q) => [q.label, q.display])),
      swap: [qa, qb],
      answers: { [qa]: 'A' },
    });
  });
});

describe('單字錯題本', () => {
  function seedMistakes() {
    const item = (entry_id: string, word: string, wrong_count: number, last_mode: string, at: number) => ({ entry_id, word, wrong_count, last_wrong_at: at, last_mode });
    window.localStorage.setItem(
      MISTAKES_STORAGE_KEY,
      JSON.stringify({
        schema: 'gsat-vocab-mistakes',
        version: 1,
        updated_at: T,
        items: {
          'postpone|v./(n.)|3': item('postpone|v./(n.)|3', 'postpone', 5, 'spelling', T),
          'afford|v.|3': item('afford|v.|3', 'afford', 3, 'en2zh', T - 1000),
          'quiet|adj./n./v.|1': item('quiet|adj./n./v.|1', 'quiet', 1, 'cloze', T - 2000),
        },
      }),
    );
    resetVocabStoresForTests();
  }

  it('清單：錯最多次的字一列，帶去確認頁的是這幾個字', async () => {
    seedMistakes();
    const rows = await ADAPTERS.vocab.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('單字錯題本：postpone、afford、quiet');
    expect(rows[0]?.askHref).toContain('entry=postpone');
  });

  it('多選：網址帶的字預設勾、其他錯題也列出來；送出題型與錯誤次數', async () => {
    seedMistakes();
    const resolved = await resolveAsk({ src: 'vocab', entries: ['afford|v.|3', 'postpone|v./(n.)|3'] });
    if (!resolved) throw new Error('應該組得出來');
    expect(resolved.kind).toBe('vocab');
    expect(resolved.group).toMatchObject({ max: 8, defaults: ['afford|v.|3', 'postpone|v./(n.)|3'], single: false });
    expect(resolved.preview.items.map((i) => i.display)).toEqual(['afford', 'postpone', 'quiet']);
    expect(resolved.displayOf('quiet|adj./n./v.|1')).toBe('quiet');
    expect(resolved.sourceFor(['afford|v.|3', 'quiet|adj./n./v.|1'])).toEqual({
      source: 'vocab',
      entries: [
        { entry_id: 'afford|v.|3', mode: 'en2zh', wrong_count: 3 },
        { entry_id: 'quiet|adj./n./v.|1', mode: 'cloze', wrong_count: 1 },
      ],
    });
  });
});

describe('listMistakes', () => {
  it('沒登入不打寫作批改的 API；任何一個來源讀不到都不影響其他來源', async () => {
    recordOutcomes([bankEntry('1', 0, 'G')]);
    window.localStorage.setItem(MISTAKES_STORAGE_KEY, '{broken');
    resetVocabStoresForTests();
    const rows = await listMistakes({ signedIn: false });
    expect(rows.map((r) => r.source)).toEqual(['bank']);
    expect(vi.mocked(fetch).mock.calls.map(([u]) => urlOf(u as RequestInfo)).filter((u) => u.includes('/api/'))).toEqual([]);
  });
});
