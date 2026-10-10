/**
 * /writing/translation：歷屆中譯英題目列表。負責：前端寫作 W2。
 *
 * 題目來自 /data/writing/translation.json（build-data.mjs 從 /data/exams 同一份資料整理，只有中文題目，
 * 沒有也不能有官方譯文，D8）。學測／指考／參考試卷分開，各自依學年度新到舊。
 */
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { dataErrorMessage } from '../../data/client';
import { EXAM_KIND_LABELS } from '../../data/exams';
import { APP_NAME } from '../../modules';
import { KindFilter, WRITING_KINDS, useKindFilter, type WritingKindFilter } from './components/KindFilter';
import { SourceTabs } from './components/SourceTabs';
import { BackLink, DataError, Loading } from './components/ui';
import { isAiGradableTranslation, loadTranslationIndex, type TranslationSet } from './data';
import { examRefLabel } from './lib/format';
import { useStaticData } from './lib/hooks';
import { useListOriginState } from './lib/listOrigin';

function SetCard({ set }: { set: TranslationSet }) {
  const aiReady = isAiGradableTranslation(set);
  const origin = useListOriginState();
  return (
    <Link to={`/writing/translation/${encodeURIComponent(set.exam_id)}`} state={origin} className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-primary">
      <span className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-lg font-semibold">{examRefLabel(set)}</span>
          {set.session === 'makeup' && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>}
          {!aiReady && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
              {set.items.length !== 2 ? `${set.items.length} 句` : '舊制計分'}・自我檢核
            </span>
          )}
        </span>
        <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      </span>
      <ol className="list-decimal space-y-1 pl-5 text-[0.95rem]">
        {set.items.map((item) => (
          <li key={item.label} className="break-words">
            {item.stem}
          </li>
        ))}
      </ol>
    </Link>
  );
}

export default function TranslationListPage() {
  return (
    <article>
      <title>{`中譯英題目｜${APP_NAME}`}</title>
      <BackLink to="/writing">寫作練習</BackLink>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">中譯英題目</h1>
      <SourceTabs kind="translation" current="exam" />
      <p className="mt-3 text-muted">
        歷屆學測、指考與參考試卷的中譯英。點選一組開始作答：可以用自我檢核清單自己檢查，或（登入並通過申請後）請 AI 批改。
      </p>
      <TranslationPromptList className="mt-6" />
    </article>
  );
}

/**
 * 題目列表本體（篩選、各考試的題組卡片、題目來源）：這一頁與中譯英題型頁（pages/TranslationPage.tsx）共用。
 * 各考試的標題預設是 <h2>；題型頁把列表放在「歷屆試題」<h2> 底下，傳 headingLevel={3}。
 */
export function TranslationPromptList({ className = '', headingLevel = 2 }: { className?: string; headingLevel?: 2 | 3 }) {
  const data = useStaticData(loadTranslationIndex);
  const [kind, setKind] = useKindFilter();
  return (
    <div className={`space-y-6 ${className}`}>
      {data.status === 'loading' && <Loading>題目載入中…</Loading>}
      {data.status === 'error' && <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />}
      {data.status === 'ready' && <TranslationLists sets={data.value.sets} kind={kind} onKind={setKind} headingLevel={headingLevel} />}
      <footer className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
        題目來源：大學入學考試中心歷屆試題。本站只整理中文題目，不轉載官方參考譯文；各題作答頁附有官方題本與評分原則的連結。
      </footer>
    </div>
  );
}

function TranslationLists({
  sets,
  kind,
  onKind,
  headingLevel,
}: {
  sets: TranslationSet[];
  kind: WritingKindFilter;
  onKind: (k: WritingKindFilter) => void;
  headingLevel: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const counts = {
    all: sets.length,
    gsat: sets.filter((s) => s.exam === 'gsat').length,
    ast: sets.filter((s) => s.exam === 'ast').length,
    reference: sets.filter((s) => s.exam === 'reference').length,
  };
  const kinds = kind === 'all' ? WRITING_KINDS : [kind];
  return (
    <>
      <KindFilter value={kind} onChange={onKind} counts={counts} />
      {kinds.map((k) => {
        const list = sets.filter((s) => s.exam === k).sort((a, b) => b.year - a.year || (a.session === b.session ? 0 : a.session === 'regular' ? -1 : 1));
        if (list.length === 0) return null;
        return (
          <section key={k} aria-labelledby={`tl-${k}`}>
            <Heading id={`tl-${k}`} className="mb-3 text-lg font-semibold">
              {EXAM_KIND_LABELS[k]}
              <span className="ml-2 text-sm font-normal text-muted">{list.length} 組</span>
            </Heading>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((s) => (
                <li key={s.exam_id} className="min-w-0">
                  <SetCard set={s} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
