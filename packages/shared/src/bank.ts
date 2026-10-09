/**
 * AI 題庫檔案（gsat-bank/v1）的 TypeScript 型別。
 *
 * 規格來源是 docs/DB_SCHEMA.md §5.3 與 SPEC §5；檔案說明、工具用法與盲解／稽核結果的 JSON 格式在 data/bank/README.md。
 * 一個檔案一個題組版本：data/bank/v1/{section_type}/{tier}/{uid}@{version}.json。
 * `group` 就是 gsat-exam/v1.1 的題組（exam.ts 的 QuestionGroup），所以讀取、計分、畫面元件和歷屆題完全共用；
 * AI 題的題號一律從 1 開始，空格 [[1]]…[[n]]。
 *
 * 檢查工具是 tools/validate_bank.py（CI 唯一入口）；文章指標由 tools/text_metrics.py 寫入 metrics，
 * 驗證紀錄由 tools/record_verification.py 寫入 verification。
 * 閱讀、混合題另外用到：圖表題 figure 的 chart 物件（ChartSpec）、事實單 data/bank/facts/{id}.json（FactSheet）、
 * 來源白名單 data/bank/sources-whitelist.json（SourcesWhitelist），格式說明在 data/bank/README.md §3.2–3.4、§8。
 * 中譯英、作文用 annotations.rubric（TranslationRubric／CompositionRubric）與 annotations.model_texts（ModelText），
 * 作文看圖題的 figure 可以帶 svg；盲譯、盲評的紀錄是 BlindTranslationVerification／BlindGradingVerification（README §3.5–3.7、§5.5–5.6）。
 * 欄位名稱刻意不出現 reasoning、chain_of_thought、step_by_step、thinking 這類「推理過程」字眼（SPEC §5.5），
 * 檢查工具會擋。
 */
import type { Figure, OptionLetter, QuestionGroup } from './exam';
import type { BankSectionType, Tier } from './tiers';
import { BANK_UID_CODES } from './tiers';

export const BANK_SCHEMA_ID = 'gsat-bank/v1';
export type BankSchemaId = typeof BANK_SCHEMA_ID;

/** uid：ai.{題型縮寫}.{6 位小寫十六進位}，例如 ai.wb.7f3a9c。改版不換 uid。 */
export const BANK_UID_PATTERN = /^ai\.(vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6}$/;
export type BankUid = `ai.${string}.${string}`;

/** 檔名（不含目錄）：{uid}@{version}.json。 */
export const BANK_FILENAME_PATTERN = /^(ai\.(?:vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;

/** 檔案在 repo 內的相對路徑。 */
export function bankFilePath(f: Pick<BankFile, 'section_type' | 'tier' | 'uid' | 'version'>): string {
  return `data/bank/v1/${f.section_type}/${f.tier}/${f.uid}@${f.version}.json`;
}

/** uid 縮寫 → 題型。 */
export function sectionTypeOfUid(uid: string): BankSectionType | null {
  const m = BANK_UID_PATTERN.exec(uid);
  if (!m) return null;
  const code = m[1];
  const found = (Object.entries(BANK_UID_CODES) as [BankSectionType, string][]).find(([, c]) => c === code);
  return found ? found[0] : null;
}

/** pool：practice＝練習池；checkpoint＝檢核卷專用（不進練習、不公開，答案不送前端）。 */
export const BANK_POOLS = ['practice', 'checkpoint'] as const;
export type BankPool = (typeof BANK_POOLS)[number];

/**
 * 檔案狀態。verified → 匯入成 needs_review（等人工審核）；rejected 的檔案也保留，記錄淘汰原因（status_reason）。
 * draft 是還沒走完驗證的中間狀態，不能 merge（validate_bank.py 在 CI 對 draft 報 warning）。
 */
export const BANK_STATUSES = ['draft', 'verified', 'rejected'] as const;
export type BankStatus = (typeof BANK_STATUSES)[number];

// ---------------------------------------------------------------------------
// annotations（各 kind 匯入後各自成為 annotations 的一列，status=needs_review）
// ---------------------------------------------------------------------------

/** 空格／正解在句中的詞性位置（同 exam.ts 的 AnswerPos，另加 sentence 給篇章結構）。 */
export const BLANK_POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
  'phrase',
  'clause',
  'sentence',
] as const;
export type BlankPos = (typeof BLANK_POS)[number];

/**
 * 解題線索類型（解析卡的徽章、生成規格的 clue_type_mix）。
 * 詞彙／綜合／文意選填用前 8 個；篇章結構另可用 exam.ts 的 StructureClue。
 */
export const CLUE_TYPES = [
  'collocation',
  'definition_restatement',
  'contrast',
  'cause_effect',
  'grammar_frame',
  'connective_logic',
  'lexical_link',
  'situational',
  'pronoun_reference',
  'lexical_cohesion',
  'transition_word',
  'topic_sentence',
  'example',
  'elaboration',
  'enumeration',
  'summary',
  'chronology',
  'other',
] as const;
export type ClueType = (typeof CLUE_TYPES)[number];

/** 正解用的字義：核心義／延伸義／轉品／慣用語（生成規格的 sense_mix；詞彙題超越頂標的「延伸義、轉品」靠它判斷）。 */
export const SENSE_KINDS = ['core', 'extended', 'conversion', 'idiom'] as const;
export type SenseKind = (typeof SENSE_KINDS)[number];

/** 混合題填充的字形變化（出題規格書 mixed.json format.fill_in_blank.transform_classes）。 */
export const FILL_TRANSFORMS = ['none', 'inflection', 'pos_shift', 'pos_shift+inflection'] as const;
export type FillTransform = (typeof FILL_TRANSFORMS)[number];

/** 閱讀誘答碼（出題規格書 reading.json distractor_taxonomy.codes）。 */
export const READING_OPTION_CODES = ['TI', 'TN', 'OP', 'SP', 'OG', 'DS', 'NM', 'LS', 'CX', 'SF', 'NA', 'VS', 'MT', 'PL'] as const;
export type ReadingOptionCode = (typeof READING_OPTION_CODES)[number];

/** 混合題多選：正解標 E1（文中明寫）／E2（要推論），誤選標 PT／CT／NM／PL／ST／ST*（出題規格書 MIX-MUL-01／02）。 */
export const MIXED_KEY_CODES = ['E1', 'E2'] as const;
export const MIXED_DISTRACTOR_CODES = ['PT', 'CT', 'NM', 'PL', 'ST', 'ST*'] as const;
export type MixedOptionCode = (typeof MIXED_KEY_CODES)[number] | (typeof MIXED_DISTRACTOR_CODES)[number];

/** 一個小題的解析（四段式解析卡＋提示階梯）。鍵是題號字串。 */
export interface ExplanationItem {
  /** 正解依據（中文）。 */
  explanation_zh: string;
  /** 逐字證據句：必須能在選文（詞彙題是題幹）逐字找到。 */
  evidence: string[];
  /** 空格需要的詞性。 */
  blank_pos?: BlankPos;
  clue_type?: ClueType;
  /** 正解用的字義（詞彙題必填，其他選填）。 */
  sense?: SenseKind;
  /** 每個錯誤選項為什麼錯（鍵是選項代號）。 */
  option_notes_zh?: Partial<Record<OptionLetter, string>>;
  /** 可遷移的解題策略。 */
  strategy_zh?: string;
  /** 提示階梯（由淺到深，最多 3 層）。 */
  hints?: string[];
  // 以下只用在閱讀、混合題（validate_bank.py 對其他題型仍報「未知欄位」），各自限定作答模式：
  /** 混合題填充：答案在文中的來源字（逐字出現在選文）。 */
  source_token?: string;
  /** 混合題填充：從 source_token 到答案的字形變化。 */
  transform?: FillTransform;
  /** 混合題填充、簡答：選字對但字形錯、給 1 分的寫法（SPEC §4.6）；不可和 accepted_answers 重疊。 */
  partial_credit_forms?: string[];
  /** 混合題填充：可以和哪一格對調（題號）；不能對調是 null。 */
  interchangeable_with?: number | null;
  /** 閱讀單選：錯誤選項的誘答碼（ReadingOptionCode）；混合題多選：每個選項的碼（MixedOptionCode）。 */
  option_codes?: Partial<Record<OptionLetter, string>>;
  /** 閱讀單選、混合題多選：每個選項的逐字證據句（多選正解要對每個需要符合的對象各附一句）。 */
  option_evidence?: Partial<Record<OptionLetter, string[]>>;
}

export interface ExplanationsAnnotation {
  items: Record<string, ExplanationItem>;
}

export interface TranslationZhAnnotation {
  text: string;
}

/**
 * 排除法矩陣（文意選填、篇章結構）：兩位盲解者「每格可行選項集合」的聯集，由 tools/record_verification.py 寫入。
 * perfect_matchings 是「每格放一個不同選項」的可行填法數，必須剛好 1（SPEC §5.6）。
 */
export interface EliminationAnnotation {
  feasible: Record<string, OptionLetter[]>;
  perfect_matchings: number;
}

/** 閱讀生字推測（閱讀、混合題用；先留位置）。 */
export interface GuessTarget {
  word: string;
  options: string[];
  answer: number;
  clue_type: string;
}

/** 思考表達開放題（SPEC §6.6.1；先留位置）。 */
export interface OpenTask {
  kind: 'main_idea' | 'evaluate' | 'compare_table';
  prompt: string;
  reference_answers: string[];
  checklist_zh: string[];
  curriculum?: string[];
}

// ---------------------------------------------------------------------------
// 中譯英、作文（README §3.5–3.7、§5.5–5.6；SPEC §3.5、§5.4、§5.7、§6.8、§6.9；出題規格書 data/exams/generation-spec/writing.json）
// 名稱刻意避開 writing.ts（AI 批改，origin/main）已有的 TRANSLATION_*／ESSAY_* 常數，合併後兩邊可以同時 export。
// ---------------------------------------------------------------------------

/** 中譯英的核心句構代碼（出題規格書 WRT-TRN-STR-01）。倒裝、假設、強調句不在這裡：只能放加分寫法（bonus）。 */
export const TRANSLATION_STRUCTURE_CODES = [
  'PERF',
  'PASS',
  'COMP',
  'PART',
  'NFSUBJ',
  'ADVCL',
  'REL',
  'NRREL',
  'PURP',
  'VOC',
  'PREPVING',
  'PARA',
  'CORR',
  'NCL',
  'PROG',
  'PASTPERF',
  'BASIC',
] as const;
export type TranslationStructureCode = (typeof TRANSLATION_STRUCTURE_CODES)[number];

/** 誘錯點類型（照字面直譯就會被扣分的地方；出題規格書 WRT-TRN-TRP-01）。 */
export const TRANSLATION_TRAP_TYPES = [
  'tense_trigger',
  'plural_countable',
  'collocation',
  'word_form',
  'subjectless',
  'prenominal_modifier',
  'verbal_subject',
  'abstract_nominal',
  'redundancy',
] as const;
export type TranslationTrapType = (typeof TRANSLATION_TRAP_TYPES)[number];

/** 標的詞彙：每個參考譯文都要含（詞形變化可；換字的寫法列在 alternatives 也算命中）。級別由程式查詞彙表。 */
export interface TranslationTargetWord {
  /** 單字或片語（可含 sb／sth／one's 佔位），例如 "reduce"、"take part in"。 */
  word: string;
  /** 中文意思。 */
  zh: string;
  alternatives?: string[];
}

/** 標的句型：每個參考譯文都要用到（程式比對得到的句構會比對）。 */
export interface TranslationPattern {
  code: TranslationStructureCode;
  /** data/curriculum/grammar-patterns.json 的 patterns[].id，例如 gp-present-perfect。 */
  grammar_id: string;
  label_zh: string;
  /** 句型框架（鷹架第 3 層），例如 "S + have/has + p.p."。 */
  frame: string;
  /** 中文題目裡引出這個句型的字串（逐字），例如「已經」。 */
  zh_trigger: string;
}

export interface TranslationCommonError {
  wrong: string;
  right?: string;
  explanation_zh: string;
}

/** 評分規準的一個部分（每句剛好 4 個，各 1 分；SPEC §4.6）。 */
export interface TranslationRubricPart {
  /** 對應的中文（逐字出現在題目）。 */
  zh: string;
  /** 可接受寫法：第一個是首選參考譯文用的寫法；每個參考譯文都要找得到其中一種。 */
  accepted: string[];
  /** 這一部分評量的標的詞彙 word 或句構 code。 */
  targets: string[];
  common_errors: TranslationCommonError[];
}

export interface TranslationTrap {
  type: TranslationTrapType;
  /** 引出誤譯的中文（逐字出現在題目）。 */
  zh: string;
  /** 照字面直譯會寫出的錯誤英文。 */
  literal_error: string;
  /** 落在第幾個評分部分（1–4）。 */
  part: 1 | 2 | 3 | 4;
  explanation_zh: string;
}

/** 加分寫法提示（超越頂標的倒裝、假設等只放這裡，不設為唯一正解；SPEC §3.5）。 */
export interface TranslationBonus {
  text: string;
  grammar_id?: string;
  explanation_zh: string;
}

/** 一句的評分規準。references[0] 等於 group 小題的 answer，references[1:] 等於 accepted_answers（或 accepted_answers 為 null）。 */
export interface TranslationRubricItem {
  /** 本站參考譯文 ≥2 種（超越頂標建議 ≥3）；不可和官方參考譯文有 8 字以上相同字串（D8）。 */
  references: string[];
  target_words: TranslationTargetWord[];
  patterns: TranslationPattern[];
  parts: TranslationRubricPart[];
  traps: TranslationTrap[];
  bonus: TranslationBonus[];
  /** 這一句要改寫句構才通順時的說明（進階以上至少 1 句；出題規格書 WRT-TRN-STR-03）。 */
  restructuring_zh?: string | null;
  notes_zh?: string;
}

export interface TranslationRubric {
  kind: 'translation';
  /** 題號字串 → 評分規準。 */
  items: Record<string, TranslationRubricItem>;
}

/** 作文四項評分指標（同 writing.ts 的 ESSAY_CRITERIA：內容、組織、文法句構、字彙拼字，各 0–5）。 */
export const MODEL_TEXT_CRITERIA = ['content', 'organization', 'grammar', 'vocabulary'] as const;
export type ModelTextCriterion = (typeof MODEL_TEXT_CRITERIA)[number];

/** 作文題型（出題規格書 tiers.*.composition.prompt_types 與 question_type_mix）。 */
export const COMPOSITION_PROMPT_TYPES = [
  'picture_scene',
  'topic_experience',
  'picture_issue',
  'letter',
  'topic_opinion',
  'picture_issue_abstract',
  'chart',
  'social_phenomenon',
] as const;
export type CompositionPromptType = (typeof COMPOSITION_PROMPT_TYPES)[number];

/** 題目要求的內容步驟（第一段：描述、比較…；第二段：經驗、看法、原因、影響、評估、方案…）。 */
export const COMPOSITION_MOVE_CODES = [
  'describe',
  'compare',
  'explain_function',
  'describe_data',
  'select_one',
  'personal_experience',
  'preference_reasons',
  'simple_plan',
  'ideal_design',
  'experience_solution',
  'imagined_plan',
  'opinion',
  'reasons',
  'effects',
  'evaluate',
  'propose',
  'compare_self',
  'concede_rebut',
] as const;
export type CompositionMoveCode = (typeof COMPOSITION_MOVE_CODES)[number];

export interface CompositionMove {
  paragraph: 1 | 2;
  code: CompositionMoveCode;
  /** 這個步驟在題目提示裡怎麼寫。 */
  zh: string;
}

/** 一項指標的分數帶描述（本站自己的文字，不重製評分原則原文；D8）。bands 剛好涵蓋 0–5 各一次。 */
export interface CompositionCriterion {
  /** 這一題在這一項要看什麼。 */
  focus_zh: string;
  bands: { min: number; max: number; descriptor_zh: string }[];
}

export interface CompositionOutlineParagraph {
  paragraph: 1 | 2;
  topic_sentence_zh: string;
  /** 2–3 個支持細節。 */
  details_zh: string[];
  closing_zh?: string;
}

/**
 * 鷹架（SPEC §3.5）：穩定基礎 outline+sentence_starters（構思圖＋兩段大綱＋每段 2–3 個句型開頭）；
 * 進階 outline（不給句型開頭）或 null；超越頂標 checklist（規劃檢核表）或 null。
 */
export type CompositionScaffold =
  | {
      kind: 'outline+sentence_starters';
      /** 構思圖（5W1H）。 */
      planning_map: { center_zh: string; branches: { label_zh: string; prompt_zh: string }[] };
      outline: CompositionOutlineParagraph[];
      /** 兩段各 2–3 個英文句型開頭。 */
      sentence_starters: string[][];
    }
  | { kind: 'outline'; outline: CompositionOutlineParagraph[] }
  | { kind: 'checklist'; checklist_zh: string[] };

export interface CompositionRubric {
  kind: 'composition';
  prompt_type: CompositionPromptType;
  moves: CompositionMove[];
  criteria: Record<ModelTextCriterion, CompositionCriterion>;
  /** 字數明顯不足、未分段的扣分說明（本站文字）。 */
  deductions_zh: string;
  scaffold: CompositionScaffold | null;
}

/** 評分規準：中譯英、作文各一種；其他題型先留位置。 */
export type RubricAnnotation = TranslationRubric | CompositionRubric | Record<string, unknown>;

/** 範文註解的種類：轉承詞、細節句、個人經驗句、好用句型、片語。 */
export const MODEL_TEXT_NOTE_KINDS = ['connective', 'detail', 'experience', 'pattern', 'phrase'] as const;
export type ModelTextNoteKind = (typeof MODEL_TEXT_NOTE_KINDS)[number];

/**
 * 轉承詞的功能：列舉或時序、補充、因果、轉折或讓步、舉例、結論。
 * SPEC §5.4 要求範文涵蓋 ≥4 種功能，算的是 sequence、cause_effect、contrast、example、conclusion 這 5 種（addition 不算）。
 */
export const CONNECTIVE_FUNCTIONS = ['sequence', 'addition', 'cause_effect', 'contrast', 'example', 'conclusion'] as const;
export type ConnectiveFunction = (typeof CONNECTIVE_FUNCTIONS)[number];

/** 範文的一個註解：text 必須逐字出現在範文。 */
export interface ModelTextNote {
  kind: ModelTextNoteKind;
  text: string;
  zh: string;
  /** 只用在 kind=connective。 */
  function?: ConnectiveFunction;
}

/** 本站標的分數（依四項指標的自評）：穩健版總分 14–17、頂標版 18–20（SPEC §5.7）；盲評者看不到。 */
export interface ModelTextSelfAssessment {
  scores: Record<ModelTextCriterion, number>;
  explanation_zh: string;
}

/** 作文範文：每題兩篇，steady＝穩健版、top＝頂標版；各 ≥120 字、剛好 2 段（段落之間一個換行）。 */
export interface ModelText {
  label: 'steady' | 'top';
  text: string;
  /** 段落功能（依序 2 筆）；topic_sentence 逐字引用該段主題句。 */
  paragraphs: { function_zh: string; topic_sentence: string }[];
  notes: ModelTextNote[];
  self_assessment: ModelTextSelfAssessment;
}

export interface BankAnnotations {
  explanations: ExplanationsAnnotation | null;
  translation_zh: TranslationZhAnnotation | null;
  elimination: EliminationAnnotation | null;
  guess_targets: GuessTarget[];
  open_tasks: OpenTask[];
  rubric: RubricAnnotation | null;
  model_texts: ModelText[] | null;
}

// ---------------------------------------------------------------------------
// 閱讀、混合題：圖表（figure.chart）、事實單、來源白名單（README §3.2–3.4、§8）
// ---------------------------------------------------------------------------

/** 圖表類型（前端依它繪圖；只收第一批需要的最小集合）。 */
export const CHART_TYPES = ['bar', 'line', 'stacked_bar', 'pie'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartAxis {
  /** 軸名（英文，學生看得到），例如 "Year"、"Share of food waste"。 */
  label: string;
  /** 單位，例如 "%"、"per 1,000 live births"；沒有單位是 null。 */
  unit: string | null;
}

export interface ChartSeries {
  /** 數列名稱（圖例），例如 "World"。 */
  name: string;
  /** 依 categories 的順序，每個類別一個數字（JSON number），長度必須和 categories 相同。 */
  values: number[];
}

/** 圖下標示的資料來源；網域要在白名單、用途 dataset、授權符合白名單（例如 OWID、World Bank 是 CC-BY-4.0）。 */
export interface ChartSource {
  publisher: string;
  title: string;
  url: string;
  license: string;
  /** 取得日期 YYYY-MM-DD。 */
  accessed: string;
}

/**
 * 圖表題的資料（DB_SCHEMA §5.3：圖表題的 figure 多一個 chart 物件）。
 * bar：類別長條（多個數列＝分組長條）；line：x 是時間點；stacked_bar：≥2 個數列堆疊；pie：1 個數列，類別是切片。
 * 每個數值都要對得回事實單的 datasets（provenance 要有 role=dataset 的來源）；figure.description 裡的數字要和這裡一致。
 */
export interface ChartSpec {
  type: ChartType;
  title: string;
  /** 類別軸（pie 是切片的類別名）。 */
  x: ChartAxis;
  /** 數值軸。 */
  y: ChartAxis;
  categories: string[];
  series: ChartSeries[];
  note: string | null;
  source: ChartSource;
}

/** AI 題庫的 figure：gsat-exam 的 Figure 加上圖表題的 chart。表格沿用 kind='table'＋rows。 */
export interface BankFigure extends Figure {
  chart?: ChartSpec;
  /**
   * 作文看圖題的示意圖（ROADMAP D9：代理畫的簡單 SVG）：完整的 <svg …>…</svg>，要有 xmlns 與 viewBox，
   * 不可有腳本、事件屬性、外部連結或圖片（validate_bank.py 的 svg_problems）。description 仍要完整描述圖的內容。只用在作文。
   */
  svg?: string;
}

/** AI 題庫的題組：gsat-exam 的 QuestionGroup，figures 用 BankFigure（仍可直接當 QuestionGroup 用）。 */
export type BankQuestionGroup = Omit<QuestionGroup, 'figures'> & { figures: BankFigure[] };

/** 事實單來源的用途：只取事實／可改作的開放文字／圖表資料（SPEC §5.3）。 */
export const SOURCE_USES = ['fact_only', 'adaptable_text', 'dataset'] as const;
export type SourceUse = (typeof SOURCE_USES)[number];

export const FACTS_SCHEMA_ID = 'gsat-bank-facts/v1';

export interface FactSource {
  /** 事實單內的來源代號，例如 s1。 */
  id: string;
  publisher: string;
  title: string;
  url: string;
  /** 取得日期 YYYY-MM-DD。 */
  accessed: string;
  /** adaptable_text、dataset 必須是白名單列的授權（CC-BY-4.0…）；fact_only 照實記錄原站授權。 */
  license: string;
  use: SourceUse;
  note?: string | null;
}

export const FACT_KINDS = ['number', 'date', 'cause_effect', 'person', 'place', 'event', 'definition', 'other'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** 一條事實：自己的話寫的單一事實（不是來源原句），附來源。 */
export interface Fact {
  id: string;
  text: string;
  /** FactSource.id；至少一個。 */
  source_ids: string[];
  kind?: FactKind;
  note?: string | null;
}

/** 圖表的原始資料（來源的 use 必須是 dataset）；格式和 ChartSpec 的 categories／series 相同。 */
export interface FactDataset {
  id: string;
  source_id: string;
  title: string;
  /** 指標代號，例如 WDI 的 SH.DYN.MORT。 */
  indicator?: string | null;
  unit: string | null;
  categories: string[];
  series: ChartSeries[];
  note?: string | null;
}

/** 事實單 data/bank/facts/{id}.json（SPEC §5.2 步驟 2：只有事實、沒有原句）。題組以 fact:{id} 引用。 */
export interface FactSheet {
  schema: typeof FACTS_SCHEMA_ID;
  /** 等於檔名，小寫英數字與連字號，例如 sdg14-0007。 */
  id: string;
  title: string;
  sdgs?: number[];
  created_on: string;
  /** 整理者：模型 ID 或 admin:{users.id}。 */
  created_by: string;
  sources: FactSource[];
  facts: Fact[];
  datasets?: FactDataset[];
  notes?: string | null;
}

/** 來源白名單的一筆允許規則。 */
export interface WhitelistAllow {
  id: string;
  publisher: string;
  match: 'domain' | 'host';
  domains?: string[];
  hosts?: string[];
  uses: SourceUse[];
  /** adaptable_text、dataset 接受的授權。 */
  licenses: string[];
  conditions_zh?: string;
  basis?: string;
}

/** 禁止規則：網域與用途都對上就不能用（uses 含 '*' 表示任何用途）；scope='interface' 的是介面規則，不比對網址。 */
export interface WhitelistDeny {
  id: string;
  match: 'domain' | 'host' | 'none';
  domains?: string[];
  hosts?: string[];
  uses: (SourceUse | '*')[];
  scope?: 'interface';
  rule_zh: string;
  basis?: string;
}

/** data/bank/sources-whitelist.json。 */
export interface SourcesWhitelist {
  schema: 'gsat-bank-sources-whitelist/v1';
  basis: string;
  updated_on: string;
  matching_zh: string;
  uses: Record<SourceUse, string>;
  licenses: Record<string, string>;
  allow: WhitelistAllow[];
  deny: WhitelistDeny[];
}

// ---------------------------------------------------------------------------
// 課綱、出處、生成、指標
// ---------------------------------------------------------------------------

export interface CurriculumRef {
  /** 課綱代碼 ASCII 寫法（data/curriculum/english-108.json 的 code_ascii），例如 3-V-12。 */
  code: string;
  weight: 'primary' | 'secondary';
  basis: 'generator' | 'inferred' | 'ceec_feature';
}

/** 授權白名單（SPEC §5.3）。CC BY-SA 改作要標 share_alike 並獨立存放。 */
export const BANK_LICENSES = ['original-ai', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0'] as const;
export type BankLicense = (typeof BANK_LICENSES)[number];

export const BANK_DERIVATIONS = ['ai-original-from-facts', 'adapted', 'original'] as const;
export type BankDerivation = (typeof BANK_DERIVATIONS)[number];

export interface ProvenanceSource {
  /** 事實單或資料集代號，例如 fact:sdg14-0007（data/bank/facts/sdg14-0007.json）。 */
  source_id: string;
  role: 'fact' | 'dataset' | 'adapted_text';
  url?: string;
}

export interface Provenance {
  sources: ProvenanceSource[];
  license: BankLicense;
  derivation: BankDerivation;
  share_alike: boolean;
  commercial_ok: boolean;
  attribution_text: string | null;
}

export interface Generation {
  channel: 'agent' | 'batch' | 'human';
  /** 例如 agent-2026-10-20-wb-adv-01。 */
  run_id: string;
  /** 批次規格 id（data/bank/lots/{lot}.json 的 lot）；匯入時寫成 review_lot。 */
  lot: string;
  model: string;
  prompt_id: string;
  prompt_sha256: string;
  /** 出題規格版本，例如 word_bank-advanced@2026-10-08。 */
  spec_id: string;
  /** 重生的題組：被退回的那一組的 uid（SPEC §5.2 步驟 9「附意見重生一次」）。 */
  regenerated_from?: string | null;
}

export interface MetricsBandCheck {
  tier: Tier;
  /** 用的是哪一套帶：SPEC §3.4，或批次規格疊上出題規格書的 passage_overrides。 */
  basis: string;
  ok: boolean;
  /** 每個指標：值、區間、是否通過。 */
  checks: Record<string, { value: number; min: number | null; max: number | null; ok: boolean }>;
}

/** tools/text_metrics.py 的輸出（不由 AI 填）。 */
export interface BankMetrics {
  tool: string;
  lexicon: 'forms-index' | 'suffix-rules';
  word_count: number;
  sentences: number;
  avg_sentence_length: number;
  /** 分母：去掉專有名詞與數字後的 token 數。 */
  denominator: number;
  proper_nouns: string[];
  numbers: number;
  coverage_l1_4: number;
  coverage_l1_6: number;
  offlist_ratio: number;
  beyond_l4_ratio: number;
  level_counts: Record<string, number>;
  offlist_words: string[];
  band: MetricsBandCheck | null;
}

// ---------------------------------------------------------------------------
// verification（各自成為 item_reviews 的一列；result 對應 verdict）
// ---------------------------------------------------------------------------

export const VERIFICATION_KINDS = [
  'program',
  'blind_solver',
  'distractor_audit',
  'unique_solution',
  'similarity',
  'fact_check',
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

export const VERIFICATION_RESULTS = ['pass', 'warn', 'fail'] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** 干擾選項稽核的判定。 */
export const DISTRACTOR_VERDICTS = ['clearly_wrong', 'arguably_acceptable'] as const;
export type DistractorVerdict = (typeof DISTRACTOR_VERDICTS)[number];

/** 干擾選項「錯在哪裡」。 */
export const DISTRACTOR_ERROR_TYPES = [
  'pos_mismatch',
  'grammar',
  'collocation',
  'meaning',
  'logic',
  'register',
  'cohesion',
  'off_topic',
  'factual',
  'other',
] as const;
export type DistractorErrorType = (typeof DISTRACTOR_ERROR_TYPES)[number];

interface VerificationBase {
  /** 模型 ID、'validate_bank.py'、'record_verification.py'、'admin:{users.id}'。 */
  reviewer: string;
  result: VerificationResult;
  /** ISO 8601（UTC）。 */
  created_at: string;
}

export interface ProgramVerification extends VerificationBase {
  kind: 'program';
  details: { errors: string[]; warnings: string[] };
}

/** 盲解者對一個小題的回答（README 的 blind_solver 輸入格式）。 */
export interface BlindAnswer {
  answer: OptionLetter;
  confidence: Confidence;
  /** 其他也說得通的選項；必須是空陣列才算通過。 */
  also_plausible: OptionLetter[];
  evidence: string[];
  explanation_zh: string;
  /** 文意選填、篇章結構：這一格的可行選項集合（必含 answer）。 */
  feasible?: OptionLetter[];
}

/** 混合題多選的盲解回答：answer 是選項代號陣列，每個選項的判斷都要和標準答案一致，also_plausible 必須是空陣列。 */
export interface MultiSelectBlindAnswer {
  answer: OptionLetter[];
  confidence: Confidence;
  also_plausible: OptionLetter[];
  evidence: string[];
  explanation_zh: string;
  /** 每個選項的逐字證據句（超越頂標標 E2 的正解，兩位盲解者引用的句子要有交集）。 */
  option_evidence?: Partial<Record<OptionLetter, string[]>>;
}

/** 混合題填充、簡答的盲解回答：answer 與 also_plausible 的每個寫法都要在 accepted_answers 內（SPEC §4.6 正規化後比對）。 */
export interface OpenBlindAnswer {
  answer: string;
  confidence: Confidence;
  also_plausible: string[];
  evidence: string[];
  explanation_zh: string;
}

export interface BlindSolverVerification extends VerificationBase {
  kind: 'blind_solver';
  details: {
    solver: 'A' | 'B';
    session_id: string | null;
    answers: Record<string, BlindAnswer | MultiSelectBlindAnswer | OpenBlindAnswer>;
    /** 不通過的原因（每條一句）。 */
    problems: string[];
  };
}

/** 盲譯／盲評時，驗證者對參考譯文、4 部分切分或題目本身的判定。 */
export type ReviewCheck = VerificationResult;

/**
 * 中譯英盲譯（README §5.5；gsat-bank-blind-translation/v1 輸入，寫進 blind_solver 的 details）。
 * answers 是只看中文題目寫出的譯文；review 是寫完之後打開題組檔對答案的判定。
 */
export interface BlindTranslationVerification extends VerificationBase {
  kind: 'blind_solver';
  details: {
    solver: 'A' | 'B';
    session_id: string | null;
    task: 'blind_translation';
    answers: Record<string, { translation: string; confidence: Confidence; explanation_zh: string }>;
    review: Record<
      string,
      {
        used_patterns: TranslationStructureCode[];
        used_target_words: string[];
        within_accepted: boolean;
        closest_reference?: number;
        reference_check: ReviewCheck;
        parts_check: ReviewCheck;
        issues_zh: string[];
      }
    >;
    /** 程式比對的結果：命中的標的詞彙與比例（≥0.8 才通過）、句構比對、譯文是否和某個可接受整句完全相同。 */
    checks: Record<
      string,
      {
        target_words_found: string[];
        target_hit_rate: number;
        patterns_detected: Record<string, boolean | null>;
        program_match: boolean;
      }
    >;
    problems: string[];
  };
}

/** 作文盲評的一篇（盲評者看到的是中性代號 E1／E2）。 */
export interface BlindEssayGrade {
  scores: Record<ModelTextCriterion, number>;
  off_topic: boolean;
  covers_all_tasks: boolean;
  /** 範文要 0 錯：有列錯誤就不通過（excerpt 逐字引用範文）。 */
  errors: { excerpt: string; explanation_zh: string; suggestion?: string }[];
  comment_zh: string;
}

/**
 * 作文盲評（README §5.6；gsat-bank-blind-grading/v1 輸入，寫進 blind_solver 的 details）。
 * essays 已換回 steady／top（id 是盲評者看到的代號）；穩健版總分 14–17、頂標版 18–20 才通過，兩位評分差 ≤2。
 */
export interface BlindGradingVerification extends VerificationBase {
  kind: 'blind_solver';
  details: {
    solver: 'A' | 'B';
    session_id: string | null;
    task: 'blind_grading';
    /** 盲評時的呈現順序：{E1: 'steady' | 'top', E2: …}（student_view.py 的 grading_order）。 */
    order: Record<string, 'steady' | 'top'>;
    essays: Partial<Record<'steady' | 'top', BlindEssayGrade & { id: string }>>;
    totals: Partial<Record<'steady' | 'top', number>>;
    prompt_check: ReviewCheck;
    issues_zh: string[];
    problems: string[];
  };
}

export interface DistractorJudgement {
  verdict: DistractorVerdict;
  error_type: DistractorErrorType;
  /** 使它錯的那句原文（逐字）。 */
  evidence: string;
  explanation_zh: string;
}

export interface DistractorAuditVerification extends VerificationBase {
  kind: 'distractor_audit';
  details: {
    session_id: string | null;
    /** 題號 → 選項代號 → 判定。 */
    items: Record<string, Partial<Record<OptionLetter, DistractorJudgement>>>;
    problems: string[];
  };
}

export interface UniqueSolutionVerification extends VerificationBase {
  kind: 'unique_solution';
  details: {
    method: 'perfect_matching_dp' | 'injective_assignment';
    perfect_matchings: number;
    matches_key: boolean;
    feasible: Record<string, OptionLetter[]>;
    problems: string[];
  };
}

export interface SimilarityVerification extends VerificationBase {
  kind: 'similarity';
  details: { max_common_words: number; threshold: number; against: string[]; problems: string[] };
}

export interface FactCheckVerification extends VerificationBase {
  kind: 'fact_check';
  details: { checked: { claim: string; source_id: string; ok: boolean }[]; problems: string[] };
}

export type VerificationEntry =
  | ProgramVerification
  | BlindSolverVerification
  | BlindTranslationVerification
  | BlindGradingVerification
  | DistractorAuditVerification
  | UniqueSolutionVerification
  | SimilarityVerification
  | FactCheckVerification;

// ---------------------------------------------------------------------------
// 檔案
// ---------------------------------------------------------------------------

export interface BankFile {
  schema: BankSchemaId;
  uid: string;
  version: number;
  section_type: BankSectionType;
  /** 例如 word_bank-10x10（tiers.ts 的 SECTION_FORMATS）。 */
  format_version: string;
  tier: Tier;
  pool: BankPool;
  group: BankQuestionGroup;
  annotations: BankAnnotations;
  curriculum: CurriculumRef[];
  provenance: Provenance;
  generation: Generation;
  metrics: BankMetrics | null;
  verification: VerificationEntry[];
  status: BankStatus;
  /** rejected 的原因（每條一句，以「；」相接）；其他狀態為 null 或省略。 */
  status_reason?: string | null;
}

/** 檔案中不可出現的「推理過程」類欄位名（不分大小寫、含底線或連字號的變體）。 */
export const FORBIDDEN_FIELD_NAMES = ['reasoning', 'chain_of_thought', 'step_by_step', 'thinking'] as const;

/** 欄位名是否屬於「推理過程」類（例如 reasoning_zh、ChainOfThought 也算）。 */
export function isForbiddenFieldName(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '_');
  const flat = k.replace(/_/g, '');
  return FORBIDDEN_FIELD_NAMES.some((f) => k.includes(f) || flat.includes(f.replace(/_/g, '')));
}
