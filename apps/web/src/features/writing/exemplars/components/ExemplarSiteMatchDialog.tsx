/**
 * 學生貼的題目和網站上的題目相同（409 exemplar_site_match；docs/design/model-essays.md §1.6 第 4 步、§5.3）：二選一。
 *   「改用網站題目」→ 換成那一題的確認畫面（之前有同學產生過就 0 點）；「仍用我貼的題目（8 點）」→ 同一個請求加 allow_custom。
 * 共用的 Dialog（原生 <dialog> 的 showModal）：焦點移到「改用網站題目」、Esc 關閉、背景不能操作。
 */
import { useRef } from 'react';
import { btn } from '../../../../components/ui/buttons';
import { Dialog } from '../../../../components/ui/Dialog';

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
  const firstRef = useRef<HTMLButtonElement>(null);
  const open = match !== null;
  return (
    <Dialog
      open={open}
      title="這一題和網站上的題目相同"
      onClose={onClose}
      initialFocusRef={firstRef}
      restoreFocus={false}
      dim="strong"
      description={match ? `這一題和網站上的「${match.title}」相同。改用網站題目時，如果之前有同學產生過就不用點數，題目文字也比較完整。` : null}
      actions={
        match && (
          <>
            <button ref={firstRef} type="button" onClick={() => onUseSite(match.group_id)} className={btn('primary', 'md')}>
              改用網站題目
            </button>
            <button type="button" onClick={onKeepCustom} className={btn('secondary', 'md')}>
              仍用我貼的題目（{points} 點）
            </button>
            <button type="button" onClick={onClose} className={btn('ghost', 'md')}>
              取消
            </button>
          </>
        )
      }
    />
  );
}
