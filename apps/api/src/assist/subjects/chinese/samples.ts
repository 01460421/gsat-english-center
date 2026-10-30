/**
 * AI 寫的國文示範文字的共同規則（國寫範文設計 §5.1 第 3、7–10 步、§5.4、§10）：國寫範文（exemplar.ts）的段落與問題（一）答案，
 * 以及國寫指導的示範段（output.ts 的 postWriting）用同一組檢查。全部確定性、不呼叫模型。
 *
 *   zhFixSamplePunct   半形的 , ; : ? ! 夾在漢字後面換成全形；“”‘’ 換成「」『』；引號外的驚嘆號換成「。」。
 *   zhSampleSentences  句子（以。！？分開，引號裡的句末標點不分句，句末標點後緊接的收引號留在這一句）。
 *   zhCheckSampleQuotes 「…」的引文規則（§5.4）：題目裡找得到 → 保留；≥ 8 個漢字、題目沒有 → 古文語料核對：完全相同保留、
 *                      幾乎相同換成語料版本、查不到時有出處標記就整句拿掉（編造的名言）、沒有出處標記只拿掉引號；
 *                      < 8 個漢字（強調用的關鍵詞）保留。對話（「媽媽說：「……」」這類一般人物的話）不算引文。
 *   zhStripSampleSentences 套語（ZH_CONTEST_STOCK_PATTERNS，題目本身引用的不算）、未經查證的說法（研究、調查、統計…而且有
 *                      題目沒有的數字）、得獎字樣、等第句：整句拿掉。
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
/** 一般人物說的話（對話）：引號前是「媽媽說：」「同學問：」這類，不當成名言（情意題的敘事常有對話）。 */
const DIALOGUE_RE =
  /(?:媽媽|爸爸|母親|父親|老師|同學|學長|學姊|學姐|學弟|學妹|朋友|阿嬤|阿公|奶奶|爺爺|外婆|外公|教練|隊長|社長|店員|弟弟|妹妹|哥哥|姊姊|姐姐|室友|鄰居|他|她|我|你|我們|他們|她們|大家)[^，。！？「」『』]{0,4}(?:說|問|喊|叫|回答|笑著說|小聲說)[：:，,]?$/u;

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
 */
export function zhCheckSampleQuotes(text: string, q: Pick<AssistQuestionView, 'blocks'>, checks: ZhChecks): ZhQuoteCheck {
  let material = 0;
  let longMaterial = 0;
  const kept: string[] = [];
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
      if (DIALOGUE_RE.test(before)) return whole;
      if (ATTRIBUTION_RE.test(before)) {
        drop = true;
        return whole;
      }
      bump(checks, 'quote_unmarked');
      return inner;
    });
    if (drop) bump(checks, 'attribution_removed');
    else kept.push(next);
  }
  bump(checks, 'material_quote_long', longMaterial);
  return { text: kept.join('').trim(), material, longMaterial };
}

// ───────────────────────── 整句拿掉的規則 ─────────────────────────

const CLAIM_RE = /研究|調查|統計|數據顯示|根據[^。！？]{0,20}報導/u;
const NUMBER_RE = /\d+(?:[.,]\d+)*\s*%?|百分之[零一二三四五六七八九十百]+|[一二三四五六七八九十]+成/gu;
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
  const kept = zhSampleSentences(text).filter((s) => {
    if (kinds.stock && ZH_CONTEST_STOCK_PATTERNS.some((p, i) => !allowed.has(i) && p.re.test(s))) {
      bump(checks, 'stock_line_removed');
      return false;
    }
    if (kinds.claim && CLAIM_RE.test(s) && [...s.matchAll(NUMBER_RE)].some((m) => !qText.includes(m[0].replace(/\s/gu, '')))) {
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
  const quoted = zhCheckSampleQuotes(text, q, checks);
  if ((checks.attribution_removed ?? 0) > before) return null;
  const punct = zhFixSamplePunct(quoted.text);
  bump(checks, 'punct_fixed', punct.fixed);
  bump(checks, 'exclaim_replaced', punct.exclaim);
  zhCountSampleWords(punct.text, q, checks);
  return punct.text;
}
