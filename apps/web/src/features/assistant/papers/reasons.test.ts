/**
 * 加強卷預覽的理由句（docs/design/weak-paper.md §3.3、A7）、網址參數與焦點（§3.1）、成績單「這次的弱點表現」（§3.6）、開關（§9.3）。
 * 固定的作答紀錄產生固定的句子；每一項都含學生自己的數字，不出現原始代碼。
 */
import { BANK_UID_CODES, type BankSectionType } from '@gsat/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaperSkills } from '../../mock/bank/paperSkills';
import type { StoredTarget } from '../../mock/bank/weakPapers';
import type { OutcomeEntry, OutcomeInput } from '../outcomes';
import { ASK_RATE, assignQuestions, beforeText, coveredSkills, drillQuestions, drillRows, type DrillQuestion } from './drill';
import { WEAK_PAPER_ENABLED, WEAK_PAPER_PREVIEW_KEY, weakPaperSeed, weakPaperVisible } from './flags';
import { focusOf, papersHref, parsePapersParams } from './params';
import {
  adjacentText,
  coverageText,
  gapsText,
  localRate,
  noWeaknessText,
  targetLabel,
  targetReason,
  tooHardText,
  unhelpedText,
  type ReasonContext,
} from './reasons';
import { computeWeakness, type WeakTarget, type WeaknessProfile } from './weakness';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-23T00:00:00.000Z');
const EMPTY_SKILLS: PaperSkills = { version: 't', codeSections: {}, groups: {} };
/** 原始代碼的樣子（畫面上不能出現）。 */
const RAW_CODE = /\b(it|cl|ct|tp|sn|gp|ts|tt|xf):[a-z_]+\b|\btrap:|\bsec:|\bskill:/;

let seq = 0;
function rec(p: Partial<OutcomeEntry> & Pick<OutcomeEntry, 'sec' | 'ok'>): OutcomeEntry {
  seq += 1;
  const code = BANK_UID_CODES[p.sec as BankSectionType] ?? 'rd';
  return { s: 'bank', r: `ai.${code}.${seq.toString(16).padStart(6, '0')}@1`, g: `g${seq}`, l: '1', k: [], a: 'A', first: 1, at: NOW - DAY, t: 'advanced', ...p };
}

function many(n: number, correct: number, p: Partial<OutcomeEntry> & Pick<OutcomeEntry, 'sec'>): OutcomeEntry[] {
  return Array.from({ length: n }, (_, i) => rec({ ...p, ok: i < correct ? 1 : 0 }));
}

function ctxOf(outcomes: OutcomeEntry[], extra: Partial<ReasonContext> = {}): { profile: WeaknessProfile; ctx: ReasonContext } {
  const profile = computeWeakness({ outcomes, skills: EMPTY_SKILLS, papers: new Map(), prefs: { practiceTier: 'advanced' } }, NOW);
  return { profile, ctx: { profile, outcomes, papers: new Map(), now: NOW, skills: null, targetLevel: null, caseErrorCounts: null, ...extra } };
}

/** 主流程的作答紀錄（同 e2e）：進階練習閱讀推論 10 題錯 7 題、其他閱讀 20 題錯 4 題、篇章結構 10 題錯 2 題。 */
function mainFlow(): OutcomeEntry[] {
  return [
    ...many(10, 3, { sec: 'reading', k: ['it:inference'] }),
    ...many(20, 16, { sec: 'reading', k: ['it:detail'] }),
    ...many(10, 8, { sec: 'structure', k: ['cl:contrast'] }),
  ];
}

describe('理由句（§3.3）', () => {
  it('技能：答對率、題數、比同難度同大題的平均低幾個百分點；名稱是中文標籤', () => {
    const { profile, ctx } = ctxOf(mainFlow());
    const t = profile.targets.find((x) => x.key === 'skill:reading:it:inference') as WeakTarget;
    expect(t).toBeDefined();
    expect(targetLabel(t)).toBe('推論（閱讀）');
    const text = targetReason(t, ctx);
    expect(text).toMatch(/^推論（閱讀）：答對 30%（10 題），比你在進階練習閱讀的平均低 \d+ 個百分點。$/);
    expect(text).not.toMatch(RAW_CODE);
  });

  it('大題（題庫）：最近幾天在那一級答對幾成，對照「這一級的設計是目標族群約七成答對」', () => {
    // 答錯的排前面（同一時間時依順序取最近 6 題）：不會被當成「最近有進步」。
    const outcomes = [...many(7, 0, { sec: 'vocabulary' }), ...many(5, 5, { sec: 'vocabulary' }), ...many(20, 16, { sec: 'reading' })];
    const { profile, ctx } = ctxOf(outcomes);
    const t = profile.targets.find((x) => x.key === 'sec:vocabulary') as WeakTarget;
    expect(targetReason(t, ctx)).toBe('詞彙題：最近 1 天在進階練習答對 42%（12 題）；這一級的設計是目標族群約七成答對。');
  });

  it('陷阱：最近 90 天答錯時選了 O 次，比一般情況多 O − E 次（取整數）', () => {
    const t: WeakTarget = {
      key: 'trap:NM',
      kind: 'trap',
      section: 'reading',
      code: 'NM',
      codes: [],
      weight: 0.2,
      evidence: { observed: 9, expected: 3.6, wrongs: 15 },
      from: ['local'],
      improving: false,
      residual: null,
      reportPriority: null,
      contradicted: false,
      merged: [],
      errors: [],
      focusOnly: false,
    };
    const { ctx } = ctxOf([]);
    expect(targetReason(t, ctx)).toBe('容易選「文中沒有提到」的選項：最近 90 天答錯時選了 9 次，比一般情況多 5 次。');
  });

  it('只有學習報告：「學習報告第 v 版（月/日）列為第 p 優先：標籤」', () => {
    const { ctx } = ctxOf([]);
    const profile: WeaknessProfile = { ...ctx.profile, coverage: { ...ctx.profile.coverage, report: { version: 3, createdAt: Date.parse('2026-10-20T04:00:00Z'), used: true } } };
    const t: WeakTarget = {
      key: 'skill:vocabulary:sn:extended',
      kind: 'skill',
      section: 'vocabulary',
      code: 'sn:extended',
      codes: ['sn:extended'],
      weight: 0.25,
      evidence: { n: 0, rate: null, expected: null, basis: 'report' },
      from: ['report'],
      improving: false,
      residual: null,
      reportPriority: 1,
      contradicted: false,
      merged: [],
      errors: [],
      focusOnly: false,
    };
    expect(targetReason(t, { ...ctx, profile })).toBe('學習報告第 3 版（10/20）列為第 1 優先：延伸義（詞彙）。');
  });

  it('焦點的技能：有提升度時寫「錯題裡比你平常多 x 倍」；不知道時不說成學生自己選的', () => {
    const { ctx } = ctxOf([]);
    const t: WeakTarget = {
      key: 'skill:reading:it:inference',
      kind: 'skill',
      section: 'reading',
      code: 'it:inference',
      codes: ['it:inference'],
      weight: 0.15,
      evidence: { n: 0, rate: null, expected: null, basis: 'bank' },
      from: ['focus'],
      improving: false,
      residual: null,
      reportPriority: null,
      contradicted: false,
      merged: [],
      errors: [],
      focusOnly: true,
    };
    expect(targetReason(t, { ...ctx, focusLift: { 'it:inference': 1.8 } })).toBe('推論（閱讀）（錯題裡比你平常多 1.8 倍）');
    expect(targetReason(t, ctx)).toBe('推論（閱讀）（你篩選的錯題裡常見）');
    expect(targetReason(t, ctx)).not.toContain('你這次選的範圍');
  });

  it('最近有進步：加「最近 6 題答對 k 題，有進步，這次少放一點」', () => {
    const old = many(10, 1, { sec: 'reading', k: ['it:inference'], at: NOW - 20 * DAY });
    const recent = many(6, 5, { sec: 'reading', k: ['it:inference'], at: NOW - DAY });
    const { profile, ctx } = ctxOf([...old, ...recent, ...many(30, 24, { sec: 'reading', k: ['it:detail'] })]);
    const t = profile.targets.find((x) => x.key === 'skill:reading:it:inference');
    expect(t?.improving).toBe(true);
    expect(targetReason(t as WeakTarget, ctx)).toContain('（最近 6 題答對 5 題，有進步，這次少放一點）');
  });

  it('範圍句用實際的天數與題數；報告讀不到、太舊時另外說明', () => {
    const { profile } = ctxOf(mainFlow());
    expect(coverageText(profile, 'none')).toBe('依這台裝置最近 1 天 40 題首次作答');
    expect(coverageText(profile, 'failed')).toContain('學習報告讀不到');
    const old = { ...profile, coverage: { ...profile.coverage, report: { version: 2, createdAt: Date.parse('2026-08-20T04:00:00Z'), used: false } } };
    expect(coverageText(old, 'ok')).toBe('依這台裝置最近 1 天 40 題首次作答（學習報告是 8/20 的版本，已經較舊，這次只依最近的作答）');
  });

  it('沒有明顯弱點、整體偏難、資料不夠、幫不上的錯因', () => {
    const fine = [...many(10, 8, { sec: 'vocabulary' }), ...many(10, 7, { sec: 'cloze' }), ...many(12, 9, { sec: 'reading' })];
    const { profile, ctx } = ctxOf(fine);
    expect(profile.noWeakness).toBe(true);
    expect(noWeaknessText(ctx)).toBe('依目前紀錄（最近 1 天 32 題），你在進階練習沒有明顯的弱點：各大題答對 70%–80%。');
    const hard = { ...profile, tooHard: { rate: 0.5, n: 40 } };
    expect(tooHardText(hard)).toBe('你在進階練習的首次作答答對 50%（40 題），各大題都低於這一級的設計（約七成）；可以先改用穩定基礎。');
    expect(tooHardText({ ...hard, baseTier: 'basic' })).not.toContain('改用');
    expect(gapsText(['structure', 'translation', 'composition'])).toBe(
      '資料不夠的部分：篇章結構還沒有資料（做一組題型練習或一份模擬考後才會列入）；中譯英、英文作文還沒有資料（送一篇 AI 批改或做一份模考後才會列入）。',
    );
    expect(gapsText([])).toBeNull();
    expect(unhelpedText(['careless', 'time'])).toMatch(/^「粗心」、「時間不夠[^」]*」不靠挑題改善：計時作答，交卷前留 2 分鐘檢查答案卡。$/);
  });

  it('基準難度沒有這項技能的題目：說明用相鄰一級（技能分布的 codeSections）', () => {
    const skills: PaperSkills = { version: 't', codeSections: { 'it:inference': { advanced: { reading: 45 }, top: { reading: 44 } } }, groups: {} };
    const t = { kind: 'skill' as const, section: 'reading' as const, code: 'it:inference' };
    expect(adjacentText(t, 'basic', skills)).toBe('穩定基礎沒有推論的題目，這一項用進階練習的題組。');
    expect(adjacentText(t, 'advanced', skills)).toBeNull();
    expect(adjacentText(t, 'basic', null)).toBeNull();
  });

  it('localRate：大題用證據規則算得進來的首次作答；技能用帶這個主代碼的', () => {
    const outcomes = mainFlow();
    const ctx = { outcomes, papers: new Map(), now: NOW };
    expect(localRate({ kind: 'skill', section: 'reading', code: 'it:inference' }, ctx)).toEqual({ n: 10, rate: 0.3 });
    expect(localRate({ kind: 'section', section: 'structure', code: null }, ctx)).toEqual({ n: 10, rate: 0.8 });
    expect(localRate({ kind: 'trap', section: 'reading', code: 'NM' }, ctx)).toBeNull();
  });
});

describe('網址參數與焦點（§3.1）', () => {
  it('卷別、大題、技能、篩選題數、入口', () => {
    expect(parsePapersParams('?kind=w&from=mistakes&section=reading,structure,vocabulary&skill=it:inference&skill=bogus:x&n=12')).toMatchObject({
      kind: 'w',
      sections: ['reading', 'structure'],
      skills: ['it:inference'],
      count: 12,
      from: { kind: 'mistakes' },
    });
    // 提升度：只收 skill 裡有的代碼、格式對的數字；錯題清單的焦點帶著它，預覽才寫得出「比你平常多 x 倍」。
    const withLift = parsePapersParams('?kind=w&from=mistakes&section=reading&skill=it:inference,it:reference&lift=it:inference:1.8,it:reference:abc,it:detail:2&n=5');
    expect(withLift.lifts).toEqual({ 'it:inference': 1.8 });
    expect(focusOf(withLift, [], NOW)?.focus).toEqual({ sections: ['reading'], skills: ['it:inference', 'it:reference'], lifts: { 'it:inference': 1.8 } });
    expect(focusOf(parsePapersParams('?from=mistakes&section=reading&skill=it:inference'), [], NOW)?.focus).toEqual({ sections: ['reading'], skills: ['it:inference'] });
    expect(parsePapersParams('?from=report&report=abc-123').from).toEqual({ kind: 'report', reportId: 'abc-123' });
    expect(parsePapersParams('?from=attempt:9f0e').from).toEqual({ kind: 'attempt', id: '9f0e' });
    expect(parsePapersParams('?from=paper:BK2-W-ABC').from).toEqual({ kind: 'paper', id: 'bk2-w-abc' });
    expect(parsePapersParams('?kind=x&from=evil').kind).toBeNull();
    expect(papersHref({ kind: 'w', from: 'paper:bk2-w-0000001', section: [] })).toBe('/assistant/papers?kind=w&from=paper%3Abk2-w-0000001');
  });

  it('from=paper：焦點由那一份目前保留的錯題算，那一份另外標出（權重加倍、不受單份上限）', () => {
    const paperId = 'bk2-w-0000001';
    const base = many(30, 24, { sec: 'reading', k: ['it:detail'] });
    const wrong = [...many(4, 0, { sec: 'vocabulary', k: ['sn:extended'], s: 'bank_mock', p: paperId }), ...many(6, 6, { sec: 'reading', k: ['it:detail'], s: 'bank_mock', p: paperId })];
    const focus = focusOf(parsePapersParams(`?from=paper:${paperId}`), [...base, ...wrong], NOW);
    expect(focus?.count).toBe(4);
    expect(focus?.focus).toMatchObject({ sections: ['vocabulary'], paper: paperId });
    expect(focusOf(parsePapersParams('?from=paper:bk2-w-9999999'), base, NOW)).toBeNull();
  });
});

describe('這次的弱點表現（§3.6）', () => {
  const targets: StoredTarget[] = [
    { key: 'skill:reading:it:inference', kind: 'skill', section: 'reading', code: 'it:inference', codes: ['it:inference'], weight: 0.3, label: '推論（閱讀）', n: 14, rate: 0.43 },
    { key: 'skill:reading:it:reference', kind: 'skill', section: 'reading', code: 'it:reference', codes: ['it:reference'], weight: 0.2, label: '指涉（閱讀）', n: 8, rate: 0.5 },
    { key: 'trap:NM', kind: 'trap', section: 'reading', code: 'NM', codes: [], weight: 0.1, label: null, n: null, rate: null },
    { key: 'sec:structure', kind: 'section', section: 'structure', code: null, codes: [], weight: 0.15, label: '篇章結構', n: 10, rate: 0.5 },
  ];
  const input = (display: string, sec: BankSectionType, k: string[], ok: 0 | 1, key = 'A'): OutcomeInput => ({ s: 'bank_mock', r: `ai.${BANK_UID_CODES[sec]}.000001@1`, g: 'g', l: display, d: display, sec, k, ok, a: 'B', key, at: NOW });

  it('每一題只算給權重最高的目標；陷阱看錯誤選項；大題目標涵蓋那個大題的每一題', () => {
    const questions = drillQuestions(
      [input('31', 'reading', ['it:inference', 'ct:pronoun_reference'], 0), input('32', 'reading', ['ct:pronoun_reference'], 1), input('33', 'reading', ['it:detail'], 0), input('21', 'structure', ['cl:contrast'], 1)],
      (d) => (d === '33' ? { A: 'E1', B: 'NM', C: 'DS' } : null),
    );
    const assigned = assignQuestions(questions, targets);
    expect(assigned.get('skill:reading:it:inference')?.map((q) => q.display)).toEqual(['31']);
    // ct:pronoun_reference 依別名表正規化成 it:reference。
    expect(assigned.get('skill:reading:it:reference')?.map((q) => q.display)).toEqual(['32']);
    expect(assigned.get('trap:NM')?.map((q) => q.display)).toEqual(['33']);
    expect(assigned.get('sec:structure')?.map((q) => q.display)).toEqual(['21']);
  });

  it('下一步：跌出前 6 名或有進步 → 先放；仍在前 6 名、本卷 ≤ 40% → 先問學習助手；其他 → 再組一份', () => {
    const q = (display: string, ok: 0 | 1): DrillQuestion => ({ display, group: 'g', section: 'reading', codes: ['it:inference'], traps: [], ok });
    const one = [targets[0] as StoredTarget];
    const current = (improving: boolean) => ({ targets: [{ key: 'skill:reading:it:inference', improving } as WeakTarget] });
    const local = () => ({ n: 17, rate: 0.46 });
    expect(drillRows({ questions: [q('1', 0), q('2', 0), q('3', 1)], targets: one, profile: current(false), local })[0]).toMatchObject({ correct: 1, next: 'ask', now: { rate: 0.46 } });
    expect(ASK_RATE).toBe(0.4);
    expect(drillRows({ questions: [q('1', 1), q('2', 1), q('3', 0)], targets: one, profile: current(false), local })[0]?.next).toBe('again');
    expect(drillRows({ questions: [q('1', 0)], targets: one, profile: current(true), local })[0]?.next).toBe('park');
    expect(drillRows({ questions: [q('1', 0)], targets: one, profile: { targets: [] }, local })[0]?.next).toBe('park');
    // 本機的弱點（from 含 local）：跌出本機重算的前 6 名 → 先放。
    expect(drillRows({ questions: [q('1', 0)], targets: [{ ...(targets[0] as StoredTarget), from: ['local', 'report'] }], profile: { targets: [] }, local })[0]?.next).toBe('park');
  });

  it('下一步：報告、案例、焦點帶來的弱點本機重算看不到，依本卷的答對率（0／3 → 先問學習助手，不是先放）；「組卷時」那一格依來源', () => {
    const q = (display: string, ok: 0 | 1, codes = ['it:inference']): DrillQuestion => ({ display, group: 'g', section: 'reading', codes, traps: [], ok });
    const base = { kind: 'skill' as const, section: 'reading' as const, weight: 0.2, label: null, n: null, rate: null };
    const report: StoredTarget = { ...base, key: 'skill:reading:it:inference', code: 'it:inference', codes: ['it:inference'], from: ['report'] };
    const cases: StoredTarget = { ...base, key: 'err:cohesion', kind: 'error', code: 'cohesion', codes: ['it:inference'], from: ['cases'] };
    const focus: StoredTarget = { ...base, key: 'skill:reading:it:inference', code: 'it:inference', codes: ['it:inference'], from: ['focus'], focusOnly: true };
    const local = () => null;
    const none = { targets: [] };
    for (const t of [report, cases, focus]) {
      const wrong = drillRows({ questions: [q('1', 0), q('2', 0), q('3', 0)], targets: [t], profile: none, local })[0];
      expect(wrong).toMatchObject({ correct: 0, next: 'ask' });
      expect(drillRows({ questions: [q('1', 1), q('2', 1), q('3', 0)], targets: [t], profile: none, local })[0]?.next).toBe('again');
      // 重算之後本機也看得到、而且有進步 → 先放。
      expect(drillRows({ questions: [q('1', 1)], targets: [t], profile: { targets: [{ key: t.key, improving: true } as WeakTarget] }, local })[0]?.next).toBe('park');
    }
    const row = (t: StoredTarget, n: number | null = null) => ({ target: { ...t, n, rate: n === null ? null : 0.5 }, before: { n, rate: n === null ? null : 0.5 } });
    expect(beforeText(row(report))).toBe('學習報告列為弱點');
    expect(beforeText(row(cases))).toBe('你問學習助手的題目');
    expect(beforeText(row(focus))).toBe('依你篩選的錯題');
    expect(beforeText(row({ ...report, from: undefined }))).toBe('組卷時列為弱點');
    expect(beforeText(row(report, 12))).toBe('組卷時 50%');
  });

  it('分享來的卷子：本卷涵蓋的技能依題數排序', () => {
    const qs = drillQuestions([input('1', 'reading', ['it:inference'], 1), input('2', 'reading', ['it:inference', 'it:detail'], 0)], () => null);
    expect(coveredSkills(qs)).toEqual([
      { section: 'reading', code: 'it:inference', n: 2 },
      { section: 'reading', code: 'it:detail', n: 1 },
    ]);
  });
});

describe('開關（§9.3、§17.1）', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('站主決定直接開放：開關預設是開的', () => {
    expect(WEAK_PAPER_ENABLED).toBe(true);
    expect(weakPaperVisible()).toBe(true);
  });

  it('?weakpaper=preview 記住預覽；種子只在預覽模式下有效', () => {
    window.history.replaceState(null, '', '/assistant/papers?paperseed=42');
    expect(weakPaperSeed()).toBeNull();
    window.history.replaceState(null, '', '/assistant/papers?weakpaper=preview&paperseed=42');
    expect(weakPaperSeed()).toBe(42);
    expect(window.localStorage.getItem(WEAK_PAPER_PREVIEW_KEY)).toBe('1');
    window.history.replaceState(null, '', '/assistant/papers?weakpaper=off');
    expect(weakPaperSeed()).toBeNull();
    expect(window.localStorage.getItem(WEAK_PAPER_PREVIEW_KEY)).toBeNull();
  });
});
