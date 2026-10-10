/**
 * 作文範文（穩健版、頂標版；SPEC §6.9）：依單一換行分段（README §3.6），每段標段落功能；
 * 註解（轉承詞、細節句、個人經驗句、好用句型、片語）可以切換顯示，在原文上加底色，並在段落下方列出文字說明
 * （底色只是視覺輔助，說明清單才是給讀屏與色弱使用者的等價內容）。最後是本站標的分數。標示「AI 生成範文，僅供參考」。
 * 標題是 h4：一律放在 ModelTexts 的 h3「範文」底下。
 */
import { ESSAY_CRITERIA, ESSAY_CRITERION_LABELS, MODEL_TEXT_NOTE_KINDS, type ModelText, type ModelTextNote, type ModelTextNoteKind } from '@gsat/shared';
import { useId, useState, type ReactNode } from 'react';
import { MODEL_TEXT_LABELS, MODEL_TEXT_NOTE_CLASSES, MODEL_TEXT_NOTE_LABELS, MODEL_TEXT_NOTICE } from '../labels';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Span {
  start: number;
  end: number;
  note: ModelTextNote;
}

/** 註解在段落裡的位置（前後不能接英文字母，避免 so 對到 also）；找不到回 null。 */
function locate(paragraph: string, note: ModelTextNote): Span | null {
  const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(note.text)}(?![A-Za-z])`);
  const m = re.exec(paragraph);
  return m ? { start: m.index, end: m.index + note.text.length, note } : null;
}

/** 把段落切成片段：每一段標上覆蓋它的最短註解（轉承詞在細節句裡也看得出來）。 */
function marked(paragraph: string, spans: readonly Span[]): ReactNode[] {
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

export function ModelTextView({ model }: { model: ModelText }) {
  const baseId = useId();
  const [kinds, setKinds] = useState<ReadonlySet<ModelTextNoteKind>>(() => new Set(MODEL_TEXT_NOTE_KINDS));
  const paragraphs = model.text.split('\n').filter((p) => p.trim() !== '');
  const total = ESSAY_CRITERIA.reduce((n, c) => n + (model.self_assessment.scores[c] ?? 0), 0);
  // 每個註解只歸到第一個找得到它的段落。
  const placed = new Set<ModelTextNote>();
  const spansByParagraph = paragraphs.map((p) =>
    model.notes.flatMap((note) => {
      if (placed.has(note)) return [];
      const span = locate(p, note);
      if (!span) return [];
      placed.add(note);
      return [span];
    }),
  );
  const toggle = (k: ModelTextNoteKind) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <section aria-labelledby={`${baseId}-h`} className="space-y-3 rounded-xl border border-line p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`${baseId}-h`} className="text-lg font-semibold">
          {MODEL_TEXT_LABELS[model.label]}
        </h4>
        <span className="rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">{MODEL_TEXT_NOTICE}</span>
      </div>
      <fieldset>
        <legend className="text-sm text-muted">標示</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {MODEL_TEXT_NOTE_KINDS.map((k) => (
            <label
              key={k}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 text-sm has-[:checked]:border-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
            >
              <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} className="size-4 accent-primary" />
              <span className={`rounded-sm px-1 ${MODEL_TEXT_NOTE_CLASSES[k]}`}>{MODEL_TEXT_NOTE_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {paragraphs.map((p, i) => {
        const fn = model.paragraphs[i];
        const spans = (spansByParagraph[i] ?? []).filter((s) => kinds.has(s.note.kind));
        return (
          <div key={i} className="space-y-1.5">
            <p className="text-sm font-semibold text-primary">
              第 {i + 1} 段{fn ? `：${fn.function_zh}` : ''}
            </p>
            <p lang="en" className="break-words leading-relaxed">
              {marked(p, spans)}
            </p>
            {spans.length > 0 && (
              <ul className="space-y-0.5 text-sm text-muted" aria-label={`第 ${i + 1} 段的標示說明`}>
                {[...spans]
                  .sort((a, b) => a.start - b.start)
                  .map((s) => (
                    <li key={`${s.note.kind}-${s.start}`} className="break-words">
                      <span className="font-medium text-fg">{MODEL_TEXT_NOTE_LABELS[s.note.kind]}</span>
                      ：<span lang="en">{s.note.text.length > 48 ? `${s.note.text.slice(0, 48)}…` : s.note.text}</span>—{s.note.zh}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        );
      })}
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <p className="font-semibold tabular-nums">本站標的分數：{total}／20</p>
        <p className="mt-0.5 tabular-nums text-muted">{ESSAY_CRITERIA.map((c) => `${ESSAY_CRITERION_LABELS[c]} ${model.self_assessment.scores[c]}`).join('・')}</p>
        <p className="mt-1">{model.self_assessment.explanation_zh}</p>
      </div>
    </section>
  );
}
