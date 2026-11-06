/**
 * 國文解析裡的引文（「」內逐字出自題目）：顯示引文，找得到原文時多一個「在題目中標出這句」，按了把左欄（手機是題目卡）
 * 捲到原文並加深顏色（同英文的 StepEvidence）。國文不包 lang="en"。
 */
import { MapPin } from 'lucide-react';
import { btn } from '../../../../../components/ui/buttons';

export function LocateQuote({ quote, locatable, onLocate }: { quote: string; locatable: boolean; onLocate?: (() => void) | undefined }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">
      <q className="zh-quote min-w-0 break-words text-fg">{quote}</q>
      {locatable && onLocate && (
        <button type="button" onClick={onLocate} className={btn('link', 'sm', 'gap-1')}>
          <MapPin aria-hidden="true" className="size-4" />
          在題目中標出這句
        </button>
      )}
    </span>
  );
}
