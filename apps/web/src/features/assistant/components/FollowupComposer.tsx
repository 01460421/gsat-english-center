/**
 * 追問的輸入（docs/design/learning-assistant.md §1.7、§2.7）：
 *   - 輸入框 ≤ 500 字、即時字數（aria-describedby）；草稿存在這台裝置（gsat-assist:v1:draft:followup:{caseId}）。
 *   - 模式「提示／詳解」：已作答的題目預設詳解、先給提示的題目預設提示；模式寫在任務裡。
 *   - 解析附的建議問題（chip）：按了填進輸入框，不會直接送出。
 *   - 題組多一個「問的是第幾題」（預設整組）。
 *   - 第 8 輪之後換成說明；同一題同時只能有一個進行中的 AI 任務（pending 時停用）。
 */
import { ASSIST_LIMITS, type AssistFollowupMode, type AssistTaskAccepted } from '@gsat/shared';
import { Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ErrorMessage } from '../../writing/components/ui';
import type { ErrorView } from '../../writing/lib/errors';
import { startAssistFollowup } from '../lib/assistApi';
import { loadAssistDraft, saveAssistDraft } from '../lib/drafts';
import { useAssistErrorView } from '../lib/pollers';
import { inputCls, primaryBtn } from './parts';

export function FollowupComposer({
  caseId,
  rounds,
  defaultMode,
  chips,
  labels,
  displayOf,
  disabled,
  disabledReason,
  points,
  onStarted,
  placeholder = '例如：那 (F) 什麼時候可以用？',
}: {
  caseId: string;
  /** 已經成功的追問輪數。 */
  rounds: number;
  defaultMode: AssistFollowupMode;
  chips: readonly string[];
  /** 題組的題號（只有一題時是空陣列，不顯示選單）。 */
  labels: readonly string[];
  displayOf: (label: string) => string;
  disabled: boolean;
  /** 不能送出的原因（進行中、AI 未核准…）。 */
  disabledReason: string | null;
  points: number;
  onStarted: (accepted: AssistTaskAccepted) => void;
  /** 輸入框的範例（國文用自己的範例；docs/design/assistant-subjects.md §1.5）。 */
  placeholder?: string;
}) {
  const id = useId();
  const draftKey = `followup:${caseId}`;
  const [text, setText] = useState(() => loadAssistDraft(draftKey));
  const [mode, setMode] = useState<AssistFollowupMode>(defaultMode);
  const [label, setLabel] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const errorView = useAssistErrorView();
  const max = ASSIST_LIMITS.followupMaxChars;
  const length = [...text].length;

  useEffect(() => {
    const timer = setTimeout(() => saveAssistDraft(draftKey, text), 400);
    return () => clearTimeout(timer);
  }, [draftKey, text]);

  if (rounds >= ASSIST_LIMITS.followupsPerCase) {
    return (
      <p className="rounded-xl border border-line bg-surface-2 px-4 py-3">
        這題已經追問 {ASSIST_LIMITS.followupsPerCase} 次，建議開新的一題，或把疑問寫進學習報告的回饋。
      </p>
    );
  }

  const submit = async () => {
    if (text.trim() === '' || length > max) return;
    setSending(true);
    setError(null);
    try {
      const accepted = await startAssistFollowup(caseId, { text: text.trim(), mode, label: label || null });
      setText('');
      saveAssistDraft(draftKey, '');
      onStarted(accepted);
    } catch (err) {
      setError(await errorView(err, { submitting: true }));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-text`} className="font-semibold">
        還有問題？繼續追問
      </label>
      {chips.length > 0 && (
        <ul aria-label="建議問題" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => {
                  setText(c);
                  textRef.current?.focus();
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface-2 px-3 text-left text-sm lg:hover:border-primary"
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={textRef}
        id={`${id}-text`}
        rows={3}
        value={text}
        maxLength={max * 2}
        onChange={(e) => setText(e.currentTarget.value)}
        aria-describedby={`${id}-count`}
        aria-invalid={length > max || undefined}
        className={inputCls}
        placeholder={placeholder}
      />
      <p id={`${id}-count`} className={`text-xs tabular-nums ${length > max ? 'font-semibold text-bad' : 'text-muted'}`}>
        {length}／{max} 字・這題還可以追問 {ASSIST_LIMITS.followupsPerCase - rounds} 次
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset>
          <legend className="text-sm font-medium">回答方式</legend>
          <div className="mt-1 flex gap-2">
            {(
              [
                ['hint', '提示（不直接說答案）'],
                ['explain', '詳解'],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${mode === value ? 'border-primary bg-primary-soft font-semibold' : 'border-line'}`}>
                <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} className="size-4 accent-[var(--primary)]" />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
        {labels.length > 1 && (
          <div>
            <label htmlFor={`${id}-label`} className="text-sm font-medium">
              問的是第幾題
            </label>
            <select id={`${id}-label`} value={label} onChange={(e) => setLabel(e.currentTarget.value)} className={`mt-1 min-h-11 ${inputCls}`}>
              <option value="">整組</option>
              {labels.map((l) => (
                <option key={l} value={l}>
                  第 {displayOf(l)} 題
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" data-followup-submit disabled={disabled || sending || text.trim() === '' || length > max} className={primaryBtn}>
          <Send aria-hidden="true" className="size-4" />
          {sending ? '送出中…' : `送出追問（用 ${points} 點）`}
        </button>
        {disabledReason && <p className="text-sm text-muted">{disabledReason}</p>}
      </div>
      {error && <ErrorMessage view={error} />}
    </form>
  );
}
