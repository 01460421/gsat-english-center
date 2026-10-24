/**
 * 作文範文（輸入或選一個作文題目，AI 依同一個構想寫出三個層級的範文）的型別、常數與前後端共用的純函式
 * （docs/design/model-essays.md §2、§7.2）。
 *
 * 分工：
 *   - 三個層級的規格（EXEMPLAR_LEVEL_SPECS）前端顯示與 Worker 的系統提示用同一份；改了規格就遞增 EXEMPLAR_LEVELS_VERSION。
 *   - 字數目標（exemplarWordTargets）前端確認畫面、Worker 的 <task>、後處理三邊共用（§2.4）。
 *   - 對照表的數字（exemplarMetrics）由程式算：Worker 後處理存進 ExemplarEssayView.metrics，前端的「你的作文」欄用同一支（§2.6）。
 *   - 網站題目的白名單（isExemplarSiteSource）Worker 與前端的選題器共用（§5.5）。
 *   - 模型輸出的 zod schema 在 Worker，這裡只放程式後處理之後給畫面的形狀（ExemplarSetView 等）。
 * JSON 欄位一律 snake_case（和資料庫、既有共用型別一致）。
 *
 * 獨立成一個模組（由 index.ts 直接轉匯出，不經 writing.ts）：只有作文範文的頁面與入口按鈕用到，不要跟著 writing.ts
 * 進到首頁的主程式（理由同 custom-essay.ts）。
 */
import { isAssistTask } from './assist';
import type { ModelTextNote } from './bank';
import { countConnectives } from './connectives';
import { CUSTOM_PROMPT_PROBLEM_MESSAGES, type CustomPromptProblem } from './custom-essay';
import {
  countEnglishWords,
  type AiRefundReason,
  type AiTask,
  type CustomEssayPrompt,
  type CustomEssayPromptInput,
  type EssayBand,
  type EssayCriterion,
} from './writing';

// ───────────────────────── 任務與白名單 ─────────────────────────

/** 作文範文的 AI 任務（代號同時登記在 writing.ts 的 AI_TASKS）。 */
export const EXEMPLAR_TASKS = ['essay_exemplars'] as const satisfies readonly AiTask[];
export type ExemplarTask = (typeof EXEMPLAR_TASKS)[number];

/** 這個任務代號是不是作文範文（consumer 依它分流，housekeeping 依它分開回收，退還依它改 exemplar_sets）。 */
export function isExemplarTask(task: string): task is ExemplarTask {
  return (EXEMPLAR_TASKS as readonly string[]).includes(task);
}

/**
 * 送出前要不要把輸出格式的 $ref 攤開（apps/api/src/ai/client.ts 的 buildClaudeRequest）：學習助手與作文範文是 true，
 * 批改任務維持原樣（請求逐位元不變）。
 */
export function inlinesSchemaRefs(task: string): boolean {
  return isAssistTask(task) || isExemplarTask(task);
}

/** 網站題目的來源：歷屆試題、本站仿真題。自訂題是 custom。 */
export const EXEMPLAR_SOURCES = ['exam', 'bank', 'custom'] as const;
export type ExemplarSource = (typeof EXEMPLAR_SOURCES)[number];

/**
 * 網站題目的白名單（§5.5）：歷屆題（origin exam＋授權 CEEC-exam）與本站仿真題（origin bank＋授權 original-ai）。
 * 其他組合（例如之後匯入的其他來源題目）一律 false：不能產生、不進共用快取、選題器不列。
 * Worker 的 isExemplarSiteGroup 與前端的選題器都呼叫這一支。
 */
export function isExemplarSiteSource(origin: string, license: string): boolean {
  return (origin === 'exam' && license === 'CEEC-exam') || (origin === 'bank' && license === 'original-ai');
}

/**
 * 前端兩份網站題目索引的來源與授權（選題器 SitePromptPicker 用；§8.2）：歷屆作文索引（/data/writing/essay.json）只收官方歷屆
 * 考卷，本站仿真作文索引（/data/writing/bank/）只收本站原創題。選題器只列 isExemplarSiteSource 為 true 的索引，之後新增的
 * 題目索引（例如匯入的其他來源題目）不在這裡，就不會自動出現。
 */
export const EXEMPLAR_SITE_INDEXES = {
  exam: { origin: 'exam', license: 'CEEC-exam' },
  bank: { origin: 'bank', license: 'original-ai' },
} as const satisfies Record<'exam' | 'bank', { origin: ExemplarSource; license: string }>;

// ───────────────────────── 三個層級（§2.2） ─────────────────────────

export const EXEMPLAR_LEVELS = ['basic', 'steady', 'top'] as const;
export type ExemplarLevel = (typeof EXEMPLAR_LEVELS)[number];

/**
 * 層級規格的版本：EXEMPLAR_LEVEL_SPECS 或系統提示裡的層級描述改了就遞增（寫進每一組的 meta_json；
 * 規格也在系統提示裡，所以 prompt_version 與共用快取的鍵跟著換）。
 */
export const EXEMPLAR_LEVELS_VERSION = 'lv1';

export interface ExemplarLevelSpec {
  label: '基礎版' | '穩健版' | '頂標版';
  /** 對到的官方等級（ESSAY_BANDS）：可、優、特優。 */
  band: EssayBand;
  /** 目標總分範圍（含兩端）。 */
  total: readonly [number, number];
  /** 四項的目標範圍；四項的下限加總＝total[0]、上限加總＝total[1]。 */
  scores: Readonly<Record<EssayCriterion, readonly [number, number]>>;
  /** 預設字數（§2.4 的預設階梯）。 */
  words: readonly [number, number];
}

/**
 * 三個層級（§2.2）。範文三篇都沒有錯誤，基礎版的分數只低在本站規準「3 分」的特徵（一項要求發展不足、轉承不平均、
 * 句型範圍窄、用字有限）；字彙 2 分要求「錯誤多」，零錯的作文到不了，所以基礎版每一項都不低於 3（§2.3）。
 * 穩健版、頂標版和本站題庫範文的同名等級一致。
 */
export const EXEMPLAR_LEVEL_SPECS: Readonly<Record<ExemplarLevel, ExemplarLevelSpec>> = {
  basic: {
    label: '基礎版',
    band: 'fair',
    total: [12, 13],
    scores: { content: [3, 3], organization: [3, 3], grammar: [3, 4], vocabulary: [3, 3] },
    words: [130, 170],
  },
  steady: {
    label: '穩健版',
    band: 'good',
    total: [15, 16],
    scores: { content: [4, 4], organization: [4, 4], grammar: [4, 4], vocabulary: [3, 4] },
    words: [180, 240],
  },
  top: {
    label: '頂標版',
    band: 'excellent',
    total: [19, 20],
    scores: { content: [5, 5], organization: [5, 5], grammar: [5, 5], vocabulary: [4, 5] },
    words: [300, 380],
  },
};

/**
 * 作文的建議用時（分鐘）：模擬考成績單的建議用時（apps/web/src/features/mock/papers.ts 引用它）與範文的系統提示
 * （頂標版「在考場上怎麼用」）共用同一個數字。
 */
export const ESSAY_SUGGESTED_MINUTES = 25;

// ───────────────────────── 上限 ─────────────────────────

/** 數量與保存的上限（設計值，§4.2、§6.2）。 */
export const EXEMPLAR_LIMITS = {
  /** 每人每天建立的組數（含共用快取命中）。 */
  setsPerDay: 20,
  /** 每人保留的組數。 */
  setsStored: 300,
  /** 最後一次更新後幾天刪除。 */
  retentionDays: 180,
  highlightsPerLevel: 10,
  typicalErrors: 3,
  bodyMaxBytes: 8_192,
  /** 範文模式的自訂題：「最多」至少這麼多字（§5.1）。 */
  customMaxWordsMin: 100,
  /** 範文模式的自訂題：「至少」最多這麼多字（§5.1）。 */
  customMinWordsMax: 350,
  /** 一個操作最多付費產生幾次內容失敗的結果（跨 Queue 投遞累計，§3.6）。 */
  contentAttempts: 2,
} as const;

/** 說明欄位的長度上限（字元；quoteWords 是英文單詞數，§2.5）。 */
export const EXEMPLAR_FIELD_LIMITS = { taskReadingZh: 150, planZh: 250, criterionZh: 90, nextZh: 160, quoteWords: 25, noteZh: 50 } as const;

// ───────────────────────── 字數目標（§2.4） ─────────────────────────

export interface ExemplarWordRequest {
  /** 網站題目取題組的 origin；自訂題是 custom。 */
  origin: ExemplarSource;
  min_words: number | null;
  max_words: number | null;
  /** 題目寫「約 A 字」時的 A（只有網站題目會有）。 */
  approx_words: number | null;
}

export interface ExemplarWordTarget {
  min: number;
  max: number;
  /** 硬性範圍：不在這裡面＝內容失敗（§3.5）；在 [min, max] 之外、硬性範圍之內只記數。 */
  hardMin: number;
  hardMax: number;
}

/** 硬性範圍（§2.4）：hardMin = min(max(90, ⌊0.8 × min⌋), min)、hardMax = ⌈1.15 × max⌉。 */
function withHardRange(min: number, max: number): ExemplarWordTarget {
  return { min, max, hardMin: Math.min(Math.max(90, Math.floor(0.8 * min)), min), hardMax: Math.ceil(1.15 * max) };
}

/** 題目的下限 L：min_words；沒有時「約 A 字」取 ⌈0.9A⌉；都沒有時 null。 */
export function exemplarLowerBound(req: Pick<ExemplarWordRequest, 'min_words' | 'approx_words'>): number | null {
  if (req.min_words !== null && req.min_words > 0) return Math.floor(req.min_words);
  if (req.approx_words !== null && req.approx_words > 0) return Math.ceil(0.9 * req.approx_words);
  return null;
}

/** 預設階梯，每一級的 min 至少是 L。 */
function defaultLadder(lower: number | null): Record<ExemplarLevel, ExemplarWordTarget> {
  const out = {} as Record<ExemplarLevel, ExemplarWordTarget>;
  for (const level of EXEMPLAR_LEVELS) {
    const [min, max] = EXEMPLAR_LEVEL_SPECS[level].words;
    const m = Math.max(min, lower ?? 0);
    out[level] = withHardRange(m, Math.max(max, m));
  }
  return out;
}

/** 只有「至少 N」而且 N > 130：N–N+40／N+40–N+100／max(N+150, 300)–max(N+230, 380)。 */
function fromLowerBound(n: number): Record<ExemplarLevel, ExemplarWordTarget> {
  return {
    basic: withHardRange(n, n + 40),
    steady: withHardRange(n + 40, n + 100),
    top: withHardRange(Math.max(n + 150, 300), Math.max(n + 230, 380)),
  };
}

/**
 * 三級的字數目標（§2.4 的表）：
 *   - 網站題目（exam、bank）：上限與「約 A 字」只用來定下限（官方只罰字數不足），L ≤ 130 或沒有時用預設階梯；
 *     L > 130（目前資料沒有）同自訂題的「只有至少 N」。
 *   - 自訂題：有「最多 M」時把〔L, M〕切成重疊的三段（前 40%、中間 30–70%、後 40%；只有上限時 L＝⌈0.6M⌉），
 *     M − L < 30 時三級都用〔L, M〕；沒有上限時同網站題目。
 * 每一級都保證 hardMin ≤ min ≤ max ≤ hardMax，而且 min ≥ L。
 */
export function exemplarWordTargets(req: ExemplarWordRequest): Record<ExemplarLevel, ExemplarWordTarget> {
  const lower = exemplarLowerBound(req);
  const upper = req.origin === 'custom' && req.max_words !== null && req.max_words > 0 ? Math.floor(req.max_words) : null;
  if (upper !== null) {
    const l = Math.min(req.min_words !== null && req.min_words > 0 ? Math.floor(req.min_words) : Math.ceil(0.6 * upper), upper);
    const span = upper - l;
    if (span < 30) {
      const same = withHardRange(l, upper);
      return { basic: same, steady: { ...same }, top: { ...same } };
    }
    const at = (ratio: number) => l + Math.round(span * ratio);
    return {
      basic: withHardRange(l, at(0.4)),
      steady: withHardRange(at(0.3), at(0.7)),
      top: withHardRange(at(0.6), upper),
    };
  }
  if (lower !== null && lower > EXEMPLAR_LEVEL_SPECS.basic.words[0]) return fromLowerBound(lower);
  return defaultLadder(lower);
}

/** 範文模式的自訂題多兩個字數代碼（§5.1）。 */
export const EXEMPLAR_WORD_PROBLEMS = ['exemplar_words_too_few', 'exemplar_words_too_many'] as const;
export type ExemplarWordProblem = (typeof EXEMPLAR_WORD_PROBLEMS)[number];

/**
 * 範文模式的自訂題字數範圍（§2.4、§5.1）：checkCustomPrompt 通過之後再查。「最多」< 100 → exemplar_words_too_few
 * （標在「最多」欄）；「至少」> 350 → exemplar_words_too_many（標在「至少」欄）；其他 null。
 */
export function exemplarCustomWordProblem(p: { min_words?: number | null; max_words?: number | null }): { code: ExemplarWordProblem; field: 'min_words' | 'max_words' } | null {
  const max = p.max_words ?? null;
  const min = p.min_words ?? null;
  if (max !== null && max < EXEMPLAR_LIMITS.customMaxWordsMin) return { code: 'exemplar_words_too_few', field: 'max_words' };
  if (min !== null && min > EXEMPLAR_LIMITS.customMinWordsMax) return { code: 'exemplar_words_too_many', field: 'min_words' };
  return null;
}

/**
 * 範文模式的題目訊息：自訂作文題目的訊息只換兩則（這個模式本來就是要產生範文），另加兩個字數代碼；
 * 其他和自訂題逐字相同（§5.1）。
 */
export const EXEMPLAR_PROMPT_PROBLEM_MESSAGES = {
  ...CUSTOM_PROMPT_PROBLEM_MESSAGES,
  request_to_ai: '題目欄只放題目本身（題目說明、提示、字數要求），不用寫「幫我寫」；按「產生三個層級的範文」就會寫出三個層級的範文。',
  scoring_text: '題目欄只放題目本身，不要貼評分標準、配分、範文或佳作；本站用自己的評分規準。',
  exemplar_words_too_few: '範文模式的字數上限至少要 100 字：太短的題目，三個層級寫不出差別。',
  exemplar_words_too_many: '範文模式的字數下限最多 350 字：這裡的範文是照學測作文的長度設計的。',
} as const satisfies Record<CustomPromptProblem | ExemplarWordProblem, string>;

/** 範文模式專用的提醒（§5.1「防代寫的額外一條」）：只提醒、不拒收；Worker 不用它（系統提示本來就規定範文不用題目裡的個人資料）。 */
export const EXEMPLAR_PROMPT_WARNING_MESSAGES = {
  personal_intro: '範文不會用你的個人資料；請把題目裡的個人資料（姓名、學校、年齡）刪掉。',
} as const;
export type ExemplarPromptWarning = keyof typeof EXEMPLAR_PROMPT_WARNING_MESSAGES;

/**
 * 自我介紹的樣式：「我的名字是／叫」「我叫○○」「我今年 17 歲」「我就讀○○高中」「my name is」「I am 17 years old」「my school is」。
 * 「我叫醒弟弟」「我叫他們…」這類動詞用法不算（「我叫」後面只接 2–3 個漢字、再接標點或結尾才算）。
 */
const PERSONAL_INTRO_PATTERNS: readonly RegExp[] = [
  /我的名字(?:是|叫)/gu,
  /我叫(?![醒做了他她它你我們])\p{Script=Han}{2,3}(?=[，,。．.！!？?、\s]|$)/gu,
  /我(?:今年)?\d{1,2}\s*歲/gu,
  /我(?:就讀|讀|念)[^，,。\n]{0,12}?(?:高級中學|高中|國中)/gu,
  /\bmy\s+name\s+is\b/giu,
  /\bI(?:'m|’m|\s+am)\s+\d{1,2}\s+years?\s+old\b/giu,
  /\bmy\s+school\s+is\b/giu,
];

/** 題目與圖片描述裡的自我介紹（提醒的位置；UTF-16 索引 [start, end)）。傳入的應該是 checkCustomPrompt 正規化後的值。 */
export function exemplarPromptWarnings(value: { text: string; figure_text: string | null }): Array<{ field: 'text' | 'figure_text'; code: ExemplarPromptWarning; start: number; end: number }> {
  const out: Array<{ field: 'text' | 'figure_text'; code: ExemplarPromptWarning; start: number; end: number }> = [];
  for (const [field, text] of [
    ['text', value.text],
    ['figure_text', value.figure_text ?? ''],
  ] as const) {
    for (const re of PERSONAL_INTRO_PATTERNS) {
      for (const m of text.matchAll(re)) out.push({ field, code: 'personal_intro', start: m.index, end: m.index + m[0].length });
    }
  }
  return out.sort((a, b) => (a.field === b.field ? a.start - b.start : a.field === 'text' ? -1 : 1));
}

// ───────────────────────── 程式算的對照數字（§2.6） ─────────────────────────

/** 正文段至少幾個英文單詞（書信的稱呼與署名不算正文段，§3.5）。 */
export const EXEMPLAR_BODY_PARAGRAPH_MIN_WORDS = 8;

export interface ExemplarMetrics {
  /** 全文的英文單詞數（countEnglishWords，和批改的字數同一個規則）。 */
  words: number;
  /** 正文段數（≥ 8 個英文單詞的段落）。 */
  paragraphs: number;
  /** 正文的句數（以 . ! ? 後接空白或段尾切）。 */
  sentences: number;
  /** 平均句長（正文單詞 ÷ 句數，四捨五入到小數一位；沒有句子時 0）。 */
  avg_sentence_words: number;
  longest_sentence_words: number;
  /** 本站轉承詞清單比對的次數與種類數（約略值，connectives.ts）。 */
  connectives: number;
  connective_kinds: number;
  /** 逐段對照用的每個正文段字數。 */
  paragraph_words: number[];
}

/**
 * 段落的切法選項。photoMode：照片辨識的文字（學生作答的 input_mode 是 photo）只認空白行分段，段內的單一換行當成空白——
 * 手寫稿一行對應紙上的一行，不是一段（同 writing.ts 的 countParagraphs(text, true)，批改結果頁的段數也是這樣算）。
 * 範文與打字的作文不傳（預設 false）。
 */
export interface ExemplarTextOptions {
  photoMode?: boolean;
}

/**
 * 段落：有空白行時以空白行分段（學生自己的作文常見），否則每一個非空白的行算一段（範文的格式是「段落之間一個換行」）；
 * photoMode 時一律只認空白行（見 ExemplarTextOptions）。回傳每一段（去頭尾空白）。
 */
export function exemplarParagraphBlocks(text: string, opts: ExemplarTextOptions = {}): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (normalized === '') return [];
  const photo = opts.photoMode === true;
  const blocks = photo || /\n[ \t]*\n/.test(normalized) ? normalized.split(/\n[ \t]*\n+/) : normalized.split('\n');
  return blocks.map((b) => (photo ? b.replace(/[ \t]*\n[ \t]*/g, ' ') : b).trim()).filter((b) => b !== '');
}

/** 正文段（≥ 8 個英文單詞；書信的稱呼「Dear Tom,」與署名不算）。 */
export function exemplarBodyParagraphs(text: string, opts: ExemplarTextOptions = {}): string[] {
  return exemplarParagraphBlocks(text, opts).filter((b) => countEnglishWords(b) >= EXEMPLAR_BODY_PARAGRAPH_MIN_WORDS);
}

/** 一段裡的句子（以 . ! ? 加上可能的右引號、右括號，後接空白或段尾切開；沒有英文字的片段不算）。 */
function sentencesOf(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?]["'”’)\]]*)\s+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
}

/**
 * 對照表的數字（§2.6）：Worker 的後處理與前端的「你的作文」欄共用。前端的「你的作文」欄依作答的 input_mode 傳 photoMode
 * （照片辨識的文字只認空白行分段）；Worker 算範文時不傳。
 */
export function exemplarMetrics(text: string, opts: ExemplarTextOptions = {}): ExemplarMetrics {
  const body = exemplarBodyParagraphs(text, opts);
  const sentenceWords = body.flatMap((p) => sentencesOf(p).map((s) => countEnglishWords(s)));
  const bodyWords = sentenceWords.reduce((a, b) => a + b, 0);
  const connectives = countConnectives(body.join('\n'));
  return {
    words: countEnglishWords(text),
    paragraphs: body.length,
    sentences: sentenceWords.length,
    avg_sentence_words: sentenceWords.length === 0 ? 0 : Math.round((bodyWords / sentenceWords.length) * 10) / 10,
    longest_sentence_words: sentenceWords.length === 0 ? 0 : Math.max(...sentenceWords),
    connectives: connectives.count,
    connective_kinds: connectives.kinds,
    paragraph_words: body.map((p) => countEnglishWords(p)),
  };
}

// ───────────────────────── API 型別（§7.2） ─────────────────────────

/** POST /api/exemplars 的請求。fresh＝重新產生（不讀快取、8 點）。 */
export type CreateExemplarSetBody =
  | { source: 'site'; group_id: string; fresh?: boolean }
  | { source: 'custom'; prompt: CustomEssayPromptInput; allow_custom?: boolean; fresh?: boolean };

/** 一篇被隱藏的原因：D8 指紋、照抄學生貼的題目、內容過濾。 */
export const EXEMPLAR_HIDDEN_REASONS = ['d8', 'task_copy', 'filtered'] as const;
export type ExemplarHiddenReason = (typeof EXEMPLAR_HIDDEN_REASONS)[number];

/** 一篇被隱藏時顯示的固定說明（內容過濾擋下的用 Worker 的 FILTERED_PLACEHOLDER，§1.10）。 */
export const EXEMPLAR_HIDDEN_TEXT = {
  d8: '這一篇含有和官方文件相同的文字，已隱藏。',
  task_copy: '這一篇和你貼的題目文字重複太多，已隱藏。',
} as const satisfies Partial<Record<ExemplarHiddenReason, string>>;
/** 說明欄位（_zh）命中 D8 時換上的固定說明。 */
export const EXEMPLAR_NOTE_HIDDEN_TEXT = '這段說明含有和官方文件相同的文字，已隱藏。';
/** 說明欄位（_zh）照抄學生貼的題目（自訂題）時換上的固定說明。 */
export const EXEMPLAR_NOTE_TASK_COPY_TEXT = '這段說明和你貼的題目文字重複太多，已隱藏。';

/** 一篇範文（程式後處理之後給畫面的形狀）。 */
export interface ExemplarEssayView {
  level: ExemplarLevel;
  /** 被隱藏時 null。 */
  text: string | null;
  hidden: ExemplarHiddenReason | null;
  /** paragraphs：題目或學生有規定時的數字。 */
  targets: { words: [number, number]; paragraphs: number | null };
  metrics: ExemplarMetrics;
  /** 四項為什麼是這個分數（_zh）。 */
  criteria: Record<EssayCriterion, string>;
  /** 亮點（kind、text、zh；不用 function 欄位）。 */
  highlights: ModelTextNote[];
  /** 升到下一級（頂標版是「在考場上怎麼用」）。 */
  next_zh: string;
}

/** 一組範文（exemplar_sets.output_json）。 */
export interface ExemplarSetView {
  task_reading_zh: string;
  plan_zh: string;
  /** 依序是 basic、steady、top。 */
  essays: [ExemplarEssayView, ExemplarEssayView, ExemplarEssayView];
  /** 基礎版常見的錯（範文裡沒有）。 */
  typical_errors: Array<{ wrong: string; right: string; zh: string }>;
  safety_flag: string | null;
}

export const EXEMPLAR_SET_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type ExemplarSetStatus = (typeof EXEMPLAR_SET_STATUSES)[number];

/** 我的範文的一列。 */
export interface ExemplarSetSummary {
  id: string;
  source: ExemplarSource;
  group_id: string | null;
  title: string;
  status: ExemplarSetStatus;
  /** 共用快取命中（0 點）。 */
  cache_hit: boolean;
  /** Unix 秒。 */
  created_at: number;
  updated_at: number;
}

/** GET /api/exemplars/:id */
export interface ExemplarSetDetail extends ExemplarSetSummary {
  /** 自訂題（D8 重查命中時 hidden）；網站題目 null。 */
  prompt: CustomEssayPrompt | null;
  view: ExemplarSetView | null;
  failure: AiRefundReason | null;
  /** 自訂題不是英文寫作題目（invalid_output 退還）。 */
  not_writing_task?: boolean;
  /**
   * 這個操作的身心安全旗標（只有類別；沒有時不帶）。退還的組（例如不是寫作題）沒有 view，畫面靠它顯示求助資源；
   * 完成的組和 view.safety_flag 相同。
   */
  safety_flag?: string;
  rating: 'helpful' | 'wrong' | null;
  /** 去重回的是之前那一組。 */
  existing?: boolean;
  /** Unix 秒。 */
  expires_at: number;
}

/** GET /api/exemplars?cursor= */
export interface ExemplarSetListResponse {
  sets: ExemplarSetSummary[];
  next_cursor: string | null;
}

/** GET /api/exemplars/site-status?group_id= */
export interface ExemplarSiteStatus {
  group_id: string;
  title: string;
  cached: boolean;
  points: number;
}
