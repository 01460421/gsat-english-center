/**
 * 學習報告的本機摘要（docs/design/learning-assistant.md §5.5；§6.3 summary.ts）：範例資料算出的摘要、sections 依來源分開、
 * plan_progress、word 的格式、≤ 16 KB、不含題目文字與作答。
 */
import { ASSIST_LIMITS, ASSIST_SUMMARY_WORD_PATTERN } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import type { MockReport } from '../mock/report';
import type { MockHistoryEntry } from '../mock/storage';
import type { DoneRecord } from '../practice/history';
import type { MistakeBook } from '../vocab/lib/mistakes';
import type { SrsState, StoredCard } from '../vocab/lib/srs';
import type { OutcomeEntry } from './outcomes';
import { encodeBk2 } from '../mock/bank/code2';
import { buildSummary, countsAsMock, fitSummary, mockRow, summaryBytes, summaryRange, type SummaryInput } from './summary';

const NOW = Date.parse('2026-11-20T02:00:00.000Z');
const DAY = 86_400_000;

function o(extra: Partial<OutcomeEntry>): OutcomeEntry {
  return { s: 'bank', r: 'ai.wb.0a1b2c@1', g: 'ai.wb.0a1b2c', l: '1', sec: 'word_bank', t: 'advanced', k: [], ok: 1, a: 'A', first: 1, at: NOW - DAY, ...extra };
}

function outcomes(): OutcomeEntry[] {
  return [
    // 歷屆閱讀：3 題，對 1（含一題 5 天前，近 30 天內）。
    o({ s: 'exam', r: 'gsat-114', g: 's5g1', l: '41', sec: 'reading', t: undefined, k: ['it:inference'], ok: 0, a: 'B', key: 'C', c: 'DS', at: NOW - 5 * DAY }),
    o({ s: 'exam', r: 'gsat-114', g: 's5g1', l: '42', sec: 'reading', t: undefined, k: ['it:detail'], ok: 1, a: 'A', key: 'A', np: 0.6 }),
    o({ s: 'mock', r: 'gsat-113', g: 's5g1', l: '41', sec: 'reading', t: undefined, k: ['it:inference'], ok: 0, a: null, first: 0, m: 1, at: NOW - 40 * DAY }),
    // 題庫文意選填（進階）：2 題，對 1；一題用了提示。
    o({ l: '1', k: ['tp:collocation', 'xx:not_a_code'], ok: 0, a: 'G', h: 2 }),
    o({ l: '2', k: ['tp:collocation'], ok: 0.5, a: 'E', rv: 1 }),
    // 自組卷（基礎）的篇章結構。
    o({ s: 'bank_mock', r: 'ai.st.3a4b5c@1', g: 'ai.st.3a4b5c', l: '1', d: '41', p: 'bk1-b-xyz', sec: 'structure', t: 'basic', k: ['cl:contrast'], ok: 1, a: 'B' }),
    // 一年前的：統計期間放寬到全部時才算。
    o({ l: '3', at: NOW - 365 * DAY, ok: 1 }),
  ];
}

function book(): MistakeBook {
  const item = (entry_id: string, word: string, wrong_count: number) => ({ entry_id, word, wrong_count, last_wrong_at: NOW - DAY, last_mode: 'en2zh' as const });
  return {
    schema: 'gsat-vocab-mistakes',
    version: 1,
    items: {
      'postpone|v.|3': item('postpone|v.|3', 'postpone', 4),
      'abroad|adv.|2': item('abroad|adv.|2', 'abroad', 2),
      // 單字頭含不允許的字元：不送。
      'weird|n.|4': item('weird|n.|4', '<b>weird</b>', 9),
    },
    updated_at: NOW,
  } as unknown as MistakeBook;
}

function srs(): SrsState {
  const card = (due: number, lapses: number) => ({ due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 3, lapses, state: 2, last_review: NOW - DAY, added_at: NOW - 30 * DAY, updated_at: NOW }) as StoredCard;
  return { cards: { 'a|n.|1': card(NOW - DAY, 0), 'b|n.|1': card(NOW + 5 * DAY, 3), 'c|n.|1': card(NOW + 9 * DAY, 4) } } as unknown as SrsState;
}

function input(extra: Partial<SummaryInput> = {}): SummaryInput {
  const done: Record<string, DoneRecord> = {
    'ai.wb.0a1b2c': { version: 1, section: 'word_bank', tier: 'advanced', at: new Date(NOW - DAY).toISOString(), correct: 6, total: 10, hinted: 1 },
    'ai.rd.0c1d2e': { version: 1, section: 'reading', tier: 'basic', at: new Date(NOW - 400 * DAY).toISOString(), correct: 3, total: 4, hinted: 0 },
  };
  return { now: NOW, outcomes: outcomes(), bankDone: done, mocks: [], vocab: { book: book(), srs: srs() }, planProgress: null, ...extra };
}

describe('buildSummary（§5.5）', () => {
  it('sections 依大題與來源分開；全部、首次接觸、近 30 天、提示、未作答各自計數；部分給分不算答對', () => {
    const s = buildSummary(input());
    expect(s.v).toBe(2);
    expect(s.generated_at).toBe('2026-11-20T02:00:00.000Z');
    // 期間內只有 6 筆（< 100）→ 放寬到全部（最早一筆在 365 天前）。
    expect(s.range_days).toBe(365);
    expect(s.sections).toEqual([
      { section: 'word_bank', src: 'bank:advanced', n: 3, correct: 1, first_n: 3, first_correct: 1, recent_n: 2, recent_correct: 0, hinted: 1, unanswered: 0 },
      { section: 'structure', src: 'bank_mock:basic', n: 1, correct: 1, first_n: 1, first_correct: 1, recent_n: 1, recent_correct: 1, hinted: 0, unanswered: 0 },
      { section: 'reading', src: 'official', n: 3, correct: 1, first_n: 2, first_correct: 1, recent_n: 2, recent_correct: 1, hinted: 0, unanswered: 1 },
    ]);
    for (const r of s.sections) expect(r.correct).toBeLessThanOrEqual(r.n);
  });

  it('技能只收封閉清單裡的代碼（依次數排）；陷阱只算答錯時選到的；標記與先看答案的次數', () => {
    const s = buildSummary(input());
    expect(s.skills.map((x) => x.code)).toEqual(['it:inference', 'tp:collocation', 'cl:contrast', 'it:detail']);
    expect(s.skills[0]).toEqual({ code: 'it:inference', n: 2, correct: 0, first_n: 1, first_correct: 0 });
    expect(s.traps).toEqual([{ code: 'DS', n: 1 }]);
    expect(s.behaviour).toEqual({ marked: 1, revealed: 1, fast_wrong: null });
  });

  it('題庫練習的每組彙總只算統計期間內；單字：級別分布、錯最多的字（格式不對的不送）、複習卡片', () => {
    const s = buildSummary(input({ outcomes: outcomes().slice(0, 6) }));
    // 6 筆都在 90 天內：放寬也不會多，期間照舊是 90 天。
    expect(s.range_days).toBe(90);
    expect(s.bank_groups).toEqual([{ section: 'word_bank', tier: 'advanced', groups: 1, correct: 6, total: 10 }]);
    expect(s.vocab.mistakes).toBe(3);
    expect(s.vocab.by_level).toEqual({ '1': 0, '2': 1, '3': 1, '4': 1, '5': 0, '6': 0 });
    expect(s.vocab.top.map((t) => t.word)).toEqual(['postpone', 'abroad']);
    for (const t of s.vocab.top) expect(t.word).toMatch(ASSIST_SUMMARY_WORD_PATTERN);
    expect(s.vocab.srs).toEqual({ cards: 3, due: 1, lapses_ge3: 2 });
    expect(s.coverage).toEqual({ outcomes: 6, first_at: new Date(NOW - 40 * DAY).toISOString(), devices_note: 'this_device' });
  });

  it('plan_progress 原樣帶上；沒有資料時是空的摘要', () => {
    const progress = { report_id: '11111111-1111-4111-8111-111111111111', since: '2026-11-01T00:00:00.000Z', recs: [], checklist: [{ kind: 'bank_practice' as const, done: 1, total: 2 }] };
    expect(buildSummary(input({ planProgress: progress })).plan_progress).toEqual(progress);
    const empty = buildSummary({ now: NOW, outcomes: [], bankDone: {}, mocks: [], vocab: { book: null, srs: null }, planProgress: null });
    expect(empty).toMatchObject({ range_days: 90, sections: [], skills: [], traps: [], bank_groups: [], mocks: [], vocab: { mistakes: 0, top: [], srs: null }, coverage: { outcomes: 0, first_at: null } });
  });

  it('不含題目文字、作答、自組卷代號與題組代號（掃描整份 JSON）', () => {
    const text = JSON.stringify(buildSummary(input()));
    for (const s of ['gsat-114', 'ai.wb.0a1b2c', 'bk1-b-xyz', '"G"', '"key"', 'weird']) expect(text).not.toContain(s);
  });

  it('統計期間：最近 90 天有 ≥ 100 題時只看 90 天', () => {
    const many = Array.from({ length: 120 }, (_, i) => o({ l: String(i), at: NOW - DAY }));
    const r = summaryRange([...many, o({ l: 'old', at: NOW - 200 * DAY })], NOW);
    expect(r).toMatchObject({ days: 90 });
    expect(r.items).toHaveLength(120);
  });
});

describe('fitSummary：≤ 16 KB', () => {
  it('太大時依序縮減，結果在上限內；本來就在上限內的原樣回傳', () => {
    const s = buildSummary(input());
    expect(fitSummary(s)).toBe(s);
    const skills = Array.from({ length: 40 }, (_, i) => ({ code: `tp:collocation`, n: 1000 + i, correct: 1, first_n: 1, first_correct: 1 }));
    const mock = { kind: 'exam' as const, paper: 'gsat-114', at: '2026-11-10T09:00:00.000Z', raw: 58, max: 100, level: 9, scale_year: 114, predicted: 60, nonmc: null, sections: Array.from({ length: 12 }, () => ({ section: 'reading' as const, earned: 10, max: 24, time_sec: 1800, suggested_sec: 1500 })) };
    const big = { ...s, skills, mocks: Array.from({ length: 5 }, () => mock), sections: Array.from({ length: 77 }, () => s.sections[0]!) };
    expect(summaryBytes(big)).toBeGreaterThan(ASSIST_LIMITS.summaryMaxBytes);
    const fit = fitSummary(big);
    expect(summaryBytes(fit)).toBeLessThanOrEqual(ASSIST_LIMITS.summaryMaxBytes);
    expect(fit.skills.length).toBeLessThanOrEqual(20);
  });
});

describe('mockRow：模考成績單 → 摘要的一列', () => {
  const entry: MockHistoryEntry = { id: 'att-1', paperId: 'gsat-114', submittedAt: '2026-11-10T09:00:00.000Z', raw: 58.5, level: 9, scaleYear: 114, predictedScore: 60, pendingMax: 0 };
  const report = {
    fullScore: 100,
    sections: [
      { sectionId: 's5', type: 'reading', title: '', label: '閱讀測驗', max: 24, earned: 14, pendingMax: 0, questionCount: 12, answeredCount: 12, autoCount: 12, correctCount: 7, timeSec: 1800.4, suggestedSec: 1500, national: null, nationalNote: null },
      { sectionId: 's7', type: 'translation', title: '', label: '中譯英', max: 8, earned: 3, pendingMax: 0, questionCount: 2, answeredCount: 2, autoCount: 0, correctCount: 0, timeSec: 600, suggestedSec: null, national: null, nationalNote: null },
    ],
    openItems: [
      { label: '1', sectionId: 's7', kind: 'translation', max: 4, score: 2, source: 'self' },
      { label: '2', sectionId: 's7', kind: 'translation', max: 4, score: 1, source: 'self' },
      { label: '3', sectionId: 's8', kind: 'composition', max: 20, score: null, source: 'pending' },
    ],
  } as unknown as MockReport;

  it('真題卷：考卷 id、分數、級分、各大題得分與用時；中譯英自評、作文還沒自評', () => {
    expect(mockRow(entry, report, null)).toEqual({
      kind: 'exam',
      paper: 'gsat-114',
      at: '2026-11-10T09:00:00.000Z',
      raw: 58.5,
      max: 100,
      level: 9,
      scale_year: 114,
      predicted: 60,
      nonmc: { translation: { earned: 3, max: 8, basis: 'self' }, essay: { earned: 0, max: 20, basis: 'none' } },
      sections: [
        { section: 'reading', earned: 14, max: 24, time_sec: 1800, suggested_sec: 1500 },
        { section: 'translation', earned: 3, max: 8, time_sec: 600, suggested_sec: 0 },
      ],
    });
  });

  it('自組卷：只送難度代碼（不送卷子代號）、不換算級分；考卷讀不到時各大題留空', () => {
    const bank = { ...entry, paperId: 'bk1-a-0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjkmnpqrstvwxyz01', level: null };
    const row = mockRow(bank, null, 'advanced');
    expect(row).toMatchObject({ kind: 'bank', paper: 'a', level: null, scale_year: null, predicted: null, nonmc: null, sections: [] });
    expect(JSON.stringify(row)).not.toContain('bk1-');
  });
});

describe('加強卷的證據規則與模考（docs/design/weak-paper.md §5.2、§9.4）', () => {
  const slot = (uid: string) => ({ ns: 'ai' as const, section: 'reading' as const, tier: 'advanced' as const, uid, v: 1 });
  const wId = encodeBk2('w', [slot('ai.rd.0a0001'), slot('ai.rd.0a0002')]);
  const rId = encodeBk2('r', [slot('ai.rd.0a0003')]);
  const sharedW = encodeBk2('w', [slot('ai.rd.0a0004')]);
  const reading = (p: string, l: string, k: string[], ok: 0 | 1) =>
    o({ s: 'bank_mock', r: 'ai.rd.0a0001@1', g: 'ai.rd.0a0001', l, d: l, p, sec: 'reading', t: 'advanced', k, ok, a: 'A' });
  const rows = [
    // 弱點加強卷（目標：推論）：推論題不算進大題，其他題算。
    reading(wId, '1', ['it:inference'], 0),
    reading(wId, '2', ['it:detail'], 1),
    // 隨機抽題卷：全部算。
    reading(rId, '1', ['it:inference'], 0),
    // 別人分享來的弱點加強卷（清單裡沒有）：整份不算進大題。
    reading(sharedW, '1', ['it:detail'], 0),
  ];
  const papers = new Map([[wId, { kind: 'w', targetCodes: { reading: ['it:inference'] } }]]);

  it('各大題答對率只收 isSectionEvidence 的紀錄；技能與陷阱照全部算', () => {
    const s = buildSummary(input({ outcomes: rows, papers }));
    const row = s.sections.find((x) => x.section === 'reading' && x.src === 'bank_mock:advanced');
    expect(row?.n).toBe(2);
    expect(row?.correct).toBe(1);
    const inference = s.skills.find((x) => x.code === 'it:inference');
    expect(inference?.n).toBe(2);
    // 不給清單時，弱點加強卷整份不算（隨機抽題卷照算）。
    const none = buildSummary(input({ outcomes: rows }));
    expect(none.sections.find((x) => x.section === 'reading' && x.src === 'bank_mock:advanced')?.n).toBe(1);
  });

  it('只有歷屆卷、自組模擬考與中性模考格式卷算「最近 5 份模考」', () => {
    const fullSlots = (['vocabulary', 'cloze', 'cloze', 'word_bank', 'structure', 'reading', 'reading', 'reading', 'mixed', 'translation', 'composition'] as const).map((section, i) => ({
      ns: 'ai' as const,
      section,
      tier: 'basic' as const,
      uid: `ai.${{ vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx', translation: 'tr', composition: 'cp' }[section]}.0b00${String(i).padStart(2, '0')}`,
      v: 1,
    }));
    expect(countsAsMock('gsat-114')).toBe(true);
    expect(countsAsMock('bk1-a-0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjkmnpqrstvwxyz01')).toBe(true);
    expect(countsAsMock(encodeBk2('m', fullSlots))).toBe(true);
    expect(countsAsMock(encodeBk2('f', fullSlots))).toBe(false);
    expect(countsAsMock(wId)).toBe(false);
    expect(countsAsMock(rId)).toBe(false);
    // 中性模考格式卷的一列：只送難度代碼，不送代號。
    const row = mockRow({ id: 'x', paperId: encodeBk2('m', fullSlots), submittedAt: new Date(NOW).toISOString(), raw: 50, level: null, predictedScore: null, scaleYear: null } as unknown as MockHistoryEntry, null, 'basic');
    expect(row).toMatchObject({ kind: 'bank', paper: 'b', level: null });
    expect(JSON.stringify(row)).not.toContain('bk2-');
  });
});
