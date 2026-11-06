/**
 * 選填題的「仿答題卷」作答（docs/design/math.md §4.3）。
 *
 * 每一格（13-1、13-2…）是一列劃記：1 2 3 4 5 6 7 8 9 0 − ±（和答題卷相同的 12 種），用原生 radio 做：
 *   - Tab 進到某一列、方向鍵在這一列裡移動並選取（瀏覽器內建）；
 *   - 焦點在某一列時直接按數字鍵或減號就劃記那一格，並跳到下一列；Backspace／Delete 清除這一列；
 *   - 每一列有「清除」按鈕（radio 選了就不能用點的取消）。
 * 上方用 KaTeX 排出作答格式（每一格標格號），下方即時預覽「你的答案」，讓學生確認帶分數、根號位置這類格式。
 * 手機：12 個劃記排成兩排各 6 個（36 px 見方），320 px 寬也放得下；sm 以上排成一排。
 */
import { fillCellDisplay, fillCellLatex, fillTemplateLatex, FILL_CELL_VALUES, type MathFill } from '@gsat/shared';
import { useId, useRef, type KeyboardEvent } from 'react';
import { Tex } from './MathText';

/** 作答格式：每一格是標了格號的小方框。 */
export function fillFormatLatex(fill: Pick<MathFill, 'template'>): string {
  return `\\displaystyle ${fillTemplateLatex(fill.template, (id) => `\\boxed{\\scriptstyle\\text{${id}}}`)}`;
}

/** 目前的作答：劃了的格子放數值，沒劃的放空方框。 */
export function fillAnswerLatex(fill: Pick<MathFill, 'template' | 'cells'>, values: readonly string[]): string {
  return fillTemplateLatex(fill.template, (id) => {
    const v = values[fill.cells.indexOf(id)] ?? '';
    return v === '' ? '\\boxed{\\phantom{0}}' : fillCellLatex(v);
  });
}

const KEY_TO_VALUE: Record<string, string> = { '-': '-', '−': '-', '±': '±', '_': '-' };

export function FillInput({
  label,
  fill,
  values,
  onChange,
  disabled,
  showFeedback,
}: {
  /** 題號（「第 13 題」的 13），用在無障礙名稱。 */
  label: string;
  fill: MathFill;
  values: readonly string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  showFeedback: boolean;
}) {
  const base = useId();
  const rowsRef = useRef<HTMLDivElement>(null);
  const valueAt = (i: number) => values[i] ?? '';

  const set = (i: number, v: string) => {
    const next = fill.cells.map((_, k) => valueAt(k));
    next[i] = v;
    onChange(next);
  };

  /** 焦點移到第 i 列（選中的那一顆，沒有就第一顆）；超過最後一列就不動。 */
  const focusRow = (i: number) => {
    const row = rowsRef.current?.querySelectorAll<HTMLElement>('[data-fill-row]')[i];
    const target = row?.querySelector<HTMLInputElement>('input:checked') ?? row?.querySelector<HTMLInputElement>('input');
    target?.focus();
  };

  const onRowKeyDown = (i: number) => (e: KeyboardEvent<HTMLFieldSetElement>) => {
    if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const v = /^[0-9]$/.test(e.key) ? e.key : KEY_TO_VALUE[e.key];
    if (v !== undefined) {
      e.preventDefault();
      set(i, v);
      // 等 React 畫好新的勾選狀態再移焦點，下一列的「選中的那一顆」才會是對的。
      requestAnimationFrame(() => focusRow(Math.min(i + 1, fill.cells.length - 1)));
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      set(i, '');
    }
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 text-sm">
        <span className="text-muted">作答格式</span>
        <span className="min-w-0 text-base" aria-hidden="true">
          <Tex tex={fillFormatLatex(fill)} />
        </span>
        <span className="sr-only">本題有 {fill.cells.length} 格：{fill.cells.join('、')}</span>
      </div>
      <div ref={rowsRef} className="space-y-2">
        {fill.cells.map((cell, i) => {
          const value = valueAt(i);
          const expected = fill.answer_cells[cell] ?? '';
          const ok = value === expected;
          return (
            <fieldset key={cell} data-fill-row onKeyDown={onRowKeyDown(i)} className="min-w-0" disabled={disabled}>
              <legend className="sr-only">
                第 {label} 題第 {cell} 格，{value === '' ? '尚未劃記' : `目前 ${fillCellDisplay(value)}`}
              </legend>
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <span aria-hidden="true" className="w-12 shrink-0 pt-2 text-sm font-semibold tabular-nums text-muted">
                  {cell}
                </span>
                <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
                  {FILL_CELL_VALUES.map((v) => {
                    const checked = value === v;
                    let tone = 'border-line has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary';
                    if (showFeedback && v === expected) tone = 'border-ok bg-ok/15 text-ok has-[:checked]:bg-ok has-[:checked]:text-on-primary';
                    else if (showFeedback && checked) tone = 'border-bad bg-bad text-on-primary';
                    return (
                      <label
                        key={v}
                        className={`flex size-9 items-center justify-center rounded-full border text-sm font-semibold tabular-nums select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${tone} ${disabled ? 'cursor-default' : 'cursor-pointer hover:border-primary'}`}
                      >
                        <input
                          type="radio"
                          name={`${base}-${cell}`}
                          value={v}
                          checked={checked}
                          onChange={() => set(i, v)}
                          className="sr-only"
                          aria-label={v === '-' ? '負號' : v === '±' ? '正負號' : v}
                        />
                        <span aria-hidden="true">{fillCellDisplay(v)}</span>
                      </label>
                    );
                  })}
                </div>
                {!disabled && value !== '' && (
                  <button
                    type="button"
                    onClick={() => set(i, '')}
                    className="min-h-9 rounded-full px-2 text-xs text-primary underline underline-offset-2"
                    aria-label={`清除第 ${cell} 格`}
                  >
                    清除
                  </button>
                )}
                {showFeedback && (
                  <span className={`self-center text-xs font-semibold ${ok ? 'text-ok' : 'text-bad'}`}>
                    {ok ? '✓' : `✗ 正確：${fillCellDisplay(expected)}`}
                  </span>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" aria-live="polite">
        <span className="text-muted">你的答案</span>
        <span className="text-base">
          <Tex tex={`\\displaystyle ${fillAnswerLatex(fill, values)}`} />
        </span>
      </p>
      {!disabled && (
        <p className="text-xs text-muted">點選每一格的數字或符號；焦點在某一格時也可以直接按鍵盤的數字或減號，會自動跳到下一格。</p>
      )}
    </div>
  );
}
