/**
 * 題目以外的古文名句與默寫的核對（docs/design/assistant-subjects.md §5.2）。**S1-worker-core 建的入口；內容由後處理的工作包填。**
 *
 * 語料：data/d8/zh-public-classics.txt（公有領域古文；由 build-writing-prompts.mjs 打包進 Worker，≤ 300 KB）。
 * 呼叫端（output.ts 已經接好；下一個工作包只改這個檔、output.ts 與 d8.ts 的打包）：
 *   zhCheckClassics   _zh 欄位裡「」包住、≥ 8 個漢字、不在題目中的引文：和語料完全相同保留；幾乎相同（編輯距離 ≤ 2、只有一處相近）
 *                     換成語料版本；相近處不只一處拿掉引號（classic_misquote）；語料找不到照常顯示（輸出照樣跑 D8）。
 *                     默寫題：學生答案與示範逐字對照語料，標出不同的字；語料沒有那一篇時該題 certainty 最高 likely、
 *                     加「本站無法核對原文」（recitation_unverified）。
 * 目前的行為（TODO）：原樣回傳、不改任何欄位。
 */
import type { AssistQuestionView, ZhAnalysisView, ZhChecks } from '@gsat/shared';

/** 古文名句與默寫的核對（見檔頭；TODO）。 */
export function zhCheckClassics<V extends ZhAnalysisView>(view: V, _q: AssistQuestionView, _checks: ZhChecks): V {
  return view;
}
