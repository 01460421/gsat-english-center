/**
 * 對話框與短暫通知（components/ui/Dialog.tsx、Toast.tsx；docs/design/css-overhaul.md §4.10、§4.11）。
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './Toast';

function ConfirmHarness() {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        清除作答
      </button>
      <Dialog
        open={open}
        title="確定要清除嗎？"
        description="清除後無法復原。"
        onClose={() => setOpen(false)}
        initialFocusRef={cancelRef}
        actions={
          <>
            <button type="button" onClick={() => setOpen(false)}>
              確定清除
            </button>
            <button ref={cancelRef} type="button" onClick={() => setOpen(false)}>
              取消
            </button>
          </>
        }
      />
    </>
  );
}

describe('Dialog', () => {
  it('名稱與說明、右上角「關閉」；打開時焦點到 initialFocusRef，關閉後回到打開前的按鈕', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    const opener = screen.getByRole('button', { name: '清除作答' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: '確定要清除嗎？' });
    expect(dialog).toHaveAccessibleDescription('清除後無法復原。');
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Esc（cancel 事件）呼叫 onClose', async () => {
    const user = userEvent.setup();
    render(<ConfirmHarness />);
    await user.click(screen.getByRole('button', { name: '清除作答' }));
    const dialog = screen.getByRole('dialog');
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

function ToastHarness({ withAction = false }: { withAction?: boolean }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show('已登出所有裝置', withAction ? { action: { label: '復原', onAction: () => {} } } : undefined)}>
      登出
    </button>
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('常駐的 aria-live 容器；4 秒後消失；有動作的不自動消失', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container, rerender } = render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: '登出' }));
    expect(screen.getByRole('status')).toHaveTextContent('已登出所有裝置');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10);
    });
    expect(screen.queryByRole('status')).toBeNull();

    rerender(
      <ToastProvider>
        <ToastHarness withAction />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: '登出' }));
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(screen.getByRole('button', { name: '復原' })).toBeInTheDocument();
  });

  it('沒有 Provider 時 useToast 不會壞（單元測試單獨 render 元件）', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<ToastHarness />);
    await user.click(screen.getByRole('button', { name: '登出' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
