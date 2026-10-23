/**
 * 交卷確認對話框：列出未作答的題號（依大題）與標記的題號，可以點題號回去檢查。
 * 用原生 <dialog>（showModal）：焦點自動移入、Esc 關閉、背景不能操作；關閉後焦點回到「交卷」按鈕。
 *
 * 桌機（≥ lg；docs/design/desktop-polish.md §3.7）：動作列固定在對話框底部（未作答很多時「確定交卷」「繼續作答」也一直看得到，
 * 焦點所在的「繼續作答」不會在捲動區下面）、右上角關閉鈕、說明寫出標記題數與剩餘時間、一個大題沒答的超過 10 題時先收成一行。
 * 手機與平板的畫面不變（只加 lg: 的 class，其他放在 useIsDesktop() 的分支）。
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type RefObject } from 'react';
import { useIsDesktop } from '../../../lib/media';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { UnansweredList } from '../../exams/components/UnansweredList';
import { formatClock } from '../../exams/labels';
import { questionTitle } from '../../exams/richText';
import { useMockMeta } from '../MockSessionContext';
import { orderedMarks, unansweredBySection, type PaperIndex } from '../paperIndex';
import { remainingSec } from '../timer';
import { useNow } from '../useNow';

/** 桌機的說明：未作答與標記的題數、剩餘時間（對話框開著時每秒更新）。 */
function DesktopSummary({ id, unanswered, marked }: { id: string; unanswered: number; marked: number }) {
  const deadlineAt = useMockMeta((m) => m.deadlineAt);
  const durationSec = useMockMeta((m) => m.durationSec);
  const now = useNow();
  const left = remainingSec({ deadlineAt, durationSec }, now);
  const counts = [unanswered > 0 ? `還有 ${unanswered} 題沒有作答` : '每一題都作答了', marked > 0 ? `標記 ${marked} 題` : null].filter(Boolean).join('、');
  return (
    <p id={id} className="text-sm text-pretty">
      {counts}；剩餘時間 <span className="font-semibold tabular-nums">{formatClock(left)}</span>。交卷後就不能再修改答案，會直接看到成績單。
    </p>
  );
}

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
  const isDesktop = useIsDesktop();
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

  const desktopChipCls = 'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-line px-2 text-sm tabular-nums hover:border-primary';

  const jump = (label: string) => {
    close(false);
    onGoQuestion(label);
  };

  const chip = (label: string) => (
    <li key={label}>
      <button
        type="button"
        onClick={() => jump(label)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-2 text-sm tabular-nums hover:border-primary lg:min-h-9 lg:min-w-9"
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
      // 桌機鎖住捲動時，保留的捲軸槽用同樣濃度的遮罩色（index.css 的 html:has(dialog:modal)）。
      data-backdrop-dim="50"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-fg backdrop:bg-black/50 lg:max-w-2xl lg:shadow-lg"
    >
      {open && isDesktop && (
        <button
          type="button"
          onClick={() => close()}
          aria-label="關閉"
          className="absolute top-3 right-3 inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      )}
      {open && (
        <div className="space-y-4">
          <h2 id={`${id}-title`} className="text-lg font-bold lg:pr-10">
            確定要交卷嗎？
          </h2>
          {isDesktop ? (
            <DesktopSummary id={`${id}-desc`} unanswered={unansweredCount} marked={marks.length} />
          ) : (
            <p id={`${id}-desc`} className="text-sm">
              {unansweredCount > 0 ? `還有 ${unansweredCount} 題沒有作答。` : '每一題都作答了。'}交卷後就不能再修改答案，會直接看到成績單。
            </p>
          )}
          {isDesktop ? (
            <UnansweredList groups={unanswered} onJump={jump} chipClassName={desktopChipCls} />
          ) : (
            unanswered.length > 0 && (
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
            )
          )}
          {marks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">已標記（{marks.length} 題）</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">{marks.map(chip)}</ul>
            </div>
          )}
          {/*
            桌機：動作列黏在對話框底部（對話框自己捲動），一打開就看得到焦點所在的「繼續作答」。
            sticky 的範圍是對話框扣掉內距（p-5）的內容框：bottom 給 −1.25rem 才貼齊對話框的下緣，捲到一半時內容不會從列的下面露出來。
          */}
          <div className="flex flex-wrap gap-2 pt-1 lg:sticky lg:-bottom-5 lg:-mx-5 lg:-mb-5 lg:mt-2 lg:border-t lg:border-line lg:bg-surface lg:px-5 lg:py-3">
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
