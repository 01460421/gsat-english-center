/**
 * 數學批改與文字切分的單元測試（docs/design/math.md §5：全未答、全選、k＝3 時為 0 等邊界）。
 */
import { describe, expect, it } from 'vitest';
import {
  FILL_CELL_VALUES,
  choiceAnswerText,
  fillCellDisplay,
  fillTemplateLatex,
  gradeFill,
  gradeMathItem,
  gradeMulti,
  gradeSingle,
  isFillCellValue,
  isMathAnswered,
  mathEraOf,
  parseFillTemplate,
  referencedTables,
  scoreMathPaper,
  splitMathStem,
  type MathItem,
  type MathPaperBase,
} from './math-exam';

function item(over: Partial<MathItem>): MathItem {
  return { no: 1, label: '1', type: 'single', stem: '', options: null, answer: null, points: 5, figures: [], tables: [], tags: { units: [] }, ...over };
}

const OPTS = { '1': 'a', '2': 'b', '3': 'c', '4': 'd', '5': 'e' };

describe('gradeSingle', () => {
  const q = item({ type: 'single', options: OPTS, answer: '3' });
  it('答對得全分、答錯 0、未答 0', () => {
    expect(gradeSingle(q, '3')).toMatchObject({ earned: 5, status: 'correct' });
    expect(gradeSingle(q, '2')).toMatchObject({ earned: 0, status: 'wrong' });
    expect(gradeSingle(q, undefined)).toMatchObject({ earned: 0, status: 'unanswered' });
    expect(gradeSingle(q, '')).toMatchObject({ earned: 0, status: 'unanswered' });
  });
  it('劃記多於一個以零分計', () => {
    expect(gradeSingle(q, ['3', '4'])).toMatchObject({ earned: 0, status: 'wrong' });
  });
});

describe('gradeMulti（n − 2k）/ n', () => {
  const q = item({ type: 'multi', options: OPTS, answer: ['2', '4'] });
  it('全對 5 分', () => {
    expect(gradeMulti(q, ['2', '4'])).toMatchObject({ earned: 5, status: 'correct', wrong: 0 });
  });
  it('錯 1 個（少選）得 3 分', () => {
    expect(gradeMulti(q, ['2'])).toMatchObject({ earned: 3, status: 'partial', wrong: 1 });
  });
  it('錯 1 個（多選）得 3 分', () => {
    expect(gradeMulti(q, ['2', '4', '5'])).toMatchObject({ earned: 3, status: 'partial', wrong: 1 });
  });
  it('錯 2 個得 1 分', () => {
    expect(gradeMulti(q, ['2', '5'])).toMatchObject({ earned: 1, status: 'partial', wrong: 2 });
  });
  it('錯 3 個得 0 分（不倒扣）', () => {
    expect(gradeMulti(q, ['1', '3', '4'])).toMatchObject({ earned: 0, status: 'wrong', wrong: 3 });
  });
  it('全選：錯 3 個，0 分', () => {
    expect(gradeMulti(q, ['1', '2', '3', '4', '5'])).toMatchObject({ earned: 0, wrong: 3 });
  });
  it('全未作答 0 分，算未作答（不是錯 2 個得 1 分）', () => {
    expect(gradeMulti(q, [])).toMatchObject({ earned: 0, status: 'unanswered' });
    expect(gradeMulti(q, undefined)).toMatchObject({ earned: 0, status: 'unanswered' });
  });
  it('3 分題（混合題組）與 4 個選項時照比例並四捨五入到兩位', () => {
    expect(gradeMulti(item({ type: 'multi', options: OPTS, answer: ['1'], points: 3 }), ['1', '2']).earned).toBe(1.8);
    const four = item({ type: 'multi', options: { '1': 'a', '2': 'b', '3': 'c', '4': 'd' }, answer: ['1', '2'], points: 4 });
    expect(gradeMulti(four, ['1']).earned).toBe(2);
    expect(gradeMulti(four, ['1', '3']).earned).toBe(0);
  });
  it('不在選項裡的值忽略', () => {
    expect(gradeMulti(q, ['2', '4', '9'])).toMatchObject({ earned: 5 });
  });
});

describe('gradeFill（每格全對才給分）', () => {
  const q = item({
    type: 'fill',
    fill: { cells: ['13-1', '13-2', '13-3'], template: '\\frac{[[13-1]]}{[[13-2]][[13-3]]}', answer_cells: { '13-1': '9', '13-2': '1', '13-3': '0' }, answer_latex: '\\frac{9}{10}' },
  });
  it('全對得全分', () => {
    expect(gradeFill(q, ['9', '1', '0'])).toMatchObject({ earned: 5, status: 'correct', wrong: 0 });
  });
  it('錯一格 0 分，不倒扣', () => {
    expect(gradeFill(q, ['9', '1', '1'])).toMatchObject({ earned: 0, status: 'wrong', wrong: 1 });
  });
  it('漏一格算錯', () => {
    expect(gradeFill(q, ['9', '1', ''])).toMatchObject({ earned: 0, status: 'wrong', wrong: 1 });
    expect(gradeFill(q, ['9', '1'])).toMatchObject({ earned: 0, status: 'wrong' });
  });
  it('每一格都沒劃記算未作答', () => {
    expect(gradeFill(q, ['', '', ''])).toMatchObject({ earned: 0, status: 'unanswered' });
    expect(gradeFill(q, undefined)).toMatchObject({ status: 'unanswered' });
  });
  it('負號與 ± 也要逐格相同', () => {
    const neg = item({ type: 'fill', fill: { cells: ['16-1', '16-2'], template: '[[16-1]][[16-2]]', answer_cells: { '16-1': '-', '16-2': '6' }, answer_latex: '-6' } });
    expect(gradeFill(neg, ['-', '6']).earned).toBe(5);
    expect(gradeFill(neg, ['±', '6']).earned).toBe(0);
  });
});

describe('gradeMathItem／isMathAnswered', () => {
  it('非選擇題不自動給分', () => {
    const q = item({ type: 'constructed', points: 6, constructed: { official_answer_stored: false, has_drawing: false } });
    expect(gradeMathItem(q, undefined)).toEqual({ kind: 'manual', max: 6 });
    expect(isMathAnswered(q, 'x')).toBe(false);
  });
  it('選填劃了至少一格就算作答', () => {
    expect(isMathAnswered({ type: 'fill' }, ['', '3'])).toBe(true);
    expect(isMathAnswered({ type: 'fill' }, ['', ''])).toBe(false);
    expect(isMathAnswered({ type: 'multi' }, [])).toBe(false);
  });
});

describe('scoreMathPaper', () => {
  const paper: Pick<MathPaperBase, 'sections'> = {
    sections: [
      { id: 's1', type: 'single', title: '單選', instructions: null, points_total: 10, groups: [{ id: 'g1', group_label: null, stem: null, figures: [], tables: [], items: [item({ label: '1', options: OPTS, answer: '1' }), item({ label: '2', options: OPTS, answer: '2' })] }] },
      { id: 's2', type: 'multi', title: '多選', instructions: null, points_total: 5, groups: [{ id: 'g2', group_label: null, stem: null, figures: [], tables: [], items: [item({ label: '3', type: 'multi', options: OPTS, answer: ['1', '2'] })] }] },
      {
        id: 's4', type: 'mixed', title: '混合', instructions: null, points_total: 9,
        groups: [{ id: 'g4', group_label: '4-5', stem: '…', figures: [], tables: [], items: [item({ label: '4', options: OPTS, answer: '5', points: 3 }), item({ label: '5', type: 'constructed', points: 6 })] }],
      },
    ],
  };
  it('合計自動批改分數、非選擇題配分與答對題數', () => {
    const s = scoreMathPaper(paper, { '1': '1', '2': '3', '3': ['1'], '4': '5' });
    expect(s).toMatchObject({ earned: 11, autoMax: 18, manualMax: 6, correctCount: 2, autoCount: 4, answeredCount: 4 });
    expect(s.sections.map((x) => [x.sectionId, x.earned, x.autoMax, x.manualMax])).toEqual([
      ['s1', 5, 10, 0],
      ['s2', 3, 5, 0],
      ['s4', 3, 3, 6],
    ]);
    expect(s.items['3']).toMatchObject({ status: 'partial', earned: 3 });
  });
});

describe('題幹與 template 切分', () => {
  it('splitMathStem 切出 [[FILL]] 與 [[TABLE:k]]', () => {
    expect(splitMathStem('已知$x$如下：[[TABLE:1]]則$y=$[[FILL]]。')).toEqual([
      { kind: 'text', text: '已知$x$如下：' },
      { kind: 'table', index: 1 },
      { kind: 'text', text: '則$y=$' },
      { kind: 'fill' },
      { kind: 'text', text: '。' },
    ]);
    expect(referencedTables('a[[TABLE:2]]b[[TABLE:1]]')).toEqual(new Set([1, 2]));
  });
  it('parseFillTemplate／fillTemplateLatex', () => {
    expect(parseFillTemplate('[[16-1]]\\sqrt{[[16-2]]}')).toEqual([
      { kind: 'cell', id: '16-1' },
      { kind: 'tex', tex: '\\sqrt{' },
      { kind: 'cell', id: '16-2' },
      { kind: 'tex', tex: '}' },
    ]);
    expect(fillTemplateLatex('\\frac{[[13-1]]}{[[13-2]]}', (id) => (id === '13-1' ? '7' : '3'))).toBe('\\frac{{7}}{{3}}');
  });
  it('格值只有 12 種，負號顯示成 −', () => {
    expect(FILL_CELL_VALUES).toHaveLength(12);
    expect(isFillCellValue('-')).toBe(true);
    expect(isFillCellValue('−')).toBe(false);
    expect(fillCellDisplay('-')).toBe('−');
  });
  it('choiceAnswerText', () => {
    expect(choiceAnswerText({ type: 'single', answer: '3' })).toBe('(3)');
    expect(choiceAnswerText({ type: 'multi', answer: ['1', '5'] })).toBe('(1)(5)');
    expect(choiceAnswerText({ type: 'fill', answer: null })).toBeNull();
  });
});

describe('mathEraOf', () => {
  it('數A／數B 是 108 課綱；舊課綱學測數學（math）是舊課綱；資料明寫 era 時用資料的', () => {
    expect(mathEraOf({ subject: 'math_a' })).toBe('108課綱');
    expect(mathEraOf({ subject: 'math_b' })).toBe('108課綱');
    expect(mathEraOf({ subject: 'math' })).toBe('舊課綱');
    expect(mathEraOf({ subject: 'math_a', era: '舊課綱' })).toBe('舊課綱');
    expect(mathEraOf({ subject: 'math', era: 'x' })).toBe('舊課綱');
  });
});
