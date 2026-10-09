/**
 * 成績單的各大題表：得分／配分、答對題數、用時 vs 建議時間、全國期望得分、你 − 全國。
 * 全國期望得分＝Σ（每題全國答對率 × 配分）；中譯英、作文用大考中心公布的分數人數分布估計平均。
 */
import { formatDuration } from '../../exams/labels';
import { formatPoints } from '../../exams/scoring';
import type { MockReport } from '../report';

function minutes(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} 秒`;
  return `${Math.round(sec / 60)} 分`;
}

function diffText(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : '−'}${formatPoints(Math.abs(rounded))}`;
}

export function SectionTable({ report }: { report: MockReport }) {
  const showNational = !report.noNationalStats;
  return (
    <div className="overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label="各大題得分與用時">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <caption className="sr-only">各大題得分、用時與全國期望得分</caption>
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left">
            <th scope="col" className="px-3 py-2 font-medium">
              大題
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              得分／配分
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              答對
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              用時／建議
            </th>
            {showNational && (
              <>
                <th scope="col" className="px-3 py-2 font-medium">
                  全國期望得分
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  你 − 全國
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {report.sections.map((s) => {
            const over = s.suggestedSec !== null && s.timeSec > s.suggestedSec * 1.2;
            return (
              <tr key={s.sectionId} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-normal whitespace-nowrap">
                  {s.label}
                </th>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {formatPoints(s.earned)}／{formatPoints(s.max)}
                  {s.pendingMax > 0 && <span className="block text-xs text-bad">（{formatPoints(s.pendingMax)} 分待自評）</span>}
                </td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">{s.autoCount > 0 ? `${s.correctCount}／${s.autoCount}` : '—'}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  <span className={over ? 'font-semibold text-bad' : ''} title={formatDuration(s.timeSec)}>
                    {minutes(s.timeSec)}
                  </span>
                  {s.suggestedSec !== null && <span className="text-muted">／{minutes(s.suggestedSec)}</span>}
                  {over && <span className="sr-only">（超過建議時間）</span>}
                </td>
                {showNational && (
                  <>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{s.national === null ? '—' : formatPoints(s.national)}</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                      {s.national === null || s.pendingMax > 0 ? '—' : diffText(s.earned - s.national)}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line font-semibold">
            <th scope="row" className="px-3 py-2 text-left">
              合計
            </th>
            <td className="px-3 py-2 tabular-nums">
              {formatPoints(report.raw)}／{formatPoints(report.fullScore)}
            </td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 tabular-nums whitespace-nowrap">
              {minutes(report.usedSec)}
              {report.awaySec > 0 && <span className="block text-xs font-normal text-muted">含離開頁面 {minutes(report.awaySec)}</span>}
            </td>
            {showNational && (
              <>
                <td className="px-3 py-2 tabular-nums">
                  {report.nationalTotal !== null ? formatPoints(report.nationalTotal) : report.nationalPartial ? `${formatPoints(report.nationalPartial.national)}*` : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {report.pendingMax > 0
                    ? '—'
                    : report.nationalTotal !== null
                      ? diffText(report.raw - report.nationalTotal)
                      : report.nationalPartial
                        ? `${diffText(report.nationalPartial.mine - report.nationalPartial.national)}*`
                        : '—'}
                </td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function SectionTableNotes({ report }: { report: MockReport }) {
  return (
    <ul className="mt-2 ml-5 list-disc space-y-1 text-xs text-muted">
      <li>建議時間是本站依題量估計的參考值（合計 100 分鐘）；用時只算頁面開著、停在該大題的時間，離開頁面的時間另計。</li>
      {report.noNationalStats ? (
        <li>參考試卷沒有全國答題統計，所以沒有全國期望得分。</li>
      ) : (
        <>
          <li>全國期望得分＝Σ（每題全國答對率 × 配分），多選題用得分率；中譯英、作文依大考中心公布的分數人數分布估計平均（缺考不計）。</li>
          {report.sections.some((s) => s.nationalNote === 'open_items') && (
            <li>混合題的填充與簡答沒有逐題統計，該大題不列全國期望得分；標 * 的合計不含混合題（你在其他大題的得分對照全國）。</li>
          )}
        </>
      )}
    </ul>
  );
}
