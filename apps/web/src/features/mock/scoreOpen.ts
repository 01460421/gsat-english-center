/**
 * 混合題的填充、簡答怎麼計分（設計文件 §6.6）。
 *
 * 能確定的才自動給分，其他交給學生自評，程式只提供「建議分數」：
 *   - 空白 → 0 分（自動）
 *   - 正規化後等於官方答案或可接受答案 → 滿分（自動）。填充題的大小寫要一樣：官方閱卷把句中的字寫成大寫開頭算字形錯誤、
 *     扣一半（115 學測 48 題的 Blended），所以只差大小寫時交給自評、預選一半；簡答題不看大小寫（句首大寫是對的）
 *   - 填充題只差大小寫 → 自評，預選一半
 *   - 填充題寫了兩個以上的單詞 → 0 分（自動；題目規定每格限填一個單詞，SPEC §4.6 設計值）
 *   - 其他 → 自評。依 2／1／0 原則先預選一個分數，學生看過官方答案後可以改：
 *       看起來是拼字錯誤（長度 ≥ 5、與答案的編輯距離 ≤ 2）或字形變化不對（同一個字根）→ 1 分
 *       答案外多寫了其他字詞 → 0 分
 *       和答案不同 → 0 分
 *
 * 2／1／0 原則用本站自己的話說明（不轉載官方評分原則）：完全正確 2 分；選對了字，但字形變化或拼字有誤 1 分；錯誤或空白 0 分。
 */
import type { Question } from '../../data/exams';
import type { AnswerValue } from '../exams/scoring';

/** 這個模組處理的題型（混合題的非選擇題）。 */
export type OpenQuestion = Extract<Question, { mode: 'fill_in_blank' | 'short_answer' }>;

export function isOpenQuestion(q: Question): q is OpenQuestion {
  return q.mode === 'fill_in_blank' || q.mode === 'short_answer';
}

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

/** 編輯距離（Levenshtein；單字很短，O(nm) 就夠）。 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** 常見的字尾（長的在前）：去掉之後比較字根，判斷是不是「同一個字、不同字形」。 */
const SUFFIXES = ['ation', 'ition', 'ment', 'ness', 'ing', 'ion', 'ive', 'ity', 'ies', 'ied', 'ed', 'es', 'er', 'ly', 'al', 's', 'e', 'y'];

/**
 * 粗略的字根候選：原字，以及去掉每一個符合的常見字尾後的結果（剩下至少 3 個字母），
 * 重複的結尾子音併成一個（stopped → stopp → stop）。innovative 與 innovation 都有 innovat。
 */
export function stemCandidates(word: string): Set<string> {
  const out = new Set<string>([word]);
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      out.add(word.slice(0, -suffix.length).replace(/([b-df-hj-np-tv-z])\1$/, '$1'));
    }
  }
  return out;
}

/** 字根相同（但不是同一個字）：blending／blended、innovative／innovation。片語不比。 */
export function sameStem(a: string, b: string): boolean {
  if (a === b || a.includes(' ') || b.includes(' ')) return false;
  const stems = stemCandidates(a);
  for (const s of stemCandidates(b)) if (stems.has(s)) return true;
  return false;
}

/**
 * 同一個字、不同字形（innovative／innovation、blending／blended、adapt／adapting）。
 * 先比字根；比不出來時退一步看字首：共同字首至少 4 個字母，而且兩邊在共同字首之後最多只剩 4 個字母。
 */
export function sameWordFamily(a: string, b: string): boolean {
  if (a === b || a.includes(' ') || b.includes(' ')) return false;
  if (sameStem(a, b)) return true;
  const prefix = commonPrefixLength(a, b);
  return prefix >= 4 && a.length - prefix <= 4 && b.length - prefix <= 4;
}

/** 官方答案與可接受答案（正規化前）。 */
export function officialAnswers(q: OpenQuestion): string[] {
  return [q.answer, ...(q.accepted_answers ?? [])].filter((a): a is string => typeof a === 'string' && a.trim() !== '');
}

export type OpenAssessment =
  | { kind: 'auto'; score: number; reason: 'blank' | 'match' | 'multi_word' | 'duplicate' }
  | { kind: 'self'; suggested: number; reason: 'capitalization' | 'spelling' | 'word_form' | 'extra_words' | 'different' | 'no_official' };

function answerText(value: AnswerValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 評估一題混合題非選擇題的作答。
 * usedElsewhere：同一個摘要句裡其他空格已經用掉、拿到分數的答案（正規化後）。
 * 例如 112 學測 47、48 兩格的答案可以對調（taste／health），兩格都寫 health 時第二格不能再自動給分。
 */
export function assessOpenAnswer(q: OpenQuestion, value: AnswerValue | undefined, usedElsewhere: ReadonlySet<string> = new Set()): OpenAssessment {
  const max = q.points ?? 0;
  const mineCased = normalizeOpenAnswerCased(answerText(value));
  const mine = mineCased.toLowerCase();
  if (mine === '') return { kind: 'auto', score: 0, reason: 'blank' };
  const official = officialAnswers(q);
  const answers = official.map(normalizeOpenAnswer);
  const half = Math.round((max / 2) * 100) / 100;
  if (answers.includes(mine)) {
    if (usedElsewhere.has(mine)) return { kind: 'auto', score: 0, reason: 'duplicate' };
    // 填充題要連大小寫都一樣才自動給滿分；只差大小寫（句中的字寫成 Blended）是字形錯誤，預選一半。
    if (q.mode === 'fill_in_blank' && !official.map(normalizeOpenAnswerCased).includes(mineCased)) return { kind: 'self', suggested: half, reason: 'capitalization' };
    return { kind: 'auto', score: max, reason: 'match' };
  }
  if (q.mode === 'fill_in_blank' && mine.split(' ').length >= 2) return { kind: 'auto', score: 0, reason: 'multi_word' };
  if (answers.length === 0) return { kind: 'self', suggested: 0, reason: 'no_official' };
  // 字根相同（blending／blended）是字形變化；字根不同但只差一兩個字母（enviroment）是拼字錯誤。
  if (answers.some((a) => sameStem(mine, a))) return { kind: 'self', suggested: half, reason: 'word_form' };
  if (mine.length >= 5 && answers.some((a) => editDistance(mine, a) <= 2)) return { kind: 'self', suggested: half, reason: 'spelling' };
  if (answers.some((a) => sameWordFamily(mine, a))) return { kind: 'self', suggested: half, reason: 'word_form' };
  const words = ` ${mine} `;
  if (answers.some((a) => words.includes(` ${a} `))) return { kind: 'self', suggested: 0, reason: 'extra_words' };
  return { kind: 'self', suggested: 0, reason: 'different' };
}

/**
 * 依題組順序評估所有混合題非選擇題（處理同一個摘要句裡答案可對調的情況）。
 * 回傳題號 → 評估結果。
 */
export function assessOpenGroup(questions: readonly Question[], answers: Readonly<Record<string, AnswerValue>>): Map<string, OpenAssessment> {
  const out = new Map<string, OpenAssessment>();
  const usedByStem = new Map<string, Set<string>>();
  for (const q of questions) {
    if (!isOpenQuestion(q)) continue;
    const key = q.stem ?? `#${q.label}`;
    const used = usedByStem.get(key) ?? new Set<string>();
    usedByStem.set(key, used);
    const result = assessOpenAnswer(q, answers[q.label], used);
    if (result.kind === 'auto' && result.reason === 'match') used.add(normalizeOpenAnswer(answerText(answers[q.label])));
    out.set(q.label, result);
  }
  return out;
}

/** 畫面上的說明（本站自己的話）。 */
export const OPEN_REASON_TEXT: Record<OpenAssessment['reason'], string> = {
  blank: '未作答，0 分。',
  match: '和官方答案（或可接受答案）相同，自動給滿分。',
  capitalization: '字選對了，但大小寫不對（例如句子中間的字寫成大寫開頭），算字形錯誤：先預選 1 分，請對照官方答案確認。',
  multi_word: '每格限填一個單詞，這格寫了兩個以上的字，0 分。',
  duplicate: '和同一句另一格的答案重複，這格不重複給分。',
  spelling: '可能是拼字錯誤：先預選 1 分，請對照官方答案確認。',
  word_form: '可能是字形變化不對（例如詞性、時態）：先預選 1 分，請對照官方答案確認。',
  extra_words: '答案外多寫了其他字詞：題目要的是文章裡的詞組，多寫或少寫通常不給分，先預選 0 分。',
  different: '和官方答案不同：先預選 0 分；如果你認為意思與寫法都正確，請自己改分數。',
  no_official: '這題沒有官方答案可以比對，請自行評分。',
};

/** 2／1／0 原則（本站自己的話）。 */
export const OPEN_RUBRIC: readonly { score: 'full' | 'half' | 'zero'; text: string }[] = [
  { score: 'full', text: '完全正確：字選對，字形變化與拼字也都正確。' },
  { score: 'half', text: '選對了字，但字形變化或拼字有誤。' },
  { score: 'zero', text: '答錯、空白，或寫了題目沒有要的字。' },
];
