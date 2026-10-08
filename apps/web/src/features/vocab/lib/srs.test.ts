/**
 * 間隔重複的狀態：序列化（存進 localStorage 再讀回來要一模一樣，壞掉的資料不能讓整份進度作廢）、
 * 評分後的排程與今日進度、學習日的換日規則與連續天數。
 * 日期一律用本地時間建構（new Date(年, 月, 日, 時)），測試結果不受執行環境的時區影響。
 */
import { Rating, State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import {
  addCard,
  advanceQueue,
  buildStudyQueue,
  createSrsState,
  currentStreak,
  dayKey,
  formatInterval,
  fromFsrsCard,
  isDue,
  nextDayStart,
  parseSrsState,
  pickNewCards,
  previewDue,
  previousDay,
  rateCard,
  removeCard,
  serializeSrsState,
  SRS_SCHEMA,
  SRS_VERSION,
  studySummary,
  toFsrsCard,
  updateSettings,
  type SrsCandidate,
  type SrsState,
} from './srs';

const at = (d: number, h = 10, min = 0) => new Date(2026, 9, d, h, min); // 2026 年 10 月 d 日（本地時間）

const CANDIDATES: SrsCandidate[] = [
  { id: 'apple|n.|3', level: 3, exam_total: 5 },
  { id: 'bridge|n.|3', level: 3, exam_total: 40 },
  { id: 'candle|n.|4', level: 4, exam_total: 40 },
  { id: 'desert|n.|5', level: 5, exam_total: 0 },
  { id: 'basic|adj.|1', level: 1, exam_total: 999 },
];

function studied(): SrsState {
  let s = createSrsState(at(8).getTime());
  s = rateCard(s, 'apple|n.|3', Rating.Good, at(8, 10));
  s = rateCard(s, 'bridge|n.|3', Rating.Again, at(8, 10, 1));
  s = rateCard(s, 'apple|n.|3', Rating.Good, at(8, 10, 15));
  return s;
}

describe('序列化', () => {
  it('serialize → parse 來回一模一樣，格式帶 schema 與版本號', () => {
    const s = addCard(studied(), 'candle|n.|4', at(8, 11).getTime());
    const raw = serializeSrsState(s);
    const json: unknown = JSON.parse(raw);
    expect(json).toMatchObject({ schema: SRS_SCHEMA, version: SRS_VERSION });
    const { state, status } = parseSrsState(raw, at(9).getTime());
    expect(status).toBe('ok');
    expect(state).toEqual(s);
  });

  it('沒有存檔：status empty，給預設狀態（每日 10 個新字、L3–5）', () => {
    const { state, status } = parseSrsState(null, at(8).getTime());
    expect(status).toBe('empty');
    expect(state.settings).toEqual({ daily_new: 10, levels: [3, 4, 5] });
    expect(state.cards).toEqual({});
  });

  it('壞掉的 JSON、別的格式：status invalid，從頭開始', () => {
    expect(parseSrsState('{oops', 0).status).toBe('invalid');
    expect(parseSrsState('[]', 0).status).toBe('invalid');
    expect(parseSrsState(JSON.stringify({ schema: 'other', version: 1 }), 0).status).toBe('invalid');
  });

  it('較新版本的存檔：status newer（呼叫端不可覆寫）', () => {
    expect(parseSrsState(JSON.stringify({ schema: SRS_SCHEMA, version: SRS_VERSION + 1, cards: {} }), 0).status).toBe('newer');
  });

  it('單張壞掉的卡片只丟那一張；不合法的鍵（含 __proto__）不收', () => {
    const good = studied().cards['apple|n.|3'];
    if (!good) throw new Error('沒有卡片');
    const raw = `{"schema":"${SRS_SCHEMA}","version":${SRS_VERSION},"cards":{"apple|n.|3":${JSON.stringify(good)},"bad|n.|3":{"due":"tomorrow"},"no-level":${JSON.stringify(good)},"__proto__":${JSON.stringify(good)}}}`;
    const { state, status } = parseSrsState(raw, 0);
    expect(status).toBe('ok');
    expect(Object.keys(state.cards)).toEqual(['apple|n.|3']);
    expect(Object.getPrototypeOf(state.cards)).toBe(Object.prototype);
  });

  it('設定值不合理時修正：每日新字數至少 1、最多 100；級別去重、排序、空的用預設', () => {
    const raw = JSON.stringify({ schema: SRS_SCHEMA, version: SRS_VERSION, settings: { daily_new: 9999, levels: [5, 3, 3, 9, 'x'] } });
    expect(parseSrsState(raw, 0).state.settings).toEqual({ daily_new: 100, levels: [3, 5] });
    const empty = JSON.stringify({ schema: SRS_SCHEMA, version: SRS_VERSION, settings: { daily_new: 0, levels: [] } });
    expect(parseSrsState(empty, 0).state.settings).toEqual({ daily_new: 10, levels: [3, 4, 5] });
  });

  it('ts-fsrs Card ↔ 存檔格式互轉不失真', () => {
    const s = studied();
    for (const stored of Object.values(s.cards)) {
      const card = toFsrsCard(stored);
      expect(card.due).toBeInstanceOf(Date);
      expect(fromFsrsCard(card, stored.added_at, stored.updated_at)).toEqual(stored);
    }
  });
});

describe('評分', () => {
  it('新字評分後建立卡片、計入今日新字與連續天數', () => {
    const s = rateCard(createSrsState(at(8).getTime()), 'apple|n.|3', Rating.Good, at(8));
    const card = s.cards['apple|n.|3'];
    expect(card?.state).not.toBe(0);
    expect(card?.due).toBeGreaterThan(at(8).getTime());
    expect(s.today).toEqual({ day: '2026-10-08', new_count: 1, review_count: 0 });
    expect(s.streak).toEqual({ current: 1, longest: 1, last_day: '2026-10-08' });
  });

  it('同一天再評分算複習；不改動輸入的狀態物件', () => {
    const s1 = rateCard(createSrsState(0), 'apple|n.|3', Rating.Again, at(8));
    const snapshot = JSON.stringify(s1);
    const s2 = rateCard(s1, 'apple|n.|3', Rating.Good, at(8, 10, 2));
    expect(JSON.stringify(s1)).toBe(snapshot);
    expect(s2.today).toMatchObject({ new_count: 1, review_count: 1 });
    expect(s2.cards['apple|n.|3']?.reps).toBe(2);
  });

  it('「重來」的卡在幾分鐘內到期，「簡單」的間隔最長', () => {
    const due = previewDue(undefined, at(8));
    const now = at(8).getTime();
    expect(due[Rating.Again] - now).toBeLessThanOrEqual(10 * 60_000);
    expect(due[Rating.Easy]).toBeGreaterThan(due[Rating.Good]);
    expect(due[Rating.Good]).toBeGreaterThanOrEqual(due[Rating.Hard]);
  });

  // ts-fsrs 先把三個間隔各自限制在 maximum_interval，再強制「困難＜良好＜簡單」各差至少 1 天，
  // 所以「簡單」最多是上限＋2 天。重點是不會出現一年以上、考前再也看不到的間隔。
  it('最長間隔約 180 天（上限＋最多 2 天）', () => {
    let s = createSrsState(0);
    let t = at(1);
    for (let i = 0; i < 12; i += 1) {
      s = rateCard(s, 'apple|n.|3', Rating.Easy, t);
      t = new Date(s.cards['apple|n.|3']?.due ?? 0);
    }
    expect(s.cards['apple|n.|3']?.scheduled_days).toBeLessThanOrEqual(182);
  });
});

describe('學習日與連續天數', () => {
  it('凌晨 4 點才換日：半夜 1 點還算前一天', () => {
    expect(dayKey(at(9, 1))).toBe('2026-10-08');
    expect(dayKey(at(9, 4))).toBe('2026-10-09');
    expect(previousDay('2026-10-01')).toBe('2026-09-30');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
    expect(nextDayStart(at(9, 1))).toBe(at(9, 4).getTime());
  });

  it('連續兩天學習 → 2 天；中斷一天 → 重新從 1 開始；最長紀錄保留', () => {
    let s = rateCard(createSrsState(0), 'a|n.|3', Rating.Good, at(8));
    s = rateCard(s, 'b|n.|3', Rating.Good, at(9, 23));
    s = rateCard(s, 'c|n.|3', Rating.Good, at(10, 2)); // 凌晨 2 點：仍是 9 日，不加天數
    expect(s.streak).toMatchObject({ current: 2, longest: 2 });
    expect(currentStreak(s, at(10, 12).getTime())).toBe(2); // 昨天有學，今天還沒學：連續中
    expect(currentStreak(s, at(11, 12).getTime())).toBe(0); // 前天之後就斷了
    s = rateCard(s, 'd|n.|3', Rating.Good, at(12));
    expect(s.streak).toMatchObject({ current: 1, longest: 2 });
  });

  it('換日後今日計數歸零', () => {
    let s = rateCard(createSrsState(0), 'a|n.|3', Rating.Good, at(8));
    s = rateCard(s, 'b|n.|3', Rating.Good, at(9));
    expect(s.today).toEqual({ day: '2026-10-09', new_count: 1, review_count: 0 });
  });
});

describe('學習佇列', () => {
  it('新字依歷屆出現次數由多到少、同分時低級別在前；只取學習範圍內；每日上限', () => {
    let s = createSrsState(at(8).getTime());
    s = updateSettings(s, { daily_new: 2 }, 0);
    expect(pickNewCards(s, CANDIDATES, at(8).getTime())).toEqual(['bridge|n.|3', 'candle|n.|4']);
    s = rateCard(s, 'bridge|n.|3', Rating.Good, at(8));
    expect(pickNewCards(s, CANDIDATES, at(8, 11).getTime())).toEqual(['candle|n.|4']);
    s = rateCard(s, 'candle|n.|4', Rating.Good, at(8, 11));
    expect(pickNewCards(s, CANDIDATES, at(8, 12).getTime())).toEqual([]);
    // 隔天名額恢復
    expect(pickNewCards(s, CANDIDATES, at(9, 12).getTime())).toEqual(['apple|n.|3', 'desert|n.|5']);
  });

  it('手動加入的字排在最前面，而且不受每日上限限制', () => {
    let s = updateSettings(createSrsState(0), { daily_new: 1 }, 0);
    s = addCard(s, 'basic|adj.|1', 1);
    s = addCard(s, 'desert|n.|5', 2);
    expect(pickNewCards(s, CANDIDATES, at(8).getTime())).toEqual(['basic|adj.|1', 'desert|n.|5']);
    expect(addCard(s, 'basic|adj.|1', 3)).toBe(s); // 已經在學的字不重複加入
    expect(removeCard(s, 'basic|adj.|1', 4).cards['basic|adj.|1']).toBeUndefined();
  });

  it('先複習到期的字（最早到期的先），再學新字', () => {
    let s = studied();
    // 十天後：apple、bridge 都到期了
    const later = at(18).getTime();
    s = updateSettings(s, { daily_new: 1 }, 0);
    const queue = buildStudyQueue(s, CANDIDATES, later);
    const dueApple = s.cards['apple|n.|3']?.due ?? 0;
    const dueBridge = s.cards['bridge|n.|3']?.due ?? 0;
    expect(queue.slice(0, 2)).toEqual(dueApple <= dueBridge ? ['apple|n.|3', 'bridge|n.|3'] : ['bridge|n.|3', 'apple|n.|3']);
    expect(queue[2]).toBe('candle|n.|4');
  });

  it('複習卡在到期當天整天都算到期；學習中的卡看實際時間（可提前 20 分鐘）', () => {
    const s = rateCard(createSrsState(0), 'a|n.|3', Rating.Good, at(8, 10));
    let card = s.cards['a|n.|3'];
    if (!card) throw new Error('沒有卡片');
    card = { ...card, state: 2, due: at(12, 22).getTime() };
    expect(isDue(card, at(12, 5).getTime())).toBe(true);
    expect(isDue(card, at(11, 23).getTime())).toBe(false);
    const learning = { ...card, state: 1 as const, due: at(8, 10, 30).getTime() };
    expect(isDue(learning, at(8, 10, 15).getTime())).toBe(true);
    expect(isDue(learning, at(8, 10, 5).getTime())).toBe(false);
  });

  it('按「重來」的卡排回本輪最後；學會的卡離開佇列', () => {
    const t = at(8);
    let s = createSrsState(t.getTime());
    s = rateCard(s, 'apple|n.|3', Rating.Again, t);
    expect(advanceQueue(['apple|n.|3', 'bridge|n.|3'], 'apple|n.|3', s, t.getTime())).toEqual(['bridge|n.|3', 'apple|n.|3']);
    s = rateCard(s, 'bridge|n.|3', Rating.Easy, t);
    expect(s.cards['bridge|n.|3']?.state).toBe(State.Review);
    expect(advanceQueue(['bridge|n.|3', 'apple|n.|3'], 'bridge|n.|3', s, t.getTime())).toEqual(['apple|n.|3']);
  });

  it('今日進度：待複習、新字、連續天數', () => {
    const s = studied();
    const summary = studySummary(s, CANDIDATES, at(8, 10, 20).getTime());
    expect(summary.newDone).toBe(2);
    expect(summary.learned).toBe(2);
    expect(summary.streak).toBe(1);
    expect(summary.newToday).toBe(2); // 名額還有 10−2 個，但範圍內（L3–5）沒學過的只剩 candle、desert
    expect(summary.dueToday).toBeGreaterThanOrEqual(1); // 按過「重來」的 bridge 今天稍晚會再出現
  });
});

describe('formatInterval', () => {
  it('分鐘、小時、天、月、年', () => {
    expect(formatInterval(30_000)).toBe('不到 1 分鐘');
    expect(formatInterval(10 * 60_000)).toBe('10 分鐘');
    expect(formatInterval(3 * 3600_000)).toBe('3 小時');
    expect(formatInterval(5 * 86400_000)).toBe('5 天');
    expect(formatInterval(60 * 86400_000)).toBe('2 個月');
    expect(formatInterval(400 * 86400_000)).toBe('1.1 年');
  });
});
