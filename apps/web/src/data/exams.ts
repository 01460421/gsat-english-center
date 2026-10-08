/**
 * 歷屆試題資料：型別、常數與載入函式。
 *
 * 資料檔（scripts/build-data.mjs 產生，來源是 data/exams/parsed/*.json 與 data/exams/manifest.json）：
 *   /data/exams/index.json  ExamIndex   66 份考卷的摘要（gzip 約 3 KB），列表與篩選用
 *   /data/exams/{id}.json   Exam        一份考卷的完整內容（gzip 5–25 KB）
 *
 * 型別依 docs/exam-json-schema.md（gsat-exam/v1.1）自己寫在這裡，只寫前端用得到的欄位。
 * 不直接用 @gsat/shared 的 Exam：前端拿到的檔案已經去掉 sources、extraction、scoring_notes 等欄位，
 * 另外多了 official_files、verified、target，形狀本來就不同。
 * @gsat/shared 的純函式（stripMarkup、locateRefersTo、joinAnswerSegments…）參數只要求部分欄位，
 * 這裡的型別可以直接傳進去用。
 *
 * 和原始資料的差異（build-data.mjs 處理）：
 *   - 刪除 sources（repo 內部路徑）→ 改成 official_files（大考中心官方檔案網址）
 *   - 刪除 extraction（解析紀錄）→ 只留 verified（是否經過查證）
 *   - 刪除小題的 scoring_notes：評分原則全文受著作權保護，不能公開轉載（04 文件 §4），要看請連到官方評分原則
 *   - 刪除 section.stats.source 與 tags 中所有 *_raw 欄位（資料查核用的內部紀錄）
 */
import { DataLoadError, DATA_BASE_URL, fetchDataFile, isRecord, memoizeAsync } from './client';

// ---------------------------------------------------------------------------
// 列舉
// ---------------------------------------------------------------------------

/** gsat＝學科能力測驗；ast＝指定科目考試；reference＝參考試卷／試辦考試。 */
export type ExamKind = 'gsat' | 'ast' | 'reference';
export type ExamSession = 'regular' | 'makeup';

export const EXAM_KIND_LABELS: Record<ExamKind, string> = {
  gsat: '學測',
  ast: '指考',
  reference: '參考試卷',
};

/** 考卷 id：gsat-115、ast-109-makeup、ref-98-a。 */
export const EXAM_ID_PATTERN = /^(gsat|ast)-\d{2,3}(-makeup)?$|^ref-\d{2,3}(-[a-z])?$/;

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

/** 大題類型的通用名稱（各年題本的標題寫法不同，例如「詞彙與慣用語」，原文在 section.title）。 */
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

export type QuestionMode =
  | 'single_choice'
  | 'multi_select'
  | 'bank_choice'
  | 'fill_in_blank'
  | 'short_answer'
  | 'table_completion'
  | 'translation'
  | 'composition';

/** 選項代號。現制文意選填 A–J、舊制句子配合題到 L，83 學年度學測印到 O。 */
export type OptionLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O';
/** 選項文字；依字母順序排列。 */
export type OptionMap = Partial<Record<OptionLetter, string>>;

// ---------------------------------------------------------------------------
// index.json
// ---------------------------------------------------------------------------

export interface SectionSummary {
  id: string;
  type: SectionType;
  /** 題本原文，例如「一、詞彙題（占10分）」。 */
  title: string;
  question_count: number;
  points_total: number | null;
  /** 有大考中心統計：小題答對率／鑑別度，或（非選擇題）大題分數分布。 */
  has_stats: boolean;
}

export interface ExamSummary {
  id: string;
  exam: ExamKind;
  /** 學年度（民國）。 */
  year: number;
  session: ExamSession;
  /** 題本標題，例如「115學年度學科能力測驗英文考科」。 */
  title: string;
  time_minutes: number | null;
  full_score: number;
  /** 參考試卷對應的考試（gsat／ast）；正式考試是 null。 */
  target: 'gsat' | 'ast' | null;
  /** 內容經過第二人逐字查證。 */
  verified: boolean;
  /** 小題數（混合題的 47A、47B 各算一題）。 */
  question_count: number;
  has_stats: boolean;
  sections: SectionSummary[];
}

/**
 * /data/exams/index.json。exams 已排序：學測 → 指考 → 參考試卷，各自依學年度由新到舊，同年正式考試在補考前。
 */
export interface ExamIndex {
  version: string;
  count: number;
  exams: ExamSummary[];
}

// ---------------------------------------------------------------------------
// {id}.json
// ---------------------------------------------------------------------------

/** 大考中心官方檔案（題本、答案、評分原則、統計）。 */
export interface OfficialFile {
  /** 原始資料 sources 的欄位名稱。 */
  kind: 'paper' | 'paper_word' | 'answer' | 'scoring' | 'stats' | 'answer_sheet' | 'other';
  /** 大考中心的檔案類別（pd_table、option_analysis、nonmc_score_dist、cover、exam_spec…）。 */
  subkind: string;
  /** 畫面上的檔案名稱，例如「試題（PDF）」「非選擇題評分原則」。 */
  label: string;
  /** pdf、doc、docx、xls… */
  format: string;
  url: string;
}

/** 題本的「部分」（第壹部分：選擇題…）。 */
export interface ExamPart {
  /** 題本印的部分標題；沒有記錄是 null。 */
  title: string | null;
  points: number | null;
  /** 部分層級的說明，逐字。 */
  instructions: string | null;
  /** 屬於這個部分的大題 id。 */
  sections: string[];
}

export interface ScoreBin {
  /** 原表的分數區間字串，例如 "8.00-8.99"；缺考列是 "缺考"。 */
  range: string;
  min?: number | null;
  max?: number | null;
  count: number;
  /** 人數比例（0–1）。 */
  rate?: number | null;
  cumulative_count?: number | null;
  cumulative_rate?: number | null;
}

/** 大題層級統計：大考中心只公布非選擇題「一大題」的分數人數分布，拆不到小題。 */
export interface SectionStats {
  max_score?: number | null;
  /** 報名人數（含缺考）。 */
  registered?: number | null;
  absent?: number | null;
  /** 到考人數。 */
  examinees?: number | null;
  /** 比例的分母說明。 */
  rate_base?: string | null;
  note?: string | null;
  score_distribution: ScoreBin[];
}

export interface PassagePart {
  /** 題本印的段落代號（"A"、"B"）；沒印是 null，畫面上要顯示時用順序補。 */
  label: string | null;
  title: string | null;
  text: string;
}

/**
 * 圖、表、地圖、海報：題本的圖一律已轉成文字描述（沒有圖檔），表格另外有 rows。
 * kind 是開放值域（table、chart、map、poster、image、picture、photo、illustration、diagram、advertisement、other…），
 * 依 kind 排版時一定要有預設分支。
 */
export interface Figure {
  kind: string;
  /** 題本上的標示，例如「連環圖片第1幅」。 */
  label?: string | null;
  caption: string | null;
  description: string;
  /** 表格內容，第一列通常是表頭。 */
  rows?: string[][] | null;
  /** 圖只屬於某一小題時的題號。 */
  question_no?: number | null;
}

export type Genre =
  | 'news'
  | 'expository'
  | 'narrative'
  | 'biography'
  | 'letter_email'
  | 'advertisement'
  | 'dialogue'
  | 'opinion'
  | 'instructions'
  | 'poem'
  | 'other';
export type TextFormat = 'continuous' | 'chart' | 'table' | 'multi_text' | 'map' | 'form' | 'timeline' | 'mixed';

export interface GroupTags {
  /** 主題（英文短語）。 */
  topic?: string;
  genre?: Genre;
  /** 相關的聯合國永續發展目標編號（1–17）。 */
  sdgs?: number[];
  text_format?: TextFormat;
}

export interface QuestionGroup {
  id: string;
  /** 題本印的題組標示，例如「第41至44題為題組」。 */
  group_label?: string | null;
  /**
   * 選文；空格寫成 [[題號]]，段落以 "\n" 分隔（詩以 "\n\n" 分節）。
   * 可能含 <u>…</u>、<b>…</b>（只在題目問「畫底線／粗體的字」時使用），其他都是純文字，不要用 innerHTML 顯示。
   */
  passage: string | null;
  passage_parts: PassagePart[] | null;
  figures: Figure[];
  /** 文意選填、篇章結構、句子配合題的共用選項庫；其他類型是 null。 */
  options_bank: OptionMap | null;
  questions: Question[];
  /** 沒有選文可標（詞彙題、翻譯、作文）時是 null。 */
  tags: GroupTags | null;
}

export interface QuestionStats {
  /** 答對率（0–1）；多選題是「得分率」。 */
  correct_rate?: number | null;
  /** 高分組、低分組通過率。 */
  high_group?: number | null;
  low_group?: number | null;
  /** 鑑別度（-1–1）。 */
  discrimination?: number | null;
  /** 全體考生各選項的選答比例。 */
  option_rates?: Partial<Record<OptionLetter, number>> | null;
  option_rates_high?: Partial<Record<OptionLetter, number>> | null;
  option_rates_low?: Partial<Record<OptionLetter, number>> | null;
  /** 未作答比例。 */
  omit_rate?: number | null;
  /** 多選題全對比例。 */
  full_correct_rate?: number | null;
  /** 五等分組通過率，由高分組到低分組，固定 5 個數字。 */
  five_groups?: number[] | null;
}

export type TestPoint = 'word_meaning' | 'collocation' | 'phrase' | 'connective' | 'grammar' | 'word_form' | 'discourse';
export type AnswerPos = 'noun' | 'verb' | 'adjective' | 'adverb' | 'preposition' | 'conjunction' | 'pronoun' | 'phrase' | 'clause';
export type AnswerFunction = Exclude<AnswerPos, 'phrase' | 'clause'>;
export type GrammarPoint =
  | 'tense'
  | 'passive'
  | 'participle'
  | 'relative_clause'
  | 'noun_clause'
  | 'adverb_clause'
  | 'conditional'
  | 'subjunctive'
  | 'inversion'
  | 'comparison'
  | 'infinitive_gerund'
  | 'modal'
  | 'agreement'
  | 'pronoun'
  | 'determiner'
  | 'article'
  | 'preposition'
  | 'conjunction'
  | 'parallel_structure'
  | 'with_construction'
  | 'causative'
  | 'emphasis'
  | 'existential'
  | 'substitution'
  | 'degree'
  | 'other';
export type ItemType =
  | 'main_idea'
  | 'detail'
  | 'inference'
  | 'vocab_in_context'
  | 'reference'
  | 'purpose'
  | 'tone_attitude'
  | 'structure'
  | 'chart_reading'
  | 'sequencing'
  | 'title'
  | 'not_mentioned'
  | 'application'
  | 'synthesis';
export type StructureClue =
  | 'pronoun_reference'
  | 'lexical_cohesion'
  | 'transition_word'
  | 'topic_sentence'
  | 'contrast'
  | 'example'
  | 'elaboration'
  | 'enumeration'
  | 'summary'
  | 'chronology'
  | 'other';
export type EssayType = 'picture' | 'chart' | 'letter' | 'topic' | 'continuation' | 'other';

export const TEST_POINT_LABELS: Record<TestPoint, string> = {
  word_meaning: '詞義',
  collocation: '搭配詞',
  phrase: '片語／慣用語',
  connective: '轉折詞／連接詞',
  grammar: '文法',
  word_form: '詞性／字形',
  discourse: '上下文邏輯',
};

/** 作文字數要求：approx 與 min／max 互斥。 */
export interface WordCount {
  min: number | null;
  max: number | null;
  approx: number | null;
}

/**
 * 小題標註。哪些欄位會出現取決於所屬大題的 type（不是小題的 mode）：
 *   vocabulary／cloze／word_bank／sentence_matching：test_point、answer_pos、answer_function、grammar_point、key_phrase
 *   structure：clue、key_phrase
 *   reading／mixed／short_answer／other：item_type、key_phrase
 *   translation：patterns、topic
 *   composition：essay_type、paragraphs、word_count、topic
 * 標註者不確定就省略，所以全部選填。
 */
export interface QuestionTags {
  test_point?: TestPoint;
  answer_pos?: AnswerPos;
  /** answer_pos 為 phrase 時，片語在句中的功能詞性。 */
  answer_function?: AnswerFunction;
  grammar_point?: GrammarPoint;
  /** 答案涉及的片語或搭配，例如 "elbow one's way"。 */
  key_phrase?: string;
  item_type?: ItemType;
  clue?: StructureClue;
  /** 翻譯的核心句型，例如 "not only ... but also"。 */
  patterns?: string[];
  topic?: string;
  essay_type?: EssayType;
  /** 作文要求段數。 */
  paragraphs?: number;
  word_count?: WordCount;
}

/** 題幹指涉的選文字串，前端用來高亮（@gsat/shared 的 locateRefersTo() 可以算出位置）。 */
export interface RefersTo {
  text: string;
  /** 在題組選文中第幾次出現（從 1 起算）。 */
  occurrence: number;
  note?: string | null;
}

/** all_credit＝送分；multiple_correct＝官方公告多個答案皆給分（其他答案在 accepted_answers）；other＝其他（看 note）。 */
export interface ScoringException {
  type: 'all_credit' | 'multiple_correct' | 'other';
  note?: string | null;
}

/** 參考試卷沿用歷屆試題時的出處。 */
export interface ReusedFrom {
  exam: string;
  /** 原卷同類大題中的題號。 */
  no: number;
  /** 與原題的差異；逐字相同是 null。 */
  modified: string | null;
}

interface QuestionBase {
  /** 題號。選擇題與混合題整份卷連續；翻譯、作文、簡答是大題內序號（1、2…）。混合題 47A／47B 共用 no。 */
  no: number;
  /** 題本印的題號，整份卷內不重複，畫面上顯示這個：例如 "11"、"47A"、"中譯英1"、"英文作文"。 */
  label: string;
  /**
   * 題幹逐字；克漏字、文意選填等沒有題幹的是 null（題目就是選文裡的 [[題號]] 空格）。
   * 和 passage 一樣可能含 <u>／<b>，也可能有 [[題號]]（混合題的摘要句填空）。
   */
  stem: string | null;
  /** 本題自己的選項；使用 options_bank 的題目與非選擇題是 null。 */
  options: OptionMap | null;
  /** 評分原則列出的其他可接受答案（填充的其他寫法、選擇題官方也接受的代號）。中譯英沒有這個欄位（見 TranslationQuestion）。 */
  accepted_answers: string[] | null;
  points: number | null;
  stats: QuestionStats | null;
  tags: QuestionTags;
  refers_to?: RefersTo;
  scoring_exception?: ScoringException;
  reused_from?: ReusedFrom;
}

/** 單選（single_choice）與從選項庫選（bank_choice，文意選填／篇章結構／句子配合）。 */
export interface ChoiceQuestion extends QuestionBase {
  mode: 'single_choice' | 'bank_choice';
  answer: OptionLetter;
}

/** 多選（混合題）：答案是字母陣列。 */
export interface MultiSelectQuestion extends QuestionBase {
  mode: 'multi_select';
  answer: OptionLetter[];
}

/** 填充、簡答：官方參考答案；官方沒公布是 null。 */
export interface OpenResponseQuestion extends QuestionBase {
  mode: 'fill_in_blank' | 'short_answer';
  answer: string | null;
}

/** 表格填寫。 */
export interface TableCompletionQuestion extends QuestionBase {
  mode: 'table_completion';
  answer: string | null;
  /** 完整答案表（第一列為表頭）。 */
  answer_table?: string[][];
}

/**
 * 中譯英。公開的資料檔不含任何官方參考譯文：scripts/build-data.mjs 刪掉 answer、accepted_answers、
 * answer_segments、answer_variants、answer_is_composite，而且輸出時再檢查一次（站主決定 D8，docs/ROADMAP.md）。
 * 原始資料（data/exams/parsed）仍保留，之後只在後端當 AI 批改的參考；畫面上改附官方評分原則的連結。
 * 型別刻意沒有這些欄位，前端程式不會不小心讀到或顯示官方譯文。
 */
export interface TranslationQuestion extends Omit<QuestionBase, 'accepted_answers'> {
  mode: 'translation';
}

/** 作文：沒有標準答案。 */
export interface CompositionQuestion extends QuestionBase {
  mode: 'composition';
  answer: null;
}

/** 以 mode 區分的小題聯集：`switch (q.mode)` 之後 answer 的型別會自動收窄。 */
export type Question =
  | ChoiceQuestion
  | MultiSelectQuestion
  | OpenResponseQuestion
  | TableCompletionQuestion
  | TranslationQuestion
  | CompositionQuestion;

export interface ExamSection {
  id: string;
  type: SectionType;
  /** 題本原文，例如「一、詞彙題（占10分）」。 */
  title: string;
  /** 題本原文的部分名稱（選擇題／混合題／非選擇題…）；舊卷沒有是 null。 */
  part: string | null;
  /** 作答說明，逐字。 */
  instructions: string;
  points_total: number | null;
  stats?: SectionStats;
  groups: QuestionGroup[];
}

/** /data/exams/{id}.json：一份完整考卷。 */
export interface Exam {
  schema: 'gsat-exam/v1.1';
  id: string;
  exam: ExamKind;
  year: number;
  session: ExamSession;
  title: string;
  /** 作答時間（分鐘）；題本沒印是 null。 */
  time_minutes: number | null;
  full_score: number;
  target: 'gsat' | 'ast' | null;
  verified: boolean;
  /** 大考中心的官方檔案；每份試題頁都要標示出處並連到這裡（04 文件 §7.1）。 */
  official_files: OfficialFile[];
  /** 題本的部分標題與說明；沒有記錄就省略。 */
  parts?: ExamPart[];
  sections: ExamSection[];
}

// ---------------------------------------------------------------------------
// 載入
// ---------------------------------------------------------------------------

function isExamIndex(body: unknown): body is ExamIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.exams);
}

const indexLoader = memoizeAsync((_key: 'index') => fetchDataFile('exams/index.json', isExamIndex));
const examLoader = memoizeAsync((id: string) => {
  // 格式檢查放在快取裡面：格式不對的 id 也要每次拿到同一個失敗的 Promise，交給 use() 時才不會每次繪製都是新的
  // Promise、讓 Suspense 一直重來（理由見 client.ts 檔頭）。
  if (!EXAM_ID_PATTERN.test(id)) {
    return Promise.reject(new DataLoadError('not_found', `${DATA_BASE_URL}exams/${encodeURIComponent(id)}.json`, null));
  }
  return fetchDataFile(
    `exams/${id}.json`,
    // 檢查 id 與 schema：避免拿到舊格式的快取，或 id 對不上的檔案。
    (body: unknown): body is Exam =>
      isRecord(body) && body.schema === 'gsat-exam/v1.1' && body.id === id && Array.isArray(body.sections),
  );
});

/** 載入考卷列表（同一頁面內只會下載一次）。 */
export function loadExamIndex(): Promise<ExamIndex> {
  return indexLoader('index');
}

/**
 * 載入一份考卷。id 通常來自網址參數，先用 EXAM_ID_PATTERN 擋掉格式不對的（不發請求，直接當成找不到），
 * 免得 ../ 之類的字串被拼進網址。
 */
export function loadExam(id: string): Promise<Exam> {
  return examLoader(id);
}

// ---------------------------------------------------------------------------
// 顯示用小工具
// ---------------------------------------------------------------------------

/**
 * 考卷的短名稱：「115 學測」「109 指考補考」「111 參考試卷（學測）」。
 * 參考試卷的 title 很長（「學科能力測驗參考試卷（111學年度起適用）英文考科」），列表上用這個比較好排。
 */
export function examShortName(e: Pick<ExamSummary, 'exam' | 'year' | 'session' | 'target'>): string {
  const makeup = e.session === 'makeup' ? '補考' : '';
  if (e.exam === 'reference') {
    return `${e.year} 參考試卷${e.target ? `（${EXAM_KIND_LABELS[e.target]}）` : ''}`;
  }
  return `${e.year} ${EXAM_KIND_LABELS[e.exam]}${makeup}`;
}

/** 依序列出考卷的所有小題（含所屬大題與題組），練習模式逐題作答時用。 */
export function* iterateQuestions(exam: Exam): Generator<{ section: ExamSection; group: QuestionGroup; question: Question }> {
  for (const section of exam.sections) {
    for (const group of section.groups) {
      for (const question of group.questions) yield { section, group, question };
    }
  }
}
