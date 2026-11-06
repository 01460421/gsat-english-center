/**
 * 本站詳解（docs/design/math.md §6）：看答案（練習模式）或交卷後才下載 /data/math/solutions/{id}.json。
 * 還沒有詳解的題目顯示「詳解準備中」；詳解檔載入失敗只影響詳解區，題目與批改照常。
 */
import { mathUnitLabel, type MathItem } from '@gsat/shared';
import { Component, createContext, Suspense, use, useMemo, type ReactNode } from 'react';
import { loadMathSolutions, type MathSolutions } from '../../data/math';
import { useAttemptSelector } from '../exams/AttemptContext';
import { MathMarkdown } from './components/MathMarkdown';
import { MathText } from './components/MathText';

const SolutionsContext = createContext<Promise<MathSolutions> | null>(null);

/** 需要時（看過任何一題的答案，或已交卷）才開始下載詳解。 */
export function SolutionsProvider({ paperId, children }: { paperId: string; children: ReactNode }) {
  const needed = useAttemptSelector((s) => s.submittedAt !== null || s.revealed.length > 0);
  const promise = useMemo(() => (needed ? loadMathSolutions(paperId) : null), [needed, paperId]);
  return <SolutionsContext value={promise}>{children}</SolutionsContext>;
}

class SolutionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return <p className="text-sm text-muted">詳解暫時載入失敗，請重新整理頁面再試一次。</p>;
  }
}

function SolutionBody({ promise, item }: { promise: Promise<MathSolutions>; item: MathItem }) {
  const solutions = use(promise);
  const sol = solutions.items[String(item.no)];
  if (!sol) {
    return (
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
        <strong className="text-fg">詳解準備中</strong>：本站詳解正在撰寫與驗算，完成後會出現在這裡。
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary">本站詳解</span>
        <span>{sol.checked ? 'AI 撰寫・已獨立驗算' : 'AI 撰寫'}</span>
        {sol.unit && <span>・單元：{mathUnitLabel(sol.unit)}</span>}
        {sol.difficulty && <span className="rounded-full bg-surface-2 px-2 py-0.5">{sol.difficulty}</span>}
      </p>
      <MathMarkdown md={sol.solution_md} />
      {/* 詳解本文已經有「答案」段落時不再重複。 */}
      {sol.answer_display && !sol.solution_md.includes('**答案**') && (
        <p className="text-sm">
          <span className="font-semibold">答案：</span>
          <MathText text={sol.answer_display} />
        </p>
      )}
    </div>
  );
}

/** 一題的詳解區。 */
export function SolutionView({ item }: { item: MathItem }) {
  const promise = use(SolutionsContext);
  return (
    <section aria-label={`第 ${item.label} 題詳解`} className="mt-3 rounded-xl border border-line bg-bg p-3">
      <h4 className="mb-2 text-sm font-semibold">詳解</h4>
      {promise === null ? (
        <p className="text-sm text-muted">看答案或交卷後顯示。</p>
      ) : (
        <SolutionBoundary>
          <Suspense fallback={<p className="text-sm text-muted" role="status">詳解載入中…</p>}>
            <SolutionBody promise={promise} item={item} />
          </Suspense>
        </SolutionBoundary>
      )}
    </section>
  );
}
