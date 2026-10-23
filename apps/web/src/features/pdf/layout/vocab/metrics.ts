/**
 * 單字講義的版面尺寸（pt，docs/design/vocab-handout.md §3.3、§6.4）。
 * 講義比題本緊：左右邊界 50、上 64、下 58，每頁約多 6% 字數；字級與行高照 §3.3 的表（設計值，實作時依實際產生的 PDF 微調）。
 * 行高同題本的算法：字級 × 1.107（所有子集統一的上下緣）× lineHeight。
 */
import { lineHeightPt } from '../metrics';

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
/** [左, 上, 右, 下]。 */
export const VOCAB_MARGINS: [number, number, number, number] = [50, 64, 50, 58];
export const VOCAB_CONTENT_WIDTH = PAGE_WIDTH - VOCAB_MARGINS[0] - VOCAB_MARGINS[2];
export const VOCAB_CONTENT_HEIGHT = PAGE_HEIGHT - VOCAB_MARGINS[1] - VOCAB_MARGINS[3];

/** 頁首文字的頂端、頁尾與內文底端的距離。 */
export const HEADER_TOP = 30;
export const FOOTER_TOP = 10;

export const VSIZE = {
  kicker: 10,
  title: 19,
  meta: 9,
  fields: 10.5,
  howTo: 9.5,
  header: 8.5,
  footer: 6.8,
  levelHeading: 14,
  letterHeading: 12,
  sectionTitle: 15,
  instructions: 9.5,
  entryNo: 8.5,
  headword: 13.5,
  ipa: 10.5,
  pos: 10,
  examTotal: 8,
  sense: 10.5,
  senseLabel: 8,
  derived: 9.5,
  extra: 9,
  exampleEn: 10.5,
  exampleZh: 9.5,
  attribution: 6.8,
  clozeText: 11,
  clozeBlank: 12,
  clozeNo: 11,
  reciteEn: 11,
  reciteZh: 10.5,
  reciteSmall: 8.5,
  keyText: 10,
  keySmall: 8.5,
  license: 7.2,
  sources: 9.5,
} as const;

export const VLINE = {
  entry: 1.25,
  example: 1.3,
  cloze: 1.75,
  recite: 1.2,
  key: 1.3,
  sources: 1.35,
  license: 1.15,
} as const;

/** 條目的編號欄寬（「#123」）。 */
export const ENTRY_NO_WIDTH = 30;
/** 句意填空的題號欄寬（「123.」）。 */
export const CLOZE_NO_WIDTH = 26;

export const COLOR = {
  text: '#111111',
  muted: '#555555',
  faint: '#777777',
  rule: '#bbbbbb',
  hairline: '#d9d9d9',
  tagFill: '#ececec',
  boxFill: '#f4f4f4',
} as const;

export { lineHeightPt };
