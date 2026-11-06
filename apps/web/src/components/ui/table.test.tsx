/**
 * 表格（components/ui/Table.tsx；docs/design/css-overhaul.md §4.8）：ScrollRegion 鍵盤捲得到、有名稱；表頭與儲存格的 class。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { numCls, ScrollRegion, tdCls, thCls } from './Table';

describe('ScrollRegion', () => {
  it('role="region"＋aria-label＋tabIndex=0（沒有可聚焦內容時鍵盤也能聚焦後捲動）', () => {
    render(
      <ScrollRegion label="各評分者分數">
        <table>
          <tbody>
            <tr>
              <td>1</td>
            </tr>
          </tbody>
        </table>
      </ScrollRegion>,
    );
    const region = screen.getByRole('region', { name: '各評分者分數' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.className).toContain('overflow-x-auto');
  });
});

describe('表格的 class', () => {
  it('表頭 surface-2＋14px 600 muted、儲存格列分隔 line-subtle、數字欄靠右等寬', () => {
    expect(thCls.split(' ')).toEqual(expect.arrayContaining(['bg-surface-2', 'text-meta', 'font-semibold', 'text-muted']));
    expect(tdCls.split(' ')).toEqual(expect.arrayContaining(['border-line-subtle', 'py-2.5', 'px-3']));
    expect(numCls.split(' ')).toEqual(expect.arrayContaining(['text-right', 'tabular-nums']));
  });
});
