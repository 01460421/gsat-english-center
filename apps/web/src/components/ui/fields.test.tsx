/**
 * 共用表單欄位（components/ui/fields.ts、Field.tsx、Check.tsx；docs/design/css-overhaul.md §4.2–4.4）：
 * 框線用 line-strong（≥ 3:1，對比由 lib/tokens.test.ts 檢查）、手機 48／桌機 40 高、16px 字、標籤／說明／錯誤的關聯。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Check, checkInputCls, optionCardCls, optionCardTopCls } from './Check';
import { Field, Input, Select, Textarea } from './Field';
import { fieldBaseCls, fieldCls, numberFieldCls, selectCls, selectCompactCls, textareaCls } from './fields';

const tokens = (cls: string) => cls.split(/\s+/);

describe('欄位的 class', () => {
  it('互動元件的框線都是 line-strong（不是裝飾用的 line）；fieldBaseCls 不含框線顏色', () => {
    for (const [name, cls] of Object.entries({ fieldCls, numberFieldCls, textareaCls, selectCls, selectCompactCls, optionCardCls, optionCardTopCls })) {
      expect(tokens(cls), name).toContain('border-line-strong');
      expect(tokens(cls), name).not.toContain('border-line');
    }
    expect(tokens(fieldBaseCls)).not.toContain('border-line-strong');
  });

  it('白底（surface）、16px 字、rounded-control；單行手機 48、桌機 40；不靠 opacity 表示停用', () => {
    for (const cls of [fieldCls, textareaCls, selectCls]) {
      expect(tokens(cls)).toEqual(expect.arrayContaining(['bg-surface', 'text-body', 'rounded-control', 'disabled:bg-surface-2', 'disabled:text-muted']));
      expect(cls).not.toMatch(/bg-bg|opacity/);
    }
    expect(tokens(fieldCls)).toEqual(expect.arrayContaining(['min-h-12', 'lg:min-h-10']));
    expect(tokens(selectCls)).toEqual(expect.arrayContaining(['min-h-12', 'lg:min-h-10', 'appearance-none', 'pr-9']));
    expect(tokens(selectCompactCls)).toEqual(expect.arrayContaining(['min-h-11', 'lg:min-h-9']));
    expect(tokens(numberFieldCls)).toEqual(expect.arrayContaining(['w-24', 'text-right', 'tabular-nums']));
  });

  it('錯誤：aria-invalid 時框線換成 bad', () => {
    expect(tokens(fieldCls)).toContain('aria-[invalid=true]:border-bad');
  });
});

describe('<Field>', () => {
  it('標籤、說明、錯誤：label 指到控制項，說明與錯誤用 aria-describedby，有錯時 aria-invalid', () => {
    render(
      <Field label="暱稱" hint="可以不是真名" error="太長了" required>
        {(p) => <input {...p} className={fieldCls} />}
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /^暱稱\s*（必填）$/ });
    expect(input).toHaveAccessibleDescription('可以不是真名 太長了');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    expect(screen.getByText('太長了').closest('p')?.className).toContain('text-bad');
  });

  it('沒有錯誤時沒有 aria-invalid、沒有 describedby', () => {
    render(<Field label="學校">{(p) => <Input {...p} />}</Field>);
    const input = screen.getByRole('textbox', { name: '學校' });
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input.className).toBe(fieldCls);
  });

  it('Textarea、Select：加好 class；Select 旁邊有不能點的箭頭', () => {
    render(
      <>
        <label>
          作答
          <Textarea rows={4} />
        </label>
        <label>
          學年度
          <Select defaultValue="115">
            <option value="115">115</option>
            <option value="114">114</option>
          </Select>
        </label>
      </>,
    );
    expect(screen.getByRole('textbox', { name: '作答' }).className).toBe(textareaCls);
    const select = screen.getByRole('combobox', { name: /學年度/ });
    expect(select.className).toBe(selectCls);
    const arrow = select.parentElement?.querySelector('svg');
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    expect(arrow?.getAttribute('class')).toContain('pointer-events-none');
  });
});

describe('<Check>', () => {
  it('原生 20px、整個 label 是點擊範圍（至少 44 高）；選項卡選中時 primary 框＋淡底', () => {
    render(
      <>
        <Check label="跟隨系統" type="radio" name="t" card defaultChecked />
        <Check label="淺色" description="白底黑字" type="radio" name="t" card />
        <Check label="我同意" />
      </>,
    );
    const radio = screen.getByRole('radio', { name: /跟隨系統/ });
    expect(radio.className).toBe(checkInputCls);
    expect(radio.closest('label')?.className).toBe(optionCardCls);
    expect(screen.getByRole('radio', { name: /淺色/ }).closest('label')?.className).toBe(optionCardTopCls);
    expect(tokens(optionCardCls)).toEqual(expect.arrayContaining(['min-h-11', 'has-[:checked]:border-primary', 'has-[:checked]:bg-primary-soft']));
    expect(tokens(screen.getByRole('checkbox', { name: '我同意' }).closest('label')?.className ?? '')).toContain('min-h-11');
  });
});
