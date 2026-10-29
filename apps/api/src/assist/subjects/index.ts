/**
 * Worker 的科目登記表（docs/design/assistant-subjects.md §2.2、§2.3）：依科目取輸出 schema、系統提示、user 訊息的組法、轉錄與追問。
 * 英文是第一筆（subjects/english.ts：只把現行的函式包起來，逐位元不變），國文是第二筆（subjects/chinese/）。
 *
 * 骨架全部共用：佇列、預扣、租約、退還、過濾、D8 比對、輪詢。依科目分流的地方（§2.3 的表）：
 *   routes.ts    建案例收 subject（白名單，寫進 ref_json）、國文的開關與指紋在預扣前檢查、題數用 assistItemCount、
 *                turn 的 meta_json 寫 {subject, kind, items}；列表的科目篩選。
 *   consumer.ts  依案例的科目分派：英文走原本的程式（一個字都不改）；國文走 subjects/chinese/run.ts（組請求 → 後處理 → 結算寫回
 *                section、verdict、wrong_count；科目不符以 invalid_output 退還）。
 *   ai/tasks.ts  taskConfig 的 size 帶 subject、kind、items（英文的數字不變；國文的表在 ZH_TASK_SIZES）。
 *
 * 新科目的 schema 一律要符合 ASSIST_SCHEMA_BUDGET（§3.1；test/assist.zh.rules.test.ts 對送出前的 schema 計數並釘住確切數字）。
 * 英文四份與報告是例外：只釘住現況數字，不套這個預算。
 */
import { assistSubjectFromRef, type AssistCaseKind, type AssistSubject, type PhotoMime } from '@gsat/shared';
import type * as z from 'zod/v4';
import type { ClaudeCallInput } from '../../ai/client';
import type { D8Fingerprints } from '../../ai/d8';
import { assistZhFollowupSchema, assistZhFollowupSystemText, assistZhSchema, assistZhSystemText, ZH_ANALYZE_TEMPLATE_VERSIONS, ZH_FOLLOWUP_TEMPLATE_VERSION } from '../../ai/prompts/assist-zh';
import { ASSIST_ZH_OCR_TEMPLATE_VERSION, assistZhOcrSchema, assistZhOcrSystemText, assistZhOcrUserText } from '../../ai/prompts/assist-zh-ocr';
import type { TaskConfig } from '../../ai/tasks';
import type { AnalyzeRequestCase } from '../requests';
import { zhAnalyzeCallInput, zhAnalyzeUserText, zhOcrCallInput } from './chinese/requests';
import { englishSubject } from './english';

/**
 * 新科目（國文與之後）送出前的 schema 大小預算（§3.1；攤開後計數）：葉 ≤ 40、物件陣列 ≤ 6、全部陣列 ≤ 14、物件深度 ≤ 3、
 * JSON ≤ 10,000 位元組、沒有 $ref／$defs／anyOf、每個 enum ≤ 6 個值。實測：扁平約 60 個字串欄位通過、約 90 個被拒；
 * 6 個物件陣列通過、10 個被拒（docs/design/learning-assistant.md §10「上線後修正」）。
 */
export const ASSIST_SCHEMA_BUDGET = {
  leavesMax: 40,
  objectArraysMax: 6,
  arraysMax: 14,
  depthMax: 3,
  jsonBytesMax: 10_000,
  enumValuesMax: 6,
} as const;

/** 組解析請求的附加資料。 */
export interface SubjectAnalyzeExtras {
  /** <student_patterns>（只有代碼與數字；同一科的錯因次數）。 */
  patterns: string | null;
  /** 英文集合的 D8 指紋（英文寫作的遮罩用；國文不用）。 */
  fp: D8Fingerprints | null;
  /** 國文「同一份題目問另一部分」的前一個案例摘要（≤ 600 字）；英文沒有。 */
  related?: string | null;
}

/** 一個科目在 Worker 的實作（組請求的部分；後處理與結算由 consumer 依科目分派）。 */
export interface WorkerSubject {
  id: AssistSubject;
  /** 這一科的解析種類（assist_cases.kind）。 */
  kinds: readonly AssistCaseKind[];
  analyze: {
    /** 輸出 schema（送出前由 client.ts 的 inlinesSchemaRefs 攤開）。 */
    schema(kind: AssistCaseKind): z.ZodType;
    /** 系統提示（依格式一份；1 小時快取）。 */
    systemText(kind: AssistCaseKind): string;
    templateVersion(kind: AssistCaseKind): string;
    /** user 訊息（<task>＋<student_provided_question>＋<student_text>…）。 */
    userText(c: AnalyzeRequestCase, extras: SubjectAnalyzeExtras): string;
    callInput(tc: TaskConfig, c: AnalyzeRequestCase, extras: SubjectAnalyzeExtras): ClaudeCallInput;
  };
  followup: { schema: z.ZodType; systemText(): string; templateVersion: string };
  ocr: {
    schema: z.ZodType;
    systemText(): string;
    templateVersion: string;
    userText(photos: number): string;
    callInput(tc: TaskConfig, photos: Array<{ mime: PhotoMime; bytes: Uint8Array }>): ClaudeCallInput;
  };
  /** 能不能讀寫共用快取（國文第一版沒有站內題，一律不進快取）。 */
  cacheable(c: Pick<AnalyzeRequestCase, 'source' | 'kind' | 'doubt' | 'question'>): boolean;
}

/** 國文（§3、§6；提示在 prompts/assist-zh.ts、assist-zh-ocr.ts，user 訊息在 subjects/chinese/requests.ts）。 */
export const chineseSubject: WorkerSubject = {
  id: 'chinese',
  kinds: ['zh_choice', 'zh_short', 'zh_writing'],
  analyze: {
    schema: (kind) => assistZhSchema(zhKind(kind)),
    systemText: (kind) => assistZhSystemText(zhKind(kind)),
    templateVersion: (kind) => ZH_ANALYZE_TEMPLATE_VERSIONS[zhKind(kind)],
    userText: (c, extras) => zhAnalyzeUserText(c, { patterns: extras.patterns, related: extras.related ?? null }),
    callInput: (tc, c, extras) => zhAnalyzeCallInput(tc, c, { patterns: extras.patterns, related: extras.related ?? null }),
  },
  followup: {
    schema: assistZhFollowupSchema,
    systemText: assistZhFollowupSystemText,
    templateVersion: ZH_FOLLOWUP_TEMPLATE_VERSION,
  },
  ocr: {
    schema: assistZhOcrSchema,
    systemText: assistZhOcrSystemText,
    templateVersion: ASSIST_ZH_OCR_TEMPLATE_VERSION,
    userText: assistZhOcrUserText,
    callInput: zhOcrCallInput,
  },
  cacheable: () => false,
};

function zhKind(kind: AssistCaseKind): 'zh_choice' | 'zh_short' | 'zh_writing' {
  if (kind === 'zh_choice' || kind === 'zh_short' || kind === 'zh_writing') return kind;
  throw new Error(`國文沒有 ${kind} 這種解析`);
}

const SUBJECTS: Readonly<Record<AssistSubject, WorkerSubject>> = { english: englishSubject, chinese: chineseSubject };

/** 依科目取 Worker 的實作。 */
export function workerSubject(subject: AssistSubject): WorkerSubject {
  return SUBJECTS[subject];
}

/** 案例的科目（ref_json.subject；沒有或不認得就是英文，§7.1）。 */
export function subjectOfCase(row: { ref_json: string }): AssistSubject {
  return assistSubjectFromRef(row.ref_json);
}
