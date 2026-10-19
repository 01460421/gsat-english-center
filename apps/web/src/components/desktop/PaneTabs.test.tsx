/**
 * 面板裡的分頁（components/desktop/PaneTabs.tsx，設計文件 §4.6）：方向鍵與 Home／End、roving tabindex、
 * 各分頁記住捲動位置、程式切換 select()、hidden="until-found" 與 beforematch。
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { PaneTabs, type PaneTabsHandle } from './PaneTabs';

function Harness({ initial = 'prompt' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<PaneTabsHandle>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.select('self')}>
        自我檢核與自評（不用 AI）
      </button>
      <PaneTabs
        ref={ref}
        label="題目與檢核"
        value={value}
        onChange={setValue}
        scrollPanels
        panelId={(id) => (id === 'self' ? 'essay-self' : undefined)}
        tabs={[
          { id: 'prompt', label: '題目', panel: <p>題目內容</p> },
          { id: 'self', label: '自我檢核與自評', panel: <label>
                <input type="checkbox" /> 有分兩段
              </label> },
          { id: 'rubric', label: '評分規準', panel: <p>評分規準內容</p> },
        ]}
      />
    </>
  );
}

describe('PaneTabs', () => {
  it('tablist：只有目前的分頁可以 Tab 進來，面板用 aria-labelledby 對應分頁', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: '題目與檢核' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(screen.getByRole('tab', { name: '題目' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: '題目' })).toHaveTextContent('題目內容');
    // 沿用既有的錨點 id。
    expect(document.getElementById('essay-self')).toHaveAttribute('role', 'tabpanel');
  });

  it('方向鍵切換並聚焦（頭尾循環），Home／End 跳到第一個、最後一個', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('tab', { name: '題目' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '自我檢核與自評' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: '自我檢核與自評' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: '評分規準' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: '題目' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: '評分規準' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: '題目' })).toHaveAttribute('aria-selected', 'true');
  });

  it('隱藏的面板是 hidden="until-found"，保持掛載（勾選不會消失）', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const self = document.getElementById('essay-self');
    expect(self).toHaveAttribute('hidden', 'until-found');
    await user.click(screen.getByRole('tab', { name: '自我檢核與自評' }));
    expect(self).not.toHaveAttribute('hidden');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('tab', { name: '題目' }));
    expect(self).toHaveAttribute('hidden', 'until-found');
    expect(screen.getByRole('checkbox', { hidden: true })).toBeChecked();
  });

  it('每個分頁各自記住捲動位置', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const prompt = screen.getByRole('tabpanel', { name: '題目' });
    prompt.scrollTop = 120;
    await user.click(screen.getByRole('tab', { name: '評分規準' }));
    const rubric = screen.getByRole('tabpanel', { name: '評分規準' });
    rubric.scrollTop = 40;
    // 瀏覽器可能把隱藏的捲動容器重設成 0：不依賴它。
    prompt.scrollTop = 0;
    await user.click(screen.getByRole('tab', { name: '題目' }));
    expect(prompt.scrollTop).toBe(120);
    await user.click(screen.getByRole('tab', { name: '評分規準' }));
    expect(rubric.scrollTop).toBe(40);
  });

  it('select()：給同名按鈕這類程式切換用', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '自我檢核與自評（不用 AI）' }));
    expect(screen.getByRole('tab', { name: '自我檢核與自評' })).toHaveAttribute('aria-selected', 'true');
  });

  it('瀏覽器在隱藏的面板裡找到字（beforematch）時切過去', () => {
    render(<Harness />);
    const rubric = document.getElementById(screen.getByRole('tab', { name: '評分規準' }).getAttribute('aria-controls') ?? '');
    if (!rubric) throw new Error('找不到面板');
    expect(rubric).toHaveAttribute('hidden', 'until-found');
    act(() => {
      rubric.dispatchEvent(new Event('beforematch', { bubbles: true }));
    });
    expect(screen.getByRole('tab', { name: '評分規準' })).toHaveAttribute('aria-selected', 'true');
    expect(rubric).not.toHaveAttribute('hidden');
  });

  it('分欄時面板自己捲動（data-pane-scroll，scrollIntoPane 用）', () => {
    render(<Harness />);
    expect(screen.getByRole('tabpanel', { name: '題目' })).toHaveAttribute('data-pane-scroll');
  });
});
