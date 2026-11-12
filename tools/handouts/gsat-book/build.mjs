// 學測英文 翻譯與作文 高分練習講義：HTML 片段 → PDF（封面＋目錄＋本文＋解答篇）
import { createRequire } from 'node:module';
const { chromium } = createRequire('/tmp/claude-0/eng/build/')('playwright');
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = '/tmp/claude-0/book';
const PARTS = `${ROOT}/parts`;
const OUT = process.argv[2] ?? `${ROOT}/out`;
const FS = '/tmp/claude-0/eng/build/node_modules/@fontsource';
execFileSync('mkdir', ['-p', OUT]);

const V = { tag: null, sub: '', foot: '' };
const D = (divider, title, en) => ({ divider, title, en });
const U = (...ids) => ids.map((id) => ({ id }));
const ORDER = [
  ...U('S0'),
  D('第一部', '字彙', 'Vocabulary'), ...U('V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7a', 'V7b', 'VP'),
  D('第二部', '文法與綜合測驗', 'Grammar & Cloze'), ...U('G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'GP'),
  D('第三部', '文意選填與篇章結構', 'Word Bank & Discourse'), ...U('C1', 'C2', 'CP'),
  D('第四部', '閱讀測驗', 'Reading'), ...U('R1', 'R2', 'RP'),
  D('第五部', '混合題', 'Mixed Questions'), ...U('M1', 'MP'),
  D('第六部', '中譯英', 'Translation'), ...U('T2a', 'T2b', 'T2c', 'T3', 'TP'),
  D('第七部', '英文作文', 'Composition'), ...U('W1', 'W2', 'W3', 'WP'),
  D('第八部', '全真模擬試題', 'Mock Exams'), ...U('X1', 'X2'),
  D('附錄', '速查表', 'Appendix'), ...U('AppA', 'AppB'),
];
const FLOW = new Set(['G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10', 'G11', 'G12', 'T2b', 'T2c', 'V7b', 'C2']);
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;

const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const missing = [];

function optCols(html) {
  return html.replace(/<div class="opts">([\s\S]*?)<\/div>/g, (m, inner) => {
    const lens = [...inner.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').length);
    const mx = Math.max(0, ...lens);
    const cls = mx > 44 ? 'opts v' : mx > 20 ? 'opts h2' : 'opts';
    return `<div class="${cls}">${inner}</div>`;
  });
}
function lines(html) {
  html = optCols(html);
  for (const [a, b] of [['污染', '汙染'], ['佔', '占'], ['裏', '裡'], ['台灣', '臺灣'], ['分量', '份量'], ['溼', '濕']]) html = html.split(a).join(b);
  // <div class="lines" data-n="k"> → 固定高度的格線
  return html.replace(/<div class="lines" data-n="(\d+)"\s*><\/div>/g, (_, n) => {
    const k = Number(n);
    if (k > 2) return '<div class="paper">請用自己的稿紙作答，寫完再對照解答篇。</div>';
    return `<div class="lines" style="height:${k * 7}mm"></div>`;
  });
}

const fontCss = [
  `${FS}/noto-serif-tc/400.css`, `${FS}/noto-serif-tc/600.css`, `${FS}/noto-serif-tc/700.css`,
  `${FS}/noto-sans-tc/400.css`, `${FS}/noto-sans-tc/500.css`, `${FS}/noto-sans-tc/700.css`, `${FS}/noto-sans-tc/900.css`,
  `${FS}/source-serif-4/400.css`, `${FS}/source-serif-4/400-italic.css`, `${FS}/source-serif-4/600.css`, `${FS}/source-serif-4/700.css`,
  `${FS}/inter/500.css`, `${FS}/inter/600.css`, `${FS}/inter/700.css`, `${FS}/inter/800.css`,
].map((f) => `<link rel="stylesheet" href="file://${f}">`).join('\n');

const CSS = `
@page { size: A4; margin: 16mm 16mm 18mm 16mm; }
:root {
  --ink:#1a1f2b; --body:#262c38; --mute:#667085; --faint:#98a2b3;
  --pri:#173f6b; --pri2:#2b5f94; --pri-soft:#eef3f9; --pri-line:#c9d6e6;
  --acc:#c08a2e; --acc-soft:#fbf5ea; --teal:#25706c; --teal-soft:#ecf5f4;
  --bad:#b4372f; --bad-soft:#fdf1f0; --good:#1e7350; --good-soft:#edf7f2;
  --line:#d5dbe3; --zebra:#f7f9fb;
}
* { box-sizing:border-box; }
html { font-size:9.5pt; }
body { margin:0; color:var(--body); font-family:'Source Serif 4','Noto Serif TC','DejaVu Serif',serif; font-weight:400; line-height:1.6; letter-spacing:.01em; text-align:justify; -webkit-print-color-adjust:exact; print-color-adjust:exact; font-kerning:normal; font-variant-numeric:lining-nums; }
strong { font-weight:700; color:var(--ink); }
em { font-style:italic; }
h1,h2,h3,h4,th,.exid,.mark,.divider,.toc,.boxlabel { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; text-align:left; }
p { margin:.38rem 0; orphans:3; widows:3; }
ul,ol { margin:.3rem 0 .55rem; padding-left:1.35rem; }
li { margin:.14rem 0; }
li::marker { color:var(--pri2); }
ol > li::marker { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:600; font-size:.9em; }
.en { font-family:'Source Serif 4','Noto Serif TC','DejaVu Serif',serif; }

/* ── 單元開頭 ── */
.unit { break-before:page; }
.unit > h2.opener { display:block; margin:0 0 1.2rem; padding:0 0 .9rem; border:none; position:relative; }
.opener .code { display:inline-block; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:800; font-size:2.6rem; line-height:1; color:var(--acc); letter-spacing:-.02em; margin-right:.55rem; vertical-align:baseline; }
.opener .ttl { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:900; font-size:1.75rem; color:var(--pri); letter-spacing:.02em; vertical-align:baseline; }
.opener::after { content:''; position:absolute; left:0; right:0; bottom:0; height:3px; background:linear-gradient(90deg,var(--pri) 0 22%,var(--acc) 22% 30%,var(--pri-line) 30% 100%); border-radius:2px; }
.unit > h2:not(.opener) { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:900; font-size:1.75rem; color:var(--pri); margin:0 0 1.2rem; padding-bottom:.6rem; border-bottom:3px solid var(--pri-line); }

/* ── 節與小節 ── */
h3 { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:1.22rem; color:var(--pri); margin:1.6rem 0 .55rem; padding:.18rem 0 .18rem .7rem; border-left:4px solid var(--acc); line-height:1.4; break-after:avoid; }
h4 { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:1.0rem; color:var(--ink); margin:1.05rem 0 .35rem; break-after:avoid; }
h4.exset { display:block; margin:1.3rem 0 .6rem; padding:.42rem .8rem; color:#fff; font-weight:700; font-size:.98rem; letter-spacing:.03em; background:linear-gradient(90deg,var(--pri),var(--pri2)); border-radius:6px; }

/* ── 例句 ── */
p.eg { margin:.45rem 0 .45rem .2rem; padding:.15rem 0 .15rem .85rem; border-left:2.5px solid var(--pri-line); text-align:left; }
p.eg .en { display:block; font-size:1.07rem; color:var(--ink); line-height:1.6; }
p.eg .zh .en, td .en, li .en { display:inline; font-size:inherit; }
p.eg .zh { display:block; font-family:'Noto Sans TC','DejaVu Sans',sans-serif; color:var(--mute); font-size:.86rem; line-height:1.55; margin-top:.1rem; }

/* ── 三種框：加標籤 ── */
.key,.tip,.warn { position:relative; border-radius:8px; padding:.6rem 1rem .6rem; margin:.8rem 0 .8rem; break-inside:avoid; text-align:left; }
.key::before,.tip::before,.warn::before { display:table; margin:0 0 .35rem -.2rem; font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:.74rem; letter-spacing:.12em; color:#fff; padding:.08rem .55rem; border-radius:999px; line-height:1.5; }
.key { background:var(--pri-soft); border:1px solid var(--pri-line); }
.key::before { content:'重點'; background:var(--pri); }
.tip { background:var(--acc-soft); border:1px solid #ecd9b3; }
.tip::before { content:'高分技巧'; background:var(--acc); }
.warn { background:var(--bad-soft); border:1px solid #f1cdc9; }
.warn::before { content:'注意'; background:var(--bad); }
.key > :first-child,.tip > :first-child,.warn > :first-child { margin-top:0; }
.key > :last-child,.tip > :last-child,.warn > :last-child { margin-bottom:0; }

/* ── 誤／正 ── */
p.bad,p.good { margin:.24rem 0 .24rem .1rem; padding:.18rem .6rem; border-radius:5px; text-align:left; }
p.bad { background:var(--bad-soft); color:#7c2620; }
p.good { background:var(--good-soft); color:#164e37; }
.mark { display:inline-block; width:1.25rem; height:1.25rem; line-height:1.25rem; text-align:center; font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.72rem; font-weight:700; color:#fff; border-radius:50%; margin-right:.5rem; vertical-align:.08rem; }
p.bad .mark { background:var(--bad); } p.good .mark { background:var(--good); }

/* ── 表格 ── */
table.t { width:100%; border-collapse:separate; border-spacing:0; margin:.8rem 0 1rem; font-size:.9rem; line-height:1.6; text-align:left; border:1px solid var(--line); border-radius:8px; overflow:hidden; }
table.t th { background:var(--pri-soft); color:var(--pri); font-weight:700; font-size:.84rem; letter-spacing:.03em; padding:.45rem .6rem; border-bottom:1.5px solid var(--pri-line); vertical-align:bottom; }
table.t td { padding:.38rem .6rem; border-bottom:1px solid #e8ecf1; vertical-align:top; }
table.t tbody tr:nth-child(even) td { background:var(--zebra); }
table.t tbody tr:last-child td { border-bottom:none; }
table.t tr { break-inside:avoid; }
table.t td .en, table.t td span.en { font-size:1.02em; }

/* ── 練習題 ── */
.ex { margin:.7rem 0 .95rem; break-inside:avoid; text-align:left; }
.exid { display:inline-block; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-size:.74rem; font-weight:700; letter-spacing:.02em; color:#fff; background:var(--pri); border-radius:4px; padding:.05rem .42rem; margin-right:.55rem; vertical-align:.1rem; }
.lines { margin-top:.35rem; background:repeating-linear-gradient(to bottom, transparent 0, transparent calc(8mm - 0.7px), #c3cad4 calc(8mm - 0.7px), #c3cad4 8mm); }

/* ── 自我檢核 ── */
ul.check { list-style:none; padding:.6rem .9rem; margin:.8rem 0; background:var(--teal-soft); border-radius:8px; border:1px solid #cfe5e2; break-inside:avoid; }
ul.check li { padding-left:1.6rem; position:relative; margin:.28rem 0; }
ul.check li::before { content:''; position:absolute; left:0; top:.32rem; width:.85rem; height:.85rem; border:1.5px solid var(--teal); border-radius:3px; background:#fff; }

/* ── 解答篇：兩欄 ── */
.answers { font-size:.84rem; line-height:1.56; column-count:2; column-gap:7mm; column-rule:1px solid var(--line); }
.ans-unit { margin:0 0 1rem; }
.ans-unit h3 { column-span:all; margin:1.2rem 0 .6rem; font-size:1.15rem; }
.ans-unit h4 { font-size:.92rem; margin:.7rem 0 .3rem; color:var(--pri); }
.ans-unit > p { font-size:.86rem; color:var(--mute); }
.ans { margin:.35rem 0 .55rem; break-inside:avoid; text-align:left; }
.ans .exid { font-size:.68rem; }
.ans .why { display:block; color:#4a5263; font-size:.92em; margin:.15rem 0 0 .1rem; }
.answers table.t { font-size:.82rem; }

/* ── 分部頁 ── */
.divider { break-before:page; height:250mm; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; padding-left:6mm; position:relative; overflow:hidden; }
.divider::before { content:''; position:absolute; left:0; top:38%; width:46mm; height:3px; background:var(--acc); }
.divider .k { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:1.15rem; color:var(--acc); letter-spacing:.4em; margin-top:2rem; }
.divider .t { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:900; font-size:3.4rem; color:var(--pri); margin:.4rem 0 .2rem; letter-spacing:.06em; }
.divider .e { font-family:'Source Serif 4','Noto Serif TC','DejaVu Serif',serif; font-style:italic; font-size:1.35rem; color:var(--mute); }
.divider svg { position:absolute; right:-62mm; top:52mm; opacity:.85; }

/* ── 目錄 ── */
.toc h2 { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:900; font-size:1.9rem; color:var(--pri); margin:0 0 1.4rem; padding-bottom:.6rem; border-bottom:3px solid var(--pri-line); }
.toc .row { display:flex; align-items:baseline; margin:.42rem 0; font-size:1.02rem; }
.toc .row.part { margin-top:1.2rem; font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:900; color:var(--acc); font-size:1.08rem; letter-spacing:.06em; }
.toc .row .code { width:3.4rem; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; color:var(--pri); font-weight:800; }
.toc .row .name { flex:0 1 auto; font-family:'Noto Sans TC','DejaVu Sans',sans-serif; color:var(--ink); }
.toc .row .dots { flex:1; border-bottom:1.2px dotted var(--faint); margin:0 .5rem; transform:translateY(-.28rem); }
.toc .row .pg { width:2.4rem; text-align:right; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:600; color:var(--pri); }

#AppA { font-size:.92rem; } #V3 .vl { column-count:3; column-gap:5mm; } #V3 .ve .v1 b { font-size:.9rem; } #V3 .ve .v1 .z { font-size:.82rem; } #V3 .ve .v2 { font-size:.72rem; }
/* ── 接排的單元、附錄 B 兩欄 ── */
.unit.flow { break-before:auto; margin-top:2.2rem; }
#AppB { font-size:.9rem; } #AppB .t { font-size:.86rem; }
#AppB .cols2 { column-count:2; column-gap:7mm; } #AppB .cols2 table { break-inside:auto; width:100%; } #AppB .cols2 tr { break-inside:avoid; }
/* ── 字彙表（V3、V4） ── */
.vl { column-count:2; column-gap:7mm; column-rule:1px solid var(--line); margin-top:.6rem; }
.vL { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:800; font-size:1.3rem; color:var(--acc); margin:.5rem 0 .15rem; break-after:avoid; }
.ve { break-inside:avoid; padding:.16rem 0 .2rem; border-bottom:1px solid #eceff3; text-align:left; line-height:1.38; }
.ve .v1 b { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:.98rem; color:var(--ink); margin-right:.35rem; }
.ve.a .v1 b { color:var(--pri); }
.ve .v1 em { font-family:'Source Serif 4','Noto Serif TC','DejaVu Serif',serif; font-size:.82rem; color:var(--teal); margin-right:.35rem; }
.ve .v1 .z { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:500; font-size:.88rem; color:var(--ink); }
.ve .lv { font-style:normal; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-size:.62rem; font-weight:600; color:var(--faint); margin-left:.4rem; }
.ve .y { font-style:normal; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-size:.62rem; font-weight:700; color:#fff; background:var(--acc); border-radius:2px; padding:0 .22rem; margin-left:.25rem; vertical-align:.08em; }
.ve .v2 { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:500; font-size:.78rem; color:var(--teal); }
.ve .v2 span { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:400; color:var(--mute); margin-left:.5rem; }
.ve .kk { font-family:'DejaVu Sans','Noto Sans TC','DejaVu Sans',sans-serif; font-size:.7rem; color:var(--mute); margin-right:.5rem; }
.ve .fam { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.76rem; color:var(--mute); }
.ve .v1.s .z { font-weight:700; color:var(--pri); }
.ve .v3 { font-size:.86rem; color:#3a4150; } .ve .v3 b { color:var(--bad); font-weight:700; }
/* ── 四選一選項、題庫題組 ── */
.opts { display:grid; grid-template-columns:repeat(4,1fr); gap:.1rem .8rem; margin:.25rem 0 .1rem; font-family:'Source Serif 4','Noto Serif TC','DejaVu Serif',serif; text-align:left; }
.opts.v { grid-template-columns:1fr; gap:.12rem; }
.opts.h2 { grid-template-columns:1fr 1fr; }
.opts span { break-inside:avoid; }
.paper { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.8rem; color:var(--mute); border:1px dashed var(--line); border-radius:4px; padding:.35rem .7rem; margin-top:.4rem; }
.mk { position:absolute; font-size:1pt; color:#fff; line-height:1; }
.bank .intro { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.9rem; color:#3a4150; background:var(--pri-soft); border-radius:5px; padding:.5rem .8rem; }
.set { margin:1.1rem 0 1.5rem; }
.set .sh { display:flex; align-items:center; gap:.55rem; border-bottom:2px solid var(--pri); padding-bottom:.25rem; margin-bottom:.55rem; break-after:avoid; }
.set .sid { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:800; font-size:1rem; color:var(--pri); }
.tier { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:.68rem; color:#fff; border-radius:999px; padding:.02rem .55rem; }
.t-basic { background:var(--teal); } .t-advanced { background:var(--pri2); } .t-top { background:var(--acc); }
.set .sn { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:.85rem; color:var(--ink); }
.set .sc { margin-left:auto; font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.78rem; color:var(--mute); }
.set .sc i { display:inline-block; width:12mm; border-bottom:1px solid var(--faint); }
.passage { text-align:justify; font-size:.98rem; line-height:1.62; margin:.2rem 0 .6rem; }
.passage p { margin:.28rem 0; text-indent:1.4em; }
.passage.lead p { text-indent:0; font-style:italic; color:#3a4150; }
.passage .pt { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; color:var(--pri); margin:.5rem 0 .1rem; }
.passage .pt b { display:inline-block; background:var(--pri); color:#fff; border-radius:3px; padding:0 .4rem; margin-right:.5rem; font-size:.85rem; }
.bl { display:inline-block; min-width:3.1em; text-align:center; border-bottom:1.2px solid var(--ink); font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:.78rem; color:var(--pri); line-height:1.25; margin:0 .15em; text-indent:0; }
.bl.w { min-width:5em; }
.ub { display:inline-block; width:3.4em; border-bottom:1.2px solid var(--ink); }
.q { display:flex; gap:.45rem; margin:.5rem 0; break-inside:avoid; text-align:left; }
.q .qn { flex:none; min-width:1.9em; font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; color:var(--pri); }
.q .qb { flex:1; min-width:0; }
.q .ins { font-family:'Noto Serif TC','DejaVu Serif',serif; font-size:.86rem; color:#4a5263; }
.q .zhq { font-family:'Noto Serif TC','DejaVu Serif',serif; font-size:1rem; }
.wl { height:8mm; border-bottom:1px solid #c3cad4; margin-bottom:.3rem; } .wl2 { height:15mm; background:repeating-linear-gradient(to bottom, transparent 0, transparent calc(7.5mm - 0.7px), #c3cad4 calc(7.5mm - 0.7px), #c3cad4 7.5mm); }
.bankbox { display:grid; grid-template-columns:repeat(5,1fr); gap:.2rem .6rem; border:1.5px solid var(--pri-line); border-radius:6px; padding:.5rem .8rem; margin:.4rem 0 .8rem; font-size:.95rem; break-inside:avoid; text-align:left; }
.bankbox.v { grid-template-columns:1fr; }
.fig { margin:.5rem auto; width:108mm; text-align:center; break-inside:avoid; } .fig svg { width:100%; height:auto; border:1px solid var(--line); border-radius:4px; } .fig .cap { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.78rem; color:var(--mute); margin-top:.2rem; }
.mock .mockhead { font-family:'Noto Sans TC','DejaVu Sans',sans-serif; font-size:.88rem; background:var(--acc-soft); border:1px solid #ead9b5; border-radius:5px; padding:.5rem .8rem; margin-bottom:.6rem; }
.mock h3.sec { margin-top:1.4rem; } .mock .secnote, .mock .rng { font-family:'Noto Serif TC','DejaVu Serif',serif; font-size:.86rem; color:#4a5263; margin:.2rem 0 .5rem; } .mock .rng { font-weight:700; color:var(--ink); margin-top:.9rem; }
/* 題庫解答 */
.aset { margin:.3rem 0 .9rem; }
.aset .at { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:800; font-size:.92rem; color:var(--pri); break-after:avoid; }
.aset .akey { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; font-weight:700; font-size:.8rem; background:var(--pri-soft); border-radius:3px; padding:.15rem .5rem; margin:.2rem 0 .35rem; line-height:1.7; break-inside:avoid; }
.aset .akey i { font-style:normal; font-weight:500; color:var(--mute); font-size:.7rem; margin-right:.12rem; }
.aset .ar { margin:.25rem 0 .4rem; text-align:left; }
.aset .an { font-family:'Inter','Noto Sans TC','DejaVu Sans',sans-serif; color:var(--pri); }
.aset .ax { font-weight:600; color:var(--ink); }
.aset .ref { font-weight:600; } .aset .alt { font-weight:400; color:#4a5263; }
.aset .why { display:block; color:#4a5263; font-size:.94em; }
.aset .ol ul { margin:.2rem 0; padding-left:1rem; } .aset .ol li { margin:.15rem 0; }
.aset p.model { margin:.3rem 0; text-indent:1.4em; text-align:justify; }
ul.check { list-style:none; padding-left:0; } ul.check li::before { content:''; display:inline-block; width:.72em; height:.72em; border:1.2px solid var(--pri2); border-radius:2px; margin-right:.5em; vertical-align:-.05em; }
`;

function ringSvg(size, seed = 1) {
  // 幾何同心環＋弧線
  const c = size / 2, out = [];
  const cols = ['#1f4e79', '#b9852c', '#2f7d7a', '#c9cfd8'];
  for (let i = 0; i < 9; i++) {
    const r = size * 0.06 + i * size * 0.05;
    const col = cols[(i + seed) % cols.length];
    const dash = (i % 3 === 0) ? '' : `stroke-dasharray="${(r * 0.9).toFixed(1)} ${(r * 0.35).toFixed(1)}"`;
    out.push(`<circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${i % 2 ? 1.2 : 2.6}" ${dash} transform="rotate(${i * 23 + seed * 11} ${c} ${c})" opacity="${0.55 + (i % 3) * 0.15}"/>`);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 + seed * 7) * Math.PI / 180, r = size * 0.46;
    out.push(`<line x1="${c}" y1="${c}" x2="${(c + r * Math.cos(a)).toFixed(1)}" y2="${(c + r * Math.sin(a)).toFixed(1)}" stroke="#1f4e79" stroke-width="0.6" opacity="0.35"/>`);
  }
  out.push(`<circle cx="${c}" cy="${c}" r="${size * 0.035}" fill="#b9852c"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${out.join('')}</svg>`;
}

function coverHtml() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>
@page { size:A4; margin:0; } body{margin:0;font-family:'Noto Sans TC',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.c{width:210mm;height:297mm;position:relative;overflow:hidden;background:#fbfaf6;}
.art{position:absolute;right:-60mm;top:-40mm;} .art2{position:absolute;left:-55mm;bottom:-70mm;opacity:.55;}
.band{position:absolute;left:0;top:150mm;width:210mm;height:2.2mm;background:#b9852c;}
.tx{position:absolute;left:20mm;top:162mm;right:20mm;color:#1d2433;}
.k{font-size:15pt;letter-spacing:.35em;color:#b9852c;font-weight:700;}
.t{font-size:54pt;font-weight:900;color:#173f6b;line-height:1.15;margin:4mm 0 3mm;letter-spacing:.06em;}
.s{font-family:'Source Serif 4',serif;font-style:italic;font-size:15pt;color:#5b6577;}
.ls{position:absolute;left:20mm;top:222mm;display:grid;grid-template-columns:repeat(4,auto);gap:2mm 7mm;font-size:11pt;color:#173f6b;font-weight:700;}
.ls span{border-left:3px solid #b9852c;padding-left:2.5mm;}
.f{position:absolute;left:20mm;bottom:18mm;font-size:12pt;color:#173f6b;font-weight:700;letter-spacing:.15em;}
.f span{color:#5b6577;font-weight:500;letter-spacing:0;margin-left:4mm;}
</style></head><body><div class="c">
<div class="art">${ringSvg(620, 1)}</div><div class="art2">${ringSvg(380, 3)}</div>
<div class="band"></div>
<div class="tx"><div class="k">學測英文　全科攻略</div><div class="t">學測英文秘笈</div>
<div class="s">The Complete Guide to the GSAT English Test</div></div>
<div class="ls"><span>字彙</span><span>文法與綜合測驗</span><span>文意選填</span><span>篇章結構</span><span>閱讀測驗</span><span>混合題</span><span>中譯英</span><span>英文作文</span></div>
<div class="f">學測英文中心<span>解法・考點・練習・兩回全真模擬</span></div>
</div></body></html>`;
}

const want = (id) => !ONLY || ONLY.has(id);
function bodyHtml(pages = {}) {
  const segs = [], tocRows = [];
  let di = 0;
  for (const o of ORDER) {
    if (o.divider) {
      di++;
      if (ONLY) continue;
      segs.push(`<section class="divider"><span class="mk">@@DIV${di}@@</span><div class="k">${o.divider}</div><div class="t">${o.title}</div><div class="e">${o.en}</div>${ringSvg(440, o.title.length)}</section>`);
      tocRows.push(`<div class="row part"><span class="name">${o.divider}　${o.title}</span><span class="dots"></span><span class="pg">${pages[`DIV${di}`] ?? ''}</span></div>`);
      continue;
    }
    if (!want(o.id)) continue;
    const b = read(`${PARTS}/${o.id}.body.html`);
    if (!b) { missing.push(o.id); continue; }
    let title = o.id, shown = o.id;
    let bb = b;
    if (FLOW.has(o.id)) bb = bb.replace('<section class="unit"', '<section class="unit flow"');
    if (o.id === 'AppB') {
      const cut = (html, from, to) => { const i = html.indexOf(from), j = to ? html.indexOf(to) : -1; if (i < 0 || (to && j < 0)) return html; const k = html.indexOf('</h3>', i) + 5; return `${html.slice(0, k)}<div class="cols2">${html.slice(k, j)}</div>${html.slice(j)}`; };
      bb = cut(bb, '<h3>B1', '<h3>B2'); bb = cut(bb, '<h3>B4', '<h3>AppB 自我檢核');
    }
    segs.push(lines(bb).replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/, (m, attrs, inner) => {
      const t = inner.trim();
      let code = null, ttl = t, mm;
      if ((mm = t.match(/^第\s*0\s*章[\s　]+([\s\S]+)$/))) { code = '0'; ttl = mm[1]; }
      else if ((mm = t.match(/^附錄\s*([A-Z])[\s　]+([\s\S]+)$/))) { code = mm[1]; ttl = mm[2]; }
      else if ((mm = t.match(/^([A-Za-z]\w{0,3})[\s　]+([\s\S]+)$/))) { code = mm[1]; ttl = mm[2]; }
      if (code && /^App[A-Z]$/.test(code)) code = code.slice(3);
      if (code === 'S0') code = '0';
      title = ttl.replace(/<[^>]+>/g, ''); shown = code ?? '';
      return `<h2 class="opener"${attrs}><span class="mk">@@${o.id}@@</span>${code ? `<span class="code">${code}</span>` : ''}<span class="ttl">${ttl}</span></h2>`;
    }));
    tocRows.push(`<div class="row"><span class="code">${shown}</span><span class="name">${title}</span><span class="dots"></span><span class="pg">${pages[o.id] ?? ''}</span></div>`);
  }
  // 解答篇
  const ans = [];
  for (const o of ORDER) {
    if (!o.id || !want(o.id)) continue;
    const a = read(`${PARTS}/${o.id}.ans.html`);
    if (a && /class="(ans|aset)"/.test(a)) ans.push(a);
  }
  if (ans.length) {
    segs.push(`<section class="divider"><span class="mk">@@ANS@@</span><div class="k">解答篇</div><div class="t">解答與說明</div><div class="e">Answer Key</div>${ringSvg(440, 5)}</section>`);
    tocRows.push(`<div class="row part"><span class="name">解答篇</span><span class="dots"></span><span class="pg">${pages.ANS ?? ''}</span></div>`);
    segs.push(`<div class="answers" style="break-before:page">${lines(ans.join('\n'))}</div>`);
  }
  const toc = `<section class="toc" style="break-before:auto"><h2>目錄</h2>${tocRows.join('\n')}</section>`;
  const head = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">${fontCss}<style>${CSS}</style></head><body>`;
  return { body: `${head}${segs.join('\n').replace('<section class="unit', '<section style="break-before:auto" class="unit')}</body></html>`, toc: `${head}<style>.toc .row{padding:.16rem 0;font-size:.92rem;} .toc .row.part{margin-top:.7rem;} .toc{column-count:2;column-gap:10mm;} .toc h2{column-span:all;}</style>${toc}</body></html>` };
}

const footer = `<div style="width:100%;font-size:8pt;color:#5b6577;font-family:'WenQuanYi Zen Hei',sans-serif;padding:0 16mm;display:flex;justify-content:space-between;"><span>學測英文中心・學測英文秘笈</span><span class="pageNumber" style="font-family:'Liberation Serif',serif;font-size:9pt"></span></div>`;

async function render(page, html, file, withFooter) {
  writeFileSync(file.replace(/\.pdf$/, '.html'), html);
  await page.goto(`file://${file.replace(/\.pdf$/, '.html')}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: withFooter, headerTemplate: '<span></span>', footerTemplate: withFooter ? footer : '<span></span>' });
}

const browser = await chromium.launch();
const page = await browser.newPage();
await render(page, coverHtml(), `${OUT}/cover.pdf`, false);
await render(page, bodyHtml().body, `${OUT}/body.pdf`, true);
const n = Number(execFileSync('pdfinfo', [`${OUT}/body.pdf`]).toString().match(/Pages:\s+(\d+)/)[1]);
const found = {};
const all = execFileSync('pdftotext', ['-raw', `${OUT}/body.pdf`, '-'], { maxBuffer: 1 << 28 }).toString().split('\f');
all.forEach((t, i) => { for (const m of t.matchAll(/@@([A-Za-z0-9]+)@@/g)) if (!(m[1] in found)) found[m[1]] = i + 1; });
await render(page, bodyHtml(found).toc, `${OUT}/toc.pdf`, false);
await browser.close();
execFileSync('pdfunite', [`${OUT}/cover.pdf`, `${OUT}/toc.pdf`, `${OUT}/body.pdf`, `${OUT}/book.pdf`]);
const info = execFileSync('pdfinfo', [`${OUT}/book.pdf`]).toString().match(/Pages:\s+(\d+)/)[1];
const order = ORDER.filter((o) => o.id && found[o.id]).map((o) => o.id);
const len = {}; order.forEach((id, i) => { const nx = order[i + 1] ? found[order[i + 1]] : (found.ANS ?? n + 1); len[id] = nx - found[id]; });
console.log(JSON.stringify({ pages: Number(info), body: n, answers: found.ANS ? n - found.ANS + 1 : 0, missing, len }));
