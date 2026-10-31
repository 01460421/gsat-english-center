/**
 * /zh-writing/:id：國寫範文的結果頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」）。id 是學習助手的案例 id
 * （範文存在學習助手：一個國文的國寫案例＋範文的 turn）。
 *
 *   - 輪詢 GET /api/assist/cases/{id}（學習助手同一個輪詢器：有進行中的任務才繼續問；分頁看不到時暫停）。
 *   - 題目（收合；QuestionPreview 的國文區塊）：問題（一）的素材引文按「在題目中標出這句」時展開、加亮並捲過去。
 *   - AI 示範（ZhExemplarBlock，和學習助手的案例頁同一塊）：兩篇時切換、進度列、失敗的退還說明、「再試一次」「再看一篇」
 *     （行內確認 → POST /api/assist/zh-exemplars {source:'case', case_id}）；這一題已經 2 篇時改成說明。
 *   - 常駐的 live region 唸出「示範排隊中」「示範寫好了」「沒有完成，點數已經退還」；寫好時焦點移到那一篇的固定標籤。
 *   - 頁尾：保存說明（ZH_EXEMPLAR_RECORDS_NOTE）、在學習助手打開這一題（國寫指導、追問）、刪除這一題（進行中不能刪）。
 *   - 開關關著（唯讀模式）或不能送出：照常看已有的示範，不給「再看一篇」。
 * 不提供整篇複製與列印（國寫是手寫考試）。
 */
import {
  ZH_EXEMPLAR_RECORDS_NOTE,
  isZhExemplarSection,
  type AssistCaseDetail,
  type AssistTaskAccepted,
} from '@gsat/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ApiRequestError } from '../../../lib/api';
import { APP_NAME } from '../../../modules';
import { BackLink, ConfirmButton, ErrorMessage, Notice, card } from '../../writing/components/ui';
import type { ErrorView } from '../../writing/lib/errors';
import { AssistLiveRegion } from '../components/AssistStatus';
import { AnalysisSection, primaryBtn, secondaryBtn } from '../components/parts';
import { QuestionPreview } from '../components/QuestionPreview';
import { createZhExemplar, deleteAssistCase } from '../lib/assistApi';
import { useAssistCasePoller, useAssistErrorView } from '../lib/pollers';
import { previewFromView } from '../lib/view';
import { caseSubject } from '../subjects';
import { ZH_EXEMPLAR_COPY } from '../subjects/chinese/copy';
import { zhExemplarState } from '../subjects/chinese/exemplar';
import { resolveZhQuote, zhExemplarQuoteRefs } from '../subjects/chinese/quotes';
import { ZH_EXEMPLAR_SECTION_ID, ZhExemplarBlock, zhExemplarBlockVisible } from '../subjects/chinese/ZhExemplarSection';
import { zhExemplarHeadingId } from '../subjects/chinese/ZhExemplarView';
import { ZhWritingAccessNotice, ZhWritingGate, ZhWritingHeader, useZhWritingAccess } from './components/ZhWritingAccess';
import { ZH_WRITING_COPY, ZH_WRITING_PATH, ZH_WRITING_SECTION_SHORT, ZH_WRITING_TITLE } from './labels';
import { zhWritingDisplayTitle } from './lib';

/** 錯誤 → 畫面訊息（useAssistErrorView 是 async）。 */
function useErrorViewOf(error: unknown): ErrorView | null {
  const errorView = useAssistErrorView();
  const [view, setView] = useState<ErrorView | null>(null);
  useEffect(() => {
    let alive = true;
    void errorView(error).then((v) => alive && setView(v));
    return () => {
      alive = false;
    };
  }, [error, errorView]);
  return view;
}

function NotFound() {
  return (
    <section className="space-y-3 py-2">
      <title>{`${ZH_WRITING_COPY.notFoundTitle}｜${ZH_WRITING_TITLE}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">{ZH_WRITING_COPY.notFoundTitle}</h1>
      <p className="text-muted">{ZH_WRITING_COPY.notFound}</p>
      <BackLink to={ZH_WRITING_PATH}>{ZH_WRITING_COPY.backHome}</BackLink>
    </section>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const view = useErrorViewOf(error);
  return (
    <section className="space-y-3 py-2">
      <title>{`${ZH_WRITING_TITLE}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">讀不到這一篇</h1>
      {view && <ErrorMessage view={view} />}
      <button type="button" onClick={onRetry} className={primaryBtn}>
        再試一次
      </button>
    </section>
  );
}

/** 輪詢停了（登入過期、在別的分頁登出…）：說出原因並給「再試一次」。 */
function PollStopped({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const view = useErrorViewOf(error);
  return (
    <div className="space-y-2">
      {view && <ErrorMessage view={view} />}
      <button type="button" onClick={onRetry} className={secondaryBtn}>
        再試一次
      </button>
    </div>
  );
}

function ResultView({ detail, poller }: { detail: AssistCaseDetail; poller: ReturnType<typeof useAssistCasePoller> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const access = useZhWritingAccess();
  const errorView = useAssistErrorView();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ErrorView | null>(null);
  const [locate, setLocate] = useState<{ id: string; n: number } | null>(null);

  const isWriting = caseSubject(detail) === 'chinese' && detail.kind === 'zh_writing';
  const stopped = poller.snapshot.phase === 'error';
  const connectionError = !stopped && poller.snapshot.error !== null;
  const ready = access.state === 'ready';
  const ended = detail.source_ended === true;
  // 能不能再送一篇：可以送 AI 任務、題目已經確認（獨立頁的案例是 ready；之後在學習助手要過國寫指導是 analyzed）。
  const offer = isWriting && ready && !ended && (detail.status === 'ready' || detail.status === 'analyzed' || detail.status === 'failed');
  const state = zhExemplarState(detail.turns, detail.pending);
  const title = zhWritingDisplayTitle(detail.title);
  const section = isZhExemplarSection(detail.section) ? detail.section : null;
  // 頁首下面一行：題目的來源與題型（歷屆題目的來源已經寫了知性或情意，不再重複）。
  const origin = detail.question?.origin_label ?? '';
  const sectionText = section ? ZH_WRITING_SECTION_SHORT[section] : '';
  const subtitle = [origin, sectionText && !origin.includes(sectionText) ? sectionText : ''].filter((t) => t !== '').join('・');

  const preview = useMemo(() => (detail.question ? { ...previewFromView(detail.question), subject: 'chinese' as const } : null), [detail.question]);
  const blocks = detail.question?.blocks;
  const refs = useMemo(() => zhExemplarQuoteRefs(detail.turns), [detail.turns]);
  const locatableIds = useMemo(() => new Set(blocks ? refs.filter((r) => resolveZhQuote(r, blocks) !== null).map((r) => r.id) : []), [refs, blocks]);
  // 問題（一）的素材引文只在學生按下那一句時才標（同學習助手的案例頁）。
  const marks = useMemo(() => {
    const ref = locate ? refs.find((r) => r.id === locate.id) : undefined;
    const at = ref && blocks ? resolveZhQuote(ref, blocks) : null;
    return at ? { [at.block]: [{ start: at.start, end: at.end, active: true }] } : {};
  }, [locate, refs, blocks]);
  useEffect(() => {
    if (!locate) return;
    const frame = requestAnimationFrame(() => {
      const mark = document.querySelector<HTMLElement>('mark[data-active="true"]');
      if (!mark) return;
      mark.scrollIntoView?.({ block: 'center' });
      mark.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [locate]);

  // 從首頁送出來的：焦點先放在「AI 示範」的標題（進度列在那裡）。
  const started = (location.state as { started?: boolean } | null)?.started === true;
  useEffect(() => {
    if (started) document.getElementById(`${ZH_EXEMPLAR_SECTION_ID}-h`)?.focus({ preventScroll: true });
    // 只在第一次顯示時。
  }, []);

  // 範文的進度：常駐的 live region 唸出來；寫好時焦點還在這一塊（或掉到 body）就移到那一篇的固定標籤。
  const pending = state.pending;
  const [announcement, setAnnouncement] = useState(() => (pending ? ZH_EXEMPLAR_COPY.pendingLive(pending.status === 'queued') : ''));
  const lastPending = useRef<string | null>(pending ? pending.turn_id : null);
  useEffect(() => {
    if (pending) {
      lastPending.current = pending.turn_id;
      setAnnouncement(ZH_EXEMPLAR_COPY.pendingLive(pending.status === 'queued'));
      return;
    }
    const turnId = lastPending.current;
    if (turnId === null) return;
    lastPending.current = null;
    const turn = detail.turns.find((t) => t.id === turnId) ?? null;
    const failed = turn?.status === 'failed';
    setAnnouncement(failed ? ZH_EXEMPLAR_COPY.failedLive : ZH_EXEMPLAR_COPY.doneLive);
    const active = document.activeElement;
    const focusLost = active === null || active === document.body;
    if (turn && !failed && (focusLost || active?.closest('[data-zh-exemplar-section]') || active?.id === `${ZH_EXEMPLAR_SECTION_ID}-h`)) {
      document.getElementById(zhExemplarHeadingId(turn.id))?.focus();
    }
  }, [pending, detail.turns]);

  const onStarted = (_accepted: AssistTaskAccepted) => {
    setActionError(null);
    poller.restart();
  };

  /** 學習助手的國寫案例還沒有國寫指導（409）：說明要先看國寫指導；其他照學習助手的說法。 */
  const describe = (err: unknown): string | null =>
    err instanceof ApiRequestError && err.code === 'conflict' && detail.pending === null && !detail.turns.some((t) => t.kind === 'analyze' && t.status === 'done')
      ? ZH_WRITING_COPY.needGuidance
      : null;

  const remove = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteAssistCase(detail.id);
      navigate(ZH_WRITING_PATH, { replace: true });
    } catch (err) {
      setActionError(await errorView(err, { deleting: true }));
      setBusy(false);
    }
  };

  return (
    <article className="space-y-5">
      <div>
        <BackLink to={ZH_WRITING_PATH}>{ZH_WRITING_TITLE}</BackLink>
        <ZhWritingHeader title={title} docTitle={`${title}｜${ZH_WRITING_TITLE}`}>
          {subtitle !== '' && <p className="text-sm text-muted">{subtitle}</p>}
        </ZhWritingHeader>
      </div>
      <AssistLiveRegion text={announcement} />
      <ZhWritingAccessNotice access={access} />
      {stopped && <PollStopped error={poller.snapshot.error} onRetry={() => poller.restart()} />}

      <section aria-labelledby="zh-writing-question-h" className={card}>
        <h2 id="zh-writing-question-h" className="mb-2 text-lg font-semibold">
          {ZH_WRITING_COPY.resultQuestion}
        </h2>
        {preview ? (
          <QuestionPreview model={preview} blockMarks={marks} collapsible expand={locate !== null} itemsFilter={[]} headingLevel={3} />
        ) : (
          <p className="text-muted">這一題沒有題目內容。</p>
        )}
      </section>

      {isWriting ? (
        <AnalysisSection id={ZH_EXEMPLAR_SECTION_ID} title={ZH_EXEMPLAR_COPY.title} className="rounded-2xl border border-line p-4 lg:p-5">
          {zhExemplarBlockVisible(detail, offer) ? (
            <ZhExemplarBlock
              detail={detail}
              offer={offer}
              poll={{ speed: poller.snapshot.speed, connectionError, stopped }}
              onStarted={onStarted}
              locatable={(id) => locatableIds.has(id)}
              onLocate={(id) => setLocate((cur) => ({ id, n: (cur?.n ?? 0) + 1 }))}
              submit={() => createZhExemplar({ source: 'case', case_id: detail.id })}
              intro={ZH_WRITING_COPY.writeFirst}
              standalone
              describe={describe}
            />
          ) : (
            <p className="text-sm text-muted">{ZH_WRITING_COPY.resultEmpty}</p>
          )}
        </AnalysisSection>
      ) : (
        <Notice>
          <p>{ZH_WRITING_COPY.resultNotWriting}</p>
        </Notice>
      )}

      <footer className="space-y-2 border-t border-line pt-4 text-sm" data-testid="zh-writing-result-footer">
        <p className="text-muted">{ZH_EXEMPLAR_RECORDS_NOTE}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link to={`/assistant/case/${encodeURIComponent(detail.id)}`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-2">
            {ZH_WRITING_COPY.resultOpenAssistant}
          </Link>
          <ConfirmButton
            label={ZH_WRITING_COPY.resultDelete}
            question={ZH_WRITING_COPY.resultDeleteQuestion}
            confirmLabel={ZH_WRITING_COPY.resultDeleteConfirm}
            onConfirm={() => void remove()}
            disabled={busy || detail.pending !== null}
          />
        </div>
        {detail.pending !== null && <p className="text-xs text-muted">{ZH_WRITING_COPY.resultDeleteBusy}</p>}
        {actionError && <ErrorMessage view={actionError} />}
      </footer>
    </article>
  );
}

function ResultBody({ id }: { id: string }) {
  const poller = useAssistCasePoller(id);
  const { snapshot } = poller;
  const detail = snapshot.detail;
  if (!detail) {
    if (snapshot.phase === 'error') {
      if (snapshot.error instanceof ApiRequestError && snapshot.error.status === 404) return <NotFound />;
      return <LoadError error={snapshot.error} onRetry={() => poller.restart()} />;
    }
    return (
      <section className="py-10 text-center">
        <title>{`${ZH_WRITING_TITLE}｜${APP_NAME}`}</title>
        <h1 className="sr-only">{ZH_WRITING_TITLE}</h1>
        <p role="status" className="text-muted">
          讀取中…
        </p>
      </section>
    );
  }
  return <ResultView detail={detail} poller={poller} />;
}

export default function ZhWritingResultPage() {
  const { id = '' } = useParams();
  return (
    <ZhWritingGate>
      <ResultBody key={id} id={id} />
    </ZhWritingGate>
  );
}
