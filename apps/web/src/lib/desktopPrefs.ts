/**
 * 電腦版介面的偏好設定（docs/design/desktop-ui.md §4.3）：只存在這台裝置的這個瀏覽器（localStorage）。
 *
 *   gsat-ui:v1:sidebar            'expanded' | 'collapsed'；沒有＝自動（工作區路由寬度不夠時自動收合，§3.2）
 *   gsat-ui:v1:single-key         'on' | 'off'；沒有＝開（§14 第 3 點；WCAG 2.1.4 要能關）
 *   gsat-ui:v1:list-view:{page}   'table' | 'cards'
 *
 * 和 lib/theme.ts 一樣用外部 store＋useSyncExternalStore：鍵盤快捷鍵的判斷（lib/hotkeys.ts）在 React 以外也要讀得到。
 * localStorage 在無痕模式、網站資料被封鎖時會丟例外，每次讀寫都包 try/catch，讀不到就用預設值。
 * 監聽 storage 事件：同一台電腦開兩個分頁時，一邊改了另一邊跟著變。
 */
import { useCallback, useSyncExternalStore } from 'react';

export type DesktopPrefKey = 'sidebar' | 'single-key' | `list-view:${string}`;
export type SidebarPref = 'expanded' | 'collapsed';
export type SingleKeyPref = 'on' | 'off';
export type ListViewPref = 'table' | 'cards';

const PREFIX = 'gsat-ui:v1:';

/** 每一種鍵允許的值；存的值不在清單裡（手改、舊版本）就當成沒有設定。 */
const ALLOWED: Record<'sidebar' | 'single-key' | 'list-view', readonly string[]> = {
  sidebar: ['expanded', 'collapsed'],
  'single-key': ['on', 'off'],
  'list-view': ['table', 'cards'],
};

export function desktopPrefStorageKey(key: DesktopPrefKey): string {
  return PREFIX + key;
}

function allowedValues(key: DesktopPrefKey): readonly string[] {
  return key.startsWith('list-view:') ? ALLOWED['list-view'] : ALLOWED[key as 'sidebar' | 'single-key'];
}

/** 讀偏好；沒有設定、值不合法或 localStorage 不能用時回傳 null。 */
export function readDesktopPref(key: DesktopPrefKey): string | null {
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(desktopPrefStorageKey(key));
  } catch {
    return null;
  }
  return value !== null && allowedValues(key).includes(value) ? value : null;
}

const listeners = new Set<() => void>();

/** 寫偏好；null＝刪掉（回到自動／預設）。寫不進去時只在這次瀏覽有效（畫面仍會更新）。 */
export function writeDesktopPref(key: DesktopPrefKey, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(desktopPrefStorageKey(key));
    else window.localStorage.setItem(desktopPrefStorageKey(key), value);
    memoryFallback.delete(key);
  } catch {
    memoryFallback.set(key, value);
  }
  for (const listener of [...listeners]) listener();
}

/** localStorage 不能用時，這次瀏覽期間的值（重新整理後消失）。 */
const memoryFallback = new Map<DesktopPrefKey, string | null>();

function currentPref(key: DesktopPrefKey): string | null {
  return memoryFallback.has(key) ? (memoryFallback.get(key) ?? null) : readDesktopPref(key);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * 讀寫一個偏好。fallback：沒有設定時的值（側邊欄用 null 表示「自動」）。
 * 回傳的 setter 傳 null 會刪掉設定。
 */
export function useDesktopPref<T extends string>(key: DesktopPrefKey, fallback: T | null): [T | null, (value: T | null) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => currentPref(key),
    () => null,
  );
  const set = useCallback((value: T | null) => writeDesktopPref(key, value), [key]);
  return [(stored as T | null) ?? fallback, set];
}

/** 單鍵快捷鍵有沒有開（預設開）；lib/hotkeys.ts 每次按鍵時讀。 */
export function singleKeysEnabled(): boolean {
  return currentPref('single-key') !== 'off';
}

/** 測試用：清掉 localStorage 不能用時暫存的值。 */
export function resetDesktopPrefsForTests() {
  memoryFallback.clear();
}
