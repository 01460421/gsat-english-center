/**
 * 作文範文的開關判斷（docs/design/model-essays.md §7.5、§8.1），全站集中在這裡：
 *
 *   開：公開的 /api/features 有 essayExemplars: true（開關是 on），或 /api/me 有 exemplars_preview（開關是 admin、這位是管理員）。
 *   關：其他一律關。各頁的入口按鈕與卡片都看這一支；關著時畫面和沒有作文範文時完全相同（手機 0 像素差異）。
 *
 * 入口按鈕在寫作的各頁（歷屆、本站仿真、自訂題目的作答頁、批改結果頁、/writing、/composition），所以這個檔案只依賴 lib/api.ts。
 */
import type { FeaturesResponse, MeResponse } from '@gsat/shared';
import { useFeatures, useMe } from '../../../../lib/api';

/** 作文範文對目前的使用者開不開（純函式，測試用）。 */
export function exemplarsEnabledOf(features: FeaturesResponse, me: MeResponse): boolean {
  return features.essayExemplars === true || (me.user !== null && me.exemplars_preview === true);
}

export function useExemplarsEnabled(): boolean {
  const features = useFeatures();
  const { me } = useMe();
  return exemplarsEnabledOf(features, me);
}
