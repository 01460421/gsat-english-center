/**
 * 學習助手國文版的文案（docs/design/assistant-subjects.md §8.2）：集中在這裡，頁面與元件只引用常數。
 * 不寫官方考試機構的名稱或縮寫（一律寫「官方」），也不寫 AI 模型的名稱。
 */
import type { AssistDoubtKind, ZhCoverage, ZhDraftStatus } from '@gsat/shared';

export const ZH_COPY = {
  /** 學習助手首頁的主要按鈕（兩科都開放時）。 */
  askEnglish: '問英文題',
  askChinese: '問國文題',
  /** 科目 chip 下方。 */
  notYetOpen: '數學、社會、自然還沒開放',
  pasteTitle: '貼上國文題目',
  pasteIntro: '把講義、段考的國文題目貼上來（不用轉錄點數）。只貼要問的題目、選項與要用到的文章或注釋，不要貼答案、詳解或評分說明。',
  photoTitle: '拍照問國文題',
  photoIntro: '拍下講義、段考的國文題目；直書的也可以。只框你要問的題目。',
  photoNote: '不要拍到答案、詳解、評分說明、範文或佳作，也不要拍到姓名、學號或學校。',
  placeholder: '把題目貼在這裡，包含題幹、選項與要用到的文章或注釋。畫底線的地方可以選取後按「標示底線」。',
  formReminder: '錯字是題目的一部分：請照原卷逐字輸入，別讓輸入法改正（例如打成「不菲」「索居」）。',
  labelHint: '題號，例如 12、34(1)；題目裡有好幾題時填要問的題號，用頓號或逗號分開。',
  choiceAnswerHint: '你選的選項，例如 B 或 AC',
  shortAnswerHint: '你寫的答案（可以不填）',
  draftHint: '你寫的一段（選填，最多 250 字；只看這一段，不打分數）',
  draftQ1: '這是問題（一）的答案（最多 80 字）',
  knownKeySummary: '我有講義答案',
  knownKeyHint: '講義或考卷給的答案（選填）。填了會依它判斷對錯，AI 不同意時會告訴你。',
  answerSectionRejected: '請刪掉答案與解析再送出（已加亮那一段）；選擇題的答案字母可以填在「我有講義答案」。',
  offTopic: '學習助手的國文模式只回答國文學習與學測國文相關的問題。',
  writingNotice: 'AI 不打分數，示範不是佳作。',
  demoNotOfficial: '本站 AI 示範，不是官方答案',
  exampleNotGoodWork: 'AI 示範，不是佳作',
  capCardNote: '讀音、字形請查教育部辭典',
  relatedCase: '用同一份題目問另一部分',
  relatedCaseHint: '題目已經帶入上一題確認過的文字；改選要問的題號與格式就能送出（不用再拍照或轉錄）。',
  reportEnglishOnly: '學習報告目前只涵蓋英文；國文的解析在學習助手首頁，用「國文」篩選。',
  mistakesHint: '國文的解析在學習助手首頁，用「國文」篩選。',
  copyNone: '題目沒有限制抄錄：可以用原文關鍵詞，但要組成回答題目問題的句子。',
  copyMust: '這題必須抄錄原文：答案要逐字出自原文。',
  copyMustNot: '這題不可抄錄原文：要用自己的話寫。',
  notVerbatim: '這不是原文的文句。',
  copiedRun: '這段和原文相同，題目規定不可抄錄。',
  demoSummary: 'AI 示範答案（先自己改寫一次再看）',
} as const;

/** 「你卡在哪裡」的國文標籤（代碼和英文相同；§8.2）。 */
export const ZH_DOUBT_LABELS: Record<AssistDoubtKind, string> = {
  why_not_mine: '為什麼不是我選的',
  torn_between: '我在兩個選項之間猶豫',
  guessed: '我是猜的',
  sentence_unclear: '這句（文言）看不懂',
  unknown_word: '有不懂的字詞',
  faster_method: '想知道更快的解法',
};

/** 貼上的國文題目可以勾的疑問（「猶豫」要兩個選項，貼上時不列）。 */
export const ZH_DOUBT_KINDS: readonly AssistDoubtKind[] = ['why_not_mine', 'guessed', 'sentence_unclear', 'unknown_word', 'faster_method'];

export const ZH_COVERAGE_TEXT: Record<ZhCoverage, string> = {
  full: '符合',
  partial: '部分符合',
  none: '不符合',
  unanswered: '還沒作答',
};

export const ZH_DRAFT_STATUS_TEXT: Record<ZhDraftStatus, string> = {
  met: '符合',
  partly: '部分符合',
  missing: '缺',
};

/** 追問的建議（國文版；模型沒給 chip 時用）。 */
export const ZH_FOLLOWUP_PLACEHOLDER = '例如：這句文言怎麼翻？(C) 為什麼不對？';
