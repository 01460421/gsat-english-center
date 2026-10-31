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

/**
 * 一段示範：本文、隱藏的原因、段落作用、方法卡、這段怎麼用那張卡。隱藏時 text 是固定說明：contest＝和比賽語料相同、
 * d8＝和受保護的官方文字太像、trimmed＝拿掉不合規則的句子後太短（ZH_EXEMPLAR_TRIMMED_TEXT）、filtered＝內容過濾擋下。
 */
export interface ZhExemplarParagraph {
  text: string;
  hidden: 'contest' | 'd8' | 'trimmed' | 'filtered' | null;
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
  /**
   * 段落（不含問題（一））的字數、漢字數、格數，以及上限（limit_chars 沒有規定是 null；limit_cells 是這部分能用的格數）。
   * limit_chars_from_question：字數上限是題目寫的（false＝題目沒寫，知性問題（二）用本站預設的 400 字）。
   */
  totals: { chars: number; han: number; cells: number; limit_chars: number | null; limit_chars_from_question: boolean; limit_cells: number };
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
  /**
   * 問題（二）或情意全文：字數上限（沒有規定是 null）、字數上限是不是題目寫的（false＝本站預設）、格數上限、
   * 題目原本寫的行數（「至多 N 行」；沒有是 null）。
   */
  body: { maxChars: number | null; charsFromQuestion: boolean; maxCells: number; lines: number | null };
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
    const given = charsOf(q2);
    const maxChars = given ?? ZH_EXEMPLAR_DEFAULT_LIMITS.q2Chars;
    return {
      section,
      q1: { maxChars: q1 },
      body: { maxChars, charsFromQuestion: given !== null, maxCells: cellsOf(lines), lines },
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
    body: { maxChars, charsFromQuestion: maxChars !== null, maxCells: cellsOf(lines), lines },
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

/**
 * 敏感事件的字（情意的示範要用日常、可信的高中生經驗，提示禁止疾病、死亡、自傷、家暴、戀愛；§4）。Worker 的後處理只計數
 * （sensitive_event）並寫 ops 事件給開發者抽查，不拿掉文字；評測的 K 組用同一份。
 */
export const ZH_EXEMPLAR_SENSITIVE_RE = /醫院|病房|住院|過世|去世|病逝|離世|喪禮|葬禮|告別式|靈堂|癌症|自殺|自殘|輕生|割腕|家暴|戀愛|男朋友|女朋友|告白|暗戀/u;

/** 含敏感事件用字的句子數（以。！？切句）。 */
export function zhSensitiveSentences(texts: readonly string[]): number {
  return texts.flatMap((text) => text.split(/(?<=[。！？])/u)).filter((s) => ZH_EXEMPLAR_SENSITIVE_RE.test(s)).length;
}

/** 方法卡 id 的清單（給測試與提示；同 ZH_WRITING_METHOD_IDS）。 */
export const ZH_EXEMPLAR_CARD_IDS: readonly ZhWritingMethodId[] = ZH_WRITING_METHOD_IDS;

// ───────────────────────── 句子與引號對話（站主 2026-10-31：「不能有引號對話，你在寫文章不是小說」） ─────────────────────────

const SENTENCE_QUOTE_OPEN = new Set(['「', '『', '“', '‘']);
const SENTENCE_QUOTE_CLOSE = new Set(['」', '』', '”', '’']);

/**
 * 說話的動詞（引號對話的標記）。「說明、說服、說法、說穿、說完」「問題、問卷」「答案、答應」「叫做」「唸書」不是說話。
 * 不收單獨的「道」（知道、道路）：「說道、問道、笑道、嘆道、喊道」由前面的字涵蓋。
 */
const SPEECH_VERB =
  '(?:說(?![明服法穿完謊教])|問(?![題卷])|答(?![案應])|回答|回應|告訴|喊|叫(?![做作])|嚷|吼|罵|唸(?!書)|叮嚀|叮囑|囑咐|交代|提醒|安慰|抱怨|嘀咕|喃喃|追問|反問|插嘴|笑道|嘆道)';
/** 引號前的說話標記（引號前緊接著）：說話的動詞＋（著、了、道、起來）＋（對誰：我、自己、大家…）＋（：，）。 */
const SPEECH_TAG = `${SPEECH_VERB}(?:著|了|道|起來)?(?:自己|我們|我|你們|你|妳|他們|他|她們|她|大家)?\\s*[：:，,]?\\s*$`;

/**
 * 日常生活裡的一般人物（家人、學校、路上遇到的人）：這些人說的話一定是對話（以前情意題允許，2026-10-31 起任何題型都不寫）。
 */
export const ZH_EVERYDAY_SPEAKERS =
  '媽媽|爸爸|母親|父親|老媽|老爸|阿嬤|阿公|奶奶|爺爺|外婆|外公|祖母|祖父|弟弟|妹妹|哥哥|姊姊|姐姐|表哥|表姊|表姐|表弟|表妹|堂哥|堂姊|堂弟|堂妹|' +
  '阿姨|叔叔|伯伯|伯父|伯母|嬸嬸|舅舅|舅媽|姑姑|姑丈|姨丈|家人|老師|導師|班導|教官|校長|主任|同學|學長姊|學長|學姊|學姐|學弟|學妹|班長|' +
  '隊長|社長|組長|隊友|社員|室友|同桌|朋友|好友|鄰居|店員|店長|老闆娘|老闆|司機|教練|護理師|護士|醫生|警衛|志工|服務生|客人|乘客|路人|' +
  '老先生|老太太|老爺爺|老奶奶|老人|阿伯|大叔|小朋友|小孩|孩子|男孩|女孩|館員|管理員|清潔員|廚師|攤販|陌生人';
const EVERYDAY_SPEAKER_RE = new RegExp(ZH_EVERYDAY_SPEAKERS, 'u');

/** 一般人物說的話：「媽媽說：」「公車司機回頭說：」（人物和說話的動詞之間最多 6 個字、不跨逗號）。 */
const NOUN_TAG_RE = new RegExp(`(?:${ZH_EVERYDAY_SPEAKERS})[^，。！？「」『』]{0,6}${SPEECH_TAG}`, 'u');
/** 第一人稱說的話（「我說：」「我們問：」「我問自己：」）；「我想起某人說」「我曾聽人說」不算。 */
const FIRST_PERSON_TAG_RE = new RegExp(`(?<![對跟和向訴給教])(?:我們|我)(?!想起|想到|記得|常|也曾)[^，。！？「」『』曾常聽讀想記引]{0,4}${SPEECH_TAG}`, 'u');
/** 第二、三人稱說的話（「他笑著說：」）；「他曾說」「她常說」不算。 */
const PRONOUN_TAG_RE = new RegExp(`(?:他們|她們|你們|他|她|你|對方)(?!常|也曾)[^，。！？「」『』曾常聽讀想記引]{0,4}${SPEECH_TAG}`, 'u');
/** 引號裡的念頭（「我心想：」）：讀起來同樣是小說的寫法。 */
const THOUGHT_TAG_RE = /(?:心想|暗想|心裡想|心中想|心底想|心裡說|心裡默念|想著)\s*[：:]\s*$/u;
/** 有冒號的說話標記（說話的人在逗號前面，或不是上面幾類）：「媽媽推門進來，說：」。 */
const COLON_TAG_RE = new RegExp(`${SPEECH_VERB}(?:著|了|道|起來)?(?:自己|我們|我|你們|你|妳|他們|他|她們|她|大家)?\\s*[：:]\\s*$`, 'u');
/** 引用作品、俗語名言、書上的話、回想某人說過的話（不是對話；引文規則另外處理）。 */
const CITATION_RE = /〈|《|俗話|俗語|諺語|古人|前人|常言|有句話|有人|人們常|人家常|名言|書上|書中|文中|作者|筆者|所謂|想起|想到|記得|聽人|聽過|讀過|讀到|曾經?說|常說/u;
/** 名人或出處的字樣：同一段前面有這些時，代名詞或不明的人說的話多半是在引用名人（引文規則拿掉編造的名言）。 */
export const ZH_FAMOUS_CONTEXT_RE =
  /《|〈|曾經?說|名言|演講|著作|書中|書裡|作家|科學家|哲學家|思想家|文學家|發明家|藝術家|音樂家|詩人|名人|偉人|總統|諾貝爾|創辦人|執行長/u;
/** 引號裡少於這麼多個漢字、前面有說話標記：一句短短的話（「好。」），當成對話（長的名言由引文規則判斷）。 */
const SHORT_UTTERANCE_HAN = 8;
/** 引號後的說話標記：「你還好嗎？」他問。「早點睡。」媽媽笑著說。（「我沒有回答」不是：中間有否定詞。） */
const TAG_AFTER_RE = new RegExp(`^[，,]?\\s*(?:${ZH_EVERYDAY_SPEAKERS}|我們|我|他們|她們|你們|他|她|你|對方)(?:(?![沒不未別])[^，。！？「」『』]){0,6}?${SPEECH_VERB}`, 'u');
/** 引號後的說話的人是代名詞（「他問。」）：同一段前面是名人時可能是在引用名人。 */
const PRONOUN_AFTER_RE = /^[，,]?\s*(?:他們|她們|你們|他|她|你|對方)/u;

/**
 * 句子：以。！？或換行分開；引號（「」『』“”‘’）裡的句末標點不分句；句末標點後面緊接的句末標點與收引號留在這一句。
 * 引號裡最後是句末標點（「早點睡。」）而引號後面不是「他問」這類說話標記時，句子在收引號後結束（「她說：「早點睡。」我沒有抬頭。」
 * 是兩句），拿掉一句對話時不會連後面的敘事一起拿掉。
 */
export function zhSampleSentences(text: string): string[] {
  const out: string[] = [];
  const chars = [...text];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '\n') {
      if (cur !== '') out.push(cur);
      cur = '';
      depth = 0;
      continue;
    }
    cur += ch;
    if (SENTENCE_QUOTE_OPEN.has(ch)) depth += 1;
    else if (SENTENCE_QUOTE_CLOSE.has(ch)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && /[。！？!?…]/u.test(chars[i - 1] ?? '')) {
        const rest = chars.slice(i + 1).join('');
        if (rest !== '' && !/^[。！？!?」』”’）)]/u.test(rest) && !TAG_AFTER_RE.test(rest)) {
          out.push(cur);
          cur = '';
        }
      }
    } else if (depth === 0 && /[。！？!?]/u.test(ch)) {
      while (i + 1 < chars.length && /[。！？!?」』”’）)]/u.test(chars[i + 1]!)) cur += chars[++i]!;
      out.push(cur);
      cur = '';
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** 引號對話的種類：引號前有說話標記、引號後有說話標記、整句只有引號、引號裡的話是說話的口氣（問句、驚嘆、對「你」說）。 */
export type ZhDialogueKind = 'tag_before' | 'tag_after' | 'standalone' | 'speech_like';

export interface ZhDialogueHit {
  /** 第幾句（zhSampleSentences(text) 的索引）。 */
  sentence: number;
  /** 引號裡的文字。 */
  inner: string;
  kind: ZhDialogueKind;
}

function hanOf(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0;
}

/** 引號裡的話是不是說話的口氣：以問號、驚嘆號結尾，句末是語氣詞，或（4 字以上）對「你」說。 */
function speechLike(inner: string): boolean {
  const body = inner.replace(/[\s」』”’）)]+$/u, '');
  if (/[？！?!]$/u.test(body)) return true;
  if (/(?:吧|啦|呢|嗎|喔|噢|囉|啊|呀|嘛|哦)[。，…～]*$/u.test(body)) return true;
  return [...body].length >= 4 && /你|妳|您/u.test(body);
}

/**
 * 找出引號對話（國寫範文與國寫指導的示範段；站主規則：國寫是文章，不是小說，「」不寫人物說的話）。全部確定性。
 * 「」只留給：題目素材的短引文、附作者與篇名的古文名句、題目的關鍵詞、篇名或題目。呼叫端用 exempt 判斷「不是對話」的引文
 * （題目裡找得到的字、古文語料查得到的句子）。
 *
 *   tag_before   一定算：引號前緊接著一般人物、第一人稱或念頭的說話標記（「媽媽說：」「公車司機回頭說：」「我問自己：」「我心想：」）。
 *                其次：代名詞的說話標記（「他問：」）或有冒號的說話標記（「媽媽推門進來，說：」），而且同一段前面提過一般人物、
 *                引號裡是說話的口氣，或引號裡不到 8 個漢字（一句短短的話）；但引號前有〈〉《》（引用作品）、俗語名言、書上的話、
 *                回想某人說過的話（「我想起梭羅說：」），或同一段前面是名人或作品時不算（引文規則另外處理，編造的名言整句拿掉）。
 *   tag_after    引號後緊接著說話的人與動詞（「早點睡。」媽媽說。「你還好嗎？」他問。），引號裡有標點或是說話的口氣；說話的人是
 *                代名詞而同一段前面是名人時不算。
 *   standalone   整句只有引號（「你還好嗎？」），引號裡至少兩個漢字；引號前有〈〉《》或俗語名言的字樣時不算。
 *   speech_like  其他位置的引號，引號裡是說話的口氣（問句、驚嘆、語氣詞、對「你」說）；同上。
 */
export function zhFindDialogue(text: string, exempt: (inner: string) => boolean = () => false): ZhDialogueHit[] {
  // 彎引號先換成「」『』（長度不變；同後處理的標點修正）。
  const norm = text.replace(/[“”‘’]/gu, (ch) => (ch === '“' ? '「' : ch === '”' ? '」' : ch === '‘' ? '『' : '』'));
  const hits: ZhDialogueHit[] = [];
  let prior = '';
  zhSampleSentences(norm).forEach((sentence, index) => {
    for (const m of sentence.matchAll(/「([^「」]+)」/gu)) {
      const inner = m[1]!;
      const offset = m.index;
      if (hanOf(inner) === 0 || exempt(inner)) continue;
      const before = [...sentence.slice(0, offset)].slice(-20).join('');
      const after = sentence.slice(offset + m[0].length);
      const context = prior + sentence.slice(0, offset);
      const utterance = /[，。！？、；,!?…]/u.test(inner) || speechLike(inner);
      const tagAfter = TAG_AFTER_RE.test(after);
      let kind: ZhDialogueKind | null = null;
      if (NOUN_TAG_RE.test(before) || FIRST_PERSON_TAG_RE.test(before) || THOUGHT_TAG_RE.test(before)) kind = 'tag_before';
      else if (tagAfter && !PRONOUN_AFTER_RE.test(after) && utterance) kind = 'tag_after';
      else {
        const cited = CITATION_RE.test(before);
        const famous = ZH_FAMOUS_CONTEXT_RE.test(context) || ZH_OVERUSED_FIGURES.some((f) => context.includes(f));
        if (PRONOUN_TAG_RE.test(before) || COLON_TAG_RE.test(before)) {
          kind = !cited && !famous && (EVERYDAY_SPEAKER_RE.test(context) || speechLike(inner) || hanOf(inner) < SHORT_UTTERANCE_HAN) ? 'tag_before' : null;
        } else if (tagAfter && utterance) kind = famous ? null : 'tag_after';
        else if (cited) kind = null;
        else if (sentence.replace(m[0], '').replace(/[\s。！？!?，、…—～.]/gu, '') === '' && hanOf(inner) >= 2) kind = 'standalone';
        else if (speechLike(inner)) kind = 'speech_like';
      }
      if (kind) hits.push({ sentence: index, inner, kind });
    }
    prior += sentence;
  });
  return hits;
}
