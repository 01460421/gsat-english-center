/**
 * AnalysisView 的全國統計（docs/design/learning-assistant.md §10「審查修正（後端與 shared）」）：
 * 多選題的官方數字是得分率（含部分給分），標「全國得分率」，有 full_correct_rate 時另外列「全對比例」；
 * 單選題照舊是「全國答對率」與選了這個選項的比例。
 */
import type { AssistAnalysisView, AssistItemAnalysis, AssistQuestionStats } from '@gsat/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalysisView, StatsLine, questionModesOf } from './AnalysisView';

function stats(overrides: Partial<AssistQuestionStats> = {}): AssistQuestionStats {
  return { correct_rate: 0.42, option_rates: null, high: null, low: null, five_groups: null, ...overrides };
}

function item(overrides: Partial<AssistItemAnalysis> = {}): AssistItemAnalysis {
  return {
    label: '31',
    display_label: '31',
    verdict: 'wrong',
    verdict_basis: 'program',
    answer_key: { from: 'site', accepted: ['B'] },
    student_answer: 'C',
    stats: stats(),
    diagnosis: { error_codes: [], summary_zh: '看錯了關鍵句。', detail_zh: '' },
    option_contrast_zh: '',
    hints_zh: [],
    solution_steps: [],
    traps: [],
    ...overrides,
  };
}

function analysis(items: AssistItemAnalysis[]): AssistAnalysisView {
  return {
    kind: 'item',
    section: 'reading',
    skill_codes: [],
    tested_zh: '細節理解。',
    structure_zh: '',
    items,
    knowledge: [],
    method: { title_zh: '', steps_zh: [] },
    score_tips_zh: [],
    doubt_replies: [],
    practice_focus: null,
    followup_chips_zh: [],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    notices: [],
    cache_hit: false,
  };
}

describe('AnalysisView 的全國統計', () => {
  it('單選題：全國答對率＋選了這個選項的比例', () => {
    render(<StatsLine item={item({ stats: stats({ option_rates: { A: 0.1, B: 0.42, C: 0.35, D: 0.13 } }) })} mode="single_choice" />);
    expect(screen.getByText(/全國答對率/)).toHaveTextContent('全國答對率 42%；全國 35% 選了 (C)（官方統計）');
    expect(screen.queryByText(/得分率|全對比例/)).not.toBeInTheDocument();
  });

  it('多選題有 full_correct_rate：標「全國得分率」（含部分給分），另外列「全對比例」', () => {
    render(<StatsLine item={item({ student_answer: ['A', 'C'], stats: stats({ correct_rate: 0.58, full_correct_rate: 0.21 }) })} mode="multi_select" />);
    expect(screen.getByText(/全國得分率/)).toHaveTextContent('全國得分率 58%（含部分給分）；全對比例 21%（官方統計）');
    expect(screen.queryByText(/全國答對率/)).not.toBeInTheDocument();
  });

  it('多選題沒有 full_correct_rate（舊的案例）：只有得分率，不寫全對比例', () => {
    render(<StatsLine item={item({ student_answer: ['A'], stats: stats({ correct_rate: 0.5 }) })} mode="multi_select" />);
    expect(screen.getByText(/全國得分率/)).toHaveTextContent('全國得分率 50%（含部分給分）（官方統計）');
    expect(screen.queryByText(/全對比例/)).not.toBeInTheDocument();
  });

  it('不知道題型時：有 full_correct_rate 或作答是陣列就當多選題；沒有統計時不顯示', () => {
    const { rerender, container } = render(<StatsLine item={item({ student_answer: null, stats: stats({ full_correct_rate: 0.3 }) })} />);
    expect(container).toHaveTextContent('全國得分率 42%（含部分給分）；全對比例 30%（官方統計）');
    rerender(<StatsLine item={item({ student_answer: ['B', 'D'] })} />);
    expect(container).toHaveTextContent('全國得分率 42%（含部分給分）（官方統計）');
    rerender(<StatsLine item={item()} />);
    expect(container).toHaveTextContent('全國答對率 42%（官方統計）');
    rerender(<StatsLine item={item({ stats: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('整個解析畫面：題型依案例的題目（questionModesOf），同一組的單選與多選各自標示', () => {
    const modes = questionModesOf({
      targets: [
        { label: '31', mode: 'single_choice' },
        { label: '32', mode: 'multi_select' },
      ] as never,
    });
    expect(modes).toEqual({ '31': 'single_choice', '32': 'multi_select' });
    render(
      <AnalysisView
        analysis={analysis([
          item(),
          item({ label: '32', display_label: '32', student_answer: ['A', 'B'], stats: stats({ correct_rate: 0.61, full_correct_rate: 0.24 }) }),
        ])}
        hintFirst={false}
        sourceNote={null}
        modes={modes}
      />,
    );
    expect(screen.getByText(/全國答對率/)).toHaveTextContent('全國答對率 42%（官方統計）');
    expect(screen.getByText(/全國得分率/)).toHaveTextContent('全國得分率 61%（含部分給分）；全對比例 24%（官方統計）');
    expect(questionModesOf(null)).toEqual({});
  });
});
