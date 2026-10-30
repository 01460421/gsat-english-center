/**
 * 解析與追問的進度（docs/design/learning-assistant.md §4.12、§5.2）：aria-live="polite" 的狀態列。
 * 文字依狀態與經過時間換（「排隊中」「AI 正在讀題」「正在整理解析」），不是真的進度；3 分鐘後改慢速輪詢時提示可以先離開。
 * 失敗時依退還原因說明（點數全額退還）並給「再試一次」。國寫範文（國寫範文設計 §8）的進度列放在範文那一塊，「AI 正在寫示範…」、
 * 通常 1–2 分鐘。
 *
 * 狀態列只在有進行中的任務時才出現，出現時就已經有字（螢幕閱讀器常常不唸）、完成時整個拿掉（沒有東西唸「完成」）。
 * 所以案例頁與報告頁另外常駐一個 AssistLiveRegion（§1.11：「排隊中」「解析完成」都要唸），狀態列傳 live={false}。
 */
import type { AssistPendingTask } from '@gsat/shared';
import { useEffect, useState } from 'react';
import type { PollSpeed } from '../../writing/lib/polling';

function stepText(pending: AssistPendingTask, elapsedSec: number): string {
  if (pending.kind === 'followup') return pending.status === 'queued' ? '排隊中…' : 'AI 正在想怎麼回答…';
  if (pending.kind === 'ocr') return pending.status === 'queued' ? '排隊中…' : 'AI 正在轉錄照片…';
  if (pending.kind === 'zh_exemplar') return pending.status === 'queued' ? '排隊中…' : 'AI 正在寫示範…';
  if (pending.status === 'queued') return '排隊中…';
  return elapsedSec < 20 ? 'AI 正在讀題…' : '正在整理解析…';
}

/** 常駐的 aria-live 區（只給螢幕閱讀器）：頁面換文字（排隊中 → 解析完成）時唸出來。 */
export function AssistLiveRegion({ text }: { text: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}

export function AssistStatus({
  pending,
  speed,
  group = false,
  connectionError = false,
  stopped = false,
  live = true,
}: {
  pending: AssistPendingTask | null;
  speed: PollSpeed;
  /** 題組：通常 1–2 分鐘。 */
  group?: boolean;
  /** 輪詢暫時失敗（保留畫面，照節奏重試）。 */
  connectionError?: boolean;
  /** 輪詢因為不會自己好的錯誤停了（登入過期、找不到…）：不再說「會自動顯示」，錯誤與「再試一次」由頁面顯示。 */
  stopped?: boolean;
  /** false：頁面另有常駐的 AssistLiveRegion，這裡不當 live region。 */
  live?: boolean;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [pending]);
  if (!pending) return live ? <p role="status" aria-live="polite" className="sr-only" /> : null;
  const elapsed = Math.round((now - startedAt) / 1000);
  const typical = pending.kind === 'followup' ? '通常 20–40 秒' : group || pending.kind === 'zh_exemplar' ? '通常 1–2 分鐘' : '通常 30–60 秒';
  const liveProps = live ? ({ role: 'status', 'aria-live': 'polite' } as const) : {};
  if (stopped) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
        <span className="font-medium">{stepText(pending, elapsed)}</span>
        <span className="text-muted">自動更新已停止（原因見上方）。按「再試一次」或重新整理頁面，就能看到最新進度。</span>
      </div>
    );
  }
  return (
    <div {...liveProps} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
      <span aria-hidden="true" className="size-3 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
      <span className="font-medium">{stepText(pending, elapsed)}</span>
      <span className="text-muted">{typical}，完成後會自動顯示。</span>
      {speed === 'slow' && <span className="text-muted">比平常久一點；可以先離開，完成後回來看。</span>}
      {connectionError && <span className="text-bad">連線不穩，正在重試…</span>}
    </div>
  );
}
