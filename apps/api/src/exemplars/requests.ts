/**
 * 作文範文的呼叫輸入（docs/design/model-essays.md §3.2）：路由（共用快取的鍵）、consumer 與真模型評測工具都從這裡取得輸入，
 * 再交給 client.ts 的 buildClaudeRequest——規則掃描（test/ai.rules.test.ts）測的就是正式送出的請求。
 *
 * 題目只有兩種來源：Worker 的題目庫（網站題目，getWritingGroup）與 D1 裡正規化、遮過 email 與電話的自訂題（prompt_json）。
 * 前端送來的任何文字都不直接進提示。送出的只有題目文字與網站寫的目標；沒有 email、暱稱、帳號 id。
 */
import { exemplarWordTargets, type CustomPromptValue, type ExemplarLevel, type ExemplarWordTarget } from '@gsat/shared';
import type { WritingGroup } from '../ai/bank';
import type { ClaudeCallInput } from '../ai/client';
import {
  EXEMPLAR_CUSTOM_TEMPLATE_VERSION,
  EXEMPLAR_SITE_TEMPLATE_VERSION,
  exemplarCustomUserContent,
  exemplarSiteUserContent,
  exemplarSystemText,
} from '../ai/prompts/exemplars';
import { callSpec, type TaskConfig } from '../ai/tasks';
import { exemplarOutputSchema } from './schema';

/** 自訂題存下來的題目（prompt_json；checkCustomPrompt 正規化之後的值）。 */
export type ExemplarCustomPrompt = Pick<CustomPromptValue, 'text' | 'figure_text' | 'paragraphs' | 'min_words' | 'max_words'>;

/** 一次產生的題目：網站題目（題目庫的題組）或自訂題。 */
export type ExemplarRequest = { source: 'exam' | 'bank'; group: WritingGroup } | { source: 'custom'; prompt: ExemplarCustomPrompt };

/** 三級的字數目標（§2.4；前端確認畫面、<task>、後處理共用 shared 的 exemplarWordTargets）。 */
export function requestTargets(req: ExemplarRequest): Record<ExemplarLevel, ExemplarWordTarget> {
  if (req.source === 'custom') return exemplarWordTargets({ origin: 'custom', min_words: req.prompt.min_words, max_words: req.prompt.max_words, approx_words: null });
  const e = req.group.essay;
  return exemplarWordTargets({ origin: req.source, min_words: e?.min_words ?? null, max_words: e?.max_words ?? null, approx_words: e?.approx_words ?? null });
}

/** 題目或學生規定的段數（沒有規定時 null：三篇段數相同即可）。 */
export function requestParagraphs(req: ExemplarRequest): number | null {
  return req.source === 'custom' ? (req.prompt.paragraphs ?? null) : (req.group.essay?.paragraphs ?? null);
}

/**
 * 「照抄題目」比對用的題目文字（§3.5）：自訂題是學生的題目與圖片描述；網站題目是說明、背景與提示（只記數，不隱藏）。
 */
export function requestTaskTexts(req: ExemplarRequest): string[] {
  if (req.source === 'custom') return [req.prompt.text, ...(req.prompt.figure_text ? [req.prompt.figure_text] : [])];
  return [req.group.instructions, req.group.context ?? '', req.group.items[0]?.stem ?? ''].filter((t) => t !== '');
}

/** 送出的呼叫輸入（系統提示所有學生共用；user 訊息依來源用兩種範本）。 */
export function exemplarCallInput(tc: TaskConfig, req: ExemplarRequest): ClaudeCallInput {
  const spec = callSpec(tc, 'writer');
  const targets = requestTargets(req);
  const custom = req.source === 'custom';
  return {
    task: tc.task,
    spec,
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: exemplarSystemText(),
    schema: exemplarOutputSchema,
    content: custom ? exemplarCustomUserContent(req.prompt, targets) : exemplarSiteUserContent(req.group, targets),
    templateVersion: custom ? EXEMPLAR_CUSTOM_TEMPLATE_VERSION : EXEMPLAR_SITE_TEMPLATE_VERSION,
  };
}
