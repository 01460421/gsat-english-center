/**
 * 段考週（選填，§1.8 第 1 步）：最多 4 個日期，程式換成週次——那一週份量減半、模擬考避開。
 */
import { ASSIST_LIMITS } from '@gsat/shared';
import { Plus, X } from 'lucide-react';
import { inputCls } from './parts';

export function SchoolExamDates({ value, onChange, min, max }: { value: string[]; onChange: (dates: string[]) => void; min?: string; max?: string }) {
  const limit = ASSIST_LIMITS.schoolExamDatesMax;
  const set = (i: number, d: string) => onChange(value.map((x, j) => (j === i ? d : x)));
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">段考日期（選填）</legend>
      <p className="text-sm text-muted">最多 {limit} 個。那一週的份量減半，模擬考會排在前後週。</p>
      <ul className="space-y-2">
        {value.map((d, i) => (
          <li key={i} className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`school-exam-${i}`}>
              第 {i + 1} 個段考日期
            </label>
            <input id={`school-exam-${i}`} type="date" value={d} min={min} max={max} onChange={(e) => set(i, e.target.value)} className={`${inputCls} w-auto`} />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="inline-flex size-11 items-center justify-center rounded-full border border-line lg:hover:bg-surface-2"
              aria-label={`刪掉第 ${i + 1} 個段考日期`}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {value.length < limit && (
        <button type="button" onClick={() => onChange([...value, ''])} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-line px-4 text-sm lg:hover:bg-surface-2">
          <Plus aria-hidden="true" className="size-4" />
          加一個段考日期
        </button>
      )}
    </fieldset>
  );
}
