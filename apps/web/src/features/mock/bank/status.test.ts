/**
 * 上架狀態（設計文件 §4.7 第 (1) 部分、§10.1）：current、same-key、key-changed（含題號清單、題數不同時整組）、removed；
 * 帶排除原因的仍是 current。
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINT_SLOTS } from './blueprint';
import type { MockPoolEntry } from './pool';
import { isStrictlyUsable, paperStatuses, slotStatus, statusOfEntry } from './status';
import { fakeEntry, fakePool, fakeTier } from './testFixtures';

const entry = (patch: Partial<MockPoolEntry>): MockPoolEntry => ({ uid: 'ai.rd.000001', v: 3, theme: [], k: ['aaaa', 'bbbb', 'cccc', 'dddd'], ...patch });

describe('statusOfEntry', () => {
  it('池子裡就是這個版本：current（帶排除原因的照樣是 current）', () => {
    expect(statusOfEntry(entry({}), 3).kind).toBe('current');
    expect(statusOfEntry(entry({ ex: 'glyph' }), 3).kind).toBe('current');
  });

  it('較新的版本、每一題指紋都相同：same-key', () => {
    const e = entry({ prev: { '1': ['aaaa', 'bbbb', 'cccc', 'dddd'], '2': ['aaaa', 'xxxx', 'cccc', 'dddd'] } });
    expect(statusOfEntry(e, 1).kind).toBe('same-key');
  });

  it('較新的版本、有題目的指紋不同：key-changed，列出是哪幾題（題組內位置，從 1 起算）', () => {
    const e = entry({ prev: { '2': ['aaaa', 'xxxx', 'cccc', 'yyyy'] } });
    expect(statusOfEntry(e, 2)).toMatchObject({ kind: 'key-changed', changed: [2, 4] });
  });

  it('題數不同、查不到舊版本的指紋、代號的版本比池子新：整組都算改了', () => {
    expect(statusOfEntry(entry({ prev: { '1': ['aaaa', 'bbbb', 'cccc'] } }), 1)).toMatchObject({ kind: 'key-changed', changed: [1, 2, 3, 4] });
    expect(statusOfEntry(entry({}), 1)).toMatchObject({ kind: 'key-changed', changed: [1, 2, 3, 4] });
    expect(statusOfEntry(entry({ prev: { '5': ['aaaa', 'bbbb', 'cccc', 'dddd'] } }), 5)).toMatchObject({ kind: 'key-changed', changed: [1, 2, 3, 4] });
  });

  it('池子裡沒有這個 uid：removed', () => {
    expect(statusOfEntry(null, 1).kind).toBe('removed');
  });

  it('嚴格載入只接受 current、same-key', () => {
    expect(isStrictlyUsable({ kind: 'current', entry: entry({}) })).toBe(true);
    expect(isStrictlyUsable({ kind: 'same-key', entry: entry({}) })).toBe(true);
    expect(isStrictlyUsable({ kind: 'key-changed', entry: entry({}), changed: [1] })).toBe(false);
    expect(isStrictlyUsable({ kind: 'removed' })).toBe(false);
  });
});

describe('slotStatus／paperStatuses', () => {
  it('只在同難度、同大題找（別的難度有同一個 uid 也算下架）', () => {
    const basic = fakeTier();
    const pool = fakePool({ basic, advanced: fakeTier({}, {}, 'a0') });
    const uid = basic.cloze[0]?.uid ?? '';
    expect(slotStatus(pool, 'basic', 'cloze', { uid, v: 1 }).kind).toBe('current');
    const onlyAdvanced = fakePool({ advanced: fakeTier({}, {}, 'a0') });
    expect(slotStatus(onlyAdvanced, 'basic', 'cloze', { uid, v: 1 }).kind).toBe('removed');
  });

  it('整份卷子 11 個位置依代號順序', () => {
    const tier = fakeTier();
    tier.mixed = [fakeEntry('mixed', 'ai.mx.a00001', 2, { prev: { '1': ['0000', '0000', '0000', '0000'] } })];
    const pool = fakePool({ basic: tier });
    const slots = BLUEPRINT_SLOTS.map((s) => {
      const list = tier[s.section] as MockPoolEntry[];
      const e = s.section === 'cloze' || s.section === 'reading' ? list[s.groupNo - 1] : list[0];
      return { uid: e?.uid ?? `ai.${s.uidCode}.ffffff`, v: s.section === 'mixed' ? 1 : (e?.v ?? 1) };
    });
    slots[0] = { uid: 'ai.vo.ffffff', v: 1 };
    const kinds = paperStatuses(pool, { tier: 'basic', slots }).map((s) => s.kind);
    expect(kinds).toEqual(['removed', 'current', 'current', 'current', 'current', 'current', 'current', 'current', 'same-key', 'current', 'current']);
  });
});
