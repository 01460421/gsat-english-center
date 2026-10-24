/**
 * 閱讀的答案位置調整（docs/design/bank-mock.md §5.3）。
 *
 * 題庫的閱讀題組幾乎每篇 4 題的答案剛好是 A、B、C、D 各一次，做出 3 題就能推出第 4 題。組卷端對「可以安全調整」的題目
 * 交換兩個選項的位置：建置時（scripts/lib/bank-mock-letters.mjs）已經列出可以交換的 (q, r) 組合寫進組卷池的 sw，
 * 條件包括 q 的中文解析沒有提到這兩個字母；這裡只負責「換不換、換哪一組」與實際交換。
 *
 *   - 這一篇的答案是 ABCD 排列、sw 不是空的，而且 FNV-1a(uid + ':' + 位置) 落在 15 分之 13 的範圍內，
 *     就從 sw 挑一組交換；保留約 15 分之 2 的篇章不換，不讓「每篇一定有重複」變成另一個可以利用的規律。
 *   - 交換 (q, r)：把 q 的正確選項和「r 的答案字母」那個位置的選項對調，q 的答案就變成 r 的字母，這一篇就有一個字母出現兩次。
 *     一起改的有 options 兩個位置的內容、answer（與 accepted_answers 裡的字母），以及解析裡以字母為鍵的
 *     option_notes_zh、option_codes、option_evidence。正確選項的文字在交換前後相同。
 *
 * 雜湊的輸入用題組的 uid 與它在代號裡的位置，不用 paperId（設計文件 §5.3 的修訂）：換題或改版會改變代號，
 * 用 paperId 的話其他沒變的閱讀題組也會換成不同的字母，紙本答案（從 PDF 進來的對答案）就對不上了；
 * 用 uid 與位置，同一篇在同一個位置永遠是同一個結果，結果仍然只由代號與題組內容決定。
 * 版本不進雜湊：same-key 的新版本答案與 sw 都相同（答案指紋包含整篇的 sw 與各題答案），一定得到相同的調整結果。
 *
 * 這套規則是 bk1 的一部分；改規則就要換成 bk2（letters.test.ts 有黃金測試鎖住輸出）。題庫練習不受影響。
 */
import type { ExplanationItem, PracticeGroupFile } from '../../../data/bank';
import type { ChoiceQuestion, OptionLetter, Question } from '../../../data/exams';
import { fnv1a } from './random';

const ABCD = ['A', 'B', 'C', 'D'] as const;

/** 15 個桶子裡有幾個要換。 */
const SWAP_BUCKETS = 13;
const ALL_BUCKETS = 15;

function asSingleChoice(q: Question | undefined): ChoiceQuestion | null {
  return q && q.mode === 'single_choice' ? q : null;
}

/** 這一篇 4 題的答案剛好是 A、B、C、D 各一次。 */
export function isAbcdPermutation(questions: readonly Question[]): boolean {
  if (questions.length !== 4) return false;
  const letters = questions.map((q) => (q.mode === 'single_choice' ? q.answer : null));
  return ABCD.every((l) => letters.includes(l));
}

/** 這個 (q, r) 能不能交換：都是四選一單選、答案不同、q 的選項有這兩個字母。 */
function swappable(questions: readonly Question[], [qNo, rNo]: readonly [number, number]): { q: ChoiceQuestion; x: OptionLetter; y: OptionLetter } | null {
  if (qNo === rNo) return null;
  const q = asSingleChoice(questions.find((x) => x.no === qNo));
  const r = asSingleChoice(questions.find((x) => x.no === rNo));
  if (!q || !r || !q.options) return null;
  const x = q.answer;
  const y = r.answer;
  if (x === y || q.options[x] === undefined || q.options[y] === undefined) return null;
  if (!ABCD.every((l) => q.options?.[l] !== undefined) || Object.keys(q.options).length !== 4) return null;
  return { q, x, y };
}

/**
 * 加強卷（bk2）的雜湊前綴（docs/design/weak-paper.md §7.1）：雜湊輸入是 `bk2:{uid}:{位置}`，位置是這一組在代號裡的序號。
 * 和 bk1 一樣只看題組與位置、不看整個代號（換題或改版時卷內其他題組的字母不變）；加前綴讓兩種格式的規則各自獨立。
 * 這條規則是 bk2 的一部分，改了就是 bk3（letters.test.ts 的黃金測試鎖住輸出）。
 */
export const BK2_LETTER_PREFIX = 'bk2:';

/**
 * 決定這一篇要不要換、換哪一組（題組內的原始題號）；不換回傳 null。
 * slotIndex 是這個題組在代號裡的位置（bk1 的閱讀是 5–7）。prefix 是雜湊前綴：bk1 是空字串（輸出不變），bk2 是 BK2_LETTER_PREFIX。
 * 出版社題組的 sw 一律是空陣列（建置端），自然不換。
 */
export function letterSwapFor(
  uid: string,
  slotIndex: number,
  questions: readonly Question[],
  sw: readonly (readonly [number, number])[],
  prefix = '',
): [number, number] | null {
  if (sw.length === 0 || !isAbcdPermutation(questions)) return null;
  const h = fnv1a(`${prefix}${uid}:${slotIndex}`);
  if (h % ALL_BUCKETS >= SWAP_BUCKETS) return null;
  const pair = sw[Math.floor(h / ALL_BUCKETS) % sw.length];
  if (!pair || !swappable(questions, pair)) return null;
  return [pair[0], pair[1]];
}

function swapKeys<T>(record: Partial<Record<OptionLetter, T>> | undefined, x: OptionLetter, y: OptionLetter): Partial<Record<OptionLetter, T>> | undefined {
  if (!record) return record;
  const out: Partial<Record<OptionLetter, T>> = {};
  for (const [key, value] of Object.entries(record) as [OptionLetter, T][]) {
    const to = key === x ? y : key === y ? x : key;
    out[to] = value;
  }
  // 照字母順序排，輸出穩定（快照、測試比對）。
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))) as Partial<Record<OptionLetter, T>>;
}

function swapItem(item: ExplanationItem | undefined, x: OptionLetter, y: OptionLetter): ExplanationItem | undefined {
  if (!item) return item;
  const out: ExplanationItem = { ...item };
  if (item.option_notes_zh) out.option_notes_zh = swapKeys(item.option_notes_zh, x, y);
  if (item.option_codes) out.option_codes = swapKeys(item.option_codes, x, y);
  if (item.option_evidence) out.option_evidence = swapKeys(item.option_evidence, x, y);
  return out;
}

/** 交換一組 (q, r)，回傳新的題組檔（不改原物件）。不能交換時原樣回傳。 */
export function applyLetterSwap(file: PracticeGroupFile, pair: readonly [number, number]): PracticeGroupFile {
  const found = swappable(file.group.questions, pair);
  if (!found) return file;
  const { q, x, y } = found;
  const swapLetter = (l: string): string => (l === x ? y : l === y ? x : l);
  const options = { ...q.options };
  options[x] = q.options?.[y];
  options[y] = q.options?.[x];
  const sortedOptions = Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)));
  const newQ: ChoiceQuestion = {
    ...q,
    options: sortedOptions,
    answer: y,
    accepted_answers: q.accepted_answers ? q.accepted_answers.map(swapLetter) : q.accepted_answers,
  };
  const key = String(q.no);
  const items = { ...file.annotations.explanations.items };
  const swappedItem = swapItem(items[key], x, y);
  if (swappedItem) items[key] = swappedItem;
  return {
    ...file,
    group: { ...file.group, questions: file.group.questions.map((item) => (item === q ? newQ : item)) },
    annotations: { ...file.annotations, explanations: { ...file.annotations.explanations, items } },
  };
}

/** 依 §5.3 調整一篇閱讀：回傳調整後的題組檔與實際交換的組合（沒換是 null）。prefix 見 letterSwapFor。 */
export function adjustReadingLetters(
  file: PracticeGroupFile,
  slotIndex: number,
  sw: readonly (readonly [number, number])[],
  prefix = '',
): { file: PracticeGroupFile; swap: [number, number] | null } {
  const swap = letterSwapFor(file.uid, slotIndex, file.group.questions, sw, prefix);
  return swap ? { file: applyLetterSwap(file, swap), swap } : { file, swap: null };
}
