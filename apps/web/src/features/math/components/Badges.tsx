/** 課綱標記與作答進度標記（列表與卷子頁共用）。 */
import type { MathEra } from '@gsat/shared';
import type { MathProgress } from '../attempt';

export function EraBadge({ era }: { era: MathEra }) {
  const tone = era === '舊課綱' ? 'bg-badge-bg text-badge-fg' : 'bg-primary-soft text-primary';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{era}</span>;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export function ProgressBadge({ progress, total }: { progress: MathProgress | null; total: number }) {
  if (!progress) return null;
  if (progress.status === 'submitted') {
    return (
      <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok">
        已交卷{progress.earned !== null && progress.autoMax !== null ? `・${fmt(progress.earned)}／${fmt(progress.autoMax)}` : ''}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
      作答中・{progress.answered}／{total}
    </span>
  );
}
