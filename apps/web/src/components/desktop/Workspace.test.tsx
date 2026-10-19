/**
 * 寫作工作區（components/desktop/Workspace.tsx，設計文件 §4.5）：分欄時面板才是可聚焦的 region（usePaneA11y），
 * 堆疊（main 不到 ws 或 split="off"）時不多一個 Tab 停留點；分欄或堆疊只靠 CSS，DOM 結構相同。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setDesktopViewport } from '../../test/viewport';
import { Pane, Workspace } from './Workspace';

function renderWorkspace(split: 'auto' | 'off' = 'auto') {
  return render(
    <Workspace
      layout="prompt-editor"
      split={split}
      header={<h1>115 學測 英文作文</h1>}
      left={
        <Pane id="ws-prompt" label="題目">
          <p>題目內容</p>
        </Pane>
      }
      right={
        <Pane id="ws-editor" label="作答區" fill>
          <textarea aria-label="你的作文" />
        </Pane>
      }
    />,
  );
}

describe('Workspace', () => {
  it('main 到 ws 寬度、split="auto"：兩個面板是可聚焦的 region，標了 data-pane-scroll', () => {
    setDesktopViewport(1366, 640);
    renderWorkspace();
    for (const name of ['題目', '作答區']) {
      const pane = screen.getByRole('region', { name });
      expect(pane).toHaveAttribute('tabindex', '0');
      expect(pane).toHaveAttribute('data-pane-scroll');
    }
    // 跳轉連結的目標在分欄與堆疊時都存在。
    expect(document.getElementById('ws-prompt')).not.toBeNull();
    expect(document.getElementById('ws-editor')).not.toBeNull();
  });

  it('main 不到 ws 寬度（1100 寬、側邊欄展開）：堆疊，面板不是 region、不能聚焦', () => {
    setDesktopViewport(1100, 640);
    renderWorkspace();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(document.getElementById('ws-prompt')).not.toHaveAttribute('tabindex');
  });

  it('split="off"：一律堆疊', () => {
    setDesktopViewport(1920, 960);
    renderWorkspace('off');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(document.querySelector('[data-workspace]')).toHaveAttribute('data-split', 'off');
  });

  it('頁首的高度寫進工作區自己的 --ws-head-h（不寫在根元素）', () => {
    setDesktopViewport(1366, 640);
    renderWorkspace();
    const root = document.querySelector<HTMLElement>('[data-workspace]');
    expect(root?.style.getPropertyValue('--ws-head-h')).toMatch(/^\d+px$/);
    expect(document.documentElement.style.getPropertyValue('--ws-head-h')).toBe('');
  });
});
