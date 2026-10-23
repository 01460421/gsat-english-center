/**
 * 選擇題的計分與填充、簡答的比對用正規化：網站（歷屆試題、真題模考、題庫練習、本站自組模擬考）與 Worker
 * （學習助手的對錯判定，docs/design/learning-assistant.md §4.5.3）共用同一支，學生在網站上看到的判定和學習助手一致。
 *
 * 從 apps/web/src/features/exams/scoring.ts（scoreQuestion、acceptedLetters、multiSelectFraction、isAnswered、
 * 題庫練習的填充比對 normalizeBankOpenAnswer）與 apps/web/src/features/mock/scoreOpen.ts（歷屆與模考的填充比對
 * normalizeOpenAnswer、normalizeOpenAnswerCased）搬來，行為逐位元不變；web 的兩個檔改成從這裡轉匯出。
 * 參數只要求計分用得到的欄位（mode、answer、accepted_answers、options、points、scoring_exception），
 * web 的 Question（data/exams.ts）與共用的 Question（exam.ts）都可以直接傳進來。
 *
 * 規則依 docs/research/02-gsat-english-spec.md §4.1（115 學測「選擇題計分方式」，111–114 同）：
 *   - 單選：答對得該題分數；答錯、未作答得 0 分。文意選填、篇章結構、句子配合（bank_choice）同單選。
 *   - 多選：n 個選項各自獨立判定，全對得滿分；答錯 k 個選項得 (n − 2k)/n 題分；低於 0 或全部未作答得 0 分。
 *   - 舊指考 91–99 原有倒扣，02 文件 §6.1 建議一律以現制計分，所以這裡沒有倒扣。
 * 填充、簡答、表格、中譯英、作文要人工（之後是 AI）批改，不自動計分，只列出配分。
 *
 * 計分例外（scoring_exception，schema 文件）：
 *   - all_credit：送分，不論作答內容（含未作答）都給滿分；
 *   - multiple_correct：官方公告的其他答案（accepted_answers）也給分；
 *   - other：照正常規則計分，畫面上顯示官方說明。
 * accepted_answers 在選擇題出現時（例如 gsat-84 第 45 題）即使還沒標 scoring_exception 也當成可接受答案：
 * 欄位的定義就是「評分原則列出的其他可接受答案」，資料補標之前先照官方答案給分，學生才不會被誤判。
 */

/** 作答內容：單選、選項庫是字母；多選是字母陣列；表格填寫是每個待填格依序的字串；其他是文字。 */
export type AnswerValue = string | readonly string[];

export type AutoStatus = 'correct' | 'partial' | 'wrong' | 'unanswered' | 'all_credit';

export interface AutoOutcome {
  kind: 'auto';
  max: number;
  earned: number;
  status: AutoStatus;
  /** 多選題答錯的選項數 k；單選是 null。 */
  wrongOptions: number | null;
}

export interface ManualOutcome {
  kind: 'manual';
  max: number;
  answered: boolean;
}

export type QuestionOutcome = AutoOutcome | ManualOutcome;

/** 計分用得到的欄位（其他欄位不看）。 */
interface ScorableBase {
  points?: number | null;
  /** 只看有幾個選項（多選題的 n）。 */
  options?: object | null;
  accepted_answers?: readonly string[] | null;
  scoring_exception?: { type: string } | null;
}

/** 單選與選項庫（文意選填、篇章結構、句子配合）：答案是一個選項代號。 */
export interface SingleChoiceScorable extends ScorableBase {
  mode: 'single_choice' | 'bank_choice';
  answer: string;
}

/** 多選：答案是選項代號陣列。 */
export interface MultiSelectScorable extends ScorableBase {
  mode: 'multi_select';
  answer: readonly string[];
}

/** 不自動計分的題型：只記配分與有沒有作答。 */
export interface ManualScorable extends ScorableBase {
  mode: 'fill_in_blank' | 'short_answer' | 'table_completion' | 'translation' | 'composition';
}

/** scoreQuestion 收的小題：以 mode 區分（web 與共用的 Question 都是它的子型別）。 */
export type ScorableQuestion = SingleChoiceScorable | MultiSelectScorable | ManualScorable;

const LETTER = /^[A-O]$/;

/** 單選題可得分的選項：官方答案，加上 accepted_answers 裡的其他選項代號。 */
export function acceptedLetters(q: SingleChoiceScorable): string[] {
  const extra = (q.accepted_answers ?? []).map((a) => a.trim().toUpperCase()).filter((a) => LETTER.test(a));
  return Array.from(new Set([q.answer, ...extra]));
}

/**
 * 多選題得分比例。n：選項數；correct：正確選項；chosen：考生選的選項。
 * 每個選項獨立判定：該選沒選、不該選卻選了，都算答錯一個（k）。
 */
export function multiSelectFraction(
  n: number,
  correct: readonly string[],
  chosen: readonly string[],
): { fraction: number; wrong: number } {
  const want = new Set(correct);
  const got = new Set(chosen);
  let wrong = 0;
  for (const letter of want) if (!got.has(letter)) wrong += 1;
  for (const letter of got) if (!want.has(letter)) wrong += 1;
  if (got.size === 0 || n <= 0) return { fraction: 0, wrong };
  return { fraction: Math.max(0, (n - 2 * wrong) / n), wrong };
}

/** 作答內容是否「有寫」：空字串、空陣列、表格全空都算沒作答。 */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return value.some((v) => v.trim() !== '');
}

function asLetter(value: AnswerValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asLetters(value: AnswerValue | undefined): string[] {
  if (value === undefined) return [];
  return (typeof value === 'string' ? [value] : [...value]).filter((v) => v !== '');
}

export function scoreQuestion(q: ScorableQuestion, value: AnswerValue | undefined): QuestionOutcome {
  const max = q.points ?? 0;
  if (q.mode !== 'single_choice' && q.mode !== 'bank_choice' && q.mode !== 'multi_select') return { kind: 'manual', max, answered: isAnswered(value) };
  if (q.scoring_exception?.type === 'all_credit') {
    return { kind: 'auto', max, earned: max, status: 'all_credit', wrongOptions: null };
  }
  if (q.mode === 'multi_select') {
    const chosen = asLetters(value);
    const n = Object.keys(q.options ?? {}).length;
    const { fraction, wrong } = multiSelectFraction(n, q.answer, chosen);
    const status: AutoStatus = chosen.length === 0 ? 'unanswered' : fraction === 1 ? 'correct' : fraction > 0 ? 'partial' : 'wrong';
    return { kind: 'auto', max, earned: max * fraction, status, wrongOptions: wrong };
  }
  const chosen = asLetter(value);
  if (chosen === null) return { kind: 'auto', max, earned: 0, status: 'unanswered', wrongOptions: null };
  const ok = acceptedLetters(q).includes(chosen);
  return { kind: 'auto', max, earned: ok ? max : 0, status: ok ? 'correct' : 'wrong', wrongOptions: null };
}

// ---------------------------------------------------------------------------
// 填充、簡答的比對用正規化
//
// 兩套規則，對應網站上兩種判分（學生看到的判定是哪一套，學習助手就用哪一套）：
//   - normalizeOpenAnswer／normalizeOpenAnswerCased：歷屆試題與真題模考的混合題（features/mock/scoreOpen.ts 的
//     assessOpenAnswer）。官方只公布部分可接受答案，填充題只差大小寫算字形錯誤。
//   - normalizeBankOpenAnswer：題庫練習與自組卷（features/exams/scoring.ts 的 scoreOpenAnswer）。可接受答案是
//     完整清單，另外去掉學生照抄片語時常帶上的引號與結尾標點。
// ---------------------------------------------------------------------------

const CIRCLED_DIGITS: Record<string, string> = { '❶': '1', '❷': '2', '❸': '3', '❹': '4', '❺': '5', '❻': '6', '❼': '7' };

/**
 * 比對用的正規化（保留大小寫）：去頭尾空白、壓縮空白、彎引號換直引號、句尾句點不計、❶–❼ 視同 1–7。
 * 全形英數字也換成半形（中文輸入法容易打成全形）。
 */
export function normalizeOpenAnswerCased(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[❶-❼]/g, (c) => CIRCLED_DIGITS[c] ?? c)
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .replace(/[.。]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 比對用的正規化：同 normalizeOpenAnswerCased，再不計大小寫。 */
export function normalizeOpenAnswer(text: string): string {
  return normalizeOpenAnswerCased(text).toLowerCase();
}

/** 圈號數字（①–⑳、❶–❿、➀–➉、➊–➓）→ 阿拉伯數字。 */
function circledDigit(ch: string): string | null {
  const c = ch.codePointAt(0) ?? 0;
  const ranges: [number, number][] = [
    [0x2460, 0x2473],
    [0x2776, 0x277f],
    [0x2780, 0x2789],
    [0x278a, 0x2793],
  ];
  for (const [from, to] of ranges) if (c >= from && c <= to) return String(c - from + 1);
  return null;
}

/** 結尾的標點（NFKC 之後全形的，！？；：已經是半形）：照抄片語時常帶上句子裡的逗號、驚嘆號。 */
const TRAILING_PUNCTUATION = /[.,!?;:。、]+$/u;
/** 包住整個答案的雙引號與中文引號：英文答案裡不會有意義，頭尾各自去掉（不必成對）。 */
const WRAPPING_QUOTES = /^["「『]+|["」』]+$/gu;

/**
 * 去掉包住答案的引號與結尾標點，直到不再變：「"come up with,"」「"Come up with"!」都會變成 come up with。
 * 單引號只在頭尾成對時才去掉：結尾的 ' 可能是答案的一部分（students' 的所有格、'til）。
 */
function stripWrapping(text: string): string {
  let out = text.trim();
  for (;;) {
    let next = out.replace(TRAILING_PUNCTUATION, '').trim().replace(WRAPPING_QUOTES, '').trim();
    if (next.length >= 2 && next.startsWith("'") && next.endsWith("'")) next = next.slice(1, -1).trim();
    if (next === out) return out;
    out = next;
  }
}

/**
 * 題庫練習的填充、簡答比對（SPEC §4.6 的正規化）：去頭尾空白、連續空白算一個、統一引號、不分大小寫（句首大寫不計）、
 * 去掉包住答案的引號與結尾的標點（句點、逗號、驚嘆號、問號、分號、冒號；學生在輸入框照抄片語時常帶上），
 * 圈號數字等於阿拉伯數字；全形英數字（ｔｕｒｎｓ）也當成半形（NFKC）。
 * 可接受答案、部分給分寫法與學生的答案都用同一個正規化再比對，拼字錯誤的編輯距離也是比正規化後的字串。
 * （web 的 features/exams/scoring.ts 以原本的名稱 normalizeOpenAnswer 轉匯出。）
 */
export function normalizeBankOpenAnswer(text: string): string {
  const unified = Array.from(text.normalize('NFKC'))
    .map((ch) => circledDigit(ch) ?? ch)
    .join('')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"');
  return stripWrapping(unified).replace(/\s+/g, ' ').toLowerCase();
}
