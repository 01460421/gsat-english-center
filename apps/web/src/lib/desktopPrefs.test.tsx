/**
 * 電腦版介面的偏好（lib/desktopPrefs.ts）：存在 localStorage；不能用時用預設值、畫面照樣更新；不合法的值當成沒設定。
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  desktopPrefStorageKey,
  readDesktopPref,
  resetDesktopPrefsForTests,
  singleKeysEnabled,
  useDesktopPref,
  type SidebarPref,
} from './desktopPrefs';

afterEach(() => resetDesktopPrefsForTests());

function breakLocalStorage(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError');
    },
  });
  return () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
  };
}

describe('useDesktopPref', () => {
  it('側邊欄沒有設定時是「自動」（null），設定後寫進 gsat-ui:v1:sidebar；傳 null 刪掉', () => {
    const { result } = renderHook(() => useDesktopPref<SidebarPref>('sidebar', null));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]('collapsed'));
    expect(result.current[0]).toBe('collapsed');
    expect(window.localStorage.getItem('gsat-ui:v1:sidebar')).toBe('collapsed');
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(window.localStorage.getItem('gsat-ui:v1:sidebar')).toBeNull();
  });

  it('不合法的值當成沒有設定', () => {
    window.localStorage.setItem(desktopPrefStorageKey('sidebar'), 'sideways');
    window.localStorage.setItem(desktopPrefStorageKey('list-view:exams'), 'table');
    expect(readDesktopPref('sidebar')).toBeNull();
    expect(readDesktopPref('list-view:exams')).toBe('table');
    const { result } = renderHook(() => useDesktopPref<SidebarPref>('sidebar', 'expanded'));
    expect(result.current[0]).toBe('expanded');
  });

  it('別的分頁改了（storage 事件）跟著更新', () => {
    const { result } = renderHook(() => useDesktopPref<'on' | 'off'>('single-key', 'on'));
    expect(result.current[0]).toBe('on');
    act(() => {
      window.localStorage.setItem('gsat-ui:v1:single-key', 'off');
      window.dispatchEvent(new StorageEvent('storage', { key: 'gsat-ui:v1:single-key' }));
    });
    expect(result.current[0]).toBe('off');
  });

  it('localStorage 丟例外時用預設值，設定在這次瀏覽仍然有效', () => {
    const restore = breakLocalStorage();
    try {
      const { result } = renderHook(() => useDesktopPref<SidebarPref>('sidebar', null));
      expect(result.current[0]).toBeNull();
      expect(singleKeysEnabled()).toBe(true);
      act(() => result.current[1]('collapsed'));
      expect(result.current[0]).toBe('collapsed');
    } finally {
      restore();
    }
  });
});

describe('singleKeysEnabled', () => {
  it('預設開，設成 off 才關', () => {
    expect(singleKeysEnabled()).toBe(true);
    window.localStorage.setItem('gsat-ui:v1:single-key', 'off');
    expect(singleKeysEnabled()).toBe(false);
    window.localStorage.setItem('gsat-ui:v1:single-key', 'on');
    expect(singleKeysEnabled()).toBe(true);
  });
});
