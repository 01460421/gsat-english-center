// 學測國文知識庫：HTML 片段 → PDF（三冊）
// 用法：node build.mjs            → 三冊都排
//       node build.mjs 2          → 只排第二冊
//       node build.mjs 1 Z1,F1    → 只排指定單元的樣張 dist/sample.pdf
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PARTS = `${ROOT}/content`;
const SRC = `${ROOT}/sources`;
const OUT = `${ROOT}/dist/tmp`;
const FS = `${ROOT}/node_modules/@fontsource`;
mkdirSync(OUT, { recursive: true });

const BOOK = '學測國文知識庫';
// 各部代表色
const COL = {
  intro: { c: '#475569', d: '#334155', s: '#eef2f6', h: '#dbe3ec' },
  blue: { c: '#2f6fb5', d: '#1f4f86', s: '#eaf2fb', h: '#cfe3f8' },
  green: { c: '#2e8b57', d: '#1f6a41', s: '#e8f5ee', h: '#c9ebd7' },
  orange: { c: '#d9772b', d: '#a85616', s: '#fdf1e5', h: '#fbdcbd' },
  purple: { c: '#7a5cc2', d: '#5a3fa0', s: '#f1ecfb', h: '#ddd1f5' },
  teal: { c: '#1f8a8a', d: '#146464', s: '#e6f5f5', h: '#c4e8e8' },
  rose: { c: '#c2476b', d: '#93304e', s: '#fceef2', h: '#f6d3dd' },
};
const W = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `W${String(a + i).padStart(2, '0')}`);
const VOLS = {
  1: {
    no: '第一冊', title: '語文基礎與國學常識', lines: ['語文基礎', '國學常識'],
    blurb: '字音、字形、字義、文言虛詞與句式、修辭、語法、<br>詞語與應用文、經史子集、文學流變、作家、文化常識',
    parts: [
      { color: 'blue', label: '第一部', title: '字音字形字義', sub: '多音字・形近字・文言實詞・古今異義', ids: ['Z1', 'Z2', 'Z3', 'Z4'] },
      { color: 'green', label: '第二部', title: '文法與修辭', sub: '虛詞・句式・詞類活用・修辭・語法', ids: ['F1', 'F2', 'F3', 'F4'] },
      { color: 'orange', label: '第三部', title: '詞語與應用文', sub: '謙敬詞・稱謂・書信・題辭・對聯', ids: ['C1', 'C2'] },
      { color: 'purple', label: '第四部', title: '國學常識', sub: '經史子集・文學流變・作家・文化常識', ids: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11'] },
    ],
  },
  2: {
    no: '第二冊', title: '古文解釋與閱讀', lines: ['古文解釋', '閱讀題型'],
    blurb: '核心古文十五篇：原文、注釋、語譯、結構、重點整理；<br>論孟諸子、詩詞曲選讀；文言與白話閱讀、題型解法',
    parts: [
      { color: 'rose', label: '第一部', title: '核心古文十五篇', sub: '原文・注釋・語譯・重點整理', ids: W(1, 15) },
      { color: 'teal', label: '第二部', title: '經典與詩詞選讀', sub: '論孟・諸子・詩經楚辭・唐詩・宋詞元曲', ids: W(16, 22) },
      { color: 'blue', label: '第三部', title: '閱讀與題型', sub: '題型解法・文言閱讀・白話與圖表', ids: ['R1', 'R2', 'R3'] },
    ],
  },
  3: {
    no: '第三冊', title: '寫作素材', lines: ['國寫', '素材庫'],
    blurb: '仿寫句式、替代詞、成語、名言、典故、<br>人物事例、詩詞名句、易錯字與語病',
    parts: [
      { color: 'intro', label: '導讀', title: '概說', ids: ['N1'], plain: true },
      { color: 'blue', label: '第一部', title: '仿寫', sub: '句式・開頭結尾・論證', ids: ['N2', 'N3'] },
      { color: 'green', label: '第二部', title: '詞語', sub: '替代詞・成語', ids: ['N4', 'N5', 'N6'] },
      { color: 'orange', label: '第三部', title: '引用', sub: '名言・典故・人物・詩詞', ids: ['N7', 'N8', 'N9', 'N10', 'N11'] },
      { color: 'purple', label: '第四部', title: '基本功', sub: '易錯字・標點・語病', ids: ['N12'] },
      { color: 'rose', label: '第五部', title: '進階', sub: '詞藻・典故語・意象・名家筆法・論證・敘事・句式', ids: ['N13', 'N14', 'N15', 'N16', 'N17', 'N18', 'N19'] },
    ],
  },
};
const DESC = JSON.parse(readFileSync(`${ROOT}/desc.json`, 'utf8'));

const VOLARG = process.argv[2] && /^[123]$/.test(process.argv[2]) ? [Number(process.argv[2])] : [1, 2, 3];
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);

function optCols(html) {
  return html.replace(/<div class="opts">([\s\S]*?)<\/div>/g, (m, inner) => {
    const lens = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').length);
    const mx = Math.max(0, ...lens);
    const cls = mx > 40 ? 'opts v' : mx > 17 ? 'opts h2' : lens.length === 5 ? 'opts h5' : 'opts';
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

function coverHtml(V) {
  const tabs = V.parts.filter((p) => !p.plain).map((p, i) => `<div class="tab" style="top:${52 + i * 33}mm;background:${COL[p.color].c}">${p.title.length > 4 ? p.title.slice(0, 4) : p.title}</div>`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>
@page { size:A4; margin:0; } body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-family:'Iansui','LXGW WenKai TC','Noto Sans TC','DejaVu Sans',sans-serif;}
.c{width:210mm;height:297mm;position:relative;overflow:hidden;background:#fffdf6;}
.c::before{content:'';position:absolute;inset:0;background:linear-gradient(#dfe8f1 .35mm, transparent .35mm) 0 0/100% 8mm, linear-gradient(90deg,#dfe8f1 .35mm, transparent .35mm) 0 0/8mm 100%;opacity:.75;}
.bar{position:absolute;left:0;top:0;bottom:0;width:17mm;background:#1f2a44;}
.bar i{position:absolute;left:5.5mm;width:6mm;height:6mm;border-radius:50%;background:#fffdf6;}
.tab{position:absolute;right:0;width:27mm;height:27mm;border-radius:5mm 0 0 5mm;color:#fff;font-size:13.5pt;letter-spacing:.08em;line-height:1.25;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;}
.kick{position:absolute;left:34mm;top:44mm;font-size:17pt;color:#1f2a44;letter-spacing:.3em;}
.kick b{font-weight:400;background:#1f2a44;color:#fff;padding:1.2mm 3mm 1mm 4mm;border-radius:2mm;margin-right:3mm;letter-spacing:.2em;}
.bk{position:absolute;left:34mm;top:62mm;font-size:30pt;color:#1f2a44;letter-spacing:.12em;}
.ti{position:absolute;left:32mm;top:84mm;font-size:66pt;line-height:1.2;color:#1f2a44;letter-spacing:.06em;}
.ti span{background:linear-gradient(transparent 58%, #ffe566 58%, #ffe566 93%, transparent 93%);padding:0 2mm;}
.note{position:absolute;left:35mm;top:166mm;width:122mm;font-size:14pt;line-height:2;color:#2456a6;}
.stick{position:absolute;left:35mm;top:212mm;width:96mm;background:#fff3a8;padding:6mm 7mm;font-size:12.5pt;line-height:1.85;color:#3b3415;transform:rotate(-1.6deg);box-shadow:1mm 1.3mm 0 rgba(0,0,0,.12);}
.stick b{font-weight:400;color:#c2410c;}
.ft{position:absolute;left:35mm;bottom:17mm;font-size:13pt;color:#1f2a44;letter-spacing:.25em;}
</style></head><body><div class="c"><div class="bar">${[22, 62, 102, 142, 182, 222, 262].map((y) => `<i style="top:${y}mm"></i>`).join('')}</div>${tabs}
<div class="kick"><b>${V.no}</b>${V.title}</div>
<div class="bk">${BOOK}</div>
<div class="ti">${V.lines.map((l) => `<span>${l}</span>`).join('<br>')}</div>
<div class="note">${V.blurb}</div>
<div class="stick">字音字形依<b>教育部辭典</b>；<br>原文逐字<b>核對</b>，出處逐條查證。<br>各單元附測驗與解答。</div>
<div class="ft">學測英文中心　編</div>
</div></body></html>`;
}

function frontHtml(V, vol) {
  const chips = V.parts.map((p) => `<span style="background:${COL[p.color].c}">${p.label}　${p.title}</span>`).join('');
  const volRows = Object.entries(VOLS).map(([k, v]) => `<tr><td>${v.no}　${v.title}</td><td>${v.parts.map((p) => p.title).join('、')}</td></tr>`).join('');
  const origLegend = vol === 2 ? `<div class="orig"><p>原文：若<strong>舍</strong><sup>1</sup>鄭以為<em>東道主</em><sup>2</sup>。螢光筆為重要字詞，波浪線為易考、易錯處，上標數字對應注釋。</p></div><ol class="notes"><li><strong>注釋</strong>：逐字解釋，標明詞性、活用、通同字。</li><li><strong>編號</strong>：每段原文各自由 1 起算。</li></ol><div class="trans"><p>語譯：依原文逐句翻譯。</p></div>` : '';
  return `<section class="front" style="${varsOf('intro')}">
<h2 class="fh">編輯說明</h2>
<p>《${BOOK}》供準備學測國文（國語文綜合能力測驗、國語文寫作能力測驗）的高中生查閱，全套三冊：</p>
<table class="t"><thead><tr><th style="width:38%">冊別</th><th>內容</th></tr></thead><tbody>${volRows}</tbody></table>
<h3>資料來源與查證</h3>
<ul>
<li><strong>字音、字形、字義、成語</strong>：依教育部《重編國語辭典修訂本》《國語辭典簡編本》《成語典》《異體字字典》。辭典兩讀或兩種寫法皆收者，不列為錯誤，並予註明。</li>
<li><strong>古文原文</strong>：逐字核對，採臺灣高中課本通行的版本與標點；有異文者註「一作……」。注釋與語譯均為重新撰寫。</li>
<li><strong>國學常識、文學史、作家</strong>：朝代、字號、並稱、作品集、文體歸屬均經查核；各家說法不一者，採高中課本通行之說，必要時註「一說」。</li>
<li><strong>名言與人物事例</strong>：僅收查得可靠出處者。</li>
<li>各單元查證所用的主要網站列於書末〈資料來源〉。</li>
</ul>
<h3>未收錄的內容</h3>
<ul>
<li>歷屆試題原題、官方參考答案、評分原則與考生佳作。各單元測驗均為自編。</li>
<li>仍有著作權的現代文學作品全文；引用以短句為限，並標明作者與篇名。</li>
</ul>
<h3>體例</h3>
<ul>
<li>書名用《》，篇名用〈〉，書名與篇名之間用間隔號「・」。</li>
<li>字音以注音符號標示。</li>
<li>測驗題編號為單元代號加流水號（如 F1-03），書末解答依同一編號排列。</li>
</ul>
</section>
<section class="front legend" style="${varsOf('blue')};break-before:page">
<h2 class="fh">使用說明</h2>
<h3>記號圖例</h3>
<table class="t"><thead><tr><th style="width:34%">記號</th><th>意義</th></tr></thead><tbody>
<tr><td><strong>黃色螢光筆</strong></td><td>該段的關鍵詞句。</td></tr>
<tr><td><em>紅色波浪線</em></td><td>易忽略或易誤之處。</td></tr>
<tr><td><span class="lg-eg">例句</span></td><td>例句或引文；其下藍色小字為出處、語譯或標註。</td></tr>
<tr><td><span class="mark lg-bad">誤</span>　<span class="mark lg-good">正</span></td><td>誤例與改正。</td></tr>
<tr><td><span class="exid">F1-03</span></td><td>測驗題編號。</td></tr>
<tr><td>☐ 自我檢核</td><td>各單元末的檢核項目。</td></tr>
</tbody></table>
<div class="key"><p>重點整理：規則、步驟、口訣。</p></div>
<div class="tip"><p>延伸補充：相關知識、辨析與記憶要點。</p></div>
<div class="warn"><p>易錯提醒：常見的誤判、誤用與誤寫。</p></div>
${origLegend}
<h3>本冊各部代表色</h3>
<div class="chips">${chips}</div>
<h3>查閱方式</h3>
<table class="t"><thead><tr><th style="width:34%">需求</th><th>查閱位置</th></tr></thead><tbody>
<tr><td>依主題或條目查頁碼</td><td>書末附二〈細目索引〉</td></tr>
<tr><td>核對選擇題答案</td><td>書末附一〈選擇題答案速查〉</td></tr>
<tr><td>查看解析</td><td>解答篇，依單元與題號排列</td></tr>
</tbody></table>
</section>`;
}

function sourcesHtml(ids) {
  const h = ['<p>各單元查證所用的主要網站如下。</p>'];
  for (const id of ids) {
    const f = `${SRC}/${id}.sources.json`;
    if (!existsSync(f)) continue;
    let src; try { src = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    const c = new Map();
    for (const x of src) { let d = ''; try { d = new URL(x.url).hostname.replace(/^www\./, ''); } catch { /* 非網址 */ } if (d) c.set(d, (c.get(d) ?? 0) + 1); }
    const top = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([d]) => d);
    h.push(`<h4>${id}　${TITLES[id] ?? ''}（查證 ${src.length} 筆）</h4><p class="src">${top.join('、')}</p>`);
  }
  return h.join('\n');
}

const TITLES = {};
let missing = [];
function build(V, vol, pages = {}) {
  const want = (id) => !ONLY || ONLY.has(id);
  const pg = (k) => pages[k] ?? '00';
  const segs = [], toc = [], idx = [], quick = [], used = [];
  let hn = 0;
  toc.push(`<a class="row" href="#front"><span class="code"></span><span class="name">編輯說明・使用說明</span><span class="dots"></span><span class="pg">${pg('FRONT')}</span></a>`);
  V.parts.forEach((P, pi) => {
    const ids = P.ids.filter(want);
    if (!ids.length) return;
    const st = varsOf(P.color);
    const dk = `DIV${pi}`;
    if (!P.plain && !ONLY) {
      const rows = ids.map((id) => {
        const b = read(`${PARTS}/${id}.body.html`);
        const t = b ? (b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? id).replace(/<[^>]+>/g, '').replace(/^[A-Z]\w*[\s　]+/, '') : id;
        return `<a class="ov" href="#${id}"><span class="oc">${id}</span><span class="ot">${t}<i>${DESC[id] ?? ''}</i></span><span class="op">${pg(id)}</span></a>`;
      }).join('');
      segs.push(`<section class="divider${ids.length > 8 ? ' dense' : ''}" id="div-${pi}" style="${st}"><span class="mk">@@${dk}@@</span><div class="k">${P.label}</div><div class="t">${P.title}</div><div class="e">${P.sub ?? ''}</div><div class="ovs">${rows}</div></section>`);
    }
    toc.push(`<a class="row part" style="${st}" href="#${P.plain ? ids[0] : `div-${pi}`}"><span class="name">${P.label}　${P.title}</span><span class="dots"></span><span class="pg">${pg(P.plain ? ids[0] : dk)}</span></a>`);
    for (const id of ids) {
      const b = read(`${PARTS}/${id}.body.html`);
      if (!b) { missing.push(id); continue; }
      used.push(id);
      let title = id;
      let bb = lines(b).replace('<section class="unit"', `<section class="unit" style="${st}"`);
      bb = bb.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/, (m, attrs, inner) => {
        const mm = inner.trim().match(/^([A-Za-z]\w{0,3})[\s　]+([\s\S]+)$/);
        const code = mm ? mm[1] : id, ttl = mm ? mm[2] : inner.trim();
        title = ttl.replace(/<[^>]+>/g, ''); TITLES[id] = title;
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
  });
  // 解答篇
  const ans = [];
  for (const P of V.parts) for (const id of P.ids) {
    if (!want(id)) continue;
    const a = read(`${PARTS}/${id}.ans.html`);
    if (!a || !/class="(ans|aset)"/.test(a)) continue;
    ans.push(a.replace('<section class="ans-unit"', `<section class="ans-unit" style="${varsOf(P.color)}"`));
    const mc = [...a.matchAll(/<span class="exid">([^<]+)<\/span>\s*(?:<strong>)?((?:\([A-E]\))+)/g)].map((x) => `<span><i>${x[1].replace(/^[A-Z]\d+-/, '')}</i>${x[2].replace(/[()]/g, '')}</span>`);
    if (mc.length) quick.push(`<div class="qk" style="${varsOf(P.color)}"><b>${id}</b>${mc.join('')}</div>`);
  }
  if (ans.length) {
    segs.push(`<section class="divider" id="ans" style="${varsOf('intro')}"><span class="mk">@@ANS@@</span><div class="k">解答篇</div><div class="t">解答與說明</div><div class="e">依單元與題號排列</div></section>`);
    toc.push(`<a class="row part" style="${varsOf('intro')}" href="#ans"><span class="name">解答篇</span><span class="dots"></span><span class="pg">${pg('ANS')}</span></a>`);
    segs.push(`<div class="answers" style="break-before:page">${lines(ans.join('\n'))}</div>`);
  }
  // 書末附錄
  if (!ONLY) {
    const st = varsOf('intro');
    const row = (code, name, href, k) => `<a class="row" style="${st}" href="#${href}"><span class="code">${code}</span><span class="name">${name}</span><span class="dots"></span><span class="pg">${pg(k)}</span></a>`;
    toc.push(`<a class="row part" style="${st}" href="#apx1"><span class="name">書末附錄</span><span class="dots"></span><span class="pg">${pg('APX1')}</span></a>`);
    toc.push(row('附一', '選擇題答案速查', 'apx1', 'APX1'), row('附二', '細目索引（附頁碼）', 'apx2', 'APX2'), row('附三', '資料來源', 'apx3', 'APX3'));
    const op = (k, code, ttl) => `<h2 class="opener"><span class="mk">@@${k}@@</span><span class="code">${code}</span><span class="ttl">${ttl}</span><span class="chip">書末附錄</span></h2>`;
    segs.push(`<section class="unit apx" id="apx1" style="${st}">${op('APX1', '附一', '選擇題答案速查')}<p>僅列選擇題答案，題號省略單元代號；多選題列出全部正確選項。非選擇題的參考答案見解答篇。</p>${quick.join('')}</section>`);
    segs.push(`<section class="unit apx" id="apx2" style="${st}">${op('APX2', '附二', '細目索引')}<p>各單元各節的頁碼。</p><div class="idx">${idx.join('')}</div></section>`);
    segs.push(`<section class="unit apx" id="apx3" style="${st}">${op('APX3', '附三', '資料來源')}${sourcesHtml(used)}</section>`);
  }
  const tocHtml = ONLY ? '' : `<section class="toc${toc.length > 30 ? ' two' : ''}" id="toc" style="break-before:page"><h2>目錄</h2>${toc.join('\n')}</section>`;
  const front = ONLY ? '' : `<div id="front"><span class="mk">@@FRONT@@</span>${frontHtml(V, vol)}</div>`;
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${CSS}</style></head><body>${front}${tocHtml}${segs.join('\n')}</body></html>`;
}

const footer = (V) => `<div style="width:100%;font-size:8pt;color:#64748b;font-family:'WenQuanYi Zen Hei','PingFang TC','Microsoft JhengHei',sans-serif;padding:0 15mm;display:flex;justify-content:space-between;"><span style="letter-spacing:.15em">${BOOK}　${V.no}　${V.title}</span><span class="pageNumber" style="font-family:'Liberation Serif','Times New Roman',serif;font-size:9.5pt"></span></div>`;
async function render(page, html, file, foot) {
  writeFileSync(file.replace(/\.pdf$/, '.html'), html);
  await page.goto(`file://${file.replace(/\.pdf$/, '.html')}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: !!foot, headerTemplate: '<span></span>', footerTemplate: foot || '<span></span>' });
}
const scan = (f) => {
  const found = {};
  execFileSync('pdftotext', ['-raw', f, '-'], { maxBuffer: 1 << 28 }).toString().split('\f').forEach((t, i) => { for (const m of t.matchAll(/@ ?@ ?([A-Za-z0-9 ]+?) ?@ ?@/g)) { const k = m[1].replace(/ /g, ''); if (!(k in found)) found[k] = i + 1; } });
  return found;
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const vol of VOLARG) {
  const V = VOLS[vol];
  missing = [];
  await render(page, coverHtml(V), `${OUT}/cover${vol}.pdf`, null);
  let found = {}, same = false;
  for (let pass = 0; pass < 4 && !same; pass++) {
    await render(page, build(V, vol, found), `${OUT}/body${vol}.pdf`, footer(V));
    const f2 = scan(`${OUT}/body${vol}.pdf`);
    same = pass > 0 && JSON.stringify(f2) === JSON.stringify(found);
    found = f2;
  }
  const FINAL = ONLY ? `${ROOT}/dist/sample.pdf` : `${ROOT}/dist/${BOOK}_${V.no}_${V.title}.pdf`;
  if (ONLY) copyFileSync(`${OUT}/body${vol}.pdf`, FINAL);
  else execFileSync('python3', [`${ROOT}/join.py`, `${OUT}/cover${vol}.pdf`, `${OUT}/body${vol}.pdf`, FINAL, `${BOOK} ${V.no} ${V.title}`]);
  const n = Number(execFileSync('pdfinfo', [`${OUT}/body${vol}.pdf`]).toString().match(/Pages:\s+(\d+)/)[1]);
  const ids = V.parts.flatMap((p) => p.ids).filter((id) => found[id]);
  const starts = Object.entries(found).filter(([k]) => /^(DIV\d+|ANS|[A-Z]+\d+)$/.test(k) && !/^H\d+$/.test(k) && !/^APX/.test(k)).map(([, v]) => v).sort((a, b) => a - b);
  const len = {}; ids.forEach((id) => { const nx = starts.find((s) => s > found[id]) ?? n + 1; len[id] = nx - found[id]; });
  console.log(`${V.no}：${same ? '頁數一致 ✓' : '頁數不一致，請再執行一次'}`);
  console.log(JSON.stringify({ file: FINAL, pages: ONLY ? n : n + 1, answers: found.ANS && found.APX1 ? found.APX1 - found.ANS : 0, missing: [...new Set(missing)], len }));
}
await browser.close();
