/**
 * 首頁的桌機儀表板（docs/design/desktop-ui.md §5.1）：main ≥ 58.5rem（ws 寬度）時 HomePage 用 React.lazy 載入，
 * 手機、平板與窄的桌機視窗不會下載。版面 grid-cols-[minmax(0,1fr)_20rem]：
 *
 *   左欄：「繼續學習」（這台裝置上做到一半的東西，最多 4 張；沒有就不顯示這一區）＋「全部功能」（HomePage 傳進來，只用 PAGES）；
 *   右欄 <aside aria-label="我的學習">（不 sticky，跟著頁面捲）：學習進度（ProgressStats 的 rail 版；region 名稱、
 *   三個 data-testid="progress-stat"、連結與文字都和手機版相同）、已登入且 AI 已核准時的 AI 點數量表與最近 3 筆寫作紀錄、後端狀態。
 *
 * DOM 順序：左欄在前、右欄在後（螢幕閱讀器與 Tab 先讀主要內容）。首頁沒有輸入框，在 ws 寬度換樹不會弄丟焦點或輸入（§2.1 R4）。
 * 「繼續學習」與學習進度只讀 localStorage；寫作紀錄與點數打 /api，不下載 /data/。
 */
import { ESSAY_MAX_SCORE, TRANSLATION_GROUP_MAX, type SubmissionSummary } from '@gsat/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BackendStatus } from '../../components/BackendStatus';
import ProgressStats from '../progress/ProgressStats';
import { QuotaMeters } from '../writing/components/AiAccessPanel';
import { AiBadge } from '../writing/components/ui';
import { useAiAccess } from '../writing/lib/access';
import { KIND_LABELS, STATUS_LABELS, formatScore, groupLabel } from '../writing/lib/format';
import { useQuota } from '../writing/lib/hooks';
import { listSubmissions } from '../writing/lib/writingApi';
import { collectContinueItems, continueKindLabel, type ContinueItem } from './continueItems';

const railCard = 'rounded-2xl border border-line bg-surface p-4';

function ContinueLearning({ items }: { items: readonly ContinueItem[] }) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-3 text-lg font-semibold">
        繼續學習
      </h2>
      <ul className="grid grid-cols-2 gap-3 @wide/main:grid-cols-4">
        {items.map((item) => (
          <li key={item.key} className="min-w-0">
            <Link to={item.to} className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-4 hover:border-primary">
              <span className="text-xs font-semibold text-primary">{continueKindLabel(item.kind)}</span>
              <span className="mt-1 flex items-start gap-2">
                <span className="min-w-0 flex-1 font-semibold">{item.title}</span>
                <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted group-hover:text-primary" />
              </span>
              <span className="mt-0.5 text-sm text-muted">{item.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 最近 3 筆寫作紀錄（中譯英與作文合併，依更新時間）；讀不到就整區不顯示（寫作紀錄頁有完整的錯誤處理）。 */
function RecentSubmissions() {
  const [items, setItems] = useState<SubmissionSummary[] | null>(null);
  const headingId = useId();
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([listSubmissions('translation', null, controller.signal), listSubmissions('essay', null, controller.signal)]).then(
      ([t, e]) => setItems([...t.submissions, ...e.submissions].sort((a, b) => b.updated_at - a.updated_at).slice(0, 3)),
      () => {
        // 只是摘要：失敗（含 abort）就不顯示
      },
    );
    return () => controller.abort();
  }, []);
  if (!items) return null;
  return (
    <section aria-labelledby={headingId} className={railCard}>
      <h2 id={headingId} className="font-semibold">
        最近的寫作紀錄
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">還沒有送 AI 批改的作答。</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((s) => (
            <li key={s.id}>
              <Link to={`/writing/submissions/${encodeURIComponent(s.id)}`} className="flex items-center gap-2 py-2 text-sm hover:text-primary">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium" title={`${groupLabel(s.group_id)} ${KIND_LABELS[s.kind]}`}>
                    {groupLabel(s.group_id)} {KIND_LABELS[s.kind]}
                  </span>
                  <span className="block text-muted">{STATUS_LABELS[s.status]}</span>
                </span>
                {s.final_score !== null && (
                  <span className="shrink-0 tabular-nums">
                    <AiBadge compact /> <span className="font-semibold">{formatScore(s.final_score)}</span>
                    <span className="text-muted">／{s.kind === 'translation' ? TRANSLATION_GROUP_MAX : ESSAY_MAX_SCORE}</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/writing" className="mt-1 inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-2">
        全部寫作紀錄
      </Link>
    </section>
  );
}

/** 已登入且 AI 已核准：點數量表＋最近的寫作紀錄。 */
function AiSummary() {
  const access = useAiAccess();
  const ready = access.state === 'ready';
  const { quota } = useQuota(ready);
  const headingId = useId();
  if (!ready) return null;
  return (
    <>
      {quota && (
        <section aria-labelledby={headingId} className={railCard}>
          <h2 id={headingId} className="mb-2 font-semibold">
            AI 點數
          </h2>
          <QuotaMeters quota={quota} />
        </section>
      )}
      <RecentSubmissions />
    </>
  );
}

export default function DesktopDashboard({ allFeatures }: { allFeatures: ReactNode }) {
  // 「今天」以進首頁的時間為準（模擬考剩餘時間也是）；換頁回來就會更新。
  const [items] = useState(() => collectContinueItems(Date.now()));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-8">
      <div className="min-w-0 space-y-8">
        <ContinueLearning items={items} />
        {allFeatures}
      </div>
      <aside aria-label="我的學習" className="space-y-4">
        <section aria-labelledby="progress-heading" className={railCard}>
          <h2 id="progress-heading" className="font-semibold">
            學習進度
          </h2>
          <p className="text-xs text-muted">只統計這台裝置的瀏覽器裡的紀錄</p>
          <ProgressStats variant="rail" />
        </section>
        <AiSummary />
        <BackendStatus variant="inline" />
      </aside>
    </div>
  );
}
