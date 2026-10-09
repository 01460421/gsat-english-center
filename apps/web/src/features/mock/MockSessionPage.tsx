/**
 * 模擬考作答頁（/mock/:paperId）：開考前（預估分數、實考模式）→ 作答（100 分鐘倒數、一次一個大題、
 * 題號面板與標記、自動存檔）→ 交卷（完成後 replace 到成績單）。設計見 docs/design/mock-exam-pdf.md §6。
 *
 * 進來時這份卷子有作答中的紀錄就直接接續；已經超過期限就以最後存檔的作答交卷（submitReason: 'expired'）。
 * 題目畫面重用歷屆試題的元件（ExamPaper 的 sectionIds、QuestionExtras 的 renderHeadingAccessory 放「標記」），AttemptState 的
 * mode 是 'exam'，題目元件就不顯示「看答案」與全國統計（練習輔助全關）。
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Suspense, use, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { forgetFailedLoads } from '../../data/client';
import { loadExam, type Exam } from '../../data/exams';
import { loadScoreScales, scaleForYear, type ScoreScales } from '../../data/scoreScales';
import { APP_NAME } from '../../modules';
import { AttemptContext, useAttemptSelector } from '../exams/AttemptContext';
import { ExamContext } from '../exams/ExamContext';
import { QuestionExtrasContext, type QuestionExtras } from '../exams/QuestionExtras';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { ExamPaper, sectionAnchorId } from '../exams/components/Paper';
import { ExamSourceNote } from '../exams/components/SessionPanels';
import { questionAnchorId } from '../exams/components/Questions';
import { formatDuration } from '../exams/labels';
import { questionTitle } from '../exams/richText';
import { MockToolbar, StrictLockText, useStrictLockLeft } from './components/MockToolbar';
import { MarkToggle } from './components/MarkToggle';
import { QuestionPalette, SectionNavigator } from './components/SectionNavigator';
import { StartScreen, type StartOptions } from './components/StartScreen';
import { SubmitDialog } from './components/SubmitDialog';
import { MockSessionContext, useMockConflict, useMockMeta } from './MockSessionContext';
import { paperIndex } from './paperIndex';
import { findMockPaper, type MockPaper } from './papers';
import { computeReport, historyEntryFor } from './report';
import { MockSession } from './session';
import { createRecord, loadActiveRecord, loadRecord, saveRecord, setActiveId, upsertHistory, type MockAttemptRecord, type MockSubmitReason } from './storage';
import { remainingSec } from './timer';

type Flow =
  | { kind: 'start' }
  | { kind: 'active'; session: MockSession; resumed: boolean }
  /** 打開時已經超過期限：以最後存檔的作答交卷，然後轉到成績單。 */
  | { kind: 'expired'; session: MockSession };

/** 紀錄裡的目前大題不在考卷裡（資料改版）時改回第一個大題。 */
function sanitize(record: MockAttemptRecord, exam: Exam): MockAttemptRecord {
  if (exam.sections.some((s) => s.id === record.activeSectionId)) return record;
  return { ...record, activeSectionId: exam.sections[0]?.id ?? record.activeSectionId };
}

function flowFromStorage(paper: MockPaper, exam: Exam): Flow {
  const record = loadActiveRecord(paper.examId);
  if (!record) return { kind: 'start' };
  const session = new MockSession(sanitize(record, exam));
  return session.isExpired() ? { kind: 'expired', session } : { kind: 'active', session, resumed: true };
}

/**
 * 捲到某一題並把焦點移過去：題目卡片（#q-題號）→ 選文裡的空格或行內輸入框（aria-label 以「第 n 題」開頭）→ 大題標題。
 * 卡片裡優先找作答元件（選項、輸入框），其次是「標記」以外的按鈕：題號旁的「標記」是卡片裡第一個按鈕，
 * 焦點放在它上面的話，鍵盤使用者按空白鍵作答會變成切換標記。
 */
function focusQuestion(container: HTMLElement | null, label: string, sectionId: string | undefined): void {
  const card = document.getElementById(questionAnchorId(label));
  let target: HTMLElement | null = card && container?.contains(card) ? card : null;
  if (!target && container) {
    const title = questionTitle(label);
    target = Array.from(container.querySelectorAll<HTMLElement>('[aria-label]')).find((el) => el.getAttribute('aria-label')?.startsWith(title)) ?? null;
  }
  if (!target && sectionId) target = document.getElementById(sectionAnchorId(sectionId));
  if (!target) return;
  target.scrollIntoView({ block: 'center' });
  const focusable = target.matches('input, button, textarea, select, [tabindex]')
    ? target
    : (target.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])') ??
      target.querySelector<HTMLElement>('button:not([disabled]):not([data-mock-mark])') ??
      target.querySelector<HTMLElement>('button:not([disabled])'));
  focusable?.focus({ preventScroll: true });
}

/**
 * 工具列固定在畫面上方時的下緣（px）：sticky 的 top＋工具列高度。不能直接用目前的位置——
 * 捲到頂端時工具列還沒黏住，位置比黏住時低得多。
 */
function stickyToolbarBottom(): number | null {
  const bar = document.querySelector<HTMLElement>('[data-mock-toolbar]');
  if (!bar) return null;
  const top = Number.parseFloat(window.getComputedStyle(bar).top);
  return (Number.isFinite(top) ? top : 0) + bar.getBoundingClientRect().height;
}

/**
 * 切換大題後捲到大題標題並把焦點移過去。捲動位置扣掉固定在上方的網站標頭與模擬考工具列（手機上工具列會換成兩行，
 * 比大題標題的 scroll-margin 高，標題會被工具列蓋住），所以量工具列的實際高度，不用 scrollIntoView。
 */
function focusSection(sectionId: string): void {
  const el = document.getElementById(sectionAnchorId(sectionId));
  if (!el) return;
  const bar = stickyToolbarBottom();
  if (bar === null) {
    el.scrollIntoView({ block: 'start' });
  } else {
    window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - bar - 8) });
  }
  el.focus({ preventScroll: true });
}

/**
 * 最後一個大題的「寫完了，準備交卷」：實考模式開考 60 分鐘內和工具列的「交卷」一樣停用，旁邊寫出還要等多久。
 */
function FinishButton({ onClick }: { onClick: () => void }) {
  const lockLeft = useStrictLockLeft();
  const hintId = useId();
  const locked = lockLeft > 0;
  return (
    <span className="ml-auto inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      {locked && <StrictLockText id={hintId} lockLeft={lockLeft} />}
      <button
        type="button"
        onClick={onClick}
        disabled={locked}
        aria-describedby={locked ? hintId : undefined}
        className="min-h-11 rounded-full bg-primary px-4 font-semibold text-on-primary disabled:opacity-50"
      >
        寫完了，準備交卷
      </button>
    </span>
  );
}

/** 放棄這次作答：在原地確認一次。 */
function AbandonControl({ onAbandon }: { onAbandon: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-2 hover:text-primary">
        放棄這次作答
      </button>
    );
  }
  return (
    <span role="group" aria-label="確認放棄" className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span>確定要放棄嗎？這次的作答會刪除，不會留下成績。</span>
      <button ref={confirmRef} type="button" onClick={onAbandon} className="min-h-9 rounded-full bg-bad px-3 font-semibold text-on-primary">
        確定放棄
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="min-h-9 rounded-full border border-line px-3">
        取消
      </button>
    </span>
  );
}

function ConflictBanner({ onTakeOver, onRestart }: { onTakeOver: () => void; onRestart: () => void }) {
  const conflict = useMockConflict();
  const id = useMockMeta((m) => m.id);
  if (!conflict) return null;
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
      {conflict === 'other_tab' && (
        <>
          <p className="font-semibold text-bad">這份模擬考正在另一個分頁作答。</p>
          <p className="mt-1">為了避免兩邊的答案互相覆蓋，這個分頁暫停為唯讀。時間照常倒數。</p>
          <button type="button" onClick={onTakeOver} className="mt-2 min-h-11 rounded-full bg-primary px-4 font-semibold text-on-primary">
            改在這個分頁作答
          </button>
        </>
      )}
      {conflict === 'submitted' && (
        <>
          <p className="font-semibold text-bad">這份模擬考已在另一個分頁交卷。</p>
          <Link to={`/mock/report/${id}`} replace className="mt-2 inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-semibold text-on-primary">
            看成績單
          </Link>
        </>
      )}
      {conflict === 'removed' && (
        <>
          <p className="font-semibold text-bad">這次作答已在另一個分頁放棄。</p>
          <button type="button" onClick={onRestart} className="mt-2 min-h-11 rounded-full border border-line bg-surface px-4">
            回到開考前
          </button>
        </>
      )}
    </div>
  );
}

interface ActiveExamProps {
  exam: Exam;
  paper: MockPaper;
  session: MockSession;
  resumed: boolean;
  onSubmitted: (record: MockAttemptRecord) => void;
  onAbandon: () => void;
  onTakeOver: () => void;
}

/** 先放 context，作答畫面（ActiveExamBody）裡的 useMockMeta／useAttemptSelector 才讀得到這次的 session。 */
function ActiveExam(props: ActiveExamProps) {
  return (
    <MockSessionContext value={props.session}>
      <AttemptContext value={props.session.attempt}>
        <ActiveExamBody {...props} />
      </AttemptContext>
    </MockSessionContext>
  );
}

function ActiveExamBody({ exam, paper, session, resumed, onSubmitted, onAbandon, onTakeOver }: ActiveExamProps) {
  const index = paperIndex(exam);
  const activeSectionId = useMockMeta((m) => m.activeSectionId);
  const conflict = useMockConflict();
  const readOnly = conflict !== null;
  // persisted 在每次寫入後更新；作答與其他欄位的寫入都可能改變它，兩邊都訂閱。
  const persistedByAnswer = useAttemptSelector(() => session.persisted);
  const persistedByMeta = useMockMeta(() => session.persisted);
  const persisted = persistedByAnswer && persistedByMeta;
  const [submitOpen, setSubmitOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<{ kind: 'section' | 'question'; target: string } | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [resumedAt] = useState(() => (resumed ? remainingSec(session.getMeta(), Date.now()) : null));

  const sectionPos = index.sections.findIndex((s) => s.id === activeSectionId);
  const current = index.sections[sectionPos] ?? index.sections[0];
  const prev = sectionPos > 0 ? index.sections[sectionPos - 1] : undefined;
  const next = sectionPos >= 0 ? index.sections[sectionPos + 1] : undefined;
  const sectionIds = useMemo(() => (current ? [current.id] : []), [current]);

  // 各大題用時（頁面可見時每秒記一次）、每 30 秒存檔、切換分頁與關閉頁面時存檔。
  useEffect(() => {
    if (readOnly) return;
    const visible = () => document.visibilityState !== 'hidden';
    session.resetClock(Date.now());
    const tick = window.setInterval(() => session.tick(Date.now(), visible()), 1000);
    const autosave = window.setInterval(() => session.flush(), 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        session.tick(Date.now(), true);
        session.flush();
      } else {
        session.resetClock(Date.now());
      }
    };
    const onPageHide = () => {
      session.tick(Date.now(), visible());
      session.flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(autosave);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      session.tick(Date.now(), visible());
      session.flush();
    };
  }, [session, readOnly]);

  // 接續作答時先接手：別的分頁若開著同一份，會收到 storage 事件而改成唯讀（最後打開的分頁優先）。
  useEffect(() => {
    if (resumed) session.claim();
  }, [session, resumed]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      session.handleStorageEvent(e.key, e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [session]);

  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus.kind === 'section') focusSection(pendingFocus.target);
    else focusQuestion(paperRef.current, pendingFocus.target, index.sectionOf.get(pendingFocus.target));
    setPendingFocus(null);
  }, [pendingFocus, index]);

  const goSection = (sectionId: string) => {
    session.setActiveSection(sectionId);
    setPendingFocus({ kind: 'section', target: sectionId });
  };
  const goQuestion = (label: string) => {
    const sectionId = index.sectionOf.get(label);
    if (sectionId) session.setActiveSection(sectionId);
    setPendingFocus({ kind: 'question', target: label });
  };

  const submit = useCallback(
    (reason: MockSubmitReason) => {
      const record = session.submit(exam, reason);
      if (record) onSubmitted(record);
    },
    [session, exam, onSubmitted],
  );
  const onTimeout = useCallback(() => submit('timeout'), [submit]);
  const extras = useMemo<QuestionExtras>(() => ({ renderHeadingAccessory: (labels) => <MarkToggle labels={labels} /> }), []);

  return (
    <>
      <title>{`${paper.label}模擬考（作答中）｜${APP_NAME}`}</title>
      <div className="space-y-4">
        <header>
          <p className="text-sm text-muted">模擬考・{exam.title}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{paper.label}模擬考</h1>
        </header>
        {resumedAt !== null && !readOnly && (
          <p className="rounded-xl bg-primary-soft px-4 py-2 text-sm">已接續上次的作答進度。離開期間時間照常計算，目前剩下 {formatDuration(resumedAt)}。</p>
        )}
        {!persisted && !readOnly && (
          <p role="status" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
            這個瀏覽器無法儲存作答進度（可能是無痕模式或停用了網站資料），重新整理或關掉分頁後答案會遺失。
          </p>
        )}
        <ConflictBanner onTakeOver={onTakeOver} onRestart={onAbandon} />
        <MockToolbar total={index.labels.length} onSubmit={() => setSubmitOpen(true)} onTimeout={onTimeout} readOnly={readOnly} submitRef={submitRef} />
        <SectionNavigator index={index} onGo={goSection} />
        <QuestionPalette index={index} onGoQuestion={goQuestion} />
        <div ref={paperRef}>
          {/* 唯讀時用 disabled 的 fieldset 一次停用所有作答元件（min-w-0：fieldset 預設的最小寬度會撐開手機版面）。 */}
          <fieldset disabled={readOnly} className="min-w-0">
            <legend className="sr-only">作答區{current ? `：${current.label}` : ''}</legend>
            <QuestionExtrasContext value={extras}>
              <ExamPaper sectionIds={sectionIds} />
            </QuestionExtrasContext>
          </fieldset>
        </div>
        <nav aria-label="上一個與下一個大題" className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          {prev ? (
            <button type="button" onClick={() => goSection(prev.id)} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 hover:border-primary">
              <ChevronLeft aria-hidden="true" className="size-4" />
              上一大題：{prev.label}
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button type="button" onClick={() => goSection(next.id)} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-4 font-semibold text-on-primary">
              下一大題：{next.label}
              <ChevronRight aria-hidden="true" className="size-4" />
            </button>
          ) : (
            !readOnly && <FinishButton onClick={() => setSubmitOpen(true)} />
          )}
        </nav>
        {!readOnly && (
          <div className="flex justify-end">
            <AbandonControl
              onAbandon={() => {
                session.discard();
                onAbandon();
              }}
            />
          </div>
        )}
        <ExamSourceNote exam={exam} />
      </div>
      <SubmitDialog
        open={submitOpen && !readOnly}
        index={index}
        onConfirm={() => {
          setSubmitOpen(false);
          // 實考模式的交卷鎖由 session.submit 把關（還在鎖定期間就回傳 null、什麼都不做）。
          submit('manual');
        }}
        onClose={() => setSubmitOpen(false)}
        onGoQuestion={goQuestion}
        returnFocusRef={submitRef}
      />
    </>
  );
}

function MockFlow({ paper, exam }: { paper: MockPaper; exam: Exam }) {
  const navigate = useNavigate();
  const [flow, setFlow] = useState<Flow>(() => flowFromStorage(paper, exam));
  const scales = useRef<ScoreScales | null>(null);

  // 級分對照（約 3 KB）先在背景載好，交卷時寫進歷史的級分才不必等成績單計算。失敗也沒關係：成績單會再算一次。
  useEffect(() => {
    let alive = true;
    loadScoreScales()
      .then((s) => {
        if (alive) scales.current = s;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(
    (record: MockAttemptRecord) => {
      const scale = scales.current ? scaleForYear(scales.current, record.scaleYear) : null;
      upsertHistory(historyEntryFor(record, computeReport(exam, record), scale));
      // 紀錄也放進路由的 state：瀏覽器存不進 localStorage（無痕模式、空間滿）時，成績單還是看得到這次的結果。
      navigate(`/mock/report/${record.id}`, { replace: true, state: { record } });
    },
    [exam, navigate],
  );

  useEffect(() => {
    if (flow.kind !== 'expired') return;
    const record = flow.session.submit(exam, 'expired') ?? flow.session.toRecord();
    finish(record);
  }, [flow, exam, finish]);

  const start = (options: StartOptions) => {
    const first = exam.sections[0]?.id ?? '';
    const record = createRecord(paper, first, options);
    const persisted = saveRecord(record);
    if (persisted) setActiveId(paper.examId, record.id);
    setFlow({ kind: 'active', session: new MockSession(record, persisted), resumed: false });
    window.scrollTo({ top: 0 });
  };

  const takeOver = () => {
    if (flow.kind !== 'active') return;
    const latest = loadRecord(flow.session.id);
    if (latest && latest.status === 'in_progress') {
      const session = new MockSession(sanitize(latest, exam));
      setFlow(session.isExpired() ? { kind: 'expired', session } : { kind: 'active', session, resumed: true });
    } else if (latest && latest.status === 'submitted') {
      navigate(`/mock/report/${latest.id}`, { replace: true });
    } else {
      setFlow({ kind: 'start' });
    }
  };

  if (flow.kind === 'start') return <StartScreen paper={paper} exam={exam} onStart={start} />;
  if (flow.kind === 'expired') {
    return (
      <p role="status" className="py-10 text-center text-muted">
        已超過作答時間，正在以最後存檔的作答交卷…
      </p>
    );
  }
  return (
    <ActiveExam
      key={flow.session.id + String(flow.resumed)}
      exam={exam}
      paper={paper}
      session={flow.session}
      resumed={flow.resumed}
      onSubmitted={finish}
      onAbandon={() => {
        setFlow({ kind: 'start' });
        window.scrollTo({ top: 0 });
      }}
      onTakeOver={takeOver}
    />
  );
}

function SessionLoader({ paper, examPromise }: { paper: MockPaper; examPromise: Promise<Exam> }) {
  const exam = use(examPromise);
  return (
    <ExamContext value={exam}>
      <MockFlow key={exam.id} paper={paper} exam={exam} />
    </ExamContext>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="py-10 text-center">
      <title>{`${label}模擬考｜${APP_NAME}`}</title>
      <h1 className="sr-only">{label}模擬考</h1>
      <p role="status" className="text-muted">
        考卷載入中…
      </p>
    </div>
  );
}

function PaperNotFound() {
  return (
    <section className="py-6">
      <title>{`找不到這份模擬考｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這份模擬考</h1>
      <p className="mt-2 text-muted">網址裡的卷別代號可能打錯了。目前的模擬考是 111–115 學測與 115 參考試卷。</p>
      <Link to="/mock" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-on-primary">
        回到模擬考列表
      </Link>
    </section>
  );
}

function PaperSession({ paper }: { paper: MockPaper }) {
  const [retry, setRetry] = useState(0);
  const examPromise = useMemo(() => loadExam(paper.examId), [paper.examId, retry]);
  return (
    <DataErrorBoundary
      key={`${paper.examId}:${retry}`}
      onRetry={() => {
        forgetFailedLoads();
        setRetry((n) => n + 1);
      }}
    >
      <Suspense fallback={<Loading label={paper.label} />}>
        <SessionLoader paper={paper} examPromise={examPromise} />
      </Suspense>
    </DataErrorBoundary>
  );
}

export default function MockSessionPage() {
  const { paperId = '' } = useParams();
  const paper = findMockPaper(paperId);
  return (
    <article>
      <Link to="/mock" className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
        <ChevronLeft aria-hidden="true" className="size-4" />
        模擬考列表
      </Link>
      {paper ? <PaperSession key={paper.examId} paper={paper} /> : <PaperNotFound />}
    </article>
  );
}
