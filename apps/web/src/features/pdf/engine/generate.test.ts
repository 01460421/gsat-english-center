/** 封面與答題卷印的線上作答網址（generate.ts 的 onlineUrlFor）。 */
import { describe, expect, it } from 'vitest';
import type { MockPdfMeta } from '../types';
import { onlineUrlFor } from './generate';

describe('onlineUrlFor', () => {
  const mockMeta: MockPdfMeta = { title: '學測英文中心模擬考', paperLabel: '115 學測英文', durationMinutes: 100 };

  it('歷屆試題 /exams/{id}、模擬考 /mock/{id}；沒有網域不印', () => {
    expect(onlineUrlFor({ id: 'gsat-115' }, {}, 'https://example.org')).toBe('https://example.org/exams/gsat-115');
    expect(onlineUrlFor({ id: 'gsat-115' }, { mockMeta }, 'https://example.org')).toBe('https://example.org/mock/gsat-115');
    expect(onlineUrlFor({ id: 'gsat-115' }, {}, undefined)).toBeNull();
  });

  it('本站自組卷在代號後面加 .p（從 PDF 進來，bank-mock §4.6）', () => {
    const sitePaper = {
      code: 'B-7Q2MK',
      tierLabel: '穩定基礎',
      assembledOn: '2026-10-19',
      dataVersion: 'v1',
      aiNotice: 'AI 出題',
      references: [],
      answers: { translation: {}, composition: { criteria: [], modelText: null }, explanations: {} },
    };
    expect(onlineUrlFor({ id: 'bk1-b-0a4c1h' }, { mockMeta: { ...mockMeta, sitePaper } }, 'https://example.org')).toBe('https://example.org/mock/bk1-b-0a4c1h.p');
  });
});
