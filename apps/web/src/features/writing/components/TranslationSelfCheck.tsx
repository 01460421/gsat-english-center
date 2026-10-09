/**
 * 中譯英自我檢核（不用 AI、任何人都能用）：本站自己寫的檢核清單＋程式能判斷的機械性問題＋依「每錯一處扣 0.5」的自評分。
 * 不顯示任何官方參考答案（D8）。
 */
import { TRANSLATION_DEDUCTION_STEP, TRANSLATION_SENTENCE_MAX } from '@gsat/shared';
import { Minus, Plus } from 'lucide-react';
import { useId } from 'react';
import { TRANSLATION_CHECKLIST } from '../lib/checklists';
import { formatScore } from '../lib/format';
import { checkTranslationSentence, mechanicsMessages } from '../lib/text';
import { card } from './ui';

/** 自評分：每句 max 分（現制 4 分）、每個錯誤扣 0.5，最低 0。 */
export function selfScoreOf(errorCount: number, max: number = TRANSLATION_SENTENCE_MAX): number {
  return Math.max(0, max - TRANSLATION_DEDUCTION_STEP * Math.max(0, Math.floor(errorCount)));
}

export function TranslationSelfCheck({
  texts,
  checked,
  errorCounts,
  maxPoints = [],
  onToggle,
  onErrorCount,
}: {
  texts: string[];
  checked: readonly string[];
  errorCounts: readonly number[];
  /** 每句滿分（題本的配分；沒給＝現制 4 分）。 */
  maxPoints?: readonly number[];
  onToggle: (id: string) => void;
  onErrorCount: (sentence: number, count: number) => void;
}) {
  const baseId = useId();
  const maxOf = (i: number) => maxPoints[i] ?? TRANSLATION_SENTENCE_MAX;
  const total = texts.reduce((n, _, i) => n + selfScoreOf(errorCounts[i] ?? 0, maxOf(i)), 0);
  const maxTotal = texts.reduce((n, _, i) => n + maxOf(i), 0);
  return (
    <section aria-labelledby={`${baseId}-h`} className={`space-y-4 ${card}`}>
      <div>
        <h2 id={`${baseId}-h`} className="text-lg font-semibold">
          自我檢核
        </h2>
        <p className="mt-1 text-sm text-muted">
          對照下面的清單逐項檢查自己的譯文，勾選已檢查過的項目；找到錯誤就修正，或記下錯誤數，系統依「每個錯誤扣 0.5 分」算出自評分。
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">程式幫你找到的</h3>
        <ul className="space-y-1 text-[0.95rem]">
          {texts.map((t, i) => {
            const c = checkTranslationSentence(t);
            const msgs = c.empty ? ['還沒有作答'] : mechanicsMessages(c.mechanics);
            return (
              <li key={i}>
                <span className="font-medium">第 {i + 1} 句：</span>
                {msgs.length === 0 ? <span className="text-ok">大小寫、句尾標點看起來沒問題</span> : <span className="text-bad">{msgs.join('；')}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-semibold">檢核清單（{checked.length}／{TRANSLATION_CHECKLIST.length}）</legend>
        <ul className="space-y-2">
          {TRANSLATION_CHECKLIST.map((item) => {
            const id = `${baseId}-${item.id}`;
            return (
              <li key={item.id} className="rounded-xl border border-line p-3">
                <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
                  <input id={id} type="checkbox" checked={checked.includes(item.id)} onChange={() => onToggle(item.id)} className="mt-1 size-5 shrink-0 accent-primary" />
                  <span className="min-w-0">
                    <span className="font-medium">{item.title}</span>
                    <span className="block text-[0.95rem]">{item.detail}</span>
                    {item.example && (
                      <span lang="en" className="mt-1 block break-words text-sm text-muted">
                        例：{item.example}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="space-y-2">
        <h3 className="font-semibold">自評分數</h3>
        <ul className="space-y-2">
          {texts.map((_, i) => {
            const count = errorCounts[i] ?? 0;
            return (
              <li key={i} className="flex flex-wrap items-center gap-3">
                <span className="w-16 shrink-0">第 {i + 1} 句</span>
                <span className="inline-flex items-center gap-1" role="group" aria-label={`第 ${i + 1} 句找到的錯誤數`}>
                  <button
                    type="button"
                    onClick={() => onErrorCount(i, Math.max(0, count - 1))}
                    disabled={count === 0}
                    aria-label="少一個錯誤"
                    className="inline-flex size-9 items-center justify-center rounded-full border border-line disabled:opacity-40"
                  >
                    <Minus aria-hidden="true" className="size-4" />
                  </button>
                  <span className="w-20 text-center tabular-nums" aria-live="polite">
                    {count} 個錯誤
                  </span>
                  <button
                    type="button"
                    onClick={() => onErrorCount(i, Math.min(10, count + 1))}
                    disabled={count >= 10}
                    aria-label="多一個錯誤"
                    className="inline-flex size-9 items-center justify-center rounded-full border border-line disabled:opacity-40"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </button>
                </span>
                <span className="tabular-nums text-muted">
                  ＝ {formatScore(selfScoreOf(count, maxOf(i)))}／{maxOf(i)} 分
                </span>
              </li>
            );
          })}
        </ul>
        <p className="font-semibold tabular-nums">
          自評總分：{formatScore(total)}／{maxTotal}
        </p>
        <p className="text-sm text-muted">
          實際閱卷每句切成 4 個部分各自扣分、相同的錯誤只扣一次、大小寫與標點整句只扣一次，所以這只是粗估。
        </p>
      </div>
    </section>
  );
}
