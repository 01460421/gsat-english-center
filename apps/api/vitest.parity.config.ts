import { defineConfig } from 'vitest/config';

// 真模型的評測（不進 CI）：自訂作文題目的評分對照（docs/design/custom-essay.md §7.8）npm run parity:custom-essay -w @gsat/api；
// 學習助手的評測（docs/design/learning-assistant.md §6.5）npm run parity:assist -w @gsat/api；作文範文的評測
// （docs/design/model-essays.md §9.6）npm run parity:exemplars -w @gsat/api；學習助手國文的評測（docs/design/assistant-subjects.md
// §11.4）npm run parity:assist-subjects -w @gsat/api。每個 script 都用檔名過濾，
// 各自只跑自己的那一支（不會一次花好幾份錢）。
// 只收 test/parity/**/*.parity.ts（npm test 與 CI 的 vitest.config.ts 只收 *.test.ts，不會跑到它）：評分對照本身，
// 以及開始前用真實資料檢查案例的 custom-essay.precheck.parity.ts（workflow 用檔名過濾只跑它，不需要金鑰）；
// 一次批改可能要幾分鐘，整組可能要跑好幾個小時，所以逾時放寬。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/parity/**/*.parity.ts'],
    testTimeout: 8 * 60 * 60 * 1000,
  },
});
