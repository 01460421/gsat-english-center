/**
 * 文件定義的共通規則（設計文件 §5、§9.1）：
 *   1. pdfmake 沒有字型備援：任何含中文的字串都必須指定 NotoSerifTC，否則印出來是方框（§10 R4）。
 *   2. 每一頁的頁尾都有出處與「非官方」聲明（§5.2、P3）；題本頁碼只算題本（「第 N 頁／共 M 頁」）。
 *   3. 答案頁不印任何中譯英譯文，只印評分原則網址（D8、P2）。
 *   4. 封面：本站名稱、官方試題 PDF 網址；不印大考中心機構名稱標題；模擬考版印考生欄位與提醒。
 *   5. 本站自組卷（bank-mock §10.3）：學生卷、教師卷、雙面版的段落組合，文件定義、文件屬性與每一節的頁首頁尾都不出現
 *      官方考試機構的名稱或網址；雙面列印的段落開頭與空白頁。
 */
import { describe, expect, it } from 'vitest';
import type { Exam } from '../../../data/exams';
import { MINI_EXAM } from '../../exams/testFixtures';
import type { PdfContent, PdfSection } from '../engine/docTypes';
import { sitePdfOptions, type SitePdfVersion } from '../index';
import { answerKeyContent } from './answerKey';
import { NON_OFFICIAL_NOTICE, sourceLine } from './attribution';
import { buildExamDocDefinition, withoutTrailingMargin } from './buildDocDefinition';
import { SITE_QR } from './cover';
import { PDF_TEXT, SITE_PAPER_TEXT } from './strings';
import { OFFICIAL_NAMES, allText, cjkWithoutChineseFont, findNodes, renderChrome, sitePaperFixture } from './testUtils';

const MOCK_META = { title: '學測英文中心模擬考', paperLabel: '115 學測英文（真題卷）', durationMinutes: 100, strict: true, notices: ['本卷有部分題目沿用歷屆試題。'] };

const variants = [
  { includeAnswerSheet: false, includeAnswerKey: false },
  { includeAnswerSheet: true, includeAnswerKey: true },
  { includeAnswerSheet: true, includeAnswerKey: false, mockMeta: MOCK_META },
];

/** 沒有任何統計的同一份考卷（舊卷、補考、參考試卷）。 */
function withoutStats(exam: Exam): Exam {
  return { ...exam, sections: exam.sections.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.map((q) => ({ ...q, stats: null })) })) })) };
}

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

  it('有全國答對率才說「對照全國答對率」（舊卷、參考試卷沒有統計）', () => {
    const coverText = (exam: Exam) => allText(sections({ includeAnswerSheet: true, includeAnswerKey: false }, exam)[0]?.section);
    expect(coverText(MINI_EXAM)).toContain(PDF_TEXT.howOnline(true));
    expect(coverText(withoutStats(MINI_EXAM))).toContain(PDF_TEXT.howOnline(false));
    expect(coverText(withoutStats(MINI_EXAM))).not.toContain('全國答對率');
  });

  it('原卷答錯倒扣（93 指考）：封面不寫「答錯以零分計算」，改說明原卷倒扣、本站線上計分依現制', () => {
    const ast93: Exam = {
      ...MINI_EXAM,
      id: 'ast-93',
      exam: 'ast',
      year: 93,
      title: '93學年度指定科目考試英文考科',
      sections: MINI_EXAM.sections
        .filter((s) => s.type !== 'mixed')
        .map((s) => (s.id === 's1' ? { ...s, instructions: '說明︰第1至15題，每題選出最適當的一個選項，標示在答案卡之「選擇題答案區」。每題答對得1分，答錯倒扣1/3分，倒扣到本大題之實得分數為零為止。未作答者，不給分亦不扣分。' } : s)),
    };
    const text = allText(sections({ includeAnswerSheet: false, includeAnswerKey: false }, ast93)[0]?.section);
    expect(text).toContain(PDF_TEXT.scoringPenaltyNote);
    expect(text).not.toContain(PDF_TEXT.scoringSingle.slice(0, 20));
    // 說明框照原卷印倒扣規則
    expect(allText(sections({ includeAnswerSheet: false, includeAnswerKey: false }, ast93)[1]?.section)).toContain('答錯倒扣1/3分');
    // 「答錯不倒扣」不是倒扣
    const noPenalty: Exam = { ...ast93, sections: ast93.sections.map((s) => (s.id === 's1' ? { ...s, instructions: '說明︰每題答對得1分，答錯不倒扣。' } : s)) };
    const plain = allText(sections({ includeAnswerSheet: false, includeAnswerKey: false }, noPenalty)[0]?.section);
    expect(plain).toContain(PDF_TEXT.scoringSingle.slice(0, 20));
    expect(plain).not.toContain(PDF_TEXT.scoringPenaltyNote);
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

  it('註記只寫答案頁上真的有的東西：有統計才說明百分比，有官方混合題答案才說「取自參考答案」', () => {
    const text = key();
    expect(text).toContain(PDF_TEXT.answerKeyChoiceNote);
    expect(text).toContain(PDF_TEXT.answerKeyRateNote);
    expect(text).toContain(PDF_TEXT.answerKeyMixedNote);
    expect(text).not.toContain(PDF_TEXT.answerKeyOpenAnswerNote);

    const noStats = key(withoutStats(MINI_EXAM));
    expect(noStats).toContain(PDF_TEXT.answerKeyChoiceNote);
    expect(noStats).not.toContain(PDF_TEXT.answerKeyRateNote);
    expect(noStats).not.toContain('%');
  });

  it('官方沒公布非選擇題答案（92 學測補考）：不印「答案取自參考答案」；舊卷的非選擇題有答案時用不寫「混合題」的說法', () => {
    const openOnly = (answer: string | null): Exam => ({
      ...MINI_EXAM,
      sections: MINI_EXAM.sections.map((s) =>
        s.type !== 'mixed'
          ? s
          : {
              ...s,
              type: 'short_answer',
              groups: s.groups.map((g) => ({
                ...g,
                questions: g.questions
                  .filter((q) => q.mode === 'fill_in_blank' || q.mode === 'short_answer')
                  .map((q) => ({ ...q, answer, accepted_answers: null }) as typeof q),
              })),
            },
      ),
    });
    const none = key(openOnly(null));
    expect(none).toContain(PDF_TEXT.noOfficialAnswer);
    expect(none).not.toContain(PDF_TEXT.answerKeyMixedNote);
    expect(none).not.toContain(PDF_TEXT.answerKeyOpenAnswerNote);
    const some = key(openOnly('answer'));
    expect(some).toContain(PDF_TEXT.answerKeyOpenAnswerNote);
    expect(some).not.toContain(PDF_TEXT.answerKeyMixedNote);
  });

  it('答案不在格子裡斷行；題號不是數字（83 學測「選填1」）時一列排 5 題', () => {
    const doc = sections({ includeAnswerSheet: false, includeAnswerKey: true })[2]?.section;
    const answers = findNodes(doc, (n) => n.bold === true && n.noWrap === true).map((n) => n.text);
    expect(answers).toContain('B');
    expect(answers).toContain(PDF_TEXT.allCredit);
    const wide: Exam = {
      ...MINI_EXAM,
      sections: MINI_EXAM.sections.map((s) => (s.id !== 's3' ? s : { ...s, groups: s.groups.map((g) => ({ ...g, questions: g.questions.map((q) => ({ ...q, label: `選填${q.no - 20}` })) })) })),
    };
    const tables = findNodes(sections({ includeAnswerSheet: false, includeAnswerKey: true }, wide)[2]?.section, (n) => 'table' in n && Array.isArray((n.table as { widths?: unknown[] }).widths));
    const widths = tables.map((t) => (t.table as { widths: unknown[] }).widths.length);
    expect(widths).toContain(5);
    expect(widths).toContain(10);
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

describe('參考試卷的頁首', () => {
  it('同一年的指考、學測參考試卷分得出來（102 指考參考試卷／102 學測參考試卷）；試辦考試另外寫', () => {
    const ref = (title: string): Exam => ({ ...MINI_EXAM, id: 'ref-102-a', exam: 'reference', year: 102, target: 'ast', title });
    const ast = ref('指定科目考試參考試卷（適用於99課綱）英文考科');
    const gsat = ref('學科能力測驗參考試卷（適用於99課綱）英文考科');
    expect(PDF_TEXT.examShort(ast)[0]).toBe('102指考參考試卷');
    expect(PDF_TEXT.examShort(gsat)[0]).toBe('102學測參考試卷');
    expect(PDF_TEXT.sheetHeader(ast)).not.toBe(PDF_TEXT.sheetHeader(gsat));
    expect(PDF_TEXT.keyHeader(gsat)).toBe('102學測參考試卷　答案');
    expect(PDF_TEXT.examShort({ ...ast, year: 110, title: '110年試辦考試（適用於108課綱）英文考科' })[0]).toBe('110試辦考試');
    const doc = buildExamDocDefinition(ast, { includeAnswerSheet: true, includeAnswerKey: false });
    const pages = renderChrome(doc, [1, 2, 1]);
    expect(allText(pages[1]?.header)).toContain('102指考參考試卷');
    expect(allText(pages[3]?.header)).toContain('102指考參考試卷　答題卷');
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

// ---------------------------------------------------------------------------
// 本站自組卷（docs/design/bank-mock.md §7、§10.3）
// ---------------------------------------------------------------------------

describe('本站自組卷', () => {
  const fx = sitePaperFixture();
  const build = (version: SitePdfVersion, duplex = false) =>
    buildExamDocDefinition(fx.exam, { ...sitePdfOptions(version, duplex), mockMeta: fx.mockMeta, onlineUrl: fx.onlineUrl });
  const segmentsOf = (doc: ReturnType<typeof build>) =>
    (doc.content as PdfSection[]).map((s) => {
      const header = s.header?.(2, 9, { width: 595.28, height: 841.89 }) ?? null;
      return allText(header);
    });
  const versions = [
    ['學生卷', 'student', false],
    ['教師卷', 'teacher', false],
    ['題本＋答案＋解析（雙面）', 'full', true],
  ] as const;

  it.each(versions)('%s：文件定義、文件屬性與每一節的頁首頁尾都沒有官方考試機構的名稱或網址', (_name, version, duplex) => {
    const doc = build(version, duplex);
    expect(allText(doc.content as PdfContent[])).not.toMatch(OFFICIAL_NAMES);
    for (const value of Object.values(doc.info ?? {})) expect(value).not.toMatch(OFFICIAL_NAMES);
    // 頁首頁尾是函式：每一節各 2 頁，實際呼叫再檢查回傳的節點（也包含雙面列印的空白頁）。
    const chrome = renderChrome(doc, doc.content.map(() => 2));
    for (const page of chrome) {
      expect(allText(page.header)).not.toMatch(OFFICIAL_NAMES);
      expect(allText(page.footer)).not.toMatch(OFFICIAL_NAMES);
      expect(allText(page.footer)).toContain(SITE_PAPER_TEXT.footerSource(fx.site.code));
      expect(allText(page.footer)).toContain(SITE_PAPER_TEXT.footerNotice);
    }
  });

  it.each(versions)('%s：含中文的字串都指定了中文字型（含頁首頁尾）', (_name, version, duplex) => {
    const doc = build(version, duplex);
    const chrome = renderChrome(doc, doc.content.map(() => 2));
    expect(cjkWithoutChineseFont(doc.content as PdfContent[])).toEqual([]);
    expect(cjkWithoutChineseFont(chrome.flatMap((c) => [c.header, c.footer]))).toEqual([]);
  });

  it('文件屬性：標題有難度與卷號（教師卷加「教師卷」），主旨是本站的聲明', () => {
    expect(build('student').info).toMatchObject({ title: SITE_PAPER_TEXT.docTitle('進階練習', fx.site.code, false), subject: SITE_PAPER_TEXT.docSubject });
    expect(build('teacher').info?.title).toBe(`學測英文中心自組模擬考 進階練習 ${fx.site.code} 教師卷`);
  });

  it('學生卷：封面 → 題本 → 資料來源 → 答題卷；沒有答案與解析', () => {
    const doc = build('student');
    const sections = doc.content as PdfSection[];
    expect(sections).toHaveLength(4);
    const text = allText(sections as unknown as PdfContent[]);
    expect(text).toContain(fx.site.code);
    expect(text).toContain(fx.site.dataVersion);
    expect(text).toContain(fx.site.aiNotice);
    expect(text).toContain(SITE_PAPER_TEXT.assembledOn('2026-10-19'));
    expect(allText(sections[2]?.section)).toContain(SITE_PAPER_TEXT.sourcesTitle);
    expect(allText(sections[3]?.section)).toContain(PDF_TEXT.choiceCardTitle);
    expect(text).not.toContain(SITE_PAPER_TEXT.answerKeyChoiceNote);
    expect(text).not.toContain(SITE_PAPER_TEXT.translationAnswerLabel);
    expect(text).not.toContain(SITE_PAPER_TEXT.explanationMissing.slice(0, 6));
    expect(segmentsOf(doc)[3]).toContain(SITE_PAPER_TEXT.sheetHeader('進階練習'));
    expect(segmentsOf(doc).join('')).not.toContain(SITE_PAPER_TEXT.keyHeader('進階練習'));
    expect(segmentsOf(doc).join('')).not.toContain(SITE_PAPER_TEXT.explanationsHeader('進階練習'));
  });

  it('教師卷：卷子資訊＋答案 → 解析 → 資料來源；沒有封面與題本的節點', () => {
    const doc = build('teacher');
    const sections = doc.content as PdfSection[];
    expect(sections).toHaveLength(3);
    const [key, explanations, sources] = sections.map((s) => allText(s.section));
    expect(key?.indexOf(SITE_PAPER_TEXT.teacherTitle)).toBe(0);
    expect(key).toContain(fx.site.code);
    expect(key).toContain(PDF_TEXT.answerKeyTitle);
    expect(explanations).toContain(SITE_PAPER_TEXT.explanationsTitle);
    expect(sources).toContain(SITE_PAPER_TEXT.sourcesTitle);
    const text = allText(sections as unknown as PdfContent[]);
    expect(text).not.toContain(PDF_TEXT.noticeTitle);
    expect(text).not.toContain(SITE_PAPER_TEXT.coverBand);
    expect(text).not.toContain('reading passage'); // 題本的選文
    expect(findNodes(sections as unknown as PdfContent[], (n) => 'qr' in n)).toEqual([]);
  });

  it('題本＋答案＋解析：封面 → 題本 → 資料來源 → 答題卷 → 答案 → 解析', () => {
    const doc = build('full');
    expect(segmentsOf(doc).slice(3)).toEqual([
      expect.stringContaining(SITE_PAPER_TEXT.sheetHeader('進階練習')),
      expect.stringContaining(SITE_PAPER_TEXT.keyHeader('進階練習')),
      expect.stringContaining(SITE_PAPER_TEXT.explanationsHeader('進階練習')),
    ]);
  });

  it('封面：本站卷名、卷號、班級與座號欄、組卷日期、資料版本、AI 聲明；只有一個放大、容錯 M 的 QR code（網址結尾 .p）', () => {
    const cover = (build('student').content as PdfSection[])[0]?.section;
    const text = allText(cover);
    expect(text).toContain(fx.mockMeta.title);
    expect(text).toContain(fx.mockMeta.paperLabel);
    expect(text).toContain(SITE_PAPER_TEXT.coverFormat);
    expect(text).toContain(SITE_PAPER_TEXT.coverBand);
    expect(text).toContain(SITE_PAPER_TEXT.howOnline);
    for (const field of SITE_PAPER_TEXT.candidateFieldRows.flat()) expect(text).toContain(field);
    expect(text).toContain(SITE_PAPER_TEXT.codeNote);
    expect(text.replace(/\s/g, '')).toContain(fx.onlineUrl);
    expect(text).not.toContain(PDF_TEXT.coverFigureNote);
    expect(findNodes(cover, (n) => 'qr' in n)).toEqual([expect.objectContaining({ qr: fx.onlineUrl, fit: SITE_QR.fit, eccLevel: 'M' })]);
    expect(fx.onlineUrl.endsWith('.p')).toBe(true);
  });

  it('答題卷第一頁：班級、座號欄；右上角卷號與同一個 QR code（大小、容錯同封面）；本站的說明文字', () => {
    const sheet = (build('student').content as PdfSection[])[3]?.section;
    const text = allText(sheet);
    for (const field of SITE_PAPER_TEXT.sheetFieldRows.flat()) expect(text).toContain(field);
    expect(text).toContain(SITE_PAPER_TEXT.codeLabel(fx.site.code));
    expect(text).toContain(SITE_PAPER_TEXT.answerSheetNote);
    expect(text).not.toContain(PDF_TEXT.answerSheetNote);
    expect(findNodes(sheet, (n) => 'qr' in n)).toEqual([expect.objectContaining({ qr: fx.onlineUrl, fit: SITE_QR.fit, eccLevel: 'M' })]);
  });

  it('答案頁：本站答案、混合題的可接受答案、中譯英參考譯文、作文評分重點；不印全國答對率', () => {
    const key = allText((build('teacher').content as PdfSection[])[0]?.section);
    expect(key).toContain(SITE_PAPER_TEXT.answerKeyChoiceNote);
    expect(key).toContain(SITE_PAPER_TEXT.answerKeyMixedNote);
    expect(key).toContain(SITE_PAPER_TEXT.translationAnswerLabel);
    expect(key).toContain('In recent years, many students have started to bring their own water bottles to school.');
    expect(key).toContain(SITE_PAPER_TEXT.compositionCriteriaLabel);
    for (const line of fx.site.answers.composition.criteria) expect(key).toContain(line);
    expect(key).toContain('47.');
    expect(key).toContain('alpha');
    expect(key).not.toContain(PDF_TEXT.answerKeyRateNote);
    expect(key).not.toContain(PDF_TEXT.translationAnswer);
    expect(key).not.toContain(PDF_TEXT.compositionAnswer);
  });

  it('答案頁：混合題答案下方印部分給分的寫法，頁末印部分給分的規則（同線上自動計分）；不叫老師去看解析', () => {
    const key = allText((build('teacher').content as PdfSection[])[0]?.section);
    // 測試資料第 47 題的 partial_credit_forms 是 alphas（線上打 alphas 得 1 分，紙本也要看得到）。
    expect(fx.site.answers.partialCredit).toEqual({ '47': ['alphas'] });
    expect(key).toContain(`47.alpha${SITE_PAPER_TEXT.partialCredit(['alphas'])}48.`);
    expect(key).toContain(SITE_PAPER_TEXT.answerKeyPartialNote);
    expect(key).not.toContain('見解析');
  });

  it('答案頁缺字：答案、參考譯文、評分重點先套用替代表；替代後仍有字型沒有的字，那一題（那一項）改印替代說明', () => {
    const rare = '\u{20000}';
    const exam = structuredClone(fx.exam);
    const q50 = exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).find((q) => q.label === '50');
    if (q50?.mode !== 'short_answer') throw new Error('測試資料的第 50 題應該是簡答');
    q50.accepted_answers = ['gamma', `gam${rare}`];
    const answers = fx.site.answers;
    const site = {
      ...fx.site,
      answers: {
        ...answers,
        translation: { ...answers.translation, 中譯英1: [`I like ${rare} fish.`], 中譯英2: ['Zero is \u3007 here.'] },
        composition: { ...answers.composition, criteria: [`內容：${rare}`, '組織：A \u2260 B'] },
        partialCredit: { '47': ['alphas'], '48': [`bet${rare}`] },
      },
    };
    const text = allText(answerKeyContent(exam, { site }));
    expect(text).not.toContain(rare);
    expect(text).toContain('Zero is \u25cb here.');
    expect(text).toContain('組織：A 不等於 B');
    expect(text).toContain(`47.alpha${SITE_PAPER_TEXT.partialCredit(['alphas'])}`);
    for (const label of ['48', '50']) expect(text).toContain(`${label}.${SITE_PAPER_TEXT.answerMissing}`);
    expect(text).toContain(`1.${SITE_PAPER_TEXT.answerMissing}`);
    expect(text).toContain(SITE_PAPER_TEXT.criterionMissing);
  });

  it('資料來源頁：AI 聲明、出處說明、參考資料與圖表資料的授權', () => {
    const sources = allText((build('student').content as PdfSection[])[2]?.section);
    expect(sources).toContain(SITE_PAPER_TEXT.sourcesIntro);
    for (const group of fx.site.references) {
      expect(sources).toContain(SITE_PAPER_TEXT.sourcesRange(group.range));
      for (const item of group.items) expect(sources.replace(/\s/g, '')).toContain(item.url);
    }
    expect(sources).toContain('CC BY 4.0');
    expect(sources).toContain('https://creativecommons.org/licenses/by/4.0/');
  });
});

describe('雙面列印（本站自組卷）', () => {
  const fx = sitePaperFixture();
  const doc = buildExamDocDefinition(fx.exam, { ...sitePdfOptions('full', true), mockMeta: fx.mockMeta, onlineUrl: fx.onlineUrl });
  const sections = doc.content as PdfSection[];
  const ids = sections.map((s) => findNodes(s.section, (n) => typeof n.id === 'string' && (n.id as string).startsWith('duplex-'))[0]?.id as string | undefined);
  const nodeAt = (id: string, pageNumber: number) =>
    ({ id, pageNumbers: [pageNumber], pages: 30, startPosition: { pageNumber, top: 84, left: 64, verticalRatio: 0 } }) as Parameters<NonNullable<typeof doc.pageBreakBefore>>[0];
  const helpers = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };

  it('答題卷、答案、解析每一段的第一個節點是段落開頭；封面、題本、資料來源不是', () => {
    expect(ids.map((id) => id !== undefined)).toEqual([false, false, false, true, true, true]);
  });

  it('段落開頭落在雙數頁就換頁，落在單數頁不換；不勾雙面列印就沒有段落開頭', () => {
    const [, , , sheet, key] = ids;
    expect(doc.pageBreakBefore?.(nodeAt(sheet ?? '', 14), helpers)).toBe(true);
    expect(doc.pageBreakBefore?.(nodeAt(key ?? '', 19), helpers)).toBe(false);
    const single = buildExamDocDefinition(fx.exam, { ...sitePdfOptions('full', false), mockMeta: fx.mockMeta });
    expect(findNodes(single.content as PdfContent[], (n) => typeof n.id === 'string' && (n.id as string).startsWith('duplex-'))).toEqual([]);
  });

  it('補的空白頁印「（本頁空白）」與出處，不算進那一節的頁碼', () => {
    const fresh = buildExamDocDefinition(fx.exam, { ...sitePdfOptions('student', true), mockMeta: fx.mockMeta, onlineUrl: fx.onlineUrl });
    const sheetId = findNodes((fresh.content as PdfSection[])[3]?.section, (n) => typeof n.id === 'string' && (n.id as string).startsWith('duplex-'))[0]?.id as string;
    // 封面 1、題本 10、資料來源 1：答題卷落在第 13 頁（單數）→ 不換頁；改成第 14 頁（雙數）→ 第 14 頁留白。
    expect(fresh.pageBreakBefore?.(nodeAt(sheetId, 14), helpers)).toBe(true);
    const pages = renderChrome(fresh, [1, 10, 2, 5]);
    const blank = pages[13];
    expect(allText(blank?.footer)).toContain(SITE_PAPER_TEXT.blankPage);
    expect(allText(blank?.footer)).toContain(SITE_PAPER_TEXT.footerSource(fx.site.code));
    expect(allText(blank?.header)).toContain(SITE_PAPER_TEXT.sheetHeader('進階練習'));
    expect(allText(pages[14]?.footer)).toContain(PDF_TEXT.pageOfShort(1, 4));
    expect(allText(pages[17]?.footer)).toContain(PDF_TEXT.pageOfShort(4, 4));
    expect(allText(pages[12]?.footer)).not.toContain(SITE_PAPER_TEXT.blankPage);
  });
});
