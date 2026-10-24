/**
 * 封面（設計文件 §5.2）：本站名稱、卷別、「英文考科」、作答注意事項、出處與官方試題 PDF 網址。
 * 不印大考中心的機構名稱標題、標誌與「請於考試開始鈴響起…簽全名」這類只適用於正式考場的指示。
 *
 * 本站自組卷（mockMeta.sitePaper，docs/design/bank-mock.md §7.2）另用 siteCoverContent()：本站卷名、卷號、
 * 「題型與配分同學測，難度依所選等級」、班級與座號欄、組卷日期、資料版本、AI 出題聲明，以及唯一一個「線上作答與計分」
 * QR code（放大、容錯 M）與完整網址；不印官方網址。
 */
import type { Exam } from '../../../data/exams';
import { missingGlyphs } from '../fontRuns';
import type { PdfContent, PdfNode } from '../engine/docTypes';
import type { MockPdfMeta, SitePaperPdfMeta } from '../types';
import { hasNationalRates } from './answerKey';
import { NON_OFFICIAL_NOTICE, officialPaperUrl, sourceLine } from './attribution';
import { CONTENT_WIDTH } from './metrics';
import { boxLayout, boxed, fieldRow } from './nodes';
import { plainInline, spacedInline, urlInline } from './richInline';
import { PDF_TEXT, SITE_PAPER_TEXT, WEAK_PAPER_TEXT, substituteGlyphs } from './strings';

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

/** 答題卷的選擇題答案卡會印的題目（混合題以外的選擇題，同 answerSheet.ts 的 choiceCardItems）。 */
function hasCardQuestions(exam: Pick<Exam, 'sections'>): boolean {
  return exam.sections.some((s) => s.type !== 'mixed' && s.groups.some((g) => g.questions.some((q) => q.mode === 'single_choice' || q.mode === 'bank_choice' || q.mode === 'multi_select')));
}

/** 寫在答題卷作答區的題目：混合題，以及選擇題以外的題目（中譯英、作文…）。 */
function hasOpenQuestions(exam: Pick<Exam, 'sections'>): boolean {
  return exam.sections.some((s) => s.type === 'mixed' || s.groups.some((g) => g.questions.some((q) => q.mode !== 'single_choice' && q.mode !== 'bank_choice' && q.mode !== 'multi_select')));
}

/** 線上會自動計分的題目（選擇題與混合題）。 */
function hasAutoScored(exam: Pick<Exam, 'sections'>): boolean {
  return exam.sections.some((s) => s.groups.some((g) => g.questions.some((q) => q.mode !== 'translation' && q.mode !== 'composition')));
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

function noticeBox(exam: Exam, options: CoverOptions, site?: SitePaperPdfMeta): PdfNode {
  const minutes = options.mockMeta?.durationMinutes ?? exam.time_minutes;
  const stack: PdfContent[] = [
    { text: plainInline(PDF_TEXT.noticeTitle), fontSize: 14, alignment: 'center', margin: [0, 0, 0, 10] },
  ];
  if (minutes !== null && minutes > 0) {
    stack.push({ text: plainInline(PDF_TEXT.timeLine(minutes)), fontSize: BODY, lineHeight: BODY_LINE, margin: [0, 0, 0, 4] });
  }
  stack.push({ text: plainInline(PDF_TEXT.howTitle), fontSize: BODY, lineHeight: BODY_LINE });
  const how = options.includeAnswerSheet ? PDF_TEXT.howWithSheet : PDF_TEXT.howWithoutSheet;
  // 學習助手加強卷可以只有部分大題（docs/design/weak-paper.md §9.5）：沒有答案卡的題目就不寫答案卡那一條，
  // 沒有混合題與非選擇題就不寫作答區那一條；全部是中譯英與作文時線上作答不自動計分。自組模擬考照舊。
  const lines = site?.paperKind ? how.filter((_, i) => (i === 0 ? hasCardQuestions(exam) : hasOpenQuestions(exam))) : how;
  for (const line of lines) stack.push(bullet(line));
  const online = site ? (site.paperKind && !hasAutoScored(exam) ? WEAK_PAPER_TEXT.howOnlineWritten : SITE_PAPER_TEXT.howOnline) : PDF_TEXT.howOnline(hasNationalRates(exam));
  stack.push(bullet(online));
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
  if (meta?.sitePaper) return siteCoverContent(exam, meta, meta.sitePaper, options);
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

// ---------------------------------------------------------------------------
// 本站自組卷（bank-mock §7.2）
// ---------------------------------------------------------------------------

/**
 * QR code 的內容改成整串大寫：代號解碼不分大小寫、路由比對也不分，pdfmake 會改用英數模式，格子更大（bank-mock §7.2）。
 * 要等實機測試（§7.8）確認 iPhone 與 Android 的相機都能打開大寫網址才改成 true；在那之前用一般寫法（byte 模式）。
 */
export const SITE_QR_UPPERCASE = false;

/**
 * 封面與答題卷共用的 QR code（§7.2）：自組卷網址約 118 個字元，放大並用 M 級容錯，影印後也掃得到。
 * pdfmake 每格的大小是 floor(fit ÷ 每邊格數) pt，不夠一格的部分整個捨去：一般寫法（byte 模式）是 version 7（每邊 45 格），
 * fit 100 → 每格 2 pt、實際 90 pt；fit 80 只剩每格 1 pt、45 pt。大寫網址（英數模式）是 version 5（每邊 37 格），每格 2 pt、74 pt。
 * cover.test.ts 用 pdfmake 的編碼程式實際量，確定兩種寫法每格都至少 2 pt（約 0.7 mm）。
 * quietZone：QR code 四周要留至少 4 格空白（4 × 2 pt），下方的說明文字不能貼著 QR code。
 */
export const SITE_QR = { fit: 100, eccLevel: 'M', quietZone: 8 } as const;

export function siteQrValue(url: string): string {
  return SITE_QR_UPPERCASE ? url.toUpperCase() : url;
}

/** QR code 那一欄的寬度：比 fit 寬一點，QR code 置中，左右各留一點空白。 */
export const SITE_QR_COLUMN = SITE_QR.fit + 4;

/** 本站自組卷的 QR code 節點（封面、答題卷共用）。 */
export function siteQrNode(url: string): Extract<PdfNode, { qr: string }> {
  return { qr: siteQrValue(url), fit: SITE_QR.fit, eccLevel: SITE_QR.eccLevel, alignment: 'center' };
}

/** 封面底部：組卷日期、資料版本、AI 出題聲明、圖的說明、線上作答網址與「卷號只供核對」；右邊是 QR code。 */
function siteSourceBlock(site: SitePaperPdfMeta, onlineUrl: string | null | undefined): PdfNode {
  const textWidth = onlineUrl ? CONTENT_WIDTH - SITE_QR_COLUMN - QR_GAP : CONTENT_WIDTH;
  const small = { fontSize: 8.5, lineHeight: 1.3, color: '#333333' };
  const texts: PdfContent[] = [
    { text: plainInline(`${SITE_PAPER_TEXT.assembledOn(site.assembledOn)}　${SITE_PAPER_TEXT.dataVersion(site.dataVersion)}`), ...small },
    // 全部是出版社題的卷子不印 AI 出題聲明；有出版社題組時另印題目來源（docs/design/weak-paper.md §9.5）。
    ...(site.footerKind === 'publisher' ? [] : [{ text: plainInline(site.aiNotice), ...small }]),
    ...(site.sourceLines ?? []).map((line): PdfContent => ({ text: plainInline(line), ...small })),
    { text: plainInline(SITE_PAPER_TEXT.coverFigureNote), ...small, margin: [0, 0, 0, 4] },
  ];
  if (onlineUrl) {
    texts.push({
      text: [...plainInline(SITE_PAPER_TEXT.onlineLabel), { text: '\n' }, urlInline(onlineUrl, textWidth - 4, URL_FONT_SIZE)],
      fontSize: URL_FONT_SIZE,
      lineHeight: 1.25,
      color: '#333333',
    });
  }
  texts.push({ text: plainInline(SITE_PAPER_TEXT.codeNote), ...small, margin: [0, 2, 0, 0] });
  const columns: PdfContent[] = [{ width: textWidth, stack: texts }];
  if (onlineUrl) {
    columns.push({
      width: SITE_QR_COLUMN,
      stack: [siteQrNode(onlineUrl), { text: plainInline(SITE_PAPER_TEXT.qrCaption), fontSize: 7, alignment: 'center', margin: [0, SITE_QR.quietZone, 0, 0] }],
    });
  }
  return { columns, columnGap: QR_GAP, margin: [0, 6, 0, 0] };
}

/**
 * 加強卷封面的「本卷針對」一行（docs/design/weak-paper.md §3.5、§9.5）：均衡加強卷寫「這次不是針對弱點…」；
 * 弱點名稱含 PDF 字型沒有的字（替代之後仍有）時那一項不印，全部不能印就整行不印。
 */
export function targetsLine(targets: SitePaperPdfMeta['targets']): string | null {
  if (!targets) return null;
  if (targets.balanced) return WEAK_PAPER_TEXT.targetsBalanced;
  const labels = targets.labels.map((l) => substituteGlyphs(l.trim())).filter((l) => l !== '' && missingGlyphs(l).length === 0);
  return labels.length > 0 ? WEAK_PAPER_TEXT.targets(labels) : null;
}

/** 本站自組卷的封面。學習助手加強卷（site.paperKind）的卷別說明、橫條與「本卷針對」另外寫（§9.5）。 */
export function siteCoverContent(exam: Exam, meta: MockPdfMeta, site: SitePaperPdfMeta, options: CoverOptions): PdfContent[] {
  const kind = site.paperKind;
  const targets = kind ? targetsLine(site.targets) : null;
  const content: PdfContent[] = [
    { text: spacedInline(meta.title.trim(), { spacing: 2 }), fontSize: 12, alignment: 'center', color: '#333333', margin: [0, 14, 0, 12] },
    { text: plainInline(meta.paperLabel.trim()), fontSize: 18, alignment: 'center', margin: [0, 0, 0, 4] },
    { text: plainInline(kind ? WEAK_PAPER_TEXT.coverFormat(kind) : SITE_PAPER_TEXT.coverFormat), fontSize: 11, alignment: 'center', color: '#333333', margin: [0, 0, 0, targets ? 2 : 8] },
    ...(targets ? [{ text: plainInline(targets), fontSize: 10, lineHeight: 1.3, alignment: 'center' as const, color: '#333333', margin: [0, 0, 0, 8] as [number, number, number, number] }] : []),
    { text: spacedInline(PDF_TEXT.subject, { bold: true, spacing: 8 }), fontSize: 26, alignment: 'center', margin: [0, 0, 0, 12] },
    {
      table: {
        widths: ['*'],
        body: [[{ text: plainInline(kind ? WEAK_PAPER_TEXT.coverBand(site.footerKind) : SITE_PAPER_TEXT.coverBand, { bold: true }), fontSize: 12, alignment: 'center', fillColor: '#e3e3e3' }]],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 4, paddingRight: () => 4 },
      margin: [0, 0, 0, 14],
    },
    noticeBox(exam, options, site),
    ...SITE_PAPER_TEXT.candidateFieldRows.map((row, i) => fieldRow(row, BODY, { margin: [0, 0, 0, i === SITE_PAPER_TEXT.candidateFieldRows.length - 1 ? 10 : 6] })),
  ];
  if (meta.strict) content.push({ text: plainInline(PDF_TEXT.strictMode), fontSize: BODY, lineHeight: BODY_LINE, margin: [0, 0, 0, 4] });
  for (const notice of meta.notices ?? []) {
    if (notice.trim() !== '') content.push(bullet(notice, 0));
  }
  content.push(siteSourceBlock(site, options.onlineUrl));
  return content;
}
