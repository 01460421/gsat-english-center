/**
 * bk1 的 PDF 黃金測試（docs/design/weak-paper.md §7.2、§9.5、A9）：加強卷（bk2）的 PDF 文字改動之前，先把自組模擬考（bk1）
 * 三種難度 × 四種版本的 pdfmake 文件定義寫成黃金資料（__golden__/bk1-pdf.json），之後每一次改動都要完全相同——
 * 已經印出去的自組卷與它的 QR code 不能變。
 *
 *   - 文件定義（JSON；函式只記「這裡有函式」）的 SHA-256 與長度：封面、題本、答題卷、答案、解析、資料來源的每個節點。
 *   - 頁首頁尾是函式：依 pdfmake 的呼叫順序（每一節 3 頁）實際呼叫，回傳的節點也算進雜湊；另外存每一節第 1 頁的文字，
 *     雜湊對不上時用它找差在哪裡。
 *   - 文件屬性（標題、主旨）。
 *
 * 黃金資料是在改動 PDF 程式之前、用改動前（HEAD）的程式產生的；之後不准用 -u 更新，除非站主決定改自組模擬考的 PDF。
 * 真正產生 PDF 的檢查（pdftotext、頁數、字型）在 scripts/pdf-render-check.mjs。
 */
import type { Tier } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { buildBankPaper } from '../../mock/bank/buildExam';
import { decodePaperId, encodePaperId } from '../../mock/bank/code';
import { bankMockPdfMeta } from '../../mock/bank/pdfText';
import { paperInput } from '../../mock/bank/testFixtures';
import type { PdfDocDefinition, PdfSection } from '../engine/docTypes';
import { sitePdfOptions, type SitePdfVersion } from '../index';
import { buildExamDocDefinition } from './buildDocDefinition';
import { allText, renderChrome } from './testUtils';

const TIERS: readonly Tier[] = ['basic', 'advanced', 'top'];
const VERSIONS: readonly [string, SitePdfVersion, boolean][] = [
  ['student', 'student', false],
  ['student-duplex', 'student', true],
  ['teacher', 'teacher', false],
  ['full-duplex', 'full', true],
];

/** 三種難度的 bk1 卷子：同一組假題組（閱讀第一篇附圖表），代號依難度重新編碼。 */
function bk1Paper(tier: Tier) {
  const input = paperInput(tier === 'advanced' ? 'a0' : tier === 'basic' ? 'b1' : 'c2');
  const decoded = decodePaperId(input.paperId);
  if (!decoded) throw new Error('測試資料的代號解不開');
  return buildBankPaper({ ...input, tier, paperId: encodePaperId(tier, decoded.slots) });
}

/** 函式不能 JSON 化：只記「這裡有函式」（表格的格線、分頁判斷是固定的程式，頁首頁尾另外實際呼叫）。 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === 'function' ? '[fn]' : v));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function docGolden(doc: PdfDocDefinition) {
  const sections = doc.content as PdfSection[];
  const pages = sections.map(() => 3);
  const chrome = renderChrome(doc, pages);
  const json = canonical({ doc, chrome });
  return {
    sha256: await sha256(json),
    length: json.length,
    info: doc.info,
    sections: sections.map((s, i) => {
      const first = chrome[pages.slice(0, i).reduce((a, b) => a + b, 0)];
      return {
        text: textSummary(allText(s.section)),
        header: allText(first?.header ?? null),
        footer: allText(first?.footer ?? null),
      };
    }),
  };
}

/** 每一節的文字太長，摘要只存長度與開頭（雜湊已經鎖住全部）。 */
function textSummary(text: string): { length: number; head: string } {
  return { length: text.length, head: text.slice(0, 60) };
}

describe('bk1 黃金測試：自組模擬考的 PDF 文件定義', () => {
  for (const tier of TIERS) {
    it(`${tier}：學生卷、學生卷雙面、教師卷、題本＋答案＋解析雙面`, async () => {
      const paper = bk1Paper(tier);
      const out: Record<string, unknown> = { id: paper.id, code: paper.code };
      for (const [name, version, duplex] of VERSIONS) {
        const mockMeta = bankMockPdfMeta(paper, { strict: name === 'student', assembledAt: new Date(2026, 9, 19, 9, 0) });
        const doc = buildExamDocDefinition(paper.exam, { ...sitePdfOptions(version, duplex), mockMeta, onlineUrl: `https://gsat-english-center.vercel.app/mock/${paper.id}.p` });
        out[name] = await docGolden(doc);
      }
      await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(`./__golden__/bk1-pdf-${tier}.json`);
    });
  }
});
