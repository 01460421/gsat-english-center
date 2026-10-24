/**
 * 有標示的英文範文（從 bank/components/ModelTextView.tsx 抽出來的共用元件；docs/design/model-essays.md §8.2）。
 * 本站仿真作文的兩篇範文（ModelTextView）與作文範文的三個層級（features/writing/exemplars/）共用同一套：
 *
 *   - placeNotes：每個註解只歸到第一個找得到它的段落（前後不能接英文字母，避免 so 對到 also）；
 *   - NoteKindToggles：五種標示（轉承詞、細節句、個人經驗句、好用句型、片語）的勾選；
 *   - AnnotatedParagraph：一段英文，在原文上加底色（<mark data-kind>），並在段落下方列出文字說明
 *     （底色只是視覺輔助，說明清單才是給讀屏與色弱使用者的等價內容）。
 * 輸出的 DOM 和抽出之前的 ModelTextView 逐字相同（ModelTextView.test.tsx 釘住）。
 */
import { MODEL_TEXT_NOTE_KINDS, type ModelTextNote, type ModelTextNoteKind } from '@gsat/shared';
import type { ReactNode } from 'react';
import { MODEL_TEXT_NOTE_CLASSES, MODEL_TEXT_NOTE_LABELS } from '../bank/labels';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface NoteSpan {
  start: number;
  end: number;
  note: ModelTextNote;
}

/** 註解在段落裡的位置（前後不能接英文字母，避免 so 對到 also）；找不到回 null。 */
export function locateNote(paragraph: string, note: ModelTextNote): NoteSpan | null {
  const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(note.text)}(?![A-Za-z])`);
  const m = re.exec(paragraph);
  return m ? { start: m.index, end: m.index + note.text.length, note } : null;
}

/** 每個註解只歸到第一個找得到它的段落；回傳每一段的位置清單（和 paragraphs 一一對應）。 */
export function placeNotes(paragraphs: readonly string[], notes: readonly ModelTextNote[]): NoteSpan[][] {
  const placed = new Set<ModelTextNote>();
  return paragraphs.map((p) =>
    notes.flatMap((note) => {
      if (placed.has(note)) return [];
      const span = locateNote(p, note);
      if (!span) return [];
      placed.add(note);
      return [span];
    }),
  );
}

/** 把段落切成片段：每一段標上覆蓋它的最短註解（轉承詞在細節句裡也看得出來）。 */
export function markedText(paragraph: string, spans: readonly NoteSpan[]): ReactNode[] {
  const cuts = [...new Set([0, paragraph.length, ...spans.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    const covering = spans.filter((s) => s.start <= a && s.end >= b).sort((x, y) => x.end - x.start - (y.end - y.start));
    const top = covering[0];
    const piece = paragraph.slice(a, b);
    out.push(
      top ? (
        <mark key={a} data-kind={top.note.kind} className={`rounded-sm px-0.5 ${MODEL_TEXT_NOTE_CLASSES[top.note.kind]}`}>
          {piece}
        </mark>
      ) : (
        piece
      ),
    );
  }
  return out;
}

/** 勾選要顯示哪幾種標示（每一種一個 checkbox，標籤本身帶那一種的底色）。 */
export function NoteKindToggles({
  kinds,
  onToggle,
  legend = '標示',
}: {
  kinds: ReadonlySet<ModelTextNoteKind>;
  onToggle: (kind: ModelTextNoteKind) => void;
  legend?: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm text-muted">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {MODEL_TEXT_NOTE_KINDS.map((k) => (
          <label
            key={k}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-sm has-[:checked]:border-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
          >
            <input type="checkbox" checked={kinds.has(k)} onChange={() => onToggle(k)} className="size-4 accent-primary" />
            <span className={`rounded-sm px-1 ${MODEL_TEXT_NOTE_CLASSES[k]}`}>{MODEL_TEXT_NOTE_LABELS[k]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 切換某一種標示（回傳新的集合）。 */
export function toggleKind(prev: ReadonlySet<ModelTextNoteKind>, k: ModelTextNoteKind): ReadonlySet<ModelTextNoteKind> {
  const next = new Set(prev);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  return next;
}

/** 段落下方的標示說明清單（依出現順序；引文超過 48 個字元截短）。 */
export function NoteList({ spans, label }: { spans: readonly NoteSpan[]; label: string }) {
  if (spans.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-sm text-muted" aria-label={label}>
      {[...spans]
        .sort((a, b) => a.start - b.start)
        .map((s) => (
          <li key={`${s.note.kind}-${s.start}`} className="break-words">
            <span className="font-medium text-fg">{MODEL_TEXT_NOTE_LABELS[s.note.kind]}</span>
            ：<span lang="en">{s.note.text.length > 48 ? `${s.note.text.slice(0, 48)}…` : s.note.text}</span>—{s.note.zh}
          </li>
        ))}
    </ul>
  );
}

/**
 * 一段有標示的英文：標題列（heading，例如「第 1 段：…」）、原文（只標 kinds 裡的種類）、下方的說明清單。
 * spans 是這一段全部的位置（placeNotes 的結果），這裡依 kinds 過濾。
 */
export function AnnotatedParagraph({
  paragraph,
  spans,
  kinds,
  heading,
  listLabel,
}: {
  paragraph: string;
  spans: readonly NoteSpan[];
  kinds: ReadonlySet<ModelTextNoteKind>;
  heading: ReactNode;
  /** 說明清單的可存取名稱（「第 1 段的標示說明」）。 */
  listLabel: string;
}) {
  const shown = spans.filter((s) => kinds.has(s.note.kind));
  return (
    <div className="space-y-1.5">
      {heading}
      <p lang="en" className="break-words leading-relaxed">
        {markedText(paragraph, shown)}
      </p>
      <NoteList spans={shown} label={listLabel} />
    </div>
  );
}
