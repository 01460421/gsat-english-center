/**
 * 國文的台灣標準（docs/design/assistant-subjects.md §5.6）。**S1-worker-core 建的入口；內容由後處理的工作包填。**
 *
 * 呼叫端（output.ts 已經接好；下一個工作包只改這個檔、output.ts 與其他步驟檔）：
 *   zhApplyStandards   整則解析（§5.1 第 13 步）：注音字元與音節形狀（sound 卡的 a、字音題的 key_zh）、拼音清空（pinyin_cleared）、
 *                      台灣審定音表（tw_reading_mismatch）、字音四方一致（sound_inconsistent）、說明欄位的字碼替換（tw_form_replaced）、
 *                      教字形欄位的非標準字整列拿掉（tw_form_rows_dropped）、修辭名稱（rhetoric_term_replaced／unknown）、
 *                      錯別字的兩可清單；回傳替換後仍在的簡體專用字（≥ 3 個時 output.ts 要求重寫一次，simplified_retry）。
 *   zhApplyFollowupStandards  追問的說明欄位（字碼替換、簡體字計數）。
 * 目前的行為（TODO）：原樣回傳、不改任何欄位，simplified 是空陣列。
 */
import type { ZhAnalysisView, ZhChecks, ZhFollowupView } from '@gsat/shared';
import type { ZhOutputContext } from '../types';

export interface ZhStandardsResult<V> {
  view: V;
  /** 替換後仍在的簡體專用字（不同的字）。 */
  simplified: string[];
}

/** 解析的台灣標準（見檔頭；TODO）。 */
export function zhApplyStandards<V extends ZhAnalysisView>(view: V, _ctx: ZhOutputContext, _checks: ZhChecks): ZhStandardsResult<V> {
  return { view, simplified: [] };
}

/** 追問的台灣標準（見檔頭；TODO）。 */
export function zhApplyFollowupStandards(view: ZhFollowupView, _checks: ZhChecks): ZhStandardsResult<ZhFollowupView> {
  return { view, simplified: [] };
}
