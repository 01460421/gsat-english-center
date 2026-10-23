// @vitest-environment node
/**
 * 題庫索引的技能代碼（docs/design/learning-assistant.md §5.6；web 的 data 專案，`npm run test:data`）：
 * 從真實的 data/bank/v1 建 bank/index.json 與 writing/bank/index.json 的內容（不依賴先跑過 build:data），檢查每個 skills
 * 都在 shared 的封閉清單裡（建置腳本是 .mjs，不能直接匯入 TS 的清單，所以由這裡把關），而且和 skillCodesOf 逐題取聯集相同。
 * 題庫每天加題、下架，這裡的失敗只出現在題庫那條 CI，不擋程式的 PR。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAssistSkillCode, skillCodesOf } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { readExams, readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import { buildBankData } from './bank-data.mjs';
import { buildWritingBank } from './writing-bank.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');
const BANK_DIR = path.join(REPO_ROOT, 'data', 'bank', 'v1');
const UNPUBLISH_FILE = path.join(REPO_ROOT, 'data', 'unpublish.jsonl');

type Json = Record<string, unknown>;

describe('題庫索引的 skills（真實題庫）', () => {
  const unpublished = readUnpublish(UNPUBLISH_FILE, { repoRoot: REPO_ROOT });
  const bank = buildBankData(BANK_DIR, { unpublished, repoRoot: REPO_ROOT });

  it('每個代碼都在封閉清單裡；和 skillCodesOf 逐題取聯集相同；大部分題組至少有一個', () => {
    expect(bank.entries.length).toBeGreaterThan(0);
    let withSkills = 0;
    for (const entry of bank.entries) {
      for (const code of entry.skills) expect(isAssistSkillCode(code), `${entry.uid}: ${code}`).toBe(true);
      const file = bank.groups.find((g) => g.uid === entry.uid) as Json;
      const questions = (file.group as { questions: Array<{ label: string; tags?: Json | null }> }).questions;
      const items = (file.annotations as { explanations: { items: Record<string, Json> } }).explanations.items;
      const expected = new Set(questions.flatMap((q) => skillCodesOf({ tags: q.tags as never, explanation: (items[q.label] ?? null) as never })));
      expect(entry.skills, entry.uid).toEqual([...expected].sort());
      if (entry.skills.length > 0) withSkills += 1;
    }
    console.log(`題庫索引：${bank.entries.length} 組，${withSkills} 組有技能代碼；skills 共 ${JSON.stringify(bank.entries.map((e) => e.skills)).length} 字元`);
    expect(withSkills / bank.entries.length).toBeGreaterThan(0.9);
  });

  it('寫作題庫：中譯英的 ts:、tt: 都在封閉清單裡；作文是空陣列', () => {
    const { exams } = readExams(path.join(REPO_ROOT, 'data', 'exams', 'parsed'));
    const writing = buildWritingBank({ bankDir: BANK_DIR, exams, unpublishFile: UNPUBLISH_FILE, repoRoot: REPO_ROOT });
    expect(writing.index.length).toBeGreaterThan(0);
    for (const entry of writing.index) {
      for (const code of entry.skills) expect(isAssistSkillCode(code), `${entry.uid}: ${code}`).toBe(true);
      if (entry.section_type === 'composition') expect(entry.skills, entry.uid).toEqual([]);
      else expect(entry.skills.every((c) => c.startsWith('ts:') || c.startsWith('tt:')), entry.uid).toBe(true);
    }
  });
});
