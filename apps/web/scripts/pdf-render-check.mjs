#!/usr/bin/env node
// @ts-check
/**
 * 考試格式 PDF 的整份產生檢查（設計文件 docs/design/mock-exam-pdf.md §9.1 P1–P4）：
 * 用和瀏覽器相同的版面程式（src/features/pdf/layout/，經 Vite 的 module runner 直接載入 TypeScript）、
 * 相同的 pdfmake 版本與子集字型，在 Node 產生每一份考卷的 PDF，再用 poppler 的 pdftotext／pdffonts 檢查：
 *
 *   1. 產生不拋錯、檔案以 %PDF- 開頭；題本／答題卷／答案的頁數在合理範圍（現制 111–115 學測、ref-115：題本 10–14 頁）；
 *   2. 每一頁都有出處與「非官方」聲明，封面有官方試題 PDF 網址，沒有大考中心的機構名稱標題；
 *   3. 每一題的題號、每段選文與每個選項的結尾都取得到（防止不跨頁區塊太高時 pdfmake 把超出一頁的內容丟掉）；
 *      中譯英題目（中文）取得到；
 *   4. 不含任何中譯英官方參考譯文（和 data/exams/parsed/ 的原始譯文比對：整句，以及任何連續 8 個單字）；
 *   5. 字型全部嵌入子集（pdffonts）。
 *
 * 用法（在 repo 根目錄，先跑過 npm run build:data -w @gsat/web）：
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs              # 66 份全部
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids gsat-115,gsat-85 --png /tmp/gsat-png
 * 需要 poppler-utils（pdftotext、pdffonts；--png 另需 pdftoppm）。沒有安裝時只做第 1 項並提示。
 * 不在 CI 的 npm test 裡跑（要讀 data/、要 poppler，66 份約 40 秒）；版面有改動時手動跑，結果寫在 PR。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { runnerImport } from 'vite';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(WEB_DIR, '..', '..');
const EXAMS_DIR = path.join(WEB_DIR, 'public', 'data', 'exams');
const PARSED_DIR = path.join(REPO_DIR, 'data', 'exams', 'parsed');
const FONTS_DIR = path.join(WEB_DIR, 'src', 'features', 'pdf', 'fonts');

/** 現制（有混合題、題本 10–14 頁）的卷別：設計文件 §9.1 P1。 */
const CURRENT_SYSTEM = /^(gsat-11[1-5]|ref-115)$/;
/** 模擬考的卷別（features/mock/papers.ts）：另外產生一份模擬考版封面。 */
const MOCK_PAPERS = new Set(['gsat-115', 'gsat-114', 'gsat-113', 'gsat-112', 'ref-115', 'gsat-111']);

/**
 * @typedef {{ includeAnswerSheet: boolean, includeAnswerKey: boolean, onlineUrl?: string, mockMeta?: { title: string, paperLabel: string, durationMinutes: number, strict?: boolean, notices?: string[] } }} LayoutOptions
 * @typedef {{ buildExamDocDefinition: (exam: unknown, options: LayoutOptions) => unknown }} LayoutModule
 * @typedef {{ sourceLine: (exam: unknown) => string, NON_OFFICIAL_NOTICE: string, officialPaperUrl: (exam: unknown) => string | null }} AttributionModule
 * @typedef {{ PDF_TEXT: { sheetHeader: (exam: unknown) => string, keyHeader: (exam: unknown) => string, headerCenter: string, examShort: (exam: unknown) => readonly string[] } }} StringsModule
 * @typedef {{ createPdf: (doc: unknown) => { getBuffer: () => Promise<Buffer> }, virtualfs: { writeFileSync: (name: string, data: Buffer) => void }, setFonts: (fonts: unknown) => void, setUrlAccessPolicy: (fn: () => boolean) => void, setLocalAccessPolicy: (fn: () => boolean) => void }} PdfMake
 * @typedef {{ label: string, no: number, mode: string, stem: string | null, options: Record<string, string> | null }} Q
 * @typedef {{ passage: string | null, passage_parts: { text: string }[] | null, options_bank: Record<string, string> | null, questions: Q[] }} G
 * @typedef {{ id: string, exam: string, year: number, title: string, sections: { type: string, groups: G[] }[] }} ExamJson
 */

function parseArgs() {
  const args = process.argv.slice(2);
  /** @param {string} name */
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    out: get('--out') ?? path.join(process.env['TMPDIR'] ?? '/tmp', 'gsat-pdfs'),
    ids: get('--ids')?.split(',').filter(Boolean) ?? null,
    png: get('--png') ?? null,
    pngIds: get('--png-ids')?.split(',').filter(Boolean) ?? null,
  };
}

/** @param {string} cmd */
function hasTool(cmd) {
  try {
    execFileSync(cmd, ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 比對用：去掉所有空白（pdftotext 會在任意位置換行），全部小寫。 @param {string} s */
const norm = (s) => s.replace(/\s+/gu, '').toLowerCase();

/** 試題文字 → 印出來的純文字：去掉 <u>／<b>，空格記號換成題號。 @param {string} s */
const plain = (s) => s.replace(/<\/?[ub]>/g, '').replace(/\[\[([0-9]+[A-Z]?)\]\]/g, '$1');

/**
 * 一段文字的結尾（最後 n 個字元，至少 12 個非空白字元才檢查）。只取最後一個空格記號之後的文字：
 * 空格印的是題目的題號，不一定等於記號（gsat-87 的選文寫 [[56]]，題本印 66）。
 * @param {string} s @param {number} n
 */
function tail(s, n = 24) {
  const after = s.split(/\[\[[0-9]+[A-Z]?\]\]/).at(-1) ?? '';
  const t = norm(plain(after));
  return t.length >= 12 ? t.slice(-n) : null;
}

/**
 * 原始資料裡的中譯英官方譯文（answer、accepted_answers、answer_variants、answer_segments 組成的整句）。
 * @param {string} id
 * @returns {string[]}
 */
function officialTranslations(id) {
  const file = path.join(PARSED_DIR, `${id}.json`);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  /** @type {string[]} */
  const out = [];
  for (const s of raw.sections ?? []) {
    for (const g of s.groups ?? []) {
      for (const q of g.questions ?? []) {
        if (q.mode !== 'translation') continue;
        for (const v of [q.answer, q.accepted_answers, q.answer_variants].flat()) if (typeof v === 'string' && v.trim().length >= 20) out.push(v.trim());
      }
    }
  }
  return out;
}

/** 連續 8 個單字的片段（小寫、只留字母數字）。 @param {string} s */
function shingles(s, n = 8) {
  const words = s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i + n <= words.length; i += 1) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/** @param {ExamJson} exam */
function contentProbes(exam) {
  /** @type {{ what: string, probe: string }[]} */
  const probes = [];
  for (const s of exam.sections) {
    for (const g of s.groups) {
      for (const text of [g.passage ?? '', ...(g.passage_parts ?? []).map((p) => p.text)]) {
        for (const para of text.split('\n')) {
          const t = tail(para);
          if (t) probes.push({ what: `選文「…${para.slice(-30)}」`, probe: t });
        }
      }
      for (const opt of Object.values(g.options_bank ?? {})) {
        const t = tail(opt, 16);
        if (t) probes.push({ what: `選項庫「${opt.slice(0, 30)}」`, probe: t });
      }
      for (const q of g.questions) {
        if (/^\d+[A-Z]?$/.test(q.label)) probes.push({ what: `第 ${q.label} 題的題號`, probe: `#${q.label}` });
        if (q.mode === 'translation' && q.stem) probes.push({ what: `中譯英題目「${q.stem.slice(0, 20)}」`, probe: norm(plain(q.stem)).slice(0, 12) });
        // 綜合測驗的題目就是選文裡的空格，題本不重印題幹（只列「16. (A) … (B) …」）。
        const inPassage = [g.passage ?? '', ...(g.passage_parts ?? []).map((p) => p.text)].some((t) => t.includes(`[[${q.label}]]`) || t.includes(`[[${q.no}]]`));
        const stemTail = q.stem && !inPassage ? tail(q.stem.split('\n').at(-1) ?? '') : null;
        if (stemTail) probes.push({ what: `第 ${q.label} 題題幹`, probe: stemTail });
        for (const opt of Object.values(q.options ?? {})) {
          const t = tail(opt, 16);
          if (t) probes.push({ what: `第 ${q.label} 題選項「${opt.slice(0, 30)}」`, probe: t });
        }
      }
    }
  }
  return probes;
}

/**
 * 每一頁屬於哪一節：第 1 頁封面；頁尾有「第 n 頁／共 m 頁」的是答題卷或答案（看頁首）；其他是題本。
 * @param {string[]} pages
 * @param {string} sheetHeader
 */
function segmentCounts(pages, sheetHeader) {
  const counts = { cover: 0, booklet: 0, sheet: 0, key: 0 };
  pages.forEach((text, i) => {
    if (i === 0) counts.cover += 1;
    else if (/第\s*\d+\s*頁／共\s*\d+\s*頁/u.test(text)) {
      if (norm(text).includes(norm(sheetHeader))) counts.sheet += 1;
      else counts.key += 1;
    } else counts.booklet += 1;
  });
  return counts;
}

async function main() {
  const opts = parseArgs();
  if (!existsSync(EXAMS_DIR)) {
    console.error('[pdf-check] 找不到 public/data/exams/，請先執行 npm run build:data -w @gsat/web');
    process.exit(1);
  }
  const poppler = hasTool('pdftotext') && hasTool('pdffonts');
  if (!poppler) console.warn('[pdf-check] 沒有 pdftotext／pdffonts（poppler-utils），只檢查能不能產生 PDF。');
  mkdirSync(opts.out, { recursive: true });
  if (opts.png) mkdirSync(opts.png, { recursive: true });

  const config = { configFile: /** @type {false} */ (false), root: WEB_DIR, logLevel: /** @type {'error'} */ ('error') };
  const layout = /** @type {LayoutModule} */ ((await runnerImport(path.join(WEB_DIR, 'src/features/pdf/layout/buildDocDefinition.ts'), config)).module);
  const attribution = /** @type {AttributionModule} */ ((await runnerImport(path.join(WEB_DIR, 'src/features/pdf/layout/attribution.ts'), config)).module);
  const strings = /** @type {StringsModule} */ ((await runnerImport(path.join(WEB_DIR, 'src/features/pdf/layout/strings.ts'), config)).module);

  const require = createRequire(import.meta.url);
  const pdfmake = /** @type {PdfMake} */ (require('pdfmake'));
  for (const f of readdirSync(FONTS_DIR).filter((n) => n.endsWith('.subset.ttf.gz'))) {
    pdfmake.virtualfs.writeFileSync(f.replace('.subset.ttf.gz', '.ttf'), gunzipSync(readFileSync(path.join(FONTS_DIR, f))));
  }
  // 與 src/features/pdf/fonts.ts 的 PDFMAKE_FONTS 相同。
  pdfmake.setFonts({
    Tinos: { normal: 'Tinos-Regular.ttf', bold: 'Tinos-Bold.ttf', italics: 'Tinos-Italic.ttf', bolditalics: 'Tinos-Bold.ttf' },
    NotoSerifTC: { normal: 'NotoSerifTC-Regular.ttf', bold: 'NotoSerifTC-Bold.ttf', italics: 'NotoSerifTC-Regular.ttf', bolditalics: 'NotoSerifTC-Bold.ttf' },
    NotoEmoji: { normal: 'NotoEmoji-Regular.ttf', bold: 'NotoEmoji-Regular.ttf', italics: 'NotoEmoji-Regular.ttf', bolditalics: 'NotoEmoji-Regular.ttf' },
  });
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);

  const ids = (opts.ids ?? readdirSync(EXAMS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'score-scales.json').map((f) => f.replace(/\.json$/, ''))).sort();
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const rows = [];
  let totalMs = 0;
  for (const id of ids) {
    const exam = /** @type {ExamJson} */ (JSON.parse(readFileSync(path.join(EXAMS_DIR, `${id}.json`), 'utf8')));
    /** @type {[string, LayoutOptions][]} */
    const variants = [['full', { includeAnswerSheet: true, includeAnswerKey: true, onlineUrl: `https://gsat-english-center.vercel.app/exams/${id}` }]];
    if (MOCK_PAPERS.has(id)) {
      variants.push([
        'mock',
        {
          includeAnswerSheet: true,
          includeAnswerKey: false,
          onlineUrl: `https://gsat-english-center.vercel.app/mock/${id}`,
          mockMeta: { title: '學測英文中心模擬考', paperLabel: id, durationMinutes: 100, strict: true, notices: ['本卷有部分題目沿用歷屆試題。'] },
        },
      ]);
    }
    for (const [variant, options] of variants) {
      const fail = (/** @type {string} */ msg) => failures.push(`${id}（${variant}）：${msg}`);
      const file = path.join(opts.out, `${id}-${variant}.pdf`);
      const t0 = performance.now();
      /** @type {Buffer} */
      let buf;
      try {
        buf = await pdfmake.createPdf(layout.buildExamDocDefinition(exam, options)).getBuffer();
      } catch (err) {
        fail(`產生失敗：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        continue;
      }
      const ms = Math.round(performance.now() - t0);
      totalMs += ms;
      writeFileSync(file, buf);
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' || buf.length < 20_000) fail(`檔案不像 PDF（${buf.length} bytes）`);
      const pageCount = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
      if (!poppler) {
        rows.push(`${id.padEnd(15)} ${variant.padEnd(5)} ${String(pageCount).padStart(3)} 頁 ${String(Math.round(buf.length / 1024)).padStart(4)} KB ${String(ms).padStart(5)} ms`);
        continue;
      }

      const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const pages = text.split('\f').slice(0, pageCount);
      // 內文：每頁去掉頁首頁尾再接起來（跨頁的段落才比對得到）。
      const chrome = [
        attribution.sourceLine(exam),
        attribution.NON_OFFICIAL_NOTICE,
        '｜',
        strings.PDF_TEXT.headerCenter,
        strings.PDF_TEXT.sheetHeader(exam),
        strings.PDF_TEXT.keyHeader(exam),
        ...strings.PDF_TEXT.examShort(exam),
      ].map(norm);
      const body = pages.map((p) => {
        let t = norm(p).replace(/第\d+頁／共\d+頁|第\d+頁|共\d+頁|-\d+-/gu, '');
        for (const c of chrome) t = t.split(c).join('');
        return t;
      });
      body.forEach((t, i) => {
        if (t.length < 4) fail(`第 ${i + 1} 頁是空白頁`);
      });
      const all = body.join('');
      // 2. 出處與非官方聲明
      const source = norm(attribution.sourceLine(exam));
      const notice = norm(attribution.NON_OFFICIAL_NOTICE);
      pages.forEach((p, i) => {
        if (!norm(p).includes(source) || !norm(p).includes(notice)) fail(`第 ${i + 1} 頁沒有出處或非官方聲明`);
      });
      const paperUrl = attribution.officialPaperUrl(exam);
      if (paperUrl && !norm(pages[0] ?? '').includes('ceec.edu.tw')) fail('封面沒有官方試題 PDF 網址');
      if (all.includes(norm('財團法人大學入學考試中心基金會'))) fail('出現大考中心機構名稱標題');
      // 1. 頁數
      const counts = segmentCounts(pages, strings.PDF_TEXT.sheetHeader(exam));
      const [bMin, bMax] = CURRENT_SYSTEM.test(id) ? [10, 14] : [5, 16];
      if (counts.cover !== 1 || counts.booklet < bMin || counts.booklet > bMax) fail(`題本頁數 ${counts.booklet} 不在 ${bMin}–${bMax}`);
      if (options.includeAnswerSheet && (counts.sheet < 2 || counts.sheet > 5)) fail(`答題卷頁數 ${counts.sheet} 不在 2–5`);
      if (options.includeAnswerKey && (counts.key < 1 || counts.key > 2)) fail(`答案頁數 ${counts.key} 不在 1–2`);
      // 3. 內容沒有遺漏
      const tokens = new Set(text.match(/\d+[A-Z]?/g) ?? []);
      for (const { what, probe } of contentProbes(exam)) {
        if (probe.startsWith('#')) {
          if (!tokens.has(probe.slice(1))) fail(`取不到${what}`);
        } else if (!all.includes(probe)) fail(`取不到${what}`);
      }
      // 4. 官方譯文
      for (const official of officialTranslations(id)) {
        if (all.includes(norm(official))) fail(`含有官方中譯英參考譯文：「${official.slice(0, 40)}…」`);
        const plainText = ` ${text.toLowerCase().replace(/[^a-z0-9']+/g, ' ')} `;
        const hit = shingles(official).find((sh) => plainText.includes(` ${sh} `));
        if (hit) fail(`含有官方中譯英參考譯文的片段：「${hit}」`);
      }
      // 5. 字型
      const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' }).split('\n').slice(2).filter((l) => l.trim() !== '');
      for (const line of fonts) {
        const cols = line.trim().split(/\s+/);
        const [emb, sub] = cols.slice(-5, -3);
        if (emb !== 'yes' || sub !== 'yes') fail(`字型沒有嵌入子集：${line.trim()}`);
      }
      rows.push(
        `${id.padEnd(15)} ${variant.padEnd(5)} ${String(pageCount).padStart(3)} 頁（題本 ${String(counts.booklet).padStart(2)}、答題卷 ${counts.sheet}、答案 ${counts.key}）${String(Math.round(buf.length / 1024)).padStart(4)} KB ${String(ms).padStart(5)} ms ${fonts.length} 字型`,
      );
      if (opts.png && (!opts.pngIds || opts.pngIds.includes(id))) {
        execFileSync('pdftoppm', ['-r', '80', '-png', file, path.join(opts.png, `${id}-${variant}`)]);
      }
    }
  }
  console.log(rows.join('\n'));
  console.log(`[pdf-check] ${ids.length} 份考卷、${rows.length} 個 PDF，排版共 ${(totalMs / 1000).toFixed(1)} 秒；輸出在 ${opts.out}`);
  if (failures.length > 0) {
    console.error(`[pdf-check] ${failures.length} 個問題：\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('[pdf-check] 全部通過');
}

await main();
