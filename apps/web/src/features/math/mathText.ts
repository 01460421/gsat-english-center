/**
 * 含公式的文字切分：`$…$`（行內）與 `$$…$$`（獨立一行）。資料裡的公式一律包在 $…$ 裡（docs/math-exam-json-schema.md「文字與公式」），
 * 沒有跳脫的 \$，所以不處理跳脫。沒有成對的 $ 時當成一般文字。
 */
export type MathSegment = { kind: 'text'; text: string } | { kind: 'math'; tex: string; display: boolean };

export function splitMathText(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: 'math', tex: m[1].trim(), display: true });
    else out.push({ kind: 'math', tex: m[2] ?? '', display: false });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** 長的行內公式（矩陣、標準差公式）在手機上會超過螢幕寬：超過這個長度的放進可以橫向捲動的容器。 */
export const LONG_INLINE_TEX = 36;
