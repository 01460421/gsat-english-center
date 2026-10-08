import { defineConfig } from 'vitest/config';

/**
 * 兩組測試分開跑：
 *   unit  `npm test`：型別守衛、小工具等純程式碼的測試。只看程式碼，結果不受 data/ 影響。
 *   data  `npm run test:data`：拿 data/ 下的實際 JSON 檢查型別有沒有「說實話」（*.data.test.ts）。
 * 分開的理由：data/exams/parsed/ 由另一條流程陸續寫入，檔案寫到一半或有錯時，不該讓程式碼的 CI 跟著紅；
 * CI 把 data 組放在題庫檢查的 job（.github/workflows/ci.yml 的 exams），和 tools/validate_exam.py 一起跑。
 */
export default defineConfig({
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.data.test.ts'] },
      },
      {
        extends: true,
        test: { name: 'data', include: ['src/**/*.data.test.ts'] },
      },
    ],
  },
});
