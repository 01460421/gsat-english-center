/**
 * svg-sanitize.mjs：作文看圖題 SVG 的白名單清理（docs/design/bank-writing.md §4.6、§7.1）。
 * 允許的範例（題庫的範例檔與從兩個工作樹複製來的代表圖）清理後內容不變、而且冪等；每一種已知的繞過寫法都要被拒絕。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as runtime from './svg-sanitize.mjs';
import { isSanitizedSvg, sanitizeSvg, SVG_MAX_CHARS } from './svg-sanitize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'svg');
const EXAMPLE = path.join(HERE, '..', '..', '..', 'tools', 'tests', 'data', 'ai.cp.0e1f2a@1.json');

const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"';
const wrap = (inner: string) => `<svg ${NS}>${inner}</svg>`;

describe('允許的圖', () => {
  const samples: Array<[string, string]> = [
    ['題庫範例 ai.cp.0e1f2a', JSON.parse(readFileSync(EXAMPLE, 'utf8')).group.figures[0].svg as string],
    ...readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.svg'))
      .sort()
      .map((f): [string, string] => [f, readFileSync(path.join(FIXTURES, f), 'utf8')]),
  ];

  it('代表圖涵蓋小數、ellipse、polyline、polygon、path、stroke-dasharray、粗體、fill-opacity', () => {
    const all = samples.map(([, s]) => s).join('\n');
    for (const needle of ['<ellipse', '<polyline', '<polygon', '<path', 'stroke-dasharray', 'font-weight="bold"', 'fill-opacity']) {
      expect(all, needle).toContain(needle);
    }
    expect(all).toMatch(/ (r|x|stroke-width)="\d+\.\d+"/);
  });

  for (const [name, svg] of samples) {
    it(`${name}：清理後內容相同，而且冪等`, () => {
      const r = sanitizeSvg(svg);
      expect(r.problem).toBeUndefined();
      expect(r.svg).toBe(svg.trim());
      expect(sanitizeSvg(r.svg).svg).toBe(r.svg);
      expect(isSanitizedSvg(r.svg)).toBe(true);
    });
  }

  it('屬性值與文字重新跳脫（不是原字串原樣流出）', () => {
    const r = sanitizeSvg(wrap(`<text x="1" y="2" aria-label="a &amp; b">5 &gt; 3 &amp; 2 &lt; 4 '引號'</text>`));
    expect(r.svg).toBe(wrap(`<text x="1" y="2" aria-label="a &amp; b">5 &gt; 3 &amp; 2 &lt; 4 '引號'</text>`));
    const q = sanitizeSvg(wrap(`<text x='1' aria-label='他說 &quot;好&quot;'>x</text>`));
    expect(q.svg).toBe(wrap(`<text x="1" aria-label="他說 &quot;好&quot;">x</text>`));
    expect(sanitizeSvg(q.svg).svg).toBe(q.svg);
  });
});

describe('數字文法', () => {
  for (const ok of ['100.9', '102.267', '-3', '.5', '1e-3', '10', '0', '2.', '1E+2']) {
    it(`${ok} 通過`, () => expect(sanitizeSvg(wrap(`<rect x="${ok}" y="0" width="1" height="1"/>`)).svg).not.toBeNull());
  }
  for (const bad of ['1..2', '1e', '--3', '10px', '', ' ', '1,2', 'calc(1)', '0x10', 'Infinity', 'NaN']) {
    it(`${JSON.stringify(bad)} 不通過`, () => expect(sanitizeSvg(wrap(`<rect x="${bad}" y="0" width="1" height="1"/>`)).svg).toBeNull());
  }
  it('font-size 可以接 px，其他數值不行', () => {
    expect(sanitizeSvg(wrap(`<text x="1" font-size="10px">a</text>`)).svg).not.toBeNull();
    expect(sanitizeSvg(wrap(`<text x="1px">a</text>`)).svg).toBeNull();
  });
  it('viewBox 剛好 4 個數字；points、stroke-dasharray 是數字清單；opacity 在 0–1', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400"></svg>').svg).toBeNull();
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,400,240"></svg>').svg).not.toBeNull();
    expect(sanitizeSvg(wrap('<polyline points="1,2 3.5,4 -5 6"/>')).svg).not.toBeNull();
    expect(sanitizeSvg(wrap('<polyline points="1,2;3,4"/>')).svg).toBeNull();
    expect(sanitizeSvg(wrap('<line x1="0" stroke-dasharray="4 3"/>')).svg).not.toBeNull();
    expect(sanitizeSvg(wrap('<rect x="0" opacity="1.5"/>')).svg).toBeNull();
    expect(sanitizeSvg(wrap('<rect x="0" fill-opacity="0.25"/>')).svg).not.toBeNull();
  });
  it('path 的 d 只能是指令字母、數字、逗號與空白', () => {
    expect(sanitizeSvg(wrap('<path d="M10 20 L30.5,40 a5 5 0 0 1 10 0 Z"/>')).svg).not.toBeNull();
    expect(sanitizeSvg(wrap('<path d="M10-5l.5.5z"/>')).svg).not.toBeNull();
    expect(sanitizeSvg(wrap('<path d="M10 20 url(#x)"/>')).svg).toBeNull();
    expect(sanitizeSvg(wrap('<path d="M10 20 X 4"/>')).svg).toBeNull();
  });
  it('顏色只收 # 色碼、none 與少數色名', () => {
    for (const ok of ['#fff', '#ffff', '#f6f3ea', '#f6f3eaff', 'none', 'white']) expect(sanitizeSvg(wrap(`<rect x="0" fill="${ok}"/>`)).svg, ok).not.toBeNull();
    for (const bad of ['#ff', 'url(#a)', 'rgb(1,2,3)', 'javascript:alert(1)', 'currentColor', 'expression(1)']) {
      expect(sanitizeSvg(wrap(`<rect x="0" fill="${bad}"/>`)).svg, bad).toBeNull();
    }
  });
});

describe('每一種繞過寫法都要被拒絕', () => {
  const cases: Array<[string, string]> = [
    ['<g/onclick>（斜線分隔的事件屬性）', wrap('<g/onclick="alert(1)"></g>')],
    ['<g onclick>', wrap('<g onclick="alert(1)"></g>')],
    ['<animate> 搭配數字實體', wrap('<a href="#x"><animate attributeName="href" to="&#106;avascript:alert(1)"/></a>')],
    ['<animate>', wrap('<animate attributeName="x" to="1"/>')],
    ['<set>', wrap('<set attributeName="onmouseover" to="alert(1)"/>')],
    ['<a href>', wrap('<a href="https://evil.example/">x</a>')],
    ['沒加引號的 href', wrap('<a href=//evil.example/x>x</a>')],
    ['沒加引號的一般屬性', wrap('<rect x=1 y="0"/>')],
    ['&#106; 數字實體（文字裡）', wrap('<text x="1">&#106;avascript</text>')],
    ['&#x6a; 十六進位實體', wrap('<text x="1">&#x6a;</text>')],
    ['具名實體 &nbsp;', wrap('<text x="1">a&nbsp;b</text>')],
    ['裸 &', wrap('<text x="1">a & b</text>')],
    ['<SCRIPT>', wrap('<SCRIPT>alert(1)</SCRIPT>')],
    ['<script>', wrap('<script>alert(1)</script>')],
    ['<style>', wrap('<style>rect{fill:red}</style>')],
    ['style=', wrap('<rect x="0" style="fill:red"/>')],
    ['url(', wrap('<rect x="0" fill="url(#g)"/>')],
    ['<foreignObject>', wrap('<foreignObject><div>x</div></foreignObject>')],
    ['<image>', wrap('<image href="x.png"/>')],
    ['<use>', wrap('<use href="#a"/>')],
    ['xlink:href', wrap('<rect x="0" xlink:href="#a"/>')],
    ['class／id／transform', wrap('<rect x="0" transform="rotate(4)"/>')],
    ['註解', wrap('<!-- hi --><rect x="0"/>')],
    ['CDATA', wrap('<text x="1"><![CDATA[x]]></text>')],
    ['DOCTYPE 實體', `<!DOCTYPE svg [<!ENTITY x "y">]>${wrap('<text x="1">&x;</text>')}`],
    ['處理指令', `<?xml version="1.0"?>${wrap('')}`],
    ['javascript: 在屬性裡', wrap('<rect x="0" fill="javascript:alert(1)"/>')],
    ['巢狀 <svg>', wrap(`<svg ${NS}></svg>`)],
    ['兩個根元素', `${wrap('')}${wrap('')}`],
    ['文字裡的 <', wrap('<text x="1">a < b</text>')],
    ['屬性值裡的 <', wrap('<text x="1" aria-label="a<b">x</text>')],
    ['大小寫不同的元素名', wrap('<Rect x="0"/>')],
    ['沒有結束標籤', `<svg ${NS}><g>`],
    ['結束標籤不對應', wrap('<g></text>')],
    ['文字放在 <rect> 外面', wrap('hello')],
    ['缺 xmlns', '<svg viewBox="0 0 1 1"></svg>'],
    ['xmlns 不是 SVG', '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 1 1"></svg>'],
    ['role 不是 img', `<svg ${NS} role="button"></svg>`],
    ['重複屬性', wrap('<rect x="0" x="1"/>')],
    ['不是 <svg> 開頭', `<g>${wrap('')}</g>`],
    ['超過長度上限', wrap(`<text x="1">${'字'.repeat(SVG_MAX_CHARS)}</text>`)],
  ];
  for (const [name, svg] of cases) {
    it(name, () => {
      const r = sanitizeSvg(svg);
      expect(r.svg).toBeNull();
      expect(r.problem).toEqual(expect.any(String));
    });
  }

  // 上面的寫法多半也會被屬性白名單或「文字只能在 <text>」擋下；這裡每一個都只有元素本身（沒有屬性、沒有文字），
  // 只能靠元素白名單拒絕：之後把 ELEMENTS 放寬（例如加了 script、a、image），這幾個測試就會失敗。
  const bareElements = [
    '<script/>',
    '<script></script>',
    '<style/>',
    '<foreignObject/>',
    '<image/>',
    '<use/>',
    '<a><rect x="0"/></a>',
    '<animate/>',
    '<animateTransform/>',
    '<set/>',
    '<iframe/>',
    '<filter/>',
    '<feImage/>',
    '<pattern/>',
    '<mask/>',
    '<symbol/>',
    '<switch/>',
    '<linearGradient/>',
  ];
  for (const inner of bareElements) {
    it(`元素白名單：${inner}`, () => {
      const r = sanitizeSvg(wrap(inner));
      expect(r.svg).toBeNull();
      expect(r.problem).toMatch(/^不允許的元素 </);
    });
  }

  it('不是字串的輸入', () => {
    expect(sanitizeSvg(null).svg).toBeNull();
    expect(sanitizeSvg(42).svg).toBeNull();
    expect(isSanitizedSvg(undefined)).toBe(false);
  });
});

it('型別宣告（svg-sanitize.d.mts）列的匯出和實際的模組一致', () => {
  const declared = [...readFileSync(path.join(HERE, 'svg-sanitize.d.mts'), 'utf8').matchAll(/export declare (?:const|function) (\w+)/g)].map((m) => m[1]);
  expect(declared.sort()).toEqual(Object.keys(runtime).sort());
});
