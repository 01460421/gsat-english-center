/**
 * 文件定義的共通規則（設計文件 §5、§9.1）：
 *   1. pdfmake 沒有字型備援：任何含中文的字串都必須指定 NotoSerifTC，否則印出來是方框（§10 R4）。
 *   2. 每一頁的頁尾都有出處與「非官方」聲明（§5.2、P3）；題本頁碼只算題本（「第 N 頁／共 M 頁」）。
 *   3. 答案頁不印任何中譯英譯文，只印評分原則網址（D8、P2）。
 *   4. 封面：本站名稱、官方試題 PDF 網址；不印大考中心機構名稱標題；模擬考版印考生欄位與提醒。
 */
import { describe, expect, it } from 'vitest';
import type { Exam } from '../../../data/exams';
import { MINI_EXAM } from '../../exams/testFixtures';
import type { PdfContent, PdfSection } from '../engine/docTypes';
import { NON_OFFICIAL_NOTICE, sourceLine } from './attribution';
import { buildExamDocDefinition, withoutTrailingMargin } from './buildDocDefinition';
import { PDF_TEXT } from './strings';
import { allText, cjkWithoutChineseFont, findNodes, renderChrome } from './testUtils';

const MOCK_META = { title: '學測英文中心模擬考', paperLabel: '115 學測英文（真題卷）', durationMinutes: 100, strict: true, notices: ['本卷有部分題目沿用歷屆試題。'] };

const variants = [
  { includeAnswerSheet: false, includeAnswerKey: false },
  { includeAnswerSheet: true, includeAnswerKey: true },
  { includeAnswerSheet: true, includeAnswerKey: false, mockMeta: MOCK_META },
];

function sections(options: Parameters<typeof buildExamDocDefinition>[1], exam: Exam = MINI_EXAM) {
  return buildExamDocDefinition(exam, options).content as PdfSection[];
}

describe('buildExamDocDefinition 的共通規則', () => {
  it.each(variants)('含中文的字串都指定了中文字型（%o）', (options) => {
    const doc = buildExamDocDefinition(MINI_EXAM, options);
    const chrome = renderChrome(doc, doc.content.map(() => 2));
    expect(cjkWithoutChineseFont(doc.content as PdfContent[])).toEqual([]);
    expect(cjkWithoutChineseFont(chrome.flatMap((c) => [c.header, c.footer]))).toEqual([]);
  });

  it('分成封面、題本、答題卷、答案四節；沒勾的不產生', () => {
    expect(sections({ includeAnswerSheet: false, includeAnswerKey: false })).toHaveLength(2);
    const all = sections({ includeAnswerSheet: true, includeAnswerKey: true });
    expect(all).toHaveLength(4);
    expect(allText(all[2]?.section)).toContain(PDF_TEXT.choiceCardTitle);
    expect(allText(all[3]?.section)).toContain(PDF_TEXT.answerKeyTitle);
    const doc = buildExamDocDefinition(MINI_EXAM, { includeAnswerSheet: false, includeAnswerKey: false });
    expect(doc.pageSize).toBe('A4');
    expect(doc.defaultStyle?.font).toBe('Tinos');
    expect(typeof doc.pageBreakBefore).toBe('function');
  });

  it('每一頁的頁尾都有出處與非官方聲明；題本頁碼只算題本、奇偶頁對調', () => {
    const doc = buildExamDocDefinition(MINI_EXAM, { includeAnswerSheet: true, includeAnswerKey: true });
    // 封面 1 頁、題本 3 頁、答題卷 2 頁、答案 1 頁
    const pages = renderChrome(doc, [1, 3, 2, 1]);
    for (const page of pages) {
      const footer = allText(page.footer);
      expect(footer.replace(/\s/g, '')).toContain(sourceLine(MINI_EXAM).replace(/\s/g, ''));
      expect(footer).toContain(NON_OFFICIAL_NOTICE);
    }
    expect(pages[0]?.header).toBeNull();
    const booklet = pages.slice(1, 4).map((p) => allText(p.footer));
    expect(booklet[0]).toContain('第 1 頁');
    expect(booklet[0]).toContain('共 3 頁');
    expect(booklet[2]).toContain('第 3 頁');
    expect(booklet[0]).toContain('- 1 -');
    expect(allText(pages[1]?.header)).toContain('115年學測');
    expect(allText(pages[4]?.header)).toContain(PDF_TEXT.sheetHeader(MINI_EXAM));
    expect(allText(pages[4]?.footer)).toContain(PDF_TEXT.pageOfShort(1, 2));
    expect(allText(pages[6]?.footer)).toContain(PDF_TEXT.pageOfShort(1, 1));
  });

  it('pdfmake 重排版時（頁首從第 1 頁重新呼叫）頁碼不會累加', () => {
    const doc = buildExamDocDefinition(MINI_EXAM, { includeAnswerSheet: false, includeAnswerKey: false });
    renderChrome(doc, [1, 4]);
    const again = renderChrome(doc, [1, 5]);
    expect(allText(again[1]?.footer)).toContain('共 5 頁');
  });
});

describe('封面', () => {
  it('本站名稱、卷別、官方試題 PDF 網址與 QR code；不印大考中心機構名稱標題', () => {
    const [cover] = sections({ includeAnswerSheet: true, includeAnswerKey: false });
    const text = allText(cover?.section);
    expect(text).toContain(PDF_TEXT.coverKicker);
    expect(text).toContain('115學年度學科能力測驗');
    expect(text).toContain(PDF_TEXT.timeLine(100));
    expect(text).toContain(PDF_TEXT.howWithSheet[0]);
    expect(text).toContain(PDF_TEXT.scoringMulti.slice(0, 10)); // MINI_EXAM 有多選題
    expect(text).toContain('https://www.ceec.edu.tw/paper.pdf');
    expect(text).not.toContain('財團法人大學入學考試中心基金會');
    expect(findNodes(cover?.section, (n) => 'qr' in n).map((n) => n.qr)).toEqual(['https://www.ceec.edu.tw/paper.pdf']);
  });

  it('有線上網址時加印網址與第二個 QR code', () => {
    const doc = buildExamDocDefinition(MINI_EXAM, { includeAnswerSheet: false, includeAnswerKey: false, onlineUrl: 'https://example.org/exams/gsat-115' });
    const cover = (doc.content as PdfSection[])[0];
    expect(findNodes(cover?.section, (n) => 'qr' in n)).toHaveLength(2);
    expect(allText(cover?.section)).toContain('https://example.org/exams/gsat-115');
  });

  it('模擬考版：考試時間用 durationMinutes，印考生欄位、實考模式與提醒', () => {
    const [cover] = sections({ includeAnswerSheet: false, includeAnswerKey: false, mockMeta: { ...MOCK_META, durationMinutes: 90 } });
    const text = allText(cover?.section);
    expect(text).toContain('115 學測英文（真題卷）');
    expect(text).toContain(PDF_TEXT.timeLine(90));
    for (const field of PDF_TEXT.candidateFields) expect(text).toContain(field);
    expect(text).toContain(PDF_TEXT.strictMode);
    expect(text).toContain('本卷有部分題目沿用歷屆試題。');
    expect(text).toContain(PDF_TEXT.howWithoutSheet[0]);
  });

  it('沒有多選題的舊卷只印單選題計分方式', () => {
    const noMulti: Exam = { ...MINI_EXAM, sections: MINI_EXAM.sections.filter((s) => s.type !== 'mixed') };
    const text = allText(sections({ includeAnswerSheet: false, includeAnswerKey: false }, noMulti)[0]?.section);
    expect(text).toContain(PDF_TEXT.scoringSingle.slice(0, 10));
    expect(text).not.toContain(PDF_TEXT.scoringMulti.slice(0, 10));
  });
});

describe('題本', () => {
  const booklet = () => sections({ includeAnswerSheet: false, includeAnswerKey: false })[1]?.section ?? [];

  it('部分標題、大題標題、說明框照題本原文；混合題不重複印部分標題', () => {
    const text = allText(booklet());
    expect(text).toContain('第壹部分、選擇題（占9分）');
    expect(text).toContain('一、詞彙題（占2分）');
    expect(text).toContain('第1題至第2題為單選題');
    expect(text.match(/第貳部分/g)).toHaveLength(1);
    expect(text).toContain('第參部分、非選擇題（占24分）');
  });

  it('第貳、第參部分從新的一頁開始', () => {
    const breaks = findNodes(booklet(), (n) => n.pageBreak === 'before').map((n) => allText(n as unknown as PdfContent).slice(0, 12));
    expect(breaks).toHaveLength(2);
    expect(breaks[0]).toContain('第貳部分');
    expect(breaks[1]).toContain('第參部分');
  });

  it('空格印成帶底線的題號；共用題幹的填充題印「47-48」', () => {
    const blanks = findNodes(booklet(), (n) => n.decoration === 'underline' && n.preserveLeadingSpaces === true);
    expect(blanks.map((n) => (n.text as string).trim())).toEqual(['11', '12', '21', '22', '23', '47', '48']);
    expect(allText(booklet())).toContain('47-48');
  });

  it('沒有官方譯文欄位：中譯英只印中文題目', () => {
    expect(allText(booklet())).toContain('現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。');
  });
});

describe('答案頁', () => {
  const key = (exam: Exam = MINI_EXAM) => allText(sections({ includeAnswerSheet: false, includeAnswerKey: true }, exam)[2]?.section);

  it('選擇題答案、送分、全國答對率；混合題答案；中譯英只有評分原則網址；作文不附範文', () => {
    const text = key();
    expect(text).toContain('1 B');
    expect(text).toContain(`2 ${PDF_TEXT.allCredit}`);
    expect(text).toContain('57%');
    expect(text).toContain('innovation');
    expect(text).toContain('ADE');
    expect(text).toContain(PDF_TEXT.translationAnswer);
    expect(text).toContain('https://www.ceec.edu.tw/scoring.pdf');
    expect(text).toContain(PDF_TEXT.compositionAnswer);
  });

  it('就算資料不小心帶了官方譯文，答案頁也不印（防止 D8 被破壞）', () => {
    const leaked = 'Now, more and more senior high school English teachers have increased the percentage of English use in class.';
    const exam: Exam = {
      ...MINI_EXAM,
      sections: MINI_EXAM.sections.map((s) =>
        s.type !== 'translation'
          ? s
          : { ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.map((q) => ({ ...q, answer: leaked, accepted_answers: [leaked] }) as unknown as typeof q) })) },
      ),
    };
    const doc = buildExamDocDefinition(exam, { includeAnswerSheet: true, includeAnswerKey: true });
    expect(allText(doc.content as PdfContent[])).not.toContain('senior high school English teachers');
  });

  it('官方公告多個答案皆給分的印全部', () => {
    const exam: Exam = {
      ...MINI_EXAM,
      sections: MINI_EXAM.sections.map((s) =>
        s.id !== 's1' ? s : { ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.map((q) => (q.no === 1 ? { ...q, accepted_answers: ['C'] } : q)) })) },
      ),
    };
    expect(key(exam)).toContain(`1 B${PDF_TEXT.orSeparator}C`);
  });
});

describe('withoutTrailingMargin', () => {
  it('去掉一節最後一個節點（含最後的子節點）的下邊界，其他不動', () => {
    const content: PdfContent[] = [
      { text: 'a', margin: [0, 0, 0, 6] },
      { stack: [{ text: 'b', margin: 4 }, { text: 'c', margin: [1, 2] }], margin: [0, 3, 0, 5] },
    ];
    const out = withoutTrailingMargin(content);
    expect(out[0]).toEqual({ text: 'a', margin: [0, 0, 0, 6] });
    expect(out[1]).toEqual({ stack: [{ text: 'b', margin: 4 }, { text: 'c', margin: [1, 2, 1, 0] }], margin: [0, 3, 0, 0] });
  });
});
