/**
 * 把 src/tiers.ts 的規格資料寫成 data/specs/tiers.json，給 Python 工具（tools/text_metrics.py、tools/validate_bank.py）讀。
 * 用法（專案根目錄）：npm run gen:tiers
 * Node 22 內建型別剝除，直接執行 .ts；tiers.ts 只用 `import type` 引用 exam.ts，執行期沒有其他相依。
 * `npm run test:data`（tiers.data.test.ts）會比對 JSON 與 tiers.ts 一致。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tiersSpecSnapshot } from '../src/tiers.ts';

const out = fileURLToPath(new URL('../../../data/specs/tiers.json', import.meta.url));
writeFileSync(out, JSON.stringify(tiersSpecSnapshot(), null, 1) + '\n');
console.log(`已寫入 ${out}`);
