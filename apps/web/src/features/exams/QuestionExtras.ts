/**
 * 作答元件的擴充點：同一套題目元件（選文、空格、選項、回饋）也用在「題庫練習」的 AI 題組與「模擬考」，
 * 這兩頁要在固定位置多放一些東西——練習頁的作答中提示階梯、看答案後的四段式解析卡、選文下方的 AI 撰寫聲明、
 * 交卷後加亮的證據句；模擬考題號旁的「標記」按鈕與檢討時的「作答時標記過」標籤。
 * 這些都由外層用 context 提供；歷屆試題頁不提供（context 是 null），畫面完全不變。
 *
 * 用 context 而不是一層層加 props：題目元件很深（ExamPaper → GroupView → BankGroup → BankFeedbackItem → ChoiceFeedback），
 * 每層都要轉傳的話，歷屆試題用不到的參數會散落在所有元件裡。
 */
import { createContext, use, useMemo, type ReactNode } from 'react';
import type { Question, QuestionGroup } from '../../data/exams';
import { refersToHighlights, type TextHighlight } from './richText';
import type { AnswerValue } from './scoring';

export interface QuestionExtras {
  /**
   * 題號標題旁的附加元件，例如模擬考的「標記」切換鈕。labels 是這個題目區塊包含的題號
   * （混合題的摘要句填充一個區塊有兩題，例如 ['47', '48']）。文意選填、篇章結構的空格在選文裡、
   * 沒有題號標題，模擬考改用大題導覽裡的題號面板標記。
   */
  renderHeadingAccessory?: (labels: readonly string[]) => ReactNode;
  /** 選擇題卡片在作答中（還沒顯示答案）時，接在選項下方的內容，例如提示階梯。 */
  renderWhileAnswering?: (q: Question) => ReactNode;
  /** 選擇題看答案後，接在回饋（對錯、正確答案）下方的內容，例如四段式解析卡。 */
  renderAfterFeedback?: (q: Question, answer: AnswerValue | undefined) => ReactNode;
  /** 選文下方的附註，例如「本文由 AI 撰寫」與交卷後的全文中譯。 */
  passageFooter?: ReactNode;
  /** 額外要加亮的選文區間（題組選文座標，見 richText.ts），例如交卷後的證據句。 */
  extraHighlights?: (group: QuestionGroup) => readonly TextHighlight[];
  /**
   * 題目沒有大考中心的統計（AI 題）：回饋區不顯示「這題沒有大考中心公布的答對率統計（補考、參考試卷…）」，
   * 那段說明是寫給歷屆題的。
   */
  noOfficialStats?: boolean;
}

export const QuestionExtrasContext = createContext<QuestionExtras | null>(null);

export function useQuestionExtras(): QuestionExtras | null {
  return use(QuestionExtrasContext);
}

/** 題組選文要加亮的區間：refers_to 指的字詞，加上外層提供的（證據句），依起點排序。 */
export function useGroupHighlights(group: QuestionGroup): TextHighlight[] {
  const extras = useQuestionExtras();
  const extra = extras?.extraHighlights;
  return useMemo(() => {
    const base = refersToHighlights(group);
    if (!extra) return base;
    return [...base, ...extra(group)].sort((a, b) => a.start - b.start || a.end - b.end);
  }, [group, extra]);
}
