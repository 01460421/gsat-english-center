/**
 * /assistant：學習助手首頁（docs/design/learning-assistant.md §1.9、§5.1）。
 *
 *   - 開關關著（或 admin 而目前不是管理員）：沒登入時只顯示「學習助手暫停使用中」，不打學習助手的 API；已登入時是唯讀模式
 *     （AssistGate readOnly）：暫停的說明、之前的解析清單與「之前的學習報告」，沒有貼上題目與錯題清單的動作卡、沒有點數說明。
 *   - 介紹＋「你正在和 AI 互動」聲明；三張動作卡：貼上題目（拍照開關打開時另有拍照，WP-A3）、錯題與疑點、學習報告（WP-C，10 點）。
 *   - 最近的解析（GET /api/assist/cases；登入才有）：標題、大題、對錯（題組「錯 2／2」）、懂了嗎、日期；先列 10 筆，
 *     「顯示更多」接著列（next_cursor），超過 10 筆的舊案例也找得到、刪得到。
 *   - 第一次開啟時把已經交卷的歷屆試題與模考補登進本機作答紀錄（backfill.ts），錯題清單才看得到它們。
 *   - 第四張動作卡「加強卷」（docs/design/weak-paper.md §3.1）：weakPaperVisible() 時出現；不用 AI，唯讀模式也顯示。
 */
import { ASSIST_SECTION_LABELS, assistAnalyzePoints, type AssistCaseSummary } from '@gsat/shared';
import { ChevronRight, ClipboardPaste, Crosshair, FileText, ListChecks } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useSignedIn } from '../writing/lib/access';
import { backfillOutcomes } from './backfill';
import { AssistAccessNotice, AssistGate, AssistHeader, useAssistAccess, useAssistReadOnly } from './components/AssistAccess';
import { VerdictBadge, secondaryBtn } from './components/parts';
import { listAssistCases } from './lib/assistApi';
import { weakPaperVisible } from './papers/flags';
import { useAssistantPhotoEnabled } from './lib/useAssistantEnabled';

const DATE = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
const UNDERSTOOD_TEXT = { yes: '懂了', partly: '還有點不懂', no: '不懂' } as const;

function verdictText(c: AssistCaseSummary): string | null {
  if (c.item_count > 1 && c.kind === 'item' && c.verdict !== 'correct') return `錯 ${c.wrong_count}／${c.item_count}`;
  return null;
}

const FIRST_PAGE = 10;

function RecentCases({ readOnly }: { readOnly: boolean }) {
  const signedIn = useSignedIn();
  const [list, setList] = useState<{ cases: AssistCaseSummary[]; cursor: string | null } | null>(null);
  const [shown, setShown] = useState(FIRST_PAGE);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    listAssistCases({ signal: controller.signal }).then(
      (r) => setList({ cases: r.cases, cursor: r.next_cursor }),
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [signedIn]);
  if (!signedIn) return null;
  const cases = list ? list.cases.slice(0, shown) : null;
  const more = list !== null && (list.cases.length > shown || list.cursor !== null);
  const showMore = async () => {
    if (!list) return;
    if (list.cases.length > shown || list.cursor === null) {
      setShown((n) => n + FIRST_PAGE * 2);
      return;
    }
    setLoadingMore(true);
    try {
      const r = await listAssistCases({ cursor: list.cursor });
      setList({ cases: [...list.cases, ...r.cases], cursor: r.next_cursor });
      setShown((n) => n + FIRST_PAGE * 2);
    } catch {
      setFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">
        最近的解析
      </h2>
      {failed && <p className="text-sm text-muted">暫時讀不到你的解析紀錄，請稍後再試。</p>}
      {!failed && cases === null && (
        <p role="status" className="text-sm text-muted">
          讀取中…
        </p>
      )}
      {cases && cases.length === 0 && (
        <p className="text-sm text-muted">{readOnly ? '沒有之前的解析紀錄。' : '還沒有問過題目。從錯題清單挑一題，或貼上一題開始。'}</p>
      )}
      {cases && cases.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {cases.map((c) => (
            <li key={c.id}>
              <Link to={`/assistant/case/${encodeURIComponent(c.id)}`} className="flex min-h-14 items-center gap-3 px-4 py-3 lg:hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">{c.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    {c.section && <span>{ASSIST_SECTION_LABELS[c.section]}</span>}
                    {verdictText(c) ? <span>{verdictText(c)}</span> : c.verdict && c.verdict !== 'unknown' ? <VerdictBadge status={c.verdict} /> : null}
                    {c.understood && <span>{UNDERSTOOD_TEXT[c.understood]}</span>}
                    {c.status === 'analyzing' && <span>解析中</span>}
                    {c.status === 'failed' && <span>解析沒有完成</span>}
                    <span>{DATE.format(new Date(c.updated_at * 1000))}</span>
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more && !failed && (
        <button type="button" onClick={() => void showMore()} disabled={loadingMore} className={secondaryBtn}>
          {loadingMore ? '讀取中…' : '顯示更多'}
        </button>
      )}
    </section>
  );
}

function ActionCard({ to, icon, title, children }: { to: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex h-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 lg:hover:border-primary">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted">{children}</span>
      </span>
    </Link>
  );
}

/** 第四張動作卡：加強卷（不用 AI，開關關著或唯讀模式也顯示；功能開關關著時不出現）。 */
function PapersCard() {
  const [visible] = useState(weakPaperVisible);
  if (!visible) return null;
  return (
    <li className="min-w-0">
      <ActionCard to="/assistant/papers" icon={<Crosshair aria-hidden="true" className="size-5" />} title="加強卷">
        依你的作答紀錄挑出需要加強的題型與技能，組成一份計時卷子；也可以隨機抽題。不用點數。
      </ActionCard>
    </li>
  );
}

function HomeBody() {
  const access = useAssistAccess();
  const readOnly = useAssistReadOnly();
  const photo = useAssistantPhotoEnabled();
  useEffect(() => {
    void backfillOutcomes().catch(() => 0);
  }, []);
  if (readOnly) {
    return (
      <div className="space-y-6">
        <AssistHeader title="學習助手" />
        <AssistAccessNotice access={access} />
        <ul className="grid gap-3 sm:grid-cols-3">
          <li className="min-w-0">
            <ActionCard to="/assistant/report" icon={<FileText aria-hidden="true" className="size-5" />} title="之前的學習報告">
              看、列印或刪除之前產生的學習報告。
            </ActionCard>
          </li>
          <PapersCard />
        </ul>
        <RecentCases readOnly />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <AssistHeader title="學習助手">
        <p className="text-muted">從錯題送出一題（或貼上一題），AI 說明這題考什麼、你錯在哪、正確解法與證據、相關觀念與提分方法；看不懂可以追問。</p>
      </AssistHeader>
      <AssistAccessNotice access={access} />
      <ul className="grid gap-3 sm:grid-cols-3">
        <li className="min-w-0">
          <ActionCard to="/assistant/new" icon={<ClipboardPaste aria-hidden="true" className="size-5" />} title={photo ? '拍照或貼上題目' : '貼上題目'}>
            講義、段考的英文題目，貼上文字（不用轉錄點數）就能問。
          </ActionCard>
        </li>
        <li className="min-w-0">
          <ActionCard to="/assistant/mistakes" icon={<ListChecks aria-hidden="true" className="size-5" />} title="錯題與疑點">
            這台裝置上答錯、沒把握的題目，依「建議先問」排好。
          </ActionCard>
        </li>
        <li className="min-w-0">
          <ActionCard to="/assistant/report" icon={<FileText aria-hidden="true" className="size-5" />} title="學習報告">
            彙整你的弱點與錯誤樣態，排出提分計畫與逐週讀書計畫。
          </ActionCard>
        </li>
        <PapersCard />
      </ul>
      <RecentCases readOnly={false} />
      <p className="text-sm text-muted">
        點數：解析一題用 {assistAnalyzePoints('item', 1)} 點（同一組每多一題加 {assistAnalyzePoints('item', 2) - assistAnalyzePoints('item', 1)} 點，最多{' '}
        {assistAnalyzePoints('item', Number.MAX_SAFE_INTEGER)} 點；已經有同學問過同一題同樣的答案、有共用的解析時 0 點）、追問一次用 3 點、學習報告一版用 10 點
        {photo ? '、拍照轉錄一次用 2 點' : ''}。
        作答紀錄只存在這台裝置；你選擇送出的題目、作答與疑問才會傳到本站伺服器。
      </p>
    </div>
  );
}

export default function AssistantHomePage() {
  return (
    <AssistGate readOnly>
      <HomeBody />
    </AssistGate>
  );
}
