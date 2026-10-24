/**
 * 自組卷成績單的檢討試卷（docs/design/bank-mock.md §6.5 第 7 項）：選擇題與混合題（s1–s6）用現有的 ExamPaper 顯示，
 * 交卷後的作答（唯讀）＋本站的答案與解析。中譯英與作文不經過 ExamPaper（那裡的回饋是寫給歷屆題的），改在自評區顯示本站的內容。
 *
 * 傳入的 QuestionExtras：
 *   renderAfterFeedback   題庫練習的四段式解析卡（ExplanationCard；多選題 MultiSelectCard），選項說明已依 §5.3 換好字母
 *   renderOpenFeedback    混合題填充、簡答：本站答案、完整的可接受答案與判分理由（OpenAnswerFeedback）
 *   renderFigure          圖表自己畫，交卷後標出解析引用的數據；表格不顯示文字描述
 *   noOfficialStats       不顯示「沒有官方答對率統計」的說明（AI 題本來就沒有）
 *   作答時標記過的題目加上標記章；解析卡的「在文中標出證據句」加亮並捲到選文裡的證據句（同題庫練習）
 *
 * 出版社題組（加強卷，docs/design/weak-paper.md §8.7「成績單、檢討試卷：同線上作答」）：每組上方的出處列（renderGroupSource）、
 * 解析卡標「解析：{出版社}提供」（不標 AI 撰寫）、沒有解析的寫「這組沒有解析」；「問學習助手」只在授權包含 ai_assist 時出現（§9.6）。
 * 只用本站題的卷子不設 renderGroupSource、不下載來源登記，畫面和原本相同。
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { ExplanationItem } from '../../../data/bank';
import type { Exam, Question, QuestionGroup } from '../../../data/exams';
import { AttemptContext } from '../../exams/AttemptContext';
import { AttemptStore } from '../../exams/attempt';
import { ExamContext } from '../../exams/ExamContext';
import { QuestionExtrasContext, type QuestionExtras } from '../../exams/QuestionExtras';
import { ExamPaper, SectionNav } from '../../exams/components/Paper';
import type { AnswerValue } from '../../exams/scoring';
import { ExplanationCard } from '../../practice/components/ExplanationCard';
import { MultiSelectCard, OpenAnswerFeedback } from '../../practice/components/MixedCards';
import { evidenceHighlights } from '../../practice/evidence';
import { PUBLISHER_NO_EXPLANATION, READING_OPTION_CODE_LABELS, publisherExplanationBy } from '../../practice/labels';
import { MarkedBadge } from '../components/MarkToggle';
import { AskEntry, choiceState } from '../../assistant/components/AskEntry';
import { okFromRatio } from '../../assistant/outcomes';
import { isAnswered } from '../../exams/scoring';
import type { MockAttemptRecord } from '../storage';
import { bankFigureRenderer } from './bankFigure';
import type { BankOpenScores } from './bankScore';
import type { BankPaper, BankPaperGroup } from './buildExam';
import { OBJECTIVE_SECTION_TYPES } from './deduction';
import { groupSourceRenderer, useAskAllowed } from './GroupSourceLine';

interface Located {
  group: QuestionGroup;
  reading: boolean;
  /** 卷子裡那一組的出處（出版社題組；本站題是 undefined）。 */
  source: BankPaperGroup['source'];
  /** 出版社授權結束、題目已經遮住（填充、簡答的答案文字也不顯示）。 */
  masked: boolean;
}

/** 授權結束的出版社題組，填充、簡答在檢討試卷的寫法。 */
export const MASKED_ANSWER_TEXT = '這一組的出版社授權已經結束，答案不再顯示；這一題照原本的作答計分。';

/** 出版社題組的解析標示「解析：{出版社}提供」；本站題是 null（照舊標 AI 撰寫）。 */
function bylineOf(at: Located | undefined): string | null {
  return at?.source ? publisherExplanationBy(at.source.label_zh) : null;
}

/** 出版社題組這一題沒有解析文字（正規化檔沒有出版社解析時是空字串，§17.2 第 2 項）：卡片照樣顯示答案，下面加一句。 */
function NoPublisherExplanation({ at, item }: { at: Located | undefined; item: ExplanationItem | undefined }) {
  if (at?.source === undefined || (item?.explanation_zh ?? '').trim() !== '') return null;
  return (
    <p className="text-sm text-muted" data-testid="no-explanations">
      {PUBLISHER_NO_EXPLANATION}
    </p>
  );
}

/** 檢討試卷只放選擇題與混合題的大題（部分也只留這兩個）。 */
export function reviewExam(exam: Exam): Exam {
  const sections = exam.sections.filter((s) => OBJECTIVE_SECTION_TYPES.has(s.type));
  const kept = new Set(sections.map((s) => s.id));
  return { ...exam, sections, parts: (exam.parts ?? []).filter((p) => p.sections.some((id) => kept.has(id))) };
}

function ReviewCard({
  q,
  answer,
  item,
  at,
  onLocate,
}: {
  q: Question;
  answer: AnswerValue | undefined;
  item: ExplanationItem | undefined;
  at: Located | undefined;
  onLocate: (label: string) => void;
}) {
  if (!at) return null;
  const byline = bylineOf(at);
  if (q.mode === 'multi_select') {
    return (
      <>
        <MultiSelectCard q={q} item={item} group={at.group} answer={answer} hintsUsed={0} onLocateEvidence={onLocate} byline={byline} />
        <NoPublisherExplanation at={at} item={item} />
      </>
    );
  }
  if (q.mode !== 'single_choice' && q.mode !== 'bank_choice') return null;
  return (
    <>
      <ExplanationCard
        label={q.label}
        item={item}
        group={at.group}
        options={q.options ?? at.group.options_bank}
        answer={q.answer}
        chosen={typeof answer === 'string' && answer !== '' ? answer : null}
        hintsUsed={0}
        onLocateEvidence={onLocate}
        codeLabels={at.reading ? READING_OPTION_CODE_LABELS : undefined}
        showBlankPos={!at.reading}
        byline={byline}
      />
      <NoPublisherExplanation at={at} item={item} />
    </>
  );
}

export function BankReview({ paper, record, scores }: { paper: BankPaper; record: MockAttemptRecord; scores: BankOpenScores }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [locate, setLocate] = useState<{ label: string; n: number } | null>(null);
  // 已交卷的作答：改不了答案，所以存檔是空操作。
  const store = useMemo(() => new AttemptStore(record.attempt, true, { save: () => true }), [record.attempt]);
  const marked = useMemo(() => new Set(record.marked), [record.marked]);
  const exam = useMemo(() => reviewExam(paper.exam), [paper.exam]);
  // 題號 → 所在的題組；題組 id → 這個題組的解析（證據句只在自己的選文裡找）。
  const { byLabel, itemsByGroup } = useMemo(() => {
    const labels = new Map<string, Located>();
    const groups = new Map<string, Record<string, ExplanationItem>>();
    for (const section of exam.sections) {
      for (const group of section.groups) {
        const items: Record<string, ExplanationItem> = {};
        // 卷子的題組（BankPaperGroup）依第一題對到 exam 的題組（同 paperSources.ts 的 groupSourceLines）。
        const bankGroup = paper.groups.find((g) => group.questions.some((q) => q.label === g.first));
        const source = bankGroup?.source;
        const masked = bankGroup?.masked === true;
        for (const q of group.questions) {
          labels.set(q.label, { group, reading: section.type === 'reading', source, masked });
          const item = paper.explanations[q.label];
          if (item) items[q.label] = item;
        }
        groups.set(group.id, items);
      }
    }
    return { byLabel: labels, itemsByGroup: groups };
  }, [exam, paper.explanations, paper.groups]);
  const askAllowed = useAskAllowed(paper.groups);
  const renderGroupSource = useMemo(() => groupSourceRenderer(paper), [paper]);
  const evidence = useMemo(() => Object.values(paper.explanations).flatMap((item) => item.evidence), [paper.explanations]);
  const onLocate = useCallback((label: string) => setLocate((cur) => ({ label, n: (cur?.n ?? 0) + 1 })), []);
  const active = locate?.label ?? null;

  // 「在文中標出證據句」：捲到證據句並把焦點移過去（同題庫練習）。
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

  const extras = useMemo<QuestionExtras>(
    () => ({
      noOfficialStats: true,
      renderHeadingAccessory: (labels) => <MarkedBadge labels={labels} marked={marked} />,
      renderFigure: bankFigureRenderer(evidence),
      ...(renderGroupSource ? { renderGroupSource } : {}),
      renderAfterFeedback: (q, answer) => (
        <>
          <ReviewCard q={q} answer={answer} item={paper.explanations[q.label]} at={byLabel.get(q.label)} onLocate={onLocate} />
          {/* 學習助手的入口（開關關著時 render null；卷面題號，docs/design/learning-assistant.md §1.4）；出版社題組要授權包含 ai_assist。 */}
          {askAllowed(byLabel.get(q.label)?.source) && (
            <AskEntry ask={{ src: 'bankmock', attempt: record.id, labels: [q.label] }} q={q} state={choiceState(q, answer)} marked={marked.has(q.label)} />
          )}
        </>
      ),
      renderOpenFeedback: (q, answer) => {
        const at = byLabel.get(q.label);
        if (!at || (q.mode !== 'fill_in_blank' && q.mode !== 'short_answer')) return null;
        // 授權結束、已經遮住的出版社題組：答案文字（題目內容的一部分）不再顯示，分數照舊（§7.6）。
        if (at.masked) {
          return (
            <p className="text-sm text-muted" data-testid="masked-answer">
              {MASKED_ANSWER_TEXT}
            </p>
          );
        }
        const pair = scores.swapped.find((p) => p.includes(q.label));
        const outcome = scores.outcomes.get(q.label);
        return (
          <>
            <OpenAnswerFeedback
              q={q}
              answer={answer}
              outcome={outcome}
              item={paper.explanations[q.label]}
              group={at.group}
              swappedWith={pair ? (pair[0] === q.label ? pair[1] : pair[0]) : null}
              hintsUsed={0}
              onLocateEvidence={onLocate}
              byline={bylineOf(at)}
            />
            <NoPublisherExplanation at={at} item={paper.explanations[q.label]} />
            {askAllowed(at.source) && (
              <AskEntry
                ask={{ src: 'bankmock', attempt: record.id, labels: [q.label] }}
                q={q}
                state={{ ok: outcome ? okFromRatio(outcome.earned, outcome.max) : null, answered: answer !== undefined && isAnswered(answer) }}
                marked={marked.has(q.label)}
              />
            )}
          </>
        );
      },
      extraHighlights: (group) => evidenceHighlights(group, itemsByGroup.get(group.id) ?? {}, active),
      locateRequest: locate,
    }),
    [marked, evidence, paper.explanations, byLabel, onLocate, scores, itemsByGroup, active, locate, record.id, askAllowed, renderGroupSource],
  );

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          檢討試卷
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-paper`}
          onClick={() => setOpen((v) => !v)}
          className="min-h-11 rounded-full border border-primary px-4 text-sm font-medium text-primary hover:bg-primary-soft"
        >
          {open ? '收起檢討試卷' : '展開檢討試卷（本站答案與解析）'}
        </button>
      </div>
      <p className="text-sm text-muted">選擇題與混合題的答案、解析與判分理由。中譯英與作文的參考譯文、評分重點與範文在上面的自評區。</p>
      {open && (
        <div id={`${id}-paper`} className="space-y-6">
          <ExamContext value={exam}>
            <AttemptContext value={store}>
              <QuestionExtrasContext value={extras}>
                <SectionNav />
                <ExamPaper />
              </QuestionExtrasContext>
            </AttemptContext>
          </ExamContext>
        </div>
      )}
    </section>
  );
}
