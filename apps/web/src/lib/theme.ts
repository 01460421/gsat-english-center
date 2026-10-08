/**
 * 外觀主題（跟隨系統／淺色／深色）。
 *
 * 用一個極小的外部 store 搭配 useSyncExternalStore，而不是 React context：
 * 頂端列的切換鈕和設定頁的選項要同步，但主題同時也要寫到 <html> 與 localStorage 這些 React 以外的地方，
 * 放在 store 裡「改值 → 寫 DOM → 通知訂閱者」一次做完，比在 context provider 的 effect 裡同步單純。
 *
 * localStorage 在無痕模式、被封鎖的網站資料或某些內嵌瀏覽器裡會丟例外，所以每次讀寫都包 try/catch，
 * 失敗時照樣能用，只是重新整理後回到「跟隨系統」。
 */
import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** index.html 的繪製前腳本也讀這個鍵；改名時兩邊要一起改。 */
export const THEME_STORAGE_KEY = 'gsat-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredPreference(pref: ThemePreference) {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // 寫不進去就只在這次瀏覽有效，不影響功能。
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** 手機瀏覽器網址列的顏色，與 index.css 的 --surface、index.html 的 theme-color 相同。 */
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#171c23' };

/** 把偏好套用到 <html>：跟隨系統時移除 data-theme，讓 CSS 的媒體查詢接手。 */
function applyThemePreference(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = pref;
  // index.html 有淺色、深色各一個 theme-color（依媒體查詢）。使用者選定主題時兩個都改成同一色，
  // 否則系統是深色、App 選淺色時，網址列會是深色而頁面是淺色。
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const systemTheme: ResolvedTheme = (meta.getAttribute('media') ?? '').includes('dark') ? 'dark' : 'light';
    meta.setAttribute('content', THEME_COLORS[pref === 'system' ? systemTheme : pref]);
  }
}

let preference: ThemePreference = readStoredPreference();
// 載入時套用一次：index.html 的繪製前腳本只設 data-theme（避免閃爍），theme-color 留到這裡同步。
// 少了這一步，系統是深色、使用者選淺色時，每次重新整理後手機網址列都會變回深色。
applyThemePreference(preference);
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(pref: ThemePreference) {
  preference = pref;
  writeStoredPreference(pref);
  applyThemePreference(pref);
  emit();
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 跟隨系統時，使用者在作業系統切換深淺色也要更新切換鈕的圖示。
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  media?.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', listener);
  };
}

/** 目前的偏好（設定頁的選項用）。 */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference, () => 'system');
}

/** 實際生效的主題（切換鈕的圖示與文字用）。 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => resolveTheme(preference),
    () => 'light',
  );
}

/** 測試用：重設模組狀態，避免測試之間互相影響。 */
export function resetThemeForTests() {
  preference = readStoredPreference();
  applyThemePreference(preference);
  emit();
}
