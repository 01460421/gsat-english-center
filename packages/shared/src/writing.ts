/**
 * 寫作（中譯英、英文作文）與 AI 任務的 API 型別（SPEC §4.6、§6.8、§6.9、§8.3；ARCHITECTURE §3.4、§6；
 * DB_SCHEMA §3.6、§3.7；設計文件 docs/design/ai-auth-mvp.md）。
 *
 * 分工原則：**模型只判斷「錯在哪裡、屬於哪一類」，分數一律由程式依官方規則算**（ARCHITECTURE §6.7 第 3 點）。
 * 所以這裡的分數欄位都是 Worker 計算後的結果，不是模型輸出的原樣；模型輸出的 zod schema 在
 * apps/api/src/ai/ 內部，不放共用套件（前端用不到，而且送給 API 的 schema 有欄位名稱限制，ARCHITECTURE §6.2 第 5、6 條）。
 *
 * JSON 欄位一律 snake_case（和資料庫、既有共用型別一致）。
 */
import type { ApiErrorCode } from './api';
import type { AiStatus, AiTier } from './account';

// ───────────────────────── 提交（submissions） ─────────────────────────

/**
 * 提交種類。MVP 只有中譯英（2 句一組）與英文作文；資料庫另有 'open'（思考表達，Phase 5），這裡刻意不列。
 */
export const SUBMISSION_KINDS = ['translation', 'essay'] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

/** 輸入方式：打字／手寫照片（只有作文可以用照片）。 */
export const INPUT_MODES = ['typed', 'photo'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

/**
 * 提交狀態機（submissions.status CHECK）：
 *   打字：draft → queued → grading → graded（失敗 failed；不用 AI 時 draft → self_graded）
 *   照片：draft →（上傳照片）→ ocr_queued → ocr_ready →（學生確認文字）confirmed → queued → grading → graded
 * 只有 draft、ocr_ready、confirmed、failed 可以修改內容；其他狀態 PUT 回 409 conflict。
 */
export const SUBMISSION_STATUSES = [
  'draft',
  'ocr_queued',
  'ocr_ready',
  'confirmed',
  'queued',
  'grading',
  'graded',
  'self_graded',
  'failed',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** 前端輪詢時「還在跑」的狀態：輪詢 GET /api/submissions/{id} 直到離開這些狀態。 */
export const SUBMISSION_PENDING_STATUSES = ['ocr_queued', 'queued', 'grading'] as const satisfies readonly SubmissionStatus[];

/** 輪詢節奏（ARCHITECTURE §3.4）：每 2 秒、最多 3 分鐘；之後每 15 秒並提示「可以先離開」。 */
export const POLL_FAST_INTERVAL_MS = 2_000;
export const POLL_FAST_DURATION_MS = 3 * 60_000;
export const POLL_SLOW_INTERVAL_MS = 15_000;

/**
 * 題組 id（submissions.group_id ＝ item_groups.id）：歷屆題是 '{paper}.{source_group}@{version}'，
 * 例如 gsat-115 第 s7g1 題組（中譯英）→ 'gsat-115.s7g1@1'（DB_SCHEMA §3.3）。
 * 前端從題目 JSON 的試卷 id 與題組 id 組出來；對應的 item_groups 最小列由 Worker 在建立提交時補上（設計文件 §4、§10 A2）。
 * 只有 Worker 打包的題目庫裡有的題組能建立提交（其他回 400）；中譯英另外要「2 句、每句 4 分」才能送 AI 批改
 * （isAiGradableTranslation）。
 */
export function writingGroupId(examId: string, sourceGroupId: string, version = 1): string {
  return `${examId}.${sourceGroupId}@${version}`;
}

/**
 * 中譯英小題 id（TranslationBody.items[].item_id）：沿用 items.id 的格式 '{group_id}#{label}'（DB_SCHEMA §3.3），
 * 例如 'gsat-115.s7g1@1#中譯英1'。label 是題目 JSON 的 question.label。
 * 伺服器也接受只送 label（'中譯英1'）或題號字串（'1'），存檔時一律改成這個完整格式。
 */
export function writingItemId(groupId: string, label: string): string {
  return `${groupId}#${label}`;
}

/** 中譯英每組幾句（學測固定 2 句、同一主題）。 */
export const TRANSLATION_SENTENCES_PER_GROUP = 2;

/**
 * 這個中譯英題組能不能送 AI 批改：剛好 2 句、每句 4 分（現制）。83–85 學測的 5 句、93 學測每句 5 分不支援
 * （照樣可以作答與自評，只是不顯示「AI 批改」按鈕；送出會回 409 conflict）。
 * 參數是題目 JSON 的 questions（只看 points）。Worker 的題目庫（apps/api/scripts/build-writing-prompts.mjs 的
 * ai_gradable）用同一條規則，test/ai.routes.test.ts 檢查兩邊一致。
 */
export function isAiGradableTranslation(questions: ReadonlyArray<{ points?: number | null }>): boolean {
  return questions.length === TRANSLATION_SENTENCES_PER_GROUP && questions.every((q) => q.points === 4);
}
/** 每句英文譯文長度上限（字元；SPEC §6.8 步驟 3、ARCHITECTURE §3.4 第 1 步）。 */
export const TRANSLATION_SENTENCE_MAX_CHARS = 500;
/** 作文長度上限：≤600 個英文單字且 ≤4,000 字元（ARCHITECTURE §3.4 第 1 步）。 */
export const ESSAY_MAX_WORDS = 600;
export const ESSAY_MAX_CHARS = 4_000;
/** 作文建議字數（官方「至少 120 個單詞」；低於這個數字畫面一律提醒）。 */
export const ESSAY_MIN_WORDS_HINT = 120;
/** 字數明顯不足的門檻：少於 100 個單詞扣總分 1（設計值，SPEC §4.6）。 */
export const ESSAY_SHORT_WORDS = 100;
/** 作文段落數：題目要求 2 段，未分段（只有 1 段）扣總分 1。 */
export const ESSAY_EXPECTED_PARAGRAPHS = 2;

/**
 * 英文單字數（前端即時字數與 Worker 計分共用同一個規則，畫面上的數字才會和扣分一致）：
 * 以空白切開，含有至少一個英文字母或數字的片段算一個字；連字號詞（well-known）、縮寫（don't）各算一個字，
 * 單獨的標點不算。
 */
export function countEnglishWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) if (/[A-Za-z0-9]/.test(token)) n++;
  return n;
}

/**
 * 段落數：有空白行時以空白行分段（照片辨識的文字一律如此：行內換行只是原稿換行）；
 * 沒有任何空白行時，每一個非空白的行算一段（打字時常見「一段一行」）。
 * photoMode 為 true 時只認空白行，避免把手寫原稿的每一行都算成一段。
 */
export function countParagraphs(text: string, photoMode = false): number {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (normalized === '') return 0;
  const hasBlankLine = /\n[ \t]*\n/.test(normalized);
  const blocks = hasBlankLine || photoMode ? normalized.split(/\n[ \t]*\n+/) : normalized.split('\n');
  return blocks.filter((b) => b.trim() !== '').length;
}

/** 中譯英作答內容（submissions.body_json）：item_id 是題目 JSON 的小題 id。 */
export interface TranslationBody {
  items: Array<{ item_id: string; text: string }>;
}

/** 作文的構思與大綱（SPEC §6.9 步驟 1–2）；全部選填，只存不送模型。 */
export interface EssayPlan {
  ideas?: string[];
  outline?: Array<{ topic_sentence?: string; details?: string[]; closing?: string }>;
}

/** 作文作答內容（submissions.body_json）。照片模式在學生確認 OCR 文字之前 text 是空字串。 */
export interface EssayBody {
  text: string;
  plan?: EssayPlan | null;
}

/** 看分數前的自評（submissions.self_assess_json）：作文四項，或中譯英每句分數。 */
export type SelfAssessment =
  | { kind: 'essay'; scores: Record<EssayCriterion, number> }
  | { kind: 'translation'; sentence_scores: number[] };

/** POST /api/submissions：建立草稿。回 201 SubmissionDetail。 */
export type CreateSubmissionBody =
  | {
      kind: 'translation';
      group_id: string;
      input_mode: 'typed';
      body?: TranslationBody;
    }
  | {
      kind: 'essay';
      group_id: string;
      input_mode: InputMode;
      body?: EssayBody;
    };

/** PUT /api/submissions/{id}：更新草稿與自評（看分數前）。欄位省略＝不改。回 SubmissionDetail。 */
export interface UpdateSubmissionBody {
  body?: TranslationBody | EssayBody;
  self_assess?: SelfAssessment | null;
}

/** GET /api/submissions?kind=&cursor= 的一列（不含內文）。 */
export interface SubmissionSummary {
  id: string;
  kind: SubmissionKind;
  group_id: string;
  input_mode: InputMode;
  status: SubmissionStatus;
  /** 程式合成的最後分數；未批改為 null。中譯英滿分 8（2 句 × 4），作文滿分 20。 */
  final_score: number | null;
  final_band: EssayBand | null;
  /** Unix 秒。 */
  created_at: number;
  updated_at: number;
  graded_at: number | null;
}

export interface SubmissionListResponse {
  submissions: SubmissionSummary[];
  next_cursor: string | null;
}

/** GET /api/submissions/{id}：詳情（前端輪詢這支）。 */
export interface SubmissionDetail extends SubmissionSummary {
  body: TranslationBody | EssayBody | null;
  self_assess: SelfAssessment | null;
  /** 程式計算的字數與段落數（作文）。 */
  word_count: number | null;
  paragraphs: number | null;
  /** 進行中或最近一次的 AI 任務。 */
  op_id: string | null;
  /** 照片模式：OCR 結果（ocr_ready 之後才有；確認後 30 天清空）。 */
  ocr: OcrResult | null;
  /** 暫存中的照片（只有中繼資料；OCR 完成或確認後立即刪除）。 */
  photos: PhotoMeta[];
  /** 批改結果（graded 之後才有）。 */
  grading: TranslationGradingResult | EssayGradingResult | null;
  /** 失敗原因（status='failed' 時）；點數已全額退還。 */
  failure: AiRefundReason | null;
}

// ───────────────────────── 手寫照片（MVP：暫存 D1） ─────────────────────────

/** 每份作文最多幾張照片。 */
export const PHOTO_MAX_COUNT = 2;
/**
 * 每張照片上限 1.2 MB（1,200,000 bytes）。前端先縮圖再上傳；D1 單列上限約 2 MB，照片以 BLOB 一張一列暫存，
 * 這個上限讓一列（照片＋中繼資料）穩穩放得下（設計文件 §4）。
 */
export const PHOTO_MAX_BYTES = 1_200_000;
/** 前端縮圖：長邊 ≤1600 px、輸出 JPEG、去 EXIF（重新編碼即去除）。 */
export const PHOTO_MAX_LONG_EDGE_PX = 1_600;
export const PHOTO_MIME = 'image/jpeg';
/**
 * 伺服器接受的照片格式（Worker 另外檢查檔頭的魔術位元組，宣告的型別和內容不符就拒絕；長邊超過
 * PHOTO_MAX_LONG_EDGE_PX 也拒絕；存檔前剝除 EXIF 等中繼資料）。
 * 前端仍建議一律重新編碼成 PHOTO_MIME（順便去掉 EXIF）；PNG、WebP 只是也收，規則相同。
 */
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIMES)[number];
/** 照片最長暫存時數：OCR 完成或學生確認後立即刪除；兜底清除在每次上傳時順手執行。 */
export const PHOTO_MAX_AGE_HOURS = 24;

/**
 * POST /api/submissions/{id}/photos?ord=1|2：multipart/form-data，**一次一張**，欄位名 `photo`（image/jpeg、≤PHOTO_MAX_BYTES），
 * 同一個 ord 再傳一次＝取代。一次一張是為了讓每個請求都在 1.2 MB 左右：過渡期經 Vercel rewrites 轉送，
 * 大本體能不能通過還沒實測（ARCHITECTURE §4.3 第 3 點）。DELETE /api/submissions/{id}/photos＝學生自己刪除全部照片。
 * 兩者都回 PhotoUploadResponse（目前暫存中的全部照片）。
 */
export interface PhotoMeta {
  id: string;
  /** 第幾張（1 或 2）。 */
  ord: number;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Unix 秒。 */
  created_at: number;
}

export interface PhotoUploadResponse {
  photos: PhotoMeta[];
}

/** 看不清的地方：OCR 文字裡以 [[?]] 標記的位置與候選字（SPEC §6.9 手寫作文）。 */
export interface OcrUncertainSpan {
  /** 在 OcrResult.text 裡的 UTF-16 位移（含 [[?]] 標記本身），start 含、end 不含。 */
  start: number;
  end: number;
  candidates: string[];
}

/** OCR 結果：只轉錄、**保留錯字**，看不清的用 [[?]] 標記。 */
export interface OcrResult {
  text: string;
  uncertain: OcrUncertainSpan[];
  /** 已確認的時間（Unix 秒）；未確認為 null。 */
  confirmed_at: number | null;
}

/**
 * PUT /api/submissions/{id}/confirm：學生確認（修正辨識錯誤後的）文字。只在 ocr_ready 狀態可用。
 * 伺服器記錄和 OCR 原文的差異（ocr_diff_json），狀態改為 confirmed，並立即刪除暫存照片。回 SubmissionDetail。
 */
export interface ConfirmOcrBody {
  text: string;
}

// ───────────────────────── 批改結果：共用 ─────────────────────────

/** 評分者角色（gradings.role，不含 'self'）：第一、第二位；兩者差距過大才有第三位。 */
export const RATER_ROLES = ['primary', 'second', 'third'] as const;
export type RaterRole = (typeof RATER_ROLES)[number];

/**
 * 兩位評分者差距超過門檻就加第三位（大考中心：作文差 >5、中譯英差 >2）。
 * 有第三位時取三個分數中最接近的兩個平均（第三閱後的定分方式未公開，設計值）。
 */
export const ESSAY_RATER_GAP_THRESHOLD = 5;
export const TRANSLATION_RATER_GAP_THRESHOLD = 2;

/**
 * 錯誤在學生文字中的位置：UTF-16 位移（JavaScript 字串索引），start 含、end 不含；excerpt 是該範圍的原文片段。
 * 位置由 Worker 以模型引用的片段在原文中搜尋得出（不採用模型自己算的位移）；
 * 找不到（例如漏譯、模型改寫了引文）時 start === end === 0，excerpt 是模型引用的文字：前端只列在清單、不畫底線。
 * 中譯英的位移以該句（TranslationBody.items[sentence_index].text）為準；作文以整篇 EssayBody.text 為準。
 */
export interface TextSpan {
  start: number;
  end: number;
  excerpt: string;
}

// ───────────────────────── 中譯英（SPEC §4.6、§6.8） ─────────────────────────

/**
 * 中譯英計分規則（程式計算，SPEC §4.6）：
 *   - 每句 4 分，切成 4 個語意單位（部分），各 1 分；
 *   - 每個錯誤扣 0.5，各部分獨立扣、扣完（0）為止；
 *   - 相同的拼字或文法錯誤只扣一次（TranslationError.repeat_of 指向第一次出現的錯誤，兩句之間也算）；
 *   - 句首未大寫、標點不妥各扣 0.5、同一種在一句裡只扣一次（由程式判定，不靠模型），所以一句最多扣 1；
 *     這兩種扣分不屬於任何部分，從該句總分扣，扣到 0 為止；
 *   - 所以每句分數在 0–4 之間、以 0.5 為單位；一組 2 句滿分 8。
 */
export const TRANSLATION_SENTENCE_MAX = 4;
export const TRANSLATION_PARTS_PER_SENTENCE = 4;
export const TRANSLATION_POINTS_PER_PART = 1;
export const TRANSLATION_DEDUCTION_STEP = 0.5;
export const TRANSLATION_GROUP_MAX = TRANSLATION_SENTENCE_MAX * TRANSLATION_SENTENCES_PER_GROUP;

/** 中譯英錯誤類別（結果頁依類別上色）。capitalization、punctuation 由程式判定。 */
export const TRANSLATION_ERROR_CATEGORIES = [
  'spelling',
  'grammar',
  'word_choice',
  'omission',
  'meaning',
  'capitalization',
  'punctuation',
  'other',
] as const;
export type TranslationErrorCategory = (typeof TRANSLATION_ERROR_CATEGORIES)[number];

/** 中譯英的一個錯誤（第一位評分者輸出、程式驗證位置後的結果）。 */
export interface TranslationError extends TextSpan {
  /** 第幾句（0 起算）。 */
  sentence_index: number;
  /** 所屬語意單位（1–4）；大小寫與標點為 null（整句只扣一次，不屬於任何部分）。 */
  part: number | null;
  category: TranslationErrorCategory;
  explanation_zh: string;
  /** 建議的改法（英文）。 */
  suggestion: string;
  /** 和前面某個錯誤相同（同錯只扣一次）時，指向那個錯誤在 errors 陣列中的索引；否則 null。 */
  repeat_of: number | null;
  /** 這個錯誤實際扣的分數：0（重複或該部分已扣完）或 0.5。 */
  deducted: number;
}

/** 某位評分者對一句的計分（程式依錯誤清單算出）。 */
export interface TranslationSentenceScore {
  sentence_index: number;
  /** 0–4，0.5 為單位。 */
  score: number;
  /** 4 個部分各自的得分（0–1，0.5 為單位）。第二位評分者若只給整體分，可為 null。 */
  part_scores: number[] | null;
  /** 大小寫與標點的扣分（程式判定）：句首未大寫 0.5、標點不妥 0.5，所以是 0、0.5 或 1。 */
  mechanics_deduction: number;
}

/** 一位評分者的中譯英結果。 */
export interface TranslationRaterResult {
  role: RaterRole;
  /** 這位評分者的總分（0–8，0.5 為單位）。 */
  score: number;
  sentences: TranslationSentenceScore[];
}

/** 中譯英批改結果（SubmissionDetail.grading）。 */
export interface TranslationGradingResult {
  kind: 'translation';
  /** 最後分數 0–8：兩位評分者平均（有第三位時取最接近的兩個平均），可能是 0.25 的倍數。 */
  final_score: number;
  max_score: typeof TRANSLATION_GROUP_MAX;
  /** 每句的最後分數（同樣是平均）。 */
  sentence_scores: number[];
  raters: TranslationRaterResult[];
  third_rater_used: boolean;
  /** 錯誤清單（以第一位評分者為準，前端在句子上標示）。 */
  errors: TranslationError[];
  /** 每句「保留你原意的修正版」。 */
  corrected: string[];
  /** 每句的整體說明。 */
  explanation_zh: string[];
}

// ───────────────────────── 英文作文（SPEC §4.6、§6.9） ─────────────────────────

/**
 * 作文四項評分指標（大考中心 106 學年度起的分項式評分標準，02 §4.4）：
 * 內容、組織、文法句構、字彙拼字，**各 0–5 分**（優 5–4／可 3／差 2–1／劣 0），四項加總上限 20。
 * 注意：95–105 學年度的舊制是「文法句構 4、字彙拼字 4、體例 2」，現制已取消體例、四項都是 5 分。
 */
export const ESSAY_CRITERIA = ['content', 'organization', 'grammar', 'vocabulary'] as const;
export type EssayCriterion = (typeof ESSAY_CRITERIA)[number];

export const ESSAY_CRITERION_MAX = {
  content: 5,
  organization: 5,
  grammar: 5,
  vocabulary: 5,
} as const satisfies Record<EssayCriterion, number>;

export const ESSAY_CRITERION_LABELS = {
  content: '內容',
  organization: '組織',
  grammar: '文法句構',
  vocabulary: '字彙拼字',
} as const satisfies Record<EssayCriterion, string>;

/** 作文總分上限（四項加總）。 */
export const ESSAY_MAX_SCORE = 20;

/** 等級（SPEC §4.6）：特優 19–20、優 15–18、可 10–14、差 5–9、劣 0–4。 */
export const ESSAY_BANDS = [
  { band: 'excellent', label: '特優', min: 19, max: 20 },
  { band: 'good', label: '優', min: 15, max: 18 },
  { band: 'fair', label: '可', min: 10, max: 14 },
  { band: 'poor', label: '差', min: 5, max: 9 },
  { band: 'failing', label: '劣', min: 0, max: 4 },
] as const;
export type EssayBand = (typeof ESSAY_BANDS)[number]['band'];

/**
 * 依總分取等級。平均分可能帶小數（例如 14.5），以「向下取到整數後落在哪一帶」判定，
 * 避免 14.5 落在 14 與 15 之間的空隙（設計值；官方總分是整數）。
 */
export function essayBandOf(score: number): EssayBand {
  const s = Math.max(0, Math.min(ESSAY_MAX_SCORE, Math.floor(score)));
  const found = ESSAY_BANDS.find((b) => s >= b.min && s <= b.max);
  return found ? found.band : 'failing';
}

/** 程式判定的扣總分項目：字數明顯不足、未分段各扣 1，兩者同時發生只扣 1（SPEC §4.6）。 */
export const ESSAY_DEDUCTION_CODES = ['too_short', 'no_paragraphs'] as const;
export type EssayDeductionCode = (typeof ESSAY_DEDUCTION_CODES)[number];
export interface EssayDeduction {
  code: EssayDeductionCode;
  points: number;
}

/** 作文錯誤類別（結果頁「依類型篩選」）。 */
export const ESSAY_ERROR_CATEGORIES = ['grammar', 'word_choice', 'spelling', 'organization', 'mechanics', 'other'] as const;
export type EssayErrorCategory = (typeof ESSAY_ERROR_CATEGORIES)[number];

/** 作文標記的一個錯誤（第一位評分者輸出、程式驗證位置後的結果）。 */
export interface EssayError extends TextSpan {
  /** 第幾段（0 起算）。 */
  paragraph_index: number;
  category: EssayErrorCategory;
  explanation_zh: string;
  suggestion: string;
}

/** 某一項的分數與說明。 */
export interface EssayCriterionResult {
  /** 0–5；最後結果是兩位評分者的平均，可能是 0.5 的倍數。 */
  score: number;
  explanation_zh: string;
}

/** 一位評分者的作文結果。 */
export interface EssayRaterResult {
  role: RaterRole;
  /** 四項各 0–5 的整數。 */
  scores: Record<EssayCriterion, number>;
  off_topic: boolean;
  /** 程式算的總分：四項加總、扣字數與分段（離題時其他各項為 0），0–20。 */
  total: number;
  /** 簡短評語（第二位評分者只輸出分數與這段）。 */
  comment_zh: string;
}

/** 逐段建議。 */
export interface EssayParagraphAdvice {
  paragraph_index: number;
  advice_zh: string;
}

/** 作文批改結果（SubmissionDetail.grading）。 */
export interface EssayGradingResult {
  kind: 'essay';
  /** 最後總分 0–20：兩位評分者的 total 平均（有第三位時取最接近的兩個平均）。 */
  final_score: number;
  max_score: typeof ESSAY_MAX_SCORE;
  band: EssayBand;
  /**
   * 四項的最後分數（平均）與說明（說明取自第一位評分者；第一位被「取最接近的兩位」排除時說明是空字串，
   * 見 explanations_from_excluded_rater）。
   */
  criteria: Record<EssayCriterion, EssayCriterionResult>;
  raters: EssayRaterResult[];
  third_rater_used: boolean;
  off_topic: boolean;
  deductions: EssayDeduction[];
  word_count: number;
  paragraphs: number;
  /** 三個優先改進（「先改這三個就好」）。 */
  top_improvements: string[];
  paragraph_advice: EssayParagraphAdvice[];
  errors: EssayError[];
  /** 保留原意的參考改寫（可省略）。 */
  rewrite: string | null;
  /** 身心安全旗標（只存類別）；非 null 時結果頁先顯示關懷與求助資訊（SPEC §6.9）。 */
  safety_flag: string | null;
  /**
   * 第一位評分者（唯一給詳細回饋的）的分數是離群值、被「取最接近的兩位」排除時為 true：
   * 各項說明（criteria[].explanation_zh）、top_improvements、paragraph_advice 會是空的（它們解釋的是沒被採用的分數），
   * errors 與 rewrite 照樣保留（和分數無關）。前端可以提示「詳細說明來自分數未被採用的評分者，已省略」，
   * 並改看 raters[].comment_zh。沒有這個欄位＝false。
   */
  explanations_from_excluded_rater?: boolean;
}

// ───────────────────────── AI 任務與額度 ─────────────────────────

/**
 * MVP 的 AI 任務代號（ARCHITECTURE §6.1）與點數。
 * 手寫作文在 MVP 是 OCR 2 點＋以確認後的文字走 essay_grade 7 點（照片確認後就刪，批改時不附照片；
 * 附照片的 essay_grade_photo 8 點要等 R2，延後）。
 */
export const AI_TASKS = ['translation_grade', 'essay_grade', 'essay_ocr'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_POINTS = {
  translation_grade: 3,
  essay_grade: 7,
  essay_ocr: 2,
} as const satisfies Record<AiTask, number>;

/** 計入「作文每天篇數」的任務家族（AI_ESSAY_USER_DAY，預設 3 篇）。OCR 不算篇數。 */
export const ESSAY_FAMILY_TASKS = ['essay_grade'] as const satisfies readonly AiTask[];

/** POST /api/ai/translation-grade、/essay-grade、/essay-ocr 的請求。 */
export interface AiTaskRequest {
  submission_id: string;
}

/** 上述三支的 202 回應：已排入 Queue，前端改輪詢 GET /api/submissions/{id}（或 /api/ai/ops/{op_id}）。 */
export interface AiTaskAccepted {
  op_id: string;
  submission_id: string;
  status: SubmissionStatus;
}

/** ai_ops.status：預扣／結算／退還。 */
export const AI_OP_STATUSES = ['reserved', 'settled', 'refunded'] as const;
export type AiOpStatus = (typeof AI_OP_STATUSES)[number];

/** 退還原因（ai_ops.refund_reason）；前端依代碼顯示中文。每一種都會全額退點。 */
export const AI_REFUND_REASONS = [
  'refusal',
  'invalid_output',
  'max_tokens',
  'api_error',
  'timeout',
  'paused',
  'expired',
  'internal',
] as const;
export type AiRefundReason = (typeof AI_REFUND_REASONS)[number];

/** GET /api/ai/ops/{id} */
export interface AiOpResponse {
  op_id: string;
  task: AiTask;
  status: AiOpStatus;
  submission_id: string | null;
  submission_status: SubmissionStatus | null;
  points_reserved: number;
  /** 實扣點數；結算前 null，退還為 0。 */
  points_charged: number | null;
  refund_reason: AiRefundReason | null;
  /** Unix 秒。 */
  created_at: number;
  settled_at: number | null;
}

/** GET /api/ai/quota：剩餘點數、今日篇數、全站狀態、名額。重置時間是台灣時間 00:00。 */
export interface AiQuotaResponse {
  ai_status: AiStatus;
  tier: AiTier;
  points: { day_used: number; day_limit: number; month_used: number; month_limit: number };
  essays: { day_used: number; day_limit: number };
  concurrent: { active: number; limit: number };
  site: { paused: boolean; budget_available: boolean };
  approval: { cap: number; approved: number; full: boolean };
  /** 下次重置（ISO 8601）。 */
  resets_at: { day: string; month: string };
  task_points: Record<AiTask, number>;
}

/**
 * 原子預扣失敗時的錯誤代碼（ARCHITECTURE §6.4）與 AI 端點的其他擋下原因。
 * 都在 api.ts 的 API_ERROR_CODES 裡（單元測試保證），前端用 AI_ERROR_MESSAGES 顯示中文。
 */
export const AI_RESERVE_ERROR_CODES = [
  'quota_day',
  'quota_month',
  'daily_limit',
  'busy',
  'ai_paused',
  'site_budget',
] as const satisfies readonly ApiErrorCode[];
export type AiReserveErrorCode = (typeof AI_RESERVE_ERROR_CODES)[number];

export const AI_GATE_ERROR_CODES = [
  ...AI_RESERVE_ERROR_CODES,
  'not_approved',
  'not_configured',
  'consent_required',
] as const satisfies readonly ApiErrorCode[];
export type AiGateErrorCode = (typeof AI_GATE_ERROR_CODES)[number];

/** 被擋下時顯示的中文原因（SPEC §8.3）。 */
export const AI_ERROR_MESSAGES = {
  quota_day: '今日點數已用完，台灣時間 00:00 重置',
  quota_month: '本月點數已用完，下個月 1 日重置',
  daily_limit: '今天的作文批改篇數已滿',
  busy: '請等前一個批改完成',
  ai_paused: 'AI 功能暫停中',
  site_budget: 'AI 功能今日額度已滿，請明天再試',
  not_approved: 'AI 功能需要先申請並通過核准',
  not_configured: 'AI 功能尚未開放',
  consent_required: '請先同意最新版的隱私權說明與服務條款',
} as const satisfies Record<AiGateErrorCode, string>;

/** 判斷分數是否在 [0, max] 且為 step 的整數倍（中譯英 0.5、作文單項 1）。前後端驗證共用。 */
export function isScoreOnStep(value: number, max: number, step: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > max) return false;
  const k = value / step;
  return Math.abs(k - Math.round(k)) < 1e-9;
}
