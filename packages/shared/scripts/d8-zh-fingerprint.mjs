// @ts-check
/**
 * 國文 D8 指紋（docs/design/assistant-subjects.md §5.7）：國綜非選擇題參考答案與評分原則、國寫閱卷評分原則、參考試卷的
 * 評分原則與試題解析、舊制國文非選擇題評分標準、選才電子報的國綜與國寫評分說明，產生兩份「只有雜湊」的檔案：
 *
 *   data/d8/zh-official.fp.json  8 個連續漢字的窗口（國文集合；英文的 d8-fingerprints.json 不動，§2.4）
 *   data/d8/zh-short.fp.json     國綜非選每一個子題官方答案的 3 字組集合（短答逐子題比對）
 *
 * 雜湊（站主決定：不帶金鑰、不需要任何 secret）：沿用 d8-fingerprint.mjs 的 cyrb53、7 位元組、排序去重、base64，
 * 只換網域前綴，和英文的 'h:'／'e:' 窗口互不相撞：
 *   8 字窗口  cyrb53('zh8:'＋窗口)
 *   3 字組    cyrb53('zs3:'＋3 字組)
 * 受保護的文件本來就由官方公開刊登，反推雜湊得不到任何沒公開的東西；本站要守的是「網站不顯示、不重製」。
 *
 * 正規形式＝d8HanWindows（NFKC → 移除所有空白 → 連續漢字，不跨標點與非漢字），Worker 用同一支函式切學生的文字與模型的輸出。
 * 不套 ZH_TW_FORM_MAP：官方文件本來就是標準字，比對端要不要先換字碼由 Worker 決定（換或不換都不會多擋）。
 *
 * 扣除（兩份檔案都不收）：
 *   - 公開題本與答題卷（papers/＊/＊-paper、＊-sheet、＊-ans、＊-cover，ref/ 的試卷與參考試卷說明）的窗口：官方答案常摘自選文；
 *   - data/d8/zh-public-classics.txt（公有領域古文）的窗口：評分原則常引用古文名句；
 *   - data/d8/zh-boilerplate.txt 的樣板字串（文件名稱、考科名稱、辭典名稱）：取窗口前先換成分隔符號，窗口不會跨過它們；
 *   - 3 字組另外扣掉「該題題本」（同一年國綜題本第貳部分起的文字與答題卷）的 3 字組；扣完少於 5 個的子題不建集合。
 *
 * 怎麼重產（每年 2 月官方公布新文件之後，列在年度維運清單）：
 *   1. 把官方檔案放在本機（不進版控），目錄結構和下載時相同：papers/<年度>/gz-score.pdf、gx-score.pdf、gw-score.pdf、
 *      gz-paper.pdf、gz-sheet.pdf…，ref/13-gz1-score.pdf…，epaper/ep<期數>_g[zx]_score.html。
 *   2. node packages/shared/scripts/d8-zh-fingerprint.mjs --source <那個目錄>
 *      （或設環境變數 ZH_D8_SOURCE_DIR）。需要 poppler 的 pdftotext（不加 -layout：它會把框注和正文排在同一行，§5.7）。
 *   3. 檢查印出的筆數與來源清單，連同 data/d8/ 的兩個檔案一起提交。原文與中間檔一律不進 repo。
 *   --check <檔案…>：只讀現有的兩個指紋檔，印出每個檔案的 8 字窗口命中數與短答最高包含率（自我檢查用，不印任何官方文字）。
 *
 * 只用 Node 22 內建功能（零依賴）。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { D8_FP_FORMAT, D8_HAN_WINDOW, cyrb53, d8HanWindows, packFingerprints, unpackFingerprints } from './d8-fingerprint.mjs';

/** 8 字窗口的雜湊網域（cyrb53 的前綴）。 */
export const ZH_D8_WINDOW_DOMAIN = 'zh8';
/** 3 字組的雜湊網域。 */
export const ZH_D8_SHORT_DOMAIN = 'zs3';
/** 短答比對的字組長度。 */
export const ZH_D8_SHORT_GRAM = 3;
/** 扣完題本後少於幾個 3 字組的子題不建集合（多半是人名、詞語這類事實型答案）。 */
export const ZH_D8_SHORT_MIN_GRAMS = 5;
/** 任一組的包含率 ≥ 這個值就拿掉示範（設計值，§5.7；評測後可調到 0.7）。 */
export const ZH_D8_SHORT_THRESHOLD = 0.6;
/** 兩份檔案的種類（檔案的 kind 欄位）。 */
export const ZH_D8_OFFICIAL_KIND = 'zh-official';
export const ZH_D8_SHORT_KIND = 'zh-short';
/** 產物的預設位置（相對 repo 根目錄）。 */
export const ZH_D8_OFFICIAL_FILE = 'data/d8/zh-official.fp.json';
export const ZH_D8_SHORT_FILE = 'data/d8/zh-short.fp.json';
export const ZH_D8_BOILERPLATE_FILE = 'data/d8/zh-boilerplate.txt';
export const ZH_D8_CLASSICS_FILE = 'data/d8/zh-public-classics.txt';
/** 產生器自我檢查的下限（[ZH] §9.2 實測扣掉題本後約 3,265 個窗口；低於下限代表來源少了或文字層壞了）。 */
export const ZH_D8_MIN_COUNTS = { windows: 2_000, shortSets: 20 };

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..', '..');
/** 樣板字串換成的分隔符號（不是漢字，窗口不會跨過它）。 */
const MASK = '｜';
const CIRCLED_RE = /[①-⑳]/;

/**
 * 8 字窗口的雜湊。
 * @param {string} window
 */
export function zhD8WindowHash(window) {
  return cyrb53(`${ZH_D8_WINDOW_DOMAIN}:${window}`);
}

/**
 * 3 字組的雜湊。
 * @param {string} gram
 */
export function zhD8GramHash(gram) {
  return cyrb53(`${ZH_D8_SHORT_DOMAIN}:${gram}`);
}

/**
 * 一段文字的 8 字窗口（去重；正規形式同 d8HanWindows）。
 * @param {string} text
 * @returns {string[]}
 */
export function zhD8Windows(text) {
  return [...new Set(d8HanWindows(text, D8_HAN_WINDOW).map((w) => w.window))];
}

/**
 * 一段文字的 3 字組（去重；不跨標點與非漢字）。
 * @param {string} text
 * @returns {string[]}
 */
export function zhD8Grams(text) {
  return [...new Set(d8HanWindows(text, ZH_D8_SHORT_GRAM).map((w) => w.window))];
}

/**
 * 樣板清單檔：一行一個字串；空行與 # 開頭的行是註解。長的在前（先換掉長的，短的才不會切斷它）。
 * @param {string} fileText
 * @returns {string[]}
 */
export function parseBoilerplate(fileText) {
  const terms = fileText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.normalize('NFKC').replace(/\s/g, ''));
  return [...new Set(terms)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

/**
 * 把樣板字串換成分隔符號（字和字之間可以有空白或換行，和移除空白的正規形式一致）。先做 NFKC，和 d8HanWindows 相同。
 * @param {string} text
 * @param {readonly string[]} terms parseBoilerplate 的結果
 */
export function maskBoilerplate(text, terms) {
  let out = text.normalize('NFKC');
  for (const term of terms) {
    const re = new RegExp([...term].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
    out = out.replace(re, MASK);
  }
  return out;
}

/**
 * 古文語料檔（data/d8/zh-public-classics.txt）：「## 篇名｜作者」開始一篇，之後到下一個「## 」之前是原文；
 * 「# 」開頭或只有「#」的行是註解。回傳每一篇的篇名與原文。
 * @param {string} fileText
 * @returns {Array<{ title: string, author: string, text: string }>}
 */
export function parseClassics(fileText) {
  /** @type {Array<{ title: string, author: string, text: string }>} */
  const out = [];
  /** @type {{ title: string, author: string, text: string } | null} */
  let cur = null;
  for (const raw of fileText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('## ')) {
      const [title = '', author = ''] = line.slice(3).split('｜');
      cur = { title: title.trim(), author: author.trim(), text: '' };
      out.push(cur);
    } else if (line === '#' || line.startsWith('# ') || !line) {
      continue;
    } else if (cur) {
      cur.text += (cur.text ? '\n' : '') + line;
    }
  }
  return out;
}

/**
 * 選才電子報文章頁：只取內文區塊（editable_content），去掉 script、style 與標籤，換回實體字元。
 * @param {string} html
 */
export function htmlArticleText(html) {
  const start = html.indexOf('editable_content');
  const end = start >= 0 ? html.indexOf('post_info below', start) : -1;
  const body = start >= 0 ? html.slice(html.indexOf('>', start) + 1, end > start ? end : undefined) : html;
  return body
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * @typedef {{ item: string, alt: number, text: string }} ZhShortAnswer
 * item 是子題（例「34(1)」「32(2)①」）；alt 是同一子題的第幾種寫法（0＝主要答案，1 以後是「或：」）。
 */

/**
 * 一段答案文字拆成「寫法」與「分項」：先依「或：」拆寫法；每一種寫法再依 ①② 與換行的「」開頭拆分項。
 * 整段（第一種寫法）、每一種寫法、每一個分項都各自成為候選集合，重疊沒有關係（任一組達到門檻就算命中）。
 * @param {string} item
 * @param {string} chunk
 * @returns {ZhShortAnswer[]}
 */
export function splitShortAnswer(item, chunk) {
  /** @type {ZhShortAnswer[]} */
  const out = [];
  const alts = chunk.split(/或\s*[：:]/).map((s) => s.trim()).filter(Boolean);
  alts.forEach((alt, i) => {
    out.push({ item, alt: i, text: alt });
    const parts = alt.split(/(?=[①-⑳])|\n(?=\s*「)/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    for (const part of parts) {
      const mark = CIRCLED_RE.exec(part.slice(0, 1))?.[0] ?? '';
      out.push({ item: mark ? `${item}${mark}` : item, alt: i, text: part });
    }
  });
  return out;
}

/**
 * 111 起的國綜「非選擇題（滿分）參考答案與評分原則」：每一題是「第 N 題／一、滿分參考答案：……二、評分原則：」，
 * 子題以單獨一行的 (1)／（1）分開。回傳每個子題的每一種寫法與分項（只在記憶體裡用，不寫進任何檔案）。
 * @param {string} text pdftotext（不加 -layout）的文字層
 * @returns {ZhShortAnswer[]}
 */
export function extractGzScoreAnswers(text) {
  /** @type {ZhShortAnswer[]} */
  const out = [];
  const re = /第\s*(\d+)\s*題\s*\n\s*一、\s*(?:滿分)?參考答案\s*[：:]([\s\S]*?)二、\s*評分原則/g;
  for (const m of text.matchAll(re)) {
    const q = m[1] ?? '';
    const region = m[2] ?? '';
    const pieces = region.split(/^\s*[（(]\s*(\d+)\s*[）)]\s*$/m);
    if (pieces.length === 1) {
      out.push(...splitShortAnswer(q, region));
      continue;
    }
    for (let i = 1; i + 1 < pieces.length; i += 2) out.push(...splitShortAnswer(`${q}(${pieces[i]})`, pieces[i + 1] ?? ''));
  }
  return out;
}

/**
 * 國綜參考試卷的「參考答案及評分原則」：每一個子題是「第 N 題. 標籤／參考答案／……／評分原則」。
 * 標籤裡的「文句 ○ 1」照 PDF 文字層的寫法還原成「文句①」。
 * @param {string} text
 * @returns {ZhShortAnswer[]}
 */
export function extractRefScoreAnswers(text) {
  /** @type {ZhShortAnswer[]} */
  const out = [];
  const re = /第\s*(\d+)\s*題\s*[.．]([^\n]*(?:\n(?!\s*參考答案)[^\n]*){0,2})\n\s*參考答案\s*\n([\s\S]*?)\n\s*評分原則/g;
  for (const m of text.matchAll(re)) {
    const label = (m[2] ?? '')
      .replace(/○\s*(\d)/g, (_, d) => String.fromCodePoint(0x245f + Number(d)))
      .replace(/[\s.．]/g, '');
    out.push(...splitShortAnswer(`${m[1]}${label}`, m[3] ?? ''));
  }
  return out;
}

/**
 * 題本裡「該題」的範圍：從「第貳部分」（混合題或非選擇題）開始到最後；找不到這個標記時用整份題本。
 * @param {string} paperText
 */
export function zhMixedSectionText(paperText) {
  const compact = paperText.replace(/\s/g, '');
  const i = compact.indexOf('第貳部分');
  return i >= 0 ? compact.slice(i) : compact;
}

/**
 * 8 字窗口指紋檔。protectedDocs 的文字只在記憶體裡切窗口；回傳的物件只有雜湊、筆數與來源清單。
 * @param {{
 *   protectedDocs: Array<{ doc: string, year: string, kind: string, sha256: string, text: string }>,
 *   publicTexts: readonly string[],
 *   classicsText: string,
 *   boilerplate: readonly string[],
 * }} input
 */
export function buildZhOfficial(input) {
  const publicWindows = new Set(input.publicTexts.flatMap((t) => zhD8Windows(maskBoilerplate(t, input.boilerplate))));
  const classicsWindows = new Set(parseClassics(input.classicsText).flatMap((c) => zhD8Windows(c.text)));
  /** @type {Set<string>} */
  const all = new Set();
  const sources = input.protectedDocs.map((d) => {
    const raw = zhD8Windows(maskBoilerplate(d.text, input.boilerplate));
    const kept = raw.filter((w) => !publicWindows.has(w) && !classicsWindows.has(w));
    kept.forEach((w) => all.add(w));
    return { doc: d.doc, year: d.year, kind: d.kind, sha256: d.sha256, windows: kept.length, in_public: raw.length - kept.length };
  });
  const hashes = new Set([...all].map(zhD8WindowHash));
  const fp = packFingerprints(hashes);
  return {
    format: D8_FP_FORMAT,
    kind: ZH_D8_OFFICIAL_KIND,
    hash: `cyrb53('${ZH_D8_WINDOW_DOMAIN}:'＋窗口)`,
    han_window: D8_HAN_WINDOW,
    count: hashes.size,
    version: sha256(fp).slice(0, 12),
    sources: [...sources].sort((a, b) => (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : 0)),
    excluded: { public_windows: publicWindows.size, classics_windows: classicsWindows.size, boilerplate_terms: input.boilerplate.length },
    fp,
  };
}

/**
 * 短答逐子題 3 字組檔。answers 的文字只在記憶體裡切字組；回傳的物件只有雜湊、字組數與「年度＋子題」。
 * 同一組雜湊只留第一次出現的那一筆（分項和整段完全相同時）。
 * @param {Array<{ year: string, answers: ZhShortAnswer[], paperText: string }>} papers
 * @param {readonly string[]} boilerplate
 */
export function buildZhShort(papers, boilerplate) {
  /** @type {Array<{ year: string, item: string, alt: number, grams: number, fp: string }>} */
  const sets = [];
  const seen = new Set();
  let dropped = 0;
  for (const p of papers) {
    const paperGrams = new Set(zhD8Grams(maskBoilerplate(p.paperText, boilerplate)));
    for (const a of p.answers) {
      const grams = zhD8Grams(maskBoilerplate(a.text, boilerplate)).filter((g) => !paperGrams.has(g));
      if (grams.length < ZH_D8_SHORT_MIN_GRAMS) {
        dropped += 1;
        continue;
      }
      const fp = packFingerprints(grams.map(zhD8GramHash));
      if (seen.has(fp)) continue;
      seen.add(fp);
      sets.push({ year: p.year, item: a.item, alt: a.alt, grams: grams.length, fp });
    }
  }
  sets.sort((a, b) => (a.year < b.year ? -1 : a.year > b.year ? 1 : 0) || compareItems(a.item, b.item) || a.alt - b.alt || (a.fp < b.fp ? -1 : 1));
  return {
    format: D8_FP_FORMAT,
    kind: ZH_D8_SHORT_KIND,
    hash: `cyrb53('${ZH_D8_SHORT_DOMAIN}:'＋3 字組)`,
    gram: ZH_D8_SHORT_GRAM,
    min_grams: ZH_D8_SHORT_MIN_GRAMS,
    threshold: ZH_D8_SHORT_THRESHOLD,
    count: sets.length,
    dropped_short: dropped,
    version: sha256(sets.map((s) => s.fp).join('|')).slice(0, 12),
    sets,
  };
}

/**
 * 子題排序：題號數字、再比其餘字串。
 * @param {string} a
 * @param {string} b
 */
function compareItems(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 一段文字命中 8 字窗口集合的窗口數（不同窗口）。
 * @param {string} text
 * @param {Set<number>} set
 * @param {readonly string[]} [boilerplate]
 */
export function zhD8OfficialHitCount(text, set, boilerplate = []) {
  return zhD8Windows(maskBoilerplate(text, boilerplate)).filter((w) => set.has(zhD8WindowHash(w))).length;
}

/**
 * 短答比對：一組的 3 字組有幾成出現在這段文字裡（0–1）。
 * @param {string} text
 * @param {Set<number>} gramSet 一個子題的集合（unpackFingerprints 之後）
 */
export function zhShortContainment(text, gramSet) {
  if (gramSet.size === 0) return 0;
  const here = new Set(zhD8Grams(text).map(zhD8GramHash));
  let hit = 0;
  for (const h of gramSet) if (here.has(h)) hit += 1;
  return hit / gramSet.size;
}

/**
 * 讀指紋檔並做格式檢查：format、kind、count 與實際筆數一致、version 和內容相符。不對就丟錯。
 * @param {unknown} json
 * @returns {{ kind: 'zh-official', version: string, set: Set<number> } | { kind: 'zh-short', version: string, sets: Array<{ year: string, item: string, alt: number, set: Set<number> }> }}
 */
export function readZhFingerprintFile(json) {
  const o = /** @type {Record<string, unknown>} */ (json && typeof json === 'object' ? json : {});
  if (o.format !== D8_FP_FORMAT) throw new Error(`format 應為 ${D8_FP_FORMAT}`);
  const version = typeof o.version === 'string' ? o.version : '';
  if (o.kind === ZH_D8_OFFICIAL_KIND) {
    if (typeof o.fp !== 'string') throw new Error('fp 應為字串');
    const list = unpackFingerprints(o.fp);
    if (list.length !== o.count) throw new Error(`count ${String(o.count)} 和實際 ${list.length} 不符`);
    if (version !== sha256(o.fp).slice(0, 12)) throw new Error('version 和內容不符');
    return { kind: ZH_D8_OFFICIAL_KIND, version, set: new Set(list) };
  }
  if (o.kind === ZH_D8_SHORT_KIND) {
    if (!Array.isArray(o.sets)) throw new Error('sets 應為陣列');
    const sets = o.sets.map((raw, i) => {
      const s = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
      if (typeof s.fp !== 'string' || typeof s.year !== 'string' || typeof s.item !== 'string' || typeof s.alt !== 'number') {
        throw new Error(`sets[${i}] 欄位不對`);
      }
      const list = unpackFingerprints(s.fp);
      if (list.length !== s.grams || list.length < ZH_D8_SHORT_MIN_GRAMS) throw new Error(`sets[${i}] 的 grams 和實際筆數不符或太少`);
      return { year: s.year, item: s.item, alt: s.alt, set: new Set(list) };
    });
    if (sets.length !== o.count) throw new Error(`count ${String(o.count)} 和實際 ${sets.length} 不符`);
    const fps = /** @type {Array<{ fp: string }>} */ (o.sets).map((s) => s.fp);
    if (version !== sha256(fps.join('|')).slice(0, 12)) throw new Error('version 和內容不符');
    return { kind: ZH_D8_SHORT_KIND, version, sets };
  }
  throw new Error(`kind 應為 ${ZH_D8_OFFICIAL_KIND} 或 ${ZH_D8_SHORT_KIND}`);
}

/** @param {string} s */
function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

// ── 以下只在命令列執行時用到（讀官方檔案、呼叫 pdftotext、寫檔） ──

/** 受保護文件的種類（依檔名判斷；來源清單寫中文種類）。 */
const PROTECTED_KINDS = /** @type {const} */ ([
  [/^papers\/\d+\/gz-score\.pdf$/, '國綜非選擇題參考答案與評分原則'],
  [/^papers\/\d+\/gx-score\.pdf$/, '國寫閱卷評分原則'],
  [/^papers\/\d+\/gw-score\.pdf$/, '舊制國文非選擇題評分標準'],
  [/^ref\/[^/]*gz\d*-score\.pdf$/, '國綜參考試卷評分原則'],
  [/^ref\/[^/]*gz\d*-exp\.pdf$/, '國綜參考試卷試題解析'],
  [/^ref\/[^/]*gx-exp\.pdf$/, '國寫參考試卷試題解析'],
  [/^epaper\/ep\d+_gz_score\.html$/, '選才電子報國綜評分說明'],
  [/^epaper\/ep\d+_gx_score\.html$/, '選才電子報國寫評分說明'],
]);
/** 公開文字（扣除用）：題本、答題卷、答案、封面、參考試卷與它的說明。 */
const PUBLIC_RE = /^(?:papers\/\d+\/[a-z]+-(?:paper|sheet|ans|cover)\.pdf|ref\/[^/]*-(?:paper|note)\.pdf)$/;

/**
 * 來源目錄裡的檔案（相對路徑，排序）。
 * @param {string} root
 * @param {string} [rel]
 * @returns {string[]}
 */
function listFiles(root, rel = '') {
  /** @type {string[]} */
  const out = [];
  for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) out.push(...listFiles(root, r));
    else out.push(r);
  }
  return out.sort();
}

/**
 * PDF 文字層（pdftotext，不加 -layout）或電子報內文。
 * @param {string} file
 */
function docText(file) {
  if (file.endsWith('.pdf')) return execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return htmlArticleText(readFileSync(file, 'utf8'));
}

/**
 * 文件的年度：papers/<年度>/…；電子報與參考試卷從內文的「NNN學年度」「NNN學測」取，取不到時寫 'ref'。
 * @param {string} rel
 * @param {string} text
 */
function docYear(rel, text) {
  const m = /^papers\/(\d+)\//.exec(rel);
  if (m) return m[1] ?? '';
  if (rel.startsWith('ref/')) return 'ref';
  const t = /(\d{3})\s*(?:學年度|學測)/.exec(text.replace(/\s/g, ''));
  return t?.[1] ?? 'ref';
}

/** @param {string} file */
function fileSha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * 產生兩份指紋檔。回傳要寫的內容（呼叫端決定寫到哪裡）。
 * @param {string} sourceDir 官方檔案的根目錄
 * @param {string} repoRoot
 */
export function generateZhFingerprints(sourceDir, repoRoot = REPO_ROOT) {
  const boilerplate = parseBoilerplate(readFileSync(path.join(repoRoot, ZH_D8_BOILERPLATE_FILE), 'utf8'));
  const classicsText = readFileSync(path.join(repoRoot, ZH_D8_CLASSICS_FILE), 'utf8');
  const files = listFiles(sourceDir);
  /** @type {Map<string, string>} */
  const texts = new Map();
  const textOf = (/** @type {string} */ rel) => {
    let t = texts.get(rel);
    if (t === undefined) {
      t = docText(path.join(sourceDir, rel));
      texts.set(rel, t);
    }
    return t;
  };
  /** @type {Array<{ doc: string, year: string, kind: string, sha256: string, text: string }>} */
  const protectedDocs = [];
  for (const rel of files) {
    const kind = PROTECTED_KINDS.find(([re]) => re.test(rel))?.[1];
    if (!kind) continue;
    const text = textOf(rel);
    protectedDocs.push({ doc: rel, year: docYear(rel, text), kind, sha256: fileSha256(path.join(sourceDir, rel)), text });
  }
  const publicTexts = files.filter((rel) => PUBLIC_RE.test(rel)).map(textOf);
  const official = buildZhOfficial({ protectedDocs, publicTexts, classicsText, boilerplate });

  /** @type {Array<{ year: string, answers: ZhShortAnswer[], paperText: string }>} */
  const papers = [];
  for (const rel of files) {
    const y = /^papers\/(\d+)\/gz-score\.pdf$/.exec(rel)?.[1];
    if (y) {
      const sheet = `papers/${y}/gz-sheet.pdf`;
      const paperText = zhMixedSectionText(textOf(`papers/${y}/gz-paper.pdf`)) + MASK + (files.includes(sheet) ? textOf(sheet) : '');
      papers.push({ year: y, answers: extractGzScoreAnswers(textOf(rel)), paperText });
    } else if (/^ref\/[^/]*gz(\d*)-score\.pdf$/.test(rel)) {
      const n = /gz(\d*)-score/.exec(rel)?.[1] ?? '';
      const paper = files.find((f) => new RegExp(`^ref/[^/]*gz${n}-paper\\.pdf$`).test(f));
      papers.push({ year: 'ref', answers: extractRefScoreAnswers(textOf(rel)), paperText: paper ? zhMixedSectionText(textOf(paper)) : '' });
    }
  }
  const short = buildZhShort(papers, boilerplate);
  return { official, short, answerCounts: papers.map((p) => ({ year: p.year, answers: p.answers.length })) };
}

/** @param {string} rel @param {unknown} obj */
function writeJson(rel, obj) {
  const file = path.join(REPO_ROOT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(obj, null, 1)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const checkAt = args.indexOf('--check');
  if (checkAt >= 0) {
    const off = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO_ROOT, ZH_D8_OFFICIAL_FILE), 'utf8')));
    const sh = readZhFingerprintFile(JSON.parse(readFileSync(path.join(REPO_ROOT, ZH_D8_SHORT_FILE), 'utf8')));
    const boilerplate = parseBoilerplate(readFileSync(path.join(REPO_ROOT, ZH_D8_BOILERPLATE_FILE), 'utf8'));
    for (const f of args.slice(checkAt + 1)) {
      const text = readFileSync(f, 'utf8');
      const hits = off.kind === ZH_D8_OFFICIAL_KIND ? zhD8OfficialHitCount(text, off.set, boilerplate) : 0;
      const best = sh.kind === ZH_D8_SHORT_KIND ? sh.sets.reduce((m, s) => Math.max(m, zhShortContainment(text, s.set)), 0) : 0;
      console.log(`[zh-d8] ${f}：8 字窗口 ${zhD8Windows(text).length}、命中 ${hits}；短答最高包含率 ${best.toFixed(2)}`);
    }
    return;
  }
  const at = args.indexOf('--source');
  const sourceDir = (at >= 0 ? args[at + 1] : undefined) ?? process.env.ZH_D8_SOURCE_DIR;
  if (!sourceDir || !existsSync(sourceDir)) {
    console.error('[zh-d8] 用法：node packages/shared/scripts/d8-zh-fingerprint.mjs --source <官方檔案目錄>（或設 ZH_D8_SOURCE_DIR）');
    process.exit(2);
  }
  const { official, short, answerCounts } = generateZhFingerprints(path.resolve(sourceDir));
  for (const s of official.sources) console.log(`[zh-d8] ${s.doc}（${s.kind}）：保留 ${s.windows}、題本或古文也有 ${s.in_public}`);
  for (const a of answerCounts) console.log(`[zh-d8] ${a.year} 短答候選 ${a.answers} 筆`);
  console.log(`[zh-d8] 8 字窗口 ${official.count}（版本 ${official.version}）；短答集合 ${short.count}、太短略過 ${short.dropped_short}（版本 ${short.version}）`);
  if (official.count < ZH_D8_MIN_COUNTS.windows || short.count < ZH_D8_MIN_COUNTS.shortSets) {
    console.error(`[zh-d8] 失敗：筆數低於下限（窗口 ≥${ZH_D8_MIN_COUNTS.windows}、短答集合 ≥${ZH_D8_MIN_COUNTS.shortSets}）；來源可能不完整`);
    process.exit(1);
  }
  writeJson(ZH_D8_OFFICIAL_FILE, official);
  writeJson(ZH_D8_SHORT_FILE, short);
  console.log(`[zh-d8] 已寫 ${ZH_D8_OFFICIAL_FILE}、${ZH_D8_SHORT_FILE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
