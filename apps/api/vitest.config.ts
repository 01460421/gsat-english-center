import { defineConfig } from 'vitest/config';

// 測試直接呼叫 Hono 的 app.request()，Node 內建的 Request／Response 就夠用，
// 不需要啟動 wrangler 或 workerd；之後要測 D1 時再依 05 文件 §2.9 用 node:sqlite 模擬。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
