/**
 * 模擬考成績單（/mock/report/:attemptId）：原得總分、預估對照、級分（非官方）、五標位置、贏過多少比例的考生、
 * 各大題得分與用時、全國期望得分、非選擇題自評、檢討試卷、下載含答案的 PDF（設計文件 §6.7）。
 *
 * 紀錄只在這台裝置的 localStorage：找不到就說明原因（換了裝置、清除網站資料、超過 30 筆被刪掉）。
 * 自評一改就寫回紀錄與歷史（原得總分、級分），列表頁顯示的是最新的分數。
 */
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { Suspense, use, useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { forgetFailedLoads } from '../../data/client';
import { loadExam, type Exam } from '../../data/exams';
import { loadScoreScales, scaleForYear, type ScoreScales } from '../../data/scoreScales';
import { APP_NAME } from '../../modules';
import { AttemptContext } from '../exams/AttemptContext';
import { AttemptStore } from '../exams/attempt';
import { ExamContext } from '../exams/ExamContext';
import { QuestionExtrasContext, type QuestionExtras } from '../exams/QuestionExtras';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { ExamPaper, SectionNav } from '../exams/components/Paper';
import { ExamSourceNote } from '../exams/components/SessionPanels';
import { examIdLabel, formatDuration } from '../exams/labels';
import { formatPoints } from '../exams/scoring';
import { ExamPdfDownload } from '../pdf/ExamPdfDownload';
import { LevelCard } from './components/LevelCard';
import { MarkedBadge } from './components/MarkToggle';
import { SectionTable, SectionTableNotes } from './components/SectionTable';
import { SelfAssessment, type SelfChange } from './components/SelfAssessment';
import { formatDateTime, signedPoints } from './format';
import { findMockPaper, mockPdfMeta, SCALE_YEARS, type MockPaper } from './papers';
import { computeReport, historyEntryFor, levelInfo } from './report';
import { doneExamIds, loadRecord, parseRecord, saveRecord, upsertHistory, type MockAttemptRecord } from './storage';

const REASON_TEXT: Record<NonNullable<MockAttemptRecord['submitReason']>, string> = {
  manual: '手動交卷',
  timeout: '時間到，自動交卷',
  expired: '已超過作答時間，以最後存檔的作答計分',
};

/** 級分對照（約 3 KB）不用 Suspense：載入失敗時成績單其他部分照常顯示，只有級分區塊顯示錯誤。 */
function useScoreScales(): { scales: ScoreScales | null; failed: boolean; retry: () => void } {
  const [state, setState] = useState<{ scales: ScoreScales | null; failed: boolean }>({ scales: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadScoreScales()
      .then((scales) => alive && setState({ scales, failed: false }))
      .catch(() => alive && setState({ scales: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    forgetFailedLoads();
    setState({ scales: null, failed: false });
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

function ReviewPaper({ record }: { record: MockAttemptRecord }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // 已交卷的作答：題目元件會顯示答案、全國答對率與選項分布；改不了答案，所以存檔是空操作。
  const store = useMemo(() => new AttemptStore(record.attempt, true, { save: () => true }), [record.attempt]);
  const marked = useMemo(() => new Set(record.marked), [record.marked]);
  const extras = useMemo<QuestionExtras>(
    () => ({ renderHeadingAccessory: (labels) => <MarkedBadge labels={labels} marked={marked} /> }),
    [marked],
  );
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          檢討試卷
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-paper`}
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 rounded-full border border-primary px-4 text-sm font-medium text-primary hover:bg-primary-soft"
        >
          {open ? '收起檢討試卷' : '展開檢討試卷（答案、全國答對率與選項分布）'}
        </button>
      </div>
      {open && (
        <div id={`${id}-paper`} className="space-y-6">
          <AttemptContext value={store}>
            <QuestionExtrasContext value={extras}>
              <SectionNav />
              <ExamPaper />
            </QuestionExtrasContext>
          </AttemptContext>
        </div>
      )}
    </section>
  );
}

function ReportBody({ exam, paper, initial }: { exam: Exam; paper: MockPaper; initial: MockAttemptRecord }) {
  const [record, setRecord] = useState(initial);
  const { scales, failed, retry } = useScoreScales();
  const done = useMemo(() => {
    const sources = new Set<string>();
    for (const s of exam.sections) for (const g of s.groups) for (const q of g.questions) if (q.reused_from) sources.add(q.reused_from.exam);
    return sources.size > 0 ? doneExamIds(sources, record.startedAt) : new Set<string>();
  }, [exam, record.startedAt]);
  const report = useMemo(() => computeReport(exam, record, { doneExamIds: done }), [exam, record, done]);
  const scale = scales ? scaleForYear(scales, record.scaleYear) : null;
  const info = scale ? levelInfo(report.raw, scale) : null;
  const pdfMeta = useMemo(() => mockPdfMeta(paper, record.strict), [paper, record.strict]);
  const titleId = useId();

  // 總分或級分改變（自評、切換對照年度）就寫回歷史。
  useEffect(() => {
    upsertHistory(historyEntryFor(record, report, scale));
  }, [record, report, scale]);

  const update = (next: MockAttemptRecord) => {
    saveRecord(next);
    setRecord(next);
  };
  const onSelf: SelfChange = (label, score, detail) => {
    const selfScores = { ...record.selfScores };
    if (score === null) delete selfScores[label];
    else selfScores[label] = score;
    const selfDetail = detail ? { ...record.selfDetail, [label]: detail } : record.selfDetail;
    update({ ...record, selfScores, selfDetail });
  };

  const predicted = record.predictedScore;
  const strictText = record.strict ? '實考模式' : '考試模式';

  return (
    <div className="space-y-6">
      <header>
        <title>{`${paper.label}模擬考成績單｜${APP_NAME}`}</title>
        <p className="text-sm text-muted">模擬考成績單・{exam.title}</p>
        <h1 id={titleId} className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">
          {paper.label}模擬考成績單
        </h1>
        <p className="mt-1 text-sm text-muted">
          {record.submittedAt ? formatDateTime(record.submittedAt) : ''}・{strictText}・用時 {formatDuration(report.usedSec)}
          {report.awaySec > 0 ? `（含離開頁面 ${formatDuration(report.awaySec)}）` : ''}・{record.submitReason ? REASON_TEXT[record.submitReason] : ''}
        </p>
        {record.submitReason === 'expired' && (
          <p className="mt-2 rounded-xl bg-badge-bg px-4 py-2 text-sm text-badge-fg">已超過作答時間，以最後存檔的作答計分。</p>
        )}
      </header>

      {report.pendingMax > 0 && (
        <p role="status" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm">
          非選擇題尚未自評，總分與級分暫不含 {formatPoints(report.pendingMax)} 分。
          <a href="#self-assessment" className="ml-1 font-semibold text-primary underline">
            前往自評
          </a>
        </p>
      )}

      <section aria-label="原得總分" className="rounded-2xl border-2 border-primary bg-surface p-5 lg:p-6">
        <p className="text-sm text-muted">原得總分</p>
        <p className="text-5xl font-bold tabular-nums">
          {formatPoints(report.raw)}
          <span className="text-xl font-normal text-muted">／{formatPoints(report.fullScore)}</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          選擇題（自動計分）{formatPoints(report.autoEarned)}／{formatPoints(report.autoMax)}＋非選擇題（自動與自評）{formatPoints(report.openEarned)}／
          {formatPoints(report.openMax)}
        </p>
        {predicted !== null && (
          <p className="mt-2">
            你預估 {predicted} 分，實得 {formatPoints(report.raw)} 分（{signedPoints(report.raw - predicted)}）
            {report.pendingMax > 0 && <span className="text-sm text-muted">；非選擇題自評完成後再比較一次</span>}。
          </p>
        )}
        {report.reuse && (
          <p className="mt-2 text-sm">
            扣掉做過的 {report.reuse.count} 題（原題來自 {report.reuse.exams.map(examIdLabel).join('、')}，你在開考前做過）：
            <strong className="tabular-nums">
              {formatPoints(report.reuse.earned)}／{formatPoints(report.reuse.max)} 分
            </strong>
            {report.reuse.max > 0 && <span className="text-muted">（得分率 {Math.round((report.reuse.earned / report.reuse.max) * 100)}%）</span>}
          </p>
        )}
      </section>

      {info && scale ? (
        <LevelCard
          info={info}
          scale={scale}
          year={record.scaleYear}
          years={SCALE_YEARS.filter((y) => scales && scaleForYear(scales, y))}
          onYearChange={(year) => update({ ...record, scaleYear: year })}
          raw={report.raw}
          pendingMax={report.pendingMax}
        />
      ) : (
        <section aria-label="級分（非官方換算）" className="rounded-2xl border border-line bg-surface p-5">
          {failed ? (
            <div role="alert">
              <p className="font-semibold">級分對照資料載入失敗</p>
              <button type="button" onClick={retry} className="mt-2 min-h-11 rounded-full bg-primary px-4 text-sm font-medium text-on-primary">
                再試一次
              </button>
            </div>
          ) : (
            <p role="status" className="text-muted">
              {scales ? `沒有 ${record.scaleYear} 學年度的級分對照。` : '級分對照載入中…'}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby={`${titleId}-sections`} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
        <h2 id={`${titleId}-sections`} className="mb-3 text-lg font-semibold">
          各大題得分與用時
        </h2>
        <SectionTable report={report} />
        <SectionTableNotes report={report} />
      </section>

      <SelfAssessment exam={exam} items={report.openItems} answers={record.attempt.answers} details={record.selfDetail} onChange={onSelf} />

      <section aria-label="聲明" className="rounded-2xl border border-line bg-surface-2 p-4 text-sm">
        <p className="font-semibold">模擬分數與級分僅供參考，不是官方級分；AI 批改分數不等於正式閱卷結果。</p>
        <p className="mt-1 text-muted">
          目前非選擇題為自評分數。級分依 {record.scaleYear} 學年度大考中心公布的原得總分與級分對照表換算，每年的級距不同，不代表今年的級分。
        </p>
      </section>

      <ReviewPaper record={record} />

      <ExamPdfDownload exam={exam} mockMeta={pdfMeta} defaultIncludeAnswerKey />

      <nav aria-label="接下來" className="flex flex-wrap gap-2">
        <Link to={`/mock/${paper.examId}`} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-on-primary">
          再做一次
        </Link>
        <Link to="/mock" className="inline-flex min-h-11 items-center rounded-full border border-line px-5 hover:border-primary">
          回模擬考列表
        </Link>
      </nav>

      <footer className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
        <p className="font-medium text-fg">級分資料來源</p>
        {scales && <p>{scales.note}</p>}
        {scale && scale.sources.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {scale.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-primary underline-offset-2 hover:underline">
                  {s.label}
                  <ExternalLink aria-hidden="true" className="size-3" />
                  <span className="sr-only">（另開新分頁）</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </footer>
      <ExamSourceNote exam={exam} />
    </div>
  );
}

function ReportLoader({ paper, record, examPromise }: { paper: MockPaper; record: MockAttemptRecord; examPromise: Promise<Exam> }) {
  const exam = use(examPromise);
  return (
    <ExamContext value={exam}>
      <ReportBody exam={exam} paper={paper} initial={record} />
    </ExamContext>
  );
}

function ReportMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-6">
      <title>{`${title}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-2 space-y-3 text-muted">{children}</div>
    </section>
  );
}

function ReportForRecord({ record }: { record: MockAttemptRecord }) {
  const paper = findMockPaper(record.paperId);
  const [retry, setRetry] = useState(0);
  const examPromise = useMemo(() => loadExam(record.paperId), [record.paperId, retry]);
  if (!paper) {
    return (
      <ReportMessage title="找不到這份成績單">
        <p>這份紀錄的卷別已經不在模擬考清單裡。</p>
      </ReportMessage>
    );
  }
  if (record.status !== 'submitted') {
    return (
      <ReportMessage title="這份模擬考還在作答中">
        <p>交卷後才會有成績單。</p>
        <Link to={`/mock/${paper.examId}`} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-on-primary">
          繼續作答
        </Link>
      </ReportMessage>
    );
  }
  return (
    <DataErrorBoundary
      key={retry}
      onRetry={() => {
        forgetFailedLoads();
        setRetry((n) => n + 1);
      }}
    >
      <Suspense
        fallback={
          <div className="py-10 text-center">
            <title>{`模擬考成績單｜${APP_NAME}`}</title>
            <h1 className="sr-only">模擬考成績單</h1>
            <p role="status" className="text-muted">
              成績單載入中…
            </p>
          </div>
        }
      >
        <ReportLoader paper={paper} record={record} examPromise={examPromise} />
      </Suspense>
    </DataErrorBoundary>
  );
}

/**
 * 成績單的紀錄：先讀 localStorage；讀不到時用交卷時放進路由 state 的紀錄（這個瀏覽器存不進 localStorage，
 * 例如無痕模式或空間滿——不然整場 100 分鐘的結果一交卷就不見了）。state 也照樣驗證格式。
 */
function useReportRecord(attemptId: string): { record: MockAttemptRecord | null; unsaved: boolean } {
  const location = useLocation();
  const state: unknown = location.state;
  return useMemo(() => {
    const stored = loadRecord(attemptId);
    if (stored) return { record: stored, unsaved: false };
    const fromState = state !== null && typeof state === 'object' && 'record' in state ? parseRecord(state.record, attemptId) : null;
    return { record: fromState, unsaved: fromState !== null };
  }, [attemptId, state]);
}

export default function MockReportPage() {
  const { attemptId = '' } = useParams();
  const { record, unsaved } = useReportRecord(attemptId);
  return (
    <article>
      <Link to="/mock" className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
        <ChevronLeft aria-hidden="true" className="size-4" />
        模擬考列表
      </Link>
      {unsaved && (
        <p role="status" className="mb-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
          這個瀏覽器無法儲存成績單（可能是無痕模式、停用了網站資料或空間已滿），離開這一頁之後就找不到了。可以先下載含答案的 PDF，或把這一頁截圖保存。
        </p>
      )}
      {record ? (
        <ReportForRecord key={record.id} record={record} />
      ) : (
        <ReportMessage title="找不到這份成績單">
          <p>模擬考的紀錄只存在作答的那台裝置與瀏覽器。換了裝置、清除了網站資料，或紀錄超過 30 筆時最舊的會被刪除，都會找不到。</p>
          <Link to="/mock" className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-on-primary">
            回模擬考列表
          </Link>
        </ReportMessage>
      )}
    </article>
  );
}
