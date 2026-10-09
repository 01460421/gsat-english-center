/**
 * 首頁學習進度的數字：今日待複習（和單字頁同一套到期規則）、題庫練習的組數與答對率、錯題本字數，以及沒有紀錄時的判斷。
 * 日期一律用本地時間建構，結果不受執行環境的時區影響。
 */
import { describe, expect, it } from 'vitest';
import { emptyHistory, recordDone } from '../practice/history';
import { createMistakeBook, recordAnswer } from '../vocab/lib/mistakes';
import { addCard, createSrsState, type SrsState, type StoredCard } from '../vocab/lib/srs';
import { computeLocalStats, isEmptyStats, vocabHint } from './localStats';

const at = (d: number, h = 10) => new Date(2026, 9, d, h).getTime(); // 2026 年 10 月 d 日
const NOW = at(9);

function reviewCard(due: number): StoredCard {
  return {
    due,
    stability: 3,
    difficulty: 5,
    elapsed_days: 3,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    last_review: due - 3 * 86_400_000,
    added_at: at(1),
    updated_at: at(6),
  };
}

function srsWith(cards: Record<string, StoredCard>, streak?: SrsState['streak']): SrsState {
  const base = createSrsState(at(1));
  return { ...base, cards, ...(streak ? { streak } : {}) };
}

describe('computeLocalStats', () => {
  it('沒有任何紀錄：全部是 0，判斷為空', () => {
    const stats = computeLocalStats(createSrsState(NOW), createMistakeBook(NOW), emptyHistory(), NOW);
    expect(stats).toEqual({
      vocab: { cards: 0, dueToday: 0, dueNow: 0, learned: 0, streak: 0, reviewsDone: 0 },
      practice: { groups: 0, correct: 0, total: 0 },
      mistakes: 0,
    });
    expect(isEmptyStats(stats)).toBe(true);
  });

  it('單字：今天與之前到期的複習卡算待複習，明天才到期的不算', () => {
    const srs = srsWith(
      {
        'apple|n.|3': reviewCard(at(7)),
        'bridge|n.|3': reviewCard(at(9, 22)), // 今天稍晚到期：複習卡整天都算到期
        'candle|n.|4': reviewCard(at(11)),
      },
      { current: 3, longest: 5, last_day: '2026-10-08' },
    );
    const stats = computeLocalStats(srs, createMistakeBook(NOW), emptyHistory(), NOW);
    expect(stats.vocab).toEqual({ cards: 3, dueToday: 2, dueNow: 2, learned: 3, streak: 3, reviewsDone: 0 });
    expect(isEmptyStats(stats)).toBe(false);
  });

  it('今天已複習的次數：只算今天的紀錄，昨天的不算', () => {
    const today = { ...srsWith({ 'apple|n.|3': reviewCard(at(12)) }), today: { day: '2026-10-09', new_count: 2, review_count: 6 } };
    expect(computeLocalStats(today, createMistakeBook(NOW), emptyHistory(), NOW).vocab.reviewsDone).toBe(6);
    const yesterday = { ...today, today: { day: '2026-10-08', new_count: 2, review_count: 6 } };
    expect(computeLocalStats(yesterday, createMistakeBook(NOW), emptyHistory(), NOW).vocab.reviewsDone).toBe(0);
  });

  it('只有手動加入、還沒開始學的卡：不算待複習，但不算「沒有紀錄」', () => {
    const srs = addCard(createSrsState(NOW), 'apple|n.|3', NOW);
    const stats = computeLocalStats(srs, createMistakeBook(NOW), emptyHistory(), NOW);
    expect(stats.vocab).toMatchObject({ cards: 1, dueToday: 0, learned: 0 });
    expect(isEmptyStats(stats)).toBe(false);
  });

  it('題庫練習：做完的組數與所有題組加總的答對率', () => {
    let history = recordDone(emptyHistory(), 'ai.vo.aaa', {
      version: 1,
      section: 'vocabulary',
      tier: 'basic',
      at: '2026-10-08T02:00:00.000Z',
      correct: 7,
      total: 10,
      hinted: 1,
    });
    history = recordDone(history, 'ai.st.bbb', {
      version: 1,
      section: 'structure',
      tier: 'top',
      at: '2026-10-09T02:00:00.000Z',
      correct: 2,
      total: 5,
      hinted: 0,
    });
    const stats = computeLocalStats(createSrsState(NOW), createMistakeBook(NOW), history, NOW);
    expect(stats.practice).toEqual({ groups: 2, correct: 9, total: 15 });
    expect(isEmptyStats(stats)).toBe(false);
  });

  it('錯題本：字數', () => {
    let book = createMistakeBook(NOW);
    book = recordAnswer(book, { entryId: 'apple|n.|3', word: 'apple', mode: 'en2zh', correct: false }, false, NOW);
    book = recordAnswer(book, { entryId: 'bridge|n.|3', word: 'bridge', mode: 'cloze', correct: false, source: 'bank_practice' }, false, NOW);
    const stats = computeLocalStats(createSrsState(NOW), book, emptyHistory(), NOW);
    expect(stats.mistakes).toBe(2);
    expect(isEmptyStats(stats)).toBe(false);
  });
});

describe('vocabHint', () => {
  const base = { cards: 0, dueToday: 0, dueNow: 0, learned: 0, streak: 0, reviewsDone: 0 };
  it('還沒開始、只加入了卡片、今天複習完、今天沒有要複習的、還有稍晚到期的', () => {
    expect(vocabHint(base)).toBe('還沒開始每日學習');
    expect(vocabHint({ ...base, cards: 2 })).toBe('已加入 2 個字，還沒開始學');
    expect(vocabHint({ ...base, cards: 30, learned: 30, streak: 4, reviewsDone: 12 })).toBe('今天的複習完成了・已學過 30 個字・連續 4 天');
    // 今天沒有到期的字、也沒複習過（例如全部幾天後才到期）：不能說「完成了」。
    expect(vocabHint({ ...base, cards: 30, learned: 30, streak: 2 })).toBe('今天沒有要複習的字・已學過 30 個字・連續 2 天');
    expect(vocabHint({ ...base, cards: 30, learned: 30, dueToday: 5, dueNow: 3 })).toBe('3 個已到期・已學過 30 個字');
    expect(vocabHint({ ...base, cards: 30, learned: 30, dueToday: 5, dueNow: 5, streak: 1 })).toBe('已學過 30 個字・連續 1 天');
  });
});
