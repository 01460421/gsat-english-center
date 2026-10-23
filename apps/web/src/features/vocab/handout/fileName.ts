/**
 * 講義的下載檔名（docs/design/vocab-handout.md §5.5）：
 *   學測英文中心_{類型}_{範圍}[_{N}字][_{YYYYMMDD}][_含答案].pdf
 *
 *   - 類型：單字講義、單字背誦版、句意填空、單字測驗卷；
 *   - 範圍：級別範圍「L4_第201-300字」「L3-L5_A-C」「L6_全部」、篩選結果「單字庫篩選」、錯題本「錯題本」、每日學習「每日學習」或「今日複習」；
 *   - 字數與日期只加在範圍本身看不出來、而且每天會變的來源（篩選、錯題本、每日學習）；
 *   - 勾選附答案時加「_含答案」。檔名不允許的字元一律去掉（同 pdfFileName 的 safe）。
 */
import type { VocabHandoutKind } from '../../pdf/vocabTypes';
import { HANDOUT_TYPES, SITE_NAME, levelsShort } from './labels';
import type { HandoutSource } from './selection';

const safe = (s: string) => s.replace(/[\s/\\:*?"<>|]+/g, '');

function compactDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/**
 * 檔名的範圍部分，以及要不要加字數與日期。cut：來源超過一份的上限、只收前幾個字時的字數
 * （同標題，「L6_第1-600字」「L5_A-F_第1-600字」，不寫「全部」）。
 */
export function fileScope(source: HandoutSource, rangeTotal?: number, cut?: number): { scope: string; variable: boolean } {
  switch (source.kind) {
    case 'levels': {
      const levels = levelsShort(source.levels, '-').replace(/、/gu, '+');
      const r = source.range;
      const first = cut !== undefined ? `_第1-${cut}字` : '';
      if (r.by === 'all') return { scope: first ? `${levels}${first}` : `${levels}_全部`, variable: false };
      if (r.by === 'letters') return { scope: `${levels}_${r.from === r.to ? r.from.toUpperCase() : `${r.from.toUpperCase()}-${r.to.toUpperCase()}`}${first}`, variable: false };
      const from = (r.part - 1) * r.size + 1;
      const to = rangeTotal === undefined ? r.part * r.size : Math.min(r.part * r.size, rangeTotal);
      return { scope: `${levels}_第${from}-${to}字`, variable: false };
    }
    case 'filters':
      return { scope: '單字庫篩選', variable: true };
    case 'mistakes':
      return { scope: '錯題本', variable: true };
    case 'study':
      return { scope: source.which === 'due' ? '今日複習' : '每日學習', variable: true };
  }
}

export function handoutFileName(input: { kind: VocabHandoutKind; source: HandoutSource; words: number; answerKey: boolean; now: Date; rangeTotal?: number; total?: number }): string {
  const cut = input.total !== undefined && input.total > input.words ? input.words : undefined;
  const { scope, variable } = fileScope(input.source, input.rangeTotal, cut);
  const parts = [SITE_NAME, HANDOUT_TYPES[input.kind].name, scope];
  if (variable) parts.push(`${input.words}字`, compactDate(input.now));
  if (input.answerKey) parts.push('含答案');
  return `${parts.map(safe).filter(Boolean).join('_')}.pdf`;
}
