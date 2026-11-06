// @vitest-environment node
/**
 * 數學資料輸出（lib/math-data.mjs）的單元測試：在暫存目錄造一份小卷子，不讀 data/。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MathDataError, buildMathData, normalizeSolutions, paperEra } from './math-data.mjs';

let root = '';

function paper(over: Record<string, unknown> = {}) {
  return {
    schema: 'gsat-math-exam/v1',
    id: 'gsat-matha-115',
    exam: 'gsat',
    subject: 'math_a',
    year: 115,
    session: 'regular',
    title: '115學年度學科能力測驗數學A考科',
    time_minutes: 100,
    full_score: 11,
    sources: { paper: 'data/raw/p.pdf', answer: ['data/raw/a.pdf'], scoring_not_stored: ['data/raw/s.pdf'] },
    scoring_rules: { single: '…' },
    parts: [{ title: '第壹部分', points: 5, instructions: null, sections: ['s1'] }],
    sections: [
      {
        id: 's1',
        type: 'single',
        title: '一、單選題',
        instructions: null,
        points_total: 5,
        groups: [
          {
            id: 's1g1',
            group_label: null,
            stem: null,
            figures: [],
            tables: [],
            items: [
              {
                no: 1,
                label: '1',
                type: 'single',
                stem: '如圖，$x=$？',
                options: { '1': '1', '2': '2', '3': '3', '4': '4', '5': '5' },
                answer: '2',
                points: 5,
                tags: { units: ['functions'] },
                figures: [{ id: 'f1', kind: 'graph', alt: '一條直線的函數圖形示意', source: { page: 2, bbox_pt: [0, 0, 1, 1] }, file: 'data/exams/figures-math/gsat-matha-115/f1.png', width: 10, height: 10 }],
                tables: [],
              },
            ],
          },
        ],
      },
      {
        id: 's4',
        type: 'mixed',
        title: '第貳部分',
        instructions: null,
        points_total: 6,
        groups: [{ id: 's4g1', group_label: null, stem: null, figures: [], tables: [], items: [{ no: 2, label: '2', type: 'constructed', stem: '求$x$。', options: null, answer: null, points: 6, constructed: { official_answer_stored: false, has_drawing: false }, tags: { units: [] }, figures: [], tables: [] }] }],
      },
    ],
    reference_formulas: [],
    extraction: { method: 'x', corrections: [], issues: [], verified_by: 'visual-check' },
    ...over,
  };
}

function write(rel: string, value: unknown) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

function build() {
  return buildMathData({
    parsedDir: path.join(root, 'data/exams/parsed-math'),
    solutionsDir: path.join(root, 'data/exams/math-solutions'),
    manifestFile: path.join(root, 'data/exams/math-manifest.json'),
    repoRoot: root,
    relative: (f: string) => path.relative(root, f),
  });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'math-data-'));
  write('data/exams/figures-math/gsat-matha-115/f1.png', 'png');
  write('data/exams/math-manifest.json', {
    items: [
      { local_path: 'data/raw/p.pdf', subkind: 'paper', format: 'pdf', url: 'https://example.test/p.pdf' },
      { local_path: 'data/raw/a.pdf', subkind: 'answer', format: 'pdf', url: 'https://example.test/a.pdf' },
      { local_path: 'data/raw/s.pdf', subkind: 'scoring', format: 'pdf', url: 'https://example.test/s.pdf', republish: false },
    ],
  });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('buildMathData', () => {
  it('去掉 sources、extraction 與圖的 PDF 座標，圖改成 /data/ 下的網址並登記要複製的檔案', () => {
    write('data/exams/parsed-math/gsat-matha-115.json', paper());
    const out = build();
    expect(out.papers).toHaveLength(1);
    const d = out.papers[0] as Record<string, unknown>;
    expect(d).not.toHaveProperty('sources');
    expect(d).not.toHaveProperty('extraction');
    expect(d).toMatchObject({ era: '108課綱', verified: true });
    const fig = (d as { sections: { groups: { items: { figures: Record<string, unknown>[] }[] }[] }[] }).sections[0]?.groups[0]?.items[0]?.figures[0];
    expect(fig).toEqual({ id: 'f1', kind: 'graph', alt: '一條直線的函數圖形示意', width: 10, height: 10, file: 'math/figures/gsat-matha-115/f1.png' });
    expect([...out.assets.keys()]).toEqual(['math/figures/gsat-matha-115/f1.png']);
  });

  it('官方檔案只列試題與答案，不列評分原則（republish:false）', () => {
    write('data/exams/parsed-math/gsat-matha-115.json', paper());
    const d = build().papers[0] as { official_files: { subkind: string }[] };
    expect(d.official_files.map((f) => f.subkind)).toEqual(['paper', 'answer']);
  });

  it('摘要：自動批改滿分、非選擇題配分、單元統計；沒有詳解檔時詳解 0 題', () => {
    write('data/exams/parsed-math/gsat-matha-115.json', paper());
    const out = build();
    expect(out.summaries[0]).toMatchObject({ id: 'gsat-matha-115', era: '108課綱', question_count: 2, constructed_count: 1, auto_max: 5, manual_max: 6, solution_count: 0, units: { functions: 1 } });
    expect(out.solutions).toEqual([{ id: 'gsat-matha-115', count: 0, items: {} }]);
  });

  it('舊課綱卷子（subject math）標「舊課綱」，排在數A／數B 後面', () => {
    write('data/exams/parsed-math/gsat-matha-115.json', paper());
    write('data/exams/parsed-math/gsat-math-105.json', paper({ id: 'gsat-math-105', subject: 'math', year: 105 }));
    const out = build();
    expect(out.summaries.map((s) => [s.id, s.era])).toEqual([
      ['gsat-matha-115', '108課綱'],
      ['gsat-math-105', '舊課綱'],
    ]);
  });

  it('有不能公開的欄位（官方評分原則）時建置失敗', () => {
    const p = paper();
    (p.sections[1] as { groups: { items: Record<string, unknown>[] }[] }).groups[0]!.items[0]!['scoring_notes'] = '…';
    write('data/exams/parsed-math/gsat-matha-115.json', p);
    expect(() => build()).toThrow(MathDataError);
  });

  it('找不到圖檔時建置失敗', () => {
    write('data/exams/parsed-math/gsat-matha-115.json', paper());
    rmSync(path.join(root, 'data/exams/figures-math'), { recursive: true });
    expect(() => build()).toThrow(/找不到圖檔/);
  });

  it('有詳解檔時輸出公開欄位並計數', () => {
    write('data/exams/parsed-math/gsat-matha-115.json', paper());
    write('data/exams/math-solutions/gsat-matha-115.json', { items: [{ no: 1, unit: 'functions', difficulty: 'basic', solution_md: '因為 $x=2$。', answer_display: '(2)', check: { independent: 'pass', official_match: true }, flags: [] }] });
    const out = build();
    expect(out.summaries[0]?.solution_count).toBe(1);
    expect(out.solutions[0]?.items).toEqual({ '1': { no: 1, unit: 'functions', difficulty: 'basic', solution_md: '因為 $x=2$。', answer_display: '(2)', checked: true } });
  });
});

describe('normalizeSolutions', () => {
  const nos = new Set([1, 2, 13]);
  it('接受陣列、{ items: [...] }、{ items: { 題號: {...} } }', () => {
    expect(Object.keys(normalizeSolutions([{ no: 1, solution_md: 'a' }], nos, 'x').items)).toEqual(['1']);
    expect(Object.keys(normalizeSolutions({ items: [{ no: '13', solution_md: 'a' }] }, nos, 'x').items)).toEqual(['13']);
    expect(Object.keys(normalizeSolutions({ items: { '2': { solution_md: 'a' } } }, nos, 'x').items)).toEqual(['2']);
  });
  it('略過：題號不在卷子裡、沒有詳解、flags 標不發布、含機構名稱或「評分原則」', () => {
    const { items, skipped } = normalizeSolutions(
      [
        { no: 9, solution_md: 'a' },
        { no: 1, solution_md: '' },
        { no: 2, solution_md: 'a', flags: ['withhold'] },
        { no: 13, solution_md: '依評分原則…' },
      ],
      nos,
      'x',
    );
    expect(items).toEqual({});
    expect(skipped).toHaveLength(4);
  });
  it('check 的各種寫法', () => {
    const c = (check: unknown) => normalizeSolutions([{ no: 1, solution_md: 'a', check }], nos, 'x').items['1']?.checked;
    expect(c('pass')).toBe(true);
    expect(c({ status: 'pass' })).toBe(true);
    expect(c({ sympy: 'pass', official_match: true })).toBe(true);
    expect(c({ official_match: false })).toBe(false);
    expect(c(undefined)).toBe(false);
  });
  it('gsat-math-solutions/v1：difficulty 物件取 level、check.agree、物件 flags', () => {
    const v1 = (extra: Record<string, unknown>) => ({
      no: 1,
      unit: '機率（條件機率）',
      difficulty: { level: '進階練習', official_p: 0.42, basis: '官方答對率' },
      solution_md: '**解題關鍵**：…',
      answer_display: '(2)',
      check: { official: '2', solver_a: '2', solver_b: '2', agree: true },
      flags: [],
      ...extra,
    });
    const ok = normalizeSolutions({ schema: 'gsat-math-solutions/v1', items: [v1({})] }, nos, 'x').items['1'];
    expect(ok).toEqual({ no: 1, unit: '機率（條件機率）', difficulty: '進階練習', solution_md: '**解題關鍵**：…', answer_display: '(2)', checked: true });
    // 解題者 B 不一致、已複核（resolved）且 A 的答案等於官方：照常發布、算驗算通過。
    const resolved = v1({ check: { official: '2', solver_a: '2', solver_b: '3', agree: false }, flags: [{ severity: 'resolved', detail: '複核後官方正確' }] });
    expect(normalizeSolutions([resolved], nos, 'x').items['1']?.checked).toBe(true);
    // A 的最終答案和官方不同：不算通過。
    const wrongA = v1({ check: { official: '2', solver_a: '3', solver_b: '2', agree: false }, flags: [{ severity: 'resolved', detail: '…' }] });
    expect(normalizeSolutions([wrongA], nos, 'x').items['1']?.checked).toBe(false);
    // 待站主裁決（owner_review）的題目不發布。
    const pending = normalizeSolutions([v1({ flags: [{ severity: 'owner_review', detail: '待決' }] })], nos, 'x');
    expect(pending.items).toEqual({});
    expect(pending.skipped[0]).toMatch(/owner_review/);
  });
  it('格式不對時丟錯', () => {
    expect(() => normalizeSolutions('x', nos, 'x')).toThrow(MathDataError);
  });
});

describe('paperEra', () => {
  it('依 era 或 subject', () => {
    expect(paperEra({ subject: 'math_b' })).toBe('108課綱');
    expect(paperEra({ subject: 'math' })).toBe('舊課綱');
    expect(paperEra({ subject: 'math_a', era: '舊課綱' })).toBe('舊課綱');
  });
});
