/**
 * bk1 黃金測試（docs/design/weak-paper.md §7.2、§9.2、§10.1、A9）：加強卷把自組模擬考的程式改成「接受版面參數」之前，
 * 先把現行 bk1 的輸出寫成黃金資料（__golden__/），之後每一次改動都要逐位元相同——已經印出去的卷子與 QR code 不能變。
 *
 *   - buildBankPaper：3 個固定的 bk1 代號（三種難度、圖表與表格、換題與改版的提示、不換字母的閱讀）的整份 BankPaper（JSON）。
 *   - assembleSelection：固定的組卷池 × 20 個種子（沒做過、做過、主題衝突各一種情境），以及換題（avoid）。
 *   - 組卷池含出版社題組（ex: 'ns'）時，bk1 的組卷、換題、剩餘份數與「題庫不夠」的判斷都和沒有時相同。
 *   - 代號與卷號：encodePaperId、paperNumber 的輸出。
 *
 * 黃金資料是在改動前用當時的程式產生的（vitest -u）；之後不准用 -u 更新這些檔案，除非站主決定換成新的代號格式。
 */
import { AI_SECTION_TYPES, type BankSectionType, type Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import type { PracticeSectionType } from '../../../data/bank';
import type { OptionLetter } from '../../../data/exams';
import { assembleSelection, insufficientSection, remainingEstimate, type AssembleSelectionResult } from './assemble';
import { BLUEPRINT_SLOTS } from './blueprint';
import { buildBankPaper, type BankPaperNotices, type BankSlotSource, type SlotFile } from './buildExam';
import { decodePaperId, encodePaperId, paperNumber } from './code';
import type { MockPoolEntry, MockPoolReadingEntry, MockPoolTier } from './pool';
import { fakeGroupFile, fakeTier, fakeWritingPair } from './testFixtures';

const ALL_PAIRS: [number, number][] = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4].filter((r) => r !== q).map((r) => [q, r] as [number, number]));

interface GoldenCase {
  name: string;
  prefix: string;
  tier: Tier;
  /** 閱讀第一篇（位置 5）的圖：chart 或 table。 */
  figure: 'chart' | 'table';
  /** 位置 7 那一篇的答案（不是 ABCD 排列時不換字母）。 */
  lastReadingAnswers?: OptionLetter[];
  notices?: Partial<BankPaperNotices>;
}

const CASES: GoldenCase[] = [
  { name: 'a', prefix: 'a0', tier: 'advanced', figure: 'chart' },
  { name: 'b', prefix: 'b1', tier: 'basic', figure: 'table', notices: { reused: ['21-30', '47-50'] } },
  {
    name: 't',
    prefix: 'c2',
    tier: 'top',
    figure: 'chart',
    lastReadingAnswers: ['A', 'A', 'B', 'C'],
    notices: { replaced: [{ range: '35-38', kind: 'removed' }], textChanged: ['1-10'], keyChanged: ['36'] },
  },
];

function goldenInput(c: GoldenCase) {
  const files: Record<string, SlotFile> = {};
  const slots: BankSlotSource[] = [];
  const codeSlots = BLUEPRINT_SLOTS.map((s) => {
    const uid = `ai.${s.uidCode}.${c.prefix}${String(s.index * 7 + 3).padStart(4, '0')}`;
    const v = 1 + (s.index % 3);
    const key = `${uid}@${v}`;
    if (s.section === 'translation' || s.section === 'composition') files[key] = fakeWritingPair(s.section, uid, v);
    else {
      files[key] = fakeGroupFile(s.section as PracticeSectionType, uid, v, {
        tier: c.tier,
        chart: s.index === 5 && c.figure === 'chart',
        table: s.index === 5 && c.figure === 'table',
        ...(s.index === 7 && c.lastReadingAnswers ? { answers: c.lastReadingAnswers } : {}),
      });
    }
    slots.push({ key, swap: s.section === 'reading' ? ALL_PAIRS : [] });
    return { uid, v };
  });
  const paperId = encodePaperId(c.tier, codeSlots);
  return { paperId, tier: c.tier, dataVersion: `golden-${c.name}`, slots, files, ...(c.notices ? { notices: c.notices } : {}) };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 黃金資料：整份 BankPaper（JSON.stringify）的 SHA-256 與長度鎖住逐位元相同；另外存一份看得懂的摘要
 * （題號、答案、配分、大題標題與說明、題組、提示、快照來源），雜湊對不上時用它找差在哪裡。
 * 題組檔本身（source.files、writing）是輸入的原樣複製，只由雜湊涵蓋，不另外存（每份約 90 KB）。
 */
async function paperGolden(paper: ReturnType<typeof buildBankPaper>) {
  const json = JSON.stringify(paper);
  return {
    sha256: await sha256(json),
    length: json.length,
    id: paper.id,
    code: paper.code,
    tier: paper.tier,
    dataVersion: paper.dataVersion,
    exam: {
      ...paper.exam,
      sections: paper.exam.sections.map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        part: s.part,
        instructions: s.instructions,
        points_total: s.points_total,
        groups: s.groups.map((g) => ({
          id: g.id,
          passage: g.passage === null ? null : g.passage.slice(0, 40),
          figures: g.figures.length,
          questions: g.questions.map((q) => ({ no: q.no, label: q.label, mode: q.mode, answer: 'answer' in q ? q.answer : null, points: q.points })),
        })),
      })),
    },
    explanations: Object.fromEntries(Object.entries(paper.explanations).map(([k, v]) => [k, v.explanation_zh])),
    elimination: paper.elimination,
    writing: { translationItemIds: paper.writing.translationItemIds, essayItemId: paper.writing.essayItemId },
    groups: paper.groups,
    notices: paper.notices,
    slots: paper.source.slots,
    files: Object.keys(paper.source.files),
    letterSwaps: paper.letterSwaps,
  };
}

describe('bk1 黃金測試：buildBankPaper 的整份輸出', () => {
  for (const c of CASES) {
    it(`代號 ${c.name}（${c.tier}）`, async () => {
      const paper = buildBankPaper(goldenInput(c));
      await expect(`${JSON.stringify(await paperGolden(paper), null, 2)}\n`).toMatchFileSnapshot(`./__golden__/bk1-paper-${c.name}.json`);
    });
  }
});

describe('bk1 黃金測試：代號與卷號', () => {
  it('encodePaperId、decodePaperId、paperNumber', async () => {
    const rows = CASES.map((c) => {
      const { paperId } = goldenInput(c);
      return { paperId, number: paperNumber(paperId), upper: paperNumber(`${paperId.toUpperCase()}.P`), decoded: decodePaperId(paperId) };
    });
    await expect(`${JSON.stringify(rows, null, 2)}\n`).toMatchFileSnapshot('./__golden__/bk1-codes.json');
  });
});

// ---------------------------------------------------------------------------
// 組卷
// ---------------------------------------------------------------------------

/** 黃金的組卷池：每個大題的題組數不同；閱讀有圖表、表格、多文本、連續文本；部分主題鍵互相衝突。 */
function goldenPool(): MockPoolTier {
  const pool = fakeTier({ vocabulary: 4, cloze: 6, word_bank: 4, structure: 4, mixed: 4, translation: 3, composition: 4 }, { chart: 3, table: 2, multi: 2, continuous: 6 });
  // 主題衝突：綜合測驗第 1、2 組和閱讀第 3 篇共用一個概念鍵；文意選填第 1 組和篇章結構第 2 組共用一個。
  const shared = 'c:shared-a';
  (pool.cloze[0] as MockPoolEntry).theme.push(shared);
  (pool.cloze[1] as MockPoolEntry).theme.push(shared);
  (pool.reading[2] as MockPoolReadingEntry).theme.push(shared);
  (pool.word_bank[0] as MockPoolEntry).theme.push('c:shared-b');
  (pool.structure[1] as MockPoolEntry).theme.push('c:shared-b');
  // 一組帶排除原因（題本缺字）、一組閱讀有可交換的組合。
  (pool.vocabulary[3] as MockPoolEntry).ex = 'glyph';
  (pool.reading[4] as MockPoolReadingEntry).sw = [
    [1, 2],
    [3, 4],
  ];
  return pool;
}

/** 做過的題組：每個大題的第一組（時間不同），閱讀的兩篇圖表。 */
function goldenUsed(pool: MockPoolTier): Map<string, number> {
  const used = new Map<string, number>();
  let t = 1_700_000_000_000;
  for (const s of AI_SECTION_TYPES) {
    const first = (pool[s] as MockPoolEntry[])[0];
    if (first) used.set(first.uid, (t += 86_400_000));
  }
  for (const e of pool.reading.filter((x) => x.fig === 'chart').slice(0, 2)) used.set(e.uid, (t += 3_600_000));
  return used;
}

function summary(r: AssembleSelectionResult) {
  return r.ok ? { ok: true, slots: r.slots.map((s) => `${s.uid}@${s.v}${s.sw.length > 0 ? `+${s.sw.map((p) => p.join('')).join(',')}` : ''}`), reused: r.reused, relaxed: r.relaxed } : r;
}

function runSeeds(pool: MockPoolTier, used: Map<string, number>) {
  return Array.from({ length: 20 }, (_, i) => {
    const seed = (i * 0x9e3779b1 + 7) >>> 0;
    return { seed, ...summary(assembleSelection(pool, seed, used)) };
  });
}

/** 換題：固定 11 個位置裡的 8 個，空出第 1、5、9 個位置（綜合 1、閱讀 1、中譯英）。 */
function runAvoid(pool: MockPoolTier) {
  const base = assembleSelection(pool, 4242, new Map());
  if (!base.ok) throw new Error('黃金組卷池組不出卷子');
  const entries = base.slots.map((s) => (pool[s.section] as MockPoolEntry[]).find((e) => e.uid === s.uid) ?? null);
  return [3, 99, 2026].map((seed) => {
    const fixed = entries.map((e, i) => ([1, 5, 9].includes(i) ? null : e));
    return { seed, ...summary(assembleSelection(pool, seed, new Map(), { fixed })) };
  });
}

/**
 * 同一個組卷池加上出版社題組（uid pb.…、ex: 'ns'、src）：每個大題 2 組，閱讀有圖表也有連續文本，主題鍵和本站題衝突。
 * 這些條目只給 bk2（weak-paper.md §6.2）；bk1 的結果要和沒有它們時逐位元相同。
 */
function withPublisherEntries(pool: MockPoolTier): MockPoolTier {
  const next = structuredClone(pool);
  const codes: Record<BankSectionType, string> = { vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx', translation: 'tr', composition: 'cp' };
  for (const s of AI_SECTION_TYPES) {
    if (s === 'translation' || s === 'composition') continue;
    const list = next[s] as MockPoolEntry[];
    for (let i = 0; i < 2; i += 1) {
      const uid = `pb.${codes[s]}.f${s.length}${i}0aa`;
      const base = { uid, v: 1, theme: [`c:pb-${s}-${i}`, 'c:shared-a'], k: (list[0]?.k ?? ['0000']).map(() => 'aaaa'), ex: 'ns', src: 'pub-test' };
      list.push((s === 'reading' ? { ...base, fig: i === 0 ? 'chart' : null, form: i === 0 ? 'mixed' : 'continuous', sw: [] } : base) as MockPoolEntry);
    }
    list.sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  }
  return next;
}

describe('bk1 黃金測試：assembleSelection', () => {
  const pool = goldenPool();
  const used = goldenUsed(pool);

  it('20 個種子 × 沒做過／做過，加上換題', async () => {
    const out = { fresh: runSeeds(pool, new Map()), used: runSeeds(pool, used), avoid: runAvoid(pool) };
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot('./__golden__/bk1-assemble.json');
  });

  it('組卷池含出版社題組（ex: ns）時：組卷、換題、剩餘份數、題庫不夠的判斷都不變', () => {
    const withPb = withPublisherEntries(pool);
    expect(withPb.reading.length).toBe(pool.reading.length + 2);
    expect(runSeeds(withPb, new Map())).toEqual(runSeeds(pool, new Map()));
    expect(runSeeds(withPb, used)).toEqual(runSeeds(pool, used));
    expect(runAvoid(withPb)).toEqual(runAvoid(pool));
    expect(remainingEstimate(withPb, used)).toEqual(remainingEstimate(pool, used));
    expect(remainingEstimate(withPb, new Map())).toEqual(remainingEstimate(pool, new Map()));
    // 只有出版社題組時，bk1 仍然判斷為不夠（不會把它們算進候選）。
    const thin = structuredClone(pool);
    thin.structure = [];
    const thinPb = withPublisherEntries(thin);
    expect(insufficientSection(thinPb)).toBe(insufficientSection(thin));
    expect(insufficientSection(thinPb)).toBe('structure');
    const r = assembleSelection(thinPb, 1, new Map());
    expect(r).toEqual({ ok: false, reason: 'insufficient', section: 'structure' });
  });
});
