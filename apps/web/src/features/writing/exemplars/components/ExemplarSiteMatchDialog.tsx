/**
 * 學生貼的題目和網站上的題目相同（409 exemplar_site_match；docs/design/model-essays.md §1.6 第 4 步、§5.3）：二選一。
 *   「改用網站題目」→ 換成那一題的確認畫面（之前有同學產生過就 0 點）；「仍用我貼的題目（8 點）」→ 同一個請求加 allow_custom。
 * 原生 <dialog>（showModal）：焦點自動移入、Esc 關閉、背景不能操作；浮層樣式 border border-line bg-surface shadow-lg（R11）。
 */
import { useEffect, useId, useRef } from 'react';

export function ExemplarSiteMatchDialog({
  match,
  points,
  onUseSite,
  onKeepCustom,
  onClose,
}: {
  match: { group_id: string; title: string } | null;
  points: number;
  onUseSite: (groupId: string) => void;
  onKeepCustom: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = match !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      firstRef.current?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      data-backdrop-dim="50"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-fg shadow-lg backdrop:bg-black/50"
    >
      {match && (
        <div className="space-y-4">
          <h2 id={`${id}-title`} className="text-lg font-bold">
            這一題和網站上的題目相同
          </h2>
          <p id={`${id}-desc`} className="text-[0.95rem]">
            這一題和網站上的「{match.title}」相同。改用網站題目時，如果之前有同學產生過就不用點數，題目文字也比較完整。
          </p>
          <div className="flex flex-wrap gap-2">
            <button ref={firstRef} type="button" onClick={() => onUseSite(match.group_id)} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-on-primary">
              改用網站題目
            </button>
            <button type="button" onClick={onKeepCustom} className="min-h-11 rounded-full border border-line px-5">
              仍用我貼的題目（{points} 點）
            </button>
            <button type="button" onClick={onClose} className="min-h-11 rounded-full px-3 text-sm text-muted underline underline-offset-2">
              取消
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
