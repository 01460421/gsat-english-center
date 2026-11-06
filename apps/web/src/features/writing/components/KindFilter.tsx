/**
 * 學測／指考／參考試卷的篩選（放在網址 ?kind=，重新整理與返回時保留）。
 * 桌機（≥ lg）的列表頁與題型頁把它放進 sticky 篩選列（components/desktop/Slot.tsx 的 InSlot name="kind-filter"，
 * 同一份元件搬過去，不 render 兩份）；滑鼠移入時外框變主題色（沒選中的才變）。≥ lg 的焦點框離開膠囊 2px（選中的是實心主色，
 * 貼著畫看不出來），高對比模式下選中的改用系統的 Highlight／HighlightText（R11），並設 forced-color-adjust: none：
 * 不設的話瀏覽器會在字後面墊一塊 Canvas 色的底，HighlightText 的白字壓在白底上看不見（設計文件 §16.7）。
 * legend：題型頁（/translation、/composition）的篩選在整頁共用的篩選列裡，只篩下面的「歷屆試題」，傳「歷屆試題的考試」。
 */
import { useSearchParams } from 'react-router';
import { EXAM_KIND_LABELS, type ExamKind } from '../../../data/exams';
import { chipCls, chipRowCls } from '../../../components/ui/Tabs';

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

export function KindFilter({
  value,
  onChange,
  counts,
  legend = '考試',
}: {
  value: WritingKindFilter;
  onChange: (k: WritingKindFilter) => void;
  counts: Record<WritingKindFilter, number>;
  legend?: string;
}) {
  const options: Array<{ value: WritingKindFilter; label: string }> = [
    { value: 'all', label: '全部' },
    ...WRITING_KINDS.map((k) => ({ value: k, label: EXAM_KIND_LABELS[k] })),
  ];
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className={chipRowCls}>
        {options.map((o) => (
          <label
            key={o.value}
            className={chipCls()}
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
