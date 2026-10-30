/**
 * 科目切換（docs/design/assistant-subjects.md §1.2、§8.2、§8.5）：「科目：［英文］［國文］」單選 chip，下方一行
 * 「數學、社會、自然還沒開放」。只列對這位使用者開放的科目；只有一科時整列不顯示（畫面和沒有多科目時相同）。
 * 是一組 radio（原生 input type="radio"），可以用方向鍵切換。
 */
import { ASSIST_SUBJECT_LABELS, type AssistSubject } from '@gsat/shared';
import { useId } from 'react';
import { ZH_COPY } from './chinese/copy';

export function SubjectChips({ open, value, onChange }: { open: readonly AssistSubject[]; value: AssistSubject; onChange: (subject: AssistSubject) => void }) {
  const id = useId();
  if (open.length < 2) return null;
  return (
    <fieldset className="space-y-1" aria-describedby={`${id}-note`}>
      <legend className="sr-only">科目</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="text-sm font-semibold">
          科目：
        </span>
        {open.map((s) => {
          const checked = s === value;
          return (
            <label
              key={s}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${checked ? 'border-primary bg-primary text-on-primary' : 'border-line lg:hover:bg-surface-2'}`}
            >
              <input type="radio" name={`${id}-subject`} value={s} checked={checked} onChange={() => onChange(s)} className="sr-only" />
              {ASSIST_SUBJECT_LABELS[s]}
            </label>
          );
        })}
      </div>
      <p id={`${id}-note`} className="text-xs text-muted">
        {ZH_COPY.notYetOpen}
      </p>
    </fieldset>
  );
}
