/**
 * 拼字題的答案比對。
 *
 * 原則：只要是「同一個字的合理拼法」就算對，學生才不會因為跟拼字無關的差異被扣分：
 *   - 大小寫、前後空白、重音符號（cafe／café）、彎引號都不計；
 *   - 原表斜線列出的其他寫法算對（adviser／advisor、afterward／afterwards），常用複數形也算（chopstick(s)）；
 *   - 英式拼法算對（colour、centre、realise）：學測以美式為主，但英式拼法不是錯字。
 * 原表的衍生字（achieve(ment) 的 achievement）與代名詞的格（I／me）是不同的字，不算。
 */
import type { VariantInfo, VocabEntry } from '../../../data/vocab';
import { editDistance, normalizeWord } from './text';

/** 拼字題只出這幾級：課程手冊把拼寫範圍定在第一至第四級（03 文件 §9.1、§9.6）。 */
export const SPELLING_MAX_LEVEL = 4;

const ACCEPTED_VARIANT_TYPES: ReadonlySet<VariantInfo['type']> = new Set(['slash', 'plural_usual']);

/** 可接受的拼法（正規化後、去重）。第一個是標準答案。 */
export function acceptedSpellings(entry: Pick<VocabEntry, 'word' | 'variants' | 'variant_info'>): string[] {
  const types = new Map((entry.variant_info ?? []).map((v) => [v.form, v.type]));
  const out = [normalizeWord(entry.word)];
  for (const v of entry.variants) {
    const type = types.get(v);
    // 沒有 variant_info 的其他寫法（理論上不會發生）保守地接受：寧可多收一個合理拼法，也不要誤判學生錯。
    if (type === undefined || ACCEPTED_VARIANT_TYPES.has(type)) out.push(normalizeWord(v));
  }
  return [...new Set(out)];
}

/** 英式拼法轉美式的字尾規則。只在「轉完剛好等於答案」時才採用，所以不會把真正的錯字放過。 */
const BRITISH_SUFFIXES: readonly [RegExp, string][] = [
  [/our$/, 'or'], // colour, favour, behaviour
  [/ise$/, 'ize'], // realise, organise
  [/yse$/, 'yze'], // analyse
  [/tre$/, 'ter'], // centre, theatre, litre
  [/ence$/, 'ense'], // defence, licence
  [/ogue$/, 'og'], // catalogue
];

function americanize(word: string): string[] {
  return BRITISH_SUFFIXES.filter(([re]) => re.test(word)).map(([re, rep]) => word.replace(re, rep));
}

export interface SpellingResult {
  correct: boolean;
  /** 學生輸入（正規化後）。 */
  normalized: string;
  /** 答錯但只差一個字母：回饋時說「差一點」，鼓勵而不是只打叉。 */
  nearMiss: boolean;
}

export function checkSpelling(input: string, accepted: readonly string[]): SpellingResult {
  const normalized = normalizeWord(input);
  if (!normalized) return { correct: false, normalized, nearMiss: false };
  const answers = new Set(accepted.map(normalizeWord));
  const correct = answers.has(normalized) || americanize(normalized).some((w) => answers.has(w));
  const nearMiss = !correct && [...answers].some((a) => editDistance(a, normalized) === 1);
  return { correct, normalized, nearMiss };
}

/** 能不能出拼字題：只收純英文字母、3 個字母以上的字（T-shirt、Mr.、I 這類不出）。 */
export function isSpellable(entry: Pick<VocabEntry, 'word' | 'level'>): boolean {
  return entry.level <= SPELLING_MAX_LEVEL && /^[a-z]{3,}$/i.test(entry.word);
}

/** 拼字提示：第一個字母與字母數。 */
export function spellingHint(word: string): { first: string; length: number } {
  return { first: word.charAt(0).toLowerCase(), length: word.length };
}
