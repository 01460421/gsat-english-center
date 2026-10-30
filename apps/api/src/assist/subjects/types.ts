/**
 * 科目模組之間的契約型別（docs/design/assistant-subjects.md §2.2）：consumer 與各科的後處理、組裝之間傳的形狀。
 * 放在獨立的檔，各科的實作檔（subjects/chinese/output.ts、ocr.ts…）只依賴這裡，改實作不必改呼叫端。
 */
import type {
  AssistDetectedSubject,
  AssistOcrView,
  AssistQuestionView,
  AssistSafetyFlag,
  ZhAnalysisView,
  ZhCaseKind,
  ZhChecks,
  ZhFollowupView,
} from '@gsat/shared';
import type { D8Fingerprints } from '../../ai/d8';
import type { OutputFilter } from '../../ai/filter';
import type { ZhFingerprints } from './chinese/d8';

/**
 * 後處理的結果（英文 output.ts 的 Postprocessed<V> 也符合這個形狀）：consumer 依它結算、寫事件、決定能不能進共用快取。
 */
export interface SubjectPostprocessed<V> {
  view: V;
  /** 計數（寫進 turn 的 meta_json；d8_hidden 另外決定案例的 d8_hidden 旗標與 assist_d8_output 事件）。 */
  meta: { readonly d8_hidden: number };
  /** 這一則的錯因代碼（併進案例的 errors_json；off_topic 時是空的）。 */
  errorCodes: string[];
  /** 這一則的技能代碼（併進案例的 skills_json；off_topic 時是空的）。 */
  skillCodes: string[];
  keyConcern: boolean;
  offTopic: boolean;
  safety: AssistSafetyFlag;
  /** 有欄位被過濾或被 D8 隱藏：不寫共用快取。 */
  tainted: boolean;
}

/** 國文解析後處理（subjects/chinese/output.ts）的脈絡。 */
export interface ZhOutputContext {
  kind: ZhCaseKind;
  /** 案例的題目（question_json）：區塊、要問的題（子模式、研判標籤、答案鍵、字數限制）、國寫片段。 */
  question: AssistQuestionView;
  filter: OutputFilter;
  /** 英文集合（所有科目的輸出都比對）。 */
  fp: D8Fingerprints;
  /** 國文集合（§5.7）。 */
  zh: ZhFingerprints;
  /**
   * 這是這次投遞第一次產生的結果，內容不合格時還能付費重寫一次（簡體字 ≥ 3 個時重寫，§5.6）。false 時照樣顯示並加說明。
   */
  allowRetry: boolean;
}

/** 國文解析後處理的結果。retry 不是 null 時，consumer 把它當成「內容不合格」交給 callWithPolicy 重寫一次（不結算）。 */
export interface ZhAnalysisPostprocessed extends SubjectPostprocessed<ZhAnalysisView> {
  /** §5.1 第 16 步的檢查計數（寫進 turn 的 meta_json.checks；給評測與監看，不顯示）。 */
  checks: ZhChecks;
  retry: string | null;
}

/** 國文追問後處理的脈絡。 */
export interface ZhFollowupContext {
  kind: ZhCaseKind;
  question: AssistQuestionView;
  /** 學生選的模式（模型寫的 mode_used 不認得時用它）。 */
  mode: 'hint' | 'explain';
  filter: OutputFilter;
  fp: D8Fingerprints;
  zh: ZhFingerprints;
  /** 上一次解析的正確答案（題號 → 選項字母；提示模式不能說出來，§3.5）。 */
  answers: Readonly<Record<string, string>>;
  /** 追問的是字音題（提示模式不能出現任何注音，§3.5、§5.1 第 10 步）；沒給當成不是。 */
  sound?: boolean;
}

export interface ZhFollowupPostprocessed extends SubjectPostprocessed<ZhFollowupView> {
  checks: ZhChecks;
}

/** 國文轉錄組裝（subjects/chinese/ocr.ts）的脈絡。 */
export interface ZhOcrContext {
  filter: OutputFilter;
  fp: D8Fingerprints;
  zh: ZhFingerprints;
}

/** 國文轉錄組裝的結果（同英文 ocr.ts 的 AssembledOcr，多了科目不符與兩種國文的隱藏）。 */
export interface ZhOcrAssembled {
  /** false：不是國文題目、看不清、沒有任何可用區塊（退還 invalid_output、刪照片）。 */
  ok: boolean;
  view: AssistOcrView;
  stats: { blocks: number; unresolved: number };
  /** 計數（meta_json；不含內容）。 */
  counts: { d8: number; official_like: number; answer_section: number; long_passage: number; masked: number; truncated: number };
  /** 被隱藏的區塊序號（meta_json；確認時一起擋）。 */
  hidden: number[];
  /** status 是 other_subject 時，模型判斷的科目（畫面依它請學生換科目再拍，§6.5）。 */
  detected: AssistDetectedSubject | null;
}
