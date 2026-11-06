/**
 * 數學頁面測試用的迷你卷子（形狀同 /data/math/{id}.json）：單選、多選、選填、混合題組（單選＋非選擇題）各一。
 */
import type { MathIndex, MathPaper, MathSolutions } from '../../data/math';

const OPTS = { '1': '$1$', '2': '$2$', '3': '$3$', '4': '$4$', '5': '$5$' };

export const MINI_MATH: MathPaper = {
  schema: 'gsat-math-exam/v1',
  id: 'gsat-matha-115',
  exam: 'gsat',
  subject: 'math_a',
  era: '108課綱',
  year: 115,
  session: 'regular',
  title: '115學年度學科能力測驗數學A考科',
  time_minutes: 100,
  full_score: 26,
  verified: true,
  official_files: [{ subkind: 'paper', label: '試題', format: 'pdf', url: 'https://example.test/paper.pdf' }],
  scoring_rules: null,
  reference_formulas: ['$\\sqrt{2}\\approx 1.414$'],
  parts: [],
  sections: [
    {
      id: 's1', type: 'single', title: '一、單選題（占5分）', instructions: null, points_total: 5,
      groups: [{ id: 's1g1', group_label: null, stem: null, figures: [], tables: [], items: [
        { no: 1, label: '1', type: 'single', stem: '$1+1=$？', options: OPTS, answer: '2', points: 5, figures: [], tables: [], tags: { units: ['real_numbers'] }, stats: { P: 0.81 } },
      ] }],
    },
    {
      id: 's2', type: 'multi', title: '二、多選題（占5分）', instructions: null, points_total: 5,
      groups: [{ id: 's2g1', group_label: null, stem: null, figures: [], tables: [], items: [
        { no: 2, label: '2', type: 'multi', stem: '選出質數。', options: OPTS, answer: ['2', '3', '5'], points: 5, figures: [], tables: [], tags: { units: ['real_numbers'] } },
      ] }],
    },
    {
      id: 's3', type: 'fill', title: '三、選填題（占5分）', instructions: null, points_total: 5,
      groups: [{ id: 's3g1', group_label: null, stem: null, figures: [], tables: [{ caption: null, rows: [['$x$', '$y$'], ['1', '2']] }], items: [
        { no: 3, label: '3', type: 'fill', stem: '如下表 [[TABLE:1]] 則$\\frac{x}{y}=$[[FILL]]。', options: null, answer: null, points: 5, figures: [],
          tables: [{ caption: null, rows: [['$x$', '$y$'], ['$1$', '$2$']] }],
          fill: { cells: ['3-1', '3-2'], template: '\\frac{[[3-1]]}{[[3-2]]}', answer_cells: { '3-1': '1', '3-2': '2' }, answer_latex: '\\frac{1}{2}' },
          tags: { units: ['real_numbers'] } },
      ] }],
    },
    {
      id: 's4', type: 'mixed', title: '第貳部分、混合題或非選擇題（占11分）', instructions: null, points_total: 11,
      groups: [{ id: 's4g1', group_label: '4-5題為題組', stem: '已知$a=3$。', figures: [], tables: [], items: [
        { no: 4, label: '4', type: 'single', stem: '$a^2=$？（單選題，3分）', options: { '1': '$6$', '2': '$9$', '3': '$27$', '4': '$3$', '5': '$1$' }, answer: '2', points: 3, figures: [], tables: [], tags: { units: [] } },
        { no: 5, label: '5', type: 'constructed', stem: '求$a^3$。（非選擇題，8分）', options: null, answer: null, points: 8, constructed: { official_answer_stored: false, has_drawing: false }, figures: [], tables: [], tags: { units: [] } },
      ] }],
    },
  ],
};

export const MINI_MATH_INDEX: MathIndex = {
  version: 'test',
  count: 2,
  papers: [
    { id: 'gsat-matha-115', subject: 'math_a', era: '108課綱', year: 115, session: 'regular', title: MINI_MATH.title, time_minutes: 100, full_score: 26, question_count: 5, constructed_count: 1, auto_max: 18, manual_max: 8, has_stats: true, solution_count: 1, sections: [], units: {} },
    { id: 'gsat-mathb-115', subject: 'math_b', era: '108課綱', year: 115, session: 'regular', title: '115學年度學科能力測驗數學B考科', time_minutes: 100, full_score: 100, question_count: 20, constructed_count: 2, auto_max: 85, manual_max: 15, has_stats: false, solution_count: 0, sections: [], units: {} },
  ],
};

export const MINI_SOLUTIONS: MathSolutions = {
  version: 'test',
  id: 'gsat-matha-115',
  count: 1,
  items: { '1': { no: 1, unit: 'real_numbers', difficulty: '穩定基礎', solution_md: '**關鍵**：$1+1=2$。\n\n- 所以選 (2)', answer_display: '(2)', checked: true } },
};

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
