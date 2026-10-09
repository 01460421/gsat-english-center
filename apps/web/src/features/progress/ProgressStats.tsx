/**
 * 首頁「學習進度」的內容：今日待複習單字、題庫練習、單字錯題本，數字都從這台裝置的瀏覽器紀錄算（localStats.ts）。
 *
 * HomePage 用 React.lazy 載入這個檔案：解析單字的間隔重複紀錄要用 vocab/lib/srs.ts，它連帶 ts-fsrs 與單字模組的共用程式，
 * 直接 import 會整包打進首頁的主程式（建置時主程式多約 50 KB）；按需載入時和單字頁共用同一個 chunk，首頁第一個畫面不必等它。
 *
 * 讀寫都經過各模組既有的 store（useSrs、useMistakes、usePracticeHistory）：localStorage 不能用（無痕模式、封鎖網站資料）時
 * 它們改存在記憶體，這裡照樣顯示這次開啟後的紀錄，並說明關掉分頁就會消失。
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { formatPercent } from '../exams/scoring';
import { usePracticeHistory } from '../practice/history';
import { vocabSearch } from '../vocab/navigation';
import { useMistakes, useSrs } from '../vocab/state';
import { computeLocalStats, isEmptyStats, vocabHint, type LocalStats } from './localStats';

const STUDY_PATH = `/words${vocabSearch('study')}`;
const MISTAKES_PATH = `/words${vocabSearch('mistakes')}`;

function StatTile({ to, label, value, unit, hint }: { to: string; label: string; value: number; unit: string; hint: ReactNode }) {
  return (
    <li className="min-w-0">
      <Link to={to} className="flex h-full flex-col rounded-xl border border-transparent bg-surface-2 p-4 hover:border-primary" data-testid="progress-stat">
        <span className="font-medium">{label}</span>
        <span className="mt-1 text-2xl font-bold tabular-nums">
          {value.toLocaleString('zh-TW')}
          <span className="ml-1 text-sm font-normal text-muted">{unit}</span>
        </span>
        <span className="mt-1 text-sm break-words text-muted">{hint}</span>
      </Link>
    </li>
  );
}

/** 題庫練習格的補充說明：數字是已完成（交卷）的題組，後面接總答對率。 */
function practiceHint({ groups, correct, total }: LocalStats['practice']): string {
  if (groups === 0) return '還沒做完任何題組';
  return total > 0 ? `已完成的題組・答對率 ${formatPercent(correct / total)}（${correct}／${total} 題）` : '已完成的題組';
}

const btnPrimary = 'inline-flex min-h-11 items-center rounded-full bg-primary px-4 font-medium text-on-primary';
const btnSecondary = 'inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 font-medium hover:border-primary';

export default function ProgressStats() {
  const srs = useSrs();
  const mistakes = useMistakes();
  const history = usePracticeHistory();
  // 「今天」以進首頁的時間為準；換日時重新進首頁就會更新，不必每分鐘重算。
  const [now] = useState(() => Date.now());
  const stats = computeLocalStats(srs.value, mistakes.value, history.value, now);
  const { vocab, practice } = stats;

  return (
    <div className="mt-3 space-y-3">
      {srs.mode === 'memory' && (
        <p role="status" className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-3 text-sm">
          這個瀏覽器無法儲存學習紀錄（可能是無痕模式或封鎖了網站資料），這裡只看得到這次開啟網站後的紀錄，關掉分頁就會消失。
        </p>
      )}
      {isEmptyStats(stats) ? (
        <div className="rounded-xl bg-surface-2 p-4">
          <p className="font-medium">還沒有紀錄，從單字或題庫練習開始吧</p>
          <p className="mt-1 text-sm text-muted">每日學習的單字、做完的題組與錯題本，都會統計在這裡。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={STUDY_PATH} className={btnPrimary}>
              開始每日學習
            </Link>
            <Link to="/practice" className={btnSecondary}>
              題庫練習
            </Link>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile to={STUDY_PATH} label="今日待複習單字" value={vocab.dueToday} unit="個" hint={vocabHint(vocab)} />
          <StatTile to="/practice" label="題庫練習" value={practice.groups} unit="組" hint={practiceHint(practice)} />
          <StatTile
            to={MISTAKES_PATH}
            label="單字錯題本"
            value={stats.mistakes}
            unit="個字"
            hint={stats.mistakes > 0 ? '測驗或題庫詞彙題答錯的字，在錯題本練對就移出' : '目前沒有答錯的字'}
          />
        </ul>
      )}
    </div>
  );
}
