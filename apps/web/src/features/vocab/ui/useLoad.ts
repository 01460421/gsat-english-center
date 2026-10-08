/**
 * 載入資料的 hook：先同步查已載入的結果（peek），查不到才非同步載入；失敗時提供 retry。
 *
 * 不用 React 19 的 use()＋Suspense：use() 的錯誤要靠錯誤邊界接，頁面層的 RouteErrorBoundary 會把整頁換成
 * 「這個頁面載入失敗」；這裡希望錯誤只出現在單字庫或單字卡那一塊，旁邊的分頁照常可用，並且就地重試。
 */
import { useEffect, useEffectEvent, useState } from 'react';
import { forgetFailedLoads } from '../../../data/client';

export type LoadState<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: unknown };

export type LoadResult<T> = LoadState<T> & { retry: () => void };

/**
 * @param key  資料的識別字串；改變時重新載入。null 表示暫時不需要載入。
 * @param peek 同步查詢已載入的結果，沒有就回傳 undefined。
 * @param load 非同步載入（src/data 的載入函式本身有快取，重複呼叫不會重複下載）。
 */
export function useLoad<T>(key: string | null, peek: () => T | undefined, load: () => Promise<T>): LoadResult<T> {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; attempt: number; state: LoadState<T> } | null>(null);
  const runLoad = useEffectEvent(load);
  const peeked = key === null ? undefined : peek();
  const hasPeek = peeked !== undefined;

  useEffect(() => {
    if (key === null || hasPeek) return;
    // disposed：key 改變或元件卸載後才回來的結果不要套用，免得慢的舊請求蓋掉新的內容。
    let disposed = false;
    runLoad().then(
      (value) => {
        if (!disposed) setSettled({ key, attempt, state: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (!disposed) setSettled({ key, attempt, state: { status: 'error', error } });
      },
    );
    return () => {
      disposed = true;
    };
  }, [key, attempt, hasPeek]);

  // src/data 的快取會保留失敗的請求（避免 Suspense 重來時重抓），重試前要先清掉，下一次載入才會重新下載。
  const retry = () => {
    forgetFailedLoads();
    setAttempt((n) => n + 1);
  };
  if (peeked !== undefined) return { status: 'ready', value: peeked, retry };
  if (settled && settled.key === key && settled.attempt === attempt) return { ...settled.state, retry };
  return { status: 'loading', retry };
}
