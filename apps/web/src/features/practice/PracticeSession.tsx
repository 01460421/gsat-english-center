/**
 * 一個 AI 題組的練習：作答（可以逐層看提示）→ 交卷計分 → 每題四段式解析卡、證據句加亮、全文中譯、排除法表 →「再一組」。
 *
 * 作答介面、計分、作答紀錄都沿用歷屆試題（features/exams）：題組包成只有一個大題的考卷（practiceExam.ts），
 * 作答 store 用考試模式（交卷前不顯示答案、沒有「看答案」按鈕）、不限時。
 * 練習才有的東西（提示、解析卡、AI 標示、證據句）用 QuestionExtrasContext 插進題目元件。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { groupKey, type PracticeGroupFile } from '../../data/bank';
import type { Question } from '../../data/exams';
import { AttemptContext } from '../exams/AttemptContext';
import { AttemptStore, createAttempt, loadAttempt } from '../exams/attempt';
import { ExamToolbar } from '../exams/components/ExamToolbar';
import { GroupView } from '../exams/components/Paper';
import { groupHasStimulus } from '../exams/components/Passage';
import { ExamContext } from '../exams/ExamContext';
import { QuestionExtrasContext, type QuestionExtras } from '../exams/QuestionExtras';
import { scoreExam, type AnswerValue } from '../exams/scoring';
import { AiGroupBadge, AiSourceNote, TranslationDetails } from './components/AiNotice';
import { EliminationTable } from './components/EliminationTable';
import { ExplanationCard } from './components/ExplanationCard';
import { HintLadder, useHintsUsed } from './components/HintLadder';
import { ResultPanel } from './components/ResultPanel';
import { evidenceHighlights } from './evidence';
import { recordDone, updatePracticeHistory, usePracticeHistory } from './history';
import { PRACTICE_SECTION_LABELS, TIER_LABELS } from './labels';
import { NO_PRACTICE_MISTAKES, recordPracticeMistakes, type PracticeMistakeResult } from './mistakes';
import { practiceAttemptId, practiceExam } from './practiceExam';

/** 解析卡：作答時看過幾層提示要從練習紀錄讀，所以包一層元件（renderAfterFeedback 只是函式，不能用 hook）。 */
function CardFor({
  file,
  q,
  answer,
  onLocate,
}: {
  file: PracticeGroupFile;
  q: Question;
  answer: AnswerValue | undefined;
  onLocate: (label: string) => void;
}) {
  const hintsUsed = useHintsUsed(groupKey(file), q.label);
  if (q.mode !== 'single_choice' && q.mode !== 'bank_choice') return null;
  return (
    <ExplanationCard
      label={q.label}
      item={file.annotations.explanations.items[q.label]}
      group={file.group}
      options={q.options ?? file.group.options_bank}
      answer={q.answer}
      chosen={typeof answer === 'string' && answer !== '' ? answer : null}
      hintsUsed={hintsUsed}
      onLocateEvidence={onLocate}
    />
  );
}

/** 選項庫題組（文意選填、篇章結構）沒有逐題的卡片，提示集中列在題組下方。 */
function BankHints({ file }: { file: PracticeGroupFile }) {
  const key = groupKey(file);
  const used = usePracticeHistory().value.hints[key];
  const [open, setOpen] = useState(() => Object.values(used ?? {}).some((n) => n > 0));
  const items = file.annotations.explanations.items;
  const questions = file.group.questions.filter((q) => (items[q.label]?.hints?.length ?? 0) > 0);
  if (questions.length === 0) return null;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-2xl border border-line bg-surface p-4">
      <summary className="cursor-pointer font-semibold">
        需要提示嗎？
        <span className="ml-2 text-sm font-normal text-muted">每一題最多 3 層，由淺到深</span>
      </summary>
      <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {questions.map((q) => (
          <li key={q.label} className="min-w-0">
            <HintLadder groupKey={key} label={q.label} hints={items[q.label]?.hints ?? []} title={`第 ${q.label} 題提示`} className="" />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function GroupSession({
  file,
  notice,
  repeatNotice,
  onNext,
}: {
  file: PracticeGroupFile;
  /** 開頭的說明（接續上次、這一格都做過了）。 */
  notice: string | null;
  /** 「再一組」會不會抽到做過的。 */
  repeatNotice: string | null;
  onNext: () => void;
}) {
  const key = groupKey(file);
  const exam = useMemo(() => practiceExam(file), [file]);
  // 有作答紀錄就接續；沒有就建立新的（第一次作答時才寫進 localStorage）。考試模式＝交卷前不顯示答案；不限時。
  const [store] = useState(() => {
    const saved = loadAttempt(practiceAttemptId(file));
    return new AttemptStore(saved ?? createAttempt(practiceAttemptId(file), 'exam', null));
  });
  const submitted = useSyncExternalStore(store.subscribe, () => store.getState().submittedAt !== null);
  const persisted = useSyncExternalStore(store.subscribe, () => store.persisted);
  const history = usePracticeHistory();
  const hintsForGroup = history.value.hints[key];
  const hinted = useMemo(
    () => file.group.questions.filter((q) => (hintsForGroup?.[q.label] ?? 0) > 0).map((q) => q.label),
    [file, hintsForGroup],
  );
  const [mistakes, setMistakes] = useState<PracticeMistakeResult>(NO_PRACTICE_MISTAKES);
  const [locate, setLocate] = useState<{ label: string; n: number } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const wasSubmitted = useRef(submitted);
  const items = file.annotations.explanations.items;
  const hasPassage = groupHasStimulus(file.group);

  // 剛交卷：記成做過、答錯的詞彙題正解字收進單字錯題本，捲回頂端看成績（焦點移到「交卷結果」）。
  useEffect(() => {
    if (wasSubmitted.current || !submitted) {
      wasSubmitted.current = submitted;
      return;
    }
    wasSubmitted.current = true;
    const answers = store.getState().answers;
    const section = scoreExam(exam, answers).sections[0];
    updatePracticeHistory((h) =>
      recordDone(h, file.uid, {
        version: file.version,
        section: file.section_type,
        tier: file.tier,
        at: new Date().toISOString(),
        correct: section?.correctCount ?? 0,
        total: section?.autoCount ?? 0,
        hinted: hinted.length,
      }),
    );
    let alive = true;
    void recordPracticeMistakes(file, answers).then((result) => {
      if (alive) setMistakes(result);
    });
    window.scrollTo({ top: 0 });
    resultHeadingRef.current?.focus({ preventScroll: true });
    return () => {
      alive = false;
    };
  }, [submitted, store, exam, file, hinted.length]);

  // 解析卡按「在文中標出證據句」：加深那一題的證據句、捲過去，並把焦點移到證據句的第一段
  // （鍵盤與螢幕閱讀器使用者也被帶到選文裡；同一題再按一次也要捲，所以帶計數）。
  useEffect(() => {
    if (!locate) return;
    const label = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(locate.label) : locate.label;
    const mark = document.querySelector<HTMLElement>(`mark[data-evidence-label="${label}"]`);
    if (!mark) return;
    mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    mark.focus({ preventScroll: true });
  }, [locate]);

  const onLocate = useCallback((label: string) => setLocate((cur) => ({ label, n: (cur?.n ?? 0) + 1 })), []);
  const activeEvidence = locate?.label ?? null;
  const translation = file.annotations.translation_zh?.text ?? null;

  const extras = useMemo<QuestionExtras>(
    () => ({
      noOfficialStats: true,
      renderWhileAnswering: (q) => <HintLadder groupKey={key} label={q.label} hints={items[q.label]?.hints ?? []} />,
      renderAfterFeedback: (q, answer) => <CardFor file={file} q={q} answer={answer} onLocate={onLocate} />,
      passageFooter: (
        <div className="space-y-3">
          <AiSourceNote file={file} />
          {submitted && translation && <TranslationDetails text={translation} />}
        </div>
      ),
      extraHighlights: submitted ? (group) => evidenceHighlights(group, items, activeEvidence) : undefined,
    }),
    [key, items, file, onLocate, submitted, translation, activeEvidence],
  );

  const section = exam.sections[0];
  if (!section) return null;
  const elimination = file.annotations.elimination;
  const isBank = file.group.options_bank !== null && file.group.questions.every((q) => q.mode === 'bank_choice');

  return (
    <ExamContext value={exam}>
      <AttemptContext value={store}>
        <QuestionExtrasContext value={extras}>
          <div className="space-y-5">
            <header className="space-y-2">
              <title>{`${PRACTICE_SECTION_LABELS[file.section_type]}・${TIER_LABELS[file.tier]}｜題庫練習｜學測英文中心`}</title>
              <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
                {PRACTICE_SECTION_LABELS[file.section_type]}・{TIER_LABELS[file.tier]}
              </h1>
              <p className="text-sm text-muted">
                {file.group.tags?.topic ? (
                  <>
                    主題：<span lang="en">{file.group.tags.topic}</span>・
                  </>
                ) : null}
                {file.group.questions.length} 題
              </p>
              <AiGroupBadge />
              {notice && <p className="rounded-xl bg-primary-soft px-4 py-2 text-sm">{notice}</p>}
            </header>
            {!persisted && (
              <p role="status" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">
                這個瀏覽器無法儲存作答進度（可能是無痕模式或停用了網站資料），重新整理後答案會遺失。
              </p>
            )}
            <ExamToolbar exam={exam} modeLabel="題庫練習" />
            {submitted && (
              <ResultPanel
                file={file}
                exam={exam}
                headingRef={resultHeadingRef}
                hinted={hinted}
                mistakes={mistakes}
                repeatNotice={repeatNotice}
                onNext={onNext}
              />
            )}
            {submitted && elimination && file.group.options_bank && (
              <EliminationTable
                elimination={elimination}
                questions={file.group.questions}
                bank={file.group.options_bank}
                answers={store.getState().answers}
                structure={file.section_type === 'structure'}
              />
            )}
            <section aria-label="題目" className="space-y-3">
              <p className="text-sm text-muted">{section.instructions}</p>
              <GroupView group={file.group} section={section} />
            </section>
            {!submitted && isBank && <BankHints file={file} />}
            {!hasPassage && (
              <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
                <AiSourceNote file={file} items />
                {submitted && translation && <TranslationDetails text={translation} />}
              </div>
            )}
            {submitted && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <button type="button" onClick={onNext} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-on-primary">
                  再一組
                </button>
                {repeatNotice && <p className="text-sm text-muted">{repeatNotice}</p>}
              </div>
            )}
          </div>
        </QuestionExtrasContext>
      </AttemptContext>
    </ExamContext>
  );
}
