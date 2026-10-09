/**
 * 一個 AI 題組的練習：作答（可以逐層看提示）→ 交卷計分 → 每題四段式解析卡、證據句加亮、全文中譯、排除法表 →「再一組」。
 *
 * 作答介面、計分、作答紀錄都沿用歷屆試題（features/exams）：題組包成只有一個大題的考卷（practiceExam.ts），
 * 作答 store 用考試模式（交卷前不顯示答案、沒有「看答案」按鈕）、不限時。
 * 練習才有的東西（提示、解析卡、AI 標示、證據句、自己畫的圖表、填充與簡答的自動判分）用 QuestionExtrasContext 插進題目元件。
 * 計分在 scoring.ts：選擇題沿用歷屆試題的規則，混合題的填充、簡答依 SPEC §4.6 自動判分。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { groupKey, type PracticeFigure, type PracticeGroupFile } from '../../data/bank';
import type { Question } from '../../data/exams';
import { AttemptContext } from '../exams/AttemptContext';
import { AttemptStore, createAttempt, loadAttempt } from '../exams/attempt';
import { ExamToolbar } from '../exams/components/ExamToolbar';
import { GroupView } from '../exams/components/Paper';
import { groupHasStimulus } from '../exams/components/Passage';
import { ExamContext } from '../exams/ExamContext';
import { QuestionExtrasContext, type QuestionExtras } from '../exams/QuestionExtras';
import type { AnswerValue } from '../exams/scoring';
import { isChartEvidence, evidenceRows } from './chart';
import { AiGroupBadge, AiSourceNote, TranslationDetails } from './components/AiNotice';
import { EliminationTable } from './components/EliminationTable';
import { ExplanationCard } from './components/ExplanationCard';
import { HintLadder, useHintsUsed } from './components/HintLadder';
import { MultiSelectCard, OpenAnswerFeedback, openAnswerNote } from './components/MixedCards';
import { renderPracticeFigure } from './components/PracticeFigure';
import { GradingPanel, ResultPanel } from './components/ResultPanel';
import { evidenceHighlights } from './evidence';
import { recordDone, recordGraded, updatePracticeHistory, usePracticeHistory } from './history';
import { PRACTICE_SECTION_LABELS, READING_OPTION_CODE_LABELS, TIER_LABELS, displayTopic } from './labels';
import { NO_PRACTICE_MISTAKES, recordPracticeMistakes, type PracticeMistakeResult } from './mistakes';
import { practiceAttemptId, practiceExam } from './practiceExam';
import { freezeGrades, needsWordIndex, scorePractice, useWordLookup, type PracticeScore } from './scoring';

const NO_EVIDENCE: readonly string[] = [];

/** 閱讀題的證據出自圖表或表格時，解析卡上標「圖表」「表格」。 */
function figureEvidenceSource(file: PracticeGroupFile): ((text: string) => string | null) | undefined {
  const figures = file.group.figures;
  if (!figures.some((f) => f.chart || f.rows)) return undefined;
  return (text) => {
    if (figures.some((f) => f.chart && isChartEvidence(f.chart, text))) return '圖表';
    if (figures.some((f) => f.rows && evidenceRows(f.rows, [text]).size > 0)) return '表格';
    return null;
  };
}

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
  const item = file.annotations.explanations.items[q.label];
  if (q.mode === 'multi_select') {
    return <MultiSelectCard q={q} item={item} group={file.group} answer={answer} hintsUsed={hintsUsed} onLocateEvidence={onLocate} />;
  }
  if (q.mode !== 'single_choice' && q.mode !== 'bank_choice') return null;
  const reading = file.section_type === 'reading';
  return (
    <ExplanationCard
      label={q.label}
      item={item}
      group={file.group}
      options={q.options ?? file.group.options_bank}
      answer={q.answer}
      chosen={typeof answer === 'string' && answer !== '' ? answer : null}
      hintsUsed={hintsUsed}
      onLocateEvidence={onLocate}
      codeLabels={reading ? READING_OPTION_CODE_LABELS : undefined}
      evidenceSource={reading ? figureEvidenceSource(file) : undefined}
      showBlankPos={!reading}
    />
  );
}

/** 填充、簡答交卷後：自動判分＋解析卡（同上，包一層才能讀提示紀錄）。 */
function OpenFor({
  file,
  q,
  answer,
  score,
  onLocate,
}: {
  file: PracticeGroupFile;
  q: Question;
  answer: AnswerValue | undefined;
  score: PracticeScore | null;
  onLocate: (label: string) => void;
}) {
  const hintsUsed = useHintsUsed(groupKey(file), q.label);
  if (q.mode !== 'fill_in_blank' && q.mode !== 'short_answer') return null;
  const outcome = score?.outcomes[q.label];
  const pair = score?.swapped.find((p) => p.includes(q.label));
  return (
    <OpenAnswerFeedback
      q={q}
      answer={answer}
      outcome={outcome?.kind === 'open' ? outcome : undefined}
      item={file.annotations.explanations.items[q.label]}
      group={file.group}
      swappedWith={pair ? (pair[0] === q.label ? pair[1] : pair[0]) : null}
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
  // 交卷後才需要整組的答案（計分、解析）；作答中不訂閱，打字時不必重繪整頁。
  const submittedAnswers = useSyncExternalStore(store.subscribe, () => {
    const state = store.getState();
    return state.submittedAt !== null ? state.answers : null;
  });
  const submittedAt = useSyncExternalStore(store.subscribe, () => store.getState().submittedAt);
  const { lookup, ready: lookupReady } = useWordLookup(file);
  const history = usePracticeHistory();
  // 交卷後的分數不能隨單字索引下載的早晚改變（scoring.ts 檔頭）：第一次判分的結果固定在練習紀錄裡，之後一律沿用；
  // 還沒有固定的判分時，有填充題就等索引下載好（或確定失敗）才判分，這段時間畫面顯示「判分中」。
  const graded = history.value.graded[key];
  const frozen = graded !== undefined && graded.submittedAt === submittedAt ? graded : null;
  const score = useMemo(() => {
    if (!submittedAnswers) return null;
    if (frozen) return scorePractice(file, submittedAnswers, lookup, frozen);
    return lookupReady ? scorePractice(file, submittedAnswers, lookup) : null;
  }, [file, submittedAnswers, lookup, lookupReady, frozen]);
  const needsFreeze = needsWordIndex(file);
  useEffect(() => {
    if (!score || frozen || submittedAt === null || !needsFreeze) return;
    updatePracticeHistory((h) => recordGraded(h, key, { submittedAt, ...freezeGrades(score) }));
  }, [score, frozen, submittedAt, needsFreeze, key]);
  const hintsForGroup = history.value.hints[key];
  const hinted = useMemo(
    () => file.group.questions.filter((q) => (hintsForGroup?.[q.label] ?? 0) > 0).map((q) => q.label),
    [file, hintsForGroup],
  );
  const [mistakes, setMistakes] = useState<PracticeMistakeResult>(NO_PRACTICE_MISTAKES);
  const [locate, setLocate] = useState<{ label: string; n: number } | null>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusResultWhenGraded = useRef(false);
  const wasSubmitted = useRef(submitted);
  const items = file.annotations.explanations.items;
  const hasPassage = groupHasStimulus(file.group);

  // 剛交卷：記成做過、答錯的詞彙題正解字收進單字錯題本，捲回頂端看成績（焦點移到「交卷結果」）。
  // 答對題數只看「等於可接受答案」，和單字索引無關（索引只影響拼字錯誤、字形的部分給分），交卷當下就可以記。
  useEffect(() => {
    if (wasSubmitted.current || !submitted) {
      wasSubmitted.current = submitted;
      return;
    }
    wasSubmitted.current = true;
    const answers = store.getState().answers;
    const result = scorePractice(file, answers);
    updatePracticeHistory((h) =>
      recordDone(h, file.uid, {
        version: file.version,
        section: file.section_type,
        tier: file.tier,
        at: new Date().toISOString(),
        correct: result.correct,
        total: result.total,
        hinted: hinted.length,
      }),
    );
    let alive = true;
    void recordPracticeMistakes(file, answers).then((result) => {
      if (alive) setMistakes(result);
    });
    window.scrollTo({ top: 0 });
    resultHeadingRef.current?.focus({ preventScroll: true });
    focusResultWhenGraded.current = true;
    return () => {
      alive = false;
    };
  }, [submitted, store, file, hinted.length]);

  // 交卷時還在判分（GradingPanel）：判分完換成 ResultPanel，原本在「判分中」標題上的焦點會掉到 body，移到新的標題上。
  // 學生這段時間已經點了別的地方（焦點不在 body）就不搶焦點。
  useEffect(() => {
    if (!score || !focusResultWhenGraded.current) return;
    focusResultWhenGraded.current = false;
    if (document.activeElement === null || document.activeElement === document.body) resultHeadingRef.current?.focus({ preventScroll: true });
  }, [score]);

  // 解析卡按「在文中標出證據句」：加深那一題的證據句、捲過去，並把焦點移到證據句的第一段
  // （鍵盤與螢幕閱讀器使用者也被帶到選文裡；同一題再按一次也要捲，所以帶計數）。
  // 多文本切在別的分頁時，選文收到 locateRequest 會先切到看得到證據句的分頁（Passage.tsx 的 partForEvidence），
  // 通常同一次 commit 就畫好了；萬一這時還找不到，下一個畫格再找一次。
  useEffect(() => {
    if (!locate) return;
    const label = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(locate.label) : locate.label;
    const go = () => {
      const mark = document.querySelector<HTMLElement>(`mark[data-evidence-label="${label}"]`);
      if (!mark) return false;
      mark.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      mark.focus({ preventScroll: true });
      return true;
    };
    if (go() || typeof requestAnimationFrame !== 'function') return;
    const frame = requestAnimationFrame(() => void go());
    return () => cancelAnimationFrame(frame);
  }, [locate]);

  const onLocate = useCallback((label: string) => setLocate((cur) => ({ label, n: (cur?.n ?? 0) + 1 })), []);
  const activeEvidence = locate?.label ?? null;
  const translation = file.annotations.translation_zh?.text ?? null;
  // 交卷後才把證據引用的資料點標在圖表與表格上（作答中標出來等於洩漏答案）。
  const figureEvidence = useMemo(
    () => (submitted ? Object.values(items).flatMap((item) => item.evidence) : NO_EVIDENCE),
    [submitted, items],
  );

  const extras = useMemo<QuestionExtras>(
    () => ({
      noOfficialStats: true,
      singleWordFill: true,
      renderWhileAnswering: (q) => (
        <HintLadder
          groupKey={key}
          label={q.label}
          hints={items[q.label]?.hints ?? []}
          title={q.mode === 'fill_in_blank' || q.mode === 'short_answer' ? `第 ${q.label} 題提示` : undefined}
        />
      ),
      renderAfterFeedback: (q, answer) => <CardFor file={file} q={q} answer={answer} onLocate={onLocate} />,
      renderOpenFeedback: (q, answer) => <OpenFor file={file} q={q} answer={answer} score={score} onLocate={onLocate} />,
      openAnswerNote,
      renderFigure: (figure) => renderPracticeFigure(figure as PracticeFigure, figureEvidence),
      passageFooter: (
        <div className="space-y-3">
          <AiSourceNote file={file} />
          {submitted && translation && <TranslationDetails text={translation} />}
        </div>
      ),
      extraHighlights: submitted ? (group) => evidenceHighlights(group, items, activeEvidence) : undefined,
      locateRequest: submitted ? locate : null,
    }),
    [key, items, file, onLocate, submitted, translation, activeEvidence, score, figureEvidence, locate],
  );

  const section = exam.sections[0];
  if (!section) return null;
  // 主題只顯示中文的（舊題組的英文主題是給出題工具用的短語）；SDG 編號用文字標示（SPEC §6.6）。
  const topic = displayTopic(file.group.tags?.topic);
  const sdgs = file.group.tags?.sdgs ?? [];
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
                {topic ? <>主題：{topic}・</> : null}
                {file.group.questions.length} 題
                {sdgs.length > 0 ? `・SDG ${sdgs.join('、')}` : ''}
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
            {submitted && !score && <GradingPanel headingRef={resultHeadingRef} />}
            {submitted && score && (
              <ResultPanel
                file={file}
                score={score}
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
