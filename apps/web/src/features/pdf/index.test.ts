import { afterEach, describe, expect, it } from 'vitest';
import { MINI_EXAM } from '../exams/testFixtures';
import { pdfFileName, pdfPreviewEnabled } from './index';

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
