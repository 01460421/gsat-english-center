// @vitest-environment node
/**
 * build-data 的題庫輸出（lib/bank-data.mjs）。
 *
 * 範例題組在 tests/fixtures/bank/v1（由 tools/tests/data 的範例改寫，另加詞彙、綜合、篇章各一組；為了讓測試好讀，
 * 題數比正式規格少，所以不會通過 validate_bank.py 的題數與文章指標檢查，只用在前端）。
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
const WB = 'word_bank/advanced/ai.wb.0a1b2c@1.json';

type Json = Record<string, unknown>;

const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 把範例題庫複製到暫存目錄，讓測試可以改檔、加檔。 */
function tmpBank(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gsat-bank-'));
  tmpDirs.push(dir);
  cpSync(FIXTURE_BANK, dir, { recursive: true });
  return dir;
}

function writeVariant(dir: string, rel: string, change: (d: Json) => void): void {
  const base = readJson(path.join(FIXTURE_BANK, WB));
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

  it('依題型、難度排序，四種題型都有', () => {
    expect(result.entries.map((e) => `${e.section_type}/${e.tier}`)).toEqual([
      'vocabulary/basic',
      'cloze/advanced',
      'word_bank/advanced',
      'structure/top',
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
      for (const banned of ['generation', 'verification', 'metrics', 'status', 'pool', 'scoring_notes', 'guess_targets', 'run_id', 'prompt_sha256', 'model']) {
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
      expect(result.entries).toHaveLength(3);
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
    writeVariant(dir, 'reading/basic/ai.rd.333333@1.json', (d) => {
      d['uid'] = 'ai.rd.333333';
      d['section_type'] = 'reading';
      d['tier'] = 'basic';
    });
    writeVariant(dir, 'word_bank/advanced/notes.json', () => {});
    mkdirSync(path.join(dir, 'cloze', 'basic'), { recursive: true });
    writeFileSync(path.join(dir, 'cloze', 'basic', 'ai.cz.444444@1.json'), '{ "schema": "gsat-bank/v1", "uid": ');
    // 編輯器的暫存檔不掃描。
    writeFileSync(path.join(dir, 'cloze', 'basic', '.ai.cz.444444@1.json.swp.json'), 'x');

    const result = buildBankData(dir);
    expect(result.entries).toHaveLength(4);
    expect(result.skipped.map((s) => [path.basename(s.file), s.reason]).sort()).toEqual([
      ['ai.rd.333333@1.json', 'unsupported_section'],
      ['ai.wb.111111@1.json', 'not_verified'],
      ['ai.wb.222222@1.json', 'checkpoint'],
      ['notes.json', 'bad_filename'],
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/ai\.cz\.444444@1\.json 不是合法的 JSON/);
    expect(result.scanned).toBe(9);
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

it('golden 目錄存在（練習頁的元件測試與 Playwright 會用）', () => {
  expect(existsSync(path.join(GOLDEN, 'bank', 'index.json'))).toBe(true);
});
