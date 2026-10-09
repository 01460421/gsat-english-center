#!/usr/bin/env node
// @ts-check
/**
 * 檢查 public/data/ 的實際 JSON 是否符合 src/data/（與寫作練習的 src/features/writing/data.ts）的 TypeScript 型別（前端資料契約）。
 *
 *   npm run check:data -w @gsat/web     （先跑過 build:data）
 *
 * 做法（lib/data-contract.mjs）：把每個資料檔寫成「帶型別註記的 TypeScript 常數」再交給 tsc，
 * 比對的就是 UI 開發者 import 的那份型別。涵蓋 meta、單字、歷屆試題與題庫練習（bank/）。
 * 題庫的部分另外有單元測試（lib/data-contract.test.ts）用範例輸出檢查，不必等完整建置。
 *
 * 約 15 秒，所以不放進 prebuild；改了 build-data.mjs 的輸出格式或 src/data/ 的型別時手動跑一次。
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractSource, runContractCheck } from './lib/data-contract.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(WEB_DIR, 'public', 'data');
// 放在 node_modules 底下：不進版控，也不會被 tsconfig.json（include: src）或 vitest 撿到；
// 又在 apps/web 之下，vite/client 等型別照常解析得到。
const WORK = path.join(WEB_DIR, 'node_modules', '.cache', 'data-contract');

if (!existsSync(path.join(DATA, 'meta.json'))) {
  console.error('[check-data] 找不到 public/data/meta.json，請先執行 npm run build:data -w @gsat/web');
  process.exit(1);
}

const { source, summary } = contractSource({ dataDir: DATA, srcDir: path.join(WEB_DIR, 'src', 'data') });
const { ok, contractFile } = runContractCheck({ webDir: WEB_DIR, workDir: WORK, source, inherit: true });
if (ok) {
  console.log(`[check-data] 通過：${summary.join('、')}都符合 src/data/ 的型別`);
  rmSync(WORK, { recursive: true, force: true });
} else {
  console.error(`[check-data] 失敗：上面的錯誤行號對應 ${path.relative(WEB_DIR, contractFile)}（保留供查看）`);
  process.exit(1);
}
