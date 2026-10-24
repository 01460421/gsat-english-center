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
 *   圖表描述的資料片段只在封面與題本比對（資料來源頁的出處說明本來就會寫「圖表資料：Our World in Data（資料來源…）」）。
 *
 * 學習助手加強卷（bk2，docs/design/weak-paper.md §9.5、§12.1 W3）：四份代表性的卷子（題組依固定種子從組卷池挑），
 * 同樣產生學生卷、教師卷與兩種雙面版：
 *   - 弱點加強卷 40 分鐘（只有選擇題，答題卷只有答案卡；封面有「本卷針對」）；
 *   - 模考格式卷（超越頂標，整份 11 組、100 分鐘）；
 *   - 隨機抽題卷 12 組（代號最長、QR code 的上限；跨三種難度、有混合題與中譯英、沒有作文）；
 *   - 隨機抽題卷只有中譯英與作文（答題卷沒有答案卡）。
 * 檢查同自組卷（官方機構名稱、卷號、每一頁的頁尾、題本內容沒有遺漏、圖表、資料來源、雙面、字型），另外：
 *   - 封面是加強卷的卷名、卷別、橫條與這份卷子自己的作答時間（「考試時間：40分鐘」）；弱點加強卷有「本卷針對」；
 *   - 頁首頁尾、各節標題與文件屬性是加強卷的寫法，沒有「自組模擬考」；教師卷第 1 頁有卷別與作答時間；
 *   - 答題卷：有作文時至少 3 頁（作文兩頁格線另起），沒有作文時 1–2 頁；網址不超過 QR code 的上限（152 個字元）。
 *
 * 單字講義（docs/design/vocab-handout.md §9.2）：用講義頁同一套程式（handout/selection.ts、assemble.ts）組資料、
 * layout/vocab/ 排版，讀 public/data/vocab/。固定產生 L1 第 1 份 100 字的四種類型、L4 第 3 份的講義版雙面列印、
 * L6 全部（取前 600 字）的講義版、L5 全部 600 字的背誦版，另加兩種選項組合（L3 講義版兩欄、L3 句意填空卷附中文與字母數），
 * 以及最重的兩份：L1 前 600 字講義版開全部選項＋雙面（例句最多、頁數最多，時間的最壞情況）、L1 前 600 字測驗卷。檢查：
 *   - %PDF- 開頭；頁數在 handout/estimate.ts 估計的 ±25%（至少容許 1 頁）內；
 *   - 每一頁都有詞彙表出處與講義代號；全文與文件屬性除了那一句出處，沒有官方考試機構的名稱或英文縮寫；
 *   - 每個字頭、音標（和資料一致，沒有缺字）、每題題號與 Tatoeba 編號都取得到；
 *   - 句意填空每題那一段文字裡找不到答案字（整字、不分大小寫），答案頁找得到；
 *   - 答案從新的一頁開始，頁碼另起；雙面列印時練習、資料來源、答案都從單數頁開始，空白頁只印「（本頁空白）」；
 *   - pdftotext -bbox：沒有任何字超出版心的左右邊界（「黏在一起」的片段量錯寬度時會超出右邊界）；
 *   - pdffonts：全部嵌入子集；印出每份的組資料與排版時間、頁數。
 *
 * 用法（在 repo 根目錄，先跑過 npm run build:data -w @gsat/web）：
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs              # 66 份全部＋三份自組卷＋單字講義
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids gsat-115,gsat-85 --png /tmp/gsat-png
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids bank   # 只跑自組卷（--ids 裡有 bank 才跑自組卷）
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids bank --bank-ids bk1-b-…,bk1-t-…
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids vocab  # 只跑單字講義（--ids 裡有 vocab 才跑）
 *   node apps/web/scripts/pdf-render-check.mjs --out /tmp/gsat-pdfs --ids weak   # 只跑加強卷（--ids 裡有 weak 才跑）
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
  const runWeak = !opts.ids || opts.ids.includes('weak');
  const runVocab = !opts.ids || opts.ids.includes('vocab');
  const ids = (opts.ids?.filter((id) => id !== 'bank' && id !== 'weak' && id !== 'vocab') ?? readdirSync(EXAMS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'score-scales.json').map((f) => f.replace(/\.json$/, ''))).sort();
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
  let weakCount = 0;
  if (runWeak) {
    const weak = await checkWeakPapers({ opts, config, pdfmake, strings, poppler, failures, rows });
    weakCount = weak.papers;
    totalMs += weak.ms;
  }
  let vocabCount = 0;
  if (runVocab) {
    const vocab = await checkVocabHandouts({ opts, config, pdfmake, poppler, failures, rows });
    vocabCount = vocab.handouts;
    totalMs += vocab.ms;
  }
  console.log(rows.join('\n'));
  console.log(
    `[pdf-check] ${ids.length} 份考卷、${bankCount} 份自組卷、${weakCount} 份加強卷、${vocabCount} 份單字講義、${rows.length} 個 PDF，排版共 ${(totalMs / 1000).toFixed(1)} 秒；輸出在 ${opts.out}`,
  );
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
        // 只比對封面與題本：資料來源頁的出處說明本來就會寫圖表的資料來源（和描述的開頭常常相同）。
        const bookletText = norm([...segments.cover, ...segments.booklet].map((n) => pages[n - 1] ?? '').join('\n'));
        for (const frag of fragments) if (bookletText.includes(norm(frag))) fail(`印出了圖表描述的資料片段「${frag}」`);
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

// ---------------------------------------------------------------------------
// 學習助手加強卷（bk2，docs/design/weak-paper.md §9.5）
// ---------------------------------------------------------------------------

/**
 * @typedef {{ section: string, tier: 'basic' | 'advanced' | 'top', fig?: 'chart' | 'table' }} WeakSlotSpec
 * @typedef {{ name: string, kind: 'w' | 'f' | 'r' | 'm', slots: WeakSlotSpec[], targets?: { labels: string[], balanced: boolean } }} WeakCase
 */

/** 模考格式卷的 11 個位置（同藍圖）。 */
const FULL_SECTIONS = ['vocabulary', 'cloze', 'cloze', 'word_bank', 'structure', 'reading', 'reading', 'reading', 'mixed', 'translation', 'composition'];

/** @type {WeakCase[]} 四份代表性的加強卷（見檔頭）。 */
const WEAK_CASES = [
  {
    name: 'w-40',
    kind: 'w',
    slots: [
      { section: 'vocabulary', tier: 'advanced' },
      { section: 'structure', tier: 'advanced' },
      { section: 'structure', tier: 'advanced' },
      { section: 'reading', tier: 'advanced', fig: 'chart' },
      { section: 'reading', tier: 'basic' },
    ],
    // 封面「本卷針對」：名稱是組卷頁存下的標籤（這裡用固定的兩個）。
    targets: { labels: ['推論題（閱讀）', '代名詞指涉（篇章結構）'], balanced: false },
  },
  { name: 'f-top', kind: 'f', slots: FULL_SECTIONS.map((section) => ({ section, tier: /** @type {const} */ ('top') })) },
  {
    name: 'r-12',
    kind: 'r',
    slots: [
      { section: 'vocabulary', tier: 'basic' },
      { section: 'vocabulary', tier: 'advanced' },
      { section: 'cloze', tier: 'basic' },
      { section: 'cloze', tier: 'top' },
      { section: 'word_bank', tier: 'advanced' },
      { section: 'structure', tier: 'top' },
      { section: 'reading', tier: 'basic', fig: 'table' },
      { section: 'reading', tier: 'advanced' },
      { section: 'reading', tier: 'top', fig: 'chart' },
      { section: 'reading', tier: 'advanced' },
      { section: 'mixed', tier: 'advanced' },
      { section: 'translation', tier: 'basic' },
    ],
  },
  {
    name: 'r-writing',
    kind: 'r',
    slots: [
      { section: 'translation', tier: 'advanced' },
      { section: 'composition', tier: 'advanced' },
    ],
  },
];

/**
 * 四份加強卷的學生卷、教師卷與雙面版。
 * @param {{ opts: ReturnType<typeof parseArgs>, config: object, pdfmake: PdfMake, strings: StringsModule, poppler: boolean, failures: string[], rows: string[] }} ctx
 */
async function checkWeakPapers(ctx) {
  const { opts, config, pdfmake, strings, poppler, failures, rows } = ctx;
  if (!existsSync(path.join(DATA_DIR, 'bank', 'mock-pool.json'))) {
    failures.push('加強卷：找不到 public/data/bank/mock-pool.json，請先執行 npm run build:data -w @gsat/web');
    return { papers: 0, ms: 0 };
  }
  /** @param {string} rel */
  const load = async (rel) => /** @type {any} */ ((await runnerImport(path.join(WEB_DIR, rel), /** @type {any} */ (config))).module);
  const layoutDoc = await load('src/features/pdf/layout/buildDocDefinition.ts');
  const code2 = await load('src/features/mock/bank/code2.ts');
  const paperLayout = await load('src/features/mock/bank/layout.ts');
  const build = await load('src/features/mock/bank/buildExam.ts');
  const random = await load('src/features/mock/bank/random.ts');
  const pdfText = await load('src/features/mock/bank/pdfText.ts');
  const pdfIndex = await load('src/features/pdf/index.ts');
  const T = strings.SITE_PAPER_TEXT;
  const W = /** @type {Record<string, any>} */ (/** @type {any} */ (strings).WEAK_PAPER_TEXT);
  const P = /** @type {Record<string, any>} */ (/** @type {any} */ (strings).PDF_TEXT);
  const mockPool = readData('bank/mock-pool.json');

  let ms = 0;
  let papers = 0;
  for (const c of WEAK_CASES) {
    const label = `加強卷 ${c.name}`;
    // 題組：每個位置依固定種子排序組卷池（同大題、同難度、沒有排除原因、沒用過的第一組；指定圖的閱讀優先挑有那種圖的）。
    const used = new Set();
    /** @type {{ ns: 'ai', section: string, tier: string, uid: string, v: number, sw: [number, number][] }[]} */
    const picks = [];
    let missing = false;
    c.slots.forEach((spec, i) => {
      const entries = /** @type {any[]} */ (mockPool.tiers[spec.tier][spec.section]).filter((e) => e.ex == null && !used.has(e.uid));
      const ranked = entries
        .map((e) => ({ e, h: random.fnv1a(`pdf-render-check:${c.name}:${i}:${e.uid}`) }))
        .sort((a, b) => Number(spec.fig !== undefined && b.e.fig === spec.fig) - Number(spec.fig !== undefined && a.e.fig === spec.fig) || a.h - b.h);
      const entry = ranked[0]?.e;
      if (!entry) {
        failures.push(`${label}：組卷池沒有 ${spec.tier} 的 ${spec.section} 題組`);
        missing = true;
        return;
      }
      used.add(entry.uid);
      picks.push({ ns: 'ai', section: spec.section, tier: spec.tier, uid: entry.uid, v: entry.v, sw: entry.sw ?? [] });
    });
    if (missing) continue;
    const slots = picks.map(({ ns, section, tier, uid, v }) => ({ ns, section, tier, uid, v }));
    const paperId = code2.encodeBk2(c.kind, slots);
    const layout = paperLayout.layoutForBk2({ kind: c.kind, slots });
    const sources = picks.map((p) => ({ key: `${p.uid}@${p.v}`, swap: p.sw }));
    const files = Object.fromEntries(picks.map((p) => [`${p.uid}@${p.v}`, slotFile(p.section, `${p.uid}@${p.v}`)]));
    const paper = build.buildBankPaper({ paperId, tier: layout.tier, dataVersion: mockPool.version, slots: sources, files, layout });
    const meta = pdfText.bankMockPdfMeta(paper, { strict: false, ...(c.targets ? { targets: c.targets } : {}) });
    const site = meta.sitePaper;
    const kindLabel = W.kindLabel(c.kind, site.tierLabel);
    papers += 1;
    console.log(`[pdf-check] ${label} ${paper.code}（${kindLabel}、${site.tierLabel}、${layout.minutes} 分鐘、${slots.length} 組）：${paperId}`);
    const onlineUrl = `${SITE_ORIGIN}/mock/${paperId}.p`;
    if (onlineUrl.length > code2.QR_MAX_URL_CHARS) failures.push(`${label}：網址 ${onlineUrl.length} 個字元，超過 QR code 的上限 ${code2.QR_MAX_URL_CHARS}`);
    if (meta.durationMinutes !== layout.minutes) failures.push(`${label}：封面的作答時間 ${meta.durationMinutes} 不是版面的 ${layout.minutes} 分鐘`);
    const readingFigures = paper.exam.sections.filter((/** @type {{ type: string }} */ s) => s.type === 'reading').flatMap((/** @type {any} */ s) => s.groups.flatMap((/** @type {any} */ g) => g.figures));
    const notes = readingFigures.map((/** @type {any} */ f) => f.chart?.note).filter((/** @type {unknown} */ n) => typeof n === 'string' && n.trim() !== '');
    const fragments = readingFigures.flatMap((/** @type {any} */ f) => (f.chart || (f.rows && f.rows.length > 0) ? descriptionFragments(f.description ?? '') : []));
    const ccRefs = paper.groups.flatMap((/** @type {any} */ g) => g.references).filter((/** @type {any} */ r) => /^CC-BY/i.test(r.license ?? ''));
    const hasComposition = paper.exam.sections.some((/** @type {any} */ s) => s.groups.some((/** @type {any} */ g) => g.questions.some((/** @type {any} */ q) => q.mode === 'composition')));
    const targetsLine = c.targets ? (c.targets.balanced ? W.targetsBalanced : W.targets(c.targets.labels)) : null;

    /** @type {[string, string, boolean][]} 輸出名稱、版本、雙面 */
    const variants = [
      ['student', 'student', false],
      ['teacher', 'teacher', false],
      ['student-duplex', 'student', true],
      ['full-duplex', 'full', true],
    ];
    for (const [variant, version, duplex] of variants) {
      const fail = (/** @type {string} */ msg) => failures.push(`${label} ${paper.code}（${variant}）：${msg}`);
      const options = { ...pdfIndex.sitePdfOptions(version, duplex), mockMeta: meta, onlineUrl };
      const fileName = pdfIndex.pdfFileName(paper.exam, options);
      const expectedName = new RegExp(`^學測英文中心_加強卷_${c.kind.toUpperCase()}-[0-9A-Z]{5}_(學生卷|教師卷|含答案解析)\\.pdf$`, 'u');
      if (!expectedName.test(fileName)) fail(`檔名不對：${fileName}`);
      const file = path.join(opts.out, `weak-${c.name}-${variant}.pdf`);
      const t0 = performance.now();
      /** @type {Buffer} */
      let buf;
      try {
        buf = await pdfmake.createPdf(layoutDoc.buildExamDocDefinition(paper.exam, options)).getBuffer();
      } catch (err) {
        fail(`產生失敗：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        continue;
      }
      const elapsed = Math.round(performance.now() - t0);
      ms += elapsed;
      writeFileSync(file, buf);
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' || buf.length < 20_000) fail(`檔案不像 PDF（${buf.length} bytes）`);
      const pageCount = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
      const row = `weak ${c.name.padEnd(10)} ${variant.padEnd(14)} ${String(pageCount).padStart(3)} 頁 ${String(Math.round(buf.length / 1024)).padStart(4)} KB ${String(elapsed).padStart(5)} ms`;
      if (!poppler) {
        rows.push(row);
        continue;
      }
      // 文件屬性
      const info = execFileSync('pdfinfo', ['-enc', 'UTF-8', file], { encoding: 'utf8' });
      const title = /^Title:\s*(.*)$/m.exec(info)?.[1] ?? '';
      const subject = /^Subject:\s*(.*)$/m.exec(info)?.[1] ?? '';
      for (const banned of BANNED) if (`${title}${subject}`.toLowerCase().includes(banned)) fail(`文件屬性有「${banned}」：${title}｜${subject}`);
      if (title !== W.docTitle(kindLabel, paper.code, version === 'teacher')) fail(`文件標題不對：${title}`);
      if (subject !== W.docSubject(T.footerNotice)) fail(`文件主旨不對：${subject}`);

      const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const pages = text.split('\f').slice(0, pageCount);
      const all = norm(text);
      for (const banned of BANNED) if (all.includes(banned)) fail(`內文有「${banned}」`);
      if (all.includes(norm('自組模擬考'))) fail('有自組模擬考（bk1）的文字');
      if (text.includes('[[')) fail('有殘留的 [[');
      if (!all.includes(norm(paper.code))) fail('沒有卷號');
      const footer = [norm(W.footerSource(paper.code)), norm(T.footerNotice)];
      const blankMark = norm(T.blankPage);
      const headers = {
        sheet: norm(W.sheetHeader(kindLabel)),
        key: norm(W.keyHeader(kindLabel)),
        explanations: norm(W.explanationsHeader(kindLabel)),
        sources: norm(W.sourcesHeader(kindLabel)),
        booklet: norm(W.headerCenter),
      };
      /** @typedef {'cover' | 'booklet' | 'sources' | 'sheet' | 'key' | 'explanations' | 'blank'} WSeg */
      /** @type {Record<WSeg, number[]>} */
      const segments = { cover: [], booklet: [], sources: [], sheet: [], key: [], explanations: [], blank: [] };
      pages.forEach((p, i) => {
        const t = norm(p);
        if (!footer.every((f) => t.includes(f))) fail(`第 ${i + 1} 頁的頁尾沒有加強卷的卷號或 AI 聲明`);
        const seg = /** @type {WSeg} */ (t.includes(blankMark) ? 'blank' : (Object.entries(headers).find(([, h]) => t.includes(h))?.[0] ?? 'cover'));
        segments[seg].push(i + 1);
        if (seg === 'blank') {
          let rest = t.replace(blankMark, '');
          for (const f of [...footer, ...Object.values(headers), norm(PDF_SUBJECT)]) rest = rest.split(f).join('');
          if (rest.replace(/[｜|]/gu, '').length > 0) fail(`第 ${i + 1} 頁是補的空白頁，卻有其他內容`);
        }
      });
      if (options.includeBooklet) {
        const cover = norm(pages[0] ?? '');
        if (segments.cover.length !== 1 || segments.cover[0] !== 1) fail(`封面不是只有第 1 頁（${segments.cover.join('、')}）`);
        for (const [what, expected] of [
          ['卷名', meta.title],
          ['卷別', meta.paperLabel],
          ['卷別說明', W.coverFormat(c.kind)],
          ['橫條', W.coverBand(site.footerKind)],
          ['作答時間', P.timeLine(layout.minutes)],
          ...(targetsLine ? [['本卷針對', targetsLine]] : []),
        ]) {
          if (!cover.includes(norm(expected))) fail(`封面沒有${what}「${expected}」`);
        }
        if (!targetsLine && cover.includes(norm('本卷針對'))) fail('封面不該有「本卷針對」');
        if (segments.sources.length < 1) fail('題本後面沒有資料來源頁');
        const tokens = new Set(text.match(/\d+[A-Z]?/g) ?? []);
        // 內文：每頁去掉頁首頁尾再接起來（跨頁的段落才比對得到，同歷屆卷的檢查）。
        const chromeText = [...footer, '｜', headers.booklet, ...W.examShort(kindLabel).map(norm)];
        const body = pages
          .map((p) => {
            let t = norm(p).replace(/第\d+頁|共\d+頁|-\d+-/gu, '');
            for (const c of chromeText) t = t.split(c).join('');
            return t;
          })
          .join('');
        for (const { what, probe } of contentProbes(paper.exam)) {
          if (probe.startsWith('#')) {
            if (!tokens.has(probe.slice(1))) fail(`取不到${what}`);
          } else if (!body.includes(probe)) fail(`取不到${what}`);
        }
        for (const note of notes) if (!body.includes(norm(note))) fail(`取不到圖表附註「${note.slice(0, 40)}」`);
        const bookletText = norm([...segments.cover, ...segments.booklet].map((n) => pages[n - 1] ?? '').join('\n'));
        for (const frag of fragments) if (bookletText.includes(norm(frag))) fail(`印出了圖表描述的資料片段「${frag}」`);
      } else {
        const first = norm(pages[0] ?? '');
        if (!first.includes(norm(T.teacherTitle))) fail('教師卷第 1 頁沒有「教師卷：答案與解析」');
        if (!first.includes(norm(kindLabel)) || !first.includes(norm(W.minutes(layout.minutes)))) fail('教師卷第 1 頁沒有卷別或作答時間');
        if (segments.booklet.length > 0 || segments.cover.length > 0) fail(`教師卷有題本或封面（第 ${[...segments.cover, ...segments.booklet].join('、')} 頁）`);
      }
      for (const ref of ccRefs) if (!all.includes(norm(ref.url))) fail(`資料來源頁沒有 CC BY 參考資料：${ref.url}`);
      if (options.includeAnswerSheet) {
        const [min, max] = hasComposition ? [3, 5] : [1, 2];
        if (segments.sheet.length < min || segments.sheet.length > max) fail(`答題卷 ${segments.sheet.length} 頁，不在 ${min}–${max} 頁`);
        const firstSheet = norm(pages[(segments.sheet[0] ?? 1) - 1] ?? '');
        if (!firstSheet.includes(norm(T.codeLabel(paper.code)))) fail('答題卷第一頁沒有卷號');
      }
      if (options.includeAnswerKey && segments.key.length < 1) fail('沒有答案頁');
      if (options.includeExplanations && segments.explanations.length < 1) fail('沒有解析頁');
      if (!options.includeAnswerKey && (segments.key.length > 0 || segments.explanations.length > 0)) fail('學生卷有答案或解析');
      if (duplex) {
        for (const seg of /** @type {const} */ (['sheet', 'key', 'explanations'])) {
          const first = segments[seg][0];
          if (first !== undefined && first % 2 === 0) fail(`雙面列印：${seg} 從第 ${first} 頁（雙數頁）開始`);
        }
      } else if (segments.blank.length > 0) fail(`沒有勾雙面列印卻有空白頁（第 ${segments.blank.join('、')} 頁）`);
      if (version === 'student' && (pageCount < 4 || pageCount > 24 + segments.blank.length)) fail(`學生卷 ${pageCount} 頁，不在 4–24 頁`);
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
      rows.push(`${row}（${parts.join('、')}${options.includeExplanations ? `；解析改印說明 ${replaced} 題` : ''}）`);
      if (opts.png && (!opts.pngIds || opts.pngIds.includes('weak'))) {
        execFileSync('pdftoppm', ['-r', '60', '-png', file, path.join(opts.png, `weak-${c.name}-${variant}`)]);
      }
    }
  }
  return { papers, ms };
}

// ---------------------------------------------------------------------------
// 單字講義（docs/design/vocab-handout.md §9.2）
// ---------------------------------------------------------------------------

/**
 * @typedef {{ name: string, kind: 'notes' | 'recite' | 'cloze' | 'quiz', levels: number[], range: { by: 'all' } | { by: 'part', size: 50 | 100, part: number }, options?: Record<string, unknown> }} VocabCase
 */

/** @type {VocabCase[]} */
const VOCAB_CASES = [
  { name: 'L1-p1-notes', kind: 'notes', levels: [1], range: { by: 'part', size: 100, part: 1 } },
  { name: 'L1-p1-recite', kind: 'recite', levels: [1], range: { by: 'part', size: 100, part: 1 } },
  { name: 'L1-p1-cloze', kind: 'cloze', levels: [1], range: { by: 'part', size: 100, part: 1 } },
  { name: 'L1-p1-quiz', kind: 'quiz', levels: [1], range: { by: 'part', size: 100, part: 1 } },
  { name: 'L4-p3-notes-duplex', kind: 'notes', levels: [4], range: { by: 'part', size: 100, part: 3 }, options: { duplex: true } },
  { name: 'L6-all-notes', kind: 'notes', levels: [6], range: { by: 'all' } },
  { name: 'L5-all-recite', kind: 'recite', levels: [5], range: { by: 'all' } },
  // 選項組合：兩欄講義版（不附例句）；句意填空卷附中文翻譯、首字母＋字母數。
  { name: 'L3-p2-notes-2col', kind: 'notes', levels: [3], range: { by: 'part', size: 100, part: 2 }, options: { columns: 2 } },
  { name: 'L3-p2-cloze-zh', kind: 'cloze', levels: [3], range: { by: 'part', size: 100, part: 2 }, options: { clozeZh: true, letterCount: true } },
  // 最重的情況（時間與記憶體的最壞情況，設計文件實作備註）：L1 幾乎每個字都有例句，600 字講義版開全部選項＋雙面約 116 頁，
  // 比 L6 前 600 字（很多字沒有例句，85 頁）重得多。
  {
    name: 'L1-600-notes-full',
    kind: 'notes',
    levels: [1],
    range: { by: 'all' },
    options: { fullSenses: true, synonyms: true, clozeZh: true, letterCount: true, duplex: true },
  },
  { name: 'L1-600-quiz', kind: 'quiz', levels: [1], range: { by: 'all' } },
];

/** A4 寬度與講義版心的左右邊界（pt，layout/vocab/metrics.ts 的 VOCAB_MARGINS）；容許 0.5 pt 的量測誤差。 */
const VOCAB_PAGE_WIDTH = 595.28;
const VOCAB_SIDE_MARGIN = 50;

/** 正規表示式的特殊字元跳脫。 @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 講義的四種類型與上面幾種組合：產生、存檔、用 poppler 檢查。
 * @param {{ opts: ReturnType<typeof parseArgs>, config: object, pdfmake: PdfMake, poppler: boolean, failures: string[], rows: string[] }} ctx
 */
async function checkVocabHandouts(ctx) {
  const { opts, config, pdfmake, poppler, failures, rows } = ctx;
  const VOCAB_DIR = path.join(DATA_DIR, 'vocab');
  if (!existsSync(path.join(VOCAB_DIR, 'L6.json'))) {
    failures.push('單字講義：找不到 public/data/vocab/L6.json，請先執行 npm run build:data -w @gsat/web');
    return { handouts: 0, ms: 0 };
  }
  /** @param {string} rel */
  const load = async (rel) => /** @type {any} */ ((await runnerImport(path.join(WEB_DIR, rel), /** @type {any} */ (config))).module);
  const assemble = await load('src/features/vocab/handout/assemble.ts');
  const selection = await load('src/features/vocab/handout/selection.ts');
  const labels = await load('src/features/vocab/handout/labels.ts');
  const handoutOptions = await load('src/features/vocab/handout/options.ts');
  const estimate = await load('src/features/vocab/handout/estimate.ts');
  const layout = await load('src/features/pdf/layout/vocab/buildVocabHandoutDocDefinition.ts');
  const strings = await load('src/features/pdf/layout/vocab/strings.ts');
  const chrome = await load('src/features/pdf/layout/vocab/chrome.ts');
  const vocabData = await load('src/data/vocab.ts');
  const T = strings.VOCAB_PDF_TEXT;
  const B = strings.VOCAB_PDF_BOLD;
  const wordlist = norm(vocabData.VOCAB_CREDITS.wordlist);

  const index = readData('vocab/index.json');
  /** @type {Map<number, { entries: any[] }>} */
  const levels = new Map([1, 2, 3, 4, 5, 6].map((l) => [l, readData(`vocab/L${l}.json`)]));
  const byId = new Map([...levels.values()].flatMap((f) => f.entries.map((/** @type {any} */ e) => [e.id, e])));
  const selectionContext = { index: index.entries, mistakes: { schema: 'gsat-vocab-mistakes', version: 1, updated_at: 0, items: {} }, srs: { cards: {} }, now: Date.now() };

  let ms = 0;
  let count = 0;
  for (const c of VOCAB_CASES) {
    const fail = (/** @type {string} */ msg) => failures.push(`單字講義 ${c.name}：${msg}`);
    const source = { kind: 'levels', levels: c.levels, range: c.range };
    const picked = selection.selectHandoutEntries(source, selectionContext);
    const entries = picked.entries.map((/** @type {{ id: string }} */ e) => byId.get(e.id));
    const pool = picked.levels.flatMap((/** @type {number} */ l) => levels.get(l)?.entries ?? []);
    const options = { ...handoutOptions.DEFAULT_HANDOUT_OPTIONS, answerKey: true, ...c.options };
    const rangeTotal = selection.levelEntries(index.entries, c.levels).length;
    const title = labels.sourceTitle(source, entries.length, rangeTotal, picked.total);
    const t0 = performance.now();
    const { data } = assemble.assembleHandout({ kind: c.kind, entries, pool, options, title, dataVersion: index.version, reroll: 0, now: new Date(), lookup: (/** @type {string} */ id) => byId.get(id) });
    const t1 = performance.now();
    /** @type {Buffer} */
    let buf;
    try {
      buf = await pdfmake.createPdf(layout.buildVocabHandoutDocDefinition(data)).getBuffer();
    } catch (err) {
      fail(`產生失敗：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      continue;
    }
    const t2 = performance.now();
    const assembleMs = Math.round(t1 - t0);
    const layoutMs = Math.round(t2 - t1);
    ms += layoutMs;
    count += 1;
    const file = path.join(opts.out, `vocab-${c.name}.pdf`);
    writeFileSync(file, buf);
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-' || buf.length < 20_000) fail(`檔案不像 PDF（${buf.length} bytes）`);
    const pageCount = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    const est = estimate.estimatePages(data).total;
    if (Math.abs(pageCount - est) > Math.max(1, est * 0.25)) fail(`${pageCount} 頁，和估計的 ${est} 頁差超過 25%`);
    const row = `vocab ${c.name.padEnd(20)} ${String(pageCount).padStart(3)} 頁（估 ${String(est).padStart(3)}）${String(Math.round(buf.length / 1024)).padStart(5)} KB 組資料 ${String(assembleMs).padStart(4)} ms 排版 ${String(layoutMs).padStart(5)} ms｜${entries.length} 字、句意填空 ${data.cloze.length}、拼字 ${data.spelling.length}、英選中 ${data.choice.length}、代號 ${data.code}`;
    if (!poppler) {
      rows.push(row);
      continue;
    }

    // 文件屬性
    const info = execFileSync('pdfinfo', ['-enc', 'UTF-8', file], { encoding: 'utf8' });
    const docTitle = /^Title:\s*(.*)$/m.exec(info)?.[1] ?? '';
    const subject = /^Subject:\s*(.*)$/m.exec(info)?.[1] ?? '';
    for (const banned of BANNED) if (`${docTitle}${subject}`.toLowerCase().includes(banned)) fail(`文件屬性有「${banned}」：${docTitle}｜${subject}`);

    const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const pages = text.split('\f').slice(0, pageCount);
    const all = norm(text);
    // 2. 每頁的出處與講義代號；除了出處那一句沒有機構名稱。
    const code = norm(T.codeLabel(data.code));
    pages.forEach((p, i) => {
      const t = norm(p);
      if (!t.includes(wordlist) || !t.includes(code)) fail(`第 ${i + 1} 頁的頁尾沒有詞彙表出處或講義代號`);
    });
    const withoutCredit = all.split(wordlist).join('');
    for (const banned of BANNED) if (withoutCredit.includes(banned)) fail(`除了詞彙表出處，內文還有「${banned}」`);

    // 每一頁屬於哪一段：本體（標題區、條目、背誦表）、練習、資料來源、答案、空白頁。
    const blankMark = norm(T.blankPage);
    const keyHeader = norm(T.keyHeader(data.code));
    const exerciseMark = norm(T.clozeInstructions(data.options.hint.firstLetter, data.options.hint.letterCount)).slice(0, 16);
    const sourcesMark = norm(T.sourcesIntro);
    /** @type {('body' | 'exercise' | 'sources' | 'key' | 'blank')[]} */
    const seg = [];
    let current = /** @type {'body' | 'exercise' | 'sources' | 'key'} */ (c.kind === 'cloze' || c.kind === 'quiz' ? 'exercise' : 'body');
    pages.forEach((p) => {
      const t = norm(p);
      if (t.includes(blankMark)) {
        seg.push('blank');
        return;
      }
      if (t.includes(keyHeader)) current = 'key';
      else if (t.includes(sourcesMark)) current = 'sources';
      else if (current === 'body' && t.includes(exerciseMark)) current = 'exercise';
      seg.push(current);
    });
    const firstOf = (/** @type {string} */ s) => seg.indexOf(/** @type {any} */ (s)) + 1;
    for (const s of ['exercise', 'sources', 'key']) if (firstOf(s) === 0) fail(`找不到${{ exercise: '句意填空', sources: '資料來源頁', key: '答案' }[s]}`);
    // 使用方式的「句意填空起始頁：N」（講義版、背誦版不勾雙面列印時）：頁碼要等於練習實際的起始頁，不能留下 pdfmake 的佔位字。
    if ((c.kind === 'notes' || c.kind === 'recite') && !data.options.duplex && !norm(pages[0] ?? '').includes(norm(`${T.exercisePage}${firstOf('exercise')}`))) {
      fail(`第 1 頁的「${T.exercisePage}」不是 ${firstOf('exercise')}`);
    }
    if (/(^|[^\d#])00000($|\D)/m.test(text)) fail('有沒替換的頁碼佔位字 00000');
    // 5. 答案另起一頁、頁碼另起；雙面列印時段落開頭在單數頁。
    const keyPages = seg.filter((s) => s === 'key').length;
    const firstKey = firstOf('key');
    if (firstKey > 0) {
      const first = norm(pages[firstKey - 1] ?? '');
      if (!first.includes(norm(T.keyPageOf(1, keyPages)))) fail(`答案第 1 頁沒有「${T.keyPageOf(1, keyPages)}」`);
      if (!first.includes(norm(B.keyQuick))) fail('答案第 1 頁不是從速查表開始');
      if (seg.slice(firstKey - 1).some((s) => s !== 'key')) fail('答案後面還有其他內容');
    }
    if (data.options.duplex) {
      for (const s of c.kind === 'notes' || c.kind === 'recite' ? ['exercise', 'sources', 'key'] : ['sources', 'key']) {
        const first = firstOf(s);
        if (first > 0 && first % 2 === 0) fail(`雙面列印：${s} 從第 ${first} 頁（雙數頁）開始`);
      }
      seg.forEach((s, i) => {
        if (s !== 'blank') return;
        let rest = norm(pages[i] ?? '').replace(blankMark, '').split(wordlist).join('');
        for (const line of chrome.footerLines(data)) rest = rest.replace(norm(line), '');
        if (rest.length > 0) fail(`第 ${i + 1} 頁是補的空白頁，卻有其他內容：${rest.slice(0, 40)}`);
      });
    } else if (seg.includes('blank')) fail('沒有勾雙面列印卻有空白頁');

    // 3. 字頭、音標、題號、Tatoeba 編號。
    const pageText = (/** @type {string} */ which) => pages.filter((_, i) => seg[i] === which).join('\n');
    const bodyText = norm(pageText('body'));
    for (const g of data.groups) {
      for (const w of g.words) {
        if (!bodyText.includes(norm(w.word))) fail(`取不到字頭 ${w.word}`);
        if (c.kind === 'notes' && data.options.ipa && w.ipa && !bodyText.includes(norm(`/${w.ipa}/`))) fail(`取不到 ${w.word} 的音標 /${w.ipa}/`);
      }
    }
    // 練習的每一題：去掉頁首頁尾的行，依「題號.」切出每題的文字。
    const chromeLine = (/** @type {string} */ line) => {
      const t = norm(line);
      return t.includes(wordlist) || t.includes(code) || /第\d+頁／共\d+頁/u.test(t);
    };
    const exerciseLines = pageText('exercise')
      .split('\n')
      .filter((l) => !chromeLine(l));
    const keyText = pageText('key');
    /** @type {Map<number, string>} */
    const windows = new Map();
    for (const line of exerciseLines) {
      // 句意填空一欄，每題從行首的「題號.」開始，接著的行（換行的句子、中文翻譯）都屬於這一題；
      // 拼字兩欄一行有兩題，那一部分只需要題號。
      const lead = /^\s*(\d{1,3})\.\s/.exec(line);
      const key = lead ? Number(lead[1]) : null;
      if (key !== null && !windows.has(key)) windows.set(key, '');
      const last = key ?? [...windows.keys()].at(-1);
      if (last !== undefined) windows.set(last, `${windows.get(last) ?? ''} ${line}`);
    }
    const numbers = new Set(exerciseLines.join('\n').match(/\d{1,3}(?=\.\s)/g)?.map(Number) ?? []);
    const exerciseNorm = norm(exerciseLines.join('\n'));
    for (const item of data.cloze) {
      if (!numbers.has(item.no)) fail(`取不到句意填空第 ${item.no} 題的題號`);
      const id = /#(\d+)/.exec(item.enAttribution)?.[1] ?? '';
      if (!exerciseNorm.includes(`tatoeba#${id}`)) fail(`取不到第 ${item.no} 題的 Tatoeba #${id}`);
      // 4. 洩漏：那一題的文字（去掉 Tatoeba 標示）裡沒有答案字；答案頁有。
      const win = (windows.get(item.no) ?? '').replace(/(中文\s)?Tatoeba\s#\d+(\sby\s\S+)?/g, ' ');
      const re = new RegExp(`(^|[^A-Za-z'’-])${escapeRe(item.answer)}($|[^A-Za-z'’-])`, 'i');
      if (!win.trim()) fail(`切不出第 ${item.no} 題的文字`);
      else if (re.test(win)) fail(`第 ${item.no} 題的題目文字裡有答案 ${item.answer}：${win.replace(/\s+/g, ' ').slice(0, 120)}`);
      if (!re.test(keyText)) fail(`答案頁取不到第 ${item.no} 題的答案 ${item.answer}`);
    }
    for (const item of data.spelling) {
      if (!numbers.has(item.no)) fail(`取不到拼字第 ${item.no} 題的題號`);
      if (!new RegExp(`(^|[^A-Za-z])${escapeRe(item.answer)}($|[^A-Za-z])`, 'i').test(keyText)) fail(`答案頁取不到拼字第 ${item.no} 題的答案 ${item.answer}`);
    }
    for (const item of data.choice) {
      if (!numbers.has(item.no)) fail(`取不到英選中第 ${item.no} 題的題號`);
      if (!exerciseNorm.includes(norm(item.word))) fail(`取不到英選中第 ${item.no} 題的字 ${item.word}`);
    }
    // 6. 字型全部嵌入子集。
    const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' }).split('\n').slice(2).filter((l) => l.trim() !== '');
    for (const line of fonts) {
      const cols = line.trim().split(/\s+/);
      const [emb, sub] = cols.slice(-5, -3);
      if (emb !== 'yes' || sub !== 'yes') fail(`字型沒有嵌入子集：${line.trim()}`);
    }
    // 7. 沒有字超出版心的左右邊界（pdftotext -bbox 的每個字的 xMin、xMax）。
    const bbox = execFileSync('pdftotext', ['-bbox', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    let bboxPage = 0;
    /** @type {string[]} */
    const outside = [];
    for (const line of bbox.split('\n')) {
      if (line.includes('<page ')) bboxPage += 1;
      const m = /<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/.exec(line);
      if (!m) continue;
      const [xMin, xMax] = [Number(m[1]), Number(m[2])];
      if (xMax > VOCAB_PAGE_WIDTH - VOCAB_SIDE_MARGIN + 0.5 || xMin < VOCAB_SIDE_MARGIN - 0.5) outside.push(`第 ${bboxPage} 頁「${m[3]}」x=${xMin.toFixed(1)}–${xMax.toFixed(1)}`);
    }
    if (outside.length > 0) fail(`${outside.length} 個字超出版心左右邊界：${outside.slice(0, 5).join('；')}`);
    const parts = /** @type {const} */ (['body', 'exercise', 'sources', 'key', 'blank'])
      .filter((k) => seg.includes(k))
      .map((k) => `${{ body: c.kind === 'recite' ? '背誦表' : '條目', exercise: '練習', sources: '資料來源', key: '答案', blank: '空白' }[k]} ${seg.filter((s) => s === k).length}`);
    rows.push(`${row}（${parts.join('、')}；${fonts.length} 字型）`);
    if (opts.png && (!opts.pngIds || opts.pngIds.includes('vocab'))) {
      execFileSync('pdftoppm', ['-r', '60', '-png', file, path.join(opts.png, `vocab-${c.name}`)]);
    }
  }
  return { handouts: count, ms };
}

await main();
