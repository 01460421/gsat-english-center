/**
 * /auth/probe（ARCHITECTURE §4.3）：只在過渡期（PUBLIC_API_ORIGIN＝APP_ORIGIN）開啟；兩個測試 cookie 各自一個 Set-Cookie、
 * 讀得回來；POST 只回位元組數；delay 的範圍檢查；寫入仍要過 Origin 檢查。負責：整合者。
 * 不碰資料庫：DB 給空物件，真的被呼叫時會直接丟錯。
 */
import { describe, expect, it, vi } from 'vitest';
import { app } from '../src/app';
import { PROBE_COOKIES, PROBE_MAX_BODY_BYTES } from '../src/auth/probe';
import type { Env } from '../src/env';

const ORIGIN = 'https://gsat.example';
const transitional: Env = { DB: {} as D1Database, ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN };

function probe(path: string, init: RequestInit = {}, env: Env = transitional) {
  return app.request(`/auth/probe${path}`, init, env);
}

describe('/auth/probe', () => {
  it('正式期（PUBLIC_API_ORIGIN 是 api.<網域>）與 APP_ORIGIN 沒設時一律 404', async () => {
    const custom = await probe('', {}, { ...transitional, APP_ORIGIN: 'https://gsat.example', PUBLIC_API_ORIGIN: 'https://api.gsat.example' });
    expect(custom.status).toBe(404);
    expect(((await custom.json()) as { error: { code: string } }).error.code).toBe('not_found');
    const unset = await probe('?set=1', {}, { DB: {} as D1Database, ALLOWED_ORIGINS: ORIGIN });
    expect(unset.status).toBe(404);
    expect(unset.headers.getSetCookie()).toEqual([]);
  });

  it('?set=1 種兩個 __Host- cookie（各一個 Set-Cookie），下一個請求讀得回來；?clear=1 清掉', async () => {
    const set = await probe('?set=1');
    expect(set.status).toBe(200);
    expect(set.headers.get('cache-control')).toBe('no-store');
    const cookies = set.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const [i, { name, value }] of PROBE_COOKIES.entries()) {
      expect(cookies[i]).toContain(`${name}=${value}`);
      expect(cookies[i]).toMatch(/HttpOnly/);
      expect(cookies[i]).toMatch(/Secure/);
      expect(cookies[i]).toMatch(/SameSite=Lax/);
      expect(cookies[i]).toMatch(/Path=\//);
    }
    const jar = cookies.map((c) => c.split(';')[0]).join('; ');
    const read = await probe('', { headers: { Cookie: jar } });
    expect(await read.json()).toEqual({ probe: true, cookies: { a: true, b: true } });
    const none = await probe('');
    expect(await none.json()).toEqual({ probe: true, cookies: { a: false, b: false } });
    const clear = await probe('?clear=1');
    expect(clear.headers.getSetCookie().every((c) => /Max-Age=0/.test(c))).toBe(true);
  });

  it('?delay 只收 1–60 的整數；合法時等那麼久才回', async () => {
    for (const bad of ['0', '61', '1.5', 'abc']) {
      expect((await probe(`?delay=${bad}`)).status).toBe(400);
    }
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = Promise.resolve(probe('?delay=30')).then((res) => {
        settled = true;
        return res;
      });
      await vi.advanceTimersByTimeAsync(29_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      const res = await pending;
      expect(await res.json()).toEqual({ probe: true, delayed_seconds: 30 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('POST 只回本體的位元組數；超過上限 413；沒有 Origin 的寫入照樣 403', async () => {
    const body = new Uint8Array(1_250_000).fill(7);
    const ok = await probe('', { method: 'POST', headers: { Origin: ORIGIN }, body });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ probe: true, bytes: 1_250_000 });
    const big = await probe('', { method: 'POST', headers: { Origin: ORIGIN }, body: new Uint8Array(PROBE_MAX_BODY_BYTES + 1) });
    expect(big.status).toBe(413);
    const noOrigin = await probe('', { method: 'POST', body });
    expect(noOrigin.status).toBe(403);
  });
});
