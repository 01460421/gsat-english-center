/**
 * 拍照問題目的框選（docs/design/learning-assistant.md §1.6 第 2 步、§5.2 PhotoCrop）：上傳前只留題目的範圍。
 *
 * 框選用四個「裁掉上／下／左／右 %」表示（滑桿與拖曳共用同一份數值，鍵盤也能操作）。拆成兩層：
 *   clampInsets、insetsFromDrag、cropPixels  純函式（單元測試）
 *   cropPhotoFile                           瀏覽器專用：從原圖裁出那一塊畫到 canvas、編成 JPEG；之後交給 resizePhotoFile
 *                                           （長邊 ≤ 1600 px、≤ 1.2 MB、去 EXIF）再上傳。從原圖裁，小範圍的字才不會糊。
 */
import { PhotoDecodeError } from '../../writing/lib/photo';

/** 四邊各裁掉幾 %（0–90 的整數）。 */
export interface CropInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const FULL_PHOTO: CropInsets = { top: 0, bottom: 0, left: 0, right: 0 };
/** 至少留下 10%（寬與高各自）。 */
export const CROP_MIN_KEEP = 10;
/** 裁出的那一塊編碼前的長邊上限（之後還會再縮到 1600 px；留兩倍讓縮圖有東西可縮）。 */
const CROP_MAX_EDGE_PX = 3_200;

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : 0)));

/** 整數化並保證至少留 CROP_MIN_KEEP%：對邊加起來超過時，縮小剛改的那一邊（changed）；沒說就縮小 bottom／right。 */
export function clampInsets(c: CropInsets, changed?: keyof CropInsets): CropInsets {
  const max = 100 - CROP_MIN_KEEP;
  const out = { top: clampInt(c.top, 0, max), bottom: clampInt(c.bottom, 0, max), left: clampInt(c.left, 0, max), right: clampInt(c.right, 0, max) };
  const fix = (a: 'top' | 'left', b: 'bottom' | 'right') => {
    const over = out[a] + out[b] - max;
    if (over <= 0) return;
    if (changed === a) out[a] -= over;
    else out[b] -= over;
  };
  fix('top', 'bottom');
  fix('left', 'right');
  return out;
}

export function isFullPhoto(c: CropInsets): boolean {
  return c.top === 0 && c.bottom === 0 && c.left === 0 && c.right === 0;
}

/** 拖曳的起點與終點（相對於圖片框的 0–1 座標，順序不拘）→ 四邊的 %。太小的框（< 最小範圍）擴到最小範圍。 */
export function insetsFromDrag(a: { x: number; y: number }, b: { x: number; y: number }): CropInsets {
  const frac = (v: number) => Math.min(1, Math.max(0, v));
  const [x0, x1] = [frac(Math.min(a.x, b.x)), frac(Math.max(a.x, b.x))];
  const [y0, y1] = [frac(Math.min(a.y, b.y)), frac(Math.max(a.y, b.y))];
  return clampInsets({ top: y0 * 100, bottom: (1 - y1) * 100, left: x0 * 100, right: (1 - x1) * 100 });
}

/** 原圖上要裁的那一塊（像素，整數，至少 1×1）。 */
export function cropPixels(size: { width: number; height: number }, c: CropInsets): { sx: number; sy: number; sw: number; sh: number } {
  const k = clampInsets(c);
  const sx = Math.round((size.width * k.left) / 100);
  const sy = Math.round((size.height * k.top) / 100);
  const sw = Math.max(1, Math.round((size.width * (100 - k.left - k.right)) / 100));
  const sh = Math.max(1, Math.round((size.height * (100 - k.top - k.bottom)) / 100));
  return { sx, sy, sw: Math.min(sw, size.width - sx), sh: Math.min(sh, size.height - sy) };
}

/** 輸出尺寸：等比例縮到長邊 ≤ maxEdge（不放大）。 */
export function outputSize(sw: number, sh: number, maxEdge = CROP_MAX_EDGE_PX): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  return { width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) };
}

// ───────────────────────── 瀏覽器專用 ─────────────────────────

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  // createImageBitmap 依 EXIF 轉正（和預覽的 <img> 看到的方向一致）。
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // 舊版 Safari 不支援某些格式或選項，改用 <img>。
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

/** 從原圖裁出框選的範圍（JPEG）；使用整張時原檔照用（縮圖時再重新編碼、去 EXIF）。 */
export async function cropPhotoFile(file: File, insets: CropInsets): Promise<File> {
  if (isFullPhoto(insets)) return file;
  const image = await decode(file);
  try {
    const { sx, sy, sw, sh } = cropPixels(image, insets);
    const size = outputSize(sw, sh);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoDecodeError();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(image.source, sx, sy, sw, sh, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoDecodeError())), 'image/jpeg', 0.92));
    canvas.width = 0;
    canvas.height = 0;
    return new File([blob], 'question.jpg', { type: 'image/jpeg' });
  } finally {
    image.close();
  }
}
