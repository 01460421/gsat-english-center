/**
 * Worker 的請求層測試：直接呼叫 app.request()，不需要 wrangler。
 * 重點是安全相關行為（CORS 允許／拒絕、非 GET 的 Origin 檢查），這些一旦退化不會有任何畫面上的徵兆，
 * 所以每個 PR 都要跑（Sekai 的安全測試只在部署時跑，見 05 文件 §3.5 第 6 點）。
 */
import { isApiErrorBody, type HealthResponse } from '@gsat/shared';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import type { AppEnv, Env } from '../src/env';
import { ApiError, handleError, handleNotFound } from '../src/errors';
import { app, SERVICE_NAME } from '../src/app';
import { isAllowedOrigin, parseAllowedOrigins } from '../src/security';

const ALLOWED = 'http://localhost:5173';
const EVIL = 'https://evil.example';

// 這些測試不碰資料庫；D1 綁定給一個空物件即可，真的被呼叫時會直接丟錯，不會默默通過。
const env: Env = {
  DB: {} as D1Database,
  ALLOWED_ORIGINS: ` ${ALLOWED} , https://gsat.example/ ,`,
};

/** app.request 的預設網址是 http://localhost/…，所以 Worker 自己的 origin 是 http://localhost。 */
const SELF = 'http://localhost';

function request(path: string, init: RequestInit = {}) {
  return app.request(path, init, env);
}

describe('GET /api/health', () => {
  it('回傳服務狀態', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.service).toBe(SERVICE_NAME);
    expect(body.version).toBe(pkg.version);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('API 回應不可被快取', async () => {
    const res = await request('/api/health');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('CORS', () => {
  it('允許清單內的 origin：回具體的 Allow-Origin 並允許 credentials', async () => {
    const res = await request('/api/health', { headers: { Origin: ALLOWED } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toMatch(/Origin/);
  });

  it('設定值結尾的斜線與空白不影響比對', async () => {
    const res = await request('/api/health', { headers: { Origin: 'https://gsat.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://gsat.example');
  });

  it('不在清單內的 origin：不發 Allow-Origin（由瀏覽器擋下）', async () => {
    const res = await request('/api/health', { headers: { Origin: EVIL } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    // 被拒的回應也要 Vary: Origin，CDN 才不會把「沒有 Allow-Origin」的版本快取給允許的來源。
    expect(res.headers.get('vary')).toMatch(/Origin/);
  });

  it('不接受前綴或子字串相似的 origin', async () => {
    for (const origin of ['http://localhost:5173.evil.example', 'http://localhost:51733', 'https://gsat.example.evil']) {
      const res = await request('/api/health', { headers: { Origin: origin } });
      expect(res.headers.get('access-control-allow-origin'), origin).toBeNull();
    }
  });

  it('preflight（允許的 origin）：204 並列出允許的方法', async () => {
    const res = await request('/api/anything', {
      method: 'OPTIONS',
      headers: { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('preflight（不允許的 origin）：沒有 Allow-Origin', async () => {
    const res = await request('/api/anything', {
      method: 'OPTIONS',
      headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('非 GET 請求的 Origin 檢查', () => {
  async function expectBadOrigin(res: Response) {
    expect(res.status).toBe(403);
    const body: unknown = await res.json();
    expect(isApiErrorBody(body)).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('bad_origin');
  }

  it('沒有 Origin 的 POST 被拒絕', async () => {
    await expectBadOrigin(await request('/api/health', { method: 'POST' }));
  });

  it('不在清單內的 Origin 被拒絕（PUT／PATCH／DELETE 也一樣）', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await expectBadOrigin(await request('/api/health', { method, headers: { Origin: EVIL } }));
    }
  });

  it('允許的 Origin 通過檢查（此路徑沒有 POST 路由，所以接著是 404），且錯誤回應也帶 CORS 標頭', async () => {
    const res = await request('/api/health', { method: 'POST', headers: { Origin: ALLOWED } });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    const body: unknown = await res.json();
    expect(isApiErrorBody(body) && body.error.code).toBe('not_found');
  });

  it('Worker 自己的 origin 通過檢查', async () => {
    const res = await request('/api/health', { method: 'POST', headers: { Origin: SELF } });
    expect(res.status).toBe(404);
  });

  it('經 Vite proxy 的同源請求：Host 不變，即使 localhost 不在允許清單也放行', async () => {
    // vite.config.ts 用 changeOrigin: false，Worker 看到的網址就是瀏覽器的網址；
    // wrangler.toml 因此不必（也不應該）把 localhost 列進正式環境的 ALLOWED_ORIGINS。
    const res = await app.request(
      'http://localhost:5173/api/health',
      { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
      { ...env, ALLOWED_ORIGINS: 'https://gsat.example' },
    );
    expect(res.status).toBe(404);
    // 同一個 localhost 頁面直連另一個 port 的 Worker 就是跨來源，照樣擋下。
    await expectBadOrigin(
      await app.request(
        'http://127.0.0.1:8787/api/health',
        { method: 'POST', headers: { Origin: 'http://localhost:5173' } },
        { ...env, ALLOWED_ORIGINS: 'https://gsat.example' },
      ),
    );
  });

  it('GET 不檢查 Origin（唯讀請求不改變狀態）', async () => {
    const res = await request('/api/health', { headers: { Origin: EVIL } });
    expect(res.status).toBe(200);
  });
});

describe('錯誤格式', () => {
  it('未知路徑回 JSON 404', async () => {
    const res = await request('/api/no-such-route');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body: unknown = await res.json();
    expect(isApiErrorBody(body)).toBe(true);
  });

  // 用一個只掛錯誤處理器的小 app 模擬路由丟錯，避免為了測試在正式 app 上加假路由。
  const errorApp = new Hono<AppEnv>();
  errorApp.get('/expected', () => {
    throw new ApiError(400, 'bad_request', '缺少欄位 word');
  });
  errorApp.get('/unexpected', () => {
    throw new Error('資料庫密碼是 hunter2');
  });
  errorApp.notFound(handleNotFound);
  errorApp.onError(handleError);

  it('ApiError 依指定的狀態碼與代碼回報', async () => {
    const res = await errorApp.request('/expected', {}, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'bad_request', message: '缺少欄位 word' } });
  });

  it('未預期的錯誤只回固定訊息，不回顯內部細節', async () => {
    const original = console.error;
    console.error = () => {}; // 這個測試預期會寫錯誤 log，避免污染測試輸出
    try {
      const res = await errorApp.request('/unexpected', {}, env);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain('hunter2');
      expect(JSON.parse(text)).toMatchObject({ error: { code: 'internal_error' } });
    } finally {
      console.error = original;
    }
  });
});

describe('Worker 入口', () => {
  it('主模組只有 default export（其他具名匯出會被 workerd 當成入口點而啟動失敗）', async () => {
    const mod = await import('../src/index');
    expect(Object.keys(mod)).toEqual(['default']);
    expect(mod.default).toBe(app);
  });
});

describe('ALLOWED_ORIGINS 解析', () => {
  it('去空白、去結尾斜線、略過空項目', () => {
    expect(parseAllowedOrigins(' a , b/ ,, ')).toEqual(['a', 'b']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });

  it('空值與未設定都不放行', () => {
    expect(isAllowedOrigin(undefined, env)).toBe(false);
    expect(isAllowedOrigin('', env)).toBe(false);
    expect(isAllowedOrigin(ALLOWED, { ALLOWED_ORIGINS: '' })).toBe(false);
  });
});
