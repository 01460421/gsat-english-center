/**
 * /exams 的桌機版（docs/design/desktop-ui.md §5.7；ExamList 在 ≥ lg、而且設定頁沒有改回卡片時用它，手機維持卡片）：
 *
 *   - StickyBar（捲動後仍看得到）：考試膠囊、學年度、「只看作答中」、筆數。篩選仍放在網址（?kind=&year=&progress=active）；
 *   - DataTable：考卷（「115 學測」＋新制、補考標章，可存取名稱和卡片一樣以考卷名稱開頭；題本全名放 title）、題數、全國答對率、
 *     題型結構（精簡寫法，全文放 title）、我的進度。沒有「滿分」欄（66 份都是 100）、沒有「時間」欄（放進分組標題「學測・100 分鐘」）、
 *     沒有「動作」欄（「開始」和第一欄連到同一頁：每列只有一個連結，tests/exams.spec.ts 要求 /指考/ 的連結只有 1 個）。
 *   - 列連結帶 state.listSearch（和 ExamCard 一樣）：作答頁的「‹ 歷屆試題列表」回到篩選過的列表。
 * main 不到 ws（58.5rem；1024 寬、側邊欄展開）時藏起「題型結構」欄（lg:@max-ws/main:hidden），表格不必水平捲動。
 */
import type { ReactNode } from 'react';
import { DataTable, type Column } from '../../components/desktop/DataTable';
import { StickyBar } from '../../components/desktop/StickyBar';
import { SECTION_TYPE_LABELS, examShortName, type ExamSummary, type SectionType } from '../../data/exams';
import { attemptProgress, type AttemptProgress } from './attempt';
import { isNewSystem } from './labels';
import { formatPoints } from './scoring';

/** 題型結構的一字簡稱（「詞10 綜10 文10 篇4 閱12 混4 譯2 作1」）。 */
const SECTION_SHORT: Record<SectionType, string> = {
  vocabulary: '詞',
  cloze: '綜',
  word_bank: '文',
  structure: '篇',
  reading: '閱',
  mixed: '混',
  sentence_matching: '配',
  short_answer: '簡',
  translation: '譯',
  composition: '作',
  other: '他',
};

export function sectionStructure(exam: Pick<ExamSummary, 'sections'>, labels: Record<SectionType, string>, joiner: string): string {
  return exam.sections.map((s) => `${labels[s.type]}${joiner}${s.question_count}`).join(' ');
}

/** 分組：學測、指考、補考、參考試卷（同一組裡時間不同時再分，例如學測參考試卷 100 分鐘、指考參考試卷 80 分鐘）。 */
const CATEGORY_ORDER = ['學測', '指考', '補考', '參考試卷'] as const;

export function examCategory(e: Pick<ExamSummary, 'exam' | 'session'>): (typeof CATEGORY_ORDER)[number] {
  if (e.session === 'makeup') return '補考';
  if (e.exam === 'reference') return '參考試卷';
  return e.exam === 'gsat' ? '學測' : '指考';
}

export function examGroupKey(e: Pick<ExamSummary, 'exam' | 'session' | 'time_minutes'>): string {
  return e.time_minutes !== null ? `${examCategory(e)}・${e.time_minutes} 分鐘` : examCategory(e);
}

/** 依分組排好（組的順序固定，時間長的在前；組內維持索引的順序＝新到舊）。DataTable 的組順序是資料第一次出現的順序。 */
export function groupedExams(exams: readonly ExamSummary[]): ExamSummary[] {
  const rank = (e: ExamSummary) => CATEGORY_ORDER.indexOf(examCategory(e)) * 1000 - (e.time_minutes ?? 0);
  return exams
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map((x) => x.e);
}

/** 排序用的進度值：沒做過 0；作答中 1–2（已答比例）；已交卷 3–4（得分比例）。 */
export function progressSortValue(progress: AttemptProgress | null, questionCount: number): number {
  if (!progress) return 0;
  if (progress.status === 'in_progress') return 1 + (questionCount > 0 ? progress.answered / questionCount : 0);
  const r = progress.result;
  return 3 + (r && r.autoMax > 0 ? r.earned / r.autoMax : 0);
}

/** 我的進度：細條（裝飾）＋和卡片相同寫法的文字（「作答中・30／53」「已交卷・78／100」）。 */
function ProgressCell({ exam, progress }: { exam: ExamSummary; progress: AttemptProgress | null }) {
  if (!progress) return <span className="text-muted">—</span>;
  const inProgress = progress.status === 'in_progress';
  const result = inProgress ? null : progress.result;
  const ratio = inProgress ? (exam.question_count > 0 ? progress.answered / exam.question_count : 0) : result && result.autoMax > 0 ? result.earned / result.autoMax : null;
  const text = inProgress
    ? `作答中・${progress.answered}／${exam.question_count}`
    : `已交卷${result ? `・${formatPoints(result.earned)}／${formatPoints(result.autoMax)}` : ''}`;
  return (
    <span className="flex min-w-0 items-center gap-2">
      {ratio !== null && (
        <span aria-hidden="true" className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-surface-2">
          <span className={`block h-full rounded-full ${inProgress ? 'bg-primary' : 'bg-ok'}`} style={{ width: `${Math.round(Math.min(1, ratio) * 100)}%` }} />
        </span>
      )}
      <span className={`text-sm tabular-nums ${inProgress ? 'font-semibold text-primary' : ''}`}>{text}</span>
    </span>
  );
}

interface Row {
  exam: ExamSummary;
  progress: AttemptProgress | null;
}

const COLUMNS: Column<Row>[] = [
  {
    id: 'exam',
    header: '考卷',
    sortValue: (r) => r.exam.year,
    // 第一欄是列連結（primaryLink）；這裡不再放別的東西。
    cell: () => null,
  },
  { id: 'questions', header: '題數', align: 'end', sortValue: (r) => r.exam.question_count, cell: (r) => r.exam.question_count, className: 'w-20' },
  {
    id: 'stats',
    header: '全國答對率',
    cell: (r) => (r.exam.has_stats ? '有' : <span className="text-muted">—</span>),
    className: 'w-28',
  },
  {
    id: 'structure',
    header: '題型結構',
    cell: (r) => (
      <span className="block truncate text-sm text-muted" title={sectionStructure(r.exam, SECTION_TYPE_LABELS, ' ')}>
        {sectionStructure(r.exam, SECTION_SHORT, '')}
      </span>
    ),
    className: 'lg:@max-ws/main:hidden',
  },
  {
    id: 'progress',
    header: '我的進度',
    sortValue: (r) => progressSortValue(r.progress, r.exam.question_count),
    cell: (r) => <ProgressCell exam={r.exam} progress={r.progress} />,
    className: 'w-52',
  },
];

function ExamLinkLabel({ exam }: { exam: ExamSummary }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{examShortName(exam)}</span>
      {isNewSystem(exam) && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">新制</span>}
      {exam.session === 'makeup' && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>}
    </span>
  );
}

export function ExamTable({ exams, listSearch, filters, count }: { exams: readonly ExamSummary[]; listSearch: string; filters: ReactNode; count: ReactNode }) {
  const rows: Row[] = groupedExams(exams).map((exam) => ({ exam, progress: attemptProgress(exam.id) }));
  return (
    <div className="space-y-3">
      {/* main 不到 ws（1024 寬）：膠囊與學年度改小、間距縮小、筆數只給讀屏，篩選列維持一行（約 45px）。 */}
      <StickyBar className="flex flex-wrap items-center gap-x-6 gap-y-2 @max-ws/main:gap-x-4">
        {filters}
        <span className="ml-auto">{count}</span>
      </StickyBar>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">沒有符合條件的考卷。</p>
      ) : (
        <DataTable
          caption="歷屆試題"
          captionSrOnly
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => r.exam.id}
          primaryLink={(r) => ({ to: `/exams/${r.exam.id}`, label: <ExamLinkLabel exam={r.exam} />, state: { listSearch }, title: r.exam.title })}
          initialSort={{ id: 'exam', dir: 'desc' }}
          groupBy={(r) => examGroupKey(r.exam)}
          stickyHeader
        />
      )}
    </div>
  );
}
