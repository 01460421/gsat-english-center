/**
 * 「懂了嗎」與「這則解析有錯」（docs/design/learning-assistant.md §1.7、§1.11）：存在案例上（PATCH），隨時可以改，
 * 也會影響學習報告（不懂的題目一定列入報告的疑點）。「這則解析有錯」寫 rating='wrong'：兩位學生在同一份共用解析按了，
 * 那份共用解析就停用。被撤銷 AI 核准的人仍然可以改（PATCH 只要登入）。
 *
 * 存檔中不停用單選鈕與按鈕（停用會讓有焦點的那一個把焦點丟到 body，鍵盤使用者每選一次就迷路一次）：
 * 外框標 aria-busy，存檔中又改了就排在後面，前一個 PATCH 回來再送最新的值（一次只送一個）。
 */
import { type AssistCaseDetail, type AssistRating, type AssistUnderstood } from '@gsat/shared';
import { Flag } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ErrorMessage } from '../../writing/components/ui';
import type { ErrorView } from '../../writing/lib/errors';
import { patchAssistCase } from '../lib/assistApi';
import { useAssistErrorView } from '../lib/pollers';

const OPTIONS: Array<{ value: AssistUnderstood; label: string }> = [
  { value: 'yes', label: '懂了' },
  { value: 'partly', label: '還有點不懂' },
  { value: 'no', label: '不懂' },
];

export function UnderstoodBar({ detail, onUpdated }: { detail: AssistCaseDetail; onUpdated: (d: AssistCaseDetail) => void }) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [saved, setSaved] = useState('');
  // 按下去就先顯示新的值（單選鈕不會等伺服器回應才勾起來）；失敗時回到伺服器上的值。
  const [optimistic, setOptimistic] = useState<{ understood?: AssistUnderstood | null; rating?: AssistRating | null } | null>(null);
  const errorView = useAssistErrorView();
  type Body = Parameters<typeof patchAssistCase>[1];
  const inFlight = useRef(false);
  const queued = useRef<{ body: Body; done: string } | null>(null);
  const save = async (body: Body, done: string) => {
    setOptimistic((cur) => ({ ...cur, ...body }));
    if (inFlight.current) {
      // 前一個還在存：只留最新的值，等它回來再送。
      queued.current = { body: { ...queued.current?.body, ...body }, done };
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    let next: { body: Body; done: string } | null = { body, done };
    while (next) {
      queued.current = null;
      try {
        onUpdated(await patchAssistCase(detail.id, next.body));
        setSaved(next.done);
      } catch (err) {
        queued.current = null;
        setError(await errorView(err));
        break;
      }
      next = queued.current;
    }
    inFlight.current = false;
    setOptimistic(null);
    setSaving(false);
  };
  const understood = optimistic && optimistic.understood !== undefined ? optimistic.understood : detail.understood;
  const rating = optimistic && optimistic.rating !== undefined ? optimistic.rating : detail.rating;
  const flagged = rating === 'wrong';
  return (
    <div aria-busy={saving || undefined} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <fieldset>
        <legend className="font-semibold">看完解析，懂了嗎？</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 ${understood === o.value ? 'border-primary bg-primary-soft font-semibold' : 'border-line'}`}
            >
              <input
                type="radio"
                name={`${id}-understood`}
                value={o.value}
                checked={understood === o.value}
                onChange={() => void save({ understood: o.value }, `已記下「${o.label}」`)}
                className="size-4 accent-[var(--primary)]"
              />
              {o.label}
            </label>
          ))}
        </div>
        {understood === 'no' && <p className="mt-2 text-sm text-muted">這題會列進學習報告的「還沒弄懂的疑點」；也可以直接在下面追問。</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={flagged}
          onClick={() => void save({ rating: flagged ? null : 'wrong' }, flagged ? '已取消「這則解析有錯」' : '已記下「這則解析有錯」，謝謝你')}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm ${flagged ? 'border-bad bg-bad/10 font-semibold text-bad' : 'border-line text-muted lg:hover:border-primary'}`}
        >
          <Flag aria-hidden="true" className="size-4" />
          {flagged ? '已標記：這則解析有錯' : '這則解析有錯'}
        </button>
        <span role="status" className="text-sm text-muted">
          {saved}
        </span>
      </div>
      {error && <ErrorMessage view={error} />}
    </div>
  );
}
