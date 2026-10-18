import { defineConfig } from 'vitest/config';

// 自訂作文題目的評分對照（真模型，docs/design/custom-essay.md §7.8）：npm run parity:custom-essay -w @gsat/api。
// 只收 test/parity/**/*.parity.ts（npm test 與 CI 的 vitest.config.ts 只收 *.test.ts，不會跑到它）；
// 一次批改可能要幾分鐘，整組可能要跑好幾個小時，所以逾時放寬。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/parity/**/*.parity.ts'],
    testTimeout: 8 * 60 * 60 * 1000,
  },
});
