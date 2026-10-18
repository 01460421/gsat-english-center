/**
 * D8 指紋的 Worker 端（src/ai/d8.ts；docs/design/custom-essay.md §2.4.5、§7.3）：
 *   - 正規形式、窗口、cyrb53、位置合併和 packages/shared/scripts/d8-fingerprint.mjs（產生器用的那份）對一批字串逐一相同；
 *   - 產生器的編碼（packFingerprints）→ Worker 的解碼（parseFingerprints）來回一致；壞檔一律回 null（fail closed）；
 *   - ranges 換算：移除空白前後的索引對照、中英混合、多段命中合併、最多 5 段；
 *   - 打包的真指紋檔（pretest 由產生器產生）解得開、筆數在下限以上。
 * 不讀 data/：真實資料的斷言在 packages/shared/src/custom-essay.data.test.ts。
 */
import { describe, expect, it } from 'vitest';
import * as mjs from '../../../packages/shared/scripts/d8-fingerprint.mjs';
import { D8_MIN_COUNTS } from '../scripts/build-writing-prompts.mjs';
import { cyrb53, d8EnglishWindows, d8Fingerprints, d8Hash, d8HanWindows, d8Ranges, mergeRanges, officialMaterialHits, parseFingerprints } from '../src/ai/d8';
import { fakeFingerprintFile, FAKE_OFFICIAL_EN, FAKE_OFFICIAL_ZH } from './helpers/customEssay';

const FULL_WIDTH_SPACE = String.fromCodePoint(0x3000);
const SAMPLES = [
  '本題旨在評量考生能否依照圖片內容寫出結構完整的短文',
  `本 題 旨 在 評 量 考 生 能 否${FULL_WIDTH_SPACE}依 照 圖 片`,
  '本題旨在評量考生能否依\n照圖片內容寫出\n結構完整的短文',
  'The students should de-\nscribe the pictures in two well organized paragraphs, and it’s fine.',
  'Ｆｕｌｌ ｗｉｄｔｈ letters and 全形數字１２３ mixed with 中文的句子在這裡測試一下',
  '提示：請以 My Favorite Place 為題，寫一篇英文作文，描述這個地方的樣子以及你喜歡它的原因。',
  `${FAKE_OFFICIAL_ZH}。${FAKE_OFFICIAL_EN}`,
  '',
];

describe('TS 移植和 d8-fingerprint.mjs 逐字串相同', () => {
  it.each(SAMPLES.map((s) => [JSON.stringify(s).slice(0, 40), s] as const))('%s', (_label, s) => {
    expect(d8HanWindows(s)).toEqual(mjs.d8HanWindows(s));
    expect(d8EnglishWindows(s)).toEqual(mjs.d8EnglishWindows(s));
    expect(cyrb53(s)).toBe(mjs.cyrb53(s));
    expect(d8Hash('han', s)).toBe(mjs.d8Hash('han', s));
    expect(d8Hash('en', s)).toBe(mjs.d8Hash('en', s));
  });

  it('mergeRanges、d8Ranges 相同', () => {
    const ranges: Array<[number, number]> = [[9, 12], [0, 3], [2, 5], [20, 21], [30, 31], [40, 41], [50, 51]];
    expect(mergeRanges(ranges)).toEqual(mjs.mergeRanges(ranges));
    const sets = { han: new Set(mjs.d8HanWindows(FAKE_OFFICIAL_ZH).map((w) => mjs.d8Hash('han', w.window))), en: new Set(mjs.d8EnglishWindows(FAKE_OFFICIAL_EN).map((w) => mjs.d8Hash('en', w.window))) };
    for (const s of SAMPLES) expect(d8Ranges(s, sets)).toEqual(mjs.d8Ranges(s, sets));
  });
});

describe('指紋檔：編碼與解碼', () => {
  it('產生器的編碼 → Worker 的解碼來回一致；version 原樣保留', () => {
    const file = fakeFingerprintFile();
    const fp = parseFingerprints(file)!;
    expect(fp).not.toBeNull();
    expect(fp.version).toBe('test-fp-0001');
    expect([...fp.han].sort((a, b) => a - b)).toEqual(mjs.unpackFingerprints(file.han));
    expect([...fp.en].sort((a, b) => a - b)).toEqual(mjs.unpackFingerprints(file.en));
    expect(fp.han.size).toBe(file.count.han);
  });

  it('壞檔回 null：格式或檔頭不對、base64 解不開、長度不是 7 的倍數、筆數是 0 或和檔頭不符、不是物件', () => {
    const good = fakeFingerprintFile();
    const bad: unknown[] = [
      null,
      'gsat-d8-fp/v2',
      { ...good, format: 'gsat-d8-fp/v1' },
      { ...good, han_window: 7 },
      { ...good, english_run: 8 },
      { ...good, version: 3 },
      { ...good, count: null },
      { ...good, han: '!!!' },
      { ...good, han: Buffer.from([1, 2, 3, 4]).toString('base64') },
      { ...good, en: '', count: { han: good.count.han, en: 0 } },
      { ...good, count: { han: good.count.han - 1, en: good.count.en } },
    ];
    for (const b of bad) expect(parseFingerprints(b), JSON.stringify(b)?.slice(0, 60)).toBeNull();
  });
});

describe('命中位置（ranges）', () => {
  const fp = parseFingerprints(fakeFingerprintFile())!;

  it('移除空白前後用索引對照表換算：每個字之間插空白時，range 涵蓋學生自己文字裡的那一段', () => {
    const spaced = [...FAKE_OFFICIAL_ZH.slice(0, 10)].join(' ');
    const text = `題目：無手機日\n${spaced}`;
    const ranges = d8Ranges(text, fp);
    expect(ranges).toHaveLength(1);
    const [s, e] = ranges[0]!;
    expect(text.slice(s, e)).toBe(spaced);
  });

  it('中英混合、多段命中合併、最多 5 段；officialMaterialHits 回傳第一個命中的欄位（題目欄優先）', () => {
    const zh = FAKE_OFFICIAL_ZH.slice(0, 9);
    const text = `${zh}。中間。${FAKE_OFFICIAL_EN}。${zh}`;
    const ranges = d8Ranges(text, fp);
    expect(ranges.map(([s, e]) => text.slice(s, e))).toEqual([zh, FAKE_OFFICIAL_EN, zh]);
    const many = Array.from({ length: 7 }, () => zh).join('。');
    expect(d8Ranges(many, fp)).toHaveLength(5);
    expect(officialMaterialHits(fp, '正常的題目文字，請寫一篇英文作文。', `圖：${zh}`)).toEqual({ field: 'figure_text', ranges: [[2, 11]] });
    expect(officialMaterialHits(fp, zh, zh)?.field).toBe('text');
    expect(officialMaterialHits(fp, '正常的題目文字，請寫一篇英文作文。', null)).toBeNull();
  });
});

it('打包的真指紋檔（產生器由 data/exams/parsed 產生）解得開、筆數在下限以上', () => {
  const real = d8Fingerprints();
  expect(real).not.toBeNull();
  expect(real!.han.size).toBeGreaterThanOrEqual(D8_MIN_COUNTS.han);
  expect(real!.en.size).toBeGreaterThanOrEqual(D8_MIN_COUNTS.en);
  expect(real!.version).toMatch(/^[0-9a-f]{12}$/);
});
