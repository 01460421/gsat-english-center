/**
 * /assistant/new?from={caseId}（docs/design/assistant-subjects.md §1.6、§2.5）：讀前一個案例已確認的題目，給貼上表單預填。
 *   - 國文「用同一份題目問另一部分」：預填題目文字，送出時帶 related_case_id（Worker 再驗證同一位使用者、同一科）。
 *   - 解析時判定科目不符退還後的「改用英文重新建立」：預填題目文字，不帶 related_case_id。
 * 讀不到（刪掉了、不是自己的、不是學生提供的題目）就當成沒有，表單照常是空的。
 */
import type { AssistCaseDetail } from '@gsat/shared';
import { useEffect, useState } from 'react';
import { getAssistCase } from '../lib/assistApi';

/** 案例 id 只收英數與連字號（放進路徑前再編碼）。 */
const CASE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export type FromCaseState = { state: 'none' } | { state: 'loading' } | { state: 'ready'; detail: AssistCaseDetail };

export function useFromCase(raw: string | null): FromCaseState {
  const id = raw !== null && CASE_ID_RE.test(raw) ? raw : null;
  const [state, setState] = useState<FromCaseState>(id ? { state: 'loading' } : { state: 'none' });
  useEffect(() => {
    if (id === null) {
      setState({ state: 'none' });
      return;
    }
    const controller = new AbortController();
    setState({ state: 'loading' });
    getAssistCase(id, controller.signal).then(
      (detail) => {
        if (controller.signal.aborted) return;
        const usable = detail.trust === 'student' && (detail.question?.blocks?.length ?? 0) > 0;
        setState(usable ? { state: 'ready', detail } : { state: 'none' });
      },
      () => {
        if (!controller.signal.aborted) setState({ state: 'none' });
      },
    );
    return () => controller.abort();
  }, [id]);
  return state;
}
