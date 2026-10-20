#!/usr/bin/env node
// @ts-check
/**
 * PDF 字型的缺字檢查：試題資料裡的每個字元，都要在 PDF 會用到的字型子集裡有字形，否則下載的 PDF 會出現方框（豆腐字）。
 *
 *   node apps/web/scripts/font-coverage.mjs      （或 npm run check:fonts -w @gsat/web；要先跑過 build:data）
 *   build-data.mjs 每次建置時也會呼叫 checkFontCoverage()，有缺字就讓建置失敗。
 *
 * 字型與字元範圍來自 src/features/pdf/fonts/（scripts/fonts/subset_fonts.py 產生）：
 *   - latinRanges 內的字元用 Tinos，emojiRanges 內的用 Noto Emoji，其他（中文、全形標點）用 Noto Serif TC Regular；
 *     規則與前端的 src/features/pdf/fontRuns.ts 相同（兩邊都讀 metrics.json）。
 *   - 大題／部分標題在 PDF 裡用粗體，所以標題裡的中文還要在 Noto Serif TC Bold 子集裡。
 *   - PDF 固定文字（src/features/pdf/layout/strings.ts、attribution.ts）的中文也要在中文子集裡。
 *   - metrics.json 記的雜湊與 boldCjk 要和實際字型檔一致（防止換了字型卻忘了重新產生 metrics.json）。
 * 缺字的修法：照 src/features/pdf/fonts/README.md 重跑 subset_fonts.py（需要 Python 與 fonttools，只在開發機上跑一次）。
 *
 * 題庫（本站自組模擬考的 PDF）另外用 bankPrintableCoverage() 逐組檢查，題本與解析的缺字分開列（docs/design/bank-mock.md §7.6）：
 * 結果交給 lib/bank-mock-pool.mjs，只警告、不讓建置失敗（題庫每天加題，不能因為一個罕用字擋住整站部署）。
 *
 * 只用 Node 內建模組（zlib 解 gzip、自己讀 TrueType 的 cmap 表），Vercel 建置不需要額外套件。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FONTS_DIR = path.join(WEB_DIR, 'src', 'features', 'pdf', 'fonts');
const PDF_SRC_DIR = path.join(WEB_DIR, 'src', 'features', 'pdf');

/**
 * @typedef {{ file: string, sha256: string }} FontMeta
 * @typedef {{ latinRanges: [number, number][], emojiRanges: [number, number][], boldCjk: string, fonts: Record<string, FontMeta> }} FontMetrics
 * @typedef {{ errors: string[], warnings: string[], stats: { chars: number, exams: number } }} CoverageResult
 */

/**
 * TrueType／OpenType 的 cmap 表 → 有字形的 Unicode 碼位。只支援子集化後實際會出現的 format 4（BMP）與 format 12（全平面）。
 * @param {Buffer} font
 * @returns {Set<number>}
 */
export function cmapCodePoints(font) {
  const numTables = font.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    if (font.toString('latin1', rec, rec + 4) === 'cmap') cmapOffset = font.readUInt32BE(rec + 8);
  }
  if (cmapOffset < 0) throw new Error('字型沒有 cmap 表');
  const subtables = font.readUInt16BE(cmapOffset + 2);
  /** @type {Map<number, number>} format → 子表位置（偏好 Windows Unicode 的 format 12，再來是 format 4） */
  const byFormat = new Map();
  for (let i = 0; i < subtables; i += 1) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = font.readUInt16BE(rec);
    const encoding = font.readUInt16BE(rec + 2);
    const offset = cmapOffset + font.readUInt32BE(rec + 4);
    if (platform !== 3 && platform !== 0) continue;
    if (platform === 3 && encoding !== 1 && encoding !== 10) continue;
    const format = font.readUInt16BE(offset);
    if (!byFormat.has(format)) byFormat.set(format, offset);
  }
  /** @type {Set<number>} */
  const out = new Set();
  const f12 = byFormat.get(12);
  if (f12 !== undefined) {
    const groups = font.readUInt32BE(f12 + 12);
    for (let g = 0; g < groups; g += 1) {
      const rec = f12 + 16 + g * 12;
      const start = font.readUInt32BE(rec);
      const end = font.readUInt32BE(rec + 4);
      const glyph = font.readUInt32BE(rec + 8);
      for (let cp = start; cp <= end; cp += 1) if (glyph + (cp - start) !== 0) out.add(cp);
    }
    return out;
  }
  const f4 = byFormat.get(4);
  if (f4 === undefined) throw new Error('cmap 沒有 format 4 或 12 的子表');
  const segCount = font.readUInt16BE(f4 + 6) / 2;
  const endBase = f4 + 14;
  const startBase = endBase + segCount * 2 + 2;
  const deltaBase = startBase + segCount * 2;
  const rangeBase = deltaBase + segCount * 2;
  for (let s = 0; s < segCount; s += 1) {
    const end = font.readUInt16BE(endBase + s * 2);
    const start = font.readUInt16BE(startBase + s * 2);
    const delta = font.readInt16BE(deltaBase + s * 2);
    const rangeOffsetPos = rangeBase + s * 2;
    const rangeOffset = font.readUInt16BE(rangeOffsetPos);
    for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
      let glyph;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        const raw = font.readUInt16BE(rangeOffsetPos + rangeOffset + (cp - start) * 2);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(cp);
    }
  }
  return out;
}

/** @param {number} cp @param {[number, number][]} ranges */
const inRanges = (cp, ranges) => ranges.some(([a, b]) => cp >= a && cp <= b);

/** @param {Set<number>} cps */
const show = (cps) => [...cps].sort((a, b) => a - b).map((cp) => `${String.fromCodePoint(cp)}(U+${cp.toString(16).toUpperCase().padStart(4, '0')})`).join(' ');

/** 讀字型目錄：metrics.json 與各子集的 cmap。 */
export function loadFonts(dir = FONTS_DIR) {
  const metricsPath = path.join(dir, 'metrics.json');
  if (!existsSync(metricsPath)) throw new Error(`找不到 ${path.relative(WEB_DIR, metricsPath)}，請照 fonts/README.md 執行 subset_fonts.py`);
  /** @type {FontMetrics} */
  const metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
  /** @type {Record<string, Set<number>>} */
  const cmaps = {};
  /** @type {string[]} */
  const stale = [];
  for (const [name, meta] of Object.entries(metrics.fonts)) {
    const gz = readFileSync(path.join(dir, meta.file));
    if (createHash('sha256').update(gz).digest('hex') !== meta.sha256) stale.push(`${meta.file} 的雜湊和 metrics.json 不符`);
    cmaps[name] = cmapCodePoints(gunzipSync(gz));
  }
  return { metrics, cmaps, stale };
}

/** 一份考卷裡所有字串值（遞迴），以及大題／部分標題。 @param {unknown} exam */
function examStrings(exam) {
  /** @type {string[]} */
  const all = [];
  /** @type {string[]} */
  const titles = [];
  /** @param {unknown} v */
  const walk = (v) => {
    if (typeof v === 'string') all.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(exam);
  const e = /** @type {{ sections?: { title?: string }[], parts?: { title?: string | null }[] }} */ (exam);
  for (const s of e.sections ?? []) if (s.title) titles.push(s.title);
  for (const p of e.parts ?? []) if (p.title) titles.push(p.title);
  return { all, titles };
}

/**
 * PDF 固定文字的檔案（封面、答題卷、頁首頁尾的中文都集中在這裡，見 strings.ts 檔頭）。
 * 不掃整個 src/features/pdf/：註解裡的字不會印在 PDF 上，掃進來只會產生假警報。
 */
export const PDF_TEXT_FILES = ['layout/strings.ts', 'layout/attribution.ts'];

/** 去掉 /* *\/ 與整行的 // 註解（和 subset_fonts.py 的 strip_comments 相同）。 @param {string} source */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 由其他模組傳進 PDF、會印在封面上的文字（模擬考的 MockPdfMeta：卷別名稱、沿用題提醒）。
 * 只看字串常值（註解與程式碼不會印出來），缺字是錯誤；不檢查粗體（封面這些字不用粗體）。
 */
export const PDF_DYNAMIC_FILES = ['../mock/papers.ts'];

/** 原始碼裡的字串常值（'…'、"…"、`…`）。 @param {string} source */
export function stringLiterals(source) {
  return (stripComments(source).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? []).join('\n');
}

function pdfDynamicText() {
  return PDF_DYNAMIC_FILES.map((rel) => path.join(PDF_SRC_DIR, rel))
    .filter((p) => existsSync(p))
    .map((p) => stringLiterals(readFileSync(p, 'utf8')))
    .join('\n');
}

function pdfSourceText() {
  return PDF_TEXT_FILES.map((rel) => path.join(PDF_SRC_DIR, rel))
    .filter((p) => existsSync(p))
    .map((p) => stripComments(readFileSync(p, 'utf8')))
    .join('\n');
}

/**
 * @param {{ id: string, exam: unknown }[]} exams  build-data 輸出的考卷（物件）
 * @param {{ fontsDir?: string, pdfSource?: string, pdfDynamicSource?: string }} [options]
 * @returns {CoverageResult}
 */
export function checkFontCoverage(exams, options = {}) {
  const { metrics, cmaps, stale } = loadFonts(options.fontsDir);
  /** @type {string[]} */
  const errors = [...stale];
  /** @type {string[]} */
  const warnings = [];
  const regular = cmaps['NotoSerifTC-Regular'];
  const bold = cmaps['NotoSerifTC-Bold'];
  const tinos = cmaps['Tinos-Regular'];
  const emoji = cmaps['NotoEmoji-Regular'];
  if (!regular || !bold || !tinos || !emoji) throw new Error('metrics.json 缺少 NotoSerifTC-Regular／NotoSerifTC-Bold／Tinos-Regular／NotoEmoji-Regular');

  // metrics.json 的範圍要和字型實際的 cmap 一致：fontRuns.ts 只看 metrics.json 決定字型。
  for (const cp of tinos) if (!inRanges(cp, metrics.latinRanges)) errors.push(`Tinos 有 U+${cp.toString(16)} 但 metrics.json 的 latinRanges 沒有，請重跑 subset_fonts.py`);
  for (const [a, b] of metrics.latinRanges) for (let cp = a; cp <= b; cp += 1) if (!tinos.has(cp)) errors.push(`latinRanges 含 U+${cp.toString(16)}，但 Tinos 沒有這個字形`);
  const boldActual = [...bold].filter((cp) => !inRanges(cp, metrics.latinRanges)).sort((a, b) => a - b).map((cp) => String.fromCodePoint(cp)).join('');
  if (boldActual !== metrics.boldCjk) errors.push('metrics.json 的 boldCjk 和 NotoSerifTC-Bold 子集不一致，請重跑 subset_fonts.py');

  /** @param {number} cp */
  const fontFor = (cp) => (inRanges(cp, metrics.latinRanges) ? tinos : inRanges(cp, metrics.emojiRanges) ? emoji : regular);
  /** @type {Map<number, Set<string>>} 缺字 → 出現的考卷 */
  const missing = new Map();
  /** @type {Map<number, Set<string>>} */
  const missingBold = new Map();
  const seen = new Set();
  for (const { id, exam } of exams) {
    const { all, titles } = examStrings(exam);
    for (const s of all) {
      for (const ch of s) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        if (cp < 0x20 || cp === 0x7f) continue;
        seen.add(cp);
        if (!fontFor(cp).has(cp)) (missing.get(cp) ?? missing.set(cp, new Set()).get(cp))?.add(id);
      }
    }
    for (const t of titles) {
      for (const ch of t) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        if (cp <= 0x20 || inRanges(cp, metrics.latinRanges) || inRanges(cp, metrics.emojiRanges) || /\s/.test(ch)) continue;
        if (!bold.has(cp)) (missingBold.get(cp) ?? missingBold.set(cp, new Set()).get(cp))?.add(id);
      }
    }
  }
  if (missing.size > 0) {
    const where = [...missing].map(([cp, ids]) => `  ${show(new Set([cp]))}：${[...ids].slice(0, 5).join('、')}${ids.size > 5 ? ' 等' : ''}`);
    errors.push(`試題資料有 ${missing.size} 個字元不在 PDF 字型子集裡（PDF 會顯示成方框）：\n${where.join('\n')}`);
  }
  if (missingBold.size > 0) {
    errors.push(`大題／部分標題有 ${missingBold.size} 個字不在粗體子集裡：${show(new Set(missingBold.keys()))}`);
  }

  // PDF 固定文字：一般粗細缺字是錯誤（一定會印出來）；粗體缺字只警告（會改用一般粗細，不會變成方框）。
  const src = options.pdfSource ?? pdfSourceText();
  const srcMissing = new Set();
  const srcMissingBold = new Set();
  for (const ch of src) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x2e80 || inRanges(cp, metrics.emojiRanges)) continue; // 只看中日韓文字與全形符號
    if (!regular.has(cp)) srcMissing.add(cp);
    else if (!bold.has(cp)) srcMissingBold.add(cp);
  }
  if (srcMissing.size > 0) errors.push(`PDF 固定文字（${PDF_TEXT_FILES.join('、')}）有 ${srcMissing.size} 個字不在中文子集裡：${show(srcMissing)}`);
  const dynamicMissing = new Set();
  for (const ch of options.pdfDynamicSource ?? pdfDynamicText()) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x2e80 || inRanges(cp, metrics.emojiRanges)) continue;
    if (!regular.has(cp)) dynamicMissing.add(cp);
  }
  if (dynamicMissing.size > 0) errors.push(`模擬考 PDF 封面文字（${PDF_DYNAMIC_FILES.join('、')}）有 ${dynamicMissing.size} 個字不在中文子集裡：${show(dynamicMissing)}`);
  if (srcMissingBold.size > 0) warnings.push(`PDF 固定文字有 ${srcMissingBold.size} 個字不在粗體子集（用粗體印時會改用一般粗細）：${show(srcMissingBold)}`);
  return { errors, warnings, stats: { chars: seen.size, exams: exams.length } };
}

// ---------------------------------------------------------------------------
// 題庫（本站自組模擬考的 PDF，docs/design/bank-mock.md §7.6）
// ---------------------------------------------------------------------------

/**
 * @typedef {Record<string, unknown>} JsonObject
 * @typedef {{ booklet: string[], explanations: string[], sources: string[] }} PrintableStrings
 * @typedef {{ booklet: string[], explanations: string[], sources: string[] }} MissingGlyphs  缺的字（不重複、依碼位排序）
 */

/** @param {unknown} v @returns {v is JsonObject} */
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v @returns {unknown[]} */
const list = (v) => (Array.isArray(v) ? v : []);
/** 把值裡的字串（遞迴）加進 out。 @param {string[]} out @param {...unknown} values */
function pushStrings(out, ...values) {
  for (const v of values) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) pushStrings(out, x);
    else if (isObj(v)) for (const x of Object.values(v)) pushStrings(out, x);
  }
}

/**
 * 圖會印出來的字串：有 chart 的印表名、軸、類別、數列名稱與附註（資料表，§7.3），表格印 rows；兩者都**不印文字描述**
 * （閱讀圖表的描述常常直接說出答案）。沒有 chart 也沒有 rows 的圖（作文的圖）印文字描述。
 * @param {unknown} f @param {string[]} out
 */
function figureStrings(f, out) {
  if (!isObj(f)) return;
  pushStrings(out, f.label, f.caption);
  if (isObj(f.chart)) {
    const c = f.chart;
    pushStrings(out, c.title, c.x, c.y, c.categories, list(c.series).map((s) => (isObj(s) ? s.name : null)), c.note);
  } else if (Array.isArray(f.rows)) pushStrings(out, f.rows);
  else pushStrings(out, f.description);
}

/**
 * 出處（資料來源頁，§7.5）：題組的 attribution_text、參考資料、圖表的 chart.source。
 * 參考資料的標題常是原文（日文網頁），和題目無關，所以另外一類：缺字只警告，不影響題組能不能組新卷。
 * @param {unknown} provenance @param {unknown[]} figures @param {string[]} out
 */
function sourceStrings(provenance, figures, out) {
  if (isObj(provenance)) {
    pushStrings(out, provenance.attribution_text);
    for (const r of list(provenance.references)) if (isObj(r)) pushStrings(out, r.publisher, r.title, r.license);
  }
  for (const f of figures) if (isObj(f) && isObj(f.chart) && isObj(f.chart.source)) pushStrings(out, f.chart.source.publisher, f.chart.source.title, f.chart.source.license);
}

/**
 * 一個題庫練習的題組檔（bank/groups/{uid}@{v}.json）會印進自組卷 PDF 的字串，分成三類（§7.6 的題本與解析，另加資料來源頁）：
 *   題本：文章、題幹、選項、圖說、圖表附註與資料表；
 *   解析：每題的 explanation_zh，以及混合題填充、簡答的答案與可接受答案（答案頁）；
 *   資料來源：出處說明、參考資料、圖表的資料來源（§7.5）。
 * 全文中譯（translation_zh）與閱讀圖表的文字描述不印，不算。
 * @param {unknown} file
 * @returns {PrintableStrings}
 */
export function practicePrintableStrings(file) {
  /** @type {string[]} */
  const booklet = [];
  /** @type {string[]} */
  const explanations = [];
  /** @type {string[]} */
  const sources = [];
  const f = isObj(file) ? file : {};
  const g = isObj(f.group) ? f.group : {};
  pushStrings(booklet, g.passage, g.options_bank);
  for (const p of list(g.passage_parts)) if (isObj(p)) pushStrings(booklet, p.label, p.title, p.text);
  for (const fig of list(g.figures)) figureStrings(fig, booklet);
  for (const q of list(g.questions)) {
    if (!isObj(q)) continue;
    pushStrings(booklet, q.stem, q.options);
    if (q.mode === 'fill_in_blank' || q.mode === 'short_answer') pushStrings(explanations, q.answer, q.accepted_answers);
  }
  sourceStrings(f.provenance, list(g.figures), sources);
  const a = isObj(f.annotations) ? f.annotations : {};
  const items = isObj(a.explanations) && isObj(a.explanations.items) ? a.explanations.items : {};
  for (const item of Object.values(items)) if (isObj(item)) pushStrings(explanations, item.explanation_zh);
  return { booklet, explanations, sources };
}

/**
 * 寫作題庫的一組（writing/bank/prompts 與 answers）會印進 PDF 的字串：
 *   題本：中譯英的中文題目；作文的題目與圖（圖說、文字描述、表格）；
 *   解析：中譯英的參考譯文與解析，作文的評分重點（四項的重點與級距說明、扣分說明、各段要點）、範文與解析。
 * @param {unknown} prompt @param {unknown} answers
 * @returns {PrintableStrings}
 */
export function writingPrintableStrings(prompt, answers) {
  /** @type {string[]} */
  const booklet = [];
  /** @type {string[]} */
  const explanations = [];
  const p = isObj(prompt) ? prompt : {};
  const a = isObj(answers) ? answers : {};
  if (p.section_type === 'translation') {
    for (const item of list(p.items)) if (isObj(item)) pushStrings(booklet, item.stem);
    for (const item of list(a.items)) if (isObj(item)) pushStrings(explanations, item.references, item.explanation_zh);
  } else {
    pushStrings(booklet, p.stem);
    for (const fig of list(p.figures)) if (isObj(fig)) pushStrings(booklet, fig.label, fig.caption, fig.description, fig.rows);
    for (const m of list(p.moves)) if (isObj(m)) pushStrings(explanations, m.zh);
    if (isObj(a.criteria)) {
      for (const c of Object.values(a.criteria)) {
        if (!isObj(c)) continue;
        pushStrings(explanations, c.focus_zh);
        for (const b of list(c.bands)) if (isObj(b)) pushStrings(explanations, b.descriptor_zh);
      }
    }
    pushStrings(explanations, a.deductions_zh);
    for (const t of list(a.model_texts)) if (isObj(t)) pushStrings(explanations, t.text);
    if (isObj(a.explanation)) pushStrings(explanations, a.explanation.explanation_zh);
  }
  // 本站仿真寫作題是原創（original-ai），沒有參考資料。
  return { booklet, explanations, sources: [] };
}

/**
 * 題庫會印進自組卷 PDF 的字串，逐組檢查 PDF 字型子集有沒有字形，題本、解析、資料來源分開找（§7.6）。
 * 建置時呼叫：題本缺字的題組由 bank-mock-pool.mjs 警告（WP3 補好子集之後改成排除在組卷池外）；
 * 解析缺字的題組 PDF 改印替代說明、資料來源缺字只列在建置紀錄。這裡不判斷要不要排除，也不讓建置失敗。
 * @param {{
 *   practice?: readonly { uid: string, version: number }[],
 *   writing?: readonly { prompt: { uid: string, version: number }, answers: unknown }[],
 * }} groups  practice：題庫練習的題組檔；writing：寫作題庫同一組的 prompts 與 answers 檔
 * @param {{ fontsDir?: string }} [options]
 * @returns {{ missing: Map<string, MissingGlyphs>, stats: { groups: number, booklet: number, explanations: number, sources: number } }}
 *   missing 的鍵是 uid@v，只列有缺字的題組；stats.booklet、explanations、sources 是各類缺的不同字數
 */
export function bankPrintableCoverage(groups, options = {}) {
  const { metrics, cmaps } = loadFonts(options.fontsDir);
  const regular = cmaps['NotoSerifTC-Regular'];
  const tinos = cmaps['Tinos-Regular'];
  const emoji = cmaps['NotoEmoji-Regular'];
  if (!regular || !tinos || !emoji) throw new Error('metrics.json 缺少 NotoSerifTC-Regular／Tinos-Regular／NotoEmoji-Regular');
  /** @param {number} cp */
  const fontFor = (cp) => (inRanges(cp, metrics.latinRanges) ? tinos : inRanges(cp, metrics.emojiRanges) ? emoji : regular);
  /** @param {readonly string[]} strings */
  const missingIn = (strings) => {
    /** @type {Set<number>} */
    const out = new Set();
    for (const s of strings) {
      for (const ch of s) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        if (cp < 0x20 || cp === 0x7f) continue;
        if (!fontFor(cp).has(cp)) out.add(cp);
      }
    }
    return [...out].sort((x, y) => x - y).map((cp) => String.fromCodePoint(cp));
  };
  /** @type {Map<string, MissingGlyphs>} */
  const missing = new Map();
  /** @type {Record<keyof MissingGlyphs, Set<string>>} */
  const all = { booklet: new Set(), explanations: new Set(), sources: new Set() };
  let count = 0;
  /** @param {string} key @param {PrintableStrings} strings */
  const check = (key, strings) => {
    count += 1;
    const found = { booklet: missingIn(strings.booklet), explanations: missingIn(strings.explanations), sources: missingIn(strings.sources) };
    for (const k of /** @type {const} */ (['booklet', 'explanations', 'sources'])) for (const ch of found[k]) all[k].add(ch);
    if (found.booklet.length + found.explanations.length + found.sources.length > 0) missing.set(key, found);
  };
  for (const g of groups.practice ?? []) check(`${g.uid}@${g.version}`, practicePrintableStrings(g));
  for (const w of groups.writing ?? []) check(`${w.prompt.uid}@${w.prompt.version}`, writingPrintableStrings(w.prompt, w.answers));
  return { missing, stats: { groups: count, booklet: all.booklet.size, explanations: all.explanations.size, sources: all.sources.size } };
}

// ---------------------------------------------------------------------------
// 直接執行：檢查 public/data/exams/（build:data 的輸出）
// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(WEB_DIR, 'public', 'data', 'exams');
  if (!existsSync(dir)) {
    console.error('[check-fonts] 找不到 public/data/exams/，請先執行 npm run build:data -w @gsat/web');
    process.exit(1);
  }
  const exams = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'score-scales.json')
    .map((f) => ({ id: f.replace(/\.json$/, ''), exam: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) }));
  const result = checkFontCoverage(exams);
  for (const w of result.warnings) console.warn(`[check-fonts] 注意：${w}`);
  if (result.errors.length > 0) {
    for (const e of result.errors) console.error(`[check-fonts] 錯誤：${e}`);
    console.error('[check-fonts] 修法：照 apps/web/src/features/pdf/fonts/README.md 重跑 subset_fonts.py。');
    process.exit(1);
  }
  console.log(`[check-fonts] 通過：${result.stats.exams} 份考卷、${result.stats.chars} 種字元都有字形`);
}
