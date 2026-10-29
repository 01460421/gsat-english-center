/**
 * 學習助手每一科對目前的使用者開不開、能不能拍照（docs/design/assistant-subjects.md §7.5、§8.1）：
 *   英文：沿用 useAssistantEnabled／useAssistantPhotoEnabled（AI_ASSISTANT、AI_ASSISTANT_PHOTO）；
 *   國文：/api/features 的 assistantSubjects（開關 on），或管理員的 /api/me 的 assistant_preview.subjects（開關 admin），
 *         拍照看同一筆的 photo（Worker 依 AI_ASSISTANT_PHOTO 與 AI_ASSISTANT_SUBJECTS_PHOTO 算好）。
 * 前端只看 API，不看 shared 的常數：Worker 與前端分開部署時，不會出現「前端顯示國文、Worker 拒收」的時段。
 * 另外記住上次選的科目（localStorage gsat-assist:v1:last-subject；讀寫都包 try/catch，讀不到就用英文）。
 */
import { ASSIST_SUBJECTS, isAssistSubject, type AssistSubject } from '@gsat/shared';
import { useAssistantEnabled, useAssistantPhotoEnabled, useAssistantSubjects } from '../lib/useAssistantEnabled';

export interface AssistSubjectsState {
  /** 對這位使用者開放的科目（依 ASSIST_SUBJECTS 的順序；學習助手沒開時是空陣列）。 */
  open: AssistSubject[];
  isOpen: (subject: AssistSubject) => boolean;
  /** 這一科能不能拍照。 */
  photo: (subject: AssistSubject) => boolean;
}

export function useAssistSubjects(): AssistSubjectsState {
  const english = useAssistantEnabled();
  const englishPhoto = useAssistantPhotoEnabled();
  const others = useAssistantSubjects();
  const open = ASSIST_SUBJECTS.filter((s) => (s === 'english' ? english : others.some((o) => o.subject === s)));
  return {
    open,
    isOpen: (s) => open.includes(s),
    photo: (s) => (s === 'english' ? englishPhoto : others.some((o) => o.subject === s && o.photo)),
  };
}

export const LAST_SUBJECT_KEY = 'gsat-assist:v1:last-subject';

/** 上次選的科目（讀不到、不是認得的科目時是 null）。 */
export function loadLastSubject(): AssistSubject | null {
  try {
    const v = localStorage.getItem(LAST_SUBJECT_KEY);
    return isAssistSubject(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveLastSubject(subject: AssistSubject): void {
  try {
    localStorage.setItem(LAST_SUBJECT_KEY, subject);
  } catch {
    // 無痕模式或儲存空間滿了：不記也沒關係，下次預設英文。
  }
}

/**
 * 表單的科目：網址的 ?subject= 優先，其次是上次選的科目，最後是英文；不在開放清單裡的一律換成開放清單的第一科。
 * 純函式（測試用）。
 */
export function pickSubject(param: string | null, last: AssistSubject | null, open: readonly AssistSubject[]): AssistSubject {
  const first = open[0] ?? 'english';
  if (isAssistSubject(param) && open.includes(param)) return param;
  if (last !== null && open.includes(last)) return last;
  return open.includes('english') ? 'english' : first;
}
