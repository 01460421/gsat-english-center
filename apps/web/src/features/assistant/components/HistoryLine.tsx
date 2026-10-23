/**
 * 學生的錯因歷史一行（docs/design/learning-assistant.md §2.1；程式算，不經 AI）：
 *   案例頁：「這是你第 4 題標成『過度推論』的錯題」＋前幾題的連結（AssistCaseDetail.history_line）。
 *   確認頁：還不知道這題的錯因，改列之前問過的題目裡最常見的錯因（GET /api/assist/cases 的 error_counts）。
 * 只有代碼與次數，沒有任何自由文字；認不得的代碼不顯示。
 */
import type { AssistHistoryLine } from '@gsat/shared';
import { Link } from 'react-router';
import { errorLabel } from '../lib/view';

export function HistoryLine({ line, currentId }: { line: AssistHistoryLine | null; currentId?: string }) {
  if (!line || line.count < 2) return null;
  const label = errorLabel(line.code);
  if (!label) return null;
  const others = line.case_ids.filter((id) => id !== currentId).slice(0, 3);
  return (
    <p className="text-sm">
      這是你第 {line.count} 題標成「{label}」的錯題
      <span className="text-muted">（本站計算）</span>
      {others.length > 0 && (
        <>
          ：
          {others.map((id, i) => (
            <span key={id}>
              {i > 0 ? '、' : ''}
              <Link to={`/assistant/case/${encodeURIComponent(id)}`} className="inline-flex min-h-8 items-center text-primary underline underline-offset-2">
                之前的第 {i + 1} 題
              </Link>
            </span>
          ))}
        </>
      )}
    </p>
  );
}

/** 確認頁：之前問過的題目裡最常見的錯因（前 3 個，≥ 2 題才列）。 */
export function ErrorCountsLine({ counts }: { counts: Readonly<Record<string, number>> | null }) {
  if (!counts) return null;
  const top = Object.entries(counts)
    .filter(([code, n]) => n >= 2 && errorLabel(code) !== null)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);
  if (top.length === 0) return null;
  return (
    <p className="text-sm">
      你之前問過的題目裡，最常見的錯因：{top.map(([code, n]) => `「${errorLabel(code)}」${n} 題`).join('、')}
      <span className="text-muted">（本站計算）</span>
    </p>
  );
}
