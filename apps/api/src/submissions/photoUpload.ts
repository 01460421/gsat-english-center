/**
 * 照片上傳的讀取與檢查（multipart，一次一張，欄位 `photo`）。作文的手寫照片（POST /api/submissions/{id}/photos）與
 * 學習助手的題目照片（POST /api/assist/cases/{id}/photos；docs/design/learning-assistant.md §6.7 WP-A3）共用，
 * 規則一個字都不分：
 *
 *   1. ord 只能是 1 或 2；
 *   2. 本體大小先看 Content-Length（multipart 的邊界與標頭另外留 64 KB），超過就 413、不讀本體；
 *   3. Content-Type 必須是 multipart/form-data；本體邊讀邊數（readBodyBytes），沒有 Content-Length 時也擋得住；
 *   4. 檔案 ≤ 1.2 MB、不是空檔、宣告的型別是 JPEG／PNG／WebP，而且和魔術位元組相符；
 *   5. 剝掉 EXIF 等中繼資料（結構不認得就拒絕）、讀得到寬高、長邊 ≤ 1600 px。
 *
 * 呼叫端先呼叫 photoOrd（檢查 ord 與 Content-Length），再查自己的資料列與狀態（找不到 404、狀態不對 409），
 * 最後才呼叫 readPhotoFile 讀本體：順序和抽出來之前一樣，回應逐字不變。存檔（各自的表、各自的上限）由呼叫端做。
 */
import { PHOTO_MAX_BYTES, PHOTO_MIMES, type PhotoMime } from '@gsat/shared';
import type { Context } from 'hono';
import { readBodyBytes } from '../account/validate';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { imageDimensions, PHOTO_SERVER_MAX_EDGE_PX, processImageMetadata, sha256Hex, sniffImageType } from './images';

/** multipart 的邊界與標頭另外留的空間。 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const TOO_LARGE_MESSAGE = '每張照片最多 1.2 MB';
const MULTIPART_MESSAGE = '請用 multipart/form-data 上傳，欄位名稱 photo';

/** 讀好、檢查過、剝掉中繼資料的一張照片。 */
export interface UploadedPhoto {
  mime: PhotoMime;
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
}

/** 第 1、2 步：ord 與 Content-Length（不讀本體）。 */
export function photoOrd(c: Context<AppEnv>): 1 | 2 {
  const ord = Number(c.req.query('ord'));
  if (ord !== 1 && ord !== 2) throw new ApiError(400, 'bad_request', 'ord 必須是 1 或 2');
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (declared > PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) throw new ApiError(413, 'payload_too_large', TOO_LARGE_MESSAGE);
  return ord;
}

/** 第 3–5 步：讀 multipart 本體、檢查格式與尺寸、剝除中繼資料。 */
export async function readPhotoFile(c: Context<AppEnv>): Promise<UploadedPhoto> {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new ApiError(400, 'bad_request', MULTIPART_MESSAGE);
  const raw = await readBodyBytes(c, PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES, TOO_LARGE_MESSAGE);
  let file: unknown;
  try {
    file = (await new Response(raw as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': contentType } }).formData()).get('photo');
  } catch {
    throw new ApiError(400, 'bad_request', MULTIPART_MESSAGE);
  }
  if (!(file instanceof Blob)) throw new ApiError(400, 'bad_request', '缺少欄位 photo');
  if (file.size > PHOTO_MAX_BYTES) throw new ApiError(413, 'payload_too_large', TOO_LARGE_MESSAGE);
  if (file.size === 0) throw new ApiError(400, 'bad_request', '照片是空的');
  const declaredType = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(PHOTO_MIMES as readonly string[]).includes(declaredType)) throw new ApiError(400, 'bad_request', '只接受 JPEG、PNG、WebP 照片');
  const original = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(original);
  if (sniffed !== declaredType) throw new ApiError(400, 'bad_request', '檔案內容和宣告的格式不符');
  const mime = sniffed as PhotoMime;
  // 中繼資料剝不掉（結構不認得）或讀不到寬高就拒絕（ARCHITECTURE §7「不合格就拒絕」）。
  const stripped = processImageMetadata(original, mime);
  if (!stripped.ok) throw new ApiError(400, 'bad_request', '無法處理這張照片的檔案格式，請重新拍照，或存成 JPEG 後再上傳');
  const bytes = stripped.bytes;
  const dims = imageDimensions(bytes, mime);
  if (!dims || dims.width <= 0 || dims.height <= 0) throw new ApiError(400, 'bad_request', '讀不到照片的寬高，請重新拍照，或存成 JPEG 後再上傳');
  if (Math.max(dims.width, dims.height) > PHOTO_SERVER_MAX_EDGE_PX) {
    throw new ApiError(400, 'bad_request', `照片尺寸太大（長邊最多 ${PHOTO_SERVER_MAX_EDGE_PX} 像素），請縮小後再上傳`);
  }
  return { mime, bytes, width: dims.width, height: dims.height, sha256: await sha256Hex(bytes) };
}

/** D1 的 BLOB 參數：只取這張照片自己的位元組（Uint8Array 可能是更大 buffer 的一段）。 */
export function photoBlob(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
