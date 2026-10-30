/**
 * 國寫案例的「看一篇 AI 示範」（國寫範文設計 §8）：案例頁在國寫指導之後、「回報 AI 內容」之前放這一塊（科目登記表的 CaseExtras）。
 *
 *   按鈕     「看一篇 AI 示範（8 點）」（次要樣式），上方一行「建議先照上面的架構自己寫一段，再對照示範」。國寫範文沒開放、國文或學習助手
 *            關著、離題、國寫指導還沒完成時不顯示；這一題已經有 2 篇（完成＋進行中）時改成說明。點數只來自 shared 的常數。
 *   確認     行內面板（不用彈窗）：會用幾點（今天還有幾點，取 GET /api/ai/quota）、AI 會寫什麼、示範不是得獎作品也不能當成自己的
 *            作品繳交；點數不夠、今天已經看過 3 篇時停用並說明（試用帳號說明國寫指導＋範文不能同一天完成）。
 *   等待     進行中的範文：進度列放在這一塊（案例頁頁首只放解析與轉錄的進度）；輪詢沿用案例頁的輪詢器（onStarted → restart）。
 *   失敗     退還原因＋「點數已經退還」＋「再試一次（8 點）」（同樣先確認）。
 *   結果     ZhExemplarView；兩篇時「第 1 篇／第 2 篇」切換，預設最新。開關關掉之後已有的範文照常顯示（唯讀）。
 * 不提供整篇複製與列印（國寫是手寫考試）。
 */
import { ASSIST_LIMITS, type AssistTaskAccepted, type ZhWritingView as ZhWritingAnalysis } from '@gsat/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError } from '../../../../lib/api';
import { ErrorMessage } from '../../../writing/components/ui';
import { isQuotaError, type ErrorView } from '../../../writing/lib/errors';
import { useQuota } from '../../../writing/lib/hooks';
import { AssistStatus } from '../../components/AssistStatus';
import { AnalysisSection, primaryBtn, secondaryBtn } from '../../components/parts';
import { startZhExemplar } from '../../lib/assistApi';
import { assistRefundMessage } from '../../lib/errors';
import { useAssistErrorView } from '../../lib/pollers';
import type { SubjectCaseExtrasProps } from '../types';
import { useAssistSubjects } from '../useAssistSubjects';
import { ZH_EXEMPLAR_COPY } from './copy';
import { ZH_EXEMPLAR_POINTS, zhExemplarPointsInfo, zhExemplarState } from './exemplar';
import { ZhExemplarView } from './ZhExemplarView';

/** 這一塊的標題 id（送出後焦點先放在這裡）。 */
export const ZH_EXEMPLAR_SECTION_ID = 'zh-exemplar';

/** 科目登記表的 CaseExtras：只有國寫案例（國寫指導完成）才有這一塊。 */
export function ZhCaseExtras(props: SubjectCaseExtrasProps) {
  if (props.detail.kind !== 'zh_writing' || props.analysis.kind !== 'zh_writing') return null;
  return <ZhExemplarSection {...props} analysis={props.analysis} />;
}

function ConfirmPanel({
  caseId,
  onCancel,
  onStarted,
}: {
  caseId: string;
  onCancel: () => void;
  onStarted: (accepted: AssistTaskAccepted) => void;
}) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { quota, refresh } = useQuota(false);
  const errorView = useAssistErrorView();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  // 打開時：焦點移到面板的標題（觸發的按鈕換成了面板），整個面板捲進畫面（手機的底部導覽列由 scroll-margin 讓開），
  // 並讀一次最新的額度（今天還有幾點、看過幾篇）。
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    void refresh();
  }, [refresh]);
  // 額度讀到之後面板多一行：再捲一次。Chromium 的 block: 'nearest' 在元素本身已經完全在視窗內時不看 scroll-margin，
  // 確定鈕會躲在手機的底部導覽列下面，所以那時再用 'end'（scroll-mb-24 讓開導覽列）。
  const loaded = quota !== null;
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof panel.scrollIntoView !== 'function') return;
    panel.scrollIntoView({ block: 'nearest' });
    const margin = parseFloat(getComputedStyle(panel).scrollMarginBottom) || 0;
    if (panel.getBoundingClientRect().bottom + margin > window.innerHeight) panel.scrollIntoView({ block: 'end' });
  }, [loaded]);
  const points = ZH_EXEMPLAR_POINTS;
  const info = zhExemplarPointsInfo(quota, points);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const accepted = await startZhExemplar(caseId);
      onStarted(accepted);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiRequestError && err.code === 'not_configured' && !err.nonJson) {
        setError({ message: ZH_EXEMPLAR_COPY.unavailable });
        return;
      }
      const q = isQuotaError(err) ? await refresh() : quota;
      setError(await errorView(err, { quota: q, submitting: true }));
    }
  };

  return (
    <div
      ref={panelRef}
      role="group"
      aria-labelledby={headingId}
      className="scroll-mb-24 space-y-3 rounded-2xl border border-line bg-surface-2 p-4 lg:scroll-mb-4"
      data-zh-exemplar-confirm
    >
      <h3 id={headingId} ref={headingRef} tabIndex={-1} className="font-semibold outline-none">
        {ZH_EXEMPLAR_COPY.confirmTitle}
      </h3>
      <ul className="space-y-1" data-testid="zh-exemplar-points">
        {info.lines.map((line) => (
          <li key={line} className={info.blocked ? 'font-medium text-bad' : 'font-medium'}>
            {line}
          </li>
        ))}
      </ul>
      <p>{ZH_EXEMPLAR_COPY.confirmWhat}</p>
      <p className="text-sm text-muted">{ZH_EXEMPLAR_COPY.confirmNotWork}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy || info.blocked} className={primaryBtn} data-zh-exemplar-submit>
          {busy ? '送出中…' : ZH_EXEMPLAR_COPY.confirmOk(points)}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={secondaryBtn}>
          {ZH_EXEMPLAR_COPY.cancel}
        </button>
      </div>
      {error && <ErrorMessage view={error} />}
    </div>
  );
}

function ZhExemplarSection({
  detail,
  analysis,
  closed,
  ready,
  ended,
  poll,
  onStarted,
  locatable,
  onLocate,
}: Omit<SubjectCaseExtrasProps, 'analysis'> & { analysis: ZhWritingAnalysis }) {
  const subjects = useAssistSubjects();
  const state = zhExemplarState(detail.turns, detail.pending);
  const [confirming, setConfirming] = useState(false);
  // 兩篇時看哪一篇（turn id；null＝最新）。新的一篇寫好時回到最新。
  const [picked, setPicked] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const doneCount = state.done.length;
  useEffect(() => setPicked(null), [doneCount]);
  useEffect(() => {
    if (confirming || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [confirming]);

  const points = ZH_EXEMPLAR_POINTS;
  // 能不能送出新的一篇：國寫範文對這位使用者開放、可以送 AI 任務、國寫指導完成而且不是離題。
  const offer = subjects.exemplar('chinese') && ready && !closed && !ended && !analysis.off_topic && detail.status === 'analyzed';
  const full = state.counted >= ASSIST_LIMITS.zhExemplarsPerCase;
  const otherPending = detail.pending !== null && detail.pending.kind !== 'zh_exemplar';
  if (doneCount === 0 && !state.pending && !state.lastFailed && !offer) return null;

  const shown = state.done.find((d) => d.turn.id === picked) ?? state.done[doneCount - 1] ?? null;
  const open = () => setConfirming(true);
  const cancel = () => {
    restoreFocus.current = true;
    setConfirming(false);
  };
  const started = (accepted: AssistTaskAccepted) => {
    setConfirming(false);
    onStarted(accepted);
    // 面板不見了：焦點先放在這一塊的標題，示範寫好時案例頁再移到那一篇的標籤。
    document.getElementById(`${ZH_EXEMPLAR_SECTION_ID}-h`)?.focus({ preventScroll: true });
  };
  const triggerLabel = state.lastFailed ? ZH_EXEMPLAR_COPY.retry(points) : doneCount > 0 ? ZH_EXEMPLAR_COPY.again(points) : ZH_EXEMPLAR_COPY.button(points);

  return (
    <AnalysisSection id={ZH_EXEMPLAR_SECTION_ID} title={ZH_EXEMPLAR_COPY.title} className="rounded-2xl border border-line p-4 lg:p-5">
      <div className="space-y-4" data-zh-exemplar-section>
        {doneCount > 1 && (
          <div role="group" aria-label={ZH_EXEMPLAR_COPY.pick} className="flex flex-wrap gap-2">
            {state.done.map((d, i) => {
              const active = d.turn.id === shown?.turn.id;
              return (
                <button
                  key={d.turn.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPicked(d.turn.id)}
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 font-medium ${active ? 'border-primary bg-primary-soft text-primary' : 'border-line'}`}
                >
                  {ZH_EXEMPLAR_COPY.pickItem(i + 1)}
                </button>
              );
            })}
          </div>
        )}
        {shown && <ZhExemplarView key={shown.turn.id} turnId={shown.turn.id} exemplar={shown.exemplar} locatable={locatable} onLocate={onLocate} />}
        {state.pending && (
          <AssistStatus
            key={state.pending.turn_id}
            pending={state.pending}
            speed={poll.speed}
            connectionError={poll.connectionError}
            stopped={poll.stopped}
            live={false}
          />
        )}
        {state.lastFailed && (
          <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3" data-testid="zh-exemplar-failed">
            <p className="text-bad">
              {assistRefundMessage(state.lastFailed.failure)}，{ZH_EXEMPLAR_COPY.failed}
            </p>
          </div>
        )}
        {offer && !state.pending && (
          full ? (
            <p className="text-sm text-muted" data-testid="zh-exemplar-full">
              {ZH_EXEMPLAR_COPY.perCaseFull(ASSIST_LIMITS.zhExemplarsPerCase)}
            </p>
          ) : confirming ? (
            <ConfirmPanel caseId={detail.id} onCancel={cancel} onStarted={started} />
          ) : (
            <div className="space-y-2">
              {doneCount === 0 && !state.lastFailed && <p className="text-sm">{ZH_EXEMPLAR_COPY.intro}</p>}
              <button ref={triggerRef} type="button" onClick={open} disabled={otherPending} className={secondaryBtn}>
                {triggerLabel}
              </button>
              {otherPending && <p className="text-xs text-muted">等進行中的 AI 任務完成，再看示範。</p>}
            </div>
          )
        )}
      </div>
    </AnalysisSection>
  );
}
