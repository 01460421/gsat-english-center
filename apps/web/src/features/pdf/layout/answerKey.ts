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
/** 題號不是數字（gsat-83 文意選填的「選填1」）時一列只排 5 題，答案才不會在格子裡斷行。 */
const PER_ROW_WIDE_LABEL = 5;
/** 網址行的可用寬度（留一點餘裕給字寬估計的誤差）。 */
const URL_WIDTH = CONTENT_WIDTH - 4;
const URL_FONT_SIZE = 7.5;

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

/** 這份考卷有沒有任何一題有全國答對率（舊卷、補考、參考試卷沒有統計）。 */
export function hasNationalRates(exam: Pick<Exam, 'sections'>): boolean {
  return exam.sections.some((s) => s.groups.some((g) => g.questions.some((q) => isAutoScored(q) && rateText(q) !== null)));
}

/** 這一題印的是不是官方公布的非選擇題答案（填充、簡答、表格；「大考中心未公布參考答案」不算）。 */
function hasOfficialOpenAnswer(q: Question): boolean {
  return (q.mode === 'fill_in_blank' || q.mode === 'short_answer' || q.mode === 'table_completion') && q.answer !== null && q.answer.trim() !== '';
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
  const perRow = questions.every((q) => /^\d+$/.test(q.label)) ? PER_ROW : PER_ROW_WIDE_LABEL;
  const cell = (q: Question | undefined): PdfContent => {
    if (!q) return { text: '' };
    const rate = rateText(q);
    // 答案不斷行（「送分」「B或C」）：放不下時寧可整個答案換到下一行，也不要拆成兩半。
    const answer = plainInline(choiceAnswerText(q), { bold: true }).map((run) => ({ ...run, noWrap: true }));
    return {
      stack: [
        { text: [...plainInline(`${q.label} `), ...answer], fontSize: 10, lineHeight: 1.15 },
        ...(rate ? [{ text: rate, font: 'Tinos' as const, fontSize: 7, color: '#555555', lineHeight: 1 }] : []),
      ],
    };
  };
  const body: PdfContent[][] = [];
  for (let i = 0; i < questions.length; i += perRow) {
    body.push(Array.from({ length: perRow }, (_, j) => cell(questions[i + j])));
  }
  return {
    table: { widths: Array.from({ length: perRow }, () => '*'), body, dontBreakRows: true },
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
  let hasRates = false;
  let mixedOfficial = false;
  let otherOfficial = false;
  for (const section of exam.sections) {
    const questions = sectionQuestions(section);
    if (questions.some((q) => q.mode === 'translation')) {
      const url = officialScoringUrl(exam) ?? PDF_TEXT.scoringSite;
      content.push({
        stack: [
          heading(section.title),
          { text: plainInline(PDF_TEXT.translationAnswer), fontSize: 10, lineHeight: 1.3 },
          { text: [urlInline(url, URL_WIDTH, URL_FONT_SIZE)], fontSize: URL_FONT_SIZE, lineHeight: 1.25, color: '#333333' },
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
      hasRates ||= choice.some((q) => rateText(q) !== null);
      stack.push(choiceTable(choice));
    }
    if (open.length > 0) {
      if (open.some(hasOfficialOpenAnswer)) {
        if (section.type === 'mixed') mixedOfficial = true;
        else otherOfficial = true;
      }
      stack.push(...openList(open));
    }
    if (stack.length > 1) content.push({ stack, unbreakable: true });
  }
  // 註記只寫這份答案頁上真的有的東西：沒有統計就不提答對率，官方沒公布非選擇題答案就不說「答案取自參考答案」。
  const noteTexts: string[] = [];
  if (hasChoice) noteTexts.push(hasRates ? `${PDF_TEXT.answerKeyChoiceNote}${PDF_TEXT.answerKeyRateNote}` : PDF_TEXT.answerKeyChoiceNote);
  if (mixedOfficial && !otherOfficial) noteTexts.push(PDF_TEXT.answerKeyMixedNote);
  else if (otherOfficial) noteTexts.push(PDF_TEXT.answerKeyOpenAnswerNote);
  const notes: PdfContent[] = noteTexts.map((text) => ({ text: plainInline(text), fontSize: 8, color: '#444444', lineHeight: 1.3 }));
  if (notes.length > 0) content.push({ stack: notes, margin: [0, 10, 0, 0], width: CONTENT_WIDTH });
  return content;
}
