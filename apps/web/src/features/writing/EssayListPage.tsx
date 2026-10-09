/**
 * /writing/essay：歷屆作文題目列表。負責：前端寫作 W2。
 *
 * 題目來自 /data/writing/essay.json（build-data.mjs 從 /data/exams 整理：composition 大題的說明、提示、圖的文字描述）。
 * 看圖作文的原圖不轉載，作答頁附官方題本 PDF 連結。學測／指考／參考試卷分開，各自新到舊。
 */
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { dataErrorMessage } from '../../data/client';
import { EXAM_KIND_LABELS } from '../../data/exams';
import { APP_NAME } from '../../modules';
import { KindFilter, WRITING_KINDS, useKindFilter, type WritingKindFilter } from './components/KindFilter';
import { BackLink, DataError, Loading } from './components/ui';
import { loadEssayIndex, type EssayPrompt } from './data';
import { ESSAY_TYPE_LABELS, essayRequirement, examRefLabel } from './lib/format';
import { useStaticData } from './lib/hooks';
import { useListOriginState } from './lib/listOrigin';

function PromptCard({ prompt }: { prompt: EssayPrompt }) {
  const requirement = essayRequirement(prompt);
  const origin = useListOriginState();
  return (
    <Link to={`/writing/essay/${encodeURIComponent(prompt.exam_id)}`} state={origin} className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-primary">
      <span className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-lg font-semibold">{examRefLabel(prompt)}</span>
          {prompt.essay_type && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{ESSAY_TYPE_LABELS[prompt.essay_type] ?? '其他'}</span>}
          {prompt.session === 'makeup' && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>}
        </span>
        <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      </span>
      {prompt.stem && <span className="line-clamp-3 break-words text-[0.95rem]">{prompt.stem.replace(/^提示[︰:：]\s*/, '')}</span>}
      <span className="text-sm text-muted">
        {[requirement, prompt.figures.length > 0 ? `附 ${prompt.figures.length} 張圖（文字描述）` : null].filter(Boolean).join('・')}
      </span>
    </Link>
  );
}

export default function EssayListPage() {
  return (
    <article>
      <title>{`英文作文題目｜${APP_NAME}`}</title>
      <BackLink to="/writing">寫作練習</BackLink>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">英文作文題目</h1>
      <p className="mt-3 text-muted">
        歷屆學測、指考與參考試卷的作文題。可以在網頁上打字，也可以（通過 AI 申請後）拍照上傳手寫稿，由 AI 辨識文字再批改。
      </p>
      <EssayPromptList className="mt-6" />
    </article>
  );
}

/** 題目列表本體（篩選、各考試的題目卡片、題目來源）：這一頁與英文作文題型頁（pages/CompositionPage.tsx）共用。 */
export function EssayPromptList({ className = '' }: { className?: string }) {
  const data = useStaticData(loadEssayIndex);
  const [kind, setKind] = useKindFilter();
  return (
      <div className={`space-y-6 ${className}`}>
        {data.status === 'loading' && <Loading>題目載入中…</Loading>}
        {data.status === 'error' && <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />}
        {data.status === 'ready' && <EssayLists prompts={data.value.prompts} kind={kind} onKind={setKind} />}
        <footer className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
          題目來源：大學入學考試中心歷屆試題。圖片改以文字描述（原圖請看作答頁的官方題本 PDF）；本站不轉載官方評分原則原文與範文。
        </footer>
      </div>
  );
}

function EssayLists({ prompts, kind, onKind }: { prompts: EssayPrompt[]; kind: WritingKindFilter; onKind: (k: WritingKindFilter) => void }) {
  const counts = {
    all: prompts.length,
    gsat: prompts.filter((p) => p.exam === 'gsat').length,
    ast: prompts.filter((p) => p.exam === 'ast').length,
    reference: prompts.filter((p) => p.exam === 'reference').length,
  };
  const kinds = kind === 'all' ? WRITING_KINDS : [kind];
  return (
    <>
      <KindFilter value={kind} onChange={onKind} counts={counts} />
      {kinds.map((k) => {
        const list = prompts.filter((p) => p.exam === k).sort((a, b) => b.year - a.year || (a.session === b.session ? 0 : a.session === 'regular' ? -1 : 1));
        if (list.length === 0) return null;
        return (
          <section key={k} aria-labelledby={`el-${k}`}>
            <h2 id={`el-${k}`} className="mb-3 text-lg font-semibold">
              {EXAM_KIND_LABELS[k]}
              <span className="ml-2 text-sm font-normal text-muted">{list.length} 題</span>
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {list.map((p) => (
                <li key={p.exam_id} className="min-w-0">
                  <PromptCard prompt={p} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
