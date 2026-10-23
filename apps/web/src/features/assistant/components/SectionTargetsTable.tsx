/**
 * 目前表現與目標（docs/design/learning-assistant.md §3.3 第 2 段）：各大題的配分、目前（官方題／題庫估計／AI 批改／自評）、
 * 目標、可爭取分數、全國平均，下面是距離目標的句子。全部讀 facts（Worker 的程式算的），標「估計（本站計算）」「非官方」。
 * 手機上表格可以左右捲（外框 overflow-x-auto，不讓整頁水平捲動）。
 */
import { ASSIST_SECTION_LABELS, type AssistReportFacts } from '@gsat/shared';
import { currentText, gainText, nationalText, targetLabel, targetText } from '../reportFormat';

export function SectionTargetsTable({ facts }: { facts: AssistReportFacts }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        目標：{targetLabel(facts)}，約是到考考生的前 {Math.round(facts.target.top_pct)}%。目標與可爭取分數是本站依 111–115 學測統計的估計，不是官方資料。
      </p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">各大題的目前表現與目標</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                大題
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                配分
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                目前
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                目標（估計）
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                可爭取
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                全國平均
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {facts.sections.map((f) => (
              <tr key={f.section}>
                <th scope="row" className="px-3 py-2 font-medium">
                  {ASSIST_SECTION_LABELS[f.section]}
                </th>
                <td className="px-3 py-2">{f.points}</td>
                <td className="px-3 py-2">{currentText(f)}</td>
                <td className="px-3 py-2">{targetText(f)}</td>
                <td className="px-3 py-2">{gainText(f.gain)}</td>
                <td className="px-3 py-2">{nationalText(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-1">
        {facts.distance_lines.map((line) => (
          <li key={line} className="font-medium">
            {line}
          </li>
        ))}
      </ul>
      {facts.mocks.length > 0 && (
        <div>
          <p className="text-sm font-medium">最近的模擬考</p>
          <ul className="mt-1 space-y-1 text-sm">
            {facts.mocks.map((m) => (
              <li key={`${m.paper}-${m.at}`}>
                {m.at.slice(0, 10)}：{m.kind === 'exam' ? m.paper.replace(/^gsat-(\d+)$/, '$1 學測') : '本站自組卷'} {m.raw}／{m.max} 分
                {m.level !== null && `（非官方換算 ${m.level} 級分）`}
                {m.self_scored && '（中譯英、作文是自評）'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(facts.writing.translation || facts.writing.essay) && (
        <p className="text-sm">
          AI 批改：
          {facts.writing.translation && `中譯英最近 ${facts.writing.translation.n} 份平均 ${facts.writing.translation.avg}／8 分`}
          {facts.writing.translation && facts.writing.essay && '；'}
          {facts.writing.essay && `作文最近 ${facts.writing.essay.n} 份平均 ${facts.writing.essay.avg}／20 分`}
        </p>
      )}
      {facts.vocab.mistakes > 0 && (
        <p className="text-sm">
          單字錯題本 {facts.vocab.mistakes} 個字{facts.vocab.srs ? `；複習卡片 ${facts.vocab.srs.cards} 張，今天到期 ${facts.vocab.srs.due} 張` : ''}。
        </p>
      )}
    </div>
  );
}
