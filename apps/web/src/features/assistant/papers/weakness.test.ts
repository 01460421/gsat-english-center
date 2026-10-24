/**
 * 弱點模型（docs/design/weak-paper.md §5、§10.1 的 weakness.test.ts）。只用測試裡造的作答紀錄。
 */
import { ASSIST_ERROR_CODES, BANK_UID_CODES, assistSkillLabel, canonicalSkill, isAssistSkillCode, type AssistReportDetail, type BankSectionType } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import type { PaperSkills } from '../../mock/bank/paperSkills';
import { targetCodesBySection } from '../../mock/bank/weakPapers';
import { rngFromSeed } from '../../mock/bank/random';
import type { OutcomeEntry } from '../outcomes';
import { peerRate, percentileOfLevel } from '../rankMistakes';
import { ERROR_TARGETS } from './errorTargets';
import { focusFromOutcomes, focusFromRows } from './focus';
import { maintenanceText } from './reasons';
import { READING_TRAP_COMPOSITIONS, parseComposition } from './testFixtures';
import {
  WEAKNESS_PARAMS,
  computeWeakness,
  isSectionEvidence,
  isTrapWeakness,
  mergeWeights,
  priorityWeight,
  recencyWeight,
  reportFactor,
  trapExcess,
  wrongGroupsFrom,
  type WeaknessInput,
  type WeakTarget,
} from './weakness';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-23T00:00:00.000Z');
const DIAG = 'bk2-m-0000001'; // 只當 p 的值用（證據規則與上限只看清單）
const EMPTY_SKILLS: PaperSkills = { version: 't', codeSections: {}, groups: {} };

let seq = 0;
function rec(p: Partial<OutcomeEntry> & Pick<OutcomeEntry, 'sec' | 'ok'>): OutcomeEntry {
  seq += 1;
  const code = BANK_UID_CODES[p.sec as BankSectionType] ?? 'rd';
  return { s: 'bank', r: `ai.${code}.${seq.toString(16).padStart(6, '0')}@1`, g: `g${seq}`, l: '1', k: [], a: 'A', first: 1, at: NOW - DAY, t: 'advanced', ...p };
}

/** n 題、其中 correct 題答對（其他欄位相同）。 */
function many(n: number, correct: number, p: Partial<OutcomeEntry> & Pick<OutcomeEntry, 'sec'>): OutcomeEntry[] {
  return Array.from({ length: n }, (_, i) => rec({ ...p, ok: i < correct ? 1 : 0 }));
}

function input(outcomes: OutcomeEntry[], extra: Partial<WeaknessInput> = {}): WeaknessInput {
  return { outcomes, skills: EMPTY_SKILLS, papers: new Map(), prefs: { practiceTier: 'advanced' }, ...extra };
}

function target(profile: { targets: WeakTarget[] }, key: string): WeakTarget | undefined {
  return profile.targets.find((t) => t.key === key);
}

describe('時間權重、平滑與門檻', () => {
  it('半衰期 30 天：30 天前的紀錄權重是今天的一半', () => {
    expect(recencyWeight(NOW, NOW)).toBe(1);
    expect(recencyWeight(NOW - 30 * DAY, NOW)).toBeCloseTo(0.5, 10);
    expect(recencyWeight(NOW - 60 * DAY, NOW)).toBeCloseTo(0.25, 10);
  });

  it('平滑：1 題錯的技能不成為弱點；8 題錯 6 題的會（殘差 3.6／12 ＝ 0.3）', () => {
    const others = many(20, 14, { sec: 'reading', at: NOW });
    const one = computeWeakness(input([...others, rec({ sec: 'reading', ok: 0, k: ['it:inference'], at: NOW })]), NOW);
    expect(target(one, 'skill:reading:it:inference')).toBeUndefined();
    const eight = computeWeakness(input([...others, ...many(8, 2, { sec: 'reading', k: ['it:inference'], at: NOW })]), NOW);
    expect(target(eight, 'skill:reading:it:inference')?.residual).toBeCloseTo(0.3, 10);
  });

  it('同一份作答最多 4 題：一份 20 題全錯的模考，單一技能的殘差 ≤ 4 題全錯能造成的值；診斷卷不受這個上限', () => {
    const others = many(20, 14, { sec: 'reading', at: NOW, s: 'bank' });
    const paper = 'bk1-a-' + 'm00061'.repeat(11);
    const bad = many(20, 0, { sec: 'reading', k: ['it:detail'], at: NOW, s: 'bank_mock', p: paper });
    const capped = computeWeakness(input([...others, ...bad]), NOW);
    const fourWrong = (4 * 0.7) / (4 + 4);
    expect(target(capped, 'skill:reading:it:detail')?.residual).toBeCloseTo(fourWrong, 10);
    const diag = bad.map((e) => ({ ...e, p: DIAG }));
    const uncapped = computeWeakness(input([...others, ...diag], { papers: new Map([[DIAG, { kind: 'm', targetCodes: {}, diagnostic: true }]]) }), NOW);
    expect(target(uncapped, 'skill:reading:it:detail')?.residual).toBeCloseTo((20 * 0.7) / 24, 10);
  });
});

describe('疑點與難度', () => {
  it('答對但標記過：技能弱點算 0.5，大題弱點算 1；標記三成、答對 75% 的學生不會冒出大題弱點；預覽的答對率同 first_correct', () => {
    const records = Array.from({ length: 40 }, (_, i) => rec({ sec: 'reading', ok: i < 30 ? 1 : 0, ...(i % 10 < 3 ? { m: 1 as const } : {}), at: NOW }));
    const p = computeWeakness(input(records), NOW);
    expect(target(p, 'sec:reading')).toBeUndefined();
    // 技能：6 題全對但都標記過 → y＝0.5，比基準（約 0.7）低。
    const skill = many(6, 6, { sec: 'reading', k: ['it:purpose'], m: 1, at: NOW });
    const withSkill = computeWeakness(input([...many(20, 14, { sec: 'reading', at: NOW }), ...skill]), NOW);
    expect(target(withSkill, 'skill:reading:it:purpose')?.residual).toBeCloseTo((6 * 0.7 - 3) / 10, 10);
    const unmarked = computeWeakness(input([...many(20, 14, { sec: 'reading', at: NOW }), ...many(6, 6, { sec: 'reading', k: ['it:purpose'], at: NOW })]), NOW);
    expect(target(unmarked, 'skill:reading:it:purpose')).toBeUndefined();
  });

  it('難度混淆：推論全在進階練習、答對率和其他進階閱讀一樣 → 不是弱點；進階推論 30%、其他進階閱讀 60% → 是', () => {
    const basic = many(20, 17, { sec: 'reading', t: 'basic', at: NOW });
    const advOthers = many(20, 11, { sec: 'reading', t: 'advanced', at: NOW });
    const inference = many(20, 11, { sec: 'reading', t: 'advanced', k: ['it:inference'], at: NOW });
    expect(target(computeWeakness(input([...basic, ...advOthers, ...inference]), NOW), 'skill:reading:it:inference')).toBeUndefined();
    const weak = computeWeakness(input([...basic, ...many(20, 12, { sec: 'reading', t: 'advanced', at: NOW }), ...many(10, 3, { sec: 'reading', t: 'advanced', k: ['it:inference'], at: NOW })]), NOW);
    const b = (12 + 2.8) / 24;
    expect(target(weak, 'skill:reading:it:inference')?.residual).toBeCloseTo((10 * b - 3) / 14, 10);
  });

  it('歷屆題：有五等分組時用目標級分百分位的期望（peerRate）；沒有時用全國答對率', () => {
    const g5 = [0.9, 0.8, 0.6, 0.4, 0.2];
    // 每一題是不同的一次作答（不同的作答時間），不受單份上限影響。
    const exam = (r: string, extra: Partial<OutcomeEntry>) => Array.from({ length: 10 }, (_, i) => rec({ sec: 'reading', ok: 0, s: 'exam', r, at: NOW - i, ...extra }));
    const withG5 = computeWeakness(input(exam('gsat-115', { g5 }), { prefs: { targetLevel: 11 } }), NOW);
    const expected = peerRate(g5, percentileOfLevel(11)) ?? 0;
    expect(target(withG5, 'sec:reading')?.residual).toBeCloseTo((10 * expected) / 14, 6);
    const withNp = computeWeakness(input(exam('gsat-114', { np: 0.5 })), NOW);
    expect(target(withNp, 'sec:reading')?.residual).toBeCloseTo(5 / 14, 6);
    // 同一次作答（同一份考卷、同一個交卷時間）的 10 題只算 4 題的權重。
    const sitting = computeWeakness(input(many(10, 0, { sec: 'reading', s: 'exam', r: 'gsat-113', np: 0.5, at: NOW })), NOW);
    expect(target(sitting, 'sec:reading')?.residual).toBeCloseTo((4 * 0.5) / 8, 10);
    expect(target(withNp, 'sec:reading')?.evidence).toMatchObject({ basis: 'official', n: 10, rate: 0 });
  });

  it('改善減權：最近 6 題答對 5 題 → 權重減半、improving', () => {
    const old = many(20, 0, { sec: 'reading', at: NOW - 20 * DAY });
    const recent = many(6, 5, { sec: 'reading', at: NOW - DAY });
    const p = computeWeakness(input([...old, ...recent]), NOW);
    const t = target(p, 'sec:reading');
    expect(t?.improving).toBe(true);
    expect(t?.weight).toBeCloseTo(0.5 * Math.min(0.4, t?.residual ?? 0), 10);
    const notYet = computeWeakness(input([...old, ...many(6, 4, { sec: 'reading', at: NOW - DAY })]), NOW);
    expect(target(notYet, 'sec:reading')?.improving).toBe(false);
  });
});

describe('別名表與包含關係', () => {
  it('篇章結構同時帶 cl: 與 ct: 的同一個線索只產生一個弱點；*:other 不是弱點；同一個大題沒有兩個中文標籤相同的弱點', () => {
    const others = many(20, 14, { sec: 'structure', at: NOW });
    const pron = many(8, 2, { sec: 'structure', k: ['cl:pronoun_reference', 'ct:pronoun_reference'], at: NOW });
    const other = many(10, 0, { sec: 'reading', k: ['ct:other'], at: NOW });
    const p = computeWeakness(input([...others, ...pron, ...other, ...many(20, 14, { sec: 'reading', at: NOW })]), NOW);
    expect(target(p, 'skill:structure:cl:pronoun_reference')).toBeDefined();
    expect(p.targets.some((t) => t.code === 'ct:pronoun_reference')).toBe(false);
    expect(p.targets.some((t) => t.code?.endsWith(':other'))).toBe(false);
    for (const section of new Set(p.targets.map((t) => t.section))) {
      const labels = p.targets.filter((t) => t.section === section && t.kind === 'skill').map((t) => assistSkillLabel(t.code ?? ''));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('包含關係：ct:grammar_frame 的題全部也是 tp:grammar、兩者都過門檻時只列排名前面的那一個，另一個併進它', () => {
    const others = many(20, 14, { sec: 'cloze', at: NOW });
    const both = many(10, 2, { sec: 'cloze', k: ['tp:grammar', 'ct:grammar_frame'], at: NOW });
    const tpOnly = many(10, 1, { sec: 'cloze', k: ['tp:grammar'], at: NOW });
    const p = computeWeakness(input([...others, ...both, ...tpOnly]), NOW);
    const tp = target(p, 'skill:cloze:tp:grammar');
    expect(tp).toBeDefined();
    expect(target(p, 'skill:cloze:ct:grammar_frame')).toBeUndefined();
    expect(tp?.merged).toEqual(['ct:grammar_frame']);
  });
});

describe('陷阱：和曝光量比', () => {
  const comps = READING_TRAP_COMPOSITIONS.map(parseComposition);
  const skills: PaperSkills = {
    version: 't',
    codeSections: {},
    groups: Object.fromEntries(comps.map((c, i) => [`ai.rd.${i.toString(16).padStart(6, '0')}@1`, { q: { '1': [] }, tr: { '1': c } }])),
  };
  const wrong = (i: number, c: string, extra: Partial<OutcomeEntry> = {}): OutcomeEntry =>
    rec({ sec: 'reading', ok: 0, r: `ai.rd.${i.toString(16).padStart(6, '0')}@1`, l: '1', c, at: NOW, ...extra });

  /** 一位學生答錯 n 題：pick 決定選哪一個錯誤選項（傳入展開後的選項代碼）。 */
  function student(rng: () => number, n: number, pick: (options: string[]) => string): OutcomeEntry[] {
    return Array.from({ length: n }, () => {
      const i = Math.floor(rng() * comps.length);
      const options = Object.entries(comps[i] ?? {}).flatMap(([code, k]) => Array.from({ length: k }, () => code));
      return wrong(i, pick(options));
    });
  }

  it('(a) 每次答錯都照誘答組成的比例選的確定性學生 → 0 個陷阱弱點', () => {
    const mixed: PaperSkills = { version: 't', codeSections: {}, groups: { 'ai.rd.0000aa@1': { tr: { '1': { DS: 1, OP: 1, NM: 1 } } } } };
    const codes = ['DS', 'OP', 'NM'];
    const outcomes = Array.from({ length: 30 }, (_, i) => rec({ sec: 'reading', ok: 0, r: 'ai.rd.0000aa@1', l: '1', c: codes[i % 3] ?? 'DS', at: NOW, g: `x${i}` }));
    const stats = trapExcess(outcomes, mixed, NOW);
    expect(stats.map((s) => [s.code, s.observed, s.expected])).toEqual([
      ['DS', 10, 10],
      ['NM', 10, 10],
      ['OP', 10, 10],
    ]);
    expect(stats.filter(isTrapWeakness)).toEqual([]);
    expect(computeWeakness(input(outcomes, { skills: mixed }), NOW).targets.filter((t) => t.kind === 'trap')).toEqual([]);
  });

  it('(b) 1,000 位均勻亂選誘答、各答錯 15 題的學生：有任何陷阱弱點的比例 ≤ 8%', () => {
    const rng = rngFromSeed(20261023);
    let flagged = 0;
    for (let s = 0; s < 1000; s += 1) {
      const outcomes = student(rng, 15, (options) => options[Math.floor(rng() * options.length)] ?? 'DS');
      if (trapExcess(outcomes, skills, NOW).some((t) => isTrapWeakness(t) && t.weightedExcess > 0)) flagged += 1;
    }
    expect(flagged / 1000).toBeLessThanOrEqual(0.08);
  });

  it('(c) 答錯時一半機會選「文中沒有提到」的學生答錯 30 題 → NM 被標出的比例 ≥ 60%', () => {
    const rng = rngFromSeed(7);
    let nm = 0;
    const students = 2000;
    for (let s = 0; s < students; s += 1) {
      const outcomes = student(rng, 30, (options) => (options.includes('NM') && rng() < 0.5 ? 'NM' : (options[Math.floor(rng() * options.length)] ?? 'DS')));
      if (trapExcess(outcomes, skills, NOW).some((t) => t.code === 'NM' && isTrapWeakness(t))) nm += 1;
    }
    expect(nm / students).toBeGreaterThanOrEqual(0.6);
  });

  it('(d) 沒有 c 的歷屆題答錯、答對的題、查不到誘答組成的題都不算進觀察與期望；(e) 預覽的數字是 O 與 E', () => {
    const outcomes = [
      ...Array.from({ length: 8 }, (_, i) => wrong(0, 'NM', { g: `n${i}` })),
      rec({ sec: 'reading', ok: 0, s: 'exam', r: 'gsat-115', at: NOW }),
      wrong(1, 'DS', { ok: 1 }),
      rec({ sec: 'reading', ok: 0, r: 'ai.rd.ffffff@1', c: 'NM', at: NOW }),
    ];
    const stats = trapExcess(outcomes, skills, NOW);
    expect(stats[0]?.wrongs).toBe(8);
    const nmStat = stats.find((s) => s.code === 'NM');
    const p = comps[0] ?? {};
    const expectedNm = (8 * (p['NM'] ?? 0)) / Object.values(p).reduce((a, b) => a + b, 0);
    expect(nmStat).toMatchObject({ observed: 8 });
    expect(nmStat?.expected).toBeCloseTo(expectedNm, 10);
    const profile = computeWeakness(input(outcomes, { skills }), NOW);
    const t = target(profile, 'trap:NM');
    expect(t?.evidence).toMatchObject({ observed: 8, wrongs: 8 });
    expect(t?.section).toBe('reading');
    expect(t?.weight).toBeLessThanOrEqual(WEAKNESS_PARAMS.trapMaxWeight);
  });
});

describe('證據規則（大題弱點、技能基準、學習報告共用）', () => {
  const w = 'bk2-w-0000001';
  const papers = new Map([[w, { kind: 'w', targetCodes: { reading: ['it:inference'] } }]]);

  it('隨機抽題卷與中性卷全部算；弱點加強卷裡技能和目標有交集的題不算、沒有交集的算；讀不到清單的整份不算', () => {
    expect(isSectionEvidence({ s: 'bank_mock', p: 'bk2-r-0000001', sec: 'reading', k: ['it:inference'] }, papers)).toBe(true);
    expect(isSectionEvidence({ s: 'bank_mock', p: 'bk2-m-0000001', sec: 'reading', k: ['it:inference'] }, papers)).toBe(true);
    expect(isSectionEvidence({ s: 'bank_mock', p: w, sec: 'reading', k: ['it:inference'] }, papers)).toBe(false);
    expect(isSectionEvidence({ s: 'bank_mock', p: w, sec: 'reading', k: ['it:detail', 'ct:other'] }, papers)).toBe(true);
    expect(isSectionEvidence({ s: 'bank_mock', p: 'bk2-f-0000002', sec: 'reading', k: [] }, papers)).toBe(false);
    expect(isSectionEvidence({ s: 'bank', sec: 'reading', k: ['it:inference'] }, papers)).toBe(true);
    expect(isSectionEvidence({ s: 'bank_mock', p: 'bk1-a-xxx', sec: 'reading', k: [] }, papers)).toBe(true);
    // 別名：ct:pronoun_reference 正規化成 it:reference。
    expect(isSectionEvidence({ s: 'bank_mock', p: w, sec: 'reading', k: ['ct:pronoun_reference'] }, new Map([[w, { kind: 'w', targetCodes: { reading: ['it:reference'] } }]]))).toBe(false);
  });

  it('只和同一個大題的目標比：綜合測驗的 tp:collocation 目標不會讓同一份卷子詞彙（保持手感）的 tp:collocation 題不算', () => {
    const p = new Map([[w, { kind: 'w', targetCodes: targetCodesBySection([{ section: 'cloze', codes: ['tp:collocation'] }, { section: 'reading', codes: [] }]) }]]);
    expect(isSectionEvidence({ s: 'bank_mock', p: w, sec: 'vocabulary', k: ['tp:collocation', 'sn:core'] }, p)).toBe(true);
    expect(isSectionEvidence({ s: 'bank_mock', p: w, sec: 'cloze', k: ['tp:collocation'] }, p)).toBe(false);
    expect(isSectionEvidence({ s: 'bank_mock', p: w, sec: 'cloze', k: ['tp:grammar'] }, p)).toBe(true);
  });

  it('做完一份「大題弱點是篇章結構、本卷篇章結構答對 85%」的加強卷之後，那個大題弱點的權重下降', () => {
    const before = many(8, 3, { sec: 'structure', at: NOW - 2 * DAY });
    const p1 = computeWeakness(input(before), NOW);
    const w1 = target(p1, 'sec:structure')?.weight ?? 0;
    expect(w1).toBeGreaterThan(0);
    const paperId = 'bk2-w-0000009';
    const drill = many(20, 17, { sec: 'structure', s: 'bank_mock', p: paperId, at: NOW });
    const p2 = computeWeakness(input([...before, ...drill], { papers: new Map([[paperId, { kind: 'w', targetCodes: {} }]]) }), NOW);
    expect(target(p2, 'sec:structure')?.weight ?? 0).toBeLessThan(w1);
  });
});

describe('診斷卷情境（一份 50 題的 bk2-m，題庫題 e＝0.7）', () => {
  const papers = new Map([[DIAG, { kind: 'm', targetCodes: {}, diagnostic: true }]]);
  function diag(correct: Partial<Record<BankSectionType, number>>, diagnostic = true): ReturnType<typeof computeWeakness> {
    const sizes: Record<string, number> = { vocabulary: 10, cloze: 10, word_bank: 10, structure: 4, reading: 12, mixed: 4 };
    const base: Record<string, number> = { vocabulary: 6, cloze: 6, word_bank: 6, structure: 3, reading: 8, mixed: 3 };
    const outcomes = Object.entries(sizes).flatMap(([sec, n]) => many(n, correct[sec as BankSectionType] ?? base[sec] ?? 0, { sec: sec as BankSectionType, s: 'bank_mock', p: DIAG, at: NOW }));
    return computeWeakness(input(outcomes, { papers: diagnostic ? papers : new Map([[DIAG, { kind: 'm', targetCodes: {} }]]) }), NOW);
  }

  it('約六成到七成五 → 0 個弱點、noWeakness（最大殘差是 10 題對 6 題的 0.071）', () => {
    const p = diag({});
    expect(p.enough).toBe(true);
    expect(p.targets).toEqual([]);
    expect(p.noWeakness).toBe(true);
    expect(p.tooHard).toBeNull();
  });

  it('全部約 50% → 6 個大題弱點、tooHard 有值', () => {
    const p = diag({ vocabulary: 5, cloze: 5, word_bank: 5, reading: 6, structure: 2, mixed: 2 });
    expect(p.targets.map((t) => t.key).sort()).toEqual(['sec:cloze', 'sec:mixed', 'sec:reading', 'sec:structure', 'sec:vocabulary', 'sec:word_bank']);
    expect(p.tooHard).toEqual({ rate: 0.5, n: 50 });
  });

  it('只有詞彙 10 題對 4 題 → 只有詞彙；只有篇章結構 4 題對 2 題 → 只有篇章結構', () => {
    expect(diag({ vocabulary: 4 }).targets.map((t) => t.key)).toEqual(['sec:vocabulary']);
    expect(target(diag({ vocabulary: 4 }), 'sec:vocabulary')?.residual).toBeCloseTo(3 / 14, 10);
    expect(diag({ structure: 2 }).targets.map((t) => t.key)).toEqual(['sec:structure']);
  });

  it('只有閱讀 12 題對 7 題：診斷卷 → 閱讀是大題弱點（殘差 0.0875）；不是診斷卷（單份上限 4）→ 不是（0.058）', () => {
    const p = diag({ reading: 7 });
    expect(p.targets.map((t) => t.key)).toEqual(['sec:reading']);
    expect(target(p, 'sec:reading')?.residual).toBeCloseTo(1.4 / 16, 10);
    expect(diag({ reading: 7 }, false).targets).toEqual([]);
  });
});

/** 只有測試用得到的欄位的報告。 */
function report(body: Partial<NonNullable<AssistReportDetail['report']>>, ageDays: number, extra: Partial<AssistReportDetail> = {}): AssistReportDetail {
  return {
    id: 'r1',
    version: 3,
    based_on: null,
    status: 'done',
    failure: null,
    created_at: Math.floor((NOW - ageDays * DAY) / 1000),
    exam_date: '2027-01-17',
    target_level: 11,
    updated_at: 0,
    expires_at: 0,
    settings: null,
    feedback: null,
    facts: null,
    report: { weaknesses: [], error_patterns: [], score_plan: [], recommendations: [], ...body } as unknown as NonNullable<AssistReportDetail['report']>,
    ...extra,
  };
}

describe('學習報告與案例', () => {
  const weak = (area: string, priority: number, error_codes: string[] = []) => ({ area, priority, error_codes, evidence_zh: '', explain_zh: '', facts: null });

  it('優先序權重；14／45／60 天衰減；報告之後又有 150 題首次作答就不用', () => {
    expect([1, 2, 3, 4, 5].map(priorityWeight)).toEqual([0.25, 0.2, 0.15, 0.1, 0.1]);
    expect(reportFactor(NOW - 10 * DAY, NOW, 0)).toBe(1);
    expect(reportFactor(NOW - 45 * DAY, NOW, 0)).toBe(0.5);
    expect(reportFactor(NOW - 50 * DAY, NOW, 0)).toBe(0.5);
    expect(reportFactor(NOW - 61 * DAY, NOW, 0)).toBe(0);
    expect(reportFactor(NOW - 5 * DAY, NOW, 150)).toBe(0);
    const r30 = reportFactor(NOW - 30 * DAY, NOW, 0);
    expect(r30).toBeCloseTo(1 - (0.5 * 16) / 31, 10);
    const p = computeWeakness(input([], { report: report({ weaknesses: [weak('reading', 1)] as never }, 30) }), NOW);
    expect(target(p, 'sec:reading')?.weight).toBeCloseTo(0.25 * r30, 10);
    expect(target(p, 'sec:reading')?.from).toEqual(['report']);
    expect(p.coverage.report).toEqual({ version: 3, createdAt: (Math.floor((NOW - 30 * DAY) / 1000)) * 1000, used: true });
    const old = computeWeakness(input([], { report: report({ weaknesses: [weak('reading', 1)] as never }, 61) }), NOW);
    expect(old.targets).toEqual([]);
    expect(old.coverage.report?.used).toBe(false);
  });

  it('本機反證（殘差 ≤ 0、≥ 8 題）時報告的權重減半；兩邊都說弱時 max ＋ 0.5 × min', () => {
    const good = many(10, 9, { sec: 'reading', at: NOW });
    const p = computeWeakness(input(good, { report: report({ weaknesses: [weak('reading', 1)] as never }, 1) }), NOW);
    expect(target(p, 'sec:reading')).toMatchObject({ weight: 0.125, contradicted: true });
    const bad = many(10, 2, { sec: 'reading', at: NOW });
    const local = computeWeakness(input(bad), NOW);
    const both = computeWeakness(input(bad, { report: report({ weaknesses: [weak('reading', 2)] as never }, 1) }), NOW);
    expect(target(both, 'sec:reading')?.weight).toBeCloseTo(mergeWeights(target(local, 'sec:reading')?.weight ?? 0, 0.2), 10);
    expect(mergeWeights(0.4, 0.4)).toBe(0.5);
  });

  it('score_plan 第 1、2 優先的大題直接加 0.10：報告弱點第 1 優先（0.25）＋ score_plan 同一個大題 → 0.35；只有 score_plan → 0.10', () => {
    const plan = (section: string, priority: number) => ({ section, priority, current: null, target: null, gain: null, why_zh: '' });
    const p = computeWeakness(input([], { report: report({ weaknesses: [weak('cloze', 1)] as never, score_plan: [plan('cloze', 1), plan('reading', 2), plan('mixed', 3)] as never }, 1) }), NOW);
    expect(target(p, 'sec:cloze')?.weight).toBeCloseTo(0.35, 10);
    expect(target(p, 'sec:reading')?.weight).toBeCloseTo(0.1, 10);
    expect(target(p, 'sec:mixed')).toBeUndefined();
  });

  it('報告技能的大題：沒有本機紀錄時依 codeSections（it:synthesis → 混合題、tp:grammar → 綜合測驗）；有本機紀錄時取本機作答最多的大題', () => {
    const skills: PaperSkills = { version: 't', codeSections: { 'it:synthesis': { advanced: { mixed: 201, reading: 15 } }, 'tp:grammar': { advanced: { cloze: 50 } } }, groups: {} };
    const body = { weaknesses: [weak('it:synthesis', 1), weak('tp:grammar', 2)] as never };
    const p = computeWeakness(input([], { skills, report: report(body, 1) }), NOW);
    expect(p.targets.map((t) => t.key).sort()).toEqual(['skill:cloze:tp:grammar', 'skill:mixed:it:synthesis']);
    const local = many(6, 3, { sec: 'reading', k: ['it:synthesis'], at: NOW });
    const q = computeWeakness(input(local, { skills, report: report(body, 1) }), NOW);
    expect(target(q, 'skill:reading:it:synthesis')).toBeDefined();
  });

  it('錯因加成：grammar 讓已經是弱點的綜合測驗 tp:grammar 權重提高；本機沒有任何相關證據時產生 err:grammar（綜合測驗、0.10）', () => {
    const others = many(20, 14, { sec: 'cloze', at: NOW });
    const grammar = many(10, 2, { sec: 'cloze', k: ['tp:grammar'], at: NOW });
    const local = computeWeakness(input([...others, ...grammar]), NOW);
    const w0 = target(local, 'skill:cloze:tp:grammar')?.weight ?? 0;
    const body = { error_patterns: [{ code: 'grammar', explain_zh: '', cases: [], fix_zh: '', count: null }] as never };
    const boosted = computeWeakness(input([...others, ...grammar], { report: report(body, 1) }), NOW);
    expect(target(boosted, 'skill:cloze:tp:grammar')?.weight).toBeCloseTo(mergeWeights(w0, 0.1), 10);
    expect(boosted.targets.some((t) => t.kind === 'error')).toBe(false);
    const none = computeWeakness(input([], { report: report(body, 1) }), NOW);
    const err = target(none, 'err:grammar');
    expect(err).toMatchObject({ kind: 'error', section: 'cloze', weight: 0.1 });
    expect(err?.codes).toContain('tp:grammar');
    expect(err?.codes).toContain('ct:grammar_frame');
  });

  it('案例的錯因次數（≥ 2 次：0.05 × 次數，最多 0.20）與「不懂」的案例的技能；粗心、時間不夠列為這份卷子幫不上', () => {
    const skills: PaperSkills = { version: 't', codeSections: { 'it:inference': { advanced: { reading: 94, mixed: 12 } } }, groups: {} };
    const p = computeWeakness(input([], { skills, cases: { errorCounts: { collocation: 3, careless: 5, time: 1 }, notUnderstoodSkills: [['it:inference'], ['it:inference', 'ct:other']] } }), NOW);
    expect(target(p, 'err:collocation')?.weight).toBeCloseTo(0.15, 10);
    expect(target(p, 'err:collocation')?.section).toBe('vocabulary');
    expect(p.unhelpedErrors).toEqual(['careless']);
    expect(target(p, 'skill:reading:it:inference')?.weight).toBeCloseTo(0.1, 10);
  });

  it('最少資料：29 題不夠、30 題夠；有報告弱點時 0 題也夠', () => {
    expect(computeWeakness(input(many(29, 20, { sec: 'reading', at: NOW })), NOW).enough).toBe(false);
    expect(computeWeakness(input(many(30, 21, { sec: 'reading', at: NOW })), NOW).enough).toBe(true);
    expect(computeWeakness(input([], { report: report({ weaknesses: [weak('cloze', 3)] as never }, 1) }), NOW).enough).toBe(true);
  });
});

describe('錯因對照表', () => {
  it('每個錯因代碼都在表裡；對到的技能都是封閉清單的代碼，在主要大題正規化後就是主代碼', () => {
    expect(Object.keys(ERROR_TARGETS).sort()).toEqual([...ASSIST_ERROR_CODES].sort());
    for (const [code, spec] of Object.entries(ERROR_TARGETS)) {
      for (const c of spec.codes) {
        expect(isAssistSkillCode(c), `${code}: ${c}`).toBe(true);
        const section = spec.section ?? spec.fallbackSection ?? 'reading';
        expect(canonicalSkill(section, canonicalSkill(section, c))).toBe(canonicalSkill(section, c));
      }
      expect(Boolean(spec.none) || spec.codes.length > 0 || spec.traps.length > 0 || (spec.sections?.length ?? 0) > 0, code).toBe(true);
    }
  });
});

describe('焦點', () => {
  it('只有詞彙錯題、sn:core 出現最多的情境：不帶 sn:core（提升度 < 1.3），焦點只有詞彙；組卷時詞彙列為目標（權重 0.15）', () => {
    const baseline = [...many(30, 20, { sec: 'vocabulary', k: ['tp:collocation', 'sn:core'], at: NOW }), ...many(10, 8, { sec: 'vocabulary', k: ['tp:word_meaning', 'sn:extended'], at: NOW })];
    const rows = [{ section: 'vocabulary', questions: [['tp:collocation', 'sn:core'], ['tp:collocation', 'sn:core'], ['tp:word_meaning', 'sn:extended'], ['tp:word_meaning', 'sn:extended']] }];
    const focus = focusFromRows(rows, baseline, { now: NOW });
    expect(focus.sections).toEqual(['vocabulary']);
    expect(focus.skills).not.toContain('sn:core');
    expect(focus.skills).toContain('sn:extended');
    const p = computeWeakness(input(baseline, { focus }), NOW);
    expect(target(p, 'sec:vocabulary')).toMatchObject({ weight: 0.15, focusOnly: true });
    // 提升度 ≥ 1.3 的技能沒過門檻也列為目標。
    expect(target(p, 'skill:vocabulary:sn:extended')?.weight).toBeGreaterThanOrEqual(0.15);
    // 其他大題的弱點不保留。
    const withReading = computeWeakness(input([...baseline, ...many(10, 1, { sec: 'reading', at: NOW })], { focus }), NOW);
    expect(withReading.targets.some((t) => t.section === 'reading')).toBe(false);
  });

  it('選「全部」時帶錯題列數最多的前 2 個大題', () => {
    const rows = [
      { section: 'reading', questions: [['it:inference']] },
      { section: 'reading', questions: [['it:detail']] },
      { section: 'cloze', questions: [['tp:grammar']] },
      { section: 'cloze', questions: [['tp:grammar']] },
      { section: 'cloze', questions: [['tp:phrase']] },
      { section: 'vocabulary', questions: [['sn:core']] },
      { section: null, questions: [['x']] },
    ];
    expect(focusFromRows(rows, [], { now: NOW }).sections).toEqual(['cloze', 'reading']);
    expect(focusFromRows(rows, [], { now: NOW, onlySection: 'vocabulary' }).sections).toEqual(['vocabulary']);
  });

  it('from=paper／attempt：那一份的錯題算焦點；那一份的紀錄權重 × 2、不受單份上限', () => {
    const paperId = 'bk1-a-' + 'm00061'.repeat(11);
    const others = many(20, 14, { sec: 'reading', at: NOW });
    const bad = many(20, 0, { sec: 'reading', k: ['it:detail'], s: 'bank_mock', p: paperId, at: NOW });
    const focus = focusFromOutcomes(bad, [...others, ...bad], NOW);
    expect(focus.sections).toEqual(['reading']);
    const plain = computeWeakness(input([...others, ...bad]), NOW);
    const focused = computeWeakness(input([...others, ...bad], { focus: { ...focus, paper: paperId } }), NOW);
    expect(target(focused, 'skill:reading:it:detail')?.residual ?? 0).toBeGreaterThan(target(plain, 'skill:reading:it:detail')?.residual ?? 0);
    expect(target(focused, 'skill:reading:it:detail')?.residual).toBeCloseTo((40 * 0.7) / 44, 10);
  });
});

describe('保持手感與其他輸出', () => {
  it('選最久沒練、殘差 ≤ 0 的選擇題大題；全部都是弱點時是 null', () => {
    const outcomes = [
      ...many(10, 9, { sec: 'vocabulary', at: NOW - 20 * DAY }),
      ...many(10, 9, { sec: 'cloze', at: NOW - 30 * DAY }),
      ...many(10, 9, { sec: 'word_bank', at: NOW - 2 * DAY }),
      ...many(10, 2, { sec: 'reading', at: NOW }),
    ];
    const p = computeWeakness(input(outcomes), NOW);
    expect(p.maintenance).toMatchObject({ section: 'cloze', daysSince: 30, rate: 0.9 });
    const allWeak = computeWeakness(input([...many(10, 2, { sec: 'cloze', at: NOW - 30 * DAY }), ...many(10, 2, { sec: 'reading', at: NOW })]), NOW);
    expect(allWeak.maintenance).toBeNull();
  });

  it('只有作答紀錄上線前的題庫練習的大題：天數用那幾筆練習的時間，不是 Infinity', () => {
    const at = new Date(NOW - 40 * DAY).toISOString();
    const done = (correct: number) => ({ version: 1, section: 'vocabulary' as const, tier: 'advanced' as const, at, correct, total: 10, hinted: 0 });
    const p = computeWeakness(input(many(30, 25, { sec: 'reading', at: NOW }), { practiceDone: { 'ai.vo.000aa1': done(9), 'ai.vo.000aa2': done(8) } }), NOW);
    expect(p.maintenance).toMatchObject({ section: 'vocabulary', daysSince: 40 });
    expect(Number.isFinite(p.maintenance?.daysSince)).toBe(true);
    expect(maintenanceText({ section: 'vocabulary', rate: 0.85, daysSince: Infinity })).not.toContain('Infinity');
  });

  it('範圍：實際用到的天數與首次作答題數；沒有資料的大題；基準難度的依據', () => {
    const p = computeWeakness(input(many(10, 7, { sec: 'reading', at: NOW - 40 * DAY }), { prefs: {} }), NOW);
    expect(p.coverage).toMatchObject({ firstAttempts: 10, days: 40, trapDays: 90, report: null });
    expect(p.gaps).toEqual(['vocabulary', 'cloze', 'word_bank', 'structure', 'mixed', 'translation', 'composition']);
    expect(p.baseTierBasis).toBe('default');
    expect(p.baseTier).toBe('basic');
    expect(computeWeakness(input([], { prefs: { targetLevel: 13 } }), NOW)).toMatchObject({ baseTier: 'top', baseTierBasis: 'target' });
    expect(computeWeakness(input([], { prefs: { practiceTier: 'advanced' } }), NOW)).toMatchObject({ baseTier: 'advanced', baseTierBasis: 'prefs' });
  });

  it('錯過的題組（重做用）：uid → 最後一次答錯的時間、答錯的題的主代碼', () => {
    const out = wrongGroupsFrom([
      rec({ sec: 'structure', ok: 0, r: 'ai.st.000001@1', k: ['ct:contrast'], at: 100 }),
      rec({ sec: 'structure', ok: 1, r: 'ai.st.000001@1', k: ['ct:example'], at: 200 }),
      rec({ sec: 'structure', ok: 0, r: 'ai.st.000001@2', k: ['cl:example'], at: 300 }),
      rec({ sec: 'reading', ok: 0, s: 'exam', r: 'gsat-115', at: 400 }),
    ]);
    expect([...out]).toEqual([['ai.st.000001', { at: 300, questions: [['cl:contrast'], ['cl:example']] }]]);
  });

  it('前 6 名：同分時作答數多的先，再依鍵排序；結果穩定', () => {
    const outcomes = (['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const).flatMap((sec) => many(sec === 'structure' || sec === 'mixed' ? 8 : 12, 2, { sec, at: NOW }));
    const extra = many(10, 0, { sec: 'reading', k: ['it:inference'], at: NOW });
    const a = computeWeakness(input([...outcomes, ...extra]), NOW);
    const b = computeWeakness(input([...extra, ...outcomes].reverse()), NOW);
    expect(a.targets.length).toBe(6);
    expect(a.targets.map((t) => t.key)).toEqual(b.targets.map((t) => t.key));
  });
});
