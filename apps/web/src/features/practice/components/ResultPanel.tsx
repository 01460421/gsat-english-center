/**
 * 交卷結果：答對幾題、得分、用時、用了提示的題目、互換偵測（選項庫題型），以及「再一組」。
 * 計分沿用歷屆試題的 scoreExam（單選、選項庫答對得全分，SPEC §4.6）。
 */
import { RotateCcw } from 'lucide-react';
import { useId, useMemo, type RefObject } from 'react';
import { Link } from 'react-router';
import type { PracticeGroupFile } from '../../../data/bank';
import type { ChoiceQuestion, Exam, Question } from '../../../data/exams';
import { useAttemptSelector } from '../../exams/AttemptContext';
import { groupHasStimulus } from '../../exams/components/Passage';
import { formatDuration } from '../../exams/labels';
import { formatPercent, formatPoints, scoreExam, type AnswerValue } from '../../exams/scoring';
import { evidenceRanges } from '../evidence';
import type { PracticeMistakeResult } from '../mistakes';

/** 錯一格常連帶錯兩格：找出「第 i 格填了第 j 格的答案、第 j 格填了第 i 格的答案」的配對（SPEC §6.4 互換偵測）。 */
export function swappedPairs(questions: readonly Question[], answers: Readonly<Record<string, AnswerValue>>): [string, string][] {
  const choice = questions.filter((q): q is ChoiceQuestion => q.mode === 'bank_choice');
  const out: [string, string][] = [];
  for (let i = 0; i < choice.length; i += 1) {
    for (let j = i + 1; j < choice.length; j += 1) {
      const a = choice[i];
      const b = choice[j];
      if (!a || !b || a.answer === b.answer) continue;
      if (answers[a.label] === b.answer && answers[b.label] === a.answer) out.push([a.label, b.label]);
    }
  }
  return out;
}

/**
 * 結果面板最後一行：證據句在哪裡看。依實際找得到的證據句決定說法，不能一律說「選文裡加底線」：
 * 詞彙題沒有選文（證據在題幹），篇章結構的正解句證據是選項句，不在選文裡。
 */
export function evidenceGuide(file: Pick<PracticeGroupFile, 'group' | 'annotations'>): string {
  const base = '每一題下方有正確答案與四段式解析';
  const items = Object.values(file.annotations.explanations.items);
  const total = items.reduce((n, item) => n + item.evidence.length, 0);
  const located = groupHasStimulus(file.group) ? items.reduce((n, item) => n + evidenceRanges(file.group, item).length, 0) : 0;
  if (located === 0) return `${base}，證據句列在每一題的解析卡裡。`;
  if (located < total) return `${base}；選文裡加底線的是證據句，不在選文裡的證據（例如選項句）只列在解析卡裡。`;
  return `${base}；選文裡加底線的是證據句。`;
}

/** 單字錯題本的結果：收進去的字（變化形附上原形）、沒能收進去的字。 */
function MistakeNotes({ mistakes }: { mistakes: PracticeMistakeResult }) {
  const { recorded, missed, indexFailed } = mistakes;
  return (
    <>
      {recorded.length > 0 && (
        <li>
          答錯的正解字已收進
          <Link to="/words?tab=mistakes" className="mx-0.5 text-primary underline underline-offset-2">
            單字錯題本
          </Link>
          ：
          <span lang="en">
            {recorded.map((r) => (r.word.toLowerCase() === r.answer.toLowerCase() ? r.word : `${r.word}（${r.answer}）`)).join('、')}
          </span>
        </li>
      )}
      {missed.length > 0 && (
        <li>
          {indexFailed ? '單字索引載入失敗，這些正解字沒能收進單字錯題本' : '這些正解字不在單字表裡（或是不規則變化），沒能收進單字錯題本'}：
          <span lang="en">{missed.join('、')}</span>
        </li>
      )}
    </>
  );
}

export function ResultPanel({
  file,
  exam,
  headingRef,
  hinted,
  mistakes,
  repeatNotice,
  onNext,
}: {
  file: PracticeGroupFile;
  exam: Exam;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** 用了提示的題號。 */
  hinted: readonly string[];
  /** 詞彙題答錯的正解字收進單字錯題本的結果。 */
  mistakes: PracticeMistakeResult;
  /** 「再一組」會不會抽到做過的（這一格都做過了）。 */
  repeatNotice: string | null;
  onNext: () => void;
}) {
  const answers = useAttemptSelector((s) => s.answers);
  const elapsed = useAttemptSelector((s) => s.elapsedSec);
  const score = useMemo(() => scoreExam(exam, answers), [exam, answers]);
  const section = score.sections[0];
  const titleId = useId();
  const swaps = useMemo(() => swappedPairs(file.group.questions, answers), [file, answers]);
  const correct = section?.correctCount ?? 0;
  const total = section?.autoCount ?? 0;
  const guide = useMemo(() => evidenceGuide(file), [file]);

  return (
    <section aria-labelledby={titleId} className="rounded-2xl border-2 border-primary bg-surface p-5 lg:p-6">
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-xl font-bold">
        交卷結果
      </h2>
      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <p className="text-sm text-muted">答對</p>
          <p className="text-4xl font-bold tabular-nums">
            {correct}
            <span className="text-lg font-normal text-muted">／{total} 題</span>
          </p>
          {total > 0 && <p className="text-sm text-muted">答對率 {formatPercent(correct / total)}</p>}
        </div>
        <div>
          <p className="text-sm text-muted">得分</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatPoints(score.earned)}／{formatPoints(score.autoMax)} 分
          </p>
        </div>
        <div>
          <p className="text-sm text-muted">用時</p>
          <p className="text-2xl font-semibold">{formatDuration(elapsed)}</p>
        </div>
      </div>
      <ul className="mt-4 ml-5 list-disc space-y-1 text-sm">
        {hinted.length > 0 && (
          <li>
            用了提示：第 {hinted.join('、')} 題（照樣計分，但不算「第一次就答對」）。
          </li>
        )}
        {swaps.map(([a, b]) => (
          <li key={`${a}-${b}`} className="text-bad">
            第 {a} 題和第 {b} 題的答案互換了：兩格的選項放反，常是只看詞性、沒有比對上下文。
          </li>
        ))}
        <MistakeNotes mistakes={mistakes} />
        <li className="text-muted">{guide}</li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 font-semibold text-on-primary"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          再一組
        </button>
        <Link to="/practice" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium hover:border-primary">
          回到題庫練習
        </Link>
      </div>
      {repeatNotice && <p className="mt-2 text-sm text-muted">{repeatNotice}</p>}
    </section>
  );
}
