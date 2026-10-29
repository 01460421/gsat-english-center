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
 *   - 多科目（docs/design/assistant-subjects.md §1.2、§1.6、§7.3、§8.2）：國文對這位使用者開放時，第一張卡換成「問英文題」「問國文題」
 *     兩張（各連到 /assistant/new?subject=…），點數說明多一行國文。最近的解析裡有國文時，每列前面有科目標籤，上方多「全部／英文／國文」
 *     篩選（GET /api/assist/cases?subject=）；選國文時上方是國文錯因統計（程式算，0 點）。只有英文時畫面和原本相同。
 */
import {
  ASSIST_SECTION_LABELS,
  ASSIST_SUBJECT_LABELS,
  ZH_SECTION_LABELS,
  assistAnalyzePoints,
  assistPoints,
  isZhSection,
  type AssistCaseSummary,
  type AssistSubject,
} from '@gsat/shared';
import { BookOpenText, ChevronRight, ClipboardPaste, Crosshair, FileText, ListChecks } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useSignedIn } from '../writing/lib/access';
import { backfillOutcomes } from './backfill';
import { AssistAccessNotice, AssistGate, AssistHeader, useAssistAccess, useAssistReadOnly } from './components/AssistAccess';
import { VerdictBadge, secondaryBtn } from './components/parts';
import { listAssistCases } from './lib/assistApi';
import { weakPaperVisible } from './papers/flags';
import { useAssistantPhotoEnabled } from './lib/useAssistantEnabled';
import { caseSubject } from './subjects';
import { zhVerdictLabel } from './subjects/chinese/caseTag';
import { ZH_COPY } from './subjects/chinese/copy';
import { ZhErrorStats } from './subjects/chinese/components/ZhErrorStats';
import { useAssistSubjects } from './subjects/useAssistSubjects';

const DATE = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
const UNDERSTOOD_TEXT = { yes: '懂了', partly: '還有點不懂', no: '不懂' } as const;

function verdictText(c: AssistCaseSummary): string | null {
  if (c.item_count > 1 && c.kind === 'item' && c.verdict !== 'correct') return `錯 ${c.wrong_count}／${c.item_count}`;
  return null;
}

/** 大題（英文）或題型（國文）的中文。 */
function sectionLabel(section: AssistCaseSummary['section']): string | null {
  if (section === null) return null;
  return isZhSection(section) ? ZH_SECTION_LABELS[section] : ASSIST_SECTION_LABELS[section];
}

/** 列表的判定：英文照原本（題組「錯 2／4」、對錯標章）；國文是答錯、部分、答對、AI 不確定、還沒作答（國寫不給判定）。 */
function CaseVerdict({ c }: { c: AssistCaseSummary }) {
  if (caseSubject(c) === 'chinese') {
    if (c.kind === 'zh_writing' || c.status !== 'analyzed') return null;
    if (c.verdict === 'wrong' || c.verdict === 'partial' || c.verdict === 'correct') return <VerdictBadge status={c.verdict} />;
    const label = zhVerdictLabel(c.verdict);
    return label ? <span>{label}</span> : null;
  }
  const text = verdictText(c);
  if (text) return <span>{text}</span>;
  return c.verdict && c.verdict !== 'unknown' ? <VerdictBadge status={c.verdict} /> : null;
}

const FIRST_PAGE = 10;

type SubjectFilter = 'all' | AssistSubject;
const FILTERS: ReadonlyArray<{ value: SubjectFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'english', label: ASSIST_SUBJECT_LABELS.english },
  { value: 'chinese', label: ASSIST_SUBJECT_LABELS.chinese },
];

/** 「全部／英文／國文」（一組 radio，方向鍵可以切換）。 */
function SubjectFilterBar({ value, onChange }: { value: SubjectFilter; onChange: (v: SubjectFilter) => void }) {
  const id = useId();
  return (
    <fieldset>
      <legend className="sr-only">依科目篩選</legend>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <label
            key={f.value}
            className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${value === f.value ? 'border-primary bg-primary text-on-primary' : 'border-line lg:hover:bg-surface-2'}`}
          >
            <input type="radio" name={`${id}-subject`} value={f.value} checked={value === f.value} onChange={() => onChange(f.value)} className="sr-only" />
            {f.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RecentCases({ readOnly }: { readOnly: boolean }) {
  const signedIn = useSignedIn();
  const [filter, setFilter] = useState<SubjectFilter>('all');
  const [list, setList] = useState<{ cases: AssistCaseSummary[]; cursor: string | null; counts: Record<string, number> } | null>(null);
  const [shown, setShown] = useState(FIRST_PAGE);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 有國文案例時才顯示科目標籤與篩選（只有英文時畫面和原本相同）；選過篩選之後一直顯示。
  const [multi, setMulti] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    setList(null);
    setFailed(false);
    setShown(FIRST_PAGE);
    listAssistCases({ signal: controller.signal, ...(filter !== 'all' ? { subject: filter } : {}) }).then(
      (r) => {
        setList({ cases: r.cases, cursor: r.next_cursor, counts: r.error_counts });
        if (r.cases.some((c) => caseSubject(c) !== 'english')) setMulti(true);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [signedIn, filter]);
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
      const r = await listAssistCases({ cursor: list.cursor, ...(filter !== 'all' ? { subject: filter } : {}) });
      setList({ cases: [...list.cases, ...r.cases], cursor: r.next_cursor, counts: list.counts });
      if (r.cases.some((c) => caseSubject(c) !== 'english')) setMulti(true);
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
      {multi && <SubjectFilterBar value={filter} onChange={setFilter} />}
      {filter === 'chinese' && list && <ZhErrorStats counts={list.counts} />}
      {failed && <p className="text-sm text-muted">暫時讀不到你的解析紀錄，請稍後再試。</p>}
      {!failed && cases === null && (
        <p role="status" className="text-sm text-muted">
          讀取中…
        </p>
      )}
      {cases && cases.length === 0 && (
        <p className="text-sm text-muted">
          {filter === 'chinese'
            ? '還沒有問過國文題目。'
            : filter === 'english'
              ? '還沒有問過英文題目。'
              : readOnly
                ? '沒有之前的解析紀錄。'
                : '還沒有問過題目。從錯題清單挑一題，或貼上一題開始。'}
        </p>
      )}
      {cases && cases.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {cases.map((c) => (
            <li key={c.id}>
              <Link to={`/assistant/case/${encodeURIComponent(c.id)}`} className="flex min-h-14 items-center gap-3 px-4 py-3 lg:hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">
                    {multi && <SubjectTag subject={caseSubject(c)} />}
                    {c.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    {c.section && <span>{sectionLabel(c.section)}</span>}
                    <CaseVerdict c={c} />
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

/** 列表每一列前面的科目標籤（有國文案例時才顯示）。 */
function SubjectTag({ subject }: { subject: AssistSubject }) {
  return (
    <span className={`mr-2 inline-block rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${subject === 'chinese' ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted'}`}>
      {ASSIST_SUBJECT_LABELS[subject]}
    </span>
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

/** 國文的點數（shared 的 assistPoints；國文開放時列在英文那一行下面）。 */
function ChinesePointsLine({ photo }: { photo: boolean }) {
  const choice = (n: number) => assistPoints('chinese', 'assist_analyze', { kind: 'zh_choice', items: n });
  const short = (n: number) => assistPoints('chinese', 'assist_analyze', { kind: 'zh_short', items: n });
  return (
    <p className="text-sm text-muted" data-testid="zh-points-line">
      國文：選擇題 {choice(1)} 點起（每多一題加 {choice(2) - choice(1)} 點，最多 {choice(Number.MAX_SAFE_INTEGER)} 點）、簡答 {short(1)} 點起（每多一個小題加{' '}
      {short(2) - short(1)} 點，最多 {short(Number.MAX_SAFE_INTEGER)} 點）、國寫指導 {assistPoints('chinese', 'assist_analyze', { kind: 'zh_writing' })} 點、追問一次{' '}
      {assistPoints('chinese', 'assist_followup')} 點
      {photo ? `、拍照轉錄 1 張 ${assistPoints('chinese', 'assist_ocr', { photos: 1 })} 點（2 張 ${assistPoints('chinese', 'assist_ocr', { photos: 2 })} 點）` : ''}。
      國文的解析目前不列入學習報告。
    </p>
  );
}

function HomeBody() {
  const access = useAssistAccess();
  const readOnly = useAssistReadOnly();
  const photo = useAssistantPhotoEnabled();
  const subjects = useAssistSubjects();
  const zhOpen = subjects.isOpen('chinese');
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
        <p className="text-muted">
          {zhOpen ? '英文、國文的題目都能問：' : ''}從錯題送出一題（或貼上一題），AI 說明這題考什麼、你錯在哪、正確解法與證據、相關觀念與提分方法；看不懂可以追問。
        </p>
      </AssistHeader>
      <AssistAccessNotice access={access} />
      <ul className="grid gap-3 sm:grid-cols-3">
        {zhOpen ? (
          <>
            <li className="min-w-0">
              <ActionCard to="/assistant/new?subject=english" icon={<ClipboardPaste aria-hidden="true" className="size-5" />} title={ZH_COPY.askEnglish}>
                講義、段考的英文題目，{photo ? '拍照或貼上文字' : '貼上文字（不用轉錄點數）'}就能問。
              </ActionCard>
            </li>
            <li className="min-w-0">
              <ActionCard to="/assistant/new?subject=chinese" icon={<BookOpenText aria-hidden="true" className="size-5" />} title={ZH_COPY.askChinese}>
                {ZH_COPY.homeChineseCard}
              </ActionCard>
            </li>
          </>
        ) : (
          <li className="min-w-0">
            <ActionCard to="/assistant/new" icon={<ClipboardPaste aria-hidden="true" className="size-5" />} title={photo ? '拍照或貼上題目' : '貼上題目'}>
              講義、段考的英文題目，貼上文字（不用轉錄點數）就能問。
            </ActionCard>
          </li>
        )}
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
      {zhOpen && <ChinesePointsLine photo={subjects.photo('chinese')} />}
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
