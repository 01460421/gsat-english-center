/**
 * 答案頁（設計文件 §5.10，includeAnswerKey）：新的一頁，標題「答案」。
 *
 *   - 選擇題：依大題分組，每列 10 題「1 B」，答案下方小字印全國答對率（有統計才印）；送分題印「送分」，
 *     官方公告多個答案皆給分的印全部（acceptedLetters）；
 *   - 混合題與其他非選擇題（簡答、填充、表格）：「47. innovation（亦可：…）」；官方沒公布答案的註明；
 *   - 中譯英：只印「官方參考譯文見大考中心評分原則」與網址，**不印任何譯文**（站主決定 D8；公開資料檔本來就沒有）；
 *   - 英文作文：不提供範文。
 */
import type { Exam, ExamSection, Question } from '../../../data/exams';
import { acceptedLetters, isAutoScored } from '../../exams/scoring';
import type { PdfContent, PdfNode } from '../engine/docTypes';
import { officialScoringUrl } from './attribution';
import { CONTENT_WIDTH } from './metrics';
import { questionNumberText } from './questions';
import { plainInline, richInline, spacedInline, urlInline } from './richInline';
import { PDF_TEXT } from './strings';

const PER_ROW = 10;

/** 選擇題的答案文字：「B」「B或C」「ADE」「送分」。 */
export function choiceAnswerText(q: Question): string {
  if (q.scoring_exception?.type === 'all_credit') return PDF_TEXT.allCredit;
  if (q.mode === 'multi_select') return q.answer.join('');
  if (q.mode === 'single_choice' || q.mode === 'bank_choice') return acceptedLetters(q).join(PDF_TEXT.orSeparator);
  return '';
}

/** 全國答對率（多選題是得分率），四捨五入到整數百分比；沒有統計是 null。 */
export function rateText(q: Pick<Question, 'stats'>): string | null {
  const rate = q.stats?.correct_rate;
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null;
  return `${Math.round(rate * 100)}%`;
}

/**
 * 非選擇題（混合題填充、簡答、表格）的答案文字。中譯英、作文不經過這裡（見 answerKeyContent）。
 * 型別上中譯英本來就沒有 answer 欄位（TranslationQuestion），這裡再擋一次。
 */
export function openAnswerText(q: Question): string {
  switch (q.mode) {
    case 'fill_in_blank':
    case 'short_answer':
    case 'table_completion': {
      if (q.answer === null || q.answer.trim() === '') return PDF_TEXT.noOfficialAnswer;
      const others = (q.accepted_answers ?? []).filter((a) => a.trim() !== '' && a.trim() !== q.answer?.trim());
      return others.length > 0 ? `${q.answer}${PDF_TEXT.alsoAccepted(others)}` : q.answer;
    }
    case 'single_choice':
    case 'bank_choice':
    case 'multi_select':
      return choiceAnswerText(q);
    case 'translation':
    case 'composition':
      return '';
  }
}

function heading(text: string): PdfNode {
  return { text: spacedInline(text, { bold: true, spacing: 1 }), fontSize: 11.5, lineHeight: 1.2, margin: [0, 8, 0, 4] };
}

function choiceTable(questions: readonly Question[]): PdfNode {
  const cell = (q: Question | undefined): PdfContent => {
    if (!q) return { text: '' };
    const rate = rateText(q);
    return {
      stack: [
        { text: [...plainInline(`${q.label} `), ...plainInline(choiceAnswerText(q), { bold: true })], fontSize: 10, lineHeight: 1.15 },
        ...(rate ? [{ text: rate, font: 'Tinos' as const, fontSize: 7, color: '#555555', lineHeight: 1 }] : []),
      ],
    };
  };
  const body: PdfContent[][] = [];
  for (let i = 0; i < questions.length; i += PER_ROW) {
    body.push(Array.from({ length: PER_ROW }, (_, j) => cell(questions[i + j])));
  }
  return {
    table: { widths: Array.from({ length: PER_ROW }, () => '*'), body, dontBreakRows: true },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.6 : 0.3),
      vLineWidth: () => 0,
      hLineColor: () => '#999999',
      paddingLeft: () => 2,
      paddingRight: () => 2,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 4],
  };
}

function openList(questions: readonly Question[]): PdfContent[] {
  return questions.map((q) => {
    const number = questionNumberText(q) || `${q.label}.`;
    return {
      columns: [
        { width: 34, text: plainInline(number), fontSize: 10.5 },
        { width: '*', text: richInline(openAnswerText(q)), fontSize: 10.5 },
      ],
      columnGap: 0,
      margin: [0, 0, 0, 3],
    };
  });
}

function sectionQuestions(section: ExamSection): Question[] {
  return section.groups.flatMap((g) => g.questions);
}

export function answerKeyContent(exam: Exam): PdfContent[] {
  const content: PdfContent[] = [
    { text: spacedInline(PDF_TEXT.answerKeyTitle, { bold: true, spacing: 6 }), fontSize: 18, alignment: 'center', margin: [0, 0, 0, 8] },
  ];
  let hasChoice = false;
  let hasOpen = false;
  for (const section of exam.sections) {
    const questions = sectionQuestions(section);
    if (questions.some((q) => q.mode === 'translation')) {
      const url = officialScoringUrl(exam) ?? PDF_TEXT.scoringSite;
      content.push({
        stack: [
          heading(section.title),
          { text: plainInline(PDF_TEXT.translationAnswer), fontSize: 10, lineHeight: 1.3 },
          { text: [urlInline(url, 120)], fontSize: 7.5, lineHeight: 1.25, color: '#333333' },
        ],
        unbreakable: true,
      });
      continue;
    }
    if (questions.some((q) => q.mode === 'composition')) {
      content.push({ stack: [heading(section.title), { text: plainInline(PDF_TEXT.compositionAnswer), fontSize: 10, lineHeight: 1.3 }], unbreakable: true });
      continue;
    }
    const choice = section.type === 'mixed' ? [] : questions.filter(isAutoScored);
    const open = section.type === 'mixed' ? questions : questions.filter((q) => !isAutoScored(q));
    const stack: PdfContent[] = [heading(section.title)];
    if (choice.length > 0) {
      hasChoice = true;
      stack.push(choiceTable(choice));
    }
    if (open.length > 0) {
      hasOpen = true;
      stack.push(...openList(open));
    }
    if (stack.length > 1) content.push({ stack, unbreakable: true });
  }
  const notes: PdfContent[] = [];
  if (hasChoice) notes.push({ text: plainInline(PDF_TEXT.answerKeyChoiceNote), fontSize: 8, color: '#444444', lineHeight: 1.3 });
  if (hasOpen) notes.push({ text: plainInline(PDF_TEXT.answerKeyMixedNote), fontSize: 8, color: '#444444', lineHeight: 1.3 });
  if (notes.length > 0) content.push({ stack: notes, margin: [0, 10, 0, 0], width: CONTENT_WIDTH });
  return content;
}
