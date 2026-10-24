/**
 * 基礎版「這個等級常見的錯（範文裡沒有，寫的時候注意）」（docs/design/model-essays.md §1.8 第 5 點、§2.3、§8.5）。
 * 這是整個功能唯一刻意給學生看的錯誤英文，所以**不只靠顏色或刪除線**：
 *   - 「✗ 錯誤示範」文字標籤＋錯句（<del>，前面另有 sr-only「錯誤的寫法：」；樣式沿用批改結果頁錯誤清單的刪除線與底色）；
 *   - 「✓ 正確」文字標籤＋改正句；
 *   - 「規則」＋說明。
 * 列印時同樣的文字標籤照印（黑白也分得出）。英文句子包 lang="en"。
 */
import type { ExemplarSetView } from '@gsat/shared';
import { useId } from 'react';
import { RIGHT_LABEL, RULE_LABEL, TYPICAL_ERRORS_TITLE, WRONG_LABEL, WRONG_SR } from '../labels';

export function ExemplarTypicalErrors({ errors, headingLevel = 4 }: { errors: ExemplarSetView['typical_errors']; headingLevel?: 3 | 4 }) {
  const id = useId();
  if (errors.length === 0) return null;
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <section aria-labelledby={id} className="space-y-2 rounded-xl border border-line p-3 lg:p-4" data-typical-errors="">
      <Heading id={id} className="font-semibold">
        {TYPICAL_ERRORS_TITLE}
      </Heading>
      <ol className="space-y-3">
        {errors.map((t, i) => (
          <li key={i} className="space-y-1 rounded-xl border border-line p-3 text-[0.95rem]">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="shrink-0 rounded-full bg-bad/15 px-2 py-0.5 text-sm font-semibold text-bad">{WRONG_LABEL}</span>
              <span className="sr-only">{WRONG_SR}</span>
              <del lang="en" className="rounded-sm bg-bad/10 px-1 break-words decoration-bad/60">
                {t.wrong}
              </del>
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="shrink-0 rounded-full bg-ok/15 px-2 py-0.5 text-sm font-semibold">{RIGHT_LABEL}</span>
              <span lang="en" className="rounded-sm bg-ok/10 px-1 break-words">
                {t.right}
              </span>
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="shrink-0 font-semibold">{RULE_LABEL}</span>
              <span className="min-w-0 break-words">{t.zh}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
