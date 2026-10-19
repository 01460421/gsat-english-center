/**
 * 考卷列表：依考試（學測／指考／補考／參考試卷）與學年度篩選，每張卡片列出大題結構與題數。
 *
 * 篩選條件放在網址（?kind=gsat&year=112）：重新整理、分享連結、從作答頁回來時都還在。
 * 「補考」獨立成一類（不混在學測、指考裡），因為補考多半沒有公布答對率，練習時要知道自己在寫哪一種。
 *
 * 桌機（view="table"，docs/design/desktop-ui.md §5.7）：篩選放進 sticky 篩選列、列表改成資料表（ExamTable.tsx），
 * 另有「只看作答中」（?progress=active；只有桌機有這個切換，手機的卡片不看這個參數，免得沒有地方取消）。
 */
import { ChevronRight } from 'lucide-react';
import { use, useId, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { SECTION_TYPE_LABELS, examShortName, type ExamIndex, type ExamSummary } from '../../data/exams';
import { attemptProgress } from './attempt';
import { ExamTable } from './ExamTable';
import { isNewSystem } from './labels';
import { formatPoints } from './scoring';

export const KIND_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'gsat', label: '學測' },
  { value: 'ast', label: '指考' },
  { value: 'makeup', label: '補考' },
  { value: 'reference', label: '參考試卷' },
] as const;
export type KindFilter = (typeof KIND_FILTERS)[number]['value'];

export function parseKindFilter(value: string | null): KindFilter {
  return KIND_FILTERS.some((k) => k.value === value) ? (value as KindFilter) : 'all';
}

export function matchesKind(e: Pick<ExamSummary, 'exam' | 'session'>, kind: KindFilter): boolean {
  switch (kind) {
    case 'all':
      return true;
    case 'makeup':
      return e.session === 'makeup';
    case 'reference':
      return e.exam === 'reference';
    case 'gsat':
    case 'ast':
      return e.exam === kind && e.session === 'regular';
  }
}

function ProgressBadge({ exam }: { exam: ExamSummary }) {
  const progress = attemptProgress(exam.id);
  if (!progress) return null;
  if (progress.status === 'submitted') {
    return (
      <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok">
        已交卷{progress.result ? `・${formatPoints(progress.result.earned)}／${formatPoints(progress.result.autoMax)}` : ''}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">
      作答中・{progress.answered}／{exam.question_count}
    </span>
  );
}

function ExamCard({ exam, listSearch }: { exam: ExamSummary; listSearch: string }) {
  const isNew = isNewSystem(exam);
  return (
    <Link
      to={`/exams/${exam.id}`}
      state={{ listSearch }}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-primary"
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{examShortName(exam)}</span>
            {isNew && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">新制</span>}
            {exam.session === 'makeup' && (
              <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>
            )}
            <ProgressBadge exam={exam} />
          </span>
          <span className="mt-0.5 block text-sm text-muted">{exam.title}</span>
        </span>
        <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      </span>
      <span className="text-sm">
        {exam.time_minutes !== null ? `${exam.time_minutes} 分鐘・` : ''}
        {exam.question_count} 題・滿分 {exam.full_score}
        {exam.has_stats ? '・附全國答對率' : ''}
      </span>
      <span className="sr-only">大題結構：</span>
      <span className="flex flex-wrap gap-1.5">
        {exam.sections.map((s) => (
          <span key={s.id} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">
            {SECTION_TYPE_LABELS[s.type]} <span className="tabular-nums">{s.question_count}</span> 題
          </span>
        ))}
      </span>
    </Link>
  );
}

/** indexPromise 由頁面在 Suspense 外建立並保持同一個物件（理由見 ExamPaperPage 的 examPromise）。 */
/** 只看作答中（?progress=active，桌機的資料表才有）。 */
export function onlyInProgress(exams: readonly ExamSummary[]): ExamSummary[] {
  return exams.filter((e) => attemptProgress(e.id)?.status === 'in_progress');
}

/**
 * 考試膠囊（radio 藏在 label 裡）。≥ lg 另外：焦點框離開膠囊 2px（選中的膠囊是實心主色，貼著畫的外框看不出來，
 * Tab 進這組 radio 時焦點正好在選中的那一顆上）；高對比模式拿掉底色後，選中的改用系統的 Highlight／HighlightText（R11），
 * 並設 forced-color-adjust: none（不設的話字後面會墊一塊 Canvas 色的底，白字壓在白底上看不見；設計文件 §16.7）。
 */
const pillCls =
  'cursor-pointer rounded-full border border-line px-3 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary lg:has-[:focus-visible]:outline-offset-2 lg:forced-colors:has-[:checked]:border-[color:Highlight] lg:forced-colors:has-[:checked]:bg-[color:Highlight] lg:forced-colors:has-[:checked]:text-[color:HighlightText] lg:forced-colors:has-[:checked]:outline-[color:CanvasText] lg:forced-colors:has-[:checked]:forced-color-adjust-none';

export function ExamList({ indexPromise, view = 'cards' }: { indexPromise: Promise<ExamIndex>; view?: 'cards' | 'table' }) {
  const index = use(indexPromise);
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const yearId = useId();
  const kind = parseKindFilter(params.get('kind'));
  const byKind = useMemo(() => index.exams.filter((e) => matchesKind(e, kind)), [index, kind]);
  const years = useMemo(() => [...new Set(byKind.map((e) => e.year))].sort((a, b) => b - a), [byKind]);
  const yearParam = Number(params.get('year'));
  const year = years.includes(yearParam) ? yearParam : null;
  const byYear = year === null ? byKind : byKind.filter((e) => e.year === year);
  const activeOnly = view === 'table' && params.get('progress') === 'active';
  const shown = activeOnly ? onlyInProgress(byYear) : byYear;

  const update = (next: { kind?: KindFilter; year?: number | null; activeOnly?: boolean }) => {
    const p = new URLSearchParams(params);
    const k = next.kind ?? kind;
    if (k === 'all') p.delete('kind');
    else p.set('kind', k);
    const y = next.year === undefined ? year : next.year;
    if (y === null) p.delete('year');
    else p.set('year', String(y));
    if (next.activeOnly !== undefined) {
      if (next.activeOnly) p.set('progress', 'active');
      else p.delete('progress');
    }
    // replace：篩選不必各佔一筆瀏覽紀錄，按「上一頁」應該回到進列表之前的頁面。
    setParams(p, { replace: true });
  };

  if (view === 'table') {
    return (
      <ExamTable
        exams={shown}
        listSearch={location.search}
        filters={
          <>
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">考試</legend>
              {KIND_FILTERS.map((k) => {
                const count = index.exams.filter((e) => matchesKind(e, k.value)).length;
                return (
                  <label
                    key={k.value}
                    className={`${pillCls} [&:not(:has(:checked))]:hover:border-primary [&:not(:has(:checked))]:hover:bg-surface-2 @max-ws/main:px-2.5 @max-ws/main:py-1 @max-ws/main:text-xs`}
                  >
                    <input
                      type="radio"
                      name="exam-kind"
                      value={k.value}
                      checked={kind === k.value}
                      onChange={() => update({ kind: k.value, year: null })}
                      className="sr-only"
                    />
                    {k.label}
                    <span className="ml-1 tabular-nums opacity-80">{count}</span>
                  </label>
                );
              })}
            </fieldset>
            <span className="flex items-center gap-2">
              <label htmlFor={yearId} className="text-sm font-semibold">
                學年度
              </label>
              <select
                id={yearId}
                value={year === null ? '' : String(year)}
                onChange={(e) => update({ year: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
                className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm @max-ws/main:py-1 @max-ws/main:text-xs"
              >
                <option value="">全部學年度</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} 學年度
                  </option>
                ))}
              </select>
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={activeOnly} onChange={(e) => update({ activeOnly: e.currentTarget.checked })} className="size-4 accent-[var(--primary)]" />
              只看作答中
            </label>
          </>
        }
        count={
          // main 不到 ws（1024 寬）時篩選列要維持一行：筆數只給讀屏（仍是 live region），畫面上不顯示。
          <span role="status" className="text-sm text-muted @max-ws/main:sr-only">
            共 {shown.length} 份考卷・{shown.reduce((acc, e) => acc + e.question_count, 0).toLocaleString('zh-TW')} 題
          </span>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">考試</legend>
          <div className="flex flex-wrap gap-2">
            {KIND_FILTERS.map((k) => {
              const count = index.exams.filter((e) => matchesKind(e, k.value)).length;
              return (
                <label key={k.value} className={pillCls}>
                  <input
                    type="radio"
                    name="exam-kind"
                    value={k.value}
                    checked={kind === k.value}
                    onChange={() => update({ kind: k.value, year: null })}
                    className="sr-only"
                  />
                  {k.label}
                  <span className="ml-1 tabular-nums opacity-80">{count}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={yearId} className="text-sm font-semibold">
            學年度
          </label>
          <select
            id={yearId}
            value={year === null ? '' : String(year)}
            onChange={(e) => update({ year: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm"
          >
            <option value="">全部學年度</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} 學年度
              </option>
            ))}
          </select>
        </div>
      </div>

      <p role="status" className="text-sm text-muted">
        共 {shown.length} 份考卷・{shown.reduce((acc, e) => acc + e.question_count, 0).toLocaleString('zh-TW')} 題
      </p>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">沒有符合條件的考卷。</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((exam) => (
            <li key={exam.id} className="min-w-0">
              <ExamCard exam={exam} listSearch={location.search} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
