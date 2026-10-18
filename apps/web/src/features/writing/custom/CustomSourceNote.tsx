/**
 * 自訂題目作答頁的頁尾聲明（docs/design/custom-essay.md §6.10）：題目由學生提供；AI 依本站自己寫的規準批改。
 * 不使用 SourceNote（那是歷屆題的出處）。文案不提考試機構名稱。
 */
export const CUSTOM_SOURCE_NOTE =
  '題目由你提供，本站沒有檢查題目內容是否正確。AI 依本站自己寫的學測作文評分規準（內容、組織、文法句構、字彙拼字各 0–5 分）批改，分數僅供參考。';

export function CustomSourceNote() {
  return (
    <footer className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
      <p>{CUSTOM_SOURCE_NOTE}</p>
    </footer>
  );
}
