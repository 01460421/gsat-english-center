/**
 * 單字講義 PDF 上所有固定文字（docs/design/vocab-handout.md §3、§4.4、§3.6、§3.7）。
 *
 * 為什麼集中：PDF 字型是子集，字型檢查（scripts/font-coverage.mjs 的 PDF_TEXT_FILES）與子集化工具（scripts/fonts/subset_fonts.py）
 * 會掃描這個檔案——這裡的每個中文字都必須在中文子集裡，粗體子集也會收這裡的字。寫在其他版面檔案的中文可能印出方框。
 * 新增或修改文字後跑 `npm run check:fonts -w @gsat/web`；報缺字就照 fonts/README.md 重跑子集化。
 *
 * 新寫的文字一律不寫官方考試機構的名稱或英文縮寫；詞彙表的出處只用資料裡的 credits.wordlist（src/data/vocab.ts 的
 * VOCAB_CREDITS.wordlist，照 data/vocab/CREDITS.md 的「App 內標示文字」原文）。也不寫任何 AI 模型名稱（講義內容沒有 AI 產生的東西）。
 * 授權全文（MIT、Princeton WordNet）照抄 data/vocab/CREDITS.md；scripts/lib/vocab-handout.data.test.ts 比對兩邊一致。
 */
import type { HandoutSkipReason, VocabHandoutKind, VocabHandoutPdfData } from '../../vocabTypes';

/**
 * 講義 PDF 用粗體印的字串（標題、段落名稱、分組標題、標題區的範圍名稱）。字型檢查會讀這個常數裡的字串常值，
 * 粗體子集沒有其中的字是錯誤，子集化工具也會把它們收進粗體子集（§7.2）。只能寫字串常值。
 */
export const VOCAB_PDF_BOLD = {
  clozeTitle: '句意填空',
  spellingTitle: '中翻英拼字',
  choiceTitle: '英選中',
  sourcesTitle: '資料來源與授權',
  keyTitle: '答案',
  keyQuick: '答案速查',
  keyDetails: '句意填空詳解',
  keySkipped: '未出題的字',
  reciteTitle: '對折背誦表',
  sourceWordlist: '詞彙與級別',
  sourceEcdict: '音標、中文釋義與詞形變化',
  sourceTatoeba: '例句',
  sourceWordnet: '同詞族與同義詞',
  /** 只有部分音標取自 Open English WordNet、沒有印同詞族與同義詞時的標題。 */
  sourceWordnetIpa: '部分音標',
  sourceWordnetBoth: '同詞族、同義詞與部分音標',
  sourceExamStats: '歷屆出現次數',
  partNumbers: '一二三、',
  /** 標題區的範圍名稱可能用到的字（labels.ts 的 sourceTitle、filtersText；單字庫篩選的選項名稱）。 */
  titleWords: '第字開頭全部單字庫篩選結果錯題本每日學習的今日複習名詞動詞形容詞副詞其他歷屆出現過次以上曾當正解從未搜尋「」…共（）・',
} as const;

const KIND_NAMES: Record<VocabHandoutKind, string> = {
  notes: '單字講義',
  recite: '單字背誦版',
  cloze: '句意填空',
  quiz: '單字測驗卷',
};

export const VOCAB_PDF_TEXT = {
  kindName: (kind: VocabHandoutKind) => KIND_NAMES[kind],
  codeLabel: (code: string) => `講義代號 ${code}`,
  /** 標題區的填寫欄。 */
  nameFields: ['班級', '座號', '姓名'] as const,
  scoreField: '得分',
  /**
   * 使用方式（標題區最後一行）。parts：測驗卷實際印出的部分數（句意填空一定有；拼字、英選中可能沒有題目或被取消，
   * Level 5–6 也不出拼字），只有一部分時和句意填空卷寫法相同。
   */
  howTo: (kind: VocabHandoutKind, answerKey: boolean, examples = true, parts = 1): string => {
    const tail = answerKey ? '答案在最後，另起一頁，可以整疊拆下。' : '';
    switch (kind) {
      case 'notes':
        return `${examples ? '先讀單字與例句' : '先讀單字'}，再做後面的句意填空。${tail}`;
      case 'recite':
        return `先用對折背誦表自我測驗，再做句意填空。${tail}`;
      case 'cloze':
        return `依句意在空格內寫出單字。${tail}`;
      case 'quiz':
        return parts >= 2 ? `共${parts === 2 ? '兩' : '三'}部分，題號連續。${tail}` : `依句意在空格內寫出單字。${tail}`;
    }
  },
  /**
   * 句意填空的起始頁：「句意填空起始頁：9」。頁碼由 pdfmake 的 pageReference 填，而它量寬度時先用 5 位數的佔位字，
   * 填進實際頁碼後不會把後面的字往前移（後面會留空隙），所以頁碼一定放在一行的最後。
   */
  exercisePage: '句意填空起始頁：',
  /** 頁首右側與答案頁的頁碼。 */
  pageOf: (page: number, total: number) => `第 ${page} 頁／共 ${total} 頁`,
  keyPageOf: (page: number, total: number) => `答案　第 ${page} 頁／共 ${total} 頁`,
  keyHeader: (code: string) => `答案・講義代號 ${code}`,
  /**
   * 頁尾第 1 行以外的來源摘要（第 1 行是詞彙表的出處 credits.wordlist），依這份講義實際用到的來源組成：
   * 用到 Open English WordNet（同詞族、同義詞或部分音標）才寫它，沒有任何例句時不寫 Tatoeba。版面用「・」接起來，放不下就分行。
   */
  footerParts: (credits: VocabHandoutPdfData['credits']): string[] => {
    const wordnet = credits.wordnet !== null;
    const ipa = credits.wordnetIpa.length > 0;
    return [
      '音標與釋義：ECDICT（MIT）',
      ...(wordnet || ipa ? [`${wordnet && ipa ? '同詞族、同義詞與部分音標' : wordnet ? '同詞族與同義詞' : '部分音標'}：Open English WordNet（CC BY 4.0）`] : []),
      ...(credits.tatoeba ? ['例句：Tatoeba（CC BY 2.0 FR，逐句標示）'] : []),
      '學測英文中心製作，非營利使用',
    ];
  },
  blankPage: '（本頁空白）',
  /** 條目。 */
  examTotal: (n: number) => `歷屆 ${n} 次`,
  levelTag: (level: number) => `L${level}`,
  derivedLabel: '衍生字',
  irregularLabel: '不規則變化',
  familyLabel: '同詞族',
  synonymsLabel: '同義',
  antonymsLabel: '反義',
  senseSeparator: '；',
  /** 全形括號：「chose（過去式）」「成人, 成蟲（n.）」。 */
  paren: (text: string) => `（${text}）`,
  /** 英選中題號前的作答括號。 */
  answerParen: '（　　）',
  /** 片段之間的全形空白。 */
  wideSpace: '　',
  colon: '：',
  itemSeparator: '・',
  zhConverted: '中文經轉換為台灣繁體',
  attributionSeparator: ' · ',
  /** 背誦版。 */
  reciteHowTo: (hide: 'zh' | 'en') =>
    hide === 'zh' ? '沿虛線對折，遮住右半邊的中文，看英文說出意思；答錯的在 □ 打勾，下次再背。' : '沿虛線對折，遮住右半邊的英文，看中文說出單字；答錯的在 □ 打勾，下次再背。',
  reciteHeader: { no: 'No.', en: '英文', zh: '中文' },
  /** 句意填空的說明（§4.4）。 */
  clozeInstructions: (firstLetter: boolean, letterCount: boolean) => {
    const hint = firstLetter && letterCount ? '空格前的字母是提示，每一格是一個字母。' : firstLetter ? '空格前的字母是提示。' : letterCount ? '每一格是一個字母。' : '';
    return `依句意在空格內寫出一個英文單字；${hint}答案可能要寫成變化形（例如複數、過去式），請寫出完整的字。`;
  },
  clozeZhNote: '每題下方附中文翻譯，可以對照句意作答。',
  spellingInstructions: '依中文意思與詞類拼出英文單字；空格前的字母是提示，每一格是一個字母。',
  choiceInstructions: '選出英文單字最適當的中文意思，把代號寫在題號前的括號內。',
  partTitle: (index: number, name: string) => `${['一', '二', '三'][index] ?? ''}、${name}`,
  /** 答案頁。 */
  keyNotes: [
    '拼法依例句；答案後面「亦可」列出的拼法也算對。',
    '句意填空的答案以例句原文為準；意思相通的其他字，請老師斟酌給分。',
  ],
  baseForm: (base: string) => `原形 ${base}`,
  backToEntry: (no: number) => `→ 講義 #${no}`,
  alsoAccepted: (words: readonly string[]) => `（亦可：${words.join('、')}）`,
  skippedReasons: {
    no_sentence: '沒有合適的例句',
    function_word: '功能詞不出題',
    over_limit: '超過題數上限',
    no_distractors: '找不到足夠的干擾選項',
    shown_elsewhere: '答案出現在句意填空的句子裡',
  } satisfies Record<HandoutSkipReason, string>,
  skippedSection: { cloze: '句意填空', spelling: '中翻英拼字', choice: '英選中' },
  skippedCount: (n: number) => `（${n} 字）`,
  /** 未出題的字太多時只列前面一部分。 */
  andMore: (n: number) => `…等 ${n} 字`,
  /** 資料來源與授權頁（§3.6）。 */
  sourcesIntro: '本講義依下列公開資料製作，只列這份講義實際用到的來源。',
  sourcesWordlistNote: '依原表封面聲明，僅供非營利目的使用並註明出處。',
  sourcesEcdictCopyright: 'MIT License，Copyright (c) 2025 Linwei。全文如下：',
  sourcesIpaNote: '音標為 IPA（以英式標音為主）。',
  /** 有些音標取自 Open English WordNet 時取代 sourcesIpaNote：item 是 OEWN 那一項的編號。 */
  sourcesIpaNoteWordnet: (count: number, item: number) => `音標為 IPA，以英式標音為主；其中 ${count} 個字的音標取自 Open English WordNet（美式標音），見第 ${item} 項。`,
  sourcesWordnetIpaWords: (words: readonly string[]) => `音標取自 Open English WordNet 的字：${words.join('、')}。`,
  /** 授權條款連結照 data/vocab/CREDITS.md §4（CC BY 要附授權條款的網址，印在 PDF 上才算數）。 */
  sourcesTatoeba:
    '例句：Tatoeba（https://tatoeba.org/）。授權 CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/）；部分句子為 CC0 1.0（https://creativecommons.org/publicdomain/zero/1.0/）。',
  sourcesTatoebaFormat: '每句旁標示「Tatoeba #句子編號 by 作者」，中文翻譯另標「中文 Tatoeba #編號 by 作者」；句子頁網址為 https://tatoeba.org/en/sentences/show/{編號}。',
  sourcesTatoebaCloze: '句意填空的題目由例句挖去目標字改作而成。',
  /** 答案附詳解時才印（詳解有整句）。 */
  sourcesTatoebaClozeKey: '完整的原句印在答案頁。',
  sourcesTatoebaConverted: '標「中文經轉換為台灣繁體」的翻譯經 OpenCC 轉換並調整用字。',
  /** OEWN 的標示照 data/vocab/CREDITS.md §3，另加授權條款的網址。 */
  sourcesWordnetAttribution:
    'Open English WordNet 2025, © 2019–present The Open English WordNet Team, CC BY 4.0（https://en-word.net/）；授權條款：https://creativecommons.org/licenses/by/4.0/。衍生自 Princeton WordNet（WordNet 3.1 Copyright 2011 by Princeton University）。Princeton WordNet 的授權聲明如下：',
  sourcesWordnetFamily: '同詞族由本站依詞彙表與 Open English WordNet 的衍生關係整理。',
  sourcesExamStats: '本站依歷屆學測、指考英文試題統計。',
  /** PDF 文件屬性的 Subject。 */
  docSubject: '學測英文中心單字講義，非營利使用',
  docAuthor: '學測英文中心',
  sourcesClosing: '本講義由學測英文中心依上列公開資料製作，免費提供，非營利使用。',
} as const;

/** ECDICT 的 MIT 授權全文（照抄 data/vocab/CREDITS.md §2）。 */
export const MIT_LICENSE_TEXT = `MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** Princeton WordNet 的授權聲明（照抄 data/vocab/CREDITS.md §3；授權條件要求「appear on ALL copies」）。 */
export const WORDNET_LICENSE_TEXT = `This software and database is being provided to you, the LICENSEE, by
the Open English Wordnet team under the Creative Commons Attribution 4.0
International License (CC-BY 4.0).

Open English Wordnet 2023 Copyright 2023 by the Open English Wordnet team.

Permission to use, copy, modify and distribute this software and
database and its documentation for any purpose and without fee or
royalty is hereby granted, provided that you agree to comply with
the following copyright notice and statements, including the disclaimer,
and that the same appear on ALL copies of the software, database and
documentation, including modifications that you make for internal
use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University.  All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT
INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR
OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in
advertising or publicity pertaining to distribution of the software
and/or database.  Title to copyright in this software, database and
any associated documentation shall at all times remain with
Princeton University and LICENSEE agrees to preserve same.`;
