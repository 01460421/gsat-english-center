/** 分頁（設計文件 §5.11）：標題不落單、不跨頁區塊的上限、從新的一頁開始。 */
import { describe, expect, it } from 'vitest';
import type { PdfNode, PdfNodeInfo } from '../engine/docTypes';
import { KEEP_LIMIT, KeepRegistry, MIN_FOLLOW, UNBREAKABLE_LIMIT, flowBlocks, keepTogether, maybeUnbreakable, type Block } from './blocks';
import { CONTENT_BOTTOM, CONTENT_HEIGHT, PAGE_MARGINS } from './metrics';

const block = (name: string, height: number, extra: Partial<Block> = {}): Block => ({ node: { text: name }, height, ...extra });
const texts = (node: unknown): string => {
  const n = node as PdfNode & { stack?: unknown[]; text?: unknown };
  if ('stack' in n && Array.isArray(n.stack)) return n.stack.map(texts).join('+');
  return String(n.text);
};

describe('flowBlocks', () => {
  it('標題、說明框、題組標示和後面第一個區塊包成不跨頁的一塊', () => {
    const out = flowBlocks([block('標題', 20, { keepWithNext: true }), block('說明', 30, { keepWithNext: true }), block('第一題', 50), block('第二題', 50)], new KeepRegistry());
    expect(out).toHaveLength(2);
    expect(texts(out[0])).toBe('標題+說明+第一題');
    expect((out[0] as PdfNode).unbreakable).toBe(true);
    expect(texts(out[1])).toBe('第二題');
  });

  it('從新的一頁開始的標題：pageBreak before 帶到合併後的區塊', () => {
    const out = flowBlocks([block('第一題', 50), block('第貳部分', 20, { keepWithNext: true, breakBefore: true }), block('第47題', 50)], new KeepRegistry());
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ pageBreak: 'before', unbreakable: true });
    expect(texts(out[1])).toBe('第貳部分+第47題');
  });

  it('合起來太高（長選文）時標題自己一塊，登記「標題後至少要有的空間」，由 pageBreakBefore 換頁', () => {
    const registry = new KeepRegistry();
    const out = flowBlocks([block('標題', 20, { keepWithNext: true }), block('長選文', KEEP_LIMIT + 10)], registry);
    expect(out).toHaveLength(2);
    const head = out[0] as PdfNode;
    expect(head).toMatchObject({ unbreakable: true, headlineLevel: 1 });
    expect(head.id).toMatch(/^keep-/);
    const info = (top: number): PdfNodeInfo => ({ id: head.id, pageNumbers: [1], pages: 1, startPosition: { pageNumber: 1, top, left: 64, verticalRatio: 0 } });
    const helpers = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };
    expect(registry.pageBreakBefore(info(CONTENT_BOTTOM - 30), helpers)).toBe(true);
    expect(registry.pageBreakBefore(info(PAGE_MARGINS[1] + 100), helpers)).toBe(false);
    // 已經在頁首就不換（換了也放不下）
    expect(registry.pageBreakBefore(info(PAGE_MARGINS[1]), helpers)).toBe(false);
    // 沒登記的節點不管
    expect(registry.pageBreakBefore({ ...info(CONTENT_BOTTOM - 5), id: 'other' }, helpers)).toBe(false);
  });

  it('標題後面接的是不跨頁的整個題組：標題下方要放得下整個題組，不然題組自己移到下一頁、標題留在頁底', () => {
    const registry = new KeepRegistry();
    const group = block('綜合測驗題組', KEEP_LIMIT, { node: { stack: [{ text: '綜合測驗題組' }], unbreakable: true } });
    const out = flowBlocks([block('大題標題', 20, { keepWithNext: true }), block('說明', 40, { keepWithNext: true }), group], registry);
    expect(out).toHaveLength(2);
    const head = out[0] as PdfNode;
    const info = (top: number): PdfNodeInfo => ({ id: head.id, pageNumbers: [1], pages: 1, startPosition: { pageNumber: 1, top, left: 64, verticalRatio: 0 } });
    const helpers = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };
    const threshold = 20 + 40 + KEEP_LIMIT;
    expect(threshold).toBeGreaterThan(20 + 40 + MIN_FOLLOW);
    // 剛好放得下標題＋整個題組：不換頁；少 1 pt 就換頁。
    expect(registry.pageBreakBefore(info(CONTENT_BOTTOM - threshold), helpers)).toBe(false);
    expect(registry.pageBreakBefore(info(CONTENT_BOTTOM - threshold + 1), helpers)).toBe(true);
  });

  it('標題後面接的是可以跨頁的長內容：只要求放得下約三行', () => {
    const registry = new KeepRegistry();
    const out = flowBlocks([block('標題', 20, { keepWithNext: true }), block('長選文', KEEP_LIMIT + 10)], registry);
    const head = out[0] as PdfNode;
    const info = (top: number): PdfNodeInfo => ({ id: head.id, pageNumbers: [1], pages: 1, startPosition: { pageNumber: 1, top, left: 64, verticalRatio: 0 } });
    const helpers = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };
    expect(registry.pageBreakBefore(info(CONTENT_BOTTOM - 20 - MIN_FOLLOW), helpers)).toBe(false);
    expect(registry.pageBreakBefore(info(CONTENT_BOTTOM - 20 - MIN_FOLLOW + 1), helpers)).toBe(true);
  });

  it('要求的空間不超過一頁：比一頁還高的題組在頁首時不換頁', () => {
    const registry = new KeepRegistry();
    const id = registry.register(30, CONTENT_HEIGHT * 2);
    const info = (top: number): PdfNodeInfo => ({ id, pageNumbers: [1], pages: 1, startPosition: { pageNumber: 1, top, left: 64, verticalRatio: 0 } });
    const helpers = { getFollowingNodesOnPage: () => [], getNodesOnNextPage: () => [], getPreviousNodesOnPage: () => [] };
    expect(registry.pageBreakBefore(info(PAGE_MARGINS[1]), helpers)).toBe(false);
    expect(registry.pageBreakBefore(info(PAGE_MARGINS[1] + 2), helpers)).toBe(true);
  });

  it('最後只剩標題也輸出（不會弄丟）', () => {
    const out = flowBlocks([block('第一題', 50), block('標題', 20, { keepWithNext: true })], new KeepRegistry());
    expect(out.map(texts)).toEqual(['第一題', '標題']);
  });
});

describe('不跨頁的上限', () => {
  it('估計高度超過約 3/4 頁就不設 unbreakable（pdfmake 會把超過一頁的不跨頁區塊截掉）', () => {
    expect(maybeUnbreakable({ text: 'x' }, UNBREAKABLE_LIMIT)).toMatchObject({ unbreakable: true });
    expect(maybeUnbreakable({ text: 'x' }, UNBREAKABLE_LIMIT + 1)).not.toHaveProperty('unbreakable');
    expect(keepTogether([block('a', UNBREAKABLE_LIMIT), block('b', 10)]).node).not.toHaveProperty('unbreakable');
    expect(keepTogether([block('a', 100), block('b', 10)]).node).toMatchObject({ unbreakable: true });
  });
});
