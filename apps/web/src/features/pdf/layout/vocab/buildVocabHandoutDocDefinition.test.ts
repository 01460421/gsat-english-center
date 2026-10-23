/**
 * 單字講義的文件定義（docs/design/vocab-handout.md §9.1）：各類型的 section 順序、答案是獨立的一段、雙面列印的段落開頭、
 * 講義版不登記其他 pageBreakBefore、中文都用中文字型、IPA 用 Tinos、Tatoeba 標示（題目上不加連結）、題目裡沒有答案字、
 * 只有詞彙表出處那一句提到機構名稱、頁首頁尾（每頁都有出處與講義代號，答案頁碼另起）、資料來源頁只列用到的來源。
 */
import { describe, expect, it } from 'vitest';
import type { PdfContent, PdfDocDefinition, PdfNodeInfo, PdfSection } from '../../engine/docTypes';
import { OFFICIAL_NAMES, allText, cjkWithoutChineseFont, findNodes, renderChrome } from '../testUtils';
import { buildVocabHandoutDocDefinition } from './buildVocabHandoutDocDefinition';
import { footerLines } from './chrome';
import { VOCAB_CONTENT_WIDTH, VSIZE } from './metrics';
import { VOCAB_PDF_BOLD, VOCAB_PDF_TEXT } from './strings';
import { estimateTextWidth } from '../../fontRuns';
import { WORDLIST_CREDIT, fixtureData } from './testFixtures';

function sections(doc: PdfDocDefinition): PdfSection[] {
  return doc.content as PdfSection[];
}

/** 全文（不換行空白當成一般空白：「不拆開的一段」裡的空白都換成了不換行空白）。 */
function plainText(content: Parameters<typeof allText>[0]): string {
  return allText(content).replace(/\u00A0/gu, ' ');
}

function sectionTitles(doc: PdfDocDefinition): string[] {
  return sections(doc).map((s) => {
    const text = allText(s.section);
    for (const t of [VOCAB_PDF_BOLD.sourcesTitle, VOCAB_PDF_BOLD.keyTitle, VOCAB_PDF_BOLD.clozeTitle]) if (text.startsWith(t)) return t;
    return text.startsWith(fixtureData('notes').kicker.slice(0, 5)) ? '標題區' : text.slice(0, 8);
  });
}

describe('段落順序', () => {
  it('講義版、背誦版：標題區＋本體 → 句意填空 → 資料來源 → 答案', () => {
    for (const kind of ['notes', 'recite'] as const) {
      const doc = buildVocabHandoutDocDefinition(fixtureData(kind));
      expect(sectionTitles(doc)).toEqual(['標題區', VOCAB_PDF_BOLD.clozeTitle, VOCAB_PDF_BOLD.sourcesTitle, VOCAB_PDF_BOLD.keyTitle]);
    }
  });

  it('句意填空卷、測驗卷：句意填空接在標題區後面；測驗卷三部分', () => {
    const cloze = buildVocabHandoutDocDefinition(fixtureData('cloze'));
    expect(sectionTitles(cloze)).toEqual(['標題區', VOCAB_PDF_BOLD.sourcesTitle, VOCAB_PDF_BOLD.keyTitle]);
    const quiz = buildVocabHandoutDocDefinition(fixtureData('quiz'));
    const text = allText(sections(quiz)[0]?.section);
    const order = ['一、句意填空', '二、中翻英拼字', '三、英選中'].map((t) => text.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain(VOCAB_PDF_TEXT.answerParen);
  });

  it('不附答案時沒有答案段', () => {
    const doc = buildVocabHandoutDocDefinition(fixtureData('notes', { answerKey: false }));
    expect(sectionTitles(doc)).not.toContain(VOCAB_PDF_BOLD.keyTitle);
  });
});

describe('分頁', () => {
  it('講義版不登記任何「標題不落單」的換頁回呼（§8.3）；雙面列印時三段開頭登記 duplex', () => {
    const ids = (doc: PdfDocDefinition) => findNodes(doc.content as PdfContent[], (n) => typeof n.id === 'string').map((n) => n.id as string);
    const plain = buildVocabHandoutDocDefinition(fixtureData('notes'));
    expect(ids(plain).filter((id) => !id.startsWith('vocab-exercise'))).toEqual([]);
    const duplex = buildVocabHandoutDocDefinition(fixtureData('notes', { duplex: true }));
    expect(ids(duplex)).toEqual(['duplex-1', 'duplex-2', 'duplex-3']);
    // 雙面列印：段落開頭落在雙數頁就換頁；單數頁不換。
    const info = (id: string, page: number): PdfNodeInfo => ({ id, pageNumbers: [page], pages: 1, startPosition: { pageNumber: page, top: 100, left: 50, verticalRatio: 0.1 } });
    const helpers = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };
    expect(duplex.pageBreakBefore?.(info('duplex-1', 4), helpers)).toBe(true);
    expect(duplex.pageBreakBefore?.(info('duplex-2', 5), helpers)).toBe(false);
  });

  it('使用方式的「句意填空起始頁」用 pageReference 指到句意填空的標題；雙面列印時不寫頁碼', () => {
    const doc = buildVocabHandoutDocDefinition(fixtureData('notes'));
    const refs = findNodes(doc.content as PdfContent[], (n) => typeof n.pageReference === 'string');
    expect(refs.map((r) => r.pageReference)).toEqual(['vocab-exercise-start']);
    expect(findNodes(doc.content as PdfContent[], (n) => n.id === 'vocab-exercise-start' && typeof n.text !== 'undefined')).toHaveLength(1);
    const duplex = buildVocabHandoutDocDefinition(fixtureData('notes', { duplex: true }));
    expect(findNodes(duplex.content as PdfContent[], (n) => typeof n.pageReference === 'string')).toEqual([]);
  });
});

describe('字型與內容', () => {
  it('含中文的字串都指定中文字型；IPA 片段用 Tinos', () => {
    for (const kind of ['notes', 'recite', 'cloze', 'quiz'] as const) {
      const doc = buildVocabHandoutDocDefinition(fixtureData(kind));
      expect(cjkWithoutChineseFont(doc.content as PdfContent[], 'Tinos')).toEqual([]);
    }
    const doc = buildVocabHandoutDocDefinition(fixtureData('notes'));
    const ipa = findNodes(doc.content as PdfContent[], (n) => typeof n.text === 'string' && n.text.includes('ˈædʌlt'));
    expect(ipa.length).toBeGreaterThan(0);
    for (const n of ipa) expect(n.font).toBe('Tinos');
  });

  it('每句例句與每題都有 Tatoeba 標示；題目上的標示沒有連結，講義版與答案頁有', () => {
    const data = fixtureData('notes');
    const doc = buildVocabHandoutDocDefinition(data);
    const [, exercise, , key] = sections(doc);
    const exerciseText = plainText(exercise?.section);
    for (const item of data.cloze) expect(exerciseText).toContain(item.enAttribution);
    const exerciseLinks = findNodes(exercise?.section, (n) => typeof n.link === 'string');
    expect(exerciseLinks).toEqual([]);
    const keyLinks = findNodes(key?.section, (n) => typeof n.link === 'string').map((n) => n.link);
    for (const item of data.cloze) expect(keyLinks).toContain(item.enUrl);
    const body = sections(doc)[0];
    expect(findNodes(body?.section, (n) => n.link === 'https://tatoeba.org/en/sentences/show/49532').length).toBeGreaterThan(0);
  });

  it('題目文字裡找不到答案字（整字比對）；答案頁找得到', () => {
    const data = fixtureData('cloze');
    const doc = buildVocabHandoutDocDefinition(data);
    const exerciseText = allText(sections(doc)[0]?.section);
    const keyText = allText(sections(doc).at(-1)?.section);
    for (const item of data.cloze) {
      expect(exerciseText).not.toMatch(new RegExp(`\\b${item.answer}\\b`));
      expect(keyText).toMatch(new RegExp(`\\b${item.answer}\\b`));
    }
  });

  it('答案頁：速查表、詳解（原形與形式、→ 講義 #）、未出題的字；答案就是原形時不寫「原形」', () => {
    const doc = buildVocabHandoutDocDefinition(fixtureData('notes'));
    const key = plainText(sections(doc).at(-1)?.section);
    expect(key).toContain(VOCAB_PDF_BOLD.keyQuick);
    expect(key).toContain(VOCAB_PDF_TEXT.paren(`${VOCAB_PDF_TEXT.baseForm('adult')}${VOCAB_PDF_TEXT.itemSeparator}複數`));
    expect(key).toContain(VOCAB_PDF_TEXT.backToEntry(1));
    expect(key).toContain(`${VOCAB_PDF_TEXT.skippedReasons.no_sentence}${VOCAB_PDF_TEXT.skippedCount(1)}`);
    const noDetails = buildVocabHandoutDocDefinition(fixtureData('notes', { keyDetails: false }));
    expect(allText(sections(noDetails).at(-1)?.section)).not.toContain(VOCAB_PDF_BOLD.keyDetails);
  });

  it('不拆開的一段（Tatoeba 標示、→ 講義 #、小標）：段內是不換行空白、片段不在中間換行，前面是可以換行的一般空白', () => {
    for (const kind of ['notes', 'quiz'] as const) {
      const doc = buildVocabHandoutDocDefinition(fixtureData(kind, { clozeZh: true }));
      expect(findNodes(doc.content as PdfContent[], (n) => typeof n.text === 'string' && /Tatoeba #\d/u.test(n.text))).toEqual([]);
      const tatoeba = findNodes(doc.content as PdfContent[], (n) => typeof n.text === 'string' && /Tatoeba\u00A0#\d/u.test(n.text));
      expect(tatoeba.length).toBeGreaterThan(0);
      for (const n of tatoeba) expect(n).toMatchObject({ noWrap: true, preserveLeadingSpaces: true, preserveTrailingSpaces: true });
      // 以不換行空白開頭或結尾的片段都保留頭尾空白：pdfmake 才不會把它們的寬度當成可以截掉，量錯「黏在一起的幾段」的寬度而超出右邊界。
      const glued = findNodes(doc.content as PdfContent[], (n) => typeof n.text === 'string' && /(^\u00A0|\u00A0$)/u.test(n.text));
      expect(glued.length).toBeGreaterThan(0);
      for (const n of glued) expect(n, JSON.stringify(n.text)).toMatchObject({ preserveLeadingSpaces: true, preserveTrailingSpaces: true });
    }
    const key = buildVocabHandoutDocDefinition(fixtureData('notes'));
    const arrows = findNodes(key.content as PdfContent[], (n) => typeof n.text === 'string' && n.text.includes('→'));
    expect(arrows.length).toBeGreaterThan(0);
    for (const n of arrows) expect(n).toMatchObject({ noWrap: true, preserveTrailingSpaces: true });
  });

  it('使用方式：測驗卷依實際印出的部分數寫「共三部分」「共兩部分」，只有句意填空時不寫部分數', () => {
    const howTo = (data: ReturnType<typeof fixtureData>) => plainText(sections(buildVocabHandoutDocDefinition(data))[0]?.section);
    const quiz = fixtureData('quiz');
    expect(howTo(quiz)).toContain('共三部分，題號連續。');
    expect(howTo({ ...quiz, spelling: [] })).toContain('共兩部分，題號連續。');
    const only = howTo({ ...quiz, spelling: [], choice: [] });
    expect(only).not.toContain('部分');
    expect(only).toContain(VOCAB_PDF_TEXT.howTo('cloze', true));
  });

  it('除了詞彙表出處那一句，全文與文件屬性都沒有機構名稱或英文縮寫', () => {
    for (const kind of ['notes', 'recite', 'cloze', 'quiz'] as const) {
      const doc = buildVocabHandoutDocDefinition(fixtureData(kind));
      const pages = renderChrome(doc, sections(doc).map(() => 2));
      const all = [allText(doc.content as PdfContent[]), ...pages.flatMap((p) => [allText(p.header), allText(p.footer)])].join('\n');
      expect(all.split(WORDLIST_CREDIT).join('')).not.toMatch(OFFICIAL_NAMES);
      expect(`${doc.info?.title}${doc.info?.subject}`).not.toMatch(OFFICIAL_NAMES);
    }
  });
});

describe('頁首頁尾（§3.2）', () => {
  it('每頁頁尾有詞彙表出處與講義代號；第 1 頁沒有頁首標題；答案頁碼另起', () => {
    const doc = buildVocabHandoutDocDefinition(fixtureData('notes'));
    // 標題區＋條目 2 頁、句意填空 1 頁、資料來源 1 頁、答案 2 頁。
    const pages = renderChrome(doc, [2, 1, 1, 2]);
    for (const p of pages) {
      expect(allText(p.footer)).toContain(WORDLIST_CREDIT);
      expect(allText(p.footer)).toContain(VOCAB_PDF_TEXT.codeLabel('7Q2MK'));
    }
    expect(pages[0]?.header).toBeNull();
    expect(allText(pages[0]?.footer)).toContain(VOCAB_PDF_TEXT.pageOf(1, 4));
    expect(allText(pages[1]?.header)).toContain('單字講義・Level 4 第 1–3 字');
    expect(allText(pages[3]?.footer)).toContain(VOCAB_PDF_TEXT.pageOf(4, 4));
    expect(allText(pages[4]?.header)).toContain(VOCAB_PDF_TEXT.keyHeader('7Q2MK'));
    expect(allText(pages[4]?.footer)).toContain(VOCAB_PDF_TEXT.keyPageOf(1, 2));
    expect(allText(pages[5]?.footer)).toContain(VOCAB_PDF_TEXT.keyPageOf(2, 2));
  });
});

describe('資料來源與授權頁（§3.6）', () => {
  it('只列用到的來源：有同詞族才印 OEWN 與 Princeton 聲明；ECDICT 的 MIT 全文一定印', () => {
    const notes = buildVocabHandoutDocDefinition(fixtureData('notes'));
    const sourcesOf = (doc: PdfDocDefinition) => allText(sections(doc).find((s) => allText(s.section).startsWith(VOCAB_PDF_BOLD.sourcesTitle))?.section);
    expect(sourcesOf(notes)).toContain('Princeton University');
    expect(sourcesOf(notes)).toContain('Permission is hereby granted, free of charge');
    const cloze = buildVocabHandoutDocDefinition(fixtureData('cloze'));
    expect(sourcesOf(cloze)).not.toContain('Princeton University');
    expect(sourcesOf(cloze)).toContain('Permission is hereby granted, free of charge');
    expect(sourcesOf(cloze)).toContain(VOCAB_PDF_TEXT.sourcesTatoebaCloze);
  });

  it('授權條款的網址：Tatoeba 的 CC BY 2.0 FR 與 CC0 1.0、OEWN 的 CC BY 4.0', () => {
    const sourcesOf = (doc: PdfDocDefinition) => plainText(sections(doc).find((s) => allText(s.section).startsWith(VOCAB_PDF_BOLD.sourcesTitle))?.section);
    const notes = sourcesOf(buildVocabHandoutDocDefinition(fixtureData('notes')));
    expect(notes).toContain('https://creativecommons.org/licenses/by/2.0/fr/');
    expect(notes).toContain('https://creativecommons.org/publicdomain/zero/1.0/');
    expect(notes).toContain('https://creativecommons.org/licenses/by/4.0/');
  });

  it('只寫這份講義成立的說明：原句在答案頁（答案附詳解時）、歷屆出現次數（講義版有印次數時）', () => {
    const sourcesOf = (data: ReturnType<typeof fixtureData>) =>
      plainText(sections(buildVocabHandoutDocDefinition(data)).find((s) => allText(s.section).startsWith(VOCAB_PDF_BOLD.sourcesTitle))?.section);
    expect(sourcesOf(fixtureData('cloze'))).toContain(VOCAB_PDF_TEXT.sourcesTatoebaClozeKey);
    expect(sourcesOf(fixtureData('cloze', { keyDetails: false }))).not.toContain(VOCAB_PDF_TEXT.sourcesTatoebaClozeKey);
    expect(sourcesOf(fixtureData('cloze', { answerKey: false }))).not.toContain(VOCAB_PDF_TEXT.sourcesTatoebaClozeKey);
    expect(sourcesOf(fixtureData('notes'))).toContain(VOCAB_PDF_BOLD.sourceExamStats);
    for (const kind of ['recite', 'cloze', 'quiz'] as const) expect(sourcesOf(fixtureData(kind))).not.toContain(VOCAB_PDF_BOLD.sourceExamStats);
    const zero = fixtureData('notes');
    const noStats = { ...zero, groups: zero.groups.map((g) => ({ ...g, words: g.words.map((w) => ({ ...w, examTotal: 0 })) })) };
    expect(sourcesOf(noStats)).not.toContain(VOCAB_PDF_BOLD.sourceExamStats);
  });

  it('音標取自 Open English WordNet 的字：列出那些字、附 OEWN 與 Princeton 聲明，ECDICT 那一項也註明；頁尾也寫', () => {
    const data = fixtureData('recite');
    const withIpa = { ...data, credits: { ...data.credits, wordnet: null, wordnetIpa: ['god', 'online'] } };
    const doc = buildVocabHandoutDocDefinition(withIpa);
    const sources = plainText(sections(doc).find((s) => allText(s.section).startsWith(VOCAB_PDF_BOLD.sourcesTitle))?.section);
    expect(sources).toContain(VOCAB_PDF_BOLD.sourceWordnetIpa);
    expect(sources).toContain(VOCAB_PDF_TEXT.sourcesWordnetIpaWords(['god', 'online']));
    expect(sources).toContain(VOCAB_PDF_TEXT.sourcesIpaNoteWordnet(2, 4));
    expect(sources).toContain('Princeton University');
    expect(sources).not.toContain(VOCAB_PDF_TEXT.sourcesIpaNote);
    const footer = footerLines(withIpa).join('・');
    expect(footer).toContain('部分音標：Open English WordNet（CC BY 4.0）');
    expect(footerLines(data).join('・')).not.toContain('Open English WordNet');
  });

  it('頁尾的來源摘要依用到的來源組成：沒有例句時不寫 Tatoeba；每一行都放得下', () => {
    const data = fixtureData('notes');
    expect(footerLines(data).join('・')).toContain('例句：Tatoeba');
    expect(footerLines(data).join('・')).toContain('同詞族與同義詞：Open English WordNet');
    const noTatoeba = { ...data, credits: { ...data.credits, tatoeba: false } };
    expect(footerLines(noTatoeba).join('・')).not.toContain('Tatoeba');
    for (const line of footerLines({ ...data, credits: { ...data.credits, wordnetIpa: ['god'] } })) {
      expect(estimateTextWidth(line, VSIZE.footer)).toBeLessThanOrEqual(VOCAB_CONTENT_WIDTH);
    }
  });

  it('文件屬性', () => {
    const doc = buildVocabHandoutDocDefinition(fixtureData('notes'));
    expect(doc.info).toMatchObject({ title: '學測英文中心 單字講義 Level 4 第 1–3 字', author: '學測英文中心', subject: VOCAB_PDF_TEXT.docSubject });
    expect(doc.language).toBe('zh-TW');
  });
});
