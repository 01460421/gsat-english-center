// @vitest-environment node
/**
 * 技能代碼別名表的漂移檢查（docs/design/weak-paper.md §5.2、§10.1、R16；web 的 data 專案，`npm run test:data`）。
 *
 * 別名表 SKILL_ALIASES（packages/shared/src/skill-aliases.ts）是固定常數，不在每次建置時重算：弱點的鍵
 * （skill:{大題}:{主代碼}）才不會因為題庫增減而跳動。這裡用即時題庫（data/bank/v1 的已發布題組）逐題取技能代碼
 * （和作答紀錄的 k 同一支 skillsOfQuestion），以 deriveSkillAliases 依同一條規則（同一大題裡中文標籤相同，或互相重疊 ≥ 80%、
 * 兩邊各 ≥ 10 題）重算一次：出現新的同義對、或舊的一對不再成立時失敗，提醒更新別名表（改表不必改資料：作答紀錄存原始代碼）。
 * 題庫每天加題、下架，這裡的失敗只出現在題庫那條 CI，不擋程式的 PR。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_ALIASES, canonicalSkills, deriveSkillAliases, skillsOfQuestion, type SkillSourceFields } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { readUnpublish } from '../../../../packages/shared/scripts/bank-select.mjs';
import { buildBankData } from './bank-data.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(WEB_DIR, '..', '..');
const BANK_DIR = path.join(REPO_ROOT, 'data', 'bank', 'v1');
const UNPUBLISH_FILE = path.join(REPO_ROOT, 'data', 'unpublish.jsonl');

type Json = Record<string, unknown>;

describe('技能代碼的別名表（真實題庫）', () => {
  const unpublished = readUnpublish(UNPUBLISH_FILE, { repoRoot: REPO_ROOT });
  const bank = buildBankData(BANK_DIR, { unpublished, repoRoot: REPO_ROOT });
  const rows = bank.groups.flatMap((file) => {
    const f = file as Json;
    const questions = (f['group'] as { questions: Array<{ label: string; tags?: Json | null }> }).questions;
    const items = ((f['annotations'] as Json | undefined)?.['explanations'] as { items?: Record<string, Json> } | undefined)?.items ?? {};
    const skills = (f['skills'] as Record<string, string[]> | undefined) ?? null;
    return questions.map((q) => ({
      section: String(f['section_type']),
      codes: skillsOfQuestion(skills, q.label, { tags: (q.tags ?? null) as SkillSourceFields['tags'], explanation: (items[q.label] ?? null) as SkillSourceFields['explanation'] }),
    }));
  });

  it('用即時題庫重算的同義對和 SKILL_ALIASES 相同（不同時更新 packages/shared/src/skill-aliases.ts）', () => {
    expect(rows.length).toBeGreaterThan(1000);
    const derived = deriveSkillAliases(rows);
    const constant = Object.fromEntries(Object.entries(SKILL_ALIASES).map(([s, t]) => [s, { ...t }]));
    const counts = Object.entries(derived).map(([s, t]) => `${s} ${Object.keys(t).length} 對`).join('、');
    console.log(`別名表：${rows.length} 題重算出 ${counts}`);
    expect(derived).toEqual(constant);
  });

  it('正規化之後，同一大題沒有兩個代碼的出現題目互相重疊 ≥ 80%（兩邊各 ≥ 10 題）', () => {
    // 正規化後的代碼再算一次，應該沒有任何一對要併（別名表已經涵蓋）。
    const canonical = rows.map((r) => ({ section: r.section, codes: canonicalSkills(r.section, r.codes) }));
    expect(deriveSkillAliases(canonical)).toEqual({});
  });
});
