/**
 * 本站仿真作文的「評分規準與範文」（docs/design/bank-writing.md §2.4 第 4 步）：交出作答之後才顯示。
 * 先看本題四項的評分重點與分數帶、扣分說明，自評四項（EssaySelfAssess 傳入本題的 criteria），
 * 範文收在下方展開（穩健版、頂標版，標「AI 生成範文，僅供參考」）。
 * 標題層級：外層是 h2「評分規準與範文」；評分項目、「自評四項」、「範文」是 h3；自評分數與每篇範文是 h4。
 */
import { ESSAY_CRITERIA, ESSAY_CRITERION_LABELS } from '@gsat/shared';
import { useId, useState } from 'react';
import { EssaySelfAssess } from '../../components/EssaySelfAssess';
import { card, secondaryButton } from '../../components/ui';
import type { PartialEssayScores } from '../../lib/drafts';
import type { BankEssayAnswersFile } from '../data';
import { MODEL_TEXT_NOTICE } from '../labels';
import { ModelTextView } from './ModelTextView';

/** 本題的評分規準：四項的重點與分數帶（手機上一項一張卡片，不用寬表格）。 */
export function EssayRubric({ answers }: { answers: BankEssayAnswersFile }) {
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 lg:grid-cols-2">
        {ESSAY_CRITERIA.map((c) => {
          const criterion = answers.criteria[c];
          return (
            <li key={c} className="rounded-xl border border-line p-3">
              <h3 className="font-semibold">{ESSAY_CRITERION_LABELS[c]}（0–5 分）</h3>
              <p className="mt-1 text-[0.95rem]">
                <span className="font-medium">本題重點：</span>
                {criterion.focus_zh}
              </p>
              <dl className="mt-2 space-y-1 text-sm">
                {criterion.bands.map((b) => (
                  <div key={`${b.min}-${b.max}`} className="flex gap-2">
                    <dt className="w-14 shrink-0 font-semibold tabular-nums">{b.min === b.max ? `${b.min} 分` : `${b.min}–${b.max} 分`}</dt>
                    <dd className="min-w-0 text-muted">{b.descriptor_zh}</dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">扣分：{answers.deductions_zh}</p>
    </div>
  );
}

/** 兩篇範文（收合）。標題 h3「範文」放在外層的 h2（「評分規準與範文」或結果頁的參考內容）底下，每篇範文是 h4。 */
export function ModelTexts({ answers }: { answers: BankEssayAnswersFile }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section aria-labelledby={`${panelId}-h`} className={`space-y-3 ${card}`}>
      <h3 id={`${panelId}-h`} className="text-lg font-semibold">
        範文
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryButton} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
          {open ? '收起範文' : '看範文（穩健版、頂標版）'}
        </button>
        <span className="rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">{MODEL_TEXT_NOTICE}</span>
      </div>
      {open && (
        <div id={panelId} className="space-y-3">
          <p className="text-sm text-muted">範文是 AI 依本題寫的參考，不是唯一的寫法；可以學它的段落安排、轉承詞與細節，不要整段背起來照抄。</p>
          {answers.model_texts.map((m) => (
            <ModelTextView key={m.label} model={m} />
          ))}
        </div>
      )}
    </section>
  );
}

export function EssayReveal({
  answers,
  selfScores,
  onScores,
}: {
  answers: BankEssayAnswersFile;
  selfScores: PartialEssayScores | null;
  onScores: (scores: PartialEssayScores | null) => void;
}) {
  return (
    <div className="space-y-4">
      <section aria-label="本題的評分規準" className={`space-y-3 ${card}`}>
        <p className="text-sm text-muted">
          學測作文看內容、組織、文法句構、字彙拼字四項，各 0–5 分。下面是本站為這一題寫的評分重點與分數帶（本站撰寫，不是大考中心的評分原則）。
        </p>
        <EssayRubric answers={answers} />
        {answers.explanation && (
          <details className="rounded-xl border border-line px-3">
            <summary className="cursor-pointer py-3 font-medium">審題重點</summary>
            <div className="space-y-1 pb-3 text-[0.95rem]">
              <p>{answers.explanation.explanation_zh}</p>
              {answers.explanation.strategy_zh && <p className="text-muted">策略：{answers.explanation.strategy_zh}</p>}
            </div>
          </details>
        )}
      </section>
      <EssaySelfAssess scores={selfScores} onScores={onScores} criteria={answers.criteria} headingLevel={3} />
      <ModelTexts answers={answers} />
    </div>
  );
}
