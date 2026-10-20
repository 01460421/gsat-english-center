/**
 * 成績單的題組狀態提示（設計文件 §6.5 第 8 項、§2.8）：已下架的題組指向原得總分那一塊的扣除行（在提示的上面）、
 * 答案已更正的逐題列出題號、中譯英與作文寫「題目」有修改、文字有修改而答案不變。
 */
import { describe, expect, it } from 'vitest';
import { statusNoteItems } from './BankReport';
import type { SlotStatus } from './status';
import { fakeEntry } from './testFixtures';

const current: SlotStatus = { kind: 'current', entry: fakeEntry('reading', 'ai.rd.000001') };

/** 11 個位置的狀態（代號順序：詞彙、綜合 ×2、文意選填、篇章結構、閱讀 ×3、混合題、中譯英、作文），沒指定的是 current。 */
function statuses(patch: Record<number, SlotStatus>): SlotStatus[] {
  return Array.from({ length: 11 }, (_, i) => patch[i] ?? current);
}

describe('statusNoteItems', () => {
  it('都是目前的版本：沒有提示', () => {
    expect(statusNoteItems(statuses({}))).toEqual([]);
  });

  it('答案已更正的逐題列出題號（不是整個題組的範圍）', () => {
    const entry = fakeEntry('reading', 'ai.rd.000002');
    expect(statusNoteItems(statuses({ 5: { kind: 'key-changed', entry, changed: [2] }, 1: { kind: 'key-changed', entry, changed: [1, 5] } }))).toEqual([
      '第 11、15、36 題的答案在交卷後由本站更正；這份成績單照你作答時的題目與答案計分。',
    ]);
  });

  it('已下架：指向上面原得總分那一塊的扣除行；中譯英的指紋是題目文字，寫「題目」有修改；文字有修改、答案不變', () => {
    const entry = fakeEntry('translation', 'ai.tr.000001');
    expect(statusNoteItems(statuses({ 8: { kind: 'removed' }, 9: { kind: 'key-changed', entry, changed: [1] }, 6: { kind: 'same-key', entry } }))).toEqual([
      '第 47–50 題的題組已被本站下架，可能有錯；上面「扣掉做過、已下架或不計分的…題」那一行已經扣掉這幾題。',
      '中譯英的題目在交卷後由本站修改；這份成績單照你作答時的題目計分。',
      '第 39–42 題的文章文字有修改，答案不變。',
    ]);
  });
});
