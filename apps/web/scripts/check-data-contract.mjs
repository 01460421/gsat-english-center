#!/usr/bin/env node
// @ts-check
/**
 * 檢查 public/data/ 的實際 JSON 是否符合 src/data/ 的 TypeScript 型別（前端資料契約）。
 *
 *   npm run check:data -w @gsat/web     （先跑過 build:data）
 *
 * 做法：把每個資料檔寫成「帶型別註記的 TypeScript 常數」（const x: VocabEntry[] = [...]），再交給 tsc。
 * 有型別註記時 tsc 會用情境型別檢查 JSON 字面值，"noun" 不在 VocabPos、mode 拼錯、少了必填欄位都會報錯；
 * 這比在 build-data.mjs 裡手寫一份平行的檢查可靠，因為比對的就是 UI 開發者 import 的那份型別。
 * 陣列每 100 筆切一段，否則 6,000 筆的陣列字面值會讓 tsc 放棄計算（TS2590）。
 *
 * 約 15 秒，所以不放進 prebuild；改了 build-data.mjs 的輸出格式或 src/data/ 的型別時手動跑一次。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(WEB_DIR, 'public', 'data');
// 放在 node_modules 底下：不進版控，也不會被 tsconfig.json（include: src）或 vitest 撿到；
// 又在 apps/web 之下，vite/client 等型別照常解析得到。
const WORK = path.join(WEB_DIR, 'node_modules', '.cache', 'data-contract');

if (!existsSync(path.join(DATA, 'meta.json'))) {
  console.error('[check-data] 找不到 public/data/meta.json，請先執行 npm run build:data -w @gsat/web');
  process.exit(1);
}

/** @param {string} rel @returns {unknown} */
const read = (rel) => JSON.parse(readFileSync(path.join(DATA, rel), 'utf8'));
/** @param {string} name */
const ident = (name) => name.replace(/\W/g, '_');

const src = path.join(WEB_DIR, 'src', 'data');
const lines = [
  `import type { DataMeta } from ${JSON.stringify(path.join(src, 'client'))};`,
  `import type { VocabIndex, VocabIndexEntry, VocabLevelFile, VocabEntry } from ${JSON.stringify(path.join(src, 'vocab'))};`,
  `import type { ExamIndex, Exam } from ${JSON.stringify(path.join(src, 'exams'))};`,
  `import type { ScoreScales } from ${JSON.stringify(path.join(src, 'scoreScales'))};`,
  `export const meta: DataMeta = ${JSON.stringify(read('meta.json'))};`,
  `export const examIndex: ExamIndex = ${JSON.stringify(read('exams/index.json'))};`,
  `export const scoreScales: ScoreScales = ${JSON.stringify(read('exams/score-scales.json'))};`,
];

/**
 * 外層物件（entries 清空）與 entries 分段各自宣告。
 * @param {string} name @param {string} fileType @param {string} entryType @param {unknown} file
 */
function chunked(name, fileType, entryType, file) {
  if (typeof file !== 'object' || file === null || !('entries' in file) || !Array.isArray(file.entries)) {
    throw new Error(`${name} 沒有 entries 陣列`);
  }
  lines.push(`export const ${name}: ${fileType} = ${JSON.stringify({ ...file, entries: [] })};`);
  for (let i = 0; i < file.entries.length; i += 100) {
    lines.push(`export const ${name}_${i}: ${entryType}[] = ${JSON.stringify(file.entries.slice(i, i + 100))};`);
  }
}

chunked('vocabIndex', 'VocabIndex', 'VocabIndexEntry', read('vocab/index.json'));
for (const level of [1, 2, 3, 4, 5, 6]) chunked(`vocabL${level}`, 'VocabLevelFile', 'VocabEntry', read(`vocab/L${level}.json`));
const examFiles = readdirSync(path.join(DATA, 'exams')).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'score-scales.json');
for (const f of examFiles) lines.push(`export const exam_${ident(f)}: Exam = ${JSON.stringify(read(`exams/${f}`))};`);

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
writeFileSync(path.join(WORK, 'contract.ts'), lines.join('\n'));
writeFileSync(
  path.join(WORK, 'tsconfig.json'),
  JSON.stringify({
    // 沿用前端的嚴格設定（含 strict、noUncheckedIndexedAccess），和 UI 程式碼看到的型別完全相同。
    extends: path.join(WEB_DIR, 'tsconfig.json'),
    include: ['contract.ts', path.join(WEB_DIR, 'src', 'vite-env.d.ts')],
  }),
);

const require = createRequire(import.meta.url);
const tsPkgPath = require.resolve('typescript/package.json');
/** @type {{ bin: { tsc: string } }} */
const tsPkg = JSON.parse(readFileSync(tsPkgPath, 'utf8'));
const tsc = path.join(path.dirname(tsPkgPath), tsPkg.bin.tsc);

try {
  execFileSync(process.execPath, [tsc, '-p', path.join(WORK, 'tsconfig.json')], { stdio: 'inherit' });
  console.log(`[check-data] 通過：meta、單字索引、6 個級別檔、試題索引與 ${examFiles.length} 份考卷都符合 src/data/ 的型別`);
  rmSync(WORK, { recursive: true, force: true });
} catch {
  console.error(`[check-data] 失敗：上面的錯誤行號對應 ${path.relative(WEB_DIR, path.join(WORK, 'contract.ts'))}（保留供查看）`);
  process.exit(1);
}
