/**
 * 自訂作文題目送出時的特殊錯誤（docs/design/custom-essay.md §6.7）。作答頁與結果頁都先經過 customErrorView，
 * 回 null 的再交給既有的 useErrorView()／describeError()。
 *
 *   400 custom_prompt_invalid  依 reason 取共用文案，指出欄位（field）與位置（ranges）：頁面把它顯示在那一欄下方並標出位置
 *   400 essay_not_gradable     依 reason 取共用文案，顯示在作文欄下方
 *   400 bad_request「沒有這個題組」  舊版 Worker（網站先部署）：自訂題目的 AI 批改還在準備中
 *   409 conflict（題目 rev 不符）     題目剛剛改過了，請重新整理後再送出
 *   409 conflict（題目讀不到）        找不到這份作答的題目，請重新整理（送 AI 任務時 startTask 用 isCustomTaskConflict 把這兩種丟出來）
 *   503 not_configured（JSON）        自訂題目批改目前沒有開放（不是「整個 AI 都沒開」）
 * 訊息只依代碼與 reason，不顯示後端的 message（rev 不符與「沒有這個題組」是共用常數，才拿 message 比對）。
 */
import {
  CUSTOM_ESSAY_MIN_WORDS_FOR_AI,
  CUSTOM_ESSAY_NOT_CONFIGURED_MESSAGE,
  CUSTOM_PROMPT_CHANGED_MESSAGE,
  CUSTOM_PROMPT_FIELDS,
  CUSTOM_PROMPT_NOT_FOUND_MESSAGE,
  CUSTOM_PROMPT_PROBLEM_MESSAGES,
  ESSAY_NOT_GRADABLE_MESSAGES,
  WRITING_UNKNOWN_GROUP_MESSAGE,
  type CustomPromptField,
  type EssayNotGradableReason,
} from '@gsat/shared';
import { ApiRequestError } from '../../../lib/api';
import { API_ERROR_MESSAGES } from '../../../lib/apiErrors';
import { messageFor, type ErrorView } from '../lib/errors';
import type { CustomPromptDraft } from './drafts';

export const CUSTOM_AI_NOT_READY = '自訂題目的 AI 批改還在準備中（網站剛更新），請幾分鐘後再試。';
export const CUSTOM_PROMPT_CHANGED_VIEW = '題目剛剛改過了，請重新整理後再送出。';
export const CUSTOM_NOT_OPEN_ATTEMPT = '自訂題目批改目前沒有開放，可以先用檢核清單自我檢核。';
export const CUSTOM_PROMPT_NOT_FOUND_VIEW = '找不到這份作答的題目，請重新整理頁面再試。';

/**
 * 題目欄位的錯誤（伺服器回的）：顯示在那一欄下方；ranges 是那一欄正規化後文字的位置。
 * snapshot 是錯誤當時那一欄的內容（promptFieldSnapshot）：表單只在那一欄沒改過時顯示（改了別的欄位不會讓說明消失，審查 ux-8）。
 */
export interface PromptFieldError {
  field: CustomPromptField;
  reason: string | null;
  message: string;
  ranges: Array<[number, number]>;
  snapshot?: string;
}

/** 題目草稿某一欄的內容（比對「這一欄改過沒有」用；數字欄位是輸入框的原樣）。 */
export function promptFieldSnapshot(draft: CustomPromptDraft, field: CustomPromptField): string {
  switch (field) {
    case 'text':
      return draft.text;
    case 'figure_text':
      return draft.figure;
    case 'paragraphs':
      return String(draft.paragraphs);
    case 'min_words':
      return draft.minWords;
    case 'max_words':
      return draft.maxWords;
  }
}

/** 伺服器的題目錯誤記下當時那一欄的內容。 */
export function withSnapshot(error: PromptFieldError, draft: CustomPromptDraft): PromptFieldError {
  return { ...error, snapshot: promptFieldSnapshot(draft, error.field) };
}

/**
 * 送 AI 任務回 409 時，哪些是「真的沒送出」（題目 rev 不符、題目讀不到）：startTask 的 isFailure 用它，
 * 其他 409（已經在排隊或批改中）照舊當成已送出。
 */
export function isCustomTaskConflict(err: ApiRequestError): boolean {
  return err.status === 409 && !err.nonJson && (err.message.startsWith(CUSTOM_PROMPT_CHANGED_MESSAGE) || err.message.startsWith(CUSTOM_PROMPT_NOT_FOUND_MESSAGE));
}

export type CustomErrorResult =
  | { kind: 'prompt'; view: ErrorView; prompt: PromptFieldError }
  | { kind: 'essay'; view: ErrorView; reason: string | null }
  | { kind: 'other'; view: ErrorView };

function isPromptField(v: string | null): v is CustomPromptField {
  return v !== null && (CUSTOM_PROMPT_FIELDS as readonly string[]).includes(v);
}

/**
 * 自訂題目的特殊錯誤 → 畫面要怎麼顯示；不是這幾種回 null。
 * place：作答頁（attempt）或結果頁（result）；reloadHref：結果頁「重新整理」連結的網址（題目 rev 不符時）。
 */
export function customErrorView(err: unknown, { place, reloadHref }: { place: 'attempt' | 'result'; reloadHref?: string }): CustomErrorResult | null {
  if (!(err instanceof ApiRequestError) || err.nonJson) return null;
  if (err.code === 'custom_prompt_invalid') {
    const message = messageFor(CUSTOM_PROMPT_PROBLEM_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.custom_prompt_invalid;
    const field = isPromptField(err.field) ? err.field : 'text';
    return {
      kind: 'prompt',
      view: { message },
      prompt: { field, reason: err.reason, message, ranges: (err.ranges ?? []).map(([s, e]) => [s, e] as [number, number]) },
    };
  }
  if (err.code === 'essay_not_gradable') {
    return { kind: 'essay', view: { message: messageFor(ESSAY_NOT_GRADABLE_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.essay_not_gradable }, reason: err.reason };
  }
  if (err.status === 400 && err.code === 'bad_request' && err.message === WRITING_UNKNOWN_GROUP_MESSAGE) {
    return { kind: 'other', view: { message: CUSTOM_AI_NOT_READY } };
  }
  if (err.status === 409 && err.message.startsWith(CUSTOM_PROMPT_CHANGED_MESSAGE)) {
    return {
      kind: 'other',
      view: place === 'result' && reloadHref ? { message: CUSTOM_PROMPT_CHANGED_VIEW, action: { label: '重新整理', href: reloadHref } } : { message: CUSTOM_PROMPT_CHANGED_VIEW },
    };
  }
  if (err.status === 409 && err.message.startsWith(CUSTOM_PROMPT_NOT_FOUND_MESSAGE)) {
    return {
      kind: 'other',
      view: place === 'result' && reloadHref ? { message: CUSTOM_PROMPT_NOT_FOUND_VIEW, action: { label: '重新整理', href: reloadHref } } : { message: CUSTOM_PROMPT_NOT_FOUND_VIEW },
    };
  }
  if (err.status === 503 && err.code === 'not_configured') {
    return { kind: 'other', view: { message: place === 'attempt' ? CUSTOM_NOT_OPEN_ATTEMPT : CUSTOM_ESSAY_NOT_CONFIGURED_MESSAGE } };
  }
  return null;
}

/** 還不能送 AI 批改的作文原因（essayGradableProblem）→ 畫面上的一句話；字數不足時附上目前的單詞數。 */
export function gradableMessage(reason: EssayNotGradableReason, words: number): string {
  return reason === 'too_few_words' ? `作文至少要有 ${CUSTOM_ESSAY_MIN_WORDS_FOR_AI} 個英文單詞才能送 AI 批改（目前 ${words} 個）。` : ESSAY_NOT_GRADABLE_MESSAGES[reason];
}
