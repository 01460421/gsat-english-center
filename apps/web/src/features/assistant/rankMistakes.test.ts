/**
 * 錯題清單的「建議先問」（rankMistakes.ts，§5.9）與推薦練習的候選（candidates.ts，§2.4、§5.6）：排序與穩定性。
 */
import { describe, expect, it } from 'vitest';
import { practiceTierFrom, rankPracticeCandidates, reportCandidates, type CandidateEntry } from './candidates';
import type { OutcomeEntry } from './outcomes';
import { peerRate, percentileOfLevel, rankMistakes, skillClusterNotes, weakestSkills } from './rankMistakes';
import type { MistakeRow } from './sources/types';

function row(key: string, patch: Partial<MistakeRow> = {}): MistakeRow {
  return {
    key,
    source: 'exam',
    title: key,
    section: 'reading',
    tier: null,
    labels: ['1'],
    wrong: 1,
    partial: 0,
    unanswered: 0,
    doubts: 0,
    kind: 'mistake',
    at: 1_000,
    askHref: `/assistant/ask?src=exam&exam=gsat-115&label=${key}`,
    links: [],
    skills: [],
    nationalRate: null,
    fiveGroups: null,
    maybeFree: true,
    groupRef: 'gsat-115',
    ...patch,
  };
}

describe('rankMistakes', () => {
  it('peerRate：五組放在百分位 10、30、50、70、90，中間線性內插，兩端不外插', () => {
    const g = [0.9, 0.7, 0.5, 0.3, 0.1];
    expect(peerRate(g, 5)).toBe(0.9);
    expect(peerRate(g, 20)).toBeCloseTo(0.8);
    expect(peerRate(g, 95)).toBe(0.1);
    expect(peerRate([1, 2], 50)).toBeNull();
    expect(percentileOfLevel(11)).toBe(30.4);
  });

  it('同程度考生大多答對的排最前；其次最弱技能；其他錯題新到舊；疑點最後', () => {
    const rows = [
      row('doubt', { kind: 'doubt', wrong: 0, doubts: 1, at: 9_000 }),
      row('recent-old', { at: 1_000 }),
      row('recent-new', { at: 5_000 }),
      row('weak', { skills: ['tp:inference'], at: 500 }),
      // 前標（百分位 30.4）的同程度答對率 ≈ 0.7。
      row('peers', { fiveGroups: [0.9, 0.7, 0.5, 0.3, 0.1], nationalRate: 0.5, at: 100 }),
    ];
    const ranked = rankMistakes(rows, { weakSkills: ['tp:inference'] });
    expect(ranked.map((r) => r.row.key)).toEqual(['peers', 'weak', 'recent-new', 'recent-old', 'doubt']);
    expect(ranked[0]?.note).toBe('同程度考生大多答對');
  });

  it('目標在均標以下：全國答對率 < 0.3 的題往後排（在疑點之前），標「可以先放」', () => {
    const rows = [row('hard', { nationalRate: 0.2, at: 9_000 }), row('normal', { at: 1_000 }), row('doubt', { kind: 'doubt', at: 9_999 })];
    const below = rankMistakes(rows, { targetLevel: 7 });
    expect(below.map((r) => r.row.key)).toEqual(['normal', 'hard', 'doubt']);
    expect(below[1]?.note).toBe('這題全國答對率很低，可以先放');
    // 目標前標：不往後排。
    expect(rankMistakes(rows, { targetLevel: 11 }).map((r) => r.row.key)).toEqual(['hard', 'normal', 'doubt']);
  });

  it('結果穩定：同時間的依 key；「新到舊」只看時間', () => {
    const rows = [row('b'), row('a'), row('c', { at: 2_000 })];
    expect(rankMistakes(rows).map((r) => r.row.key)).toEqual(['c', 'a', 'b']);
    expect(rankMistakes([...rows].reverse()).map((r) => r.row.key)).toEqual(['c', 'a', 'b']);
    expect(rankMistakes(rows, { sort: 'recent' }).map((r) => r.row.key)).toEqual(['c', 'a', 'b']);
  });

  it('weakestSkills：作答 ≥ 5 次、首次答對率最低的在前', () => {
    const e = (k: string, ok: 0 | 1, first: 0 | 1 = 1): OutcomeEntry => ({ s: 'bank', r: 'x@1', g: 'x', l: '1', sec: 'reading', k: [k], ok, a: 'A', first, at: 0 });
    const entries = [
      ...Array.from({ length: 5 }, () => e('tp:inference', 0)),
      ...Array.from({ length: 5 }, (_, i) => e('tp:main_idea', i < 3 ? 1 : 0)),
      ...Array.from({ length: 4 }, () => e('tp:detail', 0)),
    ];
    expect(weakestSkills(entries)).toEqual(['tp:inference', 'tp:main_idea']);
  });

  it('同技能的題庫題 3 列以上：合併提示', () => {
    const rows = ['a', 'b', 'c'].map((k) => row(k, { source: 'bank', skills: ['tp:collocation'] }));
    const notes = skillClusterNotes(rows);
    expect(notes.size).toBe(3);
    expect(notes.get('a')).toMatch(/^3 組都在考「.+」，建議只問其中一組，其他先看本站解析$/);
    expect(skillClusterNotes(rows.slice(0, 2)).size).toBe(0);
  });
});

describe('candidates', () => {
  const entry = (uid: string, section: string, tier: CandidateEntry['tier'], skills?: string[]): CandidateEntry => ({
    uid,
    version: 1,
    section_type: section,
    tier,
    topic: null,
    ...(skills ? { skills } : {}),
  });

  it('同大題 → 技能交集 → 同難度、其次低一級 → 沒做過 → uid', () => {
    const entries = [
      entry('ai.rd.000005', 'reading', 'advanced'),
      entry('ai.rd.000004', 'reading', 'basic', ['tp:inference']),
      entry('ai.rd.000003', 'reading', 'advanced', ['tp:inference']),
      entry('ai.rd.000002', 'reading', 'advanced', ['tp:inference']),
      entry('ai.wb.000001', 'word_bank', 'advanced', ['tp:inference']),
    ];
    const ranked = rankPracticeCandidates(entries, { section: 'reading', skill_codes: ['tp:inference'] }, { tier: 'advanced', done: new Set(['ai.rd.000002']) });
    expect(ranked.map((r) => r.ref)).toEqual(['ai.rd.000003@1', 'ai.rd.000002@1', 'ai.rd.000004@1']);
    // 不推薦別的題型。
    expect(ranked.some((r) => r.entry.section_type !== 'reading')).toBe(false);
  });

  it('索引沒有 skills：只用大題與難度', () => {
    const entries = [entry('ai.rd.b', 'reading', 'top'), entry('ai.rd.a', 'reading', 'advanced'), entry('ai.rd.c', 'reading', 'basic')];
    expect(rankPracticeCandidates(entries, { section: 'reading', skill_codes: ['tp:inference'] }, { tier: 'advanced', done: new Set() }).map((r) => r.entry.uid)).toEqual([
      'ai.rd.a',
      'ai.rd.c',
      'ai.rd.b',
    ]);
  });

  it('practiceTierFrom：prefs 優先；否則依做最多的難度與得分率上下調一級', () => {
    expect(practiceTierFrom('top', [])).toBe('top');
    expect(practiceTierFrom(null, [])).toBe('basic');
    expect(practiceTierFrom(null, [{ tier: 'basic', correct: 8, total: 10 }])).toBe('advanced');
    expect(practiceTierFrom(null, [{ tier: 'advanced', correct: 3, total: 10 }])).toBe('basic');
    expect(practiceTierFrom(null, [{ tier: 'advanced', correct: 5, total: 10 }])).toBe('advanced');
  });

  it('reportCandidates：最多 14 組題庫題＋6 份沒做過或最久沒做的學測卷，總數 ≤ 24', () => {
    const bank = Array.from({ length: 30 }, (_, i) => entry(`ai.rd.${String(i).padStart(6, '0')}`, 'reading', 'advanced'));
    const exams = ['gsat-115', 'gsat-114', 'gsat-113', 'gsat-112', 'gsat-111', 'gsat-110', 'gsat-109', 'ast-110'].map((id, i) => ({ id, lastAt: i === 0 ? 5_000 : null }));
    const refs = reportCandidates({ bank, weakSkills: [], focusSections: ['reading'], tier: 'advanced', done: new Set(), exams });
    expect(refs.filter((r) => r.startsWith('ai.'))).toHaveLength(3);
    expect(refs.filter((r) => r.startsWith('exam:'))).toEqual(['exam:gsat-114', 'exam:gsat-113', 'exam:gsat-112', 'exam:gsat-111', 'exam:gsat-110', 'exam:gsat-109']);
    expect(refs.length).toBeLessThanOrEqual(24);
  });
});
