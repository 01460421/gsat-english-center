/**
 * 「我的國寫範文」（GET /api/assist/zh-exemplars；新到舊，每頁 20，「顯示更多」接續 next_cursor）：這個頁面建立的題目，加上
 * 學習助手裡已經有範文的國寫題目。每列：標題（連到結果頁）、來源、題型、狀態（產生中／N 篇示範／上一篇沒有完成）、日期。
 * 刪除在結果頁（同學習助手：一題連同它的示範一起刪）。開關關著（唯讀模式）時照常列出。手機與桌機同一個清單。
 * 只在已登入時顯示（呼叫端判斷）。歷屆題目那一頁也用同一份資料標出「你看過 N 篇」（useZhWritingHistory 由頁面持有）。
 */
import type { ZhExemplarListItem } from '@gsat/shared';
import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { card } from '../../../writing/components/ui';
import { formatUnixTime } from '../../../writing/lib/format';
import { secondaryBtn } from '../../components/parts';
import { listZhExemplars } from '../../lib/assistApi';
import { ZH_WRITING_COPY, ZH_WRITING_ORIGIN_LABELS, ZH_WRITING_SECTION_SHORT, zhWritingHref } from '../labels';
import { zhHistoryStatus, zhWritingDisplayTitle } from '../lib';

export interface ZhWritingHistoryState {
  items: ZhExemplarListItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  more: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
}

/** 讀「我的國寫範文」（enabled 是 false 時不打 API：沒登入）。 */
export function useZhWritingHistory(enabled: boolean): ZhWritingHistoryState {
  const [items, setItems] = useState<ZhExemplarListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ZhWritingHistoryState['status']>(enabled ? 'loading' : 'idle');
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    listZhExemplars({ signal: controller.signal }).then(
      (r) => {
        setItems(r.items);
        setCursor(r.next_cursor);
        setStatus('ready');
      },
      () => {
        if (!controller.signal.aborted) setStatus('error');
      },
    );
    return () => controller.abort();
  }, [enabled]);
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await listZhExemplars({ cursor });
      setItems((prev) => [...prev, ...r.items.filter((i) => !prev.some((p) => p.case_id === i.case_id))]);
      setCursor(r.next_cursor);
    } catch {
      setStatus('error');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);
  return { items, status, more: cursor !== null, loadingMore, loadMore };
}

export function ZhWritingHistory({ history }: { history: ZhWritingHistoryState }) {
  const id = useId();
  const { items, status } = history;
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
      {status === 'ready' && items.length === 0 && <p className="text-sm text-muted">{ZH_WRITING_COPY.historyEmpty}</p>}
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
