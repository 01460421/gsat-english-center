/**
 * 模擬考畫面共用的顯示格式（列表、成績單）。
 */
import { formatPoints } from '../exams/scoring';

/** ISO 時間 → 「2026/10/9 09:40」（台灣時間的本地顯示）。 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 有正負號的分數差：「+6」「−2.5」「±0」（減號用 U+2212，螢幕閱讀器讀得出「負」）。 */
export function signedPoints(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '±0';
  return `${r > 0 ? '+' : '−'}${formatPoints(Math.abs(r))}`;
}
