/**
 * 題庫練習的中文名稱、網址代號與難度說明。
 */
import { TIER_LABELS, TIERS, type BlankPos, type ClueType, type FillTransform, type SenseKind, type Tier } from '@gsat/shared';
import { PRACTICE_SECTION_TYPES, type PracticeSectionType } from '../../data/bank';

export { TIER_LABELS, TIERS };

export const PRACTICE_SECTION_LABELS: Record<PracticeSectionType, string> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
};

/** 題型的一句話說明（選單上用）。 */
export const PRACTICE_SECTION_HINTS: Record<PracticeSectionType, string> = {
  vocabulary: '單句一空格、四選一',
  cloze: '短文挖空、每空四選一',
  word_bank: '一篇短文、從選項庫選字詞填空',
  structure: '把句子放回文章的空格（有一句多餘）',
  reading: '一篇文章（長文、圖表、表格或多文本）、四題單選',
  mixed: '兩篇或多則短文：摘要填空、多選、簡答',
};

/** 網址代號：和 modules.ts 的題型頁一致（word_bank → word-bank）。 */
const SECTION_SLUGS: Record<PracticeSectionType, string> = {
  vocabulary: 'vocabulary',
  cloze: 'cloze',
  word_bank: 'word-bank',
  structure: 'structure',
  reading: 'reading',
  mixed: 'mixed',
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
/** 有參考資料（閱讀、混合題的事實單）時，選文下方改用這一句，並列出參考資料。 */
export const AI_REFERENCES_NOTICE = '本文由 AI 參考下列資料撰寫，非原文轉載；AI 撰寫的事實陳述可能有誤，請以參考資料為準';
/** 詞彙題沒有選文，題目下方改標這一句。 */
export const AI_ITEMS_NOTICE = '本組題目由 AI 撰寫；AI 撰寫的內容可能有誤';

/** 主題（group.tags.topic）只在含中文字時顯示：舊題組的主題是英文短語（給出題與檢查工具用的 slug），學生看不懂也不需要。 */
export function displayTopic(topic: string | null | undefined): string | null {
  if (!topic) return null;
  const t = topic.trim();
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(t) ? t : null;
}

/** 混合題填充的字形變化（README §3.3 的 transform；出題規格書 mixed.json transform_classes）。 */
export const TRANSFORM_LABELS: Record<FillTransform, string> = {
  none: '文中的字照抄即可，不必變化字形',
  inflection: '同一個字要做字形變化（加 -s、-ed、-ing 等）',
  pos_shift: '要轉換詞性（例如動詞改成名詞）',
  'pos_shift+inflection': '要先轉換詞性，再做字形變化',
};

/** 空格要的詞性 + 字形變化 → 一句說明，例如「要改成名詞」。 */
export function transformNote(transform: FillTransform | undefined, pos: BlankPos | undefined): string | null {
  if (!transform) return null;
  if ((transform === 'pos_shift' || transform === 'pos_shift+inflection') && pos && pos !== 'phrase' && pos !== 'clause' && pos !== 'sentence') {
    return transform === 'pos_shift' ? `要改成${BLANK_POS_LABELS[pos]}` : `要改成${BLANK_POS_LABELS[pos]}，再做字形變化`;
  }
  return TRANSFORM_LABELS[transform];
}

/** 閱讀單選的誘答類型（出題規格書 reading.json distractor_taxonomy）。 */
export const READING_OPTION_CODE_LABELS: Record<string, string> = {
  TI: '正確但答非所問',
  TN: '以偏概全',
  OP: '與原文相反',
  SP: '漏看題幹的否定',
  OG: '過度概括、說得太絕對',
  DS: '細節錯置（拼湊原文字詞）',
  NM: '文中沒有提到',
  LS: '只看字面意思',
  CX: '上下文看似說得通',
  SF: '形近字',
  NA: '指錯對象',
  VS: '圖表讀錯',
  MT: '文中有提到的選項',
  PL: '段落位置弄錯',
};

/** 混合題多選每個選項的判斷（出題規格書 MIX-MUL-01／02）。 */
export const MIXED_OPTION_CODE_LABELS: Record<string, string> = {
  E1: '文中明寫',
  E2: '要從文中推論',
  PT: '只符合其中一方',
  CT: '和文中明寫的內容矛盾',
  NM: '文中沒有提到',
  PL: '大意說得通，但細節不符',
  ST: '立場相反或中立',
  'ST*': '立場不符（條件句講的是別人）',
};
