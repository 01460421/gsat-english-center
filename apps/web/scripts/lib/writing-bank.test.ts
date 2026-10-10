// @vitest-environment node
/**
 * scripts/lib/writing-bank.mjs：本站仿真中譯英與作文的公開資料（docs/design/bank-writing.md §4、§7.2）。
 * 範例題庫 tests/fixtures/bank-writing（tools/tests/data 的兩個範例改成 verified）→ golden tests/fixtures/bank-writing-public。
 * 更新 golden：UPDATE_WRITING_BANK_GOLDEN=1 npx vitest run scripts/lib/writing-bank.test.ts
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { officialCorpus } from '../../../../packages/shared/scripts/bank-select.mjs';
import {
  WRITING_BANK_INDEX_PATH,
  WRITING_BANK_LISTS,
  WritingBankError,
  assertWritingBankOutputs,
  buildWritingBank,
  promptExcerpt,
  writingBankAnswersPath,
  writingBankListPath,
  writingBankPromptPath,
} from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE_ROOT = path.join(WEB_DIR, 'tests', 'fixtures', 'bank-writing');
const FIXTURE_BANK = path.join(FIXTURE_ROOT, 'v1');
const GOLDEN = path.join(WEB_DIR, 'tests', 'fixtures', 'bank-writing-public');
const TR = 'translation/basic/ai.tr.0b1c2d@1.json';
const CP = 'composition/basic/ai.cp.0e1f2a@1.json';

type Json = Record<string, any>;
const readJson = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 範例題庫複製到暫存的 repo（data/bank/v1），讓測試可以改檔、加下架清單。 */
function tmpRepo(change?: (bankDir: string) => void, unpublish?: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'gsat-writing-bank-'));
  tmpDirs.push(root);
  const bankDir = path.join(root, 'data', 'bank', 'v1');
  cpSync(FIXTURE_BANK, bankDir, { recursive: true });
  change?.(bankDir);
  const unpublishFile = path.join(root, 'data', 'unpublish.jsonl');
  if (unpublish !== undefined) writeFileSync(unpublishFile, unpublish);
  return { root, bankDir, unpublishFile };
}

function edit(bankDir: string, rel: string, change: (d: Json) => void) {
  const file = path.join(bankDir, rel);
  const d = readJson(file);
  change(d);
  writeFileSync(file, JSON.stringify(d));
}

function build(opts: { bankDir: string; root: string; unpublishFile: string }, exams: Json[] = []) {
  return buildWritingBank({ bankDir: opts.bankDir, exams, unpublishFile: opts.unpublishFile, repoRoot: opts.root });
}

/** buildWritingBank 的結果 → build-data 會寫出去的檔案（相對 public/data/）。 */
function filesOf(result: ReturnType<typeof buildWritingBank>, version = 'fixture') {
  const files = new Map<string, Json>();
  files.set(WRITING_BANK_INDEX_PATH, { version, count: result.index.length, groups: result.index });
  for (const [section, tier] of WRITING_BANK_LISTS) {
    const groups = result.lists[section][tier] ?? [];
    files.set(writingBankListPath(section, tier), { version, section_type: section, tier, count: groups.length, groups });
  }
  for (const f of result.prompts) files.set(writingBankPromptPath(f), f);
  for (const f of result.answers) files.set(writingBankAnswersPath(f), f);
  return files;
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
  const result = buildWritingBank({ bankDir: FIXTURE_BANK, exams: [], unpublishFile: path.join(FIXTURE_ROOT, 'none.jsonl'), repoRoot: FIXTURE_ROOT });
  const files = filesOf(result);

  if (process.env['UPDATE_WRITING_BANK_GOLDEN'] === '1') {
    rmSync(GOLDEN, { recursive: true, force: true });
    for (const [rel, value] of files) {
      const file = path.join(GOLDEN, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    }
  }

  it('每個檔案都和 golden 相同，golden 也沒有多餘的檔案', () => {
    const golden: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else golden.push(path.relative(GOLDEN, full));
      }
    };
    walk(path.join(GOLDEN, 'writing'));
    expect([...files.keys()].sort()).toEqual(golden.sort());
    for (const [rel, value] of files) expect(value, rel).toEqual(readJson(path.join(GOLDEN, rel)));
  });

  it('兩組都發布；沒有警告與略過', () => {
    expect(result.index).toEqual([
      { uid: 'ai.tr.0b1c2d', version: 1, section_type: 'translation', tier: 'basic', topic: '自備水壺上學' },
      { uid: 'ai.cp.0e1f2a', version: 1, section_type: 'composition', tier: 'basic', topic: '打掃時間的分工' },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('6 個 list 檔都存在，沒題組的難度是空陣列', () => {
    expect(WRITING_BANK_LISTS).toHaveLength(6);
    for (const [section, tier] of WRITING_BANK_LISTS) {
      const list = files.get(writingBankListPath(section, tier))!;
      expect(list['groups']).toHaveLength(tier === 'basic' ? 1 : 0);
      expect(list['count']).toBe(tier === 'basic' ? 1 : 0);
    }
    const tr = files.get(writingBankListPath('translation', 'basic'))!;
    expect(tr['groups'][0]).toEqual({
      uid: 'ai.tr.0b1c2d',
      version: 1,
      topic: '自備水壺上學',
      stems: ['近年來，許多學生已經開始自己帶水壺到學校。', '為了減少塑膠垃圾，學校的福利社也不再賣瓶裝水。'],
    });
    const cp = files.get(writingBankListPath('composition', 'basic'))!;
    expect(cp['groups'][0]).toMatchObject({ uid: 'ai.cp.0e1f2a', essay_type: 'picture', figure_count: 1 });
    expect(cp['groups'][0]['prompt_excerpt']).toMatch(/^在臺灣，許多學校每天都有打掃時間.*…$/);
  });

  it('作答前的檔案（index、list、prompts）沒有答案、評分規準與範文；answers 檔有', () => {
    const banned = ['references', 'parts', 'model_texts', 'criteria', 'answer', 'accepted_answers', 'answer_segments', 'scoring_notes', 'generation', 'verification', 'metrics', 'status', 'status_reason'];
    for (const [rel, value] of files) {
      const keys = allKeys(value);
      const forbidden = rel.startsWith('writing/bank/answers/') ? banned.filter((k) => !['references', 'parts', 'model_texts', 'criteria'].includes(k)) : banned;
      for (const k of forbidden) expect(keys.has(k), `${rel} 不能有 ${k}`).toBe(false);
    }
    const trAnswers = files.get(writingBankAnswersPath({ uid: 'ai.tr.0b1c2d', version: 1 }))!;
    expect(trAnswers['items'][0]['references']).toEqual([
      'In recent years, many students have started to bring their own water bottles to school.',
      'Many students have begun bringing their own water bottles to school in recent years.',
    ]);
    expect(trAnswers['items'][0]['parts']).toHaveLength(4);
    const cpAnswers = files.get(writingBankAnswersPath({ uid: 'ai.cp.0e1f2a', version: 1 }))!;
    expect(cpAnswers['model_texts'].map((t: Json) => t['label'])).toEqual(['steady', 'top']);
    expect(Object.keys(cpAnswers['criteria'])).toEqual(['content', 'organization', 'grammar', 'vocabulary']);
  });

  it('group_id、item_id 的格式是 {uid}@{v} 與 {uid}@{v}#{label}', () => {
    const tr = files.get(writingBankPromptPath({ uid: 'ai.tr.0b1c2d', version: 1 }))!;
    expect(tr['group_id']).toBe('ai.tr.0b1c2d@1');
    expect(tr['items'].map((i: Json) => i['item_id'])).toEqual(['ai.tr.0b1c2d@1#1', 'ai.tr.0b1c2d@1#2']);
    expect(tr['items'][0]['hints']).toHaveLength(3);
    const cp = files.get(writingBankPromptPath({ uid: 'ai.cp.0e1f2a', version: 1 }))!;
    expect(cp['item_id']).toBe('ai.cp.0e1f2a@1#1');
    expect(cp['figures'][0]['svg']).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(cp['scaffold']['kind']).toBe('outline+sentence_starters');
    expect(cp['instructions']).toBe('請依提示寫一篇英文作文，文分兩段，至少 120 個單詞。');
  });
});

describe('挑選與 SVG', () => {
  it('不合格的 SVG：那張圖的 svg 是 null，保留文字描述並印警告', () => {
    const repo = tmpRepo((dir) =>
      edit(dir, CP, (d) => {
        d['group']['figures'][0]['svg'] = d['group']['figures'][0]['svg'].replace('<rect ', '<rect onclick="alert(1)" ');
      }),
    );
    const r = build(repo);
    const fig = r.prompts.find((p) => p.uid === 'ai.cp.0e1f2a')!['figures'] as Json[];
    expect(fig[0]!['svg']).toBeNull();
    expect(fig[0]!['description']).toMatch(/教室/);
    expect(r.warnings.some((w) => /ai\.cp\.0e1f2a@1 第 1 張圖的 SVG 不發布/.test(w))).toBe(true);
  });

  it('登記在 unpublish.jsonl 的版本不輸出', () => {
    const repo = tmpRepo(undefined, `${JSON.stringify({ path: 'data/bank/v1/translation/basic/ai.tr.0b1c2d@1.json', date: '2026-10-09', reason: '測試' })}\n`);
    const r = build(repo);
    expect(r.index.map((e) => e.uid)).toEqual(['ai.cp.0e1f2a']);
    expect(r.lists.translation['basic']).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['unpublished']);
  });

  it('draft 與 rejected 不輸出', () => {
    const repo = tmpRepo((dir) => {
      edit(dir, TR, (d) => (d['status'] = 'draft'));
      edit(dir, CP, (d) => (d['status'] = 'rejected'));
    });
    expect(build(repo).index).toEqual([]);
  });

  it('作文提示摘要：去掉「提示：」，最多 60 個字加「…」', () => {
    expect(promptExcerpt('提示：短短的提示。')).toBe('短短的提示。');
    expect(promptExcerpt(`提示：${'字'.repeat(70)}`)).toBe(`${'字'.repeat(60)}…`);
  });
});

describe('assertWritingBankOutputs（D8 第 4 道）', () => {
  const OFFICIAL = 'An entirely fictional official reference sentence for the final check.';
  const NOTES = '評分原則：這段完全虛構的評分原則文字只用在最後檢查的單元測試，長度超過三十個字元。';
  const exam: Json = {
    id: 'gsat-998',
    sections: [
      {
        id: 's1',
        type: 'translation',
        instructions: '說明。',
        groups: [{ id: 'g1', passage: null, figures: [], questions: [{ no: 1, label: '1', mode: 'translation', stem: '中文。', answer: OFFICIAL, scoring_notes: NOTES }] }],
      },
    ],
  };
  const corpus = officialCorpus([exam]);
  const base = () => {
    const r = buildWritingBank({ bankDir: FIXTURE_BANK, exams: [exam], unpublishFile: path.join(FIXTURE_ROOT, 'none.jsonl'), repoRoot: FIXTURE_ROOT });
    return new Map([...filesOf(r)].map(([k, v]) => [k, JSON.stringify(v)]));
  };

  it('範例輸出通過（含歷屆寫作檔的鍵檢查）', () => {
    const files = base();
    files.set('writing/translation.json', JSON.stringify({ version: 'x', count: 0, sets: [{ items: [{ no: 1, label: '1', stem: 's', points: 4, patterns: [] }] }] }));
    expect(() => assertWritingBankOutputs(files, corpus)).not.toThrow();
  });

  it('SVG <text> 裡有官方文字：選題就略過那一組（d8_overlap），最後檢查不會讓整個建置失敗', () => {
    const repo = tmpRepo((bankDir) =>
      edit(bankDir, CP, (d) => {
        d['group']['figures'][0]['svg'] = String(d['group']['figures'][0]['svg']).replace('</svg>', `<text x="1" y="1">${OFFICIAL}</text></svg>`);
      }),
    );
    const r = build(repo, [exam]);
    expect(r.skipped.map((x) => [path.basename(x.file), x.reason])).toEqual([['ai.cp.0e1f2a@1.json', 'd8_overlap']]);
    expect(r.prompts.map((p) => p.group_id)).toEqual(['ai.tr.0b1c2d@1']);
    const files = new Map([...filesOf(r)].map(([k, v]) => [k, JSON.stringify(v)]));
    expect(() => assertWritingBankOutputs(files, corpus)).not.toThrow();
  });

  const cases: Array<[string, (files: Map<string, string>) => void, RegExp]> = [
    [
      '寫作檔含 answer 鍵',
      (f) => f.set('writing/essay.json', JSON.stringify({ prompts: [{ label: '1', answer: 'x' }] })),
      /writing\/essay\.json 的 prompts\[0\]\.answer 是不能公開的欄位/,
    ],
    [
      'prompts 含 references（答案提前外流）',
      (f) => {
        const rel = writingBankPromptPath({ uid: 'ai.tr.0b1c2d', version: 1 });
        const d = JSON.parse(f.get(rel)!) as Json;
        d['items'][0]['references'] = ['x'];
        f.set(rel, JSON.stringify(d));
      },
      /作答前下載的檔案不能有 references/,
    ],
    [
      '8 漢字和官方評分原則相同',
      (f) => {
        const rel = writingBankAnswersPath({ uid: 'ai.cp.0e1f2a', version: 1 });
        const d = JSON.parse(f.get(rel)!) as Json;
        d['deductions_zh'] = '我寫的：這段完全虛構的評分原則文字';
        f.set(rel, JSON.stringify(d));
      },
      /han_run/,
    ],
    [
      'findLeaks 片段（官方答案整句）',
      (f) => {
        const rel = writingBankAnswersPath({ uid: 'ai.tr.0b1c2d', version: 1 });
        const d = JSON.parse(f.get(rel)!) as Json;
        d['items'][1]['explanation_zh'] = `抄來的：${OFFICIAL}`;
        f.set(rel, JSON.stringify(d));
      },
      /leak_fragment/,
    ],
    [
      '未清理的 svg',
      (f) => {
        const rel = writingBankPromptPath({ uid: 'ai.cp.0e1f2a', version: 1 });
        const d = JSON.parse(f.get(rel)!) as Json;
        d['figures'][0]['svg'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>';
        f.set(rel, JSON.stringify(d));
      },
      /第 1 張圖的 svg 不是清理後的格式/,
    ],
  ];
  for (const [name, change, message] of cases) {
    it(`建置失敗：${name}`, () => {
      const files = base();
      change(files);
      expect(() => assertWritingBankOutputs(files, corpus)).toThrow(WritingBankError);
      expect(() => assertWritingBankOutputs(files, corpus)).toThrow(message);
      try {
        assertWritingBankOutputs(files, corpus);
      } catch (err) {
        // 錯誤訊息不印官方文字。
        expect(String(err)).not.toContain(OFFICIAL);
        expect(String(err)).not.toContain('完全虛構的評分原則文字只用在');
      }
    });
  }
});

it('golden 目錄存在（元件測試與 Playwright 會用）', () => {
  expect(existsSync(path.join(GOLDEN, 'writing', 'bank', 'index.json'))).toBe(true);
});
