/**
 * 交卷確認對話框：列出未作答的題號（依大題）與標記的題號，可以點題號回去檢查。
 * 用原生 <dialog>（showModal）：焦點自動移入、Esc 關閉、背景不能操作；關閉後焦點回到「交卷」按鈕。
 *
 * 桌機（≥ lg；docs/design/desktop-polish.md §3.7）：動作列固定在對話框底部（未作答很多時「確定交卷」「繼續作答」也一直看得到，
 * 焦點所在的「繼續作答」不會在捲動區下面）、右上角關閉鈕、說明寫出標記題數與剩餘時間、一個大題沒答的超過 10 題時先收成一行。
 * 手機與平板的畫面不變（只加 lg: 的 class，其他放在 useIsDesktop() 的分支）。
 */
import { useId, useRef, type RefObject } from 'react';
import { useIsDesktop } from '../../../lib/media';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { UnansweredList } from '../../exams/components/UnansweredList';
import { formatClock } from '../../exams/labels';
import { questionTitle } from '../../exams/richText';
import { useMockMeta } from '../MockSessionContext';
import { orderedMarks, unansweredBySection, type PaperIndex } from '../paperIndex';
import { remainingSec } from '../timer';
import { useNow } from '../useNow';
import { btn } from '../../../components/ui/buttons';
import { Dialog } from '../../../components/ui/Dialog';

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
  // 開啟時焦點放在「繼續作答」：誤按 Enter 不會直接交卷。
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const isDesktop = useIsDesktop();
  const answers = useAttemptSelector((s) => s.answers);
  const marked = useMockMeta((m) => m.marked);

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
    <Dialog
      open={open}
      title="確定要交卷嗎？"
      onClose={() => close()}
      describedBy={`${id}-desc`}
      initialFocusRef={cancelRef}
      restoreFocus={false}
      dim="strong"
      size="lg"
      closeButton={isDesktop}
      actions={
        <>
          <button type="button" onClick={onConfirm} className={btn('primary', 'md')}>
            確定交卷
          </button>
          <button ref={cancelRef} type="button" onClick={() => close()} className={btn('secondary', 'md')}>
            繼續作答
          </button>
        </>
      }
    >
      {open && (
        <>
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
        </>
      )}
    </Dialog>
  );
}
