/**
 * 封面（設計文件 §5.2）：本站名稱、卷別、「英文考科」、作答注意事項、出處與官方試題 PDF 網址。
 * 不印大考中心的機構名稱標題、標誌與「請於考試開始鈴響起…簽全名」這類只適用於正式考場的指示。
 */
import type { Exam } from '../../../data/exams';
import type { PdfContent, PdfNode } from '../engine/docTypes';
import type { MockPdfMeta } from '../types';
import { hasNationalRates } from './answerKey';
import { NON_OFFICIAL_NOTICE, officialPaperUrl, sourceLine } from './attribution';
import { CONTENT_WIDTH } from './metrics';
import { boxLayout, boxed, fieldRow } from './nodes';
import { plainInline, spacedInline, urlInline } from './richInline';
import { PDF_TEXT } from './strings';

export interface CoverOptions {
  includeAnswerSheet: boolean;
  mockMeta?: MockPdfMeta | undefined;
  /** 本站的線上作答網址（瀏覽器產生時才知道網域；沒有就不印）。 */
  onlineUrl?: string | null | undefined;
}

const BODY = 11.5;
const BODY_LINE = 1.45;

/** 封面第二行：「115學年度學科能力測驗」（題本標題去掉「英文考科」）。 */
export function coverExamLine(exam: Pick<Exam, 'title'>): string {
  return exam.title.replace(/\s*英文考科\s*$/u, '').trim();
}

/** 有沒有多選題（決定封面要不要印多選題的計分方式）。 */
function hasMultiSelect(exam: Pick<Exam, 'sections'>): boolean {
  return exam.sections.some((s) => s.groups.some((g) => g.questions.some((q) => q.mode === 'multi_select')));
}

function hasChoice(exam: Pick<Exam, 'sections'>): boolean {
  return exam.sections.some((s) => s.groups.some((g) => g.questions.some((q) => q.mode === 'single_choice' || q.mode === 'bank_choice')));
}

/** 「倒扣」但不是「不倒扣」。 */
const PENALTY = /(?<!不)倒扣/u;

/**
 * 原卷答錯倒扣（指考 91–99、98 指考參考試卷）：各大題說明照原卷印倒扣規則，封面就不能寫現制的「答錯以零分計算」，
 * 改說明本站線上計分依現制（features/exams/scoring.ts）。看說明文字判斷，不靠卷別清單。
 */
export function hasPenaltyScoring(exam: Pick<Exam, 'sections' | 'parts'>): boolean {
  return exam.sections.some((s) => PENALTY.test(s.instructions)) || (exam.parts ?? []).some((p) => PENALTY.test(p.instructions ?? ''));
}

/** 「•」懸掛縮排的條列。 */
function bullet(text: string, indent = 14): PdfNode {
  return {
    columns: [
      { width: 12, text: plainInline('•'), fontSize: BODY, lineHeight: BODY_LINE },
      { width: '*', text: plainInline(text), fontSize: BODY, lineHeight: BODY_LINE, alignment: 'justify' },
    ],
    columnGap: 0,
    margin: [indent, 0, 0, 2],
  };
}

function noticeBox(exam: Exam, options: CoverOptions): PdfNode {
  const minutes = options.mockMeta?.durationMinutes ?? exam.time_minutes;
  const stack: PdfContent[] = [
    { text: plainInline(PDF_TEXT.noticeTitle), fontSize: 14, alignment: 'center', margin: [0, 0, 0, 10] },
  ];
  if (minutes !== null && minutes > 0) {
    stack.push({ text: plainInline(PDF_TEXT.timeLine(minutes)), fontSize: BODY, lineHeight: BODY_LINE, margin: [0, 0, 0, 4] });
  }
  stack.push({ text: plainInline(PDF_TEXT.howTitle), fontSize: BODY, lineHeight: BODY_LINE });
  for (const line of options.includeAnswerSheet ? PDF_TEXT.howWithSheet : PDF_TEXT.howWithoutSheet) stack.push(bullet(line));
  stack.push(bullet(PDF_TEXT.howOnline(hasNationalRates(exam))));
  if (hasChoice(exam) || hasMultiSelect(exam)) {
    stack.push({ text: plainInline(PDF_TEXT.scoringTitle), fontSize: BODY, lineHeight: BODY_LINE, margin: [0, 4, 0, 0] });
    if (hasChoice(exam)) stack.push(bullet(hasPenaltyScoring(exam) ? PDF_TEXT.scoringPenaltyNote : PDF_TEXT.scoringSingle));
    if (hasMultiSelect(exam)) stack.push(bullet(PDF_TEXT.scoringMulti));
  }
  return boxed({ stack }, boxLayout(0.8, { x: 18, y: 14 }), [0, 0, 0, 12]);
}

/** 模擬考版：考生欄位「姓名＿＿＿　日期＿＿＿　開始時間＿＿＿　結束時間＿＿＿」、實考模式、卷別提醒。 */
function mockBlock(meta: MockPdfMeta): PdfContent[] {
  const fields = fieldRow(PDF_TEXT.candidateFields, BODY);
  const out: PdfContent[] = [fields];
  if (meta.strict) out.push({ text: plainInline(PDF_TEXT.strictMode), fontSize: BODY, lineHeight: BODY_LINE, margin: [0, 0, 0, 4] });
  for (const notice of meta.notices ?? []) {
    if (notice.trim() !== '') out.push(bullet(notice, 0));
  }
  return out;
}

const QR_WIDTH = 70;
const QR_GAP = 10;
const URL_FONT_SIZE = 7.5;

function qrBlock(url: string, caption: string): PdfNode {
  return {
    width: QR_WIDTH,
    stack: [
      { qr: url, fit: 66, eccLevel: 'L', alignment: 'center' },
      { text: plainInline(caption), fontSize: 7, alignment: 'center', margin: [0, 2, 0, 0] },
    ],
  };
}

function sourceBlock(exam: Exam, options: CoverOptions): PdfNode {
  const paperUrl = officialPaperUrl(exam);
  const qrCount = (paperUrl ? 1 : 0) + (options.onlineUrl ? 1 : 0);
  // 文字欄給固定寬度、網址依這個寬度換行：太長的一行會讓 pdfmake 撐寬文字欄，把 QR code 擠出右邊界（ref-111）。
  const textWidth = CONTENT_WIDTH - qrCount * (QR_WIDTH + QR_GAP);
  const urlWidth = textWidth - 4;
  const small = { fontSize: 8.5, lineHeight: 1.3, color: '#333333' };
  const texts: PdfContent[] = [
    { text: plainInline(sourceLine(exam)), ...small },
    { text: plainInline(NON_OFFICIAL_NOTICE), ...small },
    { text: plainInline(PDF_TEXT.coverFigureNote), ...small, margin: [0, 0, 0, 4] },
  ];
  if (paperUrl) {
    texts.push({ text: [...plainInline(PDF_TEXT.officialPdfLabel), { text: '\n' }, urlInline(paperUrl, urlWidth, URL_FONT_SIZE)], fontSize: URL_FONT_SIZE, lineHeight: 1.25, color: '#333333' });
  }
  if (options.onlineUrl) {
    texts.push({
      text: [...plainInline(PDF_TEXT.onlineLabel), { text: '\n' }, urlInline(options.onlineUrl, urlWidth, URL_FONT_SIZE)],
      fontSize: URL_FONT_SIZE,
      lineHeight: 1.25,
      color: '#333333',
      margin: [0, 2, 0, 0],
    });
  }
  const qrs: PdfNode[] = [];
  if (paperUrl) qrs.push(qrBlock(paperUrl, PDF_TEXT.qrOfficial));
  if (options.onlineUrl) qrs.push(qrBlock(options.onlineUrl, PDF_TEXT.qrOnline));
  return {
    columns: [{ width: textWidth, stack: texts }, ...qrs],
    columnGap: QR_GAP,
    margin: [0, 6, 0, 0],
  };
}

export function coverContent(exam: Exam, options: CoverOptions): PdfContent[] {
  const meta = options.mockMeta;
  const kicker = meta ? [meta.title.trim() || PDF_TEXT.mockKicker, meta.paperLabel.trim()].filter(Boolean).join(PDF_TEXT.kickerSeparator) : PDF_TEXT.coverKicker;
  const content: PdfContent[] = [
    { text: spacedInline(kicker, { spacing: 2 }), fontSize: 12, alignment: 'center', color: '#333333', margin: [0, 18, 0, 16] },
    { text: plainInline(coverExamLine(exam)), fontSize: 18, alignment: 'center', margin: [0, 0, 0, 8] },
    { text: spacedInline(PDF_TEXT.subject, { bold: true, spacing: 8 }), fontSize: 26, alignment: 'center', margin: [0, 0, 0, 14] },
    {
      table: { widths: ['*'], body: [[{ text: plainInline(PDF_TEXT.coverBand, { bold: true }), fontSize: 12, alignment: 'center', fillColor: '#e3e3e3' }]] },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 4, paddingRight: () => 4 },
      margin: [0, 0, 0, 16],
    },
    noticeBox(exam, options),
  ];
  if (meta) content.push(...mockBlock(meta));
  content.push(sourceBlock(exam, options));
  return content;
}
