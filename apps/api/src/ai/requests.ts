/**
 * 每個任務、每位評分者的呼叫輸入（系統提示、schema、user 訊息）。負責：後端 AI A2。
 * consumer 與 test/ai.rules.test.ts 都從這裡取得輸入，再交給 client.ts 的 buildClaudeRequest——
 * 規則掃描測的就是正式送出的請求。
 *
 * 送出的內容只有：題目文字（伺服器端的題目，或學生自己提供、存檔前已遮掉 email 與電話的自訂作文題目）、評分基準、
 * 學生文字（OCR 另加照片）。沒有 email、暱稱、帳號 id（§6.2 第 13 條）。
 */
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { PhotoMime } from '@gsat/shared';
import type { WritingGroup } from './bank';
import type { ClaudeCallInput } from './client';
import { essayPromptParts, essaySchema } from './prompts/essay';
import { ocrPromptParts, ocrSchema, ocrSystemText } from './prompts/ocr';
import { translationSchema, translationSystemText, translationTemplateVersion, translationUserContent } from './prompts/translation';
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
    // 本站仿真題用 translation-user-guided@1（系統提示不變；prompt_version 和歷屆題分開）。
    templateVersion: translationTemplateVersion(group),
  };
}

/**
 * 作文：paragraphs 是程式切好的段落。系統提示、user 訊息與範本版本只從 essayPromptParts 取（依題目來源一次決定，
 * 自訂作文題目不會走到歷屆題的範本；docs/design/custom-essay.md §4.1）。
 */
export function essayCallInput(tc: TaskConfig, role: CallRole, group: WritingGroup, paragraphs: string[], wordCount: number): ClaudeCallInput {
  const b = base(tc, role);
  const parts = essayPromptParts(group, b.spec.framework, paragraphs, wordCount);
  return { ...b, system: parts.system, schema: essaySchema(b.spec.framework), content: parts.content, templateVersion: parts.templateVersion };
}

/** OCR：照片在前（依 ord）、文字在後。文字與範本版本只從 ocrPromptParts 取（自訂題不帶學生的題目）。 */
export function ocrCallInput(tc: TaskConfig, group: WritingGroup, photos: Array<{ mime: PhotoMime; bytes: Uint8Array }>): ClaudeCallInput {
  const b = base(tc, 'ocr');
  const parts = ocrPromptParts(group);
  const content: BetaContentBlockParam[] = [
    ...photos.map((p): BetaContentBlockParam => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: toBase64(p.bytes) } })),
    { type: 'text', text: parts.text },
  ];
  return { ...b, system: ocrSystemText(), schema: ocrSchema, content, templateVersion: parts.templateVersion };
}
