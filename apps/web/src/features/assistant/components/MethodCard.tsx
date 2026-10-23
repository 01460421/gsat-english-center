/**
 * 方法庫的一個大題（docs/design/learning-assistant.md §3.3 第 7 段；內容在 shared 的 assist-methods.ts，本站撰寫）：
 * 建議用時、練習時一組的用時、步驟、常見陷阱、提分重點、依據的統計；AI 的「對你來說要特別注意」放在最上面（有才顯示）。
 * 方法是本站寫的，不加 AI 標章；AI 的那一句另外標示。
 */
import type { AssistSectionMethod } from '@gsat/shared';
import { useId } from 'react';
import { AiBadge } from '../../writing/components/ui';

export function MethodCard({ method, note }: { method: AssistSectionMethod; note?: string | null }) {
  const id = useId();
  return (
    <article aria-labelledby={id} className="report-avoid-break space-y-3 rounded-2xl border border-line bg-surface p-4 lg:p-5">
      <h3 id={id} className="text-base font-semibold">
        {method.title}
        <span className="ml-2 text-sm font-normal text-muted">
          {method.suggested_minutes !== null && `考試時建議 ${method.suggested_minutes} 分鐘・`}練習一{method.unit.label}約 {method.unit.minutes} 分鐘（含檢討）
        </span>
      </h3>
      {note && (
        <div className="rounded-xl bg-primary-soft px-3 py-2">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            對你來說要特別注意 <AiBadge compact variant="assistant" />
          </p>
          <p className="mt-1 break-words">{note}</p>
        </div>
      )}
      <div>
        <p className="text-sm font-medium">本站的做法</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          {method.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
      <details className="report-expand group">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">常見陷阱與提分重點</summary>
        <div className="space-y-2 pt-1">
          <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
            {method.traps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
            {method.score_tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className="text-sm text-muted">{method.stat_note}</p>
        </div>
      </details>
    </article>
  );
}
