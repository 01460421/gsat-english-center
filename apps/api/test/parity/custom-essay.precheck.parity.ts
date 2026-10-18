/**
 * 評分對照開始之前的檢查（真實資料；不需要金鑰、不花錢；docs/design/custom-essay.md §7.8）。
 * 讀 data/bank/v1/composition 與 Worker 題目庫（npm run prompts 產生），確認可用的本站仿真作文夠多、案例的形狀正確、
 * 沒有被輸入規則拒收的案例。題數會因下架或審查而變，所以只檢查不變的關係（casesProblems、caseShape），不寫死數量。
 *
 * 不在 npm test 裡（檔名不符合 test/**\/*.test.ts）：下架或退回一題作文，不能讓 Worker 部署前的測試失敗。
 * GitHub Actions 的評分對照 workflow 在「準備題目庫、確認達標判定」那一步跑它（在花錢之前）：
 *   npx vitest run --config vitest.parity.config.ts custom-essay.precheck
 * npm run parity:custom-essay 也會跑到它；custom-essay.parity.ts 開始批改之前另外再檢查一次。
 */
import { describe, expect, it } from 'vitest';
import { A_COUNT, buildCases, caseShape, casesProblems, expectedCounts, loadBankEssays } from './custom-essay.cases';

describe('評分對照的案例（真實資料）', () => {
  it('可用的本站仿真作文夠多、案例的形狀正確、沒有被輸入規則拒收的案例', () => {
    const available = loadBankEssays().length;
    const cases = buildCases();
    expect(casesProblems(cases)).toEqual([]);
    expect(expectedCounts(cases)).toEqual(caseShape(Math.min(available, A_COUNT)));
    console.log(`[parity] 可用的本站仿真作文 ${available} 題，案例 ${cases.length} 個：${JSON.stringify(expectedCounts(cases))}`);
  });
});
