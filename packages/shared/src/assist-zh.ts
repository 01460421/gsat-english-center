/**
 * 學習助手國文的資料與規則（docs/design/assistant-subjects.md §2.2、§3、§4、§5）：前端與 Worker 共用的純函式與常數。
 *
 *   題型與解法步驟   ZH_SECTIONS、ZH_SECTION_SPECS（系統提示的「一定要涵蓋」與畫面的「這類題的解法」都從這裡產生）
 *   格式與子模式     ZH_FORMATS、ZH_CASE_KINDS、ZH_CHOICE_MODES
 *   題型卡           ZH_CARD_KINDS、ZH_CARD_COLUMNS、列數上限
 *   代碼清單         ZH_ERROR_CODES（錯因族、可用格式）、ZH_FLAW_CODES、ZH_SKILL_CODES；isSubjectErrorCode
 *   欄位上限         ZH_FIELD_LIMITS（同 ASSIST_FIELD_LIMITS 的形狀；.describe()、Length limits 段與截斷共用）
 *   確定程度上限     ZH_CERTAINTY_CAPS；小列舉（判定、確定程度、覆蓋程度…）的正規化
 *   正規化三支       normalizeZhText（存檔與送出）、zhMatchKey（只用在比對）、zhLabelKey（題號）
 *   輸入檢查         checkZhQuestion、zhOfficialLikeHits、zhAnswerSectionHits
 *   格式、題型猜測   guessZhFormat、guessZhSection
 *   字數與抄錄       zhCharLimits、countZhChars、zhCopyCheck
 *   研判與多選       zhJudgeLabels、zhParseJudgeCombos、zhMultiScore
 *   台灣標準         注音字元與音節、審定音、字碼、簡體字、修辭名稱（資料表在 assist-zh-data.ts）
 *   畫面形狀         ZhChoiceView、ZhShortView、ZhWritingView、ZhFollowupView（程式後處理之後給畫面的形狀）
 *
 * 英文的 assist.ts、assist-codes.ts 一個字都不改：國文的代碼、上限與檢查全部另外寫在這裡，由科目分派（§2.4）。
 *
 * 和 assist.ts 互相匯入（assist.ts 的 checkAssistQuestion 依科目轉呼叫 checkZhQuestion）：兩邊的頂層程式都不讀對方的值，
 * 只在函式裡用，所以不論哪一個模組先載入都不會碰到還沒初始化的匯入。這裡新增頂層常數時，不要引用 assist.ts 的值。
 */
import {
  ASSIST_BLOCK_KINDS,
  ASSIST_INPUT_PROBLEMS,
  ASSIST_LABEL_MAX_CHARS,
  ASSIST_LIMITS,
  ASSIST_STRUCTURAL_TAGS,
  ASSIST_TARGET_BLOCK_KINDS,
  maskAssistPersonalInfo,
  type AssistBlockKind,
  type AssistDoubtReply,
  type AssistFieldLimit,
  type AssistInputHit,
  type AssistInputProblem,
  type AssistInputWarning,
  type AssistNotice,
  type AssistQuestionBlock,
  type AssistQuoteRange,
  type AssistSafetyFlag,
  type AssistStudentQuestion,
  type AssistVerdict,
  type CheckResult,
} from './assist';
import { isAssistErrorCode, type GeneralErrorTag } from './assist-codes';
import type { AssistSubject } from './assist-subjects';
import {
  ZH_FORM_EITHER,
  ZH_FORM_EITHER_WORDS,
  ZH_RHETORIC_MAINLAND,
  ZH_RHETORIC_SUBTYPES,
  ZH_RHETORIC_TERMS,
  ZH_SIMPLIFIED_ONLY,
  ZH_TW_FORM_MAP,
  ZH_TW_READINGS,
} from './assist-zh-data';
import { firstBadCharacter, markupHits, officialLikeHits, requestToAiHits, type TextPatternHit } from './custom-essay';
import { multiSelectFraction } from './exam-scoring';

// ───────────────────────── 題型、格式、子模式（§2.1、§3.9） ─────────────────────────

/** 題型（16 個；學生的題目由模型從這份清單挑，不在清單換成 zh_other）。順序就是系統提示列出的順序。 */
export const ZH_SECTIONS = [
  'zh_sound',
  'zh_form',
  'zh_word',
  'zh_idiom',
  'zh_grammar',
  'zh_sequence',
  'zh_rhetoric',
  'zh_knowledge',
  'zh_classical',
  'zh_poetry',
  'zh_modern',
  'zh_judge',
  'zh_short_answer',
  'zh_writing_reason',
  'zh_writing_emotion',
  'zh_other',
] as const;
export type ZhSection = (typeof ZH_SECTIONS)[number];

export function isZhSection(value: unknown): value is ZhSection {
  return typeof value === 'string' && (ZH_SECTIONS as readonly string[]).includes(value);
}

export const ZH_SECTION_LABELS: Record<ZhSection, string> = {
  zh_sound: '字音',
  zh_form: '字形',
  zh_word: '字詞義',
  zh_idiom: '成語詞語',
  zh_grammar: '語法標點',
  zh_sequence: '文句排序',
  zh_rhetoric: '修辭手法',
  zh_knowledge: '文學文化常識與應用文',
  zh_classical: '文言',
  zh_poetry: '詩詞曲',
  zh_modern: '白話、多文本、圖表',
  zh_judge: '推論研判',
  zh_short_answer: '非選擇題',
  zh_writing_reason: '國寫知性',
  zh_writing_emotion: '國寫情意',
  zh_other: '其他',
};

/** 學生在表單上的格式（程式預填，偵測信心低時才請學生確認）。 */
export const ZH_FORMATS = ['choice', 'short', 'writing'] as const;
export type ZhFormat = (typeof ZH_FORMATS)[number];

/** 國文的解析種類（assist_cases.kind；決定輸出 schema、畫面元件、後處理與點數）。 */
export const ZH_CASE_KINDS = ['zh_choice', 'zh_short', 'zh_writing'] as const;
export type ZhCaseKind = (typeof ZH_CASE_KINDS)[number];

export function isZhCaseKind(value: unknown): value is ZhCaseKind {
  return typeof value === 'string' && (ZH_CASE_KINDS as readonly string[]).includes(value);
}

export const ZH_FORMAT_LABELS: Record<ZhFormat, string> = { choice: '選擇題', short: '簡答', writing: '國寫指導' };

export function zhKindOfFormat(format: ZhFormat): ZhCaseKind {
  return format === 'short' ? 'zh_short' : format === 'writing' ? 'zh_writing' : 'zh_choice';
}

export function zhFormatOfKind(kind: ZhCaseKind): ZhFormat {
  return kind === 'zh_short' ? 'short' : kind === 'zh_writing' ? 'writing' : 'choice';
}

/** 選擇題的子模式：決定逐選項的覆蓋規則（§5.3）與多選計分（§5.4）。 */
export const ZH_CHOICE_MODES = ['single', 'multi', 'judge', 'sequence'] as const;
export type ZhChoiceMode = (typeof ZH_CHOICE_MODES)[number];

export const ZH_CHOICE_MODE_LABELS: Record<ZhChoiceMode, string> = {
  single: '單選題',
  multi: '多選題',
  judge: '推論研判',
  sequence: '文句排序',
};

/** 一個案例能問幾題（§4.2）：選擇 ≤ 4 題；簡答 ≤ 3 題、小題合計 ≤ 6；國寫 1 題。 */
export const ZH_TARGET_LIMITS = { choice: 4, shortQuestions: 3, shortParts: 6, writing: 1 } as const;

/** 國文的學生文字上限（§4.2）：簡答每小題 120 字、國寫片段 250 字（問題（一）的答案 80 字）、國寫題目的漢字合計 2,500。 */
export const ZH_TEXT_LIMITS = {
  shortAnswerChars: 120,
  draftChars: 250,
  draftQ1Chars: 80,
  writingPromptHan: 2_500,
  /** 科目文字：漢字（加上注音字元）至少 30 個、占可見字元至少 30%（§2.5）。 */
  subjectHanMin: 30,
  subjectHanRatio: 0.3,
  /**
   * 國寫範文頁的貼上（checkZhQuestion 的 writingPaste）：學生的題目與素材合計至少 10 個漢字（命題作文常常只有一兩行，
   * 「以「我與一扇窗」為題，寫一篇文章…」不到 30 個漢字；學生已經自己選了國寫與題型，不必再用 30 字判斷科目）。
   */
  pasteWritingHanMin: 10,
} as const;

// ───────────────────────── 題型卡（§3.6） ─────────────────────────

/** 題型卡的種類（一個形狀：for_label、kind、title_zh、rows[]{head,a,b,note}，11 種欄名）。 */
export const ZH_CARD_KINDS = ['sound', 'form', 'confusables', 'sense', 'idiom', 'rule', 'fact', 'translation', 'compare', 'chart', 'poetry'] as const;
export type ZhCardKind = (typeof ZH_CARD_KINDS)[number];

export function isZhCardKind(value: unknown): value is ZhCardKind {
  return typeof value === 'string' && (ZH_CARD_KINDS as readonly string[]).includes(value);
}

export const ZH_CARD_LABELS: Record<ZhCardKind, string> = {
  sound: '字音卡',
  form: '字形卡',
  confusables: '易混字卡',
  sense: '字義卡',
  idiom: '成語卡',
  rule: '規則卡',
  fact: '知識卡',
  translation: '文言對照卡',
  compare: '比較卡',
  chart: '圖表卡',
  poetry: '詩詞卡',
};

/** 每種卡的欄名（畫面的表頭；手機版當成小標）。 */
export const ZH_CARD_COLUMNS: Record<ZhCardKind, { head: string; a: string; b: string; note: string }> = {
  sound: { head: '詞語', a: '注音', b: '判斷依據', note: '常見誤讀' },
  form: { head: '原句中的詞', a: '正確寫法', b: '正字的意思', note: '易混字' },
  confusables: { head: '易混字組', a: '音或義', b: '辨別方法', note: '例詞' },
  sense: { head: '句中字詞', a: '本句意思', b: '判斷依據', note: '其他常見義項' },
  idiom: { head: '成語或詞語', a: '本義', b: '用法', note: '本題對錯或正確例句' },
  rule: { head: '例句', a: '判定', b: '判斷方法', note: '對照例' },
  fact: { head: '名詞', a: '重點事實', b: '易混對照', note: '記憶法' },
  translation: { head: '原文句', a: '白話', b: '關鍵字詞', note: '句式' },
  compare: { head: '比較項目', a: '甲文', b: '乙文', note: '異同' },
  chart: { head: '項目', a: '數值或內容', b: '讀法', note: '對應選項' },
  poetry: { head: '詩句', a: '意象與字面意思', b: '情感與手法', note: '格律' },
};

/** 每種卡的列數上限（程式截斷；上限只寫在 .describe()，不增加 grammar）。 */
export const ZH_CARD_ROW_MAX: Record<ZhCardKind, number> = {
  sound: 12,
  form: 6,
  confusables: 6,
  sense: 12,
  idiom: 5,
  rule: 6,
  fact: 6,
  translation: 8,
  compare: 6,
  chart: 6,
  poetry: 6,
};

/** head 是題目原文、要做原文核對的卡（找不到時保留白話與說明，只拿掉原文標示）。 */
export const ZH_SOURCE_HEAD_CARDS = ['translation', 'poetry'] as const satisfies readonly ZhCardKind[];

/** 同一案例的卡片張數上限：≤ 4，而且 ≤ 題數＋1。 */
export function zhCardsMax(items: number): number {
  return Math.min(4, Math.max(1, Math.floor(items)) + 1);
}

/** 同一案例全部卡片的列數合計上限：9＋3n（n＝題數；1 題 12 列、4 題 21 列）。 */
export function zhCardRowsTotalMax(items: number): number {
  return 9 + 3 * Math.max(1, Math.floor(items));
}

// ───────────────────────── 錯因、選項瑕疵、技能代碼（§3.9） ─────────────────────────

/** 錯因族（8 族）。每族對到英文的通用錯因（GENERAL_ERROR_TAGS），給之後的跨科報告用。 */
export const ZH_ERROR_FAMILIES = ['form', 'word', 'rule', 'knowledge', 'reading', 'answering', 'writing', 'general'] as const;
export type ZhErrorFamily = (typeof ZH_ERROR_FAMILIES)[number];

export const ZH_ERROR_FAMILY_LABELS: Record<ZhErrorFamily, string> = {
  form: '字音字形',
  word: '詞語',
  rule: '語文規則',
  knowledge: '知識',
  reading: '閱讀理解',
  answering: '作答',
  writing: '寫作',
  general: '通用',
};

/** 錯因代碼（41 個；順序就是系統提示列出的順序）。通用的三個和英文同名，但計數一律依科目（§7.3）。 */
export const ZH_ERROR_CODES = [
  'zh_sound_side',
  'zh_sound_polyphone',
  'zh_form_homophone',
  'zh_form_lookalike',
  'zh_form_unfamiliar',
  'zh_literal',
  'zh_ancient_modern',
  'zh_polysemy',
  'zh_function_word',
  'zh_idiom_usage',
  'zh_grammar',
  'zh_sentence_pattern',
  'zh_rhetoric',
  'zh_punctuation',
  'zh_cohesion',
  'zh_application',
  'zh_literary_knowledge',
  'zh_culture_knowledge',
  'zh_classical_sense',
  'zh_no_evidence',
  'zh_over_inference',
  'zh_shift',
  'zh_relation_confusion',
  'zh_main_idea',
  'zh_technique',
  'zh_multitext',
  'zh_judge_category',
  'zh_question_misread',
  'zh_partial',
  'zh_vague',
  'zh_answer_format',
  'zh_key_typo',
  'zh_task_offtrack',
  'zh_thin_content',
  'zh_weak_logic',
  'zh_structure',
  'zh_expression',
  'zh_shallow_feeling',
  'careless',
  'time',
  'knowledge_gap',
] as const;
export type ZhErrorCode = (typeof ZH_ERROR_CODES)[number];

/** 每個錯因的中文標籤、所屬的族、可用的格式；note 是和相近代碼的界線（寫進系統提示）。 */
export const ZH_ERROR_INFO: Record<ZhErrorCode, { label: string; family: ZhErrorFamily; kinds: readonly ZhCaseKind[]; note?: string }> = {
  zh_sound_side: { label: '有邊讀邊', family: 'form', kinds: ['zh_choice'] },
  zh_sound_polyphone: { label: '破音字或審定音', family: 'form', kinds: ['zh_choice'] },
  zh_form_homophone: { label: '同音、音近字誤用', family: 'form', kinds: ['zh_choice'] },
  zh_form_lookalike: { label: '形近字誤認', family: 'form', kinds: ['zh_choice'] },
  zh_form_unfamiliar: { label: '把陌生但正確的詞當成錯字', family: 'form', kinds: ['zh_choice'] },
  zh_literal: { label: '望文生義', family: 'word', kinds: ['zh_choice', 'zh_short'], note: '照字面猜意思；知道意思但用錯是 zh_idiom_usage' },
  zh_ancient_modern: { label: '古今異義', family: 'word', kinds: ['zh_choice', 'zh_short'] },
  zh_polysemy: { label: '一詞多義', family: 'word', kinds: ['zh_choice', 'zh_short'] },
  zh_function_word: { label: '文言虛詞', family: 'word', kinds: ['zh_choice', 'zh_short'] },
  zh_idiom_usage: { label: '成語用法（對象、褒貶、情境）', family: 'word', kinds: ['zh_choice', 'zh_short'], note: '知道意思，但用錯對象、褒貶或情境' },
  zh_grammar: { label: '語法判斷', family: 'rule', kinds: ['zh_choice', 'zh_short'] },
  zh_sentence_pattern: { label: '文言句式', family: 'rule', kinds: ['zh_choice', 'zh_short'] },
  zh_rhetoric: { label: '認錯修辭格', family: 'rule', kinds: ['zh_choice', 'zh_short'], note: '認錯修辭格；說錯手法的作用或效果是 zh_technique' },
  zh_punctuation: { label: '標點', family: 'rule', kinds: ['zh_choice', 'zh_short'] },
  zh_cohesion: { label: '銜接與排序', family: 'rule', kinds: ['zh_choice', 'zh_short'] },
  zh_application: { label: '應用文用語', family: 'rule', kinds: ['zh_choice', 'zh_short'] },
  zh_literary_knowledge: { label: '文學常識', family: 'knowledge', kinds: ['zh_choice', 'zh_short'] },
  zh_culture_knowledge: { label: '國學文化常識', family: 'knowledge', kinds: ['zh_choice', 'zh_short'] },
  zh_classical_sense: { label: '文言句意', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_no_evidence: { label: '沒回原文找證據', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_over_inference: { label: '過度推論', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_shift: { label: '偷換概念、範圍、程度或因果', family: 'reading', kinds: ['zh_choice', 'zh_short'], note: '不含主體錯置（主體與對象錯置是 zh_relation_confusion）' },
  zh_relation_confusion: { label: '人物關係、主體與對象錯置', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_main_idea: { label: '主旨或立場判斷錯', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_technique: { label: '手法的作用、效果或段落功能', family: 'reading', kinds: ['zh_choice', 'zh_short'], note: '說錯手法的作用或效果；認錯修辭格是 zh_rhetoric' },
  zh_multitext: { label: '多文本或圖表整合', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_judge_category: { label: '否定標籤與無法判斷混淆', family: 'reading', kinds: ['zh_choice', 'zh_short'] },
  zh_question_misread: { label: '看錯題目要求', family: 'answering', kinds: ['zh_choice', 'zh_short', 'zh_writing'] },
  zh_partial: { label: '要件不全', family: 'answering', kinds: ['zh_short'] },
  zh_vague: { label: '答案空泛', family: 'answering', kinds: ['zh_short'] },
  zh_answer_format: { label: '字數、格式或抄錄規定不合', family: 'answering', kinds: ['zh_short'] },
  zh_key_typo: { label: '關鍵字寫錯字', family: 'answering', kinds: ['zh_short'] },
  zh_task_offtrack: { label: '審題偏離或漏要件', family: 'writing', kinds: ['zh_writing'] },
  zh_thin_content: { label: '內容空泛', family: 'writing', kinds: ['zh_writing'] },
  zh_weak_logic: { label: '論述不清', family: 'writing', kinds: ['zh_writing'] },
  zh_structure: { label: '結構問題', family: 'writing', kinds: ['zh_writing'] },
  zh_expression: { label: '文辭（含錯字、標點）', family: 'writing', kinds: ['zh_writing'] },
  zh_shallow_feeling: { label: '情意浮泛', family: 'writing', kinds: ['zh_writing'] },
  careless: { label: '粗心', family: 'general', kinds: ['zh_choice', 'zh_short', 'zh_writing'] },
  time: { label: '時間不夠、用猜的', family: 'general', kinds: ['zh_choice', 'zh_short', 'zh_writing'] },
  knowledge_gap: { label: '缺背景知識', family: 'general', kinds: ['zh_choice', 'zh_short', 'zh_writing'] },
};

/** 錯因族 → 英文的通用錯因（通用族依代碼：careless、time 對到同名，knowledge_gap 同英文對到 vocab）。 */
const ZH_FAMILY_GENERAL: Record<Exclude<ZhErrorFamily, 'general'>, GeneralErrorTag> = {
  form: 'vocab',
  word: 'vocab',
  rule: 'grammar',
  knowledge: 'vocab',
  reading: 'context',
  answering: 'misread',
  writing: 'context',
};

export function zhErrorGeneral(code: ZhErrorCode): GeneralErrorTag {
  const family = ZH_ERROR_INFO[code].family;
  if (family !== 'general') return ZH_FAMILY_GENERAL[family];
  return code === 'careless' ? 'careless' : code === 'time' ? 'time' : 'vocab';
}

export function isZhErrorCode(value: unknown): value is ZhErrorCode {
  return typeof value === 'string' && (ZH_ERROR_CODES as readonly string[]).includes(value);
}

/** 這個代碼能不能用在這個格式（不在範圍的由程式丟掉；同一種錯不會分散到兩族）。 */
export function zhErrorCodeAllowed(code: string, kind: ZhCaseKind): boolean {
  return isZhErrorCode(code) && ZH_ERROR_INFO[code].kinds.includes(kind);
}

/** 這個格式可以用的錯因代碼（依 ZH_ERROR_CODES 的順序；系統提示只列這些）。 */
export function zhErrorCodesFor(kind: ZhCaseKind): ZhErrorCode[] {
  return ZH_ERROR_CODES.filter((code) => ZH_ERROR_INFO[code].kinds.includes(kind));
}

/** 錯因的中文標籤；跨科的畫面上加「國文：」前綴。不認得的代碼回 null。 */
export function zhErrorLabel(code: string, opts: { prefix?: boolean } = {}): string | null {
  if (!isZhErrorCode(code)) return null;
  return `${opts.prefix ? '國文：' : ''}${ZH_ERROR_INFO[code].label}`;
}

/**
 * 這個代碼在這一科算不算錯因（Worker 的同科計數、歷史一行、錯因統計用；§7.3）。英文用原本的 isAssistErrorCode（不改），
 * 國文用 isZhErrorCode；通用的三個代碼兩科都認得，計數時由呼叫端依案例的科目分開數。
 */
export function isSubjectErrorCode(subject: AssistSubject, code: unknown): boolean {
  return subject === 'chinese' ? isZhErrorCode(code) : isAssistErrorCode(code);
}

/** 選項瑕疵代碼（13 個；正確選項的 flaw 是空字串）。 */
export const ZH_FLAW_CODES = [
  'zf_wrong_fact',
  'zf_reversed',
  'zf_scope',
  'zf_degree',
  'zf_subject_swap',
  'zf_unstated',
  'zf_mismatch',
  'zf_surface',
  'zf_true_irrelevant',
  'zf_misread_word',
  'zf_misuse',
  'zf_form_error',
  'zf_misclassified',
] as const;
export type ZhFlawCode = (typeof ZH_FLAW_CODES)[number];

export const ZH_FLAW_LABELS: Record<ZhFlawCode, string> = {
  zf_wrong_fact: '與原文事實不符',
  zf_reversed: '正反顛倒或因果倒置',
  zf_scope: '範圍擴大或縮小',
  zf_degree: '程度誇大',
  zf_subject_swap: '偷換主體',
  zf_unstated: '無中生有',
  zf_mismatch: '張冠李戴',
  zf_surface: '字面相同、意思不同',
  zf_true_irrelevant: '敘述正確但不合題問',
  zf_misread_word: '字詞誤解',
  zf_misuse: '用法不當',
  zf_form_error: '字形或讀音錯',
  zf_misclassified: '歸類錯誤',
};

export function isZhFlawCode(value: unknown): value is ZhFlawCode {
  return typeof value === 'string' && (ZH_FLAW_CODES as readonly string[]).includes(value);
}

/** 技能代碼（13 個）：國綜的公開測驗目標 A1–A6、B1–B5，國寫的知性與情意（事實資訊）。 */
export const ZH_SKILL_CODES = [
  'zs:A1',
  'zs:A2',
  'zs:A3',
  'zs:A4',
  'zs:A5',
  'zs:A6',
  'zs:B1',
  'zs:B2',
  'zs:B3',
  'zs:B4',
  'zs:B5',
  'zs:W1',
  'zs:W2',
] as const;
export type ZhSkillCode = (typeof ZH_SKILL_CODES)[number];

export const ZH_SKILL_LABELS: Record<ZhSkillCode, string> = {
  'zs:A1': '字形、字音、字義',
  'zs:A2': '語詞與成語',
  'zs:A3': '語法',
  'zs:A4': '表現手法與表述方式',
  'zs:A5': '文學、作家作品與體類流派',
  'zs:A6': '學術思想與文化',
  'zs:B1': '訊息檢索與擷取',
  'zs:B2': '文意理解、比較分析與統整',
  'zs:B3': '內容延伸與反思',
  'zs:B4': '形式推究與分析',
  'zs:B5': '詮釋與鑑賞（結合文學、文化知識）',
  'zs:W1': '國寫：知性統整與判斷',
  'zs:W2': '國寫：情意感受與抒發',
};

export function isZhSkillCode(value: unknown): value is ZhSkillCode {
  return typeof value === 'string' && (ZH_SKILL_CODES as readonly string[]).includes(value);
}

// ───────────────────────── 題型設定與解法步驟（§1.7、§3.6、§3.9） ─────────────────────────

export interface ZhSectionSpec {
  /** 這個題型會出現在哪幾種格式（系統提示只放這個格式會用到的題型）。 */
  kinds: readonly ZhCaseKind[];
  /** 可用的題型卡（依 for_label 那一題的 item_type 判斷；不在清單的卡由程式丟掉）。 */
  cards: readonly ZhCardKind[];
  /** 「一定要涵蓋」（英文，系統提示的題型段落）。 */
  cover_en: string;
  /** 逐選項的 key_zh 寫法（英文說明＋中文例子）；非選與國寫是空字串。 */
  key_en: string;
  key_example_zh: string;
  /** 可用的錯因族。 */
  families: readonly ZhErrorFamily[];
  /** 監看用的長度預算（中文字；每多一題、或附片段時的增量）。 */
  length_zh: { base: number; per_extra_item?: number; with_draft?: number };
  /** 這類題的解法（本站自寫，3–4 步；畫面依每題的 item_type 附上，同一案例同一題型只顯示一次）。 */
  steps_title_zh: string;
  steps_zh: readonly string[];
}

/**
 * 每一個題型的設定（§1.7 的表）。系統提示的題型段落（一定要涵蓋、可用的卡、key_zh 寫法、長度）與畫面的解法步驟都從這裡產生：
 * 改了任何一個字，國文提示的雜湊就會變（apps/api/test/fixtures/assist-prompts-zh.json 要跟著更新）。
 * steps_zh 是本站自寫的，不引任何官方解析或評分原則（D8 指紋掃描要 0 命中，§11.1）。
 */
export const ZH_SECTION_SPECS: Record<ZhSection, ZhSectionSpec> = {
  zh_sound: {
    kinds: ['zh_choice'],
    cards: ['sound', 'confusables'],
    cover_en:
      "the 注音 of every character asked in Taiwan's standard reading (審定音, citation tone), why it is read that way, which pairs are phonetic-component traps, and easily confused readings",
    key_en: 'the reading of each character and whether they match; for a set of three characters give three readings',
    key_example_zh: '前ㄆㄧˊ／後ㄆㄧˊ：同',
    families: ['form', 'answering', 'general'],
    length_zh: { base: 1_200 },
    steps_title_zh: '字音：先寫音再比對',
    steps_zh: ['把每組被問的字的注音都寫下來', '圈出相同的聲旁，提醒自己同聲旁不一定同音', '破音字看它在這個詞裡的意思或詞性決定讀音', '最後才比對前後讀音是否相同'],
  },
  zh_form: {
    kinds: ['zh_choice'],
    cards: ['form', 'confusables'],
    cover_en:
      "for each sentence the wrong character → the correct one and the correct character's meaning (quote enough context to judge the word); why an unfamiliar but correct word is not wrong",
    key_en: 'the wrong word → the correct word, or that the sentence has no wrong character',
    key_example_zh: '「不斐」→「不菲」',
    families: ['form', 'answering', 'general'],
    length_zh: { base: 1_400 },
    steps_title_zh: '字形：先義後形',
    steps_zh: ['每句只找成語或關鍵詞', '把詞拆成單字，問這個字的意思說不說得通', '說不通就換同音或形近的字試試', '用排除法確定哪幾句有錯字'],
  },
  zh_word: {
    kinds: ['zh_choice'],
    cards: ['sense'],
    cover_en:
      "the meaning of the word in each sentence and the evidence (part of speech, sentence pattern, collocation); for function words explain the function; when the question has annotations, follow them and cite 注X",
    key_en: 'the meaning in each sentence and whether they match',
    key_example_zh: '前：被／後：被：同',
    families: ['word', 'rule', 'answering', 'general'],
    length_zh: { base: 1_600, per_extra_item: 600 },
    steps_title_zh: '字詞義：代入與比較',
    steps_zh: ['先判斷兩句裡這個字的詞性', '找句式線索，例如「為…所…」', '把候選的意思代回句子讀讀看', '兩句分別判定後再比較'],
  },
  zh_idiom: {
    kinds: ['zh_choice'],
    cards: ['idiom'],
    cover_en:
      'the original meaning; the target, connotation and context of use; whether this sentence uses it correctly. Name a source book only when sure, never recite the source text, otherwise write 「出處待查」',
    key_en: 'why the usage fits or does not fit this sentence',
    key_example_zh: '隱居之志，不能用在參選',
    families: ['word', 'answering', 'general'],
    length_zh: { base: 1_800 },
    steps_title_zh: '成語：四項檢查',
    steps_zh: ['本義：這個成語原來是什麼意思', '對象：用在人、事還是物', '褒貶：是稱讚還是批評', '情境：時機與程度合不合'],
  },
  zh_grammar: {
    kinds: ['zh_choice'],
    cards: ['rule'],
    cover_en:
      "quote the definition or classification the question gives in the first solution step, then apply it to each example; use only the question's category names",
    key_en: "the category, using the question's own category names",
    key_example_zh: '借用量詞（題目的分類）',
    families: ['rule', 'answering', 'general'],
    length_zh: { base: 1_500 },
    steps_title_zh: '語法標點：先立標準再套例',
    steps_zh: ['把題目給的定義或分類表讀成一句規則', '逐例找出要判斷的成分', '套用規則判定', '用對照例再確認一次'],
  },
  zh_sequence: {
    kinds: ['zh_choice'],
    cards: ['rule'],
    cover_en: 'the clue for the first sentence, paired connectives and what each reference (其、此、之) points to, then read the whole order once',
    key_en: 'only for the correct order and the order the student chose: the decisive link',
    key_example_zh: '「及其…則…」相連',
    families: ['rule', 'reading', 'answering', 'general'],
    length_zh: { base: 1_500 },
    steps_title_zh: '文句排序：線索配對',
    steps_zh: ['先找首句：總起或交代背景的句子', '把成對的關聯詞配起來', '確認代詞指向誰', '排好之後整段順讀一次'],
  },
  zh_rhetoric: {
    kinds: ['zh_choice'],
    cards: ['rule'],
    cover_en:
      'formal feature → device (the name used in Taiwanese textbooks) → effect; when the question defines its terms, quote the definition first',
    key_en: 'the device and the words that show it',
    key_example_zh: '映襯：以熱鬧反襯孤單',
    families: ['rule', 'reading', 'answering', 'general'],
    length_zh: { base: 1_500 },
    steps_title_zh: '修辭：形式、手法、效果',
    steps_zh: ['找出形式特徵，例如比較詞、擬人的動詞、對稱的句子', '判定是哪一種修辭或手法', '說出它在句子裡的效果'],
  },
  zh_knowledge: {
    kinds: ['zh_choice', 'zh_short'],
    cards: ['fact'],
    cover_en:
      'literary knowledge: period, genre, author; practical writing: who writes to whom and for what occasion; recitation: compare with the original word by word',
    key_en: 'the decisive fact (relationship, occasion, period or genre)',
    key_example_zh: '賀生子用語，不是賀婚',
    families: ['rule', 'knowledge', 'answering', 'general'],
    length_zh: { base: 1_500 },
    steps_title_zh: '知識與應用文：先定位',
    steps_zh: ['應用文先判斷誰寫給誰、輩分與親疏', '確定場合：賀婚、賀生子、祝壽、哀輓或書信', '套用對應的用語，檢查自稱與稱人是否一致', '文學常識把作品放回時代、文體與作家'],
  },
  zh_classical: {
    kinds: ['zh_choice', 'zh_short'],
    cards: ['translation', 'sense', 'compare'],
    cover_en:
      'key words (consistent with the annotations, cite 注X), a sentence-by-sentence translation of the sentences the questions touch, sentence patterns, who speaks to whom, and the evidence for each inference',
    key_en: 'the original words and their meaning',
    key_example_zh: '原文：「惑而不從師」→白話：有疑惑卻不向老師學習',
    families: ['word', 'rule', 'reading', 'answering', 'general'],
    length_zh: { base: 2_200, per_extra_item: 900 },
    steps_title_zh: '文言：字、句、意',
    steps_zh: ['先讀題目，知道要找什麼', '找出相關的句子，解釋關鍵字詞', '逐句直譯，判斷句式與誰對誰說', '回到選項逐項對照原文'],
  },
  zh_poetry: {
    kinds: ['zh_choice', 'zh_short'],
    cards: ['poetry', 'compare', 'translation'],
    cover_en:
      'imagery → feeling → technique; write meter only when the question tests it: visible rhyme and parallelism, and tones only of the characters asked, marking entering tones (入聲)',
    key_en: 'the image, feeling or form that decides the option',
    key_example_zh: '上下句對仗，詞性要相同',
    families: ['word', 'knowledge', 'reading', 'answering', 'general'],
    length_zh: { base: 1_800, per_extra_item: 800 },
    steps_title_zh: '詩詞曲：意象、情感、手法',
    steps_zh: ['找出關鍵意象與字面意思', '判斷情感與轉折', '說出手法', '題目考格律時，再用對仗與押韻驗證'],
  },
  zh_modern: {
    kinds: ['zh_choice', 'zh_short'],
    cards: ['compare', 'chart'],
    cover_en:
      'locate the evidence in the text, the reasoning chain and what is wrong with each option (flaw code); a comparison table for several texts; for charts, how to read them (units, baseline, trend)',
    key_en: 'what the option gets wrong compared with the text',
    key_example_zh: '偷換概念：原文說的是…',
    families: ['reading', 'answering', 'general'],
    length_zh: { base: 1_800, per_extra_item: 900 },
    steps_title_zh: '白話閱讀：定位、比對、排除',
    steps_zh: ['圈出題幹的關鍵詞', '回到原文找到對應的句子', '把選項和原文逐詞比對', '標出偷換、擴大或無中生有，選最有依據的'],
  },
  zh_judge: {
    kinds: ['zh_choice'],
    cards: [],
    cover_en:
      "split each statement into subject, judgement and scope; use the question's own labels; the negative label is for statements that contradict or misreport the text, 無法判斷 only for statements beyond the text; split the student's chosen combination into per-statement judgements",
    key_en: "the label and why, quoting what the text actually says",
    key_example_zh: '不符合：原文是「士人批判俠」，不是「俠的興衰」',
    families: ['reading', 'answering', 'general'],
    length_zh: { base: 1_600 },
    steps_title_zh: '推論研判：三分法',
    steps_zh: [
      '每句敘述拆成主體、判斷與範圍',
      '原文說了或能直接推出，判肯定的標籤',
      '和原文矛盾，或把原文說的、做的講錯了，判否定的標籤',
      '原文沒說也推不出、真假都有可能，才判無法判斷',
    ],
  },
  zh_short_answer: {
    kinds: ['zh_short'],
    cards: ['translation', 'compare'],
    cover_en:
      'how many things are asked, the character limit and the copying rule → the required elements with evidence from the text → a sentence frame → a sample answer within the limit → a check of the student’s answer',
    key_en: '',
    key_example_zh: '',
    families: ['word', 'rule', 'knowledge', 'reading', 'answering', 'general'],
    length_zh: { base: 1_800, per_extra_item: 1_800 },
    steps_title_zh: '非選擇題：拆要件、找依據、組句、對字數',
    steps_zh: ['數一數題目要回答幾件事', '每一件事都回原文找依據', '依抄錄規定組成回答題目的句子', '檢查主語、錯字與字數'],
  },
  zh_writing_reason: {
    kinds: ['zh_writing'],
    cards: [],
    cover_en:
      'the core of the material and the requirements of the task quoting the prompt; for 問題（一） the points with a quote from the material for each; for 問題（二） stances, material, structure, a demonstration and common mistakes',
    key_en: '',
    key_example_zh: '',
    families: ['writing', 'answering', 'general'],
    length_zh: { base: 2_400, with_draft: 800 },
    steps_title_zh: '國寫知性：讀素材、抓要件、立論、回扣',
    steps_zh: ['問題（一）只依素材說明，不加自己的評價', '把問題（二）的要求逐條列出來', '先定立場，每段一個論點加具體事例與分析', '結尾回扣題目，提出自己的省思'],
  },
  zh_writing_emotion: {
    kinds: ['zh_writing'],
    cards: [],
    cover_en:
      "the prompt's key words and guiding questions are required elements; the main idea, material, the scene → turn → insight structure, and a demonstration",
    key_en: '',
    key_example_zh: '',
    families: ['writing', 'answering', 'general'],
    length_zh: { base: 2_200, with_draft: 800 },
    steps_title_zh: '國寫情意：場景、轉折、體悟',
    steps_zh: ['拆出題目的關鍵詞與引導問題，每一個都要寫到', '選一件具體的事，開頭用場景與感官細節', '寫出轉折：觸發、衝突或換位思考', '體悟回扣題目，不喊口號'],
  },
  zh_other: {
    kinds: ['zh_choice', 'zh_short', 'zh_writing'],
    cards: ['sense', 'rule', 'fact', 'translation', 'compare', 'chart'],
    cover_en: 'follow the closest mode above, usually the modern reading mode',
    key_en: 'the decisive fact for the option',
    key_example_zh: '',
    families: ['form', 'word', 'rule', 'knowledge', 'reading', 'answering', 'writing', 'general'],
    length_zh: { base: 1_800 },
    steps_title_zh: '先弄清楚題目要什麼',
    steps_zh: ['確認題目問的是什麼', '回到題目或原文找依據', '逐項比對之後再下結論'],
  },
};

/** 多選題策略（所有多選題另外附這一組；本站自寫）。 */
export const ZH_MULTI_STRATEGY = {
  title_zh: '多選題策略',
  steps_zh: ['每個選項獨立判斷：誤選和漏選一樣扣分', '有把握超過一半才選', '不要用答案的個數猜', '沒把握的選項可以不選，但不要整題空白'],
} as const;

/** 本站自寫、會顯示給學生的解法文字（每個題型的步驟與多選題策略）：D8 指紋掃描用，要 0 命中（§11.1）。 */
export function zhSelfWrittenStepTexts(): string[] {
  return [
    ...ZH_SECTIONS.flatMap((s) => [ZH_SECTION_SPECS[s].steps_title_zh, ...ZH_SECTION_SPECS[s].steps_zh]),
    ZH_MULTI_STRATEGY.title_zh,
    ...ZH_MULTI_STRATEGY.steps_zh,
  ];
}

/** 這個題型能不能用這種卡。 */
export function zhCardAllowed(section: ZhSection, card: ZhCardKind): boolean {
  return ZH_SECTION_SPECS[section].cards.includes(card);
}

// ───────────────────────── 模型輸出的欄位上限（§3.2–§3.5） ─────────────────────────

/** 有欄位上限的國文輸出：三種解析、追問、轉錄與國寫範文（國寫範文設計 §3.1）。 */
export const ZH_OUTPUT_KINDS = ['zh_choice', 'zh_short', 'zh_writing', 'zh_followup', 'zh_ocr', 'zh_exemplar'] as const;
export type ZhOutputKind = (typeof ZH_OUTPUT_KINDS)[number];

/** 選擇與簡答共用的頭段（題型卡的列數上限依卡的種類另外截斷，ZH_CARD_ROW_MAX）。 */
const ZH_HEAD_LIMITS = {
  skill_codes: { max: 3 },
  tested_zh: { chars: 150 },
  passage_zh: { chars: 300 },
  cards: { max: 4 },
  'cards[].for_label': { chars: 8 },
  'cards[].title_zh': { chars: 30 },
  'cards[].rows': { max: 12 },
  'cards[].rows[].head': { chars: 40 },
  'cards[].rows[].a': { chars: 60 },
  'cards[].rows[].b': { chars: 60 },
  'cards[].rows[].note': { chars: 40 },
} as const satisfies Record<string, AssistFieldLimit>;

/** 選擇與簡答共用的尾段。 */
const ZH_TAIL_LIMITS = {
  'method.title_zh': { chars: 30 },
  'method.steps_zh': { min: 2, max: 4, chars: 50 },
  score_tips_zh: { min: 2, max: 3, chars: 60 },
  doubt_replies: { max: 2 },
  'doubt_replies[].doubt_zh': { chars: 60 },
  'doubt_replies[].reply_zh': { chars: 200 },
  followup_chips_zh: { max: 3, chars: 30 },
  key_concern_zh: { chars: 150 },
} as const satisfies Record<string, AssistFieldLimit>;

/**
 * 每一欄的上限（設計值；改了要同步設計文件 §3.2–§3.5 的表，國文提示會跟著變）。鍵是欄位路徑（陣列寫成 []），
 * 順序就是系統提示列出的順序。說明文字沿用 assist.ts 的 assistLimitText。
 */
export const ZH_FIELD_LIMITS = {
  zh_choice: {
    ...ZH_HEAD_LIMITS,
    items: { min: 1, max: 4 },
    'items[].answer.text': { chars: 20 },
    'items[].diagnosis.error_codes': { max: 3 },
    'items[].diagnosis.summary_zh': { chars: 100 },
    'items[].diagnosis.detail_zh': { chars: 250 },
    'items[].hints_zh': { min: 2, max: 3, chars: 60 },
    'items[].solution_steps': { min: 2, max: 4 },
    'items[].solution_steps[].text_zh': { chars: 140 },
    'items[].solution_steps[].quote': { chars: 40 },
    'items[].options': { max: 5 },
    'items[].options[].key_zh': { chars: 40 },
    'items[].options[].reason_zh': { chars: 100 },
    'items[].options[].quote': { chars: 40 },
    ...ZH_TAIL_LIMITS,
  },
  zh_short: {
    ...ZH_HEAD_LIMITS,
    parts: { min: 1, max: 6 },
    'parts[].task_zh': { chars: 80 },
    'parts[].key_points': { max: 4 },
    'parts[].key_points[].point_zh': { chars: 60 },
    'parts[].key_points[].quote': { chars: 40 },
    'parts[].frame_zh': { chars: 40 },
    'parts[].demo_zh': { chars: 60 },
    'parts[].hints_zh': { min: 2, max: 3, chars: 60 },
    'parts[].check.missing_zh': { chars: 120 },
    'parts[].check.wording_zh': { chars: 100 },
    ...ZH_TAIL_LIMITS,
  },
  zh_writing: {
    skill_codes: { max: 3 },
    tested_zh: { chars: 150 },
    material_zh: { chars: 300 },
    requirements: { max: 5 },
    'requirements[].point_zh': { chars: 60 },
    'requirements[].quote': { chars: 40 },
    'requirements[].how_zh': { chars: 120 },
    'q1.points_zh': { max: 3, chars: 50 },
    'q1.quotes': { max: 3, chars: 40 },
    'q1.frame_zh': { chars: 40 },
    'q1.demo_zh': { chars: 80 },
    stances_zh: { max: 3, chars: 60 },
    angles_zh: { max: 4, chars: 60 },
    outline: { max: 5 },
    'outline[].part_zh': { chars: 20 },
    'outline[].hint_zh': { chars: 100 },
    examples: { max: 3 },
    'examples[].use_zh': { chars: 12 },
    'examples[].text': { chars: 150 },
    pitfalls_zh: { max: 4, chars: 60 },
    draft_checks: { max: 4 },
    'draft_checks[].point_zh': { chars: 60 },
    'draft_checks[].comment_zh': { chars: 120 },
    'draft_checks[].quote': { chars: 40 },
    typos: { max: 8 },
    'typos[].wrong': { chars: 6 },
    'typos[].right': { chars: 6 },
    'typos[].quote': { chars: 30 },
    checklist_zh: { max: 5, chars: 40 },
    doubt_replies: { max: 2 },
    'doubt_replies[].doubt_zh': { chars: 60 },
    'doubt_replies[].reply_zh': { chars: 200 },
    followup_chips_zh: { max: 3, chars: 30 },
  },
  zh_followup: {
    reply_zh: { chars: 500 },
    points: { max: 3 },
    'points[].text_zh': { chars: 120 },
    'points[].example': { chars: 60 },
    new_error_codes: { max: 2 },
    understood_check_zh: { chars: 80 },
    followup_chips_zh: { max: 3, chars: 30 },
  },
  zh_ocr: {
    blocks: { max: 40 },
    'blocks[].label': { chars: 8 },
    'blocks[].text': { chars: 3_000 },
    'blocks[].unclear[].candidates': { max: 3 },
    student_answer_seen: { chars: 300 },
  },
  // 國寫範文（國寫範文設計 §3.1）：段落本文不截斷（總長由字數與格數的檢查管）；問題（一）的硬限制由程式依題目決定（預設 80）。
  zh_exemplar: {
    title_zh: { chars: 16 },
    'q1.answer_zh': { chars: 120 },
    'q1.material_quotes': { max: 2, chars: 40 },
    paragraphs: { min: 2, max: 6 },
    'paragraphs[].role_zh': { chars: 20 },
    'paragraphs[].technique_zh': { chars: 60 },
    notes: { min: 2, max: 4 },
    'notes[].text_zh': { chars: 120 },
    coverage: { max: 5 },
    'coverage[].point_zh': { chars: 40 },
    'coverage[].quote': { chars: 30 },
    self_check_zh: { min: 3, max: 5, chars: 40 },
  },
} as const satisfies Record<ZhOutputKind, Record<string, AssistFieldLimit>>;

/** 某種國文輸出的某一欄的上限（沒有列出的欄位回 undefined：不截斷）。 */
export function zhFieldLimit(kind: ZhOutputKind, path: string): AssistFieldLimit | undefined {
  return (ZH_FIELD_LIMITS[kind] as Readonly<Record<string, AssistFieldLimit>>)[path];
}

/** 國寫示範的規則（§5.5）：三句以內、每句 ≤ 50 字；或只有一筆 ≤ 150 字的「主體段示範」。合計 ≤ 150 字。 */
export const ZH_WRITING_EXAMPLE_RULES = { sentenceMaxChars: 50, sentencesMax: 3, bodyMaxChars: 150, totalMaxChars: 150, bodyUseLabel: '主體段示範' } as const;

/** 除了主體段示範之外，任何欄位出現超過這麼多個連續漢字（不含標點）就截斷：擋一次寫出整段的最後一道防線（§5.5）。 */
export const ZH_HAN_RUN_MAX = 120;

// ───────────────────────── 確定程度、判定與小列舉（§3.1、§5.1 第 2、11 步） ─────────────────────────

export const ZH_CERTAINTIES = ['sure', 'likely', 'unsure'] as const;
export type ZhCertainty = (typeof ZH_CERTAINTIES)[number];
export const ZH_CERTAINTY_LABELS: Record<ZhCertainty, string> = { sure: '很確定', likely: '可能', unsure: '不確定' };

/** 逐選項的判定：一般選項是「該不該選」；研判題的敘述是肯定、否定標籤或無法判斷。 */
export const ZH_VERDICTS = ['yes', 'no', 'cannot_tell'] as const;
export type ZhVerdict = (typeof ZH_VERDICTS)[number];

export const ZH_COVERAGES = ['full', 'partial', 'none', 'unanswered'] as const;
export type ZhCoverage = (typeof ZH_COVERAGES)[number];

export const ZH_DRAFT_STATUSES = ['met', 'partly', 'missing'] as const;
export type ZhDraftStatus = (typeof ZH_DRAFT_STATUSES)[number];

/** 小列舉在 schema 裡是字串（寫錯一個值不會造成付費重試），由這幾支正規化；不認得回 null，由呼叫端用最保守的值。 */
function enumKey(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

const VERDICT_WORDS: Record<string, ZhVerdict> = {
  yes: 'yes', y: 'yes', true: 'yes', '✓': 'yes', '✔': 'yes', 該選: 'yes', 選: 'yes', 是: 'yes', 符合: 'yes', 適當: 'yes', 正確: 'yes', 恰當: 'yes', 合理: 'yes', 相同: 'yes',
  no: 'no', n: 'no', false: 'no', '✗': 'no', '✘': 'no', x: 'no', 不選: 'no', 否: 'no', 不符合: 'no', 不適當: 'no', 錯誤: 'no', 不正確: 'no', 不恰當: 'no', 不合理: 'no', 不同: 'no',
  cannot_tell: 'cannot_tell', cannottell: 'cannot_tell', unknown: 'cannot_tell', '?': 'cannot_tell', 無法判斷: 'cannot_tell', 不能判斷: 'cannot_tell', 無從判斷: 'cannot_tell',
};

export function normalizeZhVerdict(value: unknown): ZhVerdict | null {
  return VERDICT_WORDS[enumKey(value)] ?? null;
}

const CERTAINTY_WORDS: Record<string, ZhCertainty> = {
  sure: 'sure', certain: 'sure', 很確定: 'sure', 確定: 'sure',
  likely: 'likely', probable: 'likely', 可能: 'likely', 大概: 'likely',
  unsure: 'unsure', uncertain: 'unsure', not_sure: 'unsure', 不確定: 'unsure',
};

export function normalizeZhCertainty(value: unknown): ZhCertainty | null {
  return CERTAINTY_WORDS[enumKey(value)] ?? null;
}

const COVERAGE_WORDS: Record<string, ZhCoverage> = {
  full: 'full', complete: 'full', 完整: 'full', 符合: 'full',
  partial: 'partial', partly: 'partial', 部分: 'partial', 部分符合: 'partial',
  none: 'none', missing: 'none', 未符合: 'none', 不符合: 'none',
  unanswered: 'unanswered', blank: 'unanswered', 未作答: 'unanswered', 沒有作答: 'unanswered',
};

export function normalizeZhCoverage(value: unknown): ZhCoverage | null {
  return COVERAGE_WORDS[enumKey(value)] ?? null;
}

const DRAFT_STATUS_WORDS: Record<string, ZhDraftStatus> = {
  met: 'met', full: 'met', 符合: 'met',
  partly: 'partly', partial: 'partly', 部分: 'partly', 部分符合: 'partly',
  missing: 'missing', none: 'missing', 缺: 'missing', 缺少: 'missing', 未符合: 'missing',
};

export function normalizeZhDraftStatus(value: unknown): ZhDraftStatus | null {
  return DRAFT_STATUS_WORDS[enumKey(value)] ?? null;
}

export function normalizeZhFollowupMode(value: unknown): 'hint' | 'explain' | null {
  const k = enumKey(value);
  if (k === 'hint' || k === '提示' || k === '給我提示') return 'hint';
  if (k === 'explain' || k === '講解' || k === '直接講解') return 'explain';
  return null;
}

/**
 * 確定程度上限（§5.1 第 11 步）：沒有答案鍵時，模型的 section、該題的 item_type、guessZhSection(題目) 任一落在這裡，
 * 該題 certainty 最高 likely。字音、字形預設在裡面（評測的逐字門檻過了才由上線 PR 拿掉，§11.3）。
 */
// 評測（2026-10-30，三次完整評測）：字形三次都達到解除門檻（錯字配對 35／35），拿掉；字音三次裡有一次沒達到（審定音），保留「可能」。
export const ZH_CERTAINTY_CAPS: readonly ZhSection[] = ['zh_sound'];

/** 上限生效時畫面加的說明：字音、字形是「請查教育部辭典」，其他是「請查證」。 */
export type ZhCapNote = 'dictionary' | 'verify';
export const ZH_CAP_NOTE_TEXT: Record<ZhCapNote, string> = { dictionary: 'AI 判斷，請查教育部辭典', verify: 'AI 判斷，請查證' };

/** 這幾個題型（模型的、該題的、程式猜的）有沒有任一個落在上限清單；有就回上限與說明。 */
export function zhCertaintyCap(sections: ReadonlyArray<string | null | undefined>, caps: readonly ZhSection[] = ZH_CERTAINTY_CAPS): { cap: 'likely'; note: ZhCapNote } | null {
  const hit = sections.filter((s): s is ZhSection => isZhSection(s) && caps.includes(s));
  if (hit.length === 0) return null;
  return { cap: 'likely', note: hit.some((s) => s === 'zh_sound' || s === 'zh_form') ? 'dictionary' : 'verify' };
}

/** 把確定程度壓到上限以下（sure > likely > unsure）。 */
export function zhCapCertainty(certainty: ZhCertainty, cap: ZhCertainty | null): ZhCertainty {
  if (cap === null) return certainty;
  const rank = (c: ZhCertainty) => ZH_CERTAINTIES.indexOf(c);
  return rank(certainty) < rank(cap) ? cap : certainty;
}

// ───────────────────────── 正規化三支（§4.1） ─────────────────────────

/** 不可見字元（同 writing-mechanics.ts 的 INVISIBLE：零寬字元、方向控制、BOM、軟連字號、Cf、C0／C1 控制字元，保留換行與 Tab）。 */
const INVISIBLE =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]|\p{Cf}/gu;

/** PDF 文字層把 ① 印成「○」加數字（中間可能換行），例如「○1」「○\n1」。 */
const PDF_CIRCLED_RE = /○[ \t]*(?:\n[ \t]*)?(1\d|20|[1-9])(?!\d)/g;

function circled(n: number): string {
  return String.fromCodePoint(0x2460 + n - 1);
}

/**
 * 國文路徑的正規化（存檔與送模型的文字：題目區塊、作答、疑問、國寫片段、轉錄組裝；§4.1）。**不用 NFKC**：
 *   1. NFC（相容表意字換成統一表意字）；換行統一成 \n（含 U+2028／U+2029）；
 *   2. 移除不可見字元；
 *   3. 全形英數字（Ａ–Ｚ、ａ–ｚ、０–９）換半形（白名單，其他全形字一律不動）；
 *   4. PDF 的「○1」「○\n1」換成「①」；
 *   5. Tab 換成空白、每行去掉行尾空白、三個以上的換行併成一個空行、整段去掉頭尾空白；
 *   6. 遮個資（maskAssistPersonalInfo，同英文）。
 * 保留：①–⑳、⑴–⒇、㈠–㈩、輕聲「˙」（U+02D9）、注音符號、全形中文標點與全形空白。冪等。
 */
export function normalizeZhText(raw: string): { text: string; masked: number } {
  const text = raw
    .normalize('NFC')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(PDF_CIRCLED_RE, (_m, n: string) => circled(Number(n)))
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \u00a0]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const masked = maskAssistPersonalInfo(text);
  return { text: masked.text, masked: masked.masked };
}

/** zhMatchKey 去掉的字元：空白、標點（含引號、⟦⟧）、符號（含 ~、○）、組合記號。 */
const MATCH_DROP_RE = /^[\s\p{P}\p{S}\p{M}]$/u;

export interface ZhMatchKey {
  /** 比對用的副本（NFKC、字碼統一、去空白與標點、英文小寫）。 */
  key: string;
  /** key 的每一個 UTF-16 單位在原文的起點（UTF-16 索引）。 */
  map: number[];
}

/**
 * 比對用的副本（只用在比對：引文、D8 指紋、科目判斷、原文核對；§4.1、§5.2）：逐字 NFKC → ZH_TW_FORM_MAP（字碼統一）→
 * 去掉空白、全部標點、引號、⟦⟧~ 標記與符號 → 英文小寫。因為 NFKC，①、⑴、(1)、○1 都成了同一個數字。map 對回原文的位置。
 */
export function zhMatchKey(text: string): ZhMatchKey {
  let key = '';
  const map: number[] = [];
  let i = 0;
  for (const cp of text) {
    for (const ch of cp.normalize('NFKC')) {
      if (MATCH_DROP_RE.test(ch)) continue;
      const mapped = (ZH_TW_FORM_MAP[ch] ?? ch).toLowerCase();
      key += mapped;
      for (let k = 0; k < mapped.length; k += 1) map.push(i);
    }
    i += cp.length;
  }
  return { key, map };
}

/** 引文在原文裡的位置（兩邊都轉 zhMatchKey 再找子字串）；找不到或引文是空的回 null。位置是原文的 UTF-16 索引 [start, end)。 */
export function zhFindQuote(haystack: string, quote: string): { start: number; end: number } | null {
  const q = zhMatchKey(quote).key;
  if (q === '') return null;
  const h = zhMatchKey(haystack);
  const at = h.key.indexOf(q);
  if (at < 0) return null;
  return { start: h.map[at]!, end: endOf(haystack, h.map[at + q.length - 1]!) };
}

/** 原文第 index 個 UTF-16 位置的那個字（code point）結束在哪裡。 */
function endOf(text: string, index: number): number {
  return index + ((text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1);
}

const CN_DIGITS = '一二三四五六七八九十';

/**
 * 題號的比對鍵（§4.1）：先把 ①–⑳ 換成保留鍵 c1…c20、⑴–⒇ 換成 (1)…(20)、㈠–㈩ 換成 (一)…(十)，再 NFKC → 去空白與「第」「題」。
 * 例：「第34題(1)」→「34(1)」；「①」→「c1」（不會和「1」撞在一起）；「34（2）」→「34(2)」。
 */
export function zhLabelKey(label: string): string {
  return label
    .replace(/[①-⑳]/g, (ch) => `c${ch.charCodeAt(0) - 0x2460 + 1}`)
    .replace(/[⑴-⒇]/g, (ch) => `(${ch.charCodeAt(0) - 0x2474 + 1})`)
    .replace(/[㈠-㈩]/g, (ch) => `(${CN_DIGITS[ch.charCodeAt(0) - 0x3220]})`)
    .normalize('NFKC')
    .replace(/[\s第題]/g, '');
}

/** 題號拆成題目與小題：「34(1)」→ { base: '34', part: '(1)' }；「34」→ part null（先經 zhLabelKey）。 */
export function zhSplitPartLabel(label: string): { base: string; part: string | null } {
  const key = zhLabelKey(label);
  const m = /^(.+?)(\((?:\d{1,2}|[一二三四五六七八九十])\)|c\d{1,2})$/.exec(key);
  return m ? { base: m[1]!, part: m[2]! } : { base: key, part: null };
}

/** 國文的題號格式（§4.2；在 normalizeZhText 之後檢查，圈號還在）。 */
export const ZH_LABEL_PATTERN = /^[0-9A-Za-z一二三四五六七八九十甲乙丙丁戊()（）①-⑳⑴-⒇㈠-㈩-]{1,8}$/u;

// ───────────────────────── 字數、漢字比例 ─────────────────────────

const HAN_RE = /\p{Script=Han}/gu;

function hanCount(text: string): number {
  return text.match(HAN_RE)?.length ?? 0;
}

/** 國語注音的字元（ㄅ–ㄩ 與聲調 ˊˇˋ˙）；科目判斷時算成國文的字（選項印注音的字音題，漢字常不到 30 個）。 */
const BOPOMOFO_CHARS_RE = /[ㄅ-ㄩˊˇˋ˙]/gu;

/** 國文書寫的字數：漢字加上注音字元（科目判斷用；§2.5、§4.2）。 */
export function zhScriptCount(text: string): number {
  return hanCount(text) + (text.match(BOPOMOFO_CHARS_RE)?.length ?? 0);
}

function visibleChars(text: string): number {
  return [...text.replace(/\s/gu, '')].length;
}

export interface ZhCharCount {
  /** 字數：含標點、不含空白（答題卷一格一字、標點占一格）。 */
  chars: number;
  /** 漢字數。 */
  han: number;
}

/** 國文的字數（§5.5）：含標點、不含空白；另外回漢字數。 */
export function countZhChars(text: string): ZhCharCount {
  return { chars: visibleChars(text), han: hanCount(text) };
}

/** 漢字（加上注音字元）占可見字元的比例（科目判斷用）。 */
export function zhHanRatio(text: string): number {
  const visible = visibleChars(text);
  return visible === 0 ? 0 : zhScriptCount(text) / visible;
}

/** 最長的連續漢字（不含標點）有幾個字：國寫的最後一道防線用（ZH_HAN_RUN_MAX）。 */
export function zhLongestHanRun(text: string): number {
  let best = 0;
  for (const m of text.matchAll(/\p{Script=Han}+/gu)) best = Math.max(best, [...m[0]].length);
  return best;
}

// ───────────────────────── 輸入檢查（§4.2） ─────────────────────────

interface ZhPattern {
  id: string;
  re: RegExp;
}

function patternHits(text: string, patterns: readonly ZhPattern[]): TextPatternHit[] {
  const out: TextPatternHit[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      if (m[0] === '') continue;
      out.push({ start: m.index, end: m.index + m[0].length, id: p.id });
    }
  }
  return out;
}

/** 國文自己的受保護樣式（第 2–4 類；第 1 類是現行 OFFICIAL_LIKE_PATTERNS，經 officialLikeHits）。 */
const ZH_OFFICIAL_PATTERNS: readonly ZhPattern[] = [
  // 2. 國綜非選擇題評分原則的共通樣式。
  { id: 'zh_answer_grades', re: /滿分答案|部分給分答案|不給分答案/g },
  // 3. 國寫評分原則：等級加分數區間、「三等六級」接評分或閱卷、各級作答情形、閱卷參考。
  { id: 'zh_grade_band', re: /[ABC][＋+]?\s*[（(]\s*\d+\s*[-–~～]\s*\d+\s*分/g },
  { id: 'zh_grade_scheme', re: /三等六級[^。\n]{0,6}?(?:評分|閱卷)|(?:評分|閱卷)[^。\n]{0,6}?三等六級|各級作答情形|閱卷參考/g },
  // 4. 佳作的評語（佳作一、考生佳作在第 1 類）。
  { id: 'zh_good_works_comment', re: /佳作評語|閱卷委員評語/g },
];

/** 「配分」後面接這些才算評分說明（「配分原則」「配分方式：A 等…」「依…配分給分」）。 */
const SCORING_AFTER_RE = /^(?:原則|標準|規準|方式|說明|要點|給分)|^[^\n]{0,12}?(?:給分|[ABC][＋+]?\s*等|等級|級分)/;

/**
 * 國文的受保護樣式（§4.2 的四類）。第 1 類沿用現行的 officialLikeHits（英文與自訂題的樣式不改），但「配分」只在後面接等級
 * 描述或「給分」時才算：題本的「配分標於題末」「子題配分」、段考卷頭的「多選題（配分 20 分）」都不命中。
 */
export function zhOfficialLikeHits(text: string): TextPatternHit[] {
  const base = officialLikeHits(text).filter((h) => {
    if (h.id !== 'zh_scoring' || text.slice(h.start, h.end) !== '配分') return true;
    return SCORING_AFTER_RE.test(text.slice(h.end, h.end + 16));
  });
  return [...base, ...patternHits(text, ZH_OFFICIAL_PATTERNS)].sort((a, b) => a.start - b.start);
}

/**
 * 答案或詳解的標記：【答案】【解析】【詳解】【解答】、「答案：」「解析：」「參考答案」「詳解」，以及獨自一行的「解答」「解析」。
 * 「解答」「解析」出現在一般句子裡（「為我解答」）不算標記。
 */
const ANSWER_SECTION_MARKER_RE =
  /[【［[]\s*(?:參考答案|答案|解析|詳解|解答)\s*[】］\]]|(?:參考答案|答案|解析|詳解|解答)\s*[:：]|參考答案|詳解|^[ \t]*(?:解答|解析)[ \t]*$/gmu;
/** 標記後面接幾個漢字以上才算一段答案或詳解（只有字母的「【答案】C」不算）。 */
const ANSWER_SECTION_MIN_HAN = 8;

/**
 * 題目附了答案或詳解（§4.2）：標記後面（同一行；同一行是空的就看下一個非空行）接 ≥ 8 個漢字的段落。貼上時拒收
 * zh_answer_section 並回傳位置（畫面加亮那一段），轉錄時整塊隱藏。位置是 [標記起點, 那一段的結尾)。
 */
export function zhAnswerSectionHits(text: string): TextPatternHit[] {
  const out: TextPatternHit[] = [];
  for (const m of text.matchAll(ANSWER_SECTION_MARKER_RE)) {
    if (m[0] === '') continue;
    let from = m.index + m[0].length;
    let lineEnd = text.indexOf('\n', from);
    if (lineEnd < 0) lineEnd = text.length;
    if (text.slice(from, lineEnd).trim() === '') {
      // 標記獨自一行：看下一個非空行。
      let next = lineEnd;
      while (next < text.length && text[next] === '\n') next += 1;
      from = next;
      lineEnd = text.indexOf('\n', from);
      if (lineEnd < 0) lineEnd = text.length;
    }
    if (hanCount(text.slice(from, lineEnd)) >= ANSWER_SECTION_MIN_HAN) out.push({ start: m.index, end: lineEnd, id: 'zh_answer_section' });
  }
  // 「參考答案：…」同時命中兩個寫法時只留一個（同一個起點或包在前一段裡的）。
  return out
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((h, i, all) => i === 0 || h.start >= all[i - 1]!.end);
}

/** 國寫題目的任務字樣（§4.2）：沒有任何一個就是 zh_no_task。 */
const WRITING_TASK_RE = /請|以[^。\n]{1,20}?為題|文長|作答|寫一篇|說明|闡述/u;

/** 小題的標記：（1）(1)⑴，前面不能是「第」（「第（1）題所指的…」是引用，不是小題）。 */
const PART_PAREN_RE = /(?<!第\s*)(?:[（(]\s*(\d{1,2})\s*[）)]|([⑴-⒇]))/gu;
/** 沒有括號數字時，行首的 ①② 也算小題（「①有何反應？②…」寫在同一行的是同一小題裡的兩個要件，不算）。 */
const PART_CIRCLED_LINE_RE = /^[ \t]*([①-⑳])/gmu;

/** 一題裡的小題編號（由 1 起連續的那一串）：例如 [1, 2]；沒有小題回空陣列。 */
export function zhPartNumbers(text: string): number[] {
  const seq = (nums: number[]) => {
    const out: number[] = [];
    for (const n of nums) if (n === out.length + 1) out.push(n);
    return out;
  };
  const paren = [...text.matchAll(PART_PAREN_RE)].map((m) => (m[1] !== undefined ? Number(m[1]) : m[2]!.charCodeAt(0) - 0x2474 + 1));
  const fromParen = seq(paren);
  if (fromParen.length > 0) return fromParen;
  // 行首的圈號至少要有兩個才算小題（只有一個時是同一行裡的要件，例如「①有何反應？②…」）。
  const fromCircled = seq([...text.matchAll(PART_CIRCLED_LINE_RE)].map((m) => m[1]!.charCodeAt(0) - 0x2460 + 1));
  return fromCircled.length >= 2 ? fromCircled : [];
}

/**
 * 簡答要問的小題（§2.2 的 assistItemCount、§4.2 的「小題合計 ≤ 6」、Worker 組 targets 共用）：要問的題號已經帶小題
 * （「34(1)」）就照用；只寫題號（「34」）時展開成那一題的每一個小題（「34(1)」「34(2)」），沒有小題就是那一題本身。
 * 沒選題號而且只有一題時，用那一題（沒有題號時用空字串當題號）。
 */
export function zhShortPartLabels(blocks: readonly Pick<AssistQuestionBlock, 'kind' | 'label' | 'text'>[], targetLabels: readonly string[]): string[] {
  const textOf = (base: string) =>
    blocks
      .filter((b) => b.label !== null && zhSplitPartLabel(b.label).base === base && b.kind !== 'passage')
      .map((b) => b.text)
      .join('\n');
  const expand = (label: string, text: string): string[] => {
    const parts = zhPartNumbers(text);
    return parts.length === 0 ? [label] : parts.map((n) => `${label}(${n})`);
  };
  if (targetLabels.length === 0) {
    const labels = [...new Set(blocks.map((b) => b.label).filter((l): l is string => l !== null))];
    if (labels.length === 1) return expand(labels[0]!, textOf(zhSplitPartLabel(labels[0]!).base));
    if (labels.length === 0) return expand('', blocks.filter((b) => b.kind !== 'passage').map((b) => b.text).join('\n'));
    return [];
  }
  return targetLabels.flatMap((t) => (zhSplitPartLabel(t).part !== null ? [t] : expand(t, textOf(zhSplitPartLabel(t).base))));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 選擇題的作答與答案鍵：只收 A–E、不重複、依字母排序（「(A)(C)」「a, c」「ＡＣ」都變成「AC」）；格式不對回 null。 */
export function normalizeZhChoiceLetters(raw: string): string | null {
  const s = raw.normalize('NFKC').toUpperCase().replace(/[\s()（）［］[\],，、;；/]/g, '');
  if (s === '') return '';
  if (!/^[A-E]{1,5}$/.test(s)) return null;
  const letters = [...s];
  if (new Set(letters).size !== letters.length) return null;
  return letters.sort().join('');
}

function sortZhProblems(problems: AssistInputHit<AssistInputProblem>[]): AssistInputHit<AssistInputProblem>[] {
  const rank = (p: AssistInputHit<AssistInputProblem>) => ASSIST_INPUT_PROBLEMS.indexOf(p.code);
  return problems.sort((a, b) => rank(a) - rank(b));
}

/** 只提醒：只有字母的答案標記（「【答案】C」「答案：B」）。 */
const ANSWER_LETTER_RE = /[【［[]\s*答案\s*[】］\]]\s*[(（]?\s*[A-E]\b|答案\s*[:：]\s*[(（]?\s*[A-E]\b/g;

/** checkZhQuestion 的選項。 */
export interface ZhQuestionCheckOptions {
  /**
   * 國寫範文頁的貼上（zh-writing-prompts.ts 的 zhPasteQuestion 組的題目；學生已經自己選了國寫與題型）：kind 是 instructions 的區塊
   * 是本站寫的字數規定（學生填的數字），長度、科目與國寫任務字樣只看其他區塊（學生的題目與素材），否則結果會隨選填的字數欄位
   * 改變（本站那一行有十幾個漢字，也有「文長」）。門檻：科目只看漢字比例（≥ 30%），長度改成漢字至少
   * ZH_TEXT_LIMITS.pasteWritingHanMin 個（命題作文常常不到 30 個漢字）。
   */
  writingPaste?: boolean;
}

/**
 * 國文題目的檢查（§4.2；前端與 Worker 共用；英文的 checkAssistQuestion 一個字都不改，由 subject 分派到這裡）。
 * 形狀 → 正規化與遮個資（normalizeZhText，不用 NFKC）→ 長度 → 字元與標籤 → 內容規則（代寫、受保護樣式、答案或詳解）→
 * 科目文字 → 格式（國寫的任務字樣、片段長度）→ 要問的題（格式各自的上限）→ 作答與答案鍵。
 * 不含 D8 指紋（Worker 另外做，official_material）。失敗時 problems 依 ASSIST_INPUT_PROBLEMS 的優先順序排好。
 * 成功時 value 是正規化、遮過個資的題目，format 與 choice_mode 有填（學生沒選時用 guessZhFormat 的結果）。
 * opts.writingPaste：見 ZhQuestionCheckOptions（只有國寫範文頁的貼上用；學習助手的貼上與確認照舊）。
 */
export function checkZhQuestion(input: unknown, opts: ZhQuestionCheckOptions = {}): CheckResult<AssistStudentQuestion, AssistInputProblem> {
  const L = ASSIST_LIMITS;
  const T = ZH_TEXT_LIMITS;
  const problems: AssistInputHit<AssistInputProblem>[] = [];
  const warnings: AssistInputHit<AssistInputWarning>[] = [];
  const fail = (code: AssistInputProblem, field: string): CheckResult<AssistStudentQuestion, AssistInputProblem> => ({ ok: false, problems: [{ code, field }], warnings });

  // 形狀：1–40 塊、kind 合法、text 是字串；題號、作答、答案鍵、片段的型別。
  if (!isRecord(input) || !Array.isArray(input['blocks'])) return fail('blocks_invalid', 'blocks');
  const rawBlocks = input['blocks'] as unknown[];
  if (rawBlocks.length < 1 || rawBlocks.length > L.questionBlocksMax) return fail('blocks_invalid', 'blocks');
  const shaped: Array<{ kind: AssistBlockKind; label: string | null; text: string }> = [];
  for (const b of rawBlocks) {
    if (!isRecord(b) || !(ASSIST_BLOCK_KINDS as readonly unknown[]).includes(b['kind']) || typeof b['text'] !== 'string') return fail('blocks_invalid', 'blocks');
    const rawLabel = b['label'];
    if (rawLabel !== null && rawLabel !== undefined && typeof rawLabel !== 'string') return fail('blocks_invalid', 'blocks');
    shaped.push({ kind: b['kind'] as AssistBlockKind, label: typeof rawLabel === 'string' ? rawLabel : null, text: b['text'] });
  }
  const rawTargets = input['target_labels'] ?? [];
  if (!Array.isArray(rawTargets) || rawTargets.some((t) => typeof t !== 'string')) return fail('blocks_invalid', 'target_labels');
  const rawAnswer = input['student_answer'];
  if (rawAnswer !== undefined && rawAnswer !== null && typeof rawAnswer !== 'string') return fail('blocks_invalid', 'student_answer');
  const rawFormat = input['format'];
  if (rawFormat !== undefined && rawFormat !== null && !(ZH_FORMATS as readonly unknown[]).includes(rawFormat)) return fail('blocks_invalid', 'format');
  const rawMode = input['choice_mode'];
  if (rawMode !== undefined && rawMode !== null && !(ZH_CHOICE_MODES as readonly unknown[]).includes(rawMode)) return fail('blocks_invalid', 'choice_mode');
  const stringMap = (v: unknown) => v === undefined || v === null || (isRecord(v) && Object.values(v).every((x) => typeof x === 'string') && Object.keys(v).length <= 12);
  if (!stringMap(input['answers'])) return fail('blocks_invalid', 'answers');
  if (!stringMap(input['known_key'])) return fail('blocks_invalid', 'known_key');
  const rawDraft = input['draft'];
  if (rawDraft !== undefined && rawDraft !== null && typeof rawDraft !== 'string') return fail('blocks_invalid', 'draft');
  const rawDraftTarget = input['draft_target'];
  if (rawDraftTarget !== undefined && rawDraftTarget !== null && rawDraftTarget !== 'q1' && rawDraftTarget !== 'q2') return fail('blocks_invalid', 'draft_target');

  // 原文太長：直接拒收，不做正規化與樣式比對。
  const rawTotal = shaped.reduce((sum, b) => sum + b.text.length, 0);
  if (rawTotal > L.questionMaxChars * 4) return fail('text_too_long', 'blocks');
  if (typeof rawAnswer === 'string' && rawAnswer.length > L.studentAnswerMaxChars * 4) return fail('answer_too_long', 'student_answer');
  if (typeof rawDraft === 'string' && rawDraft.length > T.draftChars * 4) return fail('zh_draft_too_long', 'draft');

  // 正規化與遮個資（題號也正規化：圈號保留，全形英數換半形）。
  let masked = 0;
  const norm = (s: string) => {
    const n = normalizeZhText(s);
    masked += n.masked;
    return n.text;
  };
  const blocks: AssistQuestionBlock[] = [];
  for (const b of shaped) {
    const label = b.label === null ? null : normalizeZhText(b.label).text;
    if (label !== null && label !== '' && ([...label].length > ASSIST_LABEL_MAX_CHARS || !ZH_LABEL_PATTERN.test(label))) return fail('blocks_invalid', 'blocks');
    blocks.push({ kind: b.kind, label: label === '' ? null : label, text: norm(b.text) });
  }
  const targets = [...new Set((rawTargets as string[]).map((t) => normalizeZhText(t).text).filter((t) => t !== ''))];
  if (targets.some((t) => [...t].length > ASSIST_LABEL_MAX_CHARS || !ZH_LABEL_PATTERN.test(t))) return fail('blocks_invalid', 'target_labels');
  const studentAnswer = typeof rawAnswer === 'string' ? norm(rawAnswer) || null : null;
  const draft = typeof rawDraft === 'string' ? norm(rawDraft) || null : null;
  const answersIn = isRecord(input['answers']) ? (input['answers'] as Record<string, string>) : {};
  const keyIn = isRecord(input['known_key']) ? (input['known_key'] as Record<string, string>) : {};

  // 長度：全部區塊合計 20–6,000 字元；圖表描述 ≤ 1,500；你的答案 ≤ 300。
  // 國寫範文頁的貼上：長度下限、科目與國寫任務字樣只看學生的題目與素材（本站寫的字數規定區塊不算；ZhQuestionCheckOptions）。
  const all = blocks.map((b) => b.text).join('\n');
  const own = opts.writingPaste ? blocks.filter((b) => b.kind !== 'instructions').map((b) => b.text).join('\n') : all;
  const total = blocks.reduce((sum, b) => sum + b.text.length, 0);
  // 貼上的國寫：先看是不是以中文為主（不是就只報科目，不報太短），再看漢字夠不夠。
  const pasteNotZh = opts.writingPaste === true && own.trim() !== '' && zhHanRatio(own) < T.subjectHanRatio;
  if (all.trim() === '') problems.push({ code: 'text_missing', field: 'blocks' });
  else if (opts.writingPaste ? !pasteNotZh && zhScriptCount(own) < T.pasteWritingHanMin : visibleChars(all) < L.questionMinChars) {
    problems.push({ code: 'text_too_short', field: 'blocks' });
  }
  if (total > L.questionMaxChars) problems.push({ code: 'text_too_long', field: 'blocks' });
  const figureTotal = blocks.filter((b) => b.kind === 'figure').reduce((sum, b) => sum + b.text.length, 0);
  if (figureTotal > L.figureMaxChars) problems.push({ code: 'figure_too_long', field: 'blocks' });
  if (studentAnswer !== null && studentAnswer.length > L.studentAnswerMaxChars) problems.push({ code: 'answer_too_long', field: 'student_answer' });

  // 字元、標籤與內容規則（逐區塊；命中位置是該區塊正規化後的索引）。
  const fields: Array<{ field: string; text: string; question: boolean }> = [
    ...blocks.map((b, i) => ({ field: `blocks[${i}].text`, text: b.text, question: true })),
    ...(studentAnswer !== null ? [{ field: 'student_answer', text: studentAnswer, question: false }] : []),
    ...(draft !== null ? [{ field: 'draft', text: draft, question: false }] : []),
  ];
  for (const { field, text, question } of fields) {
    const bad = firstBadCharacter(text);
    if (bad) problems.push({ code: 'bad_characters', field, ...bad });
    for (const h of markupHits(text, ASSIST_STRUCTURAL_TAGS)) problems.push({ code: 'markup', field, start: h.start, end: h.end });
    for (const h of requestToAiHits(text)) {
      if (h.quoted) warnings.push({ code: 'request_like', field, start: h.start, end: h.end });
      else problems.push({ code: 'request_to_ai', field, start: h.start, end: h.end });
    }
    for (const h of zhOfficialLikeHits(text)) problems.push({ code: 'official_like', field, start: h.start, end: h.end });
    if (question) {
      for (const h of zhAnswerSectionHits(text)) problems.push({ code: 'zh_answer_section', field, start: h.start, end: h.end });
      for (const m of text.matchAll(ANSWER_LETTER_RE)) warnings.push({ code: 'answer_like', field, start: m.index, end: m.index + m[0].length });
    }
  }
  if (masked > 0) warnings.push({ code: 'personal_masked', field: 'blocks' });

  // 科目文字：漢字 ≥ 30 字，而且占可見字元 ≥ 30%（§2.5）。注音字元也算國文的字：選項印注音的字音題（「「戛」然而止：ㄍㄚ」）
  // 整題常不到 30 個漢字，注音只會出現在國文，不該讓它被當成別科。
  if (opts.writingPaste ? pasteNotZh : all.trim() !== '' && (zhScriptCount(all) < T.subjectHanMin || zhHanRatio(all) < T.subjectHanRatio)) {
    problems.push({ code: 'subject_mismatch', field: 'blocks' });
  }

  // 格式：學生選的優先，沒選用程式猜的（猜不到當成選擇題）；子模式同理。
  const guess = guessZhFormat(all, { answer: Object.values(answersIn)[0] ?? studentAnswer ?? undefined });
  const format: ZhFormat = (rawFormat as ZhFormat | null | undefined) ?? guess.format ?? 'choice';
  const choiceMode: ZhChoiceMode | undefined =
    format === 'choice' ? ((rawMode as ZhChoiceMode | null | undefined) ?? guess.choice_mode ?? 'single') : undefined;

  // 國寫：題目要有任務字樣、漢字合計 ≤ 2,500；片段 ≤ 250 字（問題（一）的答案 ≤ 80 字）。
  const draftTarget = format === 'writing' && draft !== null ? ((rawDraftTarget as 'q1' | 'q2' | null | undefined) ?? 'q2') : undefined;
  if (format === 'writing') {
    if (own.trim() !== '' && (!WRITING_TASK_RE.test(own) || hanCount(all) > T.writingPromptHan)) problems.push({ code: 'zh_no_task', field: 'blocks' });
    if (draft !== null && countZhChars(draft).chars > (draftTarget === 'q1' ? T.draftQ1Chars : T.draftChars)) problems.push({ code: 'zh_draft_too_long', field: 'draft' });
  } else if (draft !== null) {
    return fail('blocks_invalid', 'draft');
  }

  // 要問的題：區塊裡有兩個以上的題號就要選；選的題號要在區塊裡；格式各自的上限（選擇 4、簡答 3 題且小題合計 6、國寫 1）。
  const blockBases = new Set(blocks.map((b) => b.label).filter((l): l is string => l !== null).map((l) => zhSplitPartLabel(l).base));
  const targetBases = [...new Set(targets.map((t) => zhSplitPartLabel(t).base))];
  if ((blockBases.size >= 2 && targets.length === 0) || targetBases.some((t) => !blockBases.has(t))) {
    problems.push({ code: 'target_missing', field: 'target_labels' });
  }
  const parts = format === 'short' ? zhShortPartLabels(blocks, targets) : [];
  const tooMany =
    format === 'choice'
      ? targets.length > ZH_TARGET_LIMITS.choice
      : format === 'short'
        ? targetBases.length > ZH_TARGET_LIMITS.shortQuestions || parts.length > ZH_TARGET_LIMITS.shortParts
        : targets.length > ZH_TARGET_LIMITS.writing;
  if (tooMany) problems.push({ code: 'zh_too_many_targets', field: 'target_labels' });
  const isTarget = (b: AssistQuestionBlock) =>
    (ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(b.kind) &&
    (targets.length === 0 || (b.label !== null && targetBases.includes(zhSplitPartLabel(b.label).base)));
  blocks.forEach((b, i) => {
    if (!isTarget(b)) return;
    const at = b.text.indexOf('[[?]]');
    if (at >= 0) problems.push({ code: 'unresolved_target', field: `blocks[${i}].text`, start: at, end: at + 5 });
  });

  // 作答與答案鍵：鍵要是要問的題（簡答可以是小題）；選擇題的值是 A–E；簡答每小題 ≤ 120 字；國寫不收作答與答案鍵。
  // 沒有任何題號的單題：作答與答案鍵只能有一筆（鍵是什麼都可以，例如空字串或「1」）。
  const allowedKeys = new Set([...targets, ...parts, ...blockBases].map(zhLabelKey));
  const unlabeled = targets.length === 0 && blockBases.size === 0;
  const keyOk = (key: string, count: number) => allowedKeys.has(zhLabelKey(key)) || (unlabeled && format === 'choice' && count <= 1);
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(answersIn)) {
    const key = normalizeZhText(k).text;
    if (!keyOk(key, Object.keys(answersIn).length) || format === 'writing') return fail('blocks_invalid', 'answers');
    if (format === 'choice') {
      const letters = normalizeZhChoiceLetters(v);
      if (letters === null) return fail('blocks_invalid', `answers.${key}`);
      if (letters !== '') answers[key] = letters;
    } else {
      const text = norm(v);
      if (text === '') continue;
      if (countZhChars(text).chars > T.shortAnswerChars) problems.push({ code: 'zh_answer_too_long', field: `answers.${key}` });
      const bad = firstBadCharacter(text);
      if (bad) problems.push({ code: 'bad_characters', field: `answers.${key}`, ...bad });
      for (const h of markupHits(text, ASSIST_STRUCTURAL_TAGS)) problems.push({ code: 'markup', field: `answers.${key}`, start: h.start, end: h.end });
      answers[key] = text;
    }
  }
  const knownKey: Record<string, string> = {};
  for (const [k, v] of Object.entries(keyIn)) {
    const key = normalizeZhText(k).text;
    // 簡答與國寫不收答案鍵：學生填的可能是官方的表達型參考答案（D8）。
    if (format !== 'choice' || !keyOk(key, Object.keys(keyIn).length)) return fail('blocks_invalid', 'known_key');
    const letters = normalizeZhChoiceLetters(v);
    if (letters === null) return fail('blocks_invalid', `known_key.${key}`);
    if (letters !== '') knownKey[key] = letters;
  }

  if (problems.length > 0) return { ok: false, problems: sortZhProblems(problems), warnings };
  const value: AssistStudentQuestion = { blocks, target_labels: targets, student_answer: studentAnswer, format };
  if (choiceMode !== undefined) value.choice_mode = choiceMode;
  if (Object.keys(answers).length > 0) value.answers = answers;
  if (Object.keys(knownKey).length > 0) value.known_key = knownKey;
  if (draft !== null && draftTarget !== undefined) {
    value.draft = draft;
    value.draft_target = draftTarget;
  }
  return { ok: true, value, warnings };
}

// ───────────────────────── 格式、子模式、題型的猜測（§1.3、§2.5） ─────────────────────────

const OPTION_MARK_RE = /[（(]\s*([A-E])\s*[)）]/g;

/** 題目文字裡的選項 (A)…(E)：代號 → 選項文字（到下一個選項代號為止，去掉頭尾空白）。同一個代號出現兩次時用第一次。 */
export function zhExtractOptions(text: string): Record<string, string> {
  const marks = [...text.matchAll(OPTION_MARK_RE)];
  const out: Record<string, string> = {};
  marks.forEach((m, i) => {
    const letter = m[1]!;
    if (letter in out) return;
    const end = i + 1 < marks.length ? marks[i + 1]!.index : text.length;
    out[letter] = text.slice(m.index + m[0].length, end).trim();
  });
  return out;
}

/** 由 A 起連續的選項個數（只有 (A)(B)(C)(D) 是 4；跳號不算）。 */
function optionCount(options: Record<string, string>): number {
  let n = 0;
  for (const letter of 'ABCDE') {
    if (!(letter in options)) break;
    n += 1;
  }
  return n;
}

/** 敘述編號（①②、⑴⑵、(1)(2)）。 */
const STATEMENT_NUMBER_RE = /[①-⑳⑴-⒇]|[（(]\s*\d{1,2}\s*[)）]/u;
/** 研判的判斷詞（長的放前面：「不符合」先於「符合」）。 */
const JUDGE_WORDS = ['無法判斷', '無從判斷', '不能判斷', '不符合', '不適當', '不正確', '不恰當', '不合理', '不成立', '錯誤', '符合', '適當', '正確', '恰當', '合理', '成立'] as const;
const JUDGE_UNKNOWN_WORDS = ['無法判斷', '無從判斷', '不能判斷'] as const;
const JUDGE_WORD_RE = new RegExp(JUDGE_WORDS.join('|'), 'u');

/** 這個選項是不是「編號敘述＋判斷詞」（「①不適當，②無法判斷」「①、③皆正確」）。 */
function isJudgeOption(option: string): boolean {
  return /^[\s]*(?:[①-⑳⑴-⒇]|[（(]\s*\d{1,2}\s*[)）])/u.test(option) && JUDGE_WORD_RE.test(option);
}

export interface ZhFormatGuess {
  format: ZhFormat | null;
  choice_mode: ZhChoiceMode | null;
  confidence: 'high' | 'low';
  /** 由 A 起連續的選項個數（沒有選項是 0）。 */
  option_count: number;
}

/**
 * 格式與子模式的猜測（§1.3；表單預填、<task> 的參考）。規則：
 *   有 (A)…(D)／(E) 選項 → 選擇；有「作答字數」「N 字以內」「限 N 字」而沒有選項 → 簡答；有「文長」「至多 N 行」「請以…為題」「作文」→ 國寫。
 *   子模式依序：研判（「無法判斷」＋編號敘述，或選項全是「編號＋判斷詞」）→ 排序（甲乙丙丁＋順序或排列）→
 *   5 個選項是多選（題目寫明「單選」才改單選；國綜與舊制國文的單選都是 4 個選項）→ 4 個選項是單選。
 *   作答填了兩個以上字母也是多選。選項與字數限制同時出現（混合題組）、選項個數不是 4 或 5 時信心低。
 */
export function guessZhFormat(raw: string, opts: { answer?: string } = {}): ZhFormatGuess {
  const text = zhStripMarks(raw);
  const options = zhExtractOptions(text);
  const n = optionCount(options);
  const hasLimit = /作答字數|[0-9零〇一二兩三四五六七八九十百]+\s*字以內|限\s*[0-9零〇一二兩三四五六七八九十百]+\s*字/u.test(text);
  const writing = /文長|至多\s*[0-9一二三四五六七八九十]+\s*行|請以[^。\n]{1,20}?為題|作文/u.test(text);
  if (n >= 2) {
    const optionTexts = Object.values(options);
    let mode: ZhChoiceMode;
    let confidence: 'high' | 'low' = (n === 4 || n === 5) && !hasLimit ? 'high' : 'low';
    const judgeAll = optionTexts.length >= 2 && optionTexts.every(isJudgeOption);
    if ((/無法判斷/.test(text) && STATEMENT_NUMBER_RE.test(text)) || judgeAll) mode = 'judge';
    else if (/[甲乙丙丁戊][、，,]?[甲乙丙丁戊]/.test(text) && /順序|排列|排序/.test(text)) mode = 'sequence';
    else if (/單選/.test(text) && !/多選/.test(text)) mode = 'single';
    else if (/多選/.test(text) && !/單選/.test(text)) mode = 'multi';
    else if (n === 5) mode = 'multi';
    else mode = 'single';
    if (mode === 'single' && opts.answer !== undefined && (normalizeZhChoiceLetters(opts.answer) ?? '').length >= 2) {
      mode = 'multi';
      confidence = 'low';
    }
    return { format: 'choice', choice_mode: mode, confidence, option_count: n };
  }
  // 國寫也寫「N 字以內」（「文長限 80 字以內」），所以有國寫字樣而沒有「作答字數」時先判國寫。
  if (writing && !/作答字數/.test(text)) return { format: 'writing', choice_mode: null, confidence: 'high', option_count: n };
  if (hasLimit) return { format: 'short', choice_mode: null, confidence: writing ? 'low' : 'high', option_count: n };
  return { format: null, choice_mode: null, confidence: 'low', option_count: n };
}

export interface ZhSectionGuess {
  section: ZhSection;
  /** 字形題的極性：「完全正確／沒有錯別字」（n 個選項應有 n−1 句有錯字）或「有錯別字」（應有 1 句）。 */
  form_polarity?: 'all_correct' | 'has_error';
}

/** 底線與波浪線的標記（⟦…⟧、⟦~…~⟧）：題幹比對關鍵詞之前先拿掉（國綜常把「沒有」畫底線：「完全⟦沒有⟧錯別字」）。 */
export function zhStripMarks(text: string): string {
  return text.replace(/[⟦⟧~]/gu, '');
}

/**
 * 題型的猜測（§2.5；只看題幹關鍵詞，猜不到回 null，模型以自己的判斷為準）。用在 <task> 裡的「程式猜的題型」、
 * 確定程度上限與字形題的輸入提醒。比對前先拿掉底線標記。
 */
export function guessZhSection(raw: string): ZhSectionGuess | null {
  const text = zhStripMarks(raw);
  if (/讀音|注音|字音/.test(text)) return { section: 'zh_sound' };
  if (/錯別字|錯字|別字|用字(?:完全)?(?:正確|錯誤)|字形(?:完全)?(?:正確|錯誤|有誤)/.test(text)) {
    const allCorrect = /(?:完全)?沒有\s*錯別?字|無錯別?字|用字完全正確|完全正確|用字正確|字形(?:完全)?正確/.test(text);
    return { section: 'zh_form', form_polarity: allCorrect ? 'all_correct' : 'has_error' };
  }
  if ((/無法判斷/.test(text) && STATEMENT_NUMBER_RE.test(text)) || /研判/.test(text)) return { section: 'zh_judge' };
  if (/[甲乙丙丁戊][、，,]?[甲乙丙丁戊]/.test(text) && /順序|排列|排序/.test(text)) return { section: 'zh_sequence' };
  if (/成語|(?:詞語|畫底線處的詞語|畫底線的詞語)[^。\n]{0,6}(?:運用|使用)/.test(text)) return { section: 'zh_idiom' };
  if (/意義前後相同|意義相同|意思相同|字義|詞義|「」內的(?:字|詞)[，,]?\s*(?:意義|意思)/.test(text)) return { section: 'zh_word' };
  if (/修辭|表現手法/.test(text)) return { section: 'zh_rhetoric' };
  if (/語法|詞性|量詞|標點|句式|句型/.test(text)) return { section: 'zh_grammar' };
  if (/題辭|書信|稱謂|默寫|填入課文|應用文|對聯|柬帖|提稱語|啟封詞|文學常識/.test(text)) return { section: 'zh_knowledge' };
  // 國寫先於簡答：國寫題目也寫「N 字以內」，但只有國寫寫「文長」「至多 N 行」「請以…為題」。
  if (/文長|至多\s*[0-9一二三四五六七八九十]+\s*行|請以[^。\n]{1,20}?為題/.test(text)) {
    const reason = /闡述|論述|看法|觀點|分析|說明理由/.test(text);
    const emotion = /感受|體會|抒發|情感|經驗/.test(text);
    if (reason && !emotion) return { section: 'zh_writing_reason' };
    if (emotion && !reason) return { section: 'zh_writing_emotion' };
    return null;
  }
  if (/作答字數|[0-9一二三四五六七八九十百]+\s*字以內/.test(text)) return { section: 'zh_short_answer' };
  return null;
}

// ───────────────────────── 字數限制與抄錄規定（§5.5） ─────────────────────────

const ZH_NUM = '(\\d{1,4}|[零〇一二兩三四五六七八九十百千]{1,6})';

/** 阿拉伯數字或中文數字（「五十」「一百」「一百二十」「兩百」「三百五十」）；看不懂回 null。 */
export function parseZhNumber(raw: string): number | null {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[零〇一二兩三四五六七八九十百千]+$/.test(s)) return null;
  const digit: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unit: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const ch of s) {
    if (ch in digit) current = digit[ch]!;
    else {
      total += (current === 0 ? 1 : current) * unit[ch]!;
      current = 0;
    }
  }
  return total + current;
}

export type ZhCopyRule = 'must' | 'must_not' | 'none';

export interface ZhCharLimit {
  /** 小題（「(1)」「(2)」，國寫是「(一)」「(二)」；同 zhLabelKey 的寫法）；null＝整題（沒有小題，或寫在題幹的限制）。 */
  part: string | null;
  /** 同一小題裡再分的要件（「①10字以內；②20字以內」的「①」）；沒有是 null。 */
  sub: string | null;
  /** 下限與上限（字，含標點）；國寫的「至多 N 行」換算成 N×22 字，lines 記原始行數。 */
  min: number | null;
  max: number | null;
  lines: number | null;
  /** part＝這一小題、total＝整題或整小題合計、each＝每一處各自。 */
  scope: 'part' | 'total' | 'each';
  copy: ZhCopyRule;
}

/** 國寫的問題（一）、問題（二）。 */
const WRITING_PART_RE = /問題[（(]([一二三四])[）)]/gu;

/** 國寫的答題卷每行幾格（「至多 N 行」換算字數用）。 */
export const ZH_LINE_CELLS = 22;

const COPY_MUST_NOT_RE = /不可抄錄|不得(?:照)?抄|勿抄錄|不可照抄|請以自己的話|用自己的話/u;
const COPY_MUST_RE = /抄錄|寫出原文|摘錄/u;

function copyRuleOf(text: string): ZhCopyRule | null {
  if (COPY_MUST_NOT_RE.test(text)) return 'must_not';
  if (COPY_MUST_RE.test(text)) return 'must';
  return null;
}

/** 一段文字（已去空白）裡的字數限制。 */
function limitsIn(segment: string): Array<Omit<ZhCharLimit, 'part' | 'copy'>> {
  const out: Array<Omit<ZhCharLimit, 'part' | 'copy'>> = [];
  const num = (s: string) => parseZhNumber(s);
  // 同一小題裡分開寫的上限：「①10字以內；②20字以內」。
  const subs = [...segment.matchAll(new RegExp(`([\\u2460-\\u2473])${ZH_NUM}字以內`, 'gu'))];
  if (subs.length >= 2) {
    for (const m of subs) out.push({ sub: m[1]!, min: null, max: num(m[2]!), lines: null, scope: 'part' });
    return out;
  }
  const range = new RegExp(`${ZH_NUM}[-–~～至到]${ZH_NUM}字`, 'u').exec(segment);
  if (range) return [{ sub: null, min: num(range[1]!), max: num(range[2]!), lines: null, scope: 'part' }];
  const total = new RegExp(`(?:合計|共)${ZH_NUM}字`, 'u').exec(segment);
  if (total) return [{ sub: null, min: null, max: num(total[1]!), lines: null, scope: 'total' }];
  const each = new RegExp(`各${ZH_NUM}字`, 'u').exec(segment);
  if (each) return [{ sub: null, min: null, max: num(each[1]!), lines: null, scope: 'each' }];
  const lines = new RegExp(`至多${ZH_NUM}行`, 'u').exec(segment);
  const lineCount = lines ? num(lines[1]!) : null;
  const essay = new RegExp(`文長(?:限|約)?${ZH_NUM}字`, 'u').exec(segment);
  const plain =
    new RegExp(`作答字數[:：]?${ZH_NUM}字`, 'u').exec(segment) ??
    new RegExp(`字數限${ZH_NUM}字`, 'u').exec(segment) ??
    new RegExp(`限${ZH_NUM}字`, 'u').exec(segment) ??
    new RegExp(`${ZH_NUM}字以內`, 'u').exec(segment);
  const max = essay ? num(essay[1]!) : plain ? num(plain[1]!) : lineCount !== null ? lineCount * ZH_LINE_CELLS : null;
  if (max !== null) out.push({ sub: null, min: null, max, lines: lineCount, scope: 'part' });
  return out;
}

/**
 * 依小題抽出字數限制與抄錄規定（§5.5）：小題用（1）(1)⑴ 切開，每一段各自找限制；題幹（第一個小題之前）的限制與抄錄規定
 * 套用到沒有自己規定的小題。比對前先去掉空白（PDF 常把「作 答 字數」拆開）。抄錄規定三種：必須抄錄、不可抄錄、沒有規定。
 */
export function zhCharLimits(text: string): ZhCharLimit[] {
  const s = text.replace(/\s/gu, '');
  const seq: Array<{ n: number; index: number; length: number; label: string }> = [];
  for (const m of s.matchAll(PART_PAREN_RE)) {
    const n = m[1] !== undefined ? Number(m[1]) : m[2]!.charCodeAt(0) - 0x2474 + 1;
    if (n === seq.length + 1) seq.push({ n, index: m.index, length: m[0].length, label: `(${n})` });
  }
  // 國寫的「問題（一）」「問題（二）」：沒有數字小題時，用它們切開（小題寫成「(一)」「(二)」）。
  if (seq.length === 0) {
    for (const m of s.matchAll(WRITING_PART_RE)) {
      const n = CN_DIGITS.indexOf(m[1]!) + 1;
      if (n === seq.length + 1) seq.push({ n, index: m.index, length: m[0].length, label: `(${m[1]!})` });
    }
  }
  const head = seq.length > 0 ? s.slice(0, seq[0]!.index) : s;
  const headCopy = copyRuleOf(head) ?? 'none';
  const out: ZhCharLimit[] = [];
  if (seq.length === 0) {
    for (const l of limitsIn(s)) out.push({ ...l, part: null, copy: headCopy });
    if (out.length === 0 && headCopy !== 'none') out.push({ part: null, sub: null, min: null, max: null, lines: null, scope: 'part', copy: headCopy });
    return out;
  }
  const headLimits = limitsIn(head);
  seq.forEach((p, i) => {
    const seg = s.slice(p.index + p.length, i + 1 < seq.length ? seq[i + 1]!.index : s.length);
    const copy = copyRuleOf(seg) ?? headCopy;
    const own = limitsIn(seg);
    const use = own.length > 0 ? own : headLimits;
    if (use.length === 0 && copy !== 'none') out.push({ part: p.label, sub: null, min: null, max: null, lines: null, scope: 'part', copy });
    for (const l of use) out.push({ ...l, part: p.label, copy });
  });
  return out;
}

/** 最長共同子字串（比對鍵上算，不含標點與空白）：長度與兩邊在原文的位置。 */
export function zhLongestCommonRun(a: string, b: string): { length: number; a: { start: number; end: number } | null; b: { start: number; end: number } | null } {
  const ka = zhMatchKey(a);
  const kb = zhMatchKey(b);
  const x = ka.key;
  const y = kb.key;
  let best = 0;
  let endA = 0;
  let endB = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) {
          best = cur[j]!;
          endA = i;
          endB = j;
        }
      }
    }
    prev = cur;
  }
  if (best === 0) return { length: 0, a: null, b: null };
  return {
    length: best,
    a: { start: ka.map[endA - best]!, end: endOf(a, ka.map[endA - 1]!) },
    b: { start: kb.map[endB - best]!, end: endOf(b, kb.map[endB - 1]!) },
  };
}

/** 不可抄錄的小題：學生答案和選文的最長共同子字串 ≥ 8 字就提醒「這段和原文相同」。 */
export const ZH_COPY_RUN_MIN = 8;

export interface ZhCopyCheck {
  rule: ZhCopyRule;
  /** 必須抄錄：答案（或「條件；文句」的文句那一段）是不是逐字出自原文；其他規定是 null。 */
  verbatim: boolean | null;
  /** 必須抄錄卻不是原文時，原文裡最接近的那一段（原文的 UTF-16 索引）。 */
  closest: { start: number; end: number } | null;
  /** 和原文最長的共同片段有幾個字（不含標點）；不可抄錄且 ≥ ZH_COPY_RUN_MIN 時提醒。 */
  copied_run: number;
}

/**
 * 抄錄檢查（§5.5）：必須抄錄 → 答案要逐字出自原文（去標點比對；答案寫成「條件；文句」時只看分號後面那一段），否則標出最接近的原文；
 * 不可抄錄 → 算和原文的最長共同片段；沒有規定 → 不檢查。示範答案與學生答案用同一支。
 */
export function zhCopyCheck(answer: string, source: string, rule: ZhCopyRule): ZhCopyCheck {
  if (rule === 'none' || answer.trim() === '') return { rule, verbatim: null, closest: null, copied_run: 0 };
  if (rule === 'must') {
    const segments = answer.split(/[；;]/u);
    const quoted = segments[segments.length - 1]!.trim() !== '' ? segments[segments.length - 1]! : answer;
    if (zhFindQuote(source, answer) !== null || zhFindQuote(source, quoted) !== null) return { rule, verbatim: true, closest: null, copied_run: zhMatchKey(quoted).key.length };
    const run = zhLongestCommonRun(quoted, source);
    return { rule, verbatim: false, closest: run.b, copied_run: run.length };
  }
  const run = zhLongestCommonRun(answer, source);
  return { rule, verbatim: null, closest: null, copied_run: run.length };
}

// ───────────────────────── 國寫不代寫（§5.5） ─────────────────────────

/** 一組國寫示範合不合規則：三句以內、每句 ≤ 50 字；或只有一筆 ≤ 150 字的「主體段示範」。合計 ≤ 150 字。 */
function writingExamplesFit(examples: ReadonlyArray<{ use_zh: string; text: string }>): boolean {
  const R = ZH_WRITING_EXAMPLE_RULES;
  if (examples.length === 0) return true;
  const chars = examples.map((e) => countZhChars(e.text).chars);
  const total = chars.reduce((a, b) => a + b, 0);
  if (examples.some((e) => e.use_zh.trim() === R.bodyUseLabel)) return examples.length === 1 && total <= R.bodyMaxChars;
  return examples.length <= R.sentencesMax && chars.every((c) => c <= R.sentenceMaxChars) && total <= R.totalMaxChars;
}

/** 國寫示範不合規則時，從最後一筆拿掉直到合規（主體段超過 150 字時整筆拿掉）。removed 是拿掉的筆數。 */
export function zhFitWritingExamples<T extends { use_zh: string; text: string }>(examples: readonly T[]): { kept: T[]; removed: number } {
  const kept = [...examples];
  while (!writingExamplesFit(kept)) kept.pop();
  return { kept, removed: examples.length - kept.length };
}

/** 段落架構、要件的說明：有兩個以上句號而且超過 100 字時，截到第一句（不讓提示語變成成文）。 */
export function zhTrimToFirstSentence(text: string, maxChars = 100): string {
  if ((text.match(/。/gu)?.length ?? 0) < 2 || countZhChars(text).chars <= maxChars) return text;
  return text.slice(0, text.indexOf('。') + 1);
}

/** 等第或分數的寫法（「A 等」「B+級」「18 分」「級分」「等第」；「分鐘」「分之」「分析」「分類」「分段」「分別」不算）。 */
const GRADE_RE = /[ABC][＋+]?\s*(?:等|級)|\d{1,2}\s*分(?!鐘|之|析|類|段|別)|級分|等第/u;
/**
 * 配分的格式事實（系統提示允許模型引用）：「占 4 分」「配分 21 分」「滿分 25 分」「4＋21 分」「問題（一）4 分」。
 * 判斷等第句之前先拿掉這些寫法，句子裡沒有別的分數或等第就保留。
 */
const SCORE_FACT_RE =
  /(?:占|佔|配分|滿分|共|合計|總分)\s*\d{1,2}\s*分|\d{1,2}\s*[＋+]\s*\d{1,2}\s*分|問題\s*[（(][一二三四][）)][^。！？\n\d]{0,6}\d{1,2}\s*分|(?:知性|情意)(?:題)?[^。！？\n\d]{0,6}\d{1,2}\s*分/gu;

/** 拿掉含等第或分數的句子（整句；句子以。！？或換行分開）。「至多 19 行」「標點占一格」與配分這類格式事實不受影響。 */
export function zhStripGradeSentences(text: string): { text: string; removed: number } {
  let removed = 0;
  const kept = (text.match(/[^。！？!?\n]*(?:[。！？!?]+|\n|$)/gu) ?? []).filter((sentence) => {
    if (sentence === '' || !GRADE_RE.test(sentence.replace(SCORE_FACT_RE, ''))) return true;
    removed += 1;
    return false;
  });
  return { text: kept.join('').trim(), removed };
}

/** 連續漢字（不含標點）超過 max 個時，截到第 max 個字（主體段示範以外的欄位用；ZH_HAN_RUN_MAX）。 */
export function zhTruncateHanRun(text: string, max = ZH_HAN_RUN_MAX): { text: string; truncated: boolean } {
  for (const m of text.matchAll(/\p{Script=Han}+/gu)) {
    const chars = [...m[0]];
    if (chars.length > max) return { text: text.slice(0, m.index + chars.slice(0, max).join('').length), truncated: true };
  }
  return { text, truncated: false };
}

// ───────────────────────── 推論研判（§5.3） ─────────────────────────

export interface ZhJudgeLabels {
  /** 肯定標籤（符合、適當、正確…）。 */
  positive: string;
  /** 否定標籤（帶「不」的那一個，或「錯誤」）。 */
  negative: string;
  /** 無法判斷（或題目用的同義寫法）。 */
  unknown: string;
}

const JUDGE_LABEL_RE = new RegExp(`(?:[\\u2460-\\u2473\\u2474-\\u2487]|[（(]\\s*\\d{1,2}\\s*[)）]|皆|均|都)\\s*(${JUDGE_WORDS.join('|')})`, 'gu');

function isNegativeWord(w: string): boolean {
  return w === '錯誤' || (w.startsWith('不') && !(JUDGE_UNKNOWN_WORDS as readonly string[]).includes(w));
}

/**
 * 研判題的標籤（§5.3）：從選項文字抽出敘述編號後面或「皆」後面的判斷詞。否定標籤是帶「不」或「錯誤」的那一個，
 * 肯定標籤是它的另一半；只出現一半時補上另一半（正確 ↔ 錯誤、X ↔ 不X）。完全抽不到回 null。
 */
export function zhJudgeLabels(text: string): ZhJudgeLabels | null {
  const words = [...text.matchAll(JUDGE_LABEL_RE)].map((m) => m[1]!);
  if (words.length === 0) return null;
  const unknown = words.find((w) => (JUDGE_UNKNOWN_WORDS as readonly string[]).includes(w)) ?? '無法判斷';
  let negative = words.find(isNegativeWord) ?? null;
  let positive = words.find((w) => !isNegativeWord(w) && !(JUDGE_UNKNOWN_WORDS as readonly string[]).includes(w)) ?? null;
  if (positive === null && negative === null) return null;
  if (negative === null) negative = positive === '正確' ? '錯誤' : `不${positive!}`;
  if (positive === null) positive = negative === '錯誤' ? '正確' : negative.slice(1);
  return { positive, negative, unknown };
}

/** 敘述編號統一成圈號：⑴、(1)、（1） → ①。 */
function toCircled(text: string): string {
  return text
    .replace(/[⑴-⒇]/gu, (ch) => circled(ch.charCodeAt(0) - 0x2474 + 1))
    .replace(/[（(]\s*(\d{1,2})\s*[)）]/gu, (m, n: string) => (Number(n) >= 1 && Number(n) <= 20 ? circled(Number(n)) : m));
}

/** 一個選項的組合：敘述（①②…）→ 判定。 */
export type ZhJudgeCombo = Record<string, ZhVerdict>;

/**
 * 研判題的選項組合（§5.3）：把每個選項（「①、③皆正確，②無法判斷」）解析成「敘述 → 判定」。判斷詞依 labels 對到
 * yes（肯定）、no（否定）、cannot_tell（無法判斷）；沒給 labels 時用 zhJudgeLabels 從選項自己抽。
 * 解析不了的選項略過；能解析的選項少於 2 個回 null（例如選項是文字描述）。
 */
export function zhParseJudgeCombos(options: Readonly<Record<string, string>>, labels?: ZhJudgeLabels | null): Record<string, ZhJudgeCombo> | null {
  const lab = labels ?? zhJudgeLabels(Object.values(options).join('\n'));
  if (lab === null) return null;
  const verdictOf = (w: string): ZhVerdict | null => {
    if ((JUDGE_UNKNOWN_WORDS as readonly string[]).includes(w) || w === lab.unknown) return 'cannot_tell';
    if (w === lab.negative || isNegativeWord(w)) return 'no';
    if (w === lab.positive || (JUDGE_WORDS as readonly string[]).includes(w)) return 'yes';
    return null;
  };
  const out: Record<string, ZhJudgeCombo> = {};
  for (const [letter, raw] of Object.entries(options)) {
    const combo: ZhJudgeCombo = {};
    let ok = true;
    for (const clause of toCircled(raw).split(/[，,；;。]/u)) {
      if (clause.trim() === '') continue;
      const stmts = [...clause.matchAll(/[①-⑳]/gu)].map((m) => m[0]);
      const word = JUDGE_WORD_RE.exec(clause)?.[0] ?? null;
      const verdict = word === null ? null : verdictOf(word);
      if (stmts.length === 0 || verdict === null) {
        ok = false;
        break;
      }
      for (const s of stmts) combo[s] = verdict;
    }
    if (ok && Object.keys(combo).length > 0) out[letter] = combo;
  }
  return Object.keys(out).length >= 2 ? out : null;
}

/** 逐句判定推得出哪一個選項（組合的每一句都相同才算）；推不出回 null。 */
export function zhJudgeComboLetter(combos: Readonly<Record<string, ZhJudgeCombo>>, verdicts: Readonly<Record<string, ZhVerdict>>): string | null {
  for (const [letter, combo] of Object.entries(combos)) {
    const stmts = Object.keys(combo);
    if (stmts.length > 0 && stmts.every((s) => verdicts[s] === combo[s])) return letter;
  }
  return null;
}

/** 判定在畫面上的字：一般選項是「該選／不選」，研判題用題目自己的標籤。 */
export function zhVerdictText(verdict: ZhVerdict | null, labels: ZhJudgeLabels | null): string {
  if (verdict === null) return 'AI 沒有判斷';
  if (labels !== null) return verdict === 'yes' ? labels.positive : verdict === 'no' ? labels.negative : labels.unknown;
  return verdict === 'yes' ? '該選' : verdict === 'no' ? '不選' : '無法判斷';
}

// ───────────────────────── 多選計分（§5.4） ─────────────────────────

/** 判定的依據（國文的畫面顯示用）：學生提供的答案、AI 判斷的答案，或沒有答案。 */
export type ZhVerdictBasis = 'student_key' | 'ai_answer' | 'none';

export const ZH_VERDICT_BASIS_TEXT: Record<ZhVerdictBasis, string> = {
  student_key: '依你提供的答案',
  ai_answer: '依 AI 判斷的答案',
  none: '',
};

export interface ZhMultiScore {
  /** 誤選：學生選了、但答案沒有。 */
  wrong_picks: string[];
  /** 漏選：答案有、但學生沒選。 */
  missed: string[];
  /** 答錯的選項數（誤選＋漏選）。 */
  k: number;
  n: number;
  /** 得分比例 max(0, (n−2k)/n)；全部沒作答是 0。 */
  fraction: number;
  unanswered: boolean;
  /** 畫面的一行：「你誤選 (C)、漏選 (E)：答錯 2 個選項，得 1/5（每題 4 分時是 0.8 分）」。 */
  text_zh: string;
}

function lettersOf(v: string | readonly string[] | null | undefined): string[] {
  if (v === null || v === undefined) return [];
  const raw = typeof v === 'string' ? [...v] : [...v];
  return [...new Set(raw.map((x) => x.trim().toUpperCase()).filter((x) => /^[A-E]$/.test(x)))].sort();
}

function formatScore(x: number): string {
  return String(Math.round(x * 100) / 100);
}

/**
 * 多選計分（§5.4；包一層 exam-scoring 的 multiSelectFraction，國綜多選與英文混合題同一條規則），並產生畫面的說明。
 * 講義的配分不一定是 4 分，所以分數只當補充。依 AI 判斷的答案時加註「依 AI 判斷的答案試算」。單選題不要呼叫這支。
 */
export function zhMultiScore(input: { chosen: string | readonly string[] | null; key: string | readonly string[]; n: number; basis: ZhVerdictBasis; points?: number }): ZhMultiScore {
  const chosen = lettersOf(input.chosen);
  const key = lettersOf(input.key);
  const n = Math.max(1, Math.floor(input.n));
  const points = input.points ?? 4;
  const { fraction, wrong } = multiSelectFraction(n, key, chosen);
  const wrongPicks = chosen.filter((l) => !key.includes(l));
  const missed = key.filter((l) => !chosen.includes(l));
  const unanswered = chosen.length === 0;
  const tail = input.basis === 'ai_answer' ? '（依 AI 判斷的答案試算）' : '';
  let text: string;
  if (unanswered) text = '沒有作答：這題以 0 分計算。';
  else if (wrong === 0) text = '全對：得這題全部的分數。';
  else {
    const parts = [...(wrongPicks.length > 0 ? [`誤選 ${wrongPicks.map((l) => `(${l})`).join('')}`] : []), ...(missed.length > 0 ? [`漏選 ${missed.map((l) => `(${l})`).join('')}`] : [])];
    const score = fraction > 0 ? `得 ${n - 2 * wrong}/${n}（每題 ${points} 分時是 ${formatScore(fraction * points)} 分）` : '這題以 0 分計算';
    text = `你${parts.join('、')}：答錯 ${wrong} 個選項，${score}。`;
  }
  return { wrong_picks: wrongPicks, missed, k: wrong, n, fraction, unanswered, text_zh: text + tail };
}

// ───────────────────────── 台灣標準（§5.6） ─────────────────────────

/** 國語注音的一個字元：ㄅ–ㄩ（U+3105–U+3129）與聲調 ˊˇˋ˙。方言符號（ㄪ–ㄯ、ㆠ–ㆿ）不算。 */
export const ZH_BOPOMOFO_RE = /[ㄅ-ㄩˊˇˋ˙]/u;

const INITIAL = '[ㄅ-ㄙ]';
const MEDIAL = '[ㄧ-ㄩ]';
const FINAL = '[ㄚ-ㄦ]';
const TONE = '[ˊˇˋ]';
/** 一個音節：（˙）聲母？介音？韻母？聲調？（輕聲的 ˙ 寫在前面，也接受寫在後面）。 */
const SYLLABLE_RE = new RegExp(`^(?:˙)?(${INITIAL})?(${MEDIAL})?(${FINAL})?(?:${TONE}|˙)?$`, 'u');

/** 一個音節的形狀對不對：至少要有聲母、介音、韻母其中一個；輕聲與聲調不能同時出現。 */
export function isZhBopomofoSyllable(syllable: string): boolean {
  const m = SYLLABLE_RE.exec(syllable);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return false;
  const light = (syllable.match(/˙/gu)?.length ?? 0) > 0;
  return !(light && new RegExp(TONE, 'u').test(syllable)) && (syllable.match(/˙/gu)?.length ?? 0) <= 1;
}

/** 連寫的注音切成音節（聲調、輕聲或下一個聲母開始新的音節；空白、「／」「・」也是分隔）。一聲的「ˉ」不寫，先拿掉。 */
export function zhBopomofoSyllables(text: string): string[] {
  const out: string[] = [];
  for (const token of text.replace(/ˉ/gu, '').split(/[\s／/・、]+/u)) {
    let cur = '';
    let has = { initial: false, medial: false, final: false };
    const flush = () => {
      if (cur !== '') out.push(cur);
      cur = '';
      has = { initial: false, medial: false, final: false };
    };
    for (const ch of token) {
      const isInitial = /[ㄅ-ㄙ]/u.test(ch);
      const isMedial = /[ㄧ-ㄩ]/u.test(ch);
      const isFinal = /[ㄚ-ㄦ]/u.test(ch);
      if (ch === '˙') {
        if (cur !== '' && !has.initial && !has.medial && !has.final) {
          cur += ch;
          continue;
        }
        if (cur === '') {
          cur = ch;
          continue;
        }
        cur += ch;
        flush();
        continue;
      }
      if ((isInitial && (has.initial || has.medial || has.final)) || (isMedial && (has.medial || has.final)) || (isFinal && has.final)) flush();
      cur += ch;
      if (isInitial) has.initial = true;
      if (isMedial) has.medial = true;
      if (isFinal) has.final = true;
      if (/[ˊˇˋ]/u.test(ch)) flush();
    }
    flush();
  }
  return out;
}

/** 帶聲調的拼音母音（āáǎà…）。 */
const PINYIN_TONE_RE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/gu;

export interface ZhBopomofoCheck {
  /** 只有國語注音、分隔符號，而且每個音節的形狀都對。 */
  ok: boolean;
  syllables: string[];
  /** 出現拉丁字母（拼音）：那一格清空，畫面註記「讀音請查教育部辭典」。 */
  pinyin: boolean;
  /** 出現方言符號（ㄪ–ㄯ、ㆠ–ㆿ）。 */
  dialect: boolean;
}

/**
 * 字音卡的注音欄（§5.6）：字元只允許 U+3105–U+3129、聲調與分隔（空白、「／」「・」），並檢查每個音節的形狀。
 * 一聲的「ˉ」（有些講義會標）先拿掉再檢查：台灣的注音一聲不標。
 */
export function zhCheckBopomofo(raw: string): ZhBopomofoCheck {
  const text = raw.replace(/ˉ/gu, '');
  const pinyin = /[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/u.test(text);
  const dialect = /[ㄪ-ㄯㆠ-ㆿ]/u.test(text);
  const syllables = zhBopomofoSyllables(text.trim());
  const onlyAllowed = /^[ㄅ-ㄩˊˇˋ˙\s／/・、]*$/u.test(text);
  const ok = !pinyin && !dialect && onlyAllowed && syllables.length > 0 && syllables.every(isZhBopomofoSyllable);
  return { ok, syllables, pinyin, dialect };
}

/** 一段文字裡帶聲調的拼音母音有幾個（說明欄位的拼音只計數）。 */
export function zhPinyinCount(text: string): number {
  return text.match(PINYIN_TONE_RE)?.length ?? 0;
}

/**
 * 台灣審定音核對（§5.6）：字在 ZH_TW_READINGS 裡，讀音是其中一個 → ok；不是 → mismatch（那一格標「讀音待查」、
 * 該題 certainty 最高 likely）；字不在表裡 → unlisted（不檢查）。
 */
export function zhTwReadingCheck(char: string, reading: string): 'ok' | 'mismatch' | 'unlisted' {
  const allowed = ZH_TW_READINGS[char];
  if (allowed === undefined) return 'unlisted';
  return allowed.includes(reading.trim()) ? 'ok' : 'mismatch';
}

export type ZhSoundClaim = 'same' | 'different' | 'all_different';

/**
 * 字音、字義題 key_zh 的讀音與結論（§5.6 的一致性檢查）：「前ㄆㄧˊ／後ㄆㄧˊ：同」→ readings ['ㄆㄧˊ','ㄆㄧˊ']、claim same；
 * 三字一組寫三個音。結論是最後一個冒號之後的那一段（字義題寫成「前：被／後：被：同」，前面也有冒號），讀音取前面各段。
 * 結論只認「同、相同」「不同」「完全不同、兩兩不同」，其他是 null；沒有冒號時沒有結論。
 */
export function zhParseSoundKey(key: string): { readings: string[]; claim: ZhSoundClaim | null } {
  const at = Math.max(key.lastIndexOf('：'), key.lastIndexOf(':'));
  const left = at >= 0 ? key.slice(0, at) : key;
  const right = at >= 0 ? key.slice(at + 1) : '';
  const readings = left
    .split(/[／/、，,]/u)
    .map((seg) => zhBopomofoSyllables(seg.replace(/[^ㄅ-ㄩˊˇˋ˙\s]/gu, ' ')).join(' '))
    .filter((r) => r !== '');
  const r = right.trim();
  const claim: ZhSoundClaim | null = /完全不同|兩兩不同|皆不同|各不相同/.test(r) ? 'all_different' : /不同/.test(r) ? 'different' : /同/.test(r) ? 'same' : null;
  return { readings, claim };
}

/** 一組讀音的關係：全部相同、全部兩兩不同，或其他（有同有不同）。 */
export function zhReadingsRelation(readings: readonly string[]): ZhSoundClaim {
  if (readings.length <= 1 || readings.every((r) => r === readings[0])) return 'same';
  return new Set(readings).size === readings.length ? 'all_different' : 'different';
}

/** key_zh 自己寫的結論和它寫出的讀音一致嗎（讀音少於 2 個或沒有結論時回 null：無從比對）。 */
export function zhSoundKeyConsistent(key: string): boolean | null {
  const { readings, claim } = zhParseSoundKey(key);
  if (readings.length < 2 || claim === null) return null;
  const rel = zhReadingsRelation(readings);
  if (claim === 'same') return rel === 'same';
  if (claim === 'all_different') return rel === 'all_different';
  return rel !== 'same';
}

/** 說明欄位的字碼統一（ZH_TW_FORM_MAP；§5.6）：替換並回傳換了幾個字。quote、原文 head 與學生的文字不要套用。 */
export function zhApplyTwForms(text: string): { text: string; replaced: number } {
  let replaced = 0;
  const out = [...text]
    .map((ch) => {
      const to = ZH_TW_FORM_MAP[ch];
      if (to === undefined) return ch;
      replaced += 1;
      return to;
    })
    .join('');
  return { text: out, replaced };
}

const SIMPLIFIED_SET: ReadonlySet<string> = new Set(ZH_SIMPLIFIED_ONLY);

/** 文字裡不同的簡體專用字（整則 ≥ 3 個時重寫一次）。 */
export function zhSimplifiedChars(text: string): string[] {
  return [...new Set([...text].filter((ch) => SIMPLIFIED_SET.has(ch)))];
}

/** 教字形的欄位（正確寫法、易混字、錯別字的正字）裡的非標準字：簡體專用字或 ZH_TW_FORM_MAP 左邊的字；有任何一個就拿掉那一列。 */
export function zhNonStandardChars(text: string): string[] {
  return [...new Set([...text].filter((ch) => SIMPLIFIED_SET.has(ch) || ZH_TW_FORM_MAP[ch] !== undefined))];
}

function pairIn(pairs: ReadonlyArray<readonly [string, string]>, x: string, y: string): boolean {
  return pairs.some(([a, b]) => (a === x && b === y) || (a === y && b === x));
}

/** 兩個字是不是兩可：ZH_FORM_EITHER 的一對，或字碼對照（ZH_TW_FORM_MAP）統一之後相同。 */
function charEither(x: string, y: string): boolean {
  return x === y || pairIn(ZH_FORM_EITHER, x, y) || ZH_TW_FORM_MAP[x] === y || ZH_TW_FORM_MAP[y] === x || zhApplyTwForms(x).text === zhApplyTwForms(y).text;
}

/**
 * (wrong, right) 是不是兩可的寫法：錯別字清單要丟掉這一列。模型多半寫整個詞（「台灣→臺灣」「讚嘆→讚歎」），所以逐字比：
 * 兩邊一樣長、每一個不同的字都是 ZH_FORM_EITHER 的一對或字碼差異，就是兩可；另外收常見的兩可詞（ZH_FORM_EITHER_WORDS）。
 */
export function zhIsFormEither(wrong: string, right: string): boolean {
  if (wrong === right) return true;
  if (pairIn(ZH_FORM_EITHER, wrong, right) || pairIn(ZH_FORM_EITHER_WORDS, wrong, right)) return true;
  if (zhApplyTwForms(wrong).text === zhApplyTwForms(right).text) return true;
  const a = [...wrong];
  const b = [...right];
  if (a.length !== b.length) return false;
  return a.every((ch, i) => charEither(ch, b[i]!));
}

/**
 * 修辭名稱（§5.6）：台灣課本的名稱（含「名稱（次類）」）→ ok；只有大陸使用的名稱 → replaced（換成台灣名稱）；
 * 其他 → unknown（只計數，評測時人工看）。題目自己給了分類時以題目的名稱為準，不要呼叫這支。
 */
export function zhRhetoricName(raw: string): { status: 'ok' | 'replaced' | 'unknown'; name: string } {
  const name = raw.trim().replace(/[(（]\s*/u, '（').replace(/\s*[)）]$/u, '）');
  const mainland = ZH_RHETORIC_MAINLAND[name];
  if (mainland !== undefined) return { status: 'replaced', name: mainland };
  const m = /^([^（]+)(?:（([^）]+)）)?$/u.exec(name);
  if (!m) return { status: 'unknown', name: raw };
  const base = m[1]!;
  const sub = m[2];
  if (!ZH_RHETORIC_TERMS.includes(base)) {
    const replaced = ZH_RHETORIC_MAINLAND[base];
    if (replaced !== undefined && sub === undefined) return { status: 'replaced', name: replaced };
    return { status: 'unknown', name: raw };
  }
  if (sub === undefined) return { status: 'ok', name };
  const subs = ZH_RHETORIC_SUBTYPES[base];
  if (subs === undefined || subs.includes(sub)) return { status: 'ok', name };
  return { status: 'unknown', name: raw };
}

// ───────────────────────── 畫面形狀（程式後處理之後；§3.2–§3.5、§7.2） ─────────────────────────

/** 國文解析的程式說明（英文的 AssistNotice 種類，加上國文的示範、短答與等第規則）。 */
export const ZH_NOTICE_KINDS = [
  'demo_removed',
  'copy_demo_removed',
  'short_answer_hidden',
  'example_removed',
  'grade_removed',
  'notes_removed',
  'simplified_kept',
  'example_rule_removed',
  'exemplar_over_limit',
] as const;
export type ZhNoticeKind = AssistNotice['kind'] | (typeof ZH_NOTICE_KINDS)[number];

/** field 是欄位路徑（例如 'parts[0].demo_zh'）；畫面在那一區顯示固定說明。 */
export interface ZhNotice {
  kind: ZhNoticeKind;
  field: string;
}

/** 國文說明的固定文字（英文已有的種類照英文畫面的說明，這裡只列國文新增的）。 */
export const ZH_NOTICE_TEXT: Record<(typeof ZH_NOTICE_KINDS)[number], string> = {
  demo_removed: 'AI 示範超過字數，已省略。',
  copy_demo_removed: '這題必須抄錄原文，AI 示範不是逐字出自原文，已省略。',
  short_answer_hidden: '這個示範和受保護的官方文字太像，已省略。',
  example_removed: '示範超過篇幅，已省略。',
  grade_removed: 'AI 不打等第或分數，已拿掉那一句。',
  notes_removed: '已拿掉引用題目沒有的注釋的那一句。',
  simplified_kept: '這則解析裡有簡體字，寫法請以教育部標準字為準。',
  example_rule_removed: '有一筆示範不符合本站的示範規則（和已發表的文章相同、用了套語，或引文查不到出處），已省略。',
  exemplar_over_limit: '這篇示範比答案卷的字數或格數多一些，考試時要再刪減。',
};

/** 一題（或一列）的程式提醒：確定程度上限、逐項和答案不一致、可能是多選、錯字數不符、讀音前後不一致…。 */
export const ZH_ITEM_WARNINGS = [
  'cap_dictionary',
  'cap_verify',
  'inconsistent',
  'multi_suspect',
  'form_count_mismatch',
  'sound_inconsistent',
  'stem_rule_missing',
  'recitation_unverified',
  'key_concern',
] as const;
export type ZhItemWarning = (typeof ZH_ITEM_WARNINGS)[number];

export const ZH_ITEM_WARNING_TEXT: Record<ZhItemWarning, string> = {
  cap_dictionary: ZH_CAP_NOTE_TEXT.dictionary,
  cap_verify: ZH_CAP_NOTE_TEXT.verify,
  inconsistent: 'AI 的逐項判斷和答案不一致，請小心。',
  multi_suspect: '這題可能是多選題，要改成多選重看嗎？',
  form_count_mismatch: '請對照原卷確認錯字有沒有被輸入法或轉錄改掉。',
  sound_inconsistent: 'AI 的讀音說明前後不一致，請查教育部辭典。',
  stem_rule_missing: 'AI 沒有先引用題目給的定義，請對照題幹再確認。',
  recitation_unverified: '本站無法核對原文。',
  key_concern: 'AI 對答案有疑問。',
};

/** 題型卡一列的程式提醒。 */
export const ZH_ROW_FLAGS = ['reading_unverified', 'pinyin_cleared', 'class_not_in_question', 'key_differs', 'option_gap'] as const;
export type ZhRowFlag = (typeof ZH_ROW_FLAGS)[number];

export const ZH_ROW_FLAG_TEXT: Record<ZhRowFlag, string> = {
  reading_unverified: '讀音待查',
  pinyin_cleared: '讀音請查教育部辭典',
  class_not_in_question: '這個分類名稱不在題目裡',
  key_differs: 'AI 的判斷和你提供的答案不同',
  option_gap: 'AI 沒有判斷這個選項，可以用追問問它',
};

export interface ZhCardRowView {
  head: string;
  a: string;
  b: string;
  note: string;
  /** head 在題目裡的位置（文言對照、詩詞卡的原文句找得到才有；null＝不當成原文、不加亮）。 */
  range: AssistQuoteRange | null;
  flags: ZhRowFlag[];
}

export interface ZhCardView {
  /** 這張卡屬於哪一題（空字串＝整組共用，例如比較卡）；畫面把卡放在那一題下面。 */
  for_label: string;
  kind: ZhCardKind;
  title_zh: string;
  rows: ZhCardRowView[];
}

export interface ZhOptionView {
  /** A–E，或研判題的 ①–⑤。 */
  option: string;
  /** null＝AI 沒有判斷（程式補的列）。 */
  verdict: ZhVerdict | null;
  key_zh: string;
  reason_zh: string;
  quote: string;
  range: AssistQuoteRange | null;
  flaw: ZhFlawCode | '';
  /** 學生的作答：選擇題是選了沒；研判題是學生的組合拆出來的「你判」。 */
  student: { picked: boolean; mark: 'wrong_pick' | 'missed' | 'ok' | null } | { judged: ZhVerdict | null } | null;
  flags: ZhRowFlag[];
}

/** 正確答案的來源：學生提供的答案（「你提供的答案」），或 AI 的判斷。 */
export type ZhAnswerKey = { from: 'student'; text: string } | { from: 'ai'; text: string; certainty: ZhCertainty } | null;

export interface ZhChoiceItemView {
  label: string;
  display_label: string;
  item_type: ZhSection;
  choice_mode: ZhChoiceMode;
  verdict: AssistVerdict;
  verdict_basis: ZhVerdictBasis;
  answer_key: ZhAnswerKey;
  /** 學生選的字母（排序後）；沒作答是 null。 */
  student_answer: string | null;
  /** 只有多選題。 */
  multi_score: ZhMultiScore | null;
  diagnosis: { error_codes: string[]; summary_zh: string; detail_zh: string };
  hints_zh: string[];
  solution_steps: Array<{ text_zh: string; quote: string; range: AssistQuoteRange | null }>;
  options: ZhOptionView[];
  /** 研判題的題目標籤（畫面的判定欄用這些字）。 */
  judge_labels: ZhJudgeLabels | null;
  warnings: ZhItemWarning[];
}

/** 程式依每題的 item_type 附上的解法步驟（同一案例同一題型只一次；多選題策略的 key 是 'multi'）。 */
export interface ZhTypeSteps {
  key: ZhSection | 'multi';
  title_zh: string;
  steps_zh: string[];
  /** 這組步驟屬於哪幾題。 */
  labels: string[];
}

interface ZhViewTail {
  doubt_replies: AssistDoubtReply[];
  followup_chips_zh: string[];
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
  notices: ZhNotice[];
  cache_hit: boolean;
}

/** zh_choice（單選、多選、研判、排序）解析的畫面形狀。 */
export interface ZhChoiceView extends ZhViewTail {
  kind: 'zh_choice';
  section: ZhSection;
  skill_codes: string[];
  tested_zh: string;
  passage_zh: string;
  cards: ZhCardView[];
  items: ZhChoiceItemView[];
  method: { title_zh: string; steps_zh: string[] };
  type_steps: ZhTypeSteps[];
  score_tips_zh: string[];
  key_concern_zh: string;
}

export interface ZhShortPartView {
  label: string;
  display_label: string;
  item_type: ZhSection;
  task_zh: string;
  char_limit: ZhCharLimit | null;
  key_points: Array<{ point_zh: string; quote: string; range: AssistQuoteRange | null }>;
  frame_zh: string;
  /** 本站 AI 示範（先收合；拿掉時是空字串，notices 說明原因）。 */
  demo_zh: string;
  demo_count: ZhCharCount | null;
  hints_zh: string[];
  check: { coverage: ZhCoverage; missing_zh: string; wording_zh: string };
  student_answer: string | null;
  student_count: ZhCharCount | null;
  /** 學生答案超過字數限制。 */
  over_limit: boolean;
  copy_check: ZhCopyCheck | null;
  verdict: AssistVerdict;
}

/** zh_short（非選擇題、簡答）解析的畫面形狀。 */
export interface ZhShortView extends ZhViewTail {
  kind: 'zh_short';
  section: ZhSection;
  skill_codes: string[];
  tested_zh: string;
  passage_zh: string;
  cards: ZhCardView[];
  parts: ZhShortPartView[];
  method: { title_zh: string; steps_zh: string[] };
  type_steps: ZhTypeSteps[];
  score_tips_zh: string[];
  key_concern_zh: string;
}

/** zh_writing（國寫指導）解析的畫面形狀。不輸出等第或分數。 */
export interface ZhWritingView extends ZhViewTail {
  kind: 'zh_writing';
  section: ZhSection;
  skill_codes: string[];
  tested_zh: string;
  material_zh: string;
  requirements: Array<{ point_zh: string; quote: string; range: AssistQuoteRange | null; how_zh: string }>;
  /** 問題（一）：只有知性題；要點與素材原文依序對應。 */
  q1: { points: Array<{ point_zh: string; quote: string; range: AssistQuoteRange | null }>; frame_zh: string; demo_zh: string; demo_count: ZhCharCount | null } | null;
  stances_zh: string[];
  angles_zh: string[];
  outline: Array<{ part_zh: string; hint_zh: string }>;
  examples: Array<{ use_zh: string; text: string }>;
  pitfalls_zh: string[];
  /** 學生附的段落（有附才有）：要件檢核與錯別字。 */
  draft: {
    target: 'q1' | 'q2';
    count: ZhCharCount;
    checks: Array<{ point_zh: string; status: ZhDraftStatus; comment_zh: string; quote: string; range: AssistQuoteRange | null }>;
    typos: Array<{ wrong: string; right: string; quote: string; range: AssistQuoteRange | null }>;
  } | null;
  checklist_zh: string[];
  type_steps: ZhTypeSteps[];
}

/** 國文解析的畫面形狀（依格式）。 */
export type ZhAnalysisView = ZhChoiceView | ZhShortView | ZhWritingView;

/** 國文追問一輪的回覆（例句欄叫 example，不包 lang="en"）。 */
export interface ZhFollowupView {
  kind: 'zh_followup';
  reply_zh: string;
  points: Array<{ text_zh: string; example: string }>;
  mode_used: 'hint' | 'explain';
  new_error_codes: string[];
  understood_check_zh: string;
  followup_chips_zh: string[];
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
  notices: ZhNotice[];
}

/** 國文後處理寫進 assist_turns.output_json 的檢查計數（§5.1 第 16 步；給評測與監看，不顯示）。 */
export const ZH_CHECK_COUNTERS = [
  'quote_misses',
  'card_head_unmatched',
  'card_rows_dropped',
  'option_gaps',
  'inconsistent',
  'multi_suspect',
  'form_count_mismatch',
  'form_rows_unverified',
  'stem_rule_missing',
  'notes_unmatched',
  'classic_misquote',
  'recitation_unverified',
  'hint_leak_removed',
  'tw_reading_mismatch',
  'sound_inconsistent',
  'tw_form_replaced',
  'tw_form_rows_dropped',
  'rhetoric_term_replaced',
  'rhetoric_term_unknown',
  'simplified_retry',
  'pinyin_cleared',
  'demo_removed',
  'copy_demo_removed',
  'short_answer_hidden',
  'd8_hidden',
  'grade_removed',
  'enum_normalized',
  'enum_unknown',
  // 國寫範文與國寫指導的示範段（國寫範文設計 §5、§10）。
  'punct_fixed',
  'exclaim_replaced',
  'contest_retry',
  'contest_hidden',
  'contest_overlap_removed',
  'over_limit_retry',
  'over_limit_kept',
  'under_target',
  'material_quote_long',
  'attribution_removed',
  'quote_unmarked',
  'stock_line_removed',
  'cliche',
  'contest_word',
  'overused_figure',
  'claim_removed',
  'contest_mention_removed',
  'coverage_quote_miss',
  'card_unknown',
  'paragraph_trimmed',
  'example_rule_removed',
  // 情意範文含敏感事件用字的句子（只計數，ops 事件 assist_zh_exemplar_sensitive）。
  'sensitive_event',
] as const;
export type ZhCheckCounter = (typeof ZH_CHECK_COUNTERS)[number];
export type ZhChecks = Partial<Record<ZhCheckCounter, number>>;
