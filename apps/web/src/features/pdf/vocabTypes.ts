/**
 * 單字講義 PDF 的公開介面（PDF 模組與單字模組之間的約定，docs/design/vocab-handout.md §6.2）。
 *
 * 呼叫端：單字模組的講義頁（features/vocab/views/HandoutView.tsx）先在主執行緒把選字、選句、挖空、洗牌、出題與授權字串
 * 全部算好（features/vocab/handout/assemble.ts），組成這裡的 VocabHandoutPdfData（純資料，可以直接 postMessage 給 Worker）；
 * PDF 模組（layout/vocab/）只負責排版，不匯入單字模組，也不再判斷資料。
 *
 * 所有字串在主執行緒就做完正規化（handout/printable.ts 的 printableText）：PDF 字型沒有的字已經換掉或整句不用。
 * 只加選填欄位不算破壞相容；刪除或改名欄位要兩邊一起改，並更新設計文件 §6.2。
 */
import type { PdfProgress } from './types';

/** 講義類型：講義版、背誦版、句意填空卷、測驗卷。 */
export type VocabHandoutKind = 'notes' | 'recite' | 'cloze' | 'quiz';

/** 排版選項（講義頁的選項裡和版面有關的部分）。 */
export interface VocabHandoutLayoutOptions {
  /** 講義版：一欄或兩欄（兩欄不印例句）。 */
  columns: 1 | 2;
  /** 講義版：條目附例句。 */
  examples: boolean;
  /** 講義版、背誦版：附音標。 */
  ipa: boolean;
  /** 講義版：釋義完整（整行照印）或精簡（每行前 3 個義項）。資料已依此切好，版面只用來決定說明文字。 */
  fullSenses: boolean;
  /** 講義版：附不規則變化。 */
  forms: boolean;
  /** 講義版：附同詞族。 */
  family: boolean;
  /** 講義版：附同義、反義詞（只列詞彙表內的字）。 */
  synonyms: boolean;
  /** 背誦版：遮哪一邊（對折後看不到的那一邊）。 */
  hide: 'zh' | 'en';
  /** 句意填空的空格提示。 */
  hint: { firstLetter: boolean; letterCount: boolean };
  /** 句意填空：題目下一行印中文翻譯（中文提示）。 */
  clozeZh: boolean;
  /** 附答案（最後，另起一頁、頁碼另計）。 */
  answerKey: boolean;
  /** 答案附詳解（整句、原形、翻譯與出處）；關掉時只有速查表。 */
  keyDetails: boolean;
  /** 標題區的班級、座號、姓名欄（測驗卷另加得分）。 */
  nameFields: boolean;
  /** 雙面列印：句意填空、資料來源、答案各段從單數頁開始。 */
  duplex: boolean;
}

/** 一句例句（英文句已切成「一般文字／目標字」片段）與兩個 Tatoeba 標示。 */
export interface HandoutExample {
  parts: { text: string; target: boolean }[];
  zh: string;
  /** 「Tatoeba #315866 by CK」。 */
  attribution: string;
  url: string;
  /** 「中文 Tatoeba #2411906 by User5120」。 */
  zhAttribution: string;
  zhUrl: string;
  /** 中文經轉換為台灣繁體（要另外標示）。 */
  zhConverted: boolean;
}

/** 講義版、背誦版的一個條目。 */
export interface HandoutWord {
  /** 條目編號（#1–#N，全份連續）。 */
  no: number;
  id: string;
  word: string;
  /** 原表斜線列出的其他寫法（a / an 的 an）。 */
  variants: string[];
  /** 詞類照原表寫法（「n./adj.」）。 */
  pos: string;
  level: number;
  /** IPA（不含斜線）；沒有或選項關掉是 null。 */
  ipa: string | null;
  /** 釋義：每行一個，label 是短詞性標籤（「名」「及物」），沒有是 null。 */
  senses: { label: string | null; text: string }[];
  /** 原表的衍生字（achieve(ment) 的 achievement）。 */
  derived: { form: string; ipa: string | null; zh: string }[];
  /** 不規則變化（「過去式」chose）。 */
  irregular: { label: string; form: string }[];
  /** 同詞族（最多 4 個）。 */
  family: { word: string; level: number }[];
  /** 同義、反義詞（只列詞彙表內的字）；選項關掉是 null。 */
  related: { synonyms: string[]; antonyms: string[] } | null;
  /** 歷屆出現次數（0 不印）。 */
  examTotal: number;
  /** 短釋義（背誦版、兩欄版用）。 */
  gloss: string;
  /** 條目例句；沒有可印的例句或選項關掉是 null。 */
  example: HandoutExample | null;
}

/** 講義版、背誦版的分組：級別段落（heading 有值時另起一段）與首字母小標。 */
export interface HandoutGroup {
  /** 「Level 4」。 */
  heading: string;
  /** 首字母小標「A」；不分首字母時是 null。 */
  sub: string | null;
  words: HandoutWord[];
}

/** 空格：首字母（可以是空字串）與每個字母一格（null 表示固定長度底線，不透露字數）。 */
export interface ClozeBlank {
  lead: string;
  /** 首字母之後的每一格：'_' 是一個字母；連字號、撇號照印。 */
  cells: string[] | null;
}

/** 句意填空的一題。 */
export interface ClozeItem {
  /** 題號（全份連續）。 */
  no: number;
  /** 講義版：對應的條目編號（答案頁印「→ 講義 #12」）；其他類型是 null。 */
  wordNo: number | null;
  /** 空格前、後的原文。 */
  before: string;
  after: string;
  blank: ClozeBlank;
  /** 句中實際的字（答案）。 */
  answer: string;
  /** 原形（條目的字）。 */
  base: string;
  /** 形式名稱（「複數」「過去式或過去分詞」）；原形或不確定時是 null。 */
  formLabel: string | null;
  /** 也算對的寫法（英式／美式拼法、原表其他寫法）。 */
  alsoAccepted: string[];
  /** 短釋義。 */
  gloss: string;
  zh: string;
  /** 「Tatoeba #49532 by CK」（題目上不加連結：點了就看得到原句）。 */
  enAttribution: string;
  enUrl: string;
  zhAttribution: string;
  zhUrl: string;
  zhConverted: boolean;
}

/** 測驗卷：中翻英拼字的一題。 */
export interface SpellingItem {
  no: number;
  /** 短釋義。 */
  prompt: string;
  /** 詞類（「n.」）。 */
  pos: string;
  first: string;
  letters: number;
  answer: string;
  alsoAccepted: string[];
}

/** 測驗卷：英選中的一題（四個選項是短釋義）。 */
export interface ChoiceItem {
  no: number;
  word: string;
  pos: string;
  options: string[];
  answerIndex: number;
}

/** 選了卻沒出題的字與原因（測驗卷每個字只出在一個部分，三部分都出不了才列）。 */
export type HandoutSkipReason = 'no_sentence' | 'function_word' | 'over_limit' | 'no_distractors' | 'shown_elsewhere';

export interface HandoutSkipped {
  word: string;
  reason: HandoutSkipReason;
  section: 'cloze' | 'spelling' | 'choice';
}

/** 一份講義 PDF 的全部內容（純資料）。 */
export interface VocabHandoutPdfData {
  kind: VocabHandoutKind;
  /** 講義代號（5 個字元，例如 7Q2MK）：印在每頁頁尾與答案頁頁首。 */
  code: string;
  /** 標題區第一行「學測英文中心　單字講義」。 */
  kicker: string;
  /** 標題「Level 4　第 201–300 字」。 */
  title: string;
  /** 頁首左側「單字講義・Level 4 第 201–300 字」。 */
  headerTitle: string;
  /** 說明行「100 字・句意填空 86 題・2026-10-23 製作」（講義代號與使用方式由版面另外接上）。 */
  meta: string;
  /** PDF 文件屬性的 Title。 */
  docTitle: string;
  options: VocabHandoutLayoutOptions;
  /** 講義版、背誦版的條目；其他類型是空陣列。 */
  groups: HandoutGroup[];
  cloze: ClozeItem[];
  /** 只有測驗卷。 */
  spelling: SpellingItem[];
  /** 只有測驗卷。 */
  choice: ChoiceItem[];
  skipped: HandoutSkipped[];
  /**
   * 出處字串（來自 src/data/vocab.ts 的 VOCAB_CREDITS，照抄不改寫）。wordnet 只在印了同詞族或同義詞時有值；
   * wordnetIpa 是印出來的音標裡取自 Open English WordNet（CC BY 4.0）的字（其他音標來自 ECDICT），沒有是空陣列。
   */
  credits: { wordlist: string; ecdict: string; wordnet: string | null; wordnetIpa: string[]; tatoeba: boolean };
}

export interface RenderVocabHandoutPdfOptions {
  onProgress?: (progress: PdfProgress) => void;
  /** 取消：Promise 以 PdfError('aborted') 拒絕。 */
  signal?: AbortSignal;
}

/** 產生一份單字講義 PDF（A4、文字可選取、字型嵌入子集）。第一次呼叫才下載 PDF 引擎與字型。 */
export type RenderVocabHandoutPdf = (data: VocabHandoutPdfData, options: RenderVocabHandoutPdfOptions) => Promise<Blob>;
