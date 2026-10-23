/**
 * 學習助手的輪詢與錯誤 hooks（docs/design/learning-assistant.md §5.7）。
 *
 *   useAssistCasePoller(id)   GET /api/assist/cases/{id}：只有 pending 不是 null（有排隊中或處理中的 AI 任務）時繼續問；
 *                             用寫作批改同一個泛型 Poller<T>（每 2 秒，3 分鐘後每 15 秒）。分頁看不到時暫停，回來時立刻問一次。
 *   useAssistReportPoller(id) GET /api/assist/reports/{id}：status 是 queued／running 時繼續問（同一個 Poller<T>，WP-C）。
 *   useAssistErrorView()      async (err) => ErrorView：學習助手的代碼依 reason 細分，其他（同意、登入、額度）沿用寫作頁的處理
 *                             （consent_required 先重新讀 /api/me，決定帶去歡迎頁還是 /ai/apply）。
 */
import type { AssistCaseDetail, AssistReportDetail } from '@gsat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Poller, type PollSnapshot } from '../../writing/lib/polling';
import { useErrorView } from '../../writing/lib/useErrorView';
import type { DescribeContext, ErrorView } from '../../writing/lib/errors';
import { getAssistCase, getAssistReport } from './assistApi';
import { assistErrorMessage } from './errors';

export function isAssistCasePending(detail: AssistCaseDetail): boolean {
  return detail.pending !== null;
}

export function isAssistReportPending(detail: AssistReportDetail): boolean {
  return detail.status === 'queued' || detail.status === 'running';
}

export interface AssistCasePoller {
  snapshot: PollSnapshot<AssistCaseDetail>;
  /** 送出新的 AI 任務（或手動重試）之後：重設 3 分鐘的快速期。 */
  restart: (detail?: AssistCaseDetail) => void;
  /** 直接套用剛從其他請求拿到的最新內容（PATCH 的回應），需要時接著輪詢。 */
  accept: (detail: AssistCaseDetail) => void;
}

export function useAssistCasePoller(id: string | null): AssistCasePoller {
  return usePoller(id, getAssistCase, isAssistCasePending);
}

export interface AssistReportPoller {
  snapshot: PollSnapshot<AssistReportDetail>;
  restart: (detail?: AssistReportDetail) => void;
  accept: (detail: AssistReportDetail) => void;
}

/** 報告：約 1–2 分鐘（估計）；分頁看不到時同樣暫停。id 是 null 時不輪詢。 */
export function useAssistReportPoller(id: string | null): AssistReportPoller {
  return usePoller(id, getAssistReport, isAssistReportPending);
}

function usePoller<T>(id: string | null, load: (id: string, signal?: AbortSignal) => Promise<T>, isPending: (t: T) => boolean) {
  const [snapshot, setSnapshot] = useState<PollSnapshot<T>>({ phase: 'loading', detail: null, speed: 'fast', error: null });
  const pollerRef = useRef<Poller<T> | null>(null);
  useEffect(() => {
    if (id === null) return;
    const poller = new Poller<T>({
      load: (signal) => load(id, signal),
      isPending,
      onChange: setSnapshot,
    });
    pollerRef.current = poller;
    setSnapshot(poller.current);
    poller.start();
    // 分頁看不到時暫停（手機切到別的 App、桌機切分頁），回來時立刻問一次、重新算快速期。
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (poller.current.phase === 'polling') poller.stop();
      } else if (poller.current.phase === 'polling') {
        poller.start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
    // load、isPending 是模組層的函式（不會變），只依 id 重新開始。
  }, [id]);
  const restart = useCallback((detail?: T) => pollerRef.current?.restart(detail), []);
  const accept = useCallback((detail: T) => pollerRef.current?.accept(detail), []);
  return { snapshot, restart, accept };
}

/** 學習助手頁面的錯誤 → 畫面訊息（見檔頭）。deleting：刪除時的 409 寫「解析進行中，完成後再刪」。 */
export function useAssistErrorView(): (err: unknown, extra?: Pick<DescribeContext, 'quota' | 'submitting'> & { deleting?: boolean }) => Promise<ErrorView> {
  const errorView = useErrorView();
  return useCallback(
    async (err, extra = {}) => {
      const own = assistErrorMessage(err, { deleting: extra.deleting === true });
      if (own !== null) return { message: own };
      const { deleting: _deleting, ...rest } = extra;
      const view = await errorView(err, rest);
      if (view.action?.to === '/ai/apply' && view.action.label === '申請 AI 批改') return { ...view, action: { label: '申請使用 AI', to: '/ai/apply' } };
      return view;
    },
    [errorView],
  );
}
