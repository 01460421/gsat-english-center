/**
 * 題庫練習的中文名稱、網址代號與難度說明。
 */
import { TIER_LABELS, TIERS, type BlankPos, type ClueType, type SenseKind, type Tier } from '@gsat/shared';
import { PRACTICE_SECTION_TYPES, type PracticeSectionType } from '../../data/bank';

export { TIER_LABELS, TIERS };

export const PRACTICE_SECTION_LABELS: Record<PracticeSectionType, string> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
};

/** 題型的一句話說明（選單上用）。 */
export const PRACTICE_SECTION_HINTS: Record<PracticeSectionType, string> = {
  vocabulary: '單句一空格、四選一',
  cloze: '短文挖空、每空四選一',
  word_bank: '一篇短文、從選項庫選字詞填空',
  structure: '把句子放回文章的空格（有一句多餘）',
};

/** 網址代號：和 modules.ts 的題型頁一致（word_bank → word-bank）。 */
const SECTION_SLUGS: Record<PracticeSectionType, string> = {
  vocabulary: 'vocabulary',
  cloze: 'cloze',
  word_bank: 'word-bank',
  structure: 'structure',
};

export function sectionSlug(section: PracticeSectionType): string {
  return SECTION_SLUGS[section];
}

export function sectionFromSlug(slug: string | undefined): PracticeSectionType | null {
  return PRACTICE_SECTION_TYPES.find((s) => SECTION_SLUGS[s] === slug) ?? null;
}

export function tierFromParam(value: string | undefined): Tier | null {
  return (TIERS as readonly string[]).includes(value ?? '') ? (value as Tier) : null;
}

export function practicePath(section: PracticeSectionType, tier: Tier): string {
  return `/practice/${sectionSlug(section)}/${tier}`;
}

/** SPEC §3.1：每個難度給誰、這一級的題目有多難。級分是本站依五年平均換算的非官方對照。 */
export const TIER_AUDIENCE: Record<Tier, { who: string; level: string }> = {
  basic: { who: '均標（8 級分）到前標（11 級分）的學生', level: '前標程度的學生有七成以上把握答對' },
  advanced: { who: '前標到頂標（13 級分）的學生', level: '前標到頂標之間的學生大約七成答對' },
  top: { who: '頂標到 15 級分的學生', level: '要到頂標以上才有七成把握' },
};

export const BLANK_POS_LABELS: Record<BlankPos, string> = {
  noun: '名詞',
  verb: '動詞',
  adjective: '形容詞',
  adverb: '副詞',
  preposition: '介系詞',
  conjunction: '連接詞',
  pronoun: '代名詞',
  phrase: '片語',
  clause: '子句',
  sentence: '句子',
};

export const CLUE_TYPE_LABELS: Record<ClueType, string> = {
  collocation: '搭配詞',
  definition_restatement: '換句話說',
  contrast: '對比',
  cause_effect: '因果',
  grammar_frame: '文法結構',
  connective_logic: '連接詞邏輯',
  lexical_link: '詞彙呼應',
  situational: '情境',
  pronoun_reference: '代名詞指涉',
  lexical_cohesion: '詞彙銜接',
  transition_word: '轉折詞',
  topic_sentence: '主題句',
  example: '舉例',
  elaboration: '補充說明',
  enumeration: '列舉',
  summary: '總結',
  chronology: '時間順序',
  other: '其他',
};

export const SENSE_LABELS: Record<SenseKind, string> = {
  core: '核心義',
  extended: '延伸義',
  conversion: '轉品',
  idiom: '慣用語',
};

/** 每組都要標的 AI 標示（SPEC §8.4「所有 AI 產生的內容旁標示」）。 */
export const AI_GROUP_LABEL = 'AI 出題・已通過自動驗證・人工審核中';
/** 選文下方的聲明。 */
export const AI_PASSAGE_NOTICE = '本文由 AI 撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤';
/** 詞彙題沒有選文，題目下方改標這一句。 */
export const AI_ITEMS_NOTICE = '本組題目由 AI 撰寫；AI 撰寫的內容可能有誤';
