/**
 * 國文的引文與原文核對（docs/design/assistant-subjects.md §5.2）。**S1-worker-core 建的入口；完整的規則由後處理的工作包填。**
 *
 * 呼叫端（output.ts 已經接好；下一個工作包只改這個檔、output.ts 與其他步驟檔）：
 *   zhLocateQuote        每一個 quote 欄位：比對時兩邊轉 zhMatchKey（去標點、標記，圈號統一），找到回原文位置（左欄加亮）。
 *                        題目引文找題目的全部區塊；國寫片段的引文只找學生的片段（where: 'student_text'）。
 *   zhCheckQuotes        整則的引文規則（TODO）：卡片原文列（translation、poetry 的 head）找不到時拿掉「原文」標示並計
 *                        card_head_unmatched；「注X」引用題目沒有的注釋時去掉那一句（notes_unmatched）；選文總量 30%（至少 120 字，
 *                        只算白話、非公有領域的選文 ≥ 300 字）；抄錄題示範逐字出自原文（copy_demo_removed）。
 * 目前的行為：zhLocateQuote 已經做基本的子字串比對（shared 的 zhFindQuote）；zhCheckQuotes 原樣回傳、不改任何欄位。
 */
import { zhFindQuote, type AssistQuestionView, type AssistQuoteRange, type ZhAnalysisView, type ZhChecks } from '@gsat/shared';

/** 引文在題目（或學生的片段）裡的位置；找不到或引文是空的回 null。 */
export function zhLocateQuote(quote: string, q: Pick<AssistQuestionView, 'blocks' | 'draft'>, where: 'question' | 'draft' = 'question'): AssistQuoteRange | null {
  if (quote.trim() === '') return null;
  if (where === 'draft') {
    const draft = q.draft?.text ?? '';
    const at = zhFindQuote(draft, quote);
    return at ? { where: 'student_text', ref: null, start: at.start, end: at.end } : null;
  }
  for (const [i, b] of (q.blocks ?? []).entries()) {
    const at = zhFindQuote(b.text, quote);
    if (at) return { where: 'blocks', ref: String(i), start: at.start, end: at.end };
  }
  return null;
}

/** 整則的引文規則（見檔頭；TODO：下一個工作包實作）。回傳同一個 view。 */
export function zhCheckQuotes<V extends ZhAnalysisView>(view: V, _q: AssistQuestionView, _checks: ZhChecks): V {
  return view;
}
