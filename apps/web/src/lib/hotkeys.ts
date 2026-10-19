/**
 * 桌機的鍵盤快捷鍵（docs/design/desktop-ui.md §4.4、§8）。
 *
 * document 上只掛一個 keydown 監聽，各元件用 useHotkeys 把自己的快捷鍵登記到同一份表；
 * 「這一頁」的先比對（頁面優先於全站），同一組裡後登記的先比對。說明對話框（ShortcutHelp）用 useActiveHotkeys 讀同一份表。
 *
 * 一律略過：按住不放的自動重複（e.repeat）、別人已經處理過的（defaultPrevented）、按著 Alt、有 modal 對話框開著。
 * 單鍵（沒有 mod）另外略過：按著 Ctrl／⌘、焦點在文字輸入欄位、設定關掉了、跨斷點後的暫停期間（§4.1）、
 * 輸入法正在處理這個鍵（e.key === 'Process'／keyCode 229）。
 * 帶 mod 的組合只有 allowInTextEntry 的才在文字欄位裡作用，而且組字中（isComposing）略過——組字時的 Ctrl＋Enter 是在選字。
 * Enter、空白鍵、方向鍵不註冊成任何快捷鍵：焦點在按鈕或 radio 上時它們有原生作用。
 *
 * 啟用條件一定包含 useIsDesktop()（R7）：手機上一個快捷鍵也不註冊，document 上也不會有監聽。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { singleKeysEnabled } from './desktopPrefs';

export interface HotkeyDef {
  /** 'n'、'?'、'['、'mod+enter'（mod＝Ctrl，Mac 上是 ⌘）、'mod+s'。 */
  keys: string[];
  /** 給 ShortcutHelp 顯示。 */
  description: string;
  group: '全站' | '這一頁';
  /** 只有帶 mod 的組合可以設 true（作文框裡的 Ctrl＋Enter）。 */
  allowInTextEntry?: boolean;
  /** 目前能不能用（例如 `[` 只在有滑鼠的裝置）；false 時不作用，說明對話框也不列。 */
  when?: () => boolean;
  /**
   * 只列在說明對話框裡、按鍵由頁面自己的監聽處理（單字每日學習與測驗原本的空白鍵、Enter、1–4，§4.4「既有，不改」）：
   * 這裡不比對、不 preventDefault，也不受單鍵快捷鍵開關影響（說明對話框另外註明）。
   */
  listOnly?: boolean;
  /** 比對到就呼叫（呼叫前已經 preventDefault）。 */
  run: (e: KeyboardEvent) => void;
}

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** 文字類 input、textarea、select、contenteditable（radio、checkbox、按鈕不算：單鍵快捷鍵在它們上面照樣作用）。 */
export function isTextEntryTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(t.type);
}

/** 所有 input、textarea、select、contenteditable（單字每日學習與測驗原本的判斷，行為不變）。 */
export function isFormControlTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** 有沒有 modal 對話框開著（原生 <dialog> 的 showModal，或標了 aria-modal 的自製對話框）。 */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.querySelector('dialog:modal, [aria-modal="true"]') !== null;
  } catch {
    // 不認得 :modal 的環境
    return document.querySelector('[aria-modal="true"]') !== null;
  }
}

/** Mac 上 mod 是 ⌘，其他平台是 Ctrl。 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? '');
}

/**
 * 這次按鍵代表的字元（小寫）：e.key 是單一個 ASCII 字母、數字、`[` 或 `?` 時用它（Dvorak 等配置照字面）。
 * 標點（`[`、`?`）只看 e.key：德文鍵盤的 ü、日文鍵盤的 @、法文鍵盤的 ^ 死鍵都在 `[` 的實體位置，不能拿 e.code 退回去。
 * 字母與數字的 e.code 退路（KeyA–KeyZ、Digit／Numpad 0–9）只給「不是拉丁字母的字」（某些輸入法送出「ㄅ」這類注音、
 * 俄文鍵盤的字母）：é、ü 這類拉丁字母是鍵盤上真的字，法文鍵盤的 é 在 2 的位置，不能當成 2（§16.7）。
 */
export function hotkeyChar(e: Pick<KeyboardEvent, 'key' | 'code'>): string | null {
  if (/^[A-Za-z0-9[?]$/.test(e.key)) return e.key.toLowerCase();
  // 單一個非 ASCII、也不是拉丁字母的字才退回實體按鍵（[...e.key]：一個字可能是兩個 UTF-16 單位）。
  if ([...e.key].length !== 1 || e.key.charCodeAt(0) < 0x80 || /\p{Script=Latin}/u.test(e.key)) return null;
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter?.[1]) return letter[1].toLowerCase();
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (digit?.[1]) return digit[1];
  return null;
}

interface ParsedKey {
  mod: boolean;
  key: string;
}

function parseKey(spec: string): ParsedKey {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  return { mod: parts.includes('mod'), key };
}

function matchesKey(p: ParsedKey, e: KeyboardEvent, char: string | null): boolean {
  if (p.mod) {
    const mac = isMacPlatform();
    // 只按 mod（Mac 的 ⌘、其他的 Ctrl），另一個修飾鍵或 Shift 也按著就不是這個組合。
    if (!(mac ? e.metaKey : e.ctrlKey) || (mac ? e.ctrlKey : e.metaKey) || e.shiftKey) return false;
    return p.key === 'enter' ? e.key === 'Enter' : char === p.key;
  }
  return char !== null && char === p.key;
}

// ───────────────────────── 暫停單鍵快捷鍵（§4.1） ─────────────────────────

let suspended = false;

function resumeSingleKeys() {
  suspended = false;
  document.removeEventListener('pointerdown', resumeSingleKeys, true);
  document.removeEventListener('focusin', resumeSingleKeys, true);
}

/**
 * 跨斷點換樹後找不回焦點（焦點落在 body）時呼叫：這段時間按的字母不能去作答。
 * 下一次 pointerdown 或 focusin（使用者點了某處、Tab 到某處）自動解除。
 */
export function suspendSingleKeys() {
  if (suspended || typeof document === 'undefined') return;
  suspended = true;
  document.addEventListener('pointerdown', resumeSingleKeys, true);
  document.addEventListener('focusin', resumeSingleKeys, true);
}

export function singleKeysSuspended(): boolean {
  return suspended;
}

// ───────────────────────── 登記表與 document 上唯一的監聽 ─────────────────────────

interface Registration {
  defs: readonly HotkeyDef[];
  seq: number;
}

const registrations = new Set<Registration>();
const registryListeners = new Set<() => void>();
let nextSeq = 0;
let listening = false;
const EMPTY: readonly HotkeyDef[] = [];
let activeSnapshot: readonly HotkeyDef[] = EMPTY;

/** 比對順序：「這一頁」先於「全站」，同一組後登記的先。 */
function orderedDefs(): HotkeyDef[] {
  const page: HotkeyDef[] = [];
  const site: HotkeyDef[] = [];
  for (const reg of [...registrations].sort((a, b) => b.seq - a.seq)) {
    for (const def of reg.defs) (def.group === '這一頁' ? page : site).push(def);
  }
  return [...page, ...site];
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.defaultPrevented || e.altKey || isModalOpen()) return;
  const char = hotkeyChar(e);
  const textEntry = isTextEntryTarget(e.target);
  for (const def of orderedDefs()) {
    if (def.listOnly) continue;
    for (const spec of def.keys) {
      const p = parseKey(spec);
      if (!matchesKey(p, e, char)) continue;
      if (p.mod) {
        if (textEntry && (!def.allowInTextEntry || e.isComposing)) continue;
      } else if (
        e.ctrlKey ||
        e.metaKey ||
        textEntry ||
        suspended ||
        e.key === 'Process' ||
        e.keyCode === 229 ||
        !singleKeysEnabled()
      ) {
        continue;
      }
      if (def.when && !def.when()) continue;
      e.preventDefault();
      def.run(e);
      return;
    }
  }
}

function syncListener() {
  const need = registrations.size > 0;
  if (need && !listening) document.addEventListener('keydown', onKeyDown);
  if (!need && listening) document.removeEventListener('keydown', onKeyDown);
  listening = need;
}

function emitRegistry() {
  activeSnapshot = registrations.size === 0 ? EMPTY : orderedDefs();
  for (const listener of [...registryListeners]) listener();
}

/**
 * 登記一組快捷鍵。defs 要用 useMemo 固定（每次換新的陣列會重新登記）；enabled 一定包含 useIsDesktop()（R7）。
 */
export function useHotkeys(defs: readonly HotkeyDef[], options: { enabled: boolean }): void {
  const { enabled } = options;
  useEffect(() => {
    if (!enabled || defs.length === 0) return;
    nextSeq += 1;
    const reg: Registration = { defs, seq: nextSeq };
    registrations.add(reg);
    syncListener();
    emitRegistry();
    return () => {
      registrations.delete(reg);
      syncListener();
      emitRegistry();
    };
  }, [defs, enabled]);
}

function subscribeRegistry(listener: () => void) {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/** 目前登記的快捷鍵（比對順序；ShortcutHelp 依 group 分組、用 when() 過濾）。 */
export function useActiveHotkeys(): readonly HotkeyDef[] {
  return useSyncExternalStore(
    subscribeRegistry,
    () => activeSnapshot,
    () => EMPTY,
  );
}

/** 顯示用的按鍵名稱：'mod+enter' → ['Ctrl', 'Enter']（Mac 是 ⌘）；字母顯示大寫；'space'（只用在 listOnly）→ 空白鍵。 */
export function hotkeyLabels(spec: string): string[] {
  const { mod, key } = parseKey(spec);
  const name = key === 'enter' ? 'Enter' : key === 'space' ? '空白鍵' : key.length === 1 ? key.toUpperCase() : key;
  return mod ? [isMacPlatform() ? '⌘' : 'Ctrl', name] : [name];
}

/** 測試用：清掉登記表、暫停狀態與 document 上的監聽。 */
export function resetHotkeysForTests() {
  registrations.clear();
  syncListener();
  emitRegistry();
  if (suspended) resumeSingleKeys();
}
