/**
 * 這台裝置做過的題組（設計文件 §4.4、§10.1）：題庫練習、寫作題庫的草稿、自組卷（開考、下載 PDF、紙本做過）；
 * 只組了卷不算；最後使用時間；排除自己這份與「之後」的使用；localStorage 不能用時是空的。
 */
import { describe, expect, it, vi } from 'vitest';
import { saveAttempt, createAttempt } from '../../exams/attempt';
import { PRACTICE_HISTORY_KEY } from '../../practice/history';
import { upsertHistory } from '../storage';
import { decodePaperId } from './code';
import { addMyPaper, markPaperPdf, markPaperStarted, setPaperDone } from './myPapers';
import { paperInput } from './testFixtures';
import { loadUsedGroups } from './used';

const T = (iso: string) => Date.parse(iso);

function uidsOf(paperId: string): string[] {
  return decodePaperId(paperId)?.slots.map((s) => s.uid) ?? [];
}

describe('loadUsedGroups', () => {
  it('題庫練習：done 的 uid（交卷時間）與 current 的 uid（作答紀錄的更新時間）', () => {
    window.localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        done: { 'ai.rd.000001': { version: 1, section: 'reading', tier: 'basic', at: '2026-10-01T00:00:00.000Z', correct: 3, total: 4, hinted: 0 } },
        current: { 'cloze/basic': 'ai.cz.000002@2' },
        hints: {},
        graded: {},
      }),
    );
    saveAttempt({ ...createAttempt('practice:ai.cz.000002@2', 'practice', null, new Date('2026-10-05T00:00:00.000Z')) });
    const used = loadUsedGroups();
    expect(used.get('ai.rd.000001')).toBe(T('2026-10-01T00:00:00.000Z'));
    expect(used.get('ai.cz.000002')).toBe(T('2026-10-05T00:00:00.000Z'));
  });

  it('寫作題庫：本站題（ai.tr、ai.cp）有文字、對照過或送過批改的草稿才算；歷屆題的草稿不算', () => {
    window.localStorage.setItem('gsat-writing-draft:v1:translation:ai.tr.000001@1', JSON.stringify({ texts: ['I like it.', ''], updatedAt: 1000 }));
    window.localStorage.setItem('gsat-writing-draft:v1:essay:ai.cp.000002@1', JSON.stringify({ text: '', revealedAt: 2000, updatedAt: 2000 }));
    window.localStorage.setItem('gsat-writing-draft:v1:essay:ai.cp.000003@1', JSON.stringify({ text: '   ', revealedAt: null, aiSubmittedAt: null, updatedAt: 3000 }));
    window.localStorage.setItem('gsat-writing-draft:v1:translation:gsat-115.s7g1@1', JSON.stringify({ texts: ['x'], updatedAt: 4000 }));
    window.localStorage.setItem('gsat-writing-draft:v1:essay:ai.cp.000004@1', '{broken');
    const used = loadUsedGroups();
    expect([...used.entries()].sort()).toEqual([
      ['ai.cp.000002', 2000],
      ['ai.tr.000001', 1000],
    ]);
  });

  it('自組卷：只組了卷不算；開考、下載 PDF、紙本做過都讓 11 個 uid 算做過，時間取三者最晚的', () => {
    const a = paperInput('01').paperId;
    const b = paperInput('02').paperId;
    const c = paperInput('03').paperId;
    const d = paperInput('04').paperId;
    addMyPaper({ id: a, tier: 'advanced', createdAt: '2026-10-01T00:00:00.000Z', poolVersion: 'v1' });
    markPaperPdf(b, new Date('2026-10-02T00:00:00.000Z'));
    setPaperDone(c, true, new Date('2026-10-03T00:00:00.000Z'));
    markPaperStarted(d, new Date('2026-10-04T00:00:00.000Z'));
    markPaperPdf(d, new Date('2026-10-06T00:00:00.000Z'));
    const used = loadUsedGroups();
    for (const uid of uidsOf(a)) expect(used.has(uid)).toBe(false);
    for (const uid of uidsOf(b)) expect(used.get(uid)).toBe(T('2026-10-02T00:00:00.000Z'));
    for (const uid of uidsOf(c)) expect(used.get(uid)).toBe(T('2026-10-03T00:00:00.000Z'));
    for (const uid of uidsOf(d)) expect(used.get(uid)).toBe(T('2026-10-06T00:00:00.000Z'));
    expect(used.size).toBe(33);
  });

  it('作答歷史裡的自組卷也算（清單寫入失敗時的備援）', () => {
    const id = paperInput('05').paperId;
    upsertHistory({ id: 'h1', paperId: id, submittedAt: '2026-10-07T00:00:00.000Z', raw: 40, level: null, scaleYear: 115, predictedScore: null, pendingMax: 28 });
    expect(loadUsedGroups().get(uidsOf(id)[0] ?? '')).toBe(T('2026-10-07T00:00:00.000Z'));
  });

  it('excludePaperId 不算這份自己的使用；before 只算之前的使用（拿不到時間的照樣算）', () => {
    const self = paperInput('06').paperId;
    markPaperStarted(self, new Date('2026-10-10T00:00:00.000Z'));
    window.localStorage.setItem('gsat-writing-draft:v1:translation:ai.tr.00aaaa@1', JSON.stringify({ texts: ['x'], updatedAt: T('2026-10-12T00:00:00.000Z') }));
    window.localStorage.setItem('gsat-writing-draft:v1:translation:ai.tr.00bbbb@1', JSON.stringify({ texts: ['x'] }));
    const used = loadUsedGroups({ excludePaperId: self, before: T('2026-10-11T00:00:00.000Z') });
    for (const uid of uidsOf(self)) expect(used.has(uid)).toBe(false);
    expect(used.has('ai.tr.00aaaa')).toBe(false);
    expect(used.get('ai.tr.00bbbb')).toBe(0);
  });

  it('localStorage 不能用：沒有做過的題組', () => {
    const fail = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail, key: fail, length: 1, clear: () => undefined });
    expect(loadUsedGroups().size).toBe(0);
  });
});
