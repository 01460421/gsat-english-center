/**
 * PDF 的出版社出處（docs/design/weak-paper.md §8.7、§9.5）：加強卷裡有出版社題組時，封面印題目來源、題本每個出版社題組
 * 標示下一行印出處、頁尾聲明改寫、資料來源頁加出版社的聲明；全部是出版社題時不印 AI 出題聲明。
 * 只用本站題的卷子不受影響（buildDocDefinition.test.ts 的本站自組卷測試照舊）。
 */
import { describe, expect, it } from 'vitest';
import { buildBankPaper, type SlotFile } from '../../mock/bank/buildExam';
import { encodeBk2, type Bk2Slot } from '../../mock/bank/code2';
import { layoutForBk2 } from '../../mock/bank/layout';
import { bankMockPdfMeta } from '../../mock/bank/pdfText';
import { fakeGroupFile } from '../../mock/bank/testFixtures';
import type { PdfContent } from '../engine/docTypes';
import { sitePdfOptions } from '../index';
import { buildExamDocDefinition } from './buildDocDefinition';
import { SITE_PAPER_BOLD, SITE_PAPER_TEXT, WEAK_PAPER_TEXT } from './strings';
import { OFFICIAL_NAMES, allText, cjkWithoutChineseFont, renderChrome } from './testUtils';

function fixture(allPublisher: boolean, version: 'full' | 'teacher' = 'full') {
  const slots: Bk2Slot[] = allPublisher
    ? [{ ns: 'pb', section: 'reading', tier: 'advanced', uid: 'pb.rd.0f0002', v: 1 }]
    : [
        { ns: 'ai', section: 'reading', tier: 'advanced', uid: 'ai.rd.0f0001', v: 1 },
        { ns: 'pb', section: 'reading', tier: 'advanced', uid: 'pb.rd.0f0002', v: 1 },
      ];
  const files: Record<string, SlotFile> = {};
  for (const s of slots) files[`${s.uid}@${s.v}`] = fakeGroupFile('reading', s.uid, s.v, { tier: 'advanced' });
  const paper = buildBankPaper({
    paperId: encodeBk2('r', slots),
    tier: 'advanced',
    dataVersion: 'pool-v1',
    slots: slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: [] })),
    files,
    layout: layoutForBk2({ kind: 'r', slots }),
  });
  const mockMeta = bankMockPdfMeta(paper, { assembledAt: new Date(2026, 10, 2, 9, 0) });
  const doc = buildExamDocDefinition(paper.exam, { ...sitePdfOptions(version, false), mockMeta, onlineUrl: `https://example.org/mock/${paper.id}.p` });
  return { paper, site: mockMeta.sitePaper!, doc };
}

describe('加強卷裡有出版社題組', () => {
  it('封面題目來源、每組出處、頁尾聲明（兩者都有）、資料來源頁的出版社聲明；沒有官方考試機構的名稱', () => {
    const { site, doc } = fixture(false);
    const text = allText(doc.content as PdfContent[]);
    for (const line of site.sourceLines ?? []) expect(text).toContain(line);
    expect(text).toContain('測試出版《模擬試題》原卷第 41–44 題・經授權使用');
    expect(text).toContain(SITE_PAPER_TEXT.sourcesPublisherIntro);
    expect(text).toContain(site.aiNotice);
    expect(text).not.toMatch(OFFICIAL_NAMES);
    const chrome = renderChrome(doc, doc.content.map(() => 2));
    for (const page of chrome) expect(allText(page.footer)).toContain(SITE_PAPER_TEXT.footerNoticeMixed);
    expect(cjkWithoutChineseFont(doc.content as PdfContent[])).toEqual([]);
  });

  it('全部是出版社題：不印 AI 出題聲明，頁尾是出版社的聲明', () => {
    const { site, doc } = fixture(true);
    const text = allText(doc.content as PdfContent[]);
    expect(text).not.toContain(site.aiNotice);
    expect(text).not.toContain(SITE_PAPER_TEXT.sourcesIntro);
    const chrome = renderChrome(doc, doc.content.map(() => 2));
    for (const page of chrome) expect(allText(page.footer)).toContain(SITE_PAPER_TEXT.footerNoticePublisher);
  });
});

describe('加強卷的封面橫條、文件屬性與教師卷的聲明依題目來源（W3）', () => {
  it('兩者都有：封面橫條與文件主旨寫「由 AI 撰寫或出自出版社」', () => {
    const { doc } = fixture(false);
    const sections = doc.content as PdfContent[];
    expect(allText(sections[0] as PdfContent)).toContain(SITE_PAPER_BOLD.weakCoverBandMixed);
    expect(doc.info?.subject).toBe(WEAK_PAPER_TEXT.docSubject(SITE_PAPER_TEXT.footerNoticeMixed));
  });

  it('全部是出版社題：封面橫條、文件主旨、教師卷第一頁都不寫 AI 出題', () => {
    const { doc, site } = fixture(true);
    expect(allText((doc.content as PdfContent[])[0] as PdfContent)).toContain(SITE_PAPER_BOLD.weakCoverBandPublisher);
    expect(doc.info?.subject).toBe(WEAK_PAPER_TEXT.docSubject(SITE_PAPER_TEXT.footerNoticePublisher));
    const teacher = fixture(true, 'teacher').doc;
    const first = allText((teacher.content as PdfContent[])[0] as PdfContent);
    expect(first).toContain(SITE_PAPER_TEXT.footerNoticePublisher);
    expect(first).not.toContain(site.aiNotice);
  });
});
