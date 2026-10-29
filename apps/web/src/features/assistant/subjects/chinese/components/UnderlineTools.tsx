/**
 * 「標示底線」「取消底線」（docs/design/assistant-subjects.md §1.3、§6.4）：國文題目常考畫線的字詞，學生選取文字後按鈕，
 * 程式把選取的字包成 ⟦…⟧（取消時拿掉選取範圍裡與緊鄰兩側的標記）。只改文字框的值，不經 innerHTML。
 * 按鈕按下時文字框失焦，但 selectionStart／selectionEnd 還在，所以直接讀；改完把選取範圍還原。
 */
import { Underline } from 'lucide-react';
import type { RefObject } from 'react';

export interface TextSelection {
  text: string;
  start: number;
  end: number;
}

/** 選取範圍包成一段底線（已經有標記的範圍不重複包）；沒有選取時原樣回傳。純函式（測試用）。 */
export function addZhUnderline(text: string, start: number, end: number): TextSelection {
  if (end <= start) return { text, start, end };
  const inner = text.slice(start, end);
  if (/[⟦⟧]/.test(inner) || (text[start - 1] === '⟦' && text[end] === '⟧')) return { text, start, end };
  return { text: `${text.slice(0, start)}⟦${inner}⟧${text.slice(end)}`, start: start + 1, end: end + 1 };
}

/** 拿掉選取範圍裡、以及緊鄰兩側的底線標記（⟦ ⟧，波浪線 ⟦~ ~⟧）。純函式（測試用）。 */
export function removeZhUnderline(text: string, start: number, end: number): TextSelection {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.max(start, end);
  if (text.startsWith('⟦~', s - 2)) s -= 2;
  else if (text[s - 1] === '⟦') s -= 1;
  if (text.startsWith('~⟧', e)) e += 2;
  else if (text[e] === '⟧') e += 1;
  const inner = text.slice(s, e);
  const cleaned = inner.replace(/⟦~|~⟧|[⟦⟧]/g, '');
  if (cleaned === inner) return { text, start, end };
  return { text: `${text.slice(0, s)}${cleaned}${text.slice(e)}`, start: s, end: s + cleaned.length };
}

export function UnderlineTools({
  target,
  value,
  onChange,
  disabled = false,
}: {
  target: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const apply = (fn: (text: string, start: number, end: number) => TextSelection) => {
    const el = target.current;
    if (!el) return;
    const next = fn(value, el.selectionStart, el.selectionEnd);
    if (next.text === value) {
      el.focus();
      return;
    }
    onChange(next.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        disabled={disabled}
        onClick={() => apply(addZhUnderline)}
        className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-3 lg:hover:bg-surface-2 disabled:opacity-50"
      >
        <Underline aria-hidden="true" className="size-4" />
        標示底線
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => apply(removeZhUnderline)}
        className="inline-flex min-h-11 items-center rounded-full border border-line px-3 lg:hover:bg-surface-2 disabled:opacity-50"
      >
        取消底線
      </button>
      <span className="text-xs text-muted">先選取畫線的字，再按按鈕（會加上 ⟦ ⟧ 標記）。</span>
    </div>
  );
}
