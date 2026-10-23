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
 * 結果交給 lib/bank-mock-pool.mjs：題本缺字的題組不能用來組新卷（ex: 'glyph'，建置警告），解析與資料來源缺字只警告，
 * 都不讓建置失敗（題庫每天加題，不能因為一個罕用字擋住整站部署）。
 * 自組卷 PDF 的粗體字串（layout/strings.ts 的 SITE_PAPER_BOLD）與藍圖的大題標題不在粗體子集裡是**錯誤**（§7.6）。
 * `node apps/web/scripts/font-coverage.mjs --print-bank-chars` 印出題庫會印進 PDF 的所有字元（JSON），給 subset_fonts.py 收進子集。
 *
 * 單字講義 PDF（docs/design/vocab-handout.md §7.2）另外用 vocabPrintableCoverage() 檢查單字資料會印的字串：
 *   - 「條目」（字頭、其他寫法、音標、會印的釋義行、衍生字、變化形、同詞族、詞彙表內的同義與反義詞）缺字是**錯誤**（建置失敗，同歷屆試題）；
 *   - 「例句」（英文、中文、兩個作者名）缺字只是**警告**：列出 Tatoeba 編號，講義不採用那一句（features/vocab/handout/printable.ts）。
 *   - 講義的固定文字（layout/vocab/strings.ts）缺字是錯誤；粗體字串（VOCAB_PDF_BOLD）不在粗體子集裡也是錯誤。
 * `--print-vocab-chars` 印出單字資料會印的所有字元（JSON），給 subset_fonts.py 收進子集。
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
 * 本站自組卷（bank-mock §7.6）另外有：藍圖的大題標題與說明、pdfText.ts 的卷名與 AI 聲明、AI 出題標示（practice/labels.ts）、
 * 圖表類型與授權寫法（practice/chart.ts）、難度名稱（@gsat/shared 的 tiers.ts）與作文評分項目名稱（@gsat/shared 的 writing.ts）。
 * 路徑相對於 src/features/pdf/；subset_fonts.py 的 PDF_DYNAMIC_FILES 要一起改。
 */
export const PDF_DYNAMIC_FILES = [
  // 單字講義（docs/design/vocab-handout.md §7.2）：出處常數與變化形名稱、詞性短標籤、標題與範圍名稱、單字庫篩選的選項名稱、
  // 答案頁的形式名稱與條目缺字的替代說明。
  '../../data/vocab.ts',
  '../vocab/lib/text.ts',
  '../vocab/lib/search.ts',
  '../vocab/handout/labels.ts',
  '../vocab/handout/cloze.ts',
  '../vocab/handout/assemble.ts',
  '../mock/papers.ts',
  '../mock/bank/blueprint.ts',
  '../mock/bank/pdfText.ts',
  '../practice/labels.ts',
  '../practice/chart.ts',
  '../../../../../packages/shared/src/tiers.ts',
  '../../../../../packages/shared/src/writing.ts',
];

/**
 * 自組卷 PDF 用粗體印的字串：strings.ts 的 SITE_PAPER_BOLD（只讀那個常數裡的字串常值），
 * 以及藍圖的大題標題與部分名稱（題本、答案頁、解析頁的標題用粗體）。粗體子集沒有其中的字是錯誤。
 * @param {string} [stringsSource] @param {string} [blueprintSource]
 */
export function sitePaperBoldText(stringsSource, blueprintSource) {
  const strings = stringsSource ?? readIfExists(path.join(PDF_SRC_DIR, 'layout', 'strings.ts'));
  const blueprint = blueprintSource ?? readIfExists(path.join(PDF_SRC_DIR, '..', 'mock', 'bank', 'blueprint.ts'));
  const block = /export const SITE_PAPER_BOLD = \{([\s\S]*?)\} as const;/.exec(stripComments(strings))?.[1] ?? '';
  const titles = [...stripComments(blueprint).matchAll(/\b(?:title|part):\s*'([^'\n]*)'/g)].map((m) => m[1] ?? '');
  return [stringLiterals(block), ...titles].join('\n');
}

/**
 * strings.ts 的 GLYPH_SUBSTITUTES 的鍵（寫成 \\uXXXX 跳脫）：自組卷 PDF 的解析、答案頁（答案、參考譯文、評分重點）、範文與
 * 資料來源頁都會先把這些字換成別的寫法（layout/explanations.ts 的 printableSiteText、sources.ts），所以這些字缺字形不算缺字
 * （題本不替換，照樣算）。
 * @param {string} [stringsSource]
 * @returns {Set<number>}
 */
export function glyphSubstituteCodePoints(stringsSource) {
  const source = stringsSource ?? readIfExists(path.join(PDF_SRC_DIR, 'layout', 'strings.ts'));
  const block = /export const GLYPH_SUBSTITUTES[^=]*= \{([\s\S]*?)\};/.exec(source)?.[1] ?? '';
  return new Set([...block.matchAll(/'\\u([0-9a-fA-F]{4})'\s*:/g)].map((m) => Number.parseInt(m[1] ?? '0', 16)));
}

/** @param {string} file */
function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

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
 * @param {{ fontsDir?: string, pdfSource?: string, pdfDynamicSource?: string, sitePaperBold?: string }} [options]
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
  // 自組卷的粗體字串：缺粗體字形是錯誤（不只是警告，bank-mock §7.6）。
  const siteBoldMissing = new Set();
  for (const ch of options.sitePaperBold ?? sitePaperBoldText()) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x2e80 || inRanges(cp, metrics.emojiRanges) || /\s/.test(ch)) continue;
    if (!bold.has(cp)) siteBoldMissing.add(cp);
  }
  if (siteBoldMissing.size > 0) {
    errors.push(`自組卷 PDF 的粗體字串（strings.ts 的 SITE_PAPER_BOLD、藍圖的大題標題）有 ${siteBoldMissing.size} 個字不在粗體子集裡：${show(siteBoldMissing)}`);
  }
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
 *   解析：每題的 explanation_zh，以及混合題填充、簡答的答案、可接受答案與部分給分的寫法（答案頁）；
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
  for (const item of Object.values(items)) if (isObj(item)) pushStrings(explanations, item.explanation_zh, item.partial_credit_forms);
  return { booklet, explanations, sources };
}

/**
 * 寫作題庫的一組（writing/bank/prompts 與 answers）會印進 PDF 的字串：
 *   題本：中譯英的中文題目；作文的題目與圖（圖說、文字描述、表格）；
 *   解析（含答案頁）：中譯英的參考譯文與解析，作文的評分重點（四項的重點與級距說明、扣分說明、各段要點）、範文與解析。
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
 * 建置時呼叫：題本缺字的題組由 bank-mock-pool.mjs 排除在組卷池外（ex: glyph，建置警告）；
 * 解析與答案頁缺字的題組 PDF 改印替代說明（那一題、那一項或整篇範文）、資料來源缺字只列在建置紀錄。這裡不判斷要不要排除，
 * 也不讓建置失敗。
 * @param {{
 *   practice?: readonly { uid: string, version: number }[],
 *   writing?: readonly { prompt: { uid: string, version: number }, answers: unknown }[],
 * }} groups  practice：題庫練習的題組檔；writing：寫作題庫同一組的 prompts 與 answers 檔
 * @param {{ fontsDir?: string, substitutes?: ReadonlySet<number> }} [options]  substitutes：PDF 印解析與資料來源前會換掉的字（預設讀 strings.ts）
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
  const substituted = options.substitutes ?? glyphSubstituteCodePoints();
  /** @param {readonly string[]} strings @param {boolean} [withSubstitutes] 解析、答案頁與資料來源：PDF 會先換掉 GLYPH_SUBSTITUTES 的字 */
  const missingIn = (strings, withSubstitutes = false) => {
    /** @type {Set<number>} */
    const out = new Set();
    for (const s of strings) {
      for (const ch of s) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        if (cp < 0x20 || cp === 0x7f) continue;
        if (withSubstitutes && substituted.has(cp)) continue;
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
    const found = { booklet: missingIn(strings.booklet), explanations: missingIn(strings.explanations, true), sources: missingIn(strings.sources, true) };
    for (const k of /** @type {const} */ (['booklet', 'explanations', 'sources'])) for (const ch of found[k]) all[k].add(ch);
    if (found.booklet.length + found.explanations.length + found.sources.length > 0) missing.set(key, found);
  };
  for (const g of groups.practice ?? []) check(`${g.uid}@${g.version}`, practicePrintableStrings(g));
  for (const w of groups.writing ?? []) check(`${w.prompt.uid}@${w.prompt.version}`, writingPrintableStrings(w.prompt, w.answers));
  return { missing, stats: { groups: count, booklet: all.booklet.size, explanations: all.explanations.size, sources: all.sources.size } };
}

// ---------------------------------------------------------------------------
// 單字講義（docs/design/vocab-handout.md §7）
// ---------------------------------------------------------------------------

/** 講義 PDF 的固定文字檔（相對於 src/features/pdf/）：中文缺字是錯誤；粗體只看 VOCAB_PDF_BOLD（其他字不用粗體印）。 */
export const VOCAB_PDF_TEXT_FILES = ['layout/vocab/strings.ts'];

/**
 * 講義 PDF 用粗體印的字串：layout/vocab/strings.ts 的 VOCAB_PDF_BOLD（只讀那個常數裡的字串常值）。粗體子集沒有其中的字是錯誤。
 * @param {string} [stringsSource]
 */
export function vocabPdfBoldText(stringsSource) {
  const source = stringsSource ?? readIfExists(path.join(PDF_SRC_DIR, 'layout', 'vocab', 'strings.ts'));
  const block = /export const VOCAB_PDF_BOLD = \{([\s\S]*?)\} as const;/.exec(stripComments(source))?.[1] ?? '';
  return stringLiterals(block);
}

/**
 * @typedef {{ entry: string[], examples: { id: number, strings: string[] }[] }} VocabPrintable
 */

/**
 * 一筆單字條目（public/data/vocab/L*.json 的一筆）會印在講義上的字串，分兩類（§7.2）：
 *   條目：字頭、其他寫法、音標、會印的釋義行（不印專業領域的行）、衍生字（variant_info 的寫法、音標、釋義）、變化形、
 *         同詞族的字、詞彙表內的同義與反義詞；
 *   例句：英文、中文、英文與中文的作者名（依例句的 Tatoeba 編號分開，缺字時講義不採用那一句）。
 * 不印 en_def、CEFR、Cambridge 連結、詞彙表外的同義詞。
 * @param {unknown} raw
 * @returns {VocabPrintable}
 */
export function vocabPrintableStrings(raw) {
  const e = isObj(raw) ? raw : {};
  /** @type {string[]} */
  const entry = [];
  pushStrings(entry, e.word, e.variants, e.ipa);
  for (const z of list(e.zh)) if (isObj(z) && !z.domain) pushStrings(entry, z.text);
  for (const v of list(e.variant_info)) if (isObj(v)) pushStrings(entry, v.form, v.ipa, v.zh);
  if (isObj(e.forms)) pushStrings(entry, Object.values(e.forms));
  for (const f of list(e.family)) if (isObj(f)) pushStrings(entry, f.word);
  for (const r of [...list(e.synonyms), ...list(e.antonyms)]) if (isObj(r) && r.in_list === true) pushStrings(entry, r.word);
  /** @type {{ id: number, strings: string[] }[]} */
  const examples = [];
  for (const x of list(e.examples)) {
    if (!isObj(x)) continue;
    /** @type {string[]} */
    const strings = [];
    pushStrings(strings, x.en, x.zh, x.author, x.zh_author);
    examples.push({ id: typeof x.tatoeba_id === 'number' ? x.tatoeba_id : 0, strings });
  }
  return { entry, examples };
}

/** 講義正規化時會刪掉或換成空白的字（handout/printable.ts 的 printableText）：不算缺字。 */
const VOCAB_NORMALIZED = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x2009, 0x202f]);

/**
 * 單字資料會印在講義上的字串有沒有字形：條目缺字是錯誤，例句缺字是警告（§7.2）。
 * @param {readonly { entries: unknown[] }[]} levelFiles  public/data/vocab/L1–L6.json（或 build-data 產生的同樣內容）
 * @param {{ fontsDir?: string }} [options]
 * @returns {{ errors: string[], warnings: string[], stats: { entries: number, examples: number, badExamples: number[] } }}
 */
export function vocabPrintableCoverage(levelFiles, options = {}) {
  const { metrics, cmaps } = loadFonts(options.fontsDir);
  const regular = cmaps['NotoSerifTC-Regular'];
  const tinos = cmaps['Tinos-Regular'];
  const emoji = cmaps['NotoEmoji-Regular'];
  if (!regular || !tinos || !emoji) throw new Error('metrics.json 缺少 NotoSerifTC-Regular／Tinos-Regular／NotoEmoji-Regular');
  /** @param {number} cp */
  const fontFor = (cp) => (inRanges(cp, metrics.latinRanges) ? tinos : inRanges(cp, metrics.emojiRanges) ? emoji : regular);
  /** @param {readonly string[]} strings @returns {number[]} */
  const missingIn = (strings) => {
    /** @type {Set<number>} */
    const out = new Set();
    for (const s of strings) {
      for (const ch of s) {
        const cp = /** @type {number} */ (ch.codePointAt(0));
        if (cp < 0x20 || cp === 0x7f || VOCAB_NORMALIZED.has(cp)) continue;
        if (!fontFor(cp).has(cp)) out.add(cp);
      }
    }
    return [...out];
  };
  /** @type {Map<number, Set<string>>} */
  const entryMissing = new Map();
  /** @type {Map<number, Set<number>>} */
  const exampleMissing = new Map();
  let entries = 0;
  let examples = 0;
  /** @type {Set<number>} */
  const bad = new Set();
  for (const file of levelFiles) {
    for (const raw of file.entries) {
      entries += 1;
      const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : '?';
      const printable = vocabPrintableStrings(raw);
      for (const cp of missingIn(printable.entry)) (entryMissing.get(cp) ?? entryMissing.set(cp, new Set()).get(cp))?.add(id);
      for (const ex of printable.examples) {
        examples += 1;
        const gone = missingIn(ex.strings);
        if (gone.length > 0) bad.add(ex.id);
        for (const cp of gone) (exampleMissing.get(cp) ?? exampleMissing.set(cp, new Set()).get(cp))?.add(ex.id);
      }
    }
  }
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  if (entryMissing.size > 0) {
    const where = [...entryMissing].map(([cp, ids]) => `  ${show(new Set([cp]))}：${[...ids].slice(0, 5).join('、')}${ids.size > 5 ? ' 等' : ''}`);
    errors.push(`單字條目有 ${entryMissing.size} 個字元不在 PDF 字型子集裡（講義會印出方框）：\n${where.join('\n')}`);
  }
  if (exampleMissing.size > 0) {
    warnings.push(`單字例句有 ${bad.size} 句含 PDF 字型沒有的字（講義不採用這些句子）：${show(new Set(exampleMissing.keys()))}；Tatoeba #${[...bad].sort((a, b) => a - b).join('、#')}`);
  }
  // 講義的固定文字與粗體字串。
  const bold = cmaps['NotoSerifTC-Bold'];
  const textMissing = new Set();
  for (const ch of VOCAB_PDF_TEXT_FILES.map((rel) => stripComments(readIfExists(path.join(PDF_SRC_DIR, rel)))).join('\n')) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x2e80 || inRanges(cp, metrics.emojiRanges)) continue;
    if (!regular.has(cp)) textMissing.add(cp);
  }
  if (textMissing.size > 0) errors.push(`講義 PDF 固定文字（${VOCAB_PDF_TEXT_FILES.join('、')}）有 ${textMissing.size} 個字不在中文子集裡：${show(textMissing)}`);
  const boldMissing = new Set();
  for (const ch of vocabPdfBoldText()) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 0x2e80 || inRanges(cp, metrics.emojiRanges) || /\s/.test(ch)) continue;
    if (!bold?.has(cp)) boldMissing.add(cp);
  }
  if (boldMissing.size > 0) errors.push(`講義 PDF 的粗體字串（layout/vocab/strings.ts 的 VOCAB_PDF_BOLD）有 ${boldMissing.size} 個字不在粗體子集裡：${show(boldMissing)}`);
  return { errors, warnings, stats: { entries, examples, badExamples: [...bad].sort((a, b) => a - b) } };
}

/**
 * 單字資料會印在講義上的所有字元（同 vocabPrintableCoverage 的範圍）。subset_fonts.py 呼叫 `--print-vocab-chars` 收進子集：
 * 中文收進 Noto Serif TC，國際音標與其他 Tinos 有字形的字收進 Tinos。
 * @param {string} [dataDir]
 * @returns {{ entries: string, examples: string, count: number }}
 */
export function vocabPrintableChars(dataDir = path.join(WEB_DIR, 'public', 'data', 'vocab')) {
  /** @type {Set<string>} */
  const entries = new Set();
  /** @type {Set<string>} */
  const examples = new Set();
  let count = 0;
  for (const file of readVocabLevels(dataDir)) {
    for (const raw of file.entries) {
      count += 1;
      const p = vocabPrintableStrings(raw);
      // 講義正規化時會刪掉或換成空白的字（零寬空白、細空白）不必收進子集。
      const keep = (/** @type {string} */ ch) => !VOCAB_NORMALIZED.has(/** @type {number} */ (ch.codePointAt(0)));
      for (const s of p.entry) for (const ch of s) if (keep(ch)) entries.add(ch);
      for (const ex of p.examples) for (const s of ex.strings) for (const ch of s) if (keep(ch)) examples.add(ch);
    }
  }
  return { entries: [...entries].sort().join(''), examples: [...examples].sort().join(''), count };
}

/** public/data/vocab/L1–L6.json。 @param {string} dir @returns {{ entries: unknown[] }[]} */
export function readVocabLevels(dir = path.join(WEB_DIR, 'public', 'data', 'vocab')) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^L[1-6]\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

// ---------------------------------------------------------------------------
// 直接執行：檢查 public/data/exams/（build:data 的輸出）
// ---------------------------------------------------------------------------
/**
 * 題庫會印進 PDF 的所有字元（public/data 的題庫練習題組檔與寫作題庫的題目檔、答案檔；同 build-data 傳給 bankPrintableCoverage 的內容）。
 * subset_fonts.py 呼叫 `--print-bank-chars` 拿這份清單收進中文子集。
 * @param {string} [dataDir]
 * @returns {{ booklet: string, explanations: string, sources: string, groups: number }}
 */
export function bankPrintableChars(dataDir = path.join(WEB_DIR, 'public', 'data')) {
  /** @param {string} dir */
  const jsonFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))) : []);
  /** @type {Record<'booklet' | 'explanations' | 'sources', Set<string>>} */
  const sets = { booklet: new Set(), explanations: new Set(), sources: new Set() };
  /** @param {PrintableStrings} strings */
  const add = (strings) => {
    for (const k of /** @type {const} */ (['booklet', 'explanations', 'sources'])) for (const s of strings[k]) for (const ch of s) sets[k].add(ch);
  };
  const practice = jsonFiles(path.join(dataDir, 'bank', 'groups'));
  for (const g of practice) add(practicePrintableStrings(g));
  const answers = new Map(jsonFiles(path.join(dataDir, 'writing', 'bank', 'answers')).map((a) => [`${a.uid}@${a.version}`, a]));
  const prompts = jsonFiles(path.join(dataDir, 'writing', 'bank', 'prompts'));
  for (const p of prompts) add(writingPrintableStrings(p, answers.get(`${p.uid}@${p.version}`)));
  /** @param {Set<string>} set */
  const join = (set) => [...set].sort().join('');
  return { booklet: join(sets.booklet), explanations: join(sets.explanations), sources: join(sets.sources), groups: practice.length + prompts.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--print-vocab-chars')) {
  const chars = vocabPrintableChars();
  if (chars.count === 0) {
    console.error('[check-fonts] 找不到 public/data/vocab/L*.json，請先執行 npm run build:data -w @gsat/web');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(chars)}\n`);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--print-bank-chars')) {
  const chars = bankPrintableChars();
  if (chars.groups === 0) {
    console.error('[check-fonts] 找不到 public/data/bank/groups/，請先執行 npm run build:data -w @gsat/web');
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(chars)}\n`);
} else if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
  // 題庫（自組卷 PDF）：只報告，不讓檢查失敗（題本缺字的題組由建置排除在組卷池外，bank-mock §7.6）。
  const bankDir = path.join(WEB_DIR, 'public', 'data');
  /** @param {string} dir */
  const jsonFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))) : []);
  const practice = jsonFiles(path.join(bankDir, 'bank', 'groups'));
  const answers = new Map(jsonFiles(path.join(bankDir, 'writing', 'bank', 'answers')).map((a) => [`${a.uid}@${a.version}`, a]));
  const writing = jsonFiles(path.join(bankDir, 'writing', 'bank', 'prompts')).map((prompt) => ({ prompt, answers: answers.get(`${prompt.uid}@${prompt.version}`) }));
  if (practice.length + writing.length > 0) {
    const bank = bankPrintableCoverage({ practice, writing });
    for (const [key, m] of bank.missing) {
      const parts = [m.booklet.length > 0 ? `題本 ${m.booklet.join('')}` : null, m.explanations.length > 0 ? `解析 ${m.explanations.join('')}` : null, m.sources.length > 0 ? `資料來源 ${m.sources.join('')}` : null];
      console.warn(`[check-fonts] 注意：題庫 ${key} 缺字：${parts.filter(Boolean).join('；')}`);
    }
    const { stats } = bank;
    console.log(`[check-fonts] 題庫 ${stats.groups} 組：題本缺 ${stats.booklet} 字、解析缺 ${stats.explanations} 字、資料來源缺 ${stats.sources} 字`);
  }
  // 單字講義（vocab-handout §7.2）：條目缺字是錯誤，例句缺字只警告（講義不採用那一句）。
  const levels = readVocabLevels();
  if (levels.length > 0) {
    const vocab = vocabPrintableCoverage(levels);
    for (const w of vocab.warnings) console.warn(`[check-fonts] 注意：${w}`);
    if (vocab.errors.length > 0) {
      for (const e of vocab.errors) console.error(`[check-fonts] 錯誤：${e}`);
      console.error('[check-fonts] 修法：照 apps/web/src/features/pdf/fonts/README.md 重跑 subset_fonts.py。');
      process.exit(1);
    }
    console.log(`[check-fonts] 單字 ${vocab.stats.entries.toLocaleString('en')} 筆、例句 ${vocab.stats.examples.toLocaleString('en')} 句：條目沒有缺字，例句缺字 ${vocab.stats.badExamples.length} 句（不採用）`);
  }
}
