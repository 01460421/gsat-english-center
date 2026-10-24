/**
 * 我的範文（docs/design/model-essays.md §1.9）：GET /api/exemplars（新到舊，每頁 20；「再載入 20 筆」接續 next_cursor）。
 * 每列：標題（連到結果頁）、來源、日期、狀態（產生中／完成／沒有完成）、「0 點（共用）」標記、刪除。
 * 刪除用 ConfirmButton；產生中的不能刪（409「範文產生中，完成後再刪」），按鈕停用。刪除只刪自己的那一列，共用範文不受影響。
 * 桌機（≥ lg）是表格（DataTable，useMediaQuery 二選一，R3）；手機是一列列的卡片。開關關著（唯讀模式）時照常列出與刪除。
 * 只在已登入時顯示（呼叫端判斷）。
 */
import type { ExemplarSetStatus, ExemplarSetSummary } from '@gsat/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DataTable, type Column } from '../../../../components/desktop/DataTable';
import { useIsDesktop } from '../../../../lib/media';
import { ConfirmButton, ErrorMessage, card, secondaryButton } from '../../components/ui';
import type { ErrorView } from '../../lib/errors';
import { formatUnixTime, formatUnixTimeShort } from '../../lib/format';
import { EXEMPLARS_PATH, SOURCE_LABELS } from '../labels';
import { useExemplarErrorView } from '../lib/errors';
import { deleteExemplarSet, listExemplarSets } from '../lib/exemplarsApi';

export const SET_STATUS_LABELS: Record<ExemplarSetStatus, string> = { queued: '產生中', running: '產生中', done: '完成', failed: '沒有完成' };

const pending = (s: ExemplarSetSummary) => s.status === 'queued' || s.status === 'running';
const setHref = (id: string) => `${EXEMPLARS_PATH}/${encodeURIComponent(id)}`;

function SharedBadge() {
  return <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold">0 點（共用）</span>;
}

function DeleteButton({ set, onDelete, busy }: { set: ExemplarSetSummary; onDelete: (id: string) => void; busy: boolean }) {
  return (
    <ConfirmButton
      label="刪除"
      question={`確定要刪除「${set.title}」這一組範文嗎？`}
      confirmLabel="確定刪除"
      onConfirm={() => onDelete(set.id)}
      disabled={busy || pending(set)}
    />
  );
}

export function ExemplarHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const isDesktop = useIsDesktop();
  const errorView = useExemplarErrorView();
  const [items, setItems] = useState<ExemplarSetSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    listExemplarSets({ signal: controller.signal }).then(
      (r) => {
        setItems(r.sets);
        setCursor(r.next_cursor);
        setLoaded(true);
        setLoading(false);
        setError(null);
      },
      async (err: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(await errorView(err));
      },
    );
    return () => controller.abort();
  }, [refreshKey]);

  const more = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const r = await listExemplarSets({ cursor });
      setItems((prev) => [...prev, ...r.sets.filter((s) => !prev.some((p) => p.id === s.id))]);
      setCursor(r.next_cursor);
      setError(null);
    } catch (err) {
      setError(await errorView(err));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteExemplarSet(id);
      setItems((prev) => prev.filter((s) => s.id !== id));
      setStatus('已刪除這一組範文。');
    } catch (err) {
      setError(await errorView(err, { deleting: true }));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ExemplarSetSummary>[] = [
    { id: 'title', header: '題目', cell: (s) => (s.cache_hit ? <span className="ml-2 align-middle"><SharedBadge /></span> : null) },
    { id: 'source', header: '來源', cell: (s) => SOURCE_LABELS[s.source] },
    { id: 'status', header: '狀態', cell: (s) => SET_STATUS_LABELS[s.status] },
    { id: 'created', header: '建立時間', cell: (s) => <span className="whitespace-nowrap">{formatUnixTimeShort(s.created_at)}</span>, sortValue: (s) => s.created_at },
    { id: 'actions', header: '動作', srOnlyHeader: true, cell: (s) => <DeleteButton set={s} onDelete={(id) => void remove(id)} busy={busy} /> },
  ];

  return (
    <section aria-labelledby="exemplar-history-h" className={`space-y-3 ${card}`}>
      <h2 id="exemplar-history-h" className="text-lg font-semibold">
        我的範文
      </h2>
      <p className="text-sm text-muted">最後一次更新後 180 天自動刪除，也可以自己刪除（產生中的要等完成）。</p>
      {error && <ErrorMessage view={error} />}
      <p role="status" className="sr-only">
        {status}
      </p>
      {!loaded && loading ? (
        <p className="text-sm text-muted">讀取中…</p>
      ) : loaded && items.length === 0 ? (
        <p className="text-sm text-muted">還沒有範文。選一個題目，產生第一組吧。</p>
      ) : isDesktop ? (
        <DataTable
          caption="我的範文"
          captionSrOnly
          columns={columns}
          rows={items}
          rowKey={(s) => s.id}
          primaryLink={(s) => ({ to: setHref(s.id), label: s.title, title: s.title })}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-xl border border-line p-3">
              <Link to={setHref(s.id)} className="group flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{s.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    <span>
                      {SOURCE_LABELS[s.source]}・{SET_STATUS_LABELS[s.status]}・{formatUnixTime(s.created_at)}
                    </span>
                    {s.cache_hit && <SharedBadge />}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
              </Link>
              <DeleteButton set={s} onDelete={(id) => void remove(id)} busy={busy} />
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" className={secondaryButton} onClick={() => void more()} disabled={loading}>
          {loading ? '讀取中…' : '再載入 20 筆'}
        </button>
      )}
    </section>
  );
}
