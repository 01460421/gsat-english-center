/**
 * 設計 token（index.css；docs/design/css-overhaul.md §3）的守門測試：
 *   - 深色值寫了兩次（prefers-color-scheme 與 data-theme="dark"），兩個區塊必須一模一樣；
 *   - 淺色主題有值的每個主題 token，深色主題也要有（漏寫的話深色會沿用淺色值）；
 *   - @theme inline 把每個顏色 token 映射成 Tailwind 顏色（bg-surface、border-line-strong…）；
 *   - 兩種主題的文字對比 ≥ 4.5:1（WCAG 1.4.3）、控制項邊界 ≥ 3:1（1.4.11）；
 *   - index.html 的 theme-color 與 lib/theme.ts 的網址列顏色等於 --surface。
 * 頁面上實際的對比由 tests/visual/theme（axe）檢查；這裡只看 token 本身，改配色時第一時間就會發現。
 */
import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import indexCss from '../index.css?raw';
import { THEME_COLORS } from './theme';

/** 取出「selector { … }」區塊裡的自訂屬性（只看第一層，不含巢狀區塊）。 */
function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1] as string, (m[2] as string).trim());
  return map;
}

/** 從 start 位置的「{」開始，找到對應的「}」，回傳中間的內容。 */
function blockAt(css: string, start: number): string {
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error('區塊沒有結束');
}

/** 去掉註解，避免註解裡的範例被當成宣告。 */
const css = indexCss.replace(/\/\*[\s\S]*?\*\//g, '');
const light = declarations(blockAt(css, css.indexOf(':root {')));
const darkMedia = declarations(blockAt(css, css.indexOf(":root:not([data-theme='light'])")));
const darkAttr = declarations(blockAt(css, css.indexOf(":root[data-theme='dark']")));
const themeInline = declarations(blockAt(css, css.indexOf('@theme inline')));

/** 兩種主題各自的完整值（深色＝淺色被覆寫後的結果）。 */
const themes = { light, dark: new Map([...light, ...darkAttr]) } as const;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`不是 6 位的色碼：${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('設計 token', () => {
  it('深色的兩個區塊（媒體查詢與 data-theme="dark"）一模一樣', () => {
    expect(darkMedia.size).toBeGreaterThan(10);
    expect([...darkMedia.entries()]).toEqual([...darkAttr.entries()]);
  });

  it('淺色主題用色碼寫的 token，深色主題都有自己的值', () => {
    const themed = [...light.entries()].filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)).map(([k]) => k);
    // 兩種主題刻意相同的例外：圖片、圖表的白底。
    const shared = new Set(['--paper']);
    const missing = themed.filter((k) => !shared.has(k) && !darkAttr.has(k));
    expect(missing).toEqual([]);
  });

  it('@theme inline 把每個顏色 token 映射成 Tailwind 顏色', () => {
    const colorTokens = [...light.keys()].filter((k) => !/^--(chart-|shadow-|focus-ring)/.test(k));
    for (const token of colorTokens) {
      expect(themeInline.get(`--color-${token.slice(2)}`), `${token} 沒有對應的 --color-${token.slice(2)}`).toBe(`var(${token})`);
    }
  });

  describe.each(['light', 'dark'] as const)('%s 主題的對比', (name) => {
    const t = themes[name];
    const get = (k: string) => {
      const v = t.get(k);
      if (!v) throw new Error(`${name} 主題沒有 ${k}`);
      return v;
    };

    it.each([
      ['--fg', '--bg'],
      ['--fg', '--surface'],
      ['--fg', '--surface-2'],
      ['--muted', '--bg'],
      ['--muted', '--surface'],
      ['--muted', '--surface-2'],
      ['--primary', '--bg'],
      ['--primary', '--surface'],
      ['--primary', '--primary-soft'],
      ['--on-primary', '--primary'],
      ['--on-primary', '--primary-hover'],
      ['--badge-fg', '--badge-bg'],
      ['--ok', '--surface'],
      ['--bad', '--surface'],
    ])('文字 %s 在 %s 上 ≥ 4.5:1', (fg, bg) => {
      expect(contrast(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
    });

    it.each([['--bg'], ['--surface'], ['--surface-2']])('控制項邊界 --line-strong 在 %s 上 ≥ 3:1', (bg) => {
      expect(contrast(get('--line-strong'), get(bg))).toBeGreaterThanOrEqual(3);
    });
  });

  it('網址列顏色（index.html 的 theme-color、lib/theme.ts）等於兩種主題的 --surface', () => {
    expect(THEME_COLORS).toEqual({ light: themes.light.get('--surface'), dark: themes.dark.get('--surface') });
    expect(indexHtml).toContain(`content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)"`);
    expect(indexHtml).toContain(`content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)"`);
  });

  it('index.html 的繪製前腳本讀的鍵和 lib/theme.ts 相同', () => {
    expect(indexHtml).toContain("localStorage.getItem('gsat-theme')");
  });
});
