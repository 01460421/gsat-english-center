/**
 * 四段式解析卡（SPEC §4.3），交卷後接在每一題的回饋下方：
 *   1. 正解依據：解析＋證據句（選文裡找得到的可以「在文中標出」，捲過去並加深顏色）；
 *   2. 你選的為什麼錯：學生選的錯誤選項放最前面，接著列出其他錯誤選項的說明（四個選項都學）；
 *   3. 解題策略；
 *   4. 提示階梯（作答時沒打開的也一起列出）。
 * 「加入複習」要等登入與單字卡同步後再做；詞彙題答錯的正解字已經自動收進單字錯題本（mistakes.ts）。
 */
import { Bot, Crosshair } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { ExplanationItem } from '../../../data/bank';
import type { OptionLetter, OptionMap, QuestionGroup } from '../../../data/exams';
import { RichText } from '../../exams/components/RichText';
import { evidenceRanges } from '../evidence';
import { BLANK_POS_LABELS, CLUE_TYPE_LABELS, SENSE_LABELS } from '../labels';

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2">
      <span aria-hidden="true" className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
        {step}
      </span>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="mt-1 space-y-2 text-[0.95rem]">{children}</div>
      </div>
    </div>
  );
}

function OptionLabel({ letter, options }: { letter: string; options: OptionMap | null }) {
  const text = options?.[letter as OptionLetter];
  return (
    <span className="font-semibold">
      ({letter}){text !== undefined && <> <RichText text={text} variant="inline" className="inline" /></>}
    </span>
  );
}

export function ExplanationCard({
  label,
  item,
  group,
  options,
  answer,
  chosen,
  hintsUsed,
  onLocateEvidence,
}: {
  label: string;
  item: ExplanationItem | undefined;
  group: QuestionGroup;
  options: OptionMap | null;
  /** 正確答案。 */
  answer: string;
  /** 學生的答案；未作答是 null。 */
  chosen: string | null;
  hintsUsed: number;
  /** 「在文中標出」：交給外層加亮並捲到證據句。 */
  onLocateEvidence: (label: string) => void;
}) {
  const titleId = useId();
  if (!item) return null;
  const located = evidenceRanges(group, item).length > 0;
  const notes = item.option_notes_zh ?? {};
  const wrongChosen = chosen !== null && chosen !== answer ? chosen : null;
  const otherNotes = (Object.keys(notes) as OptionLetter[]).filter((l) => l !== answer && l !== wrongChosen).sort();
  const badges = [
    item.blank_pos ? `空格詞性：${BLANK_POS_LABELS[item.blank_pos]}` : null,
    item.clue_type ? `線索：${CLUE_TYPE_LABELS[item.clue_type]}` : null,
    item.sense ? `字義：${SENSE_LABELS[item.sense]}` : null,
  ].filter((b): b is string => b !== null);
  const hints = item.hints ?? [];

  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-xl border border-line bg-surface-2/50 p-3" data-testid="explanation-card">
      <h3 id={titleId} className="flex flex-wrap items-center gap-2 font-semibold">
        <span>第 {label} 題解析</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">
          <Bot aria-hidden="true" className="size-3.5" />
          AI 撰寫
        </span>
        {hintsUsed > 0 && <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-normal text-muted">作答時用了 {hintsUsed} 層提示</span>}
      </h3>

      <Section step={1} title="正解依據">
        <p className="break-words">{item.explanation_zh}</p>
        {badges.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="考點">
            {badges.map((b) => (
              <li key={b} className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">
                {b}
              </li>
            ))}
          </ul>
        )}
        <div>
          <p className="text-sm text-muted">證據句</p>
          <ul className="mt-1 space-y-1">
            {item.evidence.map((e, i) => (
              <li key={i} lang="en" className="border-l-4 border-ok bg-ok/10 px-2 py-1 break-words">
                <RichText text={e} variant="inline" className="inline" />
              </li>
            ))}
          </ul>
          {located && (
            <button
              type="button"
              onClick={() => onLocateEvidence(label)}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm hover:border-primary"
            >
              <Crosshair aria-hidden="true" className="size-4" />
              在文中標出證據句
            </button>
          )}
        </div>
      </Section>

      {(wrongChosen !== null || otherNotes.length > 0) && (
        <Section step={2} title={wrongChosen !== null ? '你選的為什麼錯' : '其他選項為什麼錯'}>
          {wrongChosen !== null && (
            <p className="rounded-lg border border-bad/40 bg-bad/10 px-2 py-1 break-words">
              <span className="text-sm font-semibold text-bad">你選的 </span>
              <OptionLabel letter={wrongChosen} options={options} />：{notes[wrongChosen as OptionLetter] ?? '這個選項放進空格，語意或文法不通。'}
            </p>
          )}
          {otherNotes.length > 0 && (
            <ul className="space-y-1" aria-label="其他錯誤選項">
              {otherNotes.map((l) => (
                <li key={l} className="break-words">
                  <OptionLabel letter={l} options={options} />：{notes[l]}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {item.strategy_zh && (
        <Section step={3} title="解題策略">
          <p className="break-words">{item.strategy_zh}</p>
        </Section>
      )}

      {hints.length > 0 && (
        <Section step={4} title="提示階梯">
          <ol className="space-y-1">
            {hints.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 font-semibold text-muted tabular-nums">{i + 1}.</span>
                <span className="min-w-0 break-words">{h}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </section>
  );
}
