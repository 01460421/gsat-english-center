/**
 * 計時中點了側邊欄、頁尾或帳號選單的站內連結（只在 ≥ lg；docs/design/desktop-polish.md §4.7）：先問要不要離開。
 * 共用的 Dialog（components/ui/Dialog.tsx，原生 <dialog> 的 showModal）：背景不能操作、Esc 等於「留下來作答」；焦點預設在
 * 「留下來作答」（安全的那一邊），關掉之後回到剛才點的連結。
 */
import { useEffect, useRef } from 'react';
import { btn } from '../ui/buttons';
import { Dialog } from '../ui/Dialog';

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
  const stayRef = useRef<HTMLButtonElement>(null);
  // 關掉之後焦點回到剛才點的連結（不是打開時的 activeElement：點連結時焦點不一定移到連結上）。
  useEffect(() => {
    const opener = prompt.opener;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [prompt]);

  return (
    <Dialog
      title="要離開作答頁嗎？"
      onClose={onStay}
      initialFocusRef={stayRef}
      restoreFocus={false}
      size="sm"
      description={
        <>
          計時還在進行（剩 <span className="font-semibold tabular-nums">{clock(prompt.remainingSec)}</span>），作答已存在這台裝置。{prompt.leaveNote}
        </>
      }
      actions={
        <>
          <button ref={stayRef} type="button" onClick={onStay} className={btn('primary', 'md')}>
            留下來作答
          </button>
          <button type="button" onClick={onLeave} className={btn('secondary', 'md')}>
            離開
          </button>
        </>
      }
    />
  );
}
