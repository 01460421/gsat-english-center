// 國寫素材庫（筆記版）：HTML 片段 → PDF
// 版面：全書芫荽（Iansui）字體、彩色螢光筆與手寫筆記風格；封面、編輯說明、使用說明、可點選目錄、分部總覽、解答篇、書末附錄
// 用法：node build.mjs            → dist/國寫素材庫.pdf
//       node build.mjs N5,N6      → 只排指定單元的樣張 dist/sample.pdf
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PARTS = `${ROOT}/content`;
const OUT = `${ROOT}/dist/tmp`;
const FS = `${ROOT}/node_modules/@fontsource`;
mkdirSync(OUT, { recursive: true });

// 各部代表色
const COL = {
  intro: { c: '#475569', d: '#334155', s: '#eef2f6', h: '#dbe3ec' },
  p1: { c: '#2f6fb5', d: '#1f4f86', s: '#eaf2fb', h: '#cfe3f8' },
  p2: { c: '#2e8b57', d: '#1f6a41', s: '#e8f5ee', h: '#c9ebd7' },
  p3: { c: '#d9772b', d: '#a85616', s: '#fdf1e5', h: '#fbdcbd' },
  app: { c: '#7a5cc2', d: '#5a3fa0', s: '#f1ecfb', h: '#ddd1f5' },
};
const DESC = {
  N1: '測驗概說；各類素材的用途與用量；引用的步驟',
  N2: '十二種修辭與句式：作用、名家例句、句型、示例',
  N3: '開頭與結尾的類型；段落寫法；論證句型與銜接語',
  N4: '常見平淡用詞的替代詞，分七類，附語氣辨析',
  N5: '作文常用成語，依主題分十六類，附釋義、出處、例句',
  N6: '易誤用、褒貶與對象易錯、易寫錯字的成語',
  N7: '古典名句，依主題分類，附出處、語譯、適用主題',
  N8: '現代作家與外國名言，僅收可查證出處者；附誤傳名言表',
  N9: '古代典故與人物事例，附運用示例',
  N10: '近現代人物事例（臺灣與世界），附運用示例',
  N11: '詩詞名句，依情境分類',
  N12: '易錯字 120 組、標點符號用法、常見語病',
  SRC: '各單元查證過的網站',
};
const PARTDEF = [
  { key: 'intro', label: '導讀', title: '概說', ids: ['N1'] },
  { key: 'p1', label: '第一部', title: '仿寫', sub: '句式・開頭結尾・論證', ids: ['N2', 'N3'] },
  { key: 'p2', label: '第二部', title: '詞語', sub: '替代詞・成語', ids: ['N4', 'N5', 'N6'] },
  { key: 'p3', label: '第三部', title: '引用', sub: '名言・典故・人物・詩詞', ids: ['N7', 'N8', 'N9', 'N10', 'N11'] },
  { key: 'app', label: '第四部', title: '基本功', sub: '易錯字・標點・語病', ids: ['N12'] },
];
const ONLY = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const missing = [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function optCols(html) {
  return html.replace(/<div class="opts">([\s\S]*?)<\/div>/g, (m, inner) => {
    const lens = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').length);
    const mx = Math.max(0, ...lens);
    const cls = mx > 40 ? 'opts v' : mx > 17 ? 'opts h2' : 'opts';
    return `<div class="${cls}">${inner}</div>`;
  });
}
function lines(html) {
  html = optCols(html);
  for (const [a, b] of [['污染', '汙染'], ['佔', '占'], ['裏', '裡'], ['台灣', '臺灣'], ['溼', '濕']]) html = html.split(a).join(b);
  html = html.replace(/<tr>\s*<td>((?:<strong>)?[^<]{1,7}(?:<\/strong>)?)<\/td>/g, '<tr><td class="nw">$1</td>');
  return html.replace(/<div class="lines" data-n="(\d+)"\s*><\/div>/g, (_, n) => {
    const k = Number(n);
    if (k > 2) return '<div class="paper">請用自己的稿紙作答，寫完再對照解答篇。</div>';
    return `<div class="lines" style="height:${k * 8}mm"></div>`;
  });
}

const fontCss = [
  `${FS}/iansui/400.css`,
  `${FS}/lxgw-wenkai-tc/400.css`, `${FS}/lxgw-wenkai-tc/700.css`,
  `${FS}/noto-sans-tc/400.css`, `${FS}/noto-sans-tc/700.css`,
  `${FS}/noto-serif-tc/400.css`, `${FS}/source-serif-4/400.css`, `${FS}/inter/500.css`,
].map((f) => `<link rel="stylesheet" href="file://${f}">`).join('\n');

const CSS = readFileSync(`${ROOT}/base.css`, 'utf8') + readFileSync(`${ROOT}/theme.css`, 'utf8');
const varsOf = (k) => `--c:${COL[k].c};--cd:${COL[k].d};--cs:${COL[k].s};--ch:${COL[k].h}`;

function coverHtml() {
  const tabs = PARTDEF.slice(1).map((p, i) => `<div class="tab" style="top:${58 + i * 34}mm;background:${COL[p.key].c}">${p.title}</div>`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>
@page { size:A4; margin:0; } body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:'Iansui','LXGW WenKai TC','Noto Sans TC','DejaVu Sans',sans-serif;}
.c{width:210mm;height:297mm;position:relative;overflow:hidden;background:#fffdf6;}
.c::before{content:'';position:absolute;inset:0;background:linear-gradient(#dfe8f1 .35mm, transparent .35mm) 0 0/100% 8mm, linear-gradient(90deg,#dfe8f1 .35mm, transparent .35mm) 0 0/8mm 100%;opacity:.75;}
.bar{position:absolute;left:0;top:0;bottom:0;width:17mm;background:#1f2a44;}
.bar i{position:absolute;left:5.5mm;width:6mm;height:6mm;border-radius:50%;background:#fffdf6;}
.tab{position:absolute;right:0;width:27mm;height:27mm;border-radius:5mm 0 0 5mm;color:#fff;font-size:17pt;letter-spacing:.12em;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;}
.kick{position:absolute;left:34mm;top:52mm;font-size:17pt;color:#1f2a44;letter-spacing:.3em;}
.kick b{font-weight:400;background:#1f2a44;color:#fff;padding:1.2mm 3mm 1mm 4mm;border-radius:2mm;margin-right:3mm;letter-spacing:.2em;}
.ti{position:absolute;left:32mm;top:72mm;font-size:74pt;line-height:1.18;color:#1f2a44;letter-spacing:.06em;}
.ti span{background:linear-gradient(transparent 58%, #ffe566 58%, #ffe566 93%, transparent 93%);padding:0 2mm;}
.note{position:absolute;left:35mm;top:158mm;width:118mm;font-size:15pt;line-height:2;color:#2456a6;}
.note u{text-decoration:underline wavy #e05252;text-underline-offset:.28em;text-decoration-thickness:.6pt;}
.stick{position:absolute;left:35mm;top:212mm;width:92mm;background:#fff3a8;padding:6mm 7mm;font-size:12.5pt;line-height:1.85;color:#3b3415;transform:rotate(-1.6deg);box-shadow:1mm 1.3mm 0 rgba(0,0,0,.12);}
.stick b{font-weight:400;color:#c2410c;}
.ft{position:absolute;left:35mm;bottom:17mm;font-size:13pt;color:#1f2a44;letter-spacing:.25em;}
</style></head><body><div class="c"><div class="bar">${[22, 62, 102, 142, 182, 222, 262].map((y) => `<i style="top:${y}mm"></i>`).join('')}</div>${tabs}
<div class="kick"><b>學測國寫</b>情意題・知性題　通用</div>
<div class="ti"><span>國寫</span><br><span>素材庫</span></div>
<div class="note">仿寫句式、替代詞、成語、<u>名言</u>、<u>典故</u>、<br>人物事例、詩詞名句、易錯字與語病</div>
<div class="stick">各條出處與寫法均經<b>查證</b>；<br>查無出處的名言<b>不收</b>。<br>各單元附練習與解答。</div>
<div class="ft">學測英文中心　編</div>
</div></body></html>`;
}

function frontHtml() {
  return `<section class="front" style="${varsOf('intro')}">
<h2 class="fh">編輯說明</h2>
<p>本書供準備學測國語文寫作能力測驗（國寫）的高中生查閱，分四部：仿寫句式、替代詞與成語、可引用的名言典故與詩詞、易錯字與語病。各單元附練習，解答置於書末。</p>
<h3>資料來源與查證</h3>
<ul>
<li>素材蒐集自網路，逐條查證後重新整理、撰寫說明與例句。各單元查證過的網站列於書末〈資料來源〉。</li>
<li><strong>成語</strong>：寫法、釋義與出處依教育部《成語典》與《重編國語辭典修訂本》。辭典未標明典源者，出處欄留空。</li>
<li><strong>古典名句與詩詞</strong>：逐句核對原文；有異文者，採臺灣高中課本與通行寫法，並註「一作……」。</li>
<li><strong>現代與外國名言</strong>：僅收查得原書、原文或可靠出處者；流傳甚廣而查無出處者不收，或列入「常被引錯」表說明。</li>
<li><strong>人物事例</strong>：年代、數字與經過均經查核；無法確定的細節不寫。</li>
</ul>
<h3>未收錄的內容</h3>
<ul>
<li>歷屆試題的官方參考答案、評分原則與考生佳作。</li>
<li>整篇範文。書中示例與參考寫法均為說明用法的短例。</li>
</ul>
<h3>體例</h3>
<ul>
<li>書名用《》，篇名用〈〉，書名與篇名之間用間隔號「・」。</li>
<li>練習題編號為單元代號加流水號（如 N5-03），書末解答依同一編號排列。</li>
<li>表中「出處」指辭典標明的典源；「適用主題」為取材方向，非限定用法。</li>
</ul>
</section>
<section class="front legend" style="${varsOf('p1')};break-before:page">
<h2 class="fh">使用說明</h2>
<h3>記號圖例</h3>
<table class="t"><thead><tr><th style="width:34%">記號</th><th>意義</th></tr></thead><tbody>
<tr><td><strong>黃色螢光筆</strong></td><td>該段的關鍵詞句。</td></tr>
<tr><td><em>紅色波浪線</em></td><td>易忽略或易誤之處。</td></tr>
<tr><td><span class="lg-eg">示例</span></td><td>例句或參考寫法；其下藍色小字為出處或標註。</td></tr>
<tr><td><span class="mark lg-bad">誤</span>　<span class="mark lg-good">正</span></td><td>同一句的誤例與改正。</td></tr>
<tr><td><span class="exid">N5-03</span></td><td>練習題編號。</td></tr>
<tr><td>☐ 自我檢核</td><td>各單元末的檢核項目。</td></tr>
</tbody></table>
<div class="key"><p>重點整理：規則、步驟、固定用法。</p></div>
<div class="tip"><p>延伸補充：相關知識、辨析與記憶要點。</p></div>
<div class="warn"><p>易錯提醒：常見的誤用、誤寫與誤引。</p></div>
<h3>各部代表色</h3>
<div class="chips">${PARTDEF.map((p) => `<span style="background:${COL[p.key].c}">${p.label}　${p.title}</span>`).join('')}</div>
<h3>查閱方式</h3>
<table class="t"><thead><tr><th style="width:34%">需求</th><th>查閱位置</th></tr></thead><tbody>
<tr><td>依主題找成語、名言、事例</td><td>書末附二〈細目索引〉</td></tr>
<tr><td>核對名言或詩詞的字句與作者</td><td>N7、N8、N11 各表；「常被引錯」表</td></tr>
<tr><td>確認成語用法與寫法</td><td>N6</td></tr>
<tr><td>替換重複用詞</td><td>N4</td></tr>
<tr><td>核對選擇題答案</td><td>書末附一〈選擇題答案速查〉</td></tr>
</tbody></table>
</section>`;
}

const want = (id) => !ONLY || ONLY.has(id);
function build(pages = {}) {
  const pg = (k) => pages[k] ?? '00';
  const segs = [], toc = [], idx = [], quick = [];
  let hn = 0;
  toc.push(`<a class="row" href="#front"><span class="code"></span><span class="name">編輯說明・使用說明</span><span class="dots"></span><span class="pg">${pg('FRONT')}</span></a>`);
  for (const P of PARTDEF) {
    const ids = P.ids.filter(want);
    if (!ids.length) continue;
    const st = varsOf(P.key);
    if (P.key !== 'intro' && !ONLY) {
      const rows = ids.map((id) => {
        const b = read(`${PARTS}/${id}.body.html`);
        const t = b ? (b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? id).replace(/<[^>]+>/g, '').replace(/^[A-Z]\w*[\s　]+/, '') : id;
        return `<a class="ov" href="#${id}"><span class="oc">${id}</span><span class="ot">${t}<i>${DESC[id] ?? ''}</i></span><span class="op">${pg(id)}</span></a>`;
      }).join('');
      segs.push(`<section class="divider" id="div-${P.key}" style="${st}"><span class="mk">@@DIV${P.key}@@</span><div class="k">${P.label}</div><div class="t">${P.title}</div><div class="e">${P.sub ?? ''}</div><div class="ovs">${rows}</div></section>`);
    }
    toc.push(`<a class="row part" style="${st}" href="#${P.key === 'intro' ? ids[0] : `div-${P.key}`}"><span class="name">${P.label}　${P.title}</span><span class="dots"></span><span class="pg">${pg(P.key === 'intro' ? ids[0] : `DIV${P.key}`)}</span></a>`);
    for (const id of ids) {
      const b = read(`${PARTS}/${id}.body.html`);
      if (!b) { missing.push(id); continue; }
      let title = id;
      let bb = lines(b).replace('<section class="unit"', `<section class="unit" style="${st}"`);
      bb = bb.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/, (m, attrs, inner) => {
        const mm = inner.trim().match(/^([A-Za-z]\w{0,3})[\s　]+([\s\S]+)$/);
        const code = mm ? mm[1] : id, ttl = mm ? mm[2] : inner.trim();
        title = ttl.replace(/<[^>]+>/g, '');
        return `<h2 class="opener"${attrs}><span class="mk">@@${id}@@</span><span class="code">${code}</span><span class="ttl">${ttl}</span><span class="chip">${P.label}　${P.title}</span></h2>`;
      });
      const hs = [];
      bb = bb.replace(/<h3>([\s\S]*?)<\/h3>/g, (m, inner) => {
        hn++;
        const t = inner.replace(/<[^>]+>/g, '').trim();
        if (!/自我檢核/.test(t)) hs.push(`<a class="ir" href="#h-${hn}"><span class="name">${t}</span><span class="dots"></span><span class="pg">${pg(`H${hn}`)}</span></a>`);
        return `<h3 id="h-${hn}"><span class="mk">@@H${hn}@@</span>${inner}</h3>`;
      });
      segs.push(bb);
      toc.push(`<a class="row" style="${st}" href="#${id}"><span class="code">${id}</span><span class="name">${title}</span><span class="dots"></span><span class="pg">${pg(id)}</span></a>`);
      idx.push(`<div class="ig" style="${st}"><div class="ih"><span>${id}</span>${title}</div>${hs.join('')}</div>`);
    }
  }
  // 解答篇
  const ans = [];
  for (const P of PARTDEF) for (const id of P.ids) {
    if (!want(id)) continue;
    const a = read(`${PARTS}/${id}.ans.html`);
    if (!a || !/class="(ans|aset)"/.test(a)) continue;
    ans.push(a.replace('<section class="ans-unit"', `<section class="ans-unit" style="${varsOf(P.key)}"`));
    const mc = [...a.matchAll(/<span class="exid">([^<]+)<\/span>\s*(?:<strong>)?\(([A-E])\)/g)].map((x) => `<span><i>${x[1].replace(/^N\d+-/, '')}</i>${x[2]}</span>`);
    if (mc.length) quick.push(`<div class="qk" style="${varsOf(P.key)}"><b>${id}</b>${mc.join('')}</div>`);
  }
  if (ans.length) {
    segs.push(`<section class="divider" id="ans" style="${varsOf('intro')}"><span class="mk">@@ANS@@</span><div class="k">解答篇</div><div class="t">解答與說明</div><div class="e">依單元與題號排列；參考寫法非唯一答案</div></section>`);
    toc.push(`<a class="row part" style="${varsOf('intro')}" href="#ans"><span class="name">解答篇</span><span class="dots"></span><span class="pg">${pg('ANS')}</span></a>`);
    segs.push(`<div class="answers" style="break-before:page">${lines(ans.join('\n'))}</div>`);
  }
  // 書末附錄
  if (!ONLY) {
    const st = varsOf('app');
    toc.push(`<a class="row part" style="${st}" href="#apx1"><span class="name">書末附錄</span><span class="dots"></span><span class="pg">${pg('APX1')}</span></a>`);
    toc.push(`<a class="row" style="${st}" href="#apx1"><span class="code">附一</span><span class="name">選擇題答案速查</span><span class="dots"></span><span class="pg">${pg('APX1')}</span></a>`);
    toc.push(`<a class="row" style="${st}" href="#apx2"><span class="code">附二</span><span class="name">細目索引（附頁碼）</span><span class="dots"></span><span class="pg">${pg('APX2')}</span></a>`);
    toc.push(`<a class="row" style="${st}" href="#SRC"><span class="code">附三</span><span class="name">資料來源</span><span class="dots"></span><span class="pg">${pg('SRC')}</span></a>`);
    segs.push(`<section class="unit apx" id="apx1" style="${st}"><h2 class="opener"><span class="mk">@@APX1@@</span><span class="code">附一</span><span class="ttl">選擇題答案速查</span><span class="chip">書末附錄</span></h2><p>僅列選擇題答案，題號省略單元代號。寫作題與改寫題的參考寫法見解答篇。</p>${quick.join('')}</section>`);
    segs.push(`<section class="unit apx" id="apx2" style="${st}"><h2 class="opener"><span class="mk">@@APX2@@</span><span class="code">附二</span><span class="ttl">細目索引</span><span class="chip">書末附錄</span></h2><p>各單元各節的頁碼。</p><div class="idx">${idx.join('')}</div></section>`);
    const s = read(`${PARTS}/SRC.body.html`);
    if (s) segs.push(s.replace('<section class="unit"', `<section class="unit apx" style="${st}"`).replace(/<h2>([\s\S]*?)<\/h2>/, `<h2 class="opener"><span class="mk">@@SRC@@</span><span class="code">附三</span><span class="ttl">資料來源</span><span class="chip">書末附錄</span></h2>`));
  }
  const tocHtml = ONLY ? '' : `<section class="toc" id="toc" style="break-before:page"><h2>目錄</h2>${toc.join('\n')}</section>`;
  const front = ONLY ? '' : `<div id="front"><span class="mk">@@FRONT@@</span>${frontHtml()}</div>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${CSS}</style></head><body>${front}${tocHtml}${segs.join('\n')}</body></html>`;
}

const footer = `<div style="width:100%;font-size:8pt;color:#64748b;font-family:'WenQuanYi Zen Hei',sans-serif;padding:0 15mm;display:flex;justify-content:space-between;"><span style="letter-spacing:.2em">國寫素材庫</span><span class="pageNumber" style="font-family:'Liberation Serif',serif;font-size:9.5pt"></span></div>`;
async function render(page, html, file, withFooter) {
  writeFileSync(file.replace(/\.pdf$/, '.html'), html);
  await page.goto(`file://${file.replace(/\.pdf$/, '.html')}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: withFooter, headerTemplate: '<span></span>', footerTemplate: withFooter ? footer : '<span></span>' });
}
const scan = (f) => {
  const found = {};
  execFileSync('pdftotext', ['-raw', f, '-'], { maxBuffer: 1 << 28 }).toString().split('\f').forEach((t, i) => { for (const m of t.matchAll(/@ ?@ ?([A-Za-z0-9 ]+?) ?@ ?@/g)) { const k = m[1].replace(/ /g, ''); if (!(k in found)) found[k] = i + 1; } });
  return found;
};

const browser = await chromium.launch();
const page = await browser.newPage();
await render(page, coverHtml(), `${OUT}/cover.pdf`, false);
let found = {};
let same = false;
for (let pass = 0; pass < 4 && !same; pass++) {
  await render(page, build(found), `${OUT}/body.pdf`, true);
  const f2 = scan(`${OUT}/body.pdf`);
  same = pass > 0 && JSON.stringify(f2) === JSON.stringify(found);
  found = f2;
}
await browser.close();
// 封面插到最前面（保留本文內的超連結）
const FINAL = ONLY ? `${ROOT}/dist/sample.pdf` : `${ROOT}/dist/國寫素材庫.pdf`;
if (ONLY) copyFileSync(`${OUT}/body.pdf`, FINAL);
else execFileSync('python3', [`${ROOT}/join.py`, `${OUT}/cover.pdf`, `${OUT}/body.pdf`, FINAL]);
const n = Number(execFileSync('pdfinfo', [`${OUT}/body.pdf`]).toString().match(/Pages:\s+(\d+)/)[1]);
const ids = PARTDEF.flatMap((p) => p.ids).filter((id) => found[id]);
const len = {}; ids.forEach((id, i) => { const nx = ids[i + 1] ? (found[`DIV${PARTDEF.find((p) => p.ids[0] === ids[i + 1])?.key}`] ?? found[ids[i + 1]]) : (found.ANS ?? n + 1); len[id] = nx - found[id]; });
console.log(same ? '頁數一致 ✓' : '頁數不一致，請再執行一次');
console.log(JSON.stringify({ file: FINAL, pages: ONLY ? n : n + 1, body: n, consistent: same, answers: found.ANS && found.APX1 ? found.APX1 - found.ANS : 0, missing: [...new Set(missing)], len }));
