/**
 * 鷹架提示（SPEC §6.8 步驟 2「逐層開，記錄使用」）：按一次開一層，開到第幾層記在草稿裡（重新整理後保留）。
 * 中譯英的三層是：切成四段、標的詞彙、句型框架；作文是審題的三個重點。
 */
import { Lightbulb } from 'lucide-react';
import { useId } from 'react';

export function BankHints({
  hints,
  level,
  onLevel,
  label,
}: {
  hints: readonly string[];
  /** 已經打開幾層（0–hints.length）。 */
  level: number;
  onLevel: (level: number) => void;
  /** 按鈕與清單的名稱，例如「第 1 句的提示」。 */
  label: string;
}) {
  const listId = useId();
  if (hints.length === 0) return null;
  const shown = Math.min(level, hints.length);
  const done = shown >= hints.length;
  return (
    <div className="mt-2 text-sm">
      {shown > 0 && (
        <ol id={listId} aria-label={label} className="mb-1 space-y-1 rounded-xl bg-surface-2 px-4 py-2">
          {hints.slice(0, shown).map((h, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 font-semibold text-primary tabular-nums">{i + 1}.</span>
              <span className="min-w-0 break-words">{h}</span>
            </li>
          ))}
        </ol>
      )}
      {!done ? (
        <button
          type="button"
          onClick={() => onLevel(shown + 1)}
          aria-expanded={shown > 0}
          aria-controls={shown > 0 ? listId : undefined}
          aria-label={`${label}：看第 ${shown + 1} 層（共 ${hints.length} 層）`}
          className="inline-flex min-h-11 items-center gap-1.5 text-primary underline-offset-2 hover:underline"
        >
          <Lightbulb aria-hidden="true" className="size-4" />
          看提示（{shown + 1}／{hints.length}）
        </button>
      ) : (
        <p className="text-muted">提示已經全部打開。</p>
      )}
    </div>
  );
}
