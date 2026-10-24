/**
 * 作文範文（穩健版、頂標版；SPEC §6.9）：依單一換行分段（README §3.6），每段標段落功能；
 * 註解（轉承詞、細節句、個人經驗句、好用句型、片語）可以切換顯示，在原文上加底色，並在段落下方列出文字說明
 * （底色只是視覺輔助，說明清單才是給讀屏與色弱使用者的等價內容）。最後是本站標的分數。標示「AI 生成範文，僅供參考」。
 * 標題是 h4：一律放在 ModelTexts 的 h3「範文」底下。
 * 標示的定位、底色與說明清單在 components/AnnotatedEssayText.tsx（作文範文的三個層級共用；抽出前後輸出相同）。
 */
import { ESSAY_CRITERIA, ESSAY_CRITERION_LABELS, MODEL_TEXT_NOTE_KINDS, type ModelText, type ModelTextNoteKind } from '@gsat/shared';
import { useId, useState } from 'react';
import { AnnotatedParagraph, NoteKindToggles, placeNotes, toggleKind } from '../../components/AnnotatedEssayText';
import { MODEL_TEXT_LABELS, MODEL_TEXT_NOTICE } from '../labels';

export function ModelTextView({ model }: { model: ModelText }) {
  const baseId = useId();
  const [kinds, setKinds] = useState<ReadonlySet<ModelTextNoteKind>>(() => new Set(MODEL_TEXT_NOTE_KINDS));
  const paragraphs = model.text.split('\n').filter((p) => p.trim() !== '');
  const total = ESSAY_CRITERIA.reduce((n, c) => n + (model.self_assessment.scores[c] ?? 0), 0);
  // 每個註解只歸到第一個找得到它的段落。
  const spansByParagraph = placeNotes(paragraphs, model.notes);
  return (
    <section aria-labelledby={`${baseId}-h`} className="space-y-3 rounded-xl border border-line p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`${baseId}-h`} className="text-lg font-semibold">
          {MODEL_TEXT_LABELS[model.label]}
        </h4>
        <span className="rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">{MODEL_TEXT_NOTICE}</span>
      </div>
      <NoteKindToggles kinds={kinds} onToggle={(k) => setKinds((prev) => toggleKind(prev, k))} />
      {paragraphs.map((p, i) => {
        const fn = model.paragraphs[i];
        return (
          <AnnotatedParagraph
            key={i}
            paragraph={p}
            spans={spansByParagraph[i] ?? []}
            kinds={kinds}
            listLabel={`第 ${i + 1} 段的標示說明`}
            heading={
              <p className="text-sm font-semibold text-primary">
                第 {i + 1} 段{fn ? `：${fn.function_zh}` : ''}
              </p>
            }
          />
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
