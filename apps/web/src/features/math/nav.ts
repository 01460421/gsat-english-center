/** 數學頁面之間的連結：列表的篩選條件（?subject=a|b|old）。 */
import type { MathSubject } from '@gsat/shared';

/** 列表頁把篩選條件放在 location.state，「回到列表」時帶回去。 */
export function listSearchFrom(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('listSearch' in state)) return '';
  const search = (state as { listSearch: unknown }).listSearch;
  return typeof search === 'string' && search.startsWith('?') ? search : '';
}

/** 卷子所屬考科的列表網址參數（數A 是預設，不加參數）。 */
export function subjectSearch(paper: { subject: MathSubject }): string {
  return paper.subject === 'math_b' ? '?subject=b' : paper.subject === 'math' ? '?subject=old' : '';
}
