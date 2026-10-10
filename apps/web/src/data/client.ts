/**
 * 前端靜態資料的共用載入層。
 *
 * 資料檔在 public/data/，由 scripts/build-data.mjs 在 predev／prebuild 時從 repo 的 data/ 產生（不進版控），
 * 部署後是網站上的一般靜態檔：/data/meta.json、/data/vocab/…、/data/exams/…、/data/bank/…。
 *
 * 為什麼自己寫而不用 SWR、React Query：資料是建置時產生的唯讀檔案，不需要背景重新驗證、輪詢或寫回，
 * 「同一個檔案只抓一次、失敗可以重試」就夠了，不值得多一個套件。
 *
 * 快取的是 Promise 而不是結果：
 *   - 兩個元件同時要同一個檔案，只會發出一次請求；
 *   - 同一個檔案永遠拿到同一個 Promise 物件，可以直接交給 React 19 的 use()，搭配 <Suspense> 與錯誤邊界；
 *   - 失敗的 Promise 也留在快取裡，直到使用者按「再試一次」（呼叫 forgetFailedLoads()）才移除、重新請求。
 *
 * 為什麼失敗不自動移除：React 在 Suspense 裡會丟掉「還沒 commit 的那次繪製」再重來（例如 fallback 的節流期間
 * 請求就失敗了），元件的 useMemo／useState 也一起丟掉。若快取在失敗時自動移除，重來的那次繪製會拿到新的請求、
 * 又失敗、又重來——正式版實測考卷不存在時，畫面出現「找不到」之前就打了二十幾次 404（離線時更久）。
 * 只有使用者明確要求重試才重新請求，才不會出現這種迴圈。
 *
 * 不提供 AbortSignal：多個元件共用同一個請求，其中一個卸載就把請求取消，會讓其他元件一起失敗。
 * 元件卸載後不想處理結果，自己在 effect 的清理函式裡設旗標忽略即可。
 */

/** 資料檔的網址前綴。跟著 Vite 的 base 走，之後若部署在子路徑也不用改程式。 */
export const DATA_BASE_URL = `${import.meta.env.BASE_URL}data/`;

/**
 * 失敗原因：
 *   network    連不上（離線、DNS、CORS）
 *   not_found  檔案不存在（404，或伺服器用 SPA 的 index.html 頂替）
 *   http       其他 HTTP 錯誤（5xx 等）
 *   format     回應不是預期的 JSON 格式（檔案壞掉、版本不符）
 */
export type DataErrorKind = 'network' | 'not_found' | 'http' | 'format';

const ERROR_MESSAGES: Record<DataErrorKind, string> = {
  network: '無法連線，請檢查網路後再試一次。',
  not_found: '找不到資料檔，可能是網站剛更新，請重新整理頁面。',
  http: '資料載入失敗，請稍後再試。',
  format: '資料格式不正確，請重新整理頁面；如果問題持續，請回報給我們。',
};

/** 資料載入失敗。message 是可以直接顯示給學生的繁體中文說明。 */
export class DataLoadError extends Error {
  readonly kind: DataErrorKind;
  /** 請求的網址（除錯用，不必顯示給學生）。 */
  readonly url: string;
  /** HTTP 狀態碼；連線失敗時是 null。 */
  readonly status: number | null;

  constructor(kind: DataErrorKind, url: string, status: number | null, options?: { cause?: unknown }) {
    super(ERROR_MESSAGES[kind], options);
    this.name = 'DataLoadError';
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

/** 把任何錯誤轉成可以顯示的訊息：DataLoadError 用它自己的說明，其他（程式錯誤）給通用訊息。 */
export function dataErrorMessage(error: unknown): string {
  return error instanceof DataLoadError ? error.message : '發生未預期的錯誤，請重新整理頁面。';
}

/** @internal 讓各資料模組寫型別守衛時共用。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 抓一個資料檔並用型別守衛檢查。守衛只檢查最上層（版本字串、陣列在不在）：
 * 深層的欄位形狀已經由 scripts/build-data.mjs 在建置時逐筆檢查過，前端再檢查一次只是浪費時間。
 * 守衛擋下的主要是「拿到別的東西」：舊版快取、SPA fallback 的 HTML、被截斷的檔案。
 */
export async function fetchDataFile<T>(path: string, isValid: (body: unknown) => body is T): Promise<T> {
  const url = `${DATA_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new DataLoadError('network', url, null, { cause });
  }
  if (res.status === 404) throw new DataLoadError('not_found', url, 404);
  if (!res.ok) throw new DataLoadError('http', url, res.status);
  // 找不到的檔案在 Vite 開發伺服器（與沒有排除 /data/ 的 SPA rewrite）會回 200＋index.html，
  // 不先擋掉的話會變成難懂的 JSON 解析錯誤。
  if ((res.headers.get('Content-Type') ?? '').includes('text/html')) throw new DataLoadError('not_found', url, res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new DataLoadError('format', url, res.status, { cause });
  }
  if (!isValid(body)) throw new DataLoadError('format', url, res.status);
  return body;
}

/** 每個 memoizeAsync 快取的清除操作；用閉包登記，各快取的型別參數才不必在這裡轉型。 */
const caches = new Set<{ clear: () => void; forgetFailed: () => void }>();

/**
 * 把「依 key 載入」的函式包成有記憶體快取的版本：同一個 key 回傳同一個 Promise（成功或失敗都是），
 * 失敗的要等 forgetFailedLoads() 才會重新請求（理由見檔頭）。
 */
export function memoizeAsync<K, T>(load: (key: K) => Promise<T>): (key: K) => Promise<T> {
  const cache = new Map<K, { promise: Promise<T>; failed: boolean }>();
  caches.add({
    clear: () => cache.clear(),
    forgetFailed: () => {
      for (const [key, entry] of cache) if (entry.failed) cache.delete(key);
    },
  });
  return (key: K) => {
    const hit = cache.get(key);
    if (hit) return hit.promise;
    const promise = load(key);
    const entry = { promise, failed: false };
    cache.set(key, entry);
    promise.catch(() => {
      entry.failed = true;
    });
    return promise;
  };
}

/**
 * 「再試一次」按鈕呼叫：移除所有失敗的請求，下一次載入會重新下載。成功的快取不受影響。
 * 一次清全部而不是只清某個檔案：失敗通常是離線造成的，恢復連線後其他失敗的檔案也該一起重抓。
 */
export function forgetFailedLoads(): void {
  for (const cache of caches) cache.forgetFailed();
}

/** 清空所有資料快取。測試用；之後若做「重新下載資料」按鈕也可以呼叫。 */
export function clearDataCache(): void {
  for (const cache of caches) cache.clear();
}

// ---------------------------------------------------------------------------
// meta.json
// ---------------------------------------------------------------------------

/** /data/meta.json：資料版本與統計。 */
export interface DataMeta {
  /** 輸入資料＋建置腳本的內容雜湊（12 碼十六進位）。資料或格式有任何變動就會改變。 */
  version: string;
  /** 產生時間（ISO 8601，UTC）。 */
  generated_at: string;
  /** 建置時的 git commit 短雜湊；取不到時是 null。注意本機可能有尚未 commit 的資料，以 version 為準。 */
  git_commit: string | null;
  /** 試題檔的格式版本。 */
  exam_schema: 'gsat-exam/v1.1';
  counts: {
    vocab: number;
    vocab_by_level: Record<'1' | '2' | '3' | '4' | '5' | '6', number>;
    exams: number;
    questions: number;
    /** 題庫練習的 AI 題組數（/data/bank/index.json）；題庫還沒有通過驗證的題組時是 0。 */
    bank_groups: number;
    /** 本站仿真中譯英與作文的題組數（/data/writing/bank/index.json）。 */
    writing_bank_groups: number;
  };
  /** 每個輸出檔（相對 /data/）的大小；gzip_bytes 是 gzip -9 的估計值，實際傳輸由 Vercel 壓縮。 */
  files: Record<string, { bytes: number; gzip_bytes: number }>;
}

function isDataMeta(body: unknown): body is DataMeta {
  return isRecord(body) && typeof body.version === 'string' && isRecord(body.counts);
}

const metaLoader = memoizeAsync((_key: 'meta') => fetchDataFile('meta.json', isDataMeta));

/** 讀取 /data/meta.json。 */
export function loadDataMeta(): Promise<DataMeta> {
  return metaLoader('meta');
}
