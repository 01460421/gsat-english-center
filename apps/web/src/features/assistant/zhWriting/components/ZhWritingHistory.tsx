/**
 * 「我的國寫範文」（GET /api/assist/zh-exemplars；新到舊，每頁 20，「顯示更多」接續 next_cursor）：這個頁面建立的題目，加上
 * 學習助手裡已經有範文的國寫題目。每列：標題（連到結果頁）、來源、題型、狀態（產生中／N 篇示範／上一篇沒有完成）、日期。
 * 刪除在結果頁（同學習助手：一題連同它的示範一起刪）。開關關著（唯讀模式）時照常列出。手機與桌機同一個清單。
 * 只在已登入時顯示（呼叫端判斷）。空清單的說明只在能送出時（access 是 ready）邀請學生選題或貼上，其他狀態（暫停、還沒核准、
 * 待同意）只說還沒有；讀不到時伺服器說要先同意條款（consent_required）就整塊不顯示（頁面上方已經說明怎麼開通）。
 * 歷屆題目那一頁另外用 ?via=past 的清單標出每一題看過幾篇（同一個 hook，由頁面持有；不受第一頁 20 筆限制）。
 * reload()：送出一篇之後先重讀（萬一換頁沒有卸載這一頁，按「上一頁」回來時清單已經是「示範產生中」）。
 */
import type { ZhExemplarListItem } from '@gsat/shared';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ApiRequestError } from '../../../../lib/api';
import { card } from '../../../writing/components/ui';
import { formatUnixTime } from '../../../writing/lib/format';
import { secondaryBtn } from '../../components/parts';
import { listZhExemplars } from '../../lib/assistApi';
import { ZH_WRITING_COPY, ZH_WRITING_ORIGIN_LABELS, ZH_WRITING_SECTION_SHORT, zhWritingHref } from '../labels';
import { zhHistoryStatus, zhWritingDisplayTitle } from '../lib';

export interface ZhWritingHistoryState {
  items: ZhExemplarListItem[];
  /** hidden：伺服器說要先同意條款（consent_required），不顯示這一塊。 */
  status: 'idle' | 'loading' | 'ready' | 'error' | 'hidden';
  more: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  /** 重讀第一頁（送出一篇之後）。 */
  reload: () => void;
}

/** 讀「我的國寫範文」（enabled 是 false 時不打 API：沒登入）；via 'past' 只讀歷屆題目的案例。 */
export function useZhWritingHistory(enabled: boolean, via: 'past' | null = null): ZhWritingHistoryState {
  const [items, setItems] = useState<ZhExemplarListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ZhWritingHistoryState['status']>(enabled ? 'loading' : 'idle');
  const [loadingMore, setLoadingMore] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    // 重讀時不清掉舊的清單（不閃「讀取中」）。
    if (generation === 0) setStatus('loading');
    listZhExemplars({ via, signal: controller.signal }).then(
      (r) => {
        setItems(r.items);
        setCursor(r.next_cursor);
        setStatus('ready');
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setStatus(err instanceof ApiRequestError && err.code === 'consent_required' ? 'hidden' : 'error');
      },
    );
    return () => controller.abort();
  }, [enabled, via, generation]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await listZhExemplars({ cursor, via });
      setItems((prev) => [...prev, ...r.items.filter((i) => !prev.some((p) => p.case_id === i.case_id))]);
      setCursor(r.next_cursor);
    } catch {
      setStatus('error');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, via]);
  return { items, status, more: cursor !== null, loadingMore, loadMore, reload };
}

/** canStart：能不能送出新的範文（access 是 ready）；不能時空清單只說還沒有，不邀請學生選題或貼上。 */
export function ZhWritingHistory({ history, canStart }: { history: ZhWritingHistoryState; canStart: boolean }) {
  const id = useId();
  const { items, status } = history;
  if (status === 'hidden' || status === 'idle') return null;
  return (
    <section aria-labelledby={id} className={`space-y-3 ${card}`} data-testid="zh-writing-history">
      <h2 id={id} className="text-lg font-semibold">
        {ZH_WRITING_COPY.historyTitle}
      </h2>
      {status === 'error' && <p className="text-sm text-muted">{ZH_WRITING_COPY.historyFailed}</p>}
      {status === 'loading' && (
        <p role="status" className="text-sm text-muted">
          讀取中…
        </p>
      )}
      {status === 'ready' && items.length === 0 && <p className="text-sm text-muted">{canStart ? ZH_WRITING_COPY.historyEmpty : ZH_WRITING_COPY.historyEmptyReadOnly}</p>}
      {items.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {items.map((item) => {
            const st = zhHistoryStatus(item);
            return (
              <li key={item.case_id}>
                <Link to={zhWritingHref(item.case_id)} className="flex min-h-14 items-center gap-3 px-4 py-3 lg:hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium break-words">{zhWritingDisplayTitle(item.title)}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                      <span>{ZH_WRITING_ORIGIN_LABELS[item.origin]}</span>
                      {item.section && <span>{ZH_WRITING_SECTION_SHORT[item.section]}</span>}
                      <span className={st.tone === 'failed' ? 'text-bad' : st.tone === 'pending' ? 'font-medium text-fg' : undefined}>{st.text}</span>
                      <span>{formatUnixTime(item.updated_at)}</span>
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {history.more && status !== 'error' && (
        <button type="button" onClick={() => void history.loadMore()} disabled={history.loadingMore} className={secondaryBtn}>
          {history.loadingMore ? '讀取中…' : ZH_WRITING_COPY.historyMore}
        </button>
      )}
    </section>
  );
}
