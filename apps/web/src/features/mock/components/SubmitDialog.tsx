/**
 * 交卷確認對話框：列出未作答的題號（依大題）與標記的題號，可以點題號回去檢查。
 * 用原生 <dialog>（showModal）：焦點自動移入、Esc 關閉、背景不能操作；關閉後焦點回到「交卷」按鈕。
 */
import { useEffect, useId, useRef, type RefObject } from 'react';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { questionTitle } from '../../exams/richText';
import { useMockMeta } from '../MockSessionContext';
import { orderedMarks, unansweredBySection, type PaperIndex } from '../paperIndex';

export function SubmitDialog({
  open,
  index,
  onConfirm,
  onClose,
  onGoQuestion,
  returnFocusRef,
}: {
  open: boolean;
  index: PaperIndex;
  onConfirm: () => void;
  onClose: () => void;
  onGoQuestion: (label: string) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // 開啟時焦點放在「繼續作答」：誤按 Enter 不會直接交卷。
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const answers = useAttemptSelector((s) => s.answers);
  const marked = useMockMeta((m) => m.marked);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      // 焦點放在「繼續作答」但不捲動：手機上未作答題號很多，捲到底就看不到標題與「還有 N 題沒有作答」。
      cancelRef.current?.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  const close = (refocus = true) => {
    onClose();
    if (refocus) window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  const unanswered = open ? unansweredBySection(index, answers) : [];
  const unansweredCount = unanswered.reduce((a, x) => a + x.labels.length, 0);
  const marks = open ? orderedMarks(index, marked) : [];

  const jump = (label: string) => {
    close(false);
    onGoQuestion(label);
  };

  const chip = (label: string) => (
    <li key={label}>
      <button
        type="button"
        onClick={() => jump(label)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-2 text-sm tabular-nums hover:border-primary"
        aria-label={`回到${questionTitle(label)}`}
      >
        {label}
      </button>
    </li>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-fg backdrop:bg-black/50"
    >
      {open && (
        <div className="space-y-4">
          <h2 id={`${id}-title`} className="text-lg font-bold">
            確定要交卷嗎？
          </h2>
          <p id={`${id}-desc`} className="text-sm">
            {unansweredCount > 0 ? `還有 ${unansweredCount} 題沒有作答。` : '每一題都作答了。'}交卷後就不能再修改答案，會直接看到成績單。
          </p>
          {unanswered.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">未作答（點題號回去作答）</h3>
              <div className="mt-1 space-y-2">
                {unanswered.map(({ section, labels }) => (
                  <div key={section.id}>
                    <p className="text-xs text-muted">{section.label}</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">{labels.map(chip)}</ul>
                  </div>
                ))}
              </div>
            </div>
          )}
          {marks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">已標記（{marks.length} 題）</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">{marks.map(chip)}</ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={onConfirm} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-on-primary">
              確定交卷
            </button>
            <button ref={cancelRef} type="button" onClick={() => close()} className="min-h-11 rounded-full border border-line px-5">
              繼續作答
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
