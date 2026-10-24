/**
 * 英文作文的轉承詞清單與計數（docs/design/model-essays.md §2.6）：作文範文的「三版對照」表與「你的作文」欄共用。
 *
 * 清單移植自 tools/validate_bank.py 的 EXTRA_CONNECTIVES（題庫範文的轉承詞註解檢查用的同一份）。
 * **兩邊改一邊就要改另一邊**（packages/shared/src/exemplars.test.ts 釘住清單的大小與幾個代表詞）。
 *
 * 比對規則（約略值，不是文法分析）：
 *   - 多字詞與不容易混淆的單字（however、in addition、for example…）在任何位置都算；
 *   - 容易和一般用法混淆的詞（as、like、so、but、then、when、while…，見 AMBIGUOUS_CONNECTIVES）只在句首或分號後才算；
 *   - 同一個位置取最長的那一個（even though 算一次，不另外算 though）；
 *   - 次數是每一次出現都算，種類數是出現過的不同詞數。
 * 實測（設計文件 §2.6）：這個算法分不出穩健版與頂標版，所以畫面只標「約略值」、不做好壞判斷，也不當門檻。
 */

/** tools/validate_bank.py 的 EXTRA_CONNECTIVES（小寫；彎引號在比對前換成直引號）。 */
export const ESSAY_CONNECTIVES: readonly string[] = [
  'first', 'first of all', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'then', 'next', 'finally', 'lastly',
  'to begin with', 'last but not least', 'after that', 'afterward', 'afterwards', 'later', 'at first', 'in the end',
  'eventually', 'meanwhile', 'also', 'besides', 'in addition', 'moreover', 'furthermore', "what's more", 'what is more',
  'however', 'but', 'yet', 'still', 'although', 'though', 'even though', 'while', 'whereas', 'on the other hand',
  'nevertheless', 'nonetheless', 'instead', 'in contrast', 'on the contrary', 'because', 'because of', 'since', 'as',
  'so', 'therefore', 'thus', 'hence', 'as a result', 'consequently', 'due to', 'thanks to', 'that is why',
  'this is why', 'for this reason', 'for example', 'for instance', 'such as', 'like', 'take', 'in conclusion',
  'to sum up', 'all in all', 'in short', 'overall', 'in summary', 'to conclude', 'above all', 'in fact', 'indeed',
  'as a matter of fact', 'from then on', 'since then', 'at the same time', 'in other words', 'that is', 'otherwise',
  'once', 'when', 'after', 'before', 'as soon as', 'unless', 'if', 'even if', 'not only', 'but also',
  'to be honest', 'personally', 'in my opinion', 'as far as i am concerned', 'admittedly',
  'of course', 'no wonder', 'as for', 'apart from', 'except for', 'in the long run', 'by contrast', 'similarly',
  'likewise', 'in the same way', 'as well', 'not to mention', 'worse still', 'to make matters worse', "what's worse",
  'in the beginning', 'at last', 'from that day on', 'ever since', 'until', 'so that', 'in order to', 'as long as',
  'whenever', 'every time', 'the moment', 'as a consequence', 'on top of that', 'in turn',
];

/**
 * 容易和一般用法混淆的詞：只在句首（段首、. ! ? 之後）或分號後才算（設計文件 §2.6 列的那幾個，再加上同樣常當一般副詞、
 * 序數或動詞用的 yet、still、first、second、third、next、later、instead）。
 */
export const AMBIGUOUS_CONNECTIVES: ReadonlySet<string> = new Set([
  'as', 'like', 'so', 'but', 'yet', 'still', 'then', 'when', 'while', 'since', 'after', 'before', 'once', 'if', 'until',
  'take', 'that is', 'first', 'second', 'third', 'next', 'later', 'instead',
]);

/** 依字數由長到短排好的清單（同一個位置先試最長的）。 */
const PHRASES: ReadonlyArray<{ phrase: string; words: readonly string[] }> = [...new Set(ESSAY_CONNECTIVES)]
  .map((phrase) => ({ phrase, words: phrase.split(' ') }))
  .sort((a, b) => b.words.length - a.words.length);

interface Token {
  word: string;
  start: number;
  end: number;
  /** 句首或分號後（前一個字到這個字之間有 . ! ? ; 或換行，或是第一個字）。 */
  clauseStart: boolean;
}

function tokenize(text: string): Token[] {
  const lower = text.replace(/[’‘]/g, "'").toLowerCase();
  const tokens: Token[] = [];
  let prevEnd = 0;
  for (const m of lower.matchAll(/[a-z]+(?:'[a-z]+)?/g)) {
    const start = m.index ?? 0;
    const gap = lower.slice(prevEnd, start);
    tokens.push({ word: m[0], start, end: start + m[0].length, clauseStart: tokens.length === 0 || /[.!?;\n]/.test(gap) });
    prevEnd = start + m[0].length;
  }
  return tokens;
}

/** 轉承詞的次數與種類數（約略值；見檔頭）。 */
export function countConnectives(text: string): { count: number; kinds: number; found: string[] } {
  const tokens = tokenize(text);
  const lower = text.replace(/[’‘]/g, "'").toLowerCase();
  const kinds = new Set<string>();
  let count = 0;
  let i = 0;
  while (i < tokens.length) {
    let matched = 0;
    for (const { phrase, words } of PHRASES) {
      if (i + words.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < words.length; k++) {
        const t = tokens[i + k]!;
        if (t.word !== words[k]) {
          ok = false;
          break;
        }
        // 多字詞的字與字之間只能是空白（for, example 這種中間有標點的不算）。
        if (k > 0 && !/^\s+$/.test(lower.slice(tokens[i + k - 1]!.end, t.start))) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (AMBIGUOUS_CONNECTIVES.has(phrase) && !tokens[i]!.clauseStart) continue;
      count++;
      kinds.add(phrase);
      matched = words.length;
      break;
    }
    i += matched > 0 ? matched : 1;
  }
  return { count, kinds: kinds.size, found: [...kinds].sort() };
}
