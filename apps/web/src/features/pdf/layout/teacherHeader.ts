/**
 * 教師卷第一頁的卷子資訊（本站自組卷，docs/design/bank-mock.md §7.7）：教師卷不印封面與題本，
 * 第一頁先印「教師卷：答案與解析」、卷號、難度、組卷日期、資料版本與線上作答網址，之後直接接答案。
 * 老師拿到學生的紙本時，可以用卷號與資料版本核對是不是同一份卷子（§2.7）。
 */
import type { PdfContent } from '../engine/docTypes';
import type { SitePaperPdfMeta } from '../types';
import { CONTENT_WIDTH } from './metrics';
import { boxLayout } from './nodes';
import { plainInline, spacedInline, urlInline } from './richInline';
import { SITE_PAPER_TEXT } from './strings';

const LABEL_WIDTH = 64;
const BODY = 10;

export function teacherHeaderContent(site: SitePaperPdfMeta, onlineUrl?: string | null): PdfContent[] {
  const labels = SITE_PAPER_TEXT.teacherRows;
  const rows: [string, PdfContent][] = [
    [labels.code, { text: plainInline(site.code), fontSize: BODY }],
    [labels.tier, { text: plainInline(site.tierLabel), fontSize: BODY }],
    [labels.assembledOn, { text: plainInline(site.assembledOn), fontSize: BODY }],
    [labels.dataVersion, { text: plainInline(site.dataVersion), fontSize: BODY }],
  ];
  if (onlineUrl) rows.push([labels.online, { text: [urlInline(onlineUrl, CONTENT_WIDTH - LABEL_WIDTH - 20, 8)], fontSize: 8, lineHeight: 1.25 }]);
  return [
    { text: spacedInline(SITE_PAPER_TEXT.teacherTitle, { bold: true, spacing: 2 }), fontSize: 16, alignment: 'center', margin: [0, 0, 0, 8] },
    {
      table: {
        widths: [LABEL_WIDTH, '*'],
        body: rows.map(([label, value]) => [{ text: plainInline(label), fontSize: BODY, fillColor: '#eeeeee' }, value]),
        dontBreakRows: true,
      },
      layout: boxLayout(0.6, { x: 5, y: 3 }),
      margin: [0, 0, 0, 4],
    },
    { text: plainInline(`${site.aiNotice}。${SITE_PAPER_TEXT.codeNote}`), fontSize: 8.5, color: '#444444', lineHeight: 1.3, margin: [0, 0, 0, 12] },
  ];
}
