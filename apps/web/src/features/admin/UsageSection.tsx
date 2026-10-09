/**
 * 後台：AI 用量摘要（GET /api/admin/usage?from=&to=）。金額是整數微美元，顯示成 US$。
 * 日期參數用台灣日期 'YYYY-MM-DD'（後端的 tw_day 也是台灣日期）。
 */
import { AI_TASKS, type AdminUsageResponse, type AiTask } from '@gsat/shared';
import { useState } from 'react';
import type { ApiPath } from '../../lib/api';
import { AI_TASK_LABELS } from '../account/labels';
import { LoadingBlock, Notice } from '../account/ui';
import { useApiData } from '../account/useApiData';
import { errorMessage } from '../../lib/apiErrors';
import { AdminSection, ReloadButton, SectionError, formatUsdMicros } from './adminUi';
import { isAdminUsageResponse } from './guards';

const RANGES = [7, 30] as const;
type Range = (typeof RANGES)[number];

/** 台灣日期 'YYYY-MM-DD'；offsetDays 往前推幾天。 */
export function taiwanDay(now: Date, offsetDays = 0): string {
  const shifted = new Date(now.getTime() - offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted);
}

function taskLabel(task: string): string {
  return (AI_TASKS as readonly string[]).includes(task) ? AI_TASK_LABELS[task as AiTask] : task;
}

export function UsageSection() {
  const [range, setRange] = useState<Range>(7);
  // 日期只在第一次繪製時決定（同一天內不會變）；換範圍才重新讀。
  const [now] = useState(() => new Date());
  const path: ApiPath = `/api/admin/usage?from=${taiwanDay(now, range - 1)}&to=${taiwanDay(now)}`;
  const usage = useApiData(path, isAdminUsageResponse);

  return (
    <AdminSection id="admin-usage" title="AI 用量摘要" actions={<ReloadButton onClick={usage.reload} busy={usage.loading} />}>
      <div role="group" aria-label="期間" className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
              range === r ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:bg-surface-2'
            }`}
          >
            近 {r} 天
          </button>
        ))}
      </div>
      <div className="mt-4">
        {usage.data ? (
          <UsageBody data={usage.data} />
        ) : usage.error !== null ? (
          <SectionError error={usage.error} onRetry={usage.reload} />
        ) : (
          <LoadingBlock />
        )}
        {usage.data && usage.error !== null && (
          <div className="mt-3">
            <Notice tone="error">重新整理失敗：{errorMessage(usage.error)}</Notice>
          </div>
        )}
      </div>
    </AdminSection>
  );
}

function BudgetBar({ label, usedMicros, limitUsd }: { label: string; usedMicros: number; limitUsd: number }) {
  const pct = limitUsd > 0 ? Math.min(100, Math.round((usedMicros / (limitUsd * 1_000_000)) * 100)) : 0;
  return (
    <div>
      <div className="flex flex-wrap justify-between gap-x-3 text-[0.95rem]">
        <span>{label}</span>
        <span>
          {formatUsdMicros(usedMicros)}／US${limitUsd}（{pct}%）
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden="true">
        <div className={`h-2 rounded-full ${pct >= 90 ? 'bg-bad' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function UsageBody({ data }: { data: AdminUsageResponse }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {data.from} 至 {data.to}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['AI 任務', `${data.totals.ops} 次`],
          ['點數', `${data.totals.points} 點`],
          ['費用', formatUsdMicros(data.totals.usd_micros)],
          ['退點任務', `${data.totals.refunded_ops} 次`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-surface-2 px-3 py-2">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-3">
        <h3 className="font-semibold">站內預算</h3>
        <BudgetBar label="今日" usedMicros={data.budget.today_usd_micros} limitUsd={data.budget.site_day_usd} />
        <BudgetBar label="本月" usedMicros={data.budget.month_usd_micros} limitUsd={data.budget.site_month_usd} />
      </div>

      <div>
        <h3 className="font-semibold">依任務</h3>
        {data.by_task.length === 0 ? (
          <p className="mt-2 text-sm text-muted">這段期間沒有 AI 任務。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-[0.95rem]">
              <thead className="text-sm text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">任務</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">次數</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">點數</th>
                  <th scope="col" className="py-1 text-right font-medium">費用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.by_task.map((r) => (
                  <tr key={r.task}>
                    <td className="py-1.5 pr-3">{taskLabel(r.task)}</td>
                    <td className="py-1.5 pr-3 text-right">{r.ops}</td>
                    <td className="py-1.5 pr-3 text-right">{r.points}</td>
                    <td className="py-1.5 text-right">{formatUsdMicros(r.usd_micros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold">依日期</h3>
        {data.by_day.length === 0 ? (
          <p className="mt-2 text-sm text-muted">這段期間沒有 AI 任務。</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-[0.95rem]">
              <thead className="text-sm text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">日期</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">次數</th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">點數</th>
                  <th scope="col" className="py-1 text-right font-medium">費用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.by_day.map((r) => (
                  <tr key={r.tw_day}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.tw_day}</td>
                    <td className="py-1.5 pr-3 text-right">{r.ops}</td>
                    <td className="py-1.5 pr-3 text-right">{r.points}</td>
                    <td className="py-1.5 text-right">{formatUsdMicros(r.usd_micros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
