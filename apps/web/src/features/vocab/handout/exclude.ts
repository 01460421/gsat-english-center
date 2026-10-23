/**
 * 講義不採用的 Tatoeba 例句（docs/design/vocab-handout.md §12 R3、§13 第 6 點）。
 *
 * Tatoeba 是開放社群的句庫，少數句子（或它的中文翻譯）不適合印在給高中生的講義上：性、粗話、罵人的話、吸毒、
 * 自殺的描述，以及把族群或宗教和犯罪連在一起的句子。2026-10-23 用一份敏感字詞清單（英文與中文各約 50 個詞）
 * 掃過單字資料的全部 12,291 句例句，命中 273 句，逐句人工判斷後收錄下面這些。
 * 一般的犯罪、戰爭、意外用語（murder、bullet、bomb）是學測詞彙本身，照常使用。
 *
 * 只影響講義（條目例句與句意填空）；單字卡畫面不受影響。編號是英文句或中文句的 Tatoeba 編號，兩邊都比對。
 * 之後依回報增補：加一個編號、附上類別即可。
 */
export const EXCLUDED_SENTENCE_IDS: ReadonlySet<number> = new Set([
  // 性的內容
  327754, 2329, 8716826, 3583286, 451591, 271266, 2806272, 1833, 402599, 6371272, 1882955, 7825917, 415305, 11282673,
  690971, 684119, 4429293, 327963, 1871, 5923976, 1513432, 67163, 7799650, 450980, 4144726,
  // 粗話、罵人、不雅的說法（含中文翻譯用了粗話，例如 loser 那一句的「屌絲」）
  1956508, 462426, 1617037, 1737449, 6453828, 957541, 1750070, 27514, 2301442, 712263, 2453098, 2301446, 433685, 4334397,
  1117848, 618177,
  // 吸毒
  2444475, 7237427,
  // 自殺
  298464, 612957, 4844626, 2952218, 394269, 390063, 3124779,
  // 政治、宗教與族群的爭議句
  8104397, 13042806, 1958, 7364060, 11865905,
]);

/** 這句例句（英文或中文的編號）在排除清單裡。 */
export function isExcludedSentence(ex: { tatoeba_id: number; zh_id: number }): boolean {
  return EXCLUDED_SENTENCE_IDS.has(ex.tatoeba_id) || EXCLUDED_SENTENCE_IDS.has(ex.zh_id);
}

/**
 * 和功能詞同形的實詞（鍵是字頭，值是那個功能詞的詞類）：mine（n./v. 礦、開採）和所有格代名詞 mine（我的）同形，
 * 而資料替它配的例句全是代名詞的用法（「an old friend of mine」）。原形在句中分不出是哪一個字，所以這種條目的例句
 * 只有句中是變化形（mines、mined、mining）才用：不出句意填空，講義版的條目也不印這種例句。
 * 條目本身就有那個功能詞的詞類時（例如 still adv./adj.）不受影響。2026-10-23 檢查全部 6,012 筆，只有 mine 這一筆。
 */
export const FUNCTION_HOMOGRAPHS: ReadonlyMap<string, string> = new Map([['mine', 'pron.']]);

/**
 * 句中的這個字（原文）是不是條目的功能詞同形字（見 FUNCTION_HOMOGRAPHS）：字頭本身、而且條目沒有那個功能詞的詞類。
 */
export function isFunctionHomograph(entry: { word: string; pos: readonly string[] }, matched: string): boolean {
  const word = entry.word.toLowerCase();
  const pos = FUNCTION_HOMOGRAPHS.get(word);
  return pos !== undefined && !entry.pos.includes(pos) && matched.toLowerCase() === word;
}
