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
import { countZhChars, type ZhErrorCode, type ZhSection } from './assist-zh';

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
    emotion_zh: '引導文的每個問題都是要件，逐條列出、各配一段；題目的意象要落在一件真實的事上，不只當成比喻。',
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
    title_zh: '結構：首段兩句點題，結尾回到開頭',
    point_zh: '開頭不要鋪陳太久，第二句就點題；本文每段照「主張→例子→說明→回扣」寫；結尾呼應開頭的畫面。',
    reason_zh: '400 字大約這樣配：首段 60、本文兩段各 140、結尾 60。首段超過全文三分之一就要刪。',
    emotion_zh: '用場景、轉折、體悟三到四段；結尾可以只留一行，回到開頭的那個畫面。',
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
 * 這個段落會檢查哪幾項（依 ZH_DRAFT_CHECK_IDS 的順序；畫面「沒有找到」那一行也列這幾項）：問題（一）的答案不看字數與開頭，
 * 題型不明時不看字數（不知道該用哪一個門檻）。
 */
export function zhDraftCheckIdsFor(section: ZhSection, target: 'q1' | 'q2' = 'q2'): ZhDraftCheckId[] {
  const lengthKnown = section === 'zh_writing_reason' || section === 'zh_writing_emotion';
  return ZH_DRAFT_CHECK_IDS.filter((id) => {
    if (id === 'length') return target === 'q2' && lengthKnown;
    if (id === 'opening_long') return target === 'q2';
    return true;
  });
}

/**
 * 字數的提醒門檻（漢字數，不含標點）：知性題問題（二）一般約 400 字；情意題的答案卷一面約 836 格（38 行 × 22 格，
 * 標點與分段空格也占格），漢字過了約 750 個就可能寫不完。
 */
export const ZH_DRAFT_LENGTH_NOTE = { reasonHan: 400, emotionHan: 750, sheetCells: 836 } as const;

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
 *   一但  只在句首、標點之後，或接在「如果、只要、因為、尤其、我們、而且…」這類詞後面才算（「唯一但書」「考第一但不驕傲」不算）。
 *   私毫  前面是「自、無、徇、隱…」時是「自私毫不…」這類兩個詞相連，不算。
 *   苦腦  後面是「海、袋、筋…」時是「痛苦腦海」這類兩個詞相連，不算。
 */
export const ZH_COMMON_TYPOS: readonly ZhTypoRule[] = [
  typo('重蹈覆徹', '重蹈覆轍'),
  typo('千律一篇', '千篇一律'),
  typo('誠墾', '誠懇'),
  typo('私毫', '絲毫', /(?<![自無徇隱營走公偏循])私毫/gu),
  typo('苦腦', '苦惱', /苦腦(?![海袋筋力部子汁門殼])/gu),
  typo('津津計較', '斤斤計較'),
  typo('不可獲缺', '不可或缺'),
  typo('濫殤', '濫觴'),
  typo('一但', '一旦', /(?<=^|[\s\p{P}果要為其們人我你他她它而且若])一但(?!書)/gu),
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

/**
 * 套語（本站自寫的清單）：放進哪一篇文章都說得通的開頭、引語與結尾。只收常見的通用說法，不收任何作品的句子；
 * 名言本身不算套語（引用另有 AI 的檢核）。
 */
export const ZH_CLICHE_PATTERNS: readonly RegExp[] = [
  /隨著(?:時代|科技|社會|網路)的?(?:進步|變遷|發展|發達)/gu,
  /在這個(?:瞬息萬變|資訊爆炸|科技發達|日新月異)的(?:時代|社會|世界)/gu,
  /俗話說得好|常言道/gu,
  /古人(?:云|說得好)/gu,
  /有(?:一)?句(?:名言|話)(?:說|是)/gu,
  /光陰似箭|時光飛逝|歲月如梭/gu,
  /人生就像一(?:場|條|本|首|齣)/gu,
  /失敗[為是]成功之母/gu,
  /天下無難事|世上無難事|只怕有心人/gu,
  /讓我(?:受益良多|受益匪淺|獲益良多|學到了很多|學到很多)/gu,
  /我(?:深深|真正)[地的]?(?:體會|感受|明白)到/gu,
  /讓我們一起(?:努力|加油)/gu,
  /綜上所述/gu,
];

/** 學生原文的一段引文：超過 12 字時取開頭（tail 時取結尾）並加「…」。 */
function clip(text: string, from: 'head' | 'tail' = 'head'): string {
  const chars = [...text.trim()];
  if (chars.length <= QUOTE_MAX) return chars.join('');
  return from === 'head' ? `${chars.slice(0, QUOTE_MAX - 1).join('')}…` : `…${chars.slice(chars.length - (QUOTE_MAX - 1)).join('')}`;
}

/** 段落：以換行分開，去掉每段前後的空白與全形空格（段首縮排），空行不算。 */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n+/u)
    .map((p) => p.replace(/^[\s　]+|[\s　]+$/gu, ''))
    .filter((p) => p !== '');
}

/** 句子：以句號、驚嘆號、問號或換行分開（句末的標點留在句子裡）。 */
function sentencesOf(text: string): string[] {
  return (text.match(/[^。！？!?\n]+[。！？!?]*/gu) ?? []).map((s) => s.trim()).filter((s) => s !== '');
}

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

function openingCheck(paragraphs: readonly string[]): ZhDraftFinding | null {
  if (paragraphs.length < 2) return null;
  const counts = paragraphs.map((p) => countZhChars(p).chars);
  const total = counts.reduce((a, b) => a + b, 0);
  const first = counts[0]!;
  if (first * 3 <= total) return null;
  const pct = Math.round((first / total) * 100);
  return finding('opening_long', `首段「${clip(paragraphs[0]!)}」有 ${first} 字，占你附的文字的 ${pct}%；開頭兩句內點題，把篇幅留給本文。`);
}

function typoCheck(text: string): ZhDraftFinding | null {
  // search 一律從頭找、不動 lastIndex（樣式帶 g 旗標，test 會記住上一次的位置）。
  const hits = ZH_COMMON_TYPOS.filter((t) => text.search(t.re) >= 0);
  if (hits.length === 0) return null;
  const shown = hits.slice(0, 3).map((t) => `「${t.wrong}」應寫「${t.right}」`);
  const more = hits.length > 3 ? `，另有 ${hits.length - 3} 處` : '';
  return finding('typo', `${shown.join('；')}${more}。`);
}

function clicheCheck(text: string): ZhDraftFinding | null {
  const found: string[] = [];
  for (const re of ZH_CLICHE_PATTERNS) {
    const m = text.match(re)?.[0];
    if (m !== undefined && !found.includes(m)) found.push(m);
  }
  if (found.length === 0) return null;
  const shown = found.slice(0, 2).map((s) => `「${clip(s)}」`).join('、');
  return finding('cliche', `${shown}這類句子放進哪篇文章都說得通；換成題目的情境，或你親眼看到的一件事。`);
}

function exclamationCheck(paragraphs: readonly string[], section: ZhSection): ZhDraftFinding | null {
  const index = paragraphs.findIndex((p) => (p.match(/[！!]/gu)?.length ?? 0) >= 2);
  if (index < 0) return null;
  const p = paragraphs[index]!;
  const count = p.match(/[！!]/gu)!.length;
  const where = paragraphs.length === 1 ? '這一段' : `第 ${index + 1} 段`;
  const sentence = sentencesOf(p).find((s) => /[！!]/u.test(s)) ?? '';
  const advice = section === 'zh_writing_reason' ? '論述用句號就好' : '情緒靠細節帶出來';
  return finding('exclamation', `${where}有 ${count} 個驚嘆號（「${clip(sentence, 'tail')}」）：${advice}，全篇最多留 1 個。`);
}

function semicolonCheck(text: string): ZhDraftFinding | null {
  for (const sentence of sentencesOf(text)) {
    const clauses = sentence.split(/[；;]/u).filter((c) => c.replace(/[\s。！？!?]/gu, '') !== '');
    if (clauses.length > 3) {
      return finding('semicolon_chain', `有一句用分號連了 ${clauses.length} 個分句（「${clip(clauses[0]!)}；…」）：排比一篇最多一組，改成一句主張加一個具體的例子。`);
    }
  }
  return null;
}

/**
 * 學生附的段落的程式檢查（不送 AI、不花點數）。只檢查程式判斷得準的幾項：
 *   字數       知性題問題（二）漢字超過約 400、情意題超過約 750（答案卷約 836 格）；問題（一）的答案不檢查（輸入已限制 80 字）。
 *   開頭太長   至少兩段，而且首段超過全部文字的三分之一（問題（一）的答案不檢查）。
 *   常見錯字   ZH_COMMON_TYPOS（每個錯的寫法只列一次，最多列 3 組）。
 *   套語       ZH_CLICHE_PATTERNS（最多列 2 個）。
 *   驚嘆號     同一段有 2 個以上。
 *   分號串排比 同一句用分號連了 4 個以上的分句。
 * 每一項最多一筆，依 ZH_DRAFT_CHECK_IDS 的順序（重要的在前），最多 ZH_DRAFT_CHECKS_MAX 筆。
 */
export function zhDraftChecks(text: string, section: ZhSection, opts: { target?: 'q1' | 'q2' } = {}): ZhDraftFinding[] {
  if (text.trim() === '') return [];
  const paragraphs = paragraphsOf(text);
  const run: Record<ZhDraftCheckId, () => ZhDraftFinding | null> = {
    length: () => lengthCheck(text, section),
    opening_long: () => openingCheck(paragraphs),
    typo: () => typoCheck(text),
    cliche: () => clicheCheck(text),
    exclamation: () => exclamationCheck(paragraphs, section),
    semicolon_chain: () => semicolonCheck(text),
  };
  return zhDraftCheckIdsFor(section, opts.target)
    .map((id) => run[id]())
    .filter((f): f is ZhDraftFinding => f !== null)
    .slice(0, ZH_DRAFT_CHECKS_MAX);
}
