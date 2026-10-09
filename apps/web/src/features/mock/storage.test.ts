/**
 * 模擬考的本機紀錄（gsat-mock:v1:*）：讀寫、驗證（壞資料不採用）、作答中指標、歷史上限、做過哪些考卷。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttemptStore, attemptStorageKey, createAttempt } from '../exams/attempt';
import { findMockPaper } from './papers';
import {
  HISTORY_KEY,
  HISTORY_LIMIT,
  activeKey,
  clearActiveId,
  createRecord,
  doneExamIds,
  loadActiveId,
  loadActiveRecord,
  loadHistory,
  loadRecord,
  parseRecord,
  recordKey,
  saveRecord,
  setActiveId,
  upsertHistory,
  type MockAttemptRecord,
  type MockHistoryEntry,
} from './storage';

const paper = findMockPaper('gsat-115');
if (!paper) throw new Error('沒有 gsat-115');

function fresh(patch: Partial<MockAttemptRecord> = {}): MockAttemptRecord {
  return { ...createRecord(paper ?? { examId: 'gsat-115', label: '', scaleYear: 115 }, 's1', { strict: true, predictedScore: 72 }, new Date('2026-10-09T01:00:00.000Z')), ...patch };
}

function entry(id: string, submittedAt: string, patch: Partial<MockHistoryEntry> = {}): MockHistoryEntry {
  return { id, paperId: 'gsat-115', submittedAt, raw: 60, level: 10, scaleYear: 115, predictedScore: null, pendingMax: 0, ...patch };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('紀錄的建立與讀寫', () => {
  it('建立：期限 100 分鐘、作答狀態是考試模式（練習輔助全關）、對照年度預設為卷別年度', () => {
    const r = fresh();
    expect(r).toMatchObject({
      v: 1,
      paperId: 'gsat-115',
      strict: true,
      predictedScore: 72,
      startedAt: '2026-10-09T01:00:00.000Z',
      deadlineAt: '2026-10-09T02:40:00.000Z',
      durationSec: 6000,
      status: 'in_progress',
      submittedAt: null,
      submitReason: null,
      activeSectionId: 's1',
      marked: [],
      scaleYear: 115,
    });
    expect(r.attempt).toMatchObject({ examId: 'gsat-115', mode: 'exam', timeLimitSec: 6000, answers: {} });
    expect(r.id).not.toBe(fresh().id);
  });

  it('鍵：gsat-mock:v1: 前綴，不會和歷屆試題的作答（gsat-exam-attempt:v1:）衝突', () => {
    const r = fresh();
    expect(recordKey(r.id)).toBe(`gsat-mock:v1:attempt:${r.id}`);
    expect(activeKey('gsat-115')).toBe('gsat-mock:v1:active:gsat-115');
    expect(recordKey(r.id)).not.toBe(attemptStorageKey('gsat-115'));
  });

  it('存檔後讀回來完全相同', () => {
    const r = fresh({
      marked: ['3', '47'],
      sectionTimeSec: { s1: 120.5 },
      selfScores: { 中譯英1: 3 },
      selfDetail: { 中譯英1: { kind: 'translation', errors: 2, mechanics: false } },
      attempt: { ...fresh().attempt, answers: { '1': 'B', '49': ['A', 'D'] } },
    });
    expect(saveRecord(r)).toBe(true);
    expect(loadRecord(r.id)).toEqual({ ...r, attempt: { ...r.attempt, examId: 'gsat-115' } });
  });

  it('不存在、不是 JSON、或內容的 id 和鍵對不上 → 沒有紀錄', () => {
    expect(loadRecord('nope')).toBeNull();
    window.localStorage.setItem(recordKey('bad'), '{not json');
    expect(loadRecord('bad')).toBeNull();
    const r = fresh();
    window.localStorage.setItem(recordKey('other'), JSON.stringify(r));
    expect(loadRecord('other')).toBeNull();
  });
});

describe('parseRecord：形狀不對就整筆不採用', () => {
  const base = () => JSON.parse(JSON.stringify(fresh())) as Record<string, unknown>;
  const cases: [string, (r: Record<string, unknown>) => void][] = [
    ['版本不對', (r) => (r['v'] = 2)],
    ['預估分數超過 100', (r) => (r['predictedScore'] = 101)],
    ['期限不是日期', (r) => (r['deadlineAt'] = 'tomorrow')],
    ['作答中卻有交卷時間', (r) => (r['submittedAt'] = '2026-10-09T02:00:00.000Z')],
    ['已交卷卻沒有交卷原因', (r) => ((r['status'] = 'submitted'), (r['submittedAt'] = '2026-10-09T02:00:00.000Z'))],
    ['不認得的狀態', (r) => (r['status'] = 'paused')],
    ['大題用時是負數', (r) => (r['sectionTimeSec'] = { s1: -1 })],
    ['離開頁面秒數是負數', (r) => (r['awaySec'] = -5)],
    ['標記不是字串陣列', (r) => (r['marked'] = [1, 2])],
    ['自評分數超過 100', (r) => (r['selfScores'] = { 英文作文: 120 })],
    ['自評內容格式不對', (r) => (r['selfDetail'] = { 英文作文: { kind: 'composition', content: 9 } })],
    ['作答狀態是練習模式', (r) => ((r['attempt'] as Record<string, unknown>)['mode'] = 'practice')],
    ['作答狀態是別份考卷', (r) => ((r['attempt'] as Record<string, unknown>)['examId'] = 'gsat-114')],
    ['答案格式不對', (r) => ((r['attempt'] as Record<string, unknown>)['answers'] = { '1': 3 })],
  ];
  for (const [name, mutate] of cases) {
    it(name, () => {
      const r = base();
      expect(parseRecord(r)).not.toBeNull();
      mutate(r);
      expect(parseRecord(r)).toBeNull();
    });
  }

  it('已交卷的紀錄：交卷時間與原因都要有', () => {
    const r = { ...base(), status: 'submitted', submittedAt: '2026-10-09T02:00:00.000Z', submitReason: 'expired' };
    expect(parseRecord(r)?.submitReason).toBe('expired');
  });

  it('重複的標記只留一個', () => {
    expect(parseRecord({ ...base(), marked: ['1', '1', '2'] })?.marked).toEqual(['1', '2']);
  });
});

describe('作答中指標（同一份卷子同時只有一筆作答中）', () => {
  it('指到作答中的紀錄才算數；指到不存在、已交卷或別份卷子的紀錄當成沒有', () => {
    const r = fresh();
    saveRecord(r);
    expect(loadActiveRecord('gsat-115')).toBeNull();
    setActiveId('gsat-115', r.id);
    expect(loadActiveRecord('gsat-115')?.id).toBe(r.id);

    saveRecord({ ...r, status: 'submitted', submittedAt: new Date().toISOString(), submitReason: 'manual' });
    expect(loadActiveRecord('gsat-115')).toBeNull();

    setActiveId('gsat-114', r.id);
    saveRecord(r);
    expect(loadActiveRecord('gsat-114')).toBeNull();

    setActiveId('gsat-113', 'missing');
    expect(loadActiveRecord('gsat-113')).toBeNull();
  });

  it('清除指標時只清還指向自己的（別的分頁可能已經開了新的一份）', () => {
    setActiveId('gsat-115', 'new-one');
    clearActiveId('gsat-115', 'old-one');
    expect(loadActiveId('gsat-115')).toBe('new-one');
    clearActiveId('gsat-115', 'new-one');
    expect(loadActiveId('gsat-115')).toBeNull();
  });
});

describe('交卷紀錄（歷史）', () => {
  it('新到舊；壞掉的項目略過；同一筆 id 取代', () => {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify([entry('a', '2026-10-01T00:00:00.000Z'), { id: 'broken' }, entry('b', '2026-10-03T00:00:00.000Z'), entry('c', '2026-10-02T00:00:00.000Z', { level: 99 })]),
    );
    expect(loadHistory().map((e) => e.id)).toEqual(['b', 'a']);
    upsertHistory(entry('a', '2026-10-01T00:00:00.000Z', { raw: 75.5, level: 12 }));
    expect(loadHistory()).toEqual([entry('b', '2026-10-03T00:00:00.000Z'), entry('a', '2026-10-01T00:00:00.000Z', { raw: 75.5, level: 12 })]);
  });

  it('舊版沒有 pendingMax 的項目當成 0', () => {
    const { pendingMax: _omit, ...old } = entry('x', '2026-10-01T00:00:00.000Z');
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify([old]));
    expect(loadHistory()[0]?.pendingMax).toBe(0);
  });

  it(`最多 ${HISTORY_LIMIT} 筆：超過時連同最舊的完整紀錄一起刪掉`, () => {
    const ids: string[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 2; i += 1) {
      const r = fresh({ id: `r${i}` });
      saveRecord(r);
      ids.push(r.id);
      upsertHistory(entry(r.id, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    }
    const history = loadHistory();
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]?.id).toBe(`r${HISTORY_LIMIT + 1}`);
    expect(history.at(-1)?.id).toBe('r2');
    expect(loadRecord('r0')).toBeNull();
    expect(loadRecord('r1')).toBeNull();
    expect(loadRecord('r2')).not.toBeNull();
  });
});

describe('localStorage 不能用（無痕模式、空間滿、封鎖網站資料）', () => {
  it('寫入失敗回傳 false、讀取失敗當成沒有紀錄，不丟例外', () => {
    const r = fresh();
    saveRecord(r);
    // 換掉整個 localStorage（happy-dom 的 Storage 是 Proxy，spy 原型上的 setItem 沒有效果）：讀寫都丟例外。
    const blocked = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as Storage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked);
    expect(saveRecord(r)).toBe(false);
    expect(setActiveId('gsat-115', r.id)).toBe(false);
    expect(upsertHistory(entry(r.id, r.startedAt))).toBe(false);
    expect(loadRecord(r.id)).toBeNull();
    expect(loadActiveRecord('gsat-115')).toBeNull();
    expect(loadHistory()).toEqual([]);
  });
});

describe('這台裝置做過哪些考卷（ref-115 的沿用題）', () => {
  it('歷屆試題有作答或已交卷、或模擬考交過卷，才算做過；可以限定「開考前」', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
    // gsat-111：歷屆試題作答了一題。
    new AttemptStore(createAttempt('gsat-111', 'practice', null)).setAnswer('1', 'B');
    // gsat-112：歷屆試題開了但沒作答。
    new AttemptStore(createAttempt('gsat-112', 'practice', null)).setElapsed(30);
    // gsat-113：模擬考 10/05 交卷。
    upsertHistory({ ...entry('m1', '2026-10-05T00:00:00.000Z'), paperId: 'gsat-113' });

    const all = ['gsat-111', 'gsat-112', 'gsat-113', 'gsat-114'];
    expect([...doneExamIds(all)].sort()).toEqual(['gsat-111', 'gsat-113']);
    expect([...doneExamIds(all, '2026-10-03T00:00:00.000Z')]).toEqual(['gsat-111']);
    expect([...doneExamIds(all, '2026-09-30T00:00:00.000Z')]).toEqual([]);
  });
});
