/**
 * 數學卷子的作答頁（/math/:paperId）：載入卷子 → 開始畫面（練習模式／考試模式）→ 作答 → 交卷後到成績頁（/math/:paperId/results）。
 *
 * 和英文歷屆試題同樣的流程與本機續作（features/math/attempt.ts）：
 *   練習模式  不限時；每題可以「看答案與詳解」（看了就鎖住這一題），也可以整份交卷看成績。
 *   考試模式  依題本時間倒數（預設 100 分鐘），交卷後才顯示答案與分數；時間到自動交卷。
 * KaTeX 在進頁面時就開始下載（和卷子 JSON 同時），第一次畫公式時不必再等。
 */
import { ChevronLeft } from 'lucide-react';
import { Suspense, use, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { DataLoadError, forgetFailedLoads } from '../../data/client';
import { loadMathPaper, mathShortName, type MathPaper } from '../../data/math';
import { APP_NAME } from '../../modules';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { AttemptContext, useAttemptSelector } from '../exams/AttemptContext';
import type { AttemptMode, AttemptStore } from '../exams/attempt';
import { clearMathAttempt, loadMathAttempt, resumeMathAttempt, startMathAttempt } from './attempt';
import { loadKatex } from './katex';
import { MathToolbar } from './components/MathToolbar';
import { ClearControl, MathSourceNote, PaperHeader, PaperSections, QuestionNav, ReferenceFormulas } from './components/PaperParts';
import { listSearchFrom } from './nav';
import { SolutionsProvider } from './solutions';
import './math.css';

function SetupPanel({ paper, onStart }: { paper: MathPaper; onStart: (mode: AttemptMode, limit: number | null) => void }) {
  const name = useId();
  const minutesId = useId();
  const [mode, setMode] = useState<AttemptMode>('practice');
  const [minutes, setMinutes] = useState(String(paper.time_minutes));
  const parsed = Number(minutes);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 300;
  const options: { value: AttemptMode; label: string; hint: string }[] = [
    { value: 'practice', label: '練習模式', hint: '不限時間；每題作答後可以看答案與本站詳解（看了就不能改），也可以整份交卷看成績。' },
    { value: 'exam', label: '考試模式', hint: `倒數計時（預設 ${paper.time_minutes} 分鐘，與當年考試相同），交卷後才顯示答案、分數與詳解；時間到自動交卷。` },
  ];
  return (
    <section aria-labelledby={`${name}-t`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 id={`${name}-t`} className="text-lg font-semibold">
        選擇作答方式
      </h2>
      <form
        className="mt-3 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'exam' && !valid) return;
          onStart(mode, mode === 'exam' ? parsed * 60 : null);
        }}
      >
        <fieldset>
          <legend className="sr-only">作答方式</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="radio" name={name} value={opt.value} checked={mode === opt.value} onChange={() => setMode(opt.value)} className="mt-1.5 accent-[var(--primary)]" />
                <span>
                  <span className="block font-medium">{opt.label}</span>
                  <span className="block text-sm text-muted">{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {mode === 'exam' && (
          <div>
            <label htmlFor={minutesId} className="block text-sm font-medium">
              作答時間（分鐘）
            </label>
            <input
              id={minutesId}
              type="number"
              inputMode="numeric"
              min={1}
              max={300}
              value={minutes}
              onChange={(e) => setMinutes(e.currentTarget.value)}
              aria-invalid={!valid}
              aria-describedby={`${minutesId}-h`}
              className="mt-1 w-28 rounded-lg border border-line bg-bg px-3 py-2"
            />
            <p id={`${minutesId}-h`} className={`mt-1 text-xs ${valid ? 'text-muted' : 'text-bad'}`}>
              {valid ? `題本規定 ${paper.time_minutes} 分鐘。` : '請輸入 1 到 300 之間的整數。'}
            </p>
          </div>
        )}
        <button type="submit" className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary">
          開始作答
        </button>
        <p className="text-sm text-muted">作答進度自動存在這台裝置的瀏覽器：關掉頁面再回來可以接著寫（計時在離開頁面時暫停），也可以隨時清除重來。</p>
      </form>
    </section>
  );
}

/** 卷子結構與計分方式（開始畫面）。 */
function Structure({ paper }: { paper: MathPaper }) {
  return (
    <section aria-label="卷子結構與計分方式" className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-semibold">卷子結構</h2>
      <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        {paper.sections.map((s) => {
          const n = s.groups.reduce((acc, g) => acc + g.items.length, 0);
          return (
            <li key={s.id} className="flex justify-between gap-3 rounded-lg bg-surface-2 px-3 py-1.5">
              <span>{s.title.replace(/（.*?）/, '')}</span>
              <span className="text-muted tabular-nums">
                {n} 題・{s.points_total} 分
              </span>
            </li>
          );
        })}
      </ul>
      <h2 className="pt-2 font-semibold">計分方式（依題本封面）</h2>
      <ul className="ml-5 list-disc space-y-1 text-sm">
        <li>單選題：答對得該題分數；答錯、未作答或劃記多於一個選項以零分計。</li>
        <li>多選題：每個選項獨立判定；全對得全部分數，答錯 k 個選項得 (n − 2k)/n 的分數（5 個選項時錯 1 個得 3/5、錯 2 個得 1/5），低於零分或全未作答以零分計。</li>
        <li>選填題：每一格都答對才給分，答錯不倒扣。作答方式仿答題卷：每一格點選 0–9、−、±。</li>
        <li>非選擇題：請在紙上作答，交卷後對照本站詳解自評（不列入自動批改分數）。拍照 AI 批改即將推出。</li>
      </ul>
    </section>
  );
}

function PaperNotFound() {
  return (
    <section className="py-6">
      <title>{`找不到這份卷子｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這份卷子</h1>
      <p className="mt-2 text-muted">網址裡的卷子代號可能打錯了，或是這份卷子已經改名。</p>
      <Link to="/math" className="mt-4 inline-block rounded-full bg-primary px-4 py-2 font-medium text-on-primary">
        回到學測數學
      </Link>
    </section>
  );
}

function Loading() {
  return (
    <div className="py-10 text-center">
      <title>{`學測數學｜${APP_NAME}`}</title>
      <h1 className="sr-only">學測數學</h1>
      <p role="status" className="text-muted">
        卷子載入中…
      </p>
    </div>
  );
}

function ActiveSession({ paper, store, resumed, onClear }: { paper: MathPaper; store: AttemptStore; resumed: boolean; onClear: () => void }) {
  const navigate = useNavigate();
  const submitted = useAttemptSelector((s) => s.submittedAt !== null);
  const mode = useAttemptSelector((s) => s.mode);
  const answeredCount = useAttemptSelector((s) => Object.keys(s.answers).length);
  const persisted = useAttemptSelector(() => store.persisted);
  const goResults = useCallback(() => navigate(`/math/${paper.id}/results`), [navigate, paper.id]);
  return (
    <div className="space-y-6">
      {resumed && !submitted && (
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
      <MathToolbar paper={paper} onSubmitted={goResults} />
      {submitted && (
        <p className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-primary bg-surface px-4 py-3">
          <span className="font-semibold">這份卷子已經交卷。</span>
          <Link to={`/math/${paper.id}/results`} className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary">
            看成績與詳解
          </Link>
          <ClearControl onClear={onClear} label="清除作答，重新開始" question="確定要清除這份卷子的作答與成績嗎？" />
        </p>
      )}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-6">
        <div className="min-w-0 space-y-6">
          <details className="rounded-2xl border border-line bg-surface p-4 lg:hidden [&[open]>summary]:mb-3">
            <summary className="cursor-pointer font-semibold">題號一覽</summary>
            <QuestionNav paper={paper} />
          </details>
          <ReferenceFormulas paper={paper} />
          <SolutionsProvider paperId={paper.id}>
            <PaperSections paper={paper} />
          </SolutionsProvider>
          {!submitted && (
            <div className="flex justify-end">
              <ClearControl onClear={onClear} />
            </div>
          )}
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-16 rounded-2xl border border-line bg-surface p-3">
            <QuestionNav paper={paper} />
          </div>
        </aside>
      </div>
      <MathSourceNote paper={paper} />
    </div>
  );
}

function PaperSession({ paper }: { paper: MathPaper }) {
  const [session, setSession] = useState<{ store: AttemptStore | null; resumed: boolean }>(() => {
    const saved = loadMathAttempt(paper.id);
    return { store: saved ? resumeMathAttempt(saved) : null, resumed: saved !== null };
  });
  const start = (mode: AttemptMode, limit: number | null) => setSession({ store: startMathAttempt(paper.id, mode, limit), resumed: false });
  const clear = () => {
    clearMathAttempt(paper.id);
    setSession({ store: null, resumed: false });
    window.scrollTo({ top: 0 });
  };
  const title = <title>{`${mathShortName(paper)}｜學測數學｜${APP_NAME}`}</title>;
  if (!session.store) {
    return (
      <div className="space-y-6">
        {title}
        <PaperHeader paper={paper} />
        <SetupPanel paper={paper} onStart={start} />
        <Structure paper={paper} />
        <MathSourceNote paper={paper} />
      </div>
    );
  }
  return (
    <AttemptContext value={session.store}>
      {title}
      <PaperHeader paper={paper} />
      <ActiveSession paper={paper} store={session.store} resumed={session.resumed} onClear={clear} />
    </AttemptContext>
  );
}

function PaperLoader({ promise }: { promise: Promise<MathPaper> }) {
  const paper = use(promise);
  // 公式要等 KaTeX 下載完才畫（MathText 也會等，這裡先等，整份卷子一次出現）。
  use(loadKatex());
  return <PaperSession key={paper.id} paper={paper} />;
}

export default function MathPaperPage() {
  const { paperId = '' } = useParams();
  const location = useLocation();
  const [retry, setRetry] = useState(0);
  const promise = useMemo(() => loadMathPaper(paperId), [paperId, retry]);
  useEffect(() => {
    // 和卷子 JSON 同時開始下載 KaTeX（失敗時由 PaperLoader 的 use() 交給錯誤邊界）。
    loadKatex().catch(() => undefined);
  }, [retry]);
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  return (
    <article>
      <Link to={`/math${listSearchFrom(location.state)}`} className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
        <ChevronLeft aria-hidden="true" className="size-4" />
        學測數學列表
      </Link>
      <DataErrorBoundary
        key={`${paperId}:${retry}`}
        onRetry={handleRetry}
        renderError={(error) => (error instanceof DataLoadError && error.kind === 'not_found' ? <PaperNotFound /> : null)}
      >
        <Suspense fallback={<Loading />}>
          <PaperLoader promise={promise} />
        </Suspense>
      </DataErrorBoundary>
    </article>
  );
}
