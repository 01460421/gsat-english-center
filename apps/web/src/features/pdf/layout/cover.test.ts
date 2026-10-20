/** 本站自組卷的 QR code（docs/design/bank-mock.md §7.2）：用 pdfmake 自己的編碼程式量實際印出來的大小。 */
import qrEnc from 'pdfmake/js/qrEnc.js';
import { describe, expect, it } from 'vitest';
import type { PdfContent, PdfNode, PdfSection } from '../engine/docTypes';
import { sitePdfOptions } from '../index';
import { buildExamDocDefinition } from './buildDocDefinition';
import { SITE_QR, siteQrNode } from './cover';
import { findNodes, sitePaperFixture } from './testUtils';

const fx = sitePaperFixture();
/** 正式站的網址：網域＋/mock/＋72 個字元的代號＋.p，共 118 個字元。 */
const PRODUCTION_URL = `https://gsat-english-center.vercel.app/mock/${fx.paper.id}.p`;

/** pdfmake 實際畫出來的 QR code：整體邊長與每格的邊長（pt）。 */
function measured(node: Extract<PdfNode, { qr: string }>): { size: number; module: number } {
  const out = qrEnc.measure({ qr: node.qr, ...(node.fit !== undefined ? { fit: node.fit } : {}), ...(node.eccLevel ? { eccLevel: node.eccLevel } : {}) });
  const [, ...modules] = out._canvas;
  return { size: out._width, module: Math.min(...modules.map((m) => m.w)) };
}

describe('自組卷的 QR code', () => {
  it('正式站的網址（118 個字元）：一般寫法（byte 模式）每格 2 pt、約 90 pt', () => {
    expect(PRODUCTION_URL).toHaveLength(118);
    const { size, module } = measured(siteQrNode(PRODUCTION_URL));
    expect(module).toBeGreaterThanOrEqual(2);
    expect(size).toBeGreaterThanOrEqual(88);
    expect(size).toBeLessThanOrEqual(SITE_QR.fit);
  });

  it('改成大寫（英數模式，SITE_QR_UPPERCASE）時每格也至少 2 pt', () => {
    const { module } = measured({ ...siteQrNode(PRODUCTION_URL), qr: PRODUCTION_URL.toUpperCase() });
    expect(module).toBeGreaterThanOrEqual(2);
  });

  it('封面與答題卷是同一個 QR code，下方的文字和 QR code 之間至少留 4 格空白', () => {
    const doc = buildExamDocDefinition(fx.exam, { ...sitePdfOptions('student', false), mockMeta: fx.mockMeta, onlineUrl: PRODUCTION_URL });
    const sections = doc.content as PdfSection[];
    const { module } = measured(siteQrNode(PRODUCTION_URL));
    for (const index of [0, 3]) {
      // 封面是第 1 節、答題卷是第 4 節；QR code 和下方的文字在同一個 stack。
      const [stack] = findNodes(sections[index]?.section, (n) => Array.isArray(n.stack) && (n.stack as PdfContent[]).some((c) => typeof c === 'object' && c !== null && 'qr' in c));
      const items = (stack?.stack ?? []) as Record<string, unknown>[];
      expect(items[0]).toEqual(siteQrNode(PRODUCTION_URL));
      const below = items[1]?.margin as [number, number, number, number] | undefined;
      expect(below?.[1]).toBeGreaterThanOrEqual(4 * module);
    }
  });
});
