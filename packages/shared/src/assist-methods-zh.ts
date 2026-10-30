/**
 * 學習助手國文的國寫方法卡與「你附的段落」的程式檢查（docs/design/assistant-subjects.md 實作備註「國寫方法卡與段落回饋清單」）。
 *
 *   國寫方法卡     ZH_WRITING_METHOD_CARDS：審題、立意、取材、結構、修辭五張；每張有要點、知性與情意各怎麼做、一個練習。
 *                  國寫指導的畫面依題型只列知性或情意那一行（題型不明時兩行都列）。
 *   段落的程式檢查 zhDraftChecks：學生附了段落時，程式依固定規則檢查開頭長度、驚嘆號、分號串排比、常見錯字、套語與字數，
 *                  不送 AI、不花點數；每一項對到 ZH_ERROR_CODES 的寫作族，最多 5 項，重要的在前。
 *
 * 撰寫規則：
 *   - 依站主的私人語料分析（全國語文競賽高中學生組得獎作品與評審講評的共同寫法）用本站自己的話寫；不轉載任何作品或講評的
 *     文句、不寫作者與學校，畫面也不寫年度與名次（只在設計文件寫）。
 *   - D8：不寫官方的評分原則、參考答案、試題解析或佳作的文字；寫「官方」，不寫考試機構的名稱。
 *   - 每一欄 ≤ 80 字（assist-methods-zh.test.ts 檢查），本站自寫的文字也進 D8 國文指紋的掃描（assist-zh.data.test.ts）。
 */
import { ZH_TEXT_LIMITS, countZhChars, type ZhErrorCode, type ZhSection } from './assist-zh';

// ───────────────────────── 國寫方法卡 ─────────────────────────

export const ZH_WRITING_METHOD_IDS = ['task', 'thesis', 'material', 'structure', 'style'] as const;
export type ZhWritingMethodId = (typeof ZH_WRITING_METHOD_IDS)[number];

export interface ZhWritingMethodCard {
  id: ZhWritingMethodId;
  title_zh: string;
  /** 要點。 */
  point_zh: string;
  /** 國寫知性怎麼做。 */
  reason_zh: string;
  /** 國寫情意怎麼做。 */
  emotion_zh: string;
  /** 一個練習。 */
  practice_zh: string;
}

/** 每張卡每一欄的字數上限（含標點）。 */
export const ZH_METHOD_CARD_FIELD_MAX = 80;

export const ZH_WRITING_METHOD_CARDS: readonly ZhWritingMethodCard[] = [
  {
    id: 'task',
    title_zh: '審題：圈出關鍵詞，問它排除了什麼',
    point_zh: '題目的每個關鍵詞都要寫到。先說清楚這個詞在你的文章裡指什麼、不指什麼；最容易漏掉的常是修飾語。',
    reason_zh: '把問題（二）的要求逐條抄成清單，每條標出寫在第幾段；素材裡的關鍵詞先下定義或劃出範圍，再立論。',
    emotion_zh: '引導文的每個問題都是要件，逐條列出、標出寫在哪一段；題目的意象要落在一件真實的事上，不只當成比喻。',
    practice_zh: '拿一個題目寫兩句「這題不是在問……」，再對照引導問題，看看有沒有漏掉的要件。',
  },
  {
    id: 'thesis',
    title_zh: '立意：一句話主張，再加一個補正',
    point_zh: '先用一句話說出你的看法，再補一句「這不是指……」或面對反面的情況，比多列幾個平行的論點更有深度。',
    reason_zh: '寫成「立場＋一個限定條件」。400 字只容得下一個主張和一到兩個理由，三個分論點要刪成兩個。',
    emotion_zh: '寫成「這件事讓我從 A 變成 B」：要有前後的變化。只有情緒、沒有轉變，讀起來像日記。',
    practice_zh: '把三個分論點刪成兩個，用一句話說明刪掉的那個為什麼比較弱。',
  },
  {
    id: 'material',
    title_zh: '取材：一個貼身例，加一個素材例',
    point_zh: '與其列一串名人，不如一個自己經歷或親眼看到的例子，再加一個題目素材或查得到的事例。',
    reason_zh: '至少引用題目素材一處，再加一個生活見聞；每個例子後面接一句說明，把它扣回你的主張。',
    emotion_zh: '只寫一個場景，寫出時間、地點、動作和一個感官細節（聲音、氣味或觸感），讓讀者看得見。',
    practice_zh: '把文章裡的一句名言，換成你親眼看到的一件事，寫成兩句。',
  },
  {
    id: 'structure',
    title_zh: '結構：開頭短，結尾回到開頭',
    point_zh: '開頭寫短、早點帶到題目，不要鋪陳太久；本文每段只做一件事；結尾呼應開頭，不另開新話題。',
    reason_zh: '首段兩句點題；本文每段照「主張→例子→說明→回扣」寫。400 字大約配成首段 60、本文兩段各 140、結尾 60。',
    emotion_zh: '用場景、轉折、體悟三到四段；開頭的場景兩三句就帶到題目，結尾可以只留一行，回到開頭的那個畫面。',
    practice_zh: '把一段一百多字的開頭壓到 30 字以內，只留下點題的那一句。',
  },
  {
    id: 'style',
    title_zh: '修辭：一篇只放一個亮點',
    point_zh: '亮點一個就夠：一個貫穿全篇的比喻，或一組排比。堆疊華麗的句子、名言和生僻字，反而看不出你的想法。',
    reason_zh: '全篇最多一組排比、一句引文，驚嘆號不超過 1 個；用理由說服人，不用口號。',
    emotion_zh: '一個比喻撐起全篇就好；生僻字換成常用字，成串的四字文言改成自己的話，感受才清楚。',
    practice_zh: '把一段三句的排比改寫成一句具體描寫：寫出看到了什麼、做了什麼。',
  },
];

/** 方法卡的來源說明（畫面顯示一行）。 */
export const ZH_METHOD_CARDS_SOURCE_ZH = '整理自全國語文競賽高中學生組得獎作品與評審講評的共同寫法（本站分析，不轉載原文）。';

/** 方法卡會顯示給學生的全部文字（D8 指紋掃描、字數與用字檢查用）。 */
export function zhWritingMethodCardTexts(): string[] {
  return [
    ...ZH_WRITING_METHOD_CARDS.flatMap((c) => [c.title_zh, c.point_zh, c.reason_zh, c.emotion_zh, c.practice_zh]),
    ZH_METHOD_CARDS_SOURCE_ZH,
  ];
}

/** 畫面要列哪幾行：知性題只列知性、情意題只列情意，題型不明（zh_other）兩行都列。 */
export function zhMethodCardLines(section: ZhSection): { reason: boolean; emotion: boolean } {
  if (section === 'zh_writing_reason') return { reason: true, emotion: false };
  if (section === 'zh_writing_emotion') return { reason: false, emotion: true };
  return { reason: true, emotion: true };
}

// ───────────────────────── 你附的段落：程式檢查 ─────────────────────────

/** 程式檢查的項目，依重要程度排列（畫面也照這個順序）。 */
export const ZH_DRAFT_CHECK_IDS = ['length', 'opening_long', 'typo', 'cliche', 'exclamation', 'semicolon_chain'] as const;
export type ZhDraftCheckId = (typeof ZH_DRAFT_CHECK_IDS)[number];

export interface ZhDraftFinding {
  id: ZhDraftCheckId;
  label_zh: string;
  /** 具體說明：引學生自己的字（每段引文 ≤ 12 字）。 */
  detail_zh: string;
  code: ZhErrorCode;
}

export const ZH_DRAFT_CHECK_INFO: Record<ZhDraftCheckId, { label_zh: string; code: ZhErrorCode }> = {
  length: { label_zh: '字數偏多', code: 'zh_structure' },
  opening_long: { label_zh: '開頭太長', code: 'zh_structure' },
  typo: { label_zh: '常見錯字', code: 'zh_expression' },
  cliche: { label_zh: '套語', code: 'zh_thin_content' },
  exclamation: { label_zh: '驚嘆號太多', code: 'zh_expression' },
  semicolon_chain: { label_zh: '分號串排比', code: 'zh_expression' },
};

/** 一次最多列幾項。 */
export const ZH_DRAFT_CHECKS_MAX = 5;

/**
 * 這個段落會檢查哪幾項（依 ZH_DRAFT_CHECK_IDS 的順序；畫面「沒有找到」那一行也列這幾項）：
 *   問題（一）的答案只看錯字、套語與驚嘆號（不看字數與開頭；分號分列素材的要點是正常寫法）。
 *   題型不明時不看字數（不知道該用哪一個門檻）。
 *   給了 text 時只列真的檢查得到的：不超過附段落上限（250 字）的片段看不出整篇多長，不看字數；只有一段時不看開頭。
 */
export function zhDraftCheckIdsFor(section: ZhSection, target: 'q1' | 'q2' = 'q2', text?: string): ZhDraftCheckId[] {
  const lengthKnown = section === 'zh_writing_reason' || section === 'zh_writing_emotion';
  return ZH_DRAFT_CHECK_IDS.filter((id) => {
    if (id === 'length') return target === 'q2' && lengthKnown && (text === undefined || countZhChars(text).chars > ZH_TEXT_LIMITS.draftChars);
    if (id === 'opening_long') return target === 'q2' && (text === undefined || paragraphsOf(text).length >= 2);
    if (id === 'semicolon_chain') return target === 'q2';
    return true;
  });
}

/**
 * 字數的提醒門檻（漢字數，不含標點）：知性題問題（二）一般約 400 字；情意題的答案卷一面約 836 格（38 行 × 22 格，
 * 標點與分段空格也占格），漢字過了約 750 個就可能寫不完。
 */
export const ZH_DRAFT_LENGTH_NOTE = { reasonHan: 400, emotionHan: 750, sheetCells: 836 } as const;

/** 開頭太長的字數下限：首段超過 100 字（含標點）才檢查比例；結構卡建議 400 字的文章首段約 60 字。 */
export const ZH_DRAFT_OPENING_MIN_CHARS = 100;

/** 引用學生原文的字數上限。 */
const QUOTE_MAX = 12;

export interface ZhTypoRule {
  wrong: string;
  right: string;
  re: RegExp;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function typo(wrong: string, right: string, re?: RegExp): ZhTypoRule {
  return { wrong, right, re: re ?? new RegExp(escapeRe(wrong), 'gu') };
}

/**
 * 常見錯字（錯的寫法 → 正確寫法）：只收在任何上下文都不會是正確寫法的組合，兩可寫法（zhIsFormEither，例如台／臺、
 * 了解／瞭解）一律不收。會和正確的詞相連的三組另外限制前後文：
 *   一但  只在句首、標點之後，或接在「如果、只要、因為、尤其、我們、而且…」這類詞後面才算（「唯一但書」「考第一但不驕傲」
 *         「合而為一但」「其一但求溫飽」不算）。
 *   私毫  前面是「自、無、徇、隱、濟、藏、謀…」時是「自私毫不…」「假公濟私毫無…」這類兩個詞相連，不算。
 *   苦腦  後面是「海、袋、筋、中、裡…」時是「痛苦腦海」「痛苦腦中」這類兩個詞相連，不算。
 */
export const ZH_COMMON_TYPOS: readonly ZhTypoRule[] = [
  typo('重蹈覆徹', '重蹈覆轍'),
  typo('千律一篇', '千篇一律'),
  typo('誠墾', '誠懇'),
  typo('私毫', '絲毫', /(?<![自無徇隱營走公偏循濟藏謀護家陰緝滅])私毫/gu),
  typo('苦腦', '苦惱', /苦腦(?![海袋筋力部子汁門殼中裡內際])/gu),
  typo('津津計較', '斤斤計較'),
  typo('不可獲缺', '不可或缺'),
  typo('濫殤', '濫觴'),
  typo('一但', '一旦', /(?<=^|[\s\p{P}果要們人我你他她它而且若]|因為|尤其)一但(?!書)/gu),
  typo('再接再勵', '再接再厲'),
  typo('迫不急待', '迫不及待'),
  typo('一股作氣', '一鼓作氣'),
  typo('談笑風聲', '談笑風生'),
  typo('默守成規', '墨守成規'),
  typo('甘敗下風', '甘拜下風'),
  typo('走頭無路', '走投無路'),
  typo('鬼鬼崇崇', '鬼鬼祟祟'),
  typo('變本加利', '變本加厲'),
  typo('世外桃園', '世外桃源'),
  typo('名列前矛', '名列前茅'),
  typo('自抱自棄', '自暴自棄'),
  typo('一愁莫展', '一籌莫展'),
  typo('美輪美煥', '美輪美奐'),
  typo('金壁輝煌', '金碧輝煌'),
  typo('出奇不意', '出其不意'),
  typo('相形見拙', '相形見絀'),
  typo('穿流不息', '川流不息'),
  typo('迫在眉捷', '迫在眉睫'),
  typo('嘔心歷血', '嘔心瀝血'),
  typo('啼笑偕非', '啼笑皆非'),
  typo('迄立不搖', '屹立不搖'),
  typo('鞠躬盡粹', '鞠躬盡瘁'),
  typo('戰戰競競', '戰戰兢兢'),
  typo('不甚枚舉', '不勝枚舉'),
  typo('無遠弗界', '無遠弗屆'),
  typo('震憾', '震撼'),
];

export interface ZhClicheGroup {
  id: 'generic' | 'saying' | 'insight' | 'ending';
  patterns: readonly RegExp[];
  /** 這一組的建議（接在學生的字後面；組與組之間用「；」連接，所以這裡只用逗號）。 */
  advice_zh: string;
}

/**
 * 套語（本站自寫的清單）：放進哪一篇文章都說得通的說法，依用途分組，各給一句建議。只收常見的通用說法，不收任何作品的句子；
 * 名言本身不算套語（引用另有 AI 的檢核）。「有句話說」只抓開頭引語的用法（後面接冒號、逗號或引號，或「說得好」），
 * 「爺爺有一句話說了一輩子」這類敘事不算。
 */
export const ZH_CLICHE_GROUPS: readonly ZhClicheGroup[] = [
  {
    id: 'generic',
    patterns: [
      /隨著(?:時代|科技|社會|網路)的?(?:進步|變遷|發展|發達)/gu,
      /在這個(?:瞬息萬變|資訊爆炸|科技發達|日新月異)的(?:時代|社會|世界)/gu,
      /光陰似箭|時光飛逝|歲月如梭/gu,
      /人生就像一(?:場|條|本|首|齣)/gu,
    ],
    advice_zh: '這類句子放進哪篇文章都說得通，換成題目的情境，或你親眼看到的一件事',
  },
  {
    id: 'saying',
    patterns: [
      /俗話說得好|常言道/gu,
      /古人(?:云|說得好)/gu,
      /有(?:一)?句(?:名言|話)(?:說得好|是這(?:樣|麼)說的)|有(?:一)?句(?:名言|話)說(?=[：:，,「『])/gu,
      /失敗[為是]成功之母/gu,
      /天下無難事|世上無難事|只怕有心人/gu,
    ],
    advice_zh: '這類現成的話人人都會用，直接說出你自己的看法，再用一件事支持它',
  },
  {
    id: 'insight',
    patterns: [/讓我(?:受益良多|受益匪淺|獲益良多|學到了很多|學到很多)/gu, /我(?:深深|真正)[地的]?(?:體會|感受|明白)到/gu],
    advice_zh: '這類句子只說有收穫，直接寫出你明白了什麼，扣回前面那件事',
  },
  {
    id: 'ending',
    patterns: [/讓我們一起(?:努力|加油)/gu, /綜上所述/gu],
    advice_zh: '這類收尾的套話不必寫，用一句話回到你的主張或開頭就好',
  },
];

/** 全部的套語樣式（不分組）。 */
export const ZH_CLICHE_PATTERNS: readonly RegExp[] = ZH_CLICHE_GROUPS.flatMap((g) => g.patterns);

/** 成對的括號與引號（開 → 收）：引文要成對，對話裡的句末標點不分句。 */
const PAIRS: Readonly<Record<string, string>> = { '「': '」', '『': '』', '“': '”', '（': '）', '(': ')' };
const CLOSERS = new Set(Object.values(PAIRS));
/** 對話與引文的引號（不含括號）。 */
const QUOTE_OPEN = new Set(['「', '『', '“']);
const QUOTE_CLOSE = new Set(['」', '』', '”']);

/** 片段裡沒有配對的括號或引號的位置（由小到大）。 */
function unmatchedAt(chars: readonly string[]): number[] {
  const open: number[] = [];
  const bad: number[] = [];
  chars.forEach((ch, i) => {
    if (ch in PAIRS) open.push(i);
    else if (CLOSERS.has(ch)) {
      const top = open.at(-1);
      if (top !== undefined && PAIRS[chars[top]!] === ch) open.pop();
      else bad.push(i);
    }
  });
  return [...bad, ...open].sort((a, b) => a - b);
}

/**
 * 學生原文的一段引文：超過 12 字時取開頭（tail 時取結尾）並加「…」。截出來的括號或引號沒有成對時，
 * 開頭版從第一個沒配對的符號前截斷、結尾版從最後一個之後開始；截完沒有字時改成只拿掉那幾個符號。
 */
function clip(text: string, from: 'head' | 'tail' = 'head'): string {
  const all = [...text.trim()];
  let chars = all.length <= QUOTE_MAX ? all : from === 'head' ? all.slice(0, QUOTE_MAX - 1) : all.slice(all.length - (QUOTE_MAX - 1));
  const bad = unmatchedAt(chars);
  if (bad.length > 0) {
    const cut = from === 'head' ? chars.slice(0, bad[0]) : chars.slice(bad.at(-1)! + 1);
    chars = /[\p{L}\p{N}]/u.test(cut.join('')) ? cut : chars.filter((_, i) => !bad.includes(i));
  }
  const s = chars.join('').trim();
  if (chars.length === all.length) return s;
  return from === 'head' ? `${s}…` : `…${s}`;
}

/** 段落：以換行分開，去掉每段前後的空白與全形空格（段首縮排），空行不算。 */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/u)
    .map((p) => p.replace(/^[\s　]+|[\s　]+$/gu, ''))
    .filter((p) => p !== '');
}

/**
 * 句子：以句號、驚嘆號、問號或換行分開；引號（「」『』“”）裡的句末標點不分句（對話留在同一句），
 * 句末標點後面緊接的句末標點、收引號與收括號也留在這一句。換行時引號重新計算。
 */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  const chars = [...text];
  let cur = '';
  let depth = 0;
  const push = () => {
    if (cur.trim() !== '') out.push(cur.trim());
    cur = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '\n') {
      push();
      depth = 0;
      continue;
    }
    cur += ch;
    if (QUOTE_OPEN.has(ch)) depth++;
    else if (QUOTE_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[。！？!?]/u.test(ch)) {
      while (i + 1 < chars.length && /[。！？!?」』”）)]/u.test(chars[i + 1]!)) cur += chars[++i]!;
      push();
    }
  }
  push();
  return out;
}

/** 拿掉引號（「」『』“”）裡的文字（對話與引文不算學生自己的語氣）；沒有收引號時到那一行結束為止。 */
function outsideQuotes(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '\n') {
      depth = 0;
      out += ch;
    } else if (QUOTE_OPEN.has(ch)) depth++;
    else if (QUOTE_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

const EXCLAMATION_RE = /[！!]/gu;

function finding(id: ZhDraftCheckId, detail_zh: string): ZhDraftFinding {
  return { id, label_zh: ZH_DRAFT_CHECK_INFO[id].label_zh, detail_zh, code: ZH_DRAFT_CHECK_INFO[id].code };
}

function lengthCheck(text: string, section: ZhSection): ZhDraftFinding | null {
  const han = countZhChars(text).han;
  const N = ZH_DRAFT_LENGTH_NOTE;
  if (section === 'zh_writing_reason' && han > N.reasonHan) {
    return finding('length', `漢字已有 ${han} 個，超過知性題問題（二）一般的約 ${N.reasonHan} 字；先對照題目的字數規定，刪掉重複的說明。`);
  }
  if (section === 'zh_writing_emotion' && han > N.emotionHan) {
    return finding('length', `漢字已有 ${han} 個；答案卷一面約 ${N.sheetCells} 格，標點和分段空格也占格，再寫下去可能寫不完。`);
  }
  return null;
}

/** 開頭太長的建議：知性照結構卡「首段兩句點題」，情意照「開頭的場景兩三句就帶到題目」，題型不明用通用的說法。 */
const OPENING_ADVICE: Partial<Record<ZhSection, string>> = {
  zh_writing_reason: '開頭兩句內點題',
  zh_writing_emotion: '開頭的場景兩三句就帶到題目',
};

function openingCheck(paragraphs: readonly string[], section: ZhSection): ZhDraftFinding | null {
  if (paragraphs.length < 2) return null;
  const counts = paragraphs.map((p) => countZhChars(p).chars);
  const total = counts.reduce((a, b) => a + b, 0);
  const first = counts[0]!;
  if (first <= ZH_DRAFT_OPENING_MIN_CHARS || first * 3 <= total) return null;
  const pct = Math.round((first / total) * 100);
  const advice = OPENING_ADVICE[section] ?? '開頭寫短、早點帶到題目';
  return finding('opening_long', `首段「${clip(paragraphs[0]!)}」有 ${first} 字，占你附的文字的 ${pct}%；${advice}，把篇幅留給本文。`);
}

function typoCheck(text: string): ZhDraftFinding | null {
  // search 一律從頭找、不動 lastIndex（樣式帶 g 旗標，test 會記住上一次的位置）。附的段落最多 250 字，每一組都列出來。
  const hits = ZH_COMMON_TYPOS.filter((t) => text.search(t.re) >= 0);
  if (hits.length === 0) return null;
  return finding('typo', `${hits.map((t) => `「${t.wrong}」應寫「${t.right}」`).join('；')}。`);
}

function clicheCheck(text: string): ZhDraftFinding | null {
  const found: { s: string; group: ZhClicheGroup }[] = [];
  for (const group of ZH_CLICHE_GROUPS) {
    for (const re of group.patterns) {
      const m = text.match(re)?.[0];
      if (m !== undefined && !found.some((f) => f.s === m)) found.push({ s: m, group });
    }
  }
  if (found.length === 0) return null;
  const shown = found.slice(0, 2);
  const parts = ZH_CLICHE_GROUPS.map((g) => shown.filter((f) => f.group === g))
    .filter((fs) => fs.length > 0)
    .map((fs) => `${fs.map((f) => `「${clip(f.s)}」`).join('、')}${fs[0]!.group.advice_zh}`);
  return finding('cliche', `${parts.join('；')}。`);
}

function exclamationCheck(text: string, paragraphs: readonly string[], section: ZhSection, target: 'q1' | 'q2'): ZhDraftFinding | null {
  // 引號裡的對話與引文不算（「快跑！」是人物的話，不是學生的語氣）；全部附的文字合計，和方法卡「不超過 1 個」一致。
  const count = outsideQuotes(text).match(EXCLAMATION_RE)?.length ?? 0;
  if (count < 2) return null;
  const sentence = sentencesOf(text).find((s) => /[！!]/u.test(outsideQuotes(s))) ?? '';
  const where = paragraphs.length <= 1 ? '這一段有' : `你附的 ${paragraphs.length} 段共有`;
  const advice =
    target === 'q1' ? '問題（一）只整理素材的要點，用句號就好' : section === 'zh_writing_reason' ? '論述用句號就好，全篇最多留 1 個' : '情緒靠細節帶出來，全篇最多留 1 個';
  return finding('exclamation', `${where} ${count} 個驚嘆號（「${clip(sentence, 'tail')}」）：${advice}。`);
}

/** 分句：只在引號外的分號分開（引文裡的分號是別人的句子，不算學生的排比）。 */
function clausesOf(sentence: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of sentence) {
    if (QUOTE_OPEN.has(ch)) depth++;
    else if (QUOTE_CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[；;]/u.test(ch)) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.filter((c) => c.replace(/[\s。！？!?」』”）)]/gu, '') !== '');
}

function semicolonCheck(text: string, section: ZhSection): ZhDraftFinding | null {
  for (const sentence of sentencesOf(text)) {
    const clauses = clausesOf(sentence);
    if (clauses.length > 3) {
      const advice = section === 'zh_writing_emotion' ? '改寫成一個具體的畫面' : '刪成一句主張加一個具體的例子';
      return finding('semicolon_chain', `有一句用分號連了 ${clauses.length} 個分句（「${clip(clauses[0]!)}；…」）：排比三句就夠，再長就像口號；${advice}。`);
    }
  }
  return null;
}

/**
 * 學生附的段落的程式檢查（不送 AI、不花點數）。只檢查程式判斷得準的幾項（哪幾項要檢查見 zhDraftCheckIdsFor）：
 *   字數       知性題問題（二）漢字超過約 400、情意題超過約 750（答案卷約 836 格）；不超過附段落上限的片段不檢查。
 *   開頭太長   至少兩段，首段超過 100 字而且超過全部文字的三分之一。
 *   常見錯字   ZH_COMMON_TYPOS（每個錯的寫法列一次，全部列出）。
 *   套語       ZH_CLICHE_GROUPS（最多列 2 個，各附那一組的建議）。
 *   驚嘆號     全部附的文字合計 2 個以上（引號裡的對話與引文不算）。
 *   分號串排比 同一句在引號外用分號連了 4 個以上的分句（問題（一）的答案不檢查）。
 * 每一項最多一筆，依 ZH_DRAFT_CHECK_IDS 的順序（重要的在前），最多 ZH_DRAFT_CHECKS_MAX 筆。
 */
export function zhDraftChecks(text: string, section: ZhSection, opts: { target?: 'q1' | 'q2' } = {}): ZhDraftFinding[] {
  if (text.trim() === '') return [];
  const target = opts.target ?? 'q2';
  const paragraphs = paragraphsOf(text);
  const run: Record<ZhDraftCheckId, () => ZhDraftFinding | null> = {
    length: () => lengthCheck(text, section),
    opening_long: () => openingCheck(paragraphs, section),
    typo: () => typoCheck(text),
    cliche: () => clicheCheck(text),
    exclamation: () => exclamationCheck(text, paragraphs, section, target),
    semicolon_chain: () => semicolonCheck(text, section),
  };
  return zhDraftCheckIdsFor(section, target, text)
    .map((id) => run[id]())
    .filter((f): f is ZhDraftFinding => f !== null)
    .slice(0, ZH_DRAFT_CHECKS_MAX);
}
