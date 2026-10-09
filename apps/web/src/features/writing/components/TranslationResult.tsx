/**
 * 中譯英批改結果（TranslationGradingResult）：每句 0–4 分（0.5 為單位）、一組滿分 8；
 * 學生原文上加亮錯誤，下方列出類別、說明（explanation_zh）、建議改法與實際扣分；兩位（必要時三位）評分者的分數。
 * 分數由 Worker 依官方規則計算（writing.ts 檔頭）；這裡只負責呈現。不顯示任何官方參考譯文（D8）。
 */
import {
  RATER_ROLES,
  TRANSLATION_GROUP_MAX,
  TRANSLATION_SENTENCE_MAX,
  type RaterRole,
  type SelfAssessment,
  type TranslationBody,
  type TranslationError,
  type TranslationGradingResult,
} from '@gsat/shared';
import type { TranslationSet } from '../data';
import { formatScore } from '../lib/format';
import { ERROR_CATEGORY_LABELS, HighlightedText, categoryClass, type MarkedError } from './HighlightedText';
import { AiBadge, card } from './ui';

export const RATER_LABELS: Record<RaterRole, string> = {
  primary: '第一位評分者',
  second: '第二位評分者',
  third: '第三位評分者',
};

function sortRaters<T extends { role: RaterRole }>(raters: readonly T[]): T[] {
  return [...raters].sort((a, b) => RATER_ROLES.indexOf(a.role) - RATER_ROLES.indexOf(b.role));
}

interface NumberedError extends MarkedError {
  error: TranslationError;
  index: number;
}

function ErrorItem({ e, idPrefix }: { e: NumberedError; idPrefix: string }) {
  const { error } = e;
  return (
    <li id={`${idPrefix}-${e.n}`} className="scroll-mt-20 rounded-xl border border-line p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{e.n}.</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${categoryClass(error.category)}`}>{ERROR_CATEGORY_LABELS[error.category]}</span>
        {error.part !== null && <span className="text-xs text-muted">第 {error.part} 部分</span>}
        <span className="ml-auto text-xs tabular-nums text-muted">
          {error.deducted > 0 ? `扣 ${formatScore(error.deducted)} 分` : error.repeat_of !== null ? '同樣的錯誤只扣一次' : '不另扣分'}
        </span>
      </p>
      <p className="mt-1 break-words" lang="en">
        <span className="rounded-sm bg-bad/10 px-1 line-through decoration-bad/60">{error.excerpt}</span>
        {error.suggestion && (
          <>
            <span aria-hidden="true" className="mx-1.5 text-muted">
              →
            </span>
            <span className="sr-only">建議改成</span>
            <span className="rounded-sm bg-ok/10 px-1 text-ok">{error.suggestion}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-sm">{error.explanation_zh}</p>
    </li>
  );
}

export function TranslationResult({
  grading,
  body,
  set,
  selfAssess = null,
}: {
  grading: TranslationGradingResult;
  body: TranslationBody | null;
  set: TranslationSet | null;
  /** 送出前的自評（看分數前），結果頁對照用。 */
  selfAssess?: SelfAssessment | null;
}) {
  const raters = sortRaters(grading.raters);
  const selfScores = selfAssess?.kind === 'translation' ? selfAssess.sentence_scores : null;
  const selfTotal = selfScores ? selfScores.reduce((n, x) => n + x, 0) : null;
  const numbered: NumberedError[] = grading.errors.map((error, index) => ({
    error,
    index,
    n: index + 1,
    start: error.start,
    end: error.end,
    excerpt: error.excerpt,
    category: error.category,
  }));
  const sentenceCount = Math.max(grading.sentence_scores.length, body?.items.length ?? 0);
  return (
    <div className="space-y-4">
      <section aria-labelledby="t-total" className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="t-total" className="text-lg font-semibold">
            總分
          </h2>
          <AiBadge />
        </div>
        <p className="mt-2 text-3xl font-bold tabular-nums">
          {formatScore(grading.final_score)}
          <span className="text-lg font-medium text-muted"> ／ {grading.max_score || TRANSLATION_GROUP_MAX}</span>
        </p>
        {selfTotal !== null && <p className="mt-1 text-sm text-muted">你的自評：{formatScore(selfTotal)} 分</p>}
        <p className="mt-1 text-sm text-muted">
          每句 {TRANSLATION_SENTENCE_MAX} 分、切成 4 個語意單位，每個錯誤扣 0.5 分、同樣的錯誤只扣一次；句首大寫與標點由程式判定、整句只扣一次。
          分數是兩位 AI 評分者的平均{grading.third_rater_used ? '（兩位差距過大，加了第三位，取最接近的兩個平均）' : ''}。
        </p>
        {raters.length > 0 && (
          <div className="mt-3 overflow-x-auto" role="region" aria-label="各評分者分數" tabIndex={0}>
            <table className="w-full min-w-[18rem] border-collapse text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    評分者
                  </th>
                  {Array.from({ length: sentenceCount }, (_, i) => (
                    <th key={i} scope="col" className="py-1 pr-3 font-medium">
                      第 {i + 1} 句
                    </th>
                  ))}
                  <th scope="col" className="py-1 font-medium">
                    合計
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {raters.map((r) => (
                  <tr key={r.role} className="border-t border-line">
                    <th scope="row" className="py-1 pr-3 text-left font-normal">
                      {RATER_LABELS[r.role]}
                    </th>
                    {Array.from({ length: sentenceCount }, (_, i) => {
                      const s = r.sentences.find((x) => x.sentence_index === i);
                      return (
                        <td key={i} className="py-1 pr-3">
                          {s ? formatScore(s.score) : '—'}
                        </td>
                      );
                    })}
                    <td className="py-1">{formatScore(r.score)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <th scope="row" className="py-1 pr-3 text-left">
                    平均（最後分數）
                  </th>
                  {Array.from({ length: sentenceCount }, (_, i) => (
                    <td key={i} className="py-1 pr-3">
                      {grading.sentence_scores[i] !== undefined ? formatScore(grading.sentence_scores[i]) : '—'}
                    </td>
                  ))}
                  <td className="py-1">{formatScore(grading.final_score)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {Array.from({ length: sentenceCount }, (_, i) => {
        const text = body?.items[i]?.text ?? '';
        const errors = numbered.filter((e) => e.error.sentence_index === i);
        const prompt = set?.items[i];
        const score = grading.sentence_scores[i];
        const idPrefix = `t-err-${i}`;
        return (
          <section key={i} aria-labelledby={`t-s-${i}`} className={card}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 id={`t-s-${i}`} className="text-lg font-semibold">
                第 {i + 1} 句
              </h2>
              {score !== undefined && (
                <span className="tabular-nums text-muted">
                  {formatScore(score)}／{TRANSLATION_SENTENCE_MAX} 分
                  {selfScores?.[i] !== undefined ? `（自評 ${formatScore(selfScores[i])}）` : ''}
                </span>
              )}
              {/* 這張卡的分數、說明與錯誤清單都是 AI 寫的 */}
              <AiBadge />
            </div>
            {prompt && <p className="mt-1 text-sm text-muted">{prompt.stem}</p>}
            <h3 className="mt-3 text-sm font-semibold text-muted">你的譯文</h3>
            {text ? <HighlightedText text={text} errors={errors} idPrefix={idPrefix} className="mt-1" /> : <p className="mt-1 text-muted">（沒有內容）</p>}
            {grading.corrected[i] && (
              <>
                <h3 className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted">
                  保留你原意的修正版 <AiBadge />
                </h3>
                <p lang="en" className="mt-1 break-words rounded-lg bg-ok/10 px-3 py-2">
                  {grading.corrected[i]}
                </p>
              </>
            )}
            {grading.explanation_zh[i] && <p className="mt-3 text-sm">{grading.explanation_zh[i]}</p>}
            {errors.length > 0 ? (
              <>
                <h3 className="mt-3 text-sm font-semibold">錯誤（{errors.length}）</h3>
                <ol className="mt-2 space-y-2">
                  {errors.map((e) => (
                    <ErrorItem key={e.index} e={e} idPrefix={idPrefix} />
                  ))}
                </ol>
              </>
            ) : (
              <p className="mt-3 text-sm text-ok">這句沒有標出錯誤。</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
