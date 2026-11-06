/**
 * 用實際的 data/exams/parsed-math/*.json 檢查 math-exam.ts 的型別與批改程式「說實話」（gsat-math-exam/v1）。
 * 完整的資料品質檢查（配分加總、KaTeX 排版、圖檔）由 tools/validate_math_exam.py 負責；這裡確保 TypeScript 端
 * 可以安全地把這些檔案當成 MathPaperBase 使用，而且官方答案用自己的批改程式算出來是滿分。
 *
 * 另外檢查本站詳解（data/exams/math-solutions/{id}.json）：另一條流程正在產生，目錄不存在時略過。
 *
 * 這是 vitest 的 data 專案（`npm run test:data`）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MATH_ITEM_TYPES,
  MATH_SECTION_TYPES,
  MATH_SUBJECTS,
  MATH_UNITS,
  fillCellLabel,
  isFillCellValue,
  mathCorrectRate,
  mathEraOf,
  iterateMathItems,
  parseFillTemplate,
  referencedTables,
  scoreMathPaper,
  splitMathStem,
  type MathAnswer,
  type MathPaperBase,
} from './math-exam';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data', 'exams');
const PARSED_DIR = join(DATA, 'parsed-math');
const SOLUTIONS_DIR = join(DATA, 'math-solutions');

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
}

const files = jsonFiles(PARSED_DIR);

describe.skipIf(files.length === 0)('data/exams/parsed-math', () => {
  it.each(files)('%s 符合型別、標記與答案形狀', (name) => {
    const paper = JSON.parse(readFileSync(join(PARSED_DIR, name), 'utf8')) as MathPaperBase & { schema: string };
    expect(paper.schema).toBe('gsat-math-exam/v1');
    expect(`${paper.id}.json`).toBe(name);
    expect(MATH_SUBJECTS).toContain(paper.subject);
    expect(Number.isInteger(paper.year)).toBe(true);
    // 課綱：資料明寫 era，而且和考科一致（舊課綱＝subject math）。
    expect(paper.era).toBe(paper.subject === 'math' ? '舊課綱' : '108課綱');
    expect(mathEraOf(paper)).toBe(paper.era);
    for (const section of paper.sections) {
      expect(MATH_SECTION_TYPES).toContain(section.type);
      for (const group of section.groups) {
        if (group.stem !== null) expect(splitMathStem(group.stem).some((t) => t.kind === 'fill')).toBe(false);
        for (const fig of group.figures) expect(fig.alt.length).toBeGreaterThanOrEqual(8);
      }
    }
    for (const { item } of iterateMathItems(paper)) {
      const at = `${paper.id} 第 ${item.label} 題`;
      expect(MATH_ITEM_TYPES, at).toContain(item.type);
      expect(item.points, at).toBeGreaterThan(0);
      for (const u of item.tags.units) expect(MATH_UNITS, at).toContain(u);
      const fills = splitMathStem(item.stem).filter((t) => t.kind === 'fill').length;
      expect(fills, at).toBe(item.type === 'fill' ? 1 : 0);
      for (const k of referencedTables(item.stem)) expect(k, at).toBeLessThanOrEqual(item.tables.length);
      switch (item.type) {
        case 'single':
          expect(typeof item.answer, at).toBe('string');
          expect(Object.keys(item.options ?? {}), at).toContain(item.answer);
          break;
        case 'multi':
          expect(Array.isArray(item.answer), at).toBe(true);
          for (const a of item.answer as string[]) expect(Object.keys(item.options ?? {}), at).toContain(a);
          break;
        case 'fill': {
          const fill = item.fill;
          expect(fill, at).toBeDefined();
          if (!fill) break;
          const cells = parseFillTemplate(fill.template).flatMap((t) => (t.kind === 'cell' ? [t.id] : []));
          expect(cells, at).toEqual(fill.cells);
          for (const id of fill.cells) expect(isFillCellValue(fill.answer_cells[id]), `${at} ${id}`).toBe(true);
          if (paper.era === '舊課綱') {
            // 舊課綱的格子用題本列號的圈號標示（⑭），每一格都要換得出圈號。
            expect(fill.official_cells?.length, at).toBe(fill.cells.length);
            for (const id of fill.cells) expect(fillCellLabel(fill, id), `${at} ${id}`).toMatch(/^[\u2460-\u2473\u3251-\u325f\u32b1-\u32bf]$/u);
          } else expect(fill.official_cells, at).toBeUndefined();
          break;
        }
        case 'constructed':
          expect(item.answer, at).toBeNull();
          expect(item.constructed?.official_answer_stored, at).toBe(false);
          break;
      }
      // 官方統計：選擇（填）題都有答對率（0–1），非選擇題沒有（官方表不列）。
      if (item.type === 'constructed') expect(item.stats, at).toBeUndefined();
      else {
        const p = mathCorrectRate(item);
        expect(p, at).not.toBeNull();
        expect(p ?? -1, at).toBeGreaterThanOrEqual(0);
        expect(p ?? 2, at).toBeLessThanOrEqual(1);
      }
      // 不收錄官方的非選擇題參考答案與評分原則（D8）。
      for (const banned of ['scoring_notes', 'reference_answer', 'rubric']) expect(Object.hasOwn(item, banned), at).toBe(false);
    }
  });

  it.each(files)('%s 以官方答案作答：自動批改得滿分，滿分＋非選擇題配分＝卷面滿分', (name) => {
    const paper = JSON.parse(readFileSync(join(PARSED_DIR, name), 'utf8')) as MathPaperBase;
    const answers: Record<string, MathAnswer> = {};
    for (const { item } of iterateMathItems(paper)) {
      if (item.type === 'fill' && item.fill) answers[item.label] = item.fill.cells.map((c) => item.fill?.answer_cells[c] ?? '');
      else if (item.answer !== null) answers[item.label] = item.answer;
    }
    const score = scoreMathPaper(paper, answers);
    expect(score.earned).toBe(score.autoMax);
    expect(score.autoMax + score.manualMax).toBe(paper.full_score);
  });
});

const solutionFiles = jsonFiles(SOLUTIONS_DIR);

describe.skipIf(solutionFiles.length === 0)('data/exams/math-solutions（本站詳解）', () => {
  it.each(solutionFiles)('%s 對得上考卷題號，詳解是非空字串', (name) => {
    const paperFile = join(PARSED_DIR, name);
    expect(existsSync(paperFile), `${name} 沒有對應的考卷`).toBe(true);
    const paper = JSON.parse(readFileSync(paperFile, 'utf8')) as MathPaperBase;
    const nos = new Set([...iterateMathItems(paper)].map((r) => r.item.no));
    const raw = JSON.parse(readFileSync(join(SOLUTIONS_DIR, name), 'utf8')) as unknown;
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : Object.values((raw as { items?: object }).items ?? {});
    for (const entry of list as Record<string, unknown>[]) {
      expect(nos.has(Number(entry['no'])), `${name} 題號 ${String(entry['no'])}`).toBe(true);
      if (entry['solution_md'] !== undefined) expect(typeof entry['solution_md']).toBe('string');
    }
  });
});
