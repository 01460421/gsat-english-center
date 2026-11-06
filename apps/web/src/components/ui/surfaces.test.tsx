/**
 * 卡片、標章、提示（components/ui/Card.tsx、Badge.tsx、Alert.tsx；docs/design/css-overhaul.md §4.6、§4.7、§4.12）。
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, alertCls } from './Alert';
import { Badge, badgeCls } from './Badge';
import { Card, calloutCls, cardCls, cardCompactCls, cardLinkCls } from './Card';

const tokens = (cls: string) => cls.split(/\s+/);

describe('卡片', () => {
  it('區塊卡沒有陰影、可點卡才有（shadow-card token，深色是 none）；圓角用 rounded-card、手機內距 16', () => {
    expect(tokens(cardCls)).toEqual(expect.arrayContaining(['rounded-card', 'border-line', 'bg-surface', 'p-4', 'lg:p-6']));
    expect(cardCls).not.toMatch(/shadow/);
    expect(tokens(cardCompactCls)).toContain('lg:p-5');
    expect(tokens(cardLinkCls)).toEqual(expect.arrayContaining(['shadow-(--shadow-card)', 'hover:border-primary', 'hover:shadow-(--shadow-card-hover)']));
    expect(tokens(calloutCls)).toEqual(['rounded-control', 'bg-surface-2', 'p-4']);
  });

  it('<Card>：as 與 variant', () => {
    render(
      <Card as="section" aria-label="說明" variant="callout">
        內容
      </Card>,
    );
    expect(screen.getByRole('region', { name: '說明' }).className).toBe(calloutCls);
  });
});

describe('標章', () => {
  it('xs 至少 20 高、12px（下限）、600；sm 24 高、14px；顏色只用 token', () => {
    expect(tokens(badgeCls('neutral', 'xs'))).toEqual(expect.arrayContaining(['min-h-5', 'text-xs', 'font-semibold', 'bg-surface-2', 'text-muted']));
    expect(tokens(badgeCls('ok', 'sm'))).toEqual(expect.arrayContaining(['min-h-6', 'text-meta', 'bg-ok-soft', 'text-ok']));
    expect(tokens(badgeCls('bad'))).toEqual(expect.arrayContaining(['bg-bad-soft', 'text-bad']));
    expect(tokens(badgeCls('ai'))).toEqual(expect.arrayContaining(['bg-badge-bg', 'text-badge-fg']));
    expect(badgeCls('primary')).not.toMatch(/\[0\.\d+rem\]|\/\d+\b/);
  });

  it('ai 預設帶 Sparkles；icon={null} 拿掉', () => {
    const { container, rerender } = render(<Badge tone="ai">AI 出題</Badge>);
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(
      <Badge tone="ai" icon={null}>
        AI 出題
      </Badge>,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('提示', () => {
  it('錯誤：淡紅底紅框、標題紅字、內文 fg；role 由呼叫端決定（常駐提示不用 alert）', () => {
    const { rerender } = render(
      <Alert tone="error" title="送出失敗" role="alert">
        作答還在，等一下再試一次。
      </Alert>,
    );
    const box = screen.getByRole('alert');
    expect(tokens(box.className)).toEqual(expect.arrayContaining(['border-bad-line', 'bg-bad-soft', 'text-fg']));
    expect(screen.getByText('送出失敗').className).toContain('text-bad');
    rerender(<Alert tone="info">作答紀錄只存在這台裝置</Alert>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('四種外觀都用 token（成功的框線是 ok-line，不寫透明度）', () => {
    expect(tokens(alertCls('success'))).toEqual(expect.arrayContaining(['border-ok-line', 'bg-ok-soft']));
    expect(tokens(alertCls('warn'))).toEqual(expect.arrayContaining(['border-badge-line', 'bg-badge-bg', 'text-badge-fg']));
    expect(tokens(alertCls('info'))).toContain('bg-surface-2');
    for (const t of ['info', 'warn', 'ai', 'error', 'success'] as const) expect(alertCls(t)).not.toMatch(/\/\d+\b/);
  });
});
