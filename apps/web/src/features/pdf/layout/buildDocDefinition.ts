/**
 * 考卷 → pdfmake 文件定義（設計文件 §5）。engine/generate.ts 呼叫這個函式；它是純函式（不碰 DOM、不載字型），
 * Vitest 可以直接檢查輸出的結構，不必真的產生 PDF。
 *
 * PDF 分成最多四節（pdfmake 的 section，每節從新的一頁開始、有自己的頁首頁尾）：
 *   封面（不編頁碼）→ 題本（「第 N 頁／共 M 頁」只算題本）→ 答題卷（可選）→ 答案（可選）。
 * 每一頁的頁尾都有出處與「非官方」聲明（chrome.ts）。
 *
 * 本站自組卷（mockMeta.sitePaper，docs/design/bank-mock.md §7.7）另外組節（siteContent）：
 *   學生卷           封面 → 題本 → 資料來源 → 答題卷
 *   教師卷           卷子資訊＋答案 → 解析 → 資料來源（includeBooklet: false，不印封面與題本）
 *   題本＋答案＋解析 封面 → 題本 → 資料來源 → 答題卷 → 答案 → 解析
 * 雙面列印（duplex）時答題卷、答案、解析每一段從單數頁開始（blocks.ts 的 KeepRegistry.duplexStart）。
 * 文件屬性（標題、主旨）也換成本站自組卷的寫法，不寫試題來源機構。歷屆卷的輸出完全不變。
 *
 * 版面規則分在同目錄的檔案：
 *   cover.ts 封面｜booklet.ts、parts.ts 部分與大題｜groups.ts 題組｜questions.ts 題目｜options.ts 選項排法
 *   nodes.ts 標題、說明框、選文、圖片描述框｜blocks.ts 分頁（標題不落單、不跨頁區塊）｜estimate.ts 高度估計
 *   answerSheet.ts 答題卷｜answerKey.ts 答案頁｜chrome.ts 頁首頁尾｜strings.ts 固定文字｜metrics.ts 尺寸
 *   explanations.ts 解析頁｜sources.ts 資料來源頁｜teacherHeader.ts 教師卷的卷子資訊（三者只有自組卷用）
 */
import type { Exam } from '../../../data/exams';
import type { PdfContent, PdfDocDefinition, PdfNode, PdfSection } from '../engine/docTypes';
import type { ExamPdfOptions, MockPdfMeta, SitePaperPdfMeta } from '../types';
import { answerKeyContent } from './answerKey';
import { answerSheetContent } from './answerSheet';
import { PageChrome, attributionLine, type PdfSegment } from './chrome';
import { KeepRegistry, flowBlocks } from './blocks';
import { bookletBlocks } from './booklet';
import { coverContent } from './cover';
import { explanationsContent } from './explanations';
import { LINE, PAGE_MARGINS, SIZE } from './metrics';
import { sourcesContent } from './sources';
import { SITE_PAPER_TEXT } from './strings';
import { teacherHeaderContent } from './teacherHeader';

/**
 * 去掉一節最後一個節點（以及它最後的子節點）的下邊界。
 * pdfmake 0.3 在「下邊界放不下」時會換到新的一頁；如果這發生在一節的最後，就留下一個空白頁，
 * 而下一節（pdfmake 的 section）看到目前頁是空的就直接沿用，連頁首頁尾都沿用上一節的（ref-107-a 的答題卷曾經印成題本的頁碼）。
 */
export function withoutTrailingMargin(content: PdfContent[]): PdfContent[] {
  const trim = (node: PdfContent): PdfContent => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map((n, i) => (i === node.length - 1 ? trim(n) : n));
    const out: PdfNode = { ...node };
    if (node.margin !== undefined) {
      const m = node.margin;
      out.margin = typeof m === 'number' ? [m, m, m, 0] : m.length === 2 ? [m[0], m[1], m[0], 0] : [m[0], m[1], m[2], 0];
    }
    if ('stack' in out) out.stack = trim(out.stack) as PdfContent[];
    if ('columns' in out) out.columns = out.columns.map(trim);
    return out;
  };
  return trim(content) as PdfContent[];
}

/** 版面選項：公開的 ExamPdfOptions，加上只有瀏覽器知道的資訊。 */
export interface PdfLayoutOptions extends ExamPdfOptions {
  /** 本站線上作答的網址（印在封面並附 QR code）；Node 測試沒有網域，不傳就不印。 */
  onlineUrl?: string | null;
}

/**
 * 雙面列印的段落開頭：把一節的第一個節點登記成 KeepRegistry 的段落開頭（落在雙數頁就換頁，前一頁留白）。
 * 第一個節點一定是有內容的物件（標題或標題列），pdfmake 才會詢問它。
 */
export function withDuplexStart(content: PdfContent[], registry: KeepRegistry): PdfContent[] {
  const [first, ...rest] = content;
  if (first === undefined || typeof first === 'string' || Array.isArray(first)) return content;
  return [{ ...first, id: registry.duplexStart() }, ...rest];
}

/** 本站自組卷的各節（bank-mock §7.7 的表）。 */
function siteContent(
  exam: Exam,
  options: PdfLayoutOptions,
  meta: MockPdfMeta,
  site: SitePaperPdfMeta,
  registry: KeepRegistry,
  section: (segment: PdfSegment, content: PdfContent[]) => PdfSection,
): PdfSection[] {
  const includeBooklet = options.includeBooklet ?? true;
  const duplex = options.duplex === true;
  const start = (content: PdfContent[]) => (duplex ? withDuplexStart(content, registry) : content);
  const out: PdfSection[] = [];
  const sources = () => section('sources', sourcesContent(site));
  if (includeBooklet) {
    out.push(
      section('cover', coverContent(exam, { includeAnswerSheet: options.includeAnswerSheet, mockMeta: meta, onlineUrl: options.onlineUrl })),
      section('booklet', flowBlocks(bookletBlocks(exam, { site: true }), registry)),
      sources(),
    );
  }
  // 教師卷：第一頁先印卷子資訊，接著答案（沒有答案時接在第一節的最前面）。
  let teacherHead: PdfContent[] = includeBooklet ? [] : teacherHeaderContent(site, options.onlineUrl);
  const withTeacherHead = (content: PdfContent[]): PdfContent[] => {
    const head = teacherHead;
    teacherHead = [];
    return [...head, ...content];
  };
  if (options.includeAnswerSheet) out.push(section('sheet', start(withTeacherHead(answerSheetContent(exam, { site, onlineUrl: options.onlineUrl })))));
  if (options.includeAnswerKey) {
    out.push(section('key', start(withTeacherHead(answerKeyContent(exam, { site })))));
    if (options.includeExplanations) out.push(section('explanations', start(explanationsContent(exam, site))));
  }
  if (!includeBooklet) out.push(teacherHead.length > 0 ? section('sources', [...teacherHead, ...sourcesContent(site)]) : sources());
  return out;
}

export function buildExamDocDefinition(exam: Exam, options: PdfLayoutOptions): PdfDocDefinition {
  const meta = options.mockMeta;
  const site = meta?.sitePaper;
  const registry = new KeepRegistry();
  const chrome = new PageChrome(exam, site ? { site, blankPages: registry.blankPages } : {});
  const section = (segment: PdfSegment, content: PdfContent[]): PdfSection => ({
    section: withoutTrailingMargin(content),
    header: chrome.header(segment),
    footer: chrome.footer(segment),
  });

  if (meta && site) {
    return {
      ...docBase(registry),
      info: {
        title: SITE_PAPER_TEXT.docTitle(site.tierLabel, site.code, options.includeBooklet === false),
        author: '學測英文中心',
        subject: SITE_PAPER_TEXT.docSubject,
        creator: '學測英文中心',
        producer: 'pdfmake',
      },
      content: siteContent(exam, options, meta, site, registry, section),
    };
  }

  const content: PdfSection[] = [
    section('cover', coverContent(exam, { includeAnswerSheet: options.includeAnswerSheet, mockMeta: options.mockMeta, onlineUrl: options.onlineUrl })),
    section('booklet', flowBlocks(bookletBlocks(exam), registry)),
  ];
  if (options.includeAnswerSheet) content.push(section('sheet', answerSheetContent(exam)));
  if (options.includeAnswerKey) content.push(section('key', answerKeyContent(exam)));

  const title = options.mockMeta ? `${options.mockMeta.title}　${options.mockMeta.paperLabel}` : exam.title;
  return {
    pageSize: 'A4',
    pageMargins: PAGE_MARGINS,
    info: {
      title: `${title}（重新排版，非官方）`,
      author: '學測英文中心',
      subject: attributionLine(exam),
      creator: '學測英文中心',
      producer: 'pdfmake',
    },
    language: 'zh-TW',
    defaultStyle: { font: 'Tinos', fontSize: SIZE.body, lineHeight: LINE.passage },
    pageBreakBefore: registry.pageBreakBefore,
    content,
  };
}

/** 兩種版本共用的文件設定。 */
function docBase(registry: KeepRegistry): Omit<PdfDocDefinition, 'content'> {
  return {
    pageSize: 'A4',
    pageMargins: PAGE_MARGINS,
    language: 'zh-TW',
    defaultStyle: { font: 'Tinos', fontSize: SIZE.body, lineHeight: LINE.passage },
    pageBreakBefore: registry.pageBreakBefore,
  };
}
