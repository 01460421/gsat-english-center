/**
 * 自我檢核清單（不用 AI，任何人都能用）。內容是本站自己寫的檢查重點與例句，
 * **不含**大考中心的官方參考譯文、評分原則原文或範文（站主決定 D8）。
 */

export interface CheckItem {
  id: string;
  title: string;
  /** 要檢查什麼。 */
  detail: string;
  /** 本站自撰的常見錯誤例子（錯 → 對）。 */
  example?: string;
}

/** 中譯英自我檢核（SPEC §6.8 步驟 3 的清單，加上詞性與漏譯）。 */
export const TRANSLATION_CHECKLIST: readonly CheckItem[] = [
  {
    id: 'tense',
    title: '時態',
    detail: '找出中文的時間線索（已經、正在、昨天、越來越…），動詞時態要配合；同一句前後時態要一致。',
    example: 'She has live here since 2020. → She has lived here since 2020.',
  },
  {
    id: 'agreement',
    title: '主詞與動詞一致',
    detail: '先找出真正的主詞：單數主詞配單數動詞；「A of B」看 A，動名詞或不定詞當主詞用單數。',
    example: 'The number of students are growing. → The number of students is growing.',
  },
  {
    id: 'articles',
    title: '冠詞與單複數',
    detail: '可數名詞單數前面要有 a／an／the 或所有格；泛指一類事物多用複數；不可數名詞不加 s。',
    example: 'He bought new phone and two furnitures. → He bought a new phone and two pieces of furniture.',
  },
  {
    id: 'word_form',
    title: '詞性',
    detail: '形容詞修飾名詞、副詞修飾動詞與形容詞；介系詞後面接名詞或動名詞。',
    example: 'She sings beautiful. / He is good at swim. → She sings beautifully. / He is good at swimming.',
  },
  {
    id: 'spelling',
    title: '拼字與大小寫',
    detail: '逐字看一遍拼字；句首、專有名詞（人名、地名、節日、語言）、I 要大寫。',
    example: 'i visited taipei in july. → I visited Taipei in July.',
  },
  {
    id: 'punctuation',
    title: '標點',
    detail: '用半形英文標點；句尾要有句點或問號；英文沒有頓號（、），列舉用逗號；兩個完整句子不能只用逗號連接。',
    example: 'It was late, we went home. → It was late, so we went home.',
  },
  {
    id: 'omission',
    title: '有沒有漏譯',
    detail: '把中文切成幾個意思單位，逐一對照：每個單位（誰、做什麼、在哪裡、什麼時候、程度或原因）都要翻到。',
  },
];

/** 英文作文自我檢核（對照四項評分面向；字數與段數由程式即時計算）。 */
export const ESSAY_CHECKLIST: readonly CheckItem[] = [
  { id: 'task', title: '切題', detail: '每一段都回應了題目要求（例如第一段描述圖片、第二段說明原因與影響），沒有離題。' },
  { id: 'paragraphs', title: '分段', detail: '依題目要求分段（多半是兩段），段落之間換行。' },
  { id: 'topic_sentence', title: '主題句與細節', detail: '每段開頭有主題句，後面有具體的例子、經驗或理由支持。' },
  { id: 'transitions', title: '轉承', detail: '句子與段落之間有轉折詞（First, In addition, However, As a result, In conclusion…），讀起來連貫。' },
  { id: 'grammar', title: '文法句構', detail: '時態一致、主詞動詞一致、沒有缺動詞或兩個句子只用逗號相連；句型有長有短。' },
  { id: 'vocabulary', title: '字彙拼字', detail: '用字精確、不重複同一個字太多次；拼字、大小寫、標點正確。' },
];
