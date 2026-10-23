/** 拍照的框選數值（lib/crop.ts 的純函式；canvas 的部分在 e2e 用真的瀏覽器測）。 */
import { describe, expect, it } from 'vitest';
import { clampInsets, cropPixels, FULL_PHOTO, insetsFromDrag, isFullPhoto, outputSize } from './crop';

describe('clampInsets', () => {
  it('整數化、0–90；對邊加起來至少留 10%（縮小剛改的那一邊）', () => {
    expect(clampInsets({ top: 12.4, bottom: -3, left: 200, right: Number.NaN })).toEqual({ top: 12, bottom: 0, left: 90, right: 0 });
    expect(clampInsets({ top: 50, bottom: 50, left: 0, right: 0 }, 'top')).toEqual({ top: 40, bottom: 50, left: 0, right: 0 });
    expect(clampInsets({ top: 50, bottom: 50, left: 0, right: 0 }, 'bottom')).toEqual({ top: 50, bottom: 40, left: 0, right: 0 });
    expect(clampInsets({ top: 0, bottom: 0, left: 70, right: 70 })).toEqual({ top: 0, bottom: 0, left: 70, right: 20 });
  });

  it('使用整張', () => {
    expect(isFullPhoto(FULL_PHOTO)).toBe(true);
    expect(isFullPhoto({ ...FULL_PHOTO, left: 1 })).toBe(false);
  });
});

describe('insetsFromDrag', () => {
  it('起點與終點順序不拘；超出圖片的部分夾到邊上', () => {
    expect(insetsFromDrag({ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.7 })).toEqual({ top: 20, bottom: 30, left: 10, right: 10 });
    expect(insetsFromDrag({ x: 0.9, y: 0.7 }, { x: 0.1, y: 0.2 })).toEqual({ top: 20, bottom: 30, left: 10, right: 10 });
    expect(insetsFromDrag({ x: -0.5, y: -1 }, { x: 1.5, y: 2 })).toEqual(FULL_PHOTO);
  });

  it('太小的框擴到最小範圍（至少 10%）', () => {
    const c = insetsFromDrag({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.51 });
    expect(100 - c.top - c.bottom).toBeGreaterThanOrEqual(10);
    expect(100 - c.left - c.right).toBeGreaterThanOrEqual(10);
  });
});

describe('cropPixels／outputSize', () => {
  it('依百分比算出原圖上的範圍（整數、不超出邊界）', () => {
    expect(cropPixels({ width: 4000, height: 3000 }, { top: 10, bottom: 20, left: 25, right: 25 })).toEqual({ sx: 1000, sy: 300, sw: 2000, sh: 2100 });
    expect(cropPixels({ width: 3, height: 3 }, FULL_PHOTO)).toEqual({ sx: 0, sy: 0, sw: 3, sh: 3 });
  });

  it('輸出等比例縮到長邊 ≤ 3,200 px，不放大', () => {
    expect(outputSize(4000, 2000)).toEqual({ width: 3200, height: 1600 });
    expect(outputSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
