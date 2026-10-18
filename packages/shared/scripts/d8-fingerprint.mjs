// @ts-check
/**
 * D8 指紋：官方受保護文字（作文評分原則、中譯英參考譯文）短窗口的雜湊（docs/design/custom-essay.md §2.4.5）。
 *
 * 學生在自訂作文題目欄貼上整份講義時，評分原則常常跟著題目一起貼進來。Worker 手上刻意沒有任何官方受保護文字，
 * 所以產生器（apps/api/scripts/build-writing-prompts.mjs）把「窗口的雜湊」打包成 apps/api/src/generated/d8-fingerprints.json，
 * Worker（apps/api/src/ai/d8.ts）用同樣的正規形式切學生的題目、算雜湊、查集合：命中就拒收，不需要知道原文是什麼。
 *
 * 正規形式（產生器與 Worker 共用這一份定義；d8.ts 是它的 TS 移植，test/custom-essay.d8.test.ts 逐字串對照）：
 *   漢字窗口：NFKC 之後移除所有空白（含換行與全形空白），再取連續 8 個漢字（不跨標點與非漢字）。從 PDF 複製時
 *             每行斷行、每個字之間有空白的文字，都會接回同一個窗口（安全審查 S3）。
 *   英文窗口：NFKC 之後把行尾的斷字連字號（字母-換行字母）接回，再取連續 7 個英文字（小寫、彎引號換直引號，
 *             和 bank-select.mjs 的 englishWords／wordRuns 相同）。英文的空白本來就不影響切字，不移除。
 * 雜湊：cyrb53('h:'＋窗口) 或 cyrb53('e:'＋窗口)（53 位元、決定性、Node 與 Workers 結果相同）。
 * 檔案只有雜湊（每個 7 位元組、big-endian、排序去重後整串 base64），不含任何窗口的原文。
 *
 * 只用 Node 22 內建功能（零依賴）。
 */

export const D8_FP_FORMAT = 'gsat-d8-fp/v2';
/** 連續幾個漢字算一個窗口（＝bank-select.mjs 的 OFFICIAL_HAN_RUN）。 */
export const D8_HAN_WINDOW = 8;
/** 連續幾個英文字算一個窗口（＝bank-select.mjs 的 OFFICIAL_RUN_WORDS）。 */
export const D8_ENGLISH_RUN = 7;
/** 每個雜湊存幾個位元組（53 位元放得下）。 */
export const D8_FP_BYTES = 7;
/** API 回傳的命中位置最多幾段。 */
export const D8_MAX_RANGES = 5;

const HAN_RUN_RE = /[㐀-鿿]+/g;
const ENGLISH_WORD_RE = /[A-Za-z0-9]+(?:['’‘][A-Za-z]+)?/g;
const WHITESPACE_RE = /\s/;
const LETTER_RE = /[A-Za-z]/;
const HYPHEN_BREAK_RE = /^-[ \t]*\n[ \t]*(?=[A-Za-z])/;

/**
 * cyrb53（公開的 53 位元字串雜湊；只用 Math.imul 與位元運算，Node 與 Workers 的結果相同）。
 * @param {string} str
 * @param {number} [seed]
 * @returns {number}
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * 一個窗口的雜湊（漢字加前綴 h:、英文加 e:，兩種窗口不會互撞）。
 * @param {'han' | 'en'} kind
 * @param {string} window
 */
export function d8Hash(kind, window) {
  return cyrb53(`${kind === 'han' ? 'h' : 'e'}:${window}`);
}

/**
 * @typedef {{ window: string, start: number, end: number }} D8Window
 * start／end 是窗口在「NFKC 之後的輸入文字」裡的 UTF-16 位置（[start, end)）；輸入本來就是 NFKC（自訂題目存檔前已正規化）時
 * 就是學生自己文字裡的位置。
 */

/**
 * 漢字窗口：NFKC → 移除所有空白 → 連續 8 個漢字。
 * @param {string} text
 * @param {number} [n]
 * @returns {D8Window[]}
 */
export function d8HanWindows(text, n = D8_HAN_WINDOW) {
  const nfkc = text.normalize('NFKC');
  let stripped = '';
  /** @type {number[]} */
  const map = [];
  for (let i = 0; i < nfkc.length; i += 1) {
    const ch = nfkc.charAt(i);
    if (WHITESPACE_RE.test(ch)) continue;
    stripped += ch;
    map.push(i);
  }
  /** @type {D8Window[]} */
  const out = [];
  for (const m of stripped.matchAll(HAN_RUN_RE)) {
    for (let k = 0; k + n <= m[0].length; k += 1) {
      const s = m.index + k;
      out.push({ window: stripped.slice(s, s + n), start: map[s] ?? 0, end: (map[s + n - 1] ?? 0) + 1 });
    }
  }
  return out;
}

/**
 * 英文窗口：NFKC → 行尾斷字的連字號接回 → 連續 7 個英文字（小寫、彎引號換直引號）。
 * @param {string} text
 * @param {number} [n]
 * @returns {D8Window[]}
 */
export function d8EnglishWindows(text, n = D8_ENGLISH_RUN) {
  const nfkc = text.normalize('NFKC');
  let joined = '';
  /** @type {number[]} */
  const map = [];
  for (let i = 0; i < nfkc.length; i += 1) {
    const ch = nfkc.charAt(i);
    if (ch === '-' && LETTER_RE.test(nfkc.charAt(i - 1))) {
      const m = HYPHEN_BREAK_RE.exec(nfkc.slice(i, i + 64));
      if (m) {
        i += m[0].length - 1;
        continue;
      }
    }
    joined += ch;
    map.push(i);
  }
  /** @type {Array<{ w: string, start: number, end: number }>} */
  const words = [];
  for (const m of joined.matchAll(ENGLISH_WORD_RE)) {
    words.push({
      w: m[0].toLowerCase().replace(/[’‘]/g, "'"),
      start: map[m.index] ?? 0,
      end: (map[m.index + m[0].length - 1] ?? 0) + 1,
    });
  }
  /** @type {D8Window[]} */
  const out = [];
  for (let i = 0; i + n <= words.length; i += 1) {
    const slice = words.slice(i, i + n);
    out.push({ window: slice.map((x) => x.w).join(' '), start: slice[0]?.start ?? 0, end: slice[n - 1]?.end ?? 0 });
  }
  return out;
}

/**
 * 重疊或相鄰的位置合併，依開頭排序，最多 limit 段。
 * @param {Array<[number, number]>} ranges
 * @param {number} [limit]
 * @returns {Array<[number, number]>}
 */
export function mergeRanges(ranges, limit = D8_MAX_RANGES) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.slice(0, limit);
}

/**
 * 一段文字命中指紋集合的位置（合併後最多 5 段；沒命中回空陣列）。不回傳任何官方文字。
 * @param {string} text
 * @param {{ han: Set<number>, en: Set<number> }} sets
 * @returns {Array<[number, number]>}
 */
export function d8Ranges(text, sets) {
  /** @type {Array<[number, number]>} */
  const hits = [];
  for (const w of d8HanWindows(text)) if (sets.han.has(d8Hash('han', w.window))) hits.push([w.start, w.end]);
  for (const w of d8EnglishWindows(text)) if (sets.en.has(d8Hash('en', w.window))) hits.push([w.start, w.end]);
  return mergeRanges(hits);
}

/**
 * 雜湊排序去重後，每個 7 位元組（big-endian）接起來、整串 base64。
 * @param {Iterable<number>} hashes
 * @returns {string}
 */
export function packFingerprints(hashes) {
  const sorted = [...new Set(hashes)].sort((a, b) => a - b);
  const bytes = new Uint8Array(sorted.length * D8_FP_BYTES);
  sorted.forEach((h, i) => {
    const hi = Math.floor(h / 4294967296);
    const lo = h >>> 0;
    const o = i * D8_FP_BYTES;
    bytes[o] = (hi >>> 16) & 0xff;
    bytes[o + 1] = (hi >>> 8) & 0xff;
    bytes[o + 2] = hi & 0xff;
    bytes[o + 3] = (lo >>> 24) & 0xff;
    bytes[o + 4] = (lo >>> 16) & 0xff;
    bytes[o + 5] = (lo >>> 8) & 0xff;
    bytes[o + 6] = lo & 0xff;
  });
  return Buffer.from(bytes).toString('base64');
}

/**
 * packFingerprints 的反向（產生器的自我檢查與測試用；Worker 有自己的 atob 版本）。長度不是 7 的倍數時丟錯。
 * @param {string} b64
 * @returns {number[]}
 */
export function unpackFingerprints(b64) {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length % D8_FP_BYTES !== 0) throw new Error(`指紋長度 ${bytes.length} 不是 ${D8_FP_BYTES} 的倍數`);
  /** @type {number[]} */
  const out = [];
  for (let o = 0; o < bytes.length; o += D8_FP_BYTES) {
    const hi = ((bytes[o] ?? 0) << 16) | ((bytes[o + 1] ?? 0) << 8) | (bytes[o + 2] ?? 0);
    const lo = (((bytes[o + 3] ?? 0) << 24) | ((bytes[o + 4] ?? 0) << 16) | ((bytes[o + 5] ?? 0) << 8) | (bytes[o + 6] ?? 0)) >>> 0;
    out.push(hi * 4294967296 + lo);
  }
  return out;
}
