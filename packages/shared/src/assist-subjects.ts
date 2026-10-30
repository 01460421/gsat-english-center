/**
 * 學習助手的科目設定檔（docs/design/assistant-subjects.md §2.2）：英文是第一筆，國文是第二筆。只有資料與純函式，前後端共用。
 *
 * 設定檔帶：回答格式與解析種類的對照、計點單位與題數上限、點數、開關名稱、題目文字的 lang、進不進學習報告、呈現需求。
 * 題型、代碼、解法步驟、欄位上限與輸入規則在各科自己的模組（國文是 assist-zh.ts）；英文沿用 assist.ts、assist-codes.ts，
 * 這裡只加一層轉接，數字一個都不改（英文的點數與題數和現行完全相同，§2.4）。
 *
 * 拍照能不能用不放在這裡：由 Worker 依開關算，經 /api/features 與 /api/me 回給前端（§7.5）。
 */
import { assistAnalyzePoints, ASSIST_LIMITS, type AssistCaseKind, type AssistQuestionView } from './assist';
import { ZH_TARGET_LIMITS, zhScriptCount, zhShortPartLabels, type ZhCaseKind } from './assist-zh';
import { ASSIST_SWITCHED_SUBJECTS } from './features';
import { AI_TASK_POINTS } from './writing';

/** 學習助手的科目（之後加 'social'、'math'、'science'：在 features.ts 的 ASSIST_SWITCHED_SUBJECTS 加一筆）。 */
export const ASSIST_SUBJECTS = ['english', ...ASSIST_SWITCHED_SUBJECTS] as const;
export type AssistSubject = (typeof ASSIST_SUBJECTS)[number];

export function isAssistSubject(value: unknown): value is AssistSubject {
  return typeof value === 'string' && (ASSIST_SUBJECTS as readonly string[]).includes(value);
}

export const ASSIST_SUBJECT_LABELS: Record<AssistSubject, string> = { english: '英文', chinese: '國文' };

/** 案例的科目：ref_json.subject（JSON 字串或已解析的物件）；沒有這個鍵、或不是認得的科目，就是英文（§7.1）。 */
export function assistSubjectFromRef(ref: unknown): AssistSubject {
  let value: unknown = ref;
  if (typeof ref === 'string') {
    try {
      value = JSON.parse(ref);
    } catch {
      return 'english';
    }
  }
  const subject = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['subject'] : undefined;
  return isAssistSubject(subject) ? subject : 'english';
}

/** 一種回答格式（＝一份輸出 schema）。 */
export interface AssistFormatSpec {
  kind: AssistCaseKind;
  /** 計點與 max_tokens 的單位：題數、小題數，或固定 1。 */
  itemUnit: 'question' | 'part' | 'one';
  /** 一個案例最多幾個單位。 */
  maxItems: number;
  /** 解析的點數（items 是 itemUnit 的個數；超出範圍的值夾回 1–maxItems）。 */
  analyzePoints(items: number): number;
}

/** 前端依它載入的呈現能力（數學、自然之後才用到 math、chem）。 */
export type AssistRenderNeed = 'bopomofo' | 'underline_marks' | 'serif_classical' | 'math' | 'chem';

export interface AssistSubjectProfile {
  id: AssistSubject;
  label: string;
  /** 題目文字的 lang（國文不加 lang="en"；§8.3）。 */
  lang: 'en' | 'zh-Hant';
  /** 總開關與拍照開關（Worker 讀值；§7.5）。 */
  switchName: 'AI_ASSISTANT' | 'AI_ASSISTANT_SUBJECTS';
  photoSwitchName: 'AI_ASSISTANT_PHOTO' | 'AI_ASSISTANT_SUBJECTS_PHOTO';
  /** 列入開放清單（開關另外決定對誰開）。 */
  ready: boolean;
  /** 格式名稱 → 格式（英文：item／writing／vocab；國文：choice／short／writing）。 */
  formats: Readonly<Record<string, AssistFormatSpec>>;
  ocrPoints(photos: 1 | 2): number;
  followupPoints: number;
  /** 國寫範文的點數（只有國文；國寫範文設計 §6）；沒有這個功能的科目是 null。 */
  exemplarPoints: number | null;
  /** 進不進學習報告（第一版只有英文；§7.4）。 */
  inReport: boolean;
  render: readonly AssistRenderNeed[];
}

function clampItems(items: number, max: number): number {
  return Number.isFinite(items) ? Math.min(max, Math.max(1, Math.floor(items))) : 1;
}

/**
 * 科目設定檔。英文的點數與上限直接引用現行的常數與函式（assistAnalyzePoints、AI_TASK_POINTS、ASSIST_LIMITS）。
 * 國文的點數是設計值（§9.2）：轉錄 1 張 3、2 張 4；選擇 6 起每多一題 +2（最多 4 題＝12）；簡答 6 起每多一個小題 +1
 * （最多 6 個小題、上限 10）；國寫 7；追問 3。不變式：拍 1 張＋單題解析 ≤ 10 點（試用帳號每天 10 點也做得完一題）。
 */
export const ASSIST_SUBJECT_PROFILES: Readonly<Record<AssistSubject, AssistSubjectProfile>> = {
  english: {
    id: 'english',
    label: '英文',
    lang: 'en',
    switchName: 'AI_ASSISTANT',
    photoSwitchName: 'AI_ASSISTANT_PHOTO',
    ready: true,
    formats: {
      item: { kind: 'item', itemUnit: 'question', maxItems: ASSIST_LIMITS.groupLabelsMax.word_bank, analyzePoints: (n) => assistAnalyzePoints('item', n) },
      writing: { kind: 'writing', itemUnit: 'one', maxItems: 1, analyzePoints: (n) => assistAnalyzePoints('writing', n) },
      vocab: { kind: 'vocab', itemUnit: 'one', maxItems: 1, analyzePoints: (n) => assistAnalyzePoints('vocab', n) },
    },
    ocrPoints: () => AI_TASK_POINTS.assist_ocr,
    followupPoints: AI_TASK_POINTS.assist_followup,
    exemplarPoints: null,
    inReport: true,
    render: [],
  },
  chinese: {
    id: 'chinese',
    label: '國文',
    lang: 'zh-Hant',
    switchName: 'AI_ASSISTANT_SUBJECTS',
    photoSwitchName: 'AI_ASSISTANT_SUBJECTS_PHOTO',
    ready: true,
    formats: {
      choice: { kind: 'zh_choice', itemUnit: 'question', maxItems: ZH_TARGET_LIMITS.choice, analyzePoints: (n) => 6 + 2 * (clampItems(n, ZH_TARGET_LIMITS.choice) - 1) },
      short: { kind: 'zh_short', itemUnit: 'part', maxItems: ZH_TARGET_LIMITS.shortParts, analyzePoints: (n) => Math.min(10, 6 + (clampItems(n, ZH_TARGET_LIMITS.shortParts) - 1)) },
      writing: { kind: 'zh_writing', itemUnit: 'one', maxItems: ZH_TARGET_LIMITS.writing, analyzePoints: () => 7 },
    },
    ocrPoints: (photos) => (photos === 2 ? 4 : 3),
    followupPoints: 3,
    exemplarPoints: AI_TASK_POINTS.assist_zh_exemplar,
    inReport: false,
    render: ['bopomofo', 'underline_marks', 'serif_classical'],
  },
};

/** 這一科的這種解析種類對到哪一個格式；不認得回 null。 */
export function assistFormatSpec(subject: AssistSubject, kind: AssistCaseKind): AssistFormatSpec | null {
  return Object.values(ASSIST_SUBJECT_PROFILES[subject].formats).find((f) => f.kind === kind) ?? null;
}

/** 這一科的預設格式（沒指定 kind 時用：英文 item、國文選擇題）。 */
function defaultFormat(subject: AssistSubject): AssistFormatSpec {
  return Object.values(ASSIST_SUBJECT_PROFILES[subject].formats)[0]!;
}

/**
 * 學習助手任務的點數（前端的點數顯示、Worker 的預扣與任務設定共用同一份；§9）。英文的回傳值和現行完全相同：
 * 轉錄 AI_TASK_POINTS.assist_ocr、解析 assistAnalyzePoints(kind, items)、追問 AI_TASK_POINTS.assist_followup。
 * size.kind 不是這一科的種類時用這一科的預設格式。
 */
export function assistPoints(
  subject: AssistSubject,
  task: 'assist_ocr' | 'assist_analyze' | 'assist_followup',
  size?: { kind?: AssistCaseKind; items?: number; photos?: 1 | 2 },
): number {
  const profile = ASSIST_SUBJECT_PROFILES[subject];
  if (task === 'assist_ocr') return profile.ocrPoints(size?.photos === 2 ? 2 : 1);
  if (task === 'assist_followup') return profile.followupPoints;
  const spec = (size?.kind !== undefined ? assistFormatSpec(subject, size.kind) : null) ?? defaultFormat(subject);
  return spec.analyzePoints(size?.items ?? 1);
}

/**
 * 題目的計點單位數（前端的點數顯示、routes 的預扣、consumer 的任務設定都用這一支；§2.3）。
 * 英文：item 是題數（至少 1），其他是 1（和現行 routes.ts 的寫法相同）。
 * 國文：zh_choice 是題數、zh_short 是小題數（只寫題號時展開成那一題的小題）、zh_writing 是 1。
 */
export function assistItemCount(subject: AssistSubject, kind: AssistCaseKind, question: Pick<AssistQuestionView, 'targets' | 'blocks'>): number {
  const targets = question.targets.map((t) => t.label);
  if (subject === 'english' || !isChineseKind(kind)) return kind === 'item' ? Math.max(1, question.targets.length) : 1;
  if (kind === 'zh_writing') return 1;
  if (kind === 'zh_short') return Math.max(1, zhShortPartLabels(question.blocks ?? [], targets).length);
  return Math.max(1, targets.length);
}

function isChineseKind(kind: AssistCaseKind): kind is ZhCaseKind {
  return kind === 'zh_choice' || kind === 'zh_short' || kind === 'zh_writing';
}

// ───────────────────────── 科目偵測（§2.5：學生選，程式只建議） ─────────────────────────

/** 程式或模型判斷的科目（含還沒開放的科目與「其他」）。 */
export const ASSIST_DETECTED_SUBJECTS = ['english', 'chinese', 'math', 'social', 'science', 'other'] as const;
export type AssistDetectedSubject = (typeof ASSIST_DETECTED_SUBJECTS)[number];

export const ASSIST_DETECTED_SUBJECT_LABELS: Record<AssistDetectedSubject, string> = {
  english: '英文',
  chinese: '國文',
  math: '數學',
  social: '社會科',
  science: '自然科',
  other: '其他',
};

/** 社會科的特徵詞（只用來提醒，不擋送出）。 */
const SOCIAL_WORDS = [
  '憲法', '立法院', '國會', '選舉', '民主', '政府', '政黨', '人權', '經濟', '供給', '需求', '供給曲線', '需求曲線', '市場', '通貨膨脹',
  '匯率', '國內生產毛額', '機會成本', '朝代', '王朝', '殖民', '帝國', '革命', '條約', '戰爭', '經緯度', '經度', '緯度', '等高線', '季風',
  '氣候', '地形', '人口', '都市化', '全球化',
] as const;
/** 自然科的特徵詞。 */
const SCIENCE_WORDS = [
  '莫耳', '細胞', '加速度', '化學式', '原子', '分子', '電子', '質子', '中子', '離子', '化合物', '反應式', '速度', '能量', '動能',
  '位能', '電流', '電壓', '電阻', '磁場', '波長', '頻率', '光合作用', '基因', '染色體', '酵素', '演化', '生態系', '地震波', '板塊',
  '星系', '溶液', '濃度', '酸鹼',
] as const;
/** 國文的特徵詞（文言虛詞、修辭、字音字形、題型用語）：出現 2 個以上就不建議社會或自然。 */
const CHINESE_WORDS = [
  '讀音', '注音', '錯別字', '字形', '字義', '成語', '修辭', '譬喻', '誇飾', '文言', '語譯', '白話', '詩句', '詞語', '作答字數', '文長',
  '國寫', '題辭', '注釋', '文意', '意義前後', '「」內', '曰', '矣', '焉', '哉', '兮', '乎',
] as const;

function countDistinct(text: string, words: readonly string[]): number {
  return words.filter((w) => text.includes(w)).length;
}

/**
 * 貼上的題目像哪一科（前端送出前的建議，純函式；§2.5）：
 *   英文單詞 ≥ 15 而且拉丁字母占可見字元 ≥ 50% → 英文（high）；
 *   數字與運算符號占 ≥ 30%，或有 \frac、√、∫ → 數學（high）；
 *   社會、自然的特徵詞 ≥ 3 個而且國文的特徵詞 < 2 → 社會或自然（low，多的那一科）；
 *   漢字（含注音字元）≥ 30、占可見字元 ≥ 50%，而且英文單詞 < 15 → 國文（high）；其他 low。
 */
export function detectAssistSubject(text: string): { subject: AssistDetectedSubject; confidence: 'high' | 'low' } {
  const visible = text.replace(/\s/gu, '');
  const n = [...visible].length;
  if (n === 0) return { subject: 'other', confidence: 'low' };
  const englishWords = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)?.length ?? 0;
  const latin = visible.match(/[A-Za-z]/g)?.length ?? 0;
  // 注音字元也算國文的字（選項印注音的字音題常不到 30 個漢字；checkZhQuestion 用同一個算法）。
  const han = zhScriptCount(visible);
  if (englishWords >= 15 && latin / n >= 0.5) return { subject: 'english', confidence: 'high' };
  const mathy = visible.match(/[0-9+\-×÷*/=<>≤≥^√∫∑π]/gu)?.length ?? 0;
  if (/\\frac|√|∫/.test(text) || mathy / n >= 0.3) return { subject: 'math', confidence: 'high' };
  const social = countDistinct(text, SOCIAL_WORDS);
  const science = countDistinct(text, SCIENCE_WORDS);
  if (social + science >= 3 && countDistinct(text, CHINESE_WORDS) < 2) return { subject: science > social ? 'science' : 'social', confidence: 'low' };
  if (han >= 30 && han / n >= 0.5 && englishWords < 15) return { subject: 'chinese', confidence: 'high' };
  if (latin > han) return { subject: 'english', confidence: 'low' };
  if (han > 0) return { subject: 'chinese', confidence: 'low' };
  return { subject: 'other', confidence: 'low' };
}

/** 「目前只開放英文、國文」：開放的科目（依 ASSIST_SUBJECTS 的順序）。 */
function openSubjectsText(open: readonly AssistSubject[]): string {
  return ASSIST_SUBJECTS.filter((s) => open.includes(s)).map((s) => ASSIST_SUBJECT_LABELS[s]).join('、');
}

/**
 * 科目不符時畫面的一句話（§1.3、§1.4、§2.5、§8.2）：
 *   input   貼上時的建議（不擋送出）：「這看起來是社會科題目；學習助手目前只開放英文、國文。」
 *   analyze 解析時判定不符而退還：「這題看起來是社會科；學習助手目前只開放英文、國文。這次的點數已經退還。」
 *   ocr     轉錄判定不符（退點、刪照片）：英文寫「這張看起來是英文題目，請把科目改成『英文』再拍一次」。
 * 偵測到的是已開放的科目時，請學生改選那一科。
 */
export function assistSubjectMismatchText(detected: AssistDetectedSubject, stage: 'input' | 'analyze' | 'ocr', open: readonly AssistSubject[] = ASSIST_SUBJECTS): string {
  const label = ASSIST_DETECTED_SUBJECT_LABELS[detected];
  const openText = openSubjectsText(open);
  const isOpen = isAssistSubject(detected) && open.includes(detected);
  const what = stage === 'ocr' ? '這張' : stage === 'analyze' ? '這題' : '這';
  const subjectWord = stage === 'analyze' ? label : `${label}題目`;
  if (isOpen) {
    const action = stage === 'ocr' ? `請把科目改成「${label}」再拍一次。` : `請把科目改成「${label}」。`;
    return `${what}看起來是${subjectWord}，${action}${stage === 'analyze' ? '這次的點數已經退還。' : ''}`;
  }
  const head = detected === 'other' ? `${what}看起來不是學科題目` : `${what}看起來是${subjectWord}`;
  return `${head}；學習助手目前只開放${openText}。${stage === 'analyze' ? '這次的點數已經退還。' : ''}`;
}
