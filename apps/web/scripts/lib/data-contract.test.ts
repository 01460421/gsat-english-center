// @vitest-environment node
/**
 * 資料契約檢查（lib/data-contract.mjs，check-data-contract.mjs 的核心）：
 *   - 題庫：範例題庫的建置輸出（tests/fixtures/bank-public，和 bank-data.test.ts 的 golden 同一份）要符合 src/data/bank.ts 的型別；
 *     欄位值不在型別允許的範圍（難度拼錯、還沒有練習介面的題型、圖表類型拼錯、多了型別沒有的欄位）時 tsc 要失敗。
 *   - 級分對照（exams 部分的 exams/score-scales.json）：lib/score-scales.mjs 由測試用的 gsat-spec 產生的輸出要符合
 *     src/data/scoreScales.ts 的型別，而且不能被當成考卷（Exam）檢查。
 * 不必先跑完整的 build:data（單字與歷屆試題本身由 npm run check:data 檢查實際建置結果）。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { contractSource, runContractCheck, type ContractPart } from './data-contract.mjs';
import { specFixture } from './score-scales.fixture';
import { buildScoreScales } from './score-scales.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GOLDEN = path.join(WEB_DIR, 'tests', 'fixtures', 'bank-public');
const WRITING_GOLDEN = path.join(WEB_DIR, 'tests', 'fixtures', 'bank-writing-public');
const SRC = path.join(WEB_DIR, 'src', 'data');

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function check(dataDir: string, name: string, parts: readonly ContractPart[] = ['bank']) {
  const workDir = path.join(WEB_DIR, 'node_modules', '.cache', `data-contract-test-${name}-${process.pid}`);
  cleanup.push(workDir);
  const { source, summary } = contractSource({ dataDir, srcDir: SRC, parts });
  return { ...runContractCheck({ webDir: WEB_DIR, workDir, source }), summary };
}

function goldenCopy(change: (dir: string) => void): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gsat-contract-'));
  cleanup.push(dir);
  cpSync(GOLDEN, dir, { recursive: true });
  change(dir);
  return dir;
}

function editJson(file: string, edit: (d: Record<string, unknown>) => void): void {
  const d = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  edit(d);
  writeFileSync(file, JSON.stringify(d));
}

describe('題庫輸出的型別契約', () => {
  it('範例輸出符合 src/data/bank.ts', () => {
    const result = check(GOLDEN, 'ok');
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual(['題庫索引', '6 個 AI 題組']);
  }, 60_000);

  it('沒有任何題組（空的 index、沒有 groups 目錄）也符合', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gsat-contract-'));
    cleanup.push(dir);
    mkdirSync(path.join(dir, 'bank'));
    writeFileSync(path.join(dir, 'bank', 'index.json'), JSON.stringify({ version: 'x', count: 0, groups: [] }));
    const result = check(dir, 'empty');
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual(['題庫索引', '0 個 AI 題組']);
  }, 60_000);

  it('不合型別的值會讓 tsc 失敗', () => {
    const dir = goldenCopy((d) => {
      editJson(path.join(d, 'bank', 'index.json'), (index) => {
        const groups = index['groups'] as Record<string, unknown>[];
        if (groups[0]) groups[0]['tier'] = 'expert';
      });
      editJson(path.join(d, 'bank', 'groups', 'ai.wb.0a1b2c@1.json'), (g) => {
        g['section_type'] = 'translation';
      });
      // 圖表類型拼錯（ChartSpec 的 type 只有 bar／line／stacked_bar／pie）。
      editJson(path.join(d, 'bank', 'groups', 'ai.rd.0c1d2e@1.json'), (g) => {
        const figures = (g['group'] as Record<string, unknown>)['figures'] as Record<string, Record<string, unknown>>[];
        const chart = figures[0]?.['chart'];
        if (chart) chart['type'] = 'scatter';
      });
      // 多了型別沒有的欄位（例如不該公開的生成紀錄）也要擋。
      editJson(path.join(d, 'bank', 'groups', 'ai.cz.2b3c4d@1.json'), (g) => {
        g['generation'] = { model: 'x' };
      });
    });
    const result = check(dir, 'bad');
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/"expert"/);
    expect(result.output).toMatch(/"translation"/);
    expect(result.output).toMatch(/"scatter"/);
    expect(result.output).toMatch(/generation/);
  }, 60_000);
});

describe('級分對照（exams/score-scales.json）的型別契約', () => {
  /** 只有空的試題索引與級分對照的 exams/ 目錄（和 build-data 輸出的形狀相同）。 */
  function examsDir(edit?: (scales: Record<string, unknown>) => void): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'gsat-contract-'));
    cleanup.push(dir);
    mkdirSync(path.join(dir, 'exams'));
    writeFileSync(path.join(dir, 'exams', 'index.json'), JSON.stringify({ version: 'x', count: 0, exams: [] }));
    const scales = { version: 'x', ...buildScoreScales(specFixture()) } as Record<string, unknown>;
    edit?.(scales);
    writeFileSync(path.join(dir, 'exams', 'score-scales.json'), JSON.stringify(scales));
    return dir;
  }

  it('build-data 的輸出符合 src/data/scoreScales.ts，且不被當成考卷', () => {
    const result = check(examsDir(), 'scales-ok', ['exams']);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual(['試題索引', '0 份考卷', '級分對照']);
  }, 60_000);

  it('不合型別的值會讓 tsc 失敗', () => {
    const dir = examsDir((scales) => {
      const years = scales['years'] as Record<string, unknown>[];
      const standards = years[0]?.['five_standards'] as Record<string, unknown>[] | undefined;
      if (standards?.[0]) standards[0]['name'] = '高標';
      scales['subject'] = 'math';
    });
    const result = check(dir, 'scales-bad', ['exams']);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/"高標"/);
    expect(result.output).toMatch(/"math"/);
  }, 60_000);
});

describe('本站仿真寫作題（writing/bank/）的型別契約', () => {
  it('範例輸出（tests/fixtures/bank-writing-public）符合 src/features/writing/bank/data.ts', () => {
    const result = check(WRITING_GOLDEN, 'writing-ok', ['writingBank']);
    expect(result.output).toBe('');
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual(['本站仿真寫作題的索引', '6 個難度列表', '2 個題目檔', '2 個參考內容檔']);
  }, 60_000);

  it('不合型別的值、作答前的檔案多了答案欄位、中譯英檔帶作文欄位都會讓 tsc 失敗', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gsat-contract-'));
    cleanup.push(dir);
    cpSync(WRITING_GOLDEN, dir, { recursive: true });
    const bank = path.join(dir, 'writing', 'bank');
    editJson(path.join(bank, 'index.json'), (index) => {
      const groups = index['groups'] as Record<string, unknown>[];
      if (groups[0]) groups[0]['tier'] = 'expert';
    });
    editJson(path.join(bank, 'prompts', 'ai.tr.0b1c2d@1.json'), (p) => {
      ((p['items'] as Record<string, unknown>[])[0] as Record<string, unknown>)['references'] = ['leak'];
    });
    editJson(path.join(bank, 'list', 'translation-basic.json'), (l) => {
      ((l['groups'] as Record<string, unknown>[])[0] as Record<string, unknown>)['figure_count'] = 1;
    });
    editJson(path.join(bank, 'answers', 'ai.cp.0e1f2a@1.json'), (a) => {
      a['verification'] = [];
    });
    const result = check(dir, 'writing-bad', ['writingBank']);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/"expert"/);
    expect(result.output).toMatch(/references/);
    expect(result.output).toMatch(/figure_count/);
    expect(result.output).toMatch(/verification/);
  }, 60_000);
});
