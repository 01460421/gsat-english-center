// 30 冊版：封底、書背與封面展開圖
// node covers30.mjs [起] [迄]  → dist/books30-covers/{back,spine,spread}_NN.pdf
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FS = `${ROOT}/node_modules/@fontsource`;
const PARTS = '/tmp/claude-0/zhw/sci/parts';
const OUTD = `${ROOT}/dist/books30-covers`;
mkdirSync(OUTD, { recursive: true });
const BOOK = '學測自然知識庫';
const S = JSON.parse(readFileSync(`${ROOT}/books30.json`, 'utf8'));
const VOLS = S.vols;
const COL = { blue: '#2f6fb5', green: '#2e8b57', orange: '#d9772b', purple: '#7a5cc2', teal: '#1f8a8a', rose: '#c2476b' };
const SUBJ = { 物理: '#2f6fb5', 化學: '#2e8b57', 生物: '#c2476b', 地科: '#7a5cc2', 探究: '#1f8a8a', 科學班: '#d9772b' };
const fontCss = [`${FS}/iansui/400.css`, `${FS}/lxgw-wenkai-tc/400.css`, `${FS}/noto-sans-tc/400.css`, `${FS}/inter/500.css`]
  .map((f) => `<link rel="stylesheet" href="file://${f}">`).join('\n');
const LOGO = (w) => `<svg style="width:${w}mm;height:${w}mm" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="47" fill="#1f2a44"/><path d="M17 62 A33 33 0 0 1 83 62" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/><line x1="12" y1="70" x2="88" y2="70" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".55"/><ellipse cx="50" cy="54" rx="27" ry="10.5" transform="rotate(-24 50 54)" fill="none" stroke="#f08a3c" stroke-width="4"/><circle cx="50" cy="54" r="6.5" fill="#f5c542"/><circle cx="74.5" cy="43" r="3.6" fill="#7fd1c7"/><path d="M68 22 L70 28 L76 30 L70 32 L68 38 L66 32 L60 30 L66 28 Z" fill="#f5c542"/></svg>`;
const title = (id) => {
  const f = `${PARTS}/${id}.body.html`;
  if (!existsSync(f)) return '';
  const m = readFileSync(f, 'utf8').match(/<h2>[A-Z]+\d+[　\s]+([^<]+)<\/h2>/);
  return m ? m[1].trim() : '';
};
const finalPdf = (n) => {
  const d = `${ROOT}/dist/books30`;
  const f = readdirSync(d).find((x) => x.includes(`_${VOLS[n].no}_`));
  return f ? `${d}/${f}` : null;
};
const pagesOf = (f) => Number(execFileSync('pdfinfo', [f]).toString().match(/Pages:\s+(\d+)/)[1]);
const spineMm = (pages) => Math.max(6, Math.round((pages * 0.055 + 1) * 10) / 10);

const BASE = `@page{margin:0} body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:'Iansui','LXGW WenKai TC','Noto Sans TC',sans-serif;color:#1f2a44}`;

function backHtml(n) {
  const V = VOLS[n];
  const acc = SUBJ[V.tag] || '#1f2a44';
  const units = V.parts.flatMap((p) => p.ids).map((id) => `<li><b>${id}</b>${title(id)}</li>`).join('');
  const grid = Object.entries(VOLS).map(([k, v]) => {
    const on = Number(k) === n;
    const c = SUBJ[v.tag] || '#1f2a44';
    const short = v.title.replace(/^科學班入學考試題詳解・/, '').replace(/（[一二三四]）/, ' ').replace(/^(.{0,9}).*$/, '$1');
    return `<div class="g${on ? ' on' : ''}" style="--k:${c}"><i>${v.no.replace('第', '').replace('冊', '')}</i><span>${short}</span></div>`;
  }).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${BASE}
@page{size:210mm 297mm}
.c{width:210mm;height:297mm;position:relative;overflow:hidden;background:#fffdf6}
.c::before{content:'';position:absolute;inset:0;background:linear-gradient(#dfe8f1 .35mm, transparent .35mm) 0 0/100% 8mm, linear-gradient(90deg,#dfe8f1 .35mm, transparent .35mm) 0 0/8mm 100%;opacity:.75}
.bar{position:absolute;right:0;top:0;bottom:0;width:17mm;background:#1f2a44}
.bar i{position:absolute;right:5.5mm;width:6mm;height:6mm;border-radius:50%;background:#fffdf6}
.hd{position:absolute;left:22mm;top:22mm;right:30mm}
.hd .s{font-size:12pt;letter-spacing:.3em;color:#64748b}
.hd .t{font-size:${V.title.length > 18 ? 14 : V.title.length > 11 ? 17 : 24}pt;letter-spacing:.06em;margin-top:2mm;white-space:nowrap}
.hd .t b{font-weight:400;background:${acc};color:#fff;border-radius:2mm;padding:.6mm 3mm;margin-right:3mm;font-size:15pt;vertical-align:.12em}
.bl{position:absolute;left:22mm;top:52mm;width:150mm;font-size:12.5pt;line-height:1.9;color:#2456a6}
.box{position:absolute;left:22mm;top:82mm;width:150mm;background:#fff;border:.4mm solid ${acc};border-radius:3mm;padding:4mm 6mm 3mm}
.box h3{margin:0 0 2mm;font-weight:400;font-size:12.5pt;color:${acc};letter-spacing:.2em}
.box ul{margin:0;padding:0;list-style:none;columns:${V.parts.flatMap((p) => p.ids).length > 4 ? 2 : 1};column-gap:8mm}
.box li{font-size:11pt;line-height:1.75;break-inside:avoid}
.box li b{font-family:Inter,sans-serif;font-weight:500;font-size:9pt;color:#fff;background:${acc};border-radius:1mm;padding:0 1.4mm;margin-right:2mm}
.ser{position:absolute;left:22mm;top:170mm;width:150mm}
.ser h3{margin:0 0 2mm;font-weight:400;font-size:12pt;letter-spacing:.2em;color:#475569}
.gr{display:grid;grid-template-columns:repeat(5,1fr);gap:1.6mm}
.g{display:flex;align-items:center;gap:1.4mm;border:.3mm solid #cbd5e1;border-radius:1.4mm;padding:1mm 1.4mm;background:#fff;font-size:7.6pt;line-height:1.25;color:#475569;min-height:8.5mm}
.g i{font-style:normal;flex:none;width:6mm;height:6mm;border-radius:50%;background:var(--k);color:#fff;font-size:6.6pt;display:flex;align-items:center;justify-content:center}
.g.on{border-color:var(--k);background:var(--k);color:#fff}.g.on i{background:#fff;color:var(--k)}
.ft{position:absolute;left:22mm;bottom:18mm;display:flex;align-items:center;gap:3.5mm}
.ft .bn{font-size:16pt;letter-spacing:.32em}
.ft .be{font-family:Inter,sans-serif;font-size:7.5pt;letter-spacing:.28em;color:#64748b;border-left:.3mm solid #94a3b8;padding-left:3mm}
.tg{position:absolute;left:22mm;bottom:9mm;font-size:9pt;color:#94a3b8;letter-spacing:.15em}
</style></head><body><div class="c"><div class="bar">${[22, 62, 102, 142, 182, 222, 262].map((y) => `<i style="top:${y}mm"></i>`).join('')}</div>
<div class="hd"><div class="s">${BOOK}</div><div class="t"><b>${V.no}</b>${V.title}</div></div>
<div class="bl">${V.blurb}</div>
<div class="box"><h3>本冊內容</h3><ul>${units}</ul></div>
<div class="ser"><h3>全套三十冊</h3><div class="gr">${grid}</div></div>
<div class="ft">${LOGO(14)}<span class="bn">穹理書房</span><span class="be">QIONGLI STUDIO</span></div>
<div class="tg">穹蒼之理・自然科學參考書</div>
</div></body></html>`;
}

function spineHtml(n, w) {
  const V = VOLS[n];
  const acc = SUBJ[V.tag] || '#1f2a44';
  const t = V.title.replace(/^科學班入學考試題詳解・/, '科學班詳解　');
  const fs = Math.min(13, Math.max(7.5, w * 0.62));
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${BASE}
@page{size:${w}mm 297mm}
.s{width:${w}mm;height:297mm;background:#1f2a44;position:relative;overflow:hidden;color:#fff}
.band{position:absolute;left:0;right:0;top:0;height:20mm;background:${acc}}
.no{position:absolute;left:0;right:0;top:4mm;text-align:center;font-family:Inter,sans-serif;font-size:${Math.min(16, w * 0.9)}pt;line-height:1}
.no small{display:block;font-family:'Iansui',sans-serif;font-size:${Math.min(8, w * 0.5)}pt;margin-top:1.5mm;letter-spacing:.1em}
.v{position:absolute;left:50%;transform:translateX(-50%);writing-mode:vertical-rl;white-space:nowrap}
.bk{top:27mm;font-size:${fs * 0.72}pt;letter-spacing:.32em;color:#cbd5e1}
.ti{top:84mm;font-size:${fs}pt;letter-spacing:.18em;max-height:160mm;overflow:hidden}
.lg{position:absolute;left:50%;transform:translateX(-50%);bottom:24mm}
.bn{bottom:7mm;top:auto;font-size:${Math.min(8.5, w * 0.55)}pt;letter-spacing:.25em;color:#cbd5e1}
</style></head><body><div class="s"><div class="band"></div>
<div class="no">${n}<small>冊</small></div>
<div class="v bk">${BOOK}</div>
<div class="v ti">${t}</div>
<div class="lg">${LOGO(Math.min(10, w - 1.6))}</div>
<div class="v bn">穹理書房</div>
</div></body></html>`;
}

const [a, b] = [Number(process.argv[2] || 1), Number(process.argv[3] || 30)];
const browser = await chromium.launch();
const page = await browser.newPage();
const out = [];
for (let n = a; n <= b; n++) {
  const f = finalPdf(n);
  if (!f) { console.log(`第 ${n} 冊尚未排版，略過`); continue; }
  const pages = pagesOf(f) + 1; // 含封底
  const w = spineMm(pages);
  const nn = String(n).padStart(2, '0');
  for (const [kind, html, size] of [['back', backHtml(n), { width: '210mm', height: '297mm' }], ['spine', spineHtml(n, w), { width: `${w}mm`, height: '297mm' }]]) {
    writeFileSync(`${OUTD}/_${kind}.html`, html);
    await page.goto(`file://${OUTD}/_${kind}.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: `${OUTD}/${kind}_${nn}.pdf`, ...size, printBackground: true, preferCSSPageSize: true });
  }
  out.push({ n, file: f, pages, spine: w });
}
await browser.close();
console.log(JSON.stringify(out));
