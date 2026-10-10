// @vitest-environment node
/**
 * 不准把字串當成 HTML 直接插進畫面（docs/design/bank-writing.md §4.6）：題庫的 SVG、題目文字都是代理寫的資料，
 * 一律用 React 的文字節點或 <img src="data:image/svg+xml,…"> 顯示（以 <img> 載入的 SVG 不執行腳本）。
 * 這裡掃 src/**／*.{ts,tsx} 的寫程式樣式；放在 scripts/ 是因為這個測試要用 node:fs（src/ 的 tsconfig 沒有 node 型別），
 * 而且它本身就不在被掃的 src/ 裡，不會掃到自己。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** 直接插入 HTML 的寫法（只抓程式寫法；註解裡提到「innerHTML」這個字不算）。 */
const RAW_HTML_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'dangerouslySetInnerHTML', re: /dangerouslySetInnerHTML/ },
  { name: '.innerHTML／.outerHTML 指派', re: /\.(inner|outer)HTML\s*=/ },
  { name: 'insertAdjacentHTML', re: /insertAdjacentHTML\s*\(/ },
  { name: 'new DOMParser', re: /new\s+DOMParser\b/ },
  { name: 'createContextualFragment', re: /createContextualFragment\s*\(/ },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** 一段原始碼命中的樣式名稱。 */
function rawHtmlHits(source: string): string[] {
  return RAW_HTML_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.name);
}

describe('src/ 沒有直接插入 HTML 的寫法', () => {
  const files = sourceFiles(SRC);

  it('掃得到檔案（路徑沒有寫錯）', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith(path.join('features', 'writing', 'bank', 'components', 'BankFigure.tsx')))).toBe(true);
  });

  it('每個檔案都沒有命中', () => {
    const hits = files.flatMap((f) => rawHtmlHits(readFileSync(f, 'utf8')).map((name) => `${path.relative(SRC, f)}：${name}`));
    expect(hits).toEqual([]);
  });

  it('樣式本身有效：故意寫壞的程式碼會命中，註解裡的字不會', () => {
    const bad = [
      '<div dangerouslySetInnerHTML={{ __html: svg }} />',
      'el.innerHTML = svg;',
      'el.outerHTML  = "<b>x</b>";',
      "el.insertAdjacentHTML('beforeend', s);",
      'const doc = new DOMParser().parseFromString(s, "image/svg+xml");',
      'range.createContextualFragment(s)',
    ];
    for (const code of bad) expect(rawHtmlHits(code), code).not.toEqual([]);
    expect(rawHtmlHits('// 不用 innerHTML，改用 React 節點')).toEqual([]);
    expect(rawHtmlHits('/** 和 innerHTML 不同，textContent 不解析標籤 */')).toEqual([]);
  });
});
