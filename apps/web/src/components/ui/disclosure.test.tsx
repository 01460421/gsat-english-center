/** 揭露（components/ui/Disclosure.tsx）：原生 <details>／<summary>，標記換成 ChevronDown，展開時旋轉。 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Disclosure, disclosureSummaryCls } from './Disclosure';

describe('Disclosure', () => {
  it('summary 至少 44 高、隱藏原生標記；點了展開，內容出現', async () => {
    const user = userEvent.setup();
    const { container } = render(<Disclosure summary="題目">題目內容</Disclosure>);
    const details = container.querySelector('details');
    const summary = screen.getByText('題目').closest('summary');
    expect(summary?.className).toBe(disclosureSummaryCls);
    expect(disclosureSummaryCls).toMatch(/min-h-11/);
    expect(disclosureSummaryCls).toMatch(/\[&::-webkit-details-marker\]:hidden/);
    expect(details?.className).toContain('group');
    expect(summary?.querySelector('svg')?.getAttribute('class')).toContain('group-open:rotate-180');
    await user.click(summary as HTMLElement);
    expect(details).toHaveAttribute('open');
  });

  it('行內的「更多」：箭頭在左，收合時 −90°', () => {
    render(
      <Disclosure variant="inline" summary="其他釋義">
        內容
      </Disclosure>,
    );
    const summary = screen.getByText('其他釋義').closest('summary');
    expect(summary?.firstElementChild?.getAttribute('class')).toContain('-rotate-90');
  });
});
