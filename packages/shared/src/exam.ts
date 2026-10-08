/**
 * 歷屆試題 JSON（gsat-exam/v1）的 TypeScript 型別。
 *
 * 唯一的規格來源是 docs/exam-json-schema.md；Python 檢查工具 tools/validate_exam.py 依同一份文件實作。
 * 這裡的列舉值都寫成 `as const` 陣列再推導出字面值聯集，原因是：
 *   1. 型別與執行期常數只寫一次，不會走鐘（測試、匯入 D1 的腳本、前端篩選器都能直接拿陣列用）。
 *   2. 規格文件改了列舉值，只要改這裡一處，所有用到的 switch 都會被 tsc 抓出漏掉的分支。
 *
 * 規格文件標「例如」的欄位（grammar_point、clue、figure.kind）沒有封閉的值域，
 * 用「已知值｜任意字串」表示：編輯器仍會提示已知值，但解析者標了新值也不會被型別擋下。
 */

/** 開放值域：保留已知字面值的自動完成，同時接受其他字串。`string & {}` 是讓聯集不被併成 string 的慣用寫法。 */
export type OpenString<Known extends string> = Known | (string & {});

/** 檔案頂層的 schema 識別字串。 */
export const EXAM_SCHEMA_ID = 'gsat-exam/v1';
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
  /** 答案檔。 */
  answer: string[];
  /** 非選擇題評分原則。 */
  scoring: string[];
  /** 答對率、鑑別度等統計檔。 */
  stats: string[];
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
  groups: QuestionGroup[];
}

// ---------------------------------------------------------------------------
// group（題組）
// ---------------------------------------------------------------------------

/**
 * 選項代號：單一大寫字母。規格文件沒有限制上限，這裡列到實際題本出現過的最大值：
 * 現制文意選填 A–J、句子配合題最多 12 個，83 學年度學測的「文意閱讀選填」印了 15 個選項（A–O，
 * 見 data/exams/parsed/gsat-83.json 的 extraction.issues）。
 * tools/validate_exam.py 目前只接受 A–L，要放寬成 A–O 才會和這裡一致；之後若有題本超過 O，兩邊一起擴充。
 */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'] as const;
export type OptionLetter = (typeof OPTION_LETTERS)[number];

/** `{ "A": "hasty", "B": "tight", ... }`。不是每個字母都會出現，所以用 Partial。 */
export type OptionMap = Partial<Record<OptionLetter, string>>;

/** 多文本選文的一段，例如閱讀測驗的文本 A／B。 */
export interface PassagePart {
  label: string;
  title: string | null;
  text: string;
}

/** 圖表種類：規格只舉例 table 並說明「圖、表、地圖、海報」，解析資料另外出現 image／picture／photo。 */
export type FigureKind = OpenString<'table' | 'chart' | 'map' | 'poster' | 'image' | 'picture' | 'photo'>;

/** 圖、表、地圖、海報：一律用文字完整描述，表格要轉成 rows。 */
export interface Figure {
  kind: FigureKind;
  caption: string | null;
  description: string;
  /** 表格內容（第一列通常是表頭）；不是表格就是 null 或省略。 */
  rows?: string[][] | null;
}

/** 選文中的空格標記 [[題號]]。用 matchAll 取出全部題號；有 g 旗標，不要拿去呼叫 test()，以免 lastIndex 殘留。 */
export const BLANK_PATTERN = /\[\[(\d+)\]\]/g;

export interface QuestionGroup {
  /** 例如 "s2g1"。 */
  id: string;
  /** 選文；空格一律寫成 [[題號]]。詞彙題這種單題形式沒有選文，為 null。 */
  passage: string | null;
  /** 多文本選文；沒有就是 null。 */
  passage_parts: PassagePart[] | null;
  figures: Figure[];
  /** word_bank／structure／sentence_matching 的共用選項庫；其他類型為 null。 */
  options_bank: OptionMap | null;
  questions: Question[];
  /**
   * 題組層級標註。沒有選文的題組（詞彙題、翻譯、作文）沒有可標的主題與文體，可能整個省略或為 null；
   * tools/validate_exam.py 也接受省略，所以型別標成選填，使用時要處理 undefined。
   */
  tags?: GroupTags | null;
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
}

/** 所有模式共用的欄位。 */
interface QuestionBase {
  /** 題號（整數）。混合題的 47A 寫 no: 47、label: "47A"。 */
  no: number;
  /** 題本上印的題號字串；整份考卷內不可重複。 */
  label: string;
  /** 題幹逐字；克漏字類沒有題幹就是 null。 */
  stem: string | null;
  /** 本題選項；用 options_bank 的題目、非選擇題為 null。 */
  options: OptionMap | null;
  /** 評分原則列出的其他可接受答案。 */
  accepted_answers: string[] | null;
  points: number | null;
  stats: QuestionStats | null;
  /** 非選擇題：評分原則中與本題相關的逐字內容。 */
  scoring_notes: string | null;
  /** 小題標註。原則是「不確定就省略、不要猜」，validate_exam.py 也接受整個省略，所以是選填。 */
  tags?: QuestionTags | null;
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

/** 填充、簡答、表格填空、翻譯：官方參考答案字串；翻譯沒公布參考譯文時為 null。 */
export interface OpenResponseQuestion extends QuestionBase {
  mode: 'fill_in_blank' | 'short_answer' | 'table_completion' | 'translation';
  answer: string | null;
}

/** 作文：沒有標準答案（範文不是官方答案），answer 固定為 null。 */
export interface CompositionQuestion extends QuestionBase {
  mode: 'composition';
  answer: null;
}

/** 以 mode 區分的小題聯集：`switch (q.mode)` 之後 answer 的型別會自動收窄。 */
export type Question = SingleChoiceQuestion | MultiSelectQuestion | OpenResponseQuestion | CompositionQuestion;

// ---------------------------------------------------------------------------
// 標註（tags）：解析時一併標上，不確定就省略該欄，不要猜。
// ---------------------------------------------------------------------------

/** 選擇題的考點（vocabulary／cloze／word_bank）。 */
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

/** 答案的詞性。 */
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

/** test_point 為 grammar 時的文法點；規格只舉例，所以是開放值域。 */
export const KNOWN_GRAMMAR_POINTS = [
  'relative_clause',
  'participle',
  'subjunctive',
  'tense',
  'passive',
  'inversion',
  'comparison',
  'infinitive_gerund',
  'conditional',
  'agreement',
] as const;
export type GrammarPoint = OpenString<(typeof KNOWN_GRAMMAR_POINTS)[number]>;

/** 閱讀、混合題的題目類型。 */
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

/** 篇章結構的解題線索；規格只舉例，所以是開放值域。 */
export const KNOWN_STRUCTURE_CLUES = [
  'pronoun_reference',
  'transition_word',
  'topic_sentence',
  'example',
  'contrast',
] as const;
export type StructureClue = OpenString<(typeof KNOWN_STRUCTURE_CLUES)[number]>;

/** 作文類型。 */
export const ESSAY_TYPES = ['picture', 'topic', 'letter', 'chart', 'two_paragraph', 'continuation', 'other'] as const;
export type EssayType = (typeof ESSAY_TYPES)[number];

/** 選擇題共通（vocabulary／cloze／word_bank）。 */
export interface ChoiceQuestionTags {
  test_point?: TestPoint;
  answer_pos?: AnswerPos;
  /** test_point 是 grammar 時填。 */
  grammar_point?: GrammarPoint;
  /** 答案涉及的片語或搭配，例如 "elbow one's way"。 */
  key_phrase?: string;
}

/** 閱讀、混合題。 */
export interface ReadingQuestionTags {
  item_type?: ItemType;
}

/** 篇章結構。 */
export interface StructureQuestionTags {
  clue?: StructureClue;
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
  /** 例如 "120 words"。 */
  word_requirement?: string;
  topic?: string;
}

/**
 * 小題標註。哪些欄位適用取決於所屬大題的 type（不是小題的 mode），
 * 單靠小題本身無法判斷，所以合併成一個「全部選填」的型別，使用時依 section.type 取用。
 */
export type QuestionTags = ChoiceQuestionTags &
  ReadingQuestionTags &
  StructureQuestionTags &
  TranslationQuestionTags &
  CompositionQuestionTags;

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

/** 題組的文本形式。 */
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
