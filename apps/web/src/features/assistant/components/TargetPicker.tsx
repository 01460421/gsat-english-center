/**
 * 報告的目標（docs/design/learning-assistant.md §1.8 第 1 步）：「頂標／前標／均標」或「目標級分 1–15」。必填，預設前標。
 * 旁邊說明五標的級分（依 115 學測；數字來自 shared 的 ASSIST_STANDARD_LEVELS，和 Worker 打包的目標資料同一年，有測試對照）。
 */
import { ASSIST_STANDARD_LABELS, ASSIST_STANDARD_LEVELS, ASSIST_STANDARDS, type AssistStandard } from '@gsat/shared';
import { useId } from 'react';
import { inputCls } from './parts';

export type ReportTarget = { standard: AssistStandard } | { level: number };

const LEVELS = Array.from({ length: 15 }, (_, i) => 15 - i);

export function TargetPicker({ value, onChange }: { value: ReportTarget; onChange: (t: ReportTarget) => void }) {
  const id = useId();
  const mode = 'standard' in value ? value.standard : 'level';
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium">目標</legend>
      <div className="flex flex-wrap gap-2">
        {ASSIST_STANDARDS.map((s) => (
          <label key={s} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
            <input type="radio" name={`${id}-target`} checked={mode === s} onChange={() => onChange({ standard: s })} className="size-4 accent-primary" />
            {ASSIST_STANDARD_LABELS[s]}（{ASSIST_STANDARD_LEVELS[s]} 級分）
          </label>
        ))}
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
          <input type="radio" name={`${id}-target`} checked={mode === 'level'} onChange={() => onChange({ level: 'level' in value ? value.level : 12 })} className="size-4 accent-primary" />
          自訂級分
        </label>
      </div>
      {'level' in value && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          目標級分
          <select value={value.level} onChange={(e) => onChange({ level: Number(e.target.value) })} className={`${inputCls} w-24`}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-sm text-muted">
        依 {ASSIST_STANDARD_LEVELS.year} 學測：頂標 {ASSIST_STANDARD_LEVELS.top}、前標 {ASSIST_STANDARD_LEVELS.front}、均標 {ASSIST_STANDARD_LEVELS.mean} 級分。各大題的目標答對率由本站依歷年統計估計，不是官方資料。
      </p>
    </fieldset>
  );
}
