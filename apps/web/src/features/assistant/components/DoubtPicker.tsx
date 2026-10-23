/**
 * 「你卡在哪裡？」（docs/design/learning-assistant.md §1.5、§5.2）：六個勾選＋自由輸入（選填，≤ 500 字，即時字數）。
 *   - 「我在 (B) 和 (C) 之間猶豫」：勾了才出現第二個選項的選單（第一個是學生自己的答案）。題組勾了好幾題時，
 *     猶豫指的是勾選的第一題（Worker 用第一題的答案），選項文字寫出是哪一題（tornQuestion）。
 *   - 寫了自由輸入時說明「寫了疑問就不能免費共用」（有自由輸入的請求不進共用快取，§4.7.4）。
 */
import { ASSIST_DOUBT_KINDS, ASSIST_DOUBT_LABELS, ASSIST_LIMITS, type AssistDoubtKind, type OptionLetter } from '@gsat/shared';
import { useId, type ReactNode } from 'react';
import { inputCls } from './parts';

export interface DoubtValue {
  kinds: AssistDoubtKind[];
  tornWith: OptionLetter | null;
  text: string;
}

export const EMPTY_DOUBT: DoubtValue = { kinds: [], tornWith: null, text: '' };

export function DoubtPicker({
  value,
  onChange,
  tornOptions,
  mine,
  showFreeNote = true,
  kinds = ASSIST_DOUBT_KINDS,
  tornQuestion = null,
  tornNote = null,
}: {
  value: DoubtValue;
  onChange: (next: DoubtValue) => void;
  /** 「猶豫」的第二個選項可以選的字母（不含學生自己的答案）；沒有選項的題目不列「猶豫」。 */
  tornOptions: readonly string[];
  /** 學生的答案（「我在 (C) 和 … 之間猶豫」）。 */
  mine: string | null;
  /** 站內題才說明「寫了疑問就不能免費共用」。 */
  showFreeNote?: boolean;
  kinds?: readonly AssistDoubtKind[];
  /** 「猶豫」指的是哪一題（「第 35 題」，寫在選項文字後面的括號裡）；只問一題時是 null，不寫題號。 */
  tornQuestion?: string | null;
  /** 「猶豫」下面的說明（例如按的是另一題時，怎麼改成問那一題）。 */
  tornNote?: ReactNode;
}) {
  const id = useId();
  const max = ASSIST_LIMITS.doubtMaxChars;
  const length = [...value.text].length;
  const shown = kinds.filter((k) => k !== 'torn_between' || tornOptions.length > 0);
  const toggle = (kind: AssistDoubtKind, checked: boolean) => {
    const next = checked ? [...value.kinds, kind] : value.kinds.filter((k) => k !== kind);
    onChange({ ...value, kinds: ASSIST_DOUBT_KINDS.filter((k) => next.includes(k)), tornWith: next.includes('torn_between') ? value.tornWith : null });
  };
  return (
    <fieldset className="space-y-3">
      <legend className="font-semibold">你卡在哪裡？（選填）</legend>
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((kind) => {
          const checked = value.kinds.includes(kind);
          const label =
            kind === 'torn_between' && mine ? `我在 (${mine}) 和另一個選項之間猶豫${tornQuestion ? `（${tornQuestion}）` : ''}` : ASSIST_DOUBT_LABELS[kind];
          return (
            <li key={kind} className="min-w-0">
              <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${checked ? 'border-primary bg-primary-soft' : 'border-line'}`}>
                <input type="checkbox" checked={checked} onChange={(e) => toggle(kind, e.currentTarget.checked)} className="size-4 shrink-0 accent-[var(--primary)]" />
                <span className="min-w-0 break-words">{label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {tornNote && shown.includes('torn_between') && <div className="text-sm text-muted">{tornNote}</div>}
      {value.kinds.includes('torn_between') && tornOptions.length > 0 && (
        <div>
          <label htmlFor={`${id}-torn`} className="text-sm font-medium">
            另一個讓你猶豫的選項
          </label>
          <select
            id={`${id}-torn`}
            value={value.tornWith ?? ''}
            onChange={(e) => onChange({ ...value, tornWith: (e.currentTarget.value || null) as OptionLetter | null })}
            className={`mt-1 min-h-11 sm:max-w-xs ${inputCls}`}
          >
            <option value="">請選擇</option>
            {tornOptions.map((l) => (
              <option key={l} value={l}>
                ({l})
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          想問的話（選填）
        </label>
        <textarea
          id={`${id}-text`}
          rows={3}
          maxLength={max * 2}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.currentTarget.value })}
          aria-describedby={`${id}-count ${id}-note`}
          aria-invalid={length > max || undefined}
          placeholder="例如：為什麼 (F) 不能填在第 3 格？"
          className={`mt-1 ${inputCls}`}
        />
        <p id={`${id}-count`} className={`text-xs tabular-nums ${length > max ? 'font-semibold text-bad' : 'text-muted'}`}>
          {length}／{max} 字
        </p>
        <p id={`${id}-note`} className="text-xs text-muted">
          {showFreeNote && value.text.trim() !== '' ? '寫了自己的疑問，這次解析就不能免費共用（會照常用點）。' : ''}
        </p>
      </div>
    </fieldset>
  );
}
