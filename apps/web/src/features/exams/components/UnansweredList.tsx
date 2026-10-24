/**
 * 交卷確認裡「還沒作答的題號」（只在桌機用；docs/design/desktop-polish.md §3.7、§4.7）：依大題列出，點題號回去作答。
 * 一個大題沒答的超過 collapseOver 題時先收成一行「閱讀測驗：第 35–50 題（16 題）」，可以展開成題號。
 * 歷屆試題與題庫練習的交卷確認列（ExamToolbar）、模擬考的交卷對話框（SubmitDialog）共用。
 */
import { useId, useState } from 'react';
import type { SectionEntry } from '../../mock/paperIndex';
import { questionTitle } from '../richText';

/** section.labels 裡連續沒答的題號併成「3–10」；不連續的用「、」隔開。 */
export function unansweredRanges(all: readonly string[], unanswered: readonly string[]): string {
  const missing = new Set(unanswered);
  const runs: string[] = [];
  let start: string | null = null;
  let prev: string | null = null;
  const flush = () => {
    if (start !== null && prev !== null) runs.push(start === prev ? start : `${start}–${prev}`);
    start = null;
    prev = null;
  };
  for (const label of all) {
    if (missing.has(label)) {
      start ??= label;
      prev = label;
    } else {
      flush();
    }
  }
  flush();
  return runs.join('、');
}

function SectionRow({
  section,
  labels,
  onJump,
  collapseOver,
  chipClassName,
}: {
  section: SectionEntry;
  labels: readonly string[];
  onJump: (label: string) => void;
  collapseOver: number;
  chipClassName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const collapsible = labels.length > collapseOver;
  return (
    // 大題名稱一欄固定寬度，各大題的題號從同一條線開始。
    <div className="flex items-baseline gap-2">
      <p className="w-28 shrink-0 text-xs font-medium text-muted">
        {section.label}
        {collapsible ? '' : `（${labels.length} 題）`}
      </p>
      <div className="min-w-0 flex-1 space-y-1">
        {collapsible && (
          <p className="text-sm">
            第 {unansweredRanges(section.labels, labels)} 題（{labels.length} 題）
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((v) => !v)}
              className="ml-2 inline-flex min-h-8 items-center text-sm text-primary underline underline-offset-2"
            >
              {expanded ? '收起題號' : '列出題號'}
            </button>
          </p>
        )}
        {(!collapsible || expanded) && (
          <ul id={listId} className="flex flex-wrap gap-1.5">
            {labels.map((label) => (
              <li key={label}>
                <button type="button" onClick={() => onJump(label)} aria-label={`回到${questionTitle(label)}`} className={chipClassName}>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function UnansweredList({
  groups,
  onJump,
  heading = '未作答（點題號回去作答）',
  collapseOver = 10,
  chipClassName = 'inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-line bg-surface px-1.5 text-sm tabular-nums hover:border-primary',
}: {
  groups: readonly { section: SectionEntry; labels: readonly string[] }[];
  onJump: (label: string) => void;
  heading?: string;
  collapseOver?: number;
  chipClassName?: string;
}) {
  const headingId = useId();
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <h3 id={headingId} className="text-sm font-semibold">
        {heading}
      </h3>
      {groups.map(({ section, labels }) => (
        <SectionRow key={section.id} section={section} labels={labels} onJump={onJump} collapseOver={collapseOver} chipClassName={chipClassName} />
      ))}
    </section>
  );
}
