/**
 * 每週可以用在英文的時間（必填，§1.8 第 1 步）：2 小時以內／2–4 小時／4–6 小時／6 小時以上。
 * 本站依這個排每週份量（約 100／180／300／420 分鐘，ASSIST_WEEKLY_MINUTES）。沒選時 value 是 null，送出鈕停用、顯示提示。
 */
import { ASSIST_FINAL_TAPER_DAYS, ASSIST_WEEKLY, ASSIST_WEEKLY_LABELS, ASSIST_WEEKLY_MINUTES, type AssistWeekly } from '@gsat/shared';
import { useId } from 'react';

export function WeeklyTimeField({ value, onChange, showError = false }: { value: AssistWeekly | null; onChange: (v: AssistWeekly) => void; showError?: boolean }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <fieldset className="space-y-2" aria-describedby={showError && value === null ? errorId : undefined}>
      <legend className="font-medium">
        每週可以用在英文的時間<span className="text-bad">（必填）</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {ASSIST_WEEKLY.map((w) => (
          <label key={w} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input type="radio" name={`${id}-weekly`} required checked={value === w} onChange={() => onChange(w)} className="size-4 accent-primary" />
            {ASSIST_WEEKLY_LABELS[w]}
          </label>
        ))}
      </div>
      {value !== null ? (
        <p className="text-sm text-muted">
          本站會依每週約 {ASSIST_WEEKLY_MINUTES[value]} 分鐘排逐週份量（段考週減半，考前最後 {ASSIST_FINAL_TAPER_DAYS} 天減半）。
        </p>
      ) : (
        showError && (
          <p id={errorId} className="text-sm text-bad">
            請先選每週可以用在英文的時間。
          </p>
        )
      )}
    </fieldset>
  );
}
