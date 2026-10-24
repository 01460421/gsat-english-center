/**
 * 「我的加強卷」與兩份清單的參數化（docs/design/weak-paper.md §7.4、§10.1 的 myPapers／snapshots／used 測試）：
 *   - 兩份清單各自讀寫、互不影響；舊格式的自組卷清單不被改寫。
 *   - 作答中上限各自 3 份；bk1 實例的逾期處理不碰 bk2 的作答（反過來也一樣）。
 *   - 快照：加強卷用自己的存放區，位置數＝代號的組數；isSlotFile 接受 pb. 的題組鍵。
 *   - used：包含本機作答紀錄裡的 uid 與「我的加強卷」裡用過的卷子；盡量避開＝還沒用過的加強卷的題組。
 */
import { BANK_UID_CODES, type BankSectionType } from '@gsat/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PracticeSectionType } from '../../../data/bank';
import { OUTCOMES_KEY } from '../../assistant/outcomes';
import { activeKey, createRecord, recordKey, type MockAttemptRecord } from '../storage';
import { MOCK_PAPERS } from '../papers';
import { bankPdfMeta } from './bankMockPaper';
import { buildBankPaper, type SlotFile } from './buildExam';
import { encodeBk2, type Bk2Slot } from './code2';
import { layoutForBk2 } from './layout';
import { BK2_LETTER_PREFIX } from './letters';
import { addMyPaper, checkActiveLimit, expireStaleAttempts, loadMyPapers, MY_PAPERS_KEY } from './myPapers';
import { createMemorySnapshotStore, getSnapshotStore, getWeakSnapshotStore, paperFromSnapshot, parseSnapshot, setSnapshotStoreForTests, snapshotOf, snapshotStoreFor } from './snapshots';
import { fakeGroupFile, fakeWritingPair, paperInput } from './testFixtures';
import { loadUsedGroups } from './used';
import { WEAK_PAPERS_KEY, avoidUids, loadLastRequest, parsePaperRequest, parseWeakPaper, saveLastRequest, weakPaperEvidence, weakPaperList, type WeakPaperEntry } from './weakPapers';

function slot(section: BankSectionType, n: number, ns: 'ai' | 'pb' = 'ai'): Bk2Slot {
  return { ns, section, tier: 'advanced', uid: `${ns}.${BANK_UID_CODES[section]}.d0${String(n).padStart(4, '0')}`, v: 1 };
}

const W_SLOTS = [slot('structure', 1), slot('reading', 2), slot('reading', 3, 'pb'), slot('translation', 4)];
const W_ID = encodeBk2('w', W_SLOTS);

function weakPaper() {
  const layout = layoutForBk2({ kind: 'w', slots: W_SLOTS });
  const files: Record<string, SlotFile> = {};
  const sources = W_SLOTS.map((s, i) => {
    const key = `${s.uid}@${s.v}`;
    files[key] = s.section === 'translation' ? fakeWritingPair('translation', s.uid, s.v) : fakeGroupFile(s.section as PracticeSectionType, s.uid, s.v, { tier: 'advanced', chart: i === 1 });
    return { key, swap: s.section === 'reading' ? ([[1, 2], [3, 4]] as [number, number][]) : [] };
  });
  return buildBankPaper({ paperId: W_ID, tier: 'advanced', dataVersion: 'pool-v1', slots: sources, files, layout });
}

function entry(id: string, extra: Partial<WeakPaperEntry> = {}): WeakPaperEntry {
  return {
    id,
    kind: 'w',
    createdAt: '2026-10-20T00:00:00.000Z',
    poolVersion: 'pool-v1',
    request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid' },
    targets: [{ key: 'skill:reading:it:inference', kind: 'skill', section: 'reading', code: 'it:inference', codes: ['it:inference'], weight: 0.3, label: '推論', n: 14, rate: 0.43 }],
    notes: [{ hits: { 'skill:reading:it:inference': 1 }, flags: [] }],
    ...extra,
  };
}

/** 一筆作答中的紀錄（期限已經過了 2 天）。 */
function staleActive(paperId: string, now: number): MockAttemptRecord {
  const paper = { ...(MOCK_PAPERS[0] as (typeof MOCK_PAPERS)[number]), examId: paperId };
  const record = createRecord(paper, 's1', { strict: false, predictedScore: null }, new Date(now - 3 * 86_400_000));
  window.localStorage.setItem(recordKey(record.id), JSON.stringify(record));
  window.localStorage.setItem(activeKey(paperId), record.id);
  return record;
}

beforeEach(() => {
  window.localStorage.clear();
  setSnapshotStoreForTests(createMemorySnapshotStore(), createMemorySnapshotStore());
});
afterEach(() => setSnapshotStoreForTests(null, null));

describe('buildBankPaper：加強卷的版面', () => {
  it('Exam 的標題、時間、滿分、大題依版面；題號從 1 連續；出版社題組可以放；沒有作文時 writing.composition 是 null', () => {
    const paper = weakPaper();
    expect(paper.layout?.kind).toBe('w');
    expect(paper.kind).toBe('w');
    expect(paper.exam.title).toMatch(/^學習助手加強卷・弱點加強卷・卷號 W-[0-9A-Z]{5}$/);
    expect(paper.exam.time_minutes).toBe(35);
    expect(paper.exam.full_score).toBe(8 + 16 + 8);
    expect(paper.exam.sections.map((s) => s.id)).toEqual(['s4', 's5', 's7']);
    expect(paper.exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions.map((q) => q.label)))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '中譯英1', '中譯英2']);
    expect(paper.writing.composition).toBeNull();
    expect(paper.writing.essayItemId).toBeNull();
    expect(Object.keys(paper.writing.translationItemIds)).toEqual(['中譯英1', '中譯英2']);
    expect(paper.groups.map((g) => `${g.first}-${g.last}`)).toEqual(['1-4', '5-8', '9-12', '中譯英1-中譯英2']);
  });

  it('閱讀的答案位置用 bk2 的雜湊前綴（和同樣位置的 bk1 規則各自獨立）', async () => {
    const { adjustReadingLetters } = await import('./letters');
    const paper = weakPaper();
    const file = fakeGroupFile('reading', W_SLOTS[1]?.uid ?? '', 1, { tier: 'advanced', chart: true });
    expect(paper.letterSwaps[1]).toEqual(adjustReadingLetters(file, 1, [[1, 2], [3, 4]], BK2_LETTER_PREFIX).swap);
  });

  it('題組數和版面不符、題組的命名空間或題型和位置不符時丟出錯誤', () => {
    const paper = weakPaper();
    const layout = layoutForBk2({ kind: 'w', slots: W_SLOTS });
    expect(() => buildBankPaper({ paperId: W_ID, tier: 'advanced', dataVersion: 'x', slots: paper.source.slots.slice(0, 3), files: paper.source.files, layout })).toThrow(/要有 4 個位置/);
    const swapped = [...paper.source.slots];
    swapped[2] = paper.source.slots[1] as (typeof swapped)[number];
    expect(() => buildBankPaper({ paperId: W_ID, tier: 'advanced', dataVersion: 'x', slots: swapped, files: paper.source.files, layout })).toThrow(/題組不符/);
  });
});

describe('快照：加強卷用自己的存放區', () => {
  it('parseSnapshot 的位置數＝代號的組數；paperFromSnapshot 依代號的版面重建；pb. 的題組鍵可以通過', async () => {
    const paper = weakPaper();
    const snap = snapshotOf(paper);
    expect(snap.slots.map((s) => s.key)).toContain(`${W_SLOTS[2]?.uid}@1`);
    expect(parseSnapshot(structuredClone(snap), W_ID)).toEqual(snap);
    expect(parseSnapshot({ ...structuredClone(snap), slots: snap.slots.slice(0, 3) }, W_ID)).toBeNull();
    const rebuilt = paperFromSnapshot(snap);
    expect(rebuilt).toEqual(paper);
    expect(snapshotStoreFor(W_ID)).toBe(getWeakSnapshotStore());
    expect(snapshotStoreFor(paperInput().paperId)).toBe(getSnapshotStore());
    expect(getWeakSnapshotStore()).not.toBe(getSnapshotStore());
    await getWeakSnapshotStore().put(snap);
    expect(await getSnapshotStore().get(W_ID)).toBeNull();
    expect(await getWeakSnapshotStore().get(W_ID)).toEqual(snap);
  });
});

describe('兩份清單', () => {
  it('各自讀寫、互不影響；舊格式的自組卷清單不被改寫', () => {
    const bk1 = paperInput().paperId;
    const oldList = JSON.stringify([{ id: bk1, tier: 'advanced', createdAt: '2026-10-01T00:00:00.000Z', poolVersion: 'v0' }]);
    window.localStorage.setItem(MY_PAPERS_KEY, oldList);
    weakPaperList.add(entry(W_ID));
    weakPaperList.markStarted(W_ID, new Date('2026-10-21T00:00:00.000Z'));
    expect(window.localStorage.getItem(MY_PAPERS_KEY)).toBe(oldList);
    expect(loadMyPapers().map((e) => e.id)).toEqual([bk1]);
    expect(weakPaperList.load().map((e) => e.id)).toEqual([W_ID]);
    expect(weakPaperList.find(W_ID)?.startedAt).toBe('2026-10-21T00:00:00.000Z');
    // bk1 的清單不收 bk2 代號，反之亦然。
    expect(weakPaperList.update(bk1, { startedAt: '2026-10-21T00:00:00.000Z' })).toBe(false);
    addMyPaper({ id: W_ID as never, tier: 'advanced', createdAt: '2026-10-01T00:00:00.000Z', poolVersion: null });
    expect(loadMyPapers().map((e) => e.id)).toEqual([bk1]);
  });

  it('開考分享來的加強卷：清單裡沒有時新增一筆（request 是 null，證據規則不列）', () => {
    weakPaperList.markStarted(W_ID, new Date('2026-10-22T00:00:00.000Z'));
    const e = weakPaperList.find(W_ID);
    expect(e).toMatchObject({ id: W_ID, kind: 'w', request: null, targets: [], notes: [] });
    expect(weakPaperEvidence().has(W_ID)).toBe(false);
  });

  it('parseWeakPaper：代號、卷別、請求、目標、每組的提示的形狀不對就略過', () => {
    expect(parseWeakPaper(entry(W_ID))).toEqual(entry(W_ID));
    expect(parseWeakPaper({ ...entry(W_ID), kind: 'f' })).toBeNull();
    expect(parseWeakPaper({ ...entry(W_ID), id: W_ID.toUpperCase() })).toBeNull();
    expect(parseWeakPaper({ ...entry(W_ID), request: { kind: 'w' } })).toBeNull();
    expect(parseWeakPaper({ ...entry(W_ID), notes: [{ hits: { x: -1 }, flags: [] }] })).toBeNull();
    expect(parseWeakPaper({ ...entry(W_ID), targets: [{ key: 'x' }] })).toBeNull();
    window.localStorage.setItem(WEAK_PAPERS_KEY, JSON.stringify([entry(W_ID), { id: 'bad' }, entry(W_ID)]));
    expect(weakPaperList.load()).toHaveLength(1);
  });

  it('證據規則的資料：卷別、目標的命中代碼、是不是診斷卷', () => {
    const m = encodeBk2('m', [
      slot('vocabulary', 1),
      slot('cloze', 2),
      slot('cloze', 3),
      slot('word_bank', 4),
      slot('structure', 5),
      slot('reading', 6),
      slot('reading', 7),
      slot('reading', 8),
      slot('mixed', 9),
      slot('translation', 10),
      slot('composition', 11),
    ]);
    weakPaperList.add(entry(W_ID));
    weakPaperList.add(entry(m, { kind: 'm', request: { kind: 'm', tiers: ['advanced'], sections: [], sources: ['ai-bank'], reuse: 'avoid', diagnostic: true }, targets: [] }));
    const ev = weakPaperEvidence();
    expect(ev.get(W_ID)).toEqual({ kind: 'w', targetCodes: { reading: ['it:inference'] }, diagnostic: false });
    expect(ev.get(m)).toEqual({ kind: 'm', targetCodes: {}, diagnostic: true });
  });

  it('上次的請求：存了讀得回來；形狀不對是 null', () => {
    const request = { kind: 'r' as const, tiers: ['basic' as const, 'top' as const], sections: ['reading' as const], counts: { reading: 2 }, sources: ['ai-bank'], reuse: 'allow' as const };
    expect(saveLastRequest(request)).toBe(true);
    expect(loadLastRequest()).toEqual(request);
    expect(parsePaperRequest({ ...request, minutes: 45 })).toBeNull();
    expect(parsePaperRequest({ ...request, tiers: [] })).toBeNull();
  });
});

describe('作答中：兩份清單各自計算、互不處理', () => {
  const now = Date.parse('2026-10-23T00:00:00.000Z');

  it('作答中上限各自 3 份', () => {
    const bk2Ids = [1, 2, 3].map((i) => encodeBk2('r', [slot('reading', 10 + i)]));
    for (const id of bk2Ids) staleActive(id, now);
    expect(weakPaperList.activeAttempts()).toHaveLength(3);
    expect(weakPaperList.checkActiveLimit(encodeBk2('r', [slot('reading', 20)])).ok).toBe(false);
    // 自組卷那一份不受影響。
    expect(checkActiveLimit(paperInput().paperId)).toEqual({ ok: true });
  });

  it('bk1 實例的逾期處理不碰 bk2 的作答；加強卷實例只處理 bk2（沒有快照就丟棄）', async () => {
    const bk1 = paperInput().paperId;
    const r1 = staleActive(bk1, now);
    const r2 = staleActive(W_ID, now);
    const bk1Result = await expireStaleAttempts({ now, store: createMemorySnapshotStore() });
    expect(bk1Result).toEqual({ submitted: [], discarded: [bk1] });
    expect(window.localStorage.getItem(activeKey(W_ID))).toBe(r2.id);
    expect(window.localStorage.getItem(recordKey(r2.id))).not.toBeNull();
    expect(window.localStorage.getItem(recordKey(r1.id))).toBeNull();
    // 加強卷實例：有快照就以「已超過作答時間」交卷。
    const store = createMemorySnapshotStore();
    await store.put(snapshotOf(weakPaper()));
    const weakResult = await weakPaperList.expireStaleAttempts({ now, store });
    expect(weakResult).toEqual({ submitted: [W_ID], discarded: [] });
  });
});

describe('used 與盡量避開', () => {
  it('used 包含本機作答紀錄裡題庫練習、自組卷與加強卷的 uid（最後作答時間），以及「我的加強卷」裡用過的卷子', () => {
    window.localStorage.setItem(
      OUTCOMES_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { s: 'bank', r: 'ai.vo.0e0001@2', g: 'g', l: '1', sec: 'vocabulary', k: [], ok: 1, a: 'A', first: 1, at: 1000 },
          { s: 'bank_mock', r: 'ai.rd.0e0002@1', g: 'g', l: '1', sec: 'reading', k: [], ok: 0, a: 'B', first: 1, at: 2000, p: W_ID },
          { s: 'exam', r: 'gsat-115', g: 'g', l: '1', sec: 'reading', k: [], ok: 0, a: 'B', first: 1, at: 3000 },
        ],
      }),
    );
    weakPaperList.add(entry(W_ID, { startedAt: '2026-10-21T00:00:00.000Z' }));
    const used = loadUsedGroups();
    expect(used.get('ai.vo.0e0001')).toBe(1000);
    expect(used.get('ai.rd.0e0002')).toBe(2000);
    expect(used.has('gsat-115')).toBe(false);
    for (const s of W_SLOTS) expect(used.get(s.uid)).toBe(Date.parse('2026-10-21T00:00:00.000Z'));
    // 這一份自己的紀錄不算（「開考前做過」）。
    expect(loadUsedGroups({ excludePaperId: W_ID }).has('ai.rd.0e0002')).toBe(false);
  });

  it('盡量避開：還沒用過的加強卷的題組，加上被「換一份」取代的那一份；用過的不算（它們已經是做過）', () => {
    const fresh = encodeBk2('w', [slot('vocabulary', 30), slot('cloze', 31)]);
    weakPaperList.add(entry(W_ID, { startedAt: '2026-10-21T00:00:00.000Z' }));
    weakPaperList.add(entry(fresh));
    expect([...avoidUids(weakPaperList.load(), ['ai.mx.000001'])].sort()).toEqual(['ai.cz.d00031', 'ai.mx.000001', 'ai.vo.d00030']);
  });
});

describe('PDF 封面的「本卷針對」取自「我的加強卷」（docs/design/weak-paper.md §9.5）', () => {
  it('組卷的裝置：弱點名稱照清單存的標籤；均衡加強卷；分享來的卷子（清單沒有、request 是 null）沒有', () => {
    const paper = weakPaper();
    expect(bankPdfMeta(paper, false).sitePaper?.targets).toBeUndefined();
    weakPaperList.add(entry(W_ID));
    expect(bankPdfMeta(paper, false).sitePaper?.targets).toEqual({ labels: ['推論'], balanced: false });
    weakPaperList.save([entry(W_ID, { request: { kind: 'w', tiers: ['advanced'], sections: [], minutes: 40, sources: ['ai-bank'], reuse: 'avoid', balanced: true }, targets: [] })]);
    expect(bankPdfMeta(paper, false).sitePaper?.targets).toEqual({ labels: [], balanced: true });
    weakPaperList.save([entry(W_ID, { request: null })]);
    expect(bankPdfMeta(paper, false).sitePaper?.targets).toBeUndefined();
  });

  it('作答時間與卷別寫進 PDF 資訊；組卷日期取清單的 createdAt', () => {
    weakPaperList.add(entry(W_ID));
    const meta = bankPdfMeta(weakPaper(), true);
    expect(meta).toMatchObject({ title: '學測英文中心　學習助手加強卷', strict: true });
    expect(meta.durationMinutes).toBe(weakPaper().layout?.minutes);
    expect(meta.sitePaper).toMatchObject({ paperKind: 'w', assembledOn: expect.stringMatching(/^2026-10-2[01]$/) });
  });
});
