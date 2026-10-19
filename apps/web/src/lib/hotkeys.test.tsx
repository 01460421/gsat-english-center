/**
 * 桌機的鍵盤快捷鍵（lib/hotkeys.ts，設計文件 §4.4、§8）：哪些按鍵一律略過、單鍵與組合鍵在文字欄位的差別、
 * 輸入法的保護只用在文字欄位裡的組合鍵、設定關閉、對話框、暫停與解除、頁面優先於全站。
 */
import { fireEvent, render, renderHook } from '@testing-library/react';
import { useMemo } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hotkeyChar,
  hotkeyLabels,
  isFormControlTarget,
  isModalOpen,
  isTextEntryTarget,
  resetHotkeysForTests,
  singleKeysSuspended,
  suspendSingleKeys,
  useActiveHotkeys,
  useHotkeys,
  type HotkeyDef,
} from './hotkeys';

afterEach(() => resetHotkeysForTests());

function Registrar({ defs, enabled = true }: { defs: HotkeyDef[]; enabled?: boolean }) {
  const memo = useMemo(() => defs, [defs]);
  useHotkeys(memo, { enabled });
  return null;
}

function setup(defs: HotkeyDef[], enabled = true) {
  return render(<Registrar defs={defs} enabled={enabled} />);
}

const def = (keys: string[], run = vi.fn(), extra: Partial<Omit<HotkeyDef, 'run'>> = {}) => ({
  keys,
  description: keys.join(' '),
  group: '全站' as HotkeyDef['group'],
  ...extra,
  run,
});

function press(target: Document | Element, init: KeyboardEventInit & { keyCode?: number }) {
  return fireEvent.keyDown(target, init);
}

describe('目標元素', () => {
  it('文字類 input、textarea、select、contenteditable 是文字輸入；radio、checkbox、按鈕不是', () => {
    const text = document.createElement('input');
    const radio = Object.assign(document.createElement('input'), { type: 'radio' });
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    expect(isTextEntryTarget(text)).toBe(true);
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true);
    expect(isTextEntryTarget(editable)).toBe(true);
    expect(isTextEntryTarget(radio)).toBe(false);
    expect(isTextEntryTarget(checkbox)).toBe(false);
    expect(isTextEntryTarget(document.createElement('button'))).toBe(false);
    // 單字每日學習與測驗原本的判斷：所有 input 都算（行為不變）。
    expect(isFormControlTarget(radio)).toBe(true);
    expect(isFormControlTarget(document.createElement('button'))).toBe(false);
    editable.remove();
  });

  it('isModalOpen：偵測標了 aria-modal 的對話框', () => {
    expect(isModalOpen()).toBe(false);
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    expect(isModalOpen()).toBe(true);
    dialog.remove();
  });
});

describe('hotkeyChar', () => {
  it('ASCII 字母與數字用 e.key（不分大小寫）；? 與 [ 照字面', () => {
    expect(hotkeyChar({ key: 'N', code: 'KeyN' })).toBe('n');
    expect(hotkeyChar({ key: '3', code: 'Digit3' })).toBe('3');
    expect(hotkeyChar({ key: '?', code: 'Slash' })).toBe('?');
    expect(hotkeyChar({ key: '[', code: 'BracketLeft' })).toBe('[');
    // Dvorak：照 e.key 的字面，不看實體位置。
    expect(hotkeyChar({ key: 'p', code: 'KeyR' })).toBe('p');
  });

  it('e.key 不是 ASCII、也不是拉丁字母（輸入法送出注音、俄文鍵盤）時改看 e.code', () => {
    expect(hotkeyChar({ key: 'ㄅ', code: 'Digit1' })).toBe('1');
    expect(hotkeyChar({ key: 'ㄖ', code: 'KeyB' })).toBe('b');
    expect(hotkeyChar({ key: 'и', code: 'KeyB' })).toBe('b');
    expect(hotkeyChar({ key: 'Enter', code: 'Enter' })).toBeNull();
    expect(hotkeyChar({ key: ' ', code: 'Space' })).toBeNull();
    expect(hotkeyChar({ key: 'ArrowDown', code: 'ArrowDown' })).toBeNull();
  });

  it('非美式鍵盤：[ 與 ? 的實體位置上的其他字、拉丁字母的 é、ü 都不算快捷鍵', () => {
    // 德文鍵盤的 ü 與 Shift+-、日文 JIS 的 @、法文 AZERTY 的 ^ 死鍵都在 [ 或 / 的位置。
    expect(hotkeyChar({ key: 'ü', code: 'BracketLeft' })).toBeNull();
    expect(hotkeyChar({ key: '_', code: 'Slash' })).toBeNull();
    expect(hotkeyChar({ key: '@', code: 'BracketLeft' })).toBeNull();
    expect(hotkeyChar({ key: 'Dead', code: 'BracketLeft' })).toBeNull();
    // 法文鍵盤的 é 在 2 的位置、德文的 ö 在 ; 的位置：是鍵盤上真的字，不能當成 2。
    expect(hotkeyChar({ key: 'é', code: 'Digit2' })).toBeNull();
    expect(hotkeyChar({ key: 'ö', code: 'Semicolon' })).toBeNull();
    expect(hotkeyChar({ key: '&', code: 'Digit1' })).toBeNull();
  });

  it('顯示用的按鍵名稱', () => {
    expect(hotkeyLabels('mod+enter')).toEqual(['Ctrl', 'Enter']);
    expect(hotkeyLabels('n')).toEqual(['N']);
    expect(hotkeyLabels('?')).toEqual(['?']);
    expect(hotkeyLabels('space')).toEqual(['空白鍵']);
  });
});

describe('單鍵快捷鍵', () => {
  it('焦點在 body 時作用並 preventDefault；忽略按住不放的重複按鍵', () => {
    const n = def(['n']);
    setup([n]);
    const first = press(document.body, { key: 'n', code: 'KeyN' });
    expect(n.run).toHaveBeenCalledTimes(1);
    expect(first).toBe(false); // dispatchEvent 回傳 false＝被 preventDefault
    press(document.body, { key: 'n', code: 'KeyN', repeat: true });
    expect(n.run).toHaveBeenCalledTimes(1);
  });

  it('文字欄位裡不作用，radio 上照樣作用', () => {
    const b = def(['b']);
    setup([b]);
    const input = document.createElement('input');
    const radio = Object.assign(document.createElement('input'), { type: 'radio' });
    document.body.append(input, radio);
    press(input, { key: 'b', code: 'KeyB' });
    expect(b.run).not.toHaveBeenCalled();
    press(radio, { key: 'b', code: 'KeyB' });
    expect(b.run).toHaveBeenCalledTimes(1);
    input.remove();
    radio.remove();
  });

  it('按著 Ctrl／⌘／Alt、已被處理過、輸入法正在處理（Process／229）時略過', () => {
    const b = def(['b']);
    setup([b]);
    press(document.body, { key: 'b', code: 'KeyB', ctrlKey: true });
    press(document.body, { key: 'b', code: 'KeyB', metaKey: true });
    press(document.body, { key: 'b', code: 'KeyB', altKey: true });
    press(document.body, { key: 'Process', code: 'KeyB' });
    press(document.body, { key: 'b', code: 'KeyB', keyCode: 229 });
    const handled = new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(b.run).not.toHaveBeenCalled();
  });

  it('輸入法送出非 ASCII 的 e.key 時用 e.code 比對', () => {
    const b = def(['b']);
    setup([b]);
    press(document.body, { key: 'ㄖ', code: 'KeyB' });
    expect(b.run).toHaveBeenCalledTimes(1);
  });

  it('非美式鍵盤在 [、/ 位置上的其他字不會收合側邊欄、打開說明', () => {
    const bracket = def(['[']);
    const help = def(['?']);
    setup([bracket, help]);
    press(document.body, { key: 'ü', code: 'BracketLeft' });
    press(document.body, { key: '@', code: 'BracketLeft' });
    press(document.body, { key: 'Dead', code: 'BracketLeft' });
    press(document.body, { key: '_', code: 'Slash', shiftKey: true });
    expect(bracket.run).not.toHaveBeenCalled();
    expect(help.run).not.toHaveBeenCalled();
    press(document.body, { key: '[', code: 'BracketLeft' });
    press(document.body, { key: '?', code: 'Slash', shiftKey: true });
    expect(bracket.run).toHaveBeenCalledTimes(1);
    expect(help.run).toHaveBeenCalledTimes(1);
  });

  it('listOnly：只列在說明裡（頁面自己的監聽處理），不攔按鍵、不 preventDefault', () => {
    const listed = def(['1', '2'], vi.fn(), { group: '這一頁', listOnly: true });
    setup([listed]);
    const event = press(document.body, { key: '1', code: 'Digit1' });
    expect(event).toBe(true);
    expect(listed.run).not.toHaveBeenCalled();
    const { result } = renderHook(() => useActiveHotkeys());
    expect(result.current.map((d) => d.keys)).toEqual([['1', '2']]);
  });

  it('設定關閉時單鍵不作用，組合鍵照常', () => {
    const b = def(['b']);
    const save = def(['mod+s']);
    setup([b, save]);
    window.localStorage.setItem('gsat-ui:v1:single-key', 'off');
    press(document.body, { key: 'b', code: 'KeyB' });
    press(document.body, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(b.run).not.toHaveBeenCalled();
    expect(save.run).toHaveBeenCalledTimes(1);
  });

  it('有 modal 對話框開著時一律不作用', () => {
    const b = def(['b']);
    setup([b]);
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    press(document.body, { key: 'b', code: 'KeyB' });
    expect(b.run).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('暫停期間不作用，下一次 pointerdown 或 focusin 解除', () => {
    const b = def(['b']);
    setup([b]);
    suspendSingleKeys();
    expect(singleKeysSuspended()).toBe(true);
    press(document.body, { key: 'b', code: 'KeyB' });
    expect(b.run).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(singleKeysSuspended()).toBe(false);
    press(document.body, { key: 'b', code: 'KeyB' });
    expect(b.run).toHaveBeenCalledTimes(1);

    suspendSingleKeys();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(singleKeysSuspended()).toBe(false);
    button.remove();
  });

  it('when() 不成立時不作用（讓給下一個）', () => {
    const off = def(['n'], vi.fn(), { when: () => false });
    const on = def(['n']);
    setup([off, on]);
    press(document.body, { key: 'n', code: 'KeyN' });
    expect(off.run).not.toHaveBeenCalled();
    expect(on.run).toHaveBeenCalledTimes(1);
  });

  it('enabled 為 false（手機）時不登記、document 上沒有監聽', () => {
    const n = def(['n']);
    setup([n], false);
    press(document.body, { key: 'n', code: 'KeyN' });
    expect(n.run).not.toHaveBeenCalled();
  });
});

describe('組合鍵', () => {
  it('mod+enter：Ctrl＋Enter 作用；單按 Enter、Ctrl＋Shift＋Enter 不作用', () => {
    const submit = def(['mod+enter']);
    setup([submit]);
    press(document.body, { key: 'Enter', code: 'Enter' });
    press(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true, shiftKey: true });
    expect(submit.run).not.toHaveBeenCalled();
    press(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(submit.run).toHaveBeenCalledTimes(1);
  });

  it('文字欄位裡只有 allowInTextEntry 的組合鍵作用，組字中（isComposing）略過', () => {
    const allowed = def(['mod+enter'], vi.fn(), { allowInTextEntry: true });
    const notAllowed = def(['mod+s']);
    setup([allowed, notAllowed]);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    press(textarea, { key: 's', code: 'KeyS', ctrlKey: true });
    expect(notAllowed.run).not.toHaveBeenCalled();
    press(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });
    expect(allowed.run).not.toHaveBeenCalled();
    press(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });
    expect(allowed.run).toHaveBeenCalledTimes(1);
    // 文字欄位以外，組字狀態不影響（輸入法的保護只用在文字欄位裡的組合鍵）。
    press(document.body, { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true });
    expect(allowed.run).toHaveBeenCalledTimes(2);
    textarea.remove();
  });
});

describe('登記表', () => {
  it('「這一頁」優先於「全站」，不論誰先登記；說明對話框讀到同樣的順序', () => {
    const site = def(['n'], vi.fn(), { description: '全站的 n' });
    const page = def(['n'], vi.fn(), { group: '這一頁', description: '這一頁的 n' });
    render(
      <>
        <Registrar defs={[page]} />
        <Registrar defs={[site]} />
      </>,
    );
    press(document.body, { key: 'n', code: 'KeyN' });
    expect(page.run).toHaveBeenCalledTimes(1);
    expect(site.run).not.toHaveBeenCalled();
    const { result } = renderHook(() => useActiveHotkeys());
    expect(result.current.map((d) => d.description)).toEqual(['這一頁的 n', '全站的 n']);
  });

  it('卸載後移除，說明對話框跟著更新', () => {
    const n = def(['n']);
    const view = setup([n]);
    const { result } = renderHook(() => useActiveHotkeys());
    expect(result.current).toHaveLength(1);
    view.unmount();
    expect(result.current).toHaveLength(0);
    press(document.body, { key: 'n', code: 'KeyN' });
    expect(n.run).not.toHaveBeenCalled();
  });
});
