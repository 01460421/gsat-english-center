/**
 * 學習助手的封閉代碼清單（docs/design/learning-assistant.md §2.3）：技能代碼、錯因代碼與中文標籤。
 *
 * 前端與 Worker 共用：系統提示裡的清單由這裡依固定順序產生（改了順序或內容就換 prompt_version），輸出後處理把不在清單裡的
 * 代碼丟掉，畫面上的中文標籤也查這裡。技能代碼一律由既有的封閉清單加前綴組成，不另外發明；
 * 前綴和 DB_SCHEMA 錯題卡 skill_key 的寫法一致（tp:、it:、gp:、cl:），之後同步到 D1 時可以直接用。
 *
 *   tp: TEST_POINTS（選擇題考點）            gp: GRAMMAR_POINTS（文法點）       it: ITEM_TYPES（閱讀題型）
 *   cl: STRUCTURE_CLUES（篇章結構的線索）     ct: CLUE_TYPES（題庫解析的線索）    sn: SENSE_KINDS（字義種類）
 *   ts: TRANSLATION_STRUCTURE_CODES（中譯英句構）tt: TRANSLATION_TRAP_TYPES（中譯英誘錯點）wc: MODEL_TEXT_CRITERIA（作文四項）
 *
 * 題庫的陷阱代碼（閱讀 READING_OPTION_CODES、混合題 MIXED_DISTRACTOR_CODES）不是技能代碼：只在題目附了本站解析時才能用，
 * 中文標籤沿用前端 practice/labels.ts。
 */
import {
  CLUE_TYPES,
  MIXED_DISTRACTOR_CODES,
  MODEL_TEXT_CRITERIA,
  READING_OPTION_CODES,
  SENSE_KINDS,
  TRANSLATION_STRUCTURE_CODES,
  TRANSLATION_TRAP_TYPES,
  type ClueType,
  type ModelTextCriterion,
  type SenseKind,
  type TranslationStructureCode,
  type TranslationTrapType,
} from './bank';
import { GRAMMAR_POINTS, ITEM_TYPES, STRUCTURE_CLUES, TEST_POINTS, TEST_POINT_LABELS, type GrammarPoint, type ItemType, type StructureClue } from './exam';

// ───────────────────────── 技能代碼 ─────────────────────────

/** 前綴 → 來源清單（順序就是系統提示與畫面列出的順序）。 */
export const ASSIST_SKILL_SOURCES = {
  tp: TEST_POINTS,
  gp: GRAMMAR_POINTS,
  it: ITEM_TYPES,
  cl: STRUCTURE_CLUES,
  ct: CLUE_TYPES,
  sn: SENSE_KINDS,
  ts: TRANSLATION_STRUCTURE_CODES,
  tt: TRANSLATION_TRAP_TYPES,
  wc: MODEL_TEXT_CRITERIA,
} as const;
export type AssistSkillPrefix = keyof typeof ASSIST_SKILL_SOURCES;
export const ASSIST_SKILL_PREFIXES = Object.keys(ASSIST_SKILL_SOURCES) as AssistSkillPrefix[];

/** 技能代碼：前綴＋來源清單的值，例如 tp:collocation、gp:participle、tt:tense_trigger。 */
export type AssistSkillCode = { [P in AssistSkillPrefix]: `${P}:${(typeof ASSIST_SKILL_SOURCES)[P][number]}` }[AssistSkillPrefix];

/** 全部技能代碼（依前綴、再依來源清單的順序；順序固定）。 */
export const ASSIST_SKILL_CODES: readonly AssistSkillCode[] = ASSIST_SKILL_PREFIXES.flatMap((prefix) =>
  (ASSIST_SKILL_SOURCES[prefix] as readonly string[]).map((value) => `${prefix}:${value}` as AssistSkillCode),
);

const SKILL_CODE_SET: ReadonlySet<string> = new Set(ASSIST_SKILL_CODES);

export function isAssistSkillCode(value: unknown): value is AssistSkillCode {
  return typeof value === 'string' && SKILL_CODE_SET.has(value);
}

const GRAMMAR_POINT_LABELS: Record<GrammarPoint, string> = {
  tense: '時態',
  passive: '被動語態',
  participle: '分詞',
  relative_clause: '關係子句',
  noun_clause: '名詞子句',
  adverb_clause: '副詞子句',
  conditional: '條件句',
  subjunctive: '假設語氣',
  inversion: '倒裝句',
  comparison: '比較句構',
  infinitive_gerund: '不定詞與動名詞',
  modal: '助動詞',
  agreement: '主詞與動詞一致',
  pronoun: '代名詞',
  determiner: '限定詞',
  article: '冠詞',
  preposition: '介系詞',
  conjunction: '連接詞',
  parallel_structure: '對等結構',
  with_construction: 'with 的獨立構句',
  causative: '使役動詞',
  emphasis: '強調句',
  existential: 'There 句型',
  substitution: '省略與替代',
  degree: '程度的句型（so…that、too…to）',
  other: '其他文法',
};

/** 同前端 exams/labels.ts 的 ITEM_TYPE_LABELS。 */
const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  main_idea: '主旨',
  detail: '細節',
  inference: '推論',
  vocab_in_context: '字義推測',
  reference: '指涉',
  purpose: '寫作目的',
  tone_attitude: '語氣態度',
  structure: '文章結構',
  chart_reading: '圖表判讀',
  sequencing: '順序',
  title: '標題',
  not_mentioned: '未提及／非事實',
  application: '應用',
  synthesis: '統整',
};

/** 同前端 exams/labels.ts 的 CLUE_LABELS。 */
const STRUCTURE_CLUE_LABELS: Record<StructureClue, string> = {
  pronoun_reference: '代名詞指涉',
  lexical_cohesion: '詞彙銜接',
  transition_word: '轉折詞',
  topic_sentence: '主題句',
  contrast: '對比',
  example: '舉例',
  elaboration: '補充說明',
  enumeration: '列舉',
  summary: '總結',
  chronology: '時間順序',
  other: '其他',
};

/** 同前端 practice/labels.ts 的 CLUE_TYPE_LABELS。 */
const CLUE_TYPE_LABELS: Record<ClueType, string> = {
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

const SENSE_LABELS: Record<SenseKind, string> = {
  core: '核心義',
  extended: '延伸義',
  conversion: '轉品',
  idiom: '慣用語',
};

/** 中譯英句構（出題規格書 writing.json 的 structure_codes 說明）。 */
const TRANSLATION_STRUCTURE_LABELS: Record<TranslationStructureCode, string> = {
  PERF: '完成式',
  PASS: '被動',
  COMP: '比較級／最高級',
  PART: '分詞',
  NFSUBJ: '動名詞／不定詞當主詞',
  ADVCL: '副詞子句',
  REL: '限定關係子句',
  NRREL: '非限定關係子句',
  PURP: '表目的的不定詞',
  VOC: '動詞＋受詞＋補語',
  PREPVING: '介系詞＋V-ing',
  PARA: '對等並列',
  CORR: '關聯連接詞',
  NCL: '名詞子句',
  PROG: '進行式',
  PASTPERF: '過去完成式',
  BASIC: '基本句構',
};

/** 中譯英誘錯點（同前端 writing/bank/labels.ts 的 TRAP_TYPE_LABELS）。 */
const TRANSLATION_TRAP_LABELS: Record<TranslationTrapType, string> = {
  tense_trigger: '時態線索',
  plural_countable: '單複數、可數名詞',
  collocation: '搭配詞',
  word_form: '詞性變化',
  subjectless: '中文省略主詞',
  prenominal_modifier: '名詞前的長修飾語',
  verbal_subject: '動作當主詞',
  abstract_nominal: '抽象名詞',
  redundancy: '贅字',
};

/** 作文四項（同 writing.ts 的 ESSAY_CRITERION_LABELS）。 */
const CRITERION_LABELS: Record<ModelTextCriterion, string> = {
  content: '內容',
  organization: '組織',
  grammar: '文法句構',
  vocabulary: '字彙拼字',
};

const LABELS_BY_PREFIX: { [P in AssistSkillPrefix]: Record<(typeof ASSIST_SKILL_SOURCES)[P][number], string> } = {
  tp: TEST_POINT_LABELS,
  gp: GRAMMAR_POINT_LABELS,
  it: ITEM_TYPE_LABELS,
  cl: STRUCTURE_CLUE_LABELS,
  ct: CLUE_TYPE_LABELS,
  sn: SENSE_LABELS,
  ts: TRANSLATION_STRUCTURE_LABELS,
  tt: TRANSLATION_TRAP_LABELS,
  wc: CRITERION_LABELS,
};

/** 每個技能代碼的中文標籤。 */
export const ASSIST_SKILL_LABELS = Object.fromEntries(
  ASSIST_SKILL_PREFIXES.flatMap((prefix) =>
    Object.entries(LABELS_BY_PREFIX[prefix] as Record<string, string>).map(([value, label]) => [`${prefix}:${value}`, label] as const),
  ),
) as Record<AssistSkillCode, string>;

/** 技能代碼的中文標籤；不認得的代碼回 null（畫面上不顯示，不把原始代碼給學生看）。 */
export function assistSkillLabel(code: string): string | null {
  return isAssistSkillCode(code) ? ASSIST_SKILL_LABELS[code] : null;
}

/** 題目標註與本站解析可以換成技能代碼的欄位（題庫索引的 skills、本機作答紀錄的 k 用同一支）。 */
export interface SkillSourceFields {
  tags?: { test_point?: string | null; grammar_point?: string | null; item_type?: string | null; clue?: string | null } | null;
  explanation?: { clue_type?: string | null; sense?: string | null } | null;
}

/**
 * 從題目的標註（test_point、grammar_point、item_type、clue）與本站解析（clue_type、sense）組出技能代碼；
 * 不在封閉清單裡的值略過，結果去重、依 ASSIST_SKILL_CODES 的順序排好。
 */
export function skillCodesOf(fields: SkillSourceFields): AssistSkillCode[] {
  const out = new Set<string>();
  const add = (prefix: AssistSkillPrefix, value: string | null | undefined) => {
    if (value) out.add(`${prefix}:${value}`);
  };
  add('tp', fields.tags?.test_point);
  add('gp', fields.tags?.grammar_point);
  add('it', fields.tags?.item_type);
  add('cl', fields.tags?.clue);
  add('ct', fields.explanation?.clue_type);
  add('sn', fields.explanation?.sense);
  return ASSIST_SKILL_CODES.filter((code) => out.has(code));
}

/**
 * 一題的技能代碼（docs/design/weak-paper.md §6.2、§9.4）：作答紀錄的 k、組卷用的 paper-skills.json 的 q、
 * 成績單「這次的弱點表現」的逐題清單都用這一支，選題依據和回流的紀錄才一定對得上。
 * 題組檔帶了每一題的 skills（出版社題在建置時算好，鍵是題組裡的原始題號）就讀它；沒有就從題目標註與本站解析算（skillCodesOf）。
 * 回傳的代碼都在封閉清單裡、去重、依 ASSIST_SKILL_CODES 的順序（未正規化；正規化見 skill-aliases.ts 的 canonicalSkills）。
 */
export function skillsOfQuestion(
  fileSkills: Readonly<Record<string, readonly string[]>> | null | undefined,
  label: string,
  fields: SkillSourceFields,
): AssistSkillCode[] {
  if (fileSkills) {
    const own = new Set((fileSkills[label] ?? []).filter(isAssistSkillCode));
    return ASSIST_SKILL_CODES.filter((code) => own.has(code));
  }
  return skillCodesOf(fields);
}

// ───────────────────────── 錯因代碼 ─────────────────────────

/** 錯因代碼（報告的「錯誤樣態」以它為單位；順序就是系統提示列出的順序）。 */
export const ASSIST_ERROR_CODES = [
  'word_meaning',
  'word_sense',
  'collocation',
  'word_form',
  'phrase',
  'grammar',
  'logic_relation',
  'clue_scope',
  'cohesion',
  'main_idea',
  'detail_match',
  'over_inference',
  'surface_lure',
  'question_misread',
  'elimination',
  'spelling',
  'answer_format',
  'sentence_structure',
  'omission',
  'content_organization',
  'careless',
  'time',
  'knowledge_gap',
] as const;
export type AssistErrorCode = (typeof ASSIST_ERROR_CODES)[number];

export function isAssistErrorCode(value: unknown): value is AssistErrorCode {
  return typeof value === 'string' && (ASSIST_ERROR_CODES as readonly string[]).includes(value);
}

export const ASSIST_ERROR_LABELS: Record<AssistErrorCode, string> = {
  word_meaning: '字義不熟',
  word_sense: '延伸義、轉品、慣用義沒認出',
  collocation: '搭配詞',
  word_form: '詞性或字形',
  phrase: '片語、慣用語',
  grammar: '文法結構',
  logic_relation: '轉折、因果、正負方向判斷錯',
  clue_scope: '只看本句，沒往前後文找線索',
  cohesion: '指涉、詞彙鏈、連接詞沒看出',
  main_idea: '主旨、目的、標題判斷錯',
  detail_match: '細節對不上',
  over_inference: '過度推論',
  surface_lure: '被字面相同或主題字吸走',
  question_misread: '看錯題目要求',
  elimination: '排除法沒用好、連鎖錯',
  spelling: '拼字',
  answer_format: '作答形式不合',
  sentence_structure: '中譯英句構',
  omission: '漏譯、多譯、離題',
  content_organization: '作文內容與組織',
  careless: '粗心',
  time: '時間不夠、用猜的',
  knowledge_gap: '缺背景知識或觀念',
};

/** SPEC 的通用錯因（DB_SCHEMA attempts.error_tag 的值）。 */
export const GENERAL_ERROR_TAGS = ['vocab', 'collocation', 'grammar', 'context', 'misread', 'careless', 'time'] as const;
export type GeneralErrorTag = (typeof GENERAL_ERROR_TAGS)[number];

/** 錯因代碼 → 通用錯因（之後同步到 D1 的錯題卡時用）。 */
export const ASSIST_ERROR_GENERAL: Record<AssistErrorCode, GeneralErrorTag> = {
  word_meaning: 'vocab',
  word_sense: 'vocab',
  collocation: 'collocation',
  word_form: 'grammar',
  phrase: 'vocab',
  grammar: 'grammar',
  logic_relation: 'context',
  clue_scope: 'context',
  cohesion: 'context',
  main_idea: 'context',
  detail_match: 'context',
  over_inference: 'context',
  surface_lure: 'context',
  question_misread: 'misread',
  elimination: 'context',
  spelling: 'vocab',
  answer_format: 'misread',
  sentence_structure: 'grammar',
  omission: 'context',
  content_organization: 'context',
  careless: 'careless',
  time: 'time',
  knowledge_gap: 'vocab',
};

// ───────────────────────── 題庫的陷阱代碼 ─────────────────────────

/** 本站解析用到的陷阱代碼（閱讀誘答碼＋混合題的誤選碼；兩邊都有的 NM、PL 只列一次）。 */
export const ASSIST_TRAP_CODES: readonly string[] = [...new Set<string>([...READING_OPTION_CODES, ...MIXED_DISTRACTOR_CODES])];

export function isAssistTrapCode(value: unknown): value is string {
  return typeof value === 'string' && ASSIST_TRAP_CODES.includes(value);
}
