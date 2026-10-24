/**
 * 桌機版面依路徑決定的事（docs/design/desktop-ui.md §2.3、§3.2、§4.2）：內容寬度模式、側邊欄的目前位置與自動收合。
 *
 * Layout 不知道 <Routes> 命中哪一條，所以只看 pathname。對照表用路由樣式寫，以 react-router 的 matchPath 比對，
 * 順序與 App.tsx 相同（靜態段 ai、custom、report 排在 :examId、:paperId 前面）。對照表沒有的路徑一律 default：
 * 新路由忘了登記時也是最安全的寬度（維持 max-w-5xl）。頁面不能自己改模式，避免 lazy 載入完成後才變寬、畫面跳動。
 */
import { matchPath } from 'react-router';
import { PAGES } from '../modules';
import type { SidebarState } from './media';

/**
 * narrow、default、workspace 見 §2.3。list（§16.7）：內容容器和 default 一樣，但頁面本身是放寬的（整頁 bleed 的列表頁），
 * 頁尾也放寬到同樣的寬度，左緣才會和內容對齊（default 的頁尾是 944px 置中，1920 寬時和放寬的內容差 184px）。
 */
export type WidthMode = 'narrow' | 'default' | 'list' | 'workspace';

/**
 * 內容容器在 ≥ lg 的寬度與內距（基底仍是 max-w-5xl px-4 py-6）。--page-px 是內容的左右內距，
 * 工具列與 StickyBar 用 lg:-mx-(--page-px) lg:px-(--page-px) 撐滿內容區；bleed 工具類也用它算寬度。
 */
export const MODE_CLASSES: Record<WidthMode, string> = {
  narrow: 'lg:max-w-4xl lg:[--page-px:2.5rem] lg:py-10',
  default: 'lg:[--page-px:2.5rem] lg:py-10',
  list: 'lg:[--page-px:2.5rem] lg:py-10',
  workspace: 'lg:[--page-px:2rem] lg:py-4',
};

/**
 * 頁尾：寬度與左右內距和內容容器相同，框線才會和內容卡片對齊（§3.1）。list 的頁尾撐滿 main，裡面的 nav 用 bleed
 * （Layout 的 SiteFooter），和頁面放寬的區塊同寬、同一條左緣。
 */
export const FOOTER_MODE_CLASSES: Record<WidthMode, string> = {
  narrow: 'lg:max-w-4xl lg:[--page-px:2.5rem]',
  default: 'lg:[--page-px:2.5rem]',
  list: 'lg:max-w-none lg:[--page-px:2.5rem]',
  workspace: 'lg:[--page-px:2rem]',
};

/** 路由樣式 → 模式（§2.3 的對照表）。依序比對，第一個符合的算數。 */
export const ROUTE_MODES: ReadonlyArray<readonly [pattern: string, mode: WidthMode]> = [
  ['/privacy', 'narrow'],
  ['/terms', 'narrow'],
  ['/about', 'narrow'],
  ['/settings', 'narrow'],
  ['/account', 'narrow'],
  ['/account/welcome', 'narrow'],
  ['/ai/apply', 'narrow'],
  // 整頁放寬的列表頁（§16.7）：首頁（ws 寬度的儀表板）、題庫練習、兩個寫作題型頁、寫作、題目列表、歷屆試題、模擬考。
  // 首頁與 /practice 不到 ws 時是原本的版面，但那時 main 不到 58.5rem，放寬的寬度就等於內容寬，頁尾一樣對齊。
  ['/', 'list'],
  ['/practice', 'list'],
  ['/translation', 'list'],
  ['/composition', 'list'],
  ['/writing', 'list'],
  ['/writing/translation', 'list'],
  ['/writing/essay', 'list'],
  ['/exams', 'list'],
  ['/mock', 'list'],
  ['/vocabulary', 'workspace'],
  ['/cloze', 'workspace'],
  ['/word-bank', 'workspace'],
  ['/structure', 'workspace'],
  ['/reading', 'workspace'],
  ['/mixed', 'workspace'],
  ['/practice/:section/:tier', 'workspace'],
  ['/exams/:examId', 'workspace'],
  ['/mock/report/:attemptId', 'default'],
  ['/mock/:paperId', 'workspace'],
  ['/writing/translation/ai', 'list'],
  ['/writing/translation/ai/:code', 'workspace'],
  ['/writing/translation/:examId', 'workspace'],
  ['/writing/essay/ai', 'list'],
  ['/writing/essay/ai/:code', 'workspace'],
  ['/writing/essay/custom', 'workspace'],
  // 作文範文（docs/design/model-essays.md §8.3）：一定要在 :examId 之前（否則 /writing/essay/exemplars 會先對到作答頁的 workspace）。
  // 首頁（表單、確認、清單）預設寬度；結果頁是工作區（寬度不夠時側邊欄自動收合，三欄才放得下）。
  ['/writing/essay/exemplars', 'default'],
  ['/writing/essay/exemplars/:id', 'workspace'],
  ['/writing/essay/:examId', 'workspace'],
  ['/writing/submissions/:id', 'workspace'],
  // 學習助手（docs/design/learning-assistant.md §1.9）：首頁與錯題清單放寬、確認頁窄版、貼上題目預設寬度、案例頁是工作區。
  ['/assistant', 'list'],
  ['/assistant/mistakes', 'list'],
  ['/assistant/ask', 'narrow'],
  ['/assistant/new', 'default'],
  ['/assistant/case/:id', 'workspace'],
  // 學習報告：預設寬度；ws 寬度起左側加目錄（報告內容自己排）。
  ['/assistant/report', 'default'],
  ['/assistant/report/:version', 'default'],
];

/**
 * 確定走 default、不必列進 ROUTE_MODES 的路由（單字、後台、404）。只給測試用：
 * App.tsx 新增路由時，測試要求它出現在 ROUTE_MODES 或這裡，逼新路由的作者決定寬度。
 */
export const DEFAULT_MODE_ROUTES: readonly string[] = ['/words', '/admin', '*'];

export function desktopWidthMode(pathname: string): WidthMode {
  for (const [pattern, mode] of ROUTE_MODES) {
    if (matchPath({ path: pattern, end: true }, pathname)) return mode;
  }
  return 'default';
}

/** 作答與寫作頁（工作區路由）：寬度不夠時自動收合側邊欄。 */
export function isWorkspaceRoute(pathname: string): boolean {
  return desktopWidthMode(pathname) === 'workspace';
}

/**
 * 側邊欄要標成目前頁的那一項（同一時間只有一項 aria-current="page"）。
 * /writing/translation* 屬於「中譯英」、/writing/essay* 屬於「英文作文」（題目列表與作答頁都是從這兩頁點進去的），
 * 其他 /writing* 是「寫作」；子頁（/exams/gsat-115、/practice/reading/basic）屬於它的列表頁。對不到任何一項時回傳 null。
 */
export function sidebarActivePath(pathname: string): string | null {
  if (/^\/writing\/translation(?:\/|$)/.test(pathname)) return '/translation';
  if (/^\/writing\/essay(?:\/|$)/.test(pathname)) return '/composition';
  if (pathname === '/') return '/';
  for (const page of PAGES) {
    if (page.path !== '/' && (pathname === page.path || pathname.startsWith(`${page.path}/`))) return page.path;
  }
  return null;
}

/**
 * 側邊欄展開或收合（§3.2）：
 *   - < lg 或觸控為主的裝置（沒有 pointer: fine）：一律展開（收合後只剩圖示，沒有 hover 看不懂）；
 *   - 使用者自己設定過：照設定；
 *   - 沒設定過：工作區路由、而且展開時 main 會小於 ws（58.5rem；版面寬 < 1192，lib/media.ts 的 SIDEBAR_AUTO_COLLAPSE_BELOW）
 *     才自動收合（不寫進設定）。
 */
export function resolveSidebarState(opts: {
  pref: SidebarState | null;
  desktop: boolean;
  pointerFine: boolean;
  workspace: boolean;
  narrowForWorkspace: boolean;
}): SidebarState {
  if (!opts.desktop || !opts.pointerFine) return 'expanded';
  if (opts.pref) return opts.pref;
  return opts.workspace && opts.narrowForWorkspace ? 'collapsed' : 'expanded';
}
