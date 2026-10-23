/**
 * 正確解法的步驟與證據句（docs/design/learning-assistant.md §2.1、§5.2）：每一步一句說明，有證據句時引用原文，
 * 「在題目中標出」把左欄（或手機上的題目卡）捲到證據句並加深顏色（桌機用 scrollIntoPane）。
 * 證據句找不到原文時（程式已清空 quote）只顯示說明。
 */
import { MapPin } from 'lucide-react';
import type { AssistItemAnalysis } from '@gsat/shared';
import { En } from './parts';

export function StepEvidence({
  steps,
  onLocate,
  locatable,
}: {
  steps: AssistItemAnalysis['solution_steps'];
  /** 按「在題目中標出」：第幾步。 */
  onLocate?: (index: number) => void;
  /** 這一步的證據句在題目裡找得到（左欄能加亮）。 */
  locatable?: (index: number) => boolean;
}) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 font-semibold text-muted tabular-nums">{i + 1}.</span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="break-words">{step.text_zh}</p>
            {step.quote && (
              <blockquote className="border-l-4 border-ok/60 pl-3 text-[0.95rem]">
                <En>{step.quote}</En>
              </blockquote>
            )}
            {step.quote && onLocate && (locatable?.(i) ?? true) && (
              <button
                type="button"
                onClick={() => onLocate(i)}
                className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline underline-offset-2"
              >
                <MapPin aria-hidden="true" className="size-4" />
                在題目中標出這句
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
