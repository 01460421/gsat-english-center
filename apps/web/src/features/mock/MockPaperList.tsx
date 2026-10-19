/**
 * 模擬考列表（/mock，設計文件 §6.1）：每份卷子的狀態（未作答／作答中，剩 mm:ss／已完成 N 次，最近一次 X 分、Y 級分）、
 * 「開始」或「繼續作答」、最近成績單連結、ref-115 的沿用題提醒、下載考試格式 PDF，以及這台裝置的作答紀錄。
 *
 * 狀態都讀 localStorage（gsat-mock:v1:*），不必下載考卷；只有展開「下載 PDF（考試格式）」時才載入那一份考卷。
 * 別的分頁交卷、開考時（storage 事件）重新讀取，列表跟著更新。
 *
 * 桌機（≥ lg，docs/design/desktop-ui.md §5.8）：仍是 6 個 article（tests/mock.spec.ts 依賴 region「卷別」裡的 article 與 h3），
 * main ≥ ws（58.5rem）時一張一列，排成「列式卡片」：卷別｜狀態（＋最佳成績、最近一次、沿用題標章）｜動作，每列欄寬相同，
 * 看起來就是對齊的表格；不到 ws（1024 寬）維持兩欄卡片。
 * 用卡片自己的寬度判斷（li 是 lg:@container，≥ 48rem 才排成一列；三欄的寬度固定，每一列的欄位才對齊）。全部只加 lg: 起的 class，
 * 只在桌機出現的文字是 hidden lg:…（小而無狀態，R3）；手機像素不變。
 */
import { ChevronRight, CircleAlert, Download, FileText } from 'lucide-react';
import { Suspense, use, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { forgetFailedLoads } from '../../data/client';
import { loadExam, type Exam } from '../../data/exams';
import { formatClock, formatDuration } from '../exams/labels';
import { formatPoints } from '../exams/scoring';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { ExamPdfDownload } from '../pdf/ExamPdfDownload';
import { pdfDownloadVisible } from '../pdf/index';
import { formatDateTime, signedPoints } from './format';
import { MOCK_DURATION_MIN, MOCK_PAPERS, findMockPaper, mockPdfMeta, type MockPaper } from './papers';
import { HISTORY_LIMIT, MOCK_STORAGE_PREFIX, loadActiveRecord, loadHistory, type MockAttemptRecord, type MockHistoryEntry } from './storage';
import { isExpired, remainingSec } from './timer';
import { useNow } from './useNow';

interface Snapshot {
  active: ReadonlyMap<string, MockAttemptRecord>;
  history: readonly MockHistoryEntry[];
}

function readSnapshot(): Snapshot {
  const active = new Map<string, MockAttemptRecord>();
  for (const paper of MOCK_PAPERS) {
    const record = loadActiveRecord(paper.examId);
    if (record) active.set(paper.examId, record);
  }
  return { active, history: loadHistory() };
}

/** 這台裝置的模擬考狀態；別的分頁寫入 gsat-mock:v1:* 時重新讀取。 */
function useMockSnapshot(): Snapshot {
  const [snapshot, setSnapshot] = useState(readSnapshot);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith(MOCK_STORAGE_PREFIX)) setSnapshot(readSnapshot());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return snapshot;
}

function levelText(entry: Pick<MockHistoryEntry, 'level' | 'scaleYear'>): string {
  return entry.level === null ? '' : `、${entry.level} 級分`;
}

/** 作答中的剩餘時間（每秒更新；只有這一小段重繪）。 */
function Remaining({ record }: { record: MockAttemptRecord }) {
  const now = useNow();
  if (isExpired(record, now)) return <>已超過作答時間，打開後會以最後存檔的作答交卷</>;
  const left = remainingSec(record, now);
  return (
    <>
      作答中，剩 <span className="tabular-nums">{formatClock(left)}</span>
      <span className="sr-only">（{formatDuration(left)}）</span>
    </>
  );
}

/** 歷次最高的原始總分（同分取最近的一次）。 */
export function bestEntry(done: readonly MockHistoryEntry[]): MockHistoryEntry | undefined {
  return done.reduce<MockHistoryEntry | undefined>((best, e) => (best === undefined || e.raw > best.raw ? e : best), undefined);
}

/** ISO 時間 → 「10/18」（台灣時間）。 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
}

function StatusLine({ active, done, reuseNotice }: { active: MockAttemptRecord | undefined; done: readonly MockHistoryEntry[]; reuseNotice?: string }) {
  const latest = done[0];
  const best = bestEntry(done);
  return (
    <p className="text-sm">
      {active ? (
        <span className="font-semibold text-primary">
          <Remaining record={active} />
        </span>
      ) : latest ? (
        <span>
          已完成 {done.length} 次，最近一次 <strong className="tabular-nums">{formatPoints(latest.raw)}</strong> 分{levelText(latest)}
          {latest.pendingMax > 0 && <span className="text-muted">（非選擇題還沒自評）</span>}
        </span>
      ) : (
        <span className="text-muted">未作答</span>
      )}
      {/* 桌機的列式卡片：最佳成績與最近一次（每個值自帶短標籤）、沿用題的小標章（全文放 title）。 */}
      {best && latest && (
        <span className="hidden text-muted lg:@3xl:block">
          最佳 <span className="tabular-nums">{formatPoints(best.raw)}</span> 分{levelText(best)}・最近 {shortDate(latest.submittedAt)}
        </span>
      )}
      {reuseNotice && (
        <span title={reuseNotice} className="mt-1 hidden w-fit items-center gap-1 rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg lg:@3xl:flex">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          沿用題提醒
          <span className="sr-only">：{reuseNotice}</span>
        </span>
      )}
    </p>
  );
}

/** 展開後才下載考卷，交給 PDF 模組的「下載考試格式 PDF」區塊（pdfDownloadVisible() 為 false 時整段不顯示）。 */
function PaperPdf({ paper }: { paper: MockPaper }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visible] = useState(pdfDownloadVisible);
  const id = useId();
  const examPromise = useMemo(() => (open ? loadExam(paper.examId) : null), [open, paper.examId, retry]);
  if (!visible) return null;
  return (
    <div className="border-t border-line pt-3 lg:@3xl:col-span-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary px-4 text-sm font-medium text-primary hover:bg-primary-soft"
      >
        <Download aria-hidden="true" className="size-4" />
        下載 PDF（考試格式）
        <span className="sr-only">：{paper.label}</span>
      </button>
      {open && examPromise && (
        <div id={`${id}-panel`} className="mt-3">
          <DataErrorBoundary
            key={retry}
            onRetry={() => {
              forgetFailedLoads();
              setRetry((n) => n + 1);
            }}
          >
            <Suspense
              fallback={
                <p role="status" className="text-sm text-muted">
                  考卷載入中…
                </p>
              }
            >
              <PaperPdfLoaded paper={paper} examPromise={examPromise} />
            </Suspense>
          </DataErrorBoundary>
        </div>
      )}
    </div>
  );
}

function PaperPdfLoaded({ paper, examPromise }: { paper: MockPaper; examPromise: Promise<Exam> }) {
  const exam = use(examPromise);
  const meta = useMemo(() => mockPdfMeta(paper, false), [paper]);
  return <ExamPdfDownload exam={exam} mockMeta={meta} className="bg-surface-2" />;
}

function PaperCard({ paper, active, done, order }: { paper: MockPaper; active: MockAttemptRecord | undefined; done: readonly MockHistoryEntry[]; order: number }) {
  const id = useId();
  const latest = done[0];
  return (
    <li className="lg:@container">
      <article
        aria-labelledby={`${id}-title`}
        className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 lg:@3xl:grid lg:@3xl:grid-cols-[14rem_minmax(0,1fr)_16.5rem] lg:@3xl:items-center lg:@3xl:gap-x-6 lg:@3xl:py-3"
      >
        <header className="flex items-start gap-3">
          <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary tabular-nums">
            {order}
          </span>
          <span className="min-w-0 flex-1">
            <h3 id={`${id}-title`} className="text-lg font-semibold">
              {paper.label}
            </h3>
            <span className="block text-sm text-muted">
              {/* 桌機的列式卡片欄寬只有 14rem：「級分對照 115 學年度」整段一起換行，不拆成「級／分對照」。 */}
              {MOCK_DURATION_MIN} 分鐘・滿分 100 分・<span className="lg:whitespace-nowrap">級分對照 {paper.scaleYear} 學年度</span>
            </span>
          </span>
        </header>
        <StatusLine active={active} done={done} reuseNotice={paper.reuseNotice} />
        {paper.reuseNotice && (
          <p className="flex gap-2 rounded-xl bg-badge-bg px-3 py-2 text-sm text-badge-fg lg:@3xl:hidden">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>沿用題提醒：</strong>
              {paper.reuseNotice}
            </span>
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 lg:@3xl:mt-0">
          <Link
            to={`/mock/${paper.examId}`}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-5 font-semibold text-on-primary"
          >
            {active ? '繼續作答' : latest ? '再做一次' : '開始'}
            <span className="sr-only">：{paper.label}模擬考</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
          {latest && (
            <Link to={`/mock/report/${latest.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-sm hover:border-primary">
              <FileText aria-hidden="true" className="size-4" />
              最近成績單
              <span className="sr-only">：{paper.label}</span>
            </Link>
          )}
        </div>
        <PaperPdf paper={paper} />
      </article>
    </li>
  );
}

function HistoryList({ history }: { history: readonly MockHistoryEntry[] }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface p-5 lg:max-w-[60rem] lg:p-6">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        作答紀錄
      </h2>
      <p className="mt-1 text-sm text-muted">只存在這台裝置的瀏覽器（最多 {HISTORY_LIMIT} 筆）；換裝置或清除網站資料就沒有了。級分是非官方換算。</p>
      <ol className="mt-3 divide-y divide-line">
        {history.map((entry) => {
          const paper = findMockPaper(entry.paperId);
          return (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
              <span className="min-w-0">
                <span className="font-medium">{paper?.label ?? entry.paperId}</span>
                <span className="ml-2 text-sm text-muted">{formatDateTime(entry.submittedAt)}</span>
                <span className="block text-sm">
                  <strong className="tabular-nums">{formatPoints(entry.raw)}</strong> 分{levelText(entry)}
                  {entry.level !== null && <span className="text-muted">（對照 {entry.scaleYear} 學年度）</span>}
                  {entry.predictedScore !== null && (
                    <span className="text-muted">
                      ・預估 {entry.predictedScore} 分（{signedPoints(entry.raw - entry.predictedScore)}）
                    </span>
                  )}
                  {entry.pendingMax > 0 && <span className="text-bad">・非選擇題 {formatPoints(entry.pendingMax)} 分未自評</span>}
                </span>
              </span>
              <Link to={`/mock/report/${entry.id}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                成績單
                <span className="sr-only">：{paper?.label ?? entry.paperId}，{formatDateTime(entry.submittedAt)}</span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function MockPaperList() {
  const { active, history } = useMockSnapshot();
  const id = useId();
  return (
    <>
      <section aria-labelledby={`${id}-papers`}>
        <h2 id={`${id}-papers`} className="mb-3 text-lg font-semibold">
          卷別
        </h2>
        <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:max-w-[60rem] lg:@ws/main:grid-cols-1">
          {MOCK_PAPERS.map((paper, i) => (
            <PaperCard
              key={paper.examId}
              order={i + 1}
              paper={paper}
              active={active.get(paper.examId)}
              done={history.filter((h) => h.paperId === paper.examId)}
            />
          ))}
        </ol>
      </section>
      {history.length > 0 && <HistoryList history={history} />}
    </>
  );
}
