/**
 * 讀一支 GET API 的小 hook（帳號、AI 申請與後台頁共用）：載入中、錯誤、重新載入，以及就地更新資料。
 *
 * 回應先經型別守衛檢查；形狀不對（後端還沒做完、代理回了別的東西）當成 not_implemented，
 * 畫面顯示「這個功能還在建置中」而不是印出 undefined 或丟例外。
 * 重新載入時保留上一份資料（不閃白），錯誤只出現在那一區，旁邊的區塊照常可用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, apiGet, type ApiPath } from '../../lib/api';

export interface ApiData<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  /** 就地更新（例如後台操作後改一個欄位），不重新打 API。 */
  setData: (update: (prev: T | null) => T | null) => void;
}

export function useApiData<T>(path: ApiPath | null, guard: (value: unknown) => value is T): ApiData<T> {
  const guardRef = useRef(guard);
  guardRef.current = guard;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    loading: path !== null,
  });

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, error: null, loading: true }));
    apiGet(path, { signal: controller.signal })
      .then((body) => {
        if (!guardRef.current(body)) throw new ApiRequestError(200, 'not_implemented', `回應格式不符：${path}`);
        if (!controller.signal.aborted) setState({ data: body, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error, loading: false }));
      });
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setData = useCallback((update: (prev: T | null) => T | null) => setState((s) => ({ ...s, data: update(s.data) })), []);
  return { ...state, reload, setData };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
