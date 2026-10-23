/**
 * 確認頁「要問哪幾題」（docs/design/learning-assistant.md §1.5、§5.2）：同一個題組的題目列成勾選清單，
 * 上限（文意選填 5、其他題組 4、單字 8；詞彙題只能 1 題，用單選）、預設勾選、點數即時更新（由呼叫端顯示）。
 * 勾滿時其他選項停用並說明上限；每一列都寫出狀態（答錯、未作答、部分給分、疑點）。
 */
import { useId } from 'react';
import type { GroupPick, ItemStatus, PreviewItem } from '../sources/types';

const STATUS_HINT: Record<ItemStatus, string> = {
  wrong: '答錯',
  unanswered: '未作答',
  partial: '部分給分',
  doubt: '答對，有疑點',
  correct: '答對',
  unknown: '',
};

export function LabelPicker({
  items,
  pick,
  value,
  onChange,
  unit,
  displayOf,
}: {
  items: readonly PreviewItem[];
  pick: GroupPick;
  value: readonly string[];
  onChange: (labels: string[]) => void;
  /** 「題」或「格」；單字是「個字」。 */
  unit: string;
  displayOf: (label: string) => string;
}) {
  const id = useId();
  const full = value.length >= pick.max;
  const toggle = (label: string, checked: boolean) => {
    if (pick.single) {
      onChange([label]);
      return;
    }
    const next = checked ? [...value, label] : value.filter((l) => l !== label);
    onChange(items.map((i) => i.label).filter((l) => next.includes(l)));
  };
  return (
    <fieldset className="space-y-2" aria-describedby={`${id}-hint`}>
      <legend className="font-semibold">要問哪{pick.single ? '一' : '幾'}{unit}</legend>
      <p id={`${id}-hint`} className="text-sm text-muted">
        {pick.single ? `一次問一${unit}。` : `同一組一次最多 ${pick.max} ${unit}；預設勾這組的錯題與疑點。`}
        {pick.overflow.length > 0 && !pick.single && ` 超過上限沒勾的：${pick.overflow.map(displayOf).join('、')}，可以下次再問。`}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => {
          const checked = value.includes(item.label);
          const disabled = !pick.single && !checked && full;
          const hint = STATUS_HINT[item.status];
          return (
            <li key={item.label} className="min-w-0">
              <label
                className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 ${
                  checked ? 'border-primary bg-primary-soft' : 'border-line'
                } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type={pick.single ? 'radio' : 'checkbox'}
                  name={`${id}-labels`}
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(item.label, e.currentTarget.checked)}
                  className="size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium break-words">{/^\d/.test(item.display) ? `第 ${item.display} ${unit}` : item.display}</span>
                  {hint && <span className="ml-2 text-sm text-muted">{hint}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {full && !pick.single && (
        <p role="status" className="text-sm text-muted">
          已經勾滿 {pick.max} {unit}。
        </p>
      )}
    </fieldset>
  );
}
