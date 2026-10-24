// @ts-check
/**
 * 前端資料契約檢查的核心（check-data-contract.mjs 與 data-contract.test.ts 共用）：
 * 把 public/data/ 的 JSON 寫成「帶型別註記的 TypeScript 常數」（const x: VocabEntry[] = [...]），再交給 tsc。
 *
 * 有型別註記時 tsc 會用情境型別檢查 JSON 字面值，"noun" 不在 VocabPos、mode 拼錯、少了必填欄位、多了型別沒有的欄位都會報錯；
 * 這比在 build-data.mjs 裡手寫一份平行的檢查可靠，因為比對的就是 UI 開發者 import 的那份型別。
 * 陣列每 100 筆切一段，否則 6,000 筆的陣列字面值會讓 tsc 放棄計算（TS2590）。
 *
 * parts 可以只挑一部分檢查：單元測試只拿題庫的範例輸出（tests/fixtures/bank-public）來檢查 bank 的型別、
 * 拿 data/exams/gsat-spec.json 換算出的級分對照檢查 exams 的 score-scales、拿範例組卷池（tests/fixtures/bank-mock-public）
 * 檢查 mockPool，不必先跑完整的建置。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const CONTRACT_PARTS = /** @type {const} */ (['meta', 'vocab', 'exams', 'bank', 'writing', 'writingBank', 'mockPool', 'paperSkills', 'sources']);
/** @typedef {(typeof CONTRACT_PARTS)[number]} ContractPart */

/**
 * 自組模擬考的組卷池（bank/mock-pool.json，scripts/lib/bank-mock-pool.mjs）對應的前端型別：模組（相對 src/）與型別名稱。
 * 前端改了型別名稱或檔案位置時只要改這裡。
 */
export const MOCK_POOL_TYPE = /** @type {const} */ ({ module: 'features/mock/bank/pool', name: 'MockPool' });

/** 加強卷的技能分布（bank/paper-skills.json，scripts/lib/bank-paper-skills.mjs）對應的前端型別。 */
export const PAPER_SKILLS_TYPE = /** @type {const} */ ({ module: 'features/mock/bank/paperSkills', name: 'PaperSkills' });

/** 題目來源登記（bank/sources.json，scripts/lib/item-sources.mjs）對應的前端型別。 */
export const SOURCES_TYPE = /** @type {const} */ ({ module: 'data/sources', name: 'SourceRegistry' });

/** exams/ 底下不是單份考卷的檔案（和 build-data.mjs 的同名常數一致）。 */
export const EXAM_DIR_NON_EXAM_FILES = new Set(['index.json', 'score-scales.json']);

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
    // exams/ 底下除了 {id}.json，還有列表與模擬考的級分對照（build-data.mjs 的 EXAM_DIR_NON_EXAM_FILES），兩者都不是 Exam。
    const examFiles = readdirSync(path.join(dataDir, 'exams')).filter((f) => f.endsWith('.json') && !EXAM_DIR_NON_EXAM_FILES.has(f));
    // 沒有考卷檔時不匯入 Exam（noUnusedLocals，同下面 bank 的 PracticeGroupFile）。
    lines.push(`import type { ${examFiles.length > 0 ? 'ExamIndex, Exam' : 'ExamIndex'} } from ${JSON.stringify(path.join(srcDir, 'exams'))};`);
    lines.push(`export const examIndex: ExamIndex = ${JSON.stringify(read('exams/index.json'))};`);
    for (const f of examFiles) lines.push(`export const exam_${ident(f)}: Exam = ${JSON.stringify(read(`exams/${f}`))};`);
    summary.push('試題索引', `${examFiles.length} 份考卷`);
    // 級分對照（模擬考成績單用，src/data/scoreScales.ts）。build-data 一定會輸出；缺檔就讓檢查失敗，不要悄悄略過。
    lines.push(`import type { ScoreScales } from ${JSON.stringify(path.join(srcDir, 'scoreScales'))};`);
    lines.push(`export const scoreScales: ScoreScales = ${JSON.stringify(read('exams/score-scales.json'))};`);
    summary.push('級分對照');
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
  if (parts.includes('writing')) {
    // 寫作練習的索引（build-data.mjs 的 buildWriting）；型別放在功能資料夾裡，因為只有寫作頁會用到。
    const writingTypes = path.join(srcDir, '..', 'features', 'writing', 'data');
    lines.push(`import type { TranslationIndex, EssayIndex } from ${JSON.stringify(writingTypes)};`);
    lines.push(`export const writingTranslation: TranslationIndex = ${JSON.stringify(read('writing/translation.json'))};`);
    lines.push(`export const writingEssay: EssayIndex = ${JSON.stringify(read('writing/essay.json'))};`);
    summary.push('寫作練習的 2 個索引');
  }
  if (parts.includes('writingBank')) {
    // 本站仿真中譯英與作文（scripts/lib/writing-bank.mjs）：index、6 個難度列表、每組的 prompts 與 answers。
    // 中譯英（ai.tr.*）與作文（ai.cp.*）各自用自己的型別檢查（比聯集型別嚴：作文的欄位不能出現在中譯英檔）。
    const bankTypes = path.join(srcDir, '..', 'features', 'writing', 'bank', 'data');
    const listDir = (/** @type {string} */ sub) => {
      const dir = path.join(dataDir, 'writing', 'bank', sub);
      return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
    };
    const prompts = listDir('prompts');
    const answers = listDir('answers');
    const lists = listDir('list');
    /** @type {Set<string>} */
    const used = new Set(['WritingBankIndex']);
    /** @param {string} f */
    const isTr = (f) => f.startsWith('ai.tr.');
    /** @type {string[]} */
    const body = [];
    body.push(`export const writingBankIndex: WritingBankIndex = ${JSON.stringify(read('writing/bank/index.json'))};`);
    for (const f of lists) {
      const type = f.startsWith('translation-') ? 'BankTranslationTierList' : 'BankEssayTierList';
      used.add(type);
      body.push(`export const writingBankList_${ident(f)}: ${type} = ${JSON.stringify(read(`writing/bank/list/${f}`))};`);
    }
    for (const f of prompts) {
      const type = isTr(f) ? 'BankTranslationPromptFile' : 'BankEssayPromptFile';
      used.add(type);
      body.push(`export const writingBankPrompt_${ident(f)}: ${type} = ${JSON.stringify(read(`writing/bank/prompts/${f}`))};`);
    }
    for (const f of answers) {
      const type = isTr(f) ? 'BankTranslationAnswersFile' : 'BankEssayAnswersFile';
      used.add(type);
      body.push(`export const writingBankAnswers_${ident(f)}: ${type} = ${JSON.stringify(read(`writing/bank/answers/${f}`))};`);
    }
    // 沒有檔案的型別不匯入（noUnusedLocals，同 bank 的做法）。
    lines.push(`import type { ${[...used].sort().join(', ')} } from ${JSON.stringify(bankTypes)};`);
    lines.push(...body);
    summary.push('本站仿真寫作題的索引', `${lists.length} 個難度列表`, `${prompts.length} 個題目檔`, `${answers.length} 個參考內容檔`);
  }
  if (parts.includes('mockPool')) {
    // 本站自組模擬考的組卷池（docs/design/bank-mock.md §4.7、§9.1）。build-data 一定會輸出（沒有題組時每個清單是空陣列）；
    // 缺檔就讓檢查失敗。外層（清單清空）與三種難度 × 八個大題的清單各自宣告（同 chunked 的做法）：
    // 整份池子寫成一個字面值時，tsc 的錯誤訊息很難對到是哪一組。
    const poolTypes = path.join(srcDir, '..', MOCK_POOL_TYPE.module);
    const pool = /** @type {{ tiers?: Record<string, Record<string, unknown[]>> }} */ (read('bank/mock-pool.json'));
    const emptied = Object.fromEntries(
      Object.entries(pool.tiers ?? {}).map(([tier, sections]) => [tier, Object.fromEntries(Object.keys(sections).map((s) => [s, []]))]),
    );
    lines.push(`import type { ${MOCK_POOL_TYPE.name} } from ${JSON.stringify(poolTypes)};`);
    lines.push(`export const mockPool: ${MOCK_POOL_TYPE.name} = ${JSON.stringify({ ...pool, tiers: emptied })};`);
    let entries = 0;
    for (const [tier, sections] of Object.entries(pool.tiers ?? {})) {
      for (const [section, list] of Object.entries(sections)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        entries += list.length;
        const type = `${MOCK_POOL_TYPE.name}['tiers'][${JSON.stringify(tier)}][${JSON.stringify(section)}]`;
        lines.push(`export const mockPool_${ident(tier)}_${ident(section)}: ${type} = ${JSON.stringify(list)};`);
      }
    }
    summary.push(`自組模擬考的組卷池（${entries} 組）`);
  }
  if (parts.includes('paperSkills')) {
    // 加強卷的技能分布（docs/design/weak-paper.md §6.2）。build-data 一定會輸出（沒有題組時 groups 是空物件）；缺檔就讓檢查失敗。
    // 外層（groups 清空）與每 100 組各自宣告（同 chunked 的理由）。
    const types = path.join(srcDir, '..', PAPER_SKILLS_TYPE.module);
    const file = /** @type {{ groups?: Record<string, unknown> }} */ (read('bank/paper-skills.json'));
    const groups = Object.entries(file.groups ?? {});
    lines.push(`import type { ${PAPER_SKILLS_TYPE.name} } from ${JSON.stringify(types)};`);
    lines.push(`export const paperSkills: ${PAPER_SKILLS_TYPE.name} = ${JSON.stringify({ ...file, groups: {} })};`);
    for (let i = 0; i < groups.length; i += 100) {
      lines.push(`export const paperSkills_${i}: ${PAPER_SKILLS_TYPE.name}['groups'] = ${JSON.stringify(Object.fromEntries(groups.slice(i, i + 100)))};`);
    }
    summary.push(`加強卷的技能分布（${groups.length} 組）`);
  }
  if (parts.includes('sources')) {
    // 題目來源登記（docs/design/weak-paper.md §8.3）。build-data 一定會輸出（至少有本站題庫那一筆）；缺檔就讓檢查失敗。
    const types = path.join(srcDir, '..', SOURCES_TYPE.module);
    const file = /** @type {{ sources?: unknown[] }} */ (read('bank/sources.json'));
    lines.push(`import type { ${SOURCES_TYPE.name} } from ${JSON.stringify(types)};`);
    lines.push(`export const sourceRegistry: ${SOURCES_TYPE.name} = ${JSON.stringify(file)};`);
    summary.push(`題目來源登記（${(file.sources ?? []).length} 個來源）`);
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
