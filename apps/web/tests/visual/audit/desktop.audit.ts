/**
 * 桌機改版的前後對照截圖（docs/design/desktop-polish.md §5.0「截圖工具」、附錄 B；設定在 audit.config.ts，用法見 README.md）。
 *
 * 和 ../capture.shots.ts 用同一套假後端（tests/support/backend.ts）、固定時鐘、Math.random = 0.5、關掉動畫，另外：
 *   - 功能開關照正式站（登入、AI、OCR、自訂題目批改、學習助手與拍照問題目全開）；
 *   - 涵蓋較新的頁面（學習助手、本站自組模擬考、單字講義、殼層的浮層）；
 *   - 每個狀態一張視窗圖（打開時的第一個畫面），頁面會捲動時另一張整頁圖（__full）。
 * 檔名：<序號>-<頁面>-<狀態>__<寬x高>[__dark][__full].png，放在 AUDIT_OUT；每張一個 JSON 紀錄放在 AUDIT_META（make-index.mjs 用）。
 * 各 PR 新增的狀態加在對應的流程測試裡（名稱和改版前的截圖對得起來）；只有改到手機的修正才另外截 375x812（ShotOpts.mobile）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { FeaturesResponse } from '@gsat/shared';
import {
  ADMIN_HEALTH,
  ADMIN_USAGE,
  FEATURES_CUSTOM_ON,
  adminUserRow,
  fakeAssist,
  fakeBackend,
  fakeReports,
  ok,
  type FakeBackend,
  type Handler,
  type Reply,
} from '../../support/backend';
import {
  B1,
  B2,
  BANK_CP_CODE,
  BANK_TR_CODE,
  CUSTOM_ESSAY,
  CUSTOM_PROMPT_TEXT,
  EXAM_ESSAY,
  FIXED_NOW,
  NOW_S,
  OPS,
  QUOTA_NOW,
  SUBMISSIONS,
  T1,
  T2,
  historyRows,
  meFor,
  type Who,
} from '../fixtures';

function requiredEnv(name: 'AUDIT_OUT' | 'AUDIT_META'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 沒有設定：請用 tests/visual/audit/audit.config.ts 執行`);
  return value;
}
const OUT = requiredEnv('AUDIT_OUT');
const META = requiredEnv('AUDIT_META');

/** Production switches (2026-10-23): everything on. */
const PROD: FeaturesResponse = { ...FEATURES_CUSTOM_ON, assistant: true, assistantPhoto: true };

// ───────────────────────── fake backend ─────────────────────────

/** FakeAssist / FakeReports stamp real wall-clock seconds; shift them back to the fixed clock the page sees. */
function shiftTimes(json: unknown): unknown {
  const off = Math.floor(Date.now() / 1000) - NOW_S;
  return JSON.parse(JSON.stringify(json), (k, v) => (typeof v === 'number' && /_at$/.test(k) && v > NOW_S + 600 ? v - off : v));
}

async function backendFor(page: Page, who: Who): Promise<FakeBackend> {
  const backend = await fakeBackend(page, {
    features: PROD,
    me: meFor(who),
    quota: who === 'student-none' ? { ...QUOTA_NOW, ai_status: 'none' } : QUOTA_NOW,
  });
  backend.on('GET /api/health', () => ok({ ok: true, service: 'gsat-english-api', version: '0.0.0-audit', time: FIXED_NOW.toISOString() }));
  // Learning assistant + reports, with timestamps shifted onto the fixed clock.
  const on = backend.on.bind(backend);
  backend.on = ((key: string, handler: Handler | object) => {
    const fn: Handler = typeof handler === 'function' ? (handler as Handler) : () => ok(handler);
    return on(key, async (call) => {
      const r: Reply = await fn(call);
      return r.json !== undefined ? { ...r, json: shiftTimes(r.json) } : r;
    });
  }) as FakeBackend['on'];
  fakeAssist(backend);
  fakeReports(backend);
  backend.on = on;
  if (who === 'student' || who === 'admin') {
    backend.on('GET /api/submissions', (call) => ok({ submissions: historyRows(call.query.get('kind')), next_cursor: null }));
    for (const [id, d] of Object.entries(SUBMISSIONS)) backend.on(`GET /api/submissions/${id}`, () => ok(d));
    for (const [id, op] of Object.entries(OPS)) {
      const sub = Object.values(SUBMISSIONS).find((d) => d.op_id === id);
      backend.on(`GET /api/ai/ops/${id}`, {
        op_id: id,
        task: op.task,
        status: op.status,
        submission_id: sub?.id ?? null,
        submission_status: sub?.status ?? null,
        points_reserved: op.points,
        points_charged: op.status === 'settled' ? op.points : null,
        refund_reason: null,
        created_at: NOW_S - 7200,
        settled_at: op.status === 'settled' ? NOW_S - 7000 : null,
      });
    }
  }
  if (who === 'admin') {
    const pending = [
      adminUserRow('u-101', '學生甲', { ai_applied_at: NOW_S - 86_400, last_active_day: '2026-10-17' }),
      adminUserRow('u-102', '學生乙', { age_band: 'under18', ai_applied_at: NOW_S - 3600, last_active_day: '2026-10-18' }),
      adminUserRow('u-103', '學生丙', { ai_applied_at: NOW_S - 600, last_active_day: '2026-10-18' }),
    ];
    backend.on('GET /api/admin/health', () => ok(ADMIN_HEALTH));
    backend.on('GET /api/admin/users', (call) =>
      ok({ users: call.query.get('ai_status') === 'pending' ? pending : [], next_cursor: null, approval: { cap: 49, approved: 12 } }),
    );
    backend.on('GET /api/admin/usage', (call) => ok({ from: call.query.get('from'), to: call.query.get('to'), ...ADMIN_USAGE }));
  }
  return backend;
}

// ───────────────────────── determinism + shots ─────────────────────────

function determinism() {
  Math.random = () => 0.5;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    crypto.randomUUID = () => {
      let n = 0;
      try {
        n = Number(sessionStorage.getItem('__shots_uuid') ?? '0') + 1;
        sessionStorage.setItem('__shots_uuid', String(n));
      } catch {
        n = Date.now();
      }
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`;
    };
  }
}

const STABLE_CSS = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important;scroll-behavior:auto!important}`;

async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByText(/^載入中…$/)).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(async (css) => {
    if (!document.getElementById('__shots_style')) {
      const style = document.createElement('style');
      style.id = '__shots_style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    for (const img of Array.from(document.images)) if (img.loading === 'lazy') img.loading = 'eager';
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 5_000);
            }),
        ),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, STABLE_CSS);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.mouse.move(0, 0);
}

interface ShotOpts {
  /** Also captured in the 1440x900 dark project. */
  dark?: boolean;
  /** Also captured in the 375x812 project (only for fixes that change phones too, so the owner can see the difference). */
  mobile?: boolean;
  /** false: viewport only (dialogs, menus). */
  full?: boolean;
  /** Keep the current scroll position (viewport shot of a section further down); implies no __full. */
  keepScroll?: boolean;
}

interface Ctx {
  page: Page;
  testInfo: TestInfo;
  backend: FakeBackend;
  who: Who;
  errors: string[];
  shot: (name: string, desc: string, opts?: ShotOpts) => Promise<void>;
}

const projectOf = (testInfo: TestInfo) => {
  const name = testInfo.project.name;
  return { dark: name.endsWith('-dark'), mobile: name === '375x812', vp: name.replace(/-dark$/, '') };
};

async function stableShot(page: Page): Promise<Buffer> {
  const opts = { fullPage: false, animations: 'disabled', caret: 'hide', scale: 'css' } as const;
  let png = await page.screenshot(opts);
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(200);
    const again = await page.screenshot(opts);
    if (again.equals(png)) return again;
    png = again;
  }
  return png;
}

async function setup(page: Page, testInfo: TestInfo, who: Who): Promise<Ctx> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()} ${msg.location().url ?? ''}`.trim());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  await page.clock.setFixedTime(FIXED_NOW);
  await page.addInitScript(determinism);
  const backend = await backendFor(page, who);
  const { dark, mobile, vp } = projectOf(testInfo);
  const c: Ctx = {
    page,
    testInfo,
    backend,
    who,
    errors,
    shot: async (name, desc, opts = {}) => {
      if ((dark && !opts.dark) || (mobile && !opts.mobile)) return;
      await settle(page);
      if (!opts.keepScroll) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await frames(page);
      }
      const base = `${name}__${vp}${dark ? '__dark' : ''}`;
      mkdirSync(OUT, { recursive: true });
      if (mobile) {
        // 手機照 capture.shots.ts 的做法用 Playwright 的整頁截圖（手機不會因為縮放視窗換樹）。
        writeFileSync(path.join(OUT, `${base}.png`), await page.screenshot({ fullPage: !opts.keepScroll && opts.full !== false, animations: 'disabled', caret: 'hide', scale: 'css' }));
        const url = new URL(page.url());
        mkdirSync(META, { recursive: true });
        writeFileSync(
          path.join(META, `${base}.json`),
          JSON.stringify({ name, desc, vp, dark, who, url: `${url.pathname}${url.search}${url.hash}`, files: [`${base}.png`], fullHeight: null, converged: null, unrolled: false, scrollY: 0, innerHeight: 812, docHeight: 0, errors: [...errors] }, null, 2),
        );
        return;
      }
      writeFileSync(path.join(OUT, `${base}.png`), await stableShot(page));
      const before = await page.evaluate(() => ({
        title: document.title,
        scrollY: Math.round(window.scrollY),
        innerHeight: window.innerHeight,
        docHeight: document.documentElement.scrollHeight,
        docWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        sidebar: document.querySelector('aside[data-sidebar]')?.getAttribute('data-sidebar') ?? null,
      }));
      const files = [`${base}.png`];
      let fullHeight: number | null = null;
      let converged: boolean | null = null;
      let unrolled = false;
      if (opts.full !== false && !opts.keepScroll && before.docHeight > before.innerHeight + 2) {
        // Same technique as capture.shots.ts: grow the viewport to the document height (Playwright's fullPage would briefly
        // shrink the viewport and flip the (min-width: 64rem) media query); the fixed sidebar is pinned to the first screen.
        const viewport = page.viewportSize()!;
        // The split Workspace (assistant case page) is exactly 100dvh tall with two internally scrolling panes: growing the
        // viewport would grow the panes forever. Unroll it for the full shot (panes at content height, no inner scroll).
        unrolled = await page.evaluate((h) => {
          const style = document.createElement('style');
          style.id = '__shots_tall';
          const ws = document.querySelector('[data-workspace][data-split="auto"]');
          style.textContent =
            `aside[data-sidebar]{bottom:auto!important;height:${h}px!important}` +
            (ws
              ? `[data-workspace]>div:last-child{height:auto!important;min-height:0!important}` +
                `[data-workspace] [class*="overflow-y-auto"]{overflow:visible!important;max-height:none!important}` +
                `[data-workspace] [data-pane] [class*="flex-1"]{flex:none!important}` +
                `[data-workspace] [class*="min-h-0"]{min-height:auto!important}`
              : '');
          document.head.appendChild(style);
          return Boolean(ws);
        }, viewport.height);
        await frames(page);
        let height = await page.evaluate(() => document.documentElement.scrollHeight);
        converged = false;
        for (let i = 0; i < 4; i += 1) {
          await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
          await frames(page);
          const next = await page.evaluate(() => document.documentElement.scrollHeight);
          if (next === height) {
            converged = true;
            break;
          }
          height = next;
        }
        fullHeight = height;
        writeFileSync(path.join(OUT, `${base}__full.png`), await stableShot(page));
        await page.evaluate(() => document.getElementById('__shots_tall')?.remove());
        await page.setViewportSize(viewport);
        await frames(page);
        files.push(`${base}__full.png`);
      }
      const url = new URL(page.url());
      const metaFile = path.join(META, `${base}.json`);
      mkdirSync(META, { recursive: true });
      writeFileSync(
        metaFile,
        JSON.stringify(
          { name, desc, vp, dark, who, url: `${url.pathname}${url.search}${url.hash}`, files, fullHeight, converged, unrolled, ...before, errors: [...errors] },
          null,
          2,
        ),
      );
    },
  };
  return c;
}

/** Skip the whole test in the dark (or mobile) project when none of its shots are wanted there. */
function darkGate(testInfo: TestInfo, wantsDark: boolean, wantsMobile = false) {
  const p = projectOf(testInfo);
  test.skip(p.dark && !wantsDark, 'not in the dark set');
  test.skip(p.mobile && !wantsMobile, 'not in the mobile set');
}

async function open(c: Ctx, url: string) {
  await c.page.goto(url);
  await expect(c.page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
  await settle(c.page);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function expectAnswered(page: Page, n: number) {
  await expect(page.getByText(new RegExp(`已答 ${n}／\\d+`)).first()).toBeVisible();
}

async function answerRadios(page: Page, n: number): Promise<number> {
  const cards = page.locator('[id^="q-"]').filter({ has: page.getByRole('radio') });
  const count = Math.min(n, await cards.count());
  for (let i = 0; i < count; i += 1) {
    const radios = cards.nth(i).getByRole('radio');
    const total = await radios.count();
    const radio = radios.nth(i % Math.max(total, 1));
    await radio.check();
    await expect(radio).toBeChecked();
  }
  return count;
}

async function fillBlanks(page: Page, n: number) {
  for (let i = 0; i < n; i += 1) {
    const blank = page.getByRole('button', { name: /^第 \S+ 題空格，未作答/ }).first();
    if ((await blank.count()) === 0) return;
    const label = /^第 (\S+) 題空格/.exec((await blank.getAttribute('aria-label')) ?? '')?.[1];
    if (!label) throw new Error('blank label');
    await blank.click();
    const group = page.getByRole('group', { name: `第 ${label} 題的選項`, exact: true });
    await expect(group).toBeVisible();
    const options = group.getByRole('button', { name: /^\([A-Z]\)/ });
    await options.nth(i % Math.max(await options.count(), 1)).click();
    await expect(page.getByRole('button', { name: new RegExp(`^第 ${escapeRe(label)} 題空格，已填`) })).toBeVisible();
    await expect(group).toBeHidden();
  }
}

async function submitPractice(page: Page) {
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();
}

async function fillTranslation(page: Page, a: string, b: string) {
  const inputs = page.getByRole('textbox', { name: /英文譯文/ });
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(a);
  await inputs.nth(1).fill(b);
}

async function keyboardFocus(page: Page, target: Locator) {
  await target.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

test.describe.configure({ mode: 'parallel' });

/** 375x812（手機）只跑有手機截圖的流程（改到手機的修正；其他測試在手機上沒有東西可截）。 */
const MOBILE_TESTS = new Set(['05-practice-reading-flow', '12-exam-paper-exam-flow']);
test.beforeEach(({ page: _page }, testInfo) => {
  test.skip(projectOf(testInfo).mobile && !MOBILE_TESTS.has(testInfo.title), 'not in the mobile set');
});

// ───────────────────────── static pages ─────────────────────────

const WORD = encodeURIComponent('abandon|v.|4');
type Static = [name: string, url: string, who: Who, desc: string, dark?: boolean];
const STATIC: Static[] = [
  ['01-home-anon', '/', 'anon', '首頁儀表板，未登入、這台裝置沒有任何學習紀錄', true],
  ['01-home-student-fresh', '/', 'student', '首頁儀表板，已登入（AI 已核准、剩 20／30 點、伺服器有寫作紀錄），但這台裝置沒有本機學習紀錄'],
  ['02-words-library', '/words', 'anon', '單字：單字庫分頁（預設篩選 L3–5）', true],
  ['02-words-study', '/words?tab=study', 'anon', '單字：每日學習分頁（開始前）'],
  ['02-words-quiz', '/words?tab=quiz', 'anon', '單字：測驗分頁（開始前）'],
  ['02-words-mistakes-empty', '/words?tab=mistakes', 'anon', '單字：錯題本分頁（沒有錯題）'],
  ['02-words-word-card', `/words?word=${WORD}`, 'anon', '單字：單字卡 abandon (v.) L4', true],
  ['02-words-handout', '/words?handout=1', 'anon', '單字：做成講義（預設 Level 3 第 1 份、講義版）', true],
  ['03-practice-menu', '/practice', 'anon', '題庫練習首頁：題型 × 難度（沒有紀錄）', true],
  ['04-section-reading', '/reading', 'anon', '題型頁：閱讀測驗（頁首＋練習入口）', true],
  ['04-section-vocabulary', '/vocabulary', 'anon', '題型頁：詞彙題'],
  ['04-section-cloze', '/cloze', 'anon', '題型頁：綜合測驗'],
  ['04-section-word-bank', '/word-bank', 'anon', '題型頁：文意選填'],
  ['04-section-structure', '/structure', 'anon', '題型頁：篇章結構'],
  ['04-section-mixed', '/mixed', 'anon', '題型頁：混合題'],
  ['05-practice-session-reading-start', '/practice/reading/basic', 'anon', '題庫練習作答頁：閱讀測驗・穩定基礎，剛進來（未作答）'],
  ['05-practice-session-word-bank-start', '/practice/word-bank/advanced', 'anon', '題庫練習作答頁：文意選填・進階練習，剛進來'],
  ['06-module-translation', '/translation', 'anon', '題型頁：中譯英（未登入）'],
  ['06-module-composition', '/composition', 'anon', '題型頁：英文作文（未登入）'],
  ['07-writing-home-anon', '/writing', 'anon', '寫作練習首頁，未登入'],
  ['07-writing-home-student', '/writing', 'student', '寫作練習首頁，已登入：我的寫作紀錄（中譯英 4 筆）', true],
  ['08-writing-translation-list', '/writing/translation', 'anon', '歷屆中譯英題目列表'],
  ['08-writing-translation-ai-list', '/writing/translation/ai', 'anon', '本站仿真中譯英題目列表'],
  ['08-writing-essay-list', '/writing/essay', 'anon', '歷屆英文作文題目列表', true],
  ['08-writing-essay-ai-list', '/writing/essay/ai', 'anon', '本站仿真英文作文題目列表'],
  ['09-essay-exam-student', '/writing/essay/gsat-115', 'student', '作文作答頁：115 學測，已登入、AI 已核准，還沒寫'],
  ['09-essay-exam-anon', '/writing/essay/gsat-115', 'anon', '作文作答頁：115 學測，未登入'],
  ['09-essay-ai-student', `/writing/essay/ai/${BANK_CP_CODE}`, 'student', '作文作答頁：本站仿真作文 0e89ae（附圖），已登入'],
  ['09-translation-exam-student', '/writing/translation/gsat-115', 'student', '中譯英作答頁：115 學測，已登入，還沒寫'],
  ['09-translation-ai-student', `/writing/translation/ai/${BANK_TR_CODE}`, 'student', '中譯英作答頁：本站仿真 1d423d（學吉他），已登入'],
  ['09-custom-essay-student', '/writing/essay/custom', 'student', '自訂題目作文：還沒設定題目，已登入'],
  ['10-submission-translation', '/writing/submissions/sub-t1', 'student', '批改結果：115 學測中譯英，5.75／8（錯誤加亮、修正版）', true],
  ['10-submission-bank-translation', '/writing/submissions/sub-b1', 'student', '批改結果：本站仿真中譯英，6.5／8'],
  ['10-submission-essay', '/writing/submissions/sub-e1', 'student', '批改結果：115 學測作文（打字），12.5／20，四項分數', true],
  ['10-submission-custom-essay', '/writing/submissions/sub-c1', 'student', '批改結果：自訂題目作文，15／20（含題目）'],
  ['10-submission-queued', '/writing/submissions/sub-q1', 'student', '批改結果頁：中譯英排隊等待批改'],
  ['11-exams-list', '/exams', 'anon', '歷屆試題列表（沒有紀錄）', true],
  ['12-exam-paper-start', '/exams/gsat-115', 'anon', '歷屆試卷 115 學測：開始作答前（模式選擇、PDF 下載）'],
  ['13-mock-list', '/mock', 'anon', '模擬考列表（沒有紀錄），含「本站自組模擬考」區塊', true],
  ['14-mock-paper-start', '/mock/gsat-115', 'anon', '歷屆模擬考 115 學測：開考前（預估分數、實考模式）'],
  ['17-assistant-home-anon', '/assistant', 'anon', '學習助手首頁，未登入'],
  ['17-assistant-home-empty', '/assistant', 'student', '學習助手首頁，已登入、還沒有任何解析紀錄'],
  ['17-assistant-mistakes-empty', '/assistant/mistakes', 'student', '學習助手：錯題與疑點（這台裝置沒有紀錄）'],
  ['17-assistant-new-photo', '/assistant/new', 'student', '學習助手：拍照問題目（預設分頁，還沒選照片）'],
  ['17-assistant-new-paste', '/assistant/new?mode=paste', 'student', '學習助手：貼上題目（空白表單）', true],
  ['17-assistant-report-empty', '/assistant/report', 'student', '學習報告：還沒有報告（產生第一份報告的設定面板）'],
  ['18-settings-anon', '/settings', 'anon', '設定，未登入'],
  ['18-settings-student', '/settings', 'student', '設定，已登入', true],
  ['19-about', '/about', 'anon', '關於本站', true],
  ['19-privacy', '/privacy', 'anon', '隱私權說明'],
  ['19-terms', '/terms', 'anon', '服務條款'],
  ['20-account-anon', '/account', 'anon', '我的帳號，未登入'],
  ['20-account-student', '/account', 'student', '我的帳號，已登入（AI 已核准）', true],
  ['20-account-welcome', '/account/welcome', 'welcome', '第一次登入：同意條款與年齡'],
  ['20-ai-apply-not-applied', '/ai/apply', 'student-none', 'AI 申請表單（還沒申請）'],
  ['20-ai-apply-approved', '/ai/apply', 'student', 'AI 申請頁：已核准'],
  ['21-admin', '/admin', 'admin', '管理後台：3 位待審核、健康檢查、用量摘要'],
  ['22-not-found', '/no-such-page', 'anon', '404 找不到頁面', true],
];

for (const [name, url, who, desc, dark] of STATIC) {
  test(name, async ({ page }, testInfo) => {
    darkGate(testInfo, Boolean(dark));
    const c = await setup(page, testInfo, who);
    await open(c, url);
    await c.shot(name, desc, { dark });
  });
}

// ───────────────────────── shell overlays (viewport only) ─────────────────────────

test('00-shell', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/');
  const aside = page.locator('aside[data-sidebar]');
  await aside.getByRole('button', { name: '小明（帳號選單）' }).click();
  await expect(page.getByRole('link', { name: '我的帳號' }).filter({ visible: true }).first()).toBeVisible();
  await c.shot('00-shell-account-menu', '側邊欄底部的帳號選單打開（首頁，已登入）', { full: false, dark: true });
  await page.keyboard.press('Escape');
  if (await page.getByRole('link', { name: '我的帳號' }).filter({ visible: true }).count()) {
    await aside.getByRole('button', { name: '小明（帳號選單）' }).click();
  }
  await expect(page.getByRole('link', { name: '我的帳號' }).filter({ visible: true })).toHaveCount(0);
  await aside.getByRole('button', { name: '鍵盤快捷鍵' }).click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await c.shot('00-shell-shortcut-help', '鍵盤快捷鍵說明對話框（首頁）', { full: false, dark: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await aside.getByRole('button', { name: '收合側邊欄' }).click();
  await expect(aside).toHaveAttribute('data-sidebar', 'collapsed');
  await c.shot('00-shell-sidebar-collapsed', '側邊欄收合成圖示欄（首頁，已登入）', { full: false, dark: true });
});

// ───────────────────────── home with history (student) + list pages with records ─────────────────────────

test('history-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/words?tab=study');
  await page.getByRole('button', { name: /開始學習（\d+ 張）/ }).click();
  await page.getByRole('button', { name: '顯示答案' }).click();
  await c.shot('02-words-study-card', '單字：每日學習，翻開第 1 張卡的答案（評分按鈕）');
  await page.getByRole('group', { name: '評分：這個字記得多熟？' }).getByRole('button').nth(2).click();
  await expect(page.getByRole('group', { name: '評分：這個字記得多熟？' })).toBeHidden();

  await open(c, '/practice/vocabulary/basic');
  await expectAnswered(page, await answerRadios(page, 4));
  await submitPractice(page);
  await expect(page.getByText(/^答錯的正解字已收進/)).toBeVisible({ timeout: 30_000 });

  await open(c, '/exams/gsat-115');
  await page.locator('label').filter({ hasText: '考試模式' }).click();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await expectAnswered(page, 1);
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();

  await open(c, '/exams/gsat-114');
  await page.getByRole('button', { name: '開始作答' }).click();
  await expectAnswered(page, await answerRadios(page, 2));

  await open(c, '/exams');
  await expect(page.getByText(/^已交卷・/)).toBeVisible();
  await c.shot('11-exams-list-records', '歷屆試題列表：有紀錄（115 學測已交卷、114 學測作答中）');
  await open(c, '/practice');
  await c.shot('03-practice-menu-records', '題庫練習首頁：有紀錄（詞彙題穩定基礎做過 1 組）');
  await open(c, '/words?tab=mistakes');
  await c.shot('02-words-mistakes', '單字：錯題本（題庫練習答錯的正解字已收進來）');
  await open(c, '/assistant/mistakes');
  await c.shot('17-assistant-mistakes', '學習助手：錯題與疑點（有詞彙題與歷屆試題的錯題）', { dark: true });
  await open(c, '/');
  await c.shot('01-home-student-history', '首頁儀表板，已登入且有學習紀錄（繼續學習、學習進度、AI 點數、最近寫作紀錄）', { dark: true });
});

// ───────────────────────── words: quiz question ─────────────────────────

test('02-words-quiz-flow', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/words?tab=quiz');
  await page.getByRole('button', { name: /開始測驗/ }).click();
  await expect(page.getByRole('heading', { name: /第 1 題/ })).toBeVisible();
  await page.getByRole('list', { name: '選項' }).getByRole('button').nth(1).click();
  await expect(page.getByText(/^(答對了！|答錯了)$/)).toBeVisible();
  await c.shot('02-words-quiz-question', '單字：測驗第 1 題作答後的回饋');
});

// ───────────────────────── practice sessions ─────────────────────────

test('05-practice-reading-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/practice/reading/basic');
  await expectAnswered(page, await answerRadios(page, 2));
  await c.shot('05-practice-session-reading-midway', '題庫練習：閱讀測驗・穩定基礎，作答 2 題（未登入）', { dark: true });
  // PR 1：用鍵盤按「交卷」→ 確認列，焦點在「繼續作答」（手機也是）；桌機另列未作答的題號。
  await keyboardFocus(page, page.getByRole('button', { name: '交卷', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: '確認交卷' })).toBeVisible();
  await expect(page.getByRole('button', { name: '繼續作答' })).toBeFocused();
  await c.shot('05-practice-session-reading-confirm', '題庫練習：用鍵盤按「交卷」後的確認列（焦點在「繼續作答」；桌機列出未作答的題號）', {
    full: false,
    dark: true,
    mobile: true,
  });
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();
  await c.shot('05-practice-session-reading-result', '題庫練習：閱讀測驗交卷後（成績、解析卡）', { dark: true });
});

test('05-practice-word-bank-flow', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'student');
  await open(c, '/practice/word-bank/advanced');
  await fillBlanks(page, 3);
  await expectAnswered(page, 3);
  await page.getByRole('button', { name: /^第 \S+ 題空格，未作答/ }).first().click();
  await expect(page.getByRole('group', { name: /^第 \S+ 題的選項$/ }).first()).toBeVisible();
  await c.shot('05-practice-session-word-bank-midway', '題庫練習：文意選填・進階，填 3 格、第 4 格的選項面板打開（已登入）');
  await page.keyboard.press('Escape');
  await submitPractice(page);
  await c.shot('05-practice-session-word-bank-result', '題庫練習：文意選填交卷後（解析卡、「問學習助手」入口；已登入）');
});

// ───────────────────────── exam paper ─────────────────────────

test('12-exam-paper-practice-flow', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/exams/gsat-115');
  await page.getByRole('button', { name: '開始作答' }).click();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  const q35 = page.locator('#q-35');
  await q35.getByRole('radio', { name: /^\(C\)/ }).check();
  await q35.getByRole('button', { name: '看答案' }).click();
  await expect(q35.getByTestId('question-feedback')).toContainText('全國答對率');
  await c.shot('12-exam-paper-practice-answered', '歷屆試卷 115 學測，練習模式：第 1 題作答、第 35 題看答案（全國答對率）');
  await q35.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('q-35')?.scrollIntoView({ block: 'center' }));
  await c.shot('12-exam-paper-practice-answered-q35', '同上，捲到第 35 題的答案回饋（視窗）', { keepScroll: true });
});

test('12-exam-paper-exam-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/exams/gsat-115');
  await page.locator('label').filter({ hasText: '考試模式' }).click();
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await page.getByRole('button', { name: '第 11 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 11 題的選項' }).getByRole('button', { name: /it turns out/ }).click();
  await page.getByRole('button', { name: '第 21 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 21 題的選項' }).getByRole('button', { name: /^\(E\)/ }).click();
  await expect(page.getByRole('button', { name: /^第 21 題空格，已填 \(E\)/ })).toBeVisible();
  await expectAnswered(page, 3);
  await c.shot('12-exam-paper-exam-midway', '歷屆試卷 115 學測，考試模式作答中：3 題（含綜合測驗、文意選填空格）', { dark: true });
  await page.getByRole('button', { name: /^第 21 題空格/ }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await c.shot('12-exam-paper-exam-midway-word-bank', '同上，捲到文意選填（視窗）', { keepScroll: true, dark: true });
  // PR 1：用鍵盤按「交卷」→ 確認列（焦點在「繼續作答」，手機也是）；桌機另列未作答的題號與剩餘時間。
  await keyboardFocus(page, page.getByRole('button', { name: '交卷', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', { name: '確認交卷' })).toBeVisible();
  await expect(page.getByRole('button', { name: '繼續作答' })).toBeFocused();
  await c.shot('12-exam-paper-exam-confirm', '歷屆試卷，考試模式：用鍵盤按「交卷」後的確認列（焦點在「繼續作答」；桌機列出未作答題號與剩餘時間；視窗）', {
    keepScroll: true,
    dark: true,
    mobile: true,
  });
  await page.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('region', { name: '交卷結果' })).toBeVisible();
  await c.shot('12-exam-paper-exam-submitted', '歷屆試卷 115 學測，考試模式交卷後（交卷結果、逐題對錯）', { dark: true });
  // PR 1：交卷後的「清除作答，重新開始」先就地確認，焦點在「取消」（手機也是）。
  const result = page.getByRole('region', { name: '交卷結果' });
  await keyboardFocus(page, result.getByRole('button', { name: '清除作答，重新開始' }));
  await page.keyboard.press('Enter');
  const confirm = result.getByRole('group', { name: /^確定要清除這份考卷的作答與成績嗎/ });
  await expect(confirm.getByRole('button', { name: '取消' })).toBeFocused();
  await confirm.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await c.shot('12-exam-paper-exam-clear-confirm', '歷屆試卷交卷後：按「清除作答，重新開始」的確認（焦點在「取消」；視窗）', { keepScroll: true, dark: true, mobile: true });
});

// ───────────────────────── mock (past exam) ─────────────────────────

test('14-mock-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/mock/gsat-115');
  await page.getByRole('spinbutton', { name: /你覺得這次會考幾分/ }).fill('60');
  await page.getByRole('button', { name: '開始作答' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.locator('#q-1').getByRole('radio', { name: /\(B\) tight/ }).check();
  await page.locator('#q-1').getByRole('button', { name: '標記第 1 題，稍後檢查' }).click();
  await page.locator('#q-2').getByRole('radio').first().check();
  await expectAnswered(page, 2);
  await c.shot('14-mock-paper-midway', '歷屆模擬考 115 學測作答中：作答 2 題、標記 1 題（詞彙大題）', { dark: true });
  // PR 1：計時中點側邊欄的「首頁」→ 先問要不要離開（焦點在「留下來作答」）。
  await page.locator('aside[data-sidebar]').getByRole('link', { name: '首頁', exact: true }).click();
  const leave = page.getByRole('dialog', { name: '要離開作答頁嗎？' });
  await expect(leave.getByRole('button', { name: '留下來作答' })).toBeFocused();
  await c.shot('14-mock-paper-leave-confirm', '歷屆模擬考作答中：點側邊欄的「首頁」，先問要不要離開（計時中離開確認）', { full: false, dark: true });
  await leave.getByRole('button', { name: '留下來作答' }).click();
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(/\/mock\/gsat-115$/);
  const nav = page.getByRole('navigation', { name: '大題導覽' });
  await nav.getByRole('button', { name: /^3\. 文意選填/ }).click();
  await page.getByRole('button', { name: '第 21 題空格，未作答' }).click();
  await page.getByRole('group', { name: '第 21 題的選項' }).getByRole('button', { name: /^\(E\)/ }).click();
  await expectAnswered(page, 3);
  await c.shot('14-mock-paper-word-bank-section', '歷屆模擬考：切到文意選填大題、填 1 格');
  await nav.getByRole('button', { name: /^5\. / }).click();
  await c.shot('14-mock-paper-reading-section', '歷屆模擬考：閱讀測驗大題');
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
  await expect(dialog).toBeVisible();
  await c.shot('14-mock-paper-submit-dialog', '歷屆模擬考：交卷確認對話框', { full: false });
  await dialog.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '115 學測模擬考成績單' })).toBeVisible();
  await c.shot('15-mock-report', '歷屆模擬考成績單（級分、五標、各大題）', { dark: true });
  await page.getByRole('button', { name: /展開檢討試卷/ }).click();
  await expect(page.locator('#q-1').getByTestId('question-feedback')).toBeVisible();
  await c.shot('15-mock-report-review', '歷屆模擬考成績單：展開檢討試卷');
  await page.getByRole('link', { name: '回模擬考列表' }).click();
  await expect(page.getByRole('region', { name: '作答紀錄' })).toBeVisible();
  await c.shot('13-mock-list-completed', '模擬考列表：交卷後（已完成、作答紀錄）');
});

// ───────────────────────── bank mock (本站自組模擬考) ─────────────────────────

const PREVIEW = '?bankmock=preview&bankmockseed=20261020';

test('16-bank-mock-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'anon');
  await open(c, `/mock${PREVIEW}`);
  const section = page.getByRole('region', { name: '本站自組模擬考' });
  await expect(section.getByText(/還可以組約 \d+ 份全新的卷子/).first()).toBeVisible();
  await settle(page);
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await c.shot('13-mock-list-bank-section', '模擬考列表：捲到「本站自組模擬考」區塊（視窗）', { keepScroll: true, dark: true });
  await section.getByRole('radio', { name: /穩定基礎/ }).check();
  await section.getByRole('button', { name: '組一份新卷：穩定基礎' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考' })).toBeVisible();
  await c.shot('16-bank-mock-paper-start', '本站自組模擬考（穩定基礎）卷子頁：開考前（卷號、AI 標示、規則、PDF）');
  await page.getByRole('button', { name: '不預估，直接開始' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expectAnswered(page, await answerRadios(page, 2));
  await c.shot('16-bank-mock-paper-midway', '本站自組模擬考作答中：作答 2 題');
  const nav = page.getByRole('navigation', { name: '大題導覽' });
  await nav.getByRole('button', { name: /^5\. 閱讀測驗/ }).click();
  await c.shot('16-bank-mock-paper-reading-section', '本站自組模擬考：閱讀測驗大題（含圖表或表格）');
  await page.getByRole('button', { name: '交卷', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '確定要交卷嗎？' });
  await dialog.getByRole('button', { name: '確定交卷' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '本站自組（穩定基礎）模擬考成績單' })).toBeVisible();
  await c.shot('16-bank-mock-report', '本站自組模擬考成績單（原得總分、下一步建議、沒有級分）', { dark: true });
});

// ───────────────────────── writing flows ─────────────────────────

test('09-translation-exam-filled', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/translation/gsat-115');
  await fillTranslation(page, T1, T2);
  await expect(page.getByTestId('quota-summary')).toBeVisible();
  await c.shot('09-translation-exam-student-filled', '中譯英作答頁：115 學測，已核准、兩句都填好（送出按鈕、點數）', { dark: true });
});

test('09-translation-exam-self-check', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'anon');
  await open(c, '/writing/translation/gsat-115');
  await fillTranslation(page, T1, T2);
  await page.getByRole('button', { name: '自我檢核（不用 AI）' }).click();
  await expect(page.locator('#t-self-check').getByRole('heading', { name: '自我檢核' })).toBeVisible();
  await c.shot('09-translation-exam-anon-self-check', '中譯英作答頁（未登入）：填好後打開自我檢核');
});

test('09-translation-ai-revealed', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'anon');
  await open(c, `/writing/translation/ai/${BANK_TR_CODE}`);
  await page.getByRole('button', { name: '第 1 句的提示：看第 1 層（共 3 層）' }).click();
  await fillTranslation(page, B1, B2);
  await page.getByRole('button', { name: '寫好了，對照參考譯文' }).click();
  await expect(page.getByRole('heading', { level: 2, name: '對照與自評' })).toBeVisible();
  await c.shot('09-translation-ai-anon-revealed', '本站仿真中譯英（未登入）：看了 1 層提示、寫好後對照本站參考譯文與自評');
});

test('09-essay-exam-filled', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/gsat-115');
  await page.getByRole('textbox', { name: /你的作文/ }).fill(EXAM_ESSAY);
  await expect(page.getByTestId('quota-summary')).toBeVisible();
  await c.shot('09-essay-exam-student-filled', '作文作答頁：115 學測，已核准、寫好兩段（字數、送出按鈕）', { dark: true });
  const submit = page.getByRole('button', { name: /^送出 AI 批改（\d+ 點）$/ });
  await keyboardFocus(page, submit);
  await c.shot('09-essay-exam-student-focus-submit', '同上，鍵盤焦點在「送出 AI 批改」（視窗）', { keepScroll: true });
  // PR 1：作文只有 108 個單詞（少於 120）→ 按送出先出現確認列，焦點在「再改一下」。
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('group', { name: /^送出 AI 批改會用 \d+ 點/ });
  await expect(confirm.getByRole('button', { name: '再改一下' })).toBeFocused();
  await confirm.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await c.shot('09-essay-exam-student-submit-confirm', '作文作答頁：字數不足時按「送出 AI 批改」先出現確認列（點數、提醒；焦點在「再改一下」；視窗）', {
    keepScroll: true,
    dark: true,
  });
});

test('09-essay-exam-photo', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/gsat-115');
  await page.getByRole('button', { name: '拍照上傳手寫稿' }).click();
  await expect(page.getByRole('region', { name: '拍照上傳手寫稿' })).toBeVisible();
  await c.shot('09-essay-exam-student-photo', '作文作答頁：切到拍照上傳手寫稿');
});

test('09-essay-ai-revealed', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'anon');
  await open(c, `/writing/essay/ai/${BANK_CP_CODE}`);
  await page.getByRole('textbox', { name: /你的作文/ }).fill(EXAM_ESSAY);
  await page.getByRole('button', { name: '寫好了，看評分規準與範文' }).click();
  await expect(page.getByRole('region', { name: '本題的評分規準' })).toBeVisible();
  await c.shot('09-essay-ai-anon-revealed', '本站仿真作文（未登入）：寫完後對照本站評分規準與本站範文');
});

test('09-custom-essay-flow', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'student');
  await open(c, '/writing/essay/custom');
  await page.getByRole('textbox', { name: '作文題目' }).fill(CUSTOM_PROMPT_TEXT);
  await page.getByRole('button', { name: '設成 2 段' }).click();
  await c.shot('09-custom-essay-student-prompt-filled', '自訂題目作文：填好題目、設成 2 段（還沒按「題目設定好了」）');
  await page.getByRole('button', { name: '題目設定好了' }).click();
  await page.getByRole('textbox', { name: /你的作文/ }).fill(CUSTOM_ESSAY);
  await expect(page.getByTestId('quota-summary')).toBeVisible();
  await c.shot('09-custom-essay-student-writing', '自訂題目作文：題目設定好、寫好作文');
});

// ───────────────────────── learning assistant ─────────────────────────

test('17-assistant-case-flow', async ({ page }, testInfo) => {
  const c = await setup(page, testInfo, 'student');
  await open(c, '/practice/word-bank/advanced');
  await fillBlanks(page, 10);
  await submitPractice(page);
  await page.getByRole('link', { name: '問學習助手：這一組的錯題與疑點' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '請學習助手解析' })).toBeVisible();
  await c.shot('17-assistant-ask', '學習助手：請學習助手解析（從文意選填練習的錯題進來，預設勾錯的格子、顯示點數）', { dark: true });
  await page.getByRole('button', { name: '送出解析' }).click();
  await expect(page).toHaveURL(/\/assistant\/case\/case-1$/);
  await expect(page.getByRole('heading', { name: /^全篇結構與這組的線索/ })).toBeVisible({ timeout: 20_000 });
  await c.shot('17-assistant-case-analysis', '學習助手案例頁：解析完成（全篇結構、逐題解析、知識點；右欄「解析」分頁）', { dark: true });
  await page.getByRole('tab', { name: /^追問/ }).click();
  const composer = page.getByRole('textbox', { name: '還有問題？繼續追問' });
  await page.getByRole('button', { name: '可以再舉一個例句嗎？' }).click();
  await composer.fill('那 retain 什麼時候可以用？');
  await page.getByRole('button', { name: '送出追問（用 3 點）' }).click();
  await expect(page.getByText('retain 是「保留、維持」，後面直接接受詞，不接 from。')).toBeVisible({ timeout: 20_000 });
  await c.shot('17-assistant-case-followups', '學習助手案例頁：「追問」分頁，追問 1 次並收到回覆', { dark: true });
  await open(c, '/assistant');
  await c.shot('17-assistant-home', '學習助手首頁，已登入、有 1 筆解析紀錄', { dark: true });
  await page.getByRole('link', { name: /學習報告/ }).first().click();
  await expect(page).toHaveURL(/\/assistant\/report$/);
  const panel = page.getByRole('region', { name: '產生第一份報告' });
  await panel.getByRole('radio', { name: '2–4 小時' }).check();
  await panel.getByRole('button', { name: '產生報告' }).click();
  await expect(page).toHaveURL(/\/assistant\/report\/1$/);
  await expect(page.getByRole('table', { name: '各大題的目前表現與目標' })).toBeVisible({ timeout: 20_000 });
  await c.shot('17-assistant-report', '學習報告第 1 版：各大題目標表、逐週計畫（前標、每週 2–4 小時）', { dark: true });
});

/** A JPEG drawn in the page (same as tests/assistant-photo.spec.ts). */
async function handoutPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#111111';
    g.font = '48px serif';
    g.fillText('14. What is the passage mainly about?', 80, 400);
    g.fillText('15. Why do the children use newspapers?', 80, 600);
    return canvas.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

test('17-assistant-photo-flow', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'student');
  await open(c, '/assistant/new');
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'handout.jpg', mimeType: 'image/jpeg', buffer: await handoutPhoto(page) });
  await expect(page.getByRole('heading', { name: '框選第 1 張照片' })).toBeVisible();
  const box = page.getByTestId('photo-crop-box');
  await expect(box.getByRole('img')).toBeVisible();
  await box.scrollIntoViewIfNeeded();
  const r = (await box.boundingBox())!;
  await page.mouse.move(r.x + r.width * 0.1, r.y + r.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * 0.9, r.y + r.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await c.shot('17-assistant-new-photo-crop', '學習助手：拍照問題目，框選照片（拖出範圍、滑桿）');
  await page.getByRole('button', { name: '確定框選' }).click();
  await expect(page.getByRole('img', { name: '第 1 張題目照片（框選後）' })).toBeVisible();
  await page.getByRole('button', { name: '上傳並轉錄（2 點）' }).click();
  await expect(page.getByRole('heading', { name: '確認轉錄的題目' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('checkbox', { name: '第 15 題' }).check();
  await c.shot('17-assistant-new-photo-confirm', '學習助手：轉錄完成，確認題目（勾第 15 題、有 1 處看不清的字待選）');
});

test('17-assistant-paste-filled', async ({ page }, testInfo) => {
  darkGate(testInfo, false);
  const c = await setup(page, testInfo, 'student');
  await open(c, '/assistant/new?mode=paste');
  await page
    .getByRole('textbox', { name: '題目全文（必填）' })
    .fill('The city council decided to ___ the meeting until next week because of the storm. (A) postpone (B) prevent (C) predict (D) pretend');
  await page.getByRole('textbox', { name: '你的答案（選填）' }).fill('B');
  await c.shot('17-assistant-new-paste-filled', '學習助手：貼上題目，填好題目與自己的答案（送出前）');
});
