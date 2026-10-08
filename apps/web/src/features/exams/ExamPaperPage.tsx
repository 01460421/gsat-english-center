/**
 * 作答頁（/exams/:examId）：載入考卷 → 開始畫面（選模式）→ 作答 → 交卷結果與逐題檢討。
 *
 * 作答紀錄在 localStorage（attempt.ts）：進來時有紀錄就直接接續，沒有才顯示開始畫面。
 */
import { ChevronLeft } from 'lucide-react';
import { Suspense, use, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { DataLoadError, forgetFailedLoads } from '../../data/client';
import { examShortName, loadExam, type Exam } from '../../data/exams';
import { APP_NAME } from '../../modules';
import { AttemptContext, useAttemptSelector } from './AttemptContext';
import { AttemptStore, clearAttempt, loadAttempt, type AttemptMode } from './attempt';
import { ExamContext } from './ExamContext';
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

/** 清除作答紀錄：先在原地確認一次，避免手滑把寫了一小時的考卷清掉。 */
function ClearControl({ onClear, label = '清除作答紀錄' }: { onClear: () => void; label?: string }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
        {label}
      </button>
    );
  }
  return (
    <span role="group" aria-label="確認清除" className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span>確定要清除這份考卷的作答與計時嗎？</span>
      <button ref={confirmRef} type="button" onClick={onClear} className="rounded-full bg-bad px-3 py-1 font-semibold text-on-primary">
        確定清除
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-full border border-line px-3 py-1">
        取消
      </button>
    </span>
  );
}

function ActiveSession({ exam, store, resumed, onClear }: { exam: Exam; store: AttemptStore; resumed: boolean; onClear: () => void }) {
  const submittedAt = useAttemptSelector((s) => s.submittedAt);
  const mode = useAttemptSelector((s) => s.mode);
  const answeredCount = useAttemptSelector((s) => Object.keys(s.answers).length);
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
      <SectionNav />
      <ExamPaper />
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
