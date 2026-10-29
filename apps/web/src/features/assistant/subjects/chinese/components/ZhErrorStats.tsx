/**
 * 首頁「最近的解析」選「國文」時上方的國文錯因統計（docs/design/assistant-subjects.md §7.3；程式算，0 點）：
 * GET /api/assist/cases?subject=chinese 的 error_counts 依錯因族加總，列各族題數與最常見的 3 個錯因。認不得的代碼略過。
 */
import { ZH_ERROR_FAMILIES, ZH_ERROR_FAMILY_LABELS, ZH_ERROR_INFO, isZhErrorCode, type ZhErrorFamily } from '@gsat/shared';
import { useId } from 'react';

export interface ZhErrorSummary {
  families: Array<{ family: ZhErrorFamily; label: string; count: number }>;
  top: Array<{ code: string; label: string; count: number }>;
}

/** 純函式（測試用）：錯因次數 → 各族題數（依族的順序、0 的不列）與最常見的 3 個錯因（次數相同依代碼）。 */
export function zhErrorSummary(counts: Readonly<Record<string, number>>): ZhErrorSummary {
  const entries = Object.entries(counts).filter(([code, n]) => isZhErrorCode(code) && n > 0) as Array<[keyof typeof ZH_ERROR_INFO, number]>;
  const byFamily = new Map<ZhErrorFamily, number>();
  for (const [code, n] of entries) byFamily.set(ZH_ERROR_INFO[code].family, (byFamily.get(ZH_ERROR_INFO[code].family) ?? 0) + n);
  return {
    families: ZH_ERROR_FAMILIES.filter((f) => (byFamily.get(f) ?? 0) > 0).map((f) => ({ family: f, label: ZH_ERROR_FAMILY_LABELS[f], count: byFamily.get(f) ?? 0 })),
    top: entries
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([code, n]) => ({ code, label: ZH_ERROR_INFO[code].label, count: n })),
  };
}

export function ZhErrorStats({ counts }: { counts: Readonly<Record<string, number>> | null }) {
  const id = useId();
  if (!counts) return null;
  const summary = zhErrorSummary(counts);
  return (
    <section aria-labelledby={id} className="space-y-2 rounded-2xl border border-line bg-surface p-4" data-testid="zh-error-stats">
      <h3 id={id} className="font-semibold">
        國文錯因統計<span className="ml-1 text-sm font-normal text-muted">（本站計算）</span>
      </h3>
      {summary.families.length === 0 ? (
        <p className="text-sm text-muted">還沒有標出錯因的國文題目。</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2 text-sm">
            {summary.families.map((f) => (
              <li key={f.family} className="rounded-full bg-surface-2 px-3 py-1">
                {f.label} <span className="font-semibold tabular-nums">{f.count}</span> 題
              </li>
            ))}
          </ul>
          <p className="text-sm">最常見的錯因：{summary.top.map((t) => `「${t.label}」${t.count} 題`).join('、')}</p>
        </>
      )}
    </section>
  );
}
