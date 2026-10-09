/**
 * 題號旁的「標記」切換鈕（透過 features/exams 的 QuestionAccessoryContext 放進題目標題列）。
 * 一個題目區塊可能有兩題（混合題 47–48 的摘要句）：全部已標記才算「已標記」，按下去一起切換。
 * 交卷後的檢討只顯示「作答時標記過」的小標籤（MarkedBadge）。
 */
import { Flag } from 'lucide-react';
import { useMockMeta, useMockSession } from '../MockSessionContext';

export function MarkToggle({ labels }: { labels: readonly string[] }) {
  const session = useMockSession();
  const pressed = useMockMeta((m) => labels.every((l) => m.marked.includes(l)));
  const readOnly = useMockMeta((m) => m.status === 'submitted');
  const name = labels.length > 1 ? `第 ${labels[0]}–${labels.at(-1)} 題` : /^\d+[A-Z]?$/.test(labels[0] ?? '') ? `第 ${labels[0]} 題` : (labels[0] ?? '');
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`標記${name}，稍後檢查`}
      disabled={readOnly}
      onClick={(e) => {
        // 題目標題在 <legend> 裡；不要讓點擊冒泡到外層（例如 label）。
        e.stopPropagation();
        session.toggleMarks(labels);
      }}
      className={`-my-1.5 inline-flex min-h-9 items-center gap-1 rounded-full border px-2.5 text-xs font-medium ${
        pressed ? 'border-badge-fg/40 bg-badge-bg text-badge-fg' : 'border-line text-muted hover:border-primary hover:text-primary'
      }`}
    >
      <Flag aria-hidden="true" className={`size-3.5 ${pressed ? 'fill-current' : ''}`} />
      {pressed ? '已標記' : '標記'}
    </button>
  );
}

export function MarkedBadge({ labels, marked }: { labels: readonly string[]; marked: ReadonlySet<string> }) {
  if (!labels.some((l) => marked.has(l))) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-badge-bg px-2 py-0.5 text-xs font-medium text-badge-fg">
      <Flag aria-hidden="true" className="size-3 fill-current" />
      作答時標記過
    </span>
  );
}
