import { PHOTO_MAX_BYTES, PHOTO_MAX_LONG_EDGE_PX } from '@gsat/shared';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUALITIES, PhotoTooLargeError, compressToLimit, fitWithin, formatBytes, photoQualityIssue, type Size } from './photo';

describe('fitWithin', () => {
  it('等比例縮到長邊 1600（直式、橫式都一樣）', () => {
    expect(fitWithin({ width: 4032, height: 3024 }, PHOTO_MAX_LONG_EDGE_PX)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin({ width: 3024, height: 4032 }, PHOTO_MAX_LONG_EDGE_PX)).toEqual({ width: 1200, height: 1600 });
  });

  it('本來就夠小的不放大', () => {
    expect(fitWithin({ width: 1200, height: 900 }, 1600)).toEqual({ width: 1200, height: 900 });
    expect(fitWithin({ width: 1600, height: 1600 }, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('極端比例也至少 1 px；尺寸不合法就丟錯', () => {
    expect(fitWithin({ width: 10000, height: 2 }, 1600)).toEqual({ width: 1600, height: 1 });
    expect(() => fitWithin({ width: 0, height: 100 }, 1600)).toThrow(RangeError);
    expect(() => fitWithin({ width: Number.NaN, height: 100 }, 1600)).toThrow(RangeError);
  });
});

/** 假編碼器：輸出大小 ＝ 像素數 × 品質 × 係數（真實 JPEG 也大致隨像素與品質遞增）。 */
function fakeEncoder(bytesPerPixelAtQ1: number) {
  // 不真的配置記憶體（「放棄」的測試會算出好幾 GB）：只需要 size。
  return vi.fn(async (size: Size, quality: number) => ({ size: Math.round(size.width * size.height * quality * bytesPerPixelAtQ1) }) as Blob);
}

describe('compressToLimit', () => {
  it('第一個品質就符合時只編碼一次，而且先縮到長邊 1600', async () => {
    const encode = fakeEncoder(0.2);
    const r = await compressToLimit({ width: 4000, height: 3000 }, encode);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith({ width: 1600, height: 1200 }, DEFAULT_QUALITIES[0]);
    expect(r).toMatchObject({ width: 1600, height: 1200, quality: 0.9, attempts: 1 });
    expect(r.blob.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
  });

  it('品質由高往低逐步降低，直到 ≤1.2 MB', async () => {
    // 1600×1200＝1,920,000 px；係數 0.8 → q=0.9 約 1.38 MB、0.8 約 1.23 MB、0.75 約 1.15 MB（第一個符合）
    const encode = fakeEncoder(0.8);
    const r = await compressToLimit({ width: 1600, height: 1200 }, encode);
    expect(encode.mock.calls.map(([, q]) => q)).toEqual([0.9, 0.85, 0.8, 0.75]);
    expect(r.quality).toBe(0.75);
    expect(r.blob.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
    expect(r.attempts).toBe(4);
  });

  it('最低品質還是太大：再縮小尺寸重來', async () => {
    const encode = fakeEncoder(2);
    const r = await compressToLimit({ width: 1600, height: 1200 }, encode, { qualities: [0.8, 0.6] });
    expect(r.blob.size).toBeLessThanOrEqual(PHOTO_MAX_BYTES);
    expect(Math.max(r.width, r.height)).toBeLessThan(1600);
    // 長寬比不變
    expect(r.width / r.height).toBeCloseTo(4 / 3, 2);
  });

  it('縮到太小仍然超過上限就放棄（字會糊到無法辨識）', async () => {
    const encode = fakeEncoder(1000);
    await expect(compressToLimit({ width: 1600, height: 1200 }, encode, { minEdge: 800 })).rejects.toBeInstanceOf(PhotoTooLargeError);
  });

  it('自訂上限', async () => {
    const encode = fakeEncoder(0.5);
    const r = await compressToLimit({ width: 1000, height: 1000 }, encode, { maxBytes: 300_000, qualities: [0.9, 0.7, 0.5] });
    expect(r.quality).toBe(0.5);
    expect(r.blob.size).toBe(250_000);
  });
});

describe('formatBytes', () => {
  it('KB 與 MB', () => {
    expect(formatBytes(850_000)).toBe('850 KB');
    expect(formatBytes(1_150_000)).toBe('1.1 MB');
    expect(formatBytes(10)).toBe('1 KB');
  });
});

describe('photoQualityIssue（送出辨識前提醒，避免白扣點數）', () => {
  it('一般手機照片縮圖後沒問題', () => {
    expect(photoQualityIssue({ width: 1600, height: 1200 })).toBeNull();
    expect(photoQualityIssue({ width: 1200, height: 1600 })).toBeNull();
    expect(photoQualityIssue({ width: 800, height: 600 })).toBeNull();
  });

  it('太小（短邊 < 600）或太窄長（長截圖，長寬比 > 3）都提醒', () => {
    expect(photoQualityIssue({ width: 40, height: 30 })).toBe('too_small');
    expect(photoQualityIssue({ width: 640, height: 480 })).toBe('too_small');
    // 300×9000 的長截圖縮到長邊 1600 → 53×1600
    expect(photoQualityIssue(fitWithin({ width: 300, height: 9000 }, PHOTO_MAX_LONG_EDGE_PX))).toBe('too_narrow');
    expect(photoQualityIssue({ width: 1600, height: 500 })).toBe('too_narrow');
  });
});
