/**
 * 桌機把同一份元件搬到別的位置（Slot.tsx）：沒有人提供位置時原地 render（手機的 DOM 和原本一樣）；
 * 提供了就用 portal 搬進目標，只有一份；目標還沒掛上時先不顯示。
 */
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { InSlot, SlotProvider, useInSlot, useSlotTarget } from './Slot';

function Filter() {
  const slotted = useInSlot('filter');
  return <button type="button">篩選{slotted ? '（搬過去了）' : ''}</button>;
}

function Page({ desktop }: { desktop: boolean }) {
  const [target, targetRef] = useSlotTarget();
  return (
    <SlotProvider name="filter" target={target} enabled={desktop}>
      <header data-testid="bar">{desktop && <div ref={targetRef} data-testid="slot" />}</header>
      <section data-testid="list">
        <InSlot name="filter">
          <Filter />
        </InSlot>
      </section>
    </SlotProvider>
  );
}

describe('Slot', () => {
  it('沒有提供位置（手機）：原地 render', () => {
    render(<Page desktop={false} />);
    expect(screen.getByTestId('list')).toContainElement(screen.getByRole('button', { name: '篩選' }));
  });

  it('提供了位置（桌機）：同一份元件搬進目標，原處沒有', () => {
    render(<Page desktop />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(screen.getByTestId('slot')).toContainElement(buttons[0] as HTMLElement);
    expect(buttons[0]).toHaveTextContent('篩選（搬過去了）');
    expect(screen.getByTestId('list')).toBeEmptyDOMElement();
  });

  it('提供了位置但目標還沒掛上：先不顯示（不會在原處多一份）', () => {
    function Pending() {
      const [target] = useState<HTMLElement | null>(null);
      return (
        <SlotProvider name="filter" target={target}>
          <section data-testid="list">
            <InSlot name="filter">
              <Filter />
            </InSlot>
          </section>
        </SlotProvider>
      );
    }
    render(<Pending />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
