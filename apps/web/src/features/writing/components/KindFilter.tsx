/** 學測／指考／參考試卷的篩選（放在網址 ?kind=，重新整理與返回時保留）。 */
import { useSearchParams } from 'react-router';
import { EXAM_KIND_LABELS, type ExamKind } from '../../../data/exams';

export const WRITING_KINDS: readonly ExamKind[] = ['gsat', 'ast', 'reference'];
export type WritingKindFilter = ExamKind | 'all';

export function useKindFilter(): [WritingKindFilter, (k: WritingKindFilter) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('kind');
  const kind: WritingKindFilter = (WRITING_KINDS as readonly string[]).includes(raw ?? '') ? (raw as ExamKind) : 'all';
  const set = (k: WritingKindFilter) => {
    const p = new URLSearchParams(params);
    if (k === 'all') p.delete('kind');
    else p.set('kind', k);
    setParams(p, { replace: true });
  };
  return [kind, set];
}

export function KindFilter({ value, onChange, counts }: { value: WritingKindFilter; onChange: (k: WritingKindFilter) => void; counts: Record<WritingKindFilter, number> }) {
  const options: Array<{ value: WritingKindFilter; label: string }> = [
    { value: 'all', label: '全部' },
    ...WRITING_KINDS.map((k) => ({ value: k, label: EXAM_KIND_LABELS[k] })),
  ];
  return (
    <fieldset>
      <legend className="sr-only">考試</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
          >
            <input type="radio" name="writing-kind" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
            <span className="ml-1 tabular-nums opacity-80">{counts[o.value]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
