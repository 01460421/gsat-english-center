/**
 * 學習報告的目標資料（docs/design/learning-assistant.md §3.2.1–§3.2.2；§6.2 assist.targets.test.ts）。
 *
 * build-assist-data.mjs 讀版控裡的官方統計（data/exams），輸出要和設計文件的表一致；13、11、8 級分的各大題目標合計
 * 和各年原始分數下限相差 ≤ 3 分（內插方法的自我檢查）。設計文件的表是先把五等分組四捨五入到整數再內插，所以逐格允許 ±1。
 */
import { readFileSync } from 'node:fs';
import { ASSIST_STANDARD_LEVELS } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { buildAssistTargets, OUT_FILE, readInputs, YEARS } from '../scripts/build-assist-data.mjs';
import { sectionTarget, standardsMatchShared, targetTotal, type AssistTargets } from '../src/assist/facts';

const targets = buildAssistTargets(readInputs()) as unknown as AssistTargets;

describe('build-assist-data.mjs 的輸出（§3.2.1 的表）', () => {
  it('打包進 Worker 的檔案就是這份輸出（pretest 產生）', () => {
    expect(JSON.parse(readFileSync(OUT_FILE, 'utf8'))).toEqual(targets);
  });

  it('六個選擇題大題、五個五等分組的平均答對率（四捨五入到整數）', () => {
    const rounded = Object.fromEntries(Object.entries(targets.mc_quintiles).map(([k, v]) => [k, v.map((x) => Math.round(x))]));
    expect(rounded).toEqual({
      vocabulary: [78, 63, 48, 34, 25],
      cloze: [78, 59, 43, 30, 24],
      word_bank: [87, 65, 44, 23, 11],
      structure: [87, 66, 46, 31, 21],
      reading: [87, 72, 56, 39, 24],
      mixed: [83, 67, 50, 33, 18],
    });
    // 設計文件的表寫 62（詞彙 Pb）：62.5 在表裡捨去，這裡四捨五入成 63；其他逐格相同。
  });

  it('官方題的難度比例（基礎／進階／頂標，%）', () => {
    const pct = Object.fromEntries(Object.entries(targets.tier_weights).map(([k, v]) => [k, [v.basic, v.advanced, v.top].map((x) => Math.round(x * 100))]));
    expect(pct).toEqual({
      vocabulary: [46, 28, 26],
      cloze: [38, 30, 32],
      word_bank: [40, 34, 26],
      structure: [40, 40, 20],
      reading: [53, 30, 17],
      mixed: [60, 20, 20],
    });
  });

  it('級分以上的人數百分比（五年平均）與非選擇題分數帶下限', () => {
    const top = (l: number) => Math.round(targets.level_top_pct[String(l)]! * 10) / 10;
    expect([15, 14, 13, 12, 11, 10, 9, 8].map(top)).toEqual([3.1, 8.4, 15.2, 22.7, 30.4, 37.9, 45.5, 53.0]);
    expect(targets.nonmc_bands.translation).toEqual({ top12: 5.6, top25: 4.4, median: 2.8, max: 8 });
    expect(targets.nonmc_bands.essay).toEqual({ top12: 13.4, top25: 11.6, median: 8.4, max: 20 });
  });

  it('五標取最近一年（115），和 shared 的 ASSIST_STANDARD_LEVELS 一致；原始分數下限逐年都有', () => {
    expect(targets.standards).toEqual({ year: 115, top: 13, front: 11, mean: 8, back: 5, floor: 3 });
    expect(standardsMatchShared(targets)).toBe(true);
    expect(ASSIST_STANDARD_LEVELS.year).toBe(115);
    expect(targets.raw_lower['115']!['13']).toBe(73.17);
    for (const y of YEARS) expect(Object.keys(targets.raw_lower[String(y)]!)).toHaveLength(15);
  });
});

describe('目標的內插（§3.2.2 的例子）', () => {
  const pct = (x: number) => Math.round(x * 100);
  it.each([
    [13, { vocabulary: 74, cloze: 73, word_bank: 81, structure: 82, reading: 83, mixed: 79 }, 5.3, 13.0],
    [11, { vocabulary: 62, cloze: 59, word_bank: 65, structure: 66, reading: 72, mixed: 67 }, 4.1, 10.9],
    [8, { vocabulary: 46, cloze: 41, word_bank: 41, structure: 44, reading: 53, mixed: 47 }, 2.8, 8.4],
  ] as const)('%i 級分：各大題目標同設計文件的表（±1）', (level, mc, tr, es) => {
    for (const [section, expected] of Object.entries(mc)) {
      expect(Math.abs(pct(sectionTarget(section as keyof typeof mc, level, targets).value) - expected), section).toBeLessThanOrEqual(1);
    }
    expect(Math.round(sectionTarget('translation', level, targets).value * 10) / 10).toBe(tr);
    expect(Math.round(sectionTarget('composition', level, targets).value * 10) / 10).toBe(es);
  });

  it.each([13, 11, 8])('%i 級分：各大題目標換成分數合計，和 111–115 每一年的原始分數下限相差 ≤ 3 分', (level) => {
    const total = targetTotal(level, targets);
    for (const y of YEARS) expect(Math.abs(total - targets.raw_lower[String(y)]![String(level)]!), `${y} 年`).toBeLessThanOrEqual(3);
  });

  it('前 10% 以內取最高一組（不外插，標作為下限）；後 10% 取最低一組', () => {
    const top15 = sectionTarget('reading', 15, targets);
    expect(top15.floor).toBe(true);
    expect(top15.value).toBeCloseTo(targets.mc_quintiles.reading[0]! / 100, 5);
    const low = sectionTarget('reading', 3, targets);
    expect(low.floor).toBe(false);
    expect(low.value).toBeCloseTo(targets.mc_quintiles.reading[4]! / 100, 5);
    expect(sectionTarget('composition', 15, targets)).toEqual({ value: 13.4, floor: true });
  });
});
