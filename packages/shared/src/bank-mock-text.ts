/**
 * 本站自組模擬考（docs/design/bank-mock.md §5.2、§5.3）的題號重編與字母交換：網站組卷與 Worker（學習助手把題組換成
 * 學生卷面上的題號與字母，docs/design/learning-assistant.md §4.5.2）共用的純函式。
 *
 *   replaceMarkers、replaceBlankRefs、RenumberError：從 apps/web/src/features/mock/bank/renumber.ts 搬來，行為不變
 *     （renumber.ts 改成從這裡匯入；renumber.test.ts 的黃金資料照樣通過）。
 *   swapAnswerLetters：新寫的「只換一題」版本。web 的 applyLetterSwap（letters.ts）依賴整個題組檔與藍圖，不搬；
 *     兩者是同一個規則，web 的 letters.test.ts 對每一組可交換的題比對兩邊的結果。
 */
import type { ExplanationItem } from './bank';

export class RenumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenumberError';
  }
}

/** 把字串裡的 [[n]] 換成新題號；舊題號不在對照表裡就丟出錯誤。 */
export function replaceMarkers(text: string, numbers: ReadonlyMap<number, number>, where = ''): string {
  return text.replace(/\[\[(\d+)\]\]/g, (_, n: string) => {
    const to = numbers.get(Number(n));
    if (to === undefined) throw new RenumberError(`${where}有指向題組外的空格記號 [[${n}]]`);
    return `[[${to}]]`;
  });
}

/** 把字串裡的「第 n 格」換成新題號（n 可以是全形數字，換完一律寫半形）；n 不在對照表裡就保留原文。 */
export function replaceBlankRefs(text: string, numbers: ReadonlyMap<number, number>): string {
  return text.replace(/(第\s*)([0-9０-９]+)(\s*格)/g, (m: string, head: string, n: string, tail: string) => {
    const to = numbers.get(Number(n.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))));
    return to === undefined ? m : `${head}${to}${tail}`;
  });
}

/** swapAnswerLetters 收的小題：只看選項、答案與 accepted_answers，其他欄位原樣保留。 */
export interface LetterSwappable {
  options: Readonly<Record<string, string | undefined>> | null;
  answer: string;
  accepted_answers?: readonly string[] | null;
}

/** 以字母為鍵的物件：x、y 兩個鍵對調，輸出依字母順序（快照、測試比對穩定）。 */
function swapKeys<T>(record: Readonly<Record<string, T | undefined>>, x: string, y: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    const to = key === x ? y : key === y ? x : key;
    out[to] = value;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * 交換一題的兩個選項位置（docs/design/bank-mock.md §5.3）：options 的 x、y 兩個位置互換，答案與 accepted_answers 裡的
 * 字母照換，解析裡以字母為鍵的 option_notes_zh、option_codes、option_evidence 一起換；正確選項的文字在交換前後相同。
 * 自組卷的 x 是這一題的答案、y 是同篇另一題的答案（Worker 依兩題的答案字母算出來，不採用前端給的字母）。
 * 不改原物件；選項缺 x 或 y、或 x 等於 y 時原樣回傳。
 */
export function swapAnswerLetters<Q extends LetterSwappable>(
  question: Q,
  explanation: ExplanationItem | undefined,
  x: string,
  y: string,
): { question: Q; explanation: ExplanationItem | undefined } {
  const options = question.options;
  if (x === y || !options || options[x] === undefined || options[y] === undefined) return { question, explanation };
  const swapLetter = (l: string): string => (l === x ? y : l === y ? x : l);
  const swappedOptions: Record<string, string | undefined> = { ...options };
  swappedOptions[x] = options[y];
  swappedOptions[y] = options[x];
  // 字母只在這一題的選項之間換，型別（例如 web 的 OptionLetter）不變。
  const newQuestion = {
    ...question,
    options: Object.fromEntries(Object.entries(swappedOptions).sort(([a], [b]) => a.localeCompare(b))),
    answer: swapLetter(question.answer),
    accepted_answers: question.accepted_answers ? question.accepted_answers.map(swapLetter) : question.accepted_answers,
  } as Q;
  if (!explanation) return { question: newQuestion, explanation };
  const out: ExplanationItem = { ...explanation };
  if (explanation.option_notes_zh) out.option_notes_zh = swapKeys(explanation.option_notes_zh, x, y);
  if (explanation.option_codes) out.option_codes = swapKeys(explanation.option_codes, x, y);
  if (explanation.option_evidence) out.option_evidence = swapKeys(explanation.option_evidence, x, y);
  return { question: newQuestion, explanation: out };
}
