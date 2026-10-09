/**
 * 整份考卷：依題本順序畫出各大題與題組。每個題組依資料形狀選作答介面（paper.ts 的 groupLayout）。
 *
 * 閱讀類題組（閱讀測驗、混合題、簡答）在桌機上選文與題目並排，選文固定在左邊、可以自己捲動，
 * 看題目時不必上下來回找；手機寬度不夠並排，改成上下排列。
 */
import { useMemo } from 'react';
import type { ExamSection, QuestionGroup } from '../../../data/exams';
import { SECTION_TYPE_LABELS } from '../../../data/exams';
import { useAttemptSelector } from '../AttemptContext';
import { useExam } from '../ExamContext';
import { groupErratum } from '../labels';
import { clusterQuestions, groupLayout } from '../paper';
import { useGroupHighlights } from '../QuestionExtras';
import { isAutoScored } from '../scoring';
import { BankGroup, ClozeGroup } from './BlankGroups';
import { PassageView, groupHasStimulus } from './Passage';
import { ScoreDistribution } from './QuestionFeedback';
import { ChoiceQuestionBlock, CompositionBlock, ErratumNote, FillClusterBlock, TableAnswerBlock, TextAnswerBlock } from './Questions';

/** 選文和題目並排的大題類型；翻譯、作文的選文（例如 gsat-85 的短文翻譯）放在題目上方就好。 */
const SIDE_BY_SIDE_TYPES: ReadonlySet<ExamSection['type']> = new Set(['reading', 'mixed', 'short_answer', 'other']);

function StandardGroup({ group, section }: { group: QuestionGroup; section: ExamSection }) {
  const exam = useExam();
  const highlights = useGroupHighlights(group);
  const items = useMemo(() => clusterQuestions(group.questions), [group.questions]);

  const questions = (
    <div className="min-w-0 space-y-3">
      {items.map((item) => {
        if (item.kind === 'fill_cluster') {
          return <FillClusterBlock key={item.questions[0]?.label ?? item.stem} stem={item.stem} questions={item.questions} />;
        }
        const q = item.question;
        if (isAutoScored(q)) {
          // bank_choice 出現在這裡代表題組沒有選項庫以外的作答介面可用，就把選項庫當成本題選項。
          return <ChoiceQuestionBlock key={q.label} q={q} options={q.options ?? group.options_bank} />;
        }
        switch (q.mode) {
          case 'composition':
            return <CompositionBlock key={q.label} q={q} />;
          case 'translation':
            return <TextAnswerBlock key={q.label} q={q} multiline />;
          case 'table_completion':
            return <TableAnswerBlock key={q.label} q={q} group={group} />;
          case 'fill_in_blank':
          case 'short_answer':
            return <TextAnswerBlock key={q.label} q={q} multiline={false} />;
          default: {
            const unreachable: never = q;
            return unreachable;
          }
        }
      })}
    </div>
  );

  if (!groupHasStimulus(group)) return questions;

  const passage = (
    <div className="rounded-2xl border border-line bg-surface p-4 break-words lg:p-5">
      <PassageView group={group} highlights={highlights} />
      <ErratumNote text={groupErratum(exam.id, group.id)} />
    </div>
  );
  if (!SIDE_BY_SIDE_TYPES.has(section.type)) {
    return (
      <div className="space-y-4">
        {passage}
        {questions}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
      {/* 桌機上選文自己捲動；可捲動的區域要能用鍵盤聚焦，才能用方向鍵捲（WCAG 2.1.1）。 */}
      <div
        tabIndex={0}
        role="region"
        aria-label="選文"
        className="min-w-0 rounded-2xl lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto"
      >
        {passage}
      </div>
      {questions}
    </div>
  );
}

/** 一個題組的作答介面（依資料形狀選擇）。題庫練習頁直接用它畫 AI 題組。 */
export function GroupView({ group, section }: { group: QuestionGroup; section: ExamSection }) {
  switch (groupLayout(group)) {
    case 'cloze':
      return <ClozeGroup group={group} />;
    case 'bank':
      return <BankGroup group={group} />;
    case 'standard':
      return <StandardGroup group={group} section={section} />;
  }
}

export function sectionAnchorId(sectionId: string): string {
  return `sec-${sectionId}`;
}

function SectionView({ section }: { section: ExamSection }) {
  const labels = useMemo(() => section.groups.flatMap((g) => g.questions.map((q) => q.label)), [section]);
  // 非選擇題的全國得分分布：交卷後，或練習模式看過這一大題任何一題的答案後才顯示（避免先看到分布影響作答）。
  const showStats = useAttemptSelector(
    (s) => s.submittedAt !== null || (s.mode === 'practice' && labels.some((l) => s.revealed.includes(l))),
  );
  return (
    <section aria-labelledby={`${sectionAnchorId(section.id)}-title`} className="space-y-4">
      <header id={sectionAnchorId(section.id)} tabIndex={-1} className="scroll-mt-32 border-b border-line pb-2">
        <h2 id={`${sectionAnchorId(section.id)}-title`} className="text-xl font-bold">
          {section.title}
        </h2>
        {section.instructions && <p className="mt-1 text-sm whitespace-pre-line text-muted">{section.instructions}</p>}
      </header>
      {section.groups.map((group) => (
        <GroupView key={group.id} group={group} section={section} />
      ))}
      {showStats && <ScoreDistribution section={section} />}
    </section>
  );
}

/** 大題導覽：按鈕捲到該大題並把焦點移過去（不用 #錨點，避免每點一次就多一筆瀏覽紀錄）。 */
export function SectionNav() {
  const exam = useExam();
  return (
    <nav aria-label="大題導覽" className="rounded-2xl border border-line bg-surface p-3">
      <ul className="flex flex-wrap gap-2">
        {exam.sections.map((s) => {
          const count = s.groups.reduce((acc, g) => acc + g.questions.length, 0);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(sectionAnchorId(s.id));
                  el?.scrollIntoView({ block: 'start' });
                  el?.focus({ preventScroll: true });
                }}
                className="rounded-full border border-line px-3 py-1 text-sm hover:border-primary"
              >
                {SECTION_TYPE_LABELS[s.type]}
                <span className="ml-1 text-xs text-muted">{count} 題</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * 整份考卷，或只畫其中幾個大題（sectionIds；模擬考一次顯示一個大題，用來分段計時）。
 * 部分標題只在該部分的第一個大題出現時顯示。
 */
export function ExamPaper({ sectionIds }: { sectionIds?: readonly string[] } = {}) {
  const exam = useExam();
  // 題本的「部分」標題（第壹部分：選擇題…）印在該部分第一個大題之前。
  const partBySection = new Map((exam.parts ?? []).map((p) => [p.sections[0], p] as const));
  const sections = sectionIds ? exam.sections.filter((s) => sectionIds.includes(s.id)) : exam.sections;
  return (
    <div className="space-y-10">
      {sections.map((section) => {
        const part = partBySection.get(section.id);
        return (
          <div key={section.id} className="space-y-4">
            {part && (part.title || part.instructions) && (
              <div className="rounded-xl bg-surface-2 px-4 py-3">
                {part.title && <p className="font-semibold">{part.title}</p>}
                {part.instructions && <p className="mt-1 text-sm whitespace-pre-line text-muted">{part.instructions}</p>}
              </div>
            )}
            <SectionView section={section} />
          </div>
        );
      })}
    </div>
  );
}
