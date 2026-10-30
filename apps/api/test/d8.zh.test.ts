/**
 * D8 國文版（docs/design/assistant-subjects.md §5.7；§11.1 的 d8.zh.test.ts）：
 *   - Worker 的雜湊、樣板遮罩和 packages/shared/scripts/d8-zh-fingerprint.mjs（產生器）逐字串相同；
 *   - d8-fingerprints.json 的 zh 鍵：解碼、壞檔一律回 null（fail closed）；打包的真檔解得開、筆數在下限以上；英文的集合與版本不變；
 *   - 比對：輸入同一區塊 ≥ 2 個不同窗口才算、輸出 1 個就算、樣板遮掉不算、異體字碼也對得上；評分原則的句型；短答 3 字組包含率；
 *   - 產生器的 buildZhD8Bundle、buildZhClassics。
 * 誘餌都是本站自寫的句子（helpers/zh.ts），不用任何官方文字；真檔只有雜湊。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { packFingerprints } from '../../../packages/shared/scripts/d8-fingerprint.mjs';
import * as zmjs from '../../../packages/shared/scripts/d8-zh-fingerprint.mjs';
import { buildZhClassics, buildZhD8Bundle, ZH_CLASSICS_MAX_BYTES } from '../scripts/build-writing-prompts.mjs';
import fpJson from '../src/generated/d8-fingerprints.json';
import {
  d8Fingerprints,
  d8HanWindows,
  d8ZhFingerprints,
  d8ZhGramHash,
  d8ZhWindowHash,
  maskZhBoilerplate,
  parseFingerprints,
  parseZhFingerprints,
  resetD8ForTests,
} from '../src/ai/d8';
import { zhD8Hit, zhOfficialMaterialHits, zhOfficialStyleHit, zhShortAnswerContainment, zhShortAnswerHit } from '../src/assist/subjects/chinese/d8';
import { ZH_DECOY_OFFICIAL, ZH_DECOY_SHORT_ANSWER, ZH_SHORT_PASSAGE, zhDecoyFingerprints } from './helpers/zh';

beforeEach(() => resetD8ForTests());

const BOILERPLATE = zmjs.parseBoilerplate('# 測試用樣板\n評分原則\n參考試卷\n重編國語辭典修訂本\n');

describe('Worker 的國文雜湊與遮罩和產生器逐字串相同', () => {
  const samples = [ZH_DECOY_OFFICIAL, ZH_SHORT_PASSAGE, `依照評分原則逐項說明，可以查重編國語辭典修訂本的解釋`, '評 分\n原 則與參考試卷', '①素昧平生：向來不認識。', ''];
  it.each(samples.map((s) => [s.slice(0, 12), s] as const))('%s', (_label, s) => {
    for (const w of zmjs.zhD8Windows(s)) expect(d8ZhWindowHash(w)).toBe(zmjs.zhD8WindowHash(w));
    for (const g of zmjs.zhD8Grams(s)) expect(d8ZhGramHash(g)).toBe(zmjs.zhD8GramHash(g));
    const worker = [...new Set(d8HanWindows(maskZhBoilerplate(s, BOILERPLATE)).map((w) => w.window))];
    expect(worker).toEqual(zmjs.zhD8Windows(zmjs.maskBoilerplate(s, BOILERPLATE)));
    // 遮罩不改長度：位置能對回原文。
    expect(maskZhBoilerplate(s, BOILERPLATE)).toHaveLength(s.normalize('NFKC').length);
  });
});

/** 和產生器輸出同格式的 zh 鍵（誘餌造的）。 */
function zhBundle(official = [ZH_DECOY_OFFICIAL], short = [ZH_DECOY_SHORT_ANSWER]) {
  const windows = new Set(official.flatMap((t) => zmjs.zhD8Windows(t).map(zmjs.zhD8WindowHash)));
  const sets = short.map((t, i) => {
    const grams = zmjs.zhD8Grams(t).map(zmjs.zhD8GramHash);
    return { year: 'test', item: String(i + 1), alt: 0, grams: grams.length, fp: packFingerprints(grams) };
  });
  return {
    zh: {
      format: 'gsat-d8-zh/v1',
      han_window: 8,
      gram: 3,
      threshold: 0.6,
      official: { version: 'o1', count: windows.size, fp: packFingerprints(windows) },
      short: { version: 's1', count: sets.length, sets },
      boilerplate: BOILERPLATE,
    },
    zh_version: 'test-zh-bundle',
  };
}

describe('zh 鍵的解碼（parseZhFingerprints）', () => {
  it('來回一致：窗口、短答、樣板、門檻、版本', () => {
    const zh = parseZhFingerprints(zhBundle())!;
    expect(zh.version).toBe('test-zh-bundle');
    expect(zh.windows.size).toBe(zmjs.zhD8Windows(ZH_DECOY_OFFICIAL).length);
    expect(zh.short).toHaveLength(1);
    expect(zh.short[0]!.set.size).toBe(zmjs.zhD8Grams(ZH_DECOY_SHORT_ANSWER).length);
    expect(zh.boilerplate).toEqual(BOILERPLATE);
    expect(zh.threshold).toBe(0.6);
  });

  it('壞檔一律回 null（fail closed）', () => {
    const good = zhBundle();
    const bad: Array<(b: any) => void> = [
      (b) => delete b.zh,
      (b) => delete b.zh_version,
      (b) => (b.zh.format = 'gsat-d8-zh/v0'),
      (b) => (b.zh.han_window = 7),
      (b) => (b.zh.gram = 4),
      (b) => (b.zh.threshold = 0),
      (b) => (b.zh.official.count += 1),
      (b) => (b.zh.official.fp = 'abc'),
      (b) => (b.zh.official.fp = ''),
      (b) => (b.zh.short.count = 2),
      (b) => (b.zh.short.sets[0].grams += 1),
      (b) => (b.zh.short.sets = []),
      (b) => (b.zh.short.sets[0].fp = packFingerprints([1, 2, 3])),
      (b) => (b.zh.boilerplate = [1]),
    ];
    for (const [i, mutate] of bad.entries()) {
      const b = structuredClone(good);
      mutate(b);
      expect(parseZhFingerprints(b), String(i)).toBeNull();
    }
    expect(parseZhFingerprints(null)).toBeNull();
  });

  it('打包的真檔（pretest 由產生器產生）：國文集合解得開、筆數在下限以上；英文的集合與版本照舊（zh 鍵不影響英文）', () => {
    const zh = d8ZhFingerprints()!;
    expect(zh).not.toBeNull();
    expect(zh.windows.size).toBeGreaterThanOrEqual(zmjs.ZH_D8_MIN_COUNTS.windows);
    expect(zh.short.length).toBeGreaterThanOrEqual(zmjs.ZH_D8_MIN_COUNTS.shortSets);
    expect(zh.short.every((s) => s.set.size >= zmjs.ZH_D8_SHORT_MIN_GRAMS)).toBe(true);
    expect(zh.boilerplate.length).toBeGreaterThan(10);
    const { zh: _zh, zh_version: _v, ...english } = fpJson as Record<string, unknown>;
    const en = parseFingerprints(english)!;
    expect(d8Fingerprints()).toEqual(en);
    expect(zh.version).not.toBe(en.version);
  });
});

describe('比對（subjects/chinese/d8.ts）', () => {
  const zh = zhDecoyFingerprints({ boilerplate: BOILERPLATE });

  it('輸入：同一區塊 ≥ 2 個不同窗口才算；位置是學生文字裡的位置', () => {
    const one = `題目：${ZH_DECOY_OFFICIAL.slice(0, 8)}。`;
    expect(zhOfficialMaterialHits(zh, one)).toEqual([]);
    expect(zhD8Hit(one, zh)).toBe(true);
    const text = `下面是我抄的講義：${ZH_DECOY_OFFICIAL}。`;
    const ranges = zhOfficialMaterialHits(zh, text);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0]![0], ranges[0]![1])).toBe(ZH_DECOY_OFFICIAL);
    // 中間有空白與換行也一樣（正規形式去空白）。
    expect(zhOfficialMaterialHits(zh, [...ZH_DECOY_OFFICIAL].join(' ')).length).toBeGreaterThan(0);
  });

  it('樣板字串先遮掉：窗口跨過樣板就不算', () => {
    const fp = zhDecoyFingerprints({ official: ['可以查重編國語辭典修訂本的解釋'], boilerplate: BOILERPLATE });
    expect(fp.windows.size).toBeGreaterThan(0);
    expect(zhD8Hit('可以查重編國語辭典修訂本的解釋', fp)).toBe(false);
    expect(zhD8Hit('可以查重編國語辭典修訂本的解釋', { ...fp, boilerplate: [] })).toBe(true);
  });

  it('異體字碼也對得上（比對的副本套 ZH_TW_FORM_MAP；原文不改）', () => {
    const fp = zhDecoyFingerprints({ official: ['這份說明裡的溫度內容只是測試用的句子'] });
    expect(zhD8Hit('這份説明裡的温度内容只是測試用的句子', fp)).toBe(true);
  });

  it('評分原則的句型：滿分答案、部分給分答案、等級加分數區間、佳作評語；題本與段考卷頭的「配分」不算', () => {
    for (const t of ['滿分答案要寫出兩個要點。', '部分給分答案只寫出一點。', 'A+（21–25分）的文章要能完整回應。', '以下是閱卷委員評語。', '這是考生佳作的寫法。']) {
      expect(zhOfficialStyleHit(t), t).toBe(true);
    }
    for (const t of ['配分標於題末。', '二、多選題（配分 20 分）', '國寫分成知性與情意兩題。', '']) expect(zhOfficialStyleHit(t), t).toBe(false);
  });

  it('短答 3 字組：包含率 ≥ 0.6 才算；只回比例', () => {
    expect(zhShortAnswerContainment(ZH_DECOY_SHORT_ANSWER, zh)).toBe(1);
    expect(zhShortAnswerHit('他們想守住桃源的祕密，免得外人前來擾亂', zh)).toBe(true);
    const low = zhShortAnswerContainment('漁人離開以後再也找不到原來的路', zh);
    expect(low).toBeLessThan(0.6);
    expect(zhShortAnswerHit('漁人離開以後再也找不到原來的路', zh)).toBe(false);
    expect(zhShortAnswerHit('', zh)).toBe(false);
    expect(zhShortAnswerHit(ZH_DECOY_SHORT_ANSWER, { ...zh, short: [] })).toBe(false);
  });
});

describe('產生器（build-writing-prompts.mjs）', () => {
  it('buildZhD8Bundle：讀 data/d8 的兩份指紋檔與樣板清單，格式和 Worker 的解碼相符', () => {
    const bundle = buildZhD8Bundle();
    expect(bundle.zh.format).toBe('gsat-d8-zh/v1');
    expect(bundle.zh_version).toMatch(/^[0-9a-f]{12}$/);
    const parsed = parseZhFingerprints(bundle)!;
    expect(parsed.windows.size).toBe(bundle.zh.official.count);
    expect(parsed.short).toHaveLength(bundle.zh.short.count);
    // 只有雜湊、筆數與「年度＋子題」（子題是題號加上題本的小題標籤），沒有答案文字。
    for (const set of bundle.zh.short.sets) {
      expect(Object.keys(set).sort()).toEqual(['alt', 'fp', 'grams', 'item', 'year']);
      expect([...set.item].length).toBeLessThanOrEqual(12);
    }
  });

  it('buildZhClassics：篇數、大小在上限以內', () => {
    const c = buildZhClassics();
    expect(c.works.length).toBeGreaterThanOrEqual(100);
    expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThanOrEqual(ZH_CLASSICS_MAX_BYTES);
    expect(c.works.some((w) => w.title === '師說')).toBe(true);
  });
});
