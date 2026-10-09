/**
 * 大題導覽（一次顯示一個大題）與題號面板。
 *
 * 大題導覽：八個大題按鈕，各顯示已答／題數與標記數；目前的大題 aria-current。
 * 題號面板（展開／收合）：所有題號的方格，已答實心、未答空心、標記加旗號，目前大題的題號外框加粗。
 * 點題號預設是「前往」（切到該大題並捲到那一題）；切到「標記」時點題號是標記／取消標記——
 * 文意選填、篇章結構的空格在選文裡，沒有題號標題可以放「標記」按鈕，要從這裡標記。
 */
import { ChevronDown, Flag } from 'lucide-react';
import { useId, useState } from 'react';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { questionTitle } from '../../exams/richText';
import { isAnswered } from '../../exams/scoring';
import { useMockMeta, useMockSession } from '../MockSessionContext';
import type { PaperIndex } from '../paperIndex';

export function SectionNavigator({ index, onGo }: { index: PaperIndex; onGo: (sectionId: string) => void }) {
  const active = useMockMeta((m) => m.activeSectionId);
  const marked = useMockMeta((m) => m.marked);
  const answers = useAttemptSelector((s) => s.answers);
  return (
    <nav aria-label="大題導覽" className="rounded-2xl border border-line bg-surface p-2">
      {/* 手機上一列放不下八個大題：在這個區塊內左右捲動（整頁不會水平捲動）。 */}
      <ol className="flex snap-x gap-2 overflow-x-auto p-1 lg:flex-wrap lg:overflow-visible">
        {index.sections.map((s, i) => {
          const answered = s.labels.filter((l) => isAnswered(answers[l])).length;
          const flags = s.labels.filter((l) => marked.includes(l)).length;
          const current = s.id === active;
          return (
            <li key={s.id} className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onGo(s.id)}
                aria-current={current ? 'step' : undefined}
                aria-label={`${i + 1}. ${s.label}，已答 ${answered}／${s.labels.length} 題${flags > 0 ? `，標記 ${flags} 題` : ''}`}
                className={`flex min-h-11 flex-col items-start rounded-xl border px-3 py-1 text-left text-sm ${
                  current ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line hover:border-primary'
                }`}
              >
                <span className="whitespace-nowrap">{s.label}</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted tabular-nums">
                  {answered}／{s.labels.length}
                  {flags > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-badge-fg">
                      <Flag aria-hidden="true" className="size-3 fill-current" />
                      {flags}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function QuestionPalette({ index, onGoQuestion }: { index: PaperIndex; onGoQuestion: (label: string) => void }) {
  const session = useMockSession();
  const active = useMockMeta((m) => m.activeSectionId);
  const marked = useMockMeta((m) => m.marked);
  const readOnly = useMockMeta((m) => m.status === 'submitted');
  const answers = useAttemptSelector((s) => s.answers);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'go' | 'mark'>('go');
  const id = useId();
  const answeredCount = index.labels.filter((l) => isAnswered(answers[l])).length;

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-line bg-surface">
      <h2 id={`${id}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-2 text-left font-semibold"
        >
          <span>
            題號面板
            <span className="ml-2 text-sm font-normal text-muted tabular-nums">
              已答 {answeredCount}／{index.labels.length}・標記 {marked.length}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className={`size-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </h2>
      {open && (
        <div id={`${id}-panel`} className="space-y-3 border-t border-line px-4 pt-3 pb-4">
          <fieldset className="min-w-0">
            <legend className="text-sm text-muted">點題號時</legend>
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              {(
                [
                  ['go', '前往那一題'],
                  ['mark', '標記／取消標記'],
                ] as const
              ).map(([value, text]) => (
                <label key={value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} className="accent-[var(--primary)]" />
                  {text}
                </label>
              ))}
            </div>
          </fieldset>
          {index.sections.map((s) => (
            <div key={s.id}>
              <h3 className={`text-sm ${s.id === active ? 'font-semibold text-primary' : 'text-muted'}`}>
                {s.label}
                {s.id === active && <span className="ml-1 text-xs">（目前大題）</span>}
              </h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {s.labels.map((label) => {
                  const done = isAnswered(answers[label]);
                  const flag = marked.includes(label);
                  const status = `${done ? '已作答' : '未作答'}${flag ? '，已標記' : ''}`;
                  return (
                    <li key={label}>
                      <button
                        type="button"
                        disabled={mode === 'mark' && readOnly}
                        aria-pressed={mode === 'mark' ? flag : undefined}
                        aria-label={`${questionTitle(label)}，${status}`}
                        onClick={() => (mode === 'mark' ? session.toggleMarks([label]) : onGoQuestion(label))}
                        className={`relative inline-flex size-11 items-center justify-center rounded-lg text-sm tabular-nums ${
                          done ? 'bg-primary text-on-primary' : 'border border-line bg-bg'
                        } ${s.id === active ? 'outline-2 outline-offset-1 outline-primary' : ''}`}
                      >
                        <span className={label.length > 3 ? 'text-[0.65rem] leading-tight' : ''}>{label.replace('中譯英', '譯')}</span>
                        {flag && (
                          <Flag aria-hidden="true" className="absolute -top-1 -right-1 size-4 rounded-full bg-badge-bg fill-badge-fg p-0.5 text-badge-fg" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted">實心＝已作答、空心＝未作答、旗號＝已標記；文意選填與篇章結構的空格請從這裡標記。</p>
        </div>
      )}
    </section>
  );
}
