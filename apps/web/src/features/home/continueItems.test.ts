/**
 * 首頁儀表板「繼續學習」的資料（docs/design/desktop-ui.md §5.1）：只讀 localStorage，依最後更新時間排序、最多 4 張；
 * 交卷的、只打開過沒作答的、已經對照或送出批改的都不算。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attemptStorageKey, createAttempt, type AttemptState } from '../exams/attempt';
import { MOCK_PAPERS } from '../mock/papers';
import { activeKey, createRecord, recordKey } from '../mock/storage';
import { PRACTICE_HISTORY_KEY, resetPracticeHistoryForTests } from '../practice/history';
import { draftKey, promptEditDraftKey } from '../writing/lib/drafts';
import { CONTINUE_LIMIT, SUBMIT_GRACE_MS, collectContinueItems } from './continueItems';

const T0 = Date.parse('2026-10-18T02:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

function saveAttempt(state: AttemptState) {
  localStorage.setItem(attemptStorageKey(state.examId), JSON.stringify(state));
}

function examAttempt(examId: string, minutes: number, answers: Record<string, string>, submitted = false): AttemptState {
  const base = createAttempt(examId, 'exam', 6000, at(0));
  return { ...base, answers, updatedAt: at(minutes).toISOString(), submittedAt: submitted ? at(minutes).toISOString() : null };
}

beforeEach(() => {
  resetPracticeHistoryForTests();
});

describe('collectContinueItems', () => {
  it('沒有任何紀錄：空陣列', () => {
    expect(collectContinueItems(T0)).toEqual([]);
  });

  it('作答中的歷屆試題：標題用考卷短名、寫模式與已答題數；交卷的與題庫練習的作答紀錄不算', () => {
    saveAttempt(examAttempt('gsat-115', 5, { '1': 'B', '2': 'C', '3': '' }));
    saveAttempt(examAttempt('ast-110', 9, { '1': 'A' }, true));
    saveAttempt(examAttempt('practice:ai.vo.abc@1', 12, { '1': 'A' }));
    expect(collectContinueItems(T0)).toEqual([
      { key: 'exam:gsat-115', kind: 'exam', title: '115 學測', detail: '考試模式・已答 2 題', to: '/exams/gsat-115', at: at(5).getTime() },
    ]);
  });

  it('進行中的模擬考：剩餘時間依 now 計算；超過時間寫「打開後交卷」', () => {
    const paper = MOCK_PAPERS[0];
    if (!paper) throw new Error('沒有卷別');
    const record = createRecord(paper, 's1', { strict: false, predictedScore: null }, at(0));
    localStorage.setItem(recordKey(record.id), JSON.stringify(record));
    localStorage.setItem(activeKey(paper.examId), record.id);
    const [item] = collectContinueItems(T0 + 10 * 60_000);
    expect(item).toMatchObject({ kind: 'mock', title: `${paper.label}模擬考`, detail: '作答中，剩 1:30:00', to: `/mock/${paper.examId}` });
    expect(collectContinueItems(T0 + 200 * 60_000)[0]?.detail).toBe('已超過作答時間，打開後交卷');
  });

  it('題庫練習目前的題組：作答過、還沒交卷才算（只打開過的不算）', () => {
    localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({ v: 1, done: {}, current: { 'vocabulary/basic': 'ai.vo.aaa111@1', 'reading/top': 'ai.re.bbb222@1' }, hints: {}, graded: {} }),
    );
    saveAttempt(examAttempt('practice:ai.vo.aaa111@1', 3, { '1': 'B' }));
    saveAttempt(examAttempt('practice:ai.re.bbb222@1', 4, {}));
    expect(collectContinueItems(T0)).toEqual([
      { key: 'practice:vocabulary/basic', kind: 'practice', title: '詞彙題・穩定基礎', detail: '已答 1 題', to: '/practice/vocabulary/basic', at: at(3).getTime() },
    ]);
  });

  it('寫作草稿：有文字、還沒對照或送出才算；結果頁修改題目的暫存不算', () => {
    localStorage.setItem(draftKey('translation', 'gsat-115.s7g1@1'), JSON.stringify({ texts: ['I have', ''], updatedAt: at(7).getTime() }));
    localStorage.setItem(draftKey('essay', 'gsat-114.s8g1@1'), JSON.stringify({ text: '   ', updatedAt: at(8).getTime() }));
    localStorage.setItem(draftKey('essay', 'ai.cp.0e89ae@1'), JSON.stringify({ text: 'Lunch time', revealedAt: at(9).getTime(), updatedAt: at(9).getTime() }));
    localStorage.setItem(draftKey('essay', 'custom:essay@1'), JSON.stringify({ text: 'My school', aiSubmittedAt: null, updatedAt: at(6).getTime() }));
    localStorage.setItem(promptEditDraftKey('sub-1'), JSON.stringify({ text: '題目', updatedAt: at(10).getTime() }));
    expect(collectContinueItems(T0).map(({ title, to, detail }) => ({ title, to, detail }))).toEqual([
      { title: '115 學測 中譯英', to: '/writing/translation/gsat-115', detail: '寫作草稿' },
      { title: '自訂題目 英文作文', to: '/writing/essay/custom', detail: '寫作草稿' },
    ]);
  });

  it('送出 AI 批改之後：沒再改過的不算（歷屆題送出後草稿保留文字）；送出後又寫了新的才算（自訂題目只有一個草稿位置）', () => {
    const t = (minutes: number) => at(minutes).getTime();
    // 歷屆中譯英：TranslationAttemptPage 送出成功後留下的形狀（文字還在、submissionId 清掉、記下送出時間）。
    localStorage.setItem(
      draftKey('translation', 'gsat-115.s7g1@1'),
      JSON.stringify({ texts: ['I have', 'You'], submissionId: null, checked: [], errorCounts: [0, 0], aiSubmittedAt: t(5), updatedAt: t(5) }),
    );
    // 本站仿真作文：persistNow 寫 aiSubmittedAt 時 updatedAt 晚幾毫秒，仍是同一次送出。
    localStorage.setItem(draftKey('essay', 'ai.cp.0e89ae@1'), JSON.stringify({ text: 'Lunch time', revealedAt: null, aiSubmittedAt: t(6), updatedAt: t(6) + 3 }));
    // 自訂題目：第一篇送過 AI 批改，清除重寫後又寫了新的一篇（aiSubmittedAt 留著，updatedAt 晚很多）。
    localStorage.setItem(draftKey('essay', 'custom:essay@1'), JSON.stringify({ text: 'My second essay', aiSubmittedAt: t(1), updatedAt: t(9) }));
    // 本站仿真中譯英「重新作答」後還沒寫：沒有文字，不算。
    localStorage.setItem(draftKey('translation', 'ai.tr.1b2c4e@1'), JSON.stringify({ texts: ['', ''], revealedAt: null, aiSubmittedAt: t(2), updatedAt: t(3) }));
    expect(collectContinueItems(T0).map(({ title, to }) => ({ title, to }))).toEqual([{ title: '自訂題目 英文作文', to: '/writing/essay/custom' }]);

    // 歷屆中譯英送出後又改了：回到「做到一半」。
    localStorage.setItem(
      draftKey('translation', 'gsat-115.s7g1@1'),
      JSON.stringify({ texts: ['I have been', 'You'], submissionId: null, checked: [], errorCounts: [0, 0], aiSubmittedAt: t(5), updatedAt: t(5) + SUBMIT_GRACE_MS }),
    );
    expect(collectContinueItems(T0).map((i) => i.title)).toEqual(['自訂題目 英文作文', '115 學測 中譯英']);
  });

  it(`依最後更新時間新到舊，最多 ${CONTINUE_LIMIT} 張；壞掉的資料略過`, () => {
    for (const [i, id] of ['gsat-115', 'gsat-114', 'gsat-113', 'gsat-112', 'gsat-111'].entries()) saveAttempt(examAttempt(id, i, { '1': 'A' }));
    localStorage.setItem(draftKey('essay', 'gsat-110.s7g1@1'), '{oops');
    localStorage.setItem(attemptStorageKey('gsat-109'), '"nope"');
    expect(collectContinueItems(T0).map((i) => i.title)).toEqual(['111 學測', '112 學測', '113 學測', '114 學測']);
  });
});
