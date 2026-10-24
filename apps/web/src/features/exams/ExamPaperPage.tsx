/**
 * 作答頁（/exams/:examId）：載入考卷 → 開始畫面（選模式）→ 作答 → 交卷結果與逐題檢討。
 *
 * 作答紀錄在 localStorage（attempt.ts）：進來時有紀錄就直接接續，沒有才顯示開始畫面。
 */
import { ChevronLeft } from 'lucide-react';
import { Suspense, use, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { DataLoadError, forgetFailedLoads } from '../../data/client';
import { examShortName, loadExam, type Exam } from '../../data/exams';
import { useIsDesktop } from '../../lib/media';
import { useTimedSession } from '../../lib/timedSession';
import { APP_NAME } from '../../modules';
import { ExamPdfDownload } from '../pdf/ExamPdfDownload';
import { officialAskExtras, recordOutcomesOnce } from '../assistant/entries';
import { examOutcomes, isAssistableQuestion } from '../assistant/outcomeBuilders';
import { useAssistantEnabled } from '../assistant/lib/useAssistantEnabled';
import { AttemptContext, useAttemptSelector } from './AttemptContext';
import { AttemptStore, clearAttempt, loadAttempt, type AttemptMode } from './attempt';
import { ExamContext } from './ExamContext';
import { QuestionExtrasContext, type QuestionExtras } from './QuestionExtras';
import { isNewSystem } from './labels';
import { DataErrorBoundary } from './components/DataErrorBoundary';
import { ExamToolbar } from './components/ExamToolbar';
import { ExamPaper, SectionNav } from './components/Paper';
import { ExamSourceNote, ResultSummary, SectionStructure, SetupPanel } from './components/SessionPanels';

/** 列表頁把篩選條件（?kind=…&year=…）放在 location.state，「回到列表」時帶回去。 */
function listSearchFrom(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('listSearch' in state)) return '';
  const search = (state as { listSearch: unknown }).listSearch;
  return typeof search === 'string' && search.startsWith('?') ? search : '';
}

function documentTitleFor(exam: Pick<Exam, 'exam' | 'year' | 'session' | 'target'>): string {
  return `${examShortName(exam)}｜歷屆試題｜${APP_NAME}`;
}

function ExamHeader({ exam }: { exam: Exam }) {
  const count = exam.sections.reduce((acc, s) => acc + s.groups.reduce((n, g) => n + g.questions.length, 0), 0);
  const isNew = isNewSystem(exam);
  return (
    <header className="mb-4">
      <title>{documentTitleFor(exam)}</title>
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{examShortName(exam)}</span>
        {isNew && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">新制</span>}
        {exam.session === 'makeup' && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{exam.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {exam.time_minutes !== null ? `${exam.time_minutes} 分鐘・` : ''}滿分 {exam.full_score} 分・{count} 題
      </p>
    </header>
  );
}

/**
 * 清除作答紀錄：先在原地確認一次，避免手滑把寫了一小時的考卷清掉。
 * 桌機（≥ lg）打開確認時焦點在「取消」、取消後回到原本的按鈕：連按兩次 Enter 不會清掉（docs/design/desktop-polish.md §4.7）。
 * 手機維持原本的行為（焦點在「確定清除」）。
 */
function ClearControl({ onClear, label = '清除作答紀錄' }: { onClear: () => void; label?: string }) {
  const isDesktop = useIsDesktop();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (confirming) (isDesktop ? cancelRef : confirmRef).current?.focus();
    else if (restoreFocus.current) triggerRef.current?.focus();
    restoreFocus.current = false;
    // 只在打開、關上的那一刻移焦點（isDesktop 改變時不搶焦點）。
  }, [confirming]);
  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
      >
        {label}
      </button>
    );
  }
  return (
    <span
      role="group"
      aria-label="確認清除"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isDesktop) {
          restoreFocus.current = true;
          setConfirming(false);
        }
      }}
      className="inline-flex flex-wrap items-center gap-2 text-sm"
    >
      <span>確定要清除這份考卷的作答與計時嗎？</span>
      <button ref={confirmRef} type="button" onClick={onClear} className="rounded-full bg-bad px-3 py-1 font-semibold text-on-primary">
        確定清除
      </button>
      <button
        ref={cancelRef}
        type="button"
        onClick={() => {
          restoreFocus.current = isDesktop;
          setConfirming(false);
        }}
        className="rounded-full border border-line px-3 py-1"
      >
        取消
      </button>
    </span>
  );
}

/**
 * 計時中離開確認（docs/design/desktop-polish.md §4.7；Layout 只在 ≥ lg 攔）：考試模式、還沒交卷時登記剩餘時間。
 * 歷屆試題的計時在離開頁面時暫停（SetupPanel 的說明），確認框照實說。
 */
function useExamLeaveGuard(store: AttemptStore) {
  const timed = useAttemptSelector((s) => s.mode === 'exam' && s.submittedAt === null && s.timeLimitSec !== null);
  useTimedSession(
    timed,
    () => {
      const s = store.getState();
      return s.timeLimitSec === null || s.submittedAt !== null ? null : Math.max(0, s.timeLimitSec - s.elapsedSec);
    },
    '離開這一頁計時會暫停，回來可以接著寫。',
  );
}

/**
 * 學習助手（docs/design/learning-assistant.md §1.4、§5.4）：
 *   - 交卷（考試模式）或練習模式每一題都看過答案時，寫一次本機作答紀錄（同一次作答不重複寫）；
 *   - 開關打開時才提供 QuestionExtrasContext（每題回饋下方的「問學習助手」「這題有疑問？」），關著時 context 仍是 null、畫面不變。
 */
function useAssistOutcomes(exam: Exam, store: AttemptStore) {
  const submittedAt = useAttemptSelector((s) => s.submittedAt);
  const mode = useAttemptSelector((s) => s.mode);
  const revealedCount = useAttemptSelector((s) => s.revealed.length);
  useEffect(() => {
    const state = store.getState();
    if (state.submittedAt !== null) {
      const at = Date.parse(state.submittedAt);
      recordOutcomesOnce('exam', { r: exam.id }, at, () => examOutcomes(exam, state.answers, { s: 'exam', revealed: new Set(state.revealed), at }));
      return;
    }
    if (state.mode !== 'practice') return;
    const labels = exam.sections.flatMap((sec) => sec.groups.flatMap((g) => g.questions.filter(isAssistableQuestion).map((q) => q.label)));
    const revealed = new Set(state.revealed);
    if (labels.length === 0 || !labels.every((l) => revealed.has(l))) return;
    const at = Date.parse(state.startedAt);
    recordOutcomesOnce('exam', { r: exam.id }, at, () => examOutcomes(exam, state.answers, { s: 'exam', revealed, at }));
  }, [exam, store, submittedAt, mode, revealedCount]);
}

function AssistExtras({ exam, children }: { exam: Exam; children: ReactNode }) {
  const enabled = useAssistantEnabled();
  const extras = useMemo<QuestionExtras | null>(
    () => (enabled ? officialAskExtras((label) => ({ src: 'exam', exam: exam.id, labels: [label] })) : null),
    [enabled, exam.id],
  );
  // 一律包同一個提供者（關著時 value 是 null，和沒有提供者一樣）：開關要等 /api/features、/api/me 回來才確定，
  // 換元素類型會讓整份考卷重新掛載，正在作答的學生會丟掉焦點與輸入中的字。
  return <QuestionExtrasContext value={extras}>{children}</QuestionExtrasContext>;
}

function ActiveSession({ exam, store, resumed, onClear }: { exam: Exam; store: AttemptStore; resumed: boolean; onClear: () => void }) {
  const submittedAt = useAttemptSelector((s) => s.submittedAt);
  const mode = useAttemptSelector((s) => s.mode);
  const answeredCount = useAttemptSelector((s) => Object.keys(s.answers).length);
  useAssistOutcomes(exam, store);
  useExamLeaveGuard(store);
  // store.persisted 在每次寫入後更新；放進 selector，寫入失敗時這裡會跟著重繪顯示提示。
  const persisted = useAttemptSelector(() => store.persisted);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const previous = useRef(submittedAt);

  // 剛交卷：捲回頂端看成績，焦點移到「交卷結果」標題，螢幕閱讀器會從這裡開始唸。
  useEffect(() => {
    if (previous.current === null && submittedAt !== null) {
      window.scrollTo({ top: 0 });
      resultHeadingRef.current?.focus({ preventScroll: true });
    }
    previous.current = submittedAt;
  }, [submittedAt]);

  return (
    <div className="space-y-6">
      {resumed && submittedAt === null && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-primary-soft px-4 py-2 text-sm">
          <span>
            已接續上次的作答進度（{mode === 'exam' ? '考試模式' : '練習模式'}，已答 {answeredCount} 題）。
          </span>
          <ClearControl onClear={onClear} label="清除重來" />
        </p>
      )}
      {!persisted && (
        <p role="status" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          這個瀏覽器無法儲存作答進度（可能是無痕模式或停用了網站資料），重新整理後答案會遺失。
        </p>
      )}
      <ExamToolbar exam={exam} />
      {submittedAt !== null && <ResultSummary exam={exam} headingRef={resultHeadingRef} onRestart={onClear} />}
      {submittedAt !== null && <ExamPdfDownload exam={exam} defaultIncludeAnswerKey />}
      <SectionNav />
      <AssistExtras exam={exam}>
        <ExamPaper />
      </AssistExtras>
      <div className="flex justify-end">{submittedAt === null && <ClearControl onClear={onClear} />}</div>
      <ExamSourceNote exam={exam} />
    </div>
  );
}

function ExamSession({ exam }: { exam: Exam }) {
  const [session, setSession] = useState<{ store: AttemptStore | null; resumed: boolean }>(() => {
    const saved = loadAttempt(exam.id);
    return { store: saved ? new AttemptStore(saved) : null, resumed: saved !== null };
  });

  const start = (mode: AttemptMode, timeLimitSec: number | null) => {
    setSession({ store: AttemptStore.start(exam.id, mode, timeLimitSec), resumed: false });
  };
  const clear = () => {
    clearAttempt(exam.id);
    setSession({ store: null, resumed: false });
    window.scrollTo({ top: 0 });
  };

  if (!session.store) {
    return (
      <div className="space-y-6">
        <ExamHeader exam={exam} />
        <SetupPanel exam={exam} onStart={start} />
        <section aria-label="大題結構" className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-3 font-semibold">大題結構</h2>
          <SectionStructure exam={exam} />
        </section>
        {/* 考試格式 PDF（docs/design/mock-exam-pdf.md）；PDF_DOWNLOAD_ENABLED 為 false 時不顯示。 */}
        <ExamPdfDownload exam={exam} />
        <ExamSourceNote exam={exam} />
      </div>
    );
  }
  return (
    <AttemptContext value={session.store}>
      <ExamHeader exam={exam} />
      <ActiveSession exam={exam} store={session.store} resumed={session.resumed} onClear={clear} />
    </AttemptContext>
  );
}

function ExamLoader({ examPromise }: { examPromise: Promise<Exam> }) {
  const exam = use(examPromise);
  return (
    <ExamContext value={exam}>
      {/* key：換考卷時整個作答狀態重來，不會把上一份的 store 帶過來。 */}
      <ExamSession key={exam.id} exam={exam} />
    </ExamContext>
  );
}

function ExamNotFound() {
  return (
    <section className="py-6">
      <title>{`找不到這份考卷｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這份考卷</h1>
      <p className="mt-2 text-muted">網址裡的考卷代號可能打錯了，或是這份考卷已經改名。</p>
      <Link to="/exams" className="mt-4 inline-block rounded-full bg-primary px-4 py-2 font-medium text-on-primary">
        回到歷屆試題列表
      </Link>
    </section>
  );
}

function Loading() {
  return (
    <div className="py-10 text-center">
      <title>{`歷屆試題｜${APP_NAME}`}</title>
      <h1 className="sr-only">歷屆試題</h1>
      <p role="status" className="text-muted">
        考卷載入中…
      </p>
    </div>
  );
}

export default function ExamPaperPage() {
  const { examId = '' } = useParams();
  const location = useLocation();
  const [retry, setRetry] = useState(0);
  // 失敗的請求會留在 data/client.ts 的快取裡，同一份考卷每次繪製都拿到同一個 Promise，Suspense 重來時不會重抓；
  // 「再試一次」先 forgetFailedLoads() 再換 retry，才會真的重新下載（理由見 client.ts 檔頭）。
  const examPromise = useMemo(() => loadExam(examId), [examId, retry]);
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  return (
    <article>
      <Link
        to={`/exams${listSearchFrom(location.state)}`}
        className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        歷屆試題列表
      </Link>
      <DataErrorBoundary
        key={`${examId}:${retry}`}
        onRetry={handleRetry}
        renderError={(error) => (error instanceof DataLoadError && error.kind === 'not_found' ? <ExamNotFound /> : null)}
      >
        <Suspense fallback={<Loading />}>
          <ExamLoader examPromise={examPromise} />
        </Suspense>
      </DataErrorBoundary>
    </article>
  );
}
