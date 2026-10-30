/**
 * 學習助手的國寫範文（國寫範文設計 docs/design/assistant-subjects.md「國寫範文」；以下 §x 指那份設計）：已經解析過的國寫案例
 * 上的「看一篇 AI 示範」。這裡放前端與 Worker 共用的部分：
 *
 *   畫面形狀       ZhExemplarView（turn 的 output_json；Worker 的後處理產生、前端顯示）、固定標籤與固定說明。
 *   方法卡 id      zhMethodCardId：模型寫的 card 欄（id 或卡名）對回 ZH_WRITING_METHOD_IDS；不認得回 null。
 *   字數與格數     zhExemplarLimits（依題目的字數規定，沒有就用預設：知性問題（一）80、問題（二）400；情意用格數）、
 *                  zhSheetCells（答題卷一面 38 行 × 22 格；每段首兩格、段末空格算進該行）。
 *   避用清單       比賽常見的套語（只有名句本身，不是任何作品的文字）、競賽詞彙、高頻人物，以及通用套語的例子：
 *                  系統提示與後處理用同一份（§4）。
 *
 * 撰寫規則同 assist-methods-zh.ts：用本站自己的話寫，不轉載任何比賽作品或講評的文句；考試機構一律寫「官方」；
 * 示範一律標「AI 示範，不是得獎作品」，不寫「仿某年第一名」。
 */
import type { AssistQuoteRange, AssistSafetyFlag, AssistQuestionView } from './assist';
import { ZH_CLICHE_PATTERNS, ZH_DRAFT_LENGTH_NOTE, ZH_WRITING_METHOD_IDS, type ZhWritingMethodId } from './assist-methods-zh';
import { ZH_LINE_CELLS, countZhChars, zhCharLimits, type ZhCharCount, type ZhCharLimit, type ZhNotice } from './assist-zh';

// ───────────────────────── 固定文字 ─────────────────────────

/** 範文頁首的固定標籤（逐字；前端與測試都比對這一份）。 */
export const ZH_EXEMPLAR_LABEL = 'AI 示範，不是得獎作品';
/** 段落拿掉句子後少於 15 字時，整段換成這句（§5.1 最後一段）。 */
export const ZH_EXEMPLAR_TRIMMED_TEXT = '這一段不符合本站的示範規則，已省略。';
/** 和比賽語料有一長串文字相同、重寫後仍然相同的段落（§5.3）。 */
export const ZH_EXEMPLAR_OVERLAP_TEXT = '這一段和已發表的文章有一長串文字相同，已隱藏。';
/** D8 命中的段落（§5.5）。 */
export const ZH_EXEMPLAR_D8_TEXT = '這一段和受保護的官方文字太像，已隱藏。';
/** 說明欄位（這篇怎麼寫）命中比賽語料時換上這句（§5.1 第 6 步）。 */
export const ZH_EXEMPLAR_NOTE_HIDDEN_TEXT = '這則說明和已發表的文章有一段文字相同，已省略。';
/** 段落拿掉句子後的下限（字，含標點）。 */
export const ZH_EXEMPLAR_PARAGRAPH_MIN_CHARS = 15;

// ───────────────────────── 畫面形狀（§3.2） ─────────────────────────

export type ZhExemplarSection = 'zh_writing_reason' | 'zh_writing_emotion';

/** 一段示範：本文、隱藏的原因（比賽語料或 D8；隱藏時 text 是固定說明）、段落作用、方法卡、這段怎麼用那張卡。 */
export interface ZhExemplarParagraph {
  text: string;
  hidden: 'contest' | 'd8' | null;
  role_zh: string;
  card: ZhWritingMethodId | null;
  technique_zh: string;
}

/** 國寫範文的畫面形狀（turn 的 output_json）。沒有任何等第或分數欄位。 */
export interface ZhExemplarView {
  kind: 'zh_exemplar';
  section: ZhExemplarSection;
  /** 題目：題目指定時就是指定的題目；題目自訂時是 AI 擬的；沒有題目時是空字串。 */
  title_zh: string;
  /**
   * 知性題的問題（一）（情意題是 null）。hidden：答案被隱藏的原因（比賽語料、D8、重寫後仍超過字數）；隱藏時 answer_zh 是空字串、
   * count 是 0，畫面依 hidden 顯示固定說明。
   */
  q1: {
    answer_zh: string;
    count: ZhCharCount;
    limit: number;
    quotes: Array<{ quote: string; range: AssistQuoteRange | null }>;
    hidden: 'contest' | 'd8' | 'over_limit' | null;
  } | null;
  /** 知性＝問題（二）的段落；情意＝全文。 */
  paragraphs: ZhExemplarParagraph[];
  /** 段落（不含問題（一））的字數、漢字數、格數，以及題目的上限（limit_chars 沒有規定是 null；limit_cells 是這部分能用的格數）。 */
  totals: { chars: number; han: number; cells: number; limit_chars: number | null; limit_cells: number };
  /** 這篇怎麼寫（2–4 則）。 */
  notes: Array<{ card: ZhWritingMethodId | null; text_zh: string }>;
  /** 要件對照：要件 → 第幾段（0＝問題（一））與那一段裡的一句。 */
  coverage: Array<{ point_zh: string; paragraph: number; quote: string }>;
  self_check_zh: string[];
  notices: ZhNotice[];
  off_topic: boolean;
  safety_flag: AssistSafetyFlag;
}

// ───────────────────────── 方法卡 id ─────────────────────────

/** 方法卡的 id 與卡名（模型可能寫 id，也可能寫卡名）→ id。方法卡改了 id 只要改這張表（測試斷言值等於 ZH_WRITING_METHOD_IDS）。 */
export const ZH_METHOD_CARD_ALIASES: Readonly<Record<string, ZhWritingMethodId>> = {
  task: 'task',
  審題: 'task',
  thesis: 'thesis',
  立意: 'thesis',
  material: 'material',
  取材: 'material',
  structure: 'structure',
  結構: 'structure',
  style: 'style',
  修辭: 'style',
};

/**
 * 模型寫的 card 欄 → 方法卡 id：接受 id（大小寫不拘）、卡名（「審題」「審題卡」「審題：圈出關鍵詞…」）；不認得回 null
 * （畫面不顯示卡片 chip，後處理計數 card_unknown）。
 */
export function zhMethodCardId(raw: string): ZhWritingMethodId | null {
  const s = raw.trim().toLowerCase();
  if (s === '') return null;
  const direct = ZH_METHOD_CARD_ALIASES[s];
  if (direct) return direct;
  const word = /^[a-z]+/u.exec(s)?.[0];
  if (word && ZH_METHOD_CARD_ALIASES[word]) return ZH_METHOD_CARD_ALIASES[word]!;
  const han = [...s].filter((ch) => /\p{Script=Han}/u.test(ch)).slice(0, 2).join('');
  return ZH_METHOD_CARD_ALIASES[han] ?? null;
}

// ───────────────────────── 字數與格數（§5.2） ─────────────────────────

/** 答案卷一面的格數（38 行 × 22 格）。 */
export const ZH_SHEET_CELLS = ZH_DRAFT_LENGTH_NOTE.sheetCells;
/** 題目沒寫時的預設上限（字，含標點）：知性問題（一）80、問題（二）400。 */
export const ZH_EXEMPLAR_DEFAULT_LIMITS = { q1Chars: 80, q2Chars: 400 } as const;
/**
 * 目標（給提示與「少於目標」的計數）：知性每一部分是上限的 85–95%（問題（一）80–95%）；情意含標點約 670–760 字
 * （漢字 600–680；比賽語料每個漢字約 1.18 格，以漢字算的「約 750 字」會超過一面）。
 */
export const ZH_EXEMPLAR_TARGETS = { q1: [0.8, 0.95], q2: [0.85, 0.95], emotionChars: [670, 760], emotionHan: [600, 680] } as const;
/** 最後一次仍超過上限、但超過不到這個比例時照樣顯示並加提醒；超過更多就退還（§5.2）。 */
export const ZH_EXEMPLAR_OVER_TOLERANCE = 0.1;

/** 一段（或幾段）寫在答題卷上要幾格：每段首兩格，段末不滿一行也算一整行。 */
export function zhSheetCells(paragraphs: readonly string[]): number {
  return paragraphs.reduce((sum, p) => sum + Math.ceil((2 + countZhChars(p).chars) / ZH_LINE_CELLS) * ZH_LINE_CELLS, 0);
}

export interface ZhExemplarLimits {
  section: ZhExemplarSection;
  /** 知性題的問題（一）：硬限制（字，含標點）；情意題是 null。 */
  q1: { maxChars: number } | null;
  /** 問題（二）或情意全文：字數上限（沒有規定是 null）、格數上限、題目原本寫的行數（「至多 N 行」；沒有是 null）。 */
  body: { maxChars: number | null; maxCells: number; lines: number | null };
  /** 問題（一）＋（二）或全文合計的格數上限（一面）。 */
  sheetCells: number;
  /** 目標範圍（字，含標點；給提示與計數）。 */
  target: { q1: [number, number] | null; body: [number, number] };
}

/**
 * 這一題的範文上限（§5.2 的表）：依 zhCharLimits 讀題目的「問題（一）（二）」字數與「至多 N 行」；沒有規定時用預設值。
 * 知性：問題（一）預設 80、問題（二）預設 400，寫了行數另外限制格數，兩部分合計不超過一面。情意：一面 836 格，題目另有字數或行數
 * 規定時一併限制。
 */
export function zhExemplarLimits(question: Pick<AssistQuestionView, 'blocks'>, section: ZhExemplarSection): ZhExemplarLimits {
  const limits = zhCharLimits((question.blocks ?? []).map((b) => b.text).join('\n'));
  const of = (part: string | null) => limits.find((l) => l.part === part && l.max !== null) ?? null;
  // zhCharLimits 把只有「至多 N 行」的規定換算成 N×22 字；那不是字數規定，字數照預設（或沒有），行數另外限制格數。
  const charsOf = (l: ZhCharLimit | null) => (l && l.max !== null && !(l.lines !== null && l.max === l.lines * ZH_LINE_CELLS) ? l.max : null);
  const cellsOf = (lines: number | null) => Math.min(ZH_SHEET_CELLS, lines !== null ? lines * ZH_LINE_CELLS : ZH_SHEET_CELLS);
  const pct = (max: number, [lo, hi]: readonly [number, number]): [number, number] => [Math.floor(max * lo), Math.floor(max * hi)];
  if (section === 'zh_writing_reason') {
    const q1 = charsOf(of('(一)')) ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q1Chars;
    const q2 = of('(二)') ?? of(null);
    const lines = q2?.lines ?? null;
    const maxChars = charsOf(q2) ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q2Chars;
    return {
      section,
      q1: { maxChars: q1 },
      body: { maxChars, maxCells: cellsOf(lines), lines },
      sheetCells: ZH_SHEET_CELLS,
      target: { q1: pct(q1, ZH_EXEMPLAR_TARGETS.q1), body: pct(maxChars, ZH_EXEMPLAR_TARGETS.q2) },
    };
  }
  const own = of(null) ?? of('(二)');
  const lines = own?.lines ?? null;
  const maxChars = charsOf(own);
  return {
    section,
    q1: null,
    body: { maxChars, maxCells: cellsOf(lines), lines },
    sheetCells: ZH_SHEET_CELLS,
    target: { q1: null, body: maxChars !== null ? pct(maxChars, ZH_EXEMPLAR_TARGETS.q2) : [...ZH_EXEMPLAR_TARGETS.emotionChars] },
  };
}

// ───────────────────────── 避用清單（§4；提示與後處理用同一份） ─────────────────────────

/**
 * 比賽作文裡跨年重複出現的套語（名句、典故與它們的固定用法；都是公開的名句，不是任何作品的文字）。後處理拿掉含有它們的句子
 * （題目本身引用的除外）。label 給系統提示用。
 */
export const ZH_CONTEST_STOCK_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '也無風雨也無晴', re: /也無風雨也無晴/u },
  { label: '扶搖九萬里／莫之夭閼', re: /扶搖(?:直上)?九萬里|莫之夭閼/u },
  { label: '「親吻著無限」那一句', re: /親吻著?無限/u },
  { label: '王國維「人生三境界」', re: /王國維[^。！？\n]{0,20}境界|(?:人生|治學|為學)的?三(?:種|個)?境界/u },
  { label: '心凝形釋／萬化冥合', re: /心凝形釋|萬化冥合/u },
  { label: '沒有人是一座孤島', re: /沒有人(?:是)?一座孤島/u },
  { label: '安得廣廈千萬間', re: /安得廣廈/u },
  { label: '上帝給你一方荒野', re: /一方荒野/u },
  { label: '馬拉拉的「一枝筆」', re: /馬拉拉[^。！？\n]{0,30}[一1][枝支]筆|[一1][枝支]筆[^。！？\n]{0,30}馬拉拉/u },
];

/** 比賽常見的生僻文藝詞（後處理只計數；系統提示要求不用）。 */
export const ZH_CONTEST_WORDS: readonly string[] = ['蒼穹', '寰宇', '廣袤', '熠熠', '囹圄', '桎梏', '逡巡', '彳亍', '趑趄', '跫音', '闃', '敻', '躓踣', '氤氳', '迤邐'];

/** 高頻事例的人物（題目沒提到時只計數；系統提示要求不用，除非素材提到）。 */
export const ZH_OVERUSED_FIGURES: readonly string[] = ['蘇軾', '東坡', '陶淵明', '孔子', '泰戈爾', '杜甫', '馬拉拉', '屈原'];

/**
 * 通用套語的例子（給系統提示用；比對用 assist-methods-zh.ts 的 ZH_CLICHE_PATTERNS，測試斷言每一個例子都會被它抓到）。
 */
export const ZH_CLICHE_EXAMPLES: readonly string[] = [
  '隨著時代的進步',
  '在這個瞬息萬變的時代',
  '光陰似箭',
  '人生就像一場',
  '俗話說得好',
  '古人云',
  '失敗為成功之母',
  '讓我受益良多',
  '我深深體會到',
  '讓我們一起努力',
  '綜上所述',
];

/** 這段文字裡的通用套語個數（ZH_CLICHE_PATTERNS，每個樣式算一次）。 */
export function zhClicheCount(text: string): number {
  return ZH_CLICHE_PATTERNS.filter((re) => text.search(re) >= 0).length;
}

/** 方法卡 id 的清單（給測試與提示；同 ZH_WRITING_METHOD_IDS）。 */
export const ZH_EXEMPLAR_CARD_IDS: readonly ZhWritingMethodId[] = ZH_WRITING_METHOD_IDS;
