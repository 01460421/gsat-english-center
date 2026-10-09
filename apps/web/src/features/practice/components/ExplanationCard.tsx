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

export function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
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

export function OptionLabel({ letter, options }: { letter: string; options: OptionMap | null }) {
  const text = options?.[letter as OptionLetter];
  return (
    <span className="font-semibold">
      ({letter}){text !== undefined && <> <RichText text={text} variant="inline" className="inline" /></>}
    </span>
  );
}

/** 解析卡的外框與標題（第 n 題解析・AI 撰寫・用了幾層提示）。 */
export function CardShell({ label, hintsUsed, children }: { label: string; hintsUsed: number; children: ReactNode }) {
  const titleId = useId();
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
      {children}
    </section>
  );
}

/** 一句逐字證據（英文原句）。from：證據出自圖表或表格時的小標籤。 */
export function EvidenceQuote({ text, from, tone = 'ok' }: { text: string; from?: string | null; tone?: 'ok' | 'muted' }) {
  return (
    <li lang="en" className={`border-l-4 px-2 py-1 break-words ${tone === 'ok' ? 'border-ok bg-ok/10' : 'border-line bg-surface'}`}>
      {from && (
        <span lang="zh-Hant" className="mr-1.5 rounded-full bg-surface px-1.5 py-0.5 text-xs text-muted">
          {from}
        </span>
      )}
      <RichText text={text} variant="inline" className="inline" />
    </li>
  );
}

/** 證據句清單＋「在文中標出證據句」（選文裡找得到時）。evidenceSource：證據出自圖表、表格時回傳小標籤。 */
export function EvidenceBlock({
  label,
  evidence,
  located,
  onLocateEvidence,
  evidenceSource,
}: {
  label: string;
  evidence: readonly string[];
  located: boolean;
  onLocateEvidence: (label: string) => void;
  evidenceSource?: (text: string) => string | null;
}) {
  return (
    <div>
      <p className="text-sm text-muted">證據句</p>
      <ul className="mt-1 space-y-1">
        {evidence.map((e, i) => (
          <EvidenceQuote key={i} text={e} from={evidenceSource?.(e) ?? null} />
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
  );
}

/** 提示階梯（作答時沒打開的也一起列出）。 */
export function HintList({ hints }: { hints: readonly string[] }) {
  return (
    <ol className="space-y-1">
      {hints.map((h, i) => (
        <li key={i} className="flex gap-2">
          <span className="shrink-0 font-semibold text-muted tabular-nums">{i + 1}.</span>
          <span className="min-w-0 break-words">{h}</span>
        </li>
      ))}
    </ol>
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
  codeLabels,
  evidenceSource,
  showBlankPos = true,
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
  /** 閱讀題：誘答碼（option_codes）→ 中文說明。 */
  codeLabels?: Readonly<Record<string, string>>;
  /** 證據出自圖表、表格時的小標籤（閱讀題）。 */
  evidenceSource?: (text: string) => string | null;
  /** 顯示「空格詞性」徽章（閱讀題沒有空格，不顯示；題目類型由歷屆試題的「考點」那一行標示）。 */
  showBlankPos?: boolean;
}) {
  if (!item) return null;
  const located = evidenceRanges(group, item).length > 0;
  const notes = item.option_notes_zh ?? {};
  const codes = item.option_codes ?? {};
  const optionEvidence = item.option_evidence ?? {};
  const wrongChosen = chosen !== null && chosen !== answer ? chosen : null;
  const documented = new Set<string>([...Object.keys(notes), ...Object.keys(optionEvidence)]);
  const otherNotes = ([...documented] as OptionLetter[]).filter((l) => l !== answer && l !== wrongChosen).sort();
  const badges = [
    item.blank_pos && showBlankPos ? `空格詞性：${BLANK_POS_LABELS[item.blank_pos]}` : null,
    item.clue_type ? `線索：${CLUE_TYPE_LABELS[item.clue_type]}` : null,
    item.sense ? `字義：${SENSE_LABELS[item.sense]}` : null,
  ].filter((b): b is string => b !== null);
  const hints = item.hints ?? [];
  const codeOf = (letter: string): string | null => {
    const code = codes[letter as OptionLetter];
    const text = code ? codeLabels?.[code] : undefined;
    return text ? text : null;
  };
  const optionDetail = (letter: string) => {
    const code = codeOf(letter);
    const quotes = optionEvidence[letter as OptionLetter] ?? [];
    return (
      <>
        {code && <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs text-muted">誘答類型：{code}</span>}
        {quotes.length > 0 && (
          <ul className="mt-1 space-y-1">
            {quotes.map((e, i) => (
              <EvidenceQuote key={i} text={e} from={evidenceSource?.(e) ?? null} tone="muted" />
            ))}
          </ul>
        )}
      </>
    );
  };

  return (
    <CardShell label={label} hintsUsed={hintsUsed}>
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
        <EvidenceBlock label={label} evidence={item.evidence} located={located} onLocateEvidence={onLocateEvidence} evidenceSource={evidenceSource} />
      </Section>

      {(wrongChosen !== null || otherNotes.length > 0) && (
        <Section step={2} title={wrongChosen !== null ? '你選的為什麼錯' : '其他選項為什麼錯'}>
          {wrongChosen !== null && (
            <div className="rounded-lg border border-bad/40 bg-bad/10 px-2 py-1 break-words">
              <span className="text-sm font-semibold text-bad">你選的 </span>
              <OptionLabel letter={wrongChosen} options={options} />：{notes[wrongChosen as OptionLetter] ?? '這個選項放進空格，語意或文法不通。'}
              {optionDetail(wrongChosen)}
            </div>
          )}
          {otherNotes.length > 0 && (
            <ul className="space-y-1" aria-label="其他錯誤選項">
              {otherNotes.map((l) => (
                <li key={l} className="break-words">
                  <OptionLabel letter={l} options={options} />
                  {notes[l] ? `：${notes[l]}` : ''}
                  {optionDetail(l)}
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
          <HintList hints={hints} />
        </Section>
      )}
    </CardShell>
  );
}
