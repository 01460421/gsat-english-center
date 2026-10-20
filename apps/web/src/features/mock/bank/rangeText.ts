/**
 * 題號範圍的顯示（docs/design/bank-mock.md §2.2）：BankPaper.notices、「我組過的卷子」的 printed 用 blueprint.ts 的
 * slotRange 寫法（「35-38」「中譯英1-中譯英2」「英文作文」），畫面上改寫成「第 35–38、43–46 題」「中譯英」「英文作文」。
 */

/** 多個範圍 → 一段文字：數字的合成「第 35–38、43–46 題」，中譯英、英文作文接在後面，用頓號隔開。 */
export function rangeText(ranges: readonly string[]): string {
  const numeric: string[] = [];
  const others: string[] = [];
  for (const range of ranges) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(range);
    if (m) {
      numeric.push(m[2] && m[2] !== m[1] ? `${m[1]}–${m[2]}` : (m[1] ?? range));
      continue;
    }
    const label = range.startsWith('中譯英') ? '中譯英' : range;
    if (!others.includes(label)) others.push(label);
  }
  const parts = numeric.length > 0 ? [`第 ${numeric.join('、')} 題`] : [];
  return [...parts, ...others].join('、');
}

/** 題號清單 → 「第 36、37 題」（答案已更正的題號）。 */
export function labelsText(labels: readonly string[]): string {
  return labels.length === 0 ? '' : `第 ${labels.join('、')} 題`;
}
