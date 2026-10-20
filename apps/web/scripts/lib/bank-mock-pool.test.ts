// @vitest-environment node
/**
 * scripts/lib/bank-mock-pool.mjs：自組模擬考的組卷池 bank/mock-pool.json（docs/design/bank-mock.md §4.7、§9.1、§10.1）。
 *
 * 範例題庫：題庫練習的 tests/fixtures/bank（6 組）加上寫作題庫的 tests/fixtures/bank-writing（2 組），複製到暫存的 repo 一起建池子。
 * 預期輸出（golden）在 tests/fixtures/bank-mock-public/bank/mock-pool.json，前端 features/mock/bank 的測試也可以拿它當假資料。
 * 改了輸出格式要更新 golden（在 apps/web 底下執行）：
 *   UPDATE_MOCK_POOL_GOLDEN=1 npx vitest run scripts/lib/bank-mock-pool.test.ts
 * 不讀 data/bank/v1；真實題庫的檢查在 bank-mock-pool.data.test.ts（npm run test:data）。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import { buildBankData } from './bank-data.mjs';
import { answerFingerprints } from './bank-mock-letters.mjs';
import {
  BankMockPoolError,
  MOCK_POOL_PATH,
  MOCK_SECTIONS,
  buildMockPool,
  mockPoolLogLines,
  poolSupply,
  readingForm,
  readTopicPlans,
  strayMarkers,
  type MockPoolFile,
} from './bank-mock-pool.mjs';
import { buildWritingBank } from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(WEB_DIR, 'tests', 'fixtures');
const GOLDEN = path.join(FIXTURES, 'bank-mock-public', MOCK_POOL_PATH);
const WB = 'word_bank/advanced/ai.wb.0a1b2c@1.json';
const RD = 'reading/basic/ai.rd.0c1d2e@1.json';
const TIERS = ['basic', 'advanced', 'top'] as const;

type Json = Record<string, any>;
const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 範例題庫（練習＋寫作）複製到暫存的 repo：<root>/data/bank/v1、facts，下架清單 <root>/data/unpublish.jsonl。 */
function tmpRepo(): { root: string; bankDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'gsat-mock-pool-'));
  tmpDirs.push(root);
  const bankDir = path.join(root, 'data', 'bank', 'v1');
  cpSync(path.join(FIXTURES, 'bank', 'v1'), bankDir, { recursive: true });
  cpSync(path.join(FIXTURES, 'bank-writing', 'v1'), bankDir, { recursive: true });
  cpSync(path.join(FIXTURES, 'bank', 'facts'), path.join(root, 'data', 'bank', 'facts'), { recursive: true });
  return { root, bankDir };
}

/** 從 rel 複製一份新版本（version 改成 v），再套用 change。 */
function writeVersion(bankDir: string, rel: string, v: number, change?: (d: Json) => void): string {
  const d = readJson(path.join(bankDir, rel));
  d['version'] = v;
  change?.(d);
  const file = path.join(bankDir, rel.replace(/@\d+\.json$/, `@${v}.json`));
  writeFileSync(file, JSON.stringify(d));
  return file;
}

/** 照 build-data.mjs 的順序建池子：下架清單 → 題庫練習 → 寫作題庫 → 組卷池。 */
function build(repo: { root: string; bankDir: string }, extra: Partial<Parameters<typeof buildMockPool>[0]> = {}) {
  const unpublishFile = path.join(repo.root, 'data', 'unpublish.jsonl');
  const unpublished = readUnpublish(unpublishFile, { repoRoot: repo.root });
  const bank = buildBankData(repo.bankDir, { unpublished, repoRoot: repo.root });
  const writing = buildWritingBank({ bankDir: repo.bankDir, exams: [], unpublishFile, repoRoot: repo.root });
  const result = buildMockPool({ version: 'fixture', bankDir: repo.bankDir, practice: bank.groups, writing: writing.index, ...extra });
  return { bank, writing, result };
}

const entry = (pool: MockPoolFile, tier: string, section: string, uid: string) =>
  (pool.tiers as Json)[tier][section].find((e: Json) => e.uid === uid) as Json | undefined;

describe('範例題庫的組卷池與 golden 一致', () => {
  const { result } = build(tmpRepo());

  if (process.env['UPDATE_MOCK_POOL_GOLDEN'] === '1') {
    mkdirSync(path.dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(result.pool, null, 2)}\n`);
  }

  it('mock-pool.json', () => {
    expect(result.pool).toEqual(readJson(GOLDEN));
  });

  it('{ version, blueprint, tiers }：三種難度、八個大題的鍵都在（沒有題組是空陣列）', () => {
    expect(Object.keys(result.pool)).toEqual(['version', 'blueprint', 'tiers']);
    expect(result.pool.blueprint).toBe('gsat-115');
    expect(Object.keys(result.pool.tiers)).toEqual([...TIERS]);
    for (const t of TIERS) expect(Object.keys(result.pool.tiers[t])).toEqual([...MOCK_SECTIONS]);
    expect(result.pool.tiers.top.reading).toEqual([]);
    const counts = TIERS.map((t) => MOCK_SECTIONS.map((s) => result.pool.tiers[t][s].length).join(''));
    // basic：詞彙、閱讀、混合、中譯英、作文；advanced：綜合、文意選填；top：篇章結構。
    expect(counts).toEqual(['10001111', '01100000', '00010000']);
    expect(result.warnings).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it('每個條目：uid、v、theme、k（每題一個 4 位十六進位）；閱讀另外有 fig、form、sw', () => {
    const rd = entry(result.pool, 'basic', 'reading', 'ai.rd.0c1d2e');
    expect(Object.keys(rd ?? {})).toEqual(['uid', 'v', 'theme', 'fig', 'form', 'sw', 'k']);
    expect(rd).toMatchObject({ v: 1, fig: 'chart', form: 'mixed' });
    expect(rd?.['sw'].length).toBeGreaterThan(0);
    const mx = entry(result.pool, 'basic', 'mixed', 'ai.mx.0f1a2b');
    expect(Object.keys(mx ?? {})).toEqual(['uid', 'v', 'theme', 'k']);
    expect(mx?.['theme']).toContain('c:food-waste');
    expect(mx?.['k']).toHaveLength(4);
    for (const t of TIERS) {
      for (const s of MOCK_SECTIONS) for (const e of result.pool.tiers[t][s]) for (const fp of e.k) expect(fp).toMatch(/^[0-9a-f]{4}$/);
    }
    // 詞彙題沒有主題鍵。
    expect(entry(result.pool, 'basic', 'vocabulary', 'ai.vo.1c2d3e')?.['theme']).toEqual([]);
  });

  it('寫作題的指紋用原始檔算（題目文字），讀過的原始檔算進資料版本的輸入', () => {
    const tr = entry(result.pool, 'basic', 'translation', 'ai.tr.0b1c2d');
    const raw = readJson(path.join(FIXTURES, 'bank-writing', 'v1', 'translation', 'basic', 'ai.tr.0b1c2d@1.json'));
    expect(tr?.['k']).toEqual(answerFingerprints('translation', raw));
    expect(tr?.['k']).toHaveLength(2);
    expect(result.inputs.map((f) => path.basename(f))).toEqual(['ai.cp.0e1f2a@1.json', 'ai.tr.0b1c2d@1.json']);
  });

  it('沒有 c: 鍵的主題依難度、大題排序列出（詞彙題不列）', () => {
    expect(result.noConcept.map((n) => `${n.tier}/${n.section}/${n.uid}`)).toEqual([
      'basic/reading/ai.rd.0c1d2e',
      'basic/translation/ai.tr.0b1c2d',
      'basic/composition/ai.cp.0e1f2a',
      'advanced/cloze/ai.cz.2b3c4d',
      'top/structure/ai.st.3a4b5c',
    ]);
  });
});

describe('收錄規則：只收已發布的版本，舊版本只出現在 prev', () => {
  it('新的 verified 版本只改文字：池子裡是新版本，prev 有舊版本的指紋（相同）', () => {
    const repo = tmpRepo();
    writeVersion(repo.bankDir, WB, 2, (d) => {
      d['group']['passage'] = String(d['group']['passage']).replace('Today', 'Nowadays');
    });
    const { result } = build(repo);
    const wb = entry(result.pool, 'advanced', 'word_bank', 'ai.wb.0a1b2c');
    expect(wb?.['v']).toBe(2);
    expect(wb?.['prev']).toEqual({ '1': wb?.['k'] });
    expect(result.pool.tiers.advanced.word_bank.filter((e) => e.uid === 'ai.wb.0a1b2c')).toHaveLength(1);
    expect(result.inputs.map((f) => path.basename(f))).toContain('ai.wb.0a1b2c@1.json');
  });

  it('答案改了的新版本：prev 的指紋和目前不同（只有改了的那一題不同）', () => {
    const repo = tmpRepo();
    writeVersion(repo.bankDir, RD, 2, (d) => {
      const q = d['group']['questions'][1];
      q['answer'] = 'D';
      d['group']['questions'][3]['answer'] = 'C';
    });
    const { result } = build(repo);
    const rd = entry(result.pool, 'basic', 'reading', 'ai.rd.0c1d2e');
    expect(rd?.['v']).toBe(2);
    const prev = rd?.['prev']['1'] as string[];
    expect(prev).toHaveLength(4);
    expect(prev[1]).not.toBe(rd?.['k'][1]);
    expect(prev[3]).not.toBe(rd?.['k'][3]);
  });

  it('較新的 draft、舊的 rejected 版本不算；下架清單登記的版本不在池子裡', () => {
    const repo = tmpRepo();
    writeVersion(repo.bankDir, WB, 2, (d) => {
      d['status'] = 'rejected';
    });
    writeVersion(repo.bankDir, WB, 3);
    writeVersion(repo.bankDir, WB, 4, (d) => {
      d['status'] = 'draft';
    });
    const { result } = build(repo);
    const wb = entry(result.pool, 'advanced', 'word_bank', 'ai.wb.0a1b2c');
    expect(wb?.['v']).toBe(3);
    expect(Object.keys(wb?.['prev'] ?? {})).toEqual(['1']);

    // 下架 @3：發布 @1（@2 是 rejected），池子裡沒有 @3，@1 也沒有 prev。
    writeFileSync(
      path.join(repo.root, 'data', 'unpublish.jsonl'),
      `${JSON.stringify({ path: `data/bank/v1/${WB.replace('@1', '@3')}`, date: '2026-10-19', reason: '人工審核下架' })}\n`,
    );
    const again = build(repo).result;
    const after = entry(again.pool, 'advanced', 'word_bank', 'ai.wb.0a1b2c');
    expect(after?.['v']).toBe(1);
    expect(after?.['prev']).toBeUndefined();
  });

  it('較新的版本改了答案、還沒通過驗證：整組撤下，池子裡沒有這個 uid（狀態是 removed）', () => {
    const repo = tmpRepo();
    writeVersion(repo.bankDir, WB, 2, (d) => {
      d['status'] = 'draft';
      d['group']['questions'][0]['answer'] = 'J';
    });
    const { result } = build(repo);
    expect(entry(result.pool, 'advanced', 'word_bank', 'ai.wb.0a1b2c')).toBeUndefined();
  });

  it('輸入的順序不影響輸出：每個清單依 uid 排序', () => {
    const repo = tmpRepo();
    const { bank, writing } = build(repo);
    const twin = { ...bank.groups[0], uid: 'ai.vo.000001' } as (typeof bank.groups)[number];
    const a = buildMockPool({ bankDir: repo.bankDir, practice: [...bank.groups, twin], writing: writing.index });
    const b = buildMockPool({ bankDir: repo.bankDir, practice: [twin, ...[...bank.groups].reverse()], writing: [...writing.index].reverse() });
    expect(a.pool).toEqual(b.pool);
    expect(a.pool.tiers.basic.vocabulary.map((e) => e.uid)).toEqual(['ai.vo.000001', 'ai.vo.1c2d3e']);
  });
});

describe('排除原因（ex）與警告：條目仍在池子裡，只是不能組新卷', () => {
  /** 範例的閱讀題組（公開檔），改 uid、版本或內容做成假的輸入。 */
  function readingFile(change?: (g: Json) => void): Json {
    const g = structuredClone(readJson(path.join(FIXTURES, 'bank-public', 'bank', 'groups', 'ai.rd.0c1d2e@1.json')));
    change?.(g);
    return g;
  }
  const pool = (practice: Json[], extra: Partial<Parameters<typeof buildMockPool>[0]> = {}) =>
    buildMockPool({ bankDir: path.join(tmpdir(), 'no-such-bank-dir-for-test'), practice: practice as never, writing: [], ...extra });

  it('uid 的題型代碼和 section_type 不一致、版本超過 63', () => {
    const r = pool([readingFile((g) => (g['uid'] = 'ai.cz.0c1d2e')), readingFile((g) => (g['version'] = 64))]);
    const list = r.pool.tiers.basic.reading;
    expect(list.map((e) => [e.uid, e.v, e.ex])).toEqual([
      ['ai.cz.0c1d2e', 1, 'uid'],
      ['ai.rd.0c1d2e', 64, 'version'],
    ]);
    expect(r.excluded).toEqual([
      { key: 'ai.cz.0c1d2e@1', reason: 'uid' },
      { key: 'ai.rd.0c1d2e@64', reason: 'version' },
    ]);
    expect(r.warnings).toEqual([
      'ai.cz.0c1d2e@1 不能用來組新卷：uid 格式或題型代碼不符，無法編進卷子代號',
      'ai.rd.0c1d2e@64 不能用來組新卷：版本超過 63，無法編進卷子代號',
    ]);
    // 排除的條目照樣算指紋、主題鍵（上架狀態以發布結果為準，§4.7）。
    expect(list[0]?.k).toHaveLength(4);
  });

  it('指向題組外的 [[n]] 或「第 n 格」', () => {
    const r = pool([
      readingFile((g) => (g['group']['passage'] = `${g['group']['passage']} See [[12]].`)),
      readingFile((g) => {
        g['uid'] = 'ai.rd.0c1d2f';
        g['annotations']['explanations']['items']['1']['explanation_zh'] = '第 3 格與第 11 格的線索相同。';
      }),
    ]);
    expect(r.pool.tiers.basic.reading.map((e) => e.ex)).toEqual(['marker', 'marker']);
    expect(r.warnings[0]).toBe('ai.rd.0c1d2e@1 不能用來組新卷：有指向題組外的 [[n]] 或「第 n 格」（[[12]]）');
    expect(r.warnings[1]).toMatch(/第 11 格/);
  });

  it('strayMarkers：題號範圍內的記號（含全形數字）不算', () => {
    const g = { group: { questions: [{ no: 1 }, { no: 2 }], passage: 'A [[1]] B [[2]]' }, annotations: { explanations: { items: { '1': { explanation_zh: '第 ２ 格' } } } } };
    expect(strayMarkers(g)).toEqual([]);
    expect(strayMarkers({ ...g, group: { ...g.group, passage: 'A [[1]] B [[3]]' } })).toEqual(['[[3]]']);
  });

  it('題本缺字：WP1 只警告；excludeGlyphs 時帶 ex: glyph。解析與資料來源缺字只警告', () => {
    const glyphs = new Map([
      ['ai.rd.0c1d2e@1', { booklet: ['鹵'], explanations: ['≠'], sources: ['の'] }],
    ]);
    const warnOnly = pool([readingFile()], { glyphs });
    expect(warnOnly.pool.tiers.basic.reading[0]?.ex).toBeUndefined();
    expect(warnOnly.warnings).toEqual([
      'ai.rd.0c1d2e@1 的題本有 PDF 字型沒有的字：鹵（之後會排除在組卷池外）',
      'ai.rd.0c1d2e@1 的解析或答案有 PDF 字型沒有的字（PDF 改印替代說明）：≠',
      'ai.rd.0c1d2e@1 的資料來源（參考資料、出處說明）有 PDF 字型沒有的字：の',
    ]);
    const excluded = pool([readingFile()], { glyphs, excludeGlyphs: true });
    expect(excluded.pool.tiers.basic.reading[0]?.ex).toBe('glyph');
    const explanationsOnly = pool([readingFile()], { glyphs: new Map([['ai.rd.0c1d2e@1', { booklet: [], explanations: ['≠'] }]]), excludeGlyphs: true });
    expect(explanationsOnly.pool.tiers.basic.reading[0]?.ex).toBeUndefined();
  });

  it('閱讀的圖不是圖表也不是表格：警告並當成沒有圖表', () => {
    const r = pool([
      readingFile((g) => {
        g['group']['figures'] = [{ kind: 'photo', label: null, caption: null, description: '一張照片', rows: null }];
      }),
    ]);
    expect(r.pool.tiers.basic.reading[0]?.fig).toBeNull();
    expect(r.warnings).toEqual(['ai.rd.0c1d2e@1 的圖不是圖表也不是表格，組卷時當成沒有圖表的篇章']);
  });

  it('找不到已發布寫作題的原始檔時丟錯（不能少一組卻不知道）', () => {
    expect(() =>
      buildMockPool({
        bankDir: path.join(tmpdir(), 'no-such-bank-dir-for-test'),
        practice: [],
        writing: [{ uid: 'ai.tr.000000', version: 1, section_type: 'translation', tier: 'basic', topic: null }],
      }),
    ).toThrow(BankMockPoolError);
  });
});

describe('主題鍵用 topic-plan 的 keywords 與 angle_en', () => {
  it('中文主題對得上 topic_zh 時，keywords 也拿來比對概念別名', () => {
    const repo = tmpRepo();
    const plan = { topics: [{ topic_zh: '自備水壺上學', keywords: ['reusable bottle', 'plastic waste'], angle_en: 'bringing water bottles' }] };
    const { result } = build(repo, { topicPlans: [plan] });
    expect(entry(result.pool, 'basic', 'translation', 'ai.tr.0b1c2d')?.['theme']).toEqual(['c:plastic', 'z:自備水壺上學']);
    expect(build(repo).result.pool.tiers.basic.translation[0]?.theme).toEqual(['z:自備水壺上學']);
  });

  it('readTopicPlans：不存在的略過；不是合法 JSON 的只警告、略過那個檔案，不丟出錯誤（不讓網站建置失敗）', () => {
    const repo = tmpRepo();
    const good = path.join(repo.root, 'data', 'bank', 'topic-plan.json');
    const broken = path.join(repo.root, 'data', 'bank', 'topic-plan-writing.json');
    const missing = path.join(repo.root, 'data', 'bank', 'topic-plan-other.json');
    const plan = { topics: [{ topic_zh: '自備水壺上學', keywords: ['plastic waste'] }] };
    writeFileSync(good, JSON.stringify(plan));
    writeFileSync(broken, '{ "topics": [ { "topic_zh": "x", }');
    const read = readTopicPlans([good, broken, missing], (f) => path.relative(repo.root, f));
    expect(read.plans).toEqual([plan]);
    expect(read.warnings).toHaveLength(1);
    expect(read.warnings[0]).toMatch(/^data\/bank\/topic-plan-writing\.json 不是合法的 JSON/);
    // 好的那個檔案照常用來算主題鍵。
    expect(entry(build(repo, { topicPlans: read.plans }).result.pool, 'basic', 'translation', 'ai.tr.0b1c2d')?.['theme']).toEqual(['c:plastic', 'z:自備水壺上學']);
  });
});

describe('閱讀的文本形式', () => {
  it('依 tags.text_format；沒標時依形狀推', () => {
    expect(readingForm({ tags: { text_format: 'multi_text' } })).toBe('multi_text');
    expect(readingForm({ tags: {}, passage_parts: [{ text: 'a' }, { text: 'b' }], figures: [] })).toBe('multi_text');
    expect(readingForm({ tags: null, figures: [{ kind: 'table', rows: [['a']] }] })).toBe('mixed');
    expect(readingForm({ figures: [] })).toBe('continuous');
  });
});

describe('供應量（§3.2）與建置紀錄', () => {
  /** 只有某一種難度有題組的假池子：sections 是每個大題的條目數，reading 用 forms 指定每篇的 [fig, form]。 */
  function fakePool(counts: Partial<Record<(typeof MOCK_SECTIONS)[number], number>>, reading: [string | null, string][] = []): MockPoolFile {
    const empty = () => Object.fromEntries(MOCK_SECTIONS.map((s) => [s, [] as Json[]])) as Json;
    const basic = empty();
    for (const [s, n] of Object.entries(counts)) {
      basic[s] = Array.from({ length: n ?? 0 }, (_, i) => ({ uid: `ai.xx.${String(i).padStart(6, '0')}`, v: 1, theme: [], k: [] }));
    }
    basic['reading'] = reading.map(([fig, form], i) => ({ uid: `ai.rd.${String(i).padStart(6, '0')}`, v: 1, theme: [], fig, form, sw: [], k: [] }));
    return { version: 'x', blueprint: 'gsat-115', tiers: { basic, advanced: empty(), top: empty() } } as MockPoolFile;
  }

  it('每個大題是「題組數 ÷ 每份要幾組」取整，取最小值；排除的題組不算', () => {
    const pool = fakePool({ vocabulary: 10, cloze: 7, word_bank: 9, structure: 25, mixed: 25, translation: 52, composition: 10 }, [
      ...Array.from({ length: 9 }, (): [string, string] => ['chart', 'mixed']),
      ...Array.from({ length: 14 }, (): [null, string] => [null, 'continuous']),
      ...Array.from({ length: 3 }, (): [null, string] => [null, 'multi_text']),
    ]);
    (pool.tiers.basic.word_bank[0] as Json)['ex'] = 'glyph';
    const s = poolSupply(pool).basic;
    expect(s.counts.word_bank).toBe(8);
    expect(s.papers).toMatchObject({ vocabulary: 10, cloze: 3, word_bank: 8, reading: 8 });
    expect(s.total).toBe(3);
    expect(s.bottleneck).toEqual(['cloze']);
    expect(s.reading).toEqual({ continuous: 14, chart: 9, table: 0, multi: 3, other: 17 });
    expect(poolSupply(pool).top.total).toBe(0);
  });

  it('閱讀的三個上限各自生效：圖表或表格篇數、⌊其他篇數 ÷ 2⌋、連續文本篇數', () => {
    const many = { vocabulary: 99, cloze: 99, word_bank: 99, structure: 99, mixed: 99, translation: 99, composition: 99 };
    const rd = (fig: number, cont: number, multi: number) => [
      ...Array.from({ length: fig }, (): [string, string] => ['table', 'mixed']),
      ...Array.from({ length: cont }, (): [null, string] => [null, 'continuous']),
      ...Array.from({ length: multi }, (): [null, string] => [null, 'multi_text']),
    ];
    expect(poolSupply(fakePool(many, rd(2, 10, 0))).basic.papers.reading).toBe(2);
    expect(poolSupply(fakePool(many, rd(9, 5, 0))).basic.papers.reading).toBe(2);
    expect(poolSupply(fakePool(many, rd(9, 3, 8))).basic.papers.reading).toBe(3);
  });

  it('mockPoolLogLines：總數與排除原因、供應表、瓶頸、閱讀形式、沒有 c: 鍵的主題', () => {
    const repo = tmpRepo();
    const { result } = build(repo);
    const lines = mockPoolLogLines({ ...result, excluded: [{ key: 'ai.rd.0c1d2e@1', reason: 'marker' }] });
    expect(lines[0]).toBe('自組模擬考組卷池：8 組，其中 1 組不能組新卷（有指向題組外的 [[n]] 或「第 n 格」 1）');
    expect(lines.some((l) => /^ {2}大題 +穩定基礎 +進階練習 +超越頂標 +每份要$/.test(l))).toBe(true);
    expect(lines.some((l) => /^ {2}閱讀測驗 +1 +0 +0 +3$/.test(l))).toBe(true);
    expect(lines.some((l) => /^ {2}不重複可組 +0 份 +0 份 +0 份/.test(l))).toBe(true);
    expect(lines).toContain('  閱讀題組的形式（三種難度）：連續文本 0／0／0、圖表 1／0／0、表格 0／0／0、多文本 0／0／0');
    expect(lines).toContain('沒有任何概念鍵（c:）的主題 5 個（補 scripts/lib/bank-mock-themes.mjs 的別名表時逐條看）：');
    expect(lines).toContain('  穩定基礎・閱讀測驗（1）：falling child death rates since 1990');
  });
});
