/**
 * 計時中點了側邊欄、頁尾或帳號選單的站內連結（只在 ≥ lg；docs/design/desktop-polish.md §4.7）：先問要不要離開。
 * 原生 <dialog> 的 showModal：背景不能操作、Esc 等於「留下來作答」；焦點預設在「留下來作答」（安全的那一邊），
 * 關掉之後回到剛才點的連結。外觀照 §2.13 的對話框：標題列＋右上角關閉、底部一列動作（R11 的框線與陰影）。
 */
import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

/** 秒數 → 1:23:45／12:05（和工具列的倒數同一種寫法；不 import 考卷的 labels.ts，主程式不必多帶那一包）。 */
function clock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export interface LeavePrompt {
  /** 要去的站內網址（pathname＋search＋hash）。 */
  to: string;
  remainingSec: number;
  leaveNote: string;
  /** 點的那個連結：留下來之後焦點回到它。 */
  opener: HTMLElement | null;
}

export function LeaveSessionDialog({ prompt, onStay, onLeave }: { prompt: LeavePrompt; onStay: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    stayRef.current?.focus();
    const opener = prompt.opener;
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [prompt]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onStay();
      }}
      className="m-auto w-[min(30rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-lg backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          要離開作答頁嗎？
        </h2>
        <button
          type="button"
          onClick={onStay}
          aria-label="關閉"
          className="-mt-1 -mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      <p id={`${id}-desc`} className="px-5 pt-1 pb-4 text-[0.95rem] text-pretty">
        計時還在進行（剩 <span className="font-semibold tabular-nums">{clock(prompt.remainingSec)}</span>），作答已存在這台裝置。{prompt.leaveNote}
      </p>
      <div className="flex flex-wrap gap-2 rounded-b-2xl border-t border-line bg-surface px-5 py-3">
        <button
          ref={stayRef}
          type="button"
          onClick={onStay}
          className="inline-flex min-h-10 items-center rounded-full bg-primary px-5 font-semibold text-on-primary"
        >
          留下來作答
        </button>
        <button type="button" onClick={onLeave} className="inline-flex min-h-10 items-center rounded-full border border-line px-5 hover:border-primary">
          離開
        </button>
      </div>
    </dialog>
  );
}
