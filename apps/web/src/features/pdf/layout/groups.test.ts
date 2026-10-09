/** 題組 → 區塊（設計文件 §5.4–§5.9）：圖片描述框的位置、題組標示、綜合測驗與選項庫的排法。 */
import { describe, expect, it } from 'vitest';
import type { ExamSection, Figure, Question, QuestionGroup } from '../../../data/exams';
import { groupBlocks, groupLabelText } from './groups';
import { clusterNumberText, questionNumberText, withoutLeadingNumber } from './questions';
import { PDF_TEXT } from './strings';
import { allText } from './testUtils';

const q = (no: number, extra: Partial<Question> = {}): Question =>
  ({ no, label: String(no), mode: 'single_choice', stem: `Question ${no} stem?`, options: { A: 'alpha', B: 'beta', C: 'gamma', D: 'delta' }, answer: 'A', accepted_answers: null, points: 2, stats: null, tags: {}, ...extra }) as Question;

const group = (extra: Partial<QuestionGroup>): QuestionGroup => ({ id: 'g', passage: null, passage_parts: null, figures: [], options_bank: null, questions: [], tags: null, ...extra });
const section = (type: ExamSection['type']): ExamSection => ({ id: 's', type, title: '五、閱讀測驗', part: '選擇題', instructions: '', points_total: null, groups: [] });
const figure = (extra: Partial<Figure>): Figure => ({ kind: 'map', caption: '地圖', description: '一張地圖的文字描述。', ...extra });

const blockTexts = (blocks: ReturnType<typeof groupBlocks>) => blocks.map((b) => allText(b.node));

describe('圖片描述框的位置', () => {
  it('有 question_no：放在該題前面、和該題包成不跨頁', () => {
    const blocks = groupBlocks(section('reading'), group({ passage: 'A passage.', questions: [q(37), q(38), q(39)], figures: [figure({ question_no: 38, caption: '第38題選項' })] }));
    const texts = blockTexts(blocks);
    const at = texts.findIndex((t) => t.includes('第38題選項'));
    expect(texts[at]).toContain('38.');
    expect(texts[at]?.indexOf('第38題選項')).toBeLessThan(texts[at]?.indexOf('38.') ?? -1);
    expect(blocks[at]?.node).toMatchObject({ unbreakable: true });
  });

  it('沒有 question_no：放在選文之後、第一題之前；虛線框印「原圖請見」', () => {
    const blocks = groupBlocks(section('reading'), group({ passage: 'A short passage.', questions: [q(40), q(41)], figures: [figure({ caption: '街區地圖' })] }));
    const text = blockTexts(blocks).join('|');
    expect(text.indexOf('A short passage.')).toBeLessThan(text.indexOf('街區地圖'));
    expect(text.indexOf('街區地圖')).toBeLessThan(text.indexOf('40.'));
    expect(text).toContain(PDF_TEXT.figureNote);
    expect(text).toContain(`${PDF_TEXT.figureLabel}地圖${PDF_TEXT.figureSeparator}街區地圖`);
  });

  it('表格（rows）印成真的表格，不加「原圖請見」；待填格照原文', () => {
    const blocks = groupBlocks(section('reading'), group({ passage: 'P.', questions: [q(40)], figures: [{ kind: 'table', caption: '樓梯資料', description: '兩欄表格', rows: [['Castle', 'Turn'], ['A', '______']] }] }));
    const text = blockTexts(blocks).join('|');
    expect(text).toContain(`${PDF_TEXT.tableLabel}樓梯資料`);
    expect(text).toContain('CastleTurnA______');
    expect(text).not.toContain(PDF_TEXT.figureNote);
  });

  it('作文的圖放在提示之後', () => {
    const comp = { ...q(1), label: '英文作文', mode: 'composition', stem: '提示︰請寫一篇作文。', options: null, answer: null } as Question;
    const blocks = groupBlocks(section('composition'), group({ questions: [comp], figures: [figure({ kind: 'photo', caption: '公園' })] }));
    const text = blockTexts(blocks).join('|');
    expect(text.indexOf('請寫一篇作文')).toBeLessThan(text.indexOf('公園'));
    expect(text).toContain('提示︰');
  });
});

describe('題組標示', () => {
  it('資料有就照印；沒有就依題號產生；單題、沒有選文、中譯英不印', () => {
    expect(groupLabelText(section('reading'), group({ group_label: '第41至44題為題組', passage: 'x', questions: [q(41), q(44)] }))).toBe('第41至44題為題組');
    expect(groupLabelText(section('reading'), group({ passage: 'x', questions: [q(43), q(44), q(45), q(46)] }))).toBe(PDF_TEXT.groupRange('43', '46'));
    expect(groupLabelText(section('reading'), group({ passage: 'x', questions: [q(43)] }))).toBeNull();
    expect(groupLabelText(section('vocabulary'), group({ questions: [q(1), q(2)] }))).toBeNull();
    const tr = (no: number) => ({ ...q(no), label: `中譯英${no}`, mode: 'translation' }) as Question;
    expect(groupLabelText(section('translation'), group({ passage: '短文', questions: [tr(1), tr(2)] }))).toBeNull();
  });
});

describe('綜合測驗與選項庫', () => {
  it('綜合測驗：選文之後依題號列出「11. (A) …」，不重印題幹', () => {
    const blocks = groupBlocks(section('cloze'), group({ passage: 'Rhinos [[11]] and [[12]].', questions: [q(11, { stem: 'Rhinos ______ and' }), q(12, { stem: null })] }));
    const text = blockTexts(blocks).join('|');
    expect(text).toContain('11.(A) alpha');
    expect(text).not.toContain('Rhinos ______');
  });

  it('文意選填：選項框接在選文最後一段後面、綁在一起', () => {
    const bankQ = (no: number) => ({ ...q(no), mode: 'bank_choice', stem: null, options: null }) as Question;
    const blocks = groupBlocks(
      { ...section('word_bank'), type: 'word_bank' },
      group({ passage: 'First [[21]].\nLast [[22]].', options_bank: { A: 'retain', B: 'risk' }, questions: [bankQ(21), bankQ(22)] }),
    );
    const text = blockTexts(blocks).join('|');
    expect(text.indexOf('Last')).toBeLessThan(text.indexOf('(A) retain'));
  });

  it('句子配合題（空格不在選文裡）：選項框在前，題目逐題列出', () => {
    const bankQ = (no: number, stem: string) => ({ ...q(no), mode: 'bank_choice', stem, options: null }) as Question;
    const blocks = groupBlocks({ ...section('sentence_matching') }, group({ options_bank: { A: 'he was tired.', B: 'by a dog.' }, questions: [bankQ(26, 'People in this village…'), bankQ(27, 'Ruth is attracted…')] }));
    const text = blockTexts(blocks).join('|');
    expect(text.indexOf('he was tired.')).toBeLessThan(text.indexOf('26.'));
    expect(text).toContain('People in this village…');
  });

  it('中譯英的題目已經劃線寫在短文裡（85 學測）：不重印', () => {
    const tr = (no: number, stem: string) => ({ ...q(no), label: `中譯英${no}`, mode: 'translation', stem, options: null }) as Question;
    const blocks = groupBlocks(section('translation'), group({ passage: '<u>1.你有沒有想過未來?</u> You need not wonder.', questions: [tr(1, '你有沒有想過未來?'), tr(2, '另一句不在短文裡。')] }));
    const text = blockTexts(blocks).join('|');
    expect(text.match(/你有沒有想過未來/g)).toHaveLength(1);
    expect(text).toContain('2.另一句不在短文裡。');
  });
});

describe('題號', () => {
  it('數字題「11.」；大題內編號「1.」；93 指考翻譯「(a)」；作文不印', () => {
    expect(questionNumberText({ label: '11', no: 11, mode: 'single_choice' })).toBe('11.');
    expect(questionNumberText({ label: '47A', no: 47, mode: 'fill_in_blank' })).toBe('47A.');
    expect(questionNumberText({ label: '中譯英2', no: 2, mode: 'translation' })).toBe('2.');
    expect(questionNumberText({ label: '英文翻譯(b)', no: 2, mode: 'translation' })).toBe('(b)');
    expect(questionNumberText({ label: '英文作文', no: 1, mode: 'composition' })).toBe('');
  });

  it('題幹開頭已經寫了題號就拿掉（112 學測「47-48 請從文章中…」）', () => {
    expect(withoutLeadingNumber('47-48 請從文章中找出', '47-48')).toBe('請從文章中找出');
    expect(withoutLeadingNumber('47. 請選出', '47.')).toBe('請選出');
    expect(withoutLeadingNumber('47 people were there', '47.')).toBe('47 people were there');
    expect(withoutLeadingNumber('470 people', '47.')).toBe('470 people');
    expect(withoutLeadingNumber('What is it?', '47.')).toBe('What is it?');
  });

  it('共用題幹的填充題：題號不同印「47-48」，同一題的子題印「47.」', () => {
    expect(clusterNumberText([{ label: '47', no: 47 }, { label: '48', no: 48 }])).toBe('47-48');
    expect(clusterNumberText([{ label: '47A', no: 47 }, { label: '47B', no: 47 }])).toBe('47.');
  });
});
