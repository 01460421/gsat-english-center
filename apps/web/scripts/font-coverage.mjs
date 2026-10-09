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
