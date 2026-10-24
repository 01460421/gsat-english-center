// @ts-check
/**
 * 本站自組模擬考（docs/design/bank-mock.md）的建置端：閱讀的可交換題目（§5.3 的 sw）與每題的答案指紋（§4.7 的 k、prev）。
 *
 * bank-mock-pool.mjs 呼叫這裡的函式，結果寫進 bank/mock-pool.json；前端 features/mock/bank/letters.ts 依 sw 交換選項位置，
 * status.ts 依 k 與 prev 判斷舊代號裡的版本是 current、same-key 還是 key-changed。這個模組沒有副作用（不讀檔、不寫檔）。
 *
 * 輸入是「題組形狀」的物件：題庫原始檔（data/bank/v1）或題庫練習的公開題組檔（bank/groups/{uid}@{v}.json）都可以，
 * 兩者的 group.questions、group.options_bank 與 annotations.explanations.items 是同樣的欄位（公開檔只是白名單挑過），
 * 所以目前版本用公開檔算、舊版本用原始檔算，得到的指紋可以直接比對。
 *
 * 可交換的條件（§5.3，判斷刻意從寬：寧可少換幾題，也不能換錯）：
 *   - q 是 4 個選項（A–D）的單選題，答案在 A–D；選項不是數字或年份的排列；選項沒有指向其他選項的字母
 *     （例如 "Both A and B"；"Text A"、"Writer B" 這類指的是文章，不算）或位置（"all of the above"）。
 *   - r 是同一篇的另一題（單選、答案在 A–D），答案字母和 q 不同；交換後這一篇每個字母最多出現兩次（出題規格「同一篇同字母 ≤ 2」）。
 *     答案是 ABCD 排列的篇章一定符合（一個字母出現兩次、一個沒出現）。
 *   - q 的中文欄位（explanation_zh、strategy_zh、hints、option_notes_zh 的內容）沒有提到這兩個字母。
 *     英文的 evidence、option_evidence 是文章原句，不是字母指稱，不檢查。
 * 前端只對答案是 ABCD 排列的篇章套用；sw 對每個閱讀題組都照同一套規則算，指紋才穩定。
 */
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊（規則改了，組卷池就會變）。 */
export const BANK_MOCK_LETTERS_SCRIPT = fileURLToPath(import.meta.url);

/** 可以交換的選項代號（閱讀每題 4 個選項）。 */
export const SWAP_LETTERS = /** @type {const} */ (['A', 'B', 'C', 'D']);
/** 交換後同一篇同一個字母最多出現幾次（出題規格 RD-FMT-03）。 */
const MAX_SAME_LETTER = 2;
/** 指紋長度（十六進位字元數；§4.7：每題 4 位）。 */
export const FINGERPRINT_HEX = 4;

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {[number, number]} SwapPair  [q, r]：把 q 的正確選項和 r 的答案字母那個位置的選項對調（題組內的題號）
 * @typedef {{ group?: unknown, annotations?: unknown }} GroupLike
 */

/** @param {unknown} v @returns {v is JsonObject} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {GroupLike} file @returns {JsonObject[]} */
function questionsOf(file) {
  const g = file.group;
  return isObject(g) && Array.isArray(g.questions) ? /** @type {JsonObject[]} */ (g.questions.filter(isObject)) : [];
}

/** @param {GroupLike} file @returns {Record<string, JsonObject>} */
function explanationItems(file) {
  const a = file.annotations;
  const items = isObject(a) && isObject(a.explanations) && isObject(a.explanations.items) ? a.explanations.items : {};
  return /** @type {Record<string, JsonObject>} */ (Object.fromEntries(Object.entries(items).filter(([, v]) => isObject(v))));
}

// ---------------------------------------------------------------------------
// 字母指稱
// ---------------------------------------------------------------------------

/** 全形 Ａ–Ｄ → 半形。 */
const FULLWIDTH = /** @type {Record<string, string>} */ ({ 'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D' });

/**
 * 文字裡提到的選項字母（A–D，含全形）：前後沒有緊鄰英文字母的 A–D 就算提到；只排除「A＋空格＋小寫英文字」這種英文冠詞。
 * 「(A)」「選項 B」「故選 C」「A、B 都錯」「Plan B」都算提到（從寬：多算只會少換幾題）。
 * @param {string} text
 * @param {{ articles?: boolean }} [options]  articles: false 時連冠詞的例外也不用（呼叫端已經自己拿掉冠詞）
 * @returns {Set<string>}
 */
export function mentionedLetters(text, { articles = true } = {}) {
  /** @type {Set<string>} */
  const out = new Set();
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    const letter = FULLWIDTH[ch] ?? (/^[A-D]$/.test(ch) ? ch : null);
    if (letter === null) continue;
    const prev = chars[i - 1] ?? '';
    const next = chars[i + 1] ?? '';
    if (/[A-Za-z]/.test(prev) || /[A-Za-z]/.test(next)) continue;
    // 英文冠詞：「A dog」「A great many」；全形Ａ不會是冠詞。
    if (articles && ch === 'A' && next === ' ' && /[a-z]/.test(chars[i + 2] ?? '')) continue;
    out.add(letter);
  }
  return out;
}

/**
 * q 的中文欄位裡所有的字串（§5.3：explanation_zh、strategy_zh、hints、option_notes_zh 的內容；鍵不算）。
 * @param {JsonObject | undefined} item
 * @returns {string[]}
 */
function chineseExplanationTexts(item) {
  if (!item) return [];
  /** @type {string[]} */
  const out = [];
  for (const key of ['explanation_zh', 'strategy_zh']) if (typeof item[key] === 'string') out.push(/** @type {string} */ (item[key]));
  if (Array.isArray(item.hints)) for (const h of item.hints) if (typeof h === 'string') out.push(h);
  if (isObject(item.option_notes_zh)) for (const n of Object.values(item.option_notes_zh)) if (typeof n === 'string') out.push(n);
  return out;
}

// ---------------------------------------------------------------------------
// 選項本身能不能換位置
// ---------------------------------------------------------------------------

/** 數字的英文寫法：選項「Two.」「Twice as many.」也算數字。 */
const NUMBER_WORDS = new Set([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'twenty', 'thirty',
  'forty', 'fifty', 'hundred', 'thousand', 'million', 'billion', 'half', 'twice', 'dozen',
]);
/** 數字選項除了數字之外最多還有幾個英文字（「About 4,000 hours.」「1 hour 15 minutes.」「In the 1930s.」）。 */
const NUMERIC_OPTION_MAX_WORDS = 3;

/**
 * 這個選項是不是「一個數字或年份」：有阿拉伯數字或數字的英文寫法，而且其他英文字不超過 NUMERIC_OPTION_MAX_WORDS 個。
 * @param {string} text
 */
export function isNumericOption(text) {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const numberWords = words.filter((w) => NUMBER_WORDS.has(w));
  const hasNumber = /\d/.test(text) || numberWords.length > 0;
  return hasNumber && words.length - numberWords.length <= NUMERIC_OPTION_MAX_WORDS;
}

/** 指的是文章的某一部分（多文本的 Text A、Writer B），不是選項。 */
const PASSAGE_PART_REFERENCE = /\b(?:Text|Texts|Writer|Writers|Passage|Part|Paragraph|Section|Letter|Person|Speaker|Student|Chart|Table|Figure|Group|Plan|Type|Option)\s+[A-D]\b/g;
/**
 * 選項裡的英文冠詞 A（「A UN study」「A Swede could…」「A great many」）：後面接小寫字或兩個字母以上的大寫開頭字。
 * 「A and B」「Only A is true」的 A 後面是 and、or、is 之類的字，指的是選項，不算冠詞。
 */
const OPTION_ARTICLE = /(?<![A-Za-z])A (?!(?:and|or|nor|is|are|was|were|only|alone|both|together|too|also)\b)(?=[a-z]|[A-Z][A-Za-z])/g;
/** 依位置指稱其他選項的寫法。 */
const POSITION_REFERENCE = /\b(?:all|none|both|neither|either|each|any)\s+of\s+the\s+(?:above|below|options|choices|answers|following)\b|\bthe\s+(?:above|first|last)\s+(?:two|three)\b/i;

/**
 * 選項文字有沒有指向其他選項（"Both A and B"、"(A) and (C)"、"Only A is true"、"all of the above"）。
 * 「Text A」「Writer B」這類指的是文章、「A UN study」的 A 是冠詞，先拿掉再判斷字母；「Option A」一定指選項，直接判定為指稱。
 * @param {string} text
 */
export function referencesOtherOptions(text) {
  if (POSITION_REFERENCE.test(text)) return true;
  if (/\bOption\s+[A-D]\b/.test(text)) return true;
  return mentionedLetters(text.replace(PASSAGE_PART_REFERENCE, ' ').replace(OPTION_ARTICLE, ' '), { articles: false }).size > 0;
}

/** q 本身符合交換的條件（不看 r）：4 選項單選、答案在 A–D、選項不是數字排列也沒有指向其他選項。 @param {JsonObject} q */
function swappableQuestion(q) {
  if (q.mode !== 'single_choice' || typeof q.answer !== 'string' || !SWAP_LETTERS.includes(/** @type {never} */ (q.answer))) return false;
  if (!isObject(q.options)) return false;
  const keys = Object.keys(q.options).sort();
  if (keys.join('') !== SWAP_LETTERS.join('')) return false;
  const texts = Object.values(q.options);
  if (!texts.every((t) => typeof t === 'string')) return false;
  if (/** @type {string[]} */ (texts).every(isNumericOption)) return false;
  return !(/** @type {string[]} */ (texts).some(referencesOtherOptions));
}

/**
 * 一個閱讀題組可以交換的 (q, r) 組合（§5.3；q、r 是題組內的題號），依 q、r 排序。
 * 出版社題組（uid pb.…）一律是空陣列（docs/design/weak-paper.md §6.6）：交換是為了處理本站 AI 閱讀題「每篇答案剛好是
 * ABCD 各一次」的生成痕跡；出版社題是逐字授權、卷面標原卷題號，學生會拿出版社的答案對照，所以不調整答案位置。
 * @param {GroupLike & { uid?: unknown }} file
 * @returns {SwapPair[]}
 */
export function swappablePairs(file) {
  if (typeof file.uid === 'string' && file.uid.startsWith('pb.')) return [];
  const questions = questionsOf(file);
  const items = explanationItems(file);
  /** @type {Map<string, number>} 每個字母目前出現幾次 */
  const counts = new Map();
  for (const q of questions) if (typeof q.answer === 'string') counts.set(q.answer, (counts.get(q.answer) ?? 0) + 1);
  /** @type {SwapPair[]} */
  const pairs = [];
  for (const q of questions) {
    if (typeof q.no !== 'number' || !swappableQuestion(q)) continue;
    const from = /** @type {string} */ (q.answer);
    /** @type {Set<string>} */
    const mentioned = new Set();
    for (const t of chineseExplanationTexts(items[String(q.label)])) for (const l of mentionedLetters(t)) mentioned.add(l);
    if (mentioned.has(from)) continue;
    for (const r of questions) {
      if (r === q || typeof r.no !== 'number' || r.mode !== 'single_choice' || typeof r.answer !== 'string') continue;
      const to = r.answer;
      if (to === from || !SWAP_LETTERS.includes(/** @type {never} */ (to)) || mentioned.has(to)) continue;
      if ((counts.get(to) ?? 0) + 1 > MAX_SAME_LETTER) continue;
      pairs.push([q.no, r.no]);
    }
  }
  return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// ---------------------------------------------------------------------------
// 答案指紋
// ---------------------------------------------------------------------------

/** 順序不影響計分的字串清單：排序後比對；不是陣列時是 null。 @param {unknown} v */
const sortedList = (v) => (Array.isArray(v) ? v.map(String).sort() : null);

/** @param {unknown} value */
function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, FINGERPRINT_HEX);
}

/**
 * 每一題的答案指紋（§4.7），依題目順序。
 *   選擇題、混合題：題號、作答方式、選項數、答案（多選排序）、可接受答案、部分給分寫法、可對調的格、配分。
 *   閱讀另外加上**整篇**決定答案位置調整的資料：完整的 sw，以及每一題的作答方式與答案。前端（letters.ts）對整篇挑一組交換：
 *                   要不要換看整篇的答案是不是 ABCD 排列，換哪一組是 sw[雜湊 % sw.length]、交換後的字母是 r 的答案，
 *                   所以任何一題的答案或 sw 改了，都可能讓別題的實際答案字母跟著變。這部分放進每一題的指紋，
 *                   這種改版就是整篇四題都列為答案已更正（key-changed 不會漏列）；每題的指紋都相同時，
 *                   same-key 的新版本得到的答案位置調整也一定和舊版完全一樣（§5.3）。
 *   中譯英、作文：題號、題目文字、配分（學生在紙本上寫的就是這些題目）。
 * 選項與文章的文字不算：只改文字、答案代號不變的新版本，紙本的答案照樣能計分。
 * @param {string} sectionType
 * @param {GroupLike} file
 * @param {SwapPair[]} [sw]  閱讀的可交換組合（沒傳就現算）
 * @returns {string[]}
 */
export function answerFingerprints(sectionType, file, sw) {
  const questions = questionsOf(file);
  if (sectionType === 'translation' || sectionType === 'composition') {
    return questions.map((q) => fingerprint([q.label ?? null, q.stem ?? null, q.points ?? null]));
  }
  const g = /** @type {JsonObject} */ (file.group);
  const bankSize = isObject(g.options_bank) ? Object.keys(g.options_bank).length : 0;
  const items = explanationItems(file);
  /** @param {JsonObject} q */
  const answerOf = (q) => (Array.isArray(q.answer) ? q.answer.map(String).sort() : (q.answer ?? null));
  // 閱讀：整篇的答案位置調整只由 sw（照組卷池裡的順序，前端依索引挑）與每題的作答方式、答案決定（版本不進雜湊，見 letters.ts），
  // 每一題都帶著這一份。
  const passage =
    sectionType === 'reading'
      ? { sw: (sw ?? swappablePairs(file)).map(([q, r]) => [q, r]), answers: questions.map((q) => [q.no ?? null, q.mode ?? null, answerOf(q)]) }
      : null;
  return questions.map((q) => {
    const item = items[String(q.label)] ?? {};
    const optionCount = q.mode === 'bank_choice' ? bankSize : isObject(q.options) ? Object.keys(q.options).length : 0;
    return fingerprint([
      q.label ?? null,
      q.mode ?? null,
      optionCount,
      answerOf(q),
      sortedList(q.accepted_answers),
      sortedList(item.partial_credit_forms),
      item.interchangeable_with ?? null,
      q.points ?? null,
      passage ?? [],
    ]);
  });
}
