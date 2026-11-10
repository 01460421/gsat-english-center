// 熟字僻義 1000：data/unit-XX.json → PDF（封面＋使用說明＋目錄＋25 單元＋解答＋索引）
import { createRequire } from 'node:module';
const { chromium } = createRequire('/tmp/claude-0/eng/build/')('playwright');
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = '/tmp/claude-0/v1000';
const DATA = process.argv[3] ?? `${ROOT}/data`;
const OUT = process.argv[2] ?? `${ROOT}/out`;
const FS = '/tmp/claude-0/eng/build/node_modules/@fontsource';
mkdirSync(OUT, { recursive: true });

const UNITS = 25, PER = 40, QN = 10;
const units = [];
for (let u = 1; u <= UNITS; u++) {
  const f = `${DATA}/unit-${String(u).padStart(2, '0')}.json`;
  if (!existsSync(f)) continue;
  units.push(JSON.parse(readFileSync(f, 'utf8')));
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad = (n, w) => String(n).padStart(w, '0');
const mark = (s) => esc(s).replace(/\[\[(.+?)\]\]/g, '<b class="hw">$1</b>');

const fontCss = [
  `${FS}/noto-serif-tc/400.css`, `${FS}/noto-serif-tc/600.css`, `${FS}/noto-serif-tc/700.css`,
  `${FS}/noto-sans-tc/400.css`, `${FS}/noto-sans-tc/500.css`, `${FS}/noto-sans-tc/700.css`, `${FS}/noto-sans-tc/900.css`,
  `${FS}/source-serif-4/400.css`, `${FS}/source-serif-4/400-italic.css`, `${FS}/source-serif-4/600.css`, `${FS}/source-serif-4/700.css`,
  `${FS}/inter/500.css`, `${FS}/inter/600.css`, `${FS}/inter/700.css`, `${FS}/inter/800.css`,
].map((f) => `<link rel="stylesheet" href="file://${f}">`).join('\n');

const CSS = `
@page { size:A4; margin:16mm 15mm 18mm 15mm; }
:root { --ink:#1a1f2b; --body:#262c38; --mute:#667085; --faint:#98a2b3; --pri:#173f6b; --pri2:#2b5f94; --pri-soft:#eef3f9; --pri-line:#c9d6e6; --acc:#b9852c; --acc-soft:#fbf5ea; --teal:#25706c; --teal-soft:#ecf5f4; --line:#d5dbe3; }
* { box-sizing:border-box; }
html { font-size:9pt; }
body { margin:0; color:var(--body); font-family:'Source Serif 4','Noto Serif TC',serif; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; font-variant-numeric:lining-nums; }
.sans { font-family:'Inter','Noto Sans TC',sans-serif; }
section { break-before:page; }
/* ── 單元開頭 ── */
.uhead { display:flex; align-items:flex-end; gap:5mm; border-bottom:3px solid var(--pri); padding-bottom:2.5mm; margin-bottom:3mm; }
.uhead .no { font-family:'Inter',sans-serif; font-weight:800; font-size:30pt; line-height:.9; color:var(--acc); letter-spacing:-.02em; }
.uhead .no small { display:block; font-size:8pt; letter-spacing:.32em; color:var(--pri); font-weight:700; margin-bottom:1.5mm; }
.uhead .meta { flex:1; font-family:'Inter','Noto Sans TC',sans-serif; color:var(--pri); padding-bottom:.6mm; }
.uhead .meta .r { font-weight:700; font-size:12.5pt; }
.uhead .meta .s { font-size:8pt; color:var(--mute); margin-top:.6mm; }
.uhead .date { font-family:'Noto Sans TC',sans-serif; font-size:8pt; color:var(--mute); text-align:right; line-height:1.9; }
.uhead .date i { display:inline-block; width:22mm; border-bottom:1px solid var(--faint); }
.check { background:var(--pri-soft); border-radius:2mm; padding:2.2mm 3mm 1.6mm; margin-bottom:3.5mm; }
.check .h { font-family:'Noto Sans TC',sans-serif; font-weight:700; font-size:8pt; color:var(--pri); margin-bottom:1mm; }
.check .g { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:.5mm 2mm; white-space:nowrap; font-family:'Inter',sans-serif; font-size:7.8pt; font-weight:500; color:var(--ink); }
.check .g span::before { content:''; display:inline-block; width:2.3mm; height:2.3mm; border:1px solid var(--pri2); border-radius:.4mm; margin-right:1.2mm; vertical-align:-.25mm; background:#fff; }
/* ── 字卡 ── */
.cards { column-count:2; column-gap:5mm; column-rule:1px solid var(--line); }
.card { break-inside:avoid; padding:0 0 2.2mm; margin:0 0 2.2mm; border-bottom:1px solid var(--line); }
.card .top { display:flex; align-items:baseline; gap:1.6mm; }
.card .n { font-family:'Inter',sans-serif; font-weight:700; font-size:6.8pt; color:#fff; background:var(--pri); border-radius:.8mm; padding:.1mm 1.2mm; transform:translateY(-.4mm); }
.card .w { font-family:'Inter',sans-serif; font-weight:800; font-size:12.5pt; color:var(--ink); letter-spacing:-.01em; }
.card .lv { font-family:'Inter',sans-serif; font-weight:600; font-size:6.8pt; color:var(--mute); border:1px solid var(--line); border-radius:.8mm; padding:0 1mm; }
.card .cv { font-family:'Noto Sans TC',sans-serif; font-weight:700; font-size:6.6pt; color:var(--acc); margin-left:auto; white-space:nowrap; }
.card .fam { font-family:'Noto Sans TC',sans-serif; font-size:7.6pt; color:var(--mute); margin:.2mm 0 .8mm; }
.card .fam b { font-weight:500; color:var(--faint); margin-right:1.2mm; letter-spacing:.08em; }
.sense { margin-top:.9mm; }
.sense .hd { display:flex; align-items:baseline; gap:1.4mm; flex-wrap:wrap; }
.sense .pos { font-family:'Source Serif 4',serif; font-style:italic; font-size:8.2pt; color:var(--teal); }
.sense .zh { font-family:'Noto Sans TC',sans-serif; font-weight:700; font-size:10pt; color:var(--pri); }
.sense .en { font-style:italic; font-size:7.8pt; color:var(--mute); }
.sense .pat { font-family:'Inter',sans-serif; font-size:7.3pt; font-weight:500; color:var(--teal); margin:.3mm 0 .2mm; }
.sense .ex { font-size:8.7pt; color:var(--ink); line-height:1.42; }
.sense .exz { font-family:'Noto Serif TC',serif; font-size:7.8pt; color:#4a5263; line-height:1.45; }
.sense .note { font-family:'Noto Sans TC',sans-serif; font-size:7.3pt; color:#8a5a12; background:var(--acc-soft); border-radius:.8mm; padding:.1mm 1.2mm; display:inline-block; margin-top:.5mm; }
b.hw { font-weight:700; color:var(--pri); }
.gs { margin-top:1.1mm; padding:.8mm 1.6mm; background:#f6f7f9; border-left:2px solid var(--acc); font-size:7.9pt; line-height:1.4; color:#3a4150; }
.gs .tag { font-family:'Noto Sans TC',sans-serif; font-weight:700; font-size:6.6pt; color:var(--acc); margin-right:1.2mm; white-space:nowrap; }
/* ── 仿學測詞彙題 ── */
.quiz .qh { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:3px solid var(--pri); padding-bottom:2.5mm; margin-bottom:3mm; }
.quiz .qh .t { font-family:'Noto Sans TC',sans-serif; font-weight:900; font-size:15pt; color:var(--pri); }
.quiz .qh .t small { font-family:'Inter',sans-serif; font-weight:800; font-size:9pt; color:var(--acc); letter-spacing:.2em; display:block; margin-bottom:1mm; }
.quiz .qh .sc { font-family:'Noto Sans TC',sans-serif; font-size:9pt; color:var(--mute); }
.quiz .qh .sc i { display:inline-block; width:14mm; border-bottom:1px solid var(--faint); }
.quiz .ins { font-family:'Noto Serif TC',serif; font-size:9pt; color:#3a4150; background:var(--pri-soft); border-radius:1.5mm; padding:2mm 3mm; margin-bottom:4mm; }
.q { break-inside:avoid; margin-bottom:4.6mm; font-size:10.6pt; line-height:1.55; color:var(--ink); }
.q .st { display:flex; gap:2mm; }
.q .st .k { font-family:'Inter',sans-serif; font-weight:700; color:var(--pri); min-width:6mm; }
.q .op { display:grid; grid-template-columns:repeat(4,1fr); margin:1mm 0 0 8mm; font-size:10.4pt; }
.q .op span b { font-weight:400; color:var(--mute); margin-right:1mm; }
.blank { display:inline-block; width:15mm; border-bottom:1px solid var(--ink); transform:translateY(-.3mm); }
/* ── 解答 ── */
.h1 { font-family:'Noto Sans TC',sans-serif; font-weight:900; font-size:19pt; color:var(--pri); border-bottom:3px solid var(--pri-line); padding-bottom:2.5mm; margin:0 0 4mm; }
.h1 small { font-family:'Inter',sans-serif; font-weight:700; font-size:8.5pt; letter-spacing:.25em; color:var(--acc); display:block; margin-bottom:1mm; }
.akey { column-count:2; column-gap:6mm; column-rule:1px solid var(--line); }
.au { break-inside:avoid; margin-bottom:4mm; }
.au .t { font-family:'Inter','Noto Sans TC',sans-serif; font-weight:800; font-size:9.5pt; color:var(--pri); }
.au .row { font-family:'Inter',sans-serif; font-weight:700; font-size:9pt; letter-spacing:.06em; color:var(--ink); background:var(--pri-soft); border-radius:1mm; padding:.6mm 2mm; margin:.8mm 0 1.2mm; }
.au .row i { font-style:normal; font-weight:500; color:var(--mute); font-size:7.4pt; margin-right:.5mm; }
.au ol { margin:0; padding-left:5mm; font-family:'Noto Serif TC','Source Serif 4',serif; font-size:8pt; line-height:1.5; color:#3a4150; }
.au ol li::marker { font-family:'Inter',sans-serif; font-weight:700; color:var(--pri); }
.au ol b { font-family:'Inter',sans-serif; font-weight:700; color:var(--ink); }
/* ── 索引 ── */
.idx { column-count:5; column-gap:4mm; font-family:'Inter',sans-serif; font-size:7.8pt; line-height:1.55; }
.idx .L { font-weight:800; font-size:11pt; color:var(--acc); margin:1.5mm 0 .3mm; break-after:avoid; }
.idx div.i { display:flex; justify-content:space-between; border-bottom:1px dotted var(--line); }
.idx div.i span:last-child { color:var(--mute); font-weight:500; font-size:7pt; }
/* ── 使用說明、目錄 ── */
.guide { font-family:'Noto Serif TC','Source Serif 4',serif; font-size:10.2pt; line-height:1.85; }
.guide h3 { font-family:'Noto Sans TC',sans-serif; font-weight:700; font-size:12pt; color:var(--pri); border-left:4px solid var(--acc); padding-left:2.5mm; margin:6mm 0 2mm; }
.guide ul,.guide ol { margin:1mm 0; padding-left:6mm; }
.guide li { margin:.6mm 0; }
.guide .demo { border:1px solid var(--pri-line); border-radius:2mm; padding:3mm 4mm; width:92mm; margin:2mm 0; font-size:9pt; line-height:1.5; }
.guide .two { display:flex; gap:7mm; align-items:flex-start; }
.guide .legend { font-size:9.2pt; line-height:1.75; }
.guide .legend b { font-family:'Noto Sans TC',sans-serif; color:var(--pri); }
.guide .cred { margin-top:8mm; font-size:8.2pt; color:var(--mute); line-height:1.7; border-top:1px solid var(--line); padding-top:2mm; }
.toc .row { display:flex; align-items:baseline; font-family:'Inter','Noto Sans TC',sans-serif; font-size:10pt; padding:1.25mm 0; border-bottom:1px solid #eef0f3; }
.toc .row .c { width:20mm; font-weight:800; color:var(--pri); }
.toc .row .nm { flex:0 1 auto; color:var(--ink); font-weight:500; }
.toc .row .nm small { color:var(--mute); font-weight:400; margin-left:2mm; }
.toc .row .d { flex:1; border-bottom:1.2px dotted var(--faint); margin:0 2mm; transform:translateY(-1mm); }
.toc .row .p { width:9mm; text-align:right; font-weight:600; color:var(--pri); }
.toc .row.part { margin-top:2mm; }
.toc .row.part .nm { font-weight:900; color:var(--acc); font-family:'Noto Sans TC',sans-serif; }
`;

function ringSvg(size, seed = 1) {
  const c = size / 2, out = [];
  const cols = ['#173f6b', '#b9852c', '#2b5f94', '#25706c', '#c9d6e6'];
  for (let i = 0; i < 11; i++) {
    const r = size * (0.08 + i * 0.04);
    const circ = 2 * Math.PI * r;
    const a = ((i * 37 + seed * 53) % 60) / 100 + 0.25;
    out.push(`<circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="none" stroke="${cols[(i + seed) % cols.length]}" stroke-width="${i % 2 ? 1.2 : 2.6}" stroke-dasharray="${(circ * a).toFixed(1)} ${(circ * (1 - a)).toFixed(1)}" transform="rotate(${i * 23 + seed * 11} ${c} ${c})" opacity="${0.55 + (i % 3) * 0.15}"/>`);
  }
  out.push(`<circle cx="${c}" cy="${c}" r="${size * 0.035}" fill="#b9852c"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${out.join('')}</svg>`;
}

function coverHtml() {
  const demo = [['address', '地址', '處理（問題）'], ['grave', '墳墓', '嚴重的'], ['weather', '天氣', '平安度過'], ['novel', '小說', '新穎的'], ['plant', '植物', '工廠']];
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>
@page { size:A4; margin:0; } body{margin:0;font-family:'Noto Sans TC',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.c{width:210mm;height:297mm;position:relative;overflow:hidden;background:#fbfaf6;}
.art{position:absolute;right:-62mm;top:-46mm;} .art2{position:absolute;left:-55mm;bottom:-72mm;opacity:.5;}
.num{position:absolute;left:20mm;top:74mm;font-family:'Inter',sans-serif;font-weight:800;font-size:92pt;line-height:1;color:#173f6b;letter-spacing:-.04em;}
.band{position:absolute;left:0;top:120mm;width:210mm;height:2.2mm;background:#b9852c;}
.tx{position:absolute;left:20mm;top:130mm;right:20mm;color:#1d2433;}
.k{font-size:14pt;letter-spacing:.35em;color:#b9852c;font-weight:700;}
.t{font-size:44pt;font-weight:900;color:#173f6b;line-height:1.2;margin:3mm 0 2mm;letter-spacing:.04em;}
.s{font-size:15pt;color:#5b6577;font-weight:500;letter-spacing:.08em;}
.tb{position:absolute;left:20mm;top:192mm;width:112mm;border-collapse:collapse;font-size:11pt;}
.tb th{font-size:8.5pt;letter-spacing:.2em;color:#98a2b3;font-weight:700;text-align:left;padding:1mm 0;border-bottom:1.5px solid #173f6b;}
.tb td{padding:1.5mm 0;border-bottom:1px solid #d5dbe3;color:#667085;}
.tb td:first-child{font-family:'Inter',sans-serif;font-weight:700;color:#1a1f2b;} .tb td:last-child{color:#173f6b;font-weight:700;}
.f{position:absolute;left:20mm;bottom:18mm;font-size:12pt;color:#173f6b;font-weight:700;letter-spacing:.15em;}
.f span{color:#5b6577;font-weight:500;letter-spacing:0;margin-left:4mm;}
</style></head><body><div class="c">
<div class="art">${ringSvg(620, 1)}</div><div class="art2">${ringSvg(380, 3)}</div>
<div class="num">1000</div><div class="band"></div>
<div class="tx"><div class="k">學測英文　字彙</div><div class="t">熟字僻義 1000</div><div class="s">認得的字，沒見過的意思</div></div>
<table class="tb"><tr><th>單字</th><th>你知道的意思</th><th>僻義</th></tr>${demo.map((d) => `<tr><td>${d[0]}</td><td>${d[1]}</td><td>${d[2]}</td></tr>`).join('')}</table>
<div class="f">學測英文中心<span>25 單元・每單元 40 字・附仿學測詞彙題</span></div>
</div></body></html>`;
}

function card(e, n) {
  const senses = e.senses.map((s) => `<div class="sense"><div class="hd"><span class="pos">${esc(s.pos)}</span><span class="zh">${esc(s.zh)}</span><span class="en">${esc(s.en)}</span></div>
${s.pattern ? `<div class="pat">${esc(s.pattern)}</div>` : ''}<div class="ex">${mark(s.example)}</div><div class="exz">${esc(s.example_zh)}</div>${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</div>`).join('');
  const gs = (e.gsat ?? []).map((g) => `<div class="gs"><span class="tag">學測 ${esc(g.exam)}・${esc(g.sec)}</span>${mark(g.sentence)}</div>`).join('');
  return `<div class="card"><div class="top"><span class="n">${pad(n, 4)}</span><span class="w">${esc(e.word)}</span><span class="lv">L${e.level}</span>${e.conversion ? '<span class="cv">★ 詞性轉換</span>' : ''}</div>
<div class="fam"><b>熟義</b>${esc(e.common_zh)}</div>${senses}${gs}</div>`;
}

function unitHtml(U) {
  const u = U.unit, base = (u - 1) * PER;
  const first = U.entries[0].word, last = U.entries[U.entries.length - 1].word;
  const qs = (U.quiz ?? []).map((q, i) => `<div class="q"><div class="st"><span class="k">${i + 1}.</span><span>${esc(q.stem).replace(/_{3,}/g, '<span class="blank"></span>')}</span></div>
<div class="op">${['A', 'B', 'C', 'D'].map((k) => `<span><b>(${k})</b>${esc(q.options[k])}</span>`).join('')}</div></div>`).join('');
  return `<section class="unit"><div class="uhead"><div class="no"><small>UNIT</small>${pad(u, 2)}</div>
<div class="meta"><div class="r">${esc(first)} → ${esc(last)}</div><div class="s">${pad(base + 1, 4)}–${pad(base + U.entries.length, 4)}・${U.entries.length} 字・依字母排序</div></div>
<div class="date">日期 <i></i><br>複習 <i></i></div></div>
<div class="check"><div class="h">先勾出「僻義」說不出來的字，讀完字卡後再回來檢查一次</div><div class="g">${U.entries.map((e) => `<span>${esc(e.word)}</span>`).join('')}</div></div>
<div class="cards">${U.entries.map((e, i) => card(e, base + i + 1)).join('\n')}</div></section>
<section class="quiz"><div class="qh"><div class="t"><small>UNIT ${pad(u, 2)}　QUIZ</small>仿學測詞彙題</div><div class="sc">得分 <i></i> / ${QN}　　用時 <i></i> 分</div></div>
<div class="ins">說明：第 1 題至第 ${QN} 題，每題有四個選項，請選出一個最適當的答案。每題 1 分，建議作答時間 5 分鐘。答案都是本單元的字，而且考的是「僻義」。</div>${qs}</section>`;
}

function guideHtml(stats) {
  const demo = { word: 'weather', level: 1, conversion: true, common_zh: '天氣（n.）', senses: [{ pos: 'vt.', zh: '平安度過（難關）', en: 'to come safely through a difficult time', pattern: 'weather a crisis / weather the storm', example: 'The small bookstore [[weathered]] the pandemic by selling books online.', example_zh: '這家小書店靠網路賣書撐過了疫情。', note: '' }], gsat: [] };
  return `<section class="guide" style="break-before:auto"><div class="h1"><small>HOW TO USE</small>使用說明</div>
<p>「熟字僻義」是你早就認得的字，在文章裡卻用了另一個意思。讀到 <i>The company weathered the crisis</i>，只知道 weather 是「天氣」就會卡住。學測的詞彙題、綜合測驗和閱讀測驗，都常出現這種用法。</p>
<p>這本講義收 ${stats.n.toLocaleString('en-US')} 個字、${stats.s.toLocaleString('en-US')} 個僻義，全部取自高中英文參考詞彙表（L1–L6），涵蓋動詞、名詞、形容詞、副詞、介系詞與連接詞。其中 ${stats.g} 個字附有歷屆學測題本裡的原句，共 ${stats.gs} 句。</p>
<h3>一、怎麼編排</h3>
<ul><li>全書分 ${UNITS} 個單元，每單元 ${PER} 個字。</li><li>每個單元裡的字都從 A 排到 Z，所以每天讀到的字首都不一樣，不會整週都在背 A 開頭的字。</li><li>每個單元最後有一頁「仿學測詞彙題」${QN} 題，題型和學測第一大題相同，答案都是該單元的字。</li><li>解答與解析在書末；最後有全書 A–Z 索引，可以查某個字在第幾單元。</li></ul>
<h3>二、怎麼讀一張字卡</h3>
<div class="two"><div class="demo">${card(demo, 1)}</div><div class="legend">
<b>0001</b>　全書編號。<br><b>L1</b>　這個字在參考詞彙表的級別。<br><b>★ 詞性轉換</b>　熟義和僻義的詞性不同，例如名詞當動詞用。<br><b>熟義</b>　你原本知道的意思。<br><b>藍色粗體中文</b>　要學的僻義，前面是詞性。<br><b>綠色小字</b>　常見搭配，連同搭配一起記。<br><b>例句</b>　本站自編，粗體是這個字。<br><b>學測原句</b>　歷屆學測題本裡用到這個意思的句子，標有學年度與大題。</div></div>
<h3>三、建議的讀法</h3>
<ol><li><b>先勾。</b>看單元開頭的 ${PER} 個字，勾出僻義說不出來的字。</li><li><b>再讀。</b>讀字卡時遮住中文，先看例句猜意思，再對答案。搭配要唸出聲。</li><li><b>後測。</b>限時 5 分鐘寫完 ${QN} 題詞彙題，對答案，錯的題目把那張字卡再讀一次。</li><li><b>複習。</b>隔天、隔週各回到單元開頭的勾選表，只看還說不出來的字。</li></ol>
<p>一天一個單元，25 天讀完一輪；第二輪只看勾過的字，大約一週。</p>
<div class="cred">詞彙與級別取自大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》。<br>學測原句取自歷屆學科能力測驗英文考科試題；其餘例句與仿學測詞彙題皆為本站自編。</div></section>`;
}

function bodyHtml() {
  const segs = units.map(unitHtml);
  // 解答
  const ak = units.map((U) => `<div class="au"><div class="t">UNIT ${pad(U.unit, 2)}</div><div class="row">${(U.quiz ?? []).map((q, i) => `<i>${i + 1}</i>${esc(q.answer)}`).join('　')}</div>
<ol>${(U.quiz ?? []).map((q) => `<li><b>(${esc(q.answer)}) ${esc(q.options[q.answer])}</b>　${esc(q.explain_zh)}</li>`).join('')}</ol></div>`).join('\n');
  segs.push(`<section><div class="h1"><small>ANSWER KEY</small>仿學測詞彙題　解答與解析</div><div class="akey">${ak}</div></section>`);
  // 索引
  const all = [];
  units.forEach((U) => U.entries.forEach((e, i) => all.push({ w: e.word, u: U.unit, n: (U.unit - 1) * PER + i + 1 })));
  all.sort((a, b) => a.w.localeCompare(b.w));
  let cur = '', ix = '';
  for (const a of all) {
    const L = a.w[0].toUpperCase();
    if (L !== cur) { cur = L; ix += `<div class="L">${L}</div>`; }
    ix += `<div class="i"><span>${esc(a.w)}</span><span>U${pad(a.u, 2)}・${pad(a.n, 4)}</span></div>`;
  }
  segs.push(`<section><div class="h1"><small>INDEX</small>索引（A–Z）</div><div class="idx">${ix}</div></section>`);
  const head = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${CSS}</style></head><body>`;
  return `${head}${segs.join('\n').replace('<section class="unit">', '<section class="unit" style="break-before:auto">')}</body></html>`;
}

function frontHtml(pages, stats) {
  const rows = units.map((U) => `<div class="row"><span class="c">UNIT ${pad(U.unit, 2)}</span><span class="nm">${esc(U.entries[0].word)} → ${esc(U.entries[U.entries.length - 1].word)}<small>${pad((U.unit - 1) * PER + 1, 4)}–${pad((U.unit - 1) * PER + U.entries.length, 4)}</small></span><span class="d"></span><span class="p">${pages[`u${U.unit}`] ?? ''}</span></div>`).join('\n');
  const head = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${CSS} @page{margin:18mm 20mm 18mm 20mm;}</style></head><body>`;
  return `${head}${guideHtml(stats)}<section class="toc"><div class="h1"><small>CONTENTS</small>目錄</div>${rows}
<div class="row part"><span class="c"></span><span class="nm">仿學測詞彙題　解答與解析</span><span class="d"></span><span class="p">${pages.ans ?? ''}</span></div>
<div class="row part"><span class="c"></span><span class="nm">索引（A–Z）</span><span class="d"></span><span class="p">${pages.idx ?? ''}</span></div></section></body></html>`;
}

const footer = `<div style="width:100%;font-size:7.5pt;color:#5b6577;font-family:'WenQuanYi Zen Hei',sans-serif;padding:0 15mm;display:flex;justify-content:space-between;"><span>學測英文中心・熟字僻義 1000</span><span class="pageNumber" style="font-family:'Liberation Serif',serif;font-size:9pt"></span></div>`;
async function render(page, html, file, withFooter) {
  const h = file.replace(/\.pdf$/, '.html');
  writeFileSync(h, html);
  await page.goto(`file://${h}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: withFooter, headerTemplate: '<span></span>', footerTemplate: withFooter ? footer : '<span></span>' });
}
const nPages = (pdf) => Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)[1]);

const stats = { n: units.reduce((a, U) => a + U.entries.length, 0), g: 0, gs: 0, s: 0 };
units.forEach((U) => U.entries.forEach((e) => { stats.s += e.senses.length; }));
units.forEach((U) => U.entries.forEach((e) => { if (e.gsat?.length) { stats.g++; stats.gs += e.gsat.length; } }));

const browser = await chromium.launch();
const page = await browser.newPage();
await render(page, coverHtml(), `${OUT}/cover.pdf`, false);
await render(page, bodyHtml(), `${OUT}/body.pdf`, true);
// 頁碼
const n = nPages(`${OUT}/body.pdf`);
const pages = {}; const perUnit = {};
let from = 1;
const texts = [];
for (let i = 1; i <= n; i++) texts[i] = execFileSync('pdftotext', ['-f', String(i), '-l', String(i), `${OUT}/body.pdf`, '-']).toString().replace(/\s+/g, '');
for (const U of units) {
  const base = (U.unit - 1) * PER;
  const needle = `${pad(base + 1, 4)}–${pad(base + U.entries.length, 4)}`;
  for (let i = from; i <= n; i++) if (texts[i].includes(needle)) { pages[`u${U.unit}`] = i; from = i + 1; break; }
}
for (let i = from; i <= n; i++) if (texts[i].includes('ANSWERKEY')) { pages.ans = i; from = i + 1; break; }
for (let i = from; i <= n; i++) if (texts[i].includes('INDEX索引')) { pages.idx = i; break; }
await render(page, frontHtml(pages, stats), `${OUT}/front.pdf`, false);
await browser.close();
execFileSync('pdfunite', [`${OUT}/cover.pdf`, `${OUT}/front.pdf`, `${OUT}/body.pdf`, `${OUT}/熟字僻義1000.pdf`]);
console.log(JSON.stringify({ pages: nPages(`${OUT}/熟字僻義1000.pdf`), body: n, stats, toc: pages }));
