/**
 * 資料載入層的失敗路徑與快取行為。資料檔是建置時產生的靜態檔，最常見的問題不是「資料錯」，
 * 而是拿到別的東西：離線、部署後檔案不見（SPA fallback 回 index.html）、舊版快取。這些都要變成
 * 看得懂的 DataLoadError，而且失敗後可以重試。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache, DATA_BASE_URL, DataLoadError, dataErrorMessage, forgetFailedLoads, loadDataMeta } from './client';

const META = {
  version: 'abc123def456',
  generated_at: '2026-10-08T00:00:00.000Z',
  git_commit: null,
  exam_schema: 'gsat-exam/v1.1',
  counts: { vocab: 6012, vocab_by_level: { '1': 1002 }, exams: 66, questions: 3783 },
  files: {},
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function loadError(): Promise<DataLoadError> {
  const error: unknown = await loadDataMeta().then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof DataLoadError)) throw new Error('預期 DataLoadError');
  return error;
}

afterEach(() => {
  clearDataCache();
});

describe('loadDataMeta', () => {
  it('成功：回傳內容，網址是 /data/meta.json', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(META));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadDataMeta()).resolves.toMatchObject({ version: 'abc123def456' });
    expect(DATA_BASE_URL).toBe('/data/');
    expect(fetchMock).toHaveBeenCalledWith('/data/meta.json', expect.anything());
  });

  it('同時與之後的呼叫共用同一個 Promise，只發一次請求（可以直接交給 React 的 use()）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(META));
    vi.stubGlobal('fetch', fetchMock);
    const a = loadDataMeta();
    const b = loadDataMeta();
    expect(a).toBe(b);
    await a;
    expect(loadDataMeta()).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('網路錯誤：kind 為 network，訊息可以直接顯示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const error = await loadError();
    expect(error.kind).toBe('network');
    expect(error.status).toBeNull();
    expect(dataErrorMessage(error)).toBe('無法連線，請檢查網路後再試一次。');
  });

  it('404：kind 為 not_found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not Found', { status: 404 })));
    const error = await loadError();
    expect(error.kind).toBe('not_found');
    expect(error.status).toBe(404);
  });

  it('200 但回的是 SPA 的 index.html：當成找不到，而不是 JSON 解析錯誤', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'Content-Type': 'text/html' } })),
    );
    expect((await loadError()).kind).toBe('not_found');
  });

  it('5xx：kind 為 http 並保留狀態碼', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 503 })));
    const error = await loadError();
    expect(error.kind).toBe('http');
    expect(error.status).toBe(503);
  });

  it('內容不是 JSON，或形狀不對（例如舊版格式）：kind 為 format', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"version":', { status: 200, headers: { 'Content-Type': 'application/json' } })));
    expect((await loadError()).kind).toBe('format');
    clearDataCache();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ hello: 'world' })));
    expect((await loadError()).kind).toBe('format');
  });

  it('失敗的請求留在快取（Suspense 重來時不重抓），forgetFailedLoads() 之後才重新請求', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(META));
    vi.stubGlobal('fetch', fetchMock);
    const failed = loadDataMeta();
    await expect(failed).rejects.toBeInstanceOf(DataLoadError);
    // 同一個失敗的 Promise：交給 use() 時不會因為每次繪製拿到新的請求而無限重抓。
    expect(loadDataMeta()).toBe(failed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    forgetFailedLoads();
    await expect(loadDataMeta()).resolves.toMatchObject({ version: META.version });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('forgetFailedLoads() 不影響成功的快取', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(META));
    vi.stubGlobal('fetch', fetchMock);
    const ok = loadDataMeta();
    await ok;
    forgetFailedLoads();
    expect(loadDataMeta()).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('不是 DataLoadError 的錯誤給通用訊息', () => {
    expect(dataErrorMessage(new Error('bug'))).toBe('發生未預期的錯誤，請重新整理頁面。');
  });
});
