/**
 * 卷子頁與成績頁共用的區塊：頁首、參考公式、各大題、題號一覽、出處、清除確認。
 */
import { MATH_SECTION_TYPE_LABELS, isMathAnswered, type MathItem } from '@gsat/shared';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { mathShortName, type MathPaper } from '../../../data/math';
import { scrollIntoPane } from '../../../components/desktop/scroll';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { EraBadge } from './Badges';
import { MathGroupView, mathItemAnchorId } from './MathItem';
import { MathText } from './MathText';

export function PaperHeader({ paper, subtitle }: { paper: MathPaper; subtitle?: string }) {
  const count = paper.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0);
  return (
    <header className="mb-4">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{mathShortName(paper)}</span>
        <EraBadge era={paper.era} />
        {subtitle && <span>・{subtitle}</span>}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{paper.title}</h1>
      <p className="mt-1 text-sm text-muted">
        {paper.time_minutes} 分鐘・滿分 {paper.full_score} 分・{count} 題
      </p>
    </header>
  );
}

/** 題本的「參考公式及可能用到的數值」：預設收合，需要時展開。 */
export function ReferenceFormulas({ paper }: { paper: MathPaper }) {
  if (paper.reference_formulas.length === 0) return null;
  return (
    <details className="rounded-2xl border border-line bg-surface p-4 [&[open]>summary]:mb-3">
      <summary className="cursor-pointer font-semibold">參考公式及可能用到的數值</summary>
      <ul className="space-y-1.5 text-sm leading-relaxed break-words">
        {paper.reference_formulas.map((f, i) => (
          <li key={i}>
            <MathText text={f} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function sectionAnchorId(id: string): string {
  return `msec-${id}`;
}

/** 全部大題（題本順序）。renderSelfAssess：成績頁在非選擇題的批改區加上自評。 */
export function PaperSections({ paper, renderSelfAssess }: { paper: MathPaper; renderSelfAssess?: (item: MathItem) => ReactNode }) {
  return (
    <div className="space-y-8">
      {paper.sections.map((section) => (
        <section key={section.id} aria-labelledby={`${sectionAnchorId(section.id)}-t`} className="space-y-4">
          <header id={sectionAnchorId(section.id)} tabIndex={-1} className="scroll-mt-32 border-b border-line pb-2">
            <h2 id={`${sectionAnchorId(section.id)}-t`} className="text-xl font-bold">
              {section.title}
            </h2>
            {section.instructions && <p className="mt-1 text-sm whitespace-pre-line text-muted">{section.instructions}</p>}
          </header>
          {section.groups.map((g) => (
            <MathGroupView key={g.id} group={g} renderSelfAssess={renderSelfAssess} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function goToMathItem(label: string): void {
  const card = document.getElementById(mathItemAnchorId(label));
  if (!card) return;
  scrollIntoPane(card, { block: 'start' });
  card.focus({ preventScroll: true });
}

/** 題號一覽：已作答的題號實心；點了捲到那一題。非選擇題（紙上作答）以虛線框表示。 */
export function QuestionNav({ paper }: { paper: MathPaper }) {
  const answers = useAttemptSelector((s) => s.answers);
  return (
    <nav aria-label="題號一覽">
      {paper.sections.map((section) => (
        <div key={section.id} className="mb-2">
          <p className="mb-1 text-xs font-semibold text-muted">{MATH_SECTION_TYPE_LABELS[section.type]}</p>
          <ul className="grid grid-cols-6 gap-1 lg:grid-cols-5">
            {section.groups.flatMap((g) =>
              g.items.map((item) => {
                const done = isMathAnswered(item, answers[item.label]);
                const paperOnly = item.type === 'constructed';
                return (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={() => goToMathItem(item.label)}
                      aria-label={`第 ${item.label} 題${paperOnly ? '（紙上作答）' : done ? '（已作答）' : '（未作答）'}`}
                      className={`flex h-8 w-full items-center justify-center rounded-md border text-sm tabular-nums ${
                        paperOnly ? 'border-dashed border-line text-muted' : done ? 'border-primary bg-primary text-on-primary' : 'border-line hover:border-primary'
                      }`}
                    >
                      {item.label}
                    </button>
                  </li>
                );
              }),
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** 出處（同英文歷屆試題的頁尾：說明性的試題來源，連到官方檔案）。 */
export function MathSourceNote({ paper }: { paper: MathPaper }) {
  return (
    <footer className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
      <p className="font-medium text-fg">試題來源：大學入學考試中心 {paper.title}（{paper.year} 學年度）</p>
      <p>
        本站依官方題本整理成文字與公式，圖從官方題本裁切並附文字描述；選擇（填）題答案取自官方公布的答案。非選擇題不轉載官方參考答案與評分原則，詳解為本站撰寫、不是官方解答。內容如有出入，以官方檔案為準。
      </p>
      {paper.official_files.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {paper.official_files.map((f) => (
            <li key={f.url}>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-primary underline-offset-2 hover:underline">
                {f.label}
                <span className="text-xs uppercase">（{f.format}）</span>
                <ExternalLink aria-hidden="true" className="size-3" />
                <span className="sr-only">（另開新分頁）</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}

/** 清除作答：先在原地確認一次，焦點在「取消」（連按 Enter 不會清掉）。 */
export function ClearControl({ onClear, label = '清除作答紀錄', question = '確定要清除這份卷子的作答與計時嗎？' }: { onClear: () => void; label?: string; question?: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (restore.current) triggerRef.current?.focus();
    restore.current = false;
  }, [confirming]);
  if (!confirming) {
    return (
      <button ref={triggerRef} type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
        {label}
      </button>
    );
  }
  const cancel = () => {
    restore.current = true;
    setConfirming(false);
  };
  return (
    <span
      role="group"
      aria-label="確認清除"
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
      className="inline-flex flex-wrap items-center gap-2 text-sm"
    >
      <span>{question}</span>
      <button ref={cancelRef} type="button" onClick={cancel} className="rounded-full border border-line px-3 py-1">
        取消
      </button>
      <button type="button" onClick={onClear} className="rounded-full bg-bad px-3 py-1 font-semibold text-on-primary">
        確定清除
      </button>
    </span>
  );
}
