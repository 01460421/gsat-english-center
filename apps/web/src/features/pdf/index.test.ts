import { afterEach, describe, expect, it } from 'vitest';
import { MINI_EXAM } from '../exams/testFixtures';
import { PDF_DOWNLOAD_ENABLED, pdfDownloadVisible, pdfFileName, pdfPreviewEnabled, sitePdfOptions } from './index';
import type { MockPdfMeta, SitePaperPdfMeta } from './types';

describe('pdfFileName', () => {
  it('歷屆試題：「學測英文中心_115學測英文_題本(_含答案).pdf」', () => {
    expect(pdfFileName(MINI_EXAM, { includeAnswerKey: false })).toBe('學測英文中心_115學測英文_題本.pdf');
    expect(pdfFileName(MINI_EXAM, { includeAnswerKey: true })).toBe('學測英文中心_115學測英文_題本_含答案.pdf');
  });
  it('模擬考與參考試卷', () => {
    const meta = { title: '學測英文中心模擬考', paperLabel: '115 參考試卷', durationMinutes: 100 };
    expect(pdfFileName({ exam: 'reference', year: 115, session: 'regular', target: 'gsat' }, { includeAnswerKey: false, mockMeta: meta })).toBe('學測英文中心_模擬考_115參考試卷（學測）英文.pdf');
    expect(pdfFileName({ exam: 'ast', year: 109, session: 'makeup', target: null }, { includeAnswerKey: false })).toBe('學測英文中心_109指考補考英文_題本.pdf');
  });
});

describe('pdfFileName：本站自組卷（bank-mock §2.5）', () => {
  const site: SitePaperPdfMeta = {
    code: 'A-3KD9W',
    tierLabel: '進階練習',
    assembledOn: '2026-10-19',
    dataVersion: 'v1',
    aiNotice: 'AI 出題',
    references: [],
    answers: { translation: {}, composition: { criteria: [], modelText: null }, explanations: {} },
  };
  const mockMeta: MockPdfMeta = { title: '學測英文中心　本站自組模擬考', paperLabel: '進階練習卷　卷號 A-3KD9W', durationMinutes: 100, sitePaper: site };
  const exam = { exam: 'reference', year: 0, session: 'regular', target: 'gsat' } as const;

  it('學生卷、教師卷、題本＋答案＋解析', () => {
    expect(pdfFileName(exam, { ...sitePdfOptions('student', false), mockMeta })).toBe('學測英文中心_自組模擬考_進階練習_A-3KD9W_學生卷.pdf');
    expect(pdfFileName(exam, { ...sitePdfOptions('teacher', true), mockMeta })).toBe('學測英文中心_自組模擬考_進階練習_A-3KD9W_教師卷.pdf');
    expect(pdfFileName(exam, { ...sitePdfOptions('full', false), mockMeta })).toBe('學測英文中心_自組模擬考_進階練習_A-3KD9W_含答案解析.pdf');
  });
});

describe('sitePdfOptions（bank-mock §7.7 的表）', () => {
  it('三種版本對應的選項', () => {
    expect(sitePdfOptions('student', false)).toEqual({ includeBooklet: true, includeAnswerSheet: true, includeAnswerKey: false, includeExplanations: false, duplex: false });
    expect(sitePdfOptions('teacher', false)).toEqual({ includeBooklet: false, includeAnswerSheet: false, includeAnswerKey: true, includeExplanations: true, duplex: false });
    expect(sitePdfOptions('full', true)).toEqual({ includeBooklet: true, includeAnswerSheet: true, includeAnswerKey: true, includeExplanations: true, duplex: true });
  });
});

describe('pdfPreviewEnabled', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('?pdf=preview 打開並記住；?pdf=off 關掉', () => {
    expect(pdfPreviewEnabled()).toBe(false);
    window.history.replaceState(null, '', '/exams/gsat-115?pdf=preview');
    expect(pdfPreviewEnabled()).toBe(true);
    window.history.replaceState(null, '', '/exams/gsat-115');
    expect(pdfPreviewEnabled()).toBe(true);
    window.history.replaceState(null, '', '/exams/gsat-115?pdf=off');
    expect(pdfPreviewEnabled()).toBe(false);
  });
});

describe('pdfDownloadVisible', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('正式開放或打開預覽開關時為 true（模擬考列表、說明文字與下載區塊共用這個判斷）', () => {
    window.history.replaceState(null, '', '/mock?pdf=off');
    expect(pdfDownloadVisible()).toBe(PDF_DOWNLOAD_ENABLED);
    window.history.replaceState(null, '', '/mock?pdf=preview');
    expect(pdfDownloadVisible()).toBe(true);
    window.history.replaceState(null, '', '/mock?pdf=off');
  });
});
