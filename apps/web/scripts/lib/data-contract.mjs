// @ts-check
/**
 * 前端資料契約檢查的核心（check-data-contract.mjs 與 data-contract.test.ts 共用）：
 * 把 public/data/ 的 JSON 寫成「帶型別註記的 TypeScript 常數」（const x: VocabEntry[] = [...]），再交給 tsc。
 *
 * 有型別註記時 tsc 會用情境型別檢查 JSON 字面值，"noun" 不在 VocabPos、mode 拼錯、少了必填欄位、多了型別沒有的欄位都會報錯；
 * 這比在 build-data.mjs 裡手寫一份平行的檢查可靠，因為比對的就是 UI 開發者 import 的那份型別。
 * 陣列每 100 筆切一段，否則 6,000 筆的陣列字面值會讓 tsc 放棄計算（TS2590）。
 *
 * parts 可以只挑一部分檢查：單元測試只拿題庫的範例輸出（tests/fixtures/bank-public）來檢查 bank 的型別，
 * 不必先跑完整的建置。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const CONTRACT_PARTS = /** @type {const} */ (['meta', 'vocab', 'exams', 'bank']);
/** @typedef {(typeof CONTRACT_PARTS)[number]} ContractPart */

/** @param {string} name */
const ident = (name) => name.replace(/\W/g, '_');

/**
 * 產生契約檢查用的 TypeScript 原始碼。
 * @param {{ dataDir: string, srcDir: string, parts?: readonly ContractPart[] }} options
 *   dataDir：public/data（或結構相同的目錄）；srcDir：src/data（型別所在）
 * @returns {{ source: string, summary: string[] }}  summary：檢查了哪些檔案（給 CLI 印出來）
 */
export function contractSource({ dataDir, srcDir, parts = CONTRACT_PARTS }) {
  /** @param {string} rel @returns {unknown} */
  const read = (rel) => JSON.parse(readFileSync(path.join(dataDir, rel), 'utf8'));
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const summary = [];

  /**
   * 外層物件（entries 清空）與 entries 分段各自宣告。
   * @param {string} name @param {string} fileType @param {string} entryType @param {unknown} file
   */
  const chunked = (name, fileType, entryType, file) => {
    if (typeof file !== 'object' || file === null || !('entries' in file) || !Array.isArray(file.entries)) {
      throw new Error(`${name} 沒有 entries 陣列`);
    }
    lines.push(`export const ${name}: ${fileType} = ${JSON.stringify({ ...file, entries: [] })};`);
    for (let i = 0; i < file.entries.length; i += 100) {
      lines.push(`export const ${name}_${i}: ${entryType}[] = ${JSON.stringify(file.entries.slice(i, i + 100))};`);
    }
  };

  if (parts.includes('meta')) {
    lines.push(`import type { DataMeta } from ${JSON.stringify(path.join(srcDir, 'client'))};`);
    lines.push(`export const meta: DataMeta = ${JSON.stringify(read('meta.json'))};`);
    summary.push('meta');
  }
  if (parts.includes('vocab')) {
    lines.push(`import type { VocabIndex, VocabIndexEntry, VocabLevelFile, VocabEntry } from ${JSON.stringify(path.join(srcDir, 'vocab'))};`);
    chunked('vocabIndex', 'VocabIndex', 'VocabIndexEntry', read('vocab/index.json'));
    for (const level of [1, 2, 3, 4, 5, 6]) chunked(`vocabL${level}`, 'VocabLevelFile', 'VocabEntry', read(`vocab/L${level}.json`));
    summary.push('單字索引', '6 個級別檔');
  }
  if (parts.includes('exams')) {
    lines.push(`import type { ExamIndex, Exam } from ${JSON.stringify(path.join(srcDir, 'exams'))};`);
    lines.push(`export const examIndex: ExamIndex = ${JSON.stringify(read('exams/index.json'))};`);
    const examFiles = readdirSync(path.join(dataDir, 'exams')).filter((f) => f.endsWith('.json') && f !== 'index.json');
    for (const f of examFiles) lines.push(`export const exam_${ident(f)}: Exam = ${JSON.stringify(read(`exams/${f}`))};`);
    summary.push('試題索引', `${examFiles.length} 份考卷`);
  }
  if (parts.includes('bank')) {
    // 還沒有題組時 build-data 不會建立 groups/ 目錄。
    const groupsDir = path.join(dataDir, 'bank', 'groups');
    const groupFiles = existsSync(groupsDir) ? readdirSync(groupsDir).filter((f) => f.endsWith('.json')).sort() : [];
    // 沒有題組檔時不匯入 PracticeGroupFile：noUnusedLocals 會把沒用到的匯入當成錯誤。
    const types = groupFiles.length > 0 ? 'BankIndex, PracticeGroupFile' : 'BankIndex';
    lines.push(`import type { ${types} } from ${JSON.stringify(path.join(srcDir, 'bank'))};`);
    lines.push(`export const bankIndex: BankIndex = ${JSON.stringify(read('bank/index.json'))};`);
    for (const f of groupFiles) lines.push(`export const bank_${ident(f)}: PracticeGroupFile = ${JSON.stringify(read(`bank/groups/${f}`))};`);
    summary.push('題庫索引', `${groupFiles.length} 個 AI 題組`);
  }
  return { source: lines.join('\n'), summary };
}

/**
 * 把原始碼寫進 workDir 並執行 tsc（沿用 webDir/tsconfig.json 的嚴格設定，和 UI 程式碼看到的型別完全相同）。
 * workDir 要在 apps/web 底下（例如 node_modules/.cache/…），tsconfig 的 types（vite/client）才解析得到。
 * @param {{ webDir: string, workDir: string, source: string, inherit?: boolean }} options
 *   inherit：tsc 的輸出直接印到終端機（CLI 用）；否則收集起來放在回傳值（測試用）
 * @returns {{ ok: boolean, output: string, contractFile: string }}
 */
export function runContractCheck({ webDir, workDir, source, inherit = false }) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const contractFile = path.join(workDir, 'contract.ts');
  writeFileSync(contractFile, source);
  writeFileSync(
    path.join(workDir, 'tsconfig.json'),
    JSON.stringify({
      extends: path.join(webDir, 'tsconfig.json'),
      include: ['contract.ts', path.join(webDir, 'src', 'vite-env.d.ts')],
    }),
  );

  const require = createRequire(path.join(webDir, 'package.json'));
  const tsPkgPath = require.resolve('typescript/package.json');
  /** @type {{ bin: { tsc: string } }} */
  const tsPkg = JSON.parse(readFileSync(tsPkgPath, 'utf8'));
  const tsc = path.join(path.dirname(tsPkgPath), tsPkg.bin.tsc);

  const res = spawnSync(process.execPath, [tsc, '-p', path.join(workDir, 'tsconfig.json')], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
  const output = inherit ? '' : `${res.stdout ?? ''}${res.stderr ?? ''}`;
  return { ok: res.status === 0, output, contractFile };
}
