/**
 * 科目登記表的型別（docs/design/assistant-subjects.md §8.1）。
 */
import type { AssistCaseDetail, AssistTaskAccepted, AssistTurnView } from '@gsat/shared';
import type { ReactNode } from 'react';
import type { PollSpeed } from '../../writing/lib/polling';

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

/**
 * 案例頁在解析之後、「回報 AI 內容」之前多放的一塊（選填；英文沒有）。國文的國寫案例放「看一篇 AI 示範」
 * （國寫範文設計 §8）：按鈕、確認、等待、失敗與結果都在這一塊裡。
 */
export interface SubjectCaseExtrasProps {
  detail: AssistCaseDetail;
  analysis: AnyAnalysis;
  /** 唯讀（學習助手或這一科關著）：只顯示已有的內容，不給送出的入口。 */
  closed: boolean;
  /** 可以送出新的 AI 任務（已核准、開關與科目都開著）。 */
  ready: boolean;
  /** 出版社題的授權已經結束（不再提供解析與追問）。 */
  ended: boolean;
  /** 輪詢的狀態（進度列用）。 */
  poll: { speed: PollSpeed; connectionError: boolean; stopped: boolean };
  /** 送出新的 AI 任務之後：交給案例頁重新開始輪詢。 */
  onStarted: (accepted: AssistTaskAccepted) => void;
  locatable: (id: string) => boolean;
  onLocate: (id: string) => void;
}
