/**
 * 共用按鈕（components/ui/buttons.ts、Button.tsx；docs/design/css-overhaul.md §4.1）：尺寸、樣式、停用（不是 opacity）、停用原因、處理中。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { btn, iconBtnCls, type ButtonSize, type ButtonVariant } from './buttons';

const tokens = (cls: string) => cls.split(/\s+/);

describe('btn()', () => {
  it('手機的點擊目標至少 44：每一種尺寸的基本高度都是 min-h-11 以上（icon 是 size-11）', () => {
    const mobile: Record<ButtonSize, string> = { sm: 'min-h-11', md: 'min-h-11', lg: 'min-h-12', icon: 'size-11' };
    for (const [size, cls] of Object.entries(mobile) as Array<[ButtonSize, string]>) {
      expect(tokens(btn('primary', size)), size).toContain(cls);
      expect(tokens(btn('link', size)), `link ${size}`).toContain(cls);
    }
    expect(tokens(iconBtnCls)).toContain('size-11');
  });

  it('桌機的尺寸：lg 44、md 40、sm 36、icon 40', () => {
    expect(tokens(btn('primary', 'lg'))).toContain('lg:min-h-11');
    expect(tokens(btn('primary', 'md'))).toContain('lg:min-h-10');
    expect(tokens(btn('primary', 'sm'))).toContain('lg:min-h-9');
    expect(tokens(btn('primary', 'icon'))).toContain('lg:size-10');
  });

  it('樣式：只用語意 token；primary 實心、secondary 外框用 line-strong、danger 紅底、文字型沒有底色', () => {
    expect(tokens(btn('primary'))).toEqual(expect.arrayContaining(['bg-primary', 'text-on-primary', 'hover:bg-primary-hover']));
    expect(tokens(btn('secondary'))).toEqual(expect.arrayContaining(['border-line-strong', 'bg-surface', 'text-fg']));
    expect(tokens(btn('danger'))).toEqual(expect.arrayContaining(['bg-bad', 'text-on-primary']));
    expect(tokens(btn('danger-ghost'))).toEqual(expect.arrayContaining(['text-bad', 'hover:bg-bad-soft']));
    expect(tokens(btn('ghost'))).toEqual(expect.arrayContaining(['text-primary', 'hover:bg-primary-soft']));
    expect(tokens(btn('link'))).toEqual(expect.arrayContaining(['text-primary', 'underline']));
    for (const v of ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost', 'link'] as ButtonVariant[]) {
      const cls = btn(v);
      expect(cls, v).not.toMatch(/(?:bg|text|border)-(?:white|black|gray|slate|blue|red)-?/);
      expect(cls, v).not.toMatch(/\[#|opacity-50|opacity-60/);
    }
  });

  it('停用不是半透明：實心與外框按鈕換成 surface-2 底＋muted 字；disabled 與 aria-disabled 同一組', () => {
    for (const v of ['primary', 'secondary', 'danger'] as ButtonVariant[]) {
      expect(tokens(btn(v)), v).toEqual(
        expect.arrayContaining([
          'disabled:bg-surface-2',
          'disabled:text-muted',
          'disabled:cursor-not-allowed',
          'aria-disabled:bg-surface-2',
          'aria-disabled:text-muted',
          'aria-disabled:cursor-not-allowed',
        ]),
      );
    }
    expect(tokens(btn('ghost'))).toEqual(expect.arrayContaining(['disabled:text-muted', 'aria-disabled:text-muted']));
    expect(btn('primary')).not.toMatch(/disabled:opacity/);
  });

  it('extra 接在最後；link 不撐左右內距', () => {
    expect(btn('primary', 'md', 'mt-4 w-full').endsWith(' mt-4 w-full')).toBe(true);
    expect(btn('link', 'sm')).not.toMatch(/\bpx-/);
  });
});

describe('<Button>', () => {
  it('預設 type="button"、primary md', () => {
    render(<Button>開始</Button>);
    const b = screen.getByRole('button', { name: '開始' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b.className).toBe(btn('primary', 'md'));
  });

  it('停用且有原因：原因顯示在旁邊，用 aria-describedby 連起來；沒停用時不顯示', () => {
    const { rerender } = render(
      <Button disabled disabledReason="兩句都寫完才能對照">
        對照
      </Button>,
    );
    const b = screen.getByRole('button', { name: '對照' });
    expect(b).toBeDisabled();
    expect(b).toHaveAccessibleDescription('兩句都寫完才能對照');
    expect(screen.getByText('兩句都寫完才能對照')).toBeVisible();
    rerender(<Button disabledReason="兩句都寫完才能對照">對照</Button>);
    expect(screen.queryByText('兩句都寫完才能對照')).toBeNull();
    expect(screen.getByRole('button', { name: '對照' })).not.toHaveAttribute('aria-describedby');
  });

  it('呼叫端自己的 aria-describedby 保留，原因的 id 接在後面', () => {
    render(
      <>
        <p id="hint">說明</p>
        <Button disabled aria-describedby="hint" disabledReason="還沒有修改">
          儲存
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: '儲存' })).toHaveAccessibleDescription('說明 還沒有修改');
  });

  it('處理中：aria-busy、文字換成 busyLabel', () => {
    render(
      <Button busy busyLabel="送出中…">
        送出
      </Button>,
    );
    const b = screen.getByRole('button', { name: '送出中…' });
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
});
