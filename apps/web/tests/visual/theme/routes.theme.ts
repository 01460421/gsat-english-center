/**
 * 全站 CSS 改版的截圖與量測（設定與用法見 theme.config.ts；設計文件 docs/design/css-overhaul.md §1、§9）。
 *
 * 每個主要路由進頁面就截一張整頁圖，並量：
 *   - overflow：文件比視窗寬（水平捲動）＋超出右緣最多的幾個元素；
 *   - tinyText：可見文字小於 12px／14px 的元素數（含例子）；
 *   - targets：可點的元素（a、button、input、select、summary、[role=button|tab|radio|checkbox]）寬或高小於 24／44px 的個數；
 *   - cls：layout-shift 的累計值（載入到截圖之間，不含使用者輸入後 500ms 內的位移）；
 *   - axe：有給 THEME_SHOTS_AXE 時，axe-core 的 color-contrast 違規數（含例子）。
 * 主題：深色用 localStorage 的 gsat-theme（走手動切換那條路，index.html 的繪製前腳本會在第一次繪製前套用）。
 * 確定性：時間固定、Math.random 固定、關掉動畫（同 ../capture.shots.ts），後端一律用假的（tests/support/backend.ts）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { FeaturesResponse } from '@gsat/shared';
import { ADMIN_HEALTH, ADMIN_USAGE, FEATURES_CUSTOM_ON, fakeAssist, fakeBackend, fakeReports, ok } from '../../support/backend';
import { BANK_CP_CODE, BANK_TR_CODE, FIXED_NOW, QUOTA_NOW, SUBMISSIONS, historyRows, meFor, type Who } from '../fixtures';

const OUT = process.env['THEME_SHOTS_OUT'];
if (!OUT) throw new Error('THEME_SHOTS_OUT 沒有設定：請用 tests/visual/theme/theme.config.ts 執行');
const AXE = process.env['THEME_SHOTS_AXE'];
const AXE_SRC = AXE ? readFileSync(AXE, 'utf8') : null;

const FEATURES_ASSISTANT: FeaturesResponse = { ...FEATURES_CUSTOM_ON, assistant: true, assistantPhoto: true };

/** [檔名, 網址, 帳號狀態, 學習助手開關]。帶參數的子頁用建置資料裡真的 id（同 ../capture.shots.ts）。 */
const ROUTES: Array<[string, string, Who, boolean?]> = [
  ['01-home', '/', 'anon'],
  ['01-home-student', '/', 'student'],
  ['02-words', '/words', 'anon'],
  ['02-words-quiz', '/words?tab=quiz', 'anon'],
  ['03-practice', '/practice', 'anon'],
  ['04-reading-section', '/reading', 'anon'],
  ['05-practice-session-cloze', '/practice/cloze/advanced', 'anon'],
  ['05-practice-session-reading', '/practice/reading/basic', 'anon'],
  ['06-exams', '/exams', 'anon'],
  ['07-exam-paper', '/exams/gsat-115', 'anon'],
  ['08-mock', '/mock', 'anon'],
  ['09-mock-paper', '/mock/gsat-115', 'anon'],
  ['10-writing', '/writing', 'student'],
  ['11-writing-essay-list', '/writing/essay', 'anon'],
  ['12-writing-essay-exam', '/writing/essay/gsat-115', 'student'],
  ['13-writing-translation-ai', `/writing/translation/ai/${BANK_TR_CODE}`, 'student'],
  ['14-writing-essay-ai', `/writing/essay/ai/${BANK_CP_CODE}`, 'student'],
  ['15-writing-submission', '/writing/submissions/sub-e1', 'student'],
  ['16-assistant', '/assistant', 'student', true],
  ['17-assistant-new', '/assistant/new?mode=paste', 'student', true],
  ['18-assistant-report', '/assistant/report', 'student', true],
  ['19-account-anon', '/account', 'anon'],
  ['20-account', '/account', 'student'],
  ['21-settings', '/settings', 'student'],
  ['22-admin', '/admin', 'admin'],
  ['23-about', '/about', 'anon'],
  ['24-zh-writing', '/zh-writing', 'student', true],
];

function determinism() {
  Math.random = () => 0.5;
  // layout-shift 從頁面一開始就記（buffered 也拿得到，但先掛好比較保險）。
  const w = window as unknown as { __cls: number; __clsSources: string[] };
  w.__cls = 0;
  w.__clsSources = [];
  try {
    new PerformanceObserver((list) => {
      type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: Array<{ node?: Node | null }> };
      for (const e of list.getEntries() as Shift[]) {
        if (e.hadRecentInput) continue;
        w.__cls += e.value;
        const node = e.sources?.[0]?.node;
        if (node instanceof Element && w.__clsSources.length < 8) {
          const cls = typeof node.className === 'string' ? node.className.split(/\s+/).slice(0, 5).join('.') : '';
          w.__clsSources.push(`${e.value.toFixed(3)} @${Math.round(e.startTime)}ms ${node.tagName.toLowerCase()}.${cls}`);
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // 不支援就是 0。
  }
}

const STABLE_CSS =
  '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}';

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByText(/^載入中…$/)).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  await page.mouse.move(0, 0);
}

/** 在頁面裡量版面（字級、點擊目標、水平溢出）。 */
function measure() {
  const vw = document.documentElement.clientWidth;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const describe = (el: Element) => {
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 6).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  // 字級：有直接文字子節點的可見元素。
  const sizes: Record<string, number> = {};
  const tiny12: string[] = [];
  const tiny14: string[] = [];
  let tiny12Count = 0;
  let tiny14Count = 0;
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
    if (!hasText || !visible(el)) continue;
    if (el.closest('.sr-only, svg')) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    sizes[String(fs)] = (sizes[String(fs)] ?? 0) + 1;
    if (fs < 12) {
      tiny12Count += 1;
      if (tiny12.length < 8) tiny12.push(`${fs}px ${describe(el)}`);
    } else if (fs < 14) {
      tiny14Count += 1;
      if (tiny14.length < 8) tiny14.push(`${fs}px ${describe(el)}`);
    }
  }
  // 點擊目標。
  const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=link]';
  let lt24 = 0;
  let lt44 = 0;
  let total = 0;
  const small: string[] = [];
  for (const raw of Array.from(document.querySelectorAll(sel))) {
    // 視覺隱藏的 input（sr-only）由外層的 label 當點擊目標；跳到主要內容的連結只在聚焦時出現，不算。
    const el = raw.classList.contains('sr-only') ? raw.closest('label') : raw;
    if (!el || el.closest('.sr-only') || !visible(el)) continue;
    // 文字段落裡的行內連結不算（WCAG 2.5.8 的例外）。
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li')) continue;
    total += 1;
    const r = el.getBoundingClientRect();
    const m = Math.min(r.width, r.height);
    if (m < 44) lt44 += 1;
    if (m < 24) {
      lt24 += 1;
      if (small.length < 8) small.push(`${Math.round(r.width)}×${Math.round(r.height)} ${describe(el)}`);
    }
  }
  // 水平溢出：超出視窗右緣的元素（只列最外層的幾個）。
  const over: string[] = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 0 && visible(el)) {
      const parent = el.parentElement?.getBoundingClientRect();
      if (parent && parent.right > vw + 1) continue;
      if (over.length < 6) over.push(`${Math.round(r.right - vw)}px ${describe(el)}`);
    }
  }
  return {
    clientWidth: vw,
    scrollWidth: document.documentElement.scrollWidth,
    docHeight: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth > vw,
    overflowing: over,
    fontSizes: sizes,
    tiny12: { count: tiny12Count, examples: tiny12 },
    tiny12to14: { count: tiny14Count, examples: tiny14 },
    targets: { total, lt24, lt44, examples: small },
    cls: (window as unknown as { __cls?: number }).__cls ?? 0,
    clsSources: (window as unknown as { __clsSources?: string[] }).__clsSources ?? [],
    dataTheme: document.documentElement.dataset['theme'] ?? 'system',
  };
}

test.describe.configure({ mode: 'parallel' });

for (const [name, url, who, assistant] of ROUTES) {
  test(name, async ({ page }, testInfo) => {
    const theme = (testInfo.project.metadata as { theme: 'light' | 'dark' }).theme;
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.clock.setFixedTime(FIXED_NOW);
    await page.addInitScript(determinism);
    await page.addInitScript((t) => {
      try {
        if (t === 'dark') localStorage.setItem('gsat-theme', 'dark');
      } catch {
        // 無痕模式
      }
    }, theme);
    const backend = await fakeBackend(page, {
      features: assistant ? FEATURES_ASSISTANT : FEATURES_CUSTOM_ON,
      me: meFor(who),
      quota: QUOTA_NOW,
    });
    if (who === 'student' || who === 'admin') {
      backend.on('GET /api/submissions', (call) => ok({ submissions: historyRows(call.query.get('kind')), next_cursor: null }));
      for (const [id, d] of Object.entries(SUBMISSIONS)) backend.on(`GET /api/submissions/${id}`, () => ok(d));
    }
    if (who === 'admin') {
      backend.on('GET /api/admin/health', () => ok(ADMIN_HEALTH));
      backend.on('GET /api/admin/users', () => ok({ users: [], next_cursor: null, approval: { cap: 49, approved: 12 } }));
      backend.on('GET /api/admin/usage', (call) => ok({ from: call.query.get('from'), to: call.query.get('to'), ...ADMIN_USAGE }));
    }
    if (assistant) {
      fakeAssist(backend);
      fakeReports(backend);
    }
    await page.goto(url);
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    const metrics = await page.evaluate(measure);
    let axe: { incomplete: number; violations: number; nodes: number; examples: string[] } | null = null;
    if (AXE_SRC) {
      await page.addScriptTag({ content: AXE_SRC });
      axe = await page.evaluate(async () => {
        const w = window as unknown as {
          axe: { run: (ctx: Document, opts: object) => Promise<{ incomplete: Array<{ nodes: unknown[] }>; violations: Array<{ id: string; nodes: Array<{ target: string[]; any: Array<{ message: string }> }> }> }> };
        };
        const res = await w.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
        const nodes = res.violations.flatMap((v) => v.nodes);
        return {
          incomplete: res.incomplete.flatMap((v) => v.nodes).length,
          violations: res.violations.length,
          nodes: nodes.length,
          examples: nodes.slice(0, 10).map((n) => `${n.target.join(' ')} — ${n.any[0]?.message ?? ''}`),
        };
      });
    }
    await page.addStyleTag({ content: STABLE_CSS });
    const dir = path.join(OUT as string, testInfo.project.name);
    mkdirSync(dir, { recursive: true });
    // 桌機不用 fullPage（Chromium 截圖時會暫時縮小視窗，(min-width: 64rem) 失效、頁面換成手機的樹；見 ../capture.shots.ts），
    // 改成把視窗拉高到整頁高度再截；側邊欄固定成原本的視窗高。
    const vp = page.viewportSize();
    const tall = vp !== null && vp.width >= 1024;
    if (tall) {
      await page.addStyleTag({ content: `aside[data-sidebar]{bottom:auto!important;height:${vp.height}px!important}` });
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(vp.height, h), 16_000) });
      await settle(page);
    }
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: !tall, animations: 'disabled', caret: 'hide' });
    const metaDir = path.join(OUT as string, '_meta', testInfo.project.name);
    mkdirSync(metaDir, { recursive: true });
    writeFileSync(path.join(metaDir, `${name}.json`), JSON.stringify({ name, url, who, theme, ...metrics, axe, errors }, null, 2));
  });
}
