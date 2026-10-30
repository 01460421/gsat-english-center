/**
 * AI 寫的國文示範文字的共同規則（國寫範文設計 §5.1 第 3、7–10 步、§5.4、§10）：國寫範文（exemplar.ts）的段落與問題（一）答案，
 * 以及國寫指導的示範段（output.ts 的 postWriting）用同一組檢查。全部確定性、不呼叫模型。
 *
 *   zhFixSamplePunct   半形的 , ; : ? ! 夾在漢字後面換成全形；“”‘’ 換成「」『』；引號外的驚嘆號換成「。」。
 *   zhSampleSentences  句子（以。！？分開，引號裡的句末標點不分句，句末標點後緊接的收引號留在這一句）。
 *   zhCheckSampleQuotes 「…」的引文規則（§5.4）：題目裡找得到 → 保留；≥ 8 個漢字、題目沒有 → 古文語料核對：完全相同保留、
 *                      幾乎相同換成語料版本、查不到時有出處標記就整句拿掉（編造的名言）、沒有出處標記只拿掉引號；
 *                      < 8 個漢字（強調用的關鍵詞）保留。對話不算引文：一般人物（「媽媽說：」「公車司機回頭說：」）任何題型；
 *                      「我說：」任何題型（「我想起某人說」不算）；「他說：」「她問：」只在情意的敘事、而且同一段前面提過一般人物、
 *                      沒有名人或出處的字樣時才算（「愛因斯坦是科學家，他說：」「史懷哲……他曾說：」都當成引用名人）。
 *   zhStripSampleSentences 套語（ZH_CONTEST_STOCK_PATTERNS，題目本身引用的不算）、未經查證的說法（研究、調查、統計、報告、
 *                      民調…而且有題目沒有的數字：阿拉伯或全形數字、百分之N、N成、帶單位的中文數字）、得獎字樣、等第句：整句拿掉。
 *   zhCountSampleWords 通用套語、競賽詞彙、高頻人物（題目沒提到的）：只計數。
 *   zhDemoGuards       國寫指導的示範段（§10）：比賽指紋、比賽套語、要拿掉的引文任一命中就拿掉那一筆；標點就地修正；詞彙只計數。
 */
import {
  ZH_CLICHE_PATTERNS,
  ZH_CONTEST_STOCK_PATTERNS,
  ZH_CONTEST_WORDS,
  ZH_OVERUSED_FIGURES,
  zhFindQuote,
  zhStripGradeSentences,
  type AssistQuestionView,
  type ZhChecks,
  type ZhCheckCounter,
} from '@gsat/shared';
import { ZH_CLASSIC_QUOTE_MIN_HAN, zhLookupClassic } from './classics';
import { zhContestHit } from './contest';

function bump(checks: ZhChecks, key: ZhCheckCounter, n = 1): void {
  if (n > 0) checks[key] = (checks[key] ?? 0) + n;
}

function hanCount(text: string): number {
  return text.match(/\p{Script=Han}/gu)?.length ?? 0;
}

const QUOTE_OPEN = new Set(['「', '『']);
const QUOTE_CLOSE = new Set(['」', '』']);

// ───────────────────────── 標點 ─────────────────────────

const HALF_TO_FULL: Readonly<Record<string, string>> = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！' };

/**
 * 標點（§5.1 第 3 步）：彎引號換成「」『』；半形的 , ; : ? ! 接在漢字或收引號後面時換全形；引號外的驚嘆號換成「。」
 * （前一個字已經是句末標點時直接拿掉，不留「。。」）。回傳修正後的文字與兩種計數。
 */
export function zhFixSamplePunct(text: string): { text: string; fixed: number; exclaim: number } {
  let fixed = 0;
  let out = text.replace(/[“”‘’]/gu, (ch) => {
    fixed += 1;
    return ch === '“' ? '「' : ch === '”' ? '」' : ch === '‘' ? '『' : '』';
  });
  out = out.replace(/(?<=[\p{Script=Han}」』）])[,;:?!]/gu, (ch) => {
    fixed += 1;
    return HALF_TO_FULL[ch]!;
  });
  let exclaim = 0;
  let depth = 0;
  let result = '';
  for (const ch of out) {
    if (QUOTE_OPEN.has(ch)) depth += 1;
    else if (QUOTE_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === '！' || ch === '!')) {
      exclaim += 1;
      if (!/[。？?…]$/u.test(result)) result += '。';
      continue;
    }
    result += ch;
  }
  return { text: result, fixed, exclaim };
}

// ───────────────────────── 句子 ─────────────────────────

/** 句子：以。！？或換行分開；引號裡的句末標點不分句；句末標點後面緊接的句末標點與收引號留在這一句。 */
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
    if (QUOTE_OPEN.has(ch)) depth += 1;
    else if (QUOTE_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[。！？!?]/u.test(ch)) {
      while (i + 1 < chars.length && /[。！？!?」』）)]/u.test(chars[i + 1]!)) cur += chars[++i]!;
      out.push(cur);
      cur = '';
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

// ───────────────────────── 引文（§5.4） ─────────────────────────

/** 出處標記（「〈」「《」「曰」「云」「說」「寫道」「提到」「指出」「名言」「所言」）：引號前 20 字內有這些就當成引用某人某書。 */
const ATTRIBUTION_RE = /〈|《|曰|云|說|寫道|提到|指出|名言|所言/u;
/** 日常生活裡的一般人物（家人、學校、路上遇到的人）：情意題的敘事常有他們說的話。 */
const EVERYDAY_SPEAKERS =
  '媽媽|爸爸|母親|父親|老媽|老爸|阿嬤|阿公|奶奶|爺爺|外婆|外公|祖母|祖父|弟弟|妹妹|哥哥|姊姊|姐姐|表哥|表姊|表姐|表弟|表妹|堂哥|堂姊|堂弟|堂妹|' +
  '阿姨|叔叔|伯伯|伯父|伯母|嬸嬸|舅舅|舅媽|姑姑|姑丈|姨丈|家人|老師|導師|班導|教官|校長|主任|同學|學長姊|學長|學姊|學姐|學弟|學妹|班長|' +
  '隊長|社長|組長|隊友|社員|室友|同桌|朋友|好友|鄰居|店員|店長|老闆娘|老闆|司機|教練|護理師|護士|醫生|警衛|志工|服務生|客人|乘客|路人|' +
  '老先生|老太太|老爺爺|老奶奶|老人|阿伯|大叔|小朋友|小孩|孩子|男孩|女孩|館員|管理員|清潔員|廚師|攤販';
const SPEAK = '(?:說|問|喊|叫|回答|答)[：:，,]?$';
/** 一般人物說的話（對話）：引號前是「媽媽說：」「公車司機回頭說：」這類，不當成名言（任何題型）。 */
const NOUN_DIALOGUE_RE = new RegExp(`(?:${EVERYDAY_SPEAKERS})[^，。！？「」『』]{0,4}${SPEAK}`, 'u');
/** 第一人稱說的話（「我說：」「我們問：」）；「我想起某人說」「我曾聽人說」不算（任何題型）。 */
const FIRST_PERSON_DIALOGUE_RE = new RegExp(`(?<![對跟和向訴給教])(?:我們|我)(?!想起|想到|記得|常|也曾)[^，。！？「」『』曾常聽讀想記引]{0,3}${SPEAK}`, 'u');
/** 第二、三人稱說的話（「他笑著說：」）；「他曾說」「她常說」不算。只在情意的敘事，而且要看同一段前面的文字（見 isDialogue）。 */
const OTHER_PERSON_DIALOGUE_RE = new RegExp(`(?:他們|她們|你們|他|她|你)(?!常|也曾)[^，。！？「」『』曾常聽讀想記引]{0,3}${SPEAK}`, 'u');
const EVERYDAY_SPEAKER_RE = new RegExp(EVERYDAY_SPEAKERS, 'u');
/** 名人或出處的字樣：同一段前面有這些時，「他說」多半是在引用名人。 */
const FAMOUS_CONTEXT_RE = /《|〈|曾經?說|名言|演講|著作|書中|書裡|作家|科學家|哲學家|思想家|文學家|發明家|藝術家|音樂家|詩人|名人|偉人|總統|諾貝爾|創辦人|執行長/u;

/**
 * 引號前的文字是不是一般人的對話（不當成名言）。before＝這一句引號前最多 20 字；prior＝同一段裡引號前的全部文字。
 * 情意的「他說：」要同一段前面提過一般人物（「他」指的是那個人），而且沒有名人或出處的字樣；「你說：」不必有前面的人物。
 */
function isDialogue(before: string, prior: string, narrative: boolean): boolean {
  if (NOUN_DIALOGUE_RE.test(before) || FIRST_PERSON_DIALOGUE_RE.test(before)) return true;
  const other = narrative ? OTHER_PERSON_DIALOGUE_RE.exec(before) : null;
  if (!other) return false;
  if (FAMOUS_CONTEXT_RE.test(prior) || ZH_OVERUSED_FIGURES.some((f) => prior.includes(f))) return false;
  return other[0].startsWith('你') || EVERYDAY_SPEAKER_RE.test(prior);
}

export interface ZhQuoteCheck {
  text: string;
  /** 題目素材的引文個數與其中超過 40 字的個數（全篇最多 2 處、各 ≤ 40 字，超過只計數）。 */
  material: number;
  longMaterial: number;
}

function inQuestion(inner: string, q: Pick<AssistQuestionView, 'blocks'>): boolean {
  return (q.blocks ?? []).some((b) => zhFindQuote(b.text, inner) !== null);
}

/**
 * 一段示範的引文（見檔頭）。直接改 checks；回傳新文字（拿掉句子、換成語料版本或拿掉引號之後）。
 * opts.narrative：情意題的敘事（「他說：」「她問：」可能是一般人的對話）；知性題與不確定的題型是 false。
 */
export function zhCheckSampleQuotes(text: string, q: Pick<AssistQuestionView, 'blocks'>, checks: ZhChecks, opts: { narrative?: boolean } = {}): ZhQuoteCheck {
  let material = 0;
  let longMaterial = 0;
  const kept: string[] = [];
  /** 這一段前面的句子（原文；判斷「他說」指的是誰）。 */
  let earlier = '';
  for (const sentence of zhSampleSentences(text)) {
    let drop = false;
    const next = sentence.replace(/「([^「」]+)」/gu, (whole, inner: string, offset: number) => {
      if (drop) return whole;
      if (inQuestion(inner, q)) {
        material += 1;
        if ([...inner].length > 40) longMaterial += 1;
        return whole;
      }
      if (hanCount(inner) < ZH_CLASSIC_QUOTE_MIN_HAN) return whole;
      const r = zhLookupClassic(inner);
      if (r.kind === 'exact') return whole;
      if (r.kind === 'near') {
        bump(checks, 'classic_misquote');
        return `「${r.original}」`;
      }
      const before = [...sentence.slice(0, offset)].slice(-20).join('');
      if (isDialogue(before, earlier + sentence.slice(0, offset), opts.narrative === true)) return whole;
      if (ATTRIBUTION_RE.test(before)) {
        drop = true;
        return whole;
      }
      bump(checks, 'quote_unmarked');
      return inner;
    });
    if (drop) bump(checks, 'attribution_removed');
    else kept.push(next);
    earlier += sentence;
  }
  bump(checks, 'material_quote_long', longMaterial);
  return { text: kept.join('').trim(), material, longMaterial };
}

// ───────────────────────── 整句拿掉的規則 ─────────────────────────

/**
 * 說法的來源字樣（§5.1 第 9 步）：研究、調查、統計、報告、民調、新聞、數據…（「研究了一下」「研究過」這類動詞不算）。
 * 比對前先 NFKC（全形字母數字換半形）。
 */
const CLAIM_RE =
  /研究(?![了過一])|調查|統計|普查|民調|問卷|數據|報告(?:指出|顯示|發現)|新聞(?:報導|指出)|資料顯示|實驗(?:顯示|發現|證明|證實)|(?:專家|學者)(?:指出|表示|發現|估計)|據估計|根據[^。！？]{0,20}報導/u;
/** 阿拉伯數字（NFKC 之後；含小數、千分位與 %）與「百分之N」。 */
const DIGIT_NUMBER_RE = /\d+(?:[.,]\d+)*\s*%?|百分之[零〇一二兩三四五六七八九十百]+(?:點[零〇一二三四五六七八九]+)?/gu;
/** 中文數字＋（多／餘／來）＋單位：「兩千三百名」「三萬多名」「近兩成」「三小時」「一個半小時」。 */
const HAN_NUMBER_RE =
  /([零〇一二兩三四五六七八九十百千萬億幾半]+)(?:個)?(?:半)?(?:多|餘|來)?(成(?!不變)|倍|%|個|名|位|人|次|年|天|日|週|周|月|小時|分鐘|秒|歲|所|家|間|件|項|戶|筆|元|塊|萬|億|公斤|公里|公尺)/gu;
/** 一半、過半、半數（沒有單位的比例）。 */
const HALF_RE = /一半|過半|半數/gu;
/** 只由「一」「半」組成的數（「一個人」「一天」「半小時」）太常見，不當成統計數字；「一成」「一倍」除外。 */
const PLAIN_NUMERAL_RE = /^[一半]+$/u;

/** 這一句裡的數字（給「題目沒有的數字」比對；回傳比對用的字串）。text 已經 NFKC。 */
function sampleNumbers(text: string): string[] {
  const out = [...text.matchAll(DIGIT_NUMBER_RE)].map((m) => m[0].replace(/\s/gu, ''));
  for (const m of text.matchAll(HAN_NUMBER_RE)) {
    const numeral = m[1]!;
    const unit = m[2]!;
    if (unit !== '成' && unit !== '倍' && unit !== '%' && PLAIN_NUMERAL_RE.test(numeral)) continue;
    // 「千萬不要」「萬一」不是數：萬、億當單位時前面要有個位數字。
    if ((unit === '萬' || unit === '億') && !/[零〇一二兩三四五六七八九幾]/u.test(numeral)) continue;
    // 兩個字以上而且有十百千萬的數比數字本身；其他連單位一起比（題目寫「三小時」才算題目有）。
    out.push(numeral.length >= 2 && /[十百千萬億]/u.test(numeral) ? numeral : m[0]);
  }
  out.push(...[...text.matchAll(HALF_RE)].map((m) => m[0]));
  return out;
}
/** 得獎字樣（§5.1 第 10 步）：示範不提任何比賽或得獎作品。 */
export const ZH_CONTEST_MENTION_RE = /得獎|特優|第[一二三]名|佳作|語文競賽/u;

/** 題目本身引用了的比賽套語（照題目寫不算套語）。 */
function stockAllowed(q: Pick<AssistQuestionView, 'blocks'>): Set<number> {
  const text = (q.blocks ?? []).map((b) => b.text).join('\n');
  return new Set(ZH_CONTEST_STOCK_PATTERNS.flatMap((p, i) => (p.re.test(text) ? [i] : [])));
}

/**
 * 整句拿掉（§5.1 第 8–10、12 步）：比賽套語、未經查證的說法、得獎字樣、等第句。直接改 checks；回傳拿掉之後的文字。
 * kinds 指定要跑哪幾種（說明欄位只跑得獎字樣；等第句由 ZhCleaner 處理）。
 */
export function zhStripSampleSentences(
  text: string,
  q: Pick<AssistQuestionView, 'blocks'>,
  checks: ZhChecks,
  kinds: { stock?: boolean; claim?: boolean; mention?: boolean; grade?: boolean } = { stock: true, claim: true, mention: true, grade: true },
): string {
  if (text === '') return text;
  const allowed = kinds.stock ? stockAllowed(q) : new Set<number>();
  const qText = (q.blocks ?? []).map((b) => b.text).join('\n');
  const qNorm = qText.normalize('NFKC');
  const kept = zhSampleSentences(text).filter((s) => {
    if (kinds.stock && ZH_CONTEST_STOCK_PATTERNS.some((p, i) => !allowed.has(i) && p.re.test(s))) {
      bump(checks, 'stock_line_removed');
      return false;
    }
    const norm = kinds.claim ? s.normalize('NFKC') : s;
    if (kinds.claim && CLAIM_RE.test(norm) && sampleNumbers(norm).some((n) => !qNorm.includes(n))) {
      bump(checks, 'claim_removed');
      return false;
    }
    if (kinds.mention && ZH_CONTEST_MENTION_RE.test(s)) {
      bump(checks, 'contest_mention_removed');
      return false;
    }
    return true;
  });
  let out = kept.join('').trim();
  if (kinds.grade) {
    const graded = zhStripGradeSentences(out);
    if (graded.removed > 0) {
      bump(checks, 'grade_removed', graded.removed);
      out = graded.text;
    }
  }
  return out;
}

/** 只計數的用詞（§5.1 第 8 步）：通用套語、競賽詞彙、題目沒提到的高頻人物。 */
export function zhCountSampleWords(text: string, q: Pick<AssistQuestionView, 'blocks'>, checks: ZhChecks): void {
  const qText = (q.blocks ?? []).map((b) => b.text).join('\n');
  bump(checks, 'cliche', ZH_CLICHE_PATTERNS.filter((re) => text.search(re) >= 0).length);
  bump(checks, 'contest_word', ZH_CONTEST_WORDS.filter((w) => text.includes(w)).length);
  bump(checks, 'overused_figure', ZH_OVERUSED_FIGURES.filter((f) => text.includes(f) && !qText.includes(f)).length);
}

// ───────────────────────── 國寫指導的示範段（§10） ─────────────────────────

/**
 * 國寫指導的一筆示範（句子或主體段示範）：要拿掉回 null（呼叫端計數並加 example_rule_removed 說明），否則回標點修正後的文字。
 * 比賽指紋（題目本身的窗口不算）、比賽套語（題目引用的不算）、引文規則判定要拿掉句子，任一命中就拿掉整筆；不重試。
 */
export function zhDemoGuards(
  text: string,
  q: Pick<AssistQuestionView, 'blocks'>,
  contest: { set: ReadonlySet<number> | undefined; allowed: ReadonlySet<string> },
  checks: ZhChecks,
  opts: { narrative?: boolean } = {},
): string | null {
  if (text === '') return text;
  if (zhContestHit(text, contest.set, contest.allowed)) {
    bump(checks, 'contest_overlap_removed');
    return null;
  }
  const allowed = stockAllowed(q);
  if (ZH_CONTEST_STOCK_PATTERNS.some((p, i) => !allowed.has(i) && p.re.test(text))) {
    bump(checks, 'stock_line_removed');
    return null;
  }
  const before = checks.attribution_removed ?? 0;
  const quoted = zhCheckSampleQuotes(text, q, checks, opts);
  if ((checks.attribution_removed ?? 0) > before) return null;
  const punct = zhFixSamplePunct(quoted.text);
  bump(checks, 'punct_fixed', punct.fixed);
  bump(checks, 'exclaim_replaced', punct.exclaim);
  zhCountSampleWords(punct.text, q, checks);
  return punct.text;
}
