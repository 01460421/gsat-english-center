/**
 * 資料來源頁（本站自組卷，docs/design/bank-mock.md §7.5）：學生卷與「題本＋答案＋解析」在題本之後、教師卷在最後。
 *
 *   - 先是 AI 出題聲明：「本卷題目由 AI 參考下列資料撰寫，非原文轉載；…請以參考資料為準。」
 *   - 依題號範圍列出每個題組的出處說明（attribution_text），以及參考資料的出版者、標題、網址與授權（圖表的 chart.source 也在裡面）。
 *
 * 為什麼一定要印：題庫有參考資料是 CC BY 或政府資料開放授權，圖表的數字也照原樣用了資料集；CC BY 要求標示出處、授權與授權條款連結，
 * 必須印在 PDF 上才算數。教師卷的解析也引用文章內容，所以同樣要印。網址太長時照 urlInline 的規則斷行，不做成 QR code。
 */
import type { PdfContent, PdfNode } from '../engine/docTypes';
import { licenseLabel, licenseUrl } from '../../practice/chart';
import type { SitePaperPdfMeta } from '../types';
import { CONTENT_WIDTH } from './metrics';
import { plainInline, spacedInline, urlInline } from './richInline';
import { SITE_PAPER_TEXT, substituteGlyphs } from './strings';

const BODY = 9.5;
const URL_SIZE = 7.5;
const INDENT = 12;

type ReferenceItem = SitePaperPdfMeta['references'][number]['items'][number];

/** 授權的寫法：「授權：CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）」；不認得的授權只印代碼。 */
export function licenseText(license: string): string {
  const url = licenseUrl(license);
  return `${SITE_PAPER_TEXT.sourcesLicense}${licenseLabel(license)}${url ? `（${url}）` : ''}`;
}

/** 一筆參考資料：「• 出版者：標題」、網址、授權。 */
function referenceItem(item: ReferenceItem): PdfNode {
  const width = CONTENT_WIDTH - INDENT - 12;
  const lines: PdfContent[] = [
    // 參考資料的標題常是原文（日文網頁），先替換字型沒有的日文字形（GLYPH_SUBSTITUTES）。
    { text: plainInline(substituteGlyphs(`${item.publisher.trim()}${item.title.trim() ? `：${item.title.trim()}` : ''}`)), fontSize: BODY, lineHeight: 1.3 },
    { text: [urlInline(item.url, width - 4, URL_SIZE)], fontSize: URL_SIZE, lineHeight: 1.25, color: '#333333' },
  ];
  if (item.license) lines.push({ text: plainInline(licenseText(item.license)), fontSize: 8, lineHeight: 1.25, color: '#333333' });
  return {
    columns: [
      { width: 12, text: plainInline('•'), fontSize: BODY },
      { width: '*', stack: lines },
    ],
    columnGap: 0,
    margin: [INDENT, 0, 0, 3],
    unbreakable: true,
  };
}

/** 資料來源頁的內容（新的一節）。 */
export function sourcesContent(site: SitePaperPdfMeta): PdfContent[] {
  const content: PdfContent[] = [
    { text: spacedInline(SITE_PAPER_TEXT.sourcesTitle, { bold: true, spacing: 4 }), fontSize: 16, alignment: 'center', margin: [0, 0, 0, 8] },
    { text: plainInline(SITE_PAPER_TEXT.sourcesIntro), fontSize: 10, lineHeight: 1.4, margin: [0, 0, 0, 6] },
    { text: plainInline(site.aiNotice), fontSize: 9, color: '#444444', margin: [0, 0, 0, 8] },
  ];
  const groups = site.references.filter((g) => g.items.length > 0 || (g.attribution ?? '').trim() !== '');
  if (groups.length === 0) {
    content.push({ text: plainInline(SITE_PAPER_TEXT.sourcesNone), fontSize: 10 });
    return content;
  }
  for (const group of groups) {
    const [first, ...rest] = group.items.map(referenceItem);
    const head: PdfContent[] = [{ text: plainInline(SITE_PAPER_TEXT.sourcesRange(group.range), { bold: true }), fontSize: 10.5, lineHeight: 1.3, margin: [0, 6, 0, 2] }];
    if (group.attribution?.trim()) head.push({ text: plainInline(substituteGlyphs(group.attribution.trim())), fontSize: BODY, lineHeight: 1.35, margin: [0, 0, 0, 3] });
    // 題號範圍、出處說明與第一筆資料綁在一起，範圍不會落在頁底。
    content.push({ stack: [...head, ...(first ? [first] : [])], unbreakable: true }, ...rest);
  }
  return content;
}
