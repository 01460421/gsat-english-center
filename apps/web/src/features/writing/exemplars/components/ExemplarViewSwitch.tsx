/**
 * 「逐篇｜逐段對照」（docs/design/model-essays.md §1.8 第 4 點、§8.5）：role="radiogroup" 的兩個選項（原生 radio，方向鍵切換），
 * 記在網址 ?view=。切換後焦點留在切換鈕上，aria-live 播報「已切換成逐段對照」。
 * 旁邊是亮點標示的開關（aria-pressed）與種類（打開時才列出）。
 */
import { MODEL_TEXT_NOTE_KINDS, type ModelTextNoteKind } from '@gsat/shared';
import { Highlighter } from 'lucide-react';
import { useId, useState } from 'react';
import { NoteKindToggles, toggleKind } from '../../components/AnnotatedEssayText';
import type { HighlightState } from './ExemplarEssays';

export type ExemplarViewMode = 'essay' | 'paragraph';

const VIEW_LABELS: Record<ExemplarViewMode, string> = { essay: '逐篇', paragraph: '逐段對照' };

const pill =
  'inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:font-semibold has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary';

export function ExemplarViewSwitch({ value, onChange }: { value: ExemplarViewMode; onChange: (mode: ExemplarViewMode) => void }) {
  const id = useId();
  const [said, setSaid] = useState('');
  return (
    <div>
      <div role="radiogroup" aria-labelledby={`${id}-l`} className="flex flex-wrap items-center gap-2">
        <span id={`${id}-l`} className="text-sm font-semibold">
          檢視
        </span>
        {(['essay', 'paragraph'] as const).map((m) => (
          <label key={m} className={pill}>
            <input
              type="radio"
              name={`${id}-view`}
              className="sr-only"
              checked={value === m}
              onChange={() => {
                onChange(m);
                setSaid(`已切換成${VIEW_LABELS[m]}`);
              }}
            />
            {VIEW_LABELS[m]}
          </label>
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

/** 亮點標示：整個開關（aria-pressed）＋打開時的五種勾選。 */
export function HighlightControls({ value, onChange }: { value: HighlightState; onChange: (next: HighlightState) => void }) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-pressed={value.on}
        onClick={() => onChange({ ...value, on: !value.on })}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm aria-pressed:border-primary aria-pressed:font-semibold aria-pressed:text-primary"
      >
        <Highlighter aria-hidden="true" className="size-4" />
        標示亮點
      </button>
      {value.on && (
        <NoteKindToggles
          legend="標示哪幾種"
          kinds={value.kinds}
          onToggle={(k: ModelTextNoteKind) => onChange({ ...value, kinds: toggleKind(value.kinds, k) })}
        />
      )}
    </div>
  );
}

export const ALL_NOTE_KINDS: ReadonlySet<ModelTextNoteKind> = new Set(MODEL_TEXT_NOTE_KINDS);
