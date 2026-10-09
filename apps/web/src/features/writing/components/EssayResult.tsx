/**
 * 英文作文批改結果（EssayGradingResult）：四項（內容、組織、文法句構、字彙拼字）各 0–5、總分 20、等級；
 * 兩位評分者各自的分數與平均（第三位若有也列出）、各項說明、三個優先改進、逐段建議、原文上標出的錯誤、字數與分段扣分。
 * 「三個優先改進」以外的標註預設收合（SPEC §6.9：一次給太多回饋反而學不到）。
 */
import {
  ESSAY_CRITERIA,
  ESSAY_CRITERION_LABELS,
  ESSAY_CRITERION_MAX,
  ESSAY_MAX_SCORE,
  ESSAY_SHORT_WORDS,
  RATER_ROLES,
  type EssayDeduction,
  type EssayErrorCategory,
  type EssayGradingResult,
  type SelfAssessment,
} from '@gsat/shared';
import { useState } from 'react';
import { bandLabel, formatScore } from '../lib/format';
import { ERROR_CATEGORY_LABELS, HighlightedText, categoryClass, type MarkedError } from './HighlightedText';
import { RATER_LABELS } from './TranslationResult';
import { AiBadge, card } from './ui';

const DEDUCTION_TEXT: Record<EssayDeduction['code'], string> = {
  too_short: `字數明顯不足（少於 ${ESSAY_SHORT_WORDS} 個單詞）`,
  no_paragraphs: '未依規定分段',
};

/** 身心安全旗標：先顯示關懷訊息與求助資源（ARCHITECTURE §8.5），批改照常。 */
export function SafetyCare() {
  return (
    <section role="note" aria-labelledby="care-heading" className="rounded-2xl border border-primary/40 bg-primary-soft p-4 lg:p-5">
      <h2 id="care-heading" className="text-lg font-semibold">
        想找人聊聊嗎？
      </h2>
      <p className="mt-2 text-[0.95rem]">
        你的作文裡提到了一些可能讓你很辛苦的事。如果你正覺得難過、害怕，或有人傷害你，你不必一個人承受，可以找信任的家人、老師或輔導老師，也可以撥打免付費專線：
      </p>
      <ul className="mt-2 grid gap-1 text-[0.95rem] sm:grid-cols-2">
        <li>
          衛福部安心專線 <a href="tel:1925" className="font-semibold text-primary underline">1925</a>（24 小時）
        </li>
        <li>
          生命線 <a href="tel:1995" className="font-semibold text-primary underline">1995</a>
        </li>
        <li>
          張老師專線 <a href="tel:1980" className="font-semibold text-primary underline">1980</a>
        </li>
        <li>
          保護專線 <a href="tel:113" className="font-semibold text-primary underline">113</a>
        </li>
      </ul>
      <p className="mt-2 text-sm text-muted">下面的批改結果照常提供。</p>
    </section>
  );
}

interface NumberedEssayError extends MarkedError {
  index: number;
}

export function EssayResult({
  grading,
  text,
  selfAssess,
}: {
  grading: EssayGradingResult;
  text: string;
  selfAssess: SelfAssessment | null;
}) {
  const [filter, setFilter] = useState<EssayErrorCategory | 'all'>('all');
  const raters = [...grading.raters].sort((a, b) => RATER_ROLES.indexOf(a.role) - RATER_ROLES.indexOf(b.role));
  const selfScores = selfAssess?.kind === 'essay' ? selfAssess.scores : null;
  const selfTotal = selfScores ? ESSAY_CRITERIA.reduce((n, c) => n + selfScores[c], 0) : null;
  const errors: NumberedEssayError[] = grading.errors.map((e, index) => ({
    index,
    n: index + 1,
    start: e.start,
    end: e.end,
    excerpt: e.excerpt,
    category: e.category,
  }));
  const categories = [...new Set(grading.errors.map((e) => e.category))];
  const shown = errors.filter((e) => filter === 'all' || e.category === filter);
  const showSafety = grading.safety_flag !== null && grading.safety_flag !== 'none';
  const idPrefix = 'e-err';

  return (
    <div className="space-y-4">
      {showSafety && <SafetyCare />}

      <section aria-labelledby="e-total" className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="e-total" className="text-lg font-semibold">
            總分
          </h2>
          <AiBadge />
        </div>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 text-3xl font-bold tabular-nums">
          <span>
            {formatScore(grading.final_score)}
            <span className="text-lg font-medium text-muted"> ／ {grading.max_score || ESSAY_MAX_SCORE}</span>
          </span>
          <span className="text-lg font-semibold">等級：{bandLabel(grading.band)}</span>
        </p>
        {selfTotal !== null && <p className="mt-1 text-sm text-muted">你的自評：{selfTotal} 分</p>}
        {grading.off_topic && (
          <p className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">AI 判斷這篇作文離題（沒有回應題目的要求），依計分規則其他各項以 0 分計。</p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ESSAY_CRITERIA.map((c) => (
            <div key={c} className="rounded-xl bg-surface-2 px-3 py-2">
              <dt className="text-sm text-muted">{ESSAY_CRITERION_LABELS[c]}</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {formatScore(grading.criteria[c].score)}
                <span className="text-sm font-normal text-muted">／{ESSAY_CRITERION_MAX[c]}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted">
          字數 {grading.word_count} 個單詞・{grading.paragraphs} 段。
          {grading.deductions.length === 0
            ? '沒有字數或分段的扣分。'
            : `扣分：${grading.deductions.map((d) => `${DEDUCTION_TEXT[d.code]} 扣 ${formatScore(d.points)} 分`).join('；')}（兩者同時發生只扣 1 分）。`}
        </p>
      </section>

      {grading.top_improvements.length > 0 && (
        <section aria-labelledby="e-top" className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="e-top" className="text-lg font-semibold">
              先改這三個就好
            </h2>
            <AiBadge />
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {grading.top_improvements.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="e-criteria" className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="e-criteria" className="text-lg font-semibold">
            各項說明
          </h2>
          <AiBadge />
        </div>
        {grading.explanations_from_excluded_rater ? (
          <p className="mt-2 text-sm text-muted">
            給詳細說明的那位評分者，分數和另外兩位差距較大、沒有被採用，所以各項說明與改進建議已省略；請看下方各評分者的評語。
          </p>
        ) : null}
        <dl className="mt-2 space-y-3">
          {ESSAY_CRITERIA.map((c) => (
            <div key={c}>
              <dt className="font-semibold">
                {ESSAY_CRITERION_LABELS[c]}{' '}
                <span className="font-normal tabular-nums text-muted">
                  {formatScore(grading.criteria[c].score)}／{ESSAY_CRITERION_MAX[c]}
                  {selfScores ? `（自評 ${selfScores[c]}）` : ''}
                </span>
              </dt>
              <dd className="mt-0.5 text-[0.95rem]">{grading.criteria[c].explanation_zh}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="e-raters" className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="e-raters" className="text-lg font-semibold">
            評分者
          </h2>
          <AiBadge />
        </div>
        <p className="mt-1 text-sm text-muted">
          兩位 AI 評分者各自評分，最後分數取平均{grading.third_rater_used ? '；兩位差距過大，加了第三位，取最接近的兩個平均' : ''}。
        </p>
        <div className="mt-2 overflow-x-auto" role="region" aria-label="各評分者分數" tabIndex={0}>
          <table className="w-full min-w-[22rem] border-collapse text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="py-1 pr-3 font-medium">
                  評分者
                </th>
                {ESSAY_CRITERIA.map((c) => (
                  <th key={c} scope="col" className="py-1 pr-3 font-medium">
                    {ESSAY_CRITERION_LABELS[c]}
                  </th>
                ))}
                <th scope="col" className="py-1 font-medium">
                  總分
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {raters.map((r) => (
                <tr key={r.role} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-normal">
                    {RATER_LABELS[r.role]}
                    {r.off_topic ? '（判離題）' : ''}
                  </th>
                  {ESSAY_CRITERIA.map((c) => (
                    <td key={c} className="py-1 pr-3">
                      {r.scores[c]}
                    </td>
                  ))}
                  <td className="py-1">{formatScore(r.total)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <th scope="row" className="py-1 pr-3 text-left">
                  平均
                </th>
                {ESSAY_CRITERIA.map((c) => (
                  <td key={c} className="py-1 pr-3">
                    {formatScore(grading.criteria[c].score)}
                  </td>
                ))}
                <td className="py-1">{formatScore(grading.final_score)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-2">
          {raters
            .filter((r) => r.comment_zh)
            .map((r) => (
              <li key={r.role} className="text-[0.95rem]">
                <span className="font-semibold">{RATER_LABELS[r.role]}：</span>
                {r.comment_zh}
              </li>
            ))}
        </ul>
      </section>

      {grading.paragraph_advice.length > 0 && (
        <details className={card}>
          <summary className="cursor-pointer text-lg font-semibold">
            <span>逐段建議（{grading.paragraph_advice.length}）</span> <AiBadge />
          </summary>
          <ol className="mt-2 space-y-2">
            {[...grading.paragraph_advice]
              .sort((a, b) => a.paragraph_index - b.paragraph_index)
              .map((p) => (
                <li key={p.paragraph_index}>
                  <span className="font-semibold">第 {p.paragraph_index + 1} 段：</span>
                  {p.advice_zh}
                </li>
              ))}
          </ol>
        </details>
      )}

      <details className={card}>
        <summary className="cursor-pointer text-lg font-semibold">
          <span>標出的錯誤（{grading.errors.length}）</span> <AiBadge />
        </summary>
        {categories.length > 1 && (
          <div role="group" aria-label="依類型篩選" className="mt-3 flex flex-wrap gap-2">
            {(['all', ...categories] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={filter === c}
                onClick={() => setFilter(c)}
                className={`rounded-full border px-3 py-1 text-sm ${filter === c ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}
              >
                {c === 'all' ? '全部' : ERROR_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        )}
        <h3 className="mt-3 text-sm font-semibold text-muted">你的作文</h3>
        {text ? <HighlightedText text={text} errors={shown} idPrefix={idPrefix} className="mt-1" /> : <p className="mt-1 text-muted">（沒有內容）</p>}
        {shown.length > 0 && (
          <ol className="mt-3 space-y-2">
            {shown.map((e) => {
              const err = grading.errors[e.index];
              if (!err) return null;
              return (
                <li key={e.index} id={`${idPrefix}-${e.n}`} className="scroll-mt-20 rounded-xl border border-line p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold tabular-nums">{e.n}.</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${categoryClass(err.category)}`}>{ERROR_CATEGORY_LABELS[err.category]}</span>
                    <span className="text-xs text-muted">第 {err.paragraph_index + 1} 段</span>
                  </p>
                  <p className="mt-1 break-words" lang="en">
                    <span className="rounded-sm bg-bad/10 px-1 line-through decoration-bad/60">{err.excerpt}</span>
                    {err.suggestion && (
                      <>
                        <span aria-hidden="true" className="mx-1.5 text-muted">
                          →
                        </span>
                        <span className="sr-only">建議改成</span>
                        <span className="rounded-sm bg-ok/10 px-1 text-ok">{err.suggestion}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-sm">{err.explanation_zh}</p>
                </li>
              );
            })}
          </ol>
        )}
      </details>

      {grading.rewrite && (
        <details className={card}>
          <summary className="cursor-pointer text-lg font-semibold">
            保留原意的參考改寫 <AiBadge />
          </summary>
          <p lang="en" className="mt-2 whitespace-pre-wrap break-words">
            {grading.rewrite}
          </p>
        </details>
      )}
    </div>
  );
}
