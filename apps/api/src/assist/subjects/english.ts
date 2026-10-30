/**
 * 英文的科目設定（docs/design/assistant-subjects.md §2.2、§2.4）：只把現行的函式包起來，**不搬也不改字**。
 * 系統提示、schema、user 訊息、快取鍵、點數、轉錄都和改版前逐位元相同（test/fixtures/assist-prompts.json 的雜湊、
 * assist.prompts.test.ts 的快照不改就必須通過；test/assist.subjects.test.ts 另外比對「經登記表組出的 user 訊息」和直接呼叫原函式相同）。
 */
import type { AssistEnglishCaseKind } from '@gsat/shared';
import { ASSIST_ANALYZE_TEMPLATE_VERSIONS, assistAnalyzeSchema, assistAnalyzeSystemText } from '../../ai/prompts/assist-analyze';
import { ASSIST_FOLLOWUP_TEMPLATE_VERSION, assistFollowupOutputSchema, assistFollowupSystemText } from '../../ai/prompts/assist-followup';
import { ASSIST_OCR_TEMPLATE_VERSION, assistOcrSchema, assistOcrSystemText, assistOcrUserText } from '../../ai/prompts/assist-ocr';
import { assistOcrCallInput } from '../ocr';
import { analyzeCallInput, analyzeUserText, isCacheable } from '../requests';
import type { WorkerSubject } from './index';

const KINDS: readonly AssistEnglishCaseKind[] = ['item', 'writing', 'vocab'];

function englishKind(kind: string): AssistEnglishCaseKind {
  if ((KINDS as readonly string[]).includes(kind)) return kind as AssistEnglishCaseKind;
  throw new Error(`英文沒有 ${kind} 這種解析`);
}

export const englishSubject: WorkerSubject = {
  id: 'english',
  kinds: KINDS,
  analyze: {
    schema: (kind) => assistAnalyzeSchema(englishKind(kind)),
    systemText: (kind) => assistAnalyzeSystemText(englishKind(kind)),
    templateVersion: (kind) => ASSIST_ANALYZE_TEMPLATE_VERSIONS[englishKind(kind)],
    userText: (c, extras) => analyzeUserText(c, { patterns: extras.patterns, fp: extras.fp }),
    callInput: (tc, c, extras) => analyzeCallInput(tc, c, { patterns: extras.patterns, fp: extras.fp }),
  },
  followup: {
    schema: assistFollowupOutputSchema,
    systemText: assistFollowupSystemText,
    templateVersion: ASSIST_FOLLOWUP_TEMPLATE_VERSION,
  },
  ocr: {
    schema: assistOcrSchema,
    systemText: assistOcrSystemText,
    templateVersion: ASSIST_OCR_TEMPLATE_VERSION,
    userText: assistOcrUserText,
    callInput: assistOcrCallInput,
  },
  cacheable: isCacheable,
};
