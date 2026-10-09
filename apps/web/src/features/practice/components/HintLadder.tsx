/**
 * 提示階梯（SPEC §4.2）：最多 3 層，由淺到深一層一層打開。
 * 用了提示照樣計分，但這次作答不算「第一次就答對」（之後接上作答紀錄時記 hints_used）；
 * 看過幾層存在練習紀錄（history.ts），重新整理後還在，交卷後的解析卡也會標出這題用過提示。
 * 打開最後一層時按鈕會消失，焦點改移到剛打開的那一層提示，鍵盤與螢幕閱讀器使用者不會掉回頁首（body）。
 */
import { Lightbulb } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { revealHint, updatePracticeHistory, usePracticeHistory } from '../history';

export function useHintsUsed(groupKey: string, label: string): number {
  return usePracticeHistory().value.hints[groupKey]?.[label] ?? 0;
}

export function HintLadder({
  groupKey,
  label,
  hints,
  title = '提示',
  className = 'mt-3',
}: {
  groupKey: string;
  label: string;
  hints: readonly string[];
  /** 標題（選項庫題組的提示列表用「第 n 格提示」）。 */
  title?: string;
  className?: string;
}) {
  const used = Math.min(useHintsUsed(groupKey, label), hints.length);
  const titleId = useId();
  const lastHintRef = useRef<HTMLLIElement>(null);
  /** 剛按了「看最後一層提示」：畫面更新後把焦點移到那一層（按鈕已經不在了）。 */
  const focusLastHint = useRef(false);
  useEffect(() => {
    if (!focusLastHint.current || used < hints.length) return;
    focusLastHint.current = false;
    lastHintRef.current?.focus();
  }, [used, hints.length]);
  if (hints.length === 0) return null;
  const shown = hints.slice(0, used);
  return (
    <div role="group" aria-labelledby={titleId} className={`${className} rounded-xl border border-dashed border-line bg-surface-2/60 p-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p id={titleId} className="flex items-center gap-1.5 text-sm font-semibold">
          <Lightbulb aria-hidden="true" className="size-4 text-badge-fg" />
          {title}
          <span className="font-normal text-muted tabular-nums">
            {used}／{hints.length} 層
          </span>
        </p>
        {used < hints.length && (
          <button
            type="button"
            onClick={() => {
              focusLastHint.current = used + 1 >= hints.length;
              updatePracticeHistory((h) => revealHint(h, groupKey, label, hints.length));
            }}
            className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-3 text-sm hover:border-primary"
          >
            {used === 0 ? '看第 1 層提示' : `看第 ${used + 1} 層提示`}
          </button>
        )}
      </div>
      {/* aria-live：按下按鈕後，螢幕閱讀器會唸出新打開的那一層。 */}
      <ol aria-live="polite" className={shown.length > 0 ? 'mt-2 space-y-1 text-[0.95rem]' : 'sr-only'}>
        {shown.map((hint, i) => (
          <li
            key={i}
            ref={i === hints.length - 1 ? lastHintRef : undefined}
            tabIndex={i === hints.length - 1 ? -1 : undefined}
            className="flex gap-2 rounded-sm"
          >
            <span className="shrink-0 font-semibold text-muted tabular-nums">{i + 1}.</span>
            <span className="min-w-0 break-words">{hint}</span>
          </li>
        ))}
      </ol>
      {used > 0 && <p className="mt-2 text-xs text-muted">用了提示照樣計分，但這一題不算「第一次就答對」。</p>}
    </div>
  );
}
