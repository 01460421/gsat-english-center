/**
 * exam.ts 的小工具與常數。這些是之後各題型模組（前端渲染空格、高亮被問的字、展開翻譯參考答案、
 * Worker 匯入 D1）會共用的判斷，錯了會讓作答框放錯位置、高亮到錯的 it，或把選擇題當成填充題，
 * 所以把規格文件（docs/exam-json-schema.md）裡的例子寫死在這裡。
 * 對實際 data/ 的檢查在 exam.data.test.ts（npm run test:data）。
 */
import { describe, expect, it } from 'vitest';
import {
  EXAM_ID_PATTERN,
  EXAM_SCHEMA_ID,
  ESSAY_TYPES,
  GRAMMAR_POINTS,
  QUESTION_TAG_KEYS_BY_SECTION,
  SECTION_TYPES,
  STRUCTURE_CLUES,
  blankNumbers,
  expandAnswerSegments,
  expectedTextFormat,
  findOccurrences,
  groupText,
  isChoiceQuestion,
  isIndependentlyNumbered,
  joinAnswerSegments,
  locateRefersTo,
  markupProblem,
  stripMarkup,
  type Figure,
  type Question,
  type QuestionGroup,
} from './exam';

const base = {
  no: 1,
  label: '1',
  stem: 'The mayor has such a ______ schedule.',
  accepted_answers: null,
  points: 1,
  stats: null,
  scoring_notes: null,
  tags: {},
} as const;

describe('EXAM_SCHEMA_ID', () => {
  it('是 v1.1（v1 檔案要先跑 tools/normalize_exams.py）', () => {
    expect(EXAM_SCHEMA_ID).toBe('gsat-exam/v1.1');
  });
});

describe('isChoiceQuestion', () => {
  it('單選、多選、選項庫作答都是選擇題', () => {
    const questions: Question[] = [
      { ...base, mode: 'single_choice', options: { A: 'hasty', B: 'tight' }, answer: 'B' },
      { ...base, mode: 'bank_choice', options: null, answer: 'C' },
      { ...base, mode: 'multi_select', options: { A: 'x', B: 'y', C: 'z' }, answer: ['A', 'C'] },
    ];
    for (const q of questions) expect(isChoiceQuestion(q), q.mode).toBe(true);
  });

  it('填充、簡答、表格填空、翻譯、作文不是選擇題', () => {
    const questions: Question[] = [
      { ...base, mode: 'fill_in_blank', options: null, answer: 'tighten' },
      { ...base, mode: 'short_answer', options: null, answer: null },
      { ...base, mode: 'table_completion', options: null, answer: 'Tuesday', answer_table: [['day'], ['Tuesday']] },
      { ...base, mode: 'translation', options: null, answer: null, answer_segments: [['Hi']] },
      { ...base, mode: 'composition', options: null, answer: null },
    ];
    for (const q of questions) expect(isChoiceQuestion(q), q.mode).toBe(false);
  });
});

describe('blankNumbers', () => {
  it('依出現順序取出 [[題號]]', () => {
    expect(blankNumbers('Text with blanks [[11]] ... [[12]] and [[13]].')).toEqual([11, 12, 13]);
  });

  it('沒有空格時回空陣列；連續呼叫結果相同（g 旗標的 lastIndex 不會殘留）', () => {
    expect(blankNumbers('no blanks here')).toEqual([]);
    expect(blankNumbers('[[1]] [[2]]')).toEqual([1, 2]);
    expect(blankNumbers('[[1]] [[2]]')).toEqual([1, 2]);
  });

  it('單層方括號或非數字不算空格', () => {
    expect(blankNumbers('[11] [[A]] [[ 12 ]]')).toEqual([]);
  });
});

describe('EXAM_ID_PATTERN（與 tools/validate_exam.py 的 ID_RE 相同）', () => {
  it('接受規格文件列出的命名', () => {
    for (const id of ['gsat-115', 'gsat-91-makeup', 'ast-110', 'ast-109-makeup', 'ref-115', 'ref-98-a']) {
      expect(EXAM_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it('拒絕不合規則的命名', () => {
    for (const id of ['gsat-1', 'gsat-1150', 'ref-115-makeup', 'ref-98-ab', 'ast-110-a', 'GSAT-115', 'gsat-115.json']) {
      expect(EXAM_ID_PATTERN.test(id), id).toBe(false);
    }
  });
});

describe('v1.1 封閉集合', () => {
  it('essay_type 不再有 two_paragraph（段數記在 paragraphs）', () => {
    expect(ESSAY_TYPES).toEqual(['picture', 'chart', 'letter', 'topic', 'continuation', 'other']);
  });

  it('grammar_point、clue 都有 other 可用，舊名稱已併入', () => {
    expect(GRAMMAR_POINTS).toContain('other');
    expect(GRAMMAR_POINTS).not.toContain('modal_perfect');
    expect(GRAMMAR_POINTS).toContain('existential');
    expect(STRUCTURE_CLUES).toContain('lexical_cohesion');
    expect(STRUCTURE_CLUES).not.toContain('lexical_link');
    expect(STRUCTURE_CLUES).not.toContain('conclusion');
  });

  it('每種大題都定義了允許的 tags 欄位；作文用 word_count 取代 word_requirement', () => {
    for (const type of SECTION_TYPES) expect(QUESTION_TAG_KEYS_BY_SECTION[type], type).toBeDefined();
    expect(QUESTION_TAG_KEYS_BY_SECTION.composition).toContain('word_count');
    expect(QUESTION_TAG_KEYS_BY_SECTION.composition).not.toContain('word_requirement' as never);
    expect(QUESTION_TAG_KEYS_BY_SECTION.cloze).toContain('answer_function');
  });
});

describe('markupProblem／stripMarkup：只允許成對的 <u>、<b>', () => {
  it('合法的標記回傳 null', () => {
    for (const text of ['plain', 'the <u>it</u> here', '<b>bold</b> and <u>under</u>', '<u>a <b>b</b> c</u>']) {
      expect(markupProblem(text), text).toBeNull();
    }
  });

  it('不成對、交錯、自我巢狀、空內容、其他標籤或帶屬性都回報', () => {
    expect(markupProblem('<u>open')).toMatch('沒有結尾標記');
    expect(markupProblem('close</b>')).toMatch('沒有對應的開頭標記');
    expect(markupProblem('<u>a <b>b</u> c</b>')).toMatch('交錯');
    expect(markupProblem('<u>a <u>b</u></u>')).toMatch('巢狀');
    expect(markupProblem('<b> </b>')).toMatch('內容是空的');
    expect(markupProblem('<i>italic</i>')).toMatch('不允許');
    expect(markupProblem('<u class="x">a</u>')).toMatch('不允許');
  });

  it('不是標籤的角括號不算（例如 a < b、<-）', () => {
    expect(markupProblem('a < b and c > d <- e')).toBeNull();
  });

  it('stripMarkup 只去掉標記、保留內容', () => {
    expect(stripMarkup('the <u>it</u> and <b>they</b>')).toBe('the it and they');
  });
});

describe('findOccurrences／locateRefersTo：refers_to 的計數規則', () => {
  it('以英數字開頭結尾的字串不算進其他字的一部分（找 it 不會找到 with 裡的 it）', () => {
    const text = 'It is with it. Without it, quit it!';
    expect(findOccurrences(text, 'it')).toEqual([11, 23, 32]);
    expect(findOccurrences(text, 'It')).toEqual([0]);
  });

  it('片語與含標點的字串照字面找', () => {
    expect(findOccurrences('a long shot, a long shot.', 'a long shot')).toEqual([0, 13]);
    expect(findOccurrences('... if you don’t.', '… if you don’t')).toEqual([]);
    expect(findOccurrences('abc', '')).toEqual([]);
  });

  it('依 occurrence 找到選文中的位置；passage 與 passage_parts 依序以換行相接、去掉標記', () => {
    const group: Pick<QuestionGroup, 'passage' | 'passage_parts'> = {
      passage: 'They said <b>it</b> was fine.',
      passage_parts: [{ label: 'A', title: null, text: 'Then it rained.' }],
    };
    expect(groupText(group)).toBe('They said it was fine.\nThen it rained.');
    const second = locateRefersTo(group, { text: 'it', occurrence: 2 });
    expect(second).toEqual([28, 30]);
    expect(locateRefersTo(group, { text: 'it', occurrence: 3 })).toBeNull();
  });
});

describe('joinAnswerSegments／expandAnswerSegments：中譯英的可替換寫法', () => {
  it('略過可省略的空字串、以空格相接、標點前不留空格', () => {
    expect(joinAnswerSegments(['In the past', ',', 'bicycles', '', 'served', 'as transportation', '.'])).toBe(
      'In the past, bicycles served as transportation.',
    );
  });

  it('依序展開所有組合，第一種是各段第一個選項', () => {
    const segments = [['High', 'Soaring'], ['house', 'housing'], ['prices'], ['', 'in cities'], ['.']];
    const all = expandAnswerSegments(segments);
    expect(all).toHaveLength(8);
    expect(all[0]).toBe('High house prices.');
    expect(all).toContain('Soaring housing prices in cities.');
    expect(new Set(all).size).toBe(8);
  });

  it('超過上限時只回傳前 limit 種', () => {
    const segments = Array.from({ length: 10 }, () => ['a', 'b']);
    expect(expandAnswerSegments(segments, 5)).toHaveLength(5);
    expect(expandAnswerSegments([])).toEqual([]);
  });
});

describe('expectedTextFormat：v1.1 的 text_format 規則', () => {
  const figure = (kind: string): Figure => ({ kind, caption: null, description: 'x' });
  const part = (text: string) => ({ label: null, title: null, text });

  it('有圖表又有選文＝mixed（優先於 multi_text）', () => {
    expect(expectedTextFormat({ passage: 'Text', passage_parts: null, figures: [figure('photo')] })).toBe('mixed');
    expect(expectedTextFormat({ passage: null, passage_parts: [part('a'), part('b')], figures: [figure('map')] })).toBe('mixed');
  });

  it('passage_parts 兩篇以上＝multi_text；一般選文＝continuous', () => {
    expect(expectedTextFormat({ passage: 'Intro', passage_parts: [part('a'), part('b')], figures: [] })).toBe('multi_text');
    expect(expectedTextFormat({ passage: 'Text', passage_parts: null, figures: [] })).toBe('continuous');
  });

  it('只有圖表沒有選文＝圖表種類；對不上或什麼都沒有回傳 null', () => {
    expect(expectedTextFormat({ passage: null, passage_parts: null, figures: [figure('table')] })).toBe('table');
    expect(expectedTextFormat({ passage: null, passage_parts: null, figures: [figure('diagram')] })).toBe('chart');
    expect(expectedTextFormat({ passage: null, passage_parts: null, figures: [figure('photo')] })).toBeNull();
    expect(expectedTextFormat({ passage: null, passage_parts: null, figures: [] })).toBeNull();
  });
});

describe('isIndependentlyNumbered：翻譯、作文、簡答各自從 1 編號', () => {
  const group = (questions: Question[]): QuestionGroup => ({
    id: 'g',
    passage: null,
    passage_parts: null,
    figures: [],
    options_bank: null,
    questions,
    tags: null,
  });
  const shortAnswer: Question = { ...base, mode: 'short_answer', options: null, answer: 'x' };
  const choice: Question = { ...base, mode: 'single_choice', options: { A: 'a', B: 'b' }, answer: 'A' };

  it('translation／composition／short_answer 一律獨立編號', () => {
    for (const type of ['translation', 'composition', 'short_answer'] as const) {
      expect(isIndependentlyNumbered({ type, groups: [group([shortAnswer])] }), type).toBe(true);
    }
  });

  it('other 只有非選擇作答時獨立編號；選擇題大題算進卷內連續題號', () => {
    expect(isIndependentlyNumbered({ type: 'other', groups: [group([shortAnswer])] })).toBe(true);
    expect(isIndependentlyNumbered({ type: 'other', groups: [group([choice])] })).toBe(false);
    expect(isIndependentlyNumbered({ type: 'reading', groups: [group([choice])] })).toBe(false);
  });
});
