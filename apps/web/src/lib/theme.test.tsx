/**
 * 主題切換：偏好要同時反映在 <html data-theme>、localStorage 與畫面上的控制項。
 * 「跟隨系統」必須移除 data-theme（交給 CSS 媒體查詢），而不是寫入 "system"。
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../components/ThemeToggle';
import SettingsPage from '../pages/SettingsPage';
import { THEME_STORAGE_KEY, getThemePreference, resetThemeForTests, setThemePreference } from './theme';

beforeEach(() => {
  window.localStorage.clear();
  resetThemeForTests();
});

describe('setThemePreference', () => {
  it('深色：寫入 data-theme 與 localStorage', () => {
    setThemePreference('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('跟隨系統：移除 data-theme 與儲存值', () => {
    setThemePreference('light');
    setThemePreference('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('localStorage 不能用時照樣能切換（無痕模式、網站資料被封鎖）', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(() => setThemePreference('dark')).not.toThrow();
      expect(getThemePreference()).toBe('dark');
      expect(document.documentElement.dataset['theme']).toBe('dark');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('主題控制項', () => {
  it('切換鈕與設定頁的選項保持同步', async () => {
    const user = userEvent.setup();
    setThemePreference('light');
    render(
      <MemoryRouter>
        <ThemeToggle />
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('radio', { name: /^淺色/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: '切換為深色主題' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(screen.getByRole('radio', { name: /^深色/ })).toBeChecked();
    expect(screen.getByRole('button', { name: '切換為淺色主題' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^跟隨系統/ }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
