/**
 * 技能代碼的別名表與題目來源契約（docs/design/weak-paper.md §5.2、§8.2、§8.3）。
 * 即時題庫的漂移檢查在 apps/web/scripts/lib/skill-aliases.data.test.ts（npm run test:data）。
 */
import { describe, expect, it } from 'vitest';
import { ASSIST_SKILL_LABELS, isAssistSkillCode, skillCodesOf, skillsOfQuestion, type AssistSkillCode } from './assist-codes';
import {
  AI_BANK_SOURCE,
  AI_BANK_SOURCE_ID,
  DEFAULT_SOURCE_REGISTRY,
  ITEM_GROUP_KEY_PATTERN,
  PRACTICE_ITEM_UID_PATTERN,
  isSourceUsable,
  namespaceOf,
  usablePaperSources,
  type ItemSourcePublic,
} from './item-source';
import { SKILL_ALIASES, canonicalSkill, canonicalSkills, deriveSkillAliases, isIgnoredSkill, primaryOf, skillAliasesOf } from './skill-aliases';

describe('SKILL_ALIASES', () => {
  it('別名與主代碼都在封閉清單裡；主代碼不是別的別名（不會連鎖）；主代碼的前綴優先序高於別名', () => {
    for (const [section, table] of Object.entries(SKILL_ALIASES)) {
      for (const [alias, primary] of Object.entries(table ?? {})) {
        expect(isAssistSkillCode(alias), alias).toBe(true);
        expect(isAssistSkillCode(primary), primary).toBe(true);
        expect(table?.[primary], `${section} ${primary}`).toBeUndefined();
        expect(primaryOf([alias, primary])).toBe(primary);
      }
    }
  });

  it('篇章結構 10 對 ct:X → cl:X、閱讀與混合題各一對、三種詞彙類大題的搭配詞', () => {
    expect(Object.keys(SKILL_ALIASES.structure ?? {})).toHaveLength(10);
    expect(canonicalSkill('structure', 'ct:pronoun_reference')).toBe('cl:pronoun_reference');
    expect(canonicalSkill('reading', 'ct:pronoun_reference')).toBe('it:reference');
    expect(canonicalSkill('mixed', 'ct:definition_restatement')).toBe('it:vocab_in_context');
    for (const s of ['vocabulary', 'cloze', 'word_bank']) expect(canonicalSkill(s, 'ct:collocation')).toBe('tp:collocation');
    // 別的大題不併：綜合測驗的 ct:contrast 和篇章結構的 cl:contrast 是不同的弱點。
    expect(canonicalSkill('cloze', 'ct:contrast')).toBe('ct:contrast');
    expect(skillAliasesOf('structure', 'cl:contrast')).toEqual(['cl:contrast', 'ct:contrast']);
  });

  it('同一個大題裡，表裡的主代碼沒有兩個中文標籤相同', () => {
    for (const [section, table] of Object.entries(SKILL_ALIASES)) {
      const primaries = [...new Set(Object.values(table ?? {}))];
      const labels = primaries.map((c) => ASSIST_SKILL_LABELS[c as AssistSkillCode]);
      expect(new Set(labels).size, section).toBe(labels.length);
    }
  });
});

describe('canonicalSkills', () => {
  it('換成主代碼、去重；*:other 與不在清單裡的代碼丟掉；依封閉清單的順序', () => {
    expect(canonicalSkills('structure', ['ct:pronoun_reference', 'cl:pronoun_reference', 'ct:other'])).toEqual(['cl:pronoun_reference']);
    expect(canonicalSkills('reading', ['ct:pronoun_reference', 'it:reference', 'it:inference'])).toEqual(['it:inference', 'it:reference']);
    expect(canonicalSkills('reading', ['ct:other', 'cl:other', 'gp:other', 'xx:nope'])).toEqual([]);
    expect(canonicalSkills('translation', ['ts:PERF', 'ts:PERF', 'tt:collocation'])).toEqual(['ts:PERF', 'tt:collocation']);
    expect(isIgnoredSkill('ct:other')).toBe(true);
    expect(isIgnoredSkill('it:inference')).toBe(false);
  });
});

describe('deriveSkillAliases', () => {
  it('中文標籤相同就併（兩個都出現過）；互相重疊 ≥ 80% 而且各 ≥ 10 題才併；不到 10 題不併', () => {
    const rows = [
      // 篇章結構：cl:contrast 與 ct:contrast 標籤相同（只出現一次也併）。
      { section: 'structure', codes: ['cl:contrast'] },
      { section: 'structure', codes: ['ct:contrast'] },
      // 閱讀：it:reference 與 ct:pronoun_reference 12 題全部重疊。
      ...Array.from({ length: 12 }, () => ({ section: 'reading', codes: ['it:reference', 'ct:pronoun_reference'] })),
      // 閱讀：it:detail 與 ct:situational 9 題重疊（不到 10 題，不併）。
      ...Array.from({ length: 9 }, () => ({ section: 'reading', codes: ['it:detail', 'ct:situational'] })),
      // 閱讀：it:inference 10 題、ct:cause_effect 13 題，交集 10 題（佔 ct 的 77%，不併）。
      ...Array.from({ length: 10 }, () => ({ section: 'reading', codes: ['it:inference', 'ct:cause_effect'] })),
      ...Array.from({ length: 3 }, () => ({ section: 'reading', codes: ['ct:cause_effect'] })),
      // *:other 不參加。
      { section: 'reading', codes: ['ct:other', 'cl:other'] },
    ];
    expect(deriveSkillAliases(rows)).toEqual({ reading: { 'ct:pronoun_reference': 'it:reference' }, structure: { 'ct:contrast': 'cl:contrast' } });
  });

  it('遞移：三個代碼互相連起來時併成一群，取優先序最高的當主代碼', () => {
    const rows = Array.from({ length: 10 }, () => ({ section: 'mixed', codes: ['ct:definition_restatement', 'it:vocab_in_context', 'sn:core'] }));
    expect(deriveSkillAliases(rows)).toEqual({ mixed: { 'ct:definition_restatement': 'it:vocab_in_context', 'sn:core': 'it:vocab_in_context' } });
  });
});

describe('skillsOfQuestion', () => {
  const fields = { tags: { item_type: 'inference' }, explanation: { clue_type: 'cause_effect' } };
  it('題組檔沒有 skills：同 skillCodesOf', () => {
    expect(skillsOfQuestion(undefined, '1', fields)).toEqual(skillCodesOf(fields));
    expect(skillsOfQuestion(null, '1', fields)).toEqual(['it:inference', 'ct:cause_effect']);
  });
  it('題組檔有 skills：讀那一題（原始題號）的代碼，過濾封閉清單、去重、排序；沒有那一題是空陣列', () => {
    const skills = { '2': ['ct:cause_effect', 'it:inference', 'it:inference', 'xx:bad'] };
    expect(skillsOfQuestion(skills, '2', fields)).toEqual(['it:inference', 'ct:cause_effect']);
    expect(skillsOfQuestion(skills, '1', fields)).toEqual([]);
  });
});

describe('item-source', () => {
  it('命名空間與 uid、題組代號的格式', () => {
    expect(namespaceOf('ai.rd.0a1b2c')).toBe('ai');
    expect(namespaceOf('pb.rd.0a1b2c')).toBe('pb');
    expect(namespaceOf('xx.rd.0a1b2c')).toBeNull();
    expect(PRACTICE_ITEM_UID_PATTERN.test('pb.mx.abcdef')).toBe(true);
    expect(PRACTICE_ITEM_UID_PATTERN.test('pb.tr.abcdef')).toBe(false);
    expect(ITEM_GROUP_KEY_PATTERN.exec('pb.rd.0a1b2c@3')?.slice(1)).toEqual(['pb.rd.0a1b2c', '3']);
    expect(ITEM_GROUP_KEY_PATTERN.test('ai.rd.0a1b2c@0')).toBe(false);
  });

  const pub: ItemSourcePublic = {
    id: 'pub-test',
    ns: 'pb',
    kind: 'publisher',
    label_zh: '測試出版',
    publisher_zh: '測試出版股份有限公司',
    product_zh: '模擬試題',
    attribution_zh: '本題出自測試出版《模擬試題》，經授權使用',
    scope: ['web', 'pdf', 'ai_assist'],
    active: true,
    retired_on: null,
    ends_on: '2027-12-31',
  };

  it('isSourceUsable：停用、過了到期日（到期日當天仍可用）、授權範圍不足都不能用', () => {
    expect(isSourceUsable(pub, '2027-12-31', ['web', 'pdf'])).toBe(true);
    expect(isSourceUsable(pub, '2028-01-01', ['web'])).toBe(false);
    expect(isSourceUsable({ ...pub, active: false }, '2026-10-23')).toBe(false);
    expect(isSourceUsable(pub, '2026-10-23', ['explanations'])).toBe(false);
    expect(isSourceUsable(AI_BANK_SOURCE, '2099-01-01', ['web', 'pdf', 'ai_assist', 'explanations'])).toBe(true);
  });

  it('usablePaperSources：只取請求裡有的、能放進卷子的（web＋pdf）來源；登記檔讀不到時本站題庫照常可用', () => {
    const registry = { version: 'v', sources: [AI_BANK_SOURCE, pub, { ...pub, id: 'pub-nopdf', scope: ['web' as const] }] };
    expect([...usablePaperSources(registry, [AI_BANK_SOURCE_ID, 'pub-test', 'pub-nopdf', 'unknown'], '2026-10-23')]).toEqual([AI_BANK_SOURCE_ID, 'pub-test']);
    expect([...usablePaperSources(registry, ['pub-test'], '2028-01-01')]).toEqual([]);
    expect([...usablePaperSources(null, [AI_BANK_SOURCE_ID, 'pub-test'], '2026-10-23')]).toEqual([AI_BANK_SOURCE_ID]);
    expect(DEFAULT_SOURCE_REGISTRY.sources).toEqual([AI_BANK_SOURCE]);
  });
});
