/**
 * 學習助手的方法庫（docs/design/learning-assistant.md §3.3「方法庫」）：本站撰寫、站主審過才上線的解題方法與錯因說明。
 *
 * 用在三個地方：
 *   - 報告的「各題型解題法」（MethodCard）與「常見錯誤樣態」：畫面直接顯示這裡的步驟與說明，AI 只寫「對你來說要特別注意」。
 *   - 解析與報告的系統提示（apps/api/src/ai/prompts/assist-common.ts 的 assistSectionGuideText）：cover_en 是「解析一定要涵蓋的
 *     重點」（英文），steps 是本站的方法（模型寫 method 時對齊它）。這裡改了，系統提示跟著變，prompt_version 自動換。
 *   - 讀書計畫的份量（UNIT_MINUTES：每組含檢討的用時；apps/api/src/assist/plan.ts 依它把分鐘數換成組數）。
 *
 * 撰寫規則（§3.3）：
 *   - 依 docs/analysis/sections/01–07 的統計結論，用本站自己的話寫；不引用試題原文、評分原則原文、參考譯文或佳作。
 *   - 引用統計一律寫明分組定義與年度：官方的「高分組／低分組」是全體到考考生的前、後 33%；五等分組 Pa–Pe 每組 20%，兩者不混用。
 *     答對率 P 是全體到考考生的答對率；「本站推算」的數字標明是推算。
 *   - 建議用時依 docs/research/02 §6.2（詞彙 7、綜合 9、文意選填 9、篇章 7、閱讀 25、混合 10、中譯英 8、作文 25 分鐘）。
 */
import type { AssistErrorCode } from './assist-codes';
import type { AssistSection } from './assist';

/** 方法庫涵蓋的大題：六個選擇題大題、中譯英、作文，加上單字（讀書計畫的單字複習也連到它）。 */
export const ASSIST_METHOD_SECTIONS = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition', 'vocab_word'] as const satisfies readonly AssistSection[];
export type AssistMethodSection = (typeof ASSIST_METHOD_SECTIONS)[number];

/** 讀書計畫的項目種類（§3.3；前端對到固定的站內頁面，份量依 UNIT_MINUTES）。 */
export const ASSIST_PLAN_KINDS = [
  'bank_practice',
  'past_exam_section',
  'mock_exam',
  'vocab_review',
  'vocab_new',
  'translation',
  'essay',
  'review_mistakes',
  'assistant',
  'rest',
] as const;
export type AssistPlanKind = (typeof ASSIST_PLAN_KINDS)[number];

export const ASSIST_PLAN_KIND_LABELS: Record<AssistPlanKind, string> = {
  bank_practice: '題庫練習',
  past_exam_section: '歷屆單一大題',
  mock_exam: '模擬考',
  vocab_review: '單字複習',
  vocab_new: '新單字',
  translation: '中譯英練習',
  essay: '作文練習',
  review_mistakes: '檢討錯題',
  assistant: '問學習助手',
  rest: '休息',
};

/** 題庫練習的每組用時（分鐘，含檢討；設計值）：詞彙 10 題、綜合測驗一篇、文意選填一篇、篇章結構一篇、閱讀一篇、混合題一組。 */
export const BANK_UNIT_MINUTES = {
  vocabulary: 10,
  cloze: 8,
  word_bank: 12,
  structure: 10,
  reading: 12,
  mixed: 15,
} as const satisfies Partial<Record<AssistSection, number>>;
export type BankUnitSection = keyof typeof BANK_UNIT_MINUTES;

/**
 * 其他項目的每次用時（分鐘，含檢討；設計值，§3.2.6）。模擬考＝作答 100＋檢討 30。休息不排時間。
 * 題庫練習依大題另見 BANK_UNIT_MINUTES。
 */
export const UNIT_MINUTES = {
  past_exam_section: 15,
  mock_exam: 130,
  vocab_review: 15,
  vocab_new: 15,
  translation: 20,
  essay: 45,
  review_mistakes: 20,
  assistant: 10,
  rest: 0,
} as const satisfies Record<Exclude<AssistPlanKind, 'bank_practice'>, number>;

/** 一個計畫項目的每組用時（題庫練習依大題；大題不在表裡時用閱讀的 12 分鐘）。 */
export function planUnitMinutes(kind: AssistPlanKind, section: AssistSection | null): number {
  if (kind === 'bank_practice') return section !== null && section in BANK_UNIT_MINUTES ? BANK_UNIT_MINUTES[section as BankUnitSection] : BANK_UNIT_MINUTES.reading;
  return UNIT_MINUTES[kind];
}

/** 一組的單位（畫面「2 組」「1 篇」「10 題」）。 */
export function planUnitLabel(kind: AssistPlanKind, section: AssistSection | null): string {
  switch (kind) {
    case 'bank_practice':
      return section === 'vocabulary' ? '回（每回 10 題）' : section === 'reading' ? '篇' : '組';
    case 'mock_exam':
      return '份';
    case 'translation':
      return '題（兩句）';
    case 'essay':
      return '篇';
    case 'past_exam_section':
      return '大題';
    default:
      return '次';
  }
}

export interface AssistSectionMethod {
  section: AssistMethodSection;
  title: string;
  /** 配分（現制）；單字沒有。 */
  points: number | null;
  /** 考試時整個大題的建議用時（分鐘）；單字沒有。 */
  suggested_minutes: number | null;
  /** 練習時一組（含檢討）的單位與用時。 */
  unit: { label: string; minutes: number };
  /** 4–6 個步驟（照順序做）。 */
  steps: readonly string[];
  /** 常見陷阱與怎麼認。 */
  traps: readonly string[];
  /** 提分重點（具體、可以照做）。 */
  score_tips: readonly string[];
  /** 依據的統計（寫明分組定義與年度）。 */
  stat_note: string;
  /** 依據的分析文件（docs/ 底下的路徑）。 */
  basis: readonly string[];
  /** 給模型看的「解析一定要涵蓋」（英文；系統提示的段落）。 */
  cover_en: string;
}

const SECTION_METHODS: readonly AssistSectionMethod[] = [
  {
    section: 'vocabulary',
    title: '詞彙題',
    points: 10,
    suggested_minutes: 7,
    unit: { label: '10 題', minutes: 10 },
    steps: [
      '先遮住選項讀完整句，用自己的話猜空格的意思，並判斷要的是名詞、動詞、形容詞還是副詞。',
      '找句子裡的線索：換句話說、對比（but、while、instead）、因果（because、so）、固定搭配（make a decision、heavy traffic）或情境。',
      '四個選項逐一放回句子：意思對還不夠，搭配也要對；同詞性的選項比精確字義（例如 compulsory 是「規定必須」，不只是「重要」）。',
      '選項都是常見字時多想一層：這個字在這裡是不是用了延伸義（grave concerns 的 grave＝嚴重的）或換了詞性（elbow 當動詞「用手肘推擠」）。',
      '真的不確定就刪掉兩個再選，不要空白：單選題答錯不倒扣。',
    ],
    traps: [
      '整句大意都說得通、只錯在搭配或精確字義的選項（harsh／grave、route／quest 這類配對）：程度好的考生最常在這裡失手。',
      '字形相近的選項（slender／slight／slippery），看太快會讀成另一個字。',
      '常見字的延伸義或轉品：只用第一個中文意思去套，正解反而看起來不對。',
    ],
    score_tips: [
      '背單字一律連搭配一起背（動詞＋受詞、形容詞＋名詞），不只背中文。',
      '錯題記下「這個字在題目裡的意思」，特別是常見字的第二、第三個意思，三天後遮住中文再測一次。',
      '一回 10 題計時 7 分鐘內完成，檢討時把每個干擾選項為什麼不行說出來（練習的份量照逐週計畫）。',
    ],
    stat_note:
      '字的級別和難度關係很小（學測 91–115 年 350 題，正解字級和全國答對率的等級相關只有 −0.12）；最難的是常見字的延伸義或轉品：學測 111–115 年這類 14 題，全國答對率中位數只有 .29，其中 9 題屬於超越頂標難度（本站推算）。',
    basis: ['docs/analysis/sections/01-vocabulary.md'],
    cover_en:
      'the clue around the blank (restatement, collocation, contrast, cause and effect, situation); the sense of the answer used here (core meaning, extended meaning, conversion, idiom); why each distractor fails (same part of speech but wrong collocation or precise meaning, look-alike words).',
  },
  {
    section: 'cloze',
    title: '綜合測驗',
    points: 10,
    suggested_minutes: 9,
    unit: { label: '一篇（5 格）', minutes: 8 },
    steps: [
      '先讀第一句與最後一句，抓主題和文章走向（敘事、說明還是議論）。',
      '每一格先判斷考哪一類：詞彙語意、片語、文法還是轉承，再決定要看多遠：本句、前後一句，或整段。',
      '轉承格先標出前後兩句的關係（因果、對比、補充、舉例），再挑對應的連接詞，不憑「唸起來順」決定。',
      '片語格比較同一個動詞的幾個片語（take over／take on／take up），看受詞和語意，不照字面猜。',
      '文法格看主詞、時態與句子結構：空格前後已經有動詞時，通常要的是分詞、不定詞或連接詞。',
      '整篇填完再讀一次，確認語氣與邏輯前後一致。',
    ],
    traps: [
      '只讀本句也說得通的選項：本句文法、語意都對，放回前後文邏輯卻不合。',
      '同家族片語或字面相近的片語。',
      '看起來可行的文法形式（分詞、動名詞互換）。',
      '轉承的邏輯錯位（把「換句話說」當成「相反地」）。',
    ],
    score_tips: [
      '檢討時每一格寫下「我看的線索在哪一句」（練習的份量照逐週計畫）。',
      '片語錯題依動詞整理成表（take、make、come、bring…），定期拿出來複習。',
      '轉承詞依功能分類背（因果、對比、補充、舉例、讓步），不要只背中文。',
    ],
    stat_note:
      '分開難易的是誘答能不能騙到程度好的考生：學測 91–115 年屬於超越頂標難度的 92 格中，89% 有一個誘答吸走官方高分組（全體到考考生的前 33%）至少兩成（本站推算）。',
    basis: ['docs/analysis/sections/02-cloze.md'],
    cover_en:
      'how far away the clue is (the same sentence, the sentences before and after, further away); turns and positive or negative direction; for grammar blanks, the context that decides the form.',
  },
  {
    section: 'word_bank',
    title: '文意選填',
    points: 10,
    suggested_minutes: 9,
    unit: { label: '一篇（10 格）', minutes: 12 },
    steps: [
      '先在每個選項旁寫下可能的詞性（n／v／adj／adv）；常見字的第二詞性也寫上（even、house 可以當動詞，faithful 可以當名詞）。',
      '每一格先判斷需要的詞性（看前後的冠詞、介系詞、主詞與受詞），第一輪先從符合的選項裡挑。',
      '同一組剩兩個時，再看語意與搭配：把整句連前後句讀一次，不只看本句。',
      '確定的先填、劃掉；剩下的格找不到合適的選項時，回頭看剩下的選項有沒有延伸義或轉品（例如 even 當動詞「使平均」），再用剩下的選項檢查最後兩三格。',
      '交卷前檢查有沒有兩格用了同一個選項：錯一格常會連帶錯第二格。',
    ],
    traps: [
      '同詞性、只讀本句也說得通的近似選項：學測 111–115 年屬於超越頂標難度的 13 格中，有 11 格有這種選項。',
      '常見字的延伸義或轉品（even 當動詞、faithful 當名詞）。',
      '和全文主題相合、字形相近的選項（familiar／faithful）。',
    ],
    score_tips: [
      '一篇計時 9 分鐘；檢討時把每一格可能的詞性與線索寫在空格旁（練習的份量照逐週計畫）。',
      '錯的格一定連同「被我用掉的那個選項原本屬於哪一格」一起檢討。',
      '背單字時記下常見字的第二詞性（名詞當動詞、形容詞當名詞）。',
    ],
    stat_note: '成績前 20% 與後 20% 的考生（五等分組）在這一大題的平均答對率每年相差 69–86 個百分點；學測 111–115 年中有 4 年是各大題裡相差最多的（本站推算）。',
    basis: ['docs/analysis/sections/03-word_bank.md'],
    cover_en:
      'first the part of speech the blank needs (articles, prepositions, subject and object around it), then meaning and collocation; a common word may fill the blank with a second part of speech or an extended sense (even as a verb, the faithful as a noun), so check for that before ruling an option out; options that fit the sentence but not the passage; chain errors, using the student\'s other answers in the group; for several blanks, elimination across the blanks.',
  },
  {
    section: 'structure',
    title: '篇章結構',
    points: 8,
    suggested_minutes: 7,
    unit: { label: '一篇（4 格）', minutes: 10 },
    steps: [
      '先讀全文，抓每一段的主題句；每個空格的前一句與後一句一定要讀。',
      '讀每個選項句，圈出它往前指的線索（this、these、such、the＋名詞、also、however、for example）。',
      '先填線索最明確的格：前後兩側都有錨點、用具體名詞或重複詞彙接起來的格最穩。',
      '連接詞要確認前後的邏輯真的是那種關係；also、for example、thus 這類泛用連接詞常常可以接好幾格，不能單靠它決定。',
      '放進去之後把整段從頭讀一次；115 年起多一個多餘句，最後剩下的選項要確認真的放不進任何一格。',
    ],
    traps: [
      '相鄰兩格的正解互相競爭：局部都說得通，只能靠整段的架構分開。',
      '重複前後句實詞的選項：字面相同不代表邏輯接得上。',
      '多餘句：和某一格的前後句共用好幾個詞，內容卻相反或岔開。',
    ],
    score_tips: [
      '練習時把每一格的線索畫成箭頭（代名詞指向哪個字、哪個詞重複出現）。',
      '做錯的格檢討「我漏看的是指涉、詞彙鏈還是轉承」（練習的份量照逐週計畫）。',
    ],
    stat_note:
      '以連接詞為主要線索的格最容易出錯：答對率中位數 .505、17% 屬於超越頂標難度；以重複詞彙為線索的格是 .66、3%（學測 111–115 年與指考合併 125 格，本站推算）。',
    basis: ['docs/analysis/sections/04-structure.md'],
    cover_en:
      'pronoun reference, lexical chains, transition words, and the logic of the content; rereading the whole paragraph with the sentence in place; what kind of sentence the extra option is.',
  },
  {
    section: 'reading',
    title: '閱讀測驗',
    points: 24,
    suggested_minutes: 25,
    unit: { label: '一篇（4 題）', minutes: 12 },
    steps: [
      '先看四題的題幹（先不看選項），知道要找什麼：主旨、細節、推論、詞義、指涉、目的或看圖。',
      '讀文章時每段用幾個字標出段意，題幹問到的人名、數字、關鍵字先畫起來。',
      '每一題回原文找證據句，先用證據句想答案，再看選項；不要先讀選項再回頭找支持。',
      '刪選項時說出理由：細節被偷換、和原文相反、以偏概全、文中沒提到、正確但答非所問。',
      '主旨題選能涵蓋每一段的；指涉題把選項代回原句；NOT 題四個選項逐一核對。',
      '一篇控制在 8 分鐘內，卡住的題先做記號往下做，最後再回來。',
    ],
    traps: [
      '用了原文的字、但關係或細節被拼錯的選項。',
      '和原文相反，或把一部分說成全部（以偏概全）。',
      '指涉題裡「位置更近、但指錯」的名詞。',
      '本身是對的，卻不是題目問的（答非所問）。',
    ],
    score_tips: [
      '一篇計時 8 分鐘；檢討時每一題寫下證據句在第幾段第幾行（練習的份量照逐週計畫）。',
      '錯題依誘答種類記錄（偷換細節、相反、以偏概全、沒提到），看自己最常被哪一種騙。',
      '主題不熟（科學、社會議題）的文章，把主題字整理成一張表。',
    ],
    stat_note:
      '照抄原文字詞的誘答主要只騙到後段考生；騙到官方高分組（全體到考考生的前 33%）的是「部分成立」的選項：指錯對象、和原文相反、以偏概全這三類的平均吸引力最高（學測 111–115 年 180 個誘答，本站推算）。',
    basis: ['docs/analysis/sections/05-reading.md'],
    cover_en:
      'the question type (main idea, detail, inference, word in context, reference, purpose, tone, chart); the evidence sentence; which kind of lure the student\'s option is (swapped detail, wrong scope or degree, over-inference, not mentioned, true but not what is asked); for a group, the structure of the whole passage first.',
  },
  {
    section: 'mixed',
    title: '混合題',
    points: 10,
    suggested_minutes: 10,
    unit: { label: '一組', minutes: 15 },
    steps: [
      '先看每一小題要什麼：填充要寫幾個字、簡答限幾個字、多選題要選出所有正確的選項。',
      '讀文章時標出每一則文本（留言、清單、雙文本）的立場與條件句。',
      '填充：在原文找到對應的句子後，依空格前後的文法改字形（詞性、單複數、時態），題目要一個字就只寫一個字。',
      '簡答：照題幹要求的形態寫（名詞片語、動名詞），不要抄整句。',
      '多選：每個選項獨立判定，該選沒選和不該選卻選了一樣扣 2/n（n 是選項數）；每個選項回原文判斷，「比較可能對」就勾、「比較可能錯」就不勾；全部不勾是 0 分。',
      '寫完檢查拼字與大小寫。',
    ],
    traps: [
      '從原文找到字卻沒有改字形（該用名詞寫成形容詞、該用過去分詞寫成 -ing）。',
      '答案多寫字或抄整句。',
      '多選裡「大意說得通、細節不符」，或「有條件句、但講的是別人」的選項。',
    ],
    score_tips: [
      '填充與簡答的答案寫完先自己念一次，確認放回原文的句子文法正確（練習的份量照逐週計畫）。',
      '把「詞性變化」整理成表（-tion、-ment、-ness、-ive、-ly），填充題常考。',
    ],
    stat_note:
      '書寫部分（填充＋簡答 6 分）是整份考卷最難拿分的地方：學測 111–115 年平均得分率約 .31，低於同年多選題的 .38–.57（本站推算）。',
    basis: ['docs/analysis/sections/06-mixed.md'],
    cover_en:
      'fill-in items need the right word form and usually a single word taken from the passage; short answers must keep the form the stem asks for; multiple-select options are judged one by one: a correct option left unselected costs as much as a wrong option selected, so select each option the text more likely supports and leave out each it more likely does not, and leaving every option blank scores zero.',
  },
  {
    section: 'translation',
    title: '中譯英',
    points: 8,
    suggested_minutes: 8,
    unit: { label: '一題（兩句）', minutes: 20 },
    steps: [
      '先找每句的主要子句：誰（主詞）做了什麼（動詞）；中文沒寫主詞時自己補上合適的主詞。',
      '找時態線索：「已經」「自…以來」「到目前為止」，以及沒有明確過去時間、表示經驗的「曾經」，用現在完成式；有明確的過去時間（去年、小時候、2010 年）才用過去式。',
      '列出關鍵詞，先寫最有把握的字：常用字寫對，比難字寫錯好。',
      '中文放在名詞前面的長修飾語，英文改成關係子句或介系詞片語放到名詞後面。',
      '寫完逐字檢查：主詞動詞一致、單複數、冠詞、拼字、句首大寫與句尾句點。',
    ],
    traps: [
      '時態線索沒看出來（「已經」「自從」「曾經」沒用完成式）；「這是我看過最…的」要寫成最高級＋現在完成式（the most … I have ever seen）。',
      '可數名詞忘了複數、「…之一」後面用單數。',
      '中文省略主詞，英文也跟著沒有主詞。',
      '名詞前的長修飾語照中文順序直譯。',
    ],
    score_tips: [
      '寫完送 AI 批改，再用學習助手看錯誤依類別的整理（練習的份量照逐週計畫）。',
      '把自己錯過的句型（完成式、被動、關係子句、比較）各準備一個會寫的例句。',
      '常錯的字（拼字、詞性）整理成清單，寫完對照檢查。',
    ],
    stat_note:
      '學測 111–115 年中譯英的全國平均每年在 2.56–3.41 分之間（滿分 8 分）；題目裡較難的實詞越多，當年得分越低（學測與指考 97–115 年合併 33 年，等級相關 −0.44，本站推算）。',
    basis: ['docs/analysis/sections/07-writing.md'],
    cover_en:
      'the main clause and the tense trigger in each Chinese sentence (for example 已經, 自從…以來, or 曾經 for experience with no definite past time call for the present perfect, and only a definite past time calls for the simple past); errors grouped by category as the student\'s sentence, the rule, and a self-check; common traps (tense triggers, countable nouns and plurals, Chinese sentences without a subject, long modifiers before a noun); alternatives in short phrases only.',
  },
  {
    section: 'composition',
    title: '英文作文',
    points: 20,
    suggested_minutes: 25,
    unit: { label: '一篇', minutes: 45 },
    steps: [
      '先花 3–5 分鐘審題：題目要寫幾段、每一段要回答什麼，逐項列出來，一項都不能漏。',
      '第一段直接回應第一段的要求；第二段寫深寫廣：具體的例子、經驗或原因，不重複第一段。',
      '每段第一句寫主題句，段內用轉承詞串起來（first of all、for example、as a result、however）。',
      '用有把握的常用字與句型寫準，少用不確定的難字；句型適度變化（分詞構句、關係子句、副詞子句）。',
      '留 3 分鐘檢查：字數（至少 120 個單詞）、分段、時態、主詞動詞一致、拼字與大小寫。',
    ],
    traps: [
      '漏寫題目要求的其中一項，或寫偏題目的重點。',
      '第二段只是換句話重複第一段。',
      '為了用難字或長句寫錯，反而讓意思不清楚。',
      '沒有分段或字數明顯不足會另外扣分。',
    ],
    score_tips: [
      '寫完送 AI 批改，先看四項裡分數最低的一項，下一篇只針對它改（練習的份量照逐週計畫）。',
      '準備每段開頭、舉例、轉折、結論各兩三種說法，練到能自然寫出來。',
      '內容具體最重要：每段至少一個具體的例子、經驗或細節。',
    ],
    stat_note: '學測 111–115 年作文的全國平均每年在 7.74–8.45 分之間（滿分 20 分），拿到 15 分以上的考生每年只有 5.3–8.3%（本站整理）。',
    basis: ['docs/analysis/sections/07-writing.md'],
    cover_en:
      'for each of the four criteria, the main reason points were lost and the next step; paragraph organization and transitions; accurate common words matter more than difficult words.',
  },
  {
    section: 'vocab_word',
    title: '單字',
    points: null,
    suggested_minutes: null,
    unit: { label: '一次', minutes: 15 },
    steps: [
      '每天先複習到期的字（站內的單字複習），再學新字。',
      '新字一次 15–20 個，記字義時同時記一個搭配詞或短例句。',
      '易混字放在一起比較（postpone／delay／cancel），寫下怎麼分辨。',
      '錯過 3 次以上的字另外整理，用自己的句子各造一句。',
      '考前 3 週停止新字，只複習。',
    ],
    traps: ['只背第一個中文意思，遇到延伸義或轉品就認不出來。', '字形相近的字混在一起（adapt／adopt、affect／effect）。'],
    score_tips: ['分散在每天複習，比週末一次背很多有效（複習的份量照逐週計畫）。', '錯題本的字優先複習。'],
    stat_note: '學測詞彙題的難度主要不在字的級別，而在常見字的延伸義、轉品與搭配（學測 91–115 年，本站推算）。',
    basis: ['docs/analysis/sections/01-vocabulary.md', 'docs/research/03-vocab-list.md'],
    cover_en:
      'the meanings most likely to appear on the GSAT, collocations, the word family, confusable words, and a memory tip; with several words, group the confusable ones.',
  },
];

/** 方法庫：每個大題一筆（順序固定，系統提示依這個順序列出）。 */
export const ASSIST_SECTION_METHODS: Readonly<Record<AssistMethodSection, AssistSectionMethod>> = Object.fromEntries(SECTION_METHODS.map((m) => [m.section, m])) as Record<
  AssistMethodSection,
  AssistSectionMethod
>;

/** 這個大題有沒有方法庫（文法、其他沒有）。 */
export function isAssistMethodSection(section: string | null | undefined): section is AssistMethodSection {
  return typeof section === 'string' && (ASSIST_METHOD_SECTIONS as readonly string[]).includes(section);
}

export interface AssistErrorMethod {
  code: AssistErrorCode;
  /** 這個錯因是什麼（固定說明）。 */
  explain: string;
  /** 自我檢查方法（下一題就能用）。 */
  self_check: string;
}

/** 每個錯因一筆（報告「常見錯誤樣態」旁的固定說明）。 */
export const ASSIST_ERROR_METHODS: Readonly<Record<AssistErrorCode, AssistErrorMethod>> = {
  word_meaning: {
    code: 'word_meaning',
    explain: '看到字只知道大概，或根本不認得，所以判斷不出哪個選項最貼切。',
    self_check: '錯過的字記下「題目裡的意思＋一個搭配」，三天後遮住中文再測一次。',
  },
  word_sense: {
    code: 'word_sense',
    explain: '常見字用了第二、第三個意思（grave concerns 的 grave＝嚴重的、choked with traffic）或換了詞性（elbow、grace 當動詞），只用第一個中文意思去套就會選錯。',
    self_check: '選項都認得卻選錯時，問自己：這個字在這裡能不能當別的詞性、別的意思？查字典看第 2、3 個義項。',
  },
  collocation: {
    code: 'collocation',
    explain: '意思接近的字，習慣搭配的名詞或介系詞不同（make／do a decision、heavy／strong rain）。',
    self_check: '把選項放回原句唸一次，問「英文會這樣說嗎」；記單字一律連搭配一起記。',
  },
  word_form: {
    code: 'word_form',
    explain: '詞性或字形錯：該用名詞卻用形容詞、該用過去分詞卻用 -ing；混合題的填充最常見。',
    self_check: '填完看空格後面：冠詞＋空格＋名詞要形容詞；冠詞＋空格＋動詞或介系詞要名詞；be 動詞後面可能是形容詞或分詞。再確認單複數與時態。',
  },
  phrase: {
    code: 'phrase',
    explain: '片語或慣用語照字面猜意思（take after、come up with）。',
    self_check: '片語題先想整個片語的意思，再看受詞與上下文；同一個動詞的片語整理成一張表。',
  },
  grammar: {
    code: 'grammar',
    explain: '時態、子句、分詞、假設語氣等句子結構判斷錯。',
    self_check: '先找出句子的主要動詞與連接詞：一個句子有兩個動詞時，中間要有連接詞或關係詞，否則其中一個要改成分詞或不定詞。',
  },
  logic_relation: {
    code: 'logic_relation',
    explain: '轉折、因果、正負方向判斷錯：沒看出前後句是對比還是補充。',
    self_check: '在前後兩句旁標＋或－：方向相同用 and、also，方向相反用 but、however，前因後果用 so、therefore。',
  },
  clue_scope: {
    code: 'clue_scope',
    explain: '只看空格所在的那一句，沒有往前後文找線索。',
    self_check: '選出「本句說得通」的答案後，再讀前一句和後一句，仍然通順才決定。',
  },
  cohesion: {
    code: 'cohesion',
    explain: '指涉、詞彙鏈、連接詞沒看出來：不知道 this、they、such 指的是什麼。',
    self_check: '圈出代名詞與「the＋名詞」，畫箭頭連到它指的字；連不起來就是放錯位置。',
  },
  main_idea: {
    code: 'main_idea',
    explain: '主旨、目的、標題判斷錯：選了只涵蓋一段的選項，或範圍太大的選項。',
    self_check: '主旨選項要能涵蓋每一段：拿每段的段意去檢查，有一段放不進去就刪掉。',
  },
  detail_match: {
    code: 'detail_match',
    explain: '細節對不上：人物、數字、時間或程度被偷換。',
    self_check: '回原文找到證據句，逐一比對選項的主詞、動作、數字與程度字（always、some、most）。',
  },
  over_inference: {
    code: 'over_inference',
    explain: '過度推論：選了文章沒寫、只是聽起來合理的結論。',
    self_check: '推論題的答案要能指出「哪一句可以推出它」；指不出來就是過度推論。',
  },
  surface_lure: {
    code: 'surface_lure',
    explain: '被字面相同或主題字吸走：選項用了原文的字，意思或關係卻不同。',
    self_check: '看到和原文一樣的字要提高警覺：先用自己的話說一次選項的意思，再和原文比對。',
  },
  question_misread: {
    code: 'question_misread',
    explain: '看錯題目要求：NOT、EXCEPT、選出所有正確的、限幾個字。',
    self_check: '讀題幹時把 NOT、EXCEPT、LEAST、要選幾個、限幾個字圈起來，作答後再看一次。',
  },
  elimination: {
    code: 'elimination',
    explain: '排除法沒用好、連鎖錯：一格選錯，正確答案被用掉，另一格跟著錯。',
    self_check: '先填最有把握的格，最後幾格用剩下的選項回頭檢查；同一個選項用了兩次就兩格一起重看。',
  },
  spelling: {
    code: 'spelling',
    explain: '拼字錯：長字、重複的子音、相近的字尾（-ance／-ence、-able／-ible）。',
    self_check: '寫完逐字看一次常錯的字尾；錯過的字列成清單，每週默寫一次。',
  },
  answer_format: {
    code: 'answer_format',
    explain: '作答形式不合：字數超過、沒照題幹要求的形態、抄整句。',
    self_check: '下筆前確認題目要幾個字、什麼詞性；寫完數一次字數。',
  },
  sentence_structure: {
    code: 'sentence_structure',
    explain: '中譯英的句子骨架沒抓對：主要子句、修飾語的位置、中文省略的主詞。',
    self_check: '先寫出「主詞＋動詞＋受詞」的骨架，再把時間、地點與修飾語加上去。',
  },
  omission: {
    code: 'omission',
    explain: '漏譯、多譯或離題：中文的某個意思沒翻到、自己多加意思，或作文沒回應某一項要求。',
    self_check: '把中文（或題目要求）逐項打勾，確認每一項在英文裡都有對應。',
  },
  content_organization: {
    code: 'content_organization',
    explain: '作文的內容與組織：段落重點不清楚、例子不具體、段落之間沒有轉承。',
    self_check: '寫完只讀每段第一句，看能不能說出這段在講什麼；每段至少有一個具體的例子或經驗。',
  },
  careless: {
    code: 'careless',
    explain: '粗心：會，但寫錯、看錯或在答題卷上劃錯。',
    self_check: '交卷前留 2 分鐘檢查答題卷的劃記、單複數與大小寫；這 2 分鐘從詞彙、綜合測驗省下的時間來。錯題記下是哪一種粗心。',
  },
  time: {
    code: 'time',
    explain: '時間不夠，最後幾題用猜的。',
    self_check: '照建議時間計時練習每一大題，記錄每篇閱讀花幾分鐘；超時的題先做記號往下做。',
  },
  knowledge_gap: {
    code: 'knowledge_gap',
    explain: '缺背景知識或觀念：不熟題目的主題（科學、社會議題），或某個文法觀念。',
    self_check: '把不熟的主題字與觀念整理成筆記，同一個主題的文章多讀兩篇。',
  },
};
