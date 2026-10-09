/**
 * 批改進度的輪詢（ARCHITECTURE §3.4 最後一行）：每 2 秒問一次 GET /api/submissions/{id}，最多 3 分鐘；
 * 之後改成每 15 秒，並提示「可以先離開，完成後回來看」。狀態離開 ocr_queued／queued／grading 就停。
 *
 * 寫成不依賴 React 的小型狀態機（SubmissionPoller），計時器與時鐘可以注入，單元測試用假計時器逐步推進；
 * 頁面用 useSubmissionPoller（hooks.ts）接上 React。
 *
 * 錯誤處理：
 *   - 第一次就失敗 → phase 'error'（畫面給「再試一次」）。
 *   - 已經拿到過資料、之後某一次失敗（網路不穩、5xx，含閘道回的 HTML 502／504）→ 保留上一次的資料、記下 error，
 *     照原本的節奏繼續問（畫面顯示「連線不穩，正在重試…」）。
 *   - 401／403／404、後端回 JSON 的 not_configured、或 4xx 的非 JSON 回應（代理的 404 頁＝後端沒部署）
 *     → 不可能自己好，停止輪詢，phase 'error'；有資料時畫面仍要顯示錯誤與「再試一次」，不能停在「會自動更新」。
 */
import {
  POLL_FAST_DURATION_MS,
  POLL_FAST_INTERVAL_MS,
  POLL_SLOW_INTERVAL_MS,
  SUBMISSION_PENDING_STATUSES,
  type SubmissionDetail,
  type SubmissionStatus,
} from '@gsat/shared';
import { ApiRequestError, isGatewayError } from '../../../lib/api';

export function isPendingStatus(status: SubmissionStatus): boolean {
  return (SUBMISSION_PENDING_STATUSES as readonly SubmissionStatus[]).includes(status);
}

export type PollSpeed = 'fast' | 'slow';

/** 開始輪詢後經過的時間 → 這一輪用快速還是慢速。 */
export function pollSpeed(elapsedMs: number): PollSpeed {
  return elapsedMs < POLL_FAST_DURATION_MS ? 'fast' : 'slow';
}

/** 開始輪詢後經過的時間 → 下一次要等多久。 */
export function pollDelay(elapsedMs: number): number {
  return pollSpeed(elapsedMs) === 'fast' ? POLL_FAST_INTERVAL_MS : POLL_SLOW_INTERVAL_MS;
}

/**
 * 不會自己恢復的錯誤：繼續問也沒用。
 * 閘道的非 JSON 5xx 不算：能輪詢就表示功能開關已確認後端有部署，這種錯誤多半是暫時的。
 */
export function isFatalPollError(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (isGatewayError(error)) return false;
  return error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'not_configured';
}

/**
 * phase：
 *   loading   第一次載入中
 *   polling   狀態還在跑，持續輪詢（speed 看快慢）
 *   idle      狀態已經不需要輪詢（graded、ocr_ready、failed…）
 *   error     停止（第一次就失敗，或遇到不會自己恢復的錯誤）
 */
export interface PollSnapshot {
  phase: 'loading' | 'polling' | 'idle' | 'error';
  detail: SubmissionDetail | null;
  speed: PollSpeed;
  /** 最近一次失敗的錯誤；成功後清掉。 */
  error: unknown;
}

export interface PollTimers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realTimers: PollTimers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface PollerOptions {
  load: (signal: AbortSignal) => Promise<SubmissionDetail>;
  onChange: (snapshot: PollSnapshot) => void;
  timers?: PollTimers;
}

export class SubmissionPoller {
  private readonly load: PollerOptions['load'];
  private readonly onChange: PollerOptions['onChange'];
  private readonly timers: PollTimers;
  private snapshot: PollSnapshot = { phase: 'loading', detail: null, speed: 'fast', error: null };
  private startedAt = 0;
  private timer: unknown = null;
  private controller: AbortController | null = null;
  private stopped = true;

  constructor(options: PollerOptions) {
    this.load = options.load;
    this.onChange = options.onChange;
    this.timers = options.timers ?? realTimers;
  }

  get current(): PollSnapshot {
    return this.snapshot;
  }

  /** 開始（或重新開始）：計時從現在起算，立刻問一次。 */
  start(): void {
    this.cancelPending();
    this.stopped = false;
    this.startedAt = this.timers.now();
    this.update({ speed: 'fast', phase: this.snapshot.detail ? 'polling' : 'loading' });
    void this.tick();
  }

  /** 學生送出新的 AI 任務（或手動重試）後呼叫：重設 3 分鐘的快速期。 */
  restart(detail?: SubmissionDetail): void {
    if (detail) this.snapshot = { ...this.snapshot, detail };
    this.start();
  }

  /** 直接套用剛從其他請求拿到的最新內容（例如 PUT confirm 的回應），需要時接著輪詢。 */
  accept(detail: SubmissionDetail): void {
    this.cancelPending();
    if (isPendingStatus(detail.status)) {
      this.snapshot = { ...this.snapshot, detail };
      this.start();
      return;
    }
    this.update({ detail, phase: 'idle', error: null });
  }

  stop(): void {
    this.stopped = true;
    this.cancelPending();
  }

  private cancelPending(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  private update(patch: Partial<PollSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.snapshot);
  }

  private schedule(): void {
    const elapsed = this.timers.now() - this.startedAt;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, pollDelay(elapsed));
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    const controller = new AbortController();
    this.controller = controller;
    let detail: SubmissionDetail;
    try {
      detail = await this.load(controller.signal);
    } catch (error) {
      if (controller.signal.aborted || this.stopped) return;
      this.controller = null;
      if (this.snapshot.detail === null || isFatalPollError(error)) {
        this.update({ phase: 'error', error });
        return;
      }
      // 暫時性錯誤：保留畫面上的資料，照節奏再試。
      this.update({ error, speed: pollSpeed(this.timers.now() - this.startedAt) });
      this.schedule();
      return;
    }
    if (controller.signal.aborted || this.stopped) return;
    this.controller = null;
    if (isPendingStatus(detail.status)) {
      this.update({ detail, phase: 'polling', error: null, speed: pollSpeed(this.timers.now() - this.startedAt) });
      this.schedule();
    } else {
      this.update({ detail, phase: 'idle', error: null });
    }
  }
}
