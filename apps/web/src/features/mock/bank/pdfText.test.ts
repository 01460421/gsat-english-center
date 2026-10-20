/** 自組卷的 PDF 資訊（docs/design/bank-mock.md §7.1）：BankPaper → MockPdfMeta／SitePaperPdfMeta。 */
import { describe, expect, it } from 'vitest';
import { BANK_PDF_TEXT, bankMockPdfMeta, pdfDateText, sitePaperPdfMeta } from './pdfText';
import { buildBankPaper } from './buildExam';
import { paperInput } from './testFixtures';

const paper = buildBankPaper(paperInput());

describe('bankMockPdfMeta', () => {
  it('封面的卷名、卷別（難度＋卷號）、100 分鐘、實考模式與 sitePaper', () => {
    const meta = bankMockPdfMeta(paper, { strict: true, assembledAt: '2026-10-19T09:00:00+08:00' });
    expect(meta).toMatchObject({ title: '學測英文中心　本站自組模擬考', paperLabel: `進階練習卷　卷號 ${paper.code}`, durationMinutes: 100, strict: true });
    expect(meta.sitePaper).toMatchObject({ code: paper.code, tierLabel: '進階練習', dataVersion: 'pool-v1', aiNotice: BANK_PDF_TEXT.aiNotice });
    expect(bankMockPdfMeta(paper).strict).toBe(false);
  });

  it('全部是純資料（可以 postMessage 給 Worker），也不出現官方考試機構的名稱或網址', () => {
    const meta = bankMockPdfMeta(paper);
    expect(structuredClone(meta)).toEqual(meta);
    // 官方考試機構的簡稱、全名與英文縮寫（寫成 \u 跳脫，新的程式碼裡不寫這些字）。
    expect(JSON.stringify(meta)).not.toMatch(new RegExp(['\u5927\u8003\u4e2d\u5fc3', '\u5927\u5b78\u5165\u5b78\u8003\u8a66\u4e2d\u5fc3', '\u0063\u0065\u0065\u0063'].join('|'), 'i'));
  });
});

describe('sitePaperPdfMeta', () => {
  const site = sitePaperPdfMeta(paper, { assembledAt: new Date(2026, 9, 19, 23, 30) });

  it('組卷日期用呼叫端給的時間（YYYY-MM-DD）；沒有就用今天', () => {
    expect(site.assembledOn).toBe('2026-10-19');
    expect(sitePaperPdfMeta(paper, { now: new Date(2026, 0, 2) }).assembledOn).toBe('2026-01-02');
    expect(sitePaperPdfMeta(paper, { assembledAt: 'not a date', now: new Date(2026, 0, 2) }).assembledOn).toBe('2026-01-02');
    expect(pdfDateText(new Date(2026, 8, 5))).toBe('2026-09-05');
  });

  it('資料來源：有參考資料的題組依題號範圍列出，圖表的資料來源（含授權）也在裡面、用網址去重', () => {
    expect(site.references.map((r) => r.range)).toEqual(['35–38', '39–42', '43–46', '47–50']);
    const first = site.references[0];
    expect(first?.attribution).toMatch(/^本文由 AI 參考下列資料撰寫/);
    expect(first?.items.map((i) => i.url)).toEqual([expect.stringContaining('example.org/ai.rd.'), 'https://example.org/data']);
    expect(first?.items[1]).toMatchObject({ publisher: 'Data Org', license: 'CC-BY-4.0' });
  });

  it('相鄰、沒有參考資料、出處說明相同的題組併成一個範圍', () => {
    const groups = paper.groups.map((g, i) => (i < 5 ? { ...g, attribution: '本文由 AI 撰寫' } : g));
    const merged = sitePaperPdfMeta({ ...paper, groups });
    expect(merged.references[0]).toEqual({ range: '1–34', attribution: '本文由 AI 撰寫', items: [] });
    expect(merged.references[1]?.range).toBe('35–38');
  });

  it('答案：中譯英參考譯文依卷子的題號；作文評分重點四項加扣分說明；範文依難度（超越頂標用頂標版）', () => {
    expect(site.answers.translation['中譯英1']?.[0]).toBe('In recent years, many students have started to bring their own water bottles to school.');
    expect(site.answers.translation['中譯英2']?.[0]).toMatch(/^To reduce plastic waste/);
    const criteria = site.answers.composition.criteria;
    expect(criteria.map((c) => c.slice(0, c.indexOf('：')))).toEqual(['內容', '組織', '文法句構', '字彙拼字', '扣分說明']);
    const models = paper.writing.composition.model_texts;
    expect(site.answers.composition.modelText).toBe(models.find((m) => m.label === 'steady')?.text.trim());
    const top = sitePaperPdfMeta({ ...paper, tier: 'top' });
    expect(top.answers.composition.modelText).toBe(models.find((m) => m.label === 'top')?.text.trim());
    expect(top.tierLabel).toBe('超越頂標');
  });

  it('解析：選擇題與混合題依新題號，另有中譯英與作文', () => {
    const keys = Object.keys(site.answers.explanations);
    for (let n = 1; n <= 50; n += 1) expect(keys).toContain(String(n));
    expect(keys).toEqual(expect.arrayContaining(['中譯英1', '中譯英2', '英文作文']));
    expect(site.answers.explanations['35']).toBe(paper.explanations['35']?.explanation_zh);
    expect(site.answers.explanations['中譯英1']).toMatch(/^「已經開始」/);
  });

  it('部分給分：混合題填充、簡答依新題號帶上 partial_credit_forms（線上自動判分給 1 分的同一份清單），沒有的題號不列', () => {
    // 測試資料的混合題第 1 格（本卷第 47 題）有部分給分的寫法 alphas。
    expect(paper.explanations['47']?.partial_credit_forms).toEqual(['alphas']);
    expect(site.answers.partialCredit).toEqual({ '47': ['alphas'] });
  });
});
