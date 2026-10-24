/**
 * 自組卷的載入與組卷（設計文件 §4.7 第 (3)–(6) 部分、§10.1），用假的 /data/（testFixtures 的 installFakeServer）：
 *   - 組一份新卷：13 個檔案、快照、清單；不夠時 insufficient；做過的題組避開；組卷池過期（404）重抓一次。
 *   - 嚴格載入：快照優先；有使用紀錄、沒有快照時題組下架或答案改了就失敗，不換題、不改代號；same-key 照常。
 *   - 解析：只組了卷的快照；改版與下架換題並改代號（只由舊代號與題庫決定）；從 PDF 進來的紀錄；多分頁；離線。
 */
import { AI_SECTION_TYPES } from '@gsat/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache, DataLoadError, forgetFailedLoads } from '../../../data/client';
import { PRACTICE_HISTORY_KEY } from '../../practice/history';
import { activeKey, upsertHistory } from '../storage';
import { assembleSelection } from './assemble';
import { decodePaperId, encodePaperId } from './code';
import { findMyPaper, loadMyPapers, markPaperStarted } from './myPapers';
import { loadMockPool, type MockPool, type MockPoolEntry } from './pool';
import { assembleNewPaper, hasLocalUse, loadBankPaperStrict, resolveBankPaper } from './resolve';
import { createMemorySnapshotStore, getSnapshotStore, setSnapshotStoreForTests, snapshotOf } from './snapshots';
import { fakeGroupFile, fakePool, fakeTier, installFakeServer, servePool, type FakeServer } from './testFixtures';
import { buildBankPaper } from './buildExam';

let pool: MockPool;
let server: FakeServer;

/** 換一個網站版本：新的組卷池與題組檔（舊的檔案不在了），清掉頁面的資料快取。 */
function deploy(next: MockPool): FakeServer {
  clearDataCache();
  server = installFakeServer();
  servePool(server, next);
  return server;
}

/** 別人分享來的代號：直接從池子挑一份（這台裝置沒有任何紀錄）。 */
function shareCode(from: MockPool, seed = 1): string {
  const sel = assembleSelection(from.tiers.basic, seed, new Map());
  if (!sel.ok) throw new Error('組不出來');
  return encodePaperId('basic', sel.slots);
}

/** 某個 uid 出新版本：sameKey 時答案指紋不變，不然第 2 題的指紋改了。 */
function withNewVersion(from: MockPool, uid: string, sameKey: boolean): MockPool {
  const next = structuredClone(from);
  for (const s of AI_SECTION_TYPES) {
    for (const e of next.tiers.basic[s] as MockPoolEntry[]) {
      if (e.uid !== uid) continue;
      e.prev = { [String(e.v)]: [...e.k] };
      e.v += 1;
      if (!sameKey) e.k = e.k.map((x, i) => (i === 1 ? 'beef' : x));
    }
  }
  return next;
}

/** 某個 uid 的新版本有指向題組外的空格記號（建置端標 ex: 'marker'），題組檔也真的帶著那個記號。 */
function deployMarkerUpdate(from: MockPool, uid: string, sameKey: boolean): void {
  const next = withNewVersion(from, uid, sameKey);
  for (const s of AI_SECTION_TYPES) for (const e of next.tiers.basic[s] as MockPoolEntry[]) if (e.uid === uid) e.ex = 'marker';
  deploy(next);
  server.files.set(`bank/groups/${uid}@2.json`, fakeGroupFile('reading', uid, 2, { strayMarker: 99 }));
}

function withoutUid(from: MockPool, uid: string): MockPool {
  const next = structuredClone(from);
  for (const s of AI_SECTION_TYPES) (next.tiers.basic[s] as MockPoolEntry[]) = (next.tiers.basic[s] as MockPoolEntry[]).filter((e) => e.uid !== uid);
  return next;
}

function slotUid(paperId: string, index: number): string {
  return decodePaperId(paperId)?.slots[index]?.uid ?? '';
}

function poolUids(from: MockPool): Set<string> {
  return new Set(AI_SECTION_TYPES.flatMap((s) => (from.tiers.basic[s] as MockPoolEntry[]).map((e) => e.uid)));
}

beforeEach(() => {
  setSnapshotStoreForTests(createMemorySnapshotStore());
  pool = fakePool({ basic: fakeTier(), top: fakeTier({}, {}, 'f0') });
  deploy(pool);
});

afterEach(() => {
  clearDataCache();
  setSnapshotStoreForTests(null);
});

describe('assembleNewPaper', () => {
  it('組卷、下載 13 個檔案、存快照、加進「我組過的卷子」；只用這個難度的題組', async () => {
    const now = new Date('2026-10-19T03:00:00.000Z');
    const r = await assembleNewPaper('basic', { seed: 42, now });
    if (!r.ok) throw new Error('組卷失敗');
    const { paper } = r;
    expect(paper.tier).toBe('basic');
    expect(paper.id.startsWith('bk1-b-')).toBe(true);
    expect(paper.dataVersion).toBe('pool-v1');
    const uids = decodePaperId(paper.id)?.slots.map((s) => s.uid) ?? [];
    expect(uids.every((u) => poolUids(pool).has(u))).toBe(true);
    expect(server.requests.filter((p) => p !== 'bank/mock-pool.json')).toHaveLength(13);
    expect(await getSnapshotStore().get(paper.id)).not.toBeNull();
    expect(findMyPaper(paper.id)).toEqual({ id: paper.id, tier: 'basic', createdAt: now.toISOString(), poolVersion: 'pool-v1' });
    expect(paper.notices.reused).toEqual([]);
    // 同一個種子、同樣的做過紀錄：同一份卷子。
    const again = await assembleNewPaper('basic', { seed: 42, now });
    expect(again.ok && again.paper.id).toBe(paper.id);
    expect(loadMyPapers()).toHaveLength(1);
  });

  it('開考過的卷子的題組，下一份會避開', async () => {
    const first = await assembleNewPaper('basic', { seed: 1 });
    if (!first.ok) throw new Error('組卷失敗');
    markPaperStarted(first.paper.id);
    const second = await assembleNewPaper('basic', { seed: 1 });
    if (!second.ok) throw new Error('組卷失敗');
    const a = new Set(decodePaperId(first.paper.id)?.slots.map((s) => s.uid));
    expect(decodePaperId(second.paper.id)?.slots.some((s) => a.has(s.uid))).toBe(false);
    expect(second.paper.notices.reused).toEqual([]);
  });

  it('沒做過的不夠時用做過的題組，並標出題號範圍', async () => {
    const first = await assembleNewPaper('basic', { seed: 1 });
    if (!first.ok) throw new Error('組卷失敗');
    markPaperStarted(first.paper.id);
    // 把剩下的作文都標成在寫作題庫寫過。
    for (const e of pool.tiers.basic.composition) {
      window.localStorage.setItem(`gsat-writing-draft:v1:essay:${e.uid}@${e.v}`, JSON.stringify({ text: 'draft', updatedAt: 1 }));
    }
    const second = await assembleNewPaper('basic', { seed: 2 });
    expect(second.ok && second.paper.notices.reused).toEqual(['英文作文']);
  });

  it('題庫不夠組一份：insufficient（不會改用其他難度）', async () => {
    await expect(assembleNewPaper('advanced', { seed: 1 })).resolves.toEqual({ ok: false, reason: 'insufficient', section: 'reading' });
    expect(loadMyPapers()).toEqual([]);
  });

  it('組卷池過期（題組檔 404）：清掉組卷池快取、重抓一次再組；還是 404 就是 not_found', async () => {
    await loadMockPool();
    // 網站更新了：作文換成另外三組，舊的作文檔不在了。開著的分頁還拿著舊的組卷池。
    const next = structuredClone(pool);
    next.version = 'pool-v2';
    next.tiers.basic.composition = next.tiers.basic.composition.map((e, i) => ({ ...e, uid: `ai.cp.e0000${i + 1}` }));
    const fresh = installFakeServer();
    servePool(fresh, next);
    const r = await assembleNewPaper('basic', { seed: 3 });
    expect(r.ok && r.paper.dataVersion).toBe('pool-v2');
    expect(fresh.requests.filter((p) => p === 'bank/mock-pool.json')).toHaveLength(1);

    // 新的組卷池也指向不存在的檔案：not_found（「網站剛更新，請重新整理」），不是網路錯誤。
    clearDataCache();
    const broken = installFakeServer();
    servePool(broken, next);
    for (const e of next.tiers.basic.composition) broken.files.delete(`writing/bank/prompts/${e.uid}@${e.v}.json`);
    const error = await assembleNewPaper('basic', { seed: 3 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).kind).toBe('not_found');
  });

  it('網路錯誤：丟出 network；恢復連線後再按一次就重新下載（不必先呼叫 forgetFailedLoads）', async () => {
    server.offline = true;
    const error = await assembleNewPaper('basic', { seed: 5 }).catch((e: unknown) => e);
    expect((error as DataLoadError).kind).toBe('network');
    server.offline = false;
    expect((await assembleNewPaper('basic', { seed: 5 })).ok).toBe(true);
  });

  it('進到 /mock 時組卷池下載失敗（只隱藏「約 N 份」）：恢復連線後按下「組一份新卷」會重新下載組卷池', async () => {
    server.offline = true;
    await expect(loadMockPool()).rejects.toBeInstanceOf(DataLoadError);
    server.offline = false;
    server.requests.length = 0;
    const r = await assembleNewPaper('basic', { seed: 5 });
    expect(r.ok).toBe(true);
    expect(server.requests.filter((p) => p === 'bank/mock-pool.json')).toHaveLength(1);
  });
});

describe('hasLocalUse', () => {
  it('作答中、作答歷史、清單裡有開考／下載／紙本做過才算；只組了卷不算', async () => {
    const r = await assembleNewPaper('basic', { seed: 7 });
    if (!r.ok) throw new Error('組卷失敗');
    const id = r.paper.id;
    expect(hasLocalUse(id)).toBe(false);
    markPaperStarted(id);
    expect(hasLocalUse(id)).toBe(true);
    expect(hasLocalUse(`${id.toUpperCase()}.p`)).toBe(true);
    const other = shareCode(pool, 9);
    window.localStorage.setItem(activeKey(other), 'attempt-1');
    expect(hasLocalUse(other)).toBe(true);
    const third = shareCode(pool, 11);
    upsertHistory({ id: 'h', paperId: third, submittedAt: '2026-10-19T00:00:00.000Z', raw: 1, level: null, scaleYear: 115, predictedScore: null, pendingMax: 0 });
    expect(hasLocalUse(third)).toBe(true);
  });
});

describe('loadBankPaperStrict', () => {
  it('有快照就用快照：已開考的卷子即使題組已下架也照常打開；離線也可以', async () => {
    const r = await assembleNewPaper('basic', { seed: 4 });
    if (!r.ok) throw new Error('組卷失敗');
    markPaperStarted(r.paper.id);
    deploy(withoutUid(pool, slotUid(r.paper.id, 3)));
    server.offline = true;
    const strict = await loadBankPaperStrict(r.paper.id);
    expect(strict).toMatchObject({ ok: true, source: 'snapshot' });
    expect(strict.ok && strict.paper.exam).toEqual(r.paper.exam);
    expect(server.requests).toEqual([]);
  });

  it('有作答中紀錄、沒有快照、題組已下架：失敗，不換題、不改代號、不動「我組過的卷子」', async () => {
    const id = shareCode(pool, 5);
    window.localStorage.setItem(activeKey(id), 'attempt-1');
    deploy(withoutUid(pool, slotUid(id, 3)));
    await expect(loadBankPaperStrict(id)).resolves.toEqual({ ok: false, reason: 'changed' });
    expect(loadMyPapers()).toEqual([]);
    expect(await getSnapshotStore().keys()).toEqual([]);
  });

  it('作答歷史裡有這個代號、沒有快照、題組答案已改：成績單拿到失敗結果（不重新計分）', async () => {
    const id = shareCode(pool, 6);
    upsertHistory({ id: 'h', paperId: id, submittedAt: '2026-10-19T00:00:00.000Z', raw: 30, level: null, scaleYear: 115, predictedScore: null, pendingMax: 28 });
    deploy(withNewVersion(pool, slotUid(id, 6), false));
    await expect(loadBankPaperStrict(id)).resolves.toEqual({ ok: false, reason: 'changed' });
  });

  it('same-key 的新版本：成功，代號不變，用新版本的內容並提示文字有修改；順便補寫快照', async () => {
    const id = shareCode(pool, 7);
    markPaperStarted(id);
    const uid = slotUid(id, 6);
    const next = withNewVersion(pool, uid, true);
    deploy(next);
    server.files.set(`bank/groups/${uid}@2.json`, fakeGroupFile('reading', uid, 2, { passagePrefix: 'Edited. ' }));
    const r = await loadBankPaperStrict(id);
    if (!r.ok) throw new Error('嚴格載入失敗');
    expect(r.paper.id).toBe(id);
    expect(r.source).toBe('network');
    expect(r.paper.notices.textChanged).toEqual(['39-42']);
    expect(r.paper.exam.sections[4]?.groups[1]?.passage).toMatch(/^Edited\. /);
    expect((await getSnapshotStore().get(id))?.slots[6]?.key).toBe(`${uid}@2`);
  });

  it('same-key 的新版本組不成卷子（ex: marker，有指向題組外的空格記號）：changed，不丟出重新編號的錯誤', async () => {
    const id = shareCode(pool, 7);
    markPaperStarted(id);
    deployMarkerUpdate(pool, slotUid(id, 6), true);
    await expect(loadBankPaperStrict(id)).resolves.toEqual({ ok: false, reason: 'changed' });
    expect(await getSnapshotStore().keys()).toEqual([]);
  });

  it('代號格式不對：invalid，不發任何請求', async () => {
    await expect(loadBankPaperStrict('bk1-b-xyz')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(server.requests).toEqual([]);
  });
});

describe('resolveBankPaper', () => {
  it('只組了卷、版本都還在：用快照，代號不變', async () => {
    const r = await assembleNewPaper('basic', { seed: 8 });
    if (!r.ok) throw new Error('組卷失敗');
    clearDataCache();
    const resolved = await resolveBankPaper(r.paper.id);
    expect(resolved).toMatchObject({ ok: true, source: 'snapshot', strict: false, redirectedFrom: null });
    expect(resolved.ok && resolved.paper.exam).toEqual(r.paper.exam);
  });

  it('只組了卷、離線：有快照照常打開；沒有快照就是網路錯誤', async () => {
    const r = await assembleNewPaper('basic', { seed: 8 });
    if (!r.ok) throw new Error('組卷失敗');
    clearDataCache();
    server.offline = true;
    await expect(resolveBankPaper(r.paper.id)).resolves.toMatchObject({ ok: true, source: 'snapshot' });
    const error = await resolveBankPaper(shareCode(pool, 13)).catch((e: unknown) => e);
    expect((error as DataLoadError).kind).toBe('network');
  });

  it('分享的連結、版本都還在：組出同一份卷子，代號不變，不寫進清單', async () => {
    const id = shareCode(pool, 10);
    const r = await resolveBankPaper(id);
    expect(r).toMatchObject({ ok: true, source: 'network', redirectedFrom: null, printed: null });
    expect(r.ok && r.paper.id).toBe(id);
    expect(loadMyPapers()).toEqual([]);
    // 同一個代號在同一個頁面只解析一次。
    expect(resolveBankPaper(id)).toBe(resolveBankPaper(id));
  });

  it('答案改了的新版本：換成新版本並改代號，列出答案改了的題號；清單裡沒用過的舊代號換成新代號、快照跟著換', async () => {
    const r = await assembleNewPaper('basic', { seed: 12 });
    if (!r.ok) throw new Error('組卷失敗');
    const oldId = r.paper.id;
    const uid = slotUid(oldId, 6);
    deploy(withNewVersion(pool, uid, false));
    const resolved = await resolveBankPaper(oldId);
    if (!resolved.ok) throw new Error('解析失敗');
    expect(resolved.redirectedFrom).toBe(oldId);
    expect(resolved.paper.id).not.toBe(oldId);
    expect(decodePaperId(resolved.paper.id)?.slots[6]).toEqual({ uid, v: 2 });
    expect(resolved.paper.notices.replaced).toEqual([{ range: '39-42', kind: 'updated' }]);
    expect(resolved.paper.notices.keyChanged).toEqual(['40']);
    expect(loadMyPapers().map((e) => e.id)).toEqual([resolved.paper.id]);
    expect(await getSnapshotStore().get(oldId)).toBeNull();
    expect(await getSnapshotStore().get(resolved.paper.id)).not.toBeNull();
  });

  it('題組下架：換成同難度的另一組，避開卷內的題組與主題；其他位置不動', async () => {
    const id = shareCode(pool, 14);
    const removed = slotUid(id, 3);
    const next = withoutUid(pool, removed);
    // 剩下兩組文意選填，其中一組和卷內的篇章結構撞主題。
    const structureUid = slotUid(id, 4);
    const structureTheme = pool.tiers.basic.structure.find((e) => e.uid === structureUid)?.theme ?? [];
    const [conflict, ok] = next.tiers.basic.word_bank;
    if (!conflict || !ok) throw new Error('文意選填不夠');
    conflict.theme = [...structureTheme];
    deploy(next);
    const r = await resolveBankPaper(id);
    if (!r.ok) throw new Error('解析失敗');
    const before = decodePaperId(id)?.slots ?? [];
    const after = decodePaperId(r.paper.id)?.slots ?? [];
    expect(after[3]?.uid).toBe(ok.uid);
    after.forEach((s, i) => {
      if (i !== 3) expect(s).toEqual(before[i]);
    });
    expect(r.paper.notices.replaced).toEqual([{ range: '21-30', kind: 'removed' }]);
    expect(poolUids(next).has(after[3]?.uid ?? '')).toBe(true);
  });

  it('新版本組不成卷子（ex: marker）：same-key 或答案改了都和下架一樣，換成同難度的另一組並改代號', async () => {
    for (const sameKey of [true, false]) {
      const id = shareCode(pool, 14);
      const uid = slotUid(id, 6);
      deployMarkerUpdate(pool, uid, sameKey);
      const r = await resolveBankPaper(id);
      if (!r.ok) throw new Error('解析失敗');
      expect(r.redirectedFrom).toBe(id);
      const after = decodePaperId(r.paper.id)?.slots ?? [];
      expect(after[6]?.uid).not.toBe(uid);
      expect(r.paper.notices.replaced).toEqual([{ range: '39-42', kind: 'removed' }]);
    }
  });

  it('換題的確定性：同一個舊代號配上兩組不同的做過紀錄，得到同一個新代號', async () => {
    const id = shareCode(pool, 15);
    const next = withoutUid(pool, slotUid(id, 8));
    deploy(next);
    const a = await resolveBankPaper(id);
    deploy(next);
    window.localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        done: Object.fromEntries(next.tiers.basic.mixed.map((e) => [e.uid, { version: 1, section: 'mixed', tier: 'basic', at: '2026-10-01T00:00:00.000Z', correct: 1, total: 4, hinted: 0 }])),
        current: {},
        hints: {},
        graded: {},
      }),
    );
    const b = await resolveBankPaper(id);
    expect(a.ok && b.ok && a.paper.id === b.paper.id).toBe(true);
    expect(a.ok && a.paper.id).not.toBe(id);
  });

  it('同難度湊不出替代：removed', async () => {
    const id = shareCode(pool, 16);
    const next = structuredClone(pool);
    next.tiers.basic.composition = next.tiers.basic.composition.filter((e) => e.uid === '__none__');
    deploy(next);
    await expect(resolveBankPaper(id)).resolves.toEqual({ ok: false, reason: 'removed' });
  });

  it('從 PDF 進來：記下不計分的題號範圍與答案已更正的題號（寫進新代號的清單項目）', async () => {
    const id = shareCode(pool, 17);
    const next = withNewVersion(withoutUid(pool, slotUid(id, 3)), slotUid(id, 5), false);
    deploy(next);
    const r = await resolveBankPaper(`${id.toUpperCase()}.p`);
    if (!r.ok) throw new Error('解析失敗');
    expect(r.printed).toEqual({ from: id, excluded: ['21-30'], keyChanged: ['36'] });
    expect(findMyPaper(r.paper.id)?.printed).toEqual({ from: id, excluded: ['21-30'], keyChanged: ['36'] });
    // 寫進清單的卷子補寫快照。
    expect(await getSnapshotStore().get(r.paper.id)).not.toBeNull();
  });

  it('從 PDF 進來、清單裡有沒用過的舊代號：換成新代號的同一筆，帶著 printed，組卷時間不變', async () => {
    const r = await assembleNewPaper('basic', { seed: 23, now: new Date('2026-10-01T00:00:00.000Z') });
    if (!r.ok) throw new Error('組卷失敗');
    deploy(withoutUid(pool, slotUid(r.paper.id, 10)));
    const resolved = await resolveBankPaper(r.paper.id, { fromPdf: true });
    if (!resolved.ok) throw new Error('解析失敗');
    expect(loadMyPapers()).toEqual([
      expect.objectContaining({
        id: resolved.paper.id,
        createdAt: '2026-10-01T00:00:00.000Z',
        printed: { from: r.paper.id, excluded: ['英文作文'], keyChanged: [] },
      }),
    ]);
  });

  it('same-key 的新版本：代號不變，只提示文字有修改', async () => {
    const id = shareCode(pool, 18);
    deploy(withNewVersion(pool, slotUid(id, 0), true));
    const r = await resolveBankPaper(id, { fromPdf: true });
    expect(r).toMatchObject({ ok: true, redirectedFrom: null, printed: null });
    expect(r.ok && r.paper.notices.textChanged).toEqual(['1-10']);
    expect(r.ok && r.paper.source.slots[0]?.key).toBe(`${slotUid(id, 0)}@2`);
  });

  it('有使用紀錄的代號改走嚴格載入', async () => {
    const id = shareCode(pool, 19);
    markPaperStarted(id);
    deploy(withoutUid(pool, slotUid(id, 3)));
    await expect(resolveBankPaper(id)).resolves.toEqual({ ok: false, reason: 'changed' });
  });

  it('多分頁：解析途中另一個分頁開考了，改走嚴格載入，不改代號', async () => {
    const id = shareCode(pool, 20);
    deploy(withoutUid(pool, slotUid(id, 3)));
    const original = globalThis.fetch;
    let started = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (!started && String(input).includes('/groups/')) {
          started = true;
          window.localStorage.setItem(activeKey(id), 'attempt-from-other-tab');
        }
        return original(input);
      }),
    );
    await expect(resolveBankPaper(id)).resolves.toEqual({ ok: false, reason: 'changed' });
    expect(loadMyPapers()).toEqual([]);
  });

  it('代號格式不對：invalid，不發任何請求', async () => {
    await expect(resolveBankPaper('bk1-q-000')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(server.requests).toEqual([]);
  });

  it('網路錯誤後「再試一次」可以重來', async () => {
    const id = shareCode(pool, 21);
    server.offline = true;
    await expect(resolveBankPaper(id)).rejects.toBeInstanceOf(DataLoadError);
    server.offline = false;
    forgetFailedLoads();
    await expect(resolveBankPaper(id)).resolves.toMatchObject({ ok: true });
  });
});

describe('快照與清單的一致性', () => {
  it('用快照重建的卷子和組卷當下的一樣（同一個代號在任何裝置都是同一份）', async () => {
    const r = await assembleNewPaper('basic', { seed: 22 });
    if (!r.ok) throw new Error('組卷失敗');
    const { slots, files, dataVersion } = snapshotOf(r.paper);
    const fromSnapshot = buildBankPaper({ paperId: r.paper.id, tier: 'basic', dataVersion, slots, files });
    expect(fromSnapshot.exam).toEqual(r.paper.exam);
    // 另一台裝置（沒有快照、沒有清單）打開同一個代號。
    setSnapshotStoreForTests(createMemorySnapshotStore());
    window.localStorage.clear();
    clearDataCache();
    const other = await resolveBankPaper(r.paper.id);
    expect(other.ok && other.paper.exam).toEqual(r.paper.exam);
  });
});

describe('組卷池含出版社題組（ex: ns）時，自組模擬考（bk1）的組卷與換題不變（docs/design/weak-paper.md §6.2、A9）', () => {
  /** 每個大題加 2 組出版社題組（主題鍵和本站題衝突、閱讀有圖表），題組檔也照樣供應。 */
  function withPublisher(from: MockPool): MockPool {
    const next = structuredClone(from);
    const codes: Record<string, string> = { vocabulary: 'vo', cloze: 'cz', word_bank: 'wb', structure: 'st', reading: 'rd', mixed: 'mx' };
    for (const [s, code] of Object.entries(codes)) {
      const list = next.tiers.basic[s as keyof typeof next.tiers.basic] as MockPoolEntry[];
      for (let i = 0; i < 2; i += 1) {
        const uid = `pb.${code}.f0000${i}`;
        const base = { uid, v: 1, theme: [...(list[0]?.theme ?? [])], k: [...(list[0]?.k ?? [])], ex: 'ns', src: 'pub-test' };
        list.push((s === 'reading' ? { ...base, fig: 'chart', form: 'mixed', sw: [] } : base) as MockPoolEntry);
      }
    }
    return next;
  }

  it('組一份新卷：同一個種子、空的「做過」得到同一份卷子', async () => {
    const plain = await assembleNewPaper('basic', { seed: 99 });
    window.localStorage.clear();
    setSnapshotStoreForTests(createMemorySnapshotStore());
    deploy(withPublisher(pool));
    const mixed = await assembleNewPaper('basic', { seed: 99 });
    if (!plain.ok || !mixed.ok) throw new Error('組卷失敗');
    expect(mixed.paper.id).toBe(plain.paper.id);
    expect(decodePaperId(mixed.paper.id)?.slots.every((s) => s.uid.startsWith('ai.'))).toBe(true);
  });

  it('下架換題：同一個舊代號換到同一個新代號，替代題組一定是本站題', async () => {
    const id = shareCode(pool, 3);
    const removed = slotUid(id, 5);
    deploy(withoutUid(pool, removed));
    const a = await resolveBankPaper(id);
    clearDataCache();
    window.localStorage.clear();
    setSnapshotStoreForTests(createMemorySnapshotStore());
    deploy(withPublisher(withoutUid(pool, removed)));
    const b = await resolveBankPaper(id);
    if (!a.ok || !b.ok) throw new Error('解析失敗');
    expect(b.paper.id).toBe(a.paper.id);
    expect(b.paper.id).not.toBe(id);
    expect(slotUid(b.paper.id, 5).startsWith('ai.')).toBe(true);
  });
});
