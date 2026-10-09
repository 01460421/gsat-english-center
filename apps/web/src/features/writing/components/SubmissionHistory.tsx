/**
 * 我的寫作紀錄（GET /api/submissions?kind=&cursor=）：中譯英、作文兩個切換按鈕，「載入更多」接續 next_cursor。
 * 只在已登入時顯示（呼叫端判斷）；載入失敗只在這一區顯示訊息（登入過期時附「重新登入」），不影響頁面其他部分。
 * 分數是 AI 給的：旁邊標「AI」（完整的「AI 批改，僅供參考」給讀屏與滑鼠提示）。
 */
import { SUBMISSION_KINDS, TRANSLATION_GROUP_MAX, ESSAY_MAX_SCORE, type SubmissionKind, type SubmissionSummary } from '@gsat/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ErrorView } from '../lib/errors';
import { useErrorView } from '../lib/useErrorView';
import { KIND_LABELS, STATUS_LABELS, bandLabel, formatScore, formatUnixTime, groupLabel } from '../lib/format';
import { listSubmissions } from '../lib/writingApi';
import { AiBadge, ErrorMessage, card, secondaryButton } from './ui';

interface ListState {
  items: SubmissionSummary[];
  cursor: string | null;
  loading: boolean;
  error: ErrorView | null;
  loaded: boolean;
}

const EMPTY: ListState = { items: [], cursor: null, loading: true, error: null, loaded: false };

function Row({ s }: { s: SubmissionSummary }) {
  const max = s.kind === 'translation' ? TRANSLATION_GROUP_MAX : ESSAY_MAX_SCORE;
  return (
    <li>
      <Link to={`/writing/submissions/${encodeURIComponent(s.id)}`} className="group flex items-center gap-3 rounded-xl border border-line p-3 hover:border-primary">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 font-medium">
            {groupLabel(s.group_id)} {KIND_LABELS[s.kind]}
            {s.input_mode === 'photo' && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">手寫</span>}
          </span>
          <span className="block text-sm text-muted">
            {STATUS_LABELS[s.status]}・{formatUnixTime(s.updated_at)}
          </span>
        </span>
        {s.final_score !== null && (
          <span className="shrink-0 text-right tabular-nums">
            <span className="mr-1 align-middle">
              <AiBadge compact />
            </span>
            <span className="text-lg font-semibold">{formatScore(s.final_score)}</span>
            <span className="text-sm text-muted">／{max}</span>
            {s.final_band && <span className="block text-xs text-muted">{bandLabel(s.final_band)}</span>}
          </span>
        )}
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted group-hover:text-primary" />
      </Link>
    </li>
  );
}

export function SubmissionHistory() {
  const [kind, setKind] = useState<SubmissionKind>('translation');
  const [state, setState] = useState<ListState>(EMPTY);
  const errorView = useErrorView();
  const errorViewRef = useRef(errorView);
  errorViewRef.current = errorView;

  useEffect(() => {
    const controller = new AbortController();
    setState(EMPTY);
    listSubmissions(kind, null, controller.signal).then(
      (res) => setState({ items: res.submissions, cursor: res.next_cursor, loading: false, error: null, loaded: true }),
      async (err: unknown) => {
        if (controller.signal.aborted) return;
        const view = await errorViewRef.current(err);
        if (!controller.signal.aborted) setState({ ...EMPTY, loading: false, error: view, loaded: true });
      },
    );
    return () => controller.abort();
  }, [kind]);

  const loadMore = async () => {
    if (!state.cursor) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await listSubmissions(kind, state.cursor);
      setState((s) => ({ ...s, items: [...s.items, ...res.submissions], cursor: res.next_cursor, loading: false }));
    } catch (err) {
      const view = await errorView(err);
      setState((s) => ({ ...s, loading: false, error: view }));
    }
  };

  return (
    <section aria-labelledby="history-heading" className={card}>
      <h2 id="history-heading" className="text-lg font-semibold">
        我的寫作紀錄
      </h2>
      <div role="group" aria-label="紀錄種類" className="mt-3 flex flex-wrap gap-2">
        {SUBMISSION_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${kind === k ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {state.loaded && state.items.length === 0 && !state.error && (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">還沒有{KIND_LABELS[kind]}的紀錄。</p>
        )}
        {state.items.length > 0 && (
          <ul className="space-y-2">
            {state.items.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </ul>
        )}
        {state.error && (
          <div className="mt-2">
            <ErrorMessage view={state.error} />
          </div>
        )}
        {state.loading && (
          <p role="status" className="mt-2 text-sm text-muted">
            載入中…
          </p>
        )}
        {state.cursor && !state.loading && (
          <button type="button" onClick={loadMore} className={`mt-3 ${secondaryButton}`}>
            載入更多
          </button>
        )}
      </div>
    </section>
  );
}
