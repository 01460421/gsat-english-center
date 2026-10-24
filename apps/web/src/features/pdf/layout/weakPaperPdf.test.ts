/**
 * 學習助手加強卷（bk2）的 PDF（docs/design/weak-paper.md §9.5、§10.1 的 PDF 測試）：
 *   - 封面：卷名、卷別、這份卷子自己的作答時間、卷別說明、加強卷的橫條、「本卷針對」；作答方式依實際的大題；
 *   - 頁首頁尾、各節標題、文件屬性、檔名都是加強卷的寫法，不出現「自組模擬考」或官方考試機構的名稱；
 *   - 教師卷第一頁有卷別與作答時間；跨難度時難度寫「穩定基礎、進階練習」；
 *   - 答題卷依實際的大題：只有選擇題時沒有作答區與作文格線，只有中譯英與作文時沒有答案卡。
 * 自組模擬考（bk1）的 PDF 和改動前完全相同由 bk1PdfGolden.test.ts 檢查。
 */
import { BANK_UID_CODES, TIERS, type BankSectionType, type Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import type { PracticeSectionType } from '../../../data/bank';
import { buildBankPaper, type SlotFile } from '../../mock/bank/buildExam';
import { encodeBk2, type Bk2Slot } from '../../mock/bank/code2';
import { layoutForBk2 } from '../../mock/bank/layout';
import { BK2_KINDS, bk2KindLabel, type Bk2Kind } from '../../mock/bank/paperId';
import { bankMockPdfMeta, type BankPdfMetaOptions } from '../../mock/bank/pdfText';
import { fakeGroupFile, fakeWritingPair } from '../../mock/bank/testFixtures';
import type { PdfContent, PdfSection } from '../engine/docTypes';
import { pdfFileName, sitePdfOptions, type SitePdfVersion } from '../index';
import { answerSheetContent } from './answerSheet';
import { buildExamDocDefinition } from './buildDocDefinition';
import { targetsLine } from './cover';
import { PDF_TEXT, SITE_PAPER_BOLD, SITE_PAPER_TEXT, WEAK_PAPER_TEXT } from './strings';
import { OFFICIAL_NAMES, allText, cjkWithoutChineseFont, findNodes, renderChrome } from './testUtils';

function slot(section: BankSectionType, n: number, tier: Tier = 'advanced'): Bk2Slot {
  return { ns: 'ai', section, tier, uid: `ai.${BANK_UID_CODES[section]}.e0${String(n).padStart(4, '0')}`, v: 1 };
}

function weakPaper(kind: Bk2Kind, slots: Bk2Slot[]) {
  const layout = layoutForBk2({ kind, slots });
  const files: Record<string, SlotFile> = {};
  const sources = slots.map((s, i) => {
    const key = `${s.uid}@${s.v}`;
    files[key] =
      s.section === 'translation' || s.section === 'composition'
        ? fakeWritingPair(s.section, s.uid, s.v)
        : fakeGroupFile(s.section as PracticeSectionType, s.uid, s.v, { tier: s.tier, chart: s.section === 'reading' && i === 1 });
    return { key, swap: [] as [number, number][] };
  });
  return buildBankPaper({ paperId: encodeBk2(kind, slots), tier: layout.tier, dataVersion: 'pool-v1', slots: sources, files, layout });
}

/** 弱點加強卷：詞彙（進階）＋閱讀兩篇（進階、穩定基礎）；7＋8⅓×2 ≈ 23.7 → 25 分鐘。只有選擇題。 */
const W_PAPER = weakPaper('w', [slot('vocabulary', 1), slot('reading', 2), slot('reading', 3, 'basic')]);
/** 隨機抽題卷：只有中譯英與作文（超越頂標）；8＋25 → 35 分鐘。 */
const R_WRITING = weakPaper('r', [slot('translation', 4, 'top'), slot('composition', 5, 'top')]);
const TARGETS = { labels: ['推論題（閱讀）', '延伸義（詞彙）'], balanced: false };

function docOf(paper: ReturnType<typeof weakPaper>, version: SitePdfVersion, options: BankPdfMetaOptions = {}, duplex = false) {
  const mockMeta = bankMockPdfMeta(paper, { assembledAt: new Date(2026, 9, 24, 9, 0), ...options });
  const onlineUrl = `https://gsat-english-center.vercel.app/mock/${paper.id}.p`;
  const pdfOptions = { ...sitePdfOptions(version, duplex), mockMeta, onlineUrl };
  return { mockMeta, site: mockMeta.sitePaper!, doc: buildExamDocDefinition(paper.exam, pdfOptions), pdfOptions };
}

describe('加強卷的 PDF 資訊（pdfText.ts）', () => {
  it('卷名、卷別與卷號、這份卷子自己的作答時間；sitePaper 帶卷別、作答時間與「本卷針對」', () => {
    const { mockMeta, site } = docOf(W_PAPER, 'student', { targets: TARGETS });
    expect(mockMeta).toMatchObject({ title: '學測英文中心　學習助手加強卷', paperLabel: `弱點加強卷　卷號 ${W_PAPER.code}`, durationMinutes: 25 });
    expect(W_PAPER.code).toMatch(/^W-[0-9A-Z]{5}$/);
    expect(site).toMatchObject({ paperKind: 'w', minutes: 25, tierLabel: '穩定基礎、進階練習', targets: TARGETS });
    expect(structuredClone(mockMeta)).toEqual(mockMeta);
  });

  it('隨機抽題卷不印「本卷針對」；模考格式卷的卷別寫難度；作文的範文依作文那一組的難度', () => {
    const r = docOf(R_WRITING, 'student', { targets: TARGETS });
    expect(r.site.targets).toBeUndefined();
    expect(r.mockMeta).toMatchObject({ paperLabel: `隨機抽題卷　卷號 ${R_WRITING.code}`, durationMinutes: 35 });
    expect(r.site.tierLabel).toBe('超越頂標');
    const models = R_WRITING.writing.composition?.model_texts ?? [];
    expect(r.site.answers.composition.modelText).toBe(models.find((m) => m.label === 'top')?.text.trim());
    const balanced = docOf(W_PAPER, 'student', { targets: { labels: [], balanced: true } });
    expect(balanced.site.targets).toEqual({ labels: [], balanced: true });
    expect(docOf(W_PAPER, 'student', { targets: { labels: [], balanced: false } }).site.targets).toBeUndefined();
  });

  it('PDF 那一側的卷別名稱和卷子頁（paperId.ts）相同', () => {
    for (const kind of BK2_KINDS) {
      for (const tier of TIERS) {
        expect(WEAK_PAPER_TEXT.kindLabel(kind, tierName(tier))).toBe(bk2KindLabel(kind, tier));
      }
    }
  });
});

/** 難度名稱（同 TIER_LABELS；這裡直接寫，免得測試依賴同一份常數）。 */
function tierName(tier: Tier): string {
  return { basic: '穩定基礎', advanced: '進階練習', top: '超越頂標' }[tier];
}

describe('加強卷的學生卷', () => {
  const { doc, site, pdfOptions } = docOf(W_PAPER, 'student', { targets: TARGETS });
  const sections = doc.content as PdfSection[];
  const cover = allText(sections[0]?.section);
  const kind = '弱點加強卷';

  it('封面：卷名、卷別、作答時間、卷別說明、加強卷的橫條、本卷針對；不寫自組模擬考', () => {
    expect(cover).toContain('學測英文中心　學習助手加強卷');
    expect(cover).toContain(`${kind}　卷號 ${W_PAPER.code}`);
    expect(cover).toContain(PDF_TEXT.timeLine(25));
    expect(cover).toContain(WEAK_PAPER_TEXT.coverFormat('w'));
    expect(cover).toContain(SITE_PAPER_BOLD.weakCoverBand);
    expect(cover).toContain('本卷針對：推論題（閱讀）、延伸義（詞彙）');
    expect(cover).not.toContain(SITE_PAPER_TEXT.coverBand);
    expect(cover).not.toContain(SITE_PAPER_TEXT.coverFormat);
  });

  it('作答方式依實際的大題：只有選擇題時不寫混合題與非選擇題的作答區', () => {
    expect(cover).toContain(PDF_TEXT.howWithSheet[0]);
    expect(cover).not.toContain(PDF_TEXT.howWithSheet[1]);
    expect(cover).toContain(SITE_PAPER_TEXT.howOnline);
  });

  it('頁首頁尾、各節標題是加強卷的寫法；沒有官方考試機構的名稱，也沒有自組模擬考的字樣', () => {
    const chrome = renderChrome(doc, sections.map(() => 2));
    const all = [allText(doc.content as PdfContent[]), ...chrome.flatMap((c) => [allText(c.header), allText(c.footer)])].join('\n');
    expect(all).not.toMatch(OFFICIAL_NAMES);
    expect(all).not.toContain('自組模擬考');
    for (const page of chrome) {
      expect(allText(page.footer)).toContain(WEAK_PAPER_TEXT.footerSource(W_PAPER.code));
      expect(allText(page.footer)).toContain(SITE_PAPER_TEXT.footerNotice);
    }
    const headers = sections.map((s) => allText(s.header?.(2, 9, { width: 595.28, height: 841.89 }) ?? null));
    expect(headers[1]).toContain(WEAK_PAPER_TEXT.headerCenter);
    expect(headers[1]).toContain(kind);
    expect(headers[2]).toContain(WEAK_PAPER_TEXT.sourcesHeader(kind));
    expect(headers[3]).toContain(WEAK_PAPER_TEXT.sheetHeader(kind));
    expect(cjkWithoutChineseFont(doc.content as PdfContent[])).toEqual([]);
    expect(cjkWithoutChineseFont(chrome.flatMap((c) => [c.header, c.footer]))).toEqual([]);
  });

  it('文件屬性與檔名', () => {
    expect(doc.info).toMatchObject({ title: `學測英文中心學習助手加強卷 ${kind} ${W_PAPER.code}`, subject: `學測英文中心學習助手加強卷　${SITE_PAPER_TEXT.footerNotice}` });
    expect(pdfFileName(W_PAPER.exam, pdfOptions)).toBe(`學測英文中心_加強卷_${W_PAPER.code}_學生卷.pdf`);
    expect(pdfFileName(W_PAPER.exam, { ...sitePdfOptions('teacher', true), mockMeta: pdfOptions.mockMeta })).toBe(`學測英文中心_加強卷_${W_PAPER.code}_教師卷.pdf`);
    expect(pdfFileName(W_PAPER.exam, { ...sitePdfOptions('full', false), mockMeta: pdfOptions.mockMeta })).toMatch(/^學測英文中心_加強卷_W-[0-9A-Z]{5}_含答案解析\.pdf$/);
    expect(site.paperKind).toBe('w');
  });

  it('答題卷只有選擇題答案卡：沒有混合題、非選擇題作答區與作文格線', () => {
    const sheet = answerSheetContent(W_PAPER.exam, { site, onlineUrl: null });
    const text = allText(sheet);
    expect(text).toContain(PDF_TEXT.choiceCardTitle);
    expect(text).not.toContain(PDF_TEXT.answerAreaHeader);
    expect(findNodes(sheet, (n) => n.pageBreak === 'before')).toEqual([]);
  });
});

describe('只有中譯英與作文的加強卷', () => {
  const { doc, site } = docOf(R_WRITING, 'student');
  const sections = doc.content as PdfSection[];
  const cover = allText(sections[0]?.section);

  it('封面：隨機抽題卷的卷別說明；作答方式不寫答案卡，線上作答不自動計分；沒有選擇題計分方式', () => {
    expect(cover).toContain(WEAK_PAPER_TEXT.coverFormat('r'));
    expect(cover).not.toContain(PDF_TEXT.howWithSheet[0]);
    expect(cover).toContain(PDF_TEXT.howWithSheet[1]);
    expect(cover).toContain(WEAK_PAPER_TEXT.howOnlineWritten);
    expect(cover).not.toContain(PDF_TEXT.scoringTitle);
    expect(cover).not.toContain('本卷針對');
  });

  it('答題卷沒有答案卡；中譯英作答線，作文從新的一頁開始、兩頁格線', () => {
    const sheet = answerSheetContent(R_WRITING.exam, { site, onlineUrl: null });
    const text = allText(sheet);
    expect(text).not.toContain(PDF_TEXT.choiceCardTitle);
    expect(text).toContain('一、中譯英（占8分）');
    expect(findNodes(sheet, (n) => n.pageBreak === 'before').map((n) => allText(n as never))).toEqual(['二、英文作文（占20分）', PDF_TEXT.compositionContinued]);
  });
});

describe('加強卷的教師卷', () => {
  it('第一頁的卷子資訊有卷別與作答時間，難度寫卷子裡出現的難度；沒有封面與題本', () => {
    const { doc } = docOf(W_PAPER, 'teacher', { targets: TARGETS });
    const sections = doc.content as PdfSection[];
    const first = allText(sections[0]?.section);
    expect(first).toContain(SITE_PAPER_BOLD.teacherTitle);
    expect(first).toContain(`${WEAK_PAPER_TEXT.teacherRows.kind}弱點加強卷`);
    expect(first).toContain(`${WEAK_PAPER_TEXT.teacherRows.minutes}${WEAK_PAPER_TEXT.minutes(25)}`);
    expect(first).toContain(`${SITE_PAPER_TEXT.teacherRows.tier}穩定基礎、進階練習`);
    expect(allText(doc.content as PdfContent[])).not.toContain('本卷針對');
    expect(doc.info?.title).toBe(`學測英文中心學習助手加強卷 弱點加強卷 ${W_PAPER.code} 教師卷`);
  });
});

describe('本卷針對（targetsLine）', () => {
  it('均衡加強卷寫「不是針對弱點」；PDF 字型沒有的字的那一項不印，全部不能印就整行不印', () => {
    expect(targetsLine(undefined)).toBeNull();
    expect(targetsLine({ labels: [], balanced: true })).toBe(WEAK_PAPER_TEXT.targetsBalanced);
    expect(targetsLine({ labels: ['推論題（閱讀）', '\u{23B20}字'], balanced: false })).toBe('本卷針對：推論題（閱讀）');
    expect(targetsLine({ labels: ['\u{23B20}'], balanced: false })).toBeNull();
    expect(targetsLine({ labels: ['  '], balanced: false })).toBeNull();
  });
});
