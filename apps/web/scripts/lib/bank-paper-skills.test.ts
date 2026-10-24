// @vitest-environment node
/**
 * scripts/lib/bank-paper-skills.mjs：加強卷的技能分布 bank/paper-skills.json（docs/design/weak-paper.md §6.2、§10.1）。
 *
 * 範例題庫：題庫練習的 tests/fixtures/bank 加上寫作題庫的 tests/fixtures/bank-writing（同 bank-mock-pool.test.ts）。
 * 預期輸出（golden）在 tests/fixtures/bank-mock-public/bank/paper-skills.json（資料契約的測試也拿它檢查前端型別）。
 * 改了輸出格式要更新 golden（在 apps/web 底下執行）：
 *   UPDATE_PAPER_SKILLS_GOLDEN=1 npx vitest run scripts/lib/bank-paper-skills.test.ts
 * 真實題庫的檢查在 weak-paper.data.test.ts（npm run test:data）。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillCodesOf, skillsOfQuestion } from '@gsat/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import { buildBankData } from './bank-data.mjs';
import { PAPER_SKILLS_PATH, buildPaperSkills, questionSkills, trapComposition } from './bank-paper-skills.mjs';
import { buildWritingBank } from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(WEB_DIR, 'tests', 'fixtures');
const GOLDEN = path.join(FIXTURES, 'bank-mock-public', PAPER_SKILLS_PATH);

type Json = Record<string, any>;

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function build() {
  const root = mkdtempSync(path.join(tmpdir(), 'gsat-paper-skills-'));
  tmpDirs.push(root);
  const bankDir = path.join(root, 'data', 'bank', 'v1');
  cpSync(path.join(FIXTURES, 'bank', 'v1'), bankDir, { recursive: true });
  cpSync(path.join(FIXTURES, 'bank-writing', 'v1'), bankDir, { recursive: true });
  cpSync(path.join(FIXTURES, 'bank', 'facts'), path.join(root, 'data', 'bank', 'facts'), { recursive: true });
  const unpublishFile = path.join(root, 'data', 'unpublish.jsonl');
  const unpublished = readUnpublish(unpublishFile, { repoRoot: root });
  const bank = buildBankData(bankDir, { unpublished, repoRoot: root });
  const writing = buildWritingBank({ bankDir, exams: [], unpublishFile, repoRoot: root });
  return { bank, writing, skills: buildPaperSkills({ version: 'fixture', practice: bank.groups, writing: writing.index }) };
}

describe('範例題庫的技能分布', () => {
  const { bank, writing, skills } = build();

  if (process.env['UPDATE_PAPER_SKILLS_GOLDEN'] === '1') {
    mkdirSync(path.dirname(GOLDEN), { recursive: true });
    writeFileSync(GOLDEN, `${JSON.stringify(skills, null, 2)}\n`);
  }

  it('和 golden 一致；每一組都有條目（題庫練習有 q、寫作題有 w）', () => {
    expect(skills).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')));
    expect(Object.keys(skills)).toEqual(['version', 'codeSections', 'groups']);
    for (const g of bank.groups) expect(skills.groups[`${g.uid}@${g.version}`]?.q, g.uid).toBeDefined();
    for (const w of writing.index) expect(skills.groups[`${w.uid}@${w.version}`]?.w, w.uid).toEqual(w.skills);
  });

  it('每一題的代碼和作答紀錄的 k 是同一個規則（skillsOfQuestion／skillCodesOf），連順序都相同', () => {
    let n = 0;
    for (const g of bank.groups as Json[]) {
      const items = g['annotations'].explanations.items as Record<string, Json>;
      for (const q of g['group'].questions as Json[]) {
        const fields = { tags: q['tags'], explanation: items[q['label']] ?? null };
        const expected = skillsOfQuestion(undefined, q['label'], fields);
        expect(expected).toEqual(skillCodesOf(fields));
        expect(skills.groups[`${g['uid']}@${g['version']}`]?.q?.[q['label']], `${g['uid']} ${q['label']}`).toEqual(expected);
        n += 1;
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('codeSections：每個原始代碼在各難度、各大題的題數（*:other 不輸出）', () => {
    const total = Object.values(skills.codeSections).reduce((s, byTier) => s + Object.values(byTier).reduce((t, bySection) => t + Object.values(bySection).reduce((u, n) => u + n, 0), 0), 0);
    const counted = Object.values(skills.groups).reduce((s, g) => s + Object.values(g.q ?? {}).reduce((t, codes) => t + codes.filter((c) => !c.endsWith(':other')).length, 0), 0);
    expect(total).toBe(counted);
    expect(Object.keys(skills.codeSections).some((c) => c.endsWith(':other'))).toBe(false);
  });

  it('閱讀與混合題多選的誘答組成：只算錯誤選項，每一題的合計等於有代碼的錯誤選項數', () => {
    const rd = bank.groups.find((g) => g.section_type === 'reading') as Json;
    const items = rd['annotations'].explanations.items as Record<string, Json>;
    const tr = skills.groups[`${rd['uid']}@${rd['version']}`]?.tr ?? {};
    expect(Object.keys(tr).length).toBeGreaterThan(0);
    for (const q of rd['group'].questions as Json[]) {
      const codes = (items[q['label']]?.['option_codes'] ?? {}) as Record<string, string>;
      const wrong = Object.keys(codes).filter((l) => l !== q['answer']).length;
      const sum = Object.values(tr[q['label']] ?? {}).reduce((s, n) => s + n, 0);
      expect(sum, q['label']).toBe(wrong);
    }
  });
});

describe('questionSkills／trapComposition', () => {
  it('題組檔有每一題的 skills（出版社題）就讀它，不看標註；沒有那一題是空陣列', () => {
    const file = {
      uid: 'pb.rd.0a0a0a',
      version: 1,
      section_type: 'reading',
      tier: 'basic',
      skills: { '1': ['it:inference', 'it:inference'], '2': [] },
      group: { questions: [{ no: 1, label: '1', tags: { item_type: 'detail' } }, { no: 2, label: '2' }, { no: 3, label: '3' }] },
      annotations: { explanations: { items: {} } },
    };
    expect(questionSkills(file, file.group.questions[0] as never)).toEqual(['it:inference']);
    expect(questionSkills(file, file.group.questions[1] as never)).toEqual([]);
    expect(questionSkills(file, file.group.questions[2] as never)).toEqual([]);
    const built = buildPaperSkills({ practice: [file], writing: [] });
    expect(built.groups['pb.rd.0a0a0a@1']?.q).toEqual({ '1': ['it:inference'], '2': [], '3': [] });
    // 前端讀到的也一樣（shared 的 skillsOfQuestion）。
    expect(skillsOfQuestion(file.skills, '1', { tags: { item_type: 'detail' } })).toEqual(['it:inference']);
  });

  it('正解的代碼不算；沒有 option_codes、或作答方式不是單選／多選時是 null', () => {
    expect(trapComposition({ mode: 'single_choice', answer: 'B' }, { option_codes: { A: 'DS', B: 'XX', C: 'DS', D: 'OP' } })).toEqual({ DS: 2, OP: 1 });
    expect(trapComposition({ mode: 'multi_select', answer: ['A', 'D'] }, { option_codes: { A: 'E1', B: 'PT', C: 'ST*', D: 'E2', E: 'NM', F: 'PT' } })).toEqual({ NM: 1, PT: 2, 'ST*': 1 });
    expect(trapComposition({ mode: 'single_choice', answer: 'B' }, { explanation_zh: 'x' })).toBeNull();
    expect(trapComposition({ mode: 'fill_in_blank', answer: 'x' }, { option_codes: { A: 'DS' } })).toBeNull();
    expect(trapComposition({ mode: 'single_choice', answer: 'A' }, { option_codes: { A: 'DS', B: 'bad code' } })).toBeNull();
  });
});
