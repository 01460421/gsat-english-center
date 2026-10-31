/**
 * AI 寫的國文示範文字的共同規則（國寫範文設計 §5.1 第 3、7–10 步、§5.4、§10）：國寫範文（exemplar.ts）的段落與問題（一）答案，
 * 以及國寫指導的示範段（output.ts 的 postWriting）用同一組檢查。全部確定性、不呼叫模型。
 *
 *   zhFixSamplePunct   半形的 , ; : ? ! 夾在漢字後面換成全形；“”‘’ 換成「」『』；引號外的驚嘆號：國寫指導的示範段換成「。」
 *                      （示範段的規則是不用驚嘆號），國寫範文保留（2026-10-31：有目的的語氣是好文章的一部分，只計數）。
 *   zhSampleSentences  句子（shared；以。！？分開，引號裡的句末標點不分句，「…。」後面不是說話標記時在收引號後分句）。
 *   zhDialogueHits     引號對話（shared 的 zhFindDialogue；站主 2026-10-31：「不能有引號對話，你在寫文章不是小說」）：題目裡找得到的
 *                      字（素材、關鍵詞、題目）與古文語料查得到的名句不算。以前情意題允許一般人物的對話，現在任何題型都不寫。
 *   zhCheckSampleQuotes 「…」的引文規則（§5.4）：有引號對話的句子整句拿掉（dialogue_removed；國寫範文在最後一次產生才走到這裡，
 *                      第一次命中先付費重寫）；其餘的引號：題目裡找得到 → 保留；≥ 8 個漢字、題目沒有 → 古文語料核對：完全相同保留、
 *                      幾乎相同換成語料版本、查不到時有出處標記就整句拿掉（編造的名言）、沒有出處標記而且是完整的句子
 *                      只拿掉引號（詞組照留：自己命名的說法是修辭）；< 8 個漢字（強調用的關鍵詞）保留。
 *   zhStripSampleSentences 套語（ZH_CONTEST_STOCK_PATTERNS，題目本身引用的不算）、未經查證的說法（研究、調查、統計、報告、
 *                      民調…而且有題目沒有的數字：阿拉伯或全形數字、百分之N、N成、帶單位的中文數字）、得獎字樣、等第句：整句拿掉。
 *   zhCountSampleWords 通用套語、競賽詞彙、高頻人物（題目沒提到的）：只計數。
 *   zhDemoGuards       國寫指導的示範段（§10）：比賽指紋、比賽套語、引號對話、要拿掉的引文任一命中就拿掉那一筆；標點就地修正；
 *                      詞彙只計數。
 */
import {
  ZH_CLICHE_PATTERNS,
  ZH_CONTEST_STOCK_PATTERNS,
  ZH_CONTEST_WORDS,
  ZH_OVERUSED_FIGURES,
  zhFindDialogue,
  zhFindQuote,
  zhSampleSentences,
  zhStripGradeSentences,
  type AssistQuestionView,
  type ZhChecks,
  type ZhCheckCounter,
  type ZhDialogueHit,
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
 * 標點（§5.1 第 3 步）：彎引號換成「」『』；半形的 , ; : ? ! 接在漢字或收引號後面時換全形。引號外的驚嘆號：exclaim 'replace'
 * （預設；國寫指導的示範段）換成「。」（前一個字已經是句末標點時直接拿掉，不留「。。」）；'keep'（國寫範文）保留、只計數。
 * 回傳修正後的文字與兩種計數（exclaim＝引號外的驚嘆號個數，換掉或保留的都算）。
 */
export function zhFixSamplePunct(text: string, opts: { exclaim?: 'replace' | 'keep' } = {}): { text: string; fixed: number; exclaim: number } {
  const replace = opts.exclaim !== 'keep';
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
      if (replace) {
        if (!/[。？?…]$/u.test(result)) result += '。';
        continue;
      }
      result += '！';
      continue;
    }
    result += ch;
  }
  return { text: result, fixed, exclaim };
}

// ───────────────────────── 句子 ─────────────────────────

/** 句子（搬到 shared；這裡照舊匯出，呼叫端不用改）。 */
export { zhSampleSentences };

// ───────────────────────── 引文（§5.4） ─────────────────────────

/** 出處標記（「〈」「《」「曰」「云」「說」「寫道」「提到」「指出」「名言」「所言」）：引號前 20 字內有這些就當成引用某人某書。 */
const ATTRIBUTION_RE = /〈|《|曰|云|說|寫道|提到|指出|名言|所言/u;

function inQuestion(inner: string, q: Pick<AssistQuestionView, 'blocks'>): boolean {
  return (q.blocks ?? []).some((b) => zhFindQuote(b.text, inner) !== null);
}

/**
 * 引號對話（shared 的 zhFindDialogue）：題目裡找得到的字（素材的引文、題目的關鍵詞、題目）與古文語料查得到的名句（≥ 8 個漢字）
 * 不算。回傳命中的句子（zhSampleSentences 的索引）與種類。
 */
export function zhDialogueHits(text: string, q: Pick<AssistQuestionView, 'blocks'>): ZhDialogueHit[] {
  return zhFindDialogue(text, (inner) => {
    if (inQuestion(inner, q)) return true;
    if (hanCount(inner) < ZH_CLASSIC_QUOTE_MIN_HAN) return false;
    const r = zhLookupClassic(inner);
    return r.kind === 'exact' || r.kind === 'near' || r.kind === 'ambiguous';
  });
}

export interface ZhQuoteCheck {
  text: string;
  /** 題目素材的引文個數與其中超過 40 字的個數（全篇最多 2 處、各 ≤ 40 字，超過只計數）。 */
  material: number;
  longMaterial: number;
}

/**
 * 一段示範的引文（見檔頭）。直接改 checks；回傳新文字（拿掉句子、換成語料版本或拿掉引號之後）。
 * 引號對話的句子整句拿掉（dialogue_removed），不論題型（站主 2026-10-31；以前情意題保留一般人物的對話）。
 */
export function zhCheckSampleQuotes(text: string, q: Pick<AssistQuestionView, 'blocks'>, checks: ZhChecks): ZhQuoteCheck {
  let material = 0;
  let longMaterial = 0;
  const kept: string[] = [];
  const dialogue = new Set(zhDialogueHits(text, q).map((h) => h.sentence));
  zhSampleSentences(text).forEach((sentence, index) => {
    if (dialogue.has(index)) {
      bump(checks, 'dialogue_removed');
      return;
    }
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
      if (ATTRIBUTION_RE.test(before)) {
        drop = true;
        return whole;
      }
      // 沒有出處標記：一個完整的句子（有句中或句末標點）像是沒說出處的名言，拿掉引號當成自己的話；一個詞組（自己命名的說法、
      // 強調的詞）是修辭，照留（2026-10-31 放寬：以前 8 字以上一律拿掉引號）。
      if (!/[，。！？；、,.!?;]/u.test(inner)) return whole;
      bump(checks, 'quote_unmarked');
      return inner;
    });
    if (drop) bump(checks, 'attribution_removed');
    else kept.push(next);
  });
  bump(checks, 'material_quote_long', longMaterial);
  return { text: kept.join('').trim(), material, longMaterial };
}

// ───────────────────────── 整句拿掉的規則 ─────────────────────────

/**
 * 說法的來源字樣（§5.1 第 9 步）：研究、調查、統計、報告、民調、新聞、數據…（「研究了一下」「研究過」這類動詞，以及
 * 「研究所、研究生、研究員、研究室」這些名詞不算：「姊姊讀研究所兩年」是敘事，不是編造的統計）。
 * 比對前先 NFKC（全形字母數字換半形）。
 */
const CLAIM_RE =
  /研究(?![了過一所生員室])|調查|統計|普查|民調|問卷|數據|報告(?:指出|顯示|發現)|新聞(?:報導|指出)|資料顯示|實驗(?:顯示|發現|證明|證實)|(?:專家|學者)(?:指出|表示|發現|估計)|據估計|根據[^。！？]{0,20}報導/u;
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
/**
 * 得獎字樣（§5.1 第 10 步）：示範不提任何比賽或得獎作品。「佳作」「語文競賽」「文學獎」「徵文」一律算；「得獎、特優、第一二三名、
 * 首獎」只在同一句提到寫作（作文、文章、寫作、語文、演講、朗讀、這篇、範文、示範）時才算（2026-10-31 放寬：「那場接力賽我們拿了
 * 第二名」「段考第一名」是敘事，整句拿掉會傷到好文章）。
 */
const CONTEST_ALWAYS_RE = /佳作|語文競賽|文學獎|徵文/u;
const CONTEST_PLACE_RE = /得獎|特優|第[一二三]名|首獎/u;
const WRITING_CONTEXT_RE = /作文|文章|寫作|語文|演講|朗讀|這篇|範文|示範/u;

/** 這段文字有沒有得獎字樣（逐句看；見上）。評測的 K 組用同一支。 */
export function zhContestMention(text: string): boolean {
  return zhSampleSentences(text).some((s) => CONTEST_ALWAYS_RE.test(s) || (CONTEST_PLACE_RE.test(s) && WRITING_CONTEXT_RE.test(s)));
}

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
    if (kinds.mention && zhContestMention(s)) {
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
 * 比賽指紋（題目本身的窗口不算）、比賽套語（題目引用的不算）、引號對話（站主 2026-10-31）、引文規則判定要拿掉句子，任一命中
 * 就拿掉整筆；不重試。
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
  if (zhDialogueHits(text, q).length > 0) {
    bump(checks, 'dialogue_removed');
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
