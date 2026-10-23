/**
 * 單字錯題本的「一次解析這幾個字」（docs/design/learning-assistant.md §1.4、§2.8）：多選，預設勾錯最多次的 8 個，
 * 一次最多 8 個字；按下去到確認頁（點數只在確認頁顯示，§1.4）。開關關著時 render null（錯題本的畫面不變）。
 */
import { ASSIST_LIMITS, assistAskHref } from '@gsat/shared';
import { MessageCircleQuestionMark } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { MistakeItem } from '../../vocab/lib/mistakes';
import { useAssistantEnabled } from '../lib/useAssistantEnabled';

export function AskVocabBatch({ items }: { items: readonly MistakeItem[] }) {
  const enabled = useAssistantEnabled();
  const id = useId();
  const max = ASSIST_LIMITS.vocabEntriesMax;
  const shown = items.slice(0, 20);
  const [chosen, setChosen] = useState<string[]>(() => shown.slice(0, max).map((i) => i.entry_id));
  if (!enabled || shown.length === 0) return null;
  const valid = chosen.filter((c) => shown.some((i) => i.entry_id === c));
  const full = valid.length >= max;
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <h2 id={`${id}-h`} className="font-semibold">
        請學習助手一次解析這幾個字
      </h2>
      <p className="text-sm text-muted">一次最多 {max} 個字：依易混字分組，說明字義、搭配、詞類變化與記法。預設勾錯最多次的字。</p>
      <ul className="flex flex-wrap gap-2">
        {shown.map((item) => {
          const checked = valid.includes(item.entry_id);
          return (
            <li key={item.entry_id}>
              <label
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 ${checked ? 'border-primary bg-primary-soft' : 'border-line'} ${!checked && full ? 'opacity-60' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setChosen((cur) => (on ? [...cur, item.entry_id] : cur.filter((c) => c !== item.entry_id)));
                  }}
                  className="size-4 accent-[var(--primary)]"
                />
                <span lang="en">{item.word}</span>
                <span className="text-xs text-muted">錯 {item.wrong_count} 次</span>
              </label>
            </li>
          );
        })}
      </ul>
      {valid.length > 0 ? (
        <Link
          to={assistAskHref({ src: 'vocab', entries: valid })}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary"
        >
          <MessageCircleQuestionMark aria-hidden="true" className="size-4" />
          一次解析這 {valid.length} 個字
        </Link>
      ) : (
        <p className="text-sm text-muted">至少勾一個字。</p>
      )}
    </section>
  );
}
