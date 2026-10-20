/**
 * 快照（設計文件 §4.7 第 (2) 部分、§10.1）：記憶體版的讀寫、壞資料略過、用快照重建出同一份卷子、
 * IndexedDB 不能用時退回記憶體（happy-dom 沒有 IndexedDB；真的 IndexedDB 由 e2e 在 Chromium 測）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildBankPaper } from './buildExam';
import {
  createIndexedDbSnapshotStore,
  createMemorySnapshotStore,
  ensureSnapshot,
  getSnapshotStore,
  paperFromSnapshot,
  parseSnapshot,
  setSnapshotStoreForTests,
  snapshotOf,
  type BankSnapshot,
} from './snapshots';
import { paperInput } from './testFixtures';

afterEach(() => {
  setSnapshotStoreForTests(null);
});

const paper = buildBankPaper(paperInput());

describe('記憶體版', () => {
  it('寫入、讀回、列出、刪除；讀回的是副本', async () => {
    const store = createMemorySnapshotStore();
    expect(await store.persistent()).toBe(false);
    expect(await store.get(paper.id)).toBeNull();
    expect(await store.put(snapshotOf(paper, new Date('2026-10-19T00:00:00Z')))).toBe(true);
    const got = await store.get(paper.id);
    expect(got).toMatchObject({ v: 1, id: paper.id, savedAt: '2026-10-19T00:00:00.000Z', dataVersion: 'pool-v1' });
    expect(got?.slots).toEqual(paper.source.slots);
    if (got) got.dataVersion = 'changed';
    expect((await store.get(paper.id))?.dataVersion).toBe('pool-v1');
    expect(await store.keys()).toEqual([paper.id]);
    await store.delete(paper.id);
    expect(await store.get(paper.id)).toBeNull();
  });

  it('用快照重建出同一份卷子（不需要組卷池）', () => {
    const rebuilt = paperFromSnapshot(snapshotOf(paper));
    expect(rebuilt.exam).toEqual(paper.exam);
    expect(rebuilt.explanations).toEqual(paper.explanations);
    expect(rebuilt.letterSwaps).toEqual(paper.letterSwaps);
    expect(paperFromSnapshot(snapshotOf(paper), { reused: ['1-10'] }).notices.reused).toEqual(['1-10']);
  });

  it('壞資料略過：版本不對、id 對不上、少了題組檔、題組檔的 uid 對不上', async () => {
    const good = snapshotOf(paper);
    expect(parseSnapshot(good, paper.id)).not.toBeNull();
    expect(parseSnapshot({ ...good, v: 2 })).toBeNull();
    expect(parseSnapshot(good, 'bk1-b-other')).toBeNull();
    const missing = structuredClone(good);
    delete missing.files[good.slots[0]?.key ?? ''];
    expect(parseSnapshot(missing)).toBeNull();
    const wrongUid = structuredClone(good);
    const key = good.slots[3]?.key ?? '';
    (wrongUid.files[key] as { uid: string }).uid = 'ai.wb.ffffff';
    expect(parseSnapshot(wrongUid)).toBeNull();
    expect(parseSnapshot({ ...good, slots: good.slots.slice(1) })).toBeNull();
    // 存進去的壞資料：讀的時候當成沒有，並刪掉。
    const store = createMemorySnapshotStore();
    await store.put(missing as BankSnapshot);
    expect(await store.get(paper.id)).toBeNull();
    expect(await store.keys()).toEqual([]);
  });

  it('ensureSnapshot：沒有才寫，已經有的不覆寫', async () => {
    const store = createMemorySnapshotStore();
    expect(await ensureSnapshot(paper, store)).toBe(true);
    const first = await store.get(paper.id);
    expect(await ensureSnapshot({ ...paper, dataVersion: 'other' }, store)).toBe(true);
    expect((await store.get(paper.id))?.dataVersion).toBe(first?.dataVersion);
  });
});

describe('IndexedDB 不能用時退回記憶體', () => {
  it('沒有 IndexedDB（happy-dom、部分內嵌瀏覽器）：persistent() 是 false，照樣可以讀寫', async () => {
    const store = getSnapshotStore();
    expect(getSnapshotStore()).toBe(store);
    expect(await store.persistent()).toBe(false);
    expect(await store.put(snapshotOf(paper))).toBe(true);
    expect((await store.get(paper.id))?.id).toBe(paper.id);
  });

  it('open() 丟例外、或非同步回報錯誤：退回記憶體', async () => {
    const throwing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const s1 = createIndexedDbSnapshotStore(throwing);
    expect(await s1.persistent()).toBe(false);
    expect(await s1.put(snapshotOf(paper))).toBe(true);
    expect(await s1.keys()).toEqual([paper.id]);

    const failing = {
      open: () => {
        const request = { error: new Error('InvalidStateError') } as unknown as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event('error')), 0);
        return request;
      },
    } as unknown as IDBFactory;
    const s2 = createIndexedDbSnapshotStore(failing);
    expect(await s2.persistent()).toBe(false);
    expect(await s2.get(paper.id)).toBeNull();
  });
});
