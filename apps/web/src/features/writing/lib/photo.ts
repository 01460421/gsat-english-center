/**
 * 手寫作文照片的前端縮圖：長邊 ≤1600 px、轉 JPEG、每張 ≤1.2 MB（設計文件 §1.1「手寫照片」、writing.ts 的 PHOTO_*）。
 *
 * 為什麼在前端做：手機原圖動輒 4000 px、3–8 MB，過渡期經 Vercel 代理轉送，大本體能不能通過還沒實測；
 * D1 單列上限約 2 MB。重新編碼成 JPEG 也順便去掉 EXIF（拍攝地點等個資不會上傳）。
 *
 * 拆成兩層：
 *   fitWithin、compressToLimit  純函式，尺寸與「品質逐步降低直到符合」的迴圈可以在單元測試裡用假的編碼器驗證；
 *   resizePhotoFile            瀏覽器專用：解碼圖片、畫到 canvas、canvas.toBlob 編碼。
 */
import { PHOTO_MAX_BYTES, PHOTO_MAX_LONG_EDGE_PX, PHOTO_MIME } from '@gsat/shared';

export interface Size {
  width: number;
  height: number;
}

/** 等比例縮到長邊 ≤ maxEdge；本來就夠小的不放大。結果是至少 1 的整數。 */
export function fitWithin(size: Size, maxEdge: number): Size {
  const { width, height } = size;
  if (!(width > 0) || !(height > 0)) throw new RangeError('圖片尺寸不正確');
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface CompressOptions {
  /** 每張上限（bytes），預設 PHOTO_MAX_BYTES。 */
  maxBytes?: number;
  /** 長邊上限（px），預設 PHOTO_MAX_LONG_EDGE_PX。 */
  maxEdge?: number;
  /** 依序嘗試的 JPEG 品質（由高到低）。 */
  qualities?: readonly number[];
  /** 最低品質還是太大時，長邊每次再縮成幾倍。 */
  shrinkFactor?: number;
  /** 長邊縮到比這個還小仍然超過上限就放棄（字會糊到辨識不了）。 */
  minEdge?: number;
}

export const DEFAULT_QUALITIES = [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5] as const;

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  /** 嘗試編碼的次數（測試與除錯用）。 */
  attempts: number;
}

/** 怎麼壓都超過上限（極少見：雜訊很多的超大圖）。 */
export class PhotoTooLargeError extends Error {
  constructor() {
    super('照片壓縮後仍然太大，請重新拍一張（光線充足、只拍作文的範圍）');
    this.name = 'PhotoTooLargeError';
  }
}

/**
 * 先縮到長邊 ≤ maxEdge，再從高品質往低品質逐步編碼，第一個 ≤ maxBytes 的就用；
 * 最低品質還是太大，就把長邊再縮 shrinkFactor 倍、從頭試一次，直到長邊小於 minEdge 才放棄。
 * encode 由呼叫端提供（瀏覽器用 canvas.toBlob），所以這個函式本身不碰 DOM。
 */
export async function compressToLimit(
  source: Size,
  encode: (size: Size, quality: number) => Promise<Blob>,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const maxBytes = options.maxBytes ?? PHOTO_MAX_BYTES;
  const qualities = options.qualities ?? DEFAULT_QUALITIES;
  const shrinkFactor = options.shrinkFactor ?? 0.85;
  const minEdge = options.minEdge ?? 800;
  if (qualities.length === 0) throw new RangeError('qualities 不能是空的');
  let size = fitWithin(source, options.maxEdge ?? PHOTO_MAX_LONG_EDGE_PX);
  let attempts = 0;
  for (;;) {
    for (const quality of qualities) {
      attempts += 1;
      const blob = await encode(size, quality);
      if (blob.size <= maxBytes) return { blob, width: size.width, height: size.height, quality, attempts };
    }
    const nextEdge = Math.floor(Math.max(size.width, size.height) * shrinkFactor);
    if (nextEdge < minEdge) throw new PhotoTooLargeError();
    size = fitWithin(size, nextEdge);
  }
}

/** 縮圖後短邊小於這個值：手寫字多半糊到辨識不了。 */
export const PHOTO_MIN_SHORT_EDGE_PX = 600;
/** 長寬比超過這個值：長截圖或只拍到一條，縮到長邊 1600 後字太小。 */
export const PHOTO_MAX_ASPECT_RATIO = 3;

export type PhotoQualityIssue = 'too_small' | 'too_narrow';

/** 縮圖後的照片可能辨識不了的原因（送出前提醒，避免白扣辨識點數）；看起來沒問題回 null。 */
export function photoQualityIssue(size: Size): PhotoQualityIssue | null {
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  if (!(short > 0)) return 'too_small';
  if (long / short > PHOTO_MAX_ASPECT_RATIO) return 'too_narrow';
  if (short < PHOTO_MIN_SHORT_EDGE_PX) return 'too_small';
  return null;
}

export const PHOTO_QUALITY_MESSAGES: Record<PhotoQualityIssue, string> = {
  too_small: '照片太小，字可能看不清楚，AI 很可能辨識不出來',
  too_narrow: '照片太窄長（像長截圖），縮小後字會太小，AI 很可能辨識不出來',
};

// ───────────────────────── 瀏覽器專用 ─────────────────────────

export interface ResizedPhoto extends CompressResult {
  /** 預覽用的 object URL；不用時呼叫 URL.revokeObjectURL。 */
  previewUrl: string;
  /** 原檔大小（bytes）。 */
  originalBytes: number;
}

/** 不是圖片、或瀏覽器解碼不了（例如舊瀏覽器開 HEIC）。 */
export class PhotoDecodeError extends Error {
  constructor() {
    super('這個檔案無法當成照片開啟，請改選 JPEG 或 PNG 照片');
    this.name = 'PhotoDecodeError';
  }
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  // createImageBitmap 會依 EXIF 轉正（imageOrientation: 'from-image' 是預設值），也不必經過 <img> 與 object URL。
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // 部分瀏覽器（舊版 Safari）不支援某些格式或選項，改用 <img>。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new PhotoDecodeError();
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoDecodeError())), PHOTO_MIME, quality);
  });
}

/** 把使用者選的照片縮成可以上傳的 JPEG。 */
export async function resizePhotoFile(file: File, options: CompressOptions = {}): Promise<ResizedPhoto> {
  if (file.type !== '' && !file.type.startsWith('image/')) throw new PhotoDecodeError();
  const image = await decodeImage(file);
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoDecodeError();
    const result = await compressToLimit(
      image,
      async (size, quality) => {
        canvas.width = size.width;
        canvas.height = size.height;
        // 透明背景（PNG 截圖）轉 JPEG 會變黑，先鋪白底。
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(image.source, 0, 0, size.width, size.height);
        return canvasToJpeg(canvas, quality);
      },
      options,
    );
    // 釋放 canvas 的像素記憶體（手機上兩張 1600 px 的 canvas 不算小）。
    canvas.width = 0;
    canvas.height = 0;
    return { ...result, previewUrl: URL.createObjectURL(result.blob), originalBytes: file.size };
  } finally {
    image.close();
  }
}

/** 位元組 → 「850 KB」「1.1 MB」。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
