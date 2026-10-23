/**
 * 學習助手的開關判斷（docs/design/learning-assistant.md §4.14、§5.1），全站集中在這裡：
 *
 *   開：公開的 /api/features 有 assistant: true（開關是 on），或 /api/me 有 assistant_preview（開關是 admin、這位是管理員）。
 *   關：其他一律關。導覽、首頁卡片、各模組的入口按鈕都看這一支；關著時畫面和沒有學習助手時完全相同。
 *
 * 這個檔案會跟著 Layout 與首頁打包進主程式，所以只依賴 lib/api.ts，不匯入學習助手的其他模組。
 */
import type { FeaturesResponse, MeResponse } from '@gsat/shared';
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

/** 導覽與首頁過濾頁面用的開關集合（modules.ts 的 navPages）。 */
export function usePageFeatureFlags(): PageFeatureFlags {
  return { assistant: useAssistantEnabled() };
}
