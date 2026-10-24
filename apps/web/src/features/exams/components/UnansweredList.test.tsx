/** 交卷確認的「未作答題號」（桌機）：連續的題號併成範圍、一個大題超過 10 題時收成一行、點題號回去作答。 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SectionEntry } from '../../mock/paperIndex';
import { UnansweredList, unansweredRanges } from './UnansweredList';

const labels = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
const section = (id: string, label: string, all: string[]): SectionEntry => ({ id, type: 'reading', label, title: label, labels: all });

describe('unansweredRanges', () => {
  it('連續的併成「a–b」，不連續的用「、」隔開', () => {
    expect(unansweredRanges(labels(1, 10), ['3', '4', '5', '6', '7', '8', '9', '10'])).toBe('3–10');
    expect(unansweredRanges(labels(1, 10), ['1', '3', '4', '9'])).toBe('1、3–4、9');
  });
});

describe('UnansweredList', () => {
  it('10 題以內列出題號；超過 10 題先收成一行，可以展開；點題號呼叫 onJump', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(
      <UnansweredList
        groups={[
          { section: section('s1', '詞彙題', labels(1, 10)), labels: ['2', '3'] },
          { section: section('s5', '閱讀測驗', labels(35, 50)), labels: labels(35, 50) },
        ]}
        onJump={onJump}
      />,
    );
    const region = screen.getByRole('region', { name: '未作答（點題號回去作答）' });
    expect(within(region).getByText('詞彙題（2 題）')).toBeInTheDocument();
    expect(region).toHaveTextContent('第 35–50 題（16 題）');
    expect(within(region).queryByRole('button', { name: '回到第 35 題' })).not.toBeInTheDocument();
    const toggle = within(region).getByRole('button', { name: '列出題號' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(within(region).getByRole('button', { name: '收起題號' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(region).getByRole('button', { name: '回到第 35 題' }));
    await user.click(within(region).getByRole('button', { name: '回到第 3 題' }));
    expect(onJump.mock.calls.map((c) => c[0])).toEqual(['35', '3']);
  });

  it('沒有未作答時不畫任何東西', () => {
    const { container } = render(<UnansweredList groups={[]} onJump={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
