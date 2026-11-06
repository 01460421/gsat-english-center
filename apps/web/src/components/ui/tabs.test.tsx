/**
 * 選擇控制項（components/ui/Tabs.tsx；docs/design/css-overhaul.md §4.5、§4.9）：實心主色只給主要按鈕、手機 44 高、
 * 選中狀態從語意讀（aria-current、has-[:checked]、aria-pressed）、高對比模式用 Highlight。
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ChoiceChip, chipCls, segmentCls, SubNav, tabCls, tierTileCls } from './Tabs';

const tokens = (cls: string) => cls.split(/\s+/);

describe('class', () => {
  it('選中都不是實心主色（bg-primary＋on-primary）', () => {
    for (const cls of [tabCls(true), segmentCls(true), chipCls(true), tierTileCls(true), chipCls(), segmentCls(), tierTileCls()]) {
      expect(tokens(cls)).not.toContain('bg-primary');
      expect(cls).not.toMatch(/text-on-primary/);
    }
    expect(tokens(chipCls(true))).toEqual(expect.arrayContaining(['bg-primary-soft', 'text-primary', 'border-primary', 'font-semibold']));
    expect(tokens(tierTileCls(true))).toEqual(expect.arrayContaining(['bg-primary-soft', 'border-2', 'border-primary']));
  });

  it('手機 44 高；未選的膠囊框線是 line-strong（≥ 3:1）', () => {
    for (const cls of [tabCls(false), segmentCls(false), chipCls(false), tierTileCls(false)]) expect(tokens(cls)).toContain('min-h-11');
    expect(tokens(chipCls(false))).toContain('border-line-strong');
    expect(tokens(chipCls())).toContain('lg:min-h-8');
  });

  it('選中狀態從語意讀；高對比模式選中用 Highlight', () => {
    expect(tokens(chipCls())).toEqual(expect.arrayContaining(['has-[:checked]:bg-primary-soft', 'aria-pressed:bg-primary-soft', 'forced-colors:has-[:checked]:bg-[color:Highlight]']));
    expect(tokens(tabCls())).toEqual(expect.arrayContaining(['aria-[current=page]:text-primary', 'aria-selected:text-primary']));
    expect(tokens(segmentCls())).toContain('aria-pressed:bg-surface');
    expect(tokens(chipCls())).toContain('has-[:focus-visible]:outline-offset-2');
  });
});

describe('元件', () => {
  it('SubNav：<nav> 的名稱、目前那一個 aria-current="page"', () => {
    render(
      <MemoryRouter>
        <SubNav
          label="題目來源"
          items={[
            { to: '/a', label: '歷屆試題', current: true },
            { to: '/b', label: '本站仿真', current: false },
          ]}
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: '題目來源' });
    expect(screen.getByRole('link', { name: '歷屆試題' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '本站仿真' })).not.toHaveAttribute('aria-current');
    expect(nav).toBeVisible();
  });

  it('ChoiceChip：原生 input（sr-only）、多選選中時有勾號', () => {
    const { container } = render(
      <>
        <ChoiceChip type="checkbox" checked onChange={() => {}}>
          學測
        </ChoiceChip>
        <ChoiceChip name="y" value="1" defaultChecked>
          115
        </ChoiceChip>
      </>,
    );
    expect(screen.getByRole('checkbox', { name: '學測' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '115' }).className).toBe('sr-only');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
