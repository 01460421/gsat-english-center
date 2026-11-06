/**
 * 數學卷子的成績頁（/math/:paperId/results）：交卷後的自動批改分數、各大題與逐題對錯、官方答對率（有公布時），
 * 以及每題的本站詳解（docs/design/math.md §5、§6）。
 *
 * 成績單把「自動批改分數（選擇＋選填，滿分 88；111 數B 是 90）」和「非選擇題」分開：非選擇題不自動給分，
 * 學生看詳解後可以自評（0～配分，存在這台裝置），合計另外列，不混進自動批改分數。拍照 AI 批改是之後的步驟，這裡只有預告。
 */
import { MATH_ITEM_TYPE_LABELS, choiceAnswerText, iterateMathItems, scoreMathPaper, type MathItem } from '@gsat/shared';
import { ChevronLeft } from 'lucide-react';
import { Suspense, use, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DataLoadError, forgetFailedLoads } from '../../data/client';
import { loadMathPaper, mathShortName, type MathPaper } from '../../data/math';
import { APP_NAME } from '../../modules';
import { AttemptContext, useAttemptSelector } from '../exams/AttemptContext';
import type { AttemptStore } from '../exams/attempt';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { clearMathAttempt, loadMathAttempt, loadSelfScores, resumeMathAttempt, saveSelfScores, type SelfScores } from './attempt';
import { loadKatex } from './katex';
import { fillAnswerLatex } from './components/FillInput';
import { mathItemAnchorId } from './components/MathItem';
import { Tex } from './components/MathText';
import { formatDuration } from './components/MathToolbar';
import { ClearControl, MathSourceNote, PaperHeader, PaperSections, ReferenceFormulas, goToMathItem, sectionAnchorId } from './components/PaperParts';
import { SolutionsProvider } from './solutions';
import { subjectSearch } from './nav';
import './math.css';

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, '');
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

const STATUS = {
  correct: { text: '答對', tone: 'text-ok' },
  partial: { text: '部分', tone: 'text-primary' },
  wrong: { text: '答錯', tone: 'text-bad' },
  unanswered: { text: '未答', tone: 'text-muted' },
} as const;

function YourAnswer({ item }: { item: MathItem }) {
  const answer = useAttemptSelector((s) => s.answers[item.label]);
  if (item.type === 'constructed') return <span className="text-muted">紙上作答</span>;
  if (answer === undefined) return <span className="text-muted">—</span>;
  if (item.type === 'fill' && item.fill) return <Tex tex={fillAnswerLatex(item.fill, typeof answer === 'string' ? [answer] : answer)} />;
  const list = typeof answer === 'string' ? [answer] : answer;
  return <>{list.map((a) => `(${a})`).join('')}</>;
}

function CorrectAnswer({ item }: { item: MathItem }) {
  if (item.type === 'fill' && item.fill) return <Tex tex={item.fill.answer_latex} />;
  if (item.type === 'constructed') return <span className="text-muted">見詳解</span>;
  return <>{choiceAnswerText(item)}</>;
}

function Summary({ paper, selfScores, headingRef }: { paper: MathPaper; selfScores: SelfScores; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const answers = useAttemptSelector((s) => s.answers);
  const elapsed = useAttemptSelector((s) => s.elapsedSec);
  const limit = useAttemptSelector((s) => s.timeLimitSec);
  const reason = useAttemptSelector((s) => s.submitReason);
  const mode = useAttemptSelector((s) => s.mode);
  const score = useMemo(() => scoreMathPaper(paper, answers), [paper, answers]);
  const items = useMemo(() => [...iterateMathItems(paper)].map((r) => r.item), [paper]);
  const constructed = items.filter((i) => i.type === 'constructed');
  const selfDone = constructed.filter((i) => selfScores[i.label] !== undefined);
  const selfTotal = selfDone.reduce((n, i) => n + (selfScores[i.label] ?? 0), 0);
  const hasStats = items.some((i) => typeof i.stats?.correct_rate === 'number');
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border-2 border-primary bg-surface p-5 lg:p-6">
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-xl font-bold">
        交卷結果
      </h2>
      {reason === 'timeout' && <p className="mt-1 font-medium text-bad">時間到，已自動交卷。</p>}
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
        <div>
          <p className="text-sm text-muted">自動批改（選擇＋選填）</p>
          <p className="text-4xl font-bold tabular-nums">
            {fmt(score.earned)}
            <span className="text-lg font-normal text-muted">／{fmt(score.autoMax)}</span>
          </p>
          {score.autoMax > 0 && <p className="text-sm text-muted">得分率 {pct(score.earned / score.autoMax)}</p>}
        </div>
        {score.manualMax > 0 && (
          <div>
            <p className="text-sm text-muted">非選擇題（自評）</p>
            <p className="text-2xl font-semibold tabular-nums">
              {selfDone.length > 0 ? fmt(selfTotal) : '—'}
              <span className="text-base font-normal text-muted">／{fmt(score.manualMax)}</span>
            </p>
            <p className="text-sm text-muted">{selfDone.length < constructed.length ? `對照詳解自評（已評 ${selfDone.length}／${constructed.length} 題）` : '已全部自評'}</p>
          </div>
        )}
        <div>
          <p className="text-sm text-muted">用時</p>
          <p className="text-2xl font-semibold">{formatDuration(elapsed)}</p>
          <p className="text-sm text-muted">{mode === 'exam' && limit !== null ? `限時 ${Math.round(limit / 60)} 分鐘` : '練習模式'}</p>
        </div>
        <div>
          <p className="text-sm text-muted">已作答（選擇＋選填）</p>
          <p className="text-2xl font-semibold tabular-nums">
            {score.answeredCount}／{score.autoCount}
          </p>
        </div>
      </div>
      {selfDone.length > 0 && score.manualMax > 0 && (
        <p className="mt-3 text-sm">
          合計（含自評）：<strong className="tabular-nums">{fmt(score.earned + selfTotal)}</strong>／{fmt(score.autoMax + score.manualMax)} 分（自評部分僅供參考）
        </p>
      )}

      <div className="mt-5 overflow-x-auto" tabIndex={0} role="region" aria-label="各大題得分">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">各大題得分</caption>
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">大題</th>
              <th scope="col" className="py-2 pr-3 font-medium">答對</th>
              <th scope="col" className="py-2 font-medium">得分</th>
            </tr>
          </thead>
          <tbody>
            {score.sections.map((s) => (
              <tr key={s.sectionId} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(sectionAnchorId(s.sectionId));
                      el?.scrollIntoView({ block: 'start' });
                      el?.focus({ preventScroll: true });
                    }}
                    className="text-left text-primary underline-offset-2 hover:underline"
                  >
                    {s.title.replace(/（.*?）/, '')}
                  </button>
                </th>
                <td className="py-2 pr-3 tabular-nums">{s.autoCount > 0 ? `${s.correctCount}／${s.autoCount}` : '—'}</td>
                <td className="py-2 tabular-nums">
                  {fmt(s.earned)}／{fmt(s.autoMax)}
                  {s.manualMax > 0 && <span className="text-muted">（另 {fmt(s.manualMax)} 分非選擇題自評）</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 font-semibold">逐題結果</h3>
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="逐題結果">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">逐題結果</caption>
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th scope="col" className="py-2 pr-2 font-medium">題號</th>
              <th scope="col" className="py-2 pr-2 font-medium">題型</th>
              <th scope="col" className="py-2 pr-2 font-medium">結果</th>
              <th scope="col" className="py-2 pr-2 font-medium">你的答案</th>
              <th scope="col" className="py-2 pr-2 font-medium">正確答案</th>
              <th scope="col" className="py-2 pr-2 font-medium">得分</th>
              {hasStats && <th scope="col" className="py-2 font-medium">全國答對率</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const o = score.items[item.label];
              return (
                <tr key={item.label} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <a
                      href={`#${mathItemAnchorId(item.label)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        goToMathItem(item.label);
                      }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {item.label}
                    </a>
                  </th>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{MATH_ITEM_TYPE_LABELS[item.type].replace('題', '')}</td>
                  <td className={`py-1.5 pr-2 font-semibold whitespace-nowrap ${o?.kind === 'auto' ? STATUS[o.status].tone : 'text-muted'}`}>
                    {o?.kind === 'auto' ? STATUS[o.status].text : selfScores[item.label] !== undefined ? '已自評' : '自評'}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <YourAnswer item={item} />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <CorrectAnswer item={item} />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                    {o?.kind === 'auto' ? `${fmt(o.earned)}／${fmt(o.max)}` : `${selfScores[item.label] !== undefined ? fmt(selfScores[item.label] ?? 0) : '—'}／${fmt(item.points)}`}
                  </td>
                  {hasStats && (
                    <td className="py-1.5 tabular-nums">{typeof item.stats?.correct_rate === 'number' ? pct(item.stats.correct_rate) : '—'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 ml-5 list-disc space-y-1 text-sm text-muted">
        <li>依題本封面的計分方式：單選答對得全分；多選答錯 k 個選項得 (n − 2k)/n 題分；選填每格全對才給分。</li>
        <li>{hasStats ? '全國答對率取自官方統計。' : '這份卷子的官方答對率尚未整理進來。'}每題的本站詳解在下方，往下捲動即可檢討。</li>
      </ul>
    </section>
  );
}

function SelfAssess({ item, value, onChange }: { item: MathItem; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const id = useId();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
      <label htmlFor={id} className="font-semibold">
        自評分數
      </label>
      <select
        id={id}
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
        className="rounded-lg border border-line bg-bg px-2 py-1"
      >
        <option value="">未評</option>
        {Array.from({ length: item.points + 1 }, (_, k) => (
          <option key={k} value={k}>
            {k} 分
          </option>
        ))}
      </select>
      <span className="text-muted">／{item.points} 分：看完詳解後，依自己的計算過程與答案給分（只存在這台裝置，不列入自動批改）。</span>
    </div>
  );
}

function Results({ paper, store }: { paper: MathPaper; store: AttemptStore }) {
  const navigate = useNavigate();
  const [selfScores, setSelfScores] = useState<SelfScores>(() => loadSelfScores(paper.id));
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  const setSelf = (label: string, v: number | undefined) => {
    const next = { ...selfScores };
    if (v === undefined) delete next[label];
    else next[label] = v;
    setSelfScores(next);
    saveSelfScores(paper.id, next);
  };
  const restart = () => {
    clearMathAttempt(paper.id);
    navigate(`/math/${paper.id}`);
  };
  return (
    <AttemptContext value={store}>
      <div className="space-y-6">
        <Summary paper={paper} selfScores={selfScores} headingRef={headingRef} />
        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/math${subjectSearch(paper)}`} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-primary">
            回到卷子列表
          </Link>
          <ClearControl onClear={restart} label="清除作答，重新開始" question="確定要清除這份卷子的作答與成績嗎？清除後無法復原。" />
        </div>
        <ReferenceFormulas paper={paper} />
        <SolutionsProvider paperId={paper.id}>
          <PaperSections
            paper={paper}
            renderSelfAssess={(item) =>
              item.type === 'constructed' ? <SelfAssess item={item} value={selfScores[item.label]} onChange={(v) => setSelf(item.label, v)} /> : null
            }
          />
        </SolutionsProvider>
        <MathSourceNote paper={paper} />
      </div>
    </AttemptContext>
  );
}

function ResultsLoader({ promise }: { promise: Promise<MathPaper> }) {
  const paper = use(promise);
  use(loadKatex());
  const [store] = useState(() => {
    const saved = loadMathAttempt(paper.id);
    return saved && saved.submittedAt !== null ? resumeMathAttempt(saved) : null;
  });
  return (
    <>
      <title>{`${mathShortName(paper)} 成績與詳解｜學測數學｜${APP_NAME}`}</title>
      <PaperHeader paper={paper} subtitle="成績與詳解" />
      {store ? (
        <Results paper={paper} store={store} />
      ) : (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-lg font-semibold">還沒有交卷</h2>
          <p className="mt-1 text-muted">這台裝置沒有這份卷子的交卷紀錄。作答並交卷後，成績、逐題對錯與詳解會出現在這裡。</p>
          <Link to={`/math/${paper.id}`} className="mt-3 inline-block rounded-full bg-primary px-4 py-2 font-medium text-on-primary">
            開始作答
          </Link>
        </section>
      )}
    </>
  );
}

export default function MathResultsPage() {
  const { paperId = '' } = useParams();
  const [retry, setRetry] = useState(0);
  const promise = useMemo(() => loadMathPaper(paperId), [paperId, retry]);
  return (
    <article>
      <Link to={`/math/${paperId}`} className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
        <ChevronLeft aria-hidden="true" className="size-4" />
        回到卷子
      </Link>
      <DataErrorBoundary
        key={`${paperId}:${retry}`}
        onRetry={() => {
          forgetFailedLoads();
          setRetry((n) => n + 1);
        }}
        renderError={(error) =>
          error instanceof DataLoadError && error.kind === 'not_found' ? (
            <section className="py-6">
              <title>{`找不到這份卷子｜${APP_NAME}`}</title>
              <h1 className="text-2xl font-bold">找不到這份卷子</h1>
              <Link to="/math" className="mt-4 inline-block rounded-full bg-primary px-4 py-2 font-medium text-on-primary">
                回到學測數學
              </Link>
            </section>
          ) : null
        }
      >
        <Suspense
          fallback={
            <p role="status" className="py-10 text-center text-muted">
              成績載入中…
            </p>
          }
        >
          <ResultsLoader promise={promise} />
        </Suspense>
      </DataErrorBoundary>
    </article>
  );
}
