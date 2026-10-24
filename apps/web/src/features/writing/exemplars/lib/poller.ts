/**
 * 結果頁的輪詢（docs/design/model-essays.md §1.7）：GET /api/exemplars/:id，狀態是 queued／running 就繼續問。
 * 用寫作批改同一個泛型 Poller<T>（每 2 秒，3 分鐘後每 15 秒）；分頁看不到時暫停，回來時立刻問一次（同學習助手的 pollers.ts）。
 */
import type { ExemplarSetDetail } from '@gsat/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Poller, type PollSnapshot } from '../../lib/polling';
import { getExemplarSet } from './exemplarsApi';

export function isExemplarSetPending(detail: ExemplarSetDetail): boolean {
  return detail.status === 'queued' || detail.status === 'running';
}

export interface ExemplarPoller {
  snapshot: PollSnapshot<ExemplarSetDetail>;
  /** 重新開始（手動「再試一次」）。 */
  restart: (detail?: ExemplarSetDetail) => void;
  /** 直接套用剛從其他請求拿到的最新內容（PATCH 的回應），需要時接著輪詢。 */
  accept: (detail: ExemplarSetDetail) => void;
}

export function useExemplarPoller(id: string | null, initial: ExemplarSetDetail | null = null): ExemplarPoller {
  const [snapshot, setSnapshot] = useState<PollSnapshot<ExemplarSetDetail>>({ phase: 'loading', detail: initial, speed: 'fast', error: null });
  const pollerRef = useRef<Poller<ExemplarSetDetail> | null>(null);
  useEffect(() => {
    if (id === null) return;
    const poller = new Poller<ExemplarSetDetail>({
      load: (signal) => getExemplarSet(id, signal),
      isPending: isExemplarSetPending,
      onChange: setSnapshot,
    });
    pollerRef.current = poller;
    // 建立時已經拿到完成的那一組（共用快取命中、自己之前產生過）：直接顯示，不必再問一次。
    if (initial && initial.id === id && !isExemplarSetPending(initial)) poller.accept(initial);
    else {
      setSnapshot(poller.current);
      poller.start();
    }
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
    // 只依 id 重新開始（initial 只在第一次用）。
  }, [id]);
  const restart = useCallback((detail?: ExemplarSetDetail) => pollerRef.current?.restart(detail), []);
  const accept = useCallback((detail: ExemplarSetDetail) => pollerRef.current?.accept(detail), []);
  return { snapshot, restart, accept };
}
