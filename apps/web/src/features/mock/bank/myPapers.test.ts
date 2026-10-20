/**
 * 「我組過的卷子」（設計文件 §6.6、§4.7 第 (7) 部分、§10.1）：讀寫與壞資料、使用紀錄、換代號、30 份上限與受保護的卷子、
 * 作答中上限、逾期 24 小時的處理、孤兒快照，以及 localStorage 不能用時的退路。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MockPaper } from '../papers';
import { activeKey, createRecord, HISTORY_KEY, loadActiveId, loadHistory, loadRecord, saveRecord, setActiveId, upsertHistory, type MockHistoryEntry } from '../storage';
import { buildBankPaper } from './buildExam';
import {
  BANK_ACTIVE_LIMIT,
  addMyPaper,
  checkActiveLimit,
  cleanupOrphanSnapshots,
  expireStaleAttempts,
  findMyPaper,
  hasPaperUse,
  listMyPapers,
  loadMyPapers,
  markPaperPdf,
  markPaperStarted,
  MY_PAPERS_KEY,
  MY_PAPERS_LIMIT,
  paperUsedAt,
  prunePapers,
  recordPrinted,
  replaceMyPaperId,
  saveMyPapers,
  setPaperDone,
  type MyPaperEntry,
} from './myPapers';
import { createMemorySnapshotStore, snapshotOf } from './snapshots';
import { paperInput } from './testFixtures';

/** 第 n 份測試卷的代號（prefix 兩碼十六進位）。 */
function idOf(n: number): string {
  return paperInput(n.toString(16).padStart(2, '0')).paperId;
}

function entry(n: number, patch: Partial<MyPaperEntry> = {}): MyPaperEntry {
  return { id: idOf(n), tier: 'advanced', createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), poolVersion: 'v1', ...patch };
}

function startAttempt(paperId: string, startedAt: Date) {
  const paper: MockPaper = { examId: paperId, label: '本站自組', scaleYear: 115 };
  const record = createRecord(paper, 's1', { strict: false, predictedScore: null }, startedAt);
  saveRecord(record);
  setActiveId(paperId, record.id);
  return record;
}

function historyEntry(id: string, paperId: string): MockHistoryEntry {
  return { id, paperId, submittedAt: '2026-10-02T00:00:00.000Z', raw: 50, level: null, scaleYear: 115, predictedScore: null, pendingMax: 28 };
}

describe('讀寫', () => {
  it('新增放最前面、同代號取代；壞掉的項目、難度和代號不符、非標準寫法的代號都略過', () => {
    addMyPaper(entry(1));
    addMyPaper(entry(2));
    expect(loadMyPapers().map((e) => e.id)).toEqual([idOf(2), idOf(1)]);
    addMyPaper(entry(1, { poolVersion: 'v2' }));
    expect(loadMyPapers().map((e) => [e.id, e.poolVersion])).toEqual([
      [idOf(1), 'v2'],
      [idOf(2), 'v1'],
    ]);
    window.localStorage.setItem(
      MY_PAPERS_KEY,
      JSON.stringify([entry(3), { ...entry(4), tier: 'basic' }, { ...entry(5), id: idOf(5).toUpperCase() }, { ...entry(6), startedAt: 'nope' }, 'x', entry(3)]),
    );
    expect(loadMyPapers().map((e) => e.id)).toEqual([idOf(3)]);
    window.localStorage.setItem(MY_PAPERS_KEY, '{oops');
    expect(loadMyPapers()).toEqual([]);
  });

  it('開考、下載 PDF、紙本做過（可以取消）；清單裡沒有的卷子會新增一筆', () => {
    const now = new Date('2026-10-19T08:00:00.000Z');
    expect(markPaperStarted(idOf(1), now)).toBe(true);
    expect(findMyPaper(idOf(1))).toMatchObject({ id: idOf(1), tier: 'advanced', createdAt: now.toISOString(), startedAt: now.toISOString(), poolVersion: null });
    markPaperPdf(idOf(1), new Date('2026-10-19T09:00:00.000Z'));
    setPaperDone(idOf(1), true, new Date('2026-10-19T10:00:00.000Z'));
    const e = findMyPaper(idOf(1));
    expect(e && hasPaperUse(e)).toBe(true);
    expect(e && paperUsedAt(e)).toBe(Date.parse('2026-10-19T10:00:00.000Z'));
    setPaperDone(idOf(1), false);
    expect(findMyPaper(idOf(1))?.paperDoneAt).toBeUndefined();
    expect(markPaperStarted('bk1-b-bad')).toBe(false);
  });

  it('從 PDF 進來的紀錄', () => {
    recordPrinted(idOf(2), { from: idOf(1), excluded: ['21-30'], keyChanged: ['36'] }, 'v9');
    expect(findMyPaper(idOf(2))).toMatchObject({ printed: { from: idOf(1), excluded: ['21-30'], keyChanged: ['36'] }, poolVersion: 'v9' });
  });

  it('換代號：只換沒有使用紀錄的那一筆，位置與組卷時間不變', () => {
    addMyPaper(entry(1));
    addMyPaper(entry(2));
    expect(replaceMyPaperId(idOf(1), idOf(9))).toBe(true);
    expect(loadMyPapers().map((e) => e.id)).toEqual([idOf(2), idOf(9)]);
    expect(findMyPaper(idOf(9))?.createdAt).toBe(entry(1).createdAt);
    markPaperStarted(idOf(2));
    expect(replaceMyPaperId(idOf(2), idOf(8))).toBe(false);
    expect(replaceMyPaperId(idOf(7), idOf(8))).toBe(false);
  });

  it('換代號時清單裡已經有新代號：保留新代號那一筆的位置、使用紀錄與 printed，組卷時間取較早的，刪掉舊代號', () => {
    const printed = { from: idOf(5), excluded: ['21-30'], keyChanged: [] };
    // 新的在前：idOf(9)（已經在紙本做過、下載過 PDF）、idOf(2)、idOf(1)（沒用過，組卷時間最早）。
    saveMyPapers([
      entry(9, { paperDoneAt: '2026-10-05T00:00:00.000Z', pdfAt: '2026-10-04T00:00:00.000Z', printed, poolVersion: null }),
      entry(2),
      entry(1),
    ]);
    expect(replaceMyPaperId(idOf(1), idOf(9))).toBe(true);
    expect(loadMyPapers()).toEqual([
      {
        id: idOf(9),
        tier: 'advanced',
        createdAt: entry(1).createdAt,
        paperDoneAt: '2026-10-05T00:00:00.000Z',
        pdfAt: '2026-10-04T00:00:00.000Z',
        printed,
        poolVersion: 'v1',
      },
      entry(2),
    ]);
    expect(hasPaperUse(findMyPaper(idOf(9)) as MyPaperEntry)).toBe(true);
  });

  it('localStorage 不能用：清單是空的、寫入回傳 false', () => {
    // 換掉整個 localStorage（happy-dom 的 Storage 是 Proxy，對原型的 spy 攔不到）；setup.ts 的 unstubAllGlobals 會還原。
    const fail = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail, key: fail, length: 0, clear: () => undefined });
    expect(loadMyPapers()).toEqual([]);
    expect(saveMyPapers([entry(1)])).toBe(false);
    expect(markPaperStarted(idOf(1))).toBe(false);
  });
});

describe('上限與清理', () => {
  it('超過 30 份：刪掉最舊、不受保護的卷子，連同快照', async () => {
    const store = createMemorySnapshotStore();
    const list = Array.from({ length: 32 }, (_, i) => entry(i + 1));
    saveMyPapers([...list].reverse());
    // 最舊的兩份受保護：一份作答中、一份在作答歷史裡。
    startAttempt(idOf(1), new Date('2026-10-18T00:00:00Z'));
    upsertHistory(historyEntry('h1', idOf(2)));
    const third = buildBankPaper(paperInput('03'));
    await store.put(snapshotOf(third));
    const removed = await prunePapers(store);
    expect(removed).toEqual([idOf(3), idOf(4)]);
    expect(loadMyPapers()).toHaveLength(MY_PAPERS_LIMIT);
    expect(await store.get(idOf(3))).toBeNull();
    expect(findMyPaper(idOf(1))).not.toBeNull();
    expect(findMyPaper(idOf(2))).not.toBeNull();
  });

  it('全部都受保護時就全部保留（最多 33 份）', async () => {
    const list = Array.from({ length: 33 }, (_, i) => entry(i + 1));
    saveMyPapers(list);
    const history = list.slice(0, 30).map((e, i) => historyEntry(`h${i}`, e.id));
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    for (const e of list.slice(30)) startAttempt(e.id, new Date('2026-10-18T00:00:00Z'));
    expect(await prunePapers(createMemorySnapshotStore())).toEqual([]);
    expect(loadMyPapers()).toHaveLength(33);
  });

  it('作答中上限：已有 3 份時開考第 4 份要提示；接續其中一份不必', () => {
    for (let n = 1; n <= BANK_ACTIVE_LIMIT; n += 1) startAttempt(idOf(n), new Date(Date.UTC(2026, 9, 18, n)));
    // 歷屆卷的作答中紀錄不算。
    startAttempt('gsat-115', new Date('2026-10-18T05:00:00Z'));
    const r = checkActiveLimit(idOf(9));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.active.map((a) => a.paperId)).toEqual([idOf(3), idOf(2), idOf(1)]);
    expect(checkActiveLimit(idOf(2))).toEqual({ ok: true });
  });

  it('刪掉孤兒快照：清單、作答中、作答歷史都沒有的代號', async () => {
    const store = createMemorySnapshotStore();
    const papers = [1, 2, 3, 4].map((n) => buildBankPaper(paperInput(n.toString(16).padStart(2, '0'))));
    for (const p of papers) await store.put(snapshotOf(p));
    addMyPaper(entry(1));
    startAttempt(idOf(2), new Date('2026-10-18T00:00:00Z'));
    upsertHistory(historyEntry('h3', idOf(3)));
    expect(await cleanupOrphanSnapshots(store)).toEqual([idOf(4)]);
    expect((await store.keys()).sort()).toEqual([idOf(1), idOf(2), idOf(3)].sort());
  });
});

describe('逾期 24 小時仍未交卷', () => {
  const startedAt = new Date('2026-10-10T00:00:00.000Z');
  // 期限是開考後 100 分鐘；再加 24 小時寬限。
  const expiredAt = startedAt.getTime() + 100 * 60 * 1000 + 24 * 60 * 60 * 1000 + 1;

  it('有快照：以「已超過作答時間」交卷並寫入作答歷史（level 是 null），清掉作答中的標記', async () => {
    const paper = buildBankPaper(paperInput('c0'));
    const store = createMemorySnapshotStore();
    await store.put(snapshotOf(paper));
    const record = startAttempt(paper.id, startedAt);
    const result = await expireStaleAttempts({ now: expiredAt, store });
    expect(result).toEqual({ submitted: [paper.id], discarded: [] });
    expect(loadActiveId(paper.id)).toBeNull();
    expect(loadRecord(record.id)).toMatchObject({ status: 'submitted', submitReason: 'expired' });
    expect(loadHistory()).toEqual([expect.objectContaining({ id: record.id, paperId: paper.id, raw: 0, level: null })]);
  });

  it('沒有快照：丟棄那筆作答紀錄，並清掉作答中的標記', async () => {
    const id = idOf(5);
    const record = startAttempt(id, startedAt);
    const result = await expireStaleAttempts({ now: expiredAt, store: createMemorySnapshotStore() });
    expect(result).toEqual({ submitted: [], discarded: [id] });
    expect(loadRecord(record.id)).toBeNull();
    expect(window.localStorage.getItem(activeKey(id))).toBeNull();
    expect(loadHistory()).toEqual([]);
  });

  it('還在寬限期內、或是歷屆卷：不動', async () => {
    const id = idOf(6);
    startAttempt(id, startedAt);
    startAttempt('gsat-115', startedAt);
    const result = await expireStaleAttempts({ now: expiredAt - 2, store: createMemorySnapshotStore() });
    expect(result).toEqual({ submitted: [], discarded: [] });
    await expireStaleAttempts({ now: expiredAt, store: createMemorySnapshotStore() });
    expect(loadActiveId('gsat-115')).not.toBeNull();
  });

  it('可以傳入自訂的歷史摘要（WP2 傳含混合題自動判分的版本）', async () => {
    const paper = buildBankPaper(paperInput('c1'));
    const store = createMemorySnapshotStore();
    await store.put(snapshotOf(paper));
    startAttempt(paper.id, startedAt);
    const historyFn = vi.fn((record, _exam) => historyEntry(record.id, record.paperId));
    await expireStaleAttempts({ now: expiredAt, store, historyEntry: historyFn });
    expect(historyFn).toHaveBeenCalledTimes(1);
    expect(loadHistory()[0]?.raw).toBe(50);
  });
});

describe('listMyPapers', () => {
  it('每一列帶卷號、作答中的紀錄與這份的交卷紀錄', () => {
    addMyPaper(entry(1));
    addMyPaper(entry(2));
    const record = startAttempt(idOf(2), new Date('2026-10-18T00:00:00Z'));
    upsertHistory(historyEntry('h1', idOf(1)));
    const rows = listMyPapers();
    expect(rows.map((r) => r.entry.id)).toEqual([idOf(2), idOf(1)]);
    expect(rows[0]?.code).toMatch(/^A-[0-9A-Z]{5}$/);
    expect(rows[0]?.active?.id).toBe(record.id);
    expect(rows[1]?.submissions.map((h) => h.id)).toEqual(['h1']);
  });
});
