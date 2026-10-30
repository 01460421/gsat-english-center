/**
 * 學習助手（拍照或貼上題目、站內錯題解析、追問、學習報告）的 API 型別、常數與前後端共用的純函式
 * （docs/design/learning-assistant.md §4.2）。
 *
 * 分工：
 *   - 前端只送「哪一題、學生答什麼」（AssistSourceRef），題目內容由 Worker 自己從網站的公開題目檔讀（§4.5）；
 *     對錯由 assistVerdict 用網站同一支計分函式判定（exam-scoring.ts），學生在網站上看到的判定和學習助手一致。
 *   - 學生提供的題目（拍照確認後、貼上）是不可信的資料：checkAssistQuestion 前後端各跑一次（§4.4），
 *     Worker 另外比對 D8 指紋（official_material 只會從 API 回來）。
 *   - 模型輸出的 zod schema 在 Worker（apps/api/src/assist/analysisSchemas.ts），這裡只放程式後處理之後給畫面的形狀
 *     （AssistAnalysisView 等），欄位與上限依 §2.1、§2.5–§2.8。
 * JSON 欄位一律 snake_case（和資料庫、既有共用型別一致）。
 *
 * 獨立成一個模組（由 index.ts 直接轉匯出，不經 writing.ts）：只有學習助手的頁面與入口按鈕用到，不要跟著 writing.ts
 * 進到首頁的主程式（理由同 custom-essay.ts）。
 */
import type { AssistDetectedSubject, AssistSubject } from './assist-subjects';
import {
  checkZhQuestion,
  type ZhAnalysisView,
  type ZhCaseKind,
  type ZhCharLimit,
  type ZhChoiceMode,
  type ZhFollowupView,
  type ZhFormat,
  type ZhJudgeLabels,
  type ZhSection,
} from './assist-zh';
import type { ExplanationItem } from './bank';
import { EXAM_ID_PATTERN, type OptionLetter, type QuestionMode } from './exam';
import { GROUP_KEY_PATTERN } from './bank-practice-file';
import {
  CUSTOM_PROMPT_MASK,
  CUSTOM_PROMPT_STRUCTURAL_TAGS,
  customPromptEnglishWords,
  firstBadCharacter,
  markupHits,
  normalizeCustomPromptText,
  officialLikeHits,
  referenceAnswerHits,
  requestToAiHits,
} from './custom-essay';
import {
  isAnswered,
  normalizeBankOpenAnswer,
  normalizeOpenAnswer,
  normalizeOpenAnswerCased,
  scoreQuestion,
  type AnswerValue,
  type MultiSelectScorable,
  type SingleChoiceScorable,
} from './exam-scoring';
import type { Tier } from './tiers';
import { countEnglishWords, type AiRefundReason, type AiTask, type SubmissionKind } from './writing';
import { EMAIL_RE, PHONE_RE } from './writing-mechanics';

// ───────────────────────── 任務、來源、大題 ─────────────────────────

/** 學習助手的四個 AI 任務（代號同時登記在 writing.ts 的 AI_TASKS）。 */
export const ASSIST_TASKS = ['assist_ocr', 'assist_analyze', 'assist_followup', 'assist_report'] as const satisfies readonly AiTask[];
export type AssistTask = (typeof ASSIST_TASKS)[number];

/** 這個任務代號是不是學習助手的任務（consumer 依它分流，housekeeping 依它分開回收）。 */
export function isAssistTask(task: string): task is AssistTask {
  return (ASSIST_TASKS as readonly string[]).includes(task);
}

/** 大題（含單字、文法與「其他」：學生提供的題目由模型判斷，站內題由程式決定）。 */
export const ASSIST_SECTIONS = [
  'vocabulary',
  'cloze',
  'word_bank',
  'structure',
  'reading',
  'mixed',
  'translation',
  'composition',
  'vocab_word',
  'grammar',
  'other',
] as const;
export type AssistSection = (typeof ASSIST_SECTIONS)[number];

export const ASSIST_SECTION_LABELS: Record<AssistSection, string> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀測驗',
  mixed: '混合題',
  translation: '中譯英',
  composition: '英文作文',
  vocab_word: '單字',
  grammar: '文法',
  other: '其他',
};

export const ASSIST_SOURCES = ['bank', 'bank_mock', 'exam', 'vocab', 'writing', 'photo', 'typed'] as const;
export type AssistSource = (typeof ASSIST_SOURCES)[number];

/** 英文的解析種類：由來源決定，不由模型判斷。 */
export type AssistEnglishCaseKind = 'item' | 'writing' | 'vocab';

/**
 * 解析的種類：決定用哪一個輸出 schema（§2.1）。英文由來源決定；國文由格式決定（zh_choice／zh_short／zh_writing，
 * docs/design/assistant-subjects.md §2.1）。都不由模型判斷。
 */
export type AssistCaseKind = AssistEnglishCaseKind | ZhCaseKind;

/**
 * 來源 → 解析的種類。國文（只有拍照、貼上兩種來源）依格式：選擇 zh_choice、簡答 zh_short、國寫 zh_writing（沒指定是選擇）。
 * 沒帶科目或是英文時，回傳值和原本完全相同。
 */
export function assistCaseKindOf(source: AssistSource, subject?: AssistSubject, format?: ZhFormat | null): AssistCaseKind {
  if (subject === 'chinese' && (source === 'photo' || source === 'typed')) return format === 'short' ? 'zh_short' : format === 'writing' ? 'zh_writing' : 'zh_choice';
  if (source === 'writing') return 'writing';
  if (source === 'vocab') return 'vocab';
  return 'item';
}

/** 學生勾的疑問種類（會進提示，所以也在共用快取鍵裡；自由輸入的疑問讓請求不能進快取）。 */
export const ASSIST_DOUBT_KINDS = ['why_not_mine', 'torn_between', 'guessed', 'sentence_unclear', 'unknown_word', 'faster_method'] as const;
export type AssistDoubtKind = (typeof ASSIST_DOUBT_KINDS)[number];

export const ASSIST_DOUBT_LABELS: Record<AssistDoubtKind, string> = {
  why_not_mine: '為什麼不是我選的',
  torn_between: '我在兩個選項之間猶豫',
  guessed: '我是猜的',
  sentence_unclear: '這句看不懂',
  unknown_word: '有不認得的字',
  faster_method: '想知道更快的解法',
};

/** 填充、簡答：Worker 判不出來的部分，採用學生裝置上的判分（只收這兩個值，標「依你裝置上的判分」）。 */
export type AssistClientStatus = 'partial' | 'wrong';
export const ASSIST_CLIENT_STATUSES = ['partial', 'wrong'] as const satisfies readonly AssistClientStatus[];

/** 單字錯題的測驗題型（錯題本的 last_mode）。 */
export const ASSIST_VOCAB_MODES = ['en2zh', 'zh2en', 'spelling', 'cloze'] as const;
export type AssistVocabMode = (typeof ASSIST_VOCAB_MODES)[number];

/** 前端送的「哪幾題、學生答了什麼」。站內來源不送任何題目文字。labels 是同一個題組裡的題號（排序、去重）。 */
export type AssistSourceRef =
  | { source: 'bank'; ref: string /* ai.rd.0a1b2c@3 */; labels: string[]; answers: Record<string, AnswerValue>; client_status?: Record<string, AssistClientStatus> }
  | {
      source: 'bank_mock';
      paper_id: string; // bk1-…（自組模擬考）或 bk2-…（學習助手加強卷）
      ref: string; // 這一組所在的題組版本
      labels: string[]; // 題組裡的原始題號
      label_map: Record<string, string>; // 原始題號 → 卷面題號（整組；值必須是 1–80 的整數字串、不重複）
      swap: [string, string] | null; // BankPaper.letterSwaps 的那一對原始題號 [q, r]；Worker 依兩題的答案字母交換
      answers: Record<string, AnswerValue>; // 鍵是原始題號，值是卷面字母
      client_status?: Record<string, AssistClientStatus>;
    }
  | { source: 'exam'; exam_id: string; labels: string[]; via: 'exam' | 'mock'; answers: Record<string, AnswerValue>; client_status?: Record<string, AssistClientStatus> }
  | { source: 'vocab'; entries: Array<{ entry_id: string; mode: AssistVocabMode; wrong_count: number }> } // 1–8 個
  | { source: 'writing'; submission_id: string }
  // 拍照、貼上才收前端的科目（白名單；沒帶＝英文，舊前端照舊）。站內題的科目由 Worker 依題目代號推出，前端不送。
  | { source: 'photo'; subject?: AssistSubject }
  | {
      source: 'typed';
      question: AssistStudentQuestion;
      subject?: AssistSubject;
      /** 「用同一份題目問另一部分」的前一個案例（同一位使用者、同一科、已確認題目；docs/design/assistant-subjects.md §1.6）。 */
      related_case_id?: string;
    };

/** 學生提供的題目區塊的種類。 */
export const ASSIST_BLOCK_KINDS = ['instructions', 'passage', 'question', 'options', 'student_mark', 'figure'] as const;
export type AssistBlockKind = (typeof ASSIST_BLOCK_KINDS)[number];
/** 要問的題的區塊（這幾種的 [[?]] 一定要處理掉；§2.5）。 */
export const ASSIST_TARGET_BLOCK_KINDS = ['question', 'options', 'student_mark'] as const satisfies readonly AssistBlockKind[];

export interface AssistQuestionBlock {
  kind: AssistBlockKind;
  /** 題號（文章與說明是 null）；≤ 8 字元。 */
  label: string | null;
  text: string;
}

/**
 * 學生提供的題目（打字是一個 question 區塊；拍照是確認後的區塊）。format 之後的欄位只有國文會送
 * （docs/design/assistant-subjects.md §7.2）；英文不送，英文的請求逐位元不變。
 */
export interface AssistStudentQuestion {
  blocks: AssistQuestionBlock[]; // 1–40 塊
  target_labels: string[]; // 要問的題號；只有一題時可以是空陣列
  student_answer?: string | null; // ≤ 300
  /** 國文的格式（程式預填；學生沒選時 checkZhQuestion 用 guessZhFormat 補上）。 */
  format?: ZhFormat;
  /** 選擇題的子模式（5 個選項預設多選）。 */
  choice_mode?: ZhChoiceMode;
  /** 學生的作答：題號（簡答可以是小題「34(1)」）→ 選擇題的字母（「AC」）或簡答的文字（每小題 ≤ 120 字）。 */
  answers?: Record<string, string>;
  /** 「我有講義答案」：只有選擇題，只收 A–E（簡答與國寫不收：可能是官方的表達型參考答案）。 */
  known_key?: Record<string, string>;
  /** 國寫附的一段（≤ 250 字；標成問題（一）的答案時 ≤ 80 字）。 */
  draft?: string;
  draft_target?: 'q1' | 'q2';
}

/** 作答當下的行為訊號（選填）。只存在案例上，給錯題清單與報告用；不進解析的提示（所以不影響共用快取）。 */
export interface AssistSignals {
  time_sec?: number;
  hints_used?: number;
  marked?: boolean;
  revealed?: boolean;
}

/** POST /api/assist/cases。 */
export interface CreateAssistCaseBody {
  source: AssistSourceRef;
  doubt_kinds?: AssistDoubtKind[];
  torn_with?: OptionLetter | null; // torn_between 的第二個選項（第一個是學生的答案）
  doubt?: string | null; // ≤ 500
  hint_first?: boolean;
  signals?: AssistSignals;
}

/** PUT /api/assist/cases/{id}/question：確認或修改學生提供的題目（拍照、打字）。 */
export interface UpdateAssistQuestionBody {
  question: AssistStudentQuestion;
  doubt_kinds?: AssistDoubtKind[];
  doubt?: string | null;
  hint_first?: boolean;
}

/** PATCH /api/assist/cases/{id}：懂了嗎、這則有錯、筆記（欄位省略＝不改）。 */
export interface PatchAssistCaseBody {
  understood?: AssistUnderstood | null;
  rating?: AssistRating | null;
  note?: string | null; // ≤ 200
  /** 國文已解析的單選題改成多選（0 點；畫面依已存的判定重算，不再呼叫 AI；docs/design/assistant-subjects.md §5.3）。 */
  choice_mode?: ZhChoiceMode;
}

/** POST /api/assist/cases/{id}/followups。 */
export interface CreateAssistFollowupBody {
  text: string; // ≤ 500
  mode: AssistFollowupMode;
  label?: string | null; // 題組裡的哪一題（null＝整組）
}

export const ASSIST_CASE_STATUSES = ['draft', 'ocr_queued', 'ocr_ready', 'ready', 'analyzing', 'analyzed', 'failed'] as const;
export type AssistCaseStatus = (typeof ASSIST_CASE_STATUSES)[number];
export const ASSIST_VERDICTS = ['correct', 'wrong', 'partial', 'unanswered', 'unknown'] as const;
export type AssistVerdict = (typeof ASSIST_VERDICTS)[number];
export type AssistVerdictBasis = 'program' | 'client' | 'none';
export const ASSIST_UNDERSTOOD = ['yes', 'partly', 'no'] as const;
export type AssistUnderstood = (typeof ASSIST_UNDERSTOOD)[number];
export const ASSIST_RATINGS = ['helpful', 'wrong', 'unclear'] as const;
export type AssistRating = (typeof ASSIST_RATINGS)[number];
export const ASSIST_FOLLOWUP_MODES = ['hint', 'explain'] as const;
export type AssistFollowupMode = (typeof ASSIST_FOLLOWUP_MODES)[number];
export const ASSIST_SAFETY_FLAGS = ['none', 'self_harm_risk', 'abuse_disclosure', 'other'] as const;
export type AssistSafetyFlag = (typeof ASSIST_SAFETY_FLAGS)[number];

/** 案例列表的一列（GET /api/assist/cases）。 */
export interface AssistCaseSummary {
  id: string;
  source: AssistSource;
  kind: AssistCaseKind;
  /** 科目（由 ref_json 算出；Worker 一律帶，沒有這個欄位＝英文，例如舊版 Worker）。 */
  subject?: AssistSubject;
  title: string; // 程式產生，例如「115 學測 第 21–30 題（文意選填）：第 23、27 格」「你貼的題目：The city council …」
  /** 英文的大題，或國文的題型（國文解析結算時寫回模型判斷的主要題型）。 */
  section: AssistSection | ZhSection | null;
  status: AssistCaseStatus;
  verdict: AssistVerdict | null; // 整組：有錯就是 wrong，其次 partial、unanswered，全對才是 correct
  item_count: number; // 這個案例問了幾題（單字是幾個字）
  wrong_count: number;
  understood: AssistUnderstood | null;
  error_codes: string[];
  skill_codes: string[];
  followups: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
  /**
   * 出版社題的授權已經結束（docs/design/weak-paper.md §7.6、§9.6）：詳情的題目只剩題號、作答與對錯，解析與追問的回覆不回傳，
   * 也不能再解析或追問。只有這種案例才有這個欄位。
   */
  source_ended?: true;
}

/** GET /api/assist/cases 的回應：另附這個學生各錯因的案例數（確認頁與案例頁的歷史一行用）。 */
export interface AssistCaseListResponse {
  cases: AssistCaseSummary[];
  next_cursor: string | null;
  error_counts: Record<string, number>;
}

/** 進行中的任務（前端只在它不是 null 時輪詢）。 */
export interface AssistPendingTask {
  turn_id: string;
  kind: AssistTurnKind;
  op_id: string | null;
  status: 'queued' | 'running';
}

/** GET /api/assist/cases/{id}：詳情（前端輪詢這支）。 */
export interface AssistCaseDetail extends AssistCaseSummary {
  trust: 'site' | 'student';
  question: AssistQuestionView | null; // §4.5.2
  doubt_kinds: AssistDoubtKind[];
  torn_with: OptionLetter | null;
  doubt: string | null;
  hint_first: boolean;
  note: string | null;
  rating: AssistRating | null;
  turns: AssistTurnView[]; // seq 由小到大
  pending: AssistPendingTask | null;
  history_line: AssistHistoryLine | null; // 程式算的錯因歷史（§2.1）
  flags: { d8_hidden: boolean; injection: boolean; safety: string | null };
  /** 建立或修改時遮過個資（回應帶提醒，不擋；§4.4）。 */
  masked?: boolean;
  /** 同一組、同樣的題號與答案已經有案例：回 200 與那一筆（§4.1）。 */
  existing?: boolean;
}

/** 「這是你第 4 題標成『過度推論』的錯題」＋前幾題的連結。 */
export interface AssistHistoryLine {
  code: string;
  count: number;
  case_ids: string[];
}

export type AssistTurnKind = 'ocr' | 'analyze' | 'followup';
export interface AssistTurnView {
  id: string;
  seq: number;
  kind: AssistTurnKind;
  status: 'queued' | 'running' | 'done' | 'failed';
  question?: string; // 追問內容
  label?: string | null; // 追問針對題組裡的哪一題（null＝整組）
  mode?: AssistFollowupMode;
  ocr?: AssistOcrView;
  analysis?: AssistAnalysisView | AssistWritingView | AssistVocabView | ZhAnalysisView;
  reply?: AssistFollowupView | ZhFollowupView;
  failure?: AiRefundReason | null;
  /** 國文解析或轉錄判定科目不符而退還時，模型判斷的科目（畫面依它請學生換科目；docs/design/assistant-subjects.md §2.5）。 */
  detected_subject?: AssistDetectedSubject;
  cache_hit?: boolean;
  created_at: number;
}

/** POST …/analyze、POST …/followups、POST …/ocr 的回應（202 排入佇列；共用快取命中時 200、0 點）。 */
export interface AssistTaskAccepted {
  op_id: string | null;
  case_id: string;
  turn_id: string;
  status: 'queued' | 'done';
  points: number;
  cache_hit?: boolean;
}

// ───────────────────────── 題目（AssistQuestionView，§4.5.2） ─────────────────────────

/** 題庫題的本站解析（只放這次問的題）。 */
export type SiteExplanation = ExplanationItem;

/**
 * 歷屆題的全國統計（五等分組由高分組到低分組）。多選題的 correct_rate 是官方的得分率（含部分給分），全對的比例另外放在
 * full_correct_rate（考卷檔有才有；舊的案例沒有這個鍵）。
 */
export interface AssistQuestionStats {
  correct_rate: number | null;
  full_correct_rate?: number | null;
  option_rates: Record<string, number> | null;
  high: number | null;
  low: number | null;
  five_groups: number[] | null;
}

export interface AssistQuestionTarget {
  label: string; // 原始題號（自組卷）或題號
  display_label: string; // 卷面題號
  mode: QuestionMode | 'unknown';
  stem: string | null;
  options: Record<string, string> | null;
  accepted: string[] | null; // 可接受答案集合：官方答案＋accepted_answers（站內題）
  student_answer: AnswerValue | null;
  verdict: AssistVerdict;
  verdict_basis: AssistVerdictBasis;
  explanation: SiteExplanation | null; // 題庫題：explanation_zh、evidence、option_notes_zh、strategy_zh、hints、clue_type、sense、option_codes…
  stats: AssistQuestionStats | null; // 歷屆題
  tags: Record<string, string> | null; // test_point、item_type、grammar_point、clue、key_phrase
  // ── 以下只有國文（docs/design/assistant-subjects.md §7.2）──
  /** 選擇題的子模式。 */
  choice_mode?: ZhChoiceMode;
  /** 簡答的字數限制與抄錄規定（zhCharLimits 抽出）。 */
  char_limit?: ZhCharLimit | null;
  /** 研判題的題目標籤（zhJudgeLabels 抽出）。 */
  judge_labels?: ZhJudgeLabels | null;
  /** accepted 的來源：站內題的答案檔，或學生提供的答案（「我有講義答案」）。 */
  key_source?: 'site' | 'student';
}

/** 單字案例的一個條目（Worker 從 vocab/index.json 取；錯題本只送 id、題型與錯誤次數）。 */
export interface AssistVocabEntryView {
  entry_id: string;
  word: string;
  level: number;
  pos: string[];
  zh: string;
  cefr: string | null;
  exam_total: number;
  exam_answer: number;
  mode: string;
  wrong_count: number;
}

/** 寫作批改案例的題目與作答（不含任何官方參考譯文、評分原則或佳作）。 */
export interface AssistWritingQuestion {
  kind: SubmissionKind;
  prompt: string;
  student_text: string;
  grading_digest: unknown;
  site_reference: unknown | null;
  /** 學生英文窗口 ≥ 80% 命中指紋時，送給模型的副本換掉的處數（§2.6）。 */
  d8_masked: number;
}

/** 存進 assist_cases.question_json 的題目（≤ 64 KB）。 */
export interface AssistQuestionView {
  kind: AssistCaseKind;
  trust: 'site' | 'student';
  origin_label: string; // 「115 學測」「本站題庫・進階練習」「你貼的題目」
  section: AssistSection | null;
  instructions: string | null;
  passage: string | null; // 站內題保留 [[n]] 與 <u>／<b>（前端用 RichText 顯示）；學生題目是純文字
  figure_text: string | null;
  targets: AssistQuestionTarget[]; // 1–5
  siblings: Array<{ label: string; display_label: string; stem: string | null }>; // 同組沒問的題
  shared_options: Record<string, string> | null; // 文意選填、篇章結構的選項
  group_answers: Record<string, AnswerValue> | null; // 同組其他格的作答（連鎖錯）
  elimination: unknown | null; // 文意選填、篇章結構的排除法表
  tier: Tier | null;
  blocks?: AssistQuestionBlock[]; // 學生提供的題目
  vocab?: { entries: AssistVocabEntryView[] };
  writing?: AssistWritingQuestion;
  /** 科目（沒有＝英文）。 */
  subject?: AssistSubject;
  /** 國寫附的一段與它回答哪一題（問題（一）或整篇的一段）。 */
  draft?: { text: string; target: 'q1' | 'q2' } | null;
}

// ───────────────────────── 解析、追問與轉錄的畫面形狀（§2.1、§2.5–§2.8） ─────────────────────────

export const ASSIST_KNOWLEDGE_KINDS = ['grammar', 'vocab', 'collocation', 'phrase', 'discourse', 'reading_skill', 'writing'] as const;
export type AssistKnowledgeKind = (typeof ASSIST_KNOWLEDGE_KINDS)[number];

/** 相關觀念（每則 ≤ 3 個；例句 ≤ 2 句）。 */
export interface AssistKnowledge {
  kind: AssistKnowledgeKind;
  title_zh: string;
  explain_zh: string;
  examples: Array<{ en: string; zh: string }>;
}

export interface AssistDoubtReply {
  doubt_zh: string;
  reply_zh: string;
}

/** 前端挑推薦練習用（不顯示）。 */
export interface AssistPracticeFocus {
  section: AssistSection;
  skill_codes: string[];
}

/**
 * 程式後處理的說明（§4.11）：哪一欄被過濾、被 D8 隱藏、英文太長被拿掉、答案被清空、太長被截斷、預測句被拿掉。
 * field 是欄位路徑（例如 'items[0].solution_steps[1].text_zh'）；畫面在那一區顯示固定說明。
 */
export interface AssistNotice {
  kind: 'filtered' | 'd8_hidden' | 'english_trimmed' | 'answer_cleared' | 'truncated' | 'prediction_removed' | 'off_topic' | 'missing_item';
  field: string;
}

/** 證據句在題目文字裡的位置（UTF-16 索引；where 是哪一段文字）。 */
export interface AssistQuoteRange {
  where: 'passage' | 'stem' | 'options' | 'blocks' | 'student_text';
  /** where 是 stem、options 時是哪一題（display_label）；blocks 時是區塊序號。 */
  ref: string | null;
  start: number;
  end: number;
}

/** 正確答案的來源：站內題來自答案檔（含官方公告的其他可接受答案）；學生提供的題目來自 AI 的判斷。 */
export type AssistAnswerKey = { from: 'site'; accepted: string[] } | { from: 'ai'; text: string; certainty: 'sure' | 'likely' | 'unsure' } | null;

/** item 解析的一題（模型的欄位＋程式加上的判定、答案、作答與統計）。 */
export interface AssistItemAnalysis {
  label: string;
  display_label: string;
  verdict: AssistVerdict;
  verdict_basis: AssistVerdictBasis;
  answer_key: AssistAnswerKey;
  student_answer: AnswerValue | null;
  stats: AssistQuestionStats | null;
  diagnosis: { error_codes: string[]; summary_zh: string; detail_zh: string };
  option_contrast_zh: string;
  hints_zh: string[];
  solution_steps: Array<{ text_zh: string; quote: string; range: AssistQuoteRange | null }>;
  traps: Array<{ option: string; trap_code: string; explain_zh: string; spot_zh: string }>;
}

/** item（選擇題、填充簡答、學生提供的題目；單題與題組共用）解析的畫面形狀。 */
export interface AssistAnalysisView {
  kind: 'item';
  section: AssistSection | null;
  skill_codes: string[];
  tested_zh: string;
  structure_zh: string;
  items: AssistItemAnalysis[];
  knowledge: AssistKnowledge[];
  method: { title_zh: string; steps_zh: string[] };
  score_tips_zh: string[];
  doubt_replies: AssistDoubtReply[];
  practice_focus: AssistPracticeFocus | null;
  followup_chips_zh: string[];
  key_concern_zh: string;
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
  notices: AssistNotice[];
  cache_hit: boolean;
}

/** writing（已批改的中譯英、作文）解析的畫面形狀（§2.6）。分數由程式顯示，AI 不寫分數。 */
export interface AssistWritingView {
  kind: 'writing';
  overview_zh: string;
  by_category: Array<{
    category: string;
    error_code: string;
    trap_code: string;
    student_quote: string;
    rule_zh: string;
    self_check_zh: string;
    range: AssistQuoteRange | null;
  }>;
  criteria: Array<{ criterion: 'wc:content' | 'wc:organization' | 'wc:grammar' | 'wc:vocabulary'; issue_zh: string; next_step_zh: string }>;
  sentence_plan: Array<{ sentence_index: 0 | 1; main_clause_zh: string; tense_trigger_zh: string; structure: string; trap_codes: string[] }>;
  rewrite_steps_zh: string[];
  knowledge: AssistKnowledge[];
  score_tips_zh: string[];
  doubt_replies: AssistDoubtReply[];
  skill_codes: string[];
  practice_focus: AssistPracticeFocus | null;
  followup_chips_zh: string[];
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
  /** 批改的分數（程式從提交讀）。 */
  score: { final: number; max: number } | null;
  notices: AssistNotice[];
  cache_hit: boolean;
}

/** vocab（1–8 個字）解析的畫面形狀（§2.8）。 */
export interface AssistVocabView {
  kind: 'vocab';
  groups: Array<{ theme_zh: string; entry_ids: string[]; contrast_zh: string }>;
  entries: Array<{
    entry_id: string;
    word: string;
    senses: Array<{ pos: string; zh: string; note_zh: string }>;
    collocations: Array<{ en: string; zh: string }>;
    confusables: Array<{ word: string; diff_zh: string }>;
    word_family: Array<{ word: string; pos: string }>;
    memory_tip_zh: string;
    example: { en: string; zh: string };
  }>;
  review_plan_zh: string;
  followup_chips_zh: string[];
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
  notices: AssistNotice[];
  cache_hit: boolean;
}

/** 追問一輪的回覆（§2.7）。 */
export interface AssistFollowupView {
  reply_zh: string;
  points: Array<{ text_zh: string; example_en: string }>;
  mode_used: AssistFollowupMode;
  new_error_codes: string[];
  understood_check_zh: string;
  followup_chips_zh: string[];
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
  notices: AssistNotice[];
}

/** 轉錄刻意沒轉錄的種類。 */
export const ASSIST_OCR_OMITTED = ['answer_key', 'explanation', 'scoring_notes', 'reference_translation', 'model_text', 'personal_info'] as const;
export type AssistOcrOmitted = (typeof ASSIST_OCR_OMITTED)[number];

/**
 * 拍照轉錄的結果（§2.5）。被隱藏的區塊 text 是固定說明、不能編輯；確認後只留統計（blocks 是空陣列）。
 * 國文另有 other_subject（附 detected_subject）與兩種隱藏：答案或詳解段落、太長像一篇文章（docs/design/assistant-subjects.md §6.3）。
 */
export interface AssistOcrView {
  status: 'ok' | 'unclear' | 'not_english_question' | 'no_question' | 'other_subject';
  detected_subject?: AssistDetectedSubject;
  blocks: Array<{
    kind: AssistBlockKind;
    label: string | null;
    text: string;
    unclear: Array<{ candidates: string[] }>;
    hidden: 'd8' | 'official_like' | 'writing_english' | 'answer_section' | 'long_passage' | null;
  }>;
  student_answer_seen: string;
  omitted: AssistOcrOmitted[];
  notices: string[];
  /** 學生確認之後（或照片到期清掉文字之後）：只留統計。 */
  stats?: { blocks: number; unresolved: number; edited?: number; unclear_kept?: number };
}

// ───────────────────────── 學習報告（§3、§5.5） ─────────────────────────

export const ASSIST_STANDARDS = ['top', 'front', 'mean'] as const; // 頂標、前標、均標
export type AssistStandard = (typeof ASSIST_STANDARDS)[number];
export const ASSIST_WEEKLY = ['le2', '2to4', '4to6', '6plus'] as const;
export type AssistWeekly = (typeof ASSIST_WEEKLY)[number];

/** 本機摘要的來源：歷屆與真題模考（official）、各難度的題庫題與自組卷。 */
export const ASSIST_SUMMARY_SOURCES = ['official', 'bank:basic', 'bank:advanced', 'bank:top', 'bank_mock:basic', 'bank_mock:advanced', 'bank_mock:top'] as const;
export type AssistSummarySource = (typeof ASSIST_SUMMARY_SOURCES)[number];

/** 前端彙整的本機作答摘要（≤ 16 KB；§5.5）。不含題目文字、作答的完整清單、自組卷代號、草稿與自評文字。 */
export interface AssistHistorySummary {
  v: 2;
  generated_at: string; // ISO
  range_days: number;
  sections: Array<{
    section: AssistSection;
    src: AssistSummarySource;
    n: number;
    correct: number; // 全部作答
    first_n: number;
    first_correct: number; // 首次接觸
    recent_n: number;
    recent_correct: number; // 近 30 天
    hinted: number; // 用了提示的題數
    unanswered: number;
  }>; // official＝歷屆試題＋真題模考；依作答紀錄的 s 與 t 分
  skills: Array<{ code: string; n: number; correct: number; first_n: number; first_correct: number }>; // 依 n 取前 40
  traps: Array<{ code: string; n: number }>; // 選到的陷阱代碼次數（題庫題），前 15
  bank_groups: Array<{ section: AssistSection; tier: Tier; groups: number; correct: number; total: number }>; // 題庫練習的每組彙總
  mocks: Array<{
    kind: 'exam' | 'bank';
    paper: string; // 考卷 id，或自組卷的難度（b／a／t），不送代號
    at: string;
    raw: number;
    max: number;
    level: number | null;
    scale_year: number | null;
    predicted: number | null;
    nonmc: {
      translation: { earned: number; max: number; basis: 'self' | 'none' };
      essay: { earned: number; max: number; basis: 'self' | 'none' };
    } | null;
    sections: Array<{ section: AssistSection; earned: number; max: number; time_sec: number; suggested_sec: number }>;
  }>; // 最近 5 份
  vocab: {
    mistakes: number;
    by_level: Record<'1' | '2' | '3' | '4' | '5' | '6', number>;
    top: Array<{ word: string; level: number; wrong: number; mode: string }>; // 前 20；word 必須符合 ASSIST_SUMMARY_WORD_PATTERN
    srs: { cards: number; due: number; lapses_ge3: number } | null;
  };
  behaviour: { marked: number; revealed: number; fast_wrong: number | null };
  plan_progress: {
    report_id: string; // 上一版
    since: string; // 上一版產生時間
    recs: Array<{ ref: string; attempted: boolean; first_n: number; first_correct: number }>; // 上一版每一項推薦
    checklist: Array<{ kind: string; done: number; total: number }>; // 逐週清單的勾選，依項目種類
  } | null;
  coverage: { outcomes: number; first_at: string | null; devices_note: 'this_device' };
}

/** 摘要裡單字的字元限制（送進報告提示的唯一一段前端文字，§4.10）。 */
export const ASSIST_SUMMARY_WORD_PATTERN = /^[A-Za-z][A-Za-z' .-]{0,39}$/;

/** POST /api/assist/reports。 */
export interface CreateAssistReportBody {
  summary: AssistHistorySummary; // §5.5
  target: { standard: AssistStandard } | { level: number }; // 1–15
  practice_tier?: Tier | null;
  weekly: AssistWeekly;
  school_exam_dates?: string[]; // YYYY-MM-DD，≤ 4
  exam_date?: string; // YYYY-MM-DD；預設 GSAT_116_ENGLISH_DATE
  feedback?: string | null; // ≤ 500
  candidates: string[]; // ≤ 24 個 ref：題組 uid@v、寫作題 wt:uid@v／we:uid@v、整份歷屆卷 exam:gsat-114
  based_on?: string | null; // 報告 id；預設最新一版
}

/** 伺服器依 ref 重建的推薦候選（不採用前端送的文字）。 */
export interface AssistPracticeCandidate {
  ref: string;
  section: AssistSection;
  tier: Tier | null;
  skills: string[];
  title: string; // 由索引的大題、難度、主題組成（≤ 40 字）
}

/** 116 學年度學測英文考科的日期（報告的預設考試日）。 */
export const GSAT_116_ENGLISH_DATE = '2027-01-23';

// ───────────────────────── 上限與點數 ─────────────────────────

/** 上限（設計值；改了要同步設計文件 §4.15 的表）。 */
export const ASSIST_LIMITS = {
  casesPerDay: 30,
  casesLive: 500,
  analysesPerCase: 2,
  followupsPerCase: 8,
  reportsPerDay: 2,
  ocrPerDay: 6,
  photosPerCase: 2,
  photosTempPerUser: 4,
  groupLabelsMax: { word_bank: 5, other: 4 },
  vocabEntriesMax: 8,
  doubtMaxChars: 500,
  followupMaxChars: 500,
  followupContextChars: 3_000,
  noteMaxChars: 200,
  feedbackMaxChars: 500,
  questionMinChars: 20,
  questionMaxChars: 6_000,
  questionBlocksMax: 40,
  questionEnglishWordsMax: 1_000,
  writingLikeEnglishWordsPerBlock: 100,
  figureMaxChars: 1_500,
  studentAnswerMaxChars: 300,
  summaryMaxBytes: 16_384,
  candidatesMax: 24,
  reportCasesMax: 15,
  reportsKept: 10,
  schoolExamDatesMax: 4,
  retentionDays: 180,
} as const;

// ───────────────────────── 模型輸出的欄位上限（§2.1、§2.6–§2.8） ─────────────────────────

/**
 * 一欄的上限：chars＝每個字串最多幾個字元（陣列是每一項）；min／max＝陣列的項數。
 * 結構化輸出送出前 SDK 會剝掉 maxLength、maxItems（§2.1），所以上限要用文字讓模型知道：zod 的 .describe()、
 * 系統提示的「Length limits」段與 Worker 的截斷（apps/api/src/assist/output.ts）都讀同一份 ASSIST_FIELD_LIMITS。
 */
export interface AssistFieldLimit {
  readonly chars?: number;
  readonly min?: number;
  readonly max?: number;
}

/** 有欄位上限的模型輸出：三種解析、追問與學習報告。 */
export const ASSIST_OUTPUT_KINDS = ['item', 'writing', 'vocab', 'followup', 'report'] as const;
export type AssistOutputKind = (typeof ASSIST_OUTPUT_KINDS)[number];

/** 相關觀念（item、writing 共用；writing 只取 2 則）。 */
const KNOWLEDGE_LIMITS = {
  'knowledge[].title_zh': { chars: 30 },
  'knowledge[].explain_zh': { chars: 200 },
  'knowledge[].examples': { max: 2 },
  'knowledge[].examples[].en': { chars: 120 },
  'knowledge[].examples[].zh': { chars: 60 },
} as const satisfies Record<string, AssistFieldLimit>;

/** 疑問回覆、練習重點、追問建議（三種解析共用的尾段）。 */
const COMMON_TAIL_LIMITS = {
  doubt_replies: { max: 3 },
  'doubt_replies[].doubt_zh': { chars: 60 },
  'doubt_replies[].reply_zh': { chars: 300 },
  'practice_focus.skill_codes': { max: 3 },
  followup_chips_zh: { max: 3, chars: 30 },
} as const satisfies Record<string, AssistFieldLimit>;

/**
 * 每一欄的上限（設計值；改了要同步設計文件 §2.1、§2.6–§2.8 的表，系統提示會跟著變、prompt_version 跟著換）。
 * 鍵是欄位路徑（陣列寫成 []），順序就是系統提示列出的順序。
 */
export const ASSIST_FIELD_LIMITS = {
  item: {
    skill_codes: { max: 4 },
    tested_zh: { chars: 150 },
    structure_zh: { chars: 300 },
    items: { min: 1, max: 5 },
    'items[].answer.text': { chars: 60 },
    'items[].diagnosis.error_codes': { max: 3 },
    'items[].diagnosis.summary_zh': { chars: 100 },
    'items[].diagnosis.detail_zh': { chars: 400 },
    'items[].option_contrast_zh': { chars: 200 },
    'items[].hints_zh': { min: 2, max: 3, chars: 80 },
    'items[].solution_steps': { min: 2, max: 5 },
    'items[].solution_steps[].text_zh': { chars: 160 },
    'items[].solution_steps[].quote': { chars: 160 },
    'items[].traps': { max: 3 },
    'items[].traps[].explain_zh': { chars: 120 },
    'items[].traps[].spot_zh': { chars: 80 },
    knowledge: { max: 3 },
    ...KNOWLEDGE_LIMITS,
    'method.title_zh': { chars: 30 },
    'method.steps_zh': { min: 2, max: 5, chars: 60 },
    score_tips_zh: { min: 2, max: 3, chars: 80 },
    ...COMMON_TAIL_LIMITS,
    key_concern_zh: { chars: 150 },
  },
  writing: {
    overview_zh: { chars: 200 },
    by_category: { max: 5 },
    'by_category[].student_quote': { chars: 120 },
    'by_category[].rule_zh': { chars: 200 },
    'by_category[].self_check_zh': { chars: 120 },
    criteria: { max: 4 },
    'criteria[].issue_zh': { chars: 200 },
    'criteria[].next_step_zh': { chars: 150 },
    sentence_plan: { max: 2 },
    'sentence_plan[].main_clause_zh': { chars: 120 },
    'sentence_plan[].tense_trigger_zh': { chars: 80 },
    'sentence_plan[].trap_codes': { max: 3 },
    rewrite_steps_zh: { min: 2, max: 5, chars: 80 },
    knowledge: { max: 2 },
    ...KNOWLEDGE_LIMITS,
    score_tips_zh: { min: 2, max: 3, chars: 100 },
    skill_codes: { max: 4 },
    ...COMMON_TAIL_LIMITS,
  },
  vocab: {
    groups: { max: 4 },
    'groups[].theme_zh': { chars: 40 },
    'groups[].contrast_zh': { chars: 200 },
    entries: { min: 1, max: 8 },
    'entries[].senses': { max: 2 },
    'entries[].senses[].zh': { chars: 30 },
    'entries[].senses[].note_zh': { chars: 60 },
    'entries[].collocations': { max: 3 },
    'entries[].collocations[].en': { chars: 40 },
    'entries[].collocations[].zh': { chars: 20 },
    'entries[].confusables': { max: 2 },
    'entries[].confusables[].word': { chars: 24 },
    'entries[].confusables[].diff_zh': { chars: 80 },
    'entries[].word_family': { max: 3 },
    'entries[].word_family[].word': { chars: 24 },
    'entries[].memory_tip_zh': { chars: 60 },
    'entries[].example.en': { chars: 120 },
    'entries[].example.zh': { chars: 60 },
    review_plan_zh: { chars: 150 },
    followup_chips_zh: { max: 3, chars: 30 },
  },
  followup: {
    reply_zh: { chars: 600 },
    points: { max: 3 },
    'points[].text_zh': { chars: 120 },
    'points[].example_en': { chars: 120 },
    new_error_codes: { max: 2 },
    understood_check_zh: { chars: 80 },
    followup_chips_zh: { max: 3, chars: 30 },
  },
  // 學習報告（§3.3）。phases 的項數＝骨架的階段數（最多 4 個），由程式依骨架對齊。
  report: {
    overview_zh: { chars: 400 },
    strengths: { max: 3 },
    'strengths[].evidence_zh': { chars: 120 },
    weaknesses: { max: 5 },
    'weaknesses[].error_codes': { max: 3 },
    'weaknesses[].evidence_zh': { chars: 120 },
    'weaknesses[].explain_zh': { chars: 250 },
    error_patterns: { max: 4 },
    'error_patterns[].explain_zh': { chars: 200 },
    'error_patterns[].case_refs': { max: 3 },
    'error_patterns[].fix_zh': { chars: 150 },
    doubts: { max: 5 },
    'doubts[].note_zh': { chars: 120 },
    section_notes: { max: 6 },
    'section_notes[].note_zh': { chars: 150 },
    score_plan: { min: 3, max: 5 },
    'score_plan[].action_zh': { chars: 150 },
    'score_plan[].why_zh': { chars: 120 },
    phases: { max: 4 },
    'phases[].focus_zh': { chars: 120 },
    'phases[].routine': { max: 5 },
    'phases[].routine[].detail_zh': { chars: 60 },
    milestones: { max: 8 },
    'milestones[].detail_zh': { chars: 60 },
    recommendations: { max: 6 },
    'recommendations[].why_zh': { chars: 80 },
    changes_zh: { max: 4, chars: 80 },
    questions_zh: { max: 3, chars: 60 },
    data_notes_zh: { chars: 150 },
  },
} as const satisfies Record<AssistOutputKind, Record<string, AssistFieldLimit>>;

/** 某種輸出的某一欄的上限（沒有列出的欄位回 undefined：不截斷）。 */
export function assistFieldLimit(kind: AssistOutputKind, path: string): AssistFieldLimit | undefined {
  return (ASSIST_FIELD_LIMITS[kind] as Readonly<Record<string, AssistFieldLimit>>)[path];
}

/**
 * 上限的英文說明（zod .describe() 與系統提示的「Length limits」段共用同一個寫法）：
 * 「at most 150 characters」「2 to 3 items, each at most 80 characters」「at most 4 items」。
 */
export function assistLimitText(limit: AssistFieldLimit): string {
  const parts: string[] = [];
  if (limit.max !== undefined) {
    const min = limit.min ?? 0;
    parts.push(min > 0 && min === limit.max ? `exactly ${min} items` : min > 0 ? `${min} to ${limit.max} items` : `at most ${limit.max} items`);
  }
  if (limit.chars !== undefined) parts.push(limit.max !== undefined ? `each at most ${limit.chars} characters` : `at most ${limit.chars} characters`);
  return parts.join(', ');
}

/** 題號的長度上限（區塊的 label、要問的題號、追問的 label；同 assist_turns.label 的 CHECK）。 */
export const ASSIST_LABEL_MAX_CHARS = 8;

/** 解析的題數上限（文意選填 5、其他題組 4；單字另計）。 */
export function assistGroupLabelsMax(section: AssistSection | null): number {
  return section === 'word_bank' ? ASSIST_LIMITS.groupLabelsMax.word_bank : ASSIST_LIMITS.groupLabelsMax.other;
}

/**
 * 解析點數：1 題 6 點，每多一題加 2，上限 14（單字固定 6）。上限只會碰到文意選填 5 格（其他題組最多 4 題＝12 點）：
 * 每多一題的成本約 US$0.05（docs/design/learning-assistant.md §4.13），上限若是 12，5 格那一次每點約 0.029，
 * 超過名額用的每點最壞值 0.0271（2026-10-23 上線審查改成 14）。
 */
export function assistAnalyzePoints(kind: AssistCaseKind, items: number): number {
  const base = 6;
  if (kind !== 'item') return base;
  const n = Number.isFinite(items) ? Math.max(1, Math.floor(items)) : 1;
  return Math.min(14, base + 2 * (n - 1));
}

// ───────────────────────── 判定對錯（§4.5.3） ─────────────────────────

/** assistVerdict 收的小題：選擇題同網站的計分；填充、簡答要有官方答案；其他題型不判對錯。 */
export type VerdictQuestion =
  | SingleChoiceScorable
  | MultiSelectScorable
  | { mode: 'fill_in_blank' | 'short_answer'; answer: string | null; accepted_answers?: readonly string[] | null; points?: number | null }
  | { mode: 'table_completion' | 'translation' | 'composition' };

export interface VerdictOptions {
  /**
   * 填充、簡答的可接受答案是不是完整清單：'complete'＝題庫題（題庫練習、自組卷；用題庫的比對規則，判不出的是錯），
   * 'official'（預設）＝歷屆題與真題模考（官方只公布部分可接受答案，判不出的是 unknown）。
   */
  openKey?: 'complete' | 'official';
  /** 題庫題的部分給分寫法（解析的 partial_credit_forms）。 */
  partialForms?: readonly string[] | null;
  /** 學生裝置上的判分（只對填充、簡答採用）。 */
  clientStatus?: AssistClientStatus | null;
}

/**
 * 判定一題的對錯（§4.5.3）。選擇題包一層網站的 scoreQuestion：送分（all_credit）算 correct，單選的可得分選項含
 * accepted_answers（例如 gsat-84 第 45 題）。填充、簡答：空白 unanswered；等於任何一個可接受答案 correct；等於題庫的
 * 部分給分寫法 partial；其他有裝置判分就用它（basis 'client'），沒有時題庫題 wrong、歷屆題 unknown。
 * 填充題的比對規則和網站一致：題庫題用 normalizeBankOpenAnswer；歷屆題的填充要連大小寫都一樣（只差大小寫算字形錯誤）。
 * 學生提供的題目、寫作、單字不判對錯（unknown），不會呼叫這支。
 */
export function assistVerdict(
  q: VerdictQuestion,
  answer: AnswerValue | null | undefined,
  opts: VerdictOptions = {},
): { verdict: AssistVerdict; basis: AssistVerdictBasis } {
  if (q.mode === 'single_choice' || q.mode === 'bank_choice' || q.mode === 'multi_select') {
    const outcome = scoreQuestion(q, answer ?? undefined);
    if (outcome.kind !== 'auto') return { verdict: 'unknown', basis: 'none' };
    return { verdict: outcome.status === 'all_credit' ? 'correct' : outcome.status, basis: 'program' };
  }
  if (q.mode !== 'fill_in_blank' && q.mode !== 'short_answer') return { verdict: 'unknown', basis: 'none' };
  if (answer === null || answer === undefined || !isAnswered(answer)) return { verdict: 'unanswered', basis: 'program' };
  const bank = opts.openKey === 'complete';
  const norm = bank ? normalizeBankOpenAnswer : q.mode === 'fill_in_blank' ? normalizeOpenAnswerCased : normalizeOpenAnswer;
  const mine = norm(typeof answer === 'string' ? answer : answer.join(' '));
  const accepted = [q.answer, ...(q.accepted_answers ?? [])].filter((a): a is string => typeof a === 'string' && a.trim() !== '');
  if (accepted.some((a) => norm(a) === mine)) return { verdict: 'correct', basis: 'program' };
  if (bank && (opts.partialForms ?? []).some((p) => norm(p) === mine)) return { verdict: 'partial', basis: 'program' };
  if (opts.clientStatus === 'partial' || opts.clientStatus === 'wrong') return { verdict: opts.clientStatus, basis: 'client' };
  return bank ? { verdict: 'wrong', basis: 'program' } : { verdict: 'unknown', basis: 'none' };
}

/** 一組的整體判定：有錯就是 wrong，其次 partial、unanswered，全對才是 correct；其他（有判不出的題）是 unknown。 */
export function assistGroupVerdict(verdicts: readonly AssistVerdict[]): AssistVerdict | null {
  if (verdicts.length === 0) return null;
  for (const v of ['wrong', 'partial', 'unanswered'] as const) if (verdicts.includes(v)) return v;
  return verdicts.every((v) => v === 'correct') ? 'correct' : 'unknown';
}

// ───────────────────────── 學生文字與學生題目的檢查（§4.4） ─────────────────────────

/** 拒收的原因（API 的 error.reason；順序就是優先順序，API 只回第一個）。 */
export const ASSIST_INPUT_PROBLEMS = [
  'blocks_invalid',
  'text_missing',
  'text_too_short',
  'text_too_long',
  'english_too_long',
  'figure_too_long',
  'answer_too_long',
  'zh_answer_too_long',
  'zh_draft_too_long',
  'bad_characters',
  'markup',
  'request_to_ai',
  'official_like',
  'zh_answer_section',
  'zh_no_task',
  'writing_english_too_long',
  'not_english',
  'subject_mismatch',
  'target_missing',
  'zh_too_many_targets',
  'unresolved_target',
  // 只有 Worker 會回（D8 指紋）。
  'official_material',
  // 站內來源的驗證（Worker；§4.4「站內來源的驗證」）。
  'bad_label_map',
  'bad_swap',
] as const;
export type AssistInputProblem = (typeof ASSIST_INPUT_PROBLEMS)[number];

/** 只提醒、不擋。 */
export const ASSIST_INPUT_WARNINGS = ['answer_like', 'personal_masked', 'request_like'] as const;
export type AssistInputWarning = (typeof ASSIST_INPUT_WARNINGS)[number];

export const ASSIST_INPUT_PROBLEM_MESSAGES = {
  blocks_invalid: '題目的格式不對，請重新整理後再試。',
  text_missing: '請輸入題目。',
  text_too_short: '題目太短了（至少 20 個字），請把題目、選項貼完整。',
  text_too_long: '題目最多 6,000 字元。只貼要問的題目與它的文章就好。',
  english_too_long: '英文最多 1,000 個單詞。只貼要問的題目與它的文章就好。',
  figure_too_long: '圖表或圖片的文字描述最多 1,500 字元。',
  answer_too_long: '你的答案最多 300 字元。',
  zh_answer_too_long: '簡答的答案每一小題最多 120 字。',
  zh_draft_too_long: '國寫指導一次只看一段，最多 250 字（問題（一）的答案最多 80 字）。',
  bad_characters: '題目裡有無法處理的特殊字元，請刪掉後再試。',
  markup: '題目裡不能有 <…> 這類標籤，請改成一般文字。',
  request_to_ai: '題目欄只放題目本身。學習助手會解析題目、說明解法，但不代寫作文或整段翻譯。',
  official_like: '題目裡有評分說明、範文或佳作。只貼要問的題目本身，不要貼評分標準、配分、範文或佳作。',
  writing_english_too_long: '作文或翻譯題的每一段英文最多 100 個單詞。只貼題目要求，不要貼範文或佳作。',
  not_english: '學習助手只處理英文題目。',
  subject_mismatch: '這看起來不是國文題目，請改選科目。',
  zh_answer_section: '請刪掉答案與解析再送出（已加亮那一段）；選擇題的答案字母可以填在「我有講義答案」。',
  zh_no_task: '這看起來是一篇文章，不是作文題目。',
  target_missing: '這段文字有好幾題，請選要問哪幾題（最多 5 題）。',
  zh_too_many_targets: '一次最多問 4 題選擇題、3 題簡答（小題合計 6 個）或 1 題國寫，其他的題目可以另外再問。',
  unresolved_target: '要問的題目裡還有看不清的字，請先選對或修改。',
  official_material: '題目裡有一段和官方受保護的資料（評分原則或參考譯文）相同，請刪掉那一段再送出。',
  bad_label_map: '這份卷子的題號對不上，請重新整理成績單再試一次。',
  bad_swap: '這份卷子的選項對不上，請重新整理成績單再試一次。',
} as const satisfies Record<AssistInputProblem, string>;

export const ASSIST_INPUT_WARNING_MESSAGES = {
  answer_like: '這些看起來像答案或詳解，會被當成資料，AI 不一定照著它。',
  personal_masked: '題目裡的姓名、學號、信箱或電話已經換成［已隱藏］。',
  request_like: 'AI 只解析題目，不會替你寫作文或翻譯；如果這是題目本身的文字，可以照樣送出。',
} as const satisfies Record<AssistInputWarning, string>;

/** 一個命中：field 是欄位（'blocks[0].text'、'student_answer'、'target_labels'、'text'）；start／end 是正規化後的 UTF-16 索引。 */
export interface AssistInputHit<C extends string> {
  code: C;
  field: string;
  start?: number;
  end?: number;
}

export type CheckResult<T, P extends string> =
  | { ok: true; value: T; warnings: AssistInputHit<AssistInputWarning>[] }
  | { ok: false; problems: AssistInputHit<P>[]; warnings: AssistInputHit<AssistInputWarning>[] };

/**
 * 學習助手提示裡的結構標籤（Worker 的 filter.ts 中和、輸入規則拒收；設計文件 §4.9）：自訂題的 8 個再加學習助手的 12 個。
 * 學生題目裡出現這些標籤（開或關）一律拒收 markup。
 */
export const ASSIST_STRUCTURAL_TAGS = [
  ...CUSTOM_PROMPT_STRUCTURAL_TAGS,
  'question',
  'student_provided_question',
  'site_explanation',
  'exam_stats',
  'student_answer',
  'student_patterns',
  'analysis_digest',
  'conversation',
  'history_facts',
  'case_digests',
  'previous_report',
  'practice_candidates',
] as const;

/** 看起來是答案或詳解（只提醒）：「參考答案」「答案：B」「Answer: B」「詳解」。 */
const ANSWER_LIKE_RE = /答案\s*[:：]\s*[(（]?\s*[A-Ja-j]\b|\bAnswers?\s*[:：]\s*[(（]?\s*[A-J]\b|詳解/g;

/** 身分證字號與居留證號（第二碼 1、2、8、9）。 */
const TW_ID_RE = /(?<![A-Za-z0-9])[A-Z][1289]\d{8}(?!\d)/g;
/** 「姓名、座號、學號、班級、學校」後接冒號的欄位值（到行尾或下一個空白）。 */
const PERSONAL_FIELD_RE = /(姓名|座號|學號|班級|學校)(\s*[:：]\s*)([^\s［]+)/g;

/**
 * 學習助手專用的個資遮罩（§4.4 第 2 步；自訂題的 normalizeCustomPromptText 不改）：身分證字號與居留證號、
 * 「姓名／座號／學號／班級／學校：」的欄位值，以及信箱與手機（normalizeCustomPromptText 已經遮過的不會再算一次），
 * 一律換成［已隱藏］。masked 是遮掉的處數。冪等。
 */
export function maskAssistPersonalInfo(text: string): { text: string; masked: number } {
  let masked = 0;
  const mask = () => {
    masked += 1;
    return CUSTOM_PROMPT_MASK;
  };
  const out = text
    .replace(EMAIL_RE, mask)
    .replace(PHONE_RE, mask)
    .replace(TW_ID_RE, mask)
    .replace(PERSONAL_FIELD_RE, (_m, label: string, sep: string) => `${label}${sep}${mask()}`);
  return { text: out, masked };
}

/** 學生文字的共同處理（§4.4）：自訂題的正規化（NFKC、不可見字元、信箱與電話）＋學習助手的個資遮罩。 */
export function normalizeAssistText(raw: string): { text: string; masked: number } {
  const a = normalizeCustomPromptText(raw);
  const b = maskAssistPersonalInfo(a.text);
  return { text: b.text, masked: a.masked + b.masked };
}

/**
 * 作文或中譯英的說明字樣（§4.4）：「英文作文」「文長」「中譯英」「譯成英文」「翻譯成英文」「寫一篇」、
 * Write an essay／a composition／a paragraph 等。命中時每一個區塊的英文 ≤ 100 個單詞（擋整篇貼上的佳作或範文）。
 */
const WRITING_TASK_RE =
  /英文作文|文長|中譯英|(?:翻)?譯成英文|英譯|寫一篇|\bwrite\s+(?:(?:an?|one|the)\s+)?(?:short\s+)?(?:essay|composition|paragraph|letter)\b|\btranslate\s+(?:the\s+following\s+)?(?:sentences?\s+)?into\s+English\b/gi;

export function writingTaskHits(text: string): Array<[number, number]> {
  return [...text.matchAll(WRITING_TASK_RE)].filter((m) => m[0] !== '').map((m): [number, number] => [m.index, m.index + m[0].length]);
}

/** 不含空白的字數（code point）。 */
function visibleLength(text: string): number {
  return [...text.replace(/\s/gu, '')].length;
}

/** 英文字母占非空白字元的比例。 */
function latinRatio(text: string): number {
  const visible = text.replace(/\s/gu, '');
  if (visible === '') return 0;
  return (visible.match(/[A-Za-z]/g)?.length ?? 0) / [...visible].length;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 原文長度上限（正規化之前，擋超大本體讓正規式跑很久；同自訂題的 textRawMaxChars 是 4 倍）。 */
const RAW_TOTAL_MAX_CHARS = ASSIST_LIMITS.questionMaxChars * 4;

function sortProblems<P extends string>(problems: AssistInputHit<P>[], order: readonly P[]): AssistInputHit<P>[] {
  const rank = (p: AssistInputHit<P>) => order.indexOf(p.code);
  return problems.sort((a, b) => rank(a) - rank(b));
}

/**
 * 學生提供的題目（打字、拍照確認後）的檢查（§4.4）：形狀 → 正規化與遮個資 → 長度 → 字元與標籤 → 內容規則 → 要問的題。
 * subject 是 chinese 時改走 checkZhQuestion（國文的正規化不用 NFKC、規則另寫；docs/design/assistant-subjects.md §4）。
 * 不含 D8 指紋（Worker 另外做，official_material）。失敗時 problems 依 ASSIST_INPUT_PROBLEMS 的優先順序排好（API 只回第一個）；
 * 提醒不影響 ok。成功時 value 是正規化、遮過個資的題目（Worker 存的就是它）。
 */
export function checkAssistQuestion(input: unknown, subject: AssistSubject = 'english'): CheckResult<AssistStudentQuestion, AssistInputProblem> {
  // 國文走自己的規則（assist-zh.ts；docs/design/assistant-subjects.md §4）；英文的規則一個字都不改。
  if (subject === 'chinese') return checkZhQuestion(input);
  const L = ASSIST_LIMITS;
  const problems: AssistInputHit<AssistInputProblem>[] = [];
  const warnings: AssistInputHit<AssistInputWarning>[] = [];
  const fail = (code: AssistInputProblem, field: string): CheckResult<AssistStudentQuestion, AssistInputProblem> => ({
    ok: false,
    problems: [{ code, field }],
    warnings,
  });

  // 形狀：1–40 塊、kind 合法、題號 ≤ 8 字元；要問的題號是字串陣列；你的答案是字串或 null。
  if (!isRecord(input) || !Array.isArray(input['blocks'])) return fail('blocks_invalid', 'blocks');
  const rawBlocks = input['blocks'] as unknown[];
  if (rawBlocks.length < 1 || rawBlocks.length > L.questionBlocksMax) return fail('blocks_invalid', 'blocks');
  const shaped: AssistQuestionBlock[] = [];
  for (const b of rawBlocks) {
    if (!isRecord(b) || !(ASSIST_BLOCK_KINDS as readonly unknown[]).includes(b['kind']) || typeof b['text'] !== 'string') return fail('blocks_invalid', 'blocks');
    const rawLabel = b['label'];
    if (rawLabel !== null && rawLabel !== undefined && typeof rawLabel !== 'string') return fail('blocks_invalid', 'blocks');
    const label = typeof rawLabel === 'string' && rawLabel.trim() !== '' ? rawLabel.trim() : null;
    if (label !== null && [...label].length > ASSIST_LABEL_MAX_CHARS) return fail('blocks_invalid', 'blocks');
    shaped.push({ kind: b['kind'] as AssistBlockKind, label, text: b['text'] });
  }
  const rawTargets = input['target_labels'] ?? [];
  if (!Array.isArray(rawTargets) || rawTargets.some((t) => typeof t !== 'string')) return fail('blocks_invalid', 'target_labels');
  const targets = [...new Set((rawTargets as string[]).map((t) => t.trim()).filter((t) => t !== ''))];
  if (targets.some((t) => [...t].length > ASSIST_LABEL_MAX_CHARS)) return fail('blocks_invalid', 'target_labels');
  const rawAnswer = input['student_answer'];
  if (rawAnswer !== undefined && rawAnswer !== null && typeof rawAnswer !== 'string') return fail('blocks_invalid', 'student_answer');

  // 原文太長：直接拒收，不做正規化與樣式比對。
  const rawTotal = shaped.reduce((sum, b) => sum + b.text.length, 0);
  if (rawTotal > RAW_TOTAL_MAX_CHARS) return fail('text_too_long', 'blocks');
  if (typeof rawAnswer === 'string' && rawAnswer.length > L.studentAnswerMaxChars * 4) return fail('answer_too_long', 'student_answer');

  // 正規化與遮個資（存檔的是遮過的版本；有遮的時候只提醒）。
  let masked = 0;
  const blocks: AssistQuestionBlock[] = shaped.map((b) => {
    const n = normalizeAssistText(b.text);
    masked += n.masked;
    return { ...b, text: n.text };
  });
  let studentAnswer: string | null = null;
  if (typeof rawAnswer === 'string') {
    const n = normalizeAssistText(rawAnswer);
    masked += n.masked;
    studentAnswer = n.text === '' ? null : n.text;
  }
  if (masked > 0) warnings.push({ code: 'personal_masked', field: 'blocks' });

  // 長度：全部區塊合計 20–6,000 字元（不含空白至少 20 字）；英文合計 ≤ 1,000 個單詞；圖表描述 ≤ 1,500；你的答案 ≤ 300。
  const all = blocks.map((b) => b.text).join('\n');
  const total = blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (all.trim() === '') problems.push({ code: 'text_missing', field: 'blocks' });
  else if (visibleLength(all) < L.questionMinChars) problems.push({ code: 'text_too_short', field: 'blocks' });
  if (total > L.questionMaxChars) problems.push({ code: 'text_too_long', field: 'blocks' });
  if (countEnglishWords(all) > L.questionEnglishWordsMax) problems.push({ code: 'english_too_long', field: 'blocks' });
  const figureTotal = blocks.filter((b) => b.kind === 'figure').reduce((sum, b) => sum + b.text.length, 0);
  if (figureTotal > L.figureMaxChars) problems.push({ code: 'figure_too_long', field: 'blocks' });
  if (studentAnswer !== null && studentAnswer.length > L.studentAnswerMaxChars) problems.push({ code: 'answer_too_long', field: 'student_answer' });

  // 字元、標籤與內容規則（逐區塊，命中位置是該區塊正規化後的索引）。
  const writingTask = blocks.some((b) => writingTaskHits(b.text).length > 0) || (studentAnswer !== null && writingTaskHits(studentAnswer).length > 0);
  const fields: Array<{ field: string; text: string }> = [
    ...blocks.map((b, i) => ({ field: `blocks[${i}].text`, text: b.text })),
    ...(studentAnswer !== null ? [{ field: 'student_answer', text: studentAnswer }] : []),
  ];
  for (const { field, text } of fields) {
    const bad = firstBadCharacter(text);
    if (bad) problems.push({ code: 'bad_characters', field, ...bad });
    for (const h of markupHits(text, ASSIST_STRUCTURAL_TAGS)) problems.push({ code: 'markup', field, start: h.start, end: h.end });
    for (const h of requestToAiHits(text)) {
      if (h.quoted) warnings.push({ code: 'request_like', field, start: h.start, end: h.end });
      else problems.push({ code: 'request_to_ai', field, start: h.start, end: h.end });
    }
    for (const h of officialLikeHits(text)) problems.push({ code: 'official_like', field, start: h.start, end: h.end });
    if (writingTask && customPromptEnglishWords(text) > L.writingLikeEnglishWordsPerBlock) problems.push({ code: 'writing_english_too_long', field });
    for (const h of referenceAnswerHits(text)) warnings.push({ code: 'answer_like', field, start: h.start, end: h.end });
    for (const m of text.matchAll(ANSWER_LIKE_RE)) warnings.push({ code: 'answer_like', field, start: m.index, end: m.index + m[0].length });
  }
  if (all.trim() !== '' && latinRatio(all) < 0.3 && countEnglishWords(all) < 15) problems.push({ code: 'not_english', field: 'blocks' });

  // 要問的題：區塊裡有兩個以上的題號就要選；選的題號要在區塊裡、最多 5 題；要問的題的題幹、選項、作答不能還有 [[?]]。
  const blockLabels = new Set(blocks.map((b) => b.label).filter((l): l is string => l !== null));
  const maxTargets = Math.max(L.groupLabelsMax.word_bank, L.groupLabelsMax.other);
  if (
    (blockLabels.size >= 2 && targets.length === 0) ||
    targets.length > maxTargets ||
    targets.some((t) => !blockLabels.has(t))
  ) {
    problems.push({ code: 'target_missing', field: 'target_labels' });
  }
  const isTarget = (b: AssistQuestionBlock) =>
    (ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(b.kind) && (targets.length === 0 || (b.label !== null && targets.includes(b.label)));
  blocks.forEach((b, i) => {
    if (!isTarget(b)) return;
    const at = b.text.indexOf('[[?]]');
    if (at >= 0) problems.push({ code: 'unresolved_target', field: `blocks[${i}].text`, start: at, end: at + 5 });
  });

  if (problems.length > 0) return { ok: false, problems: sortProblems(problems, ASSIST_INPUT_PROBLEMS), warnings };
  return { ok: true, value: { blocks, target_labels: targets, student_answer: studentAnswer }, warnings };
}

/**
 * 一段學生文字（疑問、追問、筆記、回饋）：正規化、遮個資、長度（max 字元）、字元與標籤。空字串是 text_missing
 * （選填的欄位由呼叫端先判斷有沒有填）。不是字串回 blocks_invalid。
 */
export function checkAssistText(text: unknown, max: number): CheckResult<string, AssistInputProblem> {
  if (typeof text !== 'string') return { ok: false, problems: [{ code: 'blocks_invalid', field: 'text' }], warnings: [] };
  if (text.length > max * 4) return { ok: false, problems: [{ code: 'text_too_long', field: 'text' }], warnings: [] };
  const n = normalizeAssistText(text);
  const warnings: AssistInputHit<AssistInputWarning>[] = n.masked > 0 ? [{ code: 'personal_masked', field: 'text' }] : [];
  const problems: AssistInputHit<AssistInputProblem>[] = [];
  if (n.text === '') problems.push({ code: 'text_missing', field: 'text' });
  if ([...n.text].length > max) problems.push({ code: 'text_too_long', field: 'text' });
  const bad = firstBadCharacter(n.text);
  if (bad) problems.push({ code: 'bad_characters', field: 'text', ...bad });
  for (const h of markupHits(n.text, ASSIST_STRUCTURAL_TAGS)) problems.push({ code: 'markup', field: 'text', start: h.start, end: h.end });
  if (problems.length > 0) return { ok: false, problems: sortProblems(problems, ASSIST_INPUT_PROBLEMS), warnings };
  return { ok: true, value: n.text, warnings };
}

// ───────────────────────── 確認頁的網址（§5.1） ─────────────────────────

/**
 * 入口按鈕帶去確認頁（/assistant/ask）的參數：只有「哪一題」，不帶作答內容（作答在本機）。
 * label、entry 可以重複（同一組的幾題、一次幾個字）。
 */
export type AskRef =
  | { src: 'bank'; ref: string; labels: string[] }
  | { src: 'bankmock'; attempt: string; labels: string[] }
  | { src: 'exam'; exam: string; labels: string[] }
  | { src: 'mock'; attempt: string; labels: string[] }
  | { src: 'writing'; sub: string }
  | { src: 'vocab'; entries: string[] };

export const ASSIST_ASK_PATH = '/assistant/ask';
/** 確認頁的題號最多帶幾個（整組的錯題與疑點；確認頁再依上限預設勾選）。 */
export const ASK_LABELS_MAX = 20;

/** 模考作答紀錄的 id（crypto.randomUUID，或非安全來源的備案「時間-亂數」）。 */
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9-]{6,64}$/;
/** 寫作提交的 id（UUID）。 */
const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 單字條目 id：「詞|詞類原文|級別」，例如 content|n./adj.|4。 */
export const VOCAB_ENTRY_ID_PATTERN = /^[^|\s][^|]{0,47}\|[^|]{1,40}\|[1-6]$/;
/** 題號：英數，最多 8 個字元（47A、中譯英這類不會送來：中譯英、作文另有入口）。 */
const ASK_LABEL_PATTERN = /^[A-Za-z0-9]{1,8}$/;

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** 入口按鈕的網址（題號、條目去重）。 */
export function assistAskHref(ref: AskRef): string {
  const p = new URLSearchParams({ src: ref.src });
  switch (ref.src) {
    case 'bank':
      p.set('ref', ref.ref);
      break;
    case 'bankmock':
    case 'mock':
      p.set('attempt', ref.attempt);
      break;
    case 'exam':
      p.set('exam', ref.exam);
      break;
    case 'writing':
      p.set('sub', ref.sub);
      break;
    case 'vocab':
      for (const e of uniq(ref.entries)) p.append('entry', e);
      break;
  }
  if ('labels' in ref) for (const l of uniq(ref.labels)) p.append('label', l);
  return `${ASSIST_ASK_PATH}?${p.toString()}`;
}

/** 確認頁讀查詢參數：格式不對（不認得的 src、id 格式不合、沒有題號、題號太多）回 null。題號與條目去重、保留順序。 */
export function parseAskParams(params: URLSearchParams | string): AskRef | null {
  const p = typeof params === 'string' ? new URLSearchParams(params.startsWith('?') ? params.slice(1) : params) : params;
  const labels = uniq(p.getAll('label'));
  const labelsOk = labels.length >= 1 && labels.length <= ASK_LABELS_MAX && labels.every((l) => ASK_LABEL_PATTERN.test(l));
  switch (p.get('src')) {
    case 'bank': {
      const ref = p.get('ref') ?? '';
      return GROUP_KEY_PATTERN.test(ref) && labelsOk ? { src: 'bank', ref, labels } : null;
    }
    case 'bankmock':
    case 'mock': {
      const src = p.get('src') as 'bankmock' | 'mock';
      const attempt = p.get('attempt') ?? '';
      return ATTEMPT_ID_PATTERN.test(attempt) && labelsOk ? { src, attempt, labels } : null;
    }
    case 'exam': {
      const exam = p.get('exam') ?? '';
      return EXAM_ID_PATTERN.test(exam) && labelsOk ? { src: 'exam', exam, labels } : null;
    }
    case 'writing': {
      const sub = p.get('sub') ?? '';
      return SUBMISSION_ID_PATTERN.test(sub) ? { src: 'writing', sub } : null;
    }
    case 'vocab': {
      const entries = uniq(p.getAll('entry'));
      const ok = entries.length >= 1 && entries.length <= ASSIST_LIMITS.vocabEntriesMax && entries.every((e) => VOCAB_ENTRY_ID_PATTERN.test(e));
      return ok ? { src: 'vocab', entries } : null;
    }
    default:
      return null;
  }
}
