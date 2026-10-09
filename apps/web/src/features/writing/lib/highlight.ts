/**
 * 在學生原文上標出 AI 指出的錯誤片段（TranslationError／EssayError 的 start、end、excerpt）。
 *
 * 位置是 UTF-16 位移（JavaScript 字串索引）。後端已驗證過位置，但前端仍要防呆：
 *   - start/end 對得上 excerpt → 直接用；
 *   - 對不上（例如學生之後改過內容、位移以另一種基準計算）→ 在原文裡找 excerpt 第一次出現（從 start 附近開始找）；
 *   - 找不到 → 這個錯誤只列在清單裡，不在原文上標。
 * 錯誤片段可能互相重疊：在所有邊界切開，每一小段記下覆蓋它的錯誤。
 */
export interface Span {
  start: number;
  end: number;
  excerpt?: string;
}

/** 回傳在 text 中實際的位置；找不到回 null。 */
export function locateSpan(text: string, span: Span): { start: number; end: number } | null {
  const { start, end, excerpt } = span;
  const inRange = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length;
  if (inRange && (excerpt === undefined || excerpt === '' || text.slice(start, end) === excerpt)) return { start, end };
  if (!excerpt) return null;
  const near = text.indexOf(excerpt, Math.max(0, Math.min(text.length, (Number.isFinite(start) ? start : 0) - excerpt.length)));
  const at = near >= 0 ? near : text.indexOf(excerpt);
  return at >= 0 ? { start: at, end: at + excerpt.length } : null;
}

export interface Segment<T> {
  text: string;
  start: number;
  /** 覆蓋這一段的標記（依原順序）；空陣列表示一般文字。 */
  marks: T[];
}

/** 依標記把文字切段（標記的位置要先經過 locateSpan）。 */
export function segmentText<T extends { start: number; end: number }>(text: string, marks: readonly T[]): Segment<T>[] {
  const valid = marks.filter((m) => m.start >= 0 && m.end > m.start && m.end <= text.length);
  const cuts = new Set<number>([0, text.length]);
  for (const m of valid) {
    cuts.add(m.start);
    cuts.add(m.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment<T>[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i] ?? 0;
    const end = points[i + 1] ?? text.length;
    if (end <= start) continue;
    out.push({ text: text.slice(start, end), start, marks: valid.filter((m) => m.start <= start && m.end >= end) });
  }
  return out;
}
