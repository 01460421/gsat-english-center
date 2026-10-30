/**
 * 國文解析的引文與左欄加亮（docs/design/assistant-subjects.md §5.2、§8.3）：解析裡逐字出自題目的引文（證據鏈、逐選項、要點、
 * 要件、問題（一）、文言對照卡的原文列）在左欄的題目區塊裡加亮；按「在題目中標出這句」時那一句加深並捲過去。
 *
 *   - 位置優先用 Worker 算好的 range（where: 'blocks'，ref 是區塊序號，索引是原始文字）；沒有或對不上時，前端用 shared 的
 *     zhFindQuote（去標點、去標記的比對，和 Worker 同一支）在題目區塊裡找，找不到就不加亮（說明照樣顯示）。
 *   - 引文的 id 由題號與位置組成（step、opt、kp…），解析畫面與案例頁用同一組 id。
 */
import { zhFindQuote, type AssistQuestionBlock, type AssistQuoteRange, type ZhAnalysisView } from '@gsat/shared';
import type { ZhMark } from './components/ZhText';

export interface ZhQuoteRef {
  id: string;
  quote: string;
  range: AssistQuoteRange | null;
}

export const zhQuoteId = {
  step: (label: string, i: number) => `step:${label}:${i}`,
  option: (label: string, i: number) => `opt:${label}:${i}`,
  keyPoint: (label: string, i: number) => `kp:${label}:${i}`,
  card: (card: number, row: number) => `card:${card}:${row}`,
  requirement: (i: number) => `req:${i}`,
  q1: (i: number) => `q1:${i}`,
};

/** 解析裡全部可以在題目裡加亮的引文（依畫面順序）。 */
export function zhQuoteRefs(analysis: ZhAnalysisView): ZhQuoteRef[] {
  const out: ZhQuoteRef[] = [];
  const push = (id: string, quote: string, range: AssistQuoteRange | null) => {
    if (quote.trim() !== '') out.push({ id, quote, range });
  };
  if (analysis.kind !== 'zh_writing') {
    analysis.cards.forEach((card, c) =>
      card.rows.forEach((row, r) => {
        // 文言對照、詩詞卡的原文列：Worker 找得到原文（range 不是 null）才當成原文。
        if (row.range !== null) push(zhQuoteId.card(c, r), row.head, row.range);
      }),
    );
  }
  if (analysis.kind === 'zh_choice') {
    for (const item of analysis.items) {
      item.solution_steps.forEach((s, i) => push(zhQuoteId.step(item.label, i), s.quote, s.range));
      item.options.forEach((o, i) => push(zhQuoteId.option(item.label, i), o.quote, o.range));
    }
  } else if (analysis.kind === 'zh_short') {
    for (const part of analysis.parts) part.key_points.forEach((k, i) => push(zhQuoteId.keyPoint(part.label, i), k.quote, k.range));
  } else {
    analysis.requirements.forEach((r, i) => push(zhQuoteId.requirement(i), r.quote, r.range));
    analysis.q1?.points.forEach((p, i) => push(zhQuoteId.q1(i), p.quote, p.range));
  }
  return out;
}

/** 一句引文在題目區塊裡的位置（區塊序號、原始文字的索引）；找不到回 null。 */
export function resolveZhQuote(ref: Pick<ZhQuoteRef, 'quote' | 'range'>, blocks: readonly AssistQuestionBlock[]): { block: number; start: number; end: number } | null {
  const r = ref.range;
  if (r && r.where === 'blocks' && r.ref !== null && /^\d+$/.test(r.ref)) {
    const block = Number(r.ref);
    const text = blocks[block]?.text;
    if (text !== undefined && r.start >= 0 && r.end > r.start && r.end <= text.length) return { block, start: r.start, end: r.end };
  }
  for (let i = 0; i < blocks.length; i += 1) {
    const found = zhFindQuote(blocks[i]!.text, ref.quote);
    if (found) return { block: i, ...found };
  }
  return null;
}

/**
 * 左欄每個區塊要加亮的位置（全部引文淡色、按下的那一句加深）。activeOnly（先看提示）時只標按下的那一句：還沒展開完整解析前，
 * 逐選項與證據鏈的引文一起加亮等於提前露出答案。
 */
export function zhBlockMarks(
  analysis: ZhAnalysisView | null,
  blocks: readonly AssistQuestionBlock[] | undefined,
  activeId: string | null,
  opts: { activeOnly?: boolean } = {},
): Record<number, ZhMark[]> {
  const out: Record<number, ZhMark[]> = {};
  if (!analysis || !blocks || blocks.length === 0) return out;
  for (const ref of zhQuoteRefs(analysis)) {
    if (opts.activeOnly && ref.id !== activeId) continue;
    const at = resolveZhQuote(ref, blocks);
    if (!at) continue;
    (out[at.block] ??= []).push({ start: at.start, end: at.end, active: ref.id === activeId });
  }
  return out;
}

/** 這句引文能不能在左欄標出來（id → 是否找得到原文）。 */
export function zhLocatable(analysis: ZhAnalysisView | null, blocks: readonly AssistQuestionBlock[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!analysis || !blocks) return out;
  for (const ref of zhQuoteRefs(analysis)) if (resolveZhQuote(ref, blocks)) out.add(ref.id);
  return out;
}
