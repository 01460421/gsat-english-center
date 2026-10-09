// @vitest-environment node
/**
 * build-data 的題庫輸出（lib/bank-data.mjs）。
 *
 * 範例題組在 tests/fixtures/bank/v1（由 tools/tests/data 的範例改寫，另加詞彙、綜合、篇章各一組；為了讓測試好讀，
 * 題數比正式規格少，所以不會通過 validate_bank.py 的題數與文章指標檢查，只用在前端）。
 * 閱讀（圖表）、混合題兩組是 tools/tests/data 的 ai.rd.0c1d2e@1、ai.mx.0f1a2b@1 原樣複製，只把 status 改成 verified
 * （原檔是 draft，建置只收 verified）；它們引用的事實單複製在 tests/fixtures/bank/facts（tools/tests/data/facts 原樣）。
 * 預期輸出（golden）在 tests/fixtures/bank-public：練習頁的元件測試與 Playwright 也用這份當假資料，
 * 所以前端看到的形狀和建置真正產生的一致。改了輸出格式要更新 golden：
 *   UPDATE_BANK_GOLDEN=1 npx vitest run scripts/lib/bank-data.test.ts     （在 apps/web 底下執行）
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BankDataError, PRACTICE_SCHEMA, buildBankData, practiceGroupPath } from './bank-data.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_BANK = path.join(WEB_DIR, 'tests', 'fixtures', 'bank', 'v1');
const GOLDEN = path.join(WEB_DIR, 'tests', 'fixtures', 'bank-public');
const FIXTURE_FACTS = path.join(WEB_DIR, 'tests', 'fixtures', 'bank', 'facts');
const WB = 'word_bank/advanced/ai.wb.0a1b2c@1.json';
const RD = 'reading/basic/ai.rd.0c1d2e@1.json';
const MX = 'mixed/basic/ai.mx.0f1a2b@1.json';

type Json = Record<string, unknown>;

const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 把範例題庫複製到暫存目錄，讓測試可以改檔、加檔。回傳 v1 目錄；事實單在旁邊的 facts（和 data/bank 的結構相同）。 */
function tmpBank(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'gsat-bank-'));
  tmpDirs.push(root);
  const dir = path.join(root, 'v1');
  cpSync(FIXTURE_BANK, dir, { recursive: true });
  cpSync(FIXTURE_FACTS, path.join(root, 'facts'), { recursive: true });
  return dir;
}

function writeVariant(dir: string, rel: string, change: (d: Json) => void, from = WB): void {
  const base = readJson(path.join(FIXTURE_BANK, from));
  change(base);
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(base));
}

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) allKeys(v, out);
  else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe('範例題庫的輸出與 golden 一致', () => {
  const result = buildBankData(FIXTURE_BANK, { relative: (f) => path.relative(WEB_DIR, f) });
  const index = { version: 'fixture', count: result.entries.length, groups: result.entries };

  if (process.env['UPDATE_BANK_GOLDEN'] === '1') {
    rmSync(GOLDEN, { recursive: true, force: true });
    mkdirSync(path.join(GOLDEN, 'bank', 'groups'), { recursive: true });
    writeFileSync(path.join(GOLDEN, 'bank', 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    for (const g of result.groups) writeFileSync(path.join(GOLDEN, practiceGroupPath(g)), `${JSON.stringify(g, null, 2)}\n`);
  }

  it('index.json', () => {
    expect(index).toEqual(readJson(path.join(GOLDEN, 'bank', 'index.json')));
  });

  it('每個題組檔', () => {
    const goldenFiles = readdirSync(path.join(GOLDEN, 'bank', 'groups')).sort();
    expect(result.groups.map((g) => path.basename(practiceGroupPath(g))).sort()).toEqual(goldenFiles);
    for (const g of result.groups) expect(g).toEqual(readJson(path.join(GOLDEN, practiceGroupPath(g))));
  });

  it('依題型、難度排序，六種題型都有', () => {
    expect(result.entries.map((e) => `${e.section_type}/${e.tier}`)).toEqual([
      'vocabulary/basic',
      'cloze/advanced',
      'word_bank/advanced',
      'structure/top',
      'reading/basic',
      'mixed/basic',
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('index 每組有 uid、version、題型、難度、主題、題數、課綱', () => {
    const wb = result.entries.find((e) => e.uid === 'ai.wb.0a1b2c');
    expect(wb).toEqual({
      uid: 'ai.wb.0a1b2c',
      version: 1,
      section_type: 'word_bank',
      format_version: 'word_bank-10x10',
      tier: 'advanced',
      topic: 'history of the umbrella',
      question_count: 10,
      curriculum: [{ code: '3-V-12', weight: 'primary' }],
    });
    // 詞彙題沒有選文主題。
    expect(result.entries.find((e) => e.section_type === 'vocabulary')?.topic).toBeNull();
  });

  it('不輸出生成、驗證細節與內部欄位，只有 auto_verified 旗標', () => {
    for (const g of result.groups) {
      expect(g['schema']).toBe(PRACTICE_SCHEMA);
      expect(g['auto_verified']).toBe(true);
      const keys = allKeys(g);
      for (const banned of [
        'generation', 'verification', 'metrics', 'status', 'pool', 'scoring_notes', 'guess_targets', 'open_tasks', 'run_id', 'prompt_sha256',
        'model', 'source_id', 'source_ids', 'facts', 'datasets', 'use', 'created_by', 'share_alike', 'commercial_ok', 'rubric', 'model_texts',
      ]) {
        expect(keys.has(banned), `${g.uid} 不該有 ${banned}`).toBe(false);
      }
      for (const k of keys) expect(k).not.toMatch(/reasoning|chain_?of_?thought|step_?by_?step|thinking/i);
      // 事實單代號是內部資料。
      expect(JSON.stringify(g)).not.toContain('fact:');
    }
  });

  it('學生需要的 annotations 都在：解析、全文中譯、排除法表', () => {
    const wb = result.groups.find((g) => g.uid === 'ai.wb.0a1b2c');
    const annotations = wb?.['annotations'] as Json;
    expect(Object.keys(annotations).sort()).toEqual(['elimination', 'explanations', 'translation_zh']);
    expect(annotations['elimination']).toEqual({
      feasible: { '1': ['A', 'E'], '2': ['G'], '3': ['B'], '4': ['D', 'F'], '5': ['A', 'E', 'I'], '6': ['H'], '7': ['C'], '8': ['A'], '9': ['F'], '10': ['D', 'F', 'J'] },
      perfect_matchings: 1,
    });
    const item1 = (annotations['explanations'] as { items: Record<string, Json> }).items['1'];
    expect(Object.keys(item1 ?? {}).sort()).toEqual(['blank_pos', 'clue_type', 'evidence', 'explanation_zh', 'hints', 'option_notes_zh', 'sense', 'strategy_zh']);
  });
});

describe('挑選規則', () => {
  it('data/bank/v1 不存在：空的結果、不丟錯', () => {
    const result = buildBankData(path.join(tmpdir(), 'no-such-bank-dir-for-test'));
    expect(result).toEqual({ entries: [], groups: [], inputs: [], skipped: [], warnings: [], scanned: 0 });
  });

  it('目錄存在但沒有 verified 題組：空的結果', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gsat-bank-'));
    tmpDirs.push(dir);
    writeVariant(dir, WB, (d) => {
      d['status'] = 'draft';
    });
    const result = buildBankData(dir);
    expect(result.entries).toEqual([]);
    expect(result.skipped).toEqual([{ file: path.join(dir, WB), reason: 'not_verified' }]);
  });

  it('同 uid 取最大的 verified 版本；更新的 draft 不算', () => {
    const dir = tmpBank();
    writeVariant(dir, 'word_bank/advanced/ai.wb.0a1b2c@2.json', (d) => {
      d['version'] = 2;
      (d['group'] as Json)['passage'] = String((d['group'] as Json)['passage']).replace('Today', 'Nowadays');
    });
    writeVariant(dir, 'word_bank/advanced/ai.wb.0a1b2c@3.json', (d) => {
      d['version'] = 3;
      d['status'] = 'draft';
    });
    const result = buildBankData(dir);
    const wb = result.entries.filter((e) => e.uid === 'ai.wb.0a1b2c');
    expect(wb.map((e) => e.version)).toEqual([2]);
    const group = result.groups.find((g) => g.uid === 'ai.wb.0a1b2c');
    expect(String((group?.['group'] as Json)['passage'])).toMatch(/^Nowadays/);
    expect(result.skipped.map((s) => [path.basename(s.file), s.reason]).sort()).toEqual([
      ['ai.wb.0a1b2c@1.json', 'older_version'],
      ['ai.wb.0a1b2c@3.json', 'not_verified'],
    ]);
    expect(result.inputs.map((f) => path.basename(f))).toContain('ai.wb.0a1b2c@2.json');
    // 更新的 @3 還是 draft（答案和 @2 相同）：照舊發布 @2，但建置紀錄要看得出來。
    expect(result.warnings).toEqual(['ai.wb.0a1b2c 有較新的 @3（draft，驗證中），仍發布 @2（新版沒有改答案）']);
  });

  it('較新的版本還沒通過驗證且改了答案（draft 或 rejected）：撤下舊版並警告', () => {
    for (const status of ['draft', 'rejected']) {
      const dir = tmpBank();
      writeVariant(dir, 'word_bank/advanced/ai.wb.0a1b2c@2.json', (d) => {
        d['version'] = 2;
        d['status'] = status;
        // 舊版第 1 題的答案有誤，新版更正（SPEC §4.7）。
        const qs = (d['group'] as Json)['questions'] as Json[];
        (qs[0] as Json)['answer'] = 'A';
      });
      const result = buildBankData(dir);
      expect(result.entries.map((e) => e.uid)).not.toContain('ai.wb.0a1b2c');
      expect(result.entries).toHaveLength(5);
      expect(result.groups.map((g) => g.uid)).not.toContain('ai.wb.0a1b2c');
      expect(result.inputs.map((f) => path.basename(f))).not.toContain('ai.wb.0a1b2c@1.json');
      expect(result.skipped.map((s) => [path.basename(s.file), s.reason]).sort()).toEqual([
        ['ai.wb.0a1b2c@1.json', 'withdrawn'],
        ['ai.wb.0a1b2c@2.json', 'not_verified'],
      ]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/^ai\.wb\.0a1b2c 有較新的 @2（(draft|rejected)，[^）]+），其中 @2 改了答案：撤下 @1/);
    }
  });

  it('正解代號沒變、正解選項的文字改了也算改了答案', () => {
    const dir = tmpBank();
    writeVariant(dir, 'word_bank/advanced/ai.wb.0a1b2c@2.json', (d) => {
      d['version'] = 2;
      d['status'] = 'draft';
      const bank = (d['group'] as Json)['options_bank'] as Record<string, string>;
      bank['E'] = 'colourful';
    });
    const result = buildBankData(dir);
    expect(result.skipped).toContainEqual({ file: path.join(dir, WB), reason: 'withdrawn' });
  });

  describe('混合題（多選的答案是陣列；解析的部分給分寫法、可對調的格也影響計分）', () => {
    const MX2 = 'mixed/basic/ai.mx.0f1a2b@2.json';
    const questions = (d: Json) => (d['group'] as Json)['questions'] as Json[];
    const items = (d: Json) => ((d['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
    const draftMx2 = (dir: string, change: (d: Json) => void) =>
      writeVariant(
        dir,
        MX2,
        (d) => {
          d['version'] = 2;
          d['status'] = 'draft';
          change(d);
        },
        MX,
      );

    const cases: [string, (d: Json) => void][] = [
      [
        '多選的正解從 [A, D] 改成 [D]',
        (d) => {
          (questions(d)[2] as Json)['answer'] = ['D'];
        },
      ],
      [
        '多選的正解代號沒變、正解選項的文字改了',
        (d) => {
          ((questions(d)[2] as Json)['options'] as Record<string, string>)['D'] = 'They now buy more food than before.';
        },
      ],
      [
        '填充的部分給分寫法改了',
        (d) => {
          (items(d)['2'] as Json)['partial_credit_forms'] = ['fill', 'fills'];
        },
      ],
      [
        '兩格填充改成可以對調',
        (d) => {
          (items(d)['1'] as Json)['interchangeable_with'] = 2;
          (items(d)['2'] as Json)['interchangeable_with'] = 1;
        },
      ],
    ];
    for (const [name, change] of cases) {
      it(`@2 draft ${name}：撤下 @1`, () => {
        const dir = tmpBank();
        draftMx2(dir, change);
        const result = buildBankData(dir);
        expect(result.groups.map((g) => g.uid)).not.toContain('ai.mx.0f1a2b');
        expect(result.skipped).toContainEqual({ file: path.join(dir, MX), reason: 'withdrawn' });
        expect(result.warnings).toEqual([
          expect.stringMatching(/^ai\.mx\.0f1a2b 有較新的 @2（draft，驗證中），其中 @2 改了答案：撤下 @1/) as unknown as string,
        ]);
      });
    }

    it('@2 draft 只調換多選代號、可接受答案、部分給分寫法的順序，或只改文章：照舊發布 @1（新版沒有改答案）', () => {
      const dir = tmpBank();
      draftMx2(dir, (d) => {
        (questions(d)[2] as Json)['answer'] = ['D', 'A'];
        (questions(d)[0] as Json)['accepted_answers'] = ['makes', 'turns'];
        (items(d)['1'] as Json)['partial_credit_forms'] = ['making', 'made', 'make', 'turning', 'turned', 'turn'];
        const parts = (d['group'] as Json)['passage_parts'] as Json[];
        (parts[0] as Json)['text'] = `${String((parts[0] as Json)['text'])} `;
      });
      const result = buildBankData(dir);
      expect(result.groups.find((g) => g.uid === 'ai.mx.0f1a2b')?.version).toBe(1);
      expect(result.warnings).toEqual(['ai.mx.0f1a2b 有較新的 @2（draft，驗證中），仍發布 @1（新版沒有改答案）']);
    });
  });

  it('較新的版本只改了答案以外的地方，或寫到一半無法解析：照舊發布舊版並警告', () => {
    const dir = tmpBank();
    writeVariant(dir, 'word_bank/advanced/ai.wb.0a1b2c@2.json', (d) => {
      d['version'] = 2;
      d['status'] = 'rejected';
      (d['group'] as Json)['passage'] = String((d['group'] as Json)['passage']).replace('Today', 'Nowadays');
    });
    writeFileSync(path.join(dir, 'word_bank', 'advanced', 'ai.wb.0a1b2c@3.json'), '{ "schema": "gsat-bank/v1", "uid": ');
    const result = buildBankData(dir);
    expect(result.entries.find((e) => e.uid === 'ai.wb.0a1b2c')?.version).toBe(1);
    expect(result.warnings).toContain('ai.wb.0a1b2c 有較新的 @2（rejected，未通過驗證）、@3（無法解析），仍發布 @1（新版無法比對答案）');
  });

  it('被新版取代的舊版本違反前端契約時不讓建置失敗（舊檔依只增不減的規則不能改）', () => {
    const dir = tmpBank();
    // @1 的提示有 4 層（假設日後契約改嚴），另有合法的 @2：會發布的是 @2，建置照常。
    writeVariant(dir, WB, (d) => {
      const items = ((d['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
      (items['1'] as Json)['hints'] = ['a', 'b', 'c', 'd'];
    });
    writeVariant(dir, 'word_bank/advanced/ai.wb.0a1b2c@2.json', (d) => {
      d['version'] = 2;
    });
    const result = buildBankData(dir);
    expect(result.entries.find((e) => e.uid === 'ai.wb.0a1b2c')?.version).toBe(2);
    expect(result.skipped).toEqual([{ file: path.join(dir, WB), reason: 'older_version' }]);
    expect(result.warnings).toEqual([]);

    // 同樣的檔案如果是要發布的版本，就會讓建置失敗。
    rmSync(path.join(dir, 'word_bank', 'advanced', 'ai.wb.0a1b2c@2.json'));
    expect(() => buildBankData(dir)).toThrow(/ai\.wb\.0a1b2c@1\.json 解析第 1 題：hints 必須是最多 3 個非空字串/);
  });

  it('rejected、檢核卷、還沒有練習介面的題型、檔名不對都略過；壞掉的 JSON 只警告', () => {
    const dir = tmpBank();
    writeVariant(dir, 'word_bank/advanced/ai.wb.111111@1.json', (d) => {
      d['uid'] = 'ai.wb.111111';
      d['status'] = 'rejected';
      d['status_reason'] = '盲解 B 選了 A';
    });
    writeVariant(dir, 'word_bank/top/ai.wb.222222@1.json', (d) => {
      d['uid'] = 'ai.wb.222222';
      d['tier'] = 'top';
      d['pool'] = 'checkpoint';
    });
    writeVariant(dir, 'translation/basic/ai.tr.333333@1.json', (d) => {
      d['uid'] = 'ai.tr.333333';
      d['section_type'] = 'translation';
      d['tier'] = 'basic';
    });
    writeVariant(dir, 'word_bank/advanced/notes.json', () => {});
    mkdirSync(path.join(dir, 'cloze', 'basic'), { recursive: true });
    writeFileSync(path.join(dir, 'cloze', 'basic', 'ai.cz.444444@1.json'), '{ "schema": "gsat-bank/v1", "uid": ');
    // 編輯器的暫存檔不掃描。
    writeFileSync(path.join(dir, 'cloze', 'basic', '.ai.cz.444444@1.json.swp.json'), 'x');

    const result = buildBankData(dir);
    expect(result.entries).toHaveLength(6);
    expect(result.skipped.map((s) => [path.basename(s.file), s.reason]).sort()).toEqual([
      ['ai.tr.333333@1.json', 'unsupported_section'],
      ['ai.wb.111111@1.json', 'not_verified'],
      ['ai.wb.222222@1.json', 'checkpoint'],
      ['notes.json', 'bad_filename'],
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/ai\.cz\.444444@1\.json 不是合法的 JSON/);
    expect(result.scanned).toBe(11);
  });
});

describe('verified 題組違反前端契約時讓建置失敗', () => {
  const cases: [string, string, (d: Json) => void, RegExp][] = [
    ['放錯目錄', 'word_bank/basic/ai.wb.0a1b2c@1.json', () => {}, /應該放在 v1\/word_bank\/advanced\//],
    ['檔名和 version 不一致', 'word_bank/advanced/ai.wb.0a1b2c@5.json', () => {}, /和檔名不一致/],
    [
      '少了某一題的解析',
      WB,
      (d) => {
        delete ((d['annotations'] as Json)['explanations'] as { items: Json }).items['10'];
      },
      /第 10 題缺少解析/,
    ],
    [
      'evidence 不是陣列',
      WB,
      (d) => {
        const items = ((d['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
        (items['3'] as Json)['evidence'] = '逐字證據句';
      },
      /解析第 3 題：evidence 必須是非空的字串陣列/,
    ],
    [
      '提示超過 3 層',
      WB,
      (d) => {
        const items = ((d['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
        (items['2'] as Json)['hints'] = ['a', 'b', 'c', 'd'];
      },
      /hints 必須是最多 3 個非空字串/,
    ],
    [
      '正解不在選項庫',
      WB,
      (d) => {
        const qs = (d['group'] as Json)['questions'] as Json[];
        (qs[0] as Json)['answer'] = 'K';
      },
      /選項裡沒有正解 K/,
    ],
    [
      '排除法表的題號不存在',
      WB,
      (d) => {
        ((d['annotations'] as Json)['elimination'] as { feasible: Json }).feasible['11'] = ['A'];
      },
      /elimination\.feasible 的題號 11 不存在/,
    ],
  ];
  for (const [name, rel, change, message] of cases) {
    it(name, () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gsat-bank-'));
      tmpDirs.push(dir);
      writeVariant(dir, rel, change);
      expect(() => buildBankData(dir)).toThrow(BankDataError);
      expect(() => buildBankData(dir)).toThrow(message);
    });
  }
});

describe('閱讀、混合題', () => {
  const result = buildBankData(FIXTURE_BANK, { relative: (f) => path.relative(WEB_DIR, f) });
  const rd = result.groups.find((g) => g.uid === 'ai.rd.0c1d2e') as Json;
  const mx = result.groups.find((g) => g.uid === 'ai.mx.0f1a2b') as Json;
  const source = (rel: string) => readJson(path.join(FIXTURE_BANK, rel));

  it('index：題型、難度、主題、題數', () => {
    expect(result.entries.find((e) => e.uid === 'ai.rd.0c1d2e')).toEqual({
      uid: 'ai.rd.0c1d2e',
      version: 1,
      section_type: 'reading',
      format_version: 'reading-4',
      tier: 'basic',
      topic: 'falling child death rates since 1990',
      question_count: 4,
      curriculum: [
        { code: '3-V-3', weight: 'primary' },
        { code: 'B-V-12', weight: 'secondary' },
        { code: '3-V-12', weight: 'secondary' },
      ],
    });
    expect(result.entries.find((e) => e.uid === 'ai.mx.0f1a2b')?.question_count).toBe(4);
  });

  it('圖表的 chart 物件照原樣輸出，figure 的其他欄位也在', () => {
    const figure = ((rd['group'] as Json)['figures'] as Json[])[0] as Json;
    const raw = (((source(RD)['group'] as Json)['figures'] as Json[])[0] ?? {}) as Json;
    expect(figure).toEqual(raw);
    expect((figure['chart'] as Json)['type']).toBe('line');
  });

  it('多文本 passage_parts、混合題的多選、填充、簡答原樣保留（含完整的可接受答案）', () => {
    const group = mx['group'] as Json;
    expect((group['passage_parts'] as Json[]).map((p) => p['label'])).toEqual(['A', 'B']);
    const qs = group['questions'] as Json[];
    expect(qs.map((q) => q['mode'])).toEqual(['fill_in_blank', 'fill_in_blank', 'multi_select', 'short_answer']);
    expect(qs[0]?.['accepted_answers']).toEqual(['turns', 'makes']);
    expect(qs[2]?.['answer']).toEqual(['A', 'D']);
    expect(qs.map((q) => q['points'])).toEqual([2, 2, 4, 2]);
  });

  it('解析多了閱讀、混合題的欄位（證據、字形變化、部分給分寫法）；前四種題型不輸出這些欄位', () => {
    const items = ((mx['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
    expect(Object.keys(items['1'] ?? {}).sort()).toEqual([
      'evidence', 'explanation_zh', 'interchangeable_with', 'partial_credit_forms', 'source_token', 'transform',
    ]);
    expect(items['3']?.['option_evidence']).toEqual(
      (((source(MX)['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items['3'] as Json)['option_evidence'],
    );
    expect(items['3']?.['option_codes']).toEqual({ A: 'E1', B: 'NM', C: 'PT', D: 'E1', E: 'NM', F: 'NM' });
    const rdItems = ((rd['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
    expect(rdItems['1']?.['option_codes']).toEqual({ A: 'TN', C: 'NM', D: 'NM' });
  });

  it('參考資料：事實單裡被引用的來源（publisher、title、url；資料集來源另有 license），依出現順序、網址不重複；不輸出事實單代號與內部欄位', () => {
    const pv = rd['provenance'] as Json;
    expect(pv['references']).toEqual([
      {
        publisher: 'World Bank',
        title: 'World Development Indicators: Mortality rate, under-5 (per 1,000 live births) (SH.DYN.MORT)',
        url: 'https://data.worldbank.org/indicator/SH.DYN.MORT',
        license: 'CC-BY-4.0',
      },
      { publisher: 'United Nations', title: 'Goal 3: Ensure healthy lives and promote well-being for all at all ages', url: 'https://sdgs.un.org/goals/goal3' },
      { publisher: 'United Nations', title: 'The 17 Goals', url: 'https://sdgs.un.org/goals' },
    ]);
    expect((mx['provenance'] as Json)['references']).toHaveLength(2);
    // 只用來取事實的來源（use: fact_only）不輸出 license：那是站方查證用的使用條件（UN terms of use），不是授權標示。
    const refs = [...(pv['references'] as Json[]), ...((mx['provenance'] as Json)['references'] as Json[])];
    expect(refs.filter((r) => 'license' in r).map((r) => r['publisher'])).toEqual(['World Bank']);
    for (const g of [rd, mx]) {
      expect(JSON.stringify(g)).not.toContain('terms of use');
      const text = JSON.stringify(g);
      expect(text).not.toContain('fact:');
      expect(text).not.toContain('sdg3-0001');
      expect(text).not.toContain('UN IGME'); // 事實單來源的 note
      expect(text).not.toContain('every country should cut'); // 事實文字
    }
    // 前四種題型的範例引用的事實單不在 fixtures：略過，不列參考資料。
    expect((result.groups.find((g) => g.uid === 'ai.wb.0a1b2c')?.['provenance'] as Json)['references']).toEqual([]);
  });

  it('資料集來源（use: dataset）要有 license，沒有就建置失敗（表格、圖表照原樣用了它的數值，CC BY 要標授權）', () => {
    const dir = tmpBank();
    const factsFile = path.join(dir, '..', 'facts', 'sdg3-0001.json');
    const sheet = readJson(factsFile);
    const dataset = (sheet['sources'] as Json[]).find((s) => s['use'] === 'dataset') as Json;
    dataset['license'] = '';
    writeFileSync(factsFile, JSON.stringify(sheet));
    expect(() => buildBankData(dir)).toThrow(/sdg3-0001\.json：事實單的資料集來源（use: dataset）要有 license/);
  });

  it('同一個網址在一份事實單只取事實、在另一份是資料集：只列一次，帶 license', () => {
    const dir = tmpBank();
    const worldBank = 'https://data.worldbank.org/indicator/SH.DYN.MORT';
    // 混合題引用的 sdg12-0001 把第一個來源改成同一個網址的 fact_only 來源，再讓混合題也引用 sdg3-0001（資料集）。
    const factsFile = path.join(dir, '..', 'facts', 'sdg12-0001.json');
    const sheet = readJson(factsFile);
    const first = (sheet['sources'] as Json[])[0] as Json;
    first['url'] = worldBank;
    writeFileSync(factsFile, JSON.stringify(sheet));
    writeVariant(dir, MX, (d) => {
      ((d['provenance'] as Json)['sources'] as Json[]).push({ source_id: 'fact:sdg3-0001', role: 'fact' });
    }, MX);
    const refs = (buildBankData(dir).groups.find((g) => g.uid === 'ai.mx.0f1a2b')?.['provenance'] as Json)['references'] as Json[];
    const hits = refs.filter((r) => r['url'] === worldBank);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.['license']).toBe('CC-BY-4.0');
  });

  it('引用的事實單算進資料版本的輸入', () => {
    expect(result.inputs.map((f) => path.basename(f))).toEqual(expect.arrayContaining(['sdg3-0001.json', 'sdg12-0001.json']));
  });

  it('事實單沒有被任何事實引用的來源不列；都沒有引用時列全部', () => {
    const dir = tmpBank();
    const factsFile = path.join(dir, '..', 'facts', 'sdg12-0001.json');
    const sheet = readJson(factsFile);
    (sheet['sources'] as Json[]).push({ id: 's9', publisher: 'X', title: 'unused', url: 'https://example.org/x', accessed: '2026-10-09', license: 'x', use: 'fact_only' });
    writeFileSync(factsFile, JSON.stringify(sheet));
    const refs = (g: Json | undefined) => ((g?.['provenance'] as Json)['references'] as Json[]).map((r) => r['title']);
    expect(refs(buildBankData(dir).groups.find((g) => g.uid === 'ai.mx.0f1a2b'))).not.toContain('unused');
    sheet['facts'] = [];
    writeFileSync(factsFile, JSON.stringify(sheet));
    expect(refs(buildBankData(dir).groups.find((g) => g.uid === 'ai.mx.0f1a2b'))).toContain('unused');
  });

  it('依事實單撰寫的閱讀、混合題找不到事實單：建置失敗（頁面要列參考資料）', () => {
    const dir = tmpBank();
    rmSync(path.join(dir, '..', 'facts', 'sdg12-0001.json'));
    expect(() => buildBankData(dir)).toThrow(/ai\.mx\.0f1a2b@1\.json：找不到事實單 .*sdg12-0001\.json/);
    // factsDir 可以另外指定。
    expect(() => buildBankData(dir, { factsDir: FIXTURE_FACTS })).not.toThrow();
  });

  it('依事實單撰寫（ai-original-from-facts）卻沒有引用任何事實單：建置失敗', () => {
    const dir = tmpBank();
    writeVariant(dir, MX, (d) => {
      (d['provenance'] as Json)['sources'] = [];
    }, MX);
    expect(() => buildBankData(dir)).toThrow(/閱讀、混合題要有事實單/);
  });

  it('只用常識寫的原創文章（derivation: original、沒有來源）：照常發布，參考資料是空的', () => {
    const dir = tmpBank();
    writeVariant(dir, MX, (d) => {
      const pv = d['provenance'] as Json;
      pv['derivation'] = 'original';
      pv['sources'] = [];
      pv['attribution_text'] = '本文由 AI 撰寫';
    }, MX);
    const g = buildBankData(dir).groups.find((x) => x.uid === 'ai.mx.0f1a2b') as Json;
    expect(g['provenance']).toEqual({ license: 'original-ai', derivation: 'original', attribution_text: '本文由 AI 撰寫', sources: [], references: [] });
    // derivation original 但列了不存在的事實單（validate_bank.py 只列 warning）：略過，不讓建置失敗。
    writeVariant(dir, MX, (d) => {
      const pv = d['provenance'] as Json;
      pv['derivation'] = 'original';
      pv['sources'] = [{ source_id: 'fact:not-there', role: 'fact' }];
    }, MX);
    expect((buildBankData(dir).groups.find((x) => x.uid === 'ai.mx.0f1a2b')?.['provenance'] as Json)['references']).toEqual([]);
  });

  const broken: [string, string, (d: Json) => void, RegExp][] = [
    [
      '圖表數列的數值個數和類別不同',
      RD,
      (d) => {
        const chart = (((d['group'] as Json)['figures'] as Json[])[0] as Json)['chart'] as Json;
        ((chart['series'] as Json[])[0] as Json)['values'] = [1, 2];
      },
      /chart\.series 的每一項都要有 name 與 4 個數字的 values/,
    ],
    [
      '圖表類型不支援',
      RD,
      (d) => {
        ((((d['group'] as Json)['figures'] as Json[])[0] as Json)['chart'] as Json)['type'] = 'scatter';
      },
      /chart\.type scatter 不是/,
    ],
    [
      '資料來源的網址不是 http(s)',
      RD,
      (d) => {
        const chart = (((d['group'] as Json)['figures'] as Json[])[0] as Json)['chart'] as Json;
        (chart['source'] as Json)['url'] = 'javascript:alert(1)';
      },
      /chart\.source\.url 必須是 http\(s\) 網址/,
    ],
    [
      '閱讀題用了填充的作答模式',
      RD,
      (d) => {
        (((d['group'] as Json)['questions'] as Json[])[0] as Json)['mode'] = 'fill_in_blank';
      },
      /reading 不能用作答模式 fill_in_blank/,
    ],
    [
      '多選題的正解不在選項裡',
      MX,
      (d) => {
        (((d['group'] as Json)['questions'] as Json[])[2] as Json)['answer'] = ['A', 'K'];
      },
      /選項裡沒有正解 K/,
    ],
    [
      '填充題沒有可接受答案清單',
      MX,
      (d) => {
        (((d['group'] as Json)['questions'] as Json[])[1] as Json)['accepted_answers'] = null;
      },
      /accepted_answers 必須是非空的字串陣列/,
    ],
    [
      'transform 不合法',
      MX,
      (d) => {
        const items = ((d['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
        (items['1'] as Json)['transform'] = 'magic';
      },
      /解析第 1 題：transform 不合法/,
    ],
    [
      'interchangeable_with 指到不存在的題號',
      MX,
      (d) => {
        const items = ((d['annotations'] as Json)['explanations'] as { items: Record<string, Json> }).items;
        (items['1'] as Json)['interchangeable_with'] = 9;
      },
      /interchangeable_with 必須是另一題的題號或 null/,
    ],
  ];
  for (const [name, rel, change, message] of broken) {
    it(`違反前端契約時建置失敗：${name}`, () => {
      const dir = tmpBank();
      writeVariant(dir, rel, change, rel);
      expect(() => buildBankData(dir)).toThrow(BankDataError);
      expect(() => buildBankData(dir)).toThrow(message);
    });
  }
});

it('golden 目錄存在（練習頁的元件測試與 Playwright 會用）', () => {
  expect(existsSync(path.join(GOLDEN, 'bank', 'index.json'))).toBe(true);
});
