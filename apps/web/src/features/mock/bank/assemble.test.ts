/**
 * 組卷演算法（設計文件 §4.1–§4.5、§10.1），用小型假資料：
 * 確定性、沒做過的優先、主題衝突、閱讀的圖表規則、只有不夠的大題用做過的題組、放寬的範圍、排除原因、題庫不夠、
 * 不混難度、換題（avoid），以及「還可以組約 N 份」的估計。
 */
import type { BankSectionType } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { assembleSelection, insufficientSection, remainingEstimate, type AssembleSelectionResult, type SlotPick } from './assemble';
import { BLUEPRINT_SLOTS, READING_SLOTS } from './blueprint';
import type { MockPoolEntry, MockPoolReadingEntry, MockPoolTier } from './pool';
import { fakeTier, fakeUid } from './testFixtures';

function ok(result: AssembleSelectionResult): Extract<AssembleSelectionResult, { ok: true }> {
  if (!result.ok) throw new Error(`組卷失敗：${result.section}`);
  return result;
}

function entryOf(pool: MockPoolTier, pick: SlotPick): MockPoolEntry & Partial<MockPoolReadingEntry> {
  const e = (pool[pick.section] as (MockPoolEntry & Partial<MockPoolReadingEntry>)[]).find((x) => x.uid === pick.uid);
  if (!e) throw new Error(`池子裡沒有 ${pick.uid}`);
  return e;
}

/** 一份卷子的基本性質：位置與題型相符、uid 不重複、全部在池子裡、閱讀恰好一篇圖表且在第一篇、多文本最多一篇。 */
function expectValidPaper(pool: MockPoolTier, slots: SlotPick[], { strictFigure = true } = {}) {
  expect(slots).toHaveLength(11);
  slots.forEach((s, i) => {
    expect(s.section).toBe(BLUEPRINT_SLOTS[i]?.section);
    expect(s.uid.startsWith(`ai.${BLUEPRINT_SLOTS[i]?.uidCode}.`)).toBe(true);
  });
  expect(new Set(slots.map((s) => s.uid)).size).toBe(11);
  const reading = READING_SLOTS.map((i) => entryOf(pool, slots[i] as SlotPick));
  if (strictFigure) {
    expect(reading.filter((e) => e.fig != null)).toHaveLength(1);
    expect(reading[0]?.fig).not.toBeNull();
    expect(reading.filter((e) => e.form === 'multi_text').length).toBeLessThanOrEqual(1);
  }
}

describe('assembleSelection：基本規則', () => {
  it('同樣的 (pool, seed, used) 結果相同；換種子結果不同', () => {
    const pool = fakeTier({ vocabulary: 6, cloze: 8, word_bank: 6, structure: 6, mixed: 6, translation: 6, composition: 6 }, { chart: 3, table: 2, multi: 2, continuous: 8 });
    const a = ok(assembleSelection(pool, 12345, new Map()));
    const b = ok(assembleSelection(pool, 12345, new Map()));
    expect(b).toEqual(a);
    expectValidPaper(pool, a.slots);
    const others = [1, 2, 3, 4, 5].map((seed) => ok(assembleSelection(pool, seed, new Map())).slots.map((s) => s.uid).join());
    expect(new Set([a.slots.map((s) => s.uid).join(), ...others]).size).toBeGreaterThan(1);
  });

  it('三百個種子：每一份都符合規則，relaxed 與 reused 都是空的', () => {
    const pool = fakeTier({}, { chart: 2, table: 1, multi: 2, continuous: 4 });
    for (let seed = 0; seed < 300; seed += 1) {
      const r = ok(assembleSelection(pool, seed, new Map()));
      expectValidPaper(pool, r.slots);
      expect(r.relaxed).toEqual([]);
      expect(r.reused).toEqual([]);
    }
  });

  it('閱讀：圖表或表格那一篇在第一篇，其他兩篇的順序由種子決定；綜合測驗兩組的順序也是', () => {
    const pool = fakeTier({ cloze: 2 }, { chart: 1, table: 0, multi: 0, continuous: 2 });
    const orders = new Set<string>();
    const clozeOrders = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const r = ok(assembleSelection(pool, seed, new Map()));
      expect(entryOf(pool, r.slots[READING_SLOTS[0] ?? 5] as SlotPick).fig).toBe('chart');
      orders.add(READING_SLOTS.map((i) => r.slots[i]?.uid).join());
      clozeOrders.add(`${r.slots[1]?.uid},${r.slots[2]?.uid}`);
    }
    expect(orders.size).toBe(2);
    expect(clozeOrders.size).toBe(2);
  });

  it('閱讀的 sw 照抄到選中的位置；其他題型是空陣列', () => {
    const pool = fakeTier({}, { chart: 1, table: 0, multi: 0, continuous: 2 });
    for (const e of pool.reading) e.sw = [[1, 2]];
    const r = ok(assembleSelection(pool, 1, new Map()));
    for (const i of READING_SLOTS) expect(r.slots[i]?.sw).toEqual([[1, 2]]);
    expect(r.slots[0]?.sw).toEqual([]);
  });

  it('帶排除原因的條目不會被選到', () => {
    const pool = fakeTier({ mixed: 4 });
    const excluded = new Set(pool.mixed.slice(0, 3).map((e) => e.uid));
    pool.mixed.slice(0, 3).forEach((e) => (e.ex = 'glyph'));
    for (let seed = 0; seed < 30; seed += 1) {
      const r = ok(assembleSelection(pool, seed, new Map()));
      expect(excluded.has(r.slots[8]?.uid ?? '')).toBe(false);
    }
  });

  it('某大題候選數（含做過的）不足：回傳 insufficient；只剩帶排除原因的也算不足', () => {
    expect(assembleSelection(fakeTier({ composition: 0 }), 1, new Map())).toEqual({ ok: false, reason: 'insufficient', section: 'composition' });
    expect(assembleSelection(fakeTier({ cloze: 1 }), 1, new Map())).toEqual({ ok: false, reason: 'insufficient', section: 'cloze' });
    expect(assembleSelection(fakeTier({}, { chart: 1, table: 0, multi: 0, continuous: 1 }), 1, new Map())).toMatchObject({ ok: false, section: 'reading' });
    const pool = fakeTier({ structure: 2 });
    pool.structure.forEach((e) => (e.ex = 'marker'));
    expect(assembleSelection(pool, 1, new Map())).toMatchObject({ ok: false, section: 'structure' });
    expect(insufficientSection(pool)).toBe('structure');
    expect(insufficientSection(fakeTier())).toBeNull();
  });
});

describe('assembleSelection：做過的題組', () => {
  it('沒做過的優先：做過的 uid 只要還有沒做過的就不會被選到', () => {
    const pool = fakeTier({ vocabulary: 3, cloze: 4, mixed: 3 }, { chart: 2, table: 0, multi: 0, continuous: 4 });
    const used = new Map<string, number>([
      [fakeUid('vocabulary', 1), 1000],
      [fakeUid('vocabulary', 2), 2000],
      [fakeUid('cloze', 1), 1000],
      [fakeUid('reading', 1), 1000],
    ]);
    for (let seed = 0; seed < 50; seed += 1) {
      const r = ok(assembleSelection(pool, seed, used));
      expect(r.reused).toEqual([]);
      for (const s of r.slots) expect(used.has(s.uid)).toBe(false);
    }
  });

  it('不夠時只在不夠的大題用做過的題組，做過的依最後使用時間由舊到新用；其他大題照樣用沒做過的', () => {
    const pool = fakeTier({ vocabulary: 4, word_bank: 4 });
    const used = new Map<string, number>([
      [fakeUid('vocabulary', 1), 3000],
      [fakeUid('vocabulary', 2), 1000],
      [fakeUid('vocabulary', 3), 2000],
      [fakeUid('vocabulary', 4), 4000],
      [fakeUid('word_bank', 1), 1000],
    ]);
    for (let seed = 0; seed < 30; seed += 1) {
      const r = ok(assembleSelection(pool, seed, used));
      expect(r.reused).toEqual([0]);
      expect(r.slots[0]?.uid).toBe(fakeUid('vocabulary', 2));
      expect(used.has(r.slots[3]?.uid ?? '')).toBe(false);
    }
  });

  it('閱讀依組卷規則判斷夠不夠：沒做過的圖表篇用完時，閱讀用做過的圖表篇（不放寬圖表規則），其他大題不受影響', () => {
    const pool = fakeTier({}, { chart: 2, table: 0, multi: 0, continuous: 4 });
    const used = new Map<string, number>([
      [fakeUid('reading', 1), 2000],
      [fakeUid('reading', 2), 1000],
    ]);
    const r = ok(assembleSelection(pool, 9, used));
    expect(r.relaxed).toEqual([]);
    expect(r.reused).toEqual([READING_SLOTS[0]]);
    expect(r.slots[READING_SLOTS[0] ?? 5]?.uid).toBe(fakeUid('reading', 2));
    expectValidPaper(pool, r.slots);
  });

  it('放寬的範圍：主題衝突、但每個大題都有足夠沒做過的題組時，reused 是空的、relaxed 含 theme', () => {
    const pool = fakeTier({ vocabulary: 2, cloze: 2, word_bank: 1, structure: 1, mixed: 1, translation: 1, composition: 1 }, { chart: 1, table: 0, multi: 0, continuous: 2 });
    // 篇章結構和文意選填都講腳踏車：沒有不衝突的選法。
    pool.structure[0]!.theme = ['c:bicycle'];
    pool.word_bank[0]!.theme = ['c:bicycle', 'w:wheel'];
    // 另外放一組做過、不衝突的篇章結構：放寬主題之前不能先改用它。
    pool.structure.push({ uid: 'ai.st.ffff01', v: 1, theme: ['c:other'], k: [] });
    const used = new Map([['ai.st.ffff01', 1000]]);
    const r = ok(assembleSelection(pool, 3, used));
    expect(r.reused).toEqual([]);
    expect(r.relaxed).toContain('theme');
    expect(r.slots[4]?.uid).not.toBe('ai.st.ffff01');
  });

  it('主題衝突的組合不會被選到（有其他選擇時）', () => {
    const pool = fakeTier({ word_bank: 3, structure: 3 });
    pool.word_bank[0]!.theme = ['c:sleep'];
    pool.structure[0]!.theme = ['c:sleep', 'w:nap'];
    for (let seed = 0; seed < 100; seed += 1) {
      const r = ok(assembleSelection(pool, seed, new Map()));
      expect(r.relaxed).toEqual([]);
      const picked = new Set([r.slots[3]?.uid, r.slots[4]?.uid]);
      expect(picked.has(pool.word_bank[0]!.uid) && picked.has(pool.structure[0]!.uid)).toBe(false);
    }
  });

  it('詞彙題不參加主題比對', () => {
    const pool = fakeTier({ vocabulary: 1, word_bank: 1 });
    pool.vocabulary[0]!.theme = ['c:shared'];
    pool.word_bank[0]!.theme = ['c:shared'];
    expect(ok(assembleSelection(pool, 1, new Map())).relaxed).toEqual([]);
  });

  it('圖表規則：多文本最多一篇；沒有圖表篇時放寬成越接近一篇越好', () => {
    const pool = fakeTier({}, { chart: 1, table: 0, multi: 3, continuous: 1 });
    for (let seed = 0; seed < 50; seed += 1) expectValidPaper(pool, ok(assembleSelection(pool, seed, new Map())).slots);
    const noFigure = fakeTier({}, { chart: 0, table: 0, multi: 0, continuous: 4 });
    const r = ok(assembleSelection(noFigure, 1, new Map()));
    expect(r.relaxed).toEqual(['theme', 'figure']);
    expect(r.reused).toEqual([]);
  });

  it('不混難度：只會選到傳進來那一種難度的池子裡的題組', () => {
    const basic = fakeTier({}, {}, 'b0');
    const top = fakeTier({}, {}, 'f0');
    const topUids = new Set((Object.values(top) as MockPoolEntry[][]).flat().map((e) => e.uid));
    // 穩定基礎把所有題組都做過了，仍然只用穩定基礎的（做過的）題組。
    const used = new Map((Object.values(basic) as MockPoolEntry[][]).flat().map((e) => [e.uid, 1000] as const));
    for (let seed = 0; seed < 20; seed += 1) {
      const r = ok(assembleSelection(basic, seed, used));
      for (const s of r.slots) expect(topUids.has(s.uid)).toBe(false);
      expect(r.reused).toHaveLength(11);
    }
  });
});

describe('assembleSelection：換題（avoid）', () => {
  it('固定的位置不動，空著的位置挑同大題的另一組，並避開卷內的題組與主題', () => {
    const pool = fakeTier({ word_bank: 3 });
    const first = ok(assembleSelection(pool, 77, new Map()));
    const fixed = first.slots.map((s) => entryOf(pool, s) as MockPoolEntry | null);
    const removedUid = first.slots[3]?.uid;
    fixed[3] = null;
    // 卷內的篇章結構和其中一組文意選填撞主題：替代時要避開它。
    const remaining = pool.word_bank.filter((e) => e.uid !== removedUid);
    const conflict = remaining[0]!;
    conflict.theme = [...conflict.theme, ...(fixed[4]?.theme ?? [])];
    const avoidPool = { ...pool, word_bank: pool.word_bank.filter((e) => e.uid !== removedUid) };
    const r = ok(assembleSelection(avoidPool, 999, new Map(), { fixed }));
    r.slots.forEach((s, i) => {
      if (i !== 3) expect(s.uid).toBe(first.slots[i]?.uid);
    });
    expect(r.slots[3]?.uid).toBe(remaining[1]?.uid);
  });

  it('換閱讀第一篇（圖表篇）時挑另一篇圖表；換其他篇時挑非圖表', () => {
    const pool = fakeTier({}, { chart: 2, table: 0, multi: 0, continuous: 4 });
    const first = ok(assembleSelection(pool, 5, new Map()));
    const fixedAll = first.slots.map((s) => entryOf(pool, s) as MockPoolEntry | null);
    const withoutFigure = [...fixedAll];
    withoutFigure[5] = null;
    const r1 = ok(assembleSelection({ ...pool, reading: pool.reading.filter((e) => e.uid !== first.slots[5]?.uid) }, 1, new Map(), { fixed: withoutFigure }));
    expect(entryOf(pool, r1.slots[5] as SlotPick).fig).toBe('chart');
    const withoutSecond = [...fixedAll];
    withoutSecond[6] = null;
    const r2 = ok(assembleSelection({ ...pool, reading: pool.reading.filter((e) => e.uid !== first.slots[6]?.uid) }, 1, new Map(), { fixed: withoutSecond }));
    expect(entryOf(pool, r2.slots[6] as SlotPick).fig).toBeNull();
  });

  it('同大題已經沒有其他題組：insufficient', () => {
    const pool = fakeTier({ composition: 1 });
    const first = ok(assembleSelection(pool, 1, new Map()));
    const fixed = first.slots.map((s) => entryOf(pool, s) as MockPoolEntry | null);
    fixed[10] = null;
    expect(assembleSelection({ ...pool, composition: [] }, 1, new Map(), { fixed })).toMatchObject({ ok: false, section: 'composition' });
  });
});

describe('remainingEstimate', () => {
  const sections = (r: ReturnType<typeof remainingEstimate>, s: BankSectionType) => r.sections[s];

  it('每個大題算沒做過的題組能組幾份，取最小值', () => {
    const pool = fakeTier({ vocabulary: 5, cloze: 7, word_bank: 4, structure: 9, mixed: 6, translation: 8, composition: 4 }, { chart: 6, table: 0, multi: 0, continuous: 12 });
    const r = remainingEstimate(pool, new Map());
    expect(sections(r, 'cloze')).toEqual({ unused: 7, papers: 3 });
    expect(r.papers).toBe(3);
    const used = new Map([[fakeUid('cloze', 1), 0], [fakeUid('cloze', 2), 0]]);
    expect(remainingEstimate(pool, used).papers).toBe(2);
  });

  it('閱讀的三個上限各自生效：圖表與表格篇數、⌊其他篇數 ÷ 2⌋、連續文本篇數', () => {
    const big = { vocabulary: 9, cloze: 18, word_bank: 9, structure: 9, mixed: 9, translation: 9, composition: 9 };
    // 圖表與表格只有 2 篇
    expect(remainingEstimate(fakeTier(big, { chart: 1, table: 1, multi: 0, continuous: 9 }), new Map()).papers).toBe(2);
    // 其他篇 5 篇 → 2 份
    expect(remainingEstimate(fakeTier(big, { chart: 5, table: 0, multi: 1, continuous: 4 }), new Map()).papers).toBe(2);
    // 連續文本只有 1 篇（多文本很多）
    expect(remainingEstimate(fakeTier(big, { chart: 5, table: 0, multi: 8, continuous: 1 }), new Map()).papers).toBe(1);
    // 帶排除原因的不算
    const pool = fakeTier(big, { chart: 3, table: 0, multi: 0, continuous: 9 });
    pool.reading.filter((e) => e.fig === 'chart').forEach((e) => (e.ex = 'glyph'));
    expect(remainingEstimate(pool, new Map()).papers).toBe(0);
  });

  it('閱讀沒做過的篇數依種類拆開（不夠一份時說明哪一種用完了）', () => {
    const big = { vocabulary: 9, cloze: 18, word_bank: 9, structure: 9, mixed: 9, translation: 9, composition: 9 };
    const pool = fakeTier(big, { chart: 2, table: 1, multi: 2, continuous: 6 });
    expect(remainingEstimate(pool, new Map()).reading).toEqual({ figure: 3, other: 8, continuous: 6 });
    // 圖表與表格都做過：閱讀 0 份，其他篇還有很多。
    const used = new Map(pool.reading.filter((e) => e.fig !== null).map((e) => [e.uid, 0]));
    const r = remainingEstimate(pool, used);
    expect(r.reading).toEqual({ figure: 0, other: 8, continuous: 6 });
    expect(r.sections.reading).toEqual({ unused: 8, papers: 0 });
  });
});

describe('assembleSelection 的選填參數（加強卷，docs/design/weak-paper.md §6.4）', () => {
  const pool = fakeTier({ vocabulary: 6, cloze: 8, word_bank: 6, structure: 6, mixed: 6, translation: 6, composition: 6 }, { chart: 3, table: 2, multi: 2, continuous: 8 });

  it('不傳 options、傳空的 options：結果和改動前一樣（bk1Golden.test.ts 另有黃金資料）', () => {
    for (let seed = 0; seed < 20; seed += 1) expect(assembleSelection(pool, seed, new Map(), undefined, {})).toEqual(assembleSelection(pool, seed, new Map()));
  });

  it('priority：沒做過那一層裡最高分的先；同一段照種子洗牌（換種子仍會換題）', () => {
    const favorite = (pool.structure[2] as MockPoolEntry).uid;
    const picks = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) {
      const r = ok(assembleSelection(pool, seed, new Map(), undefined, { priority: (e) => (e.uid === favorite ? 10 : 1) }));
      expect(r.slots[4]?.uid).toBe(favorite);
      picks.add(r.slots[0]?.uid ?? '');
    }
    // 其他大題的優先序全部相同（同一段）：照種子洗牌，不會每份都一樣。
    expect(picks.size).toBeGreaterThan(1);
  });

  it('priority 分 4 段：¾ 以上同一段（段內照洗牌）；負數（盡量避開）排在沒做過那一層的最後', () => {
    const [a, b, c, d] = (pool.word_bank as MockPoolEntry[]).map((e) => e.uid);
    const score: Record<string, number> = { [a ?? '']: 100, [b ?? '']: 80, [c ?? '']: 40 };
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const r = ok(assembleSelection(pool, seed, new Map(), undefined, { priority: (e) => (e.uid === d ? -1 : (score[e.uid] ?? 0)) }));
      seen.add(r.slots[3]?.uid ?? '');
    }
    // 100 與 80 在同一段（≥ 75）：兩個都會被選到；40 與 0、負數都不會。
    expect([...seen].sort()).toEqual([a, b].sort());
  });

  it('priority 只在同一個代價層內調整：做過的題組不會因為優先序高就被選到', () => {
    const favorite = (pool.structure[0] as MockPoolEntry).uid;
    const used = new Map([[favorite, 1]]);
    for (let seed = 0; seed < 10; seed += 1) {
      const r = ok(assembleSelection(pool, seed, used, undefined, { priority: (e) => (e.uid === favorite ? 100 : 0) }));
      expect(r.slots[4]?.uid).not.toBe(favorite);
      expect(r.reused).toEqual([]);
    }
  });

  it('selectable、filter：取代 isSelectable、額外篩選', () => {
    const withNs = structuredClone(pool);
    for (const e of withNs.mixed as MockPoolEntry[]) e.ex = 'ns';
    expect(assembleSelection(withNs, 1, new Map())).toEqual({ ok: false, reason: 'insufficient', section: 'mixed' });
    const r = ok(assembleSelection(withNs, 1, new Map(), undefined, { selectable: (e) => e.ex == null || e.ex === 'ns' }));
    expect(r.slots[8]?.section).toBe('mixed');
    const only = (withNs.vocabulary[1] as MockPoolEntry).uid;
    const f = ok(assembleSelection(pool, 3, new Map(), undefined, { filter: (e, section) => section !== 'vocabulary' || e.uid === only }));
    expect(f.slots[0]?.uid).toBe(only);
  });
});
