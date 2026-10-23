/**
 * 學習助手的代碼清單（assist-codes.ts；docs/design/learning-assistant.md §2.3、§6.1）：技能代碼由既有的封閉清單組成、
 * 沒有重複（含 tt:）；每個代碼都有中文標籤；錯因到通用錯因的對照完整。
 */
import { describe, expect, it } from 'vitest';
import {
  ASSIST_ERROR_CODES,
  ASSIST_ERROR_GENERAL,
  ASSIST_ERROR_LABELS,
  ASSIST_SKILL_CODES,
  ASSIST_SKILL_LABELS,
  ASSIST_SKILL_PREFIXES,
  ASSIST_TRAP_CODES,
  GENERAL_ERROR_TAGS,
  assistSkillLabel,
  isAssistErrorCode,
  isAssistSkillCode,
  isAssistTrapCode,
  skillCodesOf,
} from './assist-codes';
import { CLUE_TYPES, MIXED_DISTRACTOR_CODES, MODEL_TEXT_CRITERIA, READING_OPTION_CODES, SENSE_KINDS, TRANSLATION_STRUCTURE_CODES, TRANSLATION_TRAP_TYPES } from './bank';
import { GRAMMAR_POINTS, ITEM_TYPES, STRUCTURE_CLUES, TEST_POINTS } from './exam';

describe('技能代碼', () => {
  it('前綴的順序固定（系統提示與畫面依這個順序列出）', () => {
    expect(ASSIST_SKILL_PREFIXES).toEqual(['tp', 'gp', 'it', 'cl', 'ct', 'sn', 'ts', 'tt', 'wc']);
  });

  it('由既有的封閉清單組成：每個前綴的代碼數＝來源清單的長度，順序相同', () => {
    const sources: Array<[string, readonly string[]]> = [
      ['tp', TEST_POINTS],
      ['gp', GRAMMAR_POINTS],
      ['it', ITEM_TYPES],
      ['cl', STRUCTURE_CLUES],
      ['ct', CLUE_TYPES],
      ['sn', SENSE_KINDS],
      ['ts', TRANSLATION_STRUCTURE_CODES],
      ['tt', TRANSLATION_TRAP_TYPES],
      ['wc', MODEL_TEXT_CRITERIA],
    ];
    expect(ASSIST_SKILL_CODES).toEqual(sources.flatMap(([prefix, list]) => list.map((v) => `${prefix}:${v}`)));
    expect(GRAMMAR_POINTS).toHaveLength(26);
    expect(TRANSLATION_STRUCTURE_CODES).toHaveLength(17);
    expect(TRANSLATION_TRAP_TYPES).toHaveLength(9);
    expect(ASSIST_SKILL_CODES).toContain('tt:tense_trigger');
    expect(ASSIST_SKILL_CODES).toContain('ts:PERF');
    expect(ASSIST_SKILL_CODES).toContain('wc:organization');
  });

  it('沒有重複（同一個值在不同前綴是不同的代碼，例如 cl:contrast 與 ct:contrast）', () => {
    expect(new Set(ASSIST_SKILL_CODES).size).toBe(ASSIST_SKILL_CODES.length);
    expect(ASSIST_SKILL_CODES).toContain('cl:contrast');
    expect(ASSIST_SKILL_CODES).toContain('ct:contrast');
  });

  it('每個代碼都有中文標籤；標籤不含「大考中心」或 CEEC', () => {
    expect(Object.keys(ASSIST_SKILL_LABELS).sort()).toEqual([...ASSIST_SKILL_CODES].sort());
    for (const code of ASSIST_SKILL_CODES) {
      const label = ASSIST_SKILL_LABELS[code];
      expect(label, code).toMatch(/\S/);
      expect(label).not.toMatch(/大考中心|CEEC/);
    }
    expect(assistSkillLabel('gp:participle')).toBe('分詞');
    expect(assistSkillLabel('tt:tense_trigger')).toBe('時態線索');
    expect(assistSkillLabel('xx:unknown')).toBeNull();
  });

  it('守衛只認清單裡的代碼', () => {
    expect(isAssistSkillCode('tp:collocation')).toBe(true);
    expect(isAssistSkillCode('tp:nonsense')).toBe(false);
    expect(isAssistSkillCode('collocation')).toBe(false);
    expect(isAssistSkillCode(42)).toBe(false);
  });

  it('skillCodesOf：題目標註與本站解析換成技能代碼；不在清單的值略過；去重、依清單順序', () => {
    expect(
      skillCodesOf({
        tags: { test_point: 'collocation', grammar_point: null, item_type: 'inference', clue: 'contrast' },
        explanation: { clue_type: 'contrast', sense: 'extended' },
      }),
    ).toEqual(['tp:collocation', 'it:inference', 'cl:contrast', 'ct:contrast', 'sn:extended']);
    expect(skillCodesOf({ tags: { test_point: 'made_up' } })).toEqual([]);
    expect(skillCodesOf({})).toEqual([]);
  });
});

describe('錯因代碼', () => {
  it('23 個、沒有重複；每個都有中文標籤與通用錯因', () => {
    expect(ASSIST_ERROR_CODES).toHaveLength(23);
    expect(new Set(ASSIST_ERROR_CODES).size).toBe(ASSIST_ERROR_CODES.length);
    expect(Object.keys(ASSIST_ERROR_LABELS).sort()).toEqual([...ASSIST_ERROR_CODES].sort());
    expect(Object.keys(ASSIST_ERROR_GENERAL).sort()).toEqual([...ASSIST_ERROR_CODES].sort());
    for (const code of ASSIST_ERROR_CODES) {
      expect(GENERAL_ERROR_TAGS, code).toContain(ASSIST_ERROR_GENERAL[code]);
      expect(ASSIST_ERROR_LABELS[code]).not.toMatch(/大考中心|CEEC/);
    }
  });

  it('對照表的幾個例子（設計文件 §2.3）', () => {
    expect(ASSIST_ERROR_GENERAL.over_inference).toBe('context');
    expect(ASSIST_ERROR_GENERAL.question_misread).toBe('misread');
    expect(ASSIST_ERROR_GENERAL.word_form).toBe('grammar');
    expect(ASSIST_ERROR_GENERAL.time).toBe('time');
    expect(ASSIST_ERROR_LABELS.over_inference).toBe('過度推論');
  });

  it('通用錯因＝DB_SCHEMA attempts.error_tag 的七個值', () => {
    expect([...GENERAL_ERROR_TAGS].sort()).toEqual(['careless', 'collocation', 'context', 'grammar', 'misread', 'time', 'vocab']);
  });

  it('守衛', () => {
    expect(isAssistErrorCode('elimination')).toBe(true);
    expect(isAssistErrorCode('tp:collocation')).toBe(false);
  });
});

describe('題庫的陷阱代碼', () => {
  it('閱讀誘答碼＋混合題的誤選碼，重複的只列一次', () => {
    expect(new Set(ASSIST_TRAP_CODES)).toEqual(new Set([...READING_OPTION_CODES, ...MIXED_DISTRACTOR_CODES]));
    expect(new Set(ASSIST_TRAP_CODES).size).toBe(ASSIST_TRAP_CODES.length);
    expect(isAssistTrapCode('NM')).toBe(true);
    expect(isAssistTrapCode('ST*')).toBe(true);
    expect(isAssistTrapCode('E1')).toBe(false);
  });
});
