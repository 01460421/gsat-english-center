/**
 * 加強卷的組卷（docs/design/weak-paper.md §6、§10.1 的 assemblePaper.test.ts），用小型假資料：
 * 確定性、時間分配、收益遞減、每題只算一個弱點、五層候選、換一份、沒有明顯弱點與均衡加強卷、相鄰難度、沒有標註的題組、
 * 來源篩選、隨機抽題卷、保持手感、報告推薦、模考格式卷的優先序與診斷卷。
 */
import { AI_BANK_SOURCE, TIERS, type BankSectionType, type SourceRegistry, type Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { assemblePaper, allocateGroups, groupHits, sectionTieOrder, type AssembleInput, type AssembleResult, type AssembleTarget, type PaperRequest } from './assemblePaper';
import { BK2_MAX_GROUPS, BK2_QUESTIONS_PER_GROUP, encodeBk2 } from './code2';
import { GROUP_MINUTES } from './layout';
import type { PaperSkills } from './paperSkills';
import type { MockPool, MockPoolEntry, MockPoolReadingEntry, MockPoolTier } from './pool';
import { fakeEntry, fakePool, fakeTier } from './testFixtures';

const NOW = Date.parse('2026-10-23T00:00:00.000Z');
const DAY = 86_400_000;

function tier(prefix: string): MockPoolTier {
  return fakeTier({ vocabulary: 8, cloze: 10, word_bank: 6, structure: 8, mixed: 6, translation: 3, composition: 3 }, { chart: 3, table: 2, multi: 2, continuous: 13 }, prefix);
}

const POOL: MockPool = fakePool({ basic: tier('b1'), advanced: tier('a1'), top: tier('c1') });

/** 每一題的技能代碼（依題型與題組序號）：穩定基礎的閱讀沒有推論題（測相鄰難度）。 */
function skillsFor(pool: MockPool): PaperSkills {
  const groups: PaperSkills['groups'] = {};
  for (const t of TIERS) {
    for (const s of Object.keys(pool.tiers[t]) as BankSectionType[]) {
      (pool.tiers[t][s] as MockPoolEntry[]).forEach((e, i) => {
        const key = `${e.uid}@${e.v}`;
        const n = BK2_QUESTIONS_PER_GROUP[s];
        if (s === 'translation') groups[key] = { w: i % 2 === 0 ? ['ts:PERF', 'tt:tense_trigger'] : ['ts:PASS'] };
        else if (s === 'composition') groups[key] = { w: [] };
        else {
          const q: Record<string, string[]> = {};
          const tr: Record<string, Record<string, number>> = {};
          for (let k = 1; k <= n; k += 1) {
            let codes: string[];
            if (s === 'reading') codes = k === 3 && i % 3 === 0 && t !== 'basic' ? ['it:inference'] : k === 4 && i % 2 === 0 ? ['it:reference', 'ct:pronoun_reference'] : ['it:detail'];
            else if (s === 'structure') codes = k <= 1 + (i % 3) ? ['cl:pronoun_reference', 'ct:pronoun_reference'] : ['cl:contrast'];
            else if (s === 'vocabulary') codes = k <= i % 4 ? ['sn:extended'] : ['tp:collocation', 'sn:core'];
            else if (s === 'cloze') codes = k <= 1 + (i % 2) ? ['tp:grammar'] : ['tp:connective'];
            else if (s === 'word_bank') codes = k <= i % 3 ? ['sn:conversion'] : ['tp:word_meaning', 'sn:core'];
            else codes = ['it:synthesis'];
            q[String(k)] = codes;
            if (s === 'reading') tr[String(k)] = i % 2 === 0 ? { DS: 2, NM: 1 } : { OP: 2, TN: 1 };
          }
          groups[key] = s === 'reading' ? { q, tr } : { q };
        }
      });
    }
  }
  return { version: 't', codeSections: {}, groups };
}

const SKILLS = skillsFor(POOL);

const skill = (section: BankSectionType, code: string, weight: number): AssembleTarget => ({ key: `skill:${section}:${code}`, kind: 'skill', section, code, codes: [code], weight });
const sectionTarget = (section: BankSectionType, weight: number): AssembleTarget => ({ key: `sec:${section}`, kind: 'section', section, code: null, codes: [], weight });

const BASE_TARGETS = [skill('reading', 'it:inference', 0.3), skill('structure', 'cl:pronoun_reference', 0.2), skill('vocabulary', 'sn:extended', 0.2)];

function weakRequest(extra: Partial<PaperRequest> = {}): PaperRequest {
  return { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid', ...extra };
}

function run(extra: Partial<AssembleInput> = {}): AssembleResult {
  return assemblePaper({
    pool: POOL,
    skills: SKILLS,
    sources: null,
    profile: { targets: BASE_TARGETS, maintenance: null },
    request: weakRequest(),
    used: new Map(),
    avoid: new Set(),
    wrong: new Map(),
    seed: 1,
    now: NOW,
    ...extra,
  });
}

function ok(r: AssembleResult): Extract<AssembleResult, { ok: true }> {
  if (!r.ok) throw new Error(`組卷失敗：${r.reason}`);
  return r;
}

const minutesOf = (r: Extract<AssembleResult, { ok: true }>) => r.slots.reduce((s, x) => s + GROUP_MINUTES[x.section], 0);
const timeIn = (r: Extract<AssembleResult, { ok: true }>, s: BankSectionType) => r.slots.filter((x) => x.section === s).reduce((t, x) => t + GROUP_MINUTES[x.section], 0);

describe('弱點加強卷：確定性與時間分配', () => {
  it('同樣的輸入結果相同；換種子不同；代號編得出來', () => {
    const a = ok(run());
    expect(ok(run())).toEqual(a);
    const ids = new Set([1, 2, 3, 4, 5].map((seed) => ok(run({ seed })).slots.map((s) => s.uid).join()));
    expect(ids.size).toBeGreaterThan(1);
    expect(encodeBk2('w', a.slots).startsWith('bk2-w-')).toBe(true);
  });

  it('依權重分配：三種長度的合計在長度 ±5 分鐘、≤ 12 組、≤ 80 題、單一大題 ≤ 六成；只有弱點的大題', () => {
    for (const minutes of [20, 40, 60] as const) {
      for (let seed = 0; seed < 10; seed += 1) {
        const r = ok(run({ seed, request: weakRequest({ minutes }) }));
        const total = minutesOf(r);
        expect(total).toBeGreaterThanOrEqual(minutes - 5);
        expect(total).toBeLessThanOrEqual(minutes + 5);
        expect(r.minutes).toBeLessThanOrEqual(minutes + 5);
        expect(r.slots.length).toBeLessThanOrEqual(BK2_MAX_GROUPS);
        expect(r.slots.reduce((n, s) => n + BK2_QUESTIONS_PER_GROUP[s.section], 0)).toBeLessThanOrEqual(80);
        for (const s of ['reading', 'structure', 'vocabulary'] as const) expect(timeIn(r, s)).toBeLessThanOrEqual(0.6 * minutes + 1e-9);
        const sections = new Set(r.slots.map((s) => s.section));
        // 只放有弱點的大題；20 分鐘放不下三個大題各一組（閱讀 8⅓＋篇章 7＋詞彙 7 ＞ 20＋2）：權重高的先放，
        // 同權重（代名詞指涉、延伸義都是 0.2）依弱點的排名（篇章結構那一項排在前面）。
        for (const s of sections) expect(['reading', 'structure', 'vocabulary']).toContain(s);
        if (minutes >= 40) expect(sections).toEqual(new Set(['reading', 'structure', 'vocabulary']));
        else expect(sections).toEqual(new Set(['reading', 'structure']));
      }
    }
  });

  it('只選一個大題時不受六成的限制：只勾閱讀、60 分鐘 → 7 篇', () => {
    const r = ok(run({ request: weakRequest({ minutes: 60, sections: ['reading'] }) }));
    expect(r.slots.map((s) => s.section)).toEqual(Array(7).fill('reading'));
  });

  it('allocateGroups：權重比例、放得下才放、作文與中譯英最多 1 組', () => {
    const counts = allocateGroups(
      new Map([
        ['reading', 0.4],
        ['cloze', 0.1],
      ]),
      40,
      new Map([
        ['reading', 10],
        ['cloze', 10],
      ]),
    );
    expect(counts.get('reading')).toBe(2);
    expect((counts.get('cloze') ?? 0) * GROUP_MINUTES.cloze + (counts.get('reading') ?? 0) * GROUP_MINUTES.reading).toBeLessThanOrEqual(42);
    const writing = allocateGroups(new Map([['composition', 1]]), 60, new Map([['composition', 5]]));
    expect(writing.get('composition')).toBe(1);
    // 同權重時依 tieOrder（弱點的排名）：40 分鐘、閱讀 0.3、篇章與詞彙各 0.2 → 閱讀 2、排名在前的大題 2、另一個 1。
    const tie = (order: BankSectionType[]) =>
      allocateGroups(
        new Map<BankSectionType, number>([
          ['reading', 0.3],
          ['structure', 0.2],
          ['vocabulary', 0.2],
        ]),
        40,
        new Map<BankSectionType, number>([
          ['reading', 10],
          ['structure', 10],
          ['vocabulary', 10],
        ]),
        undefined,
        order,
      );
    expect(Object.fromEntries(tie(sectionTieOrder([skill('reading', 'it:inference', 0.3), skill('structure', 'cl:pronoun_reference', 0.2)])))).toEqual({ reading: 2, structure: 2, vocabulary: 1 });
    expect(Object.fromEntries(tie(sectionTieOrder([skill('reading', 'it:inference', 0.3), skill('vocabulary', 'sn:extended', 0.2)])))).toEqual({ reading: 2, structure: 1, vocabulary: 2 });
  });

  it('作文是前兩名弱點的 40 分鐘卷：放得進一篇作文（六成上限從第二組起算），合計在 40 ± 5 分鐘', () => {
    const targets = [sectionTarget('composition', 0.3), skill('reading', 'it:inference', 0.2)];
    for (let seed = 0; seed < 5; seed += 1) {
      for (const maintenance of [null, { section: 'cloze' as const }]) {
        const r = ok(run({ seed, profile: { targets, maintenance } }));
        expect(r.slots.filter((s) => s.section === 'composition')).toHaveLength(1);
        expect(r.slots.some((s) => s.section === 'reading')).toBe(true);
        expect(r.minutes).toBeGreaterThanOrEqual(35);
        expect(r.minutes).toBeLessThanOrEqual(45);
      }
    }
    // 自己勾作文與閱讀也一樣。
    const manual = ok(run({ profile: { targets, maintenance: null }, request: weakRequest({ sections: ['reading', 'composition'] }) }));
    expect(manual.slots.map((s) => s.section)).toContain('composition');
    expect(manual.minutes).toBeGreaterThanOrEqual(35);
  });

  it('allocateGroups：第一輪放不進的大題拿掉，不再壓低其他大題的六成上限', () => {
    // 篇章結構沒有題組：只剩閱讀一個大題，40 分鐘放到預算（不是六成的 2 組）。
    const counts = allocateGroups(
      new Map<BankSectionType, number>([
        ['reading', 0.3],
        ['structure', 0.2],
      ]),
      40,
      new Map<BankSectionType, number>([
        ['reading', 10],
        ['structure', 0],
      ]),
    );
    expect(counts.get('reading')).toBe(5);
    expect(counts.get('structure') ?? 0).toBe(0);
  });

  it('卷面依大題順序排（詞彙 → 篇章結構 → 閱讀）', () => {
    const r = ok(run());
    const order = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition'];
    const idx = r.slots.map((s) => order.indexOf(s.section));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});

describe('命中與收益', () => {
  it('每題只算一個弱點：一題同時帶兩個目標的代碼時只算給權重高的那一個；hits 合計不超過題數', () => {
    const e = (POOL.tiers.advanced.reading as MockPoolReadingEntry[])[0] as MockPoolReadingEntry;
    const reference = skill('reading', 'it:reference', 0.3);
    const group: AssembleTarget = { key: 'err:cohesion', kind: 'error', section: 'reading', code: 'cohesion', codes: ['it:reference', 'it:detail'], weight: 0.1 };
    const hits = groupHits(SKILLS, e, 'reading', [reference, group]);
    // 第 4 題（it:reference）算給 it:reference；其他三題（it:detail、推論）只有錯因群組命中 it:detail 的那幾題。
    expect(hits['skill:reading:it:reference']).toBe(1);
    expect((hits['err:cohesion'] ?? 0) + (hits['skill:reading:it:reference'] ?? 0)).toBeLessThanOrEqual(4);
    const trap: AssembleTarget = { key: 'trap:NM', kind: 'trap', section: 'reading', code: 'NM', codes: [], weight: 0.2 };
    expect(groupHits(SKILLS, e, 'reading', [trap])).toEqual({ 'trap:NM': 4 });
    for (let seed = 0; seed < 10; seed += 1) {
      const r = ok(run({ seed }));
      r.notes.forEach((n, i) => expect(Object.values(n.hits).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(BK2_QUESTIONS_PER_GROUP[r.slots[i]?.section ?? 'reading']));
    }
  });

  it('別名：ct:pronoun_reference 正規化成 it:reference（閱讀）、cl:pronoun_reference（篇章結構）', () => {
    const st = (POOL.tiers.advanced.structure as MockPoolEntry[])[2] as MockPoolEntry;
    expect(groupHits(SKILLS, st, 'structure', [skill('structure', 'cl:pronoun_reference', 0.2)])).toEqual({ 'skill:structure:cl:pronoun_reference': 3 });
  });

  it('收益遞減：兩個同權重的技能各放到題，不會全塞同一個', () => {
    const targets = [skill('reading', 'it:inference', 0.3), skill('reading', 'it:reference', 0.3)];
    for (let seed = 0; seed < 5; seed += 1) {
      const r = ok(run({ seed, profile: { targets, maintenance: null } }));
      const total = (k: string) => r.notes.reduce((s, n) => s + (n.hits[k] ?? 0), 0);
      expect(total('skill:reading:it:inference')).toBeGreaterThan(0);
      expect(total('skill:reading:it:reference')).toBeGreaterThan(0);
    }
  });
});

describe('五層候選與換一份', () => {
  const structureOnly = { targets: [skill('structure', 'cl:pronoun_reference', 0.3)], maintenance: null };
  const st = (POOL.tiers.advanced.structure as MockPoolEntry[]).map((e) => e.uid);

  it('沒做過的優先；avoid 裡的題組排在沒做過、收益 > 0 的後面（標 avoided_reuse）', () => {
    const r = ok(run({ profile: structureOnly, request: weakRequest({ minutes: 20, sections: ['structure'] }), avoid: new Set(st.slice(0, 5)) }));
    expect(r.slots.every((s) => !st.slice(0, 5).includes(s.uid))).toBe(true);
    const all = ok(run({ profile: structureOnly, request: weakRequest({ minutes: 20, sections: ['structure'] }), avoid: new Set(st) }));
    expect(all.notes.every((n) => n.flags.includes('avoided_reuse'))).toBe(true);
  });

  it('retest：7 天以上前做過、當時答錯過這個大題弱點的題組排在盡量避開的前面（標 retest）；avoid 規則不會出現重做', () => {
    const old = st[1] ?? '';
    const recent = st[3] ?? '';
    const used = new Map([
      [old, NOW - 10 * DAY],
      [recent, NOW - 3 * DAY],
    ]);
    const wrong = new Map([
      [old, { at: NOW - 10 * DAY, questions: [['cl:pronoun_reference']] }],
      [recent, { at: NOW - 3 * DAY, questions: [['cl:pronoun_reference']] }],
    ]);
    const avoid = new Set(st.filter((u) => u !== old && u !== recent));
    const retest = ok(run({ profile: structureOnly, request: weakRequest({ minutes: 20, sections: ['structure'], reuse: 'retest' }), used, wrong, avoid }));
    expect(retest.slots[0]?.uid).toBe(old);
    expect(retest.notes[0]?.flags).toContain('retest');
    const avoidRule = ok(run({ profile: structureOnly, request: weakRequest({ minutes: 20, sections: ['structure'], reuse: 'avoid' }), used, wrong, avoid }));
    expect(avoidRule.notes.some((n) => n.flags.includes('retest'))).toBe(false);
    expect(avoidRule.slots.every((s) => s.uid !== old && s.uid !== recent)).toBe(true);
  });

  it('做過的題組最後才用（最早做的先），標 reused', () => {
    // 三種難度的篇章結構都做過（否則依 §4.1，基準難度沒有沒做過的命中題組時會為這個弱點改用相鄰一級沒做過的題組）。
    const others = TIERS.filter((t) => t !== 'advanced').flatMap((t) => (POOL.tiers[t].structure as MockPoolEntry[]).map((e) => e.uid));
    const used = new Map([...st.map((u, i) => [u, NOW - (i + 1) * DAY] as const), ...others.map((u) => [u, NOW] as const)]);
    const r = ok(run({ profile: structureOnly, request: weakRequest({ minutes: 20, sections: ['structure'] }), used }));
    expect(r.notes.every((n) => n.flags.includes('reused'))).toBe(true);
    expect(r.slots.every((s) => s.tier === 'advanced')).toBe(true);
    expect(r.slots[0]?.uid).toBe(st[st.length - 1]);
  });

  it('基準難度的命中題組都做過時，為那個弱點改用相鄰一級沒做過的題組（不先用做過的）', () => {
    const used = new Map(st.map((u, i) => [u, NOW - (i + 1) * DAY]));
    const r = ok(run({ profile: structureOnly, request: weakRequest({ minutes: 20, sections: ['structure'] }), used }));
    expect(r.slots.some((s) => s.tier !== 'advanced')).toBe(true);
    r.slots.forEach((s, i) => {
      if (s.tier === 'advanced') return;
      expect(r.notes[i]?.flags).toContain('adjacent_tier');
      expect(r.notes[i]?.flags).not.toContain('reused');
    });
  });

  it('收益 0 而且在盡量避開的題組也挑得到（排在收益 0、不在盡量避開的後面）', () => {
    const none = { targets: [skill('structure', 'cl:contrast', 0.3)], maintenance: null };
    const skills: PaperSkills = structuredClone(SKILLS);
    for (const t of TIERS) for (const e of POOL.tiers[t].structure as MockPoolEntry[]) skills.groups[`${e.uid}@${e.v}`] = { q: { '1': ['cl:topic_sentence'], '2': [], '3': [], '4': [] } };
    const r = ok(run({ skills, profile: none, request: weakRequest({ minutes: 20, sections: ['structure'] }), avoid: new Set(st) }));
    expect(r.slots.length).toBeGreaterThan(0);
    expect(r.notes.every((n) => n.flags.includes('avoided_reuse'))).toBe(true);
    const some = ok(run({ skills, profile: none, request: weakRequest({ minutes: 20, sections: ['structure'] }), avoid: new Set(st.slice(0, 4)) }));
    expect(some.slots.every((s) => !st.slice(0, 4).includes(s.uid))).toBe(true);
  });

  it('換一份：同請求換種子、把第一份列為 avoid，兩份重疊 ≤ 30%', () => {
    const first = ok(run({ seed: 11 }));
    const second = ok(run({ seed: 12, avoid: new Set(first.slots.map((s) => s.uid)) }));
    const overlap = second.slots.filter((s) => first.slots.some((f) => f.uid === s.uid)).length / second.slots.length;
    expect(overlap).toBeLessThanOrEqual(0.3);
  });
});

describe('沒有明顯弱點、均衡加強卷、相鄰難度、沒有標註', () => {
  it('no_weakness：沒有目標、不是均衡加強卷', () => {
    expect(run({ profile: { targets: [], maintenance: null } })).toEqual({ ok: false, reason: 'no_weakness' });
    expect(run({ profile: null })).toEqual({ ok: false, reason: 'no_weakness' });
  });

  it('均衡加強卷：每個選擇題大題各一組（閱讀、綜合測驗優先），標 balanced', () => {
    const r = ok(run({ profile: null, request: weakRequest({ balanced: true }) }));
    for (const s of ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading'] as const) expect(r.slots.some((x) => x.section === s)).toBe(true);
    expect(r.notes.every((n) => n.flags.includes('balanced'))).toBe(true);
    const short = ok(run({ profile: null, request: weakRequest({ balanced: true, minutes: 20 }) }));
    expect(short.slots.map((s) => s.section)).toContain('reading');
    expect(short.slots.map((s) => s.section)).toContain('cloze');
  });

  it('相鄰難度只為沒有供應的那個弱點、只限命中那個弱點的題組（標 adjacent_tier）', () => {
    const r = ok(run({ request: weakRequest({ tiers: ['basic'], minutes: 40 }) }));
    const adjacent = r.slots.filter((_, i) => r.notes[i]?.flags.includes('adjacent_tier'));
    expect(adjacent.length).toBeGreaterThan(0);
    for (const [i, s] of r.slots.entries()) {
      if (s.tier === 'basic') continue;
      expect(s.tier).toBe('advanced');
      expect(s.section).toBe('reading');
      expect(r.notes[i]?.hits['skill:reading:it:inference']).toBeGreaterThan(0);
    }
    // 篇章結構、詞彙在穩定基礎有供應：用穩定基礎。
    expect(r.slots.filter((s) => s.section !== 'reading').every((s) => s.tier === 'basic')).toBe(true);
  });

  it('沒有技能標註的題組只拿大題那一項的收益，標 no_tags', () => {
    const skills: PaperSkills = structuredClone(SKILLS);
    for (const e of POOL.tiers.advanced.mixed as MockPoolEntry[]) skills.groups[`${e.uid}@${e.v}`] = { q: { '1': [], '2': [], '3': [], '4': [] } };
    const r = ok(run({ skills, profile: { targets: [sectionTarget('mixed', 0.3)], maintenance: null }, request: weakRequest({ minutes: 20 }) }));
    expect(r.slots.every((s) => s.section === 'mixed')).toBe(true);
    expect(r.notes.every((n) => n.flags.includes('no_tags'))).toBe(true);
  });
});

describe('來源', () => {
  const pub = { ...AI_BANK_SOURCE, id: 'pub-x', ns: 'pb' as const, kind: 'publisher' as const, label_zh: '測試出版', attribution_zh: '本題出自測試出版《模擬試題》，經授權使用', scope: ['web' as const, 'pdf' as const], ends_on: '2099-12-31' };
  const withPb = structuredClone(POOL);
  for (let i = 0; i < 6; i += 1) {
    const uid = `pb.rd.f0000${i}`;
    (withPb.tiers.advanced.reading as MockPoolReadingEntry[]).push({ ...(fakeEntry('reading', uid) as MockPoolReadingEntry), theme: [`c:${uid}`], ex: 'ns', src: 'pub-x' });
  }
  const randomReq: PaperRequest = { kind: 'r', tiers: ['advanced'], sections: ['reading'], counts: { reading: 6 }, sources: ['ai-bank', 'pub-x'], reuse: 'allow' };
  const pbCount = (registry: SourceRegistry | null, request: PaperRequest = randomReq) => {
    let n = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const r = assemblePaper({ pool: withPb, skills: SKILLS, sources: registry, profile: null, request, used: new Map(), avoid: new Set(), wrong: new Map(), seed, now: NOW });
      if (r.ok) n += r.slots.filter((s) => s.ns === 'pb').length;
    }
    return n;
  };

  it('勾了有效、授權包含網站與 PDF 的出版社來源才會用到出版社題組；停用、過期、沒有 PDF 授權、沒勾都不會', () => {
    expect(pbCount({ version: 'x', sources: [AI_BANK_SOURCE, pub] })).toBeGreaterThan(0);
    expect(pbCount({ version: 'x', sources: [AI_BANK_SOURCE, pub] }, { ...randomReq, sources: ['ai-bank'] })).toBe(0);
    expect(pbCount({ version: 'x', sources: [AI_BANK_SOURCE, { ...pub, active: false }] })).toBe(0);
    expect(pbCount({ version: 'x', sources: [AI_BANK_SOURCE, { ...pub, ends_on: '2026-10-22' }] })).toBe(0);
    expect(pbCount({ version: 'x', sources: [AI_BANK_SOURCE, { ...pub, scope: ['web'] }] })).toBe(0);
    expect(pbCount(null)).toBe(0);
  });

  it('出版社題組的 sw 是空陣列（不調整答案位置）', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const r = ok(assemblePaper({ pool: withPb, skills: SKILLS, sources: { version: 'x', sources: [AI_BANK_SOURCE, pub] }, profile: null, request: randomReq, used: new Map(), avoid: new Set(), wrong: new Map(), seed, now: NOW }));
      for (const s of r.slots) if (s.ns === 'pb') expect(s.sw).toEqual([]);
    }
  });
});

describe('隨機抽題卷', () => {
  const req: PaperRequest = { kind: 'r', tiers: ['basic', 'top'], sections: ['reading', 'mixed', 'translation'], counts: { reading: 2, mixed: 1, translation: 1 }, sources: ['ai-bank'], reuse: 'avoid' };
  const base = (extra: Partial<AssembleInput> = {}) => assemblePaper({ pool: POOL, skills: SKILLS, sources: null, profile: null, request: req, used: new Map(), avoid: new Set(), wrong: new Map(), seed: 3, now: NOW, ...extra });

  it('每個大題的組數完全等於設定；只用勾的難度；卷面依大題、同大題依難度排', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const r = ok(base({ seed }));
      expect(r.slots.map((s) => s.section)).toEqual(['reading', 'reading', 'mixed', 'translation']);
      expect(r.slots.every((s) => s.tier === 'basic' || s.tier === 'top')).toBe(true);
      const rd = r.slots.filter((s) => s.section === 'reading').map((s) => TIERS.indexOf(s.tier as Tier));
      expect(rd).toEqual([...rd].sort());
    }
  });

  it('做過的題組：不夠才用（標 reused）；allow 時和沒做過的一樣', () => {
    const used = new Map([...(POOL.tiers.basic.mixed as MockPoolEntry[]), ...(POOL.tiers.top.mixed as MockPoolEntry[])].map((e, i) => [e.uid, i + 1]));
    const r = ok(base({ used }));
    const mx = r.notes[2];
    expect(mx?.flags).toContain('reused');
    expect(r.notes.filter((n) => n.flags.includes('reused'))).toHaveLength(1);
  });

  it('題庫本身不夠：insufficient（說明哪個大題）；主題衝突時放寬', () => {
    // 超過上限（每個大題 12 組、中譯英 1 組）不默默截短。
    expect(base({ request: { ...req, counts: { reading: 50 } } })).toMatchObject({ ok: false, reason: 'insufficient', section: 'reading' });
    expect(base({ request: { ...req, counts: { reading: 2, mixed: 1, translation: 2 } } })).toMatchObject({ ok: false, reason: 'insufficient', section: 'translation' });
    // 最長 100 分鐘（§4.4）：混合題 10 組＋中譯英＋作文是 12 組、40 題，但 135 分鐘。
    const long = { ...req, sections: ['mixed', 'translation', 'composition'] as BankSectionType[], counts: { mixed: 10, translation: 1, composition: 1 } };
    expect(base({ request: long })).toMatchObject({ ok: false, reason: 'insufficient', section: 'composition' });
    expect(ok(base({ request: { ...long, counts: { mixed: 6, translation: 1, composition: 1 } } })).minutes).toBeLessThanOrEqual(100);
    // 題庫本身不夠：兩種難度的閱讀各只剩 5 篇，要 12 篇。
    const thin = structuredClone(POOL);
    for (const t of TIERS) thin.tiers[t].reading = (thin.tiers[t].reading as MockPoolReadingEntry[]).slice(0, 5);
    expect(base({ pool: thin, request: { ...req, counts: { reading: 12 } } })).toMatchObject({ ok: false, reason: 'insufficient', section: 'reading' });
    const clash = structuredClone(POOL);
    for (const t of TIERS) for (const e of clash.tiers[t].mixed as MockPoolEntry[]) e.theme = ['c:same'];
    for (const t of TIERS) for (const e of clash.tiers[t].reading as MockPoolEntry[]) e.theme = ['c:same'];
    const r = ok(base({ pool: clash }));
    expect(r.relaxed).toEqual(['theme']);
  });
});

describe('保持手感、報告推薦', () => {
  it('保持手感：長度 ≥ 40 分鐘、依弱點自動選時放一組基準難度、沒做過的題組（標 maintenance）', () => {
    const r = ok(run({ profile: { targets: BASE_TARGETS, maintenance: { section: 'cloze' } } }));
    const i = r.slots.findIndex((s) => s.section === 'cloze');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r.notes[i]?.flags).toEqual(['maintenance']);
    expect(r.slots[i]?.tier).toBe('advanced');
    // 20 分鐘的卷子不放。
    expect(ok(run({ profile: { targets: BASE_TARGETS, maintenance: { section: 'cloze' } }, request: weakRequest({ minutes: 20 }) })).slots.some((s) => s.section === 'cloze')).toBe(false);
  });

  it('報告推薦（pins）在對應大題先放，最多 2 組，要沒做過、符合難度與大題', () => {
    const st = (POOL.tiers.advanced.structure as MockPoolEntry[]).map((e) => e.uid);
    const pins = [st[5] ?? '', st[6] ?? '', st[7] ?? ''];
    const r = ok(run({ request: weakRequest({ pins }) }));
    const pinned = r.slots.filter((_, i) => r.notes[i]?.flags.includes('pinned')).map((s) => s.uid);
    expect(pinned.length).toBeGreaterThan(0);
    expect(pinned.length).toBeLessThanOrEqual(2);
    for (const uid of pinned) expect(pins.slice(0, 2)).toContain(uid);
    const usedPin = ok(run({ request: weakRequest({ pins: [st[5] ?? ''] }), used: new Map([[st[5] ?? '', 1]]) }));
    expect(usedPin.notes.some((n) => n.flags.includes('pinned'))).toBe(false);
  });
});

describe('模考格式卷（f）與中性卷（m）', () => {
  const full = (kind: 'f' | 'm', extra: Partial<AssembleInput> = {}, request: Partial<PaperRequest> = {}) =>
    assemblePaper({
      pool: POOL,
      skills: SKILLS,
      sources: null,
      profile: kind === 'f' ? { targets: [skill('reading', 'it:inference', 0.3)], maintenance: null } : null,
      request: { kind, tiers: ['advanced'], sections: [], sources: ['ai-bank'], reuse: 'avoid', ...request },
      used: new Map(),
      avoid: new Set(),
      wrong: new Map(),
      seed: 5,
      now: NOW,
      ...extra,
    });

  it('照藍圖的 11 組、單一難度；偏重弱點的閱讀命中比中性卷多', () => {
    let weak = 0;
    let neutral = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const f = ok(full('f', { seed }));
      expect(f.slots).toHaveLength(11);
      expect(f.slots.every((s) => s.tier === 'advanced')).toBe(true);
      weak += f.notes.reduce((s, n) => s + (n.hits['skill:reading:it:inference'] ?? 0), 0);
      const m = ok(full('m', { seed }));
      neutral += m.slots.filter((s) => s.section === 'reading').reduce((s, x) => s + (groupHits(SKILLS, x, 'reading', [skill('reading', 'it:inference', 0.3)])['skill:reading:it:inference'] ?? 0), 0);
    }
    expect(weak).toBeGreaterThan(neutral);
    expect(encodeBk2('f', ok(full('f')).slots)).toHaveLength(83);
  });

  it('診斷卷：每個大題優先挑技能種類多的題組', () => {
    const distinct = (r: Extract<AssembleResult, { ok: true }>) => r.slots.filter((s) => s.section === 'vocabulary').map((s) => new Set(Object.values(SKILLS.groups[`${s.uid}@${s.v}`]?.q ?? {}).flat()).size)[0] ?? 0;
    for (let seed = 0; seed < 10; seed += 1) expect(distinct(ok(full('m', { seed }, { diagnostic: true })))).toBe(3);
  });

  it('盡量避開的題組排在沒做過那一層的最後', () => {
    const first = ok(full('m', { seed: 9 }));
    const second = ok(full('m', { seed: 9, avoid: new Set(first.slots.map((s) => s.uid)) }));
    const overlap = second.slots.filter((s) => first.slots.some((f) => f.uid === s.uid)).length;
    expect(overlap).toBeLessThan(first.slots.length);
    expect(second.notes.filter((n) => n.flags.includes('avoided_reuse')).length).toBe(overlap);
  });
});
