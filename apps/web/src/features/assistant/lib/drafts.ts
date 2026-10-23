/**
 * 學習助手的疑問與追問草稿（docs/design/learning-assistant.md §5.4）：gsat-assist:v1:draft:{key}，純文字。
 * 登出、刪帳號時由寫作模組的 clearLocalWritingData() 一起清掉（同一個前綴）。讀寫失敗安靜略過。
 */
import { ASSIST_DRAFT_PREFIX } from '../../writing/lib/drafts';

export function assistDraftKey(key: string): string {
  return `${ASSIST_DRAFT_PREFIX}${key}`;
}

export function loadAssistDraft(key: string): string {
  try {
    return window.localStorage.getItem(assistDraftKey(key)) ?? '';
  } catch {
    return '';
  }
}

export function saveAssistDraft(key: string, text: string): void {
  try {
    if (text === '') window.localStorage.removeItem(assistDraftKey(key));
    else window.localStorage.setItem(assistDraftKey(key), text);
  } catch {
    // 存不進去就算了：草稿只是方便
  }
}
