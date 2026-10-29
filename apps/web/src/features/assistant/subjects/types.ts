/**
 * 科目登記表的型別（docs/design/assistant-subjects.md §8.1）。
 */
import type { AssistCaseDetail, AssistTurnView } from '@gsat/shared';
import type { ReactNode } from 'react';

/** 任何一科的解析畫面形狀（英文的 item／writing／vocab，國文的 zh_choice／zh_short／zh_writing）。 */
export type AnyAnalysis = NonNullable<AssistTurnView['analysis']>;

/** 案例頁傳給各科解析元件的參數。 */
export interface SubjectAnalysisProps {
  detail: AssistCaseDetail;
  analysis: AnyAnalysis;
  /** 依來源的固定說明（學生提供的題目：答案可能有錯…）。 */
  sourceNote: string | null;
  /** 推薦練習（英文；國文是 null）。 */
  recommendations: ReactNode;
  /** 這句引文（id 由各科自己定）能不能在左欄的題目裡標出來；按下時把左欄捲過去並加深。 */
  locatable: (id: string) => boolean;
  onLocate: (id: string) => void;
  /** 案例被改了（國文「改成多選重看」的 PATCH 回來）：交給輪詢器更新畫面。 */
  onUpdated: (detail: AssistCaseDetail) => void;
}
