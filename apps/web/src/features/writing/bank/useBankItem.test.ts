/** nextEntry：作答頁的「下一組／下一題」挑哪一組（docs/design/bank-writing.md §2.3、§2.4）。 */
import { afterEach, describe, expect, it } from 'vitest';
import { draftKey } from '../lib/drafts';
import type { WritingBankEntry, WritingBankIndex } from './data';
import { nextEntry } from './useBankItem';

afterEach(() => {
  window.localStorage.clear();
});

const entry = (uid: string, patch: Partial<WritingBankEntry> = {}): WritingBankEntry => ({
  uid,
  version: 1,
  section_type: uid.includes('.cp.') ? 'composition' : 'translation',
  tier: 'basic',
  topic: null,
  ...patch,
});
const indexOf = (groups: WritingBankEntry[]): WritingBankIndex => ({ version: 'test', count: groups.length, groups });
/** 在這台裝置把那一組標成已完成（已對照）。 */
const markDone = (e: WritingBankEntry, by: 'revealedAt' | 'aiSubmittedAt' = 'revealedAt') =>
  window.localStorage.setItem(
    draftKey(e.section_type === 'translation' ? 'translation' : 'essay', `${e.uid}@${e.version}`),
    JSON.stringify({ texts: ['A.', 'B.'], text: 'A.', revealedAt: by === 'revealedAt' ? 1 : null, aiSubmittedAt: by === 'aiSubmittedAt' ? 1 : null }),
  );

describe('nextEntry', () => {
  const a = entry('ai.tr.00000a');
  const b = entry('ai.tr.00000b');
  const c = entry('ai.tr.00000c');
  // 同題型其他難度、其他題型同難度：都不會被選到。
  const otherTier = entry('ai.tr.000001', { tier: 'advanced' });
  const essay = entry('ai.cp.000002');
  const index = indexOf([c, otherTier, a, essay, b]);

  it('同題型、同難度，依 uid 排序取目前這組的下一組；最後一組繞回第一組', () => {
    expect(nextEntry(index, a)?.uid).toBe(b.uid);
    expect(nextEntry(index, b)?.uid).toBe(c.uid);
    expect(nextEntry(index, c)?.uid).toBe(a.uid);
  });

  it('優先選這台裝置還沒完成的（已對照或已送 AI 批改都算完成）；全部做過才照順序', () => {
    markDone(b);
    expect(nextEntry(index, a)?.uid).toBe(c.uid);
    markDone(c, 'aiSubmittedAt');
    expect(nextEntry(index, a)?.uid).toBe(b.uid);
    // 只有草稿（有字、還沒對照）不算完成。
    window.localStorage.setItem(draftKey('translation', `${b.uid}@1`), JSON.stringify({ texts: ['寫了一半'], revealedAt: null, aiSubmittedAt: null }));
    expect(nextEntry(index, c)?.uid).toBe(a.uid);
    expect(nextEntry(index, a)?.uid).toBe(b.uid);
  });

  it('那個難度只有這一組：回 null（不顯示「下一組」）', () => {
    expect(nextEntry(index, otherTier)).toBeNull();
    expect(nextEntry(index, essay)).toBeNull();
  });

  it('作文一樣：只在作文同難度裡找', () => {
    const e1 = entry('ai.cp.00000a', { tier: 'top' });
    const e2 = entry('ai.cp.00000b', { tier: 'top' });
    const idx = indexOf([e2, entry('ai.tr.00000a', { tier: 'top' }), e1, entry('ai.cp.00000c', { tier: 'basic' })]);
    expect(nextEntry(idx, e1)?.uid).toBe(e2.uid);
    expect(nextEntry(idx, e2)?.uid).toBe(e1.uid);
  });
});
