/**
 * 英文作文的評分規準摘要（本站撰寫；D8：不轉載官方評分原則或評分指標表）。
 *
 * 四個面向各 0–5 分，描述分優（5–4）、可（3）、差（2–1）、劣（0）。用在：
 *   - 模擬考的作文自評（features/mock/selfAssess.ts 從這裡匯入並轉匯出）；
 *   - 自訂題目作答頁的「評分規準摘要（本站撰寫）」收合區（docs/design/custom-essay.md §4.7）。
 * AI 批改用的是 apps/api/src/ai/prompts/essay.ts 的 ESSAY_RUBRIC（更細的分數描述）：兩份的四個面向必須一致，
 * 改了任何一邊的面向，另一邊要一起改。
 */

export type CompositionCriterion = 'content' | 'organization' | 'grammar' | 'vocabulary';

/** 四項各 0–5 分；描述是本站自己的話（優 5–4、可 3、差 2–1、劣 0）。 */
export const COMPOSITION_CRITERIA: readonly {
  key: CompositionCriterion;
  title: string;
  levels: { range: string; text: string }[];
}[] = [
  {
    key: 'content',
    title: '內容',
    levels: [
      { range: '5–4', text: '完整回應提示的每個要求，論點清楚，有具體的例子或細節支持。' },
      { range: '3', text: '回應了主要要求，但細節較少或不夠具體。' },
      { range: '2–1', text: '漏掉部分要求，或內容空泛、重複。' },
      { range: '0', text: '幾乎沒有內容，或完全沒有回應提示。' },
    ],
  },
  {
    key: 'organization',
    title: '組織',
    levels: [
      { range: '5–4', text: '依要求分段，每段有主題句，前後連貫，轉承語使用自然。' },
      { range: '3', text: '有分段、大致有條理，但段落間銜接較弱。' },
      { range: '2–1', text: '分段或順序混亂，讀者不容易跟上。' },
      { range: '0', text: '沒有組織可言。' },
    ],
  },
  {
    key: 'grammar',
    title: '文法句構',
    levels: [
      { range: '5–4', text: '句型有變化（例如子句、分詞構句），錯誤很少且不影響理解。' },
      { range: '3', text: '多為簡單句，有一些錯誤，但意思大致清楚。' },
      { range: '2–1', text: '錯誤多，常影響理解。' },
      { range: '0', text: '錯誤多到無法理解。' },
    ],
  },
  {
    key: 'vocabulary',
    title: '字彙拼字',
    levels: [
      { range: '5–4', text: '用字精確、有變化，搭配詞恰當，幾乎沒有拼字錯誤。' },
      { range: '3', text: '用字普通、偶有重複，有少數拼字或用字錯誤。' },
      { range: '2–1', text: '字彙有限，拼字或用字錯誤多。' },
      { range: '0', text: '字彙不足以表達。' },
    ],
  },
];
