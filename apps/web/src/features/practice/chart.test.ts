/**
 * 圖表題的純函式：文字版與資料表要和 tools/student_view.py 逐字相同（證據句靠它反查資料點）、刻度、授權寫法、斷行。
 */
import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../../data/bank';
import {
  chartHasData,
  chartTableRows,
  chartTextLines,
  evidencePoints,
  evidenceRows,
  isChartEvidence,
  licenseLabel,
  licenseUrl,
  niceScale,
  pointKey,
  tickLabel,
  withUnit,
  wrapText,
} from './chart';
import { group } from './testFixtures';

const lineChart = (): ChartSpec => {
  const chart = group('ai.rd.0c1d2e@1').group.figures[0]?.chart;
  if (!chart) throw new Error('範例缺少圖表');
  return chart;
};

describe('文字版與資料表（和 student_view.py 相同）', () => {
  it('每個資料點一行：類別, 數列: 數值 單位', () => {
    const lines = chartTextLines(lineChart());
    expect(lines.slice(0, 4)).toEqual([
      '折線圖：Children who die before age 5, 1990–2020',
      '橫軸：Year',
      '數值：Deaths before age 5（單位：per 1,000 live births）',
      '數列：World、South Asia、Sub-Saharan Africa',
    ]);
    expect(lines).toContain('2020, Sub-Saharan Africa: 75.9 per 1,000 live births');
    // 90.0 在 JSON 裡就是 90，不帶小數點。
    expect(lines).toContain('2000, South Asia: 90 per 1,000 live births');
    expect(lines.at(-2)).toBe('附註：Each line shows the rate for the region as a whole.');
    expect(lines.at(-1)).toBe(
      '資料來源：World Bank, World Development Indicators: Mortality rate, under-5 (per 1,000 live births)（CC-BY-4.0）',
    );
  });

  it('只有一個數列：一行只寫類別；% 單位直接接在數字後面', () => {
    const chart: ChartSpec = { ...lineChart(), type: 'pie', y: { label: 'Share', unit: '%' }, categories: ['Homes', 'Shops'], series: [{ name: 'Waste', values: [60, 40] }] };
    expect(chartTextLines(chart)).toContain('Homes: 60%');
    expect(chartTextLines(chart)[1]).toBe('類別：Year');
  });

  it('資料表：第一列表頭（軸名與單位），之後每個類別一列', () => {
    expect(chartTableRows(lineChart())).toEqual([
      ['Year', 'World (per 1,000 live births)', 'South Asia (per 1,000 live births)', 'Sub-Saharan Africa (per 1,000 live births)'],
      ['1990', '93.5', '128.6', '178.5'],
      ['2000', '76.7', '90', '150.4'],
      ['2010', '50.6', '56.3', '97.2'],
      ['2020', '39.2', '32.4', '75.9'],
    ]);
  });
});

describe('證據句引用的資料點', () => {
  it('文字版的一行 → 一個點；資料表的一列 → 那個類別的所有點；選文的句子 → 沒有', () => {
    const chart = lineChart();
    expect([...evidencePoints(chart, ['2020, Sub-Saharan Africa: 75.9 per 1,000 live births'])]).toEqual([pointKey(3, 2)]);
    expect([...evidencePoints(chart, ['1990 | 93.5 | 128.6 | 178.5'])].sort()).toEqual(['0:0', '0:1', '0:2']);
    expect(evidencePoints(chart, ['Sub-Saharan Africa also improved a great deal, from 178.5 to 75.9.']).size).toBe(0);
    // 空白、結尾句點的差異不影響。
    expect(isChartEvidence(chart, '  2020,  Sub-Saharan Africa: 75.9 per 1,000 live births. ')).toBe(true);
  });

  it('表格（kind: table）的一列，儲存格以 " | " 相接', () => {
    const rows = [
      ['Shop', 'Open', 'Price'],
      ['Café A', '8:00', '$3'],
      ['Café B', '9:00', '$4'],
    ];
    expect([...evidenceRows(rows, ['Café B | 9:00 | $4'])]).toEqual([1]);
    expect(evidenceRows(rows, ['Shop | Open | Price']).size).toBe(0);
  });
});

describe('刻度與文字', () => {
  it('刻度是 1、2、2.5、5 × 10ⁿ，一定包含 0', () => {
    expect(niceScale([93.5, 178.5, 32.4])).toEqual({ min: 0, max: 200, step: 50, ticks: [0, 50, 100, 150, 200] });
    expect(niceScale([3, 7]).ticks).toEqual([0, 2, 4, 6, 8]);
  });

  it('負數：刻度往下延伸到負值', () => {
    const scale = niceScale([-12, 30]);
    expect(scale.min).toBeLessThan(0);
    expect(scale.min).toBeLessThanOrEqual(-12);
    expect(scale.ticks).toContain(0);
    expect(scale.max).toBeGreaterThanOrEqual(30);
  });

  it('全部是 0 或沒有數字：0–1', () => {
    expect(niceScale([0, 0]).ticks.at(0)).toBe(0);
    expect(niceScale([]).max).toBeGreaterThan(0);
  });

  it('刻度文字依間距決定小數位數、加千分位', () => {
    expect(tickLabel(1500, 500)).toBe('1,500');
    expect(tickLabel(0.5, 0.25)).toBe('0.50');
    expect(tickLabel(2.5, 2.5)).toBe('2.5');
  });

  it('授權寫法（Creative Commons 的寫法：CC BY-SA 4.0）與授權條款網址', () => {
    expect(licenseLabel('CC-BY-4.0')).toBe('CC BY 4.0');
    expect(licenseLabel('CC-BY-SA-3.0')).toBe('CC BY-SA 3.0');
    expect(licenseLabel('CC-BY-SA-4.0')).toBe('CC BY-SA 4.0');
    expect(licenseLabel('OGDL-Taiwan-1.0')).toBe('政府資料開放授權條款第1版');
    expect(licenseLabel('UN terms of use')).toBe('UN terms of use');
    expect(licenseUrl('CC-BY-4.0')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(licenseUrl('CC-BY-SA-3.0')).toBe('https://creativecommons.org/licenses/by-sa/3.0/');
    expect(licenseUrl('CC-BY-SA-4.0')).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(licenseUrl('OGDL-Taiwan-1.0')).toBe('https://data.gov.tw/license');
    expect(licenseUrl('UN terms of use')).toBeNull();
    expect(licenseUrl('original-ai')).toBeNull();
  });

  it('單位與斷行', () => {
    expect(withUnit('41.2', '%')).toBe('41.2%');
    expect(withUnit('41.2', 'kg')).toBe('41.2 kg');
    expect(withUnit('41.2', null)).toBe('41.2');
    expect(wrapText('Sub-Saharan Africa', 60)).toEqual(['Sub-Saharan', 'Africa']);
    expect(wrapText('a b c d e f g h', 10, 12, 2)).toHaveLength(2);
  });

  it('有沒有資料可以畫', () => {
    expect(chartHasData(lineChart())).toBe(true);
    expect(chartHasData({ categories: [], series: [] })).toBe(false);
    expect(chartHasData({ categories: ['a'], series: [] })).toBe(false);
  });
});
