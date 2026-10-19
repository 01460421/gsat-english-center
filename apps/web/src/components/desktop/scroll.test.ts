/**
 * 捲動工具（components/desktop/scroll.ts，設計文件 §4.10）：只捲元素所在的面板、不在面板裡才捲 window 並扣掉 sticky 列，
 * scrollAndFocus 先捲後聚焦（focus 帶 preventScroll）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollAndFocus, scrollIntoPane, targetScroll } from './scroll';

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--sticky-bar-h');
});

describe('targetScroll', () => {
  const view = { scroll: 100, height: 500, reserved: 0 };

  it('nearest：已經看得到就不捲；在上面就對齊頂端、在下面就對齊底部', () => {
    expect(targetScroll('nearest', { top: 200, bottom: 300 }, view)).toBeNull();
    expect(targetScroll('nearest', { top: 50, bottom: 80 }, view)).toBe(50);
    expect(targetScroll('nearest', { top: 650, bottom: 700 }, view)).toBe(200);
  });

  it('扣掉上方被 sticky 列蓋住的高度', () => {
    const covered = { scroll: 100, height: 500, reserved: 80 };
    expect(targetScroll('nearest', { top: 150, bottom: 200 }, covered)).toBe(70);
    expect(targetScroll('start', { top: 400, bottom: 450 }, covered)).toBe(320);
    expect(targetScroll('center', { top: 400, bottom: 440 }, covered)).toBe(400 + 20 - 80 - 210);
  });

  it('元素比可視範圍高時對齊頂端', () => {
    expect(targetScroll('nearest', { top: 400, bottom: 1400 }, view)).toBe(400);
  });
});

describe('scrollIntoPane／scrollAndFocus', () => {
  it('在面板（data-pane-scroll）裡只捲面板，不捲 window', () => {
    const pane = document.createElement('div');
    pane.setAttribute('data-pane-scroll', '');
    const target = Object.assign(document.createElement('p'), { tabIndex: -1, textContent: '錯誤 3' });
    pane.append(target);
    document.body.append(pane);
    Object.defineProperty(pane, 'clientHeight', { value: 300 });
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(rect(100, 300));
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(600, 40));
    const paneScroll = vi.fn();
    pane.scrollTo = paneScroll as typeof pane.scrollTo;
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const focus = vi.spyOn(target, 'focus');
    scrollAndFocus(target);
    expect(paneScroll).toHaveBeenCalledWith(expect.objectContaining({ top: 240 }));
    expect(windowScroll).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('不在面板裡時捲 window，並扣掉 --sticky-bar-h 與間距', () => {
    const target = Object.assign(document.createElement('h2'), { textContent: '歷屆試題' });
    document.body.append(target);
    document.documentElement.style.setProperty('--sticky-bar-h', '56px');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(30, 40));
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    scrollIntoPane(target, { block: 'start' });
    expect(windowScroll).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    windowScroll.mockClear();
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(900, 40));
    scrollIntoPane(target, { block: 'start' });
    expect(windowScroll).toHaveBeenCalledWith(expect.objectContaining({ top: 900 + window.scrollY - 56 - 16 }));
  });
});
