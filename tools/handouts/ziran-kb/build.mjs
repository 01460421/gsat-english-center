// 學測自然知識庫：HTML 片段 → PDF（五冊）
// 用法：node build.mjs            → 五冊都排
//       node build.mjs 2          → 只排第二冊
//       node build.mjs 1 Z1,F1    → 只排指定單元的樣張 dist/sample.pdf
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const katex = require('katex');
require('katex/contrib/mhchem');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PARTS = process.env.PARTS || `${ROOT}/content`;
const SRC = `${ROOT}/sources`;
const ONLYARG = process.argv[3] ? process.argv[3].replace(/[^A-Za-z0-9,]/g, '').replace(/,/g, '_') : '';
const OUT = ONLYARG ? `${ROOT}/dist/tmp/s_${ONLYARG}` : `${ROOT}/dist/tmp`;
const FS = `${ROOT}/node_modules/@fontsource`;
mkdirSync(OUT, { recursive: true });

const BOOK = '學測自然知識庫';
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
const R = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${p}${a + i}`);
const KVOLS = existsSync(`${ROOT}/kvols.json`) ? JSON.parse(readFileSync(`${ROOT}/kvols.json`, 'utf8')) : {};
const VOLS = {
  1: {
    no: '第一冊', title: '物理', lines: ['物理'], tag: '物理',
    blurb: '科學方法與單位、運動與力、萬有引力、電與磁、<br>波動・光與聲音、能量與熱、核能、量子現象',
    parts: [
      { color: 'blue', label: '第一部', title: '物質與運動', sub: '科學方法・單位・運動・牛頓定律・萬有引力', ids: ['P1', 'P2', 'P3', 'P4'] },
      { color: 'orange', label: '第二部', title: '交互作用與電磁', sub: '基本交互作用・電場・電磁感應・電磁波', ids: ['P5', 'P6'] },
      { color: 'teal', label: '第三部', title: '波動、光與聲音', sub: '波的性質・都卜勒效應・光的本質', ids: ['P7', 'P8'] },
      { color: 'purple', label: '第四部', title: '能量與近代物理', sub: '能量與熱・核能・量子現象', ids: ['P9', 'P10', 'P11'] },
    ],
  },
  2: {
    no: '第二冊', title: '化學', lines: ['化學'], tag: '化學',
    blurb: '原子與週期表、物質分類與分離、化學鍵、氣體、<br>化學計量、溶液、反應能量與速率、酸鹼、氧化還原、生活與環境化學',
    parts: [
      { color: 'green', label: '第一部', title: '物質的組成與結構', sub: '原子・週期表・物質分類・化學鍵・氣體', ids: ['C1', 'C2', 'C3', 'C4'] },
      { color: 'blue', label: '第二部', title: '化學反應', sub: '計量・溶液・能量與速率・酸鹼・氧化還原', ids: ['C5', 'C6', 'C7', 'C8', 'C9'] },
      { color: 'rose', label: '第三部', title: '化學與生活', sub: '有機化合物・界面活性劑・環境與能源', ids: ['C10', 'C11'] },
    ],
  },
  3: {
    no: '第三冊', title: '生物', lines: ['生物'], tag: '生物',
    blurb: '細胞的構造與功能、細胞能量、細胞分裂、<br>孟德爾遺傳、性聯遺傳、分子遺傳、演化與生物多樣性',
    parts: [
      { color: 'green', label: '第一部', title: '細胞', sub: '構造與功能・能量・細胞週期與分裂', ids: ['B1', 'B2', 'B3'] },
      { color: 'orange', label: '第二部', title: '遺傳', sub: '孟德爾遺傳・染色體與性聯遺傳・分子遺傳', ids: ['B4', 'B5', 'B6'] },
      { color: 'purple', label: '第三部', title: '演化與多樣性', sub: '演化理論・分類與生物多樣性', ids: ['B7', 'B8'] },
    ],
  },
  4: {
    no: '第四冊', title: '地球科學', lines: ['地球', '科學'], tag: '地科',
    blurb: '宇宙與天體、天球與視運動、太陽系與地球演化、<br>固體地球與板塊、地質年代、大氣、天氣、海洋、災害與氣候變遷',
    parts: [
      { color: 'purple', label: '第一部', title: '天文', sub: '宇宙與天體・天球與視運動・太陽系起源', ids: ['E1', 'E2', 'E3'] },
      { color: 'orange', label: '第二部', title: '固體地球', sub: '地球分層・板塊構造・地層與化石', ids: ['E4', 'E5', 'E6'] },
      { color: 'blue', label: '第三部', title: '大氣與海洋', sub: '大氣與水氣・天氣與颱風・海洋', ids: ['E7', 'E8', 'E9'] },
      { color: 'green', label: '第四部', title: '災害與永續', sub: '地震災害・氣候變遷・永續發展', ids: ['E10'] },
    ],
  },
  5: {
    no: '第五冊', title: '探究實作與跨科素養', lines: ['探究實作', '跨科素養'], tag: '探究',
    blurb: '科學探究歷程、實驗設計、數據處理與圖表、<br>論證與建模、跨科主題題組、題型與作答策略、模擬試題',
    parts: [
      { color: 'teal', label: '第一部', title: '探究與實作', sub: '探究歷程・數據與圖表・論證與建模', ids: ['X1', 'X2', 'X3'] },
      { color: 'rose', label: '第二部', title: '跨科素養', sub: '跨科主題・題型與作答策略・公式速查', ids: ['X4', 'X5'] },
      { color: 'blue', label: '第三部', title: '模擬試題', sub: '全真模擬兩回・詳解', ids: ['X6', 'X7'] },
    ],
  },
};
Object.assign(VOLS, KVOLS);
const DESC = JSON.parse(readFileSync(`${ROOT}/desc.json`, 'utf8'));

const VOLARG = process.argv[2] && /^[1-8]$/.test(process.argv[2]) ? [Number(process.argv[2])] : [1, 2, 3, 4, 5, 6, 7, 8];
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
const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const mathErr = [];
function tex(src, display) {
  try { return katex.renderToString(ent(src), { displayMode: display, throwOnError: true, strict: 'ignore', output: 'html' }); }
  catch (e) { mathErr.push(`${src.slice(0, 60)}：${e.message.slice(0, 80)}`); return `<span class="texerr">${src}</span>`; }
}
function math(html) {
  html = html.replace(/<div class="mb">([\s\S]*?)<\/div>/g, (_, s) => `<div class="mb">${tex(s, true)}</div>`);
  return html.replace(/<span class="m">([\s\S]*?)<\/span>/g, (_, s) => tex(s, false));
}
function lines(html) {
  html = html.replace(/<div class="example">(\s*)<p><strong>(例題\s*[0-9０-９]+)[：:　\s]*([^<]*)<\/strong>[：:　\s]*/g, (m, sp, n, ttl) => `<div class="example">${sp}<p class="exh"><span class="exn">${n}</span>${ttl ? `<strong>${ttl}</strong>　` : ''}`);
  html = math(optCols(html)).replace(/<img class="scan" src="img\/([A-Za-z0-9_\/.-]+)"/g, (m, p) => `<img class="scan" src="file://${ROOT}/img/${p}"`);
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
  `${FS}/noto-serif-tc/400.css`, `${FS}/source-serif-4/400.css`, `${FS}/inter/500.css`, `${ROOT}/node_modules/katex/dist/katex.min.css`,
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
<div class="stick">範圍依<b>108 課綱</b>部定必修；<br>數據與史實逐條<b>查證</b>。<br>各單元附分級測驗與詳解。</div>
<div class="ft">學測英文中心　編</div>
</div></body></html>`;
}

function frontHtml(V, vol) {
  const chips = V.parts.map((p) => `<span style="background:${COL[p.color].c}">${p.label}　${p.title}</span>`).join('');
  const volRows = Object.entries(VOLS).map(([k, v]) => `<tr><td>${v.no}　${v.title}</td><td>${v.parts.map((p) => p.title).join('、')}</td></tr>`).join('');
  return `<section class="front" style="${varsOf('intro')}">
<h2 class="fh">編輯說明</h2>
<p>《${BOOK}》供準備學測自然考科的高中生查閱與自修，程度定位為頂標與滿級分。全套八冊：</p>
<table class="t"><thead><tr><th style="width:38%">冊別</th><th>內容</th></tr></thead><tbody>${volRows}</tbody></table>
<h3>範圍</h3>
<ul>
<li>以十二年國教課綱「普通型高級中等學校自然科學領域」<strong>部定必修</strong>學習內容為範圍，含物理、化學、生物、地球科學與自然科學探究與實作。</li>
<li>為理解必修內容所需的延伸觀念，以及加深加廣選修中與必修銜接的內容，標「（進階）」或置於「深究」，供深入理解，非學測必考。</li>
</ul>
<h3>資料來源與查證</h3>
<ul>
<li><strong>物理常數與數據</strong>：依國際單位制（SI）與國際科學數據委員會（CODATA）公布值；書中計算多取有效數字三位。</li>
<li><strong>名詞</strong>：依國家教育研究院「樂詞網」學術名詞與臺灣高中教科書通行譯名；元素名稱依該院公布之中文名稱。</li>
<li><strong>科學史與統計資料</strong>：年代、人物、事件、臺灣在地資料（地震、颱風、能源）逐條查核；各說不一者採高中課本通行之說，必要時註「一說」。</li>
<li><strong>科學班入學考試題</strong>：第六至八冊與各單元「科學班入學考題精選」收錄各校公告之科學班甄選入學科學能力檢定試題，逐題註明學校、學年度與科目；答案依學校公告，未公告者為本書解。詳解、試卷分析與單元對照為本書撰寫。依著作權法第九條，依法令舉行之各類考試試題不得為著作權之標的。</li>
<li>各單元查證所用的主要網站列於書末〈資料來源〉。</li>
</ul>
<h3>未收錄的內容</h3>
<ul>
<li>學測歷屆試題原題。各單元分級測驗與第五冊模擬試題均為自編。</li>
<li>補習班、出版社自編的模擬題與其詳解。</li>
<li>出版社教科書與參考書的圖表與題目。書中圖片均為重新繪製的示意圖，未依比例者另註明。</li>
</ul>
<h3>體例</h3>
<ul>
<li>物理量符號用斜體，單位用正體；數值與單位之間空一格（如 <span class="m">9.8\\ \\mathrm{m/s^2}</span>）。</li>
<li>化學式、反應式依 IUPAC 慣例；反應式標明狀態（s、l、g、aq）。</li>
<li>測驗題編號為單元代號加流水號（如 P3-07），書末解答依同一編號排列。</li>
</ul>
</section>
<section class="front legend" style="${varsOf('blue')};break-before:page">
<h2 class="fh">使用說明</h2>
<h3>記號圖例</h3>
<table class="t"><thead><tr><th style="width:34%">記號</th><th>意義</th></tr></thead><tbody>
<tr><td><strong>黃色螢光筆</strong></td><td>該段的關鍵詞與結論。</td></tr>
<tr><td><em>紅色波浪線</em></td><td>易忽略或易誤之處。</td></tr>
<tr><td>（進階）</td><td>超出必修的延伸內容。</td></tr>
<tr><td><span class="mark lg-bad">誤</span>　<span class="mark lg-good">正</span></td><td>迷思概念與正確觀念對照。</td></tr>
<tr><td><span class="exid">P3-07</span></td><td>測驗題編號。</td></tr>
<tr><td>☐ 自我檢核</td><td>各單元末的檢核項目。</td></tr>
</tbody></table>
<div class="key"><p>重點整理：定義、定律、公式、步驟。</p></div>
<div class="tip"><p>延伸補充與深究：原理推導、科學史、跨科連結。</p></div>
<div class="warn"><p>易錯提醒：常見迷思、單位與正負號陷阱。</p></div>
<h3>各單元結構</h3>
<table class="t"><thead><tr><th style="width:34%">項目</th><th>內容</th></tr></thead><tbody>
<tr><td>課綱對照</td><td>本單元對應的課綱學習內容與學測考點。</td></tr>
<tr><td>觀念與整理</td><td>基礎、進階、深究三層。</td></tr>
<tr><td>例題精解</td><td>典型題型與解題步驟。</td></tr>
<tr><td>分級測驗</td><td>基礎、進階、挑戰三級，含圖表判讀與題組。</td></tr>
</tbody></table>
<h3>本冊各部代表色</h3>
<div class="chips">${chips}</div>
<h3>查閱方式</h3>
<table class="t"><thead><tr><th style="width:34%">需求</th><th>查閱位置</th></tr></thead><tbody>
<tr><td>依主題查頁碼</td><td>書末附二〈細目索引〉</td></tr>
<tr><td>核對選擇題答案</td><td>書末附一〈選擇題答案速查〉</td></tr>
<tr><td>查看詳解</td><td>解答篇，依單元與題號排列</td></tr>
<tr><td>記錄複習進度與測驗成績</td><td>書末附四〈進度檢核表〉</td></tr>
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
    const skip = /(^|\.)(ptt\.cc|dcard\.tw|facebook\.com|pixnet\.net|blogspot\.com|medium\.com|zhihu\.com|kknews\.cc|sohu\.com|163\.com|fx361\.com|epochtimes\.com|douban\.com|wikipedia\.com)$/;
    for (const x of src) { let d = ''; try { d = new URL(x.url).hostname.replace(/^www\./, ''); } catch { /* 非網址 */ } if (d && !skip.test(d)) c.set(d, (c.get(d) ?? 0) + 1); }
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
    toc.push(row('附一', '選擇題答案速查', 'apx1', 'APX1'), row('附二', '細目索引（附頁碼）', 'apx2', 'APX2'), row('附三', '資料來源', 'apx3', 'APX3'), row('附四', '進度檢核表', 'apx4', 'APX4'));
    const op = (k, code, ttl) => `<h2 class="opener"><span class="mk">@@${k}@@</span><span class="code">${code}</span><span class="ttl">${ttl}</span><span class="chip">書末附錄</span></h2>`;
    segs.push(`<section class="unit apx" id="apx1" style="${st}">${op('APX1', '附一', '選擇題答案速查')}<p>僅列選擇題答案，題號省略單元代號；多選題列出全部正確選項。非選擇題的參考答案見解答篇。</p>${quick.join('')}</section>`);
    segs.push(`<section class="unit apx" id="apx2" style="${st}">${op('APX2', '附二', '細目索引')}<p>各單元各節的頁碼。</p><div class="idx">${idx.join('')}</div></section>`);
    segs.push(`<section class="unit apx" id="apx3" style="${st}">${op('APX3', '附三', '資料來源')}${sourcesHtml(used)}</section>`);
    const prow = used.map((id) => `<tr><td>${id}</td><td>${TITLES[id] ?? ''}</td><td>☐</td><td>☐</td><td>☐</td><td></td></tr>`).join('');
    segs.push(`<section class="unit apx" id="apx4" style="${st}">${op('APX4', '附四', '進度檢核表')}<p>每完成一輪閱讀與測驗，勾選對應欄位，並記錄該單元測驗的答對題數。</p><table class="t prog"><thead><tr><th>單元</th><th>主題</th><th>第一輪</th><th>第二輪</th><th>第三輪</th><th>測驗答對／題數</th></tr></thead><tbody>${prow}</tbody></table></section>`);
  }
  const tocHtml = ONLY ? '' : `<section class="toc${toc.length > 30 ? ' two' : ''}" id="toc" style="break-before:page"><h2>目錄</h2>${toc.join('\n')}</section>`;
  const front = ONLY ? '' : `<div id="front"><span class="mk">@@FRONT@@</span>${math(frontHtml(V, vol))}</div>`;
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
  const FINAL = ONLY ? `${ROOT}/dist/sample_${ONLYARG}.pdf` : `${ROOT}/dist/${BOOK}_${V.no}_${V.title}.pdf`;
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
if (mathErr.length) { console.log(`公式錯誤 ${mathErr.length} 處：`); for (const e of [...new Set(mathErr)].slice(0, 30)) console.log('  ' + e); }
