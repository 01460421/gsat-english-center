/** 寫作頁的 React hooks：靜態資料、AI 額度、批改進度輪詢、草稿自動儲存。 */
import type { AiQuotaResponse, SubmissionDetail } from '@gsat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetFailedLoads } from '../../../data/client';
import { SubmissionPoller, type PollSnapshot } from './polling';
import { saveDraft } from './drafts';
import { getQuota, getSubmission } from './writingApi';

export type LoadState<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: unknown };

/**
 * 載入靜態資料（data.ts 的載入函式本身有快取）。不用 use()＋Suspense：錯誤只出現在資料那一塊，
 * 頁首與其他區塊照常顯示，並可以就地「再試一次」。
 */
export function useStaticData<T>(load: () => Promise<T>): LoadState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let disposed = false;
    setState({ status: 'loading' });
    loadRef.current().then(
      (value) => {
        if (!disposed) setState({ status: 'ready', value });
      },
      (error: unknown) => {
        if (!disposed) setState({ status: 'error', error });
      },
    );
    return () => {
      disposed = true;
    };
  }, [attempt]);
  const retry = useCallback(() => {
    forgetFailedLoads();
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry };
}

/**
 * GET /api/ai/quota（enabled 為 false 時不打）。失敗就當作沒有資料（額度只是資訊，不擋操作；
 * 真的不足時送出會收到 429 與中文原因）。
 */
export function useQuota(enabled: boolean): { quota: AiQuotaResponse | null; refresh: () => Promise<AiQuotaResponse | null> } {
  const [quota, setQuota] = useState<AiQuotaResponse | null>(null);
  const refresh = useCallback(async () => {
    try {
      const q = await getQuota();
      setQuota(q);
      return q;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getQuota(controller.signal).then(
      (q) => setQuota(q),
      () => {
        // 額度只是資訊：失敗（含 abort）就不顯示
      },
    );
    return () => controller.abort();
  }, [enabled]);
  return { quota, refresh };
}

/** 輪詢一份提交；id 為 null 時不動作。回傳目前的快照與控制函式。 */
export function useSubmissionPoller(id: string | null): {
  snapshot: PollSnapshot;
  restart: (detail?: SubmissionDetail) => void;
  accept: (detail: SubmissionDetail) => void;
} {
  const [snapshot, setSnapshot] = useState<PollSnapshot>({ phase: 'loading', detail: null, speed: 'fast', error: null });
  const pollerRef = useRef<SubmissionPoller | null>(null);
  useEffect(() => {
    if (id === null) return;
    const poller = new SubmissionPoller({
      load: (signal) => getSubmission(id, signal),
      onChange: setSnapshot,
    });
    pollerRef.current = poller;
    setSnapshot(poller.current);
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [id]);
  const restart = useCallback((detail?: SubmissionDetail) => pollerRef.current?.restart(detail), []);
  const accept = useCallback((detail: SubmissionDetail) => pollerRef.current?.accept(detail), []);
  return { snapshot, restart, accept };
}

/**
 * 按鈕展開一個面板（例如「自我檢核」）後，把面板捲進畫面並把焦點移到它的標題。
 * 手機上面板常常出現在可見範圍以下（被底部導覽列擋住），只看到按鈕文字變了，像是沒反應；
 * 讀屏使用者也需要知道內容出現在哪裡。只在 open 從 false 變成 true 時動作（第一次繪製不動）。
 */
export function useRevealOnOpen<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    const el = ref.current;
    if (!opened || !el) return;
    const heading = el.querySelector<HTMLElement>('h2, h3');
    const target = heading ?? el;
    if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  }, [open]);
  return ref;
}

/**
 * 草稿自動儲存：值改變後 600 ms 寫進 localStorage（打字時不必每個字都寫）；還沒寫的變更在下面這些時候立刻寫入：
 *   - 元件卸載（站內換頁）；
 *   - pagehide（重新整理、關分頁、點「用 Google 登入」整頁跳轉）與 visibilitychange → hidden（手機切到別的 App，
 *     分頁之後可能被系統回收、不會再有任何事件）。這些情況 React 都不會卸載元件。
 * ok 為 false 表示最近一次寫入失敗（無痕模式、容量滿），畫面提示「草稿無法儲存」。
 * discard()：丟掉還沒寫入的變更（例如確認送出、清掉草稿之後，不要在離開頁面時又寫回去）。
 */
export function useAutosave(key: string | null, value: unknown, enabled = true): { ok: boolean; discard: () => void } {
  const [ok, setOk] = useState(true);
  const first = useRef(true);
  const pending = useRef<{ key: string; value: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (key === null || !enabled) return;
    // 第一次繪製時的值就是剛讀出來的草稿，不必馬上寫回。
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = { key, value };
    timer.current = setTimeout(() => {
      timer.current = null;
      pending.current = null;
      setOk(saveDraft(key, value));
    }, 600);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [key, value, enabled]);
  useEffect(() => {
    /** 把還沒寫入的變更立刻寫進去（回傳是否成功；沒有待寫的回 null）。 */
    const flush = (): boolean | null => {
      const p = pending.current;
      if (!p) return null;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      pending.current = null;
      return saveDraft(p.key, p.value);
    };
    const onPageHide = () => {
      const result = flush();
      if (result !== null) setOk(result);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onPageHide();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);
  const discard = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }, []);
  return { ok, discard };
}
