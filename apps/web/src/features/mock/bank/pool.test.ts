/**
 * 組卷池的形狀檢查與載入（設計文件 §4.7 第 (6) 部分、§10.1）：建置端的範例輸出要過得了前端的檢查；
 * 形狀不對是 format 錯誤；reloadMockPool() 會丟掉成功的快取。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearDataCache, DataLoadError } from '../../../data/client';
import sampleJson from '../../../../tests/fixtures/bank-mock-public/bank/mock-pool.json';
import { findPoolEntry, isMockPool, isSelectable, loadMockPool, MOCK_POOL_PATH, reloadMockPool } from './pool';
import { fakePool, fakeTier, installFakeServer } from './testFixtures';

afterEach(() => {
  clearDataCache();
});

describe('isMockPool', () => {
  it('建置端的範例組卷池（tests/fixtures/bank-mock-public）通過檢查', () => {
    expect(isMockPool(sampleJson)).toBe(true);
  });

  it('測試用的假組卷池通過檢查', () => {
    expect(isMockPool(fakePool({ basic: fakeTier() }))).toBe(true);
  });

  it('擋下：藍圖不同、少一種難度、少一個大題、條目欄位型別不對、閱讀缺 sw', () => {
    const good = fakePool({ basic: fakeTier() });
    expect(isMockPool({ ...good, blueprint: 'gsat-114' })).toBe(false);
    const { top: _top, ...twoTiers } = good.tiers;
    expect(isMockPool({ ...good, tiers: twoTiers })).toBe(false);
    const { composition: _c, ...noComposition } = good.tiers.basic;
    expect(isMockPool({ ...good, tiers: { ...good.tiers, basic: noComposition } })).toBe(false);
    const badEntry = structuredClone(good);
    (badEntry.tiers.basic.vocabulary[0] as unknown as Record<string, unknown>)['v'] = '1';
    expect(isMockPool(badEntry)).toBe(false);
    const noSw = structuredClone(good);
    delete (noSw.tiers.basic.reading[0] as unknown as Record<string, unknown>)['sw'];
    expect(isMockPool(noSw)).toBe(false);
    expect(isMockPool('<html>')).toBe(false);
  });

  it('prev、ex 寫成 null 也當成沒有', () => {
    const pool = structuredClone(fakePool({ basic: fakeTier() }));
    const entry = pool.tiers.basic.cloze[0] as unknown as Record<string, unknown>;
    entry['prev'] = null;
    entry['ex'] = null;
    expect(isMockPool(pool)).toBe(true);
    expect(isSelectable(pool.tiers.basic.cloze[0]!)).toBe(true);
    expect(isSelectable({ ...pool.tiers.basic.cloze[0]!, ex: 'glyph' })).toBe(false);
  });
});

describe('loadMockPool／reloadMockPool', () => {
  it('同一頁面只下載一次；reloadMockPool() 丟掉成功的快取、重抓一次，之後的 loadMockPool() 拿到新的', async () => {
    const server = installFakeServer({ [MOCK_POOL_PATH]: fakePool({ basic: fakeTier() }, 'v1') });
    const a = loadMockPool();
    expect(loadMockPool()).toBe(a);
    await expect(a).resolves.toMatchObject({ version: 'v1' });
    server.files.set(MOCK_POOL_PATH, fakePool({ basic: fakeTier() }, 'v2'));
    await expect(loadMockPool()).resolves.toMatchObject({ version: 'v1' });
    await expect(reloadMockPool()).resolves.toMatchObject({ version: 'v2' });
    await expect(loadMockPool()).resolves.toMatchObject({ version: 'v2' });
    expect(server.requests.filter((p) => p === MOCK_POOL_PATH)).toHaveLength(2);
  });

  it('形狀不對是 format 錯誤；找不到是 not_found', async () => {
    const server = installFakeServer({ [MOCK_POOL_PATH]: { version: 'x', blueprint: 'gsat-115' } });
    await expect(loadMockPool()).rejects.toMatchObject({ kind: 'format' });
    server.files.delete(MOCK_POOL_PATH);
    const error = await reloadMockPool().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).kind).toBe('not_found');
  });

  it('findPoolEntry 只在指定的難度與大題裡找', () => {
    const pool = fakePool({ basic: fakeTier(), advanced: fakeTier({}, {}, 'b0') });
    const uid = pool.tiers.basic.cloze[0]?.uid ?? '';
    expect(findPoolEntry(pool, 'basic', 'cloze', uid)?.uid).toBe(uid);
    expect(findPoolEntry(pool, 'advanced', 'cloze', uid)).toBeNull();
    expect(findPoolEntry(pool, 'basic', 'reading', uid)).toBeNull();
  });
});
