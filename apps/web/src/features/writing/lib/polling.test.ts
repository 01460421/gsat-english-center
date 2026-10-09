import { POLL_FAST_DURATION_MS, POLL_FAST_INTERVAL_MS, POLL_SLOW_INTERVAL_MS, type SubmissionDetail, type SubmissionStatus } from '@gsat/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../lib/api';
import { translationSubmission } from '../testing/fixtures';
import { SubmissionPoller, isFatalPollError, isPendingStatus, pollDelay, pollSpeed, type PollSnapshot } from './polling';

describe('輪詢節奏', () => {
  it('3 分鐘內每 2 秒，之後每 15 秒', () => {
    expect(pollDelay(0)).toBe(POLL_FAST_INTERVAL_MS);
    expect(pollDelay(POLL_FAST_DURATION_MS - 1)).toBe(2_000);
    expect(pollDelay(POLL_FAST_DURATION_MS)).toBe(POLL_SLOW_INTERVAL_MS);
    expect(pollDelay(10 * 60_000)).toBe(15_000);
    expect(pollSpeed(60_000)).toBe('fast');
    expect(pollSpeed(180_000)).toBe('slow');
  });

  it('只有 ocr_queued、queued、grading 需要繼續問', () => {
    const pending: SubmissionStatus[] = ['ocr_queued', 'queued', 'grading'];
    for (const s of pending) expect(isPendingStatus(s)).toBe(true);
    for (const s of ['draft', 'ocr_ready', 'confirmed', 'graded', 'self_graded', 'failed'] as const) expect(isPendingStatus(s)).toBe(false);
  });

  it('401／403／404 與 not_configured 不會自己好；網路錯誤與 5xx 會', () => {
    expect(isFatalPollError(new ApiRequestError(404, 'not_found', ''))).toBe(true);
    expect(isFatalPollError(new ApiRequestError(401, 'unauthorized', ''))).toBe(true);
    expect(isFatalPollError(new ApiRequestError(200, 'not_configured', ''))).toBe(true);
    expect(isFatalPollError(new ApiRequestError(503, null, ''))).toBe(false);
    expect(isFatalPollError(new TypeError('Failed to fetch'))).toBe(false);
    // 閘道的 HTML 502／504（Vercel、Cloudflare 1101／1102）：暫時性，照節奏重試
    expect(isFatalPollError(new ApiRequestError(502, 'not_configured', 'html', { nonJson: true }))).toBe(false);
    // 代理的 HTML 404（後端沒部署）與後端自己回的 not_configured：停止
    expect(isFatalPollError(new ApiRequestError(404, 'not_configured', 'html', { nonJson: true }))).toBe(true);
    expect(isFatalPollError(new ApiRequestError(503, 'not_configured', ''))).toBe(true);
  });
});

describe('SubmissionPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (status: SubmissionStatus): SubmissionDetail => translationSubmission({ status, grading: status === 'graded' ? translationSubmission().grading : null });

  function setup(responses: Array<SubmissionDetail | Error>) {
    const snapshots: PollSnapshot[] = [];
    let i = 0;
    const load = vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (r instanceof Error) throw r;
      if (!r) throw new Error('沒有回應');
      return r;
    });
    const poller = new SubmissionPoller({ load, onChange: (s) => snapshots.push(s) });
    return { poller, load, snapshots, last: () => snapshots[snapshots.length - 1] };
  }

  it('批改中每 2 秒問一次，完成就停', async () => {
    const { poller, load, last } = setup([at('queued'), at('grading'), at('graded')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ phase: 'polling', speed: 'fast' });
    expect(last()?.detail?.status).toBe('queued');

    await vi.advanceTimersByTimeAsync(1_999);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(last()?.detail?.status).toBe('grading');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(last()).toMatchObject({ phase: 'idle' });
    expect(last()?.detail?.status).toBe('graded');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('3 分鐘後改成每 15 秒，並標示 slow（畫面提示可以先離開）', async () => {
    const { poller, load, last } = setup([at('grading')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_FAST_DURATION_MS);
    const fastCalls = load.mock.calls.length;
    // 3 分鐘內約 90 次（每 2 秒）
    expect(fastCalls).toBeGreaterThanOrEqual(90);
    expect(last()?.speed).toBe('slow');

    await vi.advanceTimersByTimeAsync(14_999);
    expect(load.mock.calls.length).toBeLessThanOrEqual(fastCalls + 1);
    const before = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(load.mock.calls.length).toBe(before + 1);
    poller.stop();
  });

  it('不需要輪詢的狀態（ocr_ready）只問一次', async () => {
    const { poller, load, last } = setup([at('ocr_ready')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(last()?.phase).toBe('idle');
  });

  it('暫時性錯誤：保留上次的資料、記下錯誤，照節奏重試', async () => {
    const { poller, load, last } = setup([at('grading'), new ApiRequestError(503, null, 'down'), at('graded')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(last()).toMatchObject({ phase: 'polling' });
    expect(last()?.error).toBeInstanceOf(ApiRequestError);
    expect(last()?.detail?.status).toBe('grading');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(last()).toMatchObject({ phase: 'idle', error: null });
  });

  it('批改中遇到閘道的 HTML 502：保留資料、繼續輪詢，之後拿到結果', async () => {
    const gateway = new ApiRequestError(502, 'not_configured', 'html', { nonJson: true });
    const { poller, load, last } = setup([at('queued'), gateway, at('graded')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(last()).toMatchObject({ phase: 'polling', error: gateway });
    expect(last()?.detail?.status).toBe('queued');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(last()).toMatchObject({ phase: 'idle', error: null });
    expect(last()?.detail?.status).toBe('graded');
  });

  it('批改中 session 過期（401）：停止、phase error，但保留上次的資料（畫面要顯示錯誤與再試一次）', async () => {
    const { poller, load, last } = setup([at('grading'), new ApiRequestError(401, 'unauthorized', '')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(last()?.phase).toBe('error');
    expect(last()?.detail?.status).toBe('grading');
  });

  it('第一次就失敗或遇到 404：停止並回報錯誤', async () => {
    const first = setup([new TypeError('Failed to fetch')]);
    first.poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(first.load).toHaveBeenCalledTimes(1);
    expect(first.last()?.phase).toBe('error');

    const notFound = setup([at('grading'), new ApiRequestError(404, 'not_found', '')]);
    notFound.poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(notFound.load).toHaveBeenCalledTimes(2);
    expect(notFound.last()?.phase).toBe('error');
  });

  it('restart 重設 3 分鐘的快速期並立刻再問；accept 直接套用新內容', async () => {
    const { poller, load, last } = setup([at('grading')]);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(POLL_FAST_DURATION_MS + 1_000);
    expect(last()?.speed).toBe('slow');
    const before = load.mock.calls.length;
    poller.restart();
    await vi.advanceTimersByTimeAsync(0);
    expect(load.mock.calls.length).toBe(before + 1);
    expect(last()?.speed).toBe('fast');

    poller.accept(at('confirmed'));
    expect(last()).toMatchObject({ phase: 'idle' });
    expect(last()?.detail?.status).toBe('confirmed');
    const afterAccept = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load.mock.calls.length).toBe(afterAccept);
  });

  it('stop 之後不再請求，進行中的回應也不套用', async () => {
    const { poller, load, snapshots } = setup([at('grading')]);
    poller.start();
    poller.stop();
    const count = snapshots.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(snapshots.length).toBe(count);
  });
});
