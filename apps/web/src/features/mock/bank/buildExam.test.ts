/**
 * 組成 Exam（設計文件 §5、§10.1）：題號 1–50 連續、標籤唯一、配分 10／10／10／8／24／10／8／20、三部分 62／10／28、
 * Exam 的固定欄位、解析與排除法表的新題號、出處、寫作題的對照，以及全部答對時 scoreExam 的 66／34。
 */
import { describe, expect, it } from 'vitest';
import type { Question } from '../../../data/exams';
import type { AnswerValue } from '../../exams/scoring';
import { scoreExam } from '../../exams/scoring';
import { BLUEPRINT_SLOTS } from './blueprint';
import { buildBankPaper } from './buildExam';
import { paperNumber } from './code';
import { paperInput } from './testFixtures';

function correctAnswer(q: Question): AnswerValue | null {
  switch (q.mode) {
    case 'single_choice':
    case 'bank_choice':
      return q.answer;
    case 'multi_select':
      return q.answer;
    case 'fill_in_blank':
    case 'short_answer':
      return q.answer;
    default:
      return null;
  }
}

describe('buildBankPaper', () => {
  const input = paperInput();
  const paper = buildBankPaper(input);
  const { exam } = paper;
  const questions = exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions));

  it('Exam 的固定欄位（§5.4）', () => {
    expect(paper.code).toBe(paperNumber(input.paperId));
    expect(exam).toMatchObject({
      schema: 'gsat-exam/v1.1',
      id: input.paperId,
      exam: 'reference',
      year: 0,
      session: 'regular',
      title: `本站自組模擬考・進階練習・卷號 ${paper.code}`,
      time_minutes: 100,
      full_score: 100,
      target: 'gsat',
      verified: false,
      official_files: [],
    });
    expect(questions.every((q) => q.stats === null)).toBe(true);
  });

  it('大題 s1–s8、配分與三部分', () => {
    expect(exam.sections.map((s) => [s.id, s.type, s.points_total])).toEqual([
      ['s1', 'vocabulary', 10],
      ['s2', 'cloze', 10],
      ['s3', 'word_bank', 10],
      ['s4', 'structure', 8],
      ['s5', 'reading', 24],
      ['s6', 'mixed', 10],
      ['s7', 'translation', 8],
      ['s8', 'composition', 20],
    ]);
    for (const s of exam.sections) {
      const sum = s.groups.flatMap((g) => g.questions).reduce((a, q) => a + (q.points ?? 0), 0);
      expect(sum).toBe(s.points_total);
    }
    expect(exam.parts?.map((p) => [p.points, p.sections])).toEqual([
      [62, ['s1', 's2', 's3', 's4', 's5']],
      [10, ['s6']],
      [28, ['s7', 's8']],
    ]);
    expect(exam.sections.map((s) => s.title)).toEqual([
      '一、詞彙題（占10分）',
      '二、綜合測驗（占10分）',
      '三、文意選填（占10分）',
      '四、篇章結構（占8分）',
      '五、閱讀測驗（占24分）',
      '第貳部分、混合題（占10分）',
      '一、中譯英（占8分）',
      '二、英文作文（占20分）',
    ]);
    expect(exam.sections[7]?.instructions).toBe('說明：請依提示寫一篇英文作文，文分兩段，文長至少 120 個單詞（words）。');
  });

  it('題號：選擇題與混合題 1–50 連續；中譯英 2 題、作文 1 題；標籤全卷唯一；group.id 不重複', () => {
    const numbered = questions.filter((q) => q.mode !== 'translation' && q.mode !== 'composition');
    expect(numbered.map((q) => q.no)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(questions.filter((q) => q.mode === 'translation').map((q) => q.label)).toEqual(['中譯英1', '中譯英2']);
    expect(questions.filter((q) => q.mode === 'composition').map((q) => q.label)).toEqual(['英文作文']);
    expect(new Set(questions.map((q) => q.label)).size).toBe(53);
    const groupIds = exam.sections.flatMap((s) => s.groups.map((g) => g.id));
    expect(groupIds).toEqual(['s1g1', 's2g1', 's2g2', 's3g1', 's4g1', 's5g1', 's5g2', 's5g3', 's6g1', 's7g1', 's8g1']);
    // 選文裡的空格記號都指向同一題組的新題號。
    for (const g of exam.sections.flatMap((s) => s.groups)) {
      const own = new Set(g.questions.map((q) => q.no));
      const text = JSON.stringify(g);
      for (const m of text.matchAll(/\[\[(\d+)\]\]/g)) expect(own.has(Number(m[1]))).toBe(true);
    }
  });

  it('全部填正確答案：scoreExam 的 earned 是 66（選擇題 62＋多選 4）、manualMax 是 34；全部空白得 0 分', () => {
    const answers: Record<string, AnswerValue> = {};
    for (const q of questions) {
      const a = correctAnswer(q);
      if (a !== null) answers[q.label] = a;
    }
    const score = scoreExam(exam, answers);
    expect(score.earned).toBe(66);
    expect(score.autoMax).toBe(66);
    expect(score.manualMax).toBe(34);
    expect(scoreExam(exam, {}).earned).toBe(0);
  });

  it('解析、排除法表依新題號；出處與參考資料依位置', () => {
    expect(Object.keys(paper.explanations).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(Object.keys(paper.elimination).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => 21 + i));
    expect(paper.explanations['47']?.interchangeable_with).toBe(48);
    expect(paper.groups.map((g) => [g.first, g.last])).toEqual([
      ['1', '10'],
      ['11', '15'],
      ['16', '20'],
      ['21', '30'],
      ['31', '34'],
      ['35', '38'],
      ['39', '42'],
      ['43', '46'],
      ['47', '50'],
      ['中譯英1', '中譯英2'],
      ['英文作文', '英文作文'],
    ]);
    expect(paper.groups[5]?.references).toHaveLength(1);
    expect(paper.groups[5]?.attribution).toContain('AI');
    expect(paper.groups[9]).toMatchObject({ section: 'translation', attribution: null, references: [] });
  });

  it('寫作題：答案檔與 item_id 的對照', () => {
    const trKey = input.slots[9]?.key ?? '';
    const cpKey = input.slots[10]?.key ?? '';
    expect(paper.writing.translation?.group_id).toBe(trKey);
    expect(paper.writing.composition?.group_id).toBe(cpKey);
    expect(paper.writing.translationItemIds).toEqual({ 中譯英1: `${trKey}#1`, 中譯英2: `${trKey}#2` });
    expect(paper.writing.essayItemId).toBe(`${cpKey}#1`);
  });

  it('閱讀依位置調整答案位置；快照來源照抄輸入；同樣的輸入得到同一份卷子', () => {
    expect(paper.letterSwaps.filter((s, i) => s !== null && BLUEPRINT_SLOTS[i]?.section !== 'reading')).toEqual([]);
    expect(paper.source.slots).toEqual(input.slots);
    expect(Object.keys(paper.source.files).sort()).toEqual(input.slots.map((s) => s.key).sort());
    expect(buildBankPaper(paperInput())).toEqual(paper);
    expect(paper.notices).toEqual({ reused: [], replaced: [], textChanged: [], keyChanged: [] });
    expect(buildBankPaper({ ...input, notices: { reused: ['35-38'] } }).notices.reused).toEqual(['35-38']);
  });

  it('缺少題組檔或題組和位置不符時丟出錯誤', () => {
    const missing = { ...input.files };
    delete missing[input.slots[3]?.key ?? ''];
    expect(() => buildBankPaper({ ...input, files: missing })).toThrow();
    const wrong = { ...input, slots: input.slots.map((s, i) => (i === 0 ? input.slots[1] ?? s : s)) };
    expect(() => buildBankPaper(wrong)).toThrow();
  });
});
