/**
 * 後端連線狀態（首頁顯示）。呼叫 GET /api/health。
 *
 * 失敗時只顯示「後端未連線」，不把錯誤細節丟給學生：單字卡、歷屆題瀏覽這類功能之後會設計成離線也能用，
 * 後端掛掉不該讓整頁看起來壞掉。逾時設 8 秒：Worker 冷啟動通常不到 1 秒，超過這麼久多半是根本連不到。
 */
import type { HealthResponse } from '@gsat/shared';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fetchHealth } from '../lib/api';

const TIMEOUT_MS = 8000;

type State = { status: 'checking' } | { status: 'online'; health: HealthResponse } | { status: 'offline' };

export function BackendStatus() {
  const [state, setState] = useState<State>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // disposed：元件卸載（或 StrictMode 開發模式的第一次掛載被拆掉）時，不要再更新狀態，
    // 也不要把「我們自己取消的請求」誤判成後端未連線。
    let disposed = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetchHealth({ signal: controller.signal })
      .then((health) => {
        if (!disposed) setState({ status: 'online', health });
      })
      .catch(() => {
        if (!disposed) setState({ status: 'offline' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-line bg-surface px-3 py-1 text-sm"
    >
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${
          state.status === 'online' ? 'bg-ok' : state.status === 'offline' ? 'bg-bad' : 'animate-pulse bg-muted'
        }`}
      />
      {state.status === 'checking' && <span className="text-muted">正在檢查後端連線…</span>}
      {state.status === 'online' && (
        <span>
          後端已連線
          <span className="ml-1 text-muted">
            （{state.health.service} v{state.health.version}）
          </span>
        </span>
      )}
      {state.status === 'offline' && (
        <>
          <span>後端未連線</span>
          <span className="text-muted">需要帳號或 AI 的功能暫時無法使用</span>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1 rounded-full px-2 text-primary hover:bg-primary-soft"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            重新檢查
          </button>
        </>
      )}
    </div>
  );
}
