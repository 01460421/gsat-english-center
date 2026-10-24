/**
 * 加強卷（bk2）的組卷、嚴格載入與解析（docs/design/weak-paper.md §7.6、§10.1 的 status／resolve 測試），用假的 /data/：
 *   - 組一份加強卷：題組檔、快照（gsat-weakpaper）、清單；第二份避開第一份還沒開考的題組。
 *   - 嚴格載入：快照優先；沒有快照時照代號重建；題組下架就明說拿不到。
 *   - 解析（沒有使用紀錄）：每一組用自己的大題與難度找組卷池；下架的換同大題、同難度的題組，優先同命名空間，
 *     找不到改用本站題庫；題號不位移；同一個舊代號配上不同的「做過」得到同一個新代號；新版本形狀不同、來源停用時當成下架。
 */
import { type BankSectionType } from '@gsat/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { PRACTICE_HISTORY_KEY } from '../../practice/history';
import { decodeBk2, encodeBk2, type Bk2Slot } from './code2';
import { createWeakPaper } from './createWeakPaper';
import type { MockPool, MockPoolEntry, MockPoolReadingEntry } from './pool';
import { loadBankPaperStrict, resolveBankPaper } from './resolve';
import { SOURCE_ENDED_TEXT } from './sourceMask';
import { createMemorySnapshotStore, getWeakSnapshotStore, setSnapshotStoreForTests } from './snapshots';
import { fakeEntry, fakeGroupFile, fakePool, fakeTier, installFakeServer, servePool, type FakeServer } from './testFixtures';
import { weakPaperList } from './weakPapers';

let server: FakeServer;
let pool: MockPool;

const PB_RD = 'pb.rd.0f0001';
const PB_RD2 = 'pb.rd.0f0002';

function withPublisher(base: MockPool): MockPool {
  const next = structuredClone(base);
  for (const uid of [PB_RD, PB_RD2]) {
    (next.tiers.advanced.reading as MockPoolReadingEntry[]).push({ ...(fakeEntry('reading', uid) as MockPoolReadingEntry), theme: [`c:${uid}`], ex: 'ns', src: 'pub-test' });
  }
  return next;
}

function deploy(next: MockPool, options: { publisherActive?: boolean } = {}): void {
  clearDataCache();
  server = installFakeServer();
  servePool(server, next);
  for (const uid of [PB_RD, PB_RD2]) server.files.set(`bank/groups/${uid}@1.json`, fakeGroupFile('reading', uid, 1, { tier: 'advanced' }));
  server.files.set('bank/paper-skills.json', { version: 'x', codeSections: {}, groups: {} });
  if (options.publisherActive) {
    server.files.set('bank/sources.json', {
      version: 'x',
      sources: [
        { id: 'ai-bank', ns: 'ai', kind: 'ai_bank', label_zh: '本站題庫', publisher_zh: null, product_zh: null, attribution_zh: 'AI 出題・已通過自動驗證・人工審核中', scope: ['web', 'pdf', 'ai_assist', 'explanations'], active: true, retired_on: null, ends_on: null },
        { id: 'pub-test', ns: 'pb', kind: 'publisher', label_zh: '測試出版', publisher_zh: '測試出版', product_zh: '模擬試題', attribution_zh: '本題出自測試出版《模擬試題》，經授權使用', scope: ['web', 'pdf'], active: true, retired_on: null, ends_on: '2099-12-31' },
      ],
    });
  }
  pool = next;
}

function slotOf(section: BankSectionType, uid: string, ns: 'ai' | 'pb' = 'ai'): Bk2Slot {
  return { ns, section, tier: 'advanced', uid, v: 1 };
}

function poolUids(p: MockPool, section: BankSectionType): string[] {
  return (p.tiers.advanced[section] as MockPoolEntry[]).map((e) => e.uid);
}

function withoutUid(from: MockPool, uid: string): MockPool {
  const next = structuredClone(from);
  for (const s of Object.keys(next.tiers.advanced) as BankSectionType[]) (next.tiers.advanced[s] as MockPoolEntry[]) = (next.tiers.advanced[s] as MockPoolEntry[]).filter((e) => e.uid !== uid);
  return next;
}

beforeEach(() => {
  window.localStorage.clear();
  setSnapshotStoreForTests(createMemorySnapshotStore(), createMemorySnapshotStore());
  deploy(withPublisher(fakePool({ advanced: fakeTier({ mixed: 4 }, { chart: 2, table: 1, multi: 1, continuous: 6 }, 'e0') })));
});
afterEach(() => setSnapshotStoreForTests(null, null));

describe('createWeakPaper（隨機抽題卷）', () => {
  const request = { kind: 'r' as const, tiers: ['advanced' as const], sections: ['reading' as const, 'mixed' as const], counts: { reading: 2, mixed: 1 }, sources: ['ai-bank'], reuse: 'avoid' as const };

  it('組卷、下載題組檔、寫快照（加強卷的存放區）、加進「我的加強卷」；卷面只有勾的大題、題號 1–12', async () => {
    const r = await createWeakPaper({ request, profile: null, seed: 7, now: new Date('2026-10-23T00:00:00.000Z') });
    if (!r.ok) throw new Error(`組卷失敗：${r.reason}`);
    expect(r.paper.id.startsWith('bk2-r-')).toBe(true);
    expect(r.paper.exam.sections.map((s) => s.type)).toEqual(['reading', 'mixed']);
    expect(r.paper.exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.label)))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(await getWeakSnapshotStore().get(r.paper.id)).not.toBeNull();
    expect(weakPaperList.find(r.paper.id)).toMatchObject({ kind: 'r', request, poolVersion: 'pool-v1' });
    // 沒勾出版社來源：出版社題組不會出現。
    expect(decodeBk2(r.paper.id)?.slots.every((s) => s.ns === 'ai')).toBe(true);
  });

  it('勾了有效的出版社來源時可以抽到出版社題組；第二份避開第一份還沒開考的題組', async () => {
    deploy(pool, { publisherActive: true });
    const req = { ...request, counts: { reading: 4 }, sections: ['reading' as const], sources: ['ai-bank', 'pub-test'] };
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      window.localStorage.clear();
      const r = await createWeakPaper({ request: req, profile: null, seed });
      if (r.ok) for (const s of decodeBk2(r.paper.id)?.slots ?? []) seen.add(s.ns);
    }
    expect(seen.has('pb')).toBe(true);
    window.localStorage.clear();
    const first = await createWeakPaper({ request: req, profile: null, seed: 1 });
    const second = await createWeakPaper({ request: req, profile: null, seed: 1 });
    if (!first.ok || !second.ok) throw new Error('組卷失敗');
    const a = new Set(decodeBk2(first.paper.id)?.slots.map((s) => s.uid));
    expect(decodeBk2(second.paper.id)?.slots.filter((s) => a.has(s.uid))).toEqual([]);
  });
});

describe('嚴格載入與解析', () => {
  function shareCode(): string {
    const rd = poolUids(pool, 'reading').filter((u) => u.startsWith('ai.'));
    const st = poolUids(pool, 'structure');
    return encodeBk2('w', [slotOf('structure', st[0] ?? ''), slotOf('reading', rd[1] ?? ''), slotOf('reading', PB_RD, 'pb')]);
  }

  it('沒有使用紀錄、題組都還在（出版社來源有效）：照代號組成，題號不變', async () => {
    deploy(pool, { publisherActive: true });
    const id = shareCode();
    const r = await resolveBankPaper(id);
    if (!r.ok) throw new Error(r.reason);
    expect(r.paper.id).toBe(id);
    expect(r.redirectedFrom).toBeNull();
    expect(r.paper.groups.map((g) => `${g.first}-${g.last}`)).toEqual(['1-4', '5-8', '9-12']);
  });

  it('出版社來源停用（登記檔讀不到或過期）時，那一組當成下架、換成本站題庫的同大題同難度題組；題號不位移', async () => {
    const id = shareCode();
    const r = await resolveBankPaper(id);
    if (!r.ok) throw new Error(r.reason);
    expect(r.redirectedFrom).toBe(id);
    const slots = decodeBk2(r.paper.id)?.slots ?? [];
    expect(slots.map((s) => [s.section, s.tier, s.ns])).toEqual([
      ['structure', 'advanced', 'ai'],
      ['reading', 'advanced', 'ai'],
      ['reading', 'advanced', 'ai'],
    ]);
    expect(r.paper.groups.map((g) => `${g.first}-${g.last}`)).toEqual(['1-4', '5-8', '9-12']);
    expect(r.paper.notices.replaced).toEqual([{ range: '9-12', kind: 'removed' }]);
  });

  it('下架的換題只由舊代號與題庫決定：配上不同的「做過」得到同一個新代號；優先同命名空間', async () => {
    deploy(pool, { publisherActive: true });
    const id = shareCode();
    deploy(withoutUid(pool, PB_RD), { publisherActive: true });
    const a = await resolveBankPaper(id);
    if (!a.ok) throw new Error(a.reason);
    expect(decodeBk2(a.paper.id)?.slots[2]?.uid).toBe(PB_RD2);
    // 換一個「做過」的紀錄（假裝做過另一篇出版社閱讀以外的所有題組）再解析一次：新代號相同。
    deploy(withoutUid(pool, PB_RD), { publisherActive: true });
    window.localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({ v: 1, done: Object.fromEntries(poolUids(pool, 'reading').map((uid) => [uid, { version: 1, section: 'reading', tier: 'advanced', at: '2026-10-01T00:00:00.000Z', correct: 1, total: 4, hinted: 0 }])), current: {} }),
    );
    const b = await resolveBankPaper(id);
    if (!b.ok) throw new Error(b.reason);
    expect(b.paper.id).toBe(a.paper.id);
  });

  it('新版本的形狀不同（ex: shape）視同下架；同大題同難度都沒有替代時明說拿不到', async () => {
    deploy(pool, { publisherActive: true });
    const id = shareCode();
    const st = poolUids(pool, 'structure')[0] ?? '';
    const next = structuredClone(pool);
    for (const e of next.tiers.advanced.structure as MockPoolEntry[]) {
      if (e.uid !== st) continue;
      e.prev = { '1': [...e.k] };
      e.v = 2;
      e.k = e.k.map(() => 'beef');
      e.ex = 'shape';
    }
    deploy(next, { publisherActive: true });
    const r = await resolveBankPaper(id);
    if (!r.ok) throw new Error(r.reason);
    expect(decodeBk2(r.paper.id)?.slots[0]?.uid).not.toBe(st);
    expect(r.paper.notices.replaced).toEqual([{ range: '1-4', kind: 'removed' }]);
    // 篇章結構全部下架：沒有替代。
    const empty = structuredClone(pool);
    empty.tiers.advanced.structure = [];
    deploy(empty, { publisherActive: true });
    expect(await resolveBankPaper(id)).toEqual({ ok: false, reason: 'removed' });
  });

  it('快照裡的出版社題組在授權結束後遮住題目文字（題號、答案不變；本站題照常；快照本身不改）', async () => {
    deploy(pool, { publisherActive: true });
    const id = shareCode();
    weakPaperList.markStarted(id);
    const first = await loadBankPaperStrict(id);
    if (!first.ok) throw new Error(first.reason);
    const pbGroup = (p: typeof first.paper) => p.exam.sections.flatMap((s) => s.groups).find((g) => g.questions.some((q) => q.label === p.groups[2]?.first));
    expect(pbGroup(first.paper)?.passage).toContain(PB_RD);
    // 授權結束（登記檔沒有這個來源＝停用），不重建網站：快照照樣讀得到，但出版社那一組只剩說明。
    deploy(pool);
    const again = await loadBankPaperStrict(id);
    if (!again.ok) throw new Error(again.reason);
    expect(again.source).toBe('snapshot');
    const masked = pbGroup(again.paper);
    expect(masked?.passage).toBe(SOURCE_ENDED_TEXT);
    expect(JSON.stringify(masked)).not.toContain(PB_RD);
    const answers = (g: ReturnType<typeof pbGroup>) => g?.questions.map((q) => [q.label, 'answer' in q ? q.answer : null]);
    expect(answers(masked)).toEqual(answers(pbGroup(first.paper)));
    const labels = masked?.questions.map((q) => q.label) ?? [];
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.map((l) => again.paper.explanations[l]?.explanation_zh ?? '')).toEqual(labels.map(() => ''));
    expect(labels.map((l) => first.paper.explanations[l]?.explanation_zh ?? '')).not.toEqual(labels.map(() => ''));
    // 本站題不受影響；快照裡仍是原文（來源恢復時照常顯示）。
    expect(again.paper.exam.sections[0]?.groups[0]).toEqual(first.paper.exam.sections[0]?.groups[0]);
    expect(JSON.stringify((await getWeakSnapshotStore().get(id))?.files)).toContain(PB_RD);
  });

  it('有使用紀錄：嚴格載入（快照優先；沒有快照就照代號重建；題組下架就明說拿不到，不換題）', async () => {
    deploy(pool, { publisherActive: true });
    const id = shareCode();
    weakPaperList.markStarted(id);
    const first = await loadBankPaperStrict(id);
    if (!first.ok) throw new Error(first.reason);
    expect(first.source).toBe('network');
    clearDataCache();
    const again = await loadBankPaperStrict(id);
    expect(again.ok && again.source).toBe('snapshot');
    await getWeakSnapshotStore().delete(id);
    deploy(withoutUid(pool, poolUids(pool, 'structure')[0] ?? ''), { publisherActive: true });
    expect(await loadBankPaperStrict(id)).toEqual({ ok: false, reason: 'changed' });
    expect(await resolveBankPaper(id)).toEqual({ ok: false, reason: 'changed' });
  });
});
