/**
 * 學習助手前端的科目登記表（docs/design/assistant-subjects.md §2.2、§8.1）：每一科提供標籤、題目文字的 lang、離題說明；
 * 依 kind 的解析元件、左欄的引文加亮、推薦練習（英文有、國文沒有），以及解析與追問的點數（shared 的 assistPoints）。
 * 案例頁、首頁、貼上與拍照都經過這裡，不再寫死英文。
 *
 * 英文的實作只引用原本的元件與函式（english.tsx），畫面一個字都不改；國文在 chinese/。
 * 選填的 CaseExtras 是案例頁解析之後多放的一塊（英文沒有）：國文的國寫案例是「看一篇 AI 示範」（國寫範文設計 §8）。
 */
import {
  ASSIST_SUBJECT_LABELS,
  assistPoints,
  isZhCaseKind,
  type AssistCaseDetail,
  type AssistCaseKind,
  type AssistCaseSummary,
  type AssistQuestionView,
  type AssistSubject,
  type AssistTurnView,
  type ZhAnalysisView,
} from '@gsat/shared';
import type { ComponentType, ReactNode } from 'react';
import type { TextHighlight } from '../../exams/richText';
import { ZH_COPY } from './chinese/copy';
import type { ZhMark } from './chinese/components/ZhText';
import { zhBlockMarks, zhExemplarQuoteRefs, zhLocatable } from './chinese/quotes';
import { ZhAnalysis } from './chinese/ZhAnalysis';
import { ZhCaseExtras } from './chinese/ZhExemplarSection';
import { EnglishAnalysis, englishHighlights, englishLocatable, englishRecommendations } from './english';
import type { AnyAnalysis, SubjectAnalysisProps, SubjectCaseExtrasProps } from './types';

export type { AnyAnalysis, SubjectAnalysisProps, SubjectCaseExtrasProps } from './types';

/** 左欄題目的加亮：站內題的選文（RichText 的座標），或學生提供的題目區塊（區塊序號 → 位置）。 */
export interface QuestionHighlights {
  passage: TextHighlight[];
  blocks: Record<number, ZhMark[]>;
}

export interface WebSubject {
  id: AssistSubject;
  label: string;
  /** 題目文字的 lang：英文 'en'；國文是 null（全站根元素本來就是 zh-Hant，不加 lang="en"；§8.3）。 */
  textLang: 'en' | null;
  /** 離題時的說明。 */
  offTopic: string;
  /** 解析元件（依 kind 自己分派；不認得的 kind 畫面是空的）。 */
  Analysis: ComponentType<SubjectAnalysisProps>;
  /**
   * 左欄的引文加亮（全部淡色、activeId 那一句加深）。hintFirst（先看提示）時國文只標學生按下的那一句：全部引文一起加亮等於把
   * 證據與答案標在題目上。turns：案例的全部 turn（國文另有國寫範文的素材引文；英文不看）。
   */
  highlightsOf(analysis: AnyAnalysis | null, question: AssistQuestionView | null, activeId: string | null, hintFirst?: boolean, turns?: readonly AssistTurnView[]): QuestionHighlights;
  /** 引文 id → 能不能在左欄標出來。 */
  locatableOf(analysis: AnyAnalysis | null, question: AssistQuestionView | null, turns?: readonly AssistTurnView[]): (id: string) => boolean;
  /** 推薦練習（國文 null）。 */
  recommendationsOf(analysis: AnyAnalysis | null, detail: AssistCaseDetail): ReactNode;
  analyzePoints(kind: AssistCaseKind, items: number): number;
  followupPoints: number;
  /** 解析之後多放的一塊（選填；英文沒有，案例頁一個元素都不多）。 */
  CaseExtras?: ComponentType<SubjectCaseExtrasProps>;
}

const EMPTY: QuestionHighlights = { passage: [], blocks: {} };

function isZhAnalysis(a: AnyAnalysis | null): a is ZhAnalysisView {
  return a !== null && isZhCaseKind(a.kind);
}

const SUBJECTS: Record<AssistSubject, WebSubject> = {
  english: {
    id: 'english',
    label: ASSIST_SUBJECT_LABELS.english,
    textLang: 'en',
    offTopic: '學習助手只回答英文學習與學測相關的問題。',
    Analysis: EnglishAnalysis,
    highlightsOf: (analysis, question, activeId) => ({ passage: englishHighlights(analysis, question, activeId), blocks: {} }),
    locatableOf: (analysis, question) => (id) => {
      const [label = '', step = ''] = id.split('\u0000');
      return englishLocatable(analysis, question, label, Number(step));
    },
    recommendationsOf: englishRecommendations,
    analyzePoints: (kind, items) => assistPoints('english', 'assist_analyze', { kind, items }),
    followupPoints: assistPoints('english', 'assist_followup'),
  },
  chinese: {
    id: 'chinese',
    label: ASSIST_SUBJECT_LABELS.chinese,
    textLang: null,
    offTopic: ZH_COPY.offTopic,
    Analysis: ZhAnalysis,
    highlightsOf: (analysis, question, activeId, hintFirst = false, turns = []) =>
      isZhAnalysis(analysis)
        ? { passage: [], blocks: zhBlockMarks(analysis, question?.blocks, activeId, { activeOnly: hintFirst, extra: zhExemplarQuoteRefs(turns) }) }
        : EMPTY,
    locatableOf: (analysis, question, turns = []) => {
      const ids = isZhAnalysis(analysis) ? zhLocatable(analysis, question?.blocks, zhExemplarQuoteRefs(turns)) : new Set<string>();
      return (id) => ids.has(id);
    },
    recommendationsOf: () => null,
    analyzePoints: (kind, items) => assistPoints('chinese', 'assist_analyze', { kind, items }),
    followupPoints: assistPoints('chinese', 'assist_followup'),
    CaseExtras: ZhCaseExtras,
  },
};

export function webSubject(subject: AssistSubject): WebSubject {
  return SUBJECTS[subject];
}

/**
 * 案例的科目：Worker 帶的 subject（沒有＝英文，例如舊版 Worker），其次是題目的 subject；國文的 kind 一定是國文。
 */
export function caseSubject(c: Pick<AssistCaseSummary, 'subject' | 'kind'> & { question?: AssistQuestionView | null }): AssistSubject {
  if (c.subject) return c.subject;
  if (c.question?.subject) return c.question.subject;
  return isZhCaseKind(c.kind) ? 'chinese' : 'english';
}
