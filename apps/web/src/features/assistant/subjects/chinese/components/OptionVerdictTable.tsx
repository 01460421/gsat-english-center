/**
 * 逐選項判定（docs/design/assistant-subjects.md §1.7、§3.2、§8.3–§8.5）：
 *   - 一般選項：「✓ 該選／✗ 不選」（不寫正確、錯誤，避免和題幹的「正確」混淆）；多選題多一欄「你」：選了、沒選、誤選、漏選。
 *   - 研判題（①②③ 敘述）：判定用題目自己的標籤（符合／不符合、適當／不適當、正確／錯誤、無法判斷），學生選的組合拆成逐句
 *     「你判」，和 AI 判的不同的那一句加亮。
 *   - 桌機是 <table>（<th scope>）；手機每一列是一張小卡（role="list"），「你」欄併進卡片標題，例如「(C) ✗ 不選・你誤選」。
 * 判定一律是圖示加文字，顏色只是輔助。
 */
import { ZH_FLAW_LABELS, ZH_ROW_FLAG_TEXT, zhVerdictText, type ZhFlawCode, type ZhJudgeLabels, type ZhOptionView, type ZhVerdict } from '@gsat/shared';
import { CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import { useIsDesktop } from '../../../../../lib/media';
import { LocateQuote } from './LocateQuote';

/** 選項代號的顯示：字母寫成 (A)，敘述編號照原樣（①）。 */
export function optionName(option: string): string {
  return /^[A-E]$/.test(option) ? `(${option})` : option;
}

function VerdictIcon({ verdict }: { verdict: ZhVerdict | null }) {
  if (verdict === 'yes') return <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-ok" />;
  if (verdict === 'no') return <CircleX aria-hidden="true" className="size-4 shrink-0 text-bad" />;
  return <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-muted" />;
}

/** 判定的文字（圖示的文字替代就是它）。 */
export function VerdictText({ verdict, labels }: { verdict: ZhVerdict | null; labels: ZhJudgeLabels | null }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap">
      <VerdictIcon verdict={verdict} />
      {zhVerdictText(verdict, labels)}
    </span>
  );
}

/** 學生在這一列的作答（「你」欄）：文字與對錯；沒有作答資料回 null。 */
export function studentCell(option: ZhOptionView, labels: ZhJudgeLabels | null, multi: boolean): { text: string; ok: boolean | null } | null {
  const s = option.student;
  if (s === null) return null;
  if ('judged' in s) {
    if (s.judged === null) return null;
    return { text: `你判：${zhVerdictText(s.judged, labels)}`, ok: option.verdict === null ? null : s.judged === option.verdict };
  }
  // 單選：只標學生選的那一個（對或錯）；多選：每一列都有選了、沒選、誤選、漏選。
  if (!multi) {
    if (!s.picked) return null;
    const ok = s.mark === 'ok' ? true : s.mark === 'wrong_pick' ? false : option.verdict === 'yes' ? true : option.verdict === 'no' ? false : null;
    return { text: '你選的', ok };
  }
  if (s.mark === 'wrong_pick') return { text: '你誤選', ok: false };
  if (s.mark === 'missed') return { text: '你漏選', ok: false };
  return { text: s.picked ? '你選了' : '你沒選', ok: s.mark === 'ok' ? true : null };
}

function StudentBadge({ cell }: { cell: { text: string; ok: boolean | null } }) {
  const tone = cell.ok === true ? 'bg-ok/10 text-ok' : cell.ok === false ? 'bg-bad/10 text-bad' : 'bg-surface-2 text-muted';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${tone}`}>
      {cell.ok === true ? <CircleCheck aria-hidden="true" className="size-3.5" /> : cell.ok === false ? <CircleX aria-hidden="true" className="size-3.5" /> : null}
      {cell.text}
    </span>
  );
}

function flawText(flaw: ZhFlawCode | ''): string | null {
  return flaw === '' ? null : (ZH_FLAW_LABELS[flaw] ?? null);
}

export interface OptionLocate {
  /** 這一列的引文能不能在左欄的題目裡標出來。 */
  locatable: (index: number) => boolean;
  onLocate: (index: number) => void;
}

export function OptionVerdictTable({
  options,
  labels,
  multi,
  answerKey,
  caption,
  locate,
}: {
  options: readonly ZhOptionView[];
  /** 研判題的題目標籤（一般選項是 null）。 */
  labels: ZhJudgeLabels | null;
  /** 多選題：「你」欄寫選了、沒選、誤選、漏選。 */
  multi: boolean;
  /** 正確答案的字母（標「正確答案」；研判題與不知道時是空字串）。 */
  answerKey: string;
  caption: string;
  locate?: OptionLocate;
}) {
  const isDesktop = useIsDesktop();
  const judge = labels !== null;
  const hasStudent = options.some((o) => studentCell(o, labels, multi) !== null);
  const differs = (o: ZhOptionView) => {
    const cell = studentCell(o, labels, multi);
    return judge && cell !== null && cell.ok === false;
  };
  if (options.length === 0) return null;

  if (isDesktop) {
    return (
      <table className="w-full table-fixed border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-14" />
          <col className="w-28" />
          {hasStudent && <col className="w-28" />}
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="py-1.5 pr-2 font-medium">
              {judge ? '敘述' : '選項'}
            </th>
            <th scope="col" className="py-1.5 pr-2 font-medium">
              {judge ? 'AI 判' : '判定'}
            </th>
            {hasStudent && (
              <th scope="col" className="py-1.5 pr-2 font-medium">
                你
              </th>
            )}
            <th scope="col" className="py-1.5 font-medium">
              關鍵與理由
            </th>
          </tr>
        </thead>
        <tbody>
          {options.map((o, i) => {
            const cell = studentCell(o, labels, multi);
            return (
              <tr key={`${o.option}-${i}`} className={`border-b border-line align-top ${differs(o) ? 'bg-bad/5' : ''}`}>
                <th scope="row" className="py-2 pr-2 font-semibold">
                  {optionName(o.option)}
                  {answerKey.includes(o.option) && /^[A-E]$/.test(o.option) && <span className="block text-xs font-normal text-ok">正確答案</span>}
                </th>
                <td className="py-2 pr-2">
                  <VerdictText verdict={o.verdict} labels={labels} />
                </td>
                {hasStudent && <td className="py-2 pr-2">{cell && <StudentBadge cell={cell} />}</td>}
                <td className="space-y-1 py-2 break-words">
                  <OptionBody option={o} index={i} locate={locate} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <ul role="list" aria-label={caption} className="space-y-2">
      {options.map((o, i) => {
        const cell = studentCell(o, labels, multi);
        return (
          <li key={`${o.option}-${i}`} className={`space-y-1 rounded-xl border px-3 py-2 ${differs(o) ? 'border-bad/40 bg-bad/5' : 'border-line bg-surface'}`}>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">{optionName(o.option)}</span>
              <VerdictText verdict={o.verdict} labels={labels} />
              {cell && (
                <>
                  <span aria-hidden="true" className="text-muted">
                    ・
                  </span>
                  <StudentBadge cell={cell} />
                </>
              )}
              {answerKey.includes(o.option) && /^[A-E]$/.test(o.option) && <span className="text-xs font-semibold text-ok">正確答案</span>}
            </p>
            <OptionBody option={o} index={i} locate={locate} />
          </li>
        );
      })}
    </ul>
  );
}

function OptionBody({ option, index, locate }: { option: ZhOptionView; index: number; locate?: OptionLocate | undefined }) {
  const flaw = flawText(option.flaw);
  return (
    <>
      {option.key_zh && <p className="font-medium break-words">{option.key_zh}</p>}
      {option.reason_zh && <p className="break-words">{option.reason_zh}</p>}
      {(flaw || option.quote) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {flaw && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{flaw}</span>}
          {option.quote && (
            <LocateQuote quote={option.quote} locatable={locate?.locatable(index) ?? false} onLocate={() => locate?.onLocate(index)} />
          )}
        </p>
      )}
      {option.flags.length > 0 && (
        <ul className="text-xs text-badge-fg">
          {option.flags.map((f) => (
            <li key={f}>{ZH_ROW_FLAG_TEXT[f]}</li>
          ))}
        </ul>
      )}
    </>
  );
}
