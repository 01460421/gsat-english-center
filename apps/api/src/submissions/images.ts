/**
 * 照片的位元組處理（純位元組操作，Workers 不能用 sharp 之類的原生套件）。負責：後端 AI A2。
 *
 * - 依魔術位元組判斷格式（JPEG FF D8 FF、PNG 89 50 4E 47 0D 0A 1A 0A、WebP RIFF….WEBP），宣告的型別和內容不符就拒絕；
 * - 解析檔頭取寬高（解析不了回 null；上傳端點會拒絕）；
 * - 剝除中繼資料（可能含 GPS 定位、姓名；ARCHITECTURE §7「上傳檔案」）：JPEG 的 APP1（EXIF、XMP）、APP13（IPTC）
 *   與 COM 註解區段、PNG 的 eXIf／tEXt／zTXt／iTXt／tIME 區塊與 IEND 之後的資料、WebP 的 EXIF／XMP 區塊與
 *   RIFF 長度之後的資料。processImageMetadata 回三種結果：剝掉了、本來就沒有、結構不認得（上傳端點拒絕，
 *   ARCHITECTURE §7「不合格就拒絕」）；JPEG 標記前的 0xFF 填充位元組照規格跳過；
 * - 尺寸上限：長邊 ≤ 1600 px（和前端縮圖同一個常數）；
 * - sha256 與 base64（送給 Claude 的 image 區塊）。
 */
import { PHOTO_MAX_LONG_EDGE_PX, type PhotoMime } from '@gsat/shared';

export function sniffImageType(bytes: Uint8Array): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}
function u32be(b: Uint8Array, i: number): number {
  return (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
}
function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
function u24le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
}

/** 取寬高；格式不認得或檔頭不完整回 null。 */
export function imageDimensions(bytes: Uint8Array, mime: PhotoMime): { width: number; height: number } | null {
  if (mime === 'image/png') {
    if (bytes.length < 24) return null;
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (mime === 'image/webp') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X' && bytes.length >= 30) return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    if (chunk === 'VP8 ' && bytes.length >= 30) return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const b0 = bytes[21] ?? 0;
      const b1 = bytes[22] ?? 0;
      const b2 = bytes[23] ?? 0;
      const b3 = bytes[24] ?? 0;
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    return null;
  }
  // JPEG：逐段找 SOFn（C0–CF，排除 C4 DHT、C8 JPG、CC DAC）。
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = u16be(bytes, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(bytes, i + 5), width: u16be(bytes, i + 7) };
    }
    if (marker === 0xda || len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** 中繼資料處理的結果：ok=false 表示結構不認得（不冒險改壞檔案，也不放行）。 */
export type MetadataResult = { ok: true; bytes: Uint8Array; removed: boolean } | { ok: false };

/** JPEG 要剝掉的區段：APP1（EXIF、XMP）、APP13（Photoshop IPTC）、COM（註解）。 */
const JPEG_STRIP_MARKERS = new Set([0xe1, 0xed, 0xfe]);

/**
 * 剝除 JPEG 的中繼資料區段。只處理 SOS（FF DA）之前的標頭區段，影像資料本身不動；
 * 標記前的 0xFF 填充位元組（規格允許）照樣跳過，輸出時丟掉。結構不認得（不是 FF 開頭、長度不合理、
 * 沒有 SOS 就結束、SOS 之前出現 SOI／EOI／RSTn）回 ok=false。
 */
export function stripJpegMetadata(bytes: Uint8Array): MetadataResult {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ok: false };
  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  let removed = false;
  for (;;) {
    if (i >= bytes.length || bytes[i] !== 0xff) return { ok: false };
    let j = i + 1;
    while (j < bytes.length && bytes[j] === 0xff) j++;
    if (j >= bytes.length) return { ok: false };
    if (j > i + 1) removed = true; // 填充位元組
    const marker = bytes[j]!;
    if (marker === 0xda) {
      keep.push(bytes.subarray(j - 1));
      break;
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) return { ok: false };
    if (marker === 0x01) {
      // TEM：沒有長度欄位的獨立標記。
      keep.push(bytes.subarray(j - 1, j + 1));
      i = j + 1;
      continue;
    }
    if (j + 2 >= bytes.length) return { ok: false };
    const len = u16be(bytes, j + 1);
    const end = j + 1 + len;
    if (len < 2 || end > bytes.length) return { ok: false };
    if (JPEG_STRIP_MARKERS.has(marker)) removed = true;
    else keep.push(bytes.subarray(j - 1, end));
    i = end;
  }
  return removed ? { ok: true, bytes: concat(keep), removed } : { ok: true, bytes, removed };
}

/** 舊介面：剝除 JPEG 的中繼資料；結構不認得時原樣回傳（上傳端點改用 processImageMetadata，不認得就拒絕）。 */
export function stripJpegApp1(bytes: Uint8Array): Uint8Array {
  const r = stripJpegMetadata(bytes);
  return r.ok ? r.bytes : bytes;
}

/**
 * 伺服器接受的最大長邊（px）＝前端縮圖的上限 PHOTO_MAX_LONG_EDGE_PX（1600）。OCR 預扣的輸入估計（tasks.ts，
 * 兩張各約 2,500 tokens）就是以這個尺寸算的；更大的圖只會多花 token，辨識也不會更準，所以直接拒絕。
 */
export const PHOTO_SERVER_MAX_EDGE_PX = PHOTO_MAX_LONG_EDGE_PX;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 剝除 PNG 的中繼資料區塊（整塊丟掉，不必重算 CRC）與 IEND 之後的資料；沒有 IEND 或區塊長度不合理回 ok=false。 */
export function stripPngMetadataResult(bytes: Uint8Array): MetadataResult {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, k) => bytes[k] === b)) return { ok: false };
  const keep: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  let removed = false;
  for (;;) {
    if (i + 12 > bytes.length) return { ok: false };
    const len = u32be(bytes, i);
    const end = i + 12 + len;
    if (end > bytes.length) return { ok: false };
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    if (PNG_METADATA_CHUNKS.has(type)) removed = true;
    else keep.push(bytes.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      if (end < bytes.length) removed = true;
      break;
    }
  }
  return removed ? { ok: true, bytes: concat(keep), removed } : { ok: true, bytes, removed };
}

/** 舊介面：結構不認得時原樣回傳。 */
export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const r = stripPngMetadataResult(bytes);
  return r.ok ? r.bytes : bytes;
}

function u32le(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
}

/**
 * 剝除 WebP 的 EXIF、XMP 區塊並清掉 VP8X 的對應旗標、丟掉 RIFF 長度之後的資料、更新 RIFF 長度；
 * 檔頭不對或區塊長度超出 RIFF 範圍回 ok=false。
 */
export function stripWebpMetadataResult(bytes: Uint8Array): MetadataResult {
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return { ok: false };
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.length || riffEnd < 12) return { ok: false };
  const keep: Uint8Array[] = [];
  let i = 12;
  let removed = riffEnd < bytes.length;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) return { ok: false };
    const fourcc = String.fromCharCode(...bytes.subarray(i, i + 4));
    const size = u32le(bytes, i + 4);
    if (i + 8 + size > riffEnd) return { ok: false };
    const end = Math.min(i + 8 + size + (size % 2), riffEnd);
    const chunk = bytes.subarray(i, end);
    if (fourcc === 'EXIF' || fourcc === 'XMP ') removed = true;
    else if (fourcc === 'VP8X' && size >= 1) {
      const copy = Uint8Array.from(chunk);
      if ((copy[8] ?? 0) & 0x0c) removed = true;
      copy[8] = (copy[8] ?? 0) & ~0x0c; // 0x08 EXIF、0x04 XMP
      keep.push(copy);
    } else keep.push(chunk);
    i = end;
  }
  if (!removed) return { ok: true, bytes, removed };
  const body = concat(keep);
  const header = Uint8Array.from(bytes.subarray(0, 12));
  const riffSize = body.length + 4;
  header.set([riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff], 4);
  return { ok: true, bytes: concat([header, body]), removed };
}

/** 舊介面：結構不認得時原樣回傳。 */
export function stripWebpMetadata(bytes: Uint8Array): Uint8Array {
  const r = stripWebpMetadataResult(bytes);
  return r.ok ? r.bytes : bytes;
}

/** 依格式剝除中繼資料（三種結果；上傳端點遇到 ok=false 就拒絕）。 */
export function processImageMetadata(bytes: Uint8Array, mime: PhotoMime): MetadataResult {
  if (mime === 'image/jpeg') return stripJpegMetadata(bytes);
  if (mime === 'image/png') return stripPngMetadataResult(bytes);
  return stripWebpMetadataResult(bytes);
}

/** 舊介面：依格式剝除中繼資料；結構不認得時原樣回傳。 */
export function stripImageMetadata(bytes: Uint8Array, mime: PhotoMime): Uint8Array {
  const r = processImageMetadata(bytes, mime);
  return r.ok ? r.bytes : bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 位元組 → base64（分段轉，避免 String.fromCharCode 的參數上限）。 */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** D1 回傳的 BLOB 可能是 ArrayBuffer、Uint8Array 或數字陣列，一律轉成 Uint8Array。 */
export function blobToBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error('無法讀取照片資料');
}
