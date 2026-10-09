/**
 * 每個任務、每位評分者的呼叫輸入（系統提示、schema、user 訊息）。負責：後端 AI A2。
 * consumer 與 test/ai.rules.test.ts 都從這裡取得輸入，再交給 client.ts 的 buildClaudeRequest——
 * 規則掃描測的就是正式送出的請求。
 *
 * 送出的內容只有：伺服器端的題目文字、評分基準、學生文字（OCR 另加照片）。沒有 email、暱稱、帳號 id（§6.2 第 13 條）。
 */
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { PhotoMime } from '@gsat/shared';
import type { WritingGroup } from './bank';
import type { ClaudeCallInput } from './client';
import { essaySchema, essaySystemText, essayUserContent, ESSAY_TEMPLATE_VERSION } from './prompts/essay';
import { ocrSchema, ocrSystemText, ocrUserText, OCR_TEMPLATE_VERSION } from './prompts/ocr';
import { translationSchema, translationSystemText, translationUserContent, TRANSLATION_TEMPLATE_VERSION } from './prompts/translation';
import { toBase64 } from '../submissions/images';
import { callSpec, type CallRole, type TaskConfig } from './tasks';

function base(tc: TaskConfig, role: CallRole) {
  return { task: tc.task, spec: callSpec(tc, role), timeoutMs: tc.timeoutMs, maxRetries: tc.maxRetries };
}

/** 中譯英：sentences 依題組的題目順序（已淨化）。 */
export function translationCallInput(tc: TaskConfig, role: CallRole, group: WritingGroup, sentences: string[]): ClaudeCallInput {
  const b = base(tc, role);
  return {
    ...b,
    system: translationSystemText(b.spec.framework),
    schema: translationSchema(b.spec.framework),
    content: translationUserContent(group, sentences),
    templateVersion: TRANSLATION_TEMPLATE_VERSION,
  };
}

/** 作文：paragraphs 是程式切好的段落。 */
export function essayCallInput(tc: TaskConfig, role: CallRole, group: WritingGroup, paragraphs: string[], wordCount: number): ClaudeCallInput {
  const b = base(tc, role);
  return {
    ...b,
    system: essaySystemText(b.spec.framework),
    schema: essaySchema(b.spec.framework),
    content: essayUserContent(group, paragraphs, wordCount),
    templateVersion: ESSAY_TEMPLATE_VERSION,
  };
}

/** OCR：照片在前（依 ord）、文字在後。 */
export function ocrCallInput(tc: TaskConfig, group: WritingGroup, photos: Array<{ mime: PhotoMime; bytes: Uint8Array }>): ClaudeCallInput {
  const b = base(tc, 'ocr');
  const content: BetaContentBlockParam[] = [
    ...photos.map((p): BetaContentBlockParam => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: toBase64(p.bytes) } })),
    { type: 'text', text: ocrUserText(group) },
  ];
  return { ...b, system: ocrSystemText(), schema: ocrSchema, content, templateVersion: OCR_TEMPLATE_VERSION };
}
