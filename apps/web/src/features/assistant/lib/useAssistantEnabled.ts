/**
 * 學習助手的開關判斷（docs/design/learning-assistant.md §4.14、§5.1），全站集中在這裡：
 *
 *   開：公開的 /api/features 有 assistant: true（開關是 on），或 /api/me 有 assistant_preview（開關是 admin、這位是管理員）。
 *   關：其他一律關。導覽、首頁卡片、各模組的入口按鈕都看這一支；關著時畫面和沒有學習助手時完全相同。
 *   英文以外的科目（docs/design/assistant-subjects.md §7.5）：/api/features 的 assistantSubjects（開關 on），或管理員的
 *   /api/me 的 assistant_preview.subjects（開關 admin）；每一科的拍照由 Worker 算好放在 photo，前端只看 API。
 *
 * 這個檔案會跟著 Layout 與首頁打包進主程式，所以只依賴 lib/api.ts 與 shared 的 features.ts，不匯入學習助手的其他模組。
 */
import { assistSubjectAvailability, type AssistSubjectAvailability, type FeaturesResponse, type MeResponse } from '@gsat/shared';
import { useFeatures, useMe } from '../../../lib/api';
import type { PageFeatureFlags } from '../../../modules';

/** 學習助手對目前的使用者開不開（純函式，測試用）。 */
export function assistantEnabledOf(features: FeaturesResponse, me: MeResponse): boolean {
  return features.assistant === true || (me.user !== null && me.assistant_preview != null);
}

/** 拍照問題目開不開（WP-A3 的拍照分頁用；開關是 admin 時看 assistant_preview.photo）。 */
export function assistantPhotoEnabledOf(features: FeaturesResponse, me: MeResponse): boolean {
  if (!assistantEnabledOf(features, me)) return false;
  return features.assistantPhoto === true || (me.user !== null && me.assistant_preview?.photo === true);
}

/**
 * 對目前的使用者開放的英文以外科目（純函式，測試用）：公開的 assistantSubjects 與管理員預覽的 subjects 合併，
 * 同一科出現兩次時拍照取「任一邊開」。學習助手本身沒開時一律是空的（國文跟著學習助手的總開關）。
 * 國寫範文（exemplar；國寫範文設計 §7）同樣取任一邊開：開關是 admin 時只有管理員的預覽帶 exemplar: true；沒開時不帶這個欄位。
 */
export function assistantSubjectsOf(features: FeaturesResponse, me: MeResponse): AssistSubjectAvailability[] {
  if (!assistantEnabledOf(features, me)) return [];
  const preview = me.user !== null ? (me.assistant_preview?.subjects ?? []) : [];
  const all = [...(features.assistantSubjects ?? []), ...preview];
  const out: AssistSubjectAvailability[] = [];
  for (const item of assistSubjectAvailability(all)) {
    const exemplar = all.some((s) => s.subject === item.subject && s.exemplar === true);
    out.push({ subject: item.subject, photo: all.some((s) => s.subject === item.subject && s.photo), ...(exemplar ? { exemplar: true } : {}) });
  }
  return out;
}

export function useAssistantEnabled(): boolean {
  const features = useFeatures();
  const { me } = useMe();
  return assistantEnabledOf(features, me);
}

export function useAssistantPhotoEnabled(): boolean {
  const features = useFeatures();
  const { me } = useMe();
  return assistantPhotoEnabledOf(features, me);
}

/** 對目前的使用者開放的英文以外科目（沒有開放任何一科時是空陣列）。 */
export function useAssistantSubjects(): AssistSubjectAvailability[] {
  const features = useFeatures();
  const { me } = useMe();
  return assistantSubjectsOf(features, me);
}

/** 導覽與首頁過濾頁面用的開關集合（modules.ts 的 navPages）；assistantSubjects 只換學習助手卡片的說明。 */
export function usePageFeatureFlags(): PageFeatureFlags {
  const features = useFeatures();
  const { me } = useMe();
  const assistant = assistantEnabledOf(features, me);
  return assistantSubjectsOf(features, me).length > 0 ? { assistant, assistantSubjects: true } : { assistant };
}
