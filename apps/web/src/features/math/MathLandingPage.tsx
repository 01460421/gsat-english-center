/**
 * 學測數學入口（/math）：數A／數B 分頁，有舊課綱（100–110）卷子時多一個「舊課綱」分頁，依學年度列出卷子。
 *
 * 分頁放在網址（?subject=b、?subject=old；數A 是預設）：重新整理、分享連結、從卷子頁回來時都還在。
 * 這一頁只下載卷子清單（/data/math/index.json，幾 KB），不載 KaTeX；公式在卷子頁才排版。
 */
import { ChevronRight } from 'lucide-react';
import { Suspense, use, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { PageHeader } from '../../components/ModulePage';
import { forgetFailedLoads } from '../../data/client';
import { loadMathIndex, type MathIndex, type MathPaperSummary } from '../../data/math';
import { getPage } from '../../modules';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { mathProgress } from './attempt';
import { EraBadge, ProgressBadge } from './components/Badges';

export const SUBJECT_TABS = [
  { value: 'a', label: '數學A', match: (p: Pick<MathPaperSummary, 'subject' | 'era'>) => p.subject === 'math_a' && p.era === '108課綱' },
  { value: 'b', label: '數學B', match: (p: Pick<MathPaperSummary, 'subject' | 'era'>) => p.subject === 'math_b' && p.era === '108課綱' },
  { value: 'old', label: '舊課綱', match: (p: Pick<MathPaperSummary, 'subject' | 'era'>) => p.era === '舊課綱' },
] as const;
export type SubjectTab = (typeof SUBJECT_TABS)[number]['value'];

export function parseSubjectTab(value: string | null): SubjectTab {
  return SUBJECT_TABS.some((t) => t.value === value) ? (value as SubjectTab) : 'a';
}

const SUBJECT_NOTES: Record<SubjectTab, string> = {
  a: '數學A：高一與高二 A 類課程（含空間向量、矩陣、線性方程組），偏重代數與幾何的連結；理工、醫藥、商管等校系常採計。',
  b: '數學B：高一與高二 B 類課程（含圓錐曲線、球面與數學建模），情境題多；人文、社會、藝術等校系常採計。',
  old: '舊課綱學測數學（100–110 學年度）：只有單選、多選與選填題（滿分 100 全部自動批改），選填格照題本標列號（⑭⑮…）。部分內容（例如複數平面、轉移矩陣）不在現行課綱，詳解陸續補上。',
};

/** 大題名稱的短寫：「一、單選題（占30分）」→「單選題」；舊課綱「第貳部分：選填題（占35分）」→「選填題」。 */
export function sectionChipLabel(title: string): string {
  return title
    .replace(/^.*?、/, '')
    .replace(/^第.部分：/, '')
    .replace(/（.*?）/, '');
}

function PaperCard({ paper, listSearch }: { paper: MathPaperSummary; listSearch: string }) {
  const progress = mathProgress(paper.id);
  return (
    <Link
      to={`/math/${paper.id}`}
      state={{ listSearch }}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-primary"
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{paper.year} 學年度</span>
            <EraBadge era={paper.era} />
            <ProgressBadge progress={progress} total={paper.question_count - paper.constructed_count} />
          </span>
          <span className="mt-0.5 block text-sm text-muted">{paper.title}</span>
        </span>
        <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      </span>
      <span className="text-sm">
        {paper.time_minutes} 分鐘・{paper.question_count} 題・自動批改 {paper.auto_max} 分{paper.manual_max > 0 ? `＋非選擇題 ${paper.manual_max} 分` : ''}
        {paper.has_stats ? '・附全國答對率' : ''}
      </span>
      <span className="flex flex-wrap gap-1.5 text-xs">
        {paper.sections.map((s) => (
          <span key={s.id} className="rounded-md bg-surface-2 px-2 py-0.5">
            {sectionChipLabel(s.title)} <span className="tabular-nums">{s.question_count}</span> 題
          </span>
        ))}
        <span className={`rounded-md px-2 py-0.5 ${paper.solution_count > 0 ? 'bg-ok/10 text-ok' : 'bg-badge-bg text-badge-fg'}`}>
          {paper.solution_count >= paper.question_count ? '本站詳解' : paper.solution_count > 0 ? `本站詳解 ${paper.solution_count}／${paper.question_count} 題` : '詳解準備中'}
        </span>
      </span>
    </Link>
  );
}

const pillCls =
  'cursor-pointer rounded-full border border-line px-4 py-1.5 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary [&:not(:has(:checked))]:hover:border-primary';

function PaperList({ indexPromise }: { indexPromise: Promise<MathIndex> }) {
  const index = use(indexPromise);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabs = SUBJECT_TABS.filter((t) => t.value !== 'old' || index.papers.some(t.match));
  const requested = parseSubjectTab(params.get('subject'));
  const tab = tabs.find((t) => t.value === requested) ?? tabs[0];
  const papers = tab ? index.papers.filter(tab.match).sort((a, b) => b.year - a.year) : [];

  const select = (value: SubjectTab) => {
    const p = new URLSearchParams(params);
    if (value === 'a') p.delete('subject');
    else p.set('subject', value);
    setParams(p, { replace: true });
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="sr-only">考科</legend>
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <label key={t.value} className={pillCls}>
              <input type="radio" name="math-subject" value={t.value} checked={tab?.value === t.value} onChange={() => select(t.value)} className="sr-only" />
              {t.label}
              <span className="ml-1 tabular-nums opacity-80">{index.papers.filter(t.match).length}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {tab && <p className="max-w-3xl text-sm text-muted">{SUBJECT_NOTES[tab.value]}</p>}
      <p role="status" className="text-sm text-muted">
        共 {papers.length} 份卷子・{papers.reduce((n, p) => n + p.question_count, 0)} 題
      </p>
      {papers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">這個考科還沒有卷子。</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {papers.map((p) => (
            <li key={p.id} className="min-w-0">
              <PaperCard paper={p} listSearch={location.search} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MathLandingPage() {
  const page = getPage('/math');
  const [retry, setRetry] = useState(0);
  const indexPromise = useMemo(() => loadMathIndex(), [retry]);
  return (
    <article className="lg:bleed lg:[&>*]:max-w-[72rem] lg:[&_p]:max-w-3xl">
      <PageHeader page={page} />
      <div className="grid grid-cols-1 gap-4">
        <p className="max-w-3xl text-[0.95rem]">
          點選卷子開始作答：<strong>練習模式</strong>每題寫完就能看答案與本站詳解；<strong>考試模式</strong>依題本時間倒數計時，交卷後看成績、逐題對錯與詳解。選填題仿答題卷的劃記格作答（每格 0–9、−、±），依官方計分方式自動批改；非選擇題請在紙上寫，交卷後對照詳解自評（拍照 AI 批改即將推出）。進度會自動存在這台裝置。
        </p>
        <DataErrorBoundary
          key={retry}
          onRetry={() => {
            forgetFailedLoads();
            setRetry((n) => n + 1);
          }}
        >
          <Suspense
            fallback={
              <p role="status" className="py-10 text-center text-muted">
                卷子清單載入中…
              </p>
            }
          >
            <PaperList indexPromise={indexPromise} />
          </Suspense>
        </DataErrorBoundary>
        <footer className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted lg:max-w-3xl">
          試題來源：大學入學考試中心 111–115 學年度學科能力測驗數學A、數學B考科，100–110 學年度學科能力測驗數學考科（舊課綱）。題目、選項與選擇（填）題答案依官方公告的試題與答案整理，圖從官方題本裁切並附文字描述；每份卷子頁都附有官方檔案連結，內容如有出入以官方檔案為準。詳解為本站撰寫，不是官方解答。
        </footer>
      </div>
    </article>
  );
}
