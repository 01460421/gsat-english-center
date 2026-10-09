/**
 * 作答時固定在畫面上方的工具列：模式、計時、已答題數、交卷。
 *
 * 計時器自己持有每秒更新的 state，只有它每秒重繪，整份考卷不受影響。用時每秒寫回 store（幾 KB 的 localStorage，成本很低），
 * 交卷與續作時拿到的用時才準；離開頁面期間不計時（02 文件 §6.2 的模擬考計時是給練習用的，不是監考）。
 * 時間到自動交卷；剩 10、5、1 分鐘時用 aria-live 提醒，螢幕閱讀器使用者也知道時間快到了。
 */
import { Timer as TimerIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { iterateQuestions, type Exam } from '../../../data/exams';
import { useAttemptSelector, useAttemptStore } from '../AttemptContext';
import type { AttemptStore } from '../attempt';
import { formatClock, formatDuration } from '../labels';
import { isAnswered, scoreExam } from '../scoring';

const WARN_AT_SEC = [600, 300, 60];

/** 交卷：當下計分（列表頁顯示用）並鎖住作答。 */
export function submitAttempt(store: AttemptStore, exam: Exam, reason: 'manual' | 'timeout'): void {
  const score = scoreExam(exam, store.getState().answers);
  store.submit(reason, { earned: score.earned, autoMax: score.autoMax });
}

/**
 * waitForFirstAnswer：第一次作答才開始計時（題型頁內嵌的題庫練習：打開頁面就抽好一組，只是來看說明、或分頁開著沒動，
 * 不能算進這一組的用時，也不寫出作答紀錄）。開始之後就一直計時（清掉唯一的答案也不停）。預設 false：一打開就計時。
 */
export function AttemptTimer({ onTimeout, waitForFirstAnswer = false }: { onTimeout: () => void; waitForFirstAnswer?: boolean }) {
  const store = useAttemptStore();
  const limit = useAttemptSelector((s) => s.timeLimitSec);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const storedElapsed = useAttemptSelector((s) => s.elapsedSec);
  const hasAnswers = useAttemptSelector((s) => Object.keys(s.answers).length > 0);
  const [answeredOnce, setAnsweredOnce] = useState(hasAnswers);
  if (hasAnswers && !answeredOnce) setAnsweredOnce(true);
  const waiting = waitForFirstAnswer && !answeredOnce && !submitted;
  const [elapsed, setElapsed] = useState(storedElapsed);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (submitted || waiting) return;
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
  }, [store, limit, submitted, waiting, onTimeout]);

  const shown = submitted || waiting ? storedElapsed : elapsed;
  const remaining = limit === null ? null : Math.max(0, limit - shown);
  const urgent = remaining !== null && remaining <= 300 && !submitted;
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${urgent ? 'text-bad' : ''}`}>
      <TimerIcon aria-hidden="true" className="size-4" />
      <span className="text-xs font-normal text-muted">{remaining !== null && !submitted ? '剩餘' : '用時'}</span>
      <span
        role="timer"
        aria-label={
          remaining !== null && !submitted
            ? `剩餘時間 ${formatDuration(remaining)}${waiting ? '，作答後開始計時' : ''}`
            : `已用時間 ${formatDuration(shown)}${waiting ? '，作答後開始計時' : ''}`
        }
      >
        {formatClock(remaining !== null && !submitted ? remaining : shown)}
      </span>
      {/* 手機上工具列放不下這一句（會擠成兩行），只靠計時器的無障礙名稱說明。 */}
      {waiting && (
        <span aria-hidden="true" className="hidden text-xs font-normal text-muted sm:inline">
          作答後開始計時
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  );
}

/**
 * modeLabel：模式標籤的文字（預設「考試模式／練習模式」；題庫練習頁傳「題庫練習」）。
 * waitForFirstAnswer：第一次作答才開始計時（見 AttemptTimer；題型頁內嵌的題庫練習用）。
 */
export function ExamToolbar({ exam, modeLabel, waitForFirstAnswer = false }: { exam: Exam; modeLabel?: string; waitForFirstAnswer?: boolean }) {
  const store = useAttemptStore();
  const mode = useAttemptSelector((s) => s.mode);
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const answers = useAttemptSelector((s) => s.answers);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  let total = 0;
  let answered = 0;
  for (const { question } of iterateQuestions(exam)) {
    total += 1;
    if (isAnswered(answers[question.label])) answered += 1;
  }
  const unanswered = total - answered;

  // useCallback：計時器的 effect 依賴這個函式，每次重繪都換新的會讓計時器一直重設。
  const onTimeout = useCallback(() => submitAttempt(store, exam, 'timeout'), [store, exam]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    submitRef.current?.focus();
  };

  return (
    <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur lg:top-0 lg:-mx-10 lg:px-10">
      {/* 手機上收窄間距、模式只寫「考試／練習」：390px 寬時倒數（1:40:00）加交卷鈕原本會擠成兩行，工具列多佔 40px 高。 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4">
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
          {modeLabel ?? (
            <>
              {mode === 'exam' ? '考試' : '練習'}
              <span className="hidden sm:inline">模式</span>
            </>
          )}
        </span>
        <AttemptTimer onTimeout={onTimeout} waitForFirstAnswer={waitForFirstAnswer} />
        <span className="text-sm tabular-nums">
          已答 {answered}／{total}
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
            {unanswered > 0 ? `還有 ${unanswered} 題沒有作答。` : '每一題都作答了。'}交卷後就不能再修改答案。
          </p>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              setConfirming(false);
              submitAttempt(store, exam, 'manual');
            }}
            className="rounded-full bg-primary px-4 py-1.5 font-semibold text-on-primary"
          >
            確定交卷
          </button>
          <button type="button" onClick={cancel} className="rounded-full border border-line px-4 py-1.5">
            繼續作答
          </button>
        </div>
      )}
    </div>
  );
}
