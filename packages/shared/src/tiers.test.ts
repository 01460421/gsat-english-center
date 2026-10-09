/**
 * tiers.ts 的規格資料：數字錯了，生成提示與程式檢查會一起錯，所以把 SPEC §3.4、§3.5 的關係寫成測試。
 * 鏡像 data/specs/tiers.json 是否最新在 tiers.data.test.ts（npm run test:data）。
 */
import { describe, expect, it } from 'vitest';
import {
  AI_SECTION_TYPES,
  AI_SECTION_TYPES_WITH_CHECKS,
  BANK_UID_CODES,
  ITEM_RULES,
  PASSAGE_BANDS,
  PASSAGE_SECTION_TYPES,
  PASSAGE_WORDS,
  SECTION_FORMATS,
  TIERS,
  CURRENT_EXAM_MEDIAN_WORDS,
  inRange,
  type Range,
} from './tiers';

const ordered = (range: Range) => range.min === null || range.max === null || range.min <= range.max;

describe('PASSAGE_BANDS（SPEC §3.4）', () => {
  it('每個區間下限 ≤ 上限，比率都在 0–1', () => {
    for (const tier of TIERS) {
      const band = PASSAGE_BANDS[tier];
      for (const key of ['coverage_l1_4', 'coverage_l1_6', 'offlist_ratio'] as const) {
        const range = band[key];
        expect(ordered(range), `${tier}.${key}`).toBe(true);
        for (const v of [range.min, range.max]) if (v !== null) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
      }
      expect(ordered(band.avg_sentence_length), `${tier}.avg_sentence_length`).toBe(true);
    }
  });

  it('L1–6 覆蓋率下限 ≥ L1–4 下限；表外字上限不超過 1 − L1–6 下限', () => {
    for (const tier of TIERS) {
      const band = PASSAGE_BANDS[tier];
      expect(band.coverage_l1_6.min!).toBeGreaterThanOrEqual(band.coverage_l1_4.min!);
      expect(band.offlist_ratio.max!).toBeLessThanOrEqual(1 - band.coverage_l1_6.min! + 1e-9);
    }
  });

  it('越難覆蓋率下限越低、表外字上限越高（帶之間可以重疊，但方向不能反）', () => {
    const [b, a, t] = TIERS.map((tier) => PASSAGE_BANDS[tier]);
    expect(b!.coverage_l1_4.min!).toBeGreaterThan(a!.coverage_l1_4.min!);
    expect(a!.coverage_l1_4.min!).toBeGreaterThan(t!.coverage_l1_4.min!);
    expect(b!.offlist_ratio.max!).toBeLessThan(a!.offlist_ratio.max!);
    expect(a!.offlist_ratio.max!).toBeLessThan(t!.offlist_ratio.max!);
    expect(PASSAGE_BANDS.top.offlist_gloss).toBe('about_half');
  });

  it('115 學測全卷的校準點（L1–4 90.9%、L1–6 95.2%、表外 4.8%）落在進階練習帶內', () => {
    const band = PASSAGE_BANDS.advanced;
    expect(inRange(0.909, band.coverage_l1_4)).toBe(true);
    expect(inRange(0.952, band.coverage_l1_6)).toBe(true);
    expect(inRange(0.048, band.offlist_ratio)).toBe(true);
  });
});

describe('PASSAGE_WORDS（SPEC §3.4 字數帶）', () => {
  it('每種有選文的題型三個難度都有字數帶，且越難字數下限越高', () => {
    for (const type of PASSAGE_SECTION_TYPES) {
      const words = PASSAGE_WORDS[type];
      for (const tier of TIERS) expect(ordered(words[tier]), `${type}.${tier}`).toBe(true);
      expect(words.basic.min!).toBeLessThan(words.advanced.min!);
      expect(words.advanced.min!).toBeLessThanOrEqual(words.top.min!);
    }
  });

  it('現制學測字數中位數（進階練習的錨點）落在進階練習帶內', () => {
    for (const type of PASSAGE_SECTION_TYPES) {
      expect(inRange(CURRENT_EXAM_MEDIAN_WORDS[type], PASSAGE_WORDS[type].advanced), type).toBe(true);
    }
  });
});

describe('SECTION_FORMATS', () => {
  it('8 種題型都有格式與 uid 縮寫，縮寫不重複', () => {
    expect(AI_SECTION_TYPES).toHaveLength(8);
    for (const type of AI_SECTION_TYPES) expect(SECTION_FORMATS[type].format_version.startsWith(type)).toBe(true);
    const codes = Object.values(BANK_UID_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{2}$/);
  });

  it('有專屬檢查的題型的格式常數：詞彙 10×4、綜合 5×4、文意選填 10 空 10 選、篇章 4 空 5 選（多 1 句）、閱讀 4×4、混合 4 子題、中譯英 2 句、作文 1 題', () => {
    expect(AI_SECTION_TYPES_WITH_CHECKS).toEqual(['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition']);
    expect(SECTION_FORMATS.translation).toMatchObject({ questions: 2, options_per_question: null, bank_options: null, format_version: 'translation-2' });
    expect(SECTION_FORMATS.composition).toMatchObject({ questions: 1, options_per_question: null, bank_options: null, format_version: 'composition-1' });
    expect(SECTION_FORMATS.vocabulary).toMatchObject({ questions: 10, options_per_question: 4, bank_options: null, uses_blanks: false });
    expect(SECTION_FORMATS.cloze).toMatchObject({ questions: 5, options_per_question: 4, bank_options: null, uses_blanks: true });
    expect(SECTION_FORMATS.word_bank).toMatchObject({ questions: 10, bank_options: 10, extra_bank_options: 0, format_version: 'word_bank-10x10' });
    expect(SECTION_FORMATS.structure).toMatchObject({ questions: 4, bank_options: 5, extra_bank_options: 1, format_version: 'structure-4x5' });
    expect(SECTION_FORMATS.reading).toMatchObject({ questions: 4, options_per_question: 4, bank_options: null, format_version: 'reading-4' });
    expect(SECTION_FORMATS.mixed).toMatchObject({ questions: 4, options_per_question: null, bank_options: null, format_version: 'mixed-4' });
    for (const type of ['word_bank', 'structure'] as const) {
      const f = SECTION_FORMATS[type];
      expect(f.bank_options! - f.questions).toBe(f.extra_bank_options);
      expect(f.modes).toEqual(['bank_choice']);
    }
  });
});

describe('ITEM_RULES（SPEC §3.5）', () => {
  it('8 種題型 × 3 種難度都有規則與原文摘要', () => {
    for (const type of AI_SECTION_TYPES) {
      for (const tier of TIERS) expect(ITEM_RULES[type][tier].summary_zh.length, `${type}.${tier}`).toBeGreaterThan(5);
    }
  });

  it('詞彙題正解級別：穩定基礎 L2–4、進階 L3–5、超越頂標 L4–6，近義干擾數遞增', () => {
    const v = ITEM_RULES.vocabulary;
    expect([v.basic.answer_levels, v.advanced.answer_levels, v.top.answer_levels]).toEqual([
      { min: 2, max: 4 },
      { min: 3, max: 5 },
      { min: 4, max: 6 },
    ]);
    expect(v.basic.near_synonym_distractors_min).toBeLessThan(v.advanced.near_synonym_distractors_min);
    expect(v.advanced.near_synonym_distractors_min).toBeLessThan(v.top.near_synonym_distractors_min);
  });

  it('綜合測驗各類考點的格數區間都在 0–5 內', () => {
    for (const tier of TIERS) {
      const c = ITEM_RULES.cloze[tier];
      for (const range of [c.content_blanks, c.connective_blanks, c.grammar_blanks, c.phrase_collocation_blanks]) {
        if (range === null) continue;
        expect(ordered(range)).toBe(true);
        expect(range.min ?? 0).toBeGreaterThanOrEqual(0);
        expect(range.max ?? 5).toBeLessThanOrEqual(SECTION_FORMATS.cloze.questions);
      }
    }
  });

  it('文意選填：穩定基礎每格相容選項 ≤3、近義誘答對 0；超越頂標 ≥3、≥2 對且要有片語動詞', () => {
    const w = ITEM_RULES.word_bank;
    expect(w.basic.compatible_options_per_blank.max).toBe(3);
    expect(w.basic.near_synonym_pairs).toEqual({ min: 0, max: 0 });
    expect(w.top.compatible_options_per_blank.min).toBe(3);
    expect(w.top.near_synonym_pairs.min).toBe(2);
    expect(w.top.phrasal_verb_option_required).toBe(true);
  });

  it('篇章結構：多餘句設計三級不同；超越頂標 ≥2 格沒有字面線索', () => {
    const s = ITEM_RULES.structure;
    expect(new Set(TIERS.map((t) => s[t].extra_sentence)).size).toBe(3);
    expect(s.top.no_surface_cue_blanks.min).toBe(2);
    expect(s.basic.all_blanks_have_surface_cue).toBe(true);
  });
});

describe('inRange', () => {
  it('端點算在內；null 代表沒有限制', () => {
    expect(inRange(0.93, { min: 0.93, max: null })).toBe(true);
    expect(inRange(0.929, { min: 0.93, max: null })).toBe(false);
    expect(inRange(100, { min: null, max: null })).toBe(true);
  });
});
