/**
 * 鍵盤快捷鍵說明（components/desktop/ShortcutHelp.tsx，設計文件 §4.9）：列出登記的快捷鍵（分全站與這一頁）、
 * 單鍵快捷鍵開關、Esc 與關閉鈕關閉、焦點回到打開前的元素。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetHotkeysForTests, useHotkeys, type HotkeyDef } from '../../lib/hotkeys';
import ShortcutHelp from './ShortcutHelp';

afterEach(() => resetHotkeysForTests());

function Page({ pageKeys = true }: { pageKeys?: boolean }) {
  const [open, setOpen] = useState(false);
  const defs = useMemo<HotkeyDef[]>(
    () => [
      { keys: ['?'], description: '開啟快捷鍵說明', group: '全站', run: () => setOpen(true) },
      { keys: ['['], description: '收合／展開側邊欄', group: '全站', when: () => false, run: vi.fn() },
      ...(pageKeys ? [{ keys: ['mod+enter'], description: '送出確認', group: '這一頁' as const, allowInTextEntry: true, run: vi.fn() }] : []),
    ],
    [pageKeys],
  );
  useHotkeys(defs, { enabled: true });
  return (
    <MemoryRouter>
      <button type="button" onClick={() => setOpen(true)}>
        鍵盤快捷鍵
      </button>
      {open && <ShortcutHelp onClose={() => setOpen(false)} />}
    </MemoryRouter>
  );
}

describe('ShortcutHelp', () => {
  it('列出全站與這一頁的快捷鍵；when() 不成立的不列', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: '鍵盤快捷鍵' }));
    const dialog = screen.getByRole('dialog', { name: '鍵盤快捷鍵' });
    const site = within(dialog).getByRole('region', { name: '全站' });
    expect(within(site).getByText('開啟快捷鍵說明')).toBeInTheDocument();
    expect(within(site).queryByText('收合／展開側邊欄')).not.toBeInTheDocument();
    expect(within(site).getByText('Esc')).toBeInTheDocument();
    const page = within(dialog).getByRole('region', { name: '這一頁' });
    expect(within(page).getByText('送出確認')).toBeInTheDocument();
    expect(within(page).getByText('Ctrl')).toBeInTheDocument();
    expect(within(page).getByText('Enter')).toBeInTheDocument();
    // 不寫任何關於中文輸入法的說法（§8）。
    expect(dialog).not.toHaveTextContent(/輸入法|注音/);
  });

  it('這一頁沒有快捷鍵時說明', async () => {
    const user = userEvent.setup();
    render(<Page pageKeys={false} />);
    await user.click(screen.getByRole('button', { name: '鍵盤快捷鍵' }));
    expect(screen.getByText('這一頁沒有專用的快捷鍵。')).toBeInTheDocument();
  });

  it('單鍵快捷鍵開關寫進 gsat-ui:v1:single-key', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: '鍵盤快捷鍵' }));
    const toggle = screen.getByRole('checkbox', { name: '單鍵快捷鍵' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription('焦點在文字欄位時，單鍵快捷鍵不會作用；不需要可以在這裡關掉。');
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem('gsat-ui:v1:single-key')).toBe('off');
  });

  it('按關閉鈕關閉，焦點回到打開前的按鈕', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole('button', { name: '鍵盤快捷鍵' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('Esc（對話框的 cancel／close）關閉', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: '鍵盤快捷鍵' }));
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    // happy-dom 不實作 Esc 的原生關閉：直接呼叫瀏覽器在按 Esc 時做的 close()。
    dialog.close();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
