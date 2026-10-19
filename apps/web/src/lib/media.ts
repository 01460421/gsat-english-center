/**
 * 桌機版面的媒體查詢與 main 的實際寬度（docs/design/desktop-ui.md §4.1）。
 *
 * - useMediaQuery／useIsDesktop：lg（64rem＝1024px）分手機與桌機。用 min-width 寫法，和 Tailwind 的 rem 斷點一致；
 *   沒有 SSR，第一次 render 就拿到正確的值；沒有 matchMedia 的環境回傳 false（走手機路徑）。
 * - useMainTier：分欄看 main 的內容寬，不看視窗寬（§2.2）。MainWidthProvider 用 ResizeObserver 量 main，
 *   和 CSS 的 @container/main 量的是同一個寬度；還沒量到時用「版面寬 − 側邊欄寬」同步估算。
 * - 跨斷點時保存焦點：lg 改變、main 的寬度層級改變或側邊欄收合／展開、React 換樹之前，先記下焦點所在元素的 id
 *   （沒有 id 時記標籤、href 與名稱）、游標與捲動位置；新的樹 commit 後找回同一個元素。找不回來就把焦點放在頁面的 <h1>
 *   並暫停單鍵快捷鍵，避免焦點掉到 body、這段時間按的字母去作答。
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { suspendSingleKeys } from './hotkeys';

export const MQ = { lg: '(min-width: 64rem)', pointerFine: '(pointer: fine)' } as const;
/**
 * ＝ index.css 的 --container-ws（58.5rem）／--container-wide（80rem）。ws 不是設計文件的 960：1024 寬、側邊欄收合、
 * Windows 傳統捲軸（17px）時 main 是 943px，要讓這種情況也分欄（docs/design/desktop-ui.md §16.7）。
 */
export const MAIN_TIER_PX = { ws: 936, wide: 1280 } as const;
/** 側邊欄寬（Layout 的 w-64／w-16）。 */
export const SIDEBAR_PX = { expanded: 256, collapsed: 64 } as const;
/** 側邊欄展開時 main 剛好到 ws 寬度的版面寬（扣掉捲軸）：工作區路由低於這個寬度時自動收合（§3.2）。 */
export const SIDEBAR_AUTO_COLLAPSE_BELOW = SIDEBAR_PX.expanded + MAIN_TIER_PX.ws;

export type SidebarState = 'expanded' | 'collapsed';

// ───────────────────────── 跨斷點的焦點保存 ─────────────────────────

interface FocusSnapshot {
  el: Element;
  id: string;
  /**
   * 沒有 id 的元素（首頁卡片、/practice 矩陣的連結）用來找回「同一個」：main 裡同樣標籤、同樣 href（連結）、
   * 同樣可存取名稱的元素。兩棵樹的連結網址與名稱相同（§5.1、§5.2），換樹後找得回來。
   */
  match: { tag: string; href: string | null; name: string } | null;
  selection: { start: number; end: number; direction: 'forward' | 'backward' | 'none' } | null;
  scrollTop: number;
}

let pendingFocus: FocusSnapshot | null = null;
/** 換樹後新的元素還沒出現（按需載入的區塊）時，短時間內再找幾次。 */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_INTERVAL_MS = 50;
const RETRY_FOR_MS = 1500;

function accessibleName(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function selectionOf(el: Element): FocusSnapshot['selection'] {
  if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return null;
  try {
    if (el.selectionStart === null || el.selectionEnd === null) return null;
    return { start: el.selectionStart, end: el.selectionEnd, direction: el.selectionDirection ?? 'none' };
  } catch {
    // 不支援選取的 input（number、email 等在部分瀏覽器會丟例外）
    return null;
  }
}

/**
 * 版面換樹之前呼叫（lg 的 change、main 的寬度層級改變、側邊欄收合或展開）：記下焦點所在的元素（焦點在 body 時清掉紀錄）。
 */
export function captureFocus() {
  if (typeof document === 'undefined') return;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) {
    pendingFocus = null;
    return;
  }
  const match = el.id ? null : { tag: el.tagName, href: el.getAttribute('href'), name: accessibleName(el) };
  pendingFocus = { el, id: el.id, match, selection: selectionOf(el), scrollTop: el.scrollTop };
}

function focusBodyOrRoot(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

/** 新的樹裡「同一個」元素：先看 id，再看 main 裡同標籤、同 href、同名稱的元素（只有一個同 href 的就是它）。 */
function findReplacement(snap: FocusSnapshot): HTMLElement | null {
  if (snap.id) {
    const byId = document.getElementById(snap.id);
    if (byId instanceof HTMLElement) return byId;
  }
  const m = snap.match;
  if (!m || (!m.href && !m.name)) return null;
  const root = document.getElementById('main') ?? document.body;
  const candidates = Array.from(root.getElementsByTagName(m.tag)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0 && (m.href === null || el.getAttribute('href') === m.href),
  );
  if (m.href !== null && candidates.length === 1) return candidates[0] ?? null;
  const named = candidates.filter((el) => accessibleName(el) === m.name);
  return named.length === 1 ? (named[0] ?? null) : null;
}

function focusReplacement(target: HTMLElement, snap: FocusSnapshot) {
  target.focus({ preventScroll: true });
  if (snap.selection && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
    try {
      target.setSelectionRange(snap.selection.start, snap.selection.end, snap.selection.direction);
    } catch {
      // 新的元素不支援選取：只還原焦點
    }
  }
  target.scrollTop = snap.scrollTop;
}

/** 找不回來時：焦點放在頁面的 <h1>（不留在 body，下一次 Tab 不必從頭開始），並暫停單鍵快捷鍵。 */
function focusHeadingFallback() {
  const heading = document.querySelector<HTMLElement>('main h1');
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  // focus() 觸發的 focusin 會解除暫停，所以在聚焦之後才暫停。
  suspendSingleKeys();
}

function stopRetry() {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  document.removeEventListener('pointerdown', stopRetry, true);
  document.removeEventListener('keydown', stopRetry, true);
}

/**
 * 新的樹 commit 之後呼叫（useLayoutEffect）：原本的元素還在而且有焦點就不動；被換掉了就用 id（或 href＋名稱，見 FocusSnapshot）
 * 找回來，focus({ preventScroll: true }) 並還原游標與捲動位置。焦點已經在別的元素上（使用者或程式移過去的）就不搶。
 * 一時找不到（新的區塊是按需載入的，例如首頁儀表板）先暫停單鍵快捷鍵，1.5 秒內每 50ms 再找；使用者先按了鍵或點了滑鼠就不再找。
 * 最後還是找不到：焦點放在頁面的 <h1>，單鍵快捷鍵維持暫停到下一次 pointerdown／focusin（lib/hotkeys.ts）。
 */
export function restoreFocus() {
  const snap = pendingFocus;
  pendingFocus = null;
  if (!snap || typeof document === 'undefined') return;
  if (retryTimer !== null) stopRetry();
  if (!focusBodyOrRoot()) return;
  const target = findReplacement(snap);
  if (target) {
    focusReplacement(target, snap);
    return;
  }
  suspendSingleKeys();
  const deadline = Date.now() + RETRY_FOR_MS;
  const retry = () => {
    retryTimer = null;
    if (!focusBodyOrRoot()) {
      stopRetry();
      return;
    }
    const found = findReplacement(snap);
    if (found) {
      stopRetry();
      focusReplacement(found, snap);
    } else if (Date.now() < deadline) {
      retryTimer = setTimeout(retry, RETRY_INTERVAL_MS);
    } else {
      stopRetry();
      focusHeadingFallback();
    }
  };
  document.addEventListener('pointerdown', stopRetry, true);
  document.addEventListener('keydown', stopRetry, true);
  retryTimer = setTimeout(retry, RETRY_INTERVAL_MS);
}

/** 測試用：清掉還沒還原的焦點紀錄與重試（上一個測試的計時器不能在下一個測試裡移動焦點）。 */
export function resetFocusRestoreForTests() {
  pendingFocus = null;
  if (typeof document !== 'undefined') stopRetry();
}

// ───────────────────────── 媒體查詢 ─────────────────────────

interface QueryEntry {
  mql: MediaQueryList;
  listeners: Set<() => void>;
  onChange: () => void;
}

/** 每個查詢只建一個 MediaQueryList、掛一個 change 監聽，所有用到的元件共用。 */
const queries = new Map<string, QueryEntry>();

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

function subscribeQuery(query: string, listener: () => void): () => void {
  if (!hasMatchMedia()) return () => {};
  let entry = queries.get(query);
  if (!entry) {
    const mql = window.matchMedia(query);
    const listeners = new Set<() => void>();
    const onChange = () => {
      // 先記下焦點，再通知 React（換樹、commit 之後由 MainWidthProvider 還原）。
      captureFocus();
      for (const l of [...listeners]) l();
    };
    mql.addEventListener('change', onChange);
    entry = { mql, listeners, onChange };
    queries.set(query, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.mql.removeEventListener('change', current.onChange);
      queries.delete(query);
    }
  };
}

function queryMatches(query: string): boolean {
  if (!hasMatchMedia()) return false;
  return (queries.get(query)?.mql ?? window.matchMedia(query)).matches;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((listener: () => void) => subscribeQuery(query, listener), [query]);
  return useSyncExternalStore(
    subscribe,
    () => queryMatches(query),
    () => false,
  );
}

/** ≥ lg（1024px）：桌機版面。 */
export const useIsDesktop = () => useMediaQuery(MQ.lg);

/**
 * 版面實際可用的寬度（已扣掉捲軸）。量 <body> 而不是 documentElement.clientWidth：html 在 ≥ lg 設了
 * scrollbar-gutter: stable，捲軸被隱藏時（無頭瀏覽器）gutter 仍保留 15px，documentElement.clientWidth 卻不扣（實測）；
 * <body> 的寬度兩種情況都等於 main 的外框寬。沒有版面引擎的環境（happy-dom）是 0，改用 innerWidth。
 */
export function viewportClientWidth(): number {
  return document.body?.clientWidth || document.documentElement.clientWidth || window.innerWidth;
}

function subscribeResize(listener: () => void) {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/**
 * 版面寬（viewportClientWidth）是否小於 px（側邊欄的自動收合用）。看扣掉捲軸的寬度，不看媒體查詢的視窗寬：
 * Windows 的傳統捲軸約 17px，1200 寬的視窗媒體查詢算 ≥ 1192，main 卻只剩 1200 − 17 − 256 = 927，不到 ws（§16.7）。
 * enabled 為 false 時不讀版面、一律 false。
 */
export function useViewportNarrowerThan(px: number, enabled: boolean): boolean {
  return useSyncExternalStore(
    subscribeResize,
    () => enabled && viewportClientWidth() < px,
    () => false,
  );
}

// ───────────────────────── main 的寬度層級 ─────────────────────────

export interface MainTier {
  /** main 的內容寬（px）；< lg 時是 0。 */
  width: number;
  /** ≥ 58.5rem（936px，§16.7）：寫作分欄、首頁儀表板、列表右欄。 */
  ws: boolean;
  /** ≥ 80rem：三欄網格、第三欄。 */
  wide: boolean;
}

const MOBILE_TIER: MainTier = { width: 0, ws: false, wide: false };
const MainTierContext = createContext<MainTier | null>(null);

function tierOf(width: number): MainTier {
  return { width, ws: width >= MAIN_TIER_PX.ws, wide: width >= MAIN_TIER_PX.wide };
}

/** 還沒量到 main 時的同步估算：版面寬（viewportClientWidth）− 側邊欄寬。 */
export function estimateMainWidth(sidebar: SidebarState): number {
  return Math.max(0, viewportClientWidth() - SIDEBAR_PX[sidebar]);
}

/**
 * useMainTier() 的來源，放在 Layout 的 main 裡。sidebar：目前側邊欄展開或收合（量測值是在另一種狀態下量的就先用估算，
 * 收合、展開的那一個畫面就拿到正確的層級，不等 ResizeObserver）。
 */
export function MainWidthProvider({
  mainRef,
  sidebar,
  children,
}: {
  mainRef: RefObject<HTMLElement | null>;
  sidebar: SidebarState;
  children: ReactNode;
}): ReactNode {
  const isDesktop = useIsDesktop();
  const [measured, setMeasured] = useState<{ width: number; sidebar: SidebarState } | null>(null);
  const sidebarRef = useRef(sidebar);
  const tierRef = useRef(MOBILE_TIER);

  const width = !isDesktop ? 0 : measured && measured.sidebar === sidebar ? measured.width : estimateMainWidth(sidebar);
  const value = useMemo(() => (isDesktop ? tierOf(width) : MOBILE_TIER), [isDesktop, width]);

  useLayoutEffect(() => {
    sidebarRef.current = sidebar;
    tierRef.current = value;
  });

  // useEffect 而不是 useLayoutEffect：Provider 是 <main> 的子元件，layout effect 執行時父元素的 ref 還沒接上。
  // 量到之前一直用估算值，ResizeObserver 的第一次回呼在下一次繪製前就到。
  useEffect(() => {
    const main = mainRef.current;
    if (!isDesktop || !main || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const next = Math.round(entry.contentRect.width);
      const prev = tierRef.current;
      const nextTier = tierOf(next);
      // 層級改變會換樹（例如首頁儀表板）：通知 React 之前先記下焦點。
      if (nextTier.ws !== prev.ws || nextTier.wide !== prev.wide) captureFocus();
      setMeasured((m) => (m && m.width === next && m.sidebar === sidebarRef.current ? m : { width: next, sidebar: sidebarRef.current }));
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, [isDesktop, mainRef]);

  // 新的樹 commit 之後還原焦點（父元件的 layout effect 在子元件之後執行，這時新的輸入框已經在 DOM 裡）。
  useLayoutEffect(() => {
    restoreFocus();
  }, [isDesktop, value.ws, value.wide]);

  return createElement(MainTierContext.Provider, { value }, children);
}

/** main 的寬度層級；< lg 一律 { width: 0, ws: false, wide: false }。不在 MainWidthProvider 裡（元件測試）時用估算。 */
export function useMainTier(): MainTier {
  const context = useContext(MainTierContext);
  const isDesktop = useIsDesktop();
  if (context) return context;
  return isDesktop ? tierOf(estimateMainWidth('expanded')) : MOBILE_TIER;
}

/** 只在 ≥ lg render（有狀態、id 或量大的桌機元件，R3）。 */
export function DesktopOnly({ children }: { children: ReactNode }): ReactNode {
  return useIsDesktop() ? children : null;
}
