/**
 * 作文範文真模型評測開始之前的檢查（真實資料；不需要金鑰、不花錢；docs/design/model-essays.md §9.6、§12.4）。
 * 讀 Worker 題目庫與 D8 指紋（npm run prompts 產生），確認題目集（fixtures/exemplars-golden/golden.json）沒有問題：A 組與網站題目都
 * 在白名單、來源對（B 歷屆、C 本站仿真）、自訂題都通過輸入規則而且不和網站題目相同、F 組的檢查認得而且真的有注入旗標
 * （casesProblems，和 exemplars.parity.ts 花錢之前的檢查同一支）。
 *
 * 不在 npm test 裡（檔名不符合 test/**\/*.test.ts）：下架或退回一題本站仿真作文、更新 D8 指紋，不能讓 Worker 部署前的測試失敗
 * （同 custom-essay.precheck.parity.ts）。GitHub Actions 的作文範文評測 workflow 在「準備資料、確認達標判定」那一步跑它（在花錢之前）：
 *   npx vitest run --config vitest.parity.config.ts exemplars.precheck
 * exemplars.parity.ts 開始之前另外再檢查一次（題目集有問題就不開始、不花錢）。
 */
import { describe, expect, it } from 'vitest';
import { d8Fingerprints } from '../../src/ai/d8';
import goldenJson from '../fixtures/exemplars-golden/golden.json';
import { allCases, type GoldenFile } from './exemplars.cases';
import { casesProblems } from './exemplars.runner';

describe('作文範文評測的題目集（真實資料）', () => {
  it('A 組與網站題目都在白名單而且來源對、自訂題都送得出去、F 組有注入旗標', () => {
    const fp = d8Fingerprints();
    if (!fp) throw new Error('D8 指紋檔無效：先跑 npm run prompts -w @gsat/api');
    const golden = goldenJson as unknown as GoldenFile;
    const cases = allCases(golden, true);
    expect(casesProblems(golden, cases, fp)).toEqual([]);
    console.log(`[exemplars-eval] 題目集 ${cases.length} 題（含 G 組）、A 組 ${golden.probe.uid}：花錢之前的檢查沒有問題`);
  });
});
