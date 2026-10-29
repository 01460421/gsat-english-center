/**
 * /assistant/mistakes：錯題與疑點清單（docs/design/learning-assistant.md §5.1、§5.9）。
 *
 *   - 資料：這台裝置的本機作答紀錄（題庫練習、自組卷、歷屆試題、真題模考）、單字錯題本，登入時另外列已批改的寫作。
 *     純本機、不登入也能看；第一次開啟先補登已經交卷的歷屆試題與模考（backfill.ts）。
 *   - 一列一個題組（同一組的錯題與疑點併成一列），預設依「建議先問」排序（rankMistakes.ts），可以改成新到舊。
 *   - 篩選：來源、大題、日期、只看沒問過的、錯題或疑點。題庫題先看本站解析（免費）；同技能多組時合併提示。
 *   - 手機是卡片列表；桌機（≥ lg）是 DataTable，篩選列用 StickyBar（R3：同時只有一份）。
 *   - 篩選後至少 3 列錯題時：「用目前篩選的錯題組一份加強卷」（docs/design/weak-paper.md §3.1；大題與技能由 focusFromRows 依提升度挑）。
 */
import { ASSIST_SECTION_LABELS, ASSIST_STANDARDS, type AssistSection } from '@gsat/shared';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { DataTable, type Column } from '../../components/desktop/DataTable';
import { StickyBar } from '../../components/desktop/StickyBar';
import { useIsDesktop } from '../../lib/media';
import { BackLink } from '../writing/components/ui';
import { useSignedIn } from '../writing/lib/access';
import { backfillOutcomes } from './backfill';
import { AssistGate, AssistHeader } from './components/AssistAccess';
import { inputCls } from './components/parts';
import { isAskedHref, readAsked } from './lib/asked';
import { readPrefs } from './lib/prefs';
import { getOutcomes } from './outcomes';
import { DEFAULT_TARGET_LEVEL, rankMistakes, skillClusterNotes, weakestSkills, type RankedRow } from './rankMistakes';
import { focusFromRows } from './papers/focus';
import { weakPaperVisible } from './papers/flags';
import { papersHref } from './papers/params';
import { rowSummary } from './sources/common';
import { listMistakes } from './sources';
import { ZH_COPY } from './subjects/chinese/copy';
import { useAssistSubjects } from './subjects/useAssistSubjects';
import type { MistakeRow, MistakeSource } from './sources/types';

const SOURCE_LABELS: Record<MistakeSource, string> = {
  bank: '題庫練習',
  bank_mock: '自組模考',
  exam: '歷屆試題',
  mock: '真題模考',
  vocab: '單字錯題本',
  writing: '寫作批改',
};

const STANDARD_LEVELS: Record<(typeof ASSIST_STANDARDS)[number], number> = { top: 13, front: 11, mean: 8 };
const DAY_MS = 86_400_000;
const DATE = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });

function targetLevel(): number {
  const t = readPrefs().target;
  if (!t) return DEFAULT_TARGET_LEVEL;
  return 'level' in t ? t.level : STANDARD_LEVELS[t.standard];
}

interface Filters {
  source: MistakeSource | 'all';
  section: AssistSection | 'all';
  days: 7 | 30 | 0;
  kind: 'all' | 'mistake' | 'doubt';
  notAsked: boolean;
  sort: 'suggested' | 'recent';
}

const INITIAL: Filters = { source: 'all', section: 'all', days: 0, kind: 'all', notAsked: false, sort: 'suggested' };

function useMistakeRows(): { rows: MistakeRow[] | null; reload: () => void } {
  const signedIn = useSignedIn();
  const [rows, setRows] = useState<MistakeRow[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      await backfillOutcomes().catch(() => 0);
      const list = await listMistakes({ signedIn });
      if (alive) setRows(list);
    })();
    return () => {
      alive = false;
    };
  }, [signedIn, attempt]);
  return { rows, reload: () => setAttempt((n) => n + 1) };
}

function RowActions({ row, asked }: { row: MistakeRow; asked: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.askHref && (
        <Link to={row.askHref} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-on-primary" aria-label={`問學習助手：${row.title}`}>
          問學習助手
        </Link>
      )}
      {row.links.map((l) => (
        <Link key={l.to} to={l.to} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm lg:hover:border-primary">
          {l.label}
        </Link>
      ))}
      {row.maybeFree && !asked && <span className="text-xs text-muted">可能 0 點（之前有同學問過同一題同樣的答案時）</span>}
      {asked && <span className="text-xs text-muted">問過</span>}
    </div>
  );
}

function MobileList({ ranked, asked, clusters }: { ranked: RankedRow[]; asked: (row: MistakeRow) => boolean; clusters: Map<string, string> }) {
  return (
    <ul className="space-y-3">
      {ranked.map(({ row, note }) => (
        <li key={row.key} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold break-words">{row.title}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            <span>{SOURCE_LABELS[row.source]}</span>
            {rowSummary(row) && <span>{rowSummary(row)}</span>}
            {row.at > 0 && <span>{DATE.format(new Date(row.at))}</span>}
          </p>
          {note && <p className="text-sm font-medium text-primary">{note}</p>}
          {clusters.get(row.key) && <p className="text-sm text-muted">{clusters.get(row.key)}</p>}
          <RowActions row={row} asked={asked(row)} />
        </li>
      ))}
    </ul>
  );
}

function DesktopTable({ ranked, asked, clusters }: { ranked: RankedRow[]; asked: (row: MistakeRow) => boolean; clusters: Map<string, string> }) {
  const columns: Column<RankedRow>[] = [
    {
      id: 'title',
      header: '題目',
      cell: ({ row, note }) => (
        <span className="block text-sm text-muted">
          {[note, clusters.get(row.key)].filter(Boolean).join('；')}
        </span>
      ),
    },
    { id: 'source', header: '來源', cell: ({ row }) => SOURCE_LABELS[row.source], sortValue: ({ row }) => SOURCE_LABELS[row.source] },
    { id: 'summary', header: '狀態', cell: ({ row }) => rowSummary(row) || '—' },
    { id: 'date', header: '日期', cell: ({ row }) => (row.at > 0 ? DATE.format(new Date(row.at)) : '—'), sortValue: ({ row }) => row.at, align: 'end' },
    {
      id: 'actions',
      header: '動作',
      srOnlyHeader: true,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          {row.links.map((l) => (
            <Link key={l.to} to={l.to} className="text-sm text-primary underline underline-offset-2">
              {l.label}
            </Link>
          ))}
          {row.maybeFree && !asked(row) && <span className="text-xs text-muted">可能 0 點</span>}
          {asked(row) && <span className="text-xs text-muted">問過</span>}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      caption="錯題與疑點"
      captionSrOnly
      columns={columns}
      rows={ranked}
      rowKey={({ row }) => row.key}
      primaryLink={({ row }) => (row.askHref ? { to: row.askHref, label: row.title } : { to: row.links[0]?.to ?? '/assistant', label: row.title })}
      stickyHeader
      empty={<p className="py-6 text-center text-muted">沒有符合篩選的題目。</p>}
    />
  );
}

function Body() {
  const { rows } = useMistakeRows();
  const zhOpen = useAssistSubjects().isOpen('chinese');
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const isDesktop = useIsDesktop();
  const id = useId();
  const askedSet = useMemo(() => readAsked(), [rows]);
  const asked = (row: MistakeRow) => isAskedHref(row.askHref, askedSet);
  const weak = useMemo(() => (rows ? weakestSkills(getOutcomes().items) : []), [rows]);
  const sections = useMemo(() => [...new Set((rows ?? []).map((r) => r.section).filter((s): s is AssistSection => s !== null))], [rows]);
  const ranked = useMemo(() => {
    if (!rows) return [];
    const now = Date.now();
    const filtered = rows.filter(
      (r) =>
        (filters.source === 'all' || r.source === filters.source) &&
        (filters.section === 'all' || r.section === filters.section) &&
        (filters.days === 0 || now - r.at <= filters.days * DAY_MS) &&
        (filters.kind === 'all' || r.kind === filters.kind) &&
        (!filters.notAsked || !isAskedHref(r.askHref, askedSet)),
    );
    return rankMistakes(filtered, { targetLevel: targetLevel(), weakSkills: weak, sort: filters.sort });
  }, [rows, filters, askedSet, weak]);
  const clusters = useMemo(() => skillClusterNotes(rows ?? []), [rows]);
  const [papersVisible] = useState(weakPaperVisible);
  // 加強卷的入口：篩選後的錯題（不含只有疑點的列）至少 3 列時，依提升度挑大題與技能（focus.ts）。
  const papersLink = useMemo(() => {
    if (!papersVisible) return null;
    const mistakes = ranked.map((r) => r.row).filter((r) => r.kind === 'mistake' && r.questionSkills && r.questionSkills.length > 0);
    if (mistakes.length < 3) return null;
    const focus = focusFromRows(
      mistakes.map((r) => ({ section: r.section, questions: r.questionSkills ?? [] })),
      getOutcomes().items,
      { now: Date.now(), onlySection: filters.section === 'all' ? null : filters.section },
    );
    if (focus.sections.length === 0) return null;
    const n = mistakes.reduce((sum, r) => sum + (r.questionSkills?.length ?? 0), 0);
    // 提升度一起帶過去（預覽寫「錯題裡比你平常多 x 倍」）：lift=it:inference:1.8。
    const lift = Object.entries(focus.lifts ?? {}).map(([code, value]) => `${code}:${value}`);
    return papersHref({ kind: 'w', from: 'mistakes', section: focus.sections, skill: focus.skills, lift, n });
  }, [papersVisible, ranked, filters.section]);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={`${id}-source`} className="block text-sm font-medium">
          來源
        </label>
        <select id={`${id}-source`} value={filters.source} onChange={(e) => set('source', e.currentTarget.value as Filters['source'])} className={`mt-1 min-h-11 ${inputCls}`}>
          <option value="all">全部</option>
          {(Object.keys(SOURCE_LABELS) as MistakeSource[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-section`} className="block text-sm font-medium">
          大題
        </label>
        <select id={`${id}-section`} value={filters.section} onChange={(e) => set('section', e.currentTarget.value as Filters['section'])} className={`mt-1 min-h-11 ${inputCls}`}>
          <option value="all">全部</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {ASSIST_SECTION_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-days`} className="block text-sm font-medium">
          日期
        </label>
        <select id={`${id}-days`} value={filters.days} onChange={(e) => set('days', Number(e.currentTarget.value) as Filters['days'])} className={`mt-1 min-h-11 ${inputCls}`}>
          <option value={0}>全部</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-kind`} className="block text-sm font-medium">
          種類
        </label>
        <select id={`${id}-kind`} value={filters.kind} onChange={(e) => set('kind', e.currentTarget.value as Filters['kind'])} className={`mt-1 min-h-11 ${inputCls}`}>
          <option value="all">錯題與疑點</option>
          <option value="mistake">只看錯題</option>
          <option value="doubt">只看答對的疑點</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-sort`} className="block text-sm font-medium">
          排序
        </label>
        <select id={`${id}-sort`} value={filters.sort} onChange={(e) => set('sort', e.currentTarget.value as Filters['sort'])} className={`mt-1 min-h-11 ${inputCls}`}>
          <option value="suggested">建議先問</option>
          <option value="recent">新到舊</option>
        </select>
      </div>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={filters.notAsked} onChange={(e) => set('notAsked', e.currentTarget.checked)} className="size-4 accent-[var(--primary)]" />
        只看沒問過的
      </label>
    </div>
  );

  return (
    <div className="space-y-5 lg:bleed">
      <BackLink to="/assistant">學習助手</BackLink>
      <AssistHeader title="錯題與疑點" docTitle="錯題與疑點｜學習助手">
        <p className="text-muted">
          這台裝置上答錯、部分給分、未作答，以及答對但標記過、用了提示的題目。預設依「建議先問」排序：同程度考生大多答對、你卻答錯的題排前面。
        </p>
        {/* 錯題清單第一版只有英文的站內作答紀錄；國文的解析在首頁篩選（docs/design/assistant-subjects.md §1.6）。 */}
        {zhOpen && (
          <p className="text-sm text-muted">
            {ZH_COPY.mistakesHint}
            <Link to="/assistant" className="ml-1 font-medium text-primary underline underline-offset-2">
              到學習助手首頁
            </Link>
          </p>
        )}
      </AssistHeader>
      {isDesktop ? <StickyBar label="篩選">{filterBar}</StickyBar> : filterBar}
      {rows === null ? (
        <p role="status" className="text-muted">
          讀取作答紀錄中…
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">
          <p className="font-semibold">還沒有錯題或疑點</p>
          <p className="mt-1 text-muted">做一組題庫練習、一份歷屆試題或模擬考，交卷後答錯的題就會出現在這裡。也可以直接貼上一題問。</p>
          <Link to="/assistant/new" className="mt-3 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
            貼上題目
          </Link>
        </div>
      ) : (
        <>
          <p role="status" className="text-sm text-muted">
            共 {ranked.length} 組{ranked.length !== rows.length ? `（全部 ${rows.length} 組）` : ''}
          </p>
          {papersLink && (
            <p className="text-sm">
              <Link to={papersLink} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
                用目前篩選的錯題組一份加強卷
              </Link>
            </p>
          )}
          {isDesktop ? <DesktopTable ranked={ranked} asked={asked} clusters={clusters} /> : <MobileList ranked={ranked} asked={asked} clusters={clusters} />}
        </>
      )}
    </div>
  );
}

export default function MistakesPage() {
  return (
    <AssistGate>
      <Body />
    </AssistGate>
  );
}
