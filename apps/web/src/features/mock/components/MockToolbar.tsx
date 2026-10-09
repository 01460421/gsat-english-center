/**
 * 作答時固定在畫面上方的工具列：剩餘時間（期限倒數）、模式、已答／已標記、交卷。
 *
 * 只有倒數計時（MockClock）與實考模式的交卷鎖每秒重繪；剩 10／5／1 分鐘用 aria-live 提醒一次，不每秒播報。
 * 時間到自動交卷（onTimeout）。實考模式開考 60 分鐘內交卷鈕停用，旁邊寫出還要等多久。
 */
import { Flag, Timer as TimerIcon } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { formatClock, formatDuration } from '../../exams/labels';
import { isAnswered } from '../../exams/scoring';
import { useMockMeta } from '../MockSessionContext';
import { crossedWarning, remainingSec, strictLockRemainingSec } from '../timer';
import { useNow } from '../useNow';

/** active 為 false（唯讀：別的分頁在作答）時照樣倒數，只是時間到不在這個分頁交卷。 */
function MockClock({ onTimeout, active }: { onTimeout: () => void; active: boolean }) {
  const deadlineAt = useMockMeta((m) => m.deadlineAt);
  const now = useNow();
  const remaining = remainingSec({ deadlineAt }, now);
  const previous = useRef(remaining);
  const [announcement, setAnnouncement] = useState('');
  const fired = useRef(false);

  useEffect(() => {
    const warn = crossedWarning(previous.current, remaining);
    previous.current = remaining;
    if (warn !== null) setAnnouncement(`剩下 ${warn / 60} 分鐘`);
    if (active && remaining <= 0 && !fired.current) {
      fired.current = true;
      onTimeout();
    }
  }, [remaining, active, onTimeout]);

  const urgent = remaining <= 300;
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${urgent ? 'text-bad' : ''}`}>
      <TimerIcon aria-hidden="true" className="size-4" />
      <span className="text-xs font-normal text-muted">剩餘</span>
      <span role="timer" aria-label={`剩餘時間 ${formatDuration(remaining)}`}>
        {formatClock(remaining)}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}

/** 交卷鈕；實考模式前 60 分鐘停用（只有停用期間每秒重繪）。 */
function SubmitControl({ onSubmit, disabled, buttonRef }: { onSubmit: () => void; disabled: boolean; buttonRef: Ref<HTMLButtonElement> }) {
  const strict = useMockMeta((m) => m.strict);
  const startedAt = useMockMeta((m) => m.startedAt);
  const [unlocked, setUnlocked] = useState(() => strictLockRemainingSec({ strict, startedAt }, Date.now()) === 0);
  const now = useNow(!unlocked);
  const lockLeft = strictLockRemainingSec({ strict, startedAt }, now);
  useEffect(() => {
    if (lockLeft === 0 && !unlocked) setUnlocked(true);
  }, [lockLeft, unlocked]);
  const locked = lockLeft > 0;
  return (
    <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {locked && (
        <span id="mock-submit-lock" className="text-xs text-muted">
          <span className="sm:hidden">
            還要 <span className="tabular-nums">{formatClock(lockLeft)}</span> 才能交卷
          </span>
          <span className="hidden sm:inline">
            開考 60 分鐘後才能交卷（還要 <span className="tabular-nums">{formatClock(lockLeft)}</span>）
          </span>
        </span>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={onSubmit}
        disabled={disabled || locked}
        aria-describedby={locked ? 'mock-submit-lock' : undefined}
        className="min-h-9 rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary disabled:opacity-50"
      >
        交卷
      </button>
    </span>
  );
}

export function MockToolbar({
  total,
  onSubmit,
  onTimeout,
  readOnly,
  submitRef,
}: {
  total: number;
  onSubmit: () => void;
  onTimeout: () => void;
  readOnly: boolean;
  submitRef: Ref<HTMLButtonElement>;
}) {
  const strict = useMockMeta((m) => m.strict);
  const markedCount = useMockMeta((m) => m.marked.length);
  const answers = useAttemptSelector((s) => s.answers);
  let answered = 0;
  for (const value of Object.values(answers)) if (isAnswered(value)) answered += 1;

  return (
    <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:top-0 lg:-mx-10 lg:px-10">
      {/* 手機上收窄間距、模式只寫兩個字：390px 寬時工具列維持一到兩行。 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
          {strict ? '實考' : '考試'}
          <span className="hidden sm:inline">模式</span>
        </span>
        <MockClock onTimeout={onTimeout} active={!readOnly} />
        <span className="text-sm tabular-nums">
          已答 {answered}／{total}
        </span>
        <span className="inline-flex items-center gap-1 text-sm tabular-nums" aria-label={`已標記 ${markedCount} 題`}>
          <Flag aria-hidden="true" className="size-3.5" />
          <span aria-hidden="true">{markedCount}</span>
        </span>
        <SubmitControl onSubmit={onSubmit} disabled={readOnly} buttonRef={submitRef} />
      </div>
    </div>
  );
}
