/**
 * 卷子的題目來源（paperSources.ts；docs/design/weak-paper.md §8.7、§9.5）：加強卷裡有出版社題組時，卷子頁、頁尾、PDF 的
 * 封面來源行、每組出處、頁尾聲明與解析頁；只用本站題的卷子（自組模擬考）全部維持原樣。
 */
import { describe, expect, it } from 'vitest';
import { buildBankPaper, type BankPaper, type SlotFile } from './buildExam';
import { encodeBk2, type Bk2Slot } from './code2';
import { layoutForBk2 } from './layout';
import { siteAttribution } from '../../pdf/layout/attribution';
import { SITE_PAPER_TEXT } from '../../pdf/layout/strings';
import { BANK_PDF_TEXT, sitePaperPdfMeta } from './pdfText';
import { AI_SOURCE_TEXT, footerKindOf, groupSourceLines, paperSourceLines, paperSourceRanges } from './paperSources';
import { fakeGroupFile, paperInput } from './testFixtures';
import { maskPublisherFile } from './sourceMask';
import { answerKeyContent } from '../../pdf/layout/answerKey';

const PB_SOURCE = '本題出自測試出版《模擬試題》，經授權使用';

/** 一份隨機抽題卷：閱讀 2 篇（第 1 篇本站題、第 2 篇出版社題）＋混合題 1 組（本站題）；publisherNoExplanations 時出版社那篇沒有解析。 */
function bk2Paper(options: { publisherNoExplanations?: boolean; allPublisher?: boolean } = {}): BankPaper {
  const slots: Bk2Slot[] = options.allPublisher
    ? [{ ns: 'pb', section: 'reading', tier: 'advanced', uid: 'pb.rd.0f0002', v: 1 }]
    : [
        { ns: 'ai', section: 'reading', tier: 'advanced', uid: 'ai.rd.0f0001', v: 1 },
        { ns: 'pb', section: 'reading', tier: 'advanced', uid: 'pb.rd.0f0002', v: 1 },
        { ns: 'ai', section: 'mixed', tier: 'advanced', uid: 'ai.mx.0f0003', v: 1 },
      ];
  const files: Record<string, SlotFile> = {};
  for (const s of slots) {
    const file = fakeGroupFile(s.section as 'reading' | 'mixed', s.uid, s.v, { tier: 'advanced' });
    if (s.ns === 'pb' && options.publisherNoExplanations) file.annotations.explanations.items = {};
    files[`${s.uid}@${s.v}`] = file;
  }
  const paperId = encodeBk2('r', slots);
  return buildBankPaper({
    paperId,
    tier: 'advanced',
    dataVersion: 'pool-v1',
    slots: slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: [] })),
    files,
    layout: layoutForBk2({ kind: 'r', slots }),
  });
}

describe('卷子裡有出版社題組', () => {
  const paper = bk2Paper();

  it('BankPaperGroup 帶出處（只有出版社題組）', () => {
    expect(paper.groups.map((g) => g.source?.id ?? null)).toEqual([null, 'pub-test', null]);
  });

  it('題目來源依題號範圍，相鄰同來源併成一段', () => {
    expect(paperSourceRanges(paper.groups)).toEqual([
      { range: '第 1–4 題', text: AI_SOURCE_TEXT, sourceId: null },
      { range: '第 5–8 題', text: PB_SOURCE, sourceId: 'pub-test' },
      { range: '第 9–12 題', text: AI_SOURCE_TEXT, sourceId: null },
    ]);
    expect(paperSourceLines(paper.groups)).toEqual([`題目來源：${AI_SOURCE_TEXT}`, '測試出版《模擬試題》（經授權使用）']);
    expect(footerKindOf(paper.groups)).toBe('mixed');
    expect(footerKindOf(bk2Paper({ allPublisher: true }).groups)).toBe('publisher');
  });

  it('每組出處依卷子裡的題組 id', () => {
    const lines = groupSourceLines(paper);
    expect(Object.values(lines)).toEqual(['測試出版《模擬試題》原卷第 41–44 題・經授權使用']);
    const id = Object.keys(lines)[0];
    const group = paper.exam.sections.flatMap((s) => s.groups).find((g) => g.id === id);
    expect(group?.questions.map((q) => q.label)).toEqual(['5', '6', '7', '8']);
  });

  it('PDF：封面來源行、每組出處、頁尾聲明；出版社題沒有解析時解析頁印「這組沒有解析」', () => {
    const meta = sitePaperPdfMeta(paper, { now: new Date(2026, 10, 2) });
    expect(meta.sourceLines).toEqual(paperSourceLines(paper.groups));
    expect(meta.groupSources).toEqual(groupSourceLines(paper));
    expect(meta.footerKind).toBe('mixed');
    expect(siteAttribution(meta).notice).toBe(SITE_PAPER_TEXT.footerNoticeMixed);
    expect(siteAttribution({ code: 'X', footerKind: 'publisher' }).notice).toBe(SITE_PAPER_TEXT.footerNoticePublisher);
    // 資料來源頁：出版社題組的出處說明就是出處句。
    expect(meta.references.find((r) => r.range === '5–8')?.attribution).toBe(PB_SOURCE);
    const none = sitePaperPdfMeta(bk2Paper({ publisherNoExplanations: true }), { now: new Date(2026, 10, 2) });
    expect(['5', '6', '7', '8'].map((l) => none.answers.explanations[l])).toEqual(Array(4).fill(BANK_PDF_TEXT.noExplanation));
    expect(none.answers.explanations['1']).not.toBe(BANK_PDF_TEXT.noExplanation);
  });
});

describe('只用本站題的卷子：維持原樣', () => {
  const paper = buildBankPaper(paperInput());

  it('沒有出版社題組：沒有題目來源一塊、PDF 不帶三個新欄位、頁尾照舊', () => {
    expect(paper.groups.every((g) => g.source === undefined && !('source' in g))).toBe(true);
    expect(paperSourceRanges(paper.groups)).toBeNull();
    expect(paperSourceLines(paper.groups)).toBeNull();
    expect(footerKindOf(paper.groups)).toBe('ai');
    expect(groupSourceLines(paper)).toEqual({});
    const meta = sitePaperPdfMeta(paper, { now: new Date(2026, 10, 2) });
    expect(Object.keys(meta).sort()).toEqual(['aiNotice', 'answers', 'assembledOn', 'code', 'dataVersion', 'references', 'tierLabel']);
    expect(siteAttribution(meta).notice).toBe(SITE_PAPER_TEXT.footerNotice);
  });
});

describe('授權結束、快照已遮住的出版社題組（§7.6）', () => {
  /** 一份隨機抽題卷：混合題 1 組（出版社題，遮住）＋閱讀 1 篇（本站題）。 */
  function maskedPaper(): BankPaper {
    const slots: Bk2Slot[] = [
      { ns: 'ai', section: 'reading', tier: 'advanced', uid: 'ai.rd.0f0011', v: 1 },
      { ns: 'pb', section: 'mixed', tier: 'advanced', uid: 'pb.mx.0f0012', v: 1 },
    ];
    const files: Record<string, SlotFile> = {};
    for (const s of slots) {
      const file = fakeGroupFile(s.section as 'reading' | 'mixed', s.uid, s.v, { tier: 'advanced' });
      files[`${s.uid}@${s.v}`] = s.ns === 'pb' ? maskPublisherFile(file) : file;
    }
    return buildBankPaper({
      paperId: encodeBk2('r', slots),
      tier: 'advanced',
      dataVersion: 'pool-v1',
      slots: slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: [] })),
      files,
      layout: layoutForBk2({ kind: 'r', slots }),
    });
  }

  it('卷子的那一組標 masked；PDF 答案頁不印填充、簡答的答案與部分給分的寫法（選擇題字母照印）；本站題照常', () => {
    const paper = maskedPaper();
    expect(paper.groups.map((g) => g.masked ?? false)).toEqual([false, true]);
    expect(paper.groups[0]).not.toHaveProperty('masked');
    const meta = sitePaperPdfMeta(paper, { now: new Date(2026, 10, 2) });
    const mixed = paper.exam.sections.flatMap((s) => s.groups).find((g) => g.questions.some((q) => q.label === paper.groups[1]?.first));
    const open = (mixed?.questions ?? []).filter((q) => q.mode === 'fill_in_blank' || q.mode === 'short_answer').map((q) => q.label);
    expect(open.length).toBeGreaterThan(0);
    expect(meta.answers.ended).toEqual(open);
    for (const l of open) expect(meta.answers.partialCredit?.[l]).toBeUndefined();
    const text = JSON.stringify(answerKeyContent(paper.exam, { site: meta }));
    for (const word of ['alpha', 'beta', 'gamma', 'alphas']) expect(text).not.toContain(word);
    expect(text).toContain(SITE_PAPER_TEXT.answerEnded.slice(1, 8));
    // 沒有遮住的題組：不加 ended（PDF 和原本相同）。
    expect(sitePaperPdfMeta(bk2Paper(), { now: new Date(2026, 10, 2) }).answers).not.toHaveProperty('ended');
  });
});
