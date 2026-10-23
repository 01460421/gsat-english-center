/**
 * 單字模組的網址（navigation.ts）：分頁、單字卡與講義頁的查詢參數，以及講義來源放在 history state 的讀寫
 * （docs/design/vocab-handout.md §5.2）。
 */
import { describe, expect, it } from 'vitest';
import { handoutLink, handoutNavState, handoutSourceFromState, parseTab, vocabSearch } from './navigation';

describe('vocabSearch', () => {
  it('預設分頁沒有參數；其他分頁、單字卡、講義頁各自帶參數', () => {
    expect(vocabSearch('library')).toBe('');
    expect(vocabSearch('mistakes')).toBe('?tab=mistakes');
    expect(vocabSearch('library', 'adult|n./adj.|4')).toBe('?tab=library&word=adult%7Cn.%2Fadj.%7C4');
    expect(vocabSearch('library', null, { handout: true })).toBe('?tab=library&handout=1');
    expect(vocabSearch('study', null, { handout: true })).toBe('?tab=study&handout=1');
  });

  it('parseTab：不認得的值回到單字庫', () => {
    expect(parseTab('quiz')).toBe('quiz');
    expect(parseTab('handout')).toBe('library');
    expect(parseTab(null)).toBe('library');
  });
});

describe('講義的來源放在 history state', () => {
  it('handoutLink：網址只有分頁與 handout=1，來源在 state（並標記為模組內的導覽，「返回」可以回上一頁）', () => {
    const source = { kind: 'mistakes' };
    expect(handoutLink('mistakes', source)).toEqual({ to: { search: '?tab=mistakes&handout=1' }, state: { vocabInternal: true, vocabHandoutSource: source } });
    expect(handoutNavState(source)).toEqual({ vocabInternal: true, vocabHandoutSource: source });
  });

  it('handoutSourceFromState：沒有來源或 state 不是物件時是 null', () => {
    expect(handoutSourceFromState({ vocabInternal: true, vocabHandoutSource: { kind: 'study' } })).toEqual({ kind: 'study' });
    expect(handoutSourceFromState({ vocabInternal: true })).toBeNull();
    expect(handoutSourceFromState(null)).toBeNull();
    expect(handoutSourceFromState('x')).toBeNull();
  });
});
