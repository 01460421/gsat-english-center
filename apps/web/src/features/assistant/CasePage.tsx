/**
 * /assistant/case/:id：一題（或一組）的解析與追問（docs/design/learning-assistant.md §1.7、§1.9、§2.1）。
 *
 *   - 輪詢 GET /api/assist/cases/{id}：只有 pending 不是 null 時繼續問（Poller<T>，分頁看不到時暫停）。
 *   - 手機：頁首（標題、AI 聲明、歷史一行）→ 可收合的題目卡（預設收合）→ 解析各區塊 → 懂了嗎、這則有錯 → 追問串與輸入框 → 刪除。
 *   - 桌機（≥ lg）：Workspace layout="result"：左欄「題目」（選文、證據句加亮、你的答案），右欄 PaneTabs「解析｜追問（n）」。
 *     分欄或堆疊只靠 CSS（R4），追問輸入框不會因為寬度改變重新掛載。
 *   - 解析完成時不搶焦點：只有焦點還在 body 上（或送出按鈕已經不見）時，才把焦點移到「解析」標題（§1.11）；
 *     追問的回覆出來時移到那一輪的標題（不是頁面上方的「解析」）。
 *   - 常駐一個 aria-live 區（AssistLiveRegion）：排隊中、解析完成、追問的回覆出來了都唸得到。
 *   - 輪詢因為不會自己好的錯誤停了（登入過期、找不到…）：說出原因、給「再試一次」，不再說「會自動顯示」。
 *   - 有進行中的 AI 任務時不能刪（409）：刪除鈕停用。
 *   - 開關關著（唯讀模式，AssistGate readOnly）：照常輪詢與顯示、可以改「懂了嗎」與刪除；頁首說明暫停，
 *     送出解析、追問、繼續拍照的入口都不顯示。
 *   - 多科目（docs/design/assistant-subjects.md §8.1）：解析元件、左欄引文加亮、推薦練習（國文沒有）、重試與追問的點數都經過
 *     科目登記表（subjects/index.ts）；國文的開關另外決定這一題是不是唯讀（國文關著時英文照常）。國文另有頁首的「國文｜字形・單選」、
 *     解析時判定科目不符的退還說明，以及「用同一份題目問另一部分」。
 *   - 科目登記表的 CaseExtras（選填，英文沒有）放在解析之後、「回報 AI 內容」之前：國文的國寫案例是「看一篇 AI 示範」
 *     （國寫範文設計 §8）。範文的進度列放在那一塊（頁首只放解析與轉錄的進度），寫好或失敗時常駐的 live region 照樣唸出來。
 */
import {
  PUBLISHER_ASSIST_ENDED_TEXT,
  assistSubjectMismatchText,
  type AssistCaseDetail,
  type AssistDetectedSubject,
  type AssistPendingTask,
  type AssistTaskAccepted,
  type AssistTurnKind,
  type AssistTurnView,
} from '@gsat/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { PaneTabs } from '../../components/desktop/PaneTabs';
import { Pane, Workspace } from '../../components/desktop/Workspace';
import { scrollIntoPane } from '../../components/desktop/scroll';
import { ApiRequestError } from '../../lib/api';
import { useIsDesktop, useMainTier } from '../../lib/media';
import { AiNotice, BackLink, ConfirmButton, ErrorMessage, Notice, ReportAiContent } from '../writing/components/ui';
import type { ErrorView } from '../writing/lib/errors';
import { AssistAccessNotice, AssistGate, useAssistAccess } from './components/AssistAccess';
import { AssistLiveRegion, AssistStatus } from './components/AssistStatus';
import { FollowupComposer } from './components/FollowupComposer';
import { FollowupThread, followupHeadingId } from './components/FollowupThread';
import { HistoryLine } from './components/HistoryLine';
import { AssistSafetyCare, primaryBtn, secondaryBtn } from './components/parts';
import { QuestionPreview } from './components/QuestionPreview';
import { UnderstoodBar } from './components/UnderstoodBar';
import { deleteAssistCase, startAssistAnalyze } from './lib/assistApi';
import { assistRefundMessage } from './lib/errors';
import { useAssistCasePoller, useAssistErrorView } from './lib/pollers';
import { followupTurns, latestAnalysis, previewFromView } from './lib/view';
import { caseSubject, webSubject } from './subjects';
import { ZH_COPY, ZH_EXEMPLAR_COPY, ZH_FOLLOWUP_PLACEHOLDER } from './subjects/chinese/copy';
import { zhCaseTag, zhClassicalCase } from './subjects/chinese/caseTag';
import { zhExemplarHeadingId } from './subjects/chinese/ZhExemplarView';
import { useAssistSubjects } from './subjects/useAssistSubjects';
import { APP_NAME } from '../../modules';

function sourceNote(detail: AssistCaseDetail): string | null {
  if (detail.source === 'exam') return '這份解析由 AI 即時產生，沒有經過人工審核；答案以官方公布為準。';
  if (detail.source === 'bank' || detail.source === 'bank_mock') return '答案與本站解析以題目頁為準；AI 的說明是補充。';
  if (detail.trust === 'student') return '你提供的題目沒有經過本站確認；AI 判斷的答案可能有錯，請對照課本或老師的答案。';
  return null;
}

/** 解析時判定科目不符而退還（國文的 turn 帶 detected_subject；§2.5）：英文、數學、社會、自然才算，其他照一般的退還說明。 */
function mismatchOf(turn: AssistTurnView | null): Exclude<AssistDetectedSubject, 'chinese' | 'other'> | null {
  const d = turn?.detected_subject;
  return d === 'english' || d === 'math' || d === 'social' || d === 'science' ? d : null;
}

/** 常駐 live region 的文字：進行中的任務。 */
/** 追問框停用時的說明：國寫範文產生中另外說（不是「這一輪」追問）；解析與追問的寫法不變。 */
function composerBusyReason(pending: AssistPendingTask, stopped: boolean): string {
  if (pending.kind === 'zh_exemplar') return stopped ? ZH_EXEMPLAR_COPY.followupBusyStopped : ZH_EXEMPLAR_COPY.followupBusy;
  return stopped ? '自動更新已停止：按上方的「再試一次」看這一輪有沒有完成。' : '等這一輪完成再問下一個問題。';
}

function pendingText(pending: AssistPendingTask): string {
  if (pending.kind === 'followup') return pending.status === 'queued' ? '追問排隊中…' : 'AI 正在回答你的追問…';
  if (pending.kind === 'ocr') return '照片轉錄中…';
  if (pending.kind === 'zh_exemplar') return ZH_EXEMPLAR_COPY.pendingLive(pending.status === 'queued');
  return pending.status === 'queued' ? '解析排隊中…' : 'AI 正在解析…';
}

/** 錯誤 → 畫面訊息（含重新登入、同意的下一步；useAssistErrorView 是 async）。 */
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

/** 輪詢停了（登入過期、在別的分頁登出、找不到…）：畫面上的內容可能不是最新的，說出原因並給下一步。 */
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

function NotFound() {
  return (
    <section className="space-y-3 py-2">
      <title>{`找不到這一題｜學習助手｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這一題</h1>
      <p className="text-muted">這一題可能已經刪除，或超過保存期限（最後一次更新後 180 天）。</p>
      <BackLink to="/assistant">回到學習助手</BackLink>
    </section>
  );
}

function CaseView({ detail, poller }: { detail: AssistCaseDetail; poller: ReturnType<typeof useAssistCasePoller> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const { ws } = useMainTier();
  const access = useAssistAccess();
  const subjects = useAssistSubjects();
  const subject = caseSubject(detail);
  const registry = webSubject(subject);
  // 英文以外的科目另有開關：那一科關著時這一題是唯讀模式（英文照常；§7.5 緊急關閉）。
  const subjectClosed = subject !== 'english' && access.state !== 'closed' && !subjects.isOpen(subject);
  const closed = access.state === 'closed' || subjectClosed;
  const errorView = useAssistErrorView();
  // 確認頁送出時回到既有的案例、這次的疑問放進了追問框（AskPage）：說明一次，桌機先打開「追問」分頁。
  const carriedDoubt = (location.state as { carriedDoubt?: boolean } | null)?.carriedDoubt === true;
  const [tab, setTab] = useState<'analysis' | 'followups'>(() => (carriedDoubt && latestAnalysis(detail.turns) ? 'followups' : 'analysis'));
  // 正在看的引文（id 由各科自己定）；n 讓同一句再按一次也會捲過去。
  const [locate, setLocate] = useState<{ id: string; n: number } | null>(null);
  const [actionError, setActionError] = useState<ErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  const analysisHeadingRef = useRef<HTMLHeadingElement>(null);

  const preview = useMemo(
    () => (detail.question ? { ...previewFromView(detail.question), ...(subject !== 'english' ? { subject } : {}) } : null),
    [detail.question, subject],
  );
  const latest = latestAnalysis(detail.turns);
  const analysis = latest?.analysis ?? null;
  const followups = followupTurns(detail.turns);
  const doneFollowups = followups.filter((t) => t.status === 'done').length;
  const lastAnalyze = [...detail.turns].reverse().find((t) => t.kind === 'analyze') ?? null;
  const pending = detail.pending;
  // 輪詢因為不會自己好的錯誤停了：進度列不再說「會自動顯示」，改顯示原因與「再試一次」。
  const stopped = poller.snapshot.phase === 'error';
  const connectionError = !stopped && poller.snapshot.error !== null;
  const ready = access.state === 'ready' && !subjectClosed;
  const targets = detail.question?.targets ?? [];
  const displayOf = (label: string) => targets.find((t) => t.label === label)?.display_label ?? label;
  const groupCase = targets.length > 1;
  const safety = (detail.flags.safety && detail.flags.safety !== 'none') || (analysis && 'safety_flag' in analysis && analysis.safety_flag !== 'none');
  // 出版社題的授權已經結束（docs/design/weak-paper.md §9.6）：Worker 已經遮住題目與解析，這裡不再提供解析與追問。
  const ended = detail.source_ended === true;

  // 進行中的任務結束（pending → 沒有）時：常駐的 live region 唸出結果；焦點還在 body（送出按鈕停用或不見了）才移動，
  // 不搶學生正在操作的焦點。解析完成移到「解析」標題，追問的回覆移到那一輪的標題。
  const started = (location.state as { started?: boolean } | null)?.started === true;
  const [announcement, setAnnouncement] = useState(() => (pending ? pendingText(pending) : ''));
  const lastPending = useRef<{ kind: AssistTurnKind; turnId: string | null } | null>(
    pending ? { kind: pending.kind, turnId: pending.turn_id } : started ? { kind: 'analyze', turnId: null } : null,
  );
  useEffect(() => {
    if (pending) {
      lastPending.current = { kind: pending.kind, turnId: pending.turn_id };
      setAnnouncement(pendingText(pending));
      return;
    }
    const finished = lastPending.current;
    if (!finished) return;
    lastPending.current = null;
    const turn = finished.turnId ? (detail.turns.find((t) => t.id === finished.turnId) ?? null) : null;
    const active = document.activeElement;
    const focusLost = active === null || active === document.body;
    if (finished.kind === 'followup') {
      const failed = turn?.status === 'failed';
      setAnnouncement(failed ? '這一輪追問沒有完成，點數已經退還。' : '追問的回覆已經出來了。');
      // 焦點還在「送出追問」上（送出時停用，有的瀏覽器把焦點丟到 body）也算：學生還沒去操作別的東西。
      if (turn && (focusLost || active?.matches('[data-followup-submit]'))) document.getElementById(followupHeadingId(turn.id))?.focus();
      return;
    }
    if (finished.kind === 'ocr') {
      setAnnouncement('照片轉錄完成。');
      return;
    }
    if (finished.kind === 'zh_exemplar') {
      const failed = turn?.status === 'failed';
      setAnnouncement(failed ? ZH_EXEMPLAR_COPY.failedLive : ZH_EXEMPLAR_COPY.doneLive);
      // 焦點還在範文那一塊（送出後放在它的標題）或已經丟到 body：移到這一篇的標籤；學生去操作別的東西了就不搶。
      if (turn && !failed && (focusLost || active?.closest('[data-zh-exemplar-section]') || active?.id === 'zh-exemplar-h')) {
        document.getElementById(zhExemplarHeadingId(turn.id))?.focus();
      }
      return;
    }
    if (!analysis) {
      if ((turn ?? lastAnalyze)?.status === 'failed') setAnnouncement('解析沒有完成，點數已經退還。');
      return;
    }
    setAnnouncement('解析完成。');
    if (focusLost) analysisHeadingRef.current?.focus({ preventScroll: true });
  }, [pending, analysis, detail.turns, lastAnalyze]);

  // 證據句與引文：左欄加亮（全部淡色、按下的那一句加深），按下時捲過去。英文是選文裡的解法步驟；國文是題目區塊裡的引文。
  const highlights = useMemo(
    () => registry.highlightsOf(analysis, detail.question, locate?.id ?? null, detail.hint_first, detail.turns),
    [registry, analysis, detail.question, locate, detail.hint_first, detail.turns],
  );
  const locatable = useMemo(() => registry.locatableOf(analysis, detail.question, detail.turns), [registry, analysis, detail.question, detail.turns]);
  useEffect(() => {
    if (!locate) return;
    const frame = requestAnimationFrame(() => {
      const mark = document.querySelector<HTMLElement>('mark[data-active="true"]');
      if (!mark) return;
      if (isDesktop) scrollIntoPane(mark, { block: 'center' });
      else mark.scrollIntoView?.({ block: 'center' });
      mark.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [locate, isDesktop]);

  const onStarted = (accepted: AssistTaskAccepted) => {
    poller.restart();
    if (accepted.status === 'done') setActionError(null);
  };

  const retryAnalyze = async () => {
    setBusy(true);
    setActionError(null);
    try {
      onStarted(await startAssistAnalyze(detail.id));
    } catch (err) {
      setActionError(await errorView(err, { submitting: true }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteAssistCase(detail.id);
      navigate('/assistant', { replace: true });
    } catch (err) {
      setActionError(await errorView(err, { deleting: true }));
      setBusy(false);
    }
  };

  const recommendations = registry.recommendationsOf(analysis, detail);
  const Analysis = registry.Analysis;
  const CaseExtras = registry.CaseExtras ?? null;
  const mismatch = mismatchOf(lastAnalyze);

  const analysisBlock = (
    <div className="space-y-5">
      <h2 ref={analysisHeadingRef} tabIndex={-1} className="sr-only">
        解析
      </h2>
      {pending && (pending.kind === 'analyze' || pending.kind === 'ocr') && (
        <AssistStatus key={pending.turn_id} pending={pending} speed={poller.snapshot.speed} group={groupCase} connectionError={connectionError} stopped={stopped} live={false} />
      )}
      {/* 拍照的題目還沒確認轉錄（WP-A3）：照片、轉錄與確認都在 /assistant/new。 */}
      {detail.source === 'photo' && (detail.status === 'draft' || detail.status === 'ocr_queued' || detail.status === 'ocr_ready') && (
        <Notice>
          <p>
            這一題的照片還沒有確認轉錄。
            {!closed && (
              <Link
                to={`/assistant/new?${subject !== 'english' ? `subject=${subject}&` : ''}mode=photo&case=${encodeURIComponent(detail.id)}`}
                className="ml-1 font-medium text-primary underline underline-offset-2"
              >
                繼續拍照與確認
              </Link>
            )}
          </p>
        </Notice>
      )}
      {!analysis && !pending && lastAnalyze?.status === 'failed' && mismatch === null && (
        <div role="alert" className="space-y-2 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3">
          <p className="text-bad">{assistRefundMessage(lastAnalyze.failure)}，這次的點數已經退還。</p>
        </div>
      )}
      {!analysis && !pending && lastAnalyze?.status === 'failed' && mismatch !== null && (
        <div role="alert" className="space-y-2 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3" data-testid="assist-subject-mismatch">
          <p className="text-bad">{assistSubjectMismatchText(mismatch, 'analyze', subjects.open)}</p>
          {mismatch === 'english' && subjects.isOpen('english') && (
            <Link
              to={`/assistant/new?subject=english&mode=paste&from=${encodeURIComponent(detail.id)}`}
              className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
            >
              {ZH_COPY.analyzeSubjectRetry}
            </Link>
          )}
        </div>
      )}
      {!analysis && !pending && !ended && mismatch === null && (detail.status === 'ready' || detail.status === 'failed') && ready && (
        <button type="button" onClick={() => void retryAnalyze()} disabled={busy} className={primaryBtn}>
          {lastAnalyze ? '再試一次' : '送出解析'}（用 {registry.analyzePoints(detail.kind, detail.item_count)} 點）
        </button>
      )}
      {analysis && (
        <Analysis
          detail={detail}
          analysis={analysis}
          sourceNote={sourceNote(detail)}
          recommendations={recommendations}
          locatable={locatable}
          onLocate={(id) => setLocate((cur) => ({ id, n: (cur?.n ?? 0) + 1 }))}
          onUpdated={poller.accept}
        />
      )}
      {analysis && CaseExtras && (
        <CaseExtras
          detail={detail}
          analysis={analysis}
          closed={closed}
          ready={ready}
          ended={ended}
          poll={{ speed: poller.snapshot.speed, connectionError, stopped }}
          onStarted={onStarted}
          locatable={locatable}
          onLocate={(id) => setLocate((cur) => ({ id, n: (cur?.n ?? 0) + 1 }))}
        />
      )}
      {analysis && <ReportAiContent variant="assistant" />}
      {analysis && <UnderstoodBar detail={detail} onUpdated={poller.accept} />}
    </div>
  );

  const followupBlock = (
    <section aria-labelledby="assist-followups" className="space-y-4">
      <h2 id="assist-followups" className="text-lg font-semibold">
        追問
      </h2>
      {carriedDoubt && (
        <Notice>
          <p>
            {analysis
              ? '你之前問過這一題（同樣的答案），這次寫的疑問沒有另外送出解析，已經放進下面的追問框；要問的話按「送出追問」。'
              : '你之前建立過這一題（同樣的答案），解析只看得到當時寫的疑問；這次寫的疑問已經放進追問框，解析完成後可以追問。'}
          </p>
        </Notice>
      )}
      <FollowupThread turns={followups} displayOf={displayOf} />
      {pending?.kind === 'followup' && (
        <AssistStatus key={pending.turn_id} pending={pending} speed={poller.snapshot.speed} connectionError={connectionError} stopped={stopped} live={false} />
      )}
      {ended ? null : analysis ? (
        ready ? (
          <FollowupComposer
            caseId={detail.id}
            rounds={doneFollowups}
            defaultMode={detail.hint_first ? 'hint' : 'explain'}
            chips={'followup_chips_zh' in analysis ? analysis.followup_chips_zh : []}
            labels={groupCase ? targets.map((t) => t.label) : []}
            displayOf={displayOf}
            disabled={pending !== null}
            disabledReason={pending ? composerBusyReason(pending, stopped) : null}
            points={registry.followupPoints}
            onStarted={onStarted}
            {...(subject === 'chinese' ? { placeholder: ZH_FOLLOWUP_PLACEHOLDER } : {})}
          />
        ) : closed ? null : (
          <AssistAccessNotice access={access} />
        )
      ) : closed ? null : (
        <p className="text-sm text-muted">解析完成後就可以追問。</p>
      )}
    </section>
  );

  const header = (
    <header className="space-y-2">
      <title>{`${detail.title}｜學習助手｜${APP_NAME}`}</title>
      <BackLink to="/assistant">學習助手</BackLink>
      {subject === 'chinese' && (
        <p className="text-sm font-semibold text-primary" data-testid="zh-case-tag">
          {zhCaseTag(detail, analysis)}
        </p>
      )}
      <h1 className="text-xl font-bold tracking-tight break-words lg:text-2xl">{detail.title}</h1>
      <AiNotice variant="assistant" />
      {ended && (
        <Notice>
          <p data-testid="assist-source-ended">{PUBLISHER_ASSIST_ENDED_TEXT}。</p>
        </Notice>
      )}
      <HistoryLine line={detail.history_line} currentId={detail.id} subject={subject} />
      {access.state === 'closed' && <AssistAccessNotice access={access} />}
      {subjectClosed && (
        <Notice tone="warn">
          <p>{ZH_COPY.closed}</p>
        </Notice>
      )}
      <AssistLiveRegion text={announcement} />
      {stopped && <PollStopped error={poller.snapshot.error} onRetry={() => poller.restart()} />}
    </header>
  );

  // 國文「用同一份題目問另一部分」（§1.6）：題目已確認的國文案例，國文開放時才有（不用重拍或重貼）。
  const relatedLink =
    subject === 'chinese' && !closed && detail.question?.blocks && detail.question.blocks.length > 0 ? (
      <Link
        to={`/assistant/new?subject=chinese&mode=paste&from=${encodeURIComponent(detail.id)}`}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2"
      >
        {ZH_COPY.relatedCase}
      </Link>
    ) : null;

  const footer = (
    <div className="space-y-2">
      {actionError && <ErrorMessage view={actionError} />}
      <div className="flex justify-end">
        <ConfirmButton
          label="刪除這一題"
          question="確定要刪除這一題、它的解析與追問嗎？刪除後無法復原。"
          confirmLabel="確定刪除"
          onConfirm={() => void remove()}
          disabled={busy || pending !== null}
        />
      </div>
      {pending && <p className="text-right text-xs text-muted">{pending.kind === 'zh_exemplar' ? ZH_EXEMPLAR_COPY.deleteBusy : '解析進行中，完成後才能刪除。'}</p>}
    </div>
  );

  if (isDesktop) {
    return (
      <Workspace
        layout="result"
        header={header}
        left={
          <Pane id="assist-question" label="題目">
            <section aria-labelledby="assist-question-h" className="space-y-3">
              <h2 id="assist-question-h" className="text-lg font-semibold">
                題目
              </h2>
              {safety && <AssistSafetyCare />}
              {preview ? (
                <QuestionPreview model={preview} highlights={highlights.passage} blockMarks={highlights.blocks} classical={zhClassicalCase(detail, analysis)} headingLevel={3} />
              ) : (
                <p className="text-muted">這一題沒有題目內容。</p>
              )}
              {relatedLink}
            </section>
          </Pane>
        }
        right={
          <Pane id="assist-answer" label="解析與追問" fill>
            <PaneTabs
              label="解析與追問"
              value={tab}
              onChange={(v) => setTab(v as 'analysis' | 'followups')}
              scrollPanels={ws}
              tabs={[
                { id: 'analysis', label: '解析', panel: <div className="space-y-5 pt-3">{analysisBlock}</div> },
                { id: 'followups', label: `追問（${doneFollowups}）`, panel: <div className="space-y-5 pt-3">{followupBlock}</div> },
              ]}
            />
            <div className="pt-4">{footer}</div>
          </Pane>
        }
      />
    );
  }

  return (
    <article className="space-y-5">
      {header}
      {safety && <AssistSafetyCare />}
      {preview && (
        <section aria-labelledby="assist-question-h" className="space-y-2 rounded-2xl border border-line bg-surface-2 p-4">
          <h2 id="assist-question-h" className="text-lg font-semibold">
            題目
          </h2>
          <QuestionPreview
            model={preview}
            highlights={highlights.passage}
            blockMarks={highlights.blocks}
            classical={zhClassicalCase(detail, analysis)}
            collapsible
            expand={locate !== null}
            headingLevel={3}
          />
          {relatedLink}
        </section>
      )}
      {analysisBlock}
      {followupBlock}
      {footer}
    </article>
  );
}

function CaseBody({ id }: { id: string }) {
  const poller = useAssistCasePoller(id);
  const { snapshot } = poller;
  const detail = snapshot.detail;
  if (!detail) {
    if (snapshot.phase === 'error') {
      if (snapshot.error instanceof ApiRequestError && snapshot.error.status === 404) return <NotFound />;
      return <CaseLoadError error={snapshot.error} onRetry={() => poller.restart()} />;
    }
    return (
      <section className="py-10 text-center">
        <title>{`學習助手｜${APP_NAME}`}</title>
        <h1 className="sr-only">學習助手</h1>
        <p role="status" className="text-muted">
          讀取中…
        </p>
      </section>
    );
  }
  return <CaseView detail={detail} poller={poller} />;
}

function CaseLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const view = useErrorViewOf(error);
  return (
    <section className="space-y-3 py-2">
      <title>{`學習助手｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">讀不到這一題</h1>
      {view && <ErrorMessage view={view} />}
      <button type="button" onClick={onRetry} className={primaryBtn}>
        再試一次
      </button>
    </section>
  );
}

export default function CasePage() {
  const { id = '' } = useParams();
  return (
    <AssistGate readOnly>
      <CaseBody key={id} id={id} />
    </AssistGate>
  );
}
