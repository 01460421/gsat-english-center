/**
 * 三種練習難度的「規格資料」：SPEC §3.4（文章指標帶）與 §3.5（各題型的題目規則），外加 AI 題庫各題型的格式常數。
 *
 * 生成提示與程式檢查共用這一份：
 *   - 出題代理的提示詞、批次規格（data/bank/lots/*.json）從這裡取數字；
 *   - Python 檢查工具（tools/text_metrics.py、tools/validate_bank.py）讀的是同一份資料的 JSON 鏡像
 *     data/specs/tiers.json，由 `npm run gen:tiers` 從本檔產生；`npm run test:data` 會比對兩者一致，
 *     改了這裡忘了重新產生，CI 的 exams job 會失敗。
 *
 * 比率一律是 0–1 的小數（93% 寫 0.93）；區間用 {min, max}，沒有上限或下限就是 null。
 * 數字照 SPEC 原文，SPEC 改了要同步改這裡（並重新產生鏡像）。各題型更細的出題規格（考點配比、誘答設計）在
 * data/exams/generation-spec/*.json，批次規格會把那裡的 passage_overrides 疊在本檔的帶上（見 tools/make_lots.py）。
 */
import type { QuestionMode, SectionType } from './exam';

// ---------------------------------------------------------------------------
// 難度與題型
// ---------------------------------------------------------------------------

/** 三種練習難度（DB_SCHEMA 的 item_groups.tier）。 */
export const TIERS = ['basic', 'advanced', 'top'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  basic: '穩定基礎',
  advanced: '進階練習',
  top: '超越頂標',
};

/** 出題規格書（data/exams/generation-spec/*.json）的 tiers 鍵名 → 本站的難度代號（規格書的 tier_rule.band_ids）。 */
export const GENERATION_SPEC_TIER_KEYS: Record<'foundation' | 'advanced' | 'beyond_top', Tier> = {
  foundation: 'basic',
  advanced: 'advanced',
  beyond_top: 'top',
};

/**
 * AI 題庫的 8 種題型（gsat-bank/v1 的 section_type）。值沿用 gsat-exam 的 SectionType，
 * 所以作文是 composition（uid 縮寫 es）。
 */
export const AI_SECTION_TYPES = [
  'vocabulary',
  'cloze',
  'word_bank',
  'structure',
  'reading',
  'mixed',
  'translation',
  'composition',
] as const satisfies readonly SectionType[];
export type BankSectionType = (typeof AI_SECTION_TYPES)[number];

/** 第一批已有完整程式檢查的題型；其餘 4 種目前只跑共通檢查（tools/validate_bank.py 會印 warning）。 */
export const AI_SECTION_TYPES_WITH_CHECKS = ['vocabulary', 'cloze', 'word_bank', 'structure'] as const satisfies readonly BankSectionType[];

/** uid 的題型縮寫：ai.{縮寫}.{6 位小寫十六進位}。 */
export const BANK_UID_CODES: Record<BankSectionType, string> = {
  vocabulary: 'vo',
  cloze: 'cz',
  word_bank: 'wb',
  structure: 'st',
  reading: 'rd',
  mixed: 'mx',
  translation: 'tr',
  composition: 'cp',
};

/** 有選文、要量文章指標的題型（SPEC §3.4 的字數帶）。 */
export const PASSAGE_SECTION_TYPES = ['cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const satisfies readonly BankSectionType[];
export type PassageSectionType = (typeof PASSAGE_SECTION_TYPES)[number];

// ---------------------------------------------------------------------------
// 格式常數
// ---------------------------------------------------------------------------

/** 一組題目的固定格式。format_version 的寫法照 DB_SCHEMA（題型＋小題數＋選項庫大小）。 */
export interface SectionFormat {
  /** 例如 word_bank-10x10。 */
  format_version: string;
  /** 一組的小題數（混合題是小題 label 數，47A／47B 各算一個）。 */
  questions: number;
  /** 每個小題自己的選項數；用選項庫或非選擇題為 null。 */
  options_per_question: number | null;
  /** 題組共用選項庫的選項數；沒有選項庫為 null。 */
  bank_options: number | null;
  /** 選項庫裡「不是任何一格答案」的多餘選項數（篇章結構 1）。 */
  extra_bank_options: number;
  /** 小題的作答模式；混合題各小題不同，列出允許的模式。 */
  modes: readonly QuestionMode[];
  /** 選文是否以 [[題號]] 標出空格。 */
  uses_blanks: boolean;
  /** 是否有選文。 */
  has_passage: boolean;
}

export const SECTION_FORMATS: Record<BankSectionType, SectionFormat> = {
  vocabulary: {
    format_version: 'vocabulary-10',
    questions: 10,
    options_per_question: 4,
    bank_options: null,
    extra_bank_options: 0,
    modes: ['single_choice'],
    uses_blanks: false,
    has_passage: false,
  },
  cloze: {
    format_version: 'cloze-5',
    questions: 5,
    options_per_question: 4,
    bank_options: null,
    extra_bank_options: 0,
    modes: ['single_choice'],
    uses_blanks: true,
    has_passage: true,
  },
  word_bank: {
    format_version: 'word_bank-10x10',
    questions: 10,
    options_per_question: null,
    bank_options: 10,
    extra_bank_options: 0,
    modes: ['bank_choice'],
    uses_blanks: true,
    has_passage: true,
  },
  structure: {
    format_version: 'structure-4x5',
    questions: 4,
    options_per_question: null,
    bank_options: 5,
    extra_bank_options: 1,
    modes: ['bank_choice'],
    uses_blanks: true,
    has_passage: true,
  },
  reading: {
    format_version: 'reading-4',
    questions: 4,
    options_per_question: 4,
    bank_options: null,
    extra_bank_options: 0,
    modes: ['single_choice'],
    uses_blanks: false,
    has_passage: true,
  },
  mixed: {
    format_version: 'mixed-4',
    questions: 4,
    options_per_question: null,
    bank_options: null,
    extra_bank_options: 0,
    modes: ['fill_in_blank', 'multi_select', 'short_answer', 'table_completion'],
    uses_blanks: false,
    has_passage: true,
  },
  translation: {
    format_version: 'translation-2',
    questions: 2,
    options_per_question: null,
    bank_options: null,
    extra_bank_options: 0,
    modes: ['translation'],
    uses_blanks: false,
    has_passage: false,
  },
  composition: {
    format_version: 'composition-1',
    questions: 1,
    options_per_question: null,
    bank_options: null,
    extra_bank_options: 0,
    modes: ['composition'],
    uses_blanks: false,
    has_passage: false,
  },
};

// ---------------------------------------------------------------------------
// SPEC §3.4 第一層：文章指標
// ---------------------------------------------------------------------------

/** 閉區間；沒有下限（上限）就是 null。 */
export interface Range {
  min: number | null;
  max: number | null;
}

/** 表外字要不要附註：all＝全部附註；about_half＝約一半不附註（練習用上下文推測）。 */
export type OfflistGloss = 'all' | 'about_half';

export interface PassageBand {
  /** 選文 L1–4 token 覆蓋率。 */
  coverage_l1_4: Range;
  /** 選文 L1–6 token 覆蓋率（＝在詞彙表內的比例）。 */
  coverage_l1_6: Range;
  /** 表外字比例。 */
  offlist_ratio: Range;
  offlist_gloss: OfflistGloss;
  /** 平均句長（字）。 */
  avg_sentence_length: Range;
}

/** SPEC §3.4 的表（帶與帶之間刻意重疊：落在目標難度的帶內就合格）。 */
export const PASSAGE_BANDS: Record<Tier, PassageBand> = {
  basic: {
    coverage_l1_4: { min: 0.93, max: null },
    coverage_l1_6: { min: 0.97, max: null },
    offlist_ratio: { min: null, max: 0.03 },
    offlist_gloss: 'all',
    avg_sentence_length: { min: null, max: 17 },
  },
  advanced: {
    coverage_l1_4: { min: 0.89, max: 0.93 },
    coverage_l1_6: { min: 0.95, max: null },
    offlist_ratio: { min: null, max: 0.05 },
    offlist_gloss: 'all',
    avg_sentence_length: { min: 15, max: 21 },
  },
  top: {
    coverage_l1_4: { min: 0.86, max: 0.91 },
    coverage_l1_6: { min: 0.92, max: null },
    offlist_ratio: { min: null, max: 0.07 },
    offlist_gloss: 'about_half',
    avg_sentence_length: { min: 18, max: 25 },
  },
};

/** SPEC §3.4 的每篇字數帶（混合題是多文本合計）。 */
export const PASSAGE_WORDS: Record<PassageSectionType, Record<Tier, Range>> = {
  cloze: { basic: { min: 140, max: 180 }, advanced: { min: 180, max: 215 }, top: { min: 200, max: 240 } },
  word_bank: { basic: { min: 220, max: 260 }, advanced: { min: 270, max: 310 }, top: { min: 290, max: 340 } },
  structure: { basic: { min: 210, max: 250 }, advanced: { min: 250, max: 300 }, top: { min: 280, max: 330 } },
  reading: { basic: { min: 250, max: 300 }, advanced: { min: 310, max: 360 }, top: { min: 340, max: 420 } },
  mixed: { basic: { min: 290, max: 340 }, advanced: { min: 360, max: 410 }, top: { min: 380, max: 450 } },
};

/** 「進階練習」帶的錨點：現制學測各大題字數中位數（docs/analysis/exam-stats.md）。 */
export const CURRENT_EXAM_MEDIAN_WORDS: Record<PassageSectionType, number> = {
  cloze: 196,
  word_bank: 293,
  structure: 278,
  reading: 337,
  mixed: 394,
};

// ---------------------------------------------------------------------------
// SPEC §3.5 第二層：題目規則
// ---------------------------------------------------------------------------

/** 每條規則都附 SPEC 原文摘要，給生成提示直接引用；結構化欄位給程式檢查用。 */
interface RuleBase {
  summary_zh: string;
}

/** 線索範圍：同一子句／可跨子句（因果、對比）／要讀懂整句。 */
export type ClueScope = 'same_clause' | 'cross_clause' | 'whole_sentence';

export interface VocabularyRule extends RuleBase {
  /** 正解級別（詞彙表 L1–6）。 */
  answer_levels: { min: number; max: number };
  /** L6 正解占比上限；沒有限制為 null。 */
  level6_share_max: number | null;
  /** 詞義題占比下限。 */
  word_meaning_share_min: number | null;
  /** 搭配詞題的目標占比（約略值）。 */
  collocation_share_target: number | null;
  /** 常用字延伸義、轉品題占比下限（超越頂標的另一條路：正解不在 L4–6 也可以）。 */
  extended_or_conversion_share_min: number | null;
  /** 每題至少幾個與正解語意相近的干擾選項。 */
  near_synonym_distractors_min: number;
  clue_scope: ClueScope;
}

/** 綜合測驗 5 格裡各類考點的格數範圍。 */
export interface ClozeRule extends RuleBase {
  /** 實詞（詞義）；穩定基礎是「實詞與搭配合計」。 */
  content_blanks: Range;
  /** 片語、搭配；穩定基礎併在 content_blanks，這裡是 null。 */
  phrase_collocation_blanks: Range | null;
  connective_blanks: Range;
  grammar_blanks: Range;
  /** 至少幾格要看前後句（線索不在本句）。 */
  cross_sentence_blanks_min: number;
  /** 至少幾格要看篇章（線索距離 ≥2 句）。 */
  discourse_blanks_min: number;
  /** 正解級別上限；沒有限制為 null。 */
  answer_level_max: number | null;
}

export interface WordBankRule extends RuleBase {
  /** 10 個選項至少分成幾個詞性組。 */
  pos_groups_min: number | null;
  /** 每格「詞性相容的選項數」範圍。 */
  compatible_options_per_blank: Range;
  /** 同詞性近義誘答對數。 */
  near_synonym_pairs: Range;
  /** 選項庫的詞性配比（進階練習）；沒有規定為 null。 */
  bank_pos_mix: { noun: Range; adjective: Range; verb: Range; phrase: Range } | null;
  /** 詞彙聯結（同一指涉換說法）的格數。 */
  lexical_link_blanks: Range;
  /** 選項是否必須含片語動詞。 */
  phrasal_verb_option_required: boolean;
}

/** 多餘句的設計：主題明顯偏離／主題相關、只差銜接／看起來能放進 ≥2 格。 */
export type ExtraSentenceDesign = 'off_topic' | 'related_cohesion_only' | 'fits_two_slots';

export interface StructureRule extends RuleBase {
  /** 4 格是否都要有明顯的代名詞或轉折詞線索。 */
  all_blanks_have_surface_cue: boolean;
  /** 主題句或總結句的格數。 */
  topic_or_summary_blanks: Range;
  /** 沒有明顯字面線索、要靠段落推理的格數。 */
  no_surface_cue_blanks: Range;
  extra_sentence: ExtraSentenceDesign;
}

export interface ReadingRule extends RuleBase {
  /** 各題目類型的題數（4 題一組）。鍵是 exam.ts 的 ItemType 或下列合併類別。 */
  item_types: Record<string, Range>;
  /** 至少幾題要整合兩句以上。 */
  multi_sentence_items_min: number;
  /** 至少幾題要整合全文或跨文本。 */
  whole_text_items_min: number;
  /** 是否所有依據都在單一句子。 */
  evidence_single_sentence: boolean;
}

export interface MixedRule extends RuleBase {
  /** 多選題選項數。 */
  multi_select_options: Range;
  /** 摘要填空：要變字形的格數（共 2 格）。 */
  fill_blanks_inflected: Range;
  /** 摘要填空是否要求轉詞性（名詞化、形容詞化）。 */
  fill_requires_pos_change: boolean;
  /** 簡答答案字數。 */
  short_answer_words: Range;
  /** 簡答是否要保留題幹指定的形態。 */
  short_answer_keeps_form: boolean;
}

export interface TranslationRule extends RuleBase {
  /** 一句幾個核心句構。 */
  structures_per_sentence: Range;
  /** 標的詞彙級別上限。 */
  target_word_level_max: number;
  /** 可含幾個比上限高一級的字（進階練習可含 1 個 L5）。 */
  above_level_words_max: number;
  /** 參考譯文字數。 */
  reference_words: Range;
  /** 指定句型（超越頂標）；沒有指定為空陣列。 */
  patterns: readonly string[];
}

export interface CompositionRule extends RuleBase {
  /** 題目形式。 */
  prompt_kinds: readonly ('picture' | 'chart' | 'multi_picture' | 'experience' | 'opinion' | 'proposal')[];
  /** 是否提供構思圖與句型開頭。 */
  scaffold: boolean;
  /** 課綱代碼（ASCII 寫法）。 */
  curriculum: readonly string[];
}

export interface ItemRulesBySection {
  vocabulary: VocabularyRule;
  cloze: ClozeRule;
  word_bank: WordBankRule;
  structure: StructureRule;
  reading: ReadingRule;
  mixed: MixedRule;
  translation: TranslationRule;
  composition: CompositionRule;
}

const r = (min: number | null, max: number | null): Range => ({ min, max });

/** SPEC §3.5 的表，逐格轉成資料。summary_zh 是原文（略去出處括號）。 */
export const ITEM_RULES: { [S in BankSectionType]: Record<Tier, ItemRulesBySection[S]> } = {
  vocabulary: {
    basic: {
      summary_zh: '正解 L2–4；詞義題 ≥70%；干擾選項同詞性、語意明顯不同；線索在同一子句',
      answer_levels: { min: 2, max: 4 },
      level6_share_max: null,
      word_meaning_share_min: 0.7,
      collocation_share_target: null,
      extended_or_conversion_share_min: null,
      near_synonym_distractors_min: 0,
      clue_scope: 'same_clause',
    },
    advanced: {
      summary_zh: '正解 L3–5；搭配詞題約 35%；至少 1 個干擾和正解語意相近；線索可跨子句（因果、對比）',
      answer_levels: { min: 3, max: 5 },
      level6_share_max: null,
      word_meaning_share_min: null,
      collocation_share_target: 0.35,
      extended_or_conversion_share_min: null,
      near_synonym_distractors_min: 1,
      clue_scope: 'cross_clause',
    },
    top: {
      summary_zh: '正解 L4–6（L6 ≤20%），或常用字的延伸義、轉品 ≥30%；≥2 個近義干擾；要讀懂整句才能判斷',
      answer_levels: { min: 4, max: 6 },
      level6_share_max: 0.2,
      word_meaning_share_min: null,
      collocation_share_target: null,
      extended_or_conversion_share_min: 0.3,
      near_synonym_distractors_min: 2,
      clue_scope: 'whole_sentence',
    },
  },
  cloze: {
    basic: {
      summary_zh: '實詞與搭配 ≥3、文法 ≤1 且句內可判斷、轉折 ≤1；正解 L1–4',
      content_blanks: r(3, 5),
      phrase_collocation_blanks: null,
      connective_blanks: r(0, 1),
      grammar_blanks: r(0, 1),
      cross_sentence_blanks_min: 0,
      discourse_blanks_min: 0,
      answer_level_max: 4,
    },
    advanced: {
      summary_zh: '實詞 1–3、片語搭配 1–3、轉承 0–1、文法 0–1；≥1 格要看前後句',
      content_blanks: r(1, 3),
      phrase_collocation_blanks: r(1, 3),
      connective_blanks: r(0, 1),
      grammar_blanks: r(0, 1),
      cross_sentence_blanks_min: 1,
      discourse_blanks_min: 0,
      answer_level_max: null,
    },
    top: {
      summary_zh: '≥2 格要看篇章（線索距離 ≥2 句）；文法題要讀懂上下文才判斷得出（had yet to、could have p.p.）；搭配詞干擾',
      content_blanks: r(0, 5),
      phrase_collocation_blanks: r(0, 5),
      connective_blanks: r(0, 5),
      grammar_blanks: r(0, 5),
      cross_sentence_blanks_min: 2,
      discourse_blanks_min: 2,
      answer_level_max: null,
    },
  },
  word_bank: {
    basic: {
      summary_zh: '選項詞性至少分 3 組；每格「詞性相容的選項」≤3；同詞性近義誘答對 0',
      pos_groups_min: 3,
      compatible_options_per_blank: r(null, 3),
      near_synonym_pairs: r(0, 0),
      bank_pos_mix: null,
      lexical_link_blanks: r(0, null),
      phrasal_verb_option_required: false,
    },
    advanced: {
      summary_zh: '名詞約 3、形容詞約 3、動詞 2–3、片語 0–2；同詞性近義誘答對 1–2；1 格詞彙聯結（同一指涉換說法）',
      pos_groups_min: null,
      compatible_options_per_blank: r(null, null),
      near_synonym_pairs: r(1, 2),
      bank_pos_mix: { noun: r(2, 4), adjective: r(2, 4), verb: r(2, 3), phrase: r(0, 2) },
      lexical_link_blanks: r(1, 1),
      phrasal_verb_option_required: false,
    },
    top: {
      summary_zh: '同詞性近義誘答對 ≥2；含片語動詞選項；每格詞性相容選項 ≥3；1 格詞彙聯結',
      pos_groups_min: null,
      compatible_options_per_blank: r(3, null),
      near_synonym_pairs: r(2, null),
      bank_pos_mix: null,
      lexical_link_blanks: r(1, 1),
      phrasal_verb_option_required: true,
    },
  },
  structure: {
    basic: {
      summary_zh: '4 格都有明顯的代名詞或轉折詞線索；多餘句主題明顯偏離',
      all_blanks_have_surface_cue: true,
      topic_or_summary_blanks: r(0, null),
      no_surface_cue_blanks: r(0, 0),
      extra_sentence: 'off_topic',
    },
    advanced: {
      summary_zh: '1 格是主題句或總結句；多餘句主題相關，只差銜接',
      all_blanks_have_surface_cue: false,
      topic_or_summary_blanks: r(1, 1),
      no_surface_cue_blanks: r(0, null),
      extra_sentence: 'related_cohesion_only',
    },
    top: {
      summary_zh: '≥2 格沒有明顯字面線索，要靠段落推理；多餘句看起來能放進 ≥2 格',
      all_blanks_have_surface_cue: false,
      topic_or_summary_blanks: r(0, null),
      no_surface_cue_blanks: r(2, null),
      extra_sentence: 'fits_two_slots',
    },
  },
  reading: {
    basic: {
      summary_zh: '細節 ≥2、主旨 1、上下文詞義或指代 1；依據都在單一句子',
      item_types: { detail: r(2, null), main_idea: r(1, 1), vocab_in_context_or_reference: r(1, 1) },
      multi_sentence_items_min: 0,
      whole_text_items_min: 0,
      evidence_single_sentence: true,
    },
    advanced: {
      summary_zh: '加入指代、推論各 1；≥1 題要整合兩句以上',
      item_types: { reference: r(1, null), inference: r(1, null) },
      multi_sentence_items_min: 1,
      whole_text_items_min: 0,
      evidence_single_sentence: false,
    },
    top: {
      summary_zh: '推論、目的或態度、事實與意見、圖表整合合計 ≥2；≥1 題要整合全文或跨文本',
      item_types: { inference_purpose_attitude_fact_chart: r(2, null) },
      multi_sentence_items_min: 1,
      whole_text_items_min: 1,
      evidence_single_sentence: false,
    },
  },
  mixed: {
    basic: {
      summary_zh: '多選 6 選項；填空 1 格要變字形、1 格原形；簡答 1 個字',
      multi_select_options: r(6, 6),
      fill_blanks_inflected: r(1, 1),
      fill_requires_pos_change: false,
      short_answer_words: r(1, 1),
      short_answer_keeps_form: false,
    },
    advanced: {
      summary_zh: '多選 6–8 選項；2 格填空都要變字形；簡答 2–3 字片語',
      multi_select_options: r(6, 8),
      fill_blanks_inflected: r(2, 2),
      fill_requires_pos_change: false,
      short_answer_words: r(2, 3),
      short_answer_keeps_form: false,
    },
    top: {
      summary_zh: '多選 8–10 選項；填空要轉詞性（名詞化、形容詞化）；簡答要保留題幹指定的形態（例如動名詞片語）',
      multi_select_options: r(8, 10),
      fill_blanks_inflected: r(2, 2),
      fill_requires_pos_change: true,
      short_answer_words: r(2, null),
      short_answer_keeps_form: true,
    },
  },
  translation: {
    basic: {
      summary_zh: '07 §5.3 前八名句型、一句一個核心句構、標的詞彙 L1–4，參考譯文 10–18 字',
      structures_per_sentence: r(1, 1),
      target_word_level_max: 4,
      above_level_words_max: 0,
      reference_words: r(10, 18),
      patterns: [],
    },
    advanced: {
      summary_zh: '一句兩個句構，可含 1 個 L5 字，14–24 字',
      structures_per_sentence: r(2, 2),
      target_word_level_max: 4,
      above_level_words_max: 1,
      reference_words: r(14, 24),
      patterns: [],
    },
    top: {
      summary_zh: '非限定關係子句、句尾分詞表結果、no matter＋wh-、what 子句；20–30 字；倒裝與假設只放「加分寫法」提示，不設為唯一正解',
      structures_per_sentence: r(2, null),
      target_word_level_max: 6,
      above_level_words_max: 0,
      reference_words: r(20, 30),
      patterns: ['non-restrictive relative clause', 'sentence-final participle (result)', 'no matter + wh-', 'what-clause'],
    },
  },
  composition: {
    basic: {
      summary_zh: '圖片描述＋個人經驗，校園生活情境；提供構思圖與句型開頭',
      prompt_kinds: ['picture', 'experience'],
      scaffold: true,
      curriculum: [],
    },
    advanced: {
      summary_zh: '圖片＋看法、原因或影響（學測主流），不提供句型開頭',
      prompt_kinds: ['picture', 'opinion'],
      scaffold: false,
      curriculum: [],
    },
    top: {
      summary_zh: '圖表或多圖比較＋評估、提出方案（9-Ⅴ-7、9-Ⅴ-8）',
      prompt_kinds: ['chart', 'multi_picture', 'proposal'],
      scaffold: false,
      curriculum: ['9-V-7', '9-V-8'],
    },
  },
};

/** 給 Python 工具的鏡像（data/specs/tiers.json）內容；scripts/dump-tiers.ts 與 tiers.data.test.ts 共用。 */
export function tiersSpecSnapshot() {
  return {
    schema: 'gsat-tiers/v1',
    source: 'packages/shared/src/tiers.ts（SPEC §3.4、§3.5）；由 npm run gen:tiers 產生，不要手改',
    tiers: TIERS,
    tier_labels: TIER_LABELS,
    generation_spec_tier_keys: GENERATION_SPEC_TIER_KEYS,
    bank_section_types: AI_SECTION_TYPES,
    bank_section_types_with_checks: AI_SECTION_TYPES_WITH_CHECKS,
    bank_uid_codes: BANK_UID_CODES,
    section_formats: SECTION_FORMATS,
    passage_bands: PASSAGE_BANDS,
    passage_words: PASSAGE_WORDS,
    current_exam_median_words: CURRENT_EXAM_MEDIAN_WORDS,
    item_rules: ITEM_RULES,
  };
}

/** 數值是否落在區間內（端點算在內）。 */
export function inRange(value: number, range: Range): boolean {
  return (range.min === null || value >= range.min) && (range.max === null || value <= range.max);
}
