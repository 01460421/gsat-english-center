/**
 * bank.ts 的常數與小工具。對實際 data/bank/ 檔案的檢查由 tools/validate_bank.py 負責（CI 的 exams job）。
 */
import { describe, expect, it } from 'vitest';
import {
  BANK_FILENAME_PATTERN,
  BANK_SCHEMA_ID,
  BANK_UID_PATTERN,
  BANK_WRITING_GROUP_ID_PATTERN,
  bankFilePath,
  COMPOSITION_MOVE_CODES,
  CONNECTIVE_FUNCTIONS,
  isForbiddenFieldName,
  parseBankGroupId,
  MODEL_TEXT_CRITERIA,
  MODEL_TEXT_NOTE_KINDS,
  sectionTypeOfUid,
  TRANSLATION_STRUCTURE_CODES,
  type BankFile,
} from './bank';
import { AI_SECTION_TYPES, BANK_UID_CODES } from './tiers';

describe('uid 與檔名', () => {
  it('uid 是 ai.{縮寫}.{6 位小寫十六進位}', () => {
    expect(BANK_UID_PATTERN.test('ai.wb.7f3a9c')).toBe(true);
    for (const bad of ['ai.wb.7F3A9C', 'ai.wb.7f3a9', 'ai.vc.7f3a9c', 'gsat-115.s6g1', 'ai.wb.7f3a9c0']) {
      expect(BANK_UID_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('每種題型的縮寫都能由 uid 還原', () => {
    for (const type of AI_SECTION_TYPES) expect(sectionTypeOfUid(`ai.${BANK_UID_CODES[type]}.abc123`)).toBe(type);
    expect(sectionTypeOfUid('ai.zz.abc123')).toBeNull();
  });

  it('檔案路徑是 data/bank/v1/{section_type}/{tier}/{uid}@{version}.json', () => {
    const f = { section_type: 'word_bank', tier: 'advanced', uid: 'ai.wb.7f3a9c', version: 2 } as const satisfies Pick<
      BankFile,
      'section_type' | 'tier' | 'uid' | 'version'
    >;
    const path = bankFilePath(f);
    expect(path).toBe('data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@2.json');
    const m = BANK_FILENAME_PATTERN.exec(path.split('/').at(-1)!);
    expect(m?.[1]).toBe('ai.wb.7f3a9c');
    expect(m?.[2]).toBe('2');
    expect(BANK_FILENAME_PATTERN.test('ai.wb.7f3a9c@0.json')).toBe(false);
  });

  it('schema 是 gsat-bank/v1', () => {
    expect(BANK_SCHEMA_ID).toBe('gsat-bank/v1');
  });
});

describe('isForbiddenFieldName', () => {
  it('擋下「推理過程」類欄位名的各種寫法', () => {
    for (const k of ['reasoning', 'reasoning_zh', 'chain_of_thought', 'chainOfThought', 'step_by_step', 'step-by-step', 'thinking', 'Thinking']) {
      expect(isForbiddenFieldName(k), k).toBe(true);
    }
  });

  it('解析與證據欄位不受影響', () => {
    for (const k of ['explanation_zh', 'evidence', 'strategy_zh', 'hints', 'option_notes_zh', 'clue_type']) {
      expect(isForbiddenFieldName(k), k).toBe(false);
    }
  });
});

describe('中譯英、作文的常數（tools/validate_bank.py 用同一組值）', () => {
  it('句構代碼不含倒裝、假設、強調：這些只能放加分寫法', () => {
    expect(TRANSLATION_STRUCTURE_CODES).toContain('PERF');
    expect(TRANSLATION_STRUCTURE_CODES).toHaveLength(17);
    for (const banned of ['INV', 'SUBJUNCTIVE', 'CLEFT']) expect(TRANSLATION_STRUCTURE_CODES).not.toContain(banned);
  });

  it('作文四項指標與範文註解', () => {
    expect(MODEL_TEXT_CRITERIA).toEqual(['content', 'organization', 'grammar', 'vocabulary']);
    expect(MODEL_TEXT_NOTE_KINDS).toEqual(['connective', 'detail', 'experience', 'pattern', 'phrase']);
    expect(CONNECTIVE_FUNCTIONS).toEqual(['sequence', 'addition', 'cause_effect', 'contrast', 'example', 'conclusion']);
    expect(COMPOSITION_MOVE_CODES).toContain('personal_experience');
    expect(COMPOSITION_MOVE_CODES).toContain('propose');
  });
});

describe('本站仿真寫作題的題組 id', () => {
  it('ai.tr／ai.cp 的 {uid}@{version} 解析成 uid、版本與題型', () => {
    expect(parseBankGroupId('ai.tr.1b2c4e@1')).toEqual({ uid: 'ai.tr.1b2c4e', version: 1, section_type: 'translation' });
    expect(parseBankGroupId('ai.cp.1f94f0@12')).toEqual({ uid: 'ai.cp.1f94f0', version: 12, section_type: 'composition' });
  });

  it('歷屆題、選擇題型、格式不對的 id 都不是', () => {
    for (const bad of ['gsat-115.s7g1@1', 'ai.wb.7f3a9c@1', 'ai.tr.1b2c4e', 'ai.tr.1b2c4e@0', 'ai.tr.1B2C4E@1', 'ai.tr.1b2c4e@1#1', ' ai.tr.1b2c4e@1']) {
      expect(parseBankGroupId(bad), bad).toBeNull();
      expect(BANK_WRITING_GROUP_ID_PATTERN.test(bad), bad).toBe(false);
    }
  });
});
