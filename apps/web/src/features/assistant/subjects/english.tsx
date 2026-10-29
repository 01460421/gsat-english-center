/**
 * 英文在科目登記表裡的實作（docs/design/assistant-subjects.md §2.4、§8.1）：只把案例頁原本的寫法搬過來，畫面一個字都不改。
 *   - 解析元件：item → AnalysisView（多選題的統計看題型）、writing → WritingAnalysisView、vocab → VocabAnalysisView；
 *   - 證據句加亮：item 的解法步驟在選文裡的位置（題組選文座標，RichText 的 highlights）；
 *   - 推薦練習：PracticeRecommendations（單字解析沒有）。
 */
import type { AssistCaseDetail, AssistQuestionView, AssistSection } from '@gsat/shared';
import type { ReactNode } from 'react';
import type { TextHighlight } from '../../exams/richText';
import { AnalysisView, questionModesOf } from '../components/AnalysisView';
import { PracticeRecommendations } from '../components/PracticeRecommendations';
import { VocabAnalysisView } from '../components/VocabAnalysisView';
import { WritingAnalysisView } from '../components/WritingAnalysisView';
import { locateQuote } from '../lib/view';
import type { AnyAnalysis, SubjectAnalysisProps } from './types';

/** 英文解法步驟的引文 id（題號＋第幾步）。 */
export function englishStepId(label: string, step: number): string {
  return `${label}\u0000${step}`;
}

/** 推薦練習（英文；單字解析沒有）。 */
export function englishRecommendations(analysis: AnyAnalysis | null, detail: Pick<AssistCaseDetail, 'section'>): ReactNode {
  if (!analysis || (analysis.kind !== 'item' && analysis.kind !== 'writing')) return null;
  return <PracticeRecommendations focus={analysis.practice_focus} fallbackSection={detail.section as AssistSection | null} />;
}

/** 證據句在選文裡的位置（全部步驟淡色、按下的那一句加深）。 */
export function englishHighlights(analysis: AnyAnalysis | null, question: AssistQuestionView | null, activeId: string | null): TextHighlight[] {
  if (!analysis || analysis.kind !== 'item' || !question?.passage) return [];
  const out: TextHighlight[] = [];
  for (const item of analysis.items) {
    item.solution_steps.forEach((step, i) => {
      const h = locateQuote(question.passage ?? null, step.quote, item.display_label, activeId === englishStepId(item.label, i));
      if (h) out.push(h);
    });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** 這一步的證據句能不能在選文裡標出來。 */
export function englishLocatable(analysis: AnyAnalysis | null, question: AssistQuestionView | null, label: string, step: number): boolean {
  if (!analysis || analysis.kind !== 'item') return false;
  const q = analysis.items.find((i) => i.label === label)?.solution_steps[step]?.quote ?? '';
  return locateQuote(question?.passage ?? null, q, label) !== null;
}

export function EnglishAnalysis({ detail, analysis, sourceNote, recommendations, onLocate }: SubjectAnalysisProps) {
  if (analysis.kind === 'item') {
    return (
      <AnalysisView
        analysis={analysis}
        hintFirst={detail.hint_first}
        sourceNote={sourceNote}
        onLocate={(label, step) => onLocate(englishStepId(label, step))}
        locatable={(label, step) => englishLocatable(analysis, detail.question, label, step)}
        recommendations={recommendations}
        modes={questionModesOf(detail.question)}
      />
    );
  }
  if (analysis.kind === 'writing') return <WritingAnalysisView analysis={analysis} recommendations={recommendations} />;
  if (analysis.kind === 'vocab') return <VocabAnalysisView analysis={analysis} />;
  return null;
}
