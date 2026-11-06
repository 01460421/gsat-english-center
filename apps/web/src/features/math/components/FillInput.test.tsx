/**
 * 選填題的仿答題卷作答（FillInput）：點選劃記、鍵盤直接輸入數字／減號並跳到下一格、Backspace 清除、批改後的對錯標示。
 */
import type { MathFill } from '@gsat/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareMathDom } from '../testSetup';
import { FillInput, fillAnswerLatex, fillFormatLatex } from './FillInput';

const FILL: MathFill = {
  cells: ['16-1', '16-2', '16-3'],
  template: '\\frac{[[16-1]]\\sqrt{[[16-2]]}}{[[16-3]]}',
  answer_cells: { '16-1': '-', '16-2': '3', '16-3': '2' },
  answer_latex: '\\frac{-\\sqrt{3}}{2}',
};

beforeAll(prepareMathDom);

function Harness({ initial = [], disabled = false, showFeedback = false, onChange }: { initial?: string[]; disabled?: boolean; showFeedback?: boolean; onChange?: (v: string[]) => void }) {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <FillInput
      label="16"
      fill={FILL}
      values={values}
      onChange={(v) => {
        setValues(v);
        onChange?.(v);
      }}
      disabled={disabled}
      showFeedback={showFeedback}
    />
  );
}

async function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />);
  return screen.findAllByRole('group', {}, { timeout: 5000 });
}

describe('fillFormatLatex／fillAnswerLatex', () => {
  it('作答格式：每一格是標了格號的方框', () => {
    expect(fillFormatLatex(FILL)).toContain('\\boxed{\\scriptstyle\\text{16-2}}');
  });
  it('你的答案：劃了的放值（負號、±），沒劃的放空方框', () => {
    expect(fillAnswerLatex(FILL, ['-', '', '2'])).toBe('\\frac{{-}\\sqrt{{\\boxed{\\phantom{0}}}}}{{2}}');
    expect(fillAnswerLatex({ ...FILL, template: '[[16-1]]' }, ['±'])).toBe('{\\pm}');
  });
});

describe('FillInput', () => {
  it('每一格一列 12 個劃記（1–9、0、負號、正負號），無障礙名稱說明目前的值', async () => {
    const rows = await renderHarness();
    expect(rows).toHaveLength(3);
    const first = rows[0]!;
    expect(within(first).getAllByRole('radio')).toHaveLength(12);
    expect(first).toHaveAccessibleName('第 16 題第 16-1 格，尚未劃記');
    expect(within(first).getByRole('radio', { name: '負號' })).toBeInTheDocument();
    expect(within(first).getByRole('radio', { name: '正負號' })).toBeInTheDocument();
  });

  it('點選劃記：回傳和格子等長的陣列，空格是空字串；「清除」把這一格清掉', async () => {
    const onChange = vi.fn();
    const rows = await renderHarness({ onChange });
    await userEvent.click(within(rows[1]!).getByRole('radio', { name: '3' }));
    expect(onChange).toHaveBeenLastCalledWith(['', '3', '']);
    expect(rows[1]).toHaveAccessibleName('第 16 題第 16-2 格，目前 3');
    await userEvent.click(screen.getByRole('button', { name: '清除第 16-2 格' }));
    expect(onChange).toHaveBeenLastCalledWith(['', '', '']);
  });

  it('焦點在某一列時按減號或數字就劃記並跳到下一列；Backspace 清除', async () => {
    const onChange = vi.fn();
    const rows = await renderHarness({ onChange });
    const firstRadio = within(rows[0]!).getAllByRole('radio')[0]!;
    firstRadio.focus();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
    fireEvent.keyDown(firstRadio, { key: '-' });
    expect(onChange).toHaveBeenLastCalledWith(['-', '', '']);
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    vi.useRealTimers();
    expect(rows[1]!.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: '7' });
    expect(onChange).toHaveBeenLastCalledWith(['-', '7', '']);
    fireEvent.keyDown(within(rows[0]!).getByRole('radio', { name: '負號' }), { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(['', '7', '']);
  });

  it('鎖住時不能作答；批改後標出每一格的對錯與正確值', async () => {
    const onChange = vi.fn();
    const rows = await renderHarness({ initial: ['-', '2', '2'], disabled: true, showFeedback: true, onChange });
    for (const r of within(rows[0]!).getAllByRole('radio')) expect(r).toBeDisabled();
    fireEvent.keyDown(within(rows[0]!).getAllByRole('radio')[0]!, { key: '5' });
    expect(onChange).not.toHaveBeenCalled();
    expect(within(rows[0]!).getByText('✓')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('✗ 正確：3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /清除/ })).toBeNull();
  });
});
