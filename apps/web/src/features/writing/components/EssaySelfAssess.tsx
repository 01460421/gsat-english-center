/**
 * 作文的自我檢核與看分數前自評（不用 AI）：檢核清單＋四項（內容、組織、文法句構、字彙拼字）各 0–5 分。
 * 自評會隨 AI 批改一起送出（UpdateSubmissionBody.self_assess），結果頁對照「你的自評」。
 */
import { ESSAY_CRITERIA, ESSAY_CRITERION_LABELS, ESSAY_CRITERION_MAX, essayBandOf } from '@gsat/shared';
import { useId } from 'react';
import { ESSAY_CHECKLIST } from '../lib/checklists';
import { completeEssayScores, type PartialEssayScores } from '../lib/drafts';
import { bandLabel } from '../lib/format';
import { card } from './ui';

/** 官方四項的白話說明（本站整理，不是評分原則原文）。 */
const CRITERION_HINTS: Record<(typeof ESSAY_CRITERIA)[number], string> = {
  content: '切題、內容充實、有具體例子或經驗。',
  organization: '段落分明、有主題句與結論、前後連貫。',
  grammar: '句子正確、句型有變化。',
  vocabulary: '用字恰當多樣、拼字與大小寫正確。',
};

export function EssaySelfAssess({
  scores,
  checked,
  onScores,
  onToggle,
}: {
  scores: PartialEssayScores | null;
  checked: readonly string[];
  onScores: (scores: PartialEssayScores | null) => void;
  onToggle: (id: string) => void;
}) {
  const baseId = useId();
  const complete = completeEssayScores(scores);
  const total = complete ? ESSAY_CRITERIA.reduce((n, c) => n + complete[c], 0) : null;
  const missing = ESSAY_CRITERIA.filter((c) => typeof scores?.[c] !== 'number').length;
  const setScore = (criterion: (typeof ESSAY_CRITERIA)[number], value: number) => onScores({ ...(scores ?? {}), [criterion]: value });
  return (
    <section aria-labelledby={`${baseId}-h`} className={`space-y-4 ${card}`}>
      <div>
        <h2 id={`${baseId}-h`} className="text-lg font-semibold">
          自我檢核與自評
        </h2>
        <p className="mt-1 text-sm text-muted">送出前先自己檢查一遍，再依四項評分面向給自己打分數（不用 AI、不花點數）。送 AI 批改時會一起附上，結果頁可以對照。</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-semibold">檢核清單（{checked.length}／{ESSAY_CHECKLIST.length}）</legend>
        <ul className="space-y-2">
          {ESSAY_CHECKLIST.map((item) => {
            const id = `${baseId}-${item.id}`;
            return (
              <li key={item.id} className="rounded-xl border border-line p-3">
                <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
                  <input id={id} type="checkbox" checked={checked.includes(item.id)} onChange={() => onToggle(item.id)} className="mt-1 size-5 shrink-0 accent-primary" />
                  <span className="min-w-0">
                    <span className="font-medium">{item.title}</span>
                    <span className="block text-[0.95rem]">{item.detail}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="space-y-3">
        <h3 className="font-semibold">自評分數（各 0–5 分）</h3>
        {ESSAY_CRITERIA.map((c) => (
          <fieldset key={c}>
            <legend className="text-[0.95rem]">
              <span className="font-medium">{ESSAY_CRITERION_LABELS[c]}</span>
              <span className="ml-2 text-sm text-muted">{CRITERION_HINTS[c]}</span>
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {Array.from({ length: ESSAY_CRITERION_MAX[c] + 1 }, (_, v) => (
                <label
                  key={v}
                  className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full border border-line tabular-nums has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
                >
                  <input type="radio" name={`${baseId}-${c}`} value={v} checked={scores?.[c] === v} onChange={() => setScore(c, v)} className="sr-only" />
                  {v}
                  <span className="sr-only"> 分</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {scores && (
          <p className="tabular-nums" aria-live="polite">
            {total !== null ? (
              <span className="font-semibold">
                自評總分：{total}／20（{bandLabel(essayBandOf(total))}）
              </span>
            ) : (
              <span className="text-muted">還有 {missing} 項沒有評分（四項都評完才會附在批改上）</span>
            )}
            <button type="button" onClick={() => onScores(null)} className="ml-3 text-sm text-primary underline underline-offset-2">
              清除自評
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
