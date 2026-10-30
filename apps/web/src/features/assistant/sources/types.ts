/**
 * 錯題來源的轉接器介面（docs/design/learning-assistant.md §5.3）：每個來源（題庫練習、自組卷、歷屆試題、真題模考、
 * 單字錯題本、寫作批改）各實作一份，錯題清單與確認頁都經過它。
 *
 *   list()            這個來源在本機的錯題與疑點（只讀 localStorage；寫作批改要登入、打 API）。
 *   resolve(ask)      確認頁：查詢參數（AskRef）→ 預覽資料、同組可以勾的題目與預設勾選、依勾選組出 API 的 AssistSourceRef。
 *                     這台裝置沒有作答紀錄時回 null（確認頁改提供「貼上題目」）。站內題的題目文字只用來預覽，不送給 API。
 */
import type {
  AnswerValue,
  AskRef,
  AssistCaseKind,
  AssistSection,
  AssistSignals,
  AssistSourceRef,
  AssistSubject,
  AssistQuestionBlock,
  QuestionMode,
  Tier,
} from '@gsat/shared';

export type MistakeSource = 'bank' | 'bank_mock' | 'exam' | 'mock' | 'vocab' | 'writing';

/** 一題在這次作答的狀態（確認頁的勾選清單與錯題清單用）。doubt＝答對但標記過、用了提示或先看答案。 */
export type ItemStatus = 'wrong' | 'unanswered' | 'partial' | 'doubt' | 'correct' | 'unknown';

/** 錯題清單的一列：一列一個題組（同一組的錯題與疑點併成一列，§5.9）。 */
export interface MistakeRow {
  key: string;
  source: MistakeSource;
  title: string;
  section: AssistSection | null;
  tier: Tier | null;
  /** 這一列包含的題號（卷面題號）。 */
  labels: string[];
  wrong: number;
  partial: number;
  unanswered: number;
  doubts: number;
  /** 有錯、部分給分或未作答＝錯題；只有疑點＝疑點。 */
  kind: 'mistake' | 'doubt';
  /** 最近一次作答（毫秒）。 */
  at: number;
  /** 確認頁的網址（沒有時這一列不能直接問，例如模考的中譯英、作文要先送 AI 批改）。 */
  askHref: string | null;
  /** 其他動作（模考寫作的「先送 AI 批改」連到成績單；題庫題的本站解析）。 */
  links: Array<{ label: string; to: string }>;
  /** 錯題的技能代碼（排序用）。 */
  skills: string[];
  /** 每一題錯題的原始技能代碼（加強卷入口的焦點，docs/design/weak-paper.md §3.1；單字、寫作沒有）。 */
  questionSkills?: string[][];
  /** 歷屆題：錯題裡全國答對率最高的那一題的答對率與五等分組（排序用）。 */
  nationalRate: number | null;
  fiveGroups: number[] | null;
  /** 可能 0 點：站內題、還沒問過（之前有同學問過同一題同樣的答案時）。 */
  maybeFree: boolean;
  /** 來源的題組代號（題庫題的 uid@v、考卷 id；同技能合併提示用）。 */
  groupRef: string;
}

/** 預覽的一題。 */
export interface PreviewItem {
  /** 送給 API 的題號（自組卷是題組裡的原始題號）。 */
  label: string;
  /** 畫面上的題號（自組卷是卷面題號）。 */
  display: string;
  mode: QuestionMode | 'unknown';
  stem: string | null;
  options: Record<string, string> | null;
  studentAnswer: AnswerValue | null;
  /** 正確答案（站內題的公開答案；選擇題是可得分的字母）。 */
  correct: string[] | null;
  status: ItemStatus;
  /** 疑點的原因（標記過、用了幾層提示、先看答案）。 */
  marked?: boolean;
  hints?: number;
  revealed?: boolean;
  /** 填充、簡答的判分是不是裝置上的（client_status）。 */
  clientJudged?: boolean;
}

/** 題目預覽（確認頁與案例頁左欄共用；站內題用 RichText，學生題目用純文字）。 */
export interface PreviewModel {
  trust: 'site' | 'student';
  originLabel: string;
  section: AssistSection | null;
  tier: Tier | null;
  instructions: string | null;
  passage: string | null;
  figureText: string | null;
  sharedOptions: Record<string, string> | null;
  items: PreviewItem[];
  /** 學生提供的題目（純文字區塊）。 */
  blocks?: AssistQuestionBlock[];
  /** 科目（沒有＝英文）：國文不加 lang="en"，題目區塊的底線標記換成底線（docs/design/assistant-subjects.md §8.3）。 */
  subject?: AssistSubject;
}

/** 確認頁「要問哪幾題」：同組可以勾的題、上限、預設勾選。 */
export interface GroupPick {
  max: number;
  /** 預設勾選（依「錯 → 未作答 → 部分給分 → 疑點」、再依題號）。 */
  defaults: string[];
  /** 超過上限沒勾的題號（畫面說明）。 */
  overflow: string[];
  /** 只能選一題（詞彙題）：用單選。 */
  single: boolean;
}

export interface ResolvedAsk {
  kind: AssistCaseKind;
  /** 頁首的標題（「115 學測 第 21–30 題（文意選填）」）。 */
  title: string;
  preview: PreviewModel;
  group: GroupPick;
  /** 依勾選的題號組出 API 的來源。 */
  sourceFor: (labels: readonly string[]) => AssistSourceRef;
  /** 作答當下的行為訊號（只存在案例上，不進提示）。 */
  signalsFor: (labels: readonly string[]) => AssistSignals;
  /** 這題可能 0 點（站內題、沒有自由輸入時）。 */
  maybeFree: boolean;
  /** 題號 → 畫面上的題號（勾選清單與點數說明）。 */
  displayOf: (label: string) => string;
}

export interface MistakeSourceAdapter {
  list(): Promise<MistakeRow[]>;
  resolve(ask: AskRef): Promise<ResolvedAsk | null>;
}

/** 依狀態排優先順序（§1.5：錯 → 未作答 → 部分給分 → 疑點）。 */
export const STATUS_PRIORITY: Record<ItemStatus, number> = { wrong: 0, unanswered: 1, partial: 2, doubt: 3, correct: 4, unknown: 5 };
