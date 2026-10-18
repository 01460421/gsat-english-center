/**
 * D8：擋學生貼進自訂作文題目欄的官方受保護文字（評分原則、中譯英參考譯文；docs/design/custom-essay.md §2.4.5）。
 * 負責：後端 B。
 *
 * Worker 手上沒有任何官方受保護文字：產生器（scripts/build-writing-prompts.mjs）只打包短窗口的雜湊
 * （src/generated/d8-fingerprints.json，不進版控）。這裡用同樣的正規形式切學生的題目、算雜湊、查集合；
 * 命中就拒收（400 custom_prompt_invalid／official_material），ranges 只回學生自己文字裡的位置，不回任何官方文字。
 *
 * 正規形式、cyrb53、窗口與位置的換算是 packages/shared/scripts/d8-fingerprint.mjs 的 TS 移植
 * （test/custom-essay.d8.test.ts 對一批字串逐一對照，兩邊必須相同）：
 *   漢字：NFKC → 移除所有空白 → 連續 8 個漢字（不跨標點與非漢字）；
 *   英文：NFKC → 行尾斷字的連字號接回 → 連續 7 個英文字（小寫、彎引號換直引號）。
 *
 * 壞檔時 fail closed（S3）：格式不對、base64 解不開、筆數是 0 或和檔頭的 count 不符 → 自訂題的建立、修改、送辨識、
 * 送批改一律回 503 not_configured；ops_events(kind='d8_fingerprints_invalid') 每個 isolate 只寫一次（模組層旗標）。
 * 顯示時（詳情、列表標題、匯出）壞檔不回 503，只把題目隱藏。集合在第一次用到時才解碼（模組層快取）。
 */
import fpJson from '../generated/d8-fingerprints.json';
import { opsEvent } from './ledger';

export const D8_FP_FORMAT = 'gsat-d8-fp/v2';
export const D8_HAN_WINDOW = 8;
export const D8_ENGLISH_RUN = 7;
const D8_FP_BYTES = 7;
/** API 回傳的命中位置最多幾段。 */
export const D8_MAX_RANGES = 5;

const HAN_RUN_RE = /[㐀-鿿]+/g;
const ENGLISH_WORD_RE = /[A-Za-z0-9]+(?:['’‘][A-Za-z]+)?/g;
const WHITESPACE_RE = /\s/;
const LETTER_RE = /[A-Za-z]/;
const HYPHEN_BREAK_RE = /^-[ \t]*\n[ \t]*(?=[A-Za-z])/;

/** cyrb53（53 位元、決定性；和 d8-fingerprint.mjs 逐位元相同）。 */
export function cyrb53(str: string, seed = 0): number {
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

export function d8Hash(kind: 'han' | 'en', window: string): number {
  return cyrb53(`${kind === 'han' ? 'h' : 'e'}:${window}`);
}

/** 一個窗口與它在（NFKC 後的）輸入文字裡的位置 [start, end)。 */
export interface D8Window {
  window: string;
  start: number;
  end: number;
}

/** 漢字窗口：NFKC → 移除所有空白 → 連續 n 個漢字。 */
export function d8HanWindows(text: string, n = D8_HAN_WINDOW): D8Window[] {
  const nfkc = text.normalize('NFKC');
  let stripped = '';
  const map: number[] = [];
  for (let i = 0; i < nfkc.length; i += 1) {
    const ch = nfkc.charAt(i);
    if (WHITESPACE_RE.test(ch)) continue;
    stripped += ch;
    map.push(i);
  }
  const out: D8Window[] = [];
  for (const m of stripped.matchAll(HAN_RUN_RE)) {
    for (let k = 0; k + n <= m[0].length; k += 1) {
      const s = m.index + k;
      out.push({ window: stripped.slice(s, s + n), start: map[s] ?? 0, end: (map[s + n - 1] ?? 0) + 1 });
    }
  }
  return out;
}

/** 英文窗口：NFKC → 行尾斷字的連字號接回 → 連續 n 個英文字。 */
export function d8EnglishWindows(text: string, n = D8_ENGLISH_RUN): D8Window[] {
  const nfkc = text.normalize('NFKC');
  let joined = '';
  const map: number[] = [];
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
  const words: Array<{ w: string; start: number; end: number }> = [];
  for (const m of joined.matchAll(ENGLISH_WORD_RE)) {
    words.push({ w: m[0].toLowerCase().replace(/[’‘]/g, "'"), start: map[m.index] ?? 0, end: (map[m.index + m[0].length - 1] ?? 0) + 1 });
  }
  const out: D8Window[] = [];
  for (let i = 0; i + n <= words.length; i += 1) {
    const slice = words.slice(i, i + n);
    out.push({ window: slice.map((x) => x.w).join(' '), start: slice[0]?.start ?? 0, end: slice[n - 1]?.end ?? 0 });
  }
  return out;
}

/** 重疊或相鄰的位置合併，依開頭排序，最多 limit 段。 */
export function mergeRanges(ranges: Array<[number, number]>, limit = D8_MAX_RANGES): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.slice(0, limit);
}

// ───────────────────────── 指紋檔 ─────────────────────────

export interface D8Fingerprints {
  /** 檔頭的 version（寫進批改紀錄 judgments.meta.d8_fp）。 */
  version: string;
  han: Set<number>;
  en: Set<number>;
}

/** base64 → 雜湊陣列；長度不是 7 的倍數或解不開時丟錯。 */
function unpack(b64: string): number[] {
  const bin = atob(b64);
  if (bin.length % D8_FP_BYTES !== 0) throw new Error(`指紋長度 ${bin.length} 不是 ${D8_FP_BYTES} 的倍數`);
  const out: number[] = [];
  for (let o = 0; o < bin.length; o += D8_FP_BYTES) {
    const hi = (bin.charCodeAt(o) << 16) | (bin.charCodeAt(o + 1) << 8) | bin.charCodeAt(o + 2);
    const lo = ((bin.charCodeAt(o + 3) << 24) | (bin.charCodeAt(o + 4) << 16) | (bin.charCodeAt(o + 5) << 8) | bin.charCodeAt(o + 6)) >>> 0;
    out.push(hi * 4294967296 + lo);
  }
  return out;
}

/**
 * 檢查並解碼指紋檔（純函式；測試直接呼叫）。壞檔回 null：格式或檔頭不對、base64 解不開、任何一種筆數是 0、
 * 解碼後的筆數和檔頭的 count 不符。
 */
export function parseFingerprints(json: unknown): D8Fingerprints | null {
  if (typeof json !== 'object' || json === null) return null;
  const f = json as Record<string, unknown>;
  const count = f['count'] as Record<string, unknown> | undefined;
  if (
    f['format'] !== D8_FP_FORMAT ||
    f['han_window'] !== D8_HAN_WINDOW ||
    f['english_run'] !== D8_ENGLISH_RUN ||
    typeof f['version'] !== 'string' ||
    typeof f['han'] !== 'string' ||
    typeof f['en'] !== 'string' ||
    typeof count !== 'object' ||
    count === null
  ) {
    return null;
  }
  try {
    const han = new Set(unpack(f['han']));
    const en = new Set(unpack(f['en']));
    if (han.size === 0 || en.size === 0 || han.size !== count['han'] || en.size !== count['en']) return null;
    return { version: f['version'], han, en };
  } catch {
    return null;
  }
}

let cached: { fp: D8Fingerprints | null } | null = null;
let alerted = false;

/** 打包的指紋檔（第一次呼叫時解碼並快取）；壞檔回 null。 */
export function d8Fingerprints(): D8Fingerprints | null {
  if (!cached) cached = { fp: parseFingerprints(fpJson as unknown) };
  return cached.fp;
}

/**
 * 自訂題的寫入路徑（建立、修改、送辨識、送批改）用：壞檔時寫一次 ops_events（每個 isolate 只寫一次）並回 null，
 * 呼叫端回 503 not_configured（fail closed）。
 */
export async function requireD8Fingerprints(db: D1Database): Promise<D8Fingerprints | null> {
  const fp = d8Fingerprints();
  if (fp) return fp;
  if (!alerted) {
    alerted = true;
    console.error('D8 指紋檔壞掉或是空的：自訂作文題目暫停（503）');
    await opsEvent(db, 'd8_fingerprints_invalid', 'error', { file: 'd8-fingerprints.json' });
  }
  return null;
}

/** 測試用：清掉模組層的快取與「已告警」旗標（換了 mock 的指紋檔之後呼叫）。 */
export function resetD8ForTests(): void {
  cached = null;
  alerted = false;
}

/** 一段文字命中指紋的位置（合併後最多 5 段）。 */
export function d8Ranges(text: string, fp: Pick<D8Fingerprints, 'han' | 'en'>): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  for (const w of d8HanWindows(text)) if (fp.han.has(d8Hash('han', w.window))) hits.push([w.start, w.end]);
  for (const w of d8EnglishWindows(text)) if (fp.en.has(d8Hash('en', w.window))) hits.push([w.start, w.end]);
  return mergeRanges(hits);
}

/**
 * 正規化後的題目與圖片描述，分別比對指紋。回傳第一個命中的欄位與位置（題目欄優先）；都沒命中回 null。
 * 位置是學生自己文字（存檔的正規化文字）裡的 UTF-16 索引；不含任何受保護文字。
 */
export function officialMaterialHits(
  fp: Pick<D8Fingerprints, 'han' | 'en'>,
  text: string,
  figureText: string | null,
): { field: 'text' | 'figure_text'; ranges: Array<[number, number]> } | null {
  const inText = d8Ranges(text, fp);
  if (inText.length > 0) return { field: 'text', ranges: inText };
  const inFigure = figureText ? d8Ranges(figureText, fp) : [];
  return inFigure.length > 0 ? { field: 'figure_text', ranges: inFigure } : null;
}
