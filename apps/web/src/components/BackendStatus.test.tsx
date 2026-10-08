/**
 * 首頁的後端連線狀態。重點是失敗路徑：後端沒開、代理回錯誤頁、回應不是 JSON 時，
 * 都要優雅地顯示「後端未連線」，而不是丟例外或顯示 undefined。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BackendStatus } from './BackendStatus';

const HEALTH = { ok: true, service: 'gsat-english-api', version: '0.1.0', time: '2026-10-07T00:00:00.000Z' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('BackendStatus', () => {
  it('健康檢查成功：顯示已連線與服務版本', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(HEALTH));
    vi.stubGlobal('fetch', fetchMock);
    render(<BackendStatus />);
    expect(screen.getByText('正在檢查後端連線…')).toBeInTheDocument();
    expect(await screen.findByText('後端已連線')).toBeInTheDocument();
    expect(screen.getByText(/gsat-english-api v0\.1\.0/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'include' }));
  });

  it('連不到後端（網路錯誤）：顯示後端未連線', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    render(<BackendStatus />);
    expect(await screen.findByText('後端未連線')).toBeInTheDocument();
  });

  it('代理回 502 錯誤頁（HTML）：顯示後端未連線', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
    render(<BackendStatus />);
    expect(await screen.findByText('後端未連線')).toBeInTheDocument();
  });

  it('回應 200 但不是健康檢查格式（例如 SPA 的 index.html）：也算未連線', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><div id="root"></div>', { status: 200 })));
    render(<BackendStatus />);
    expect(await screen.findByText('後端未連線')).toBeInTheDocument();
  });

  it('按「重新檢查」會再打一次，成功後顯示已連線', async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(HEALTH));
    vi.stubGlobal('fetch', fetchMock);
    render(<BackendStatus />);
    await userEvent.click(await screen.findByRole('button', { name: '重新檢查' }));
    expect(await screen.findByText('後端已連線')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
