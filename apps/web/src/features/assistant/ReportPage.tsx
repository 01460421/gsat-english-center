/**
 * /assistant/report、/assistant/report/:version：學習報告（docs/design/learning-assistant.md §1.8、§3.3–§3.5、§5.1）。負責：WP-C。
 *
 *   - 開關關著：沒登入時「學習助手暫停使用中」（AssistGate），不打 API；已登入時是唯讀模式（AssistGate readOnly）：
 *     暫停的說明、版本選單、列印、複製、刪除照常，沒有「產生新版本」與產生報告的面板。沒登入：說明怎麼開通，不打報告的 API。
 *   - 沒有報告：產生第一份的面板。有報告：預設最新一版（或網址的版本），版本選單、列印／存成 PDF、複製文字、刪除這一版；
 *     「產生新版本」打開面板（?refresh=1 時一開始就打開，模考成績單的連結用）。
 *   - 進行中（queued／running）：輪詢 GET …/reports/{id}（Poller<T>，分頁看不到時暫停）；失敗：退還原因＋面板再試一次。
 *     輪詢因為不會自己好的錯誤停了（登入過期…）：說出原因、給「再試一次」，不再說「會自動顯示」。
 *     常駐一個 aria-live 區：排隊中、報告完成、沒有完成都唸得到（§1.11）。
 *   - 面板依「最近一版完成的報告」產生新版本（上一版之後的變化、AI 問你的問題、推薦做了沒）：選到的這一版沒有完成
 *     （失敗、還在產生）時改讀列表裡最近一版 done 的；一版 done 的都沒有才是「產生第一份報告」。
 *   - 完成時把這一版記成 prefs 的 last_report_id（模考成績單的「用這份模考更新學習報告」）。
 */
import { ASSIST_STANDARD_LEVELS, taiwanToday, type AssistReportAccepted, type AssistReportDetail, type AssistReportSummary } from '@gsat/shared';
import { Copy, Printer, RefreshCw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { BackLink, ConfirmButton, ErrorMessage } from '../writing/components/ui';
import { useSignedIn } from '../writing/lib/access';
import type { ErrorView } from '../writing/lib/errors';
import { AssistAccessNotice, AssistGate, AssistHeader, useAssistAccess } from './components/AssistAccess';
import { AssistLiveRegion } from './components/AssistStatus';
import { cardCls, primaryBtn, secondaryBtn } from './components/parts';
import { ReportGeneratePanel } from './components/ReportGeneratePanel';
import { ReportView } from './components/ReportView';
import { deleteAssistReport, getAssistReport, listAssistReports } from './lib/assistApi';
import { assistRefundMessage } from './lib/errors';
import { useAssistErrorView, useAssistReportPoller } from './lib/pollers';
import { writePrefs } from './lib/prefs';
import { reportPlainText } from './lib/printText';
import { readPlanChecks } from './planProgress';
import { reportDate } from './reportFormat';
import { ZH_COPY } from './subjects/chinese/copy';
import { useAssistSubjects } from './subjects/useAssistSubjects';

/** 進度列（不是 live region：頁面常駐的 AssistLiveRegion 負責唸）。stopped：輪詢因錯誤停了，原因與「再試一次」在上方。 */
function ReportPending({ detail, stopped }: { detail: AssistReportDetail; stopped: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
      {!stopped && <span aria-hidden="true" className="size-3 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />}
      <span className="font-medium">{detail.status === 'queued' ? '排隊中…' : 'AI 正在整理你的學習報告…'}</span>
      <span className="text-muted">
        {stopped ? '自動更新已停止（原因見上方）。按「再試一次」或重新整理頁面，就能看到最新進度。' : '通常 1–2 分鐘，完成後會自動顯示；可以先離開，回來再看。'}
      </span>
    </div>
  );
}

/** 輪詢停了（登入過期、在別的分頁登出…）：說出原因（重新登入、同意的下一步）並給「再試一次」。 */
function PollStopped({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const errorView = useAssistErrorView();
  const [view, setView] = useState<ErrorView | null>(null);
  useEffect(() => {
    let alive = true;
    void errorView(error).then((v) => alive && setView(v));
    return () => {
      alive = false;
    };
  }, [error, errorView]);
  return (
    <div className="report-screen-only space-y-2">
      {view && <ErrorMessage view={view} />}
      <button type="button" onClick={onRetry} className={secondaryBtn}>
        再試一次
      </button>
    </div>
  );
}

/** 常駐 live region 的文字。 */
function reportStatusText(status: AssistReportDetail['status']): string {
  if (status === 'queued') return '報告排隊中…';
  if (status === 'running') return 'AI 正在整理你的學習報告…';
  if (status === 'done') return '學習報告完成。';
  return '這一版報告沒有完成，點數已全額退還。';
}

function Toolbar({
  detail,
  versions,
  onPick,
  onNewVersion,
  onDeleted,
}: {
  detail: AssistReportDetail;
  versions: AssistReportSummary[];
  onPick: (v: number) => void;
  /** null：不能產生新版本（開關關著的唯讀模式）。 */
  onNewVersion: (() => void) | null;
  onDeleted: () => void;
}) {
  const selectId = useId();
  const errorView = useAssistErrorView();
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<ErrorView | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportPlainText(detail, readPlanChecks(detail.id)));
      setCopyState('done');
    } catch {
      setCopyState('failed');
    }
  };
  const remove = async () => {
    setError(null);
    try {
      await deleteAssistReport(detail.id);
      onDeleted();
    } catch (err) {
      setError(await errorView(err, { deleting: true }));
    }
  };
  return (
    <div className="report-screen-only space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          版本
        </label>
        <select id={selectId} value={detail.version} onChange={(e) => onPick(Number(e.target.value))} className="min-h-11 rounded-full border border-line bg-bg px-4">
          {versions.map((v) => (
            <option key={v.id} value={v.version}>
              第 {v.version} 版（{reportDate(v.created_at)}）{v.status === 'failed' ? '・沒有完成' : v.status === 'done' ? '' : '・產生中'}
            </option>
          ))}
        </select>
        {detail.status === 'done' && (
          <>
            <button type="button" onClick={() => window.print()} className={secondaryBtn}>
              <Printer aria-hidden="true" className="size-4" />
              列印／存成 PDF
            </button>
            <button type="button" onClick={() => void copy()} className={secondaryBtn}>
              <Copy aria-hidden="true" className="size-4" />
              複製文字
            </button>
          </>
        )}
        {onNewVersion && (
          <button type="button" onClick={onNewVersion} className={primaryBtn}>
            <RefreshCw aria-hidden="true" className="size-4" />
            {detail.status === 'failed' ? '再產生一次' : '依這版產生新版本'}
          </button>
        )}
      </div>
      <p role="status" className="text-sm text-muted">
        {copyState === 'done' ? '已複製報告的文字（開頭與結尾附 AI 聲明）。' : copyState === 'failed' ? '這個瀏覽器不能複製，請改用列印。' : ''}
      </p>
      {detail.status !== 'queued' && detail.status !== 'running' && (
        <ConfirmButton label="刪除這一版" question="確定刪除這一版報告？刪除後無法復原。" confirmLabel="刪除" onConfirm={() => void remove()} />
      )}
      {error && <ErrorMessage view={error} />}
    </div>
  );
}

function Body() {
  const zhOpen = useAssistSubjects().isOpen('chinese');
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const signedIn = useSignedIn();
  const access = useAssistAccess();
  const closed = access.state === 'closed';
  const panelHeading = useId();
  const [todayTw] = useState(() => taiwanToday());
  const [list, setList] = useState<AssistReportSummary[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [panelOpenState, setPanelOpen] = useState(search.get('refresh') === '1');
  // 唯讀模式（開關關著）不產生新版本：面板一律不開。
  const panelOpen = panelOpenState && !closed;

  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    setListFailed(false);
    listAssistReports(controller.signal).then(
      (r) => setList(r.reports),
      () => {
        if (!controller.signal.aborted) setListFailed(true);
      },
    );
    return () => controller.abort();
  }, [signedIn, reload]);

  const wanted = params['version'] ? Number(params['version']) : null;
  const selected = useMemo(() => {
    if (!list) return null;
    return wanted === null ? (list[0] ?? null) : (list.find((r) => r.version === wanted) ?? null);
  }, [list, wanted]);
  const poller = useAssistReportPoller(selected?.id ?? null);
  const { snapshot } = poller;
  const detail = snapshot.detail && snapshot.detail.id === selected?.id ? snapshot.detail : null;
  const stopped = snapshot.phase === 'error';

  // 常駐的 live region：同一版從進行中變成完成（或沒有完成）時唸出來；打開時就已經完成的不唸。
  const [announcement, setAnnouncement] = useState('');
  const watched = useRef<{ id: string; pending: boolean } | null>(null);
  useEffect(() => {
    if (!detail) return;
    const pending = detail.status === 'queued' || detail.status === 'running';
    const prev = watched.current;
    watched.current = { id: detail.id, pending };
    if (pending || (prev?.id === detail.id && prev.pending)) setAnnouncement(reportStatusText(detail.status));
  }, [detail?.id, detail?.status]);

  // 產生新版本的面板依「最近一版完成的報告」：選到的這一版沒有完成時，讀列表裡最近一版 done 的詳情。
  const baseId = detail && detail.status !== 'done' && list ? (list.find((r) => r.status === 'done')?.id ?? null) : null;
  const [base, setBase] = useState<{ id: string; detail: AssistReportDetail | null; failed: boolean } | null>(null);
  const [baseRetry, setBaseRetry] = useState(0);
  useEffect(() => {
    if (!panelOpen || baseId === null) return;
    const controller = new AbortController();
    setBase({ id: baseId, detail: null, failed: false });
    getAssistReport(baseId, controller.signal).then(
      (d) => setBase({ id: baseId, detail: d, failed: false }),
      () => {
        if (!controller.signal.aborted) setBase({ id: baseId, detail: null, failed: true });
      },
    );
    return () => controller.abort();
  }, [panelOpen, baseId, baseRetry]);

  // 完成的那一版記下來（模考成績單的「用這份模考更新學習報告」）；列表的狀態也跟著更新。
  useEffect(() => {
    if (!detail || detail.status === 'queued' || detail.status === 'running') return;
    if (detail.status === 'done') writePrefs({ last_report_id: detail.id });
    setList((prev) => prev?.map((r) => (r.id === detail.id && r.status !== detail.status ? { ...r, status: detail.status, failure: detail.failure } : r)) ?? prev);
  }, [detail?.id, detail?.status]);

  const onCreated = (accepted: AssistReportAccepted) => {
    setPanelOpen(false);
    setList(null);
    setReload((n) => n + 1);
    navigate(`/assistant/report/${accepted.version}`);
  };

  const header = (
    <AssistHeader title="學習報告" docTitle={wanted ? `學習報告第 ${wanted} 版｜學習助手` : '學習報告｜學習助手'}>
      <p className="text-muted">
        整理你的強項、弱點與常見錯誤，排出提分計畫與到考試日的逐週讀書計畫。數字由本站的程式依這台裝置的作答紀錄計算（估計、非官方）；分析與建議由 AI 產生。
      </p>
      {/* 學習報告第一版只涵蓋英文（docs/design/assistant-subjects.md §7.4）；國文開放時才說明。 */}
      {zhOpen && <p className="text-sm text-muted">{ZH_COPY.reportEnglishOnly}</p>}
    </AssistHeader>
  );

  if (!signedIn) {
    return (
      <div className="space-y-5">
        <BackLink to="/assistant">學習助手</BackLink>
        {header}
        <AssistAccessNotice access={access} />
        <p className="text-sm text-muted">
          目標的參考：依 {ASSIST_STANDARD_LEVELS.year} 學測，頂標 {ASSIST_STANDARD_LEVELS.top}、前標 {ASSIST_STANDARD_LEVELS.front}、均標 {ASSIST_STANDARD_LEVELS.mean} 級分。
        </p>
      </div>
    );
  }

  const panel = (previous: AssistReportDetail | null) => (
    <section id="report-generate" aria-labelledby={panelHeading} className={`${cardCls} report-screen-only space-y-4`}>
      <h2 id={panelHeading} className="text-lg font-semibold">
        {previous ? `依第 ${previous.version} 版產生新版本` : '產生第一份報告'}
      </h2>
      <ReportGeneratePanel previous={previous} access={access} todayTw={todayTw} onCreated={onCreated} headingId={panelHeading} />
    </section>
  );

  return (
    <div data-report-print className="space-y-5">
      <div className="report-screen-only">
        <BackLink to="/assistant">學習助手</BackLink>
      </div>
      {header}
      {closed && <AssistAccessNotice access={access} />}
      <AssistLiveRegion text={announcement} />
      {listFailed && (
        <div className="space-y-2">
          <ErrorMessage view={{ message: '暫時讀不到你的學習報告，請稍後再試。' }} />
          <button type="button" onClick={() => setReload((n) => n + 1)} className={secondaryBtn}>
            再試一次
          </button>
        </div>
      )}
      {!listFailed && list === null && (
        <p role="status" className="text-muted">
          讀取中…
        </p>
      )}
      {list && list.length === 0 && (closed ? <p className="text-muted">沒有之前的學習報告。</p> : panel(null))}
      {list && list.length > 0 && !selected && (
        <div className="space-y-2">
          <p>找不到第 {wanted} 版的報告（每人保留最近 10 版）。</p>
          <button type="button" onClick={() => navigate('/assistant/report')} className={secondaryBtn}>
            看最新一版
          </button>
        </div>
      )}
      {selected && !detail && snapshot.phase === 'error' && <ErrorMessage view={{ message: '暫時讀不到這一版報告，請稍後再試。' }} />}
      {selected && !detail && snapshot.phase !== 'error' && (
        <p role="status" className="text-muted">
          讀取中…
        </p>
      )}
      {detail && list && (
        <>
          <Toolbar
            detail={detail}
            versions={list}
            onPick={(v) => navigate(`/assistant/report/${v}`)}
            onNewVersion={
              closed
                ? null
                : () => {
                    setPanelOpen(true);
                    requestAnimationFrame(() => document.getElementById('report-generate')?.scrollIntoView({ block: 'start' }));
                  }
            }
            onDeleted={() => {
              setList(null);
              setReload((n) => n + 1);
              navigate('/assistant/report');
            }}
          />
          {stopped && <PollStopped error={snapshot.error} onRetry={() => poller.restart()} />}
          {panelOpen &&
            (detail.status === 'done' || baseId === null ? (
              panel(detail.status === 'done' ? detail : null)
            ) : base?.id === baseId && base.detail ? (
              panel(base.detail)
            ) : base?.id === baseId && base.failed ? (
              <div className="report-screen-only space-y-2">
                <ErrorMessage view={{ message: '暫時讀不到上一版完成的報告，請稍後再試。' }} />
                <button type="button" onClick={() => setBaseRetry((n) => n + 1)} className={secondaryBtn}>
                  再試一次
                </button>
              </div>
            ) : (
              <p role="status" className="report-screen-only text-muted">
                讀取上一版報告…
              </p>
            ))}
          {(detail.status === 'queued' || detail.status === 'running') && <ReportPending detail={detail} stopped={stopped} />}
          {detail.status === 'failed' && (
            <div role="alert" className={cardCls}>
              <p className="font-semibold">這一版報告沒有完成：{assistRefundMessage(detail.failure)}。</p>
              <p className="text-muted">點數已全額退還。{closed ? '' : '可以按「再產生一次」重新送出。'}</p>
            </div>
          )}
          {detail.status === 'done' && detail.facts && detail.report && (
            <ReportView detail={detail} facts={detail.facts} report={detail.report} todayTw={todayTw} onAnswerQuestions={closed ? undefined : () => setPanelOpen(true)} />
          )}
        </>
      )}
    </div>
  );
}

export default function ReportPage() {
  return (
    <AssistGate readOnly>
      <Body />
    </AssistGate>
  );
}
