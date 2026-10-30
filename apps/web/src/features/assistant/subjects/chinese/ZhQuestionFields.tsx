/**
 * 國文題目的作答欄位（docs/design/assistant-subjects.md §1.3 第 3 步、§8.2）：貼上與拍照確認共用。
 *   - 格式與子模式：程式依題目文字預填，畫面一行「多選題（依題目判斷）・修改」，按「修改」才出現選擇；偵測信心低時直接打開請學生確認。
 *   - 你的答案：選擇題填字母（每題一格）；簡答每個小題一格（每格最多 120 字，旁邊列字數與題目的字數限制）；
 *     國寫可以附自己寫的一段（最多 250 字），知性題另可勾「這是問題（一）的答案」（最多 80 字）。
 *   - 「我有講義答案」（摺疊，只有選擇題）：已知的正確答案，選填，只收 A–E。簡答與國寫不收（可能是官方的表達型參考答案）。
 * 檢查一律再跑 shared 的 checkZhQuestion；這裡只在欄位旁邊即時提示格式不對的字母與超過的字數。
 */
import {
  ZH_CHOICE_MODES,
  ZH_CHOICE_MODE_LABELS,
  ZH_FORMATS,
  ZH_FORMAT_LABELS,
  ZH_TEXT_LIMITS,
  countZhChars,
  normalizeZhChoiceLetters,
  zhSplitPartLabel,
  type ZhCharLimit,
  type ZhChoiceMode,
  type ZhFormat,
  type ZhFormatGuess,
} from '@gsat/shared';
import { useId, useState } from 'react';
import { inputCls } from '../../components/parts';
import { CharCount } from './components/CharCount';
import { ZH_COPY } from './copy';
import type { ZhFieldsValue } from './typed';
import { zhItemTitle } from './ZhCommon';
import { charLimitText } from './ZhShortView';

/** 選擇題的字母格式不對（空白不算錯）。 */
export function lettersInvalid(value: string): boolean {
  return value.trim() !== '' && normalizeZhChoiceLetters(value) === null;
}

/** 簡答小題「34(1)」對到 zhCharLimits 的哪一條（小題的、或整題的）。 */
export function limitForPart(limits: readonly ZhCharLimit[], key: string): ZhCharLimit | null {
  const part = zhSplitPartLabel(key).part;
  return limits.find((l) => l.part === part && l.sub === null) ?? limits.find((l) => l.part === null && l.sub === null) ?? null;
}

/** 作答欄位裡第一個看得到的問題（送出前擋住；沒有回 null）。 */
export function zhFieldsBlocker(value: ZhFieldsValue, format: ZhFormat, keys: readonly string[]): string | null {
  if (format === 'choice') {
    if (keys.some((k) => lettersInvalid(value.answers[k] ?? '') || lettersInvalid(value.knownKey[k] ?? ''))) return '選擇題的答案只能填 A–E 的字母，例如 B 或 AC。';
    return null;
  }
  if (format === 'short') {
    if (keys.some((k) => countZhChars(value.answers[k] ?? '').chars > ZH_TEXT_LIMITS.shortAnswerChars)) return `簡答的答案每一小題最多 ${ZH_TEXT_LIMITS.shortAnswerChars} 字。`;
    return null;
  }
  const max = value.draftQ1 ? ZH_TEXT_LIMITS.draftQ1Chars : ZH_TEXT_LIMITS.draftChars;
  if (countZhChars(value.draft).chars > max) return value.draftQ1 ? `問題（一）的答案最多 ${max} 字。` : `國寫指導一次只看一段，最多 ${max} 字。`;
  return null;
}

function formatSummary(format: ZhFormat, mode: ZhChoiceMode | null): string {
  return format === 'choice' && mode !== null ? ZH_CHOICE_MODE_LABELS[mode] : ZH_FORMAT_LABELS[format];
}

export function ZhQuestionFields({
  value,
  onChange,
  guess,
  format,
  mode,
  answerKeys,
  limits,
  showQ1,
}: {
  value: ZhFieldsValue;
  onChange: (next: ZhFieldsValue) => void;
  /** 程式依題目文字猜的格式與子模式。 */
  guess: ZhFormatGuess;
  /** 實際採用的格式與子模式（effectiveZhFormat）。 */
  format: ZhFormat;
  mode: ZhChoiceMode | null;
  /** 作答欄位的鍵（選擇題每題、簡答每小題；單題沒有題號時是空字串）。 */
  answerKeys: readonly string[];
  /** 題目裡的字數限制（簡答的每格旁邊列出）。 */
  limits: readonly ZhCharLimit[];
  /** 知性題：可以勾「這是問題（一）的答案」。 */
  showQ1: boolean;
}) {
  const id = useId();
  const needConfirm = guess.format === null || guess.confidence === 'low';
  const [editing, setEditing] = useState(false);
  const open = editing || (needConfirm && value.format === null);
  const byGuess = value.format === null && (format !== 'choice' || value.mode === null);
  const set = (patch: Partial<ZhFieldsValue>) => onChange({ ...value, ...patch });
  const setMap = (key: 'answers' | 'knownKey', k: string, v: string) => set({ [key]: { ...value[key], [k]: v } });
  const many = answerKeys.length > 1;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="font-semibold">格式：</span>
          <span data-testid="zh-format-summary">
            {formatSummary(format, mode)}
            {byGuess && !needConfirm ? '（依題目判斷）' : ''}
          </span>
          {!open && (
            <>
              <span aria-hidden="true">・</span>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
                修改
              </button>
            </>
          )}
        </p>
        {open && (
          <div className="space-y-3 rounded-xl border border-line p-3">
            {needConfirm && value.format === null && <p className="text-sm text-muted">看不太出這題的格式，請確認：</p>}
            <fieldset>
              <legend className="text-sm font-medium">格式</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {ZH_FORMATS.map((f) => (
                  <label key={f} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${format === f ? 'border-primary bg-primary-soft font-semibold' : 'border-line'}`}>
                    <input type="radio" name={`${id}-format`} value={f} checked={format === f} onChange={() => set({ format: f })} className="size-4 accent-[var(--primary)]" />
                    {ZH_FORMAT_LABELS[f]}
                  </label>
                ))}
              </div>
            </fieldset>
            {format === 'choice' && (
              <fieldset>
                <legend className="text-sm font-medium">選擇題的種類</legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {ZH_CHOICE_MODES.map((m) => (
                    <label key={m} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm ${mode === m ? 'border-primary bg-primary-soft font-semibold' : 'border-line'}`}>
                      <input type="radio" name={`${id}-mode`} value={m} checked={mode === m} onChange={() => set({ format: 'choice', mode: m })} className="size-4 accent-[var(--primary)]" />
                      {ZH_CHOICE_MODE_LABELS[m]}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">5 個選項的題目通常是多選題（國綜的單選題是 4 個選項）。</p>
              </fieldset>
            )}
          </div>
        )}
      </div>

      {format === 'choice' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {answerKeys.map((k) => {
            const bad = lettersInvalid(value.answers[k] ?? '');
            const inputId = `${id}-ans-${k}`;
            return (
              <div key={`a-${k}`}>
                <label htmlFor={inputId} className="font-semibold">
                  {many ? `${zhItemTitle(k)}你的答案（選填）` : '你的答案（選填）'}
                </label>
                <input
                  id={inputId}
                  value={value.answers[k] ?? ''}
                  onChange={(e) => setMap('answers', k, e.currentTarget.value)}
                  aria-describedby={`${inputId}-hint`}
                  aria-invalid={bad || undefined}
                  className={`mt-1 min-h-11 ${inputCls}`}
                  autoComplete="off"
                  autoCapitalize="characters"
                />
                <p id={`${inputId}-hint`} className={`text-xs ${bad ? 'font-semibold text-bad' : 'text-muted'}`}>
                  {bad ? '只能填 A–E 的字母。' : ZH_COPY.choiceAnswerHint}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {format === 'short' && (
        <div className="space-y-4">
          {answerKeys.map((k) => {
            const inputId = `${id}-ans-${k}`;
            const limit = limitForPart(limits, k);
            const text = value.answers[k] ?? '';
            const max = Math.min(ZH_TEXT_LIMITS.shortAnswerChars, limit?.max ?? ZH_TEXT_LIMITS.shortAnswerChars);
            const limitText = charLimitText(limit);
            return (
              <div key={`s-${k}`}>
                <label htmlFor={inputId} className="font-semibold">
                  {k === '' ? '你的答案' : `${zhItemTitle(k)}你的答案`}
                </label>
                <textarea
                  id={inputId}
                  rows={2}
                  value={text}
                  onChange={(e) => setMap('answers', k, e.currentTarget.value)}
                  aria-describedby={`${inputId}-count ${inputId}-hint`}
                  className={`mt-1 ${inputCls}`}
                />
                <p className="flex flex-wrap items-center gap-x-3">
                  <CharCount id={`${inputId}-count`} text={text} max={max} />
                  {limitText && <span className="text-xs text-muted">題目：{limitText}</span>}
                </p>
                <p id={`${inputId}-hint`} className="text-xs text-muted">
                  {ZH_COPY.shortAnswerHint}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {format === 'writing' && (
        <div className="space-y-2">
          <label htmlFor={`${id}-draft`} className="font-semibold">
            你寫的一段（選填）
          </label>
          <textarea
            id={`${id}-draft`}
            rows={5}
            value={value.draft}
            onChange={(e) => set({ draft: e.currentTarget.value })}
            aria-describedby={`${id}-draft-count ${id}-draft-hint`}
            className={inputCls}
          />
          <p>
            <CharCount id={`${id}-draft-count`} text={value.draft} max={value.draftQ1 ? ZH_TEXT_LIMITS.draftQ1Chars : ZH_TEXT_LIMITS.draftChars} />
          </p>
          <p id={`${id}-draft-hint`} className="text-xs text-muted">
            {ZH_COPY.draftHint}
          </p>
          {showQ1 && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <input type="checkbox" checked={value.draftQ1} onChange={(e) => set({ draftQ1: e.currentTarget.checked })} className="size-4 accent-[var(--primary)]" />
              {ZH_COPY.draftQ1}
            </label>
          )}
        </div>
      )}

      {format === 'choice' && (
        <details className="rounded-xl border border-line px-3 py-1" open={answerKeys.some((k) => (value.knownKey[k] ?? '') !== '') || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{ZH_COPY.knownKeySummary}</summary>
          <div className="space-y-3 pb-3">
            <p className="text-sm text-muted">{ZH_COPY.knownKeyHint}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {answerKeys.map((k) => {
                const bad = lettersInvalid(value.knownKey[k] ?? '');
                const inputId = `${id}-key-${k}`;
                return (
                  <div key={`k-${k}`}>
                    <label htmlFor={inputId} className="text-sm font-medium">
                      {many ? `${zhItemTitle(k)}的答案` : '講義或考卷的答案'}
                    </label>
                    <input
                      id={inputId}
                      value={value.knownKey[k] ?? ''}
                      onChange={(e) => setMap('knownKey', k, e.currentTarget.value)}
                      aria-invalid={bad || undefined}
                      aria-describedby={bad ? `${inputId}-bad` : undefined}
                      className={`mt-1 min-h-11 ${inputCls}`}
                      autoComplete="off"
                      autoCapitalize="characters"
                    />
                    {bad && (
                      <p id={`${inputId}-bad`} className="text-xs font-semibold text-bad">
                        只能填 A–E 的字母。
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
