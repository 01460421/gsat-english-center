/**
 * 區塊與分頁（設計文件 §5.11）。
 *
 * 版面先組成一串「區塊」（Block）：每個區塊是一個 pdfmake 節點加上估計高度，以及兩個分頁旗標：
 *   - keepWithNext：標題、說明框、題組標示——不能是頁面最後一個元素，要和下一個區塊放在同一頁；
 *   - breakBefore：從新的一頁開始（第貳、第參部分）。
 * flowBlocks() 把連續的 keepWithNext 區塊和後面第一個一般區塊包成一個不跨頁的 stack（pdfmake 的 unbreakable），
 * 放不下就整塊移到下一頁；合起來太高（超過 KEEP_LIMIT，硬包會被 pdfmake 從中間切開）時，標題自己包一塊並登記
 * 「標題之後至少還要多少空間」，由 pageBreakBefore 回呼在標題落到頁底時換頁。後面的區塊本身不跨頁（整個題組）時，
 * 要的空間是整個區塊的高度——只留三行的話，區塊會自己移到下一頁，標題就留在頁底（gsat-85、ast-95）。
 */
import type { PdfContent, PdfDocDefinition, PdfNode } from '../engine/docTypes';
import { CONTENT_BOTTOM, CONTENT_HEIGHT, PAGE_MARGINS, SIZE, LINE, lineHeightPt } from './metrics';

export interface Block {
  node: PdfNode;
  /** 估計高度（pt，含上下間距）。 */
  height: number;
  keepWithNext?: boolean;
  breakBefore?: boolean;
}

/** 標題與後面內容合起來最多這麼高才包成不跨頁（約六成頁高；估計偏保守，留給誤差）。 */
export const KEEP_LIMIT = Math.round(CONTENT_HEIGHT * 0.6);
/** 單一區塊估計超過這個高度就不設 unbreakable（讓 pdfmake 在段落或表格列之間換頁）。 */
export const UNBREAKABLE_LIMIT = Math.round(CONTENT_HEIGHT * 0.75);
/** 標題之後至少要放得下的內容：約三行選文。 */
export const MIN_FOLLOW = Math.ceil(lineHeightPt(SIZE.body, LINE.passage) * 3);

/** 「標題不能落單」的登記表：節點 id → 標題本身＋後面至少要放得下的高度。每份文件各自一份。 */
export class KeepRegistry {
  private readonly need = new Map<string, number>();
  private next = 1;

  /**
   * follow：標題之後至少要放得下的高度（預設三行選文）。不超過一頁扣掉標題的高度：
   * 再高的話換到新的一頁也放不下，在頁首時本來就不換。
   */
  register(height: number, follow = MIN_FOLLOW): string {
    const id = `keep-${this.next}`;
    this.next += 1;
    this.need.set(id, height + Math.min(Math.max(follow, MIN_FOLLOW), CONTENT_HEIGHT - height));
    return id;
  }

  /**
   * pdfmake 的 pageBreakBefore 回呼：登記過的標題區塊離頁底不夠時換頁。已經在頁首就不換（換了也放不下）。
   */
  readonly pageBreakBefore: NonNullable<PdfDocDefinition['pageBreakBefore']> = (node) => {
    if (node.id === undefined) return false;
    const need = this.need.get(node.id);
    if (need === undefined) return false;
    const top = node.startPosition.top;
    if (top <= PAGE_MARGINS[1] + 1) return false;
    return top + need > CONTENT_BOTTOM;
  };
}

function withBreak(node: PdfNode, breakBefore: boolean | undefined): PdfNode {
  return breakBefore ? { ...node, pageBreak: 'before' } : node;
}

/** 幾個區塊包成一個 stack（不跨頁）。 */
export function keepTogether(blocks: readonly Block[]): Block {
  const height = blocks.reduce((sum, b) => sum + b.height, 0);
  return {
    node: { stack: blocks.map((b) => b.node), ...(height <= UNBREAKABLE_LIMIT ? { unbreakable: true } : {}) },
    height,
    ...(blocks[0]?.keepWithNext && blocks.every((b) => b.keepWithNext) ? { keepWithNext: true } : {}),
    ...(blocks[0]?.breakBefore ? { breakBefore: true } : {}),
  };
}

/** 區塊串 → pdfmake 內容（處理 keepWithNext 與 breakBefore）。 */
export function flowBlocks(blocks: readonly Block[], registry: KeepRegistry): PdfContent[] {
  const out: PdfContent[] = [];
  let pending: Block[] = [];
  /** follow：觸發這次清出的區塊（標題後面接的內容）；它不跨頁時，標題下方要放得下整個區塊。 */
  const flushPending = (follow?: Block) => {
    if (pending.length === 0) return;
    const head = keepTogether(pending);
    const need = follow?.node.unbreakable ? follow.height : MIN_FOLLOW;
    out.push(withBreak({ ...head.node, unbreakable: true, id: registry.register(head.height, need), headlineLevel: 1 }, head.breakBefore));
    pending = [];
  };
  for (const block of blocks) {
    if (block.breakBefore) flushPending();
    if (block.keepWithNext) {
      pending.push(block);
      continue;
    }
    if (pending.length === 0) {
      out.push(withBreak(block.node, block.breakBefore));
      continue;
    }
    const total = pending.reduce((sum, b) => sum + b.height, 0) + block.height;
    if (total <= KEEP_LIMIT) {
      const merged = keepTogether([...pending, block]);
      out.push(withBreak({ ...merged.node, unbreakable: true }, merged.breakBefore));
      pending = [];
    } else {
      flushPending(block);
      out.push(block.node);
    }
  }
  flushPending();
  return out;
}

/** 依估計高度決定要不要包成不跨頁。 */
export function maybeUnbreakable(node: PdfNode, height: number): PdfNode {
  return height <= UNBREAKABLE_LIMIT ? { ...node, unbreakable: true } : node;
}
