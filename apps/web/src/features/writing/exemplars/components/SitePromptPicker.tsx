/**
 * 「選網站上的題目」（docs/design/model-essays.md §1.5 第 1 步、§8.2）：歷屆作文與本站仿真作文（只列白名單的來源，
 * sitePrompts.ts）。來源切換、歷屆依考試篩選、本站仿真依難度篩選、關鍵字搜尋；選一題 → 呼叫端把 ?group= 寫進網址、打開確認畫面。
 * 本站仿真題在這台裝置還沒對照過時標「寫完並對照後再看」（§1.3：沿用「寫完才對照、對照後鎖定」）。
 * 清單是按鈕（選了就打開同一頁的確認面板，不換路由）；手機與桌機同一棵樹（只有篩選與一列列的按鈕）。
 */
import { TIERS, TIER_LABELS, type Tier } from '@gsat/shared';
import { ChevronRight, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { dataErrorMessage } from '../../../../data/client';
import { DataError, Loading, textInput } from '../../components/ui';
import { bankProgressOf } from '../../bank/drafts';
import { useStaticData } from '../../lib/hooks';
import { BANK_LOCK_TAG } from '../labels';
import { loadSiteTasks, type SiteSource, type SiteTask } from '../lib/sitePrompts';

type ExamFilter = 'all' | 'gsat' | 'ast' | 'reference';

const EXAM_FILTERS: Array<[ExamFilter, string]> = [
  ['all', '全部'],
  ['gsat', '學測'],
  ['ast', '指考'],
  ['reference', '參考試卷'],
];

const pill =
  'inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary';

/** 選題器顯示的上限（篩選後的前 n 題；其餘按「顯示更多」）。 */
const PAGE = 20;

export function SitePromptPicker({ onPick }: { onPick: (task: SiteTask) => void }) {
  const data = useStaticData(loadSiteTasks);
  const id = useId();
  const [source, setSource] = useState<SiteSource>('exam');
  const [exam, setExam] = useState<ExamFilter>('all');
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    if (data.status !== 'ready') return [];
    const q = query.trim().toLowerCase();
    return data.value.filter(
      (t) =>
        t.source === source &&
        (source !== 'exam' || exam === 'all' || t.exam === exam) &&
        (source !== 'bank' || tier === 'all' || t.tier === tier) &&
        (q === '' || q.split(/\s+/).every((w) => t.search.includes(w))),
    );
  }, [data, source, exam, tier, query]);

  if (data.status === 'loading') return <Loading>題目載入中…</Loading>;
  if (data.status === 'error') return <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />;

  const reset = () => setShown(PAGE);
  const sources = (['exam', 'bank'] as const).filter((s) => data.value.some((t) => t.source === s));
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="text-sm font-semibold">題目來源</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {sources.map((s) => (
            <label key={s} className={pill}>
              <input
                type="radio"
                name={`${id}-source`}
                className="sr-only"
                checked={source === s}
                onChange={() => {
                  setSource(s);
                  reset();
                }}
              />
              {s === 'exam' ? '歷屆試題' : '本站仿真'}
            </label>
          ))}
        </div>
      </fieldset>
      {source === 'exam' ? (
        <fieldset>
          <legend className="text-sm font-semibold">考試</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {EXAM_FILTERS.map(([value, label]) => (
              <label key={value} className={pill}>
                <input
                  type="radio"
                  name={`${id}-exam`}
                  className="sr-only"
                  checked={exam === value}
                  onChange={() => {
                    setExam(value);
                    reset();
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <fieldset>
          <legend className="text-sm font-semibold">難度</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {(['all', ...TIERS] as const).map((value) => (
              <label key={value} className={pill}>
                <input
                  type="radio"
                  name={`${id}-tier`}
                  className="sr-only"
                  checked={tier === value}
                  onChange={() => {
                    setTier(value);
                    reset();
                  }}
                />
                {value === 'all' ? '全部' : TIER_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <label htmlFor={`${id}-q`} className="text-sm font-semibold">
          關鍵字
        </label>
        <div className="relative mt-1">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              reset();
            }}
            placeholder={source === 'exam' ? '例如 115、寵物、信' : '例如 運動、圖表'}
            className={`${textInput} min-h-11 pl-9`}
          />
        </div>
      </div>
      <p className="text-sm text-muted" role="status">
        {filtered.length} 題
      </p>
      {filtered.length === 0 ? (
        <p className="rounded-xl bg-surface-2 p-4 text-sm text-muted">沒有符合的題目，換個關鍵字或篩選看看。</p>
      ) : (
        <ul className="space-y-2" aria-label="網站上的作文題目">
          {filtered.slice(0, shown).map((t) => {
            const locked = t.source === 'bank' && bankProgressOf('essay', t.group_id) !== 'done';
            return (
              <li key={t.group_id}>
                <button
                  type="button"
                  onClick={() => onPick(t)}
                  className="group flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left lg:hover:border-primary"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold break-words">{t.title}</span>
                      {t.tier && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{TIER_LABELS[t.tier]}</span>}
                      {locked && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">{BANK_LOCK_TAG}</span>}
                    </span>
                    {t.excerpt && <span className="mt-0.5 block text-sm text-muted break-words">{t.excerpt}</span>}
                  </span>
                  <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted lg:group-hover:text-primary" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE * 2)} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">
          顯示更多（還有 {filtered.length - shown} 題）
        </button>
      )}
    </div>
  );
}
