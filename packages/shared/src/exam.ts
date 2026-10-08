/**
 * 歷屆試題 JSON（gsat-exam/v1.1）的 TypeScript 型別。
 *
 * 唯一的規格來源是 docs/exam-json-schema.md；Python 檢查工具 tools/validate_exam.py 依同一份文件實作，
 * 資料由 tools/normalize_exams.py 從 v1 升級。這裡的列舉值都寫成 `as const` 陣列再推導出字面值聯集，原因是：
 *   1. 型別與執行期常數只寫一次，不會走鐘（測試、匯入 D1 的腳本、前端篩選器都能直接拿陣列用）。
 *   2. 規格文件改了列舉值，只要改這裡一處，所有用到的 switch 都會被 tsc 抓出漏掉的分支。
 *
 * v1.1 起 grammar_point、clue 也是封閉集合（v1 只是舉例）；唯一還開放的是 figure.kind，
 * 用「已知值｜任意字串」表示：編輯器仍會提示已知值，但解析者標了新值也不會被型別擋下。
 */

/** 開放值域：保留已知字面值的自動完成，同時接受其他字串。`string & {}` 是讓聯集不被併成 string 的慣用寫法。 */
export type OpenString<Known extends string> = Known | (string & {});

/** 檔案頂層的 schema 識別字串。v1 檔案不再接受，要先跑 tools/normalize_exams.py。 */
export const EXAM_SCHEMA_ID = 'gsat-exam/v1.1';
export type ExamSchemaId = typeof EXAM_SCHEMA_ID;

// ---------------------------------------------------------------------------
// 頂層
// ---------------------------------------------------------------------------

/** 考試別：學測、指考、參考試卷／試辦。 */
export const EXAM_KINDS = ['gsat', 'ast', 'reference'] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];

/** 場次：一般、補考。 */
export const EXAM_SESSIONS = ['regular', 'makeup'] as const;
export type ExamSession = (typeof EXAM_SESSIONS)[number];

/**
 * 考卷 id，同時也是檔名（data/exams/parsed/{id}.json）。
 * 學測 `gsat-115`、`gsat-91-makeup`；指考 `ast-110`、`ast-109-makeup`；參考試卷 `ref-115`、`ref-98-a`。
 * 樣板字面值型別只能粗略限制形狀；精確規則（學年度 2–3 位數、後綴單一小寫字母）見 EXAM_ID_PATTERN。
 */
export type ExamId =
  | `${'gsat' | 'ast'}-${number}`
  | `${'gsat' | 'ast'}-${number}-makeup`
  | `ref-${number}`
  | `ref-${number}-${string}`;

/** 與 tools/validate_exam.py 的 ID_RE 相同。 */
export const EXAM_ID_PATTERN = /^(gsat|ast)-\d{2,3}(-makeup)?$|^ref-\d{2,3}(-[a-z])?$/;

/** 原始檔路徑（repo 內相對路徑；data/raw/ 不進 git，但路徑要對得上 manifest）。 */
export interface ExamSources {
  /** 題本 PDF。 */
  paper: string;
  /** v1.1：題本 Word 版（.doc／.docx）。 */
  paper_word?: string[];
  /** 答案檔。 */
  answer: string[];
  /** 非選擇題評分原則。 */
  scoring: string[];
  /** 答對率、鑑別度等統計檔。 */
  stats: string[];
  /** v1.1：答案卷／答題卷（manifest subkind 為 answer_sheet 的檔案）。 */
  answer_sheet?: string[];
  /** v1.1：其他官方附件，例如封面、考試說明、試題解析。 */
  other?: string[];
}

/** 解析過程紀錄：之後回頭查證時，要知道每份檔案是怎麼產生、哪裡沒把握。 */
export interface ExamExtraction {
  /** 用了哪些方法（含 Read 看頁面影像）。 */
  method: string;
  /** 無法確定的地方，逐條寫清楚題號與原因。 */
  issues: string[];
  /** 查證者；查證完成填 "verifier"，未查證為 null。 */
  verified_by: string | null;
}

/**
 * v1.1：題本的「部分」（第壹部分：選擇題…）。v1 散在 section.part_title／part_instructions 的內容併到這裡。
 * 題本沒有記下部分標題時 title 為 null；points 題本有印照印，沒印時是所屬大題 points_total 的加總。
 */
export interface ExamPart {
  title: string | null;
  points: number | null;
  /** 部分層級的說明（例如非選擇題的作答說明），逐字照題本；沒有就是 null。 */
  instructions: string | null;
  /** 屬於這個部分的大題 id，依題本順序。 */
  sections: string[];
}

/** 一份考卷（含補考、參考試卷）。 */
export interface Exam {
  schema: ExamSchemaId;
  id: ExamId;
  exam: ExamKind;
  /** 學年度（民國）。 */
  year: number;
  session: ExamSession;
  /** 題本原文標題，例如「115學年度學科能力測驗英文考科」。 */
  title: string;
  /** 作答時間（分鐘）；題本沒印就是 null。 */
  time_minutes: number | null;
  full_score: number;
  sources: ExamSources;
  /** v1.1：題本的部分標題與說明；沒有記錄就省略。 */
  parts?: ExamPart[];
  sections: ExamSection[];
  extraction: ExamExtraction;
}

// ---------------------------------------------------------------------------
// section（大題）
// ---------------------------------------------------------------------------

export const SECTION_TYPES = [
  'vocabulary',
  'cloze',
  'word_bank',
  'structure',
  'reading',
  'mixed',
  'sentence_matching',
  'short_answer',
  'translation',
  'composition',
  'other',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

/** 大題類型的中文名稱（介面顯示用，依規格文件的「中文」欄）。 */
export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
  sentence_matching: '句子配合題',
  short_answer: '簡答題',
  translation: '中譯英',
  composition: '英文作文',
  other: '其他',
};

/** 用共用選項庫（options_bank）作答的大題類型；這幾類的題組一定要有 options_bank。 */
export const BANK_SECTION_TYPES = ['word_bank', 'structure', 'sentence_matching'] as const satisfies readonly SectionType[];

/** 選文中以 [[題號]] 標出空格的大題類型；空格順序必須與小題題號一致。 */
export const BLANK_SECTION_TYPES = ['cloze', 'word_bank', 'structure'] as const satisfies readonly SectionType[];

/**
 * v1.1：題號在大題內從 1 編號、不算進卷內連續題號的大題類型（翻譯、作文、簡答）。
 * type 為 other 且全部是非選擇作答的大題（例如 gsat-87 的短詩閱讀）也一樣，判斷用 isIndependentlyNumbered()。
 */
export const INDEPENDENTLY_NUMBERED_SECTION_TYPES = ['translation', 'composition', 'short_answer'] as const satisfies readonly SectionType[];

/** v1.1：大題層級的得分分布（大考中心只公布非選擇題「一大題」的分數人數統計，拆不到小題）。 */
export interface ScoreBin {
  /** 原表的分數區間字串，例如 "8.00-8.99"；缺考列為 "缺考"。 */
  range: string;
  /** 由 range 解析出的區間上下限；解析不了（例如「缺考」）是 null。 */
  min?: number | null;
  max?: number | null;
  count: number;
  /** 人數比例（0–1），分母見 SectionStats.rate_base／note。 */
  rate?: number | null;
  cumulative_count?: number | null;
  cumulative_rate?: number | null;
}

export interface SectionStats {
  /** 統計檔與工作表。 */
  source?: string | null;
  /** 該大題滿分。 */
  max_score?: number | null;
  /** 報名（報考）人數，含缺考。 */
  registered?: number | null;
  absent?: number | null;
  /** 到考人數。 */
  examinees?: number | null;
  /** 比例的分母說明。 */
  rate_base?: string | null;
  note?: string | null;
  score_distribution: ScoreBin[];
}

export interface ExamSection {
  /** 例如 "s1"。 */
  id: string;
  type: SectionType;
  /** 題本原文，例如「一、詞彙題（占10分）」。 */
  title: string;
  /** 題本原文的部分名稱：選擇題／混合題／非選擇題…；舊卷沒有就是 null。 */
  part: string | null;
  /** 說明文字，逐字照題本。 */
  instructions: string;
  /** 本大題配分；規格要求是數字，檢查工具對非數字只發 warning，所以保留 null 的可能。 */
  points_total: number | null;
  /** v1.1：大題層級統計（v1 的 section.score_distribution 併入這裡）。 */
  stats?: SectionStats;
  groups: QuestionGroup[];
}

// ---------------------------------------------------------------------------
// group（題組）
// ---------------------------------------------------------------------------

/**
 * 選項代號：單一大寫字母。tools/validate_exam.py 接受 A–Z；這裡列到實際題本出現過的最大值：
 * 現制文意選填 A–J、句子配合題最多 12 個，83 學年度學測的「文意閱讀選填」印了 15 個選項（A–O，
 * 見 data/exams/parsed/gsat-83.json 的 extraction.issues）。之後若有題本超過 O，在這裡擴充。
 */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

/** `{ "A": "hasty", "B": "tight", ... }`。不是每個字母都會出現，所以用 Partial。 */
export type OptionMap = Partial<Record<OptionLetter, string>>;

/** 多文本選文的一段，例如閱讀測驗的文本 A／B。 */
export interface PassagePart {
  /**
   * 題本印的段落代號（"A"、"B"）。有些題本的多文本沒有印代號（例如 gsat-93 的書目、gsat-113、ast-94），
   * 依「逐字」原則不自己編，所以是 null。畫面上要顯示代號時，用陣列順序補。
   */
  label: string | null;
  title: string | null;
  text: string;
}

/**
 * 圖表種類，開放值域。解析資料實際用了 table、chart、map、poster、image、picture、photo、illustration、
 * diagram、advertisement、other 等；前端依 kind 決定排版時，要有「其他」的預設分支。
 */
export type FigureKind = OpenString<
  'table' | 'chart' | 'map' | 'poster' | 'image' | 'picture' | 'photo' | 'illustration' | 'diagram'
>;

/** 圖、表、地圖、海報：一律用文字完整描述，表格要轉成 rows。 */
export interface Figure {
  kind: FigureKind;
  /** v1.1：題本上對這張圖的標示或指稱（例如「連環圖片第1幅」「the following diagram（第50題）」）。 */
  label?: string | null;
  caption: string | null;
  description: string;
  /** 表格內容（第一列通常是表頭）；不是表格就是 null 或省略。 */
  rows?: string[][] | null;
  /** v1.1：圖只屬於某一小題時的題號（例如選項是圖片的那一題）。 */
  question_no?: number | null;
}

/** 選文中的空格標記 [[題號]]。用 matchAll 取出全部題號；有 g 旗標，不要拿去呼叫 test()，以免 lastIndex 殘留。 */
export const BLANK_PATTERN = /\[\[(\d+)\]\]/g;

export interface QuestionGroup {
  /** 例如 "s2g1"。 */
  id: string;
  /** v1.1：題本印的題組標示，例如「第41至44題為題組」；題本沒印是 null，沒記錄就省略。 */
  group_label?: string | null;
  /**
   * 選文；空格一律寫成 [[題號]]。詞彙題這種單題形式沒有選文，為 null。
   * v1.1：段落之間只用一個 "\n"（詩以 "\n\n" 分節）。
   */
  passage: string | null;
  /** 多文本選文；沒有就是 null。 */
  passage_parts: PassagePart[] | null;
  figures: Figure[];
  /** word_bank／structure／sentence_matching 的共用選項庫；其他類型為 null。 */
  options_bank: OptionMap | null;
  questions: Question[];
  /** 題組層級標註。v1.1 起必填：沒有選文可標（詞彙題、翻譯、作文）就是 null。 */
  tags: GroupTags | null;
}

// ---------------------------------------------------------------------------
// question（小題）
// ---------------------------------------------------------------------------

export const QUESTION_MODES = [
  'single_choice',
  'multi_select',
  'bank_choice',
  'fill_in_blank',
  'short_answer',
  'table_completion',
  'translation',
  'composition',
] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

/** 用選項作答的模式；answer 必須是選項代號。 */
export const CHOICE_MODES = ['single_choice', 'multi_select', 'bank_choice'] as const satisfies readonly QuestionMode[];

/** 大考中心公布的統計，數值一律是 0–1 的小數（百分比要除以 100）；有才填。 */
export interface QuestionStats {
  correct_rate?: number | null;
  high_group?: number | null;
  low_group?: number | null;
  /** 鑑別度，範圍 -1–1。 */
  discrimination?: number | null;
  option_rates?: Partial<Record<OptionLetter, number>> | null;
  /** v1.1：高分組各選項選答比例。 */
  option_rates_high?: Partial<Record<OptionLetter, number>> | null;
  /** v1.1：低分組各選項選答比例。 */
  option_rates_low?: Partial<Record<OptionLetter, number>> | null;
  /** v1.1：未作答比例（v1 部分檔案叫 no_answer_rate）。 */
  omit_rate?: number | null;
  /** v1.1：多選題全對比例。 */
  full_correct_rate?: number | null;
  /** v1.1：五等分組通過率，由高分組到低分組，固定 5 個數字。 */
  five_groups?: number[] | null;
}

/** v1.1：參考試卷沿用歷屆試題時的出處。 */
export interface ReusedFrom {
  /** 原卷 id。 */
  exam: ExamId;
  /** 原卷「同類大題」中的題號（v1.1 編號：翻譯、作文是大題內序號）。 */
  no: number;
  /** 與原題的差異說明；逐字相同是 null。 */
  modified: string | null;
}

/** v1.1：計分例外的種類。all_credit＝送分；multiple_correct＝官方公告多個答案皆給分；other＝其他（note 必填）。 */
export const SCORING_EXCEPTION_TYPES = ['all_credit', 'multiple_correct', 'other'] as const;
export type ScoringExceptionType = (typeof SCORING_EXCEPTION_TYPES)[number];

export interface ScoringException {
  type: ScoringExceptionType;
  note?: string | null;
}

/**
 * v1.1：題目指涉選文中的特定字串（例如「第三段粗體的 it」「line 5」），前端用來高亮。
 * occurrence 是 text 在題組選文（passage 接著各 passage_parts.text，去掉強調標記）中第幾次出現，
 * 計數規則見 findOccurrences()。
 */
export interface RefersTo {
  text: string;
  occurrence: number;
  note?: string | null;
}

/** 所有模式共用的欄位。 */
interface QuestionBase {
  /** 題號（整數）。混合題的 47A 寫 no: 47、label: "47A"；翻譯、作文、簡答是大題內序號（v1.1）。 */
  no: number;
  /** 題本上印的題號字串；整份考卷內不可重複。翻譯、作文用題本印的大題名稱，例如「中譯英1」「英文作文」。 */
  label: string;
  /** 題幹逐字；克漏字類沒有題幹就是 null。 */
  stem: string | null;
  /** v1.1：題幹指涉的選文字串。 */
  refers_to?: RefersTo;
  /** 本題選項；用 options_bank 的題目、非選擇題為 null。 */
  options: OptionMap | null;
  /** 評分原則列出的其他可接受答案。 */
  accepted_answers: string[] | null;
  /** v1.1：送分、多個答案皆給分等計分例外。 */
  scoring_exception?: ScoringException;
  points: number | null;
  stats: QuestionStats | null;
  /** 非選擇題：評分原則中與本題相關的逐字內容。 */
  scoring_notes: string | null;
  /** v1.1：參考試卷沿用歷屆試題時的出處。 */
  reused_from?: ReusedFrom;
  /**
   * 小題標註。必填（可以是空物件），「不確定就省略」指的是省略 tags 裡的「欄位」，
   * 所以讀 q.tags.test_point 時不必先判斷 tags 存不存在。
   */
  tags: QuestionTags;
}

/** 單選題、共用選項庫的選擇題：答案是一個選項代號。 */
export interface SingleChoiceQuestion extends QuestionBase {
  mode: 'single_choice' | 'bank_choice';
  answer: OptionLetter;
}

/** 多選題：答案是選項代號陣列，例如 ["C", "D"]。 */
export interface MultiSelectQuestion extends QuestionBase {
  mode: 'multi_select';
  answer: OptionLetter[];
}

/** 填充、簡答：官方參考答案字串；沒公布為 null。 */
export interface OpenResponseQuestion extends QuestionBase {
  mode: 'fill_in_blank' | 'short_answer';
  answer: string | null;
}

/** 表格填寫題。 */
export interface TableCompletionQuestion extends QuestionBase {
  mode: 'table_completion';
  answer: string | null;
  /** v1.1：完整的答案表（第一列為表頭），與題組 figures 裡的作答表格對應。 */
  answer_table?: string[][];
}

/**
 * 中譯英。answer 是官方參考譯文（沒公布為 null）。
 * v1.1：有官方大括號／樹狀圖譯法時，用 answer_segments 表示可替換寫法；
 * 跨段相依（例如主詞單複數連動）時另用 answer_variants 列出完整句子，answer_segments 可省略。
 */
export interface TranslationQuestion extends QuestionBase {
  mode: 'translation';
  answer: string | null;
  /** 每一段是可替換寫法的陣列，空字串代表可省略；依序串接（joinAnswerSegments）即為可接受譯文。 */
  answer_segments?: string[][];
  /** 完整的可接受譯文。 */
  answer_variants?: string[];
  /** true：answer 是由樹狀圖各段第一個選項組成，不是官方印出的整句。 */
  answer_is_composite?: boolean;
}

/** 作文：沒有標準答案（範文不是官方答案），answer 固定為 null。 */
export interface CompositionQuestion extends QuestionBase {
  mode: 'composition';
  answer: null;
}

/** 以 mode 區分的小題聯集：`switch (q.mode)` 之後 answer 與專屬欄位的型別會自動收窄。 */
export type Question =
  | SingleChoiceQuestion
  | MultiSelectQuestion
  | OpenResponseQuestion
  | TableCompletionQuestion
  | TranslationQuestion
  | CompositionQuestion;

// ---------------------------------------------------------------------------
// 標註（tags）：解析時一併標上，不確定就省略該欄，不要猜。
// ---------------------------------------------------------------------------

/** 選擇題的考點（vocabulary／cloze／word_bank／sentence_matching）。 */
export const TEST_POINTS = [
  'word_meaning',
  'collocation',
  'phrase',
  'connective',
  'grammar',
  'word_form',
  'discourse',
] as const;
export type TestPoint = (typeof TEST_POINTS)[number];

export const TEST_POINT_LABELS: Record<TestPoint, string> = {
  word_meaning: '詞義',
  collocation: '搭配詞',
  phrase: '片語／慣用語',
  connective: '轉折詞／連接詞',
  grammar: '文法',
  word_form: '詞性／字形',
  discourse: '上下文邏輯',
};

/** 答案的詞性。v1.1：答案兩個字以上一律是 phrase（整句保留 clause），原本的功能詞性放 answer_function。 */
export const ANSWER_POS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
  'phrase',
  'clause',
] as const;
export type AnswerPos = (typeof ANSWER_POS)[number];

/** v1.1：片語答案在句中的功能詞性（answer_pos 為 phrase 時才有）。 */
export const ANSWER_FUNCTIONS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'pronoun',
] as const satisfies readonly AnswerPos[];
export type AnswerFunction = (typeof ANSWER_FUNCTIONS)[number];

/** test_point 為 grammar 時的文法點。v1.1 起是封閉集合（原值不在集合內時，原值保留在 grammar_point_raw）。 */
export const GRAMMAR_POINTS = [
  'tense',
  'passive',
  'participle',
  'relative_clause',
  'noun_clause',
  'adverb_clause',
  'conditional',
  'subjunctive',
  'inversion',
  'comparison',
  'infinitive_gerund',
  'modal',
  'agreement',
  'pronoun',
  'determiner',
  'article',
  'preposition',
  'conjunction',
  'parallel_structure',
  'with_construction',
  'causative',
  'emphasis',
  'existential',
  'substitution',
  'degree',
  'other',
] as const;
export type GrammarPoint = (typeof GRAMMAR_POINTS)[number];

/** 閱讀、混合、簡答題的題目類型。 */
export const ITEM_TYPES = [
  'main_idea',
  'detail',
  'inference',
  'vocab_in_context',
  'reference',
  'purpose',
  'tone_attitude',
  'structure',
  'chart_reading',
  'sequencing',
  'title',
  'not_mentioned',
  'application',
  'synthesis',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** 篇章結構的解題線索。v1.1 起是封閉集合（lexical_link、keyword_repetition 併入 lexical_cohesion；conclusion 併入 summary）。 */
export const STRUCTURE_CLUES = [
  'pronoun_reference',
  'lexical_cohesion',
  'transition_word',
  'topic_sentence',
  'contrast',
  'example',
  'elaboration',
  'enumeration',
  'summary',
  'chronology',
  'other',
] as const;
export type StructureClue = (typeof STRUCTURE_CLUES)[number];

/** 作文類型。v1.1：two_paragraph 改為 topic（段數記在 paragraphs）。 */
export const ESSAY_TYPES = ['picture', 'chart', 'letter', 'topic', 'continuation', 'other'] as const;
export type EssayType = (typeof ESSAY_TYPES)[number];

/**
 * v1.1：作文字數要求。「at least 120 words」→ {min:120}；「about 120 words」「120字左右」→ {approx:120}；
 * 「about 120 to 150 words」「100至150字」→ {min, max}。三個欄位都要寫出（不適用是 null），approx 與 min／max 互斥。
 */
export interface WordCount {
  min: number | null;
  max: number | null;
  approx: number | null;
}

/** 選擇題共通（vocabulary／cloze／word_bank／sentence_matching）。 */
export interface ChoiceQuestionTags {
  test_point?: TestPoint;
  answer_pos?: AnswerPos;
  /** v1.1：answer_pos 為 phrase 時，片語原本的功能詞性。 */
  answer_function?: AnswerFunction;
  /** test_point 是 grammar 時填。 */
  grammar_point?: GrammarPoint;
  /** v1.1：grammar_point 收斂到封閉集合前的原值（有改才有）。 */
  grammar_point_raw?: string;
  /** 答案涉及的片語或搭配，例如 "elbow one's way"。 */
  key_phrase?: string;
}

/** 閱讀、混合、簡答題。 */
export interface ReadingQuestionTags {
  item_type?: ItemType;
  /** v1.1：被 NOT／EXCEPT 規則或讀圖規則改掉之前的 item_type（有改才有）。 */
  item_type_raw?: string;
  key_phrase?: string;
}

/** 篇章結構。 */
export interface StructureQuestionTags {
  clue?: StructureClue;
  /** v1.1：clue 收斂到封閉集合前的原值（有改才有）。 */
  clue_raw?: string;
  key_phrase?: string;
}

/** 翻譯。 */
export interface TranslationQuestionTags {
  /** 核心句型，例如 "not only ... but also"、"so ... that"、"分詞構句"。 */
  patterns?: string[];
  topic?: string;
}

/** 作文。 */
export interface CompositionQuestionTags {
  essay_type?: EssayType;
  /** 要求段數。 */
  paragraphs?: number;
  /** v1.1：字數要求（取代 v1 的 word_requirement 字串）。 */
  word_count?: WordCount;
  /** v1.1：v1 的 word_requirement 原字串，例如 "at least 120 words"。 */
  word_requirement_raw?: string;
  topic?: string;
}

/**
 * 小題標註。哪些欄位適用取決於所屬大題的 type（不是小題的 mode），
 * 單靠小題本身無法判斷，所以合併成一個「全部選填」的型別，使用時依 section.type 取用。
 * 每種大題實際允許的欄位見 QUESTION_TAG_KEYS_BY_SECTION（validator 對其他欄位報 error）。
 */
export type QuestionTags = ChoiceQuestionTags &
  ReadingQuestionTags &
  StructureQuestionTags &
  TranslationQuestionTags &
  CompositionQuestionTags;

type QuestionTagKey = keyof QuestionTags;
const CHOICE_TAG_KEYS = [
  'test_point',
  'answer_pos',
  'answer_function',
  'grammar_point',
  'grammar_point_raw',
  'key_phrase',
] as const satisfies readonly QuestionTagKey[];
const ITEM_TAG_KEYS = ['item_type', 'item_type_raw', 'key_phrase'] as const satisfies readonly QuestionTagKey[];

/** v1.1：各大題類型允許的小題 tags 欄位（與 tools/validate_exam.py 的 QUESTION_TAGS_BY_SECTION 相同）。 */
export const QUESTION_TAG_KEYS_BY_SECTION: Record<SectionType, readonly QuestionTagKey[]> = {
  vocabulary: CHOICE_TAG_KEYS,
  cloze: CHOICE_TAG_KEYS,
  word_bank: CHOICE_TAG_KEYS,
  sentence_matching: CHOICE_TAG_KEYS,
  structure: ['clue', 'clue_raw', 'key_phrase'],
  reading: ITEM_TAG_KEYS,
  mixed: ITEM_TAG_KEYS,
  short_answer: ITEM_TAG_KEYS,
  other: ITEM_TAG_KEYS,
  translation: ['patterns', 'topic'],
  composition: ['essay_type', 'paragraphs', 'word_count', 'word_requirement_raw', 'topic'],
};

/** 題組的文體。 */
export const GENRES = [
  'news',
  'expository',
  'narrative',
  'biography',
  'letter_email',
  'advertisement',
  'dialogue',
  'opinion',
  'instructions',
  'poem',
  'other',
] as const;
export type Genre = (typeof GENRES)[number];

/**
 * 題組的文本形式。v1.1 起由規則決定（見 expectedTextFormat）：有圖表又有選文＝mixed、
 * passage_parts 兩篇以上＝multi_text、只有圖表＝圖表種類、其他＝continuous。
 */
export const TEXT_FORMATS = ['continuous', 'chart', 'table', 'multi_text', 'map', 'form', 'timeline', 'mixed'] as const;
export type TextFormat = (typeof TEXT_FORMATS)[number];

/** 聯合國永續發展目標編號 1–17。 */
export type SdgNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;

export interface GroupTags {
  /** 英文短語，例如 "plastic pollution"。 */
  topic?: string;
  genre?: Genre;
  /** 相關的 SDG 編號，沒有就空陣列。 */
  sdgs?: SdgNumber[];
  text_format?: TextFormat;
}

// ---------------------------------------------------------------------------
// 文字標記
// ---------------------------------------------------------------------------

/** v1.1：文字中允許的強調標記，只有 <u>…</u>（底線）與 <b>…</b>（粗體），而且只在題目會用到時使用。 */
export const ALLOWED_MARKUP_TAGS = ['u', 'b'] as const;
export type MarkupTag = (typeof ALLOWED_MARKUP_TAGS)[number];

const MARKUP_TOKEN = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>/g;

/**
 * 檢查強調標記：只允許不帶屬性的 <u>、<b>，必須成對、不可交錯、不可自我巢狀、內容不可為空。
 * 沒問題回傳 null，否則回傳說明（與 tools/validate_exam.py 的 markup_problem 規則相同）。
 */
export function markupProblem(text: string): string | null {
  const stack: { name: string; end: number }[] = [];
  for (const m of text.matchAll(MARKUP_TOKEN)) {
    const [token, slash, name = '', attrs = ''] = m;
    if (!(ALLOWED_MARKUP_TAGS as readonly string[]).includes(name) || attrs.trim() !== '') {
      return `不允許的標記 ${token}`;
    }
    const at = m.index ?? 0;
    if (slash === '') {
      if (stack.some((s) => s.name === name)) return `<${name}> 巢狀在另一個 <${name}> 裡`;
      stack.push({ name, end: at + token.length });
      continue;
    }
    const top = stack.pop();
    if (!top || top.name !== name) return `</${name}> 沒有對應的開頭標記，或標記交錯`;
    if (text.slice(top.end, at).trim() === '') return `<${name}></${name}> 內容是空的`;
  }
  const open = stack.at(-1);
  return open ? `<${open.name}> 沒有結尾標記` : null;
}

/** 去掉強調標記，留下純文字。 */
export function stripMarkup(text: string): string {
  return text.replace(MARKUP_TOKEN, '');
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 是否為用選項作答的小題（answer 一定是選項代號或代號陣列）。 */
export function isChoiceQuestion(q: Question): q is SingleChoiceQuestion | MultiSelectQuestion {
  return (CHOICE_MODES as readonly QuestionMode[]).includes(q.mode);
}

/** 依出現順序取出選文中的空格題號，例如 "a [[11]] b [[12]]" → [11, 12]。 */
export function blankNumbers(text: string): number[] {
  return Array.from(text.matchAll(BLANK_PATTERN), (m) => Number(m[1]));
}

/** v1.1：大題是否各自從 1 編號（翻譯、作文、簡答，以及只有非選擇作答的 other）。 */
export function isIndependentlyNumbered(section: Pick<ExamSection, 'type' | 'groups'>): boolean {
  if ((INDEPENDENTLY_NUMBERED_SECTION_TYPES as readonly SectionType[]).includes(section.type)) return true;
  if (section.type !== 'other') return false;
  const questions = section.groups.flatMap((g) => g.questions);
  return questions.length > 0 && questions.every((q) => !isChoiceQuestion(q));
}

const isAlnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * needle 在 text 中每一次出現的起始位置。needle 以字母／數字開頭（結尾）時，前（後）一個字元不可是字母／數字，
 * 所以找 "it" 不會算到 "with" 裡的 it。RefersTo.occurrence 依這個定義計數（第 1 次是陣列的第 0 個）。
 */
export function findOccurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (needle === '') return out;
  const checkStart = isAlnum(needle[0]);
  const checkEnd = isAlnum(needle.at(-1));
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    if (checkStart && isAlnum(text[i - 1])) continue;
    if (checkEnd && isAlnum(text[i + needle.length])) continue;
    out.push(i);
  }
  return out;
}

/** 題組選文（refers_to 計數的範圍）：passage 接著各 passage_parts.text，以換行相接，去掉強調標記。 */
export function groupText(group: Pick<QuestionGroup, 'passage' | 'passage_parts'>): string {
  const texts = [group.passage ?? '', ...(group.passage_parts ?? []).map((p) => p.text)];
  return stripMarkup(texts.filter((t) => t !== '').join('\n'));
}

/** 找出 refers_to 在選文中的位置（[start, end)）；找不到（資料錯誤）回傳 null。 */
export function locateRefersTo(
  group: Pick<QuestionGroup, 'passage' | 'passage_parts'>,
  refersTo: RefersTo,
): [number, number] | null {
  const start = findOccurrences(groupText(group), refersTo.text)[refersTo.occurrence - 1];
  return start === undefined ? null : [start, start + refersTo.text.length];
}

/** answer_segments 的串接規則：略過空字串、以單一空格相接、逗號句號等標點前不留空格。 */
export function joinAnswerSegments(parts: readonly string[]): string {
  return parts
    .filter((p) => p !== '')
    .join(' ')
    .replace(/\s+([,.;:?!])/g, '$1');
}

/**
 * 展開 answer_segments 的所有組合（依段落順序、每段依選項順序）。組合數可能很大（數百種），
 * 超過 limit 就停止並只回傳前 limit 種；第一種一定是「各段第一個選項」。
 */
export function expandAnswerSegments(segments: readonly (readonly string[])[], limit = 1000): string[] {
  const out: string[] = [];
  const pick: string[] = [];
  const walk = (i: number): void => {
    if (out.length >= limit) return;
    if (i === segments.length) {
      out.push(joinAnswerSegments(pick));
      return;
    }
    for (const option of segments[i] ?? []) {
      pick.push(option);
      walk(i + 1);
      pick.pop();
      if (out.length >= limit) return;
    }
  };
  if (segments.length > 0) walk(0);
  return out;
}

const TEXT_FORMAT_BY_FIGURE: Partial<Record<string, TextFormat>> = {
  chart: 'chart',
  graph: 'chart',
  diagram: 'chart',
  table: 'table',
  map: 'map',
  form: 'form',
  timeline: 'timeline',
};

/**
 * v1.1 的 text_format 規則（翻譯、作文題組不適用）：有圖表又有選文＝mixed；passage_parts 兩篇以上＝multi_text；
 * 只有圖表沒有連續選文＝圖表種類（chart、table、map、form、timeline）；其他有選文＝continuous。
 * 沒有選文也沒有圖表，或圖表種類對不上時回傳 null。
 */
export function expectedTextFormat(group: Pick<QuestionGroup, 'passage' | 'passage_parts' | 'figures'>): TextFormat | null {
  const parts = group.passage_parts ?? [];
  const hasText = (group.passage ?? '').trim() !== '' || parts.length > 0;
  const figures = group.figures;
  if (!hasText && figures.length === 0) return null;
  if (figures.length > 0 && hasText) return 'mixed';
  if (parts.length >= 2) return 'multi_text';
  if (figures.length > 0) {
    const kinds = new Set(figures.map((f) => TEXT_FORMAT_BY_FIGURE[f.kind] ?? null));
    const [only] = kinds;
    return kinds.size === 1 && only ? only : null;
  }
  return 'continuous';
}
