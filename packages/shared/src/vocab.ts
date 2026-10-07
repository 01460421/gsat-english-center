/**
 * 大考中心《高中英文參考詞彙表（111 學年度起適用）》的結構化條目型別。
 *
 * 對應 data/vocab/ceec-wordlist.json（由 tools/parse_wordlist.py 產生；格式說明見 docs/research/03-vocab-list.md §5.3）。
 * 檔案是「條目陣列」，依原表字母順序排列。
 *
 * 注意：`word` 不是唯一鍵。有 9 個字各出現在兩筆（例如 capital n./adj. 2 與 capital(ism) n. 4），
 * 詞形也可能同時落在多筆（mine 既是 mine n./v. 1，也是 I 的格變化）。
 * 要當主鍵請用陣列索引，或組合 `{word}|{pos 原文}|{level}`（見 03 文件 §6.3、§9.2）。
 */

/** 級別 1–6。 */
export const VOCAB_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type VocabLevel = (typeof VOCAB_LEVELS)[number];

/**
 * 詞類，照原表寫法保留（含句點與括號）。`(n.)` 表示括號展開出的衍生名詞，
 * 例如 accomplish(ment) v./(n.)。第一個詞類是原表認定「最常用」的詞類。
 */
export const VOCAB_POS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'pron.', 'conj.', 'aux.', 'art.', '(n.)'] as const;
export type VocabPos = (typeof VOCAB_POS)[number];

/** 詞類的中文名稱（介面顯示用）。 */
export const VOCAB_POS_LABELS: Record<VocabPos, string> = {
  'n.': '名詞',
  'v.': '動詞',
  'adj.': '形容詞',
  'adv.': '副詞',
  'prep.': '介系詞',
  'pron.': '代名詞',
  'conj.': '連接詞',
  'aux.': '助動詞',
  'art.': '冠詞',
  '(n.)': '名詞（衍生）',
};

/**
 * 條目型態標記：
 * - slash-forms：斜線並列的其他形式（am/a.m.、advertise(ment)/ad）
 * - paren-ment：括號內是 -ment 衍生名詞（agree(ment)）
 * - paren-plural：(s) 常用複數（chopstick(s)）
 * - paren-suffix：其他字尾（capital(ism)）
 * - paren-full-form：括號內是完整詞形（argue(argument)）
 * - pronoun-forms：代名詞格變化（we (us, our, ours, ourselves)）
 * - unbalanced-paren：解析時括號不成對（parse_wordlist.py 會標，正常輸出不應出現）
 */
export const VOCAB_ENTRY_TAGS = [
  'slash-forms',
  'paren-ment',
  'paren-plural',
  'paren-suffix',
  'paren-full-form',
  'pronoun-forms',
  'unbalanced-paren',
] as const;
export type VocabEntryTag = (typeof VOCAB_ENTRY_TAGS)[number];

/** 原表印刷頁碼，方便回 PDF 核對。 */
export interface VocabPages {
  /** 依字母排序部分的印刷頁碼。 */
  alpha: number;
  /** 依級別排序部分的印刷頁碼；解析腳本在兩種排序對不上時會留 null。 */
  level: number | null;
}

/** 詞彙表的一筆條目。 */
export interface VocabEntry {
  /** 主要詞形：斜線前、括號外的第一個形式。 */
  word: string;
  level: VocabLevel;
  /** 詞類陣列，照原表順序與寫法，例如 ["v.", "(n.)"]。 */
  pos: VocabPos[];
  /** 其他形式：括號展開形式在前，斜線後的形式在後，再來是代名詞格變化。 */
  variants: string[];
  /** 依字母排序中該條目的原文（詞彙 詞類 級別），排版換行已還原，例如 "abandon v. 4"。 */
  raw: string;
  pages: VocabPages;
  tags: VocabEntryTag[];
}

/** data/vocab/ceec-wordlist.json 的整體型別。 */
export type VocabWordlist = VocabEntry[];

/** 學測主力級別（03 文件建議單字模組以 Level 3–5 為主）。 */
export const CORE_VOCAB_LEVELS = [3, 4, 5] as const satisfies readonly VocabLevel[];
