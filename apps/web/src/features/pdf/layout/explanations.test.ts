/** 解析頁（本站自組卷，docs/design/bank-mock.md §7.4、§10.3）。 */
import { describe, expect, it } from 'vitest';
import type { PdfContent, PdfSection } from '../engine/docTypes';
import { sitePdfOptions } from '../index';
import { buildExamDocDefinition } from './buildDocDefinition';
import { explanationsContent, printableExplanation } from './explanations';
import { SITE_PAPER_TEXT } from './strings';
import { allText, cjkWithoutChineseFont, sitePaperFixture } from './testUtils';

const fx = sitePaperFixture();

describe('printableExplanation', () => {
  it('照印；字型沒有的符號先替代（≠ → 不等於）', () => {
    expect(printableExplanation('答案是 B。')).toEqual({ text: '答案是 B。', replaced: false });
    expect(printableExplanation('a ≠ b，所以選 C。')).toEqual({ text: 'a 不等於 b，所以選 C。', replaced: false });
  });

  it('替代之後仍有缺字、或沒有解析時，改印「請到線上檢討試卷查看」', () => {
    expect(printableExplanation('這個字𠀀子集沒有。')).toEqual({ text: SITE_PAPER_TEXT.explanationMissing, replaced: true });
    expect(printableExplanation(null)).toEqual({ text: SITE_PAPER_TEXT.explanationMissing, replaced: true });
    expect(printableExplanation('  ')).toEqual({ text: SITE_PAPER_TEXT.explanationMissing, replaced: true });
  });
});

describe('解析頁', () => {
  const content = explanationsContent(fx.exam, fx.site);
  const text = allText(content);

  it('依大題印每一題的解析，題號和題本一致（1–50、中譯英 1–2）', () => {
    for (const section of fx.exam.sections) expect(text).toContain(section.title);
    for (let n = 1; n <= 50; n += 1) expect(text).toContain(`${n}.`);
    // 題號已經換成本卷的題號（閱讀第一篇的第 1 題是第 35 題）。
    expect(text).toContain(`35.${fx.site.answers.explanations['35']}`);
    expect(text).toContain(`1.${fx.site.answers.explanations['中譯英1']}`);
    expect(text).toContain('「已經開始」說的是從過去延續到現在的改變');
  });

  it('作文印解析與一篇 AI 範文，標「AI 生成範文，僅供參考」', () => {
    expect(text).toContain(SITE_PAPER_TEXT.modelTextTitle);
    expect(text).toContain(SITE_PAPER_TEXT.modelTextNote);
    const model = fx.site.answers.composition.modelText ?? '';
    expect(model).not.toBe('');
    expect(text.replace(/\s/g, '')).toContain(model.split('\n')[0]?.replace(/\s/g, '').slice(0, 40));
  });

  it('含字型沒有的字的解析印替代說明，其他題照印', () => {
    const site = { ...fx.site, answers: { ...fx.site.answers, explanations: { ...fx.site.answers.explanations, '36': '含罕用字𠀀的解析' } } };
    const out = allText(explanationsContent(fx.exam, site));
    expect(out).toContain(`36.${SITE_PAPER_TEXT.explanationMissing}`);
    expect(out).toContain(`35.${fx.site.answers.explanations['35']}`);
  });

  it('範文先套用替代表；替代後仍有字型沒有的字時，整篇改印替代說明（標題與「AI 生成範文」照印）', () => {
    const withModel = (modelText: string) => ({ ...fx.site, answers: { ...fx.site.answers, composition: { ...fx.site.answers.composition, modelText } } });
    const missing = allText(explanationsContent(fx.exam, withModel('My first day was \u{20000} great.\nThe end.')));
    expect(missing).toContain(`${SITE_PAPER_TEXT.modelTextTitle}${SITE_PAPER_TEXT.modelTextNote}${SITE_PAPER_TEXT.modelTextMissing}`);
    expect(missing).not.toContain('\u{20000}');
    expect(missing).not.toContain('The end.');
    expect(allText(explanationsContent(fx.exam, withModel('Effort ≠ luck.')))).toContain('Effort 不等於 luck.');
  });

  it('每個含中文的字串都指定了中文字型', () => {
    expect(cjkWithoutChineseFont(content)).toEqual([]);
  });

  it('學生卷沒有解析頁；教師卷與題本＋答案＋解析各有一節', () => {
    const count = (version: 'student' | 'teacher' | 'full') =>
      (buildExamDocDefinition(fx.exam, { ...sitePdfOptions(version, false), mockMeta: fx.mockMeta }).content as PdfSection[]).filter((s) =>
        allText(s.section as PdfContent[]).startsWith(SITE_PAPER_TEXT.explanationsTitle),
      ).length;
    expect(count('student')).toBe(0);
    expect(count('teacher')).toBe(1);
    expect(count('full')).toBe(1);
  });
});
