/**
 * 測試用：走訪 pdfmake 文件定義（只給 *.test.ts 用，App 不會匯入）。
 */
import type { PdfContent, PdfDocDefinition, PdfInline, PdfSection } from '../engine/docTypes';

type Walkable = PdfContent | PdfInline | PdfSection | null | undefined;

const CJK = /[⺀-鿿豈-﫿＀-￯]/u;

/** 節點裡所有文字接起來。 */
export function allText(content: Walkable | readonly Walkable[]): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: Walkable) => allText(c)).join('');
  const node = content as unknown as Record<string, unknown>;
  let out = '';
  for (const key of ['text', 'stack', 'columns', 'ul', 'ol', 'section'] as const) {
    if (key in node) out += allText(node[key] as Walkable);
  }
  if ('table' in node) out += (node.table as { body: Walkable[][] }).body.flat().map((c) => allText(c)).join('');
  return out;
}

/** 含中文卻沒有指定中文字型的字串（pdfmake 沒有字型備援，會印成方框；設計文件 §10 R4）。 */
export function cjkWithoutChineseFont(content: Walkable | readonly Walkable[], inherited?: string): string[] {
  if (content === null || content === undefined) return [];
  if (typeof content === 'string') return CJK.test(content) && inherited !== 'NotoSerifTC' ? [content] : [];
  if (Array.isArray(content)) return content.flatMap((c: Walkable) => cjkWithoutChineseFont(c, inherited));
  const node = content as unknown as Record<string, unknown>;
  const font = typeof node.font === 'string' ? node.font : inherited;
  const out: string[] = [];
  for (const key of ['text', 'stack', 'columns', 'ul', 'ol', 'section'] as const) {
    if (key in node) out.push(...cjkWithoutChineseFont(node[key] as Walkable, font));
  }
  if ('table' in node) out.push(...(node.table as { body: Walkable[][] }).body.flat().flatMap((cell) => cjkWithoutChineseFont(cell, font)));
  return out;
}

/** 依序找出符合條件的節點（深度優先）。 */
export function findNodes(content: Walkable | readonly Walkable[], predicate: (node: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (content === null || content === undefined || typeof content === 'string') return [];
  if (Array.isArray(content)) return content.flatMap((c: Walkable) => findNodes(c, predicate));
  const node = content as unknown as Record<string, unknown>;
  const out = predicate(node) ? [node] : [];
  for (const key of ['text', 'stack', 'columns', 'ul', 'ol', 'section'] as const) {
    if (key in node && typeof node[key] !== 'string') out.push(...findNodes(node[key] as Walkable, predicate));
  }
  if ('table' in node) out.push(...(node.table as { body: Walkable[][] }).body.flat().flatMap((cell) => findNodes(cell, predicate)));
  return out;
}

/**
 * 模擬 pdfmake 呼叫頁首頁尾的順序（每排一次版：先依頁序呼叫所有頁首，再呼叫所有頁尾），
 * pages：每一節的頁數。回傳每一頁的頁首與頁尾。
 */
export function renderChrome(doc: PdfDocDefinition, pages: readonly number[]): { header: PdfContent | null; footer: PdfContent | null }[] {
  const sections = doc.content as PdfSection[];
  const plan: PdfSection[] = sections.flatMap((s, i) => Array.from({ length: pages[i] ?? 1 }, () => s));
  const size = { width: 595.28, height: 841.89 };
  const headers = plan.map((s, i) => s.header?.(i + 1, plan.length, size) ?? null);
  const footers = plan.map((s, i) => s.footer?.(i + 1, plan.length, size) ?? null);
  return plan.map((_, i) => ({ header: headers[i] ?? null, footer: footers[i] ?? null }));
}
