/**
 * 作答時固定在畫面上方的工具列：模式、計時、已答題數、交卷（做法同英文歷屆試題的 ExamToolbar）。
 *
 * 計時器自己持有每秒更新的 state，只有它每秒重繪；用時每秒寫回作答紀錄（離開頁面期間不計時）。
 * 考試模式時間到自動交卷；剩 10、5、1 分鐘時用 aria-live 提醒。
 * 交卷確認列打開時焦點在「繼續作答」（連按兩次 Enter 不會交卷）；交卷後跳到成績頁。
 */
import { isMathAnswered, mathItems, scoreMathPaper } from '@gsat/shared';
import { Timer as TimerIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MathPaper } from '../../../data/math';
import { useTimedSession } from '../../../lib/timedSession';
import { useAttemptSelector, useAttemptStore } from '../../exams/AttemptContext';
import type { AttemptStore } from '../../exams/attempt';

const WARN_AT_SEC = [600, 300, 60];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h} 小時 ${m} 分`;
  if (m > 0) return `${m} 分 ${rest} 秒`;
  return `${rest} 秒`;
}

/** 交卷：當下計分（列表頁顯示用）並鎖住作答。 */
export function submitMathAttempt(store: AttemptStore, paper: MathPaper, reason: 'manual' | 'timeout'): void {
  const score = scoreMathPaper(paper, store.getState().answers);
  store.submit(reason, { earned: score.earned, autoMax: score.autoMax });
}

function MathTimer({ onTimeout }: { onTimeout: () => void }) {
  const store = useAttemptStore();
  const limit = useAttemptSelector((s) => s.timeLimitSec);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const storedElapsed = useAttemptSelector((s) => s.elapsedSec);
  const [elapsed, setElapsed] = useState(storedElapsed);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (submitted) return;
    const base = store.getState().elapsedSec;
    const startedAt = Date.now();
    const now = () => base + Math.floor((Date.now() - startedAt) / 1000);
    const flush = () => store.setElapsed(now());
    const tick = () => {
      const sec = limit === null ? now() : Math.min(now(), limit);
      setElapsed(sec);
      store.setElapsed(sec);
      if (limit === null) return;
      const remaining = limit - sec;
      const warn = WARN_AT_SEC.find((w) => remaining === w);
      if (warn !== undefined) setAnnouncement(`剩下 ${warn / 60} 分鐘`);
      if (remaining <= 0) onTimeout();
    };
    const id = window.setInterval(tick, 1000);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [store, limit, submitted, onTimeout]);

  const shown = submitted ? storedElapsed : elapsed;
  const remaining = limit === null ? null : Math.max(0, limit - shown);
  const countdown = remaining !== null && !submitted;
  const urgent = countdown && remaining <= 300;
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${urgent ? 'text-bad' : ''}`}>
      <TimerIcon aria-hidden="true" className="size-4" />
      <span className="text-xs font-normal text-muted">{countdown ? '剩餘' : '用時'}</span>
      <span role="timer" aria-label={countdown ? `剩餘時間 ${formatDuration(remaining)}` : `已用時間 ${formatDuration(shown)}`}>
        {formatClock(countdown ? remaining : shown)}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}

export function MathToolbar({ paper, onSubmitted }: { paper: MathPaper; onSubmitted: () => void }) {
  const store = useAttemptStore();
  const mode = useAttemptSelector((s) => s.mode);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const answers = useAttemptSelector((s) => s.answers);
  const timed = useAttemptSelector((s) => s.mode === 'exam' && s.submittedAt === null && s.timeLimitSec !== null);
  const [confirming, setConfirming] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // 桌機計時中離開確認（Layout 只在 ≥ lg 攔；同英文歷屆試題）。
  useTimedSession(
    timed,
    () => {
      const s = store.getState();
      return s.timeLimitSec === null || s.submittedAt !== null ? null : Math.max(0, s.timeLimitSec - s.elapsedSec);
    },
    '離開這一頁計時會暫停，回來可以接著寫。',
  );

  const items = mathItems(paper).filter((i) => i.type !== 'constructed');
  const answered = items.filter((i) => isMathAnswered(i, answers[i.label])).length;
  const unanswered = items.length - answered;

  const onTimeout = useCallback(() => {
    submitMathAttempt(store, paper, 'timeout');
    onSubmitted();
  }, [store, paper, onSubmitted]);

  useEffect(() => {
    if (confirming) continueRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    submitRef.current?.focus();
  };

  return (
    <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:top-0 lg:-mx-(--page-px) lg:px-(--page-px)">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
          {mode === 'exam' ? '考試' : '練習'}
          <span className="hidden sm:inline">模式</span>
        </span>
        <MathTimer onTimeout={onTimeout} />
        <span className="text-sm tabular-nums">
          已答 {answered}／{items.length}
        </span>
        <div className="ml-auto">
          {submitted ? (
            <span className="text-sm font-semibold text-ok">已交卷</span>
          ) : (
            <button
              ref={submitRef}
              type="button"
              onClick={() => setConfirming(true)}
              aria-expanded={confirming}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary"
            >
              交卷
            </button>
          )}
        </div>
      </div>
      {confirming && !submitted && (
        <div
          role="group"
          aria-label="確認交卷"
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancel();
          }}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-primary bg-surface p-3 text-sm"
        >
          <p className="w-full sm:w-auto sm:flex-1">
            {unanswered > 0 ? `還有 ${unanswered} 題選擇（填）題沒有作答。` : '選擇（填）題都作答了。'}交卷後就不能再修改答案。
          </p>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              submitMathAttempt(store, paper, 'manual');
              onSubmitted();
            }}
            className="rounded-full bg-primary px-4 py-1.5 font-semibold text-on-primary"
          >
            確定交卷
          </button>
          <button ref={continueRef} type="button" onClick={cancel} className="rounded-full border border-line px-4 py-1.5">
            繼續作答
          </button>
        </div>
      )}
    </div>
  );
}
