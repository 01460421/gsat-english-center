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
 * 本站自組卷（docs/design/bank-mock.md §10.3）：每種難度一份（public/data 的組卷池＋固定種子，或 --bank-ids 指定代號），
 * 各產生學生卷、教師卷、學生卷雙面版、題本＋答案＋解析雙面版，檢查：
 *   - pdfinfo 的 Title、Subject 與 pdftotext 的全文都沒有官方考試機構的名稱或網址，也沒有殘留的 [[；每一頁頁尾有卷號與 AI 聲明；
 *   - 有卷號；題本每一題的題號、選文與選項的結尾都取得到；每一張閱讀圖表的附註都在；不出現圖表或表格描述裡帶資料的片段
 *     （「依序是」後面的數列，或描述排除前 10 個字後任意連續 12 個字）；
 *   - 資料來源頁列出所有 CC BY 參考資料（網址）；
 *   - 雙面版：答題卷、答案、解析各段的第一頁是單數頁，補的空白頁印「（本頁空白）」；教師卷第 1 頁不是題本；
 *   - 學生卷 14–24 頁；字型全部嵌入子集；印出解析改印替代說明的題數（題庫補字後應為 0）。
 *
 * 用法（在 repo 根目錄，先跑過 npm run build:data -w @gsat/web）：
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs              # 66 份全部＋三份自組卷
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids gsat-115,gsat-85 --png /tmp/gsat-png
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids bank   # 只跑自組卷（--ids 裡有 bank 才跑自組卷）
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids bank --bank-ids bk1-b-…,bk1-t-…
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
 * @typedef {{ PDF_TEXT: { sheetHeader: (exam: unknown) => string, keyHeader: (exam: unknown) => string, headerCenter: string, examShort: (exam: unknown) => readonly string[] }, SITE_PAPER_TEXT: Record<string, any> }} StringsModule
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
    bankIds: get('--bank-ids')?.split(',').filter(Boolean) ?? null,
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

  const runBank = !opts.ids || opts.ids.includes('bank');
  const ids = (opts.ids?.filter((id) => id !== 'bank') ?? readdirSync(EXAMS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'score-scales.json').map((f) => f.replace(/\.json$/, ''))).sort();
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
  let bankCount = 0;
  if (runBank) {
    const bank = await checkBankPapers({ opts, config, pdfmake, strings, poppler, failures, rows });
    bankCount = bank.papers;
    totalMs += bank.ms;
  }
  console.log(rows.join('\n'));
  console.log(`[pdf-check] ${ids.length} 份考卷、${bankCount} 份自組卷、${rows.length} 個 PDF，排版共 ${(totalMs / 1000).toFixed(1)} 秒；輸出在 ${opts.out}`);
  if (failures.length > 0) {
    console.error(`[pdf-check] ${failures.length} 個問題：\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('[pdf-check] 全部通過');
}

// ---------------------------------------------------------------------------
// 本站自組卷（docs/design/bank-mock.md §10.3）
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(WEB_DIR, 'public', 'data');
const SITE_ORIGIN = 'https://gsat-english-center.vercel.app';
/** 自組卷 PDF 不能出現的字串（官方考試機構的簡稱、全名與英文縮寫；網域也含縮寫）。寫成 \u 跳脫，新的程式碼裡不寫這些字。 */
const BANNED = ['\u5927\u8003\u4e2d\u5fc3', '\u5927\u5b78\u5165\u5b78\u8003\u8a66\u4e2d\u5fc3', '\u0063\u0065\u0065\u0063'];
const TIERS = /** @type {const} */ (['basic', 'advanced', 'top']);

/** @param {string} rel */
function readData(rel) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, rel), 'utf8'));
}

/**
 * 一個位置的題組檔（同瀏覽器下載的檔案）：題庫練習的題組檔，或寫作題的題目檔＋答案檔。
 * @param {string} section @param {string} key
 */
function slotFile(section, key) {
  if (section === 'translation' || section === 'composition') {
    return { prompt: readData(`writing/bank/prompts/${key}.json`), answers: readData(`writing/bank/answers/${key}.json`) };
  }
  return readData(`bank/groups/${key}.json`);
}

/**
 * 描述裡帶資料的片段（§10.3）：「依序是」後面的數列，以及排除前 10 個字後任意連續 12 個字。比對前去掉空白。
 * 只取含中文的視窗：描述常引用表頭、類別的英文原文（「within sustainable levels」），那些本來就印在資料表裡；
 * 洩漏答案的是描述自己的中文敘述（「1900 年最低的是巴西」），資料表與附註都是英文，不會碰巧相同。
 * @param {string} description
 */
function descriptionFragments(description) {
  const d = description.replace(/\s+/gu, '');
  /** @type {Set<string>} */
  const out = new Set();
  for (const m of d.matchAll(/依序是([^。；]{6,40})/gu)) out.add(m[1] ?? '');
  const chars = [...d];
  for (let i = 10; i + 12 <= chars.length; i += 1) {
    const w = chars.slice(i, i + 12).join('');
    if (/\p{Script=Han}/u.test(w)) out.add(w);
  }
  return [...out].filter((f) => f.length >= 6).map((f) => f.toLowerCase());
}

/**
 * 三份自組卷（每種難度一份）的學生卷、教師卷與雙面版。
 * @param {{ opts: ReturnType<typeof parseArgs>, config: object, pdfmake: PdfMake, strings: StringsModule, poppler: boolean, failures: string[], rows: string[] }} ctx
 */
async function checkBankPapers(ctx) {
  const { opts, config, pdfmake, strings, poppler, failures, rows } = ctx;
  if (!existsSync(path.join(DATA_DIR, 'bank', 'mock-pool.json'))) {
    failures.push('自組卷：找不到 public/data/bank/mock-pool.json，請先執行 npm run build:data -w @gsat/web');
    return { papers: 0, ms: 0 };
  }
  /** @param {string} rel */
  const load = async (rel) => /** @type {any} */ ((await runnerImport(path.join(WEB_DIR, rel), /** @type {any} */ (config))).module);
  const layout = await load('src/features/pdf/layout/buildDocDefinition.ts');
  const assemble = await load('src/features/mock/bank/assemble.ts');
  const code = await load('src/features/mock/bank/code.ts');
  const build = await load('src/features/mock/bank/buildExam.ts');
  const blueprint = await load('src/features/mock/bank/blueprint.ts');
  const pool = await load('src/features/mock/bank/pool.ts');
  const random = await load('src/features/mock/bank/random.ts');
  const pdfText = await load('src/features/mock/bank/pdfText.ts');
  const pdfIndex = await load('src/features/pdf/index.ts');
  const T = strings.SITE_PAPER_TEXT;
  const mockPool = readData('bank/mock-pool.json');

  /** 代號 → 每個位置的題組與可交換設定（組卷池裡的版本要和代號相同）。 @param {string} paperId */
  const slotsOfId = (paperId) => {
    const decoded = code.decodePaperId(paperId);
    if (!decoded) throw new Error(`代號格式不對：${paperId}`);
    return {
      tier: decoded.tier,
      slots: decoded.slots.map((/** @type {{ uid: string, v: number }} */ s, /** @type {number} */ i) => {
        const section = blueprint.BLUEPRINT_SLOTS[i].section;
        const entry = pool.findPoolEntry(mockPool, decoded.tier, section, s.uid);
        if (!entry || entry.v !== s.v) throw new Error(`${s.uid}@${s.v} 不是組卷池目前的版本`);
        return { uid: s.uid, v: s.v, sw: entry.sw ?? [] };
      }),
    };
  };

  /** @type {{ tier: string, slots: { uid: string, v: number, sw: [number, number][] }[] }[]} */
  const picks = [];
  if (opts.bankIds) {
    for (const id of opts.bankIds) {
      try {
        picks.push(slotsOfId(id));
      } catch (err) {
        failures.push(`自組卷 ${id}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    // 固定種子：同一份組卷池永遠組出同一份卷子（題庫改版後代號會跟著變，所以不寫死代號）。
    for (const tier of TIERS) {
      const selection = assemble.assembleSelection(mockPool.tiers[tier], random.fnv1a(`pdf-render-check:${tier}`), new Map());
      if (!selection.ok) failures.push(`自組卷 ${tier}：${selection.section} 的題組不夠組一份`);
      else picks.push({ tier, slots: selection.slots });
    }
  }

  let ms = 0;
  for (const pick of picks) {
    const sources = pick.slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: s.sw }));
    const files = Object.fromEntries(sources.map((s, i) => [s.key, slotFile(blueprint.BLUEPRINT_SLOTS[i].section, s.key)]));
    const paperId = code.encodePaperId(pick.tier, pick.slots);
    const paper = build.buildBankPaper({ paperId, tier: pick.tier, dataVersion: mockPool.version, slots: sources, files });
    const meta = pdfText.bankMockPdfMeta(paper, { strict: false });
    const site = meta.sitePaper;
    const label = `${paper.code}（${site.tierLabel}）`;
    console.log(`[pdf-check] 自組卷 ${label}：${paperId}`);
    const onlineUrl = `${SITE_ORIGIN}/mock/${paperId}.p`;
    const readingFigures = paper.exam.sections.filter((/** @type {{ type: string }} */ s) => s.type === 'reading').flatMap((/** @type {any} */ s) => s.groups.flatMap((/** @type {any} */ g) => g.figures));
    const notes = readingFigures.map((/** @type {any} */ f) => f.chart?.note).filter((/** @type {unknown} */ n) => typeof n === 'string' && n.trim() !== '');
    const fragments = readingFigures.flatMap((/** @type {any} */ f) => (f.chart || (f.rows && f.rows.length > 0) ? descriptionFragments(f.description ?? '') : []));
    const ccRefs = paper.groups.flatMap((/** @type {any} */ g) => g.references).filter((/** @type {any} */ r) => /^CC-BY/i.test(r.license ?? ''));

    /** @type {[string, string, boolean][]} 輸出名稱、版本、雙面 */
    const variants = [
      ['student', 'student', false],
      ['teacher', 'teacher', false],
      ['student-duplex', 'student', true],
      ['full-duplex', 'full', true],
    ];
    for (const [variant, version, duplex] of variants) {
      const fail = (/** @type {string} */ msg) => failures.push(`自組卷 ${label}（${variant}）：${msg}`);
      const options = { ...pdfIndex.sitePdfOptions(version, duplex), mockMeta: meta, onlineUrl };
      const file = path.join(opts.out, `bank-${pick.tier}-${variant}.pdf`);
      const t0 = performance.now();
      /** @type {Buffer} */
      let buf;
      try {
        buf = await pdfmake.createPdf(layout.buildExamDocDefinition(paper.exam, options)).getBuffer();
      } catch (err) {
        fail(`產生失敗：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        continue;
      }
      const elapsed = Math.round(performance.now() - t0);
      ms += elapsed;
      writeFileSync(file, buf);
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' || buf.length < 20_000) fail(`檔案不像 PDF（${buf.length} bytes）`);
      const pageCount = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
      const row = `bank ${pick.tier.padEnd(8)} ${variant.padEnd(14)} ${String(pageCount).padStart(3)} 頁 ${String(Math.round(buf.length / 1024)).padStart(4)} KB ${String(elapsed).padStart(5)} ms`;
      if (!poppler) {
        rows.push(row);
        continue;
      }
      // 文件屬性
      const info = execFileSync('pdfinfo', ['-enc', 'UTF-8', file], { encoding: 'utf8' });
      const title = /^Title:\s*(.*)$/m.exec(info)?.[1] ?? '';
      const subject = /^Subject:\s*(.*)$/m.exec(info)?.[1] ?? '';
      for (const banned of BANNED) if (`${title}${subject}`.toLowerCase().includes(banned)) fail(`文件屬性有「${banned}」：${title}｜${subject}`);
      if (!title.includes(paper.code)) fail(`文件標題沒有卷號：${title}`);

      const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const pages = text.split('\f').slice(0, pageCount);
      const all = norm(text);
      for (const banned of BANNED) if (all.includes(banned)) fail(`內文有「${banned}」`);
      if (text.includes('[[')) fail('有殘留的 [[');
      if (!all.includes(norm(paper.code))) fail('沒有卷號');
      const footer = [norm(T.footerSource(paper.code)), norm(T.footerNotice)];
      const blankMark = norm(T.blankPage);
      const headers = {
        sheet: norm(T.sheetHeader(site.tierLabel)),
        key: norm(T.keyHeader(site.tierLabel)),
        explanations: norm(T.explanationsHeader(site.tierLabel)),
        sources: norm(T.sourcesHeader(site.tierLabel)),
        booklet: norm(T.headerCenter),
      };
      /** @typedef {'cover' | 'booklet' | 'sources' | 'sheet' | 'key' | 'explanations' | 'blank'} Seg */
      /** @type {Record<Seg, number[]>} 每一節的頁碼（1 起算；空白頁另列） */
      const segments = { cover: [], booklet: [], sources: [], sheet: [], key: [], explanations: [], blank: [] };
      pages.forEach((p, i) => {
        const t = norm(p);
        if (!footer.every((f) => t.includes(f))) fail(`第 ${i + 1} 頁的頁尾沒有卷號或 AI 聲明`);
        const seg = /** @type {Seg} */ (t.includes(blankMark) ? 'blank' : (Object.entries(headers).find(([, h]) => t.includes(h))?.[0] ?? 'cover'));
        segments[seg].push(i + 1);
        if (seg === 'blank') {
          let rest = t.replace(blankMark, '');
          for (const f of [...footer, ...Object.values(headers), norm(PDF_SUBJECT)]) rest = rest.split(f).join('');
          if (rest.replace(/[｜|]/gu, '').length > 0) fail(`第 ${i + 1} 頁是補的空白頁，卻有其他內容`);
        }
      });
      const opt = options;
      if (opt.includeBooklet) {
        if (segments.cover.length !== 1 || segments.cover[0] !== 1) fail(`封面不是只有第 1 頁（${segments.cover.join('、')}）`);
        if (!norm(pages[0] ?? '').includes(norm(T.coverBand))) fail('封面沒有本站自組卷的橫條');
        if (segments.sources.length < 1) fail('題本後面沒有資料來源頁');
        // 題本內容沒有遺漏（同歷屆卷的檢查）
        const tokens = new Set(text.match(/\d+[A-Z]?/g) ?? []);
        for (const { what, probe } of contentProbes(paper.exam)) {
          if (probe.startsWith('#')) {
            if (!tokens.has(probe.slice(1))) fail(`取不到${what}`);
          } else if (!all.includes(probe)) fail(`取不到${what}`);
        }
        for (const note of notes) if (!all.includes(norm(note))) fail(`取不到圖表附註「${note.slice(0, 40)}」`);
        for (const frag of fragments) if (all.includes(norm(frag))) fail(`印出了圖表描述的資料片段「${frag}」`);
      } else {
        if (!norm(pages[0] ?? '').includes(norm(T.teacherTitle))) fail('教師卷第 1 頁沒有「教師卷：答案與解析」');
        if (segments.booklet.length > 0 || segments.cover.length > 0) fail(`教師卷有題本或封面（第 ${[...segments.cover, ...segments.booklet].join('、')} 頁）`);
      }
      for (const ref of ccRefs) if (!all.includes(norm(ref.url))) fail(`資料來源頁沒有 CC BY 參考資料：${ref.url}`);
      if (opt.includeAnswerSheet && segments.sheet.length < 2) fail(`答題卷頁數 ${segments.sheet.length}`);
      if (opt.includeAnswerKey && segments.key.length < 1) fail('沒有答案頁');
      if (opt.includeExplanations && segments.explanations.length < 1) fail('沒有解析頁');
      if (!opt.includeAnswerKey && (segments.key.length > 0 || segments.explanations.length > 0)) fail('學生卷有答案或解析');
      if (duplex) {
        for (const seg of /** @type {const} */ (['sheet', 'key', 'explanations'])) {
          const first = segments[seg][0];
          if (first !== undefined && first % 2 === 0) fail(`雙面列印：${seg} 從第 ${first} 頁（雙數頁）開始`);
        }
      } else if (segments.blank.length > 0) fail(`沒有勾雙面列印卻有空白頁（第 ${segments.blank.join('、')} 頁）`);
      if (version === 'student' && (pageCount < 14 || pageCount > 24 + segments.blank.length)) fail(`學生卷 ${pageCount} 頁，不在 14–24 頁`);
      const replaced = (all.match(new RegExp(norm(T.explanationMissing).replace(/[()（）]/g, '.'), 'g')) ?? []).length;
      const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' }).split('\n').slice(2).filter((l) => l.trim() !== '');
      for (const line of fonts) {
        const cols = line.trim().split(/\s+/);
        const [emb, sub] = cols.slice(-5, -3);
        if (emb !== 'yes' || sub !== 'yes') fail(`字型沒有嵌入子集：${line.trim()}`);
      }
      const parts = /** @type {const} */ (['booklet', 'sources', 'sheet', 'key', 'explanations', 'blank'])
        .filter((k) => segments[k].length > 0)
        .map((k) => `${{ booklet: '題本', sources: '資料來源', sheet: '答題卷', key: '答案', explanations: '解析', blank: '空白' }[k]} ${segments[k].length}`);
      rows.push(`${row}（${parts.join('、')}${opt.includeExplanations ? `；解析改印說明 ${replaced} 題` : ''}）`);
      if (opts.png && (!opts.pngIds || opts.pngIds.includes('bank'))) {
        execFileSync('pdftoppm', ['-r', '60', '-png', file, path.join(opts.png, `bank-${pick.tier}-${variant}`)]);
      }
    }
  }
  return { papers: picks.length, ms };
}

/** 頁首右側的「英文考科」（空白頁檢查時當成頁首文字去掉）。 */
const PDF_SUBJECT = '英文考科';

await main();
