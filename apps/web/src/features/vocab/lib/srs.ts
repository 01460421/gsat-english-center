/**
 * 每日學習（間隔重複）的狀態模型：排程、序列化與今日進度。純函式，存取 localStorage 的部分在 storage.ts。
 *
 * 排程用 ts-fsrs（FSRS 演算法，MIT）。存檔格式刻意和 ts-fsrs 的 Card 分開定義：
 *   - 日期存成毫秒數字，JSON 才能原樣來回；
 *   - 欄位用 snake_case，和題庫、資料檔、之後的後端 API 一致；
 *   - 外層有 schema 與 version，之後登入同步到後端（D1）或改格式時可以辨認、遷移，不會把舊資料誤讀成新格式；
 *   - 每張卡有 updated_at，同步時可以逐張「新的蓋舊的」合併兩台裝置的進度。
 *
 * 「一天」從凌晨 4 點開始（DAY_ROLLOVER_HOUR）：高中生常讀到半夜，0–4 點的複習算前一天，
 * 連續天數才不會因為過了午夜就重算或多算一天（Anki 也是這樣設計）。
 */
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { VocabLevel } from '../../../data/vocab';
import { isVocabLevel, levelFromEntryId } from '../../../data/vocab';
import { DEFAULT_LEVELS } from './search';

export const SRS_STORAGE_KEY = 'gsat-vocab-srs';
export const SRS_SCHEMA = 'gsat-vocab-srs';
export const SRS_VERSION = 1;

export const DEFAULT_DAILY_NEW = 10;
export const DAILY_NEW_CHOICES = [5, 10, 15, 20, 30] as const;
const MAX_DAILY_NEW = 100;

export const DAY_ROLLOVER_HOUR = 4;
/** 學習中的卡片（以分鐘計的步驟）提前多久可以先複習：和 Anki 的 learn ahead limit 相同，20 分鐘。 */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

/** ts-fsrs 的 State 數值：0 新卡、1 學習中、2 複習、3 重新學習。 */
export type StoredState = 0 | 1 | 2 | 3;

export interface StoredCard {
  /** 下次到期時間（毫秒）。 */
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: StoredState;
  last_review: number | null;
  /** 加入學習的時間。 */
  added_at: number;
  /** 最後修改時間（同步合併用）。 */
  updated_at: number;
}

export interface SrsSettings {
  /** 每日新字數。 */
  daily_new: number;
  /** 新字的學習範圍（級別）。到期的複習不受影響：換了範圍，以前學過的字照樣要複習。 */
  levels: VocabLevel[];
}

export interface SrsState {
  schema: typeof SRS_SCHEMA;
  version: typeof SRS_VERSION;
  settings: SrsSettings;
  /** 條目 id → 卡片。 */
  cards: Record<string, StoredCard>;
  /** 今天（day）學了幾個新字、複習了幾次；換日後歸零。 */
  today: { day: string; new_count: number; review_count: number };
  /** 連續學習天數。last_day 是最後一次有評分的日子。 */
  streak: { current: number; longest: number; last_day: string | null };
  updated_at: number;
}

/**
 * 排程器。maximum_interval 設 180 天而不是預設的 100 年：學生是為了一兩年內的學測準備，
 * 間隔再長，考前就再也看不到這個字了；最長半年複習一次，考前每個學過的字至少會再出現。
 * enable_fuzz 讓同一天學的字不會在同一天一起到期（ts-fsrs 依卡片內容決定亂數，結果可重現）。
 */
const scheduler = fsrs({ request_retention: 0.9, maximum_interval: 180, enable_fuzz: true, enable_short_term: true });

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

function formatDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 學習日（YYYY-MM-DD，本地時間，凌晨 4 點換日）。字串可以直接比大小。 */
export function dayKey(time: Date | number): string {
  const d = new Date(typeof time === 'number' ? time : time.getTime());
  d.setHours(d.getHours() - DAY_ROLLOVER_HOUR);
  return formatDay(d);
}

function parseDay(day: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return [y, m, d];
}

export function previousDay(day: string): string {
  const [y, m, d] = parseDay(day);
  return formatDay(new Date(y, m - 1, d - 1));
}

/** 下一個學習日開始的時間（毫秒）。 */
export function nextDayStart(now: Date | number): number {
  const [y, m, d] = parseDay(dayKey(now));
  return new Date(y, m - 1, d + 1, DAY_ROLLOVER_HOUR).getTime();
}

// ---------------------------------------------------------------------------
// 建立、序列化、讀取
// ---------------------------------------------------------------------------

export function createSrsState(now: number): SrsState {
  return {
    schema: SRS_SCHEMA,
    version: SRS_VERSION,
    settings: { daily_new: DEFAULT_DAILY_NEW, levels: [...DEFAULT_LEVELS] },
    cards: {},
    today: { day: dayKey(now), new_count: 0, review_count: 0 },
    streak: { current: 0, longest: 0, last_day: null },
    updated_at: now,
  };
}

export function serializeSrsState(state: SrsState): string {
  return JSON.stringify(state);
}

/**
 * 讀取結果：
 *   ok       正常讀到
 *   empty    沒有存檔（第一次使用）
 *   invalid  存檔壞掉或不是這個格式：從頭開始
 *   newer    存檔是比這個版本新的格式（例如另一個分頁已經更新網站）：先用空白狀態，而且不要覆寫它
 */
export type LoadStatus = 'ok' | 'empty' | 'invalid' | 'newer';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNegInt = (v: unknown, fallback = 0): number => (finite(v) && v >= 0 ? Math.floor(v) : fallback);
const isDayString = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function parseCard(value: unknown, now: number): StoredCard | null {
  if (!isObject(value)) return null;
  const { due, stability, difficulty, state } = value;
  if (!finite(due) || !finite(stability) || !finite(difficulty)) return null;
  if (state !== 0 && state !== 1 && state !== 2 && state !== 3) return null;
  const lastReview = value['last_review'];
  return {
    due,
    stability,
    difficulty,
    elapsed_days: nonNegInt(value['elapsed_days']),
    scheduled_days: nonNegInt(value['scheduled_days']),
    learning_steps: nonNegInt(value['learning_steps']),
    reps: nonNegInt(value['reps']),
    lapses: nonNegInt(value['lapses']),
    state,
    last_review: finite(lastReview) ? lastReview : null,
    added_at: finite(value['added_at']) ? value['added_at'] : now,
    updated_at: finite(value['updated_at']) ? value['updated_at'] : now,
  };
}

function parseSettings(value: unknown): SrsSettings {
  const fallback: SrsSettings = { daily_new: DEFAULT_DAILY_NEW, levels: [...DEFAULT_LEVELS] };
  if (!isObject(value)) return fallback;
  const dailyNew = value['daily_new'];
  const levels = Array.isArray(value['levels']) ? [...new Set(value['levels'].filter(isVocabLevel))].sort((a, b) => a - b) : [];
  return {
    daily_new: finite(dailyNew) && dailyNew >= 1 ? Math.min(MAX_DAILY_NEW, Math.floor(dailyNew)) : fallback.daily_new,
    levels: levels.length > 0 ? levels : fallback.levels,
  };
}

/**
 * 從 localStorage 的字串還原。逐欄檢查：單張卡片壞掉只丟那一張，不讓整份進度作廢；
 * 卡片的鍵要是合法的條目 id（也順便擋掉 "__proto__" 這種鍵）。
 */
export function parseSrsState(raw: string | null, now: number): { state: SrsState; status: LoadStatus } {
  if (raw === null) return { state: createSrsState(now), status: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { state: createSrsState(now), status: 'invalid' };
  }
  if (!isObject(data) || data['schema'] !== SRS_SCHEMA || !finite(data['version'])) {
    return { state: createSrsState(now), status: 'invalid' };
  }
  if (data['version'] > SRS_VERSION) return { state: createSrsState(now), status: 'newer' };
  if (data['version'] !== SRS_VERSION) return { state: createSrsState(now), status: 'invalid' };

  const cards: Record<string, StoredCard> = {};
  if (isObject(data['cards'])) {
    for (const [id, value] of Object.entries(data['cards'])) {
      if (levelFromEntryId(id) === null) continue;
      const card = parseCard(value, now);
      if (card) cards[id] = card;
    }
  }
  const today = isObject(data['today']) ? data['today'] : {};
  const streak = isObject(data['streak']) ? data['streak'] : {};
  const todayDay = today['day'];
  const lastDay = streak['last_day'];
  const current = nonNegInt(streak['current']);
  return {
    state: {
      schema: SRS_SCHEMA,
      version: SRS_VERSION,
      settings: parseSettings(data['settings']),
      cards,
      today: {
        day: isDayString(todayDay) ? todayDay : dayKey(now),
        new_count: nonNegInt(today['new_count']),
        review_count: nonNegInt(today['review_count']),
      },
      streak: {
        current,
        longest: Math.max(current, nonNegInt(streak['longest'])),
        last_day: isDayString(lastDay) ? lastDay : null,
      },
      updated_at: finite(data['updated_at']) ? data['updated_at'] : now,
    },
    status: 'ok',
  };
}

// ---------------------------------------------------------------------------
// ts-fsrs 的 Card 與存檔格式互轉
// ---------------------------------------------------------------------------

const STATES: readonly State[] = [State.New, State.Learning, State.Review, State.Relearning];

function toStoredState(state: State): StoredState {
  switch (state) {
    case State.New:
      return 0;
    case State.Learning:
      return 1;
    case State.Review:
      return 2;
    case State.Relearning:
      return 3;
  }
}

export function toFsrsCard(c: StoredCard): Card {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: STATES[c.state] ?? State.New,
    ...(c.last_review === null ? {} : { last_review: new Date(c.last_review) }),
  };
}

export function fromFsrsCard(card: Card, addedAt: number, now: number): StoredCard {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: toStoredState(card.state),
    last_review: card.last_review ? card.last_review.getTime() : null,
    added_at: addedAt,
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// 評分
// ---------------------------------------------------------------------------

/** 四個評分鈕（順序就是畫面上的順序，key 是鍵盤快捷鍵）。 */
export const SRS_GRADES: readonly { grade: Grade; label: string; key: string }[] = [
  { grade: Rating.Again, label: '重來', key: '1' },
  { grade: Rating.Hard, label: '困難', key: '2' },
  { grade: Rating.Good, label: '良好', key: '3' },
  { grade: Rating.Easy, label: '簡單', key: '4' },
];

function rollToday(state: SrsState, day: string): SrsState['today'] {
  return state.today.day === day ? state.today : { day, new_count: 0, review_count: 0 };
}

function bumpStreak(streak: SrsState['streak'], day: string): SrsState['streak'] {
  if (streak.last_day === day) return streak;
  const current = streak.last_day === previousDay(day) ? streak.current + 1 : 1;
  return { current, longest: Math.max(streak.longest, current), last_day: day };
}

/** 對一個字評分，回傳新狀態（不改動輸入）。還沒有卡片的字（新字）會在這裡建立。 */
export function rateCard(state: SrsState, entryId: string, grade: Grade, now: Date): SrsState {
  const prev = state.cards[entryId];
  const card = prev ? toFsrsCard(prev) : createEmptyCard(now);
  const next = scheduler.next(card, now, grade).card;
  const t = now.getTime();
  const wasNew = !prev || prev.state === 0;
  const day = dayKey(now);
  const today = rollToday(state, day);
  return {
    ...state,
    cards: { ...state.cards, [entryId]: fromFsrsCard(next, prev?.added_at ?? t, t) },
    today: {
      day,
      new_count: today.new_count + (wasNew ? 1 : 0),
      review_count: today.review_count + (wasNew ? 0 : 1),
    },
    streak: bumpStreak(state.streak, day),
    updated_at: t,
  };
}

/** 每個評分鈕按下去之後的到期時間（毫秒），按鈕上顯示「10 分鐘」「3 天」用。 */
export function previewDue(stored: StoredCard | undefined, now: Date): Record<Grade, number> {
  const card = stored ? toFsrsCard(stored) : createEmptyCard(now);
  const due = (grade: Grade) => scheduler.next(card, now, grade).card.due.getTime();
  return {
    [Rating.Again]: due(Rating.Again),
    [Rating.Hard]: due(Rating.Hard),
    [Rating.Good]: due(Rating.Good),
    [Rating.Easy]: due(Rating.Easy),
  };
}

/** 間隔的中文說法：「1 分鐘」「3 小時」「5 天」「2 個月」。 */
export function formatInterval(ms: number): string {
  const minutes = Math.max(0, ms) / 60_000;
  if (minutes < 1) return '不到 1 分鐘';
  if (minutes < 60) return `${Math.round(minutes)} 分鐘`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} 小時`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} 天`;
  if (days < 365) return `${Math.round(days / 30)} 個月`;
  return `${Math.round((days / 365) * 10) / 10} 年`;
}

// ---------------------------------------------------------------------------
// 卡片管理
// ---------------------------------------------------------------------------

/** 從單字卡手動加入學習：建立一張新卡，下次學習時優先出現。已經在學的字不變。 */
export function addCard(state: SrsState, entryId: string, now: number): SrsState {
  if (state.cards[entryId]) return state;
  const card = fromFsrsCard(createEmptyCard(new Date(now)), now, now);
  return { ...state, cards: { ...state.cards, [entryId]: card }, updated_at: now };
}

export function removeCard(state: SrsState, entryId: string, now: number): SrsState {
  if (!state.cards[entryId]) return state;
  const cards = { ...state.cards };
  delete cards[entryId];
  return { ...state, cards, updated_at: now };
}

export function updateSettings(state: SrsState, patch: Partial<SrsSettings>, now: number): SrsState {
  const settings = parseSettings({ ...state.settings, ...patch });
  return { ...state, settings, updated_at: now };
}

// ---------------------------------------------------------------------------
// 今日進度與學習佇列
// ---------------------------------------------------------------------------

/**
 * 到期判斷：
 *   - 複習中的卡（間隔以天計）：到期「那一天」整天都算到期，不必等到幾點幾分（早上讀書就能把今天的字複習完）；
 *   - 學習中／重新學習的卡（間隔以分鐘計）：看實際時間，可提前 LEARN_AHEAD_MS。
 * 新卡（手動加入的）不算「到期」，另外當新字處理。
 */
export function isDue(card: StoredCard, now: number): boolean {
  if (card.state === 0) return false;
  if (card.state === 2) return dayKey(card.due) <= dayKey(now);
  return card.due <= now + LEARN_AHEAD_MS;
}

/** 新字候選（來自單字索引）。 */
export interface SrsCandidate {
  id: string;
  level: VocabLevel;
  exam_total: number;
}

/** 今天還能學幾個新字（每日上限扣掉今天已學的）。 */
export function newQuotaLeft(state: SrsState, now: number): number {
  const today = rollToday(state, dayKey(now));
  return Math.max(0, state.settings.daily_new - today.new_count);
}

/**
 * 今天的新字：先放手動加入的（依加入時間），剩下的名額從學習範圍裡挑還沒學過的字，
 * 依歷屆出現次數由多到少（「先背最常考的字」，03 文件 §9.5），同分時低級別在前。
 * 手動加入的字不受每日上限限制：那是學生自己點的，不該藏起來。
 */
export function pickNewCards(state: SrsState, candidates: readonly SrsCandidate[], now: number): string[] {
  const manual = Object.entries(state.cards)
    .filter(([, c]) => c.state === 0)
    .sort((a, b) => a[1].added_at - b[1].added_at)
    .map(([id]) => id);
  const room = Math.max(0, newQuotaLeft(state, now) - manual.length);
  if (room === 0) return manual;
  const levels = new Set<number>(state.settings.levels);
  const fresh = candidates
    .filter((c) => levels.has(c.level) && !state.cards[c.id])
    .sort((a, b) => b.exam_total - a.exam_total || a.level - b.level || a.id.localeCompare(b.id, 'en'))
    .slice(0, room)
    .map((c) => c.id);
  return [...manual, ...fresh];
}

/** 開始學習時的佇列：先複習到期的字（最早到期的先），再學新字。 */
export function buildStudyQueue(state: SrsState, candidates: readonly SrsCandidate[], now: number): string[] {
  const due = Object.entries(state.cards)
    .filter(([, c]) => isDue(c, now))
    .sort((a, b) => a[1].due - b[1].due)
    .map(([id]) => id);
  return [...due, ...pickNewCards(state, candidates, now)];
}

/**
 * 評分後更新佇列：拿掉剛評分的字；如果它還在短期學習步驟（例如按「重來」後 1 分鐘再看），
 * 而且在提前量之內到期，就排回佇列最後，同一輪學習裡會再出現一次。
 */
export function advanceQueue(queue: readonly string[], entryId: string, state: SrsState, now: number): string[] {
  const index = queue.indexOf(entryId);
  const rest = index === -1 ? queue.slice() : [...queue.slice(0, index), ...queue.slice(index + 1)];
  const card = state.cards[entryId];
  if (card && card.state !== 2 && card.due <= now + LEARN_AHEAD_MS) rest.push(entryId);
  return rest;
}

export interface StudySummary {
  /** 現在就可以複習的字數。 */
  dueNow: number;
  /** 今天（到明天凌晨 4 點前）要複習的字數，含稍晚才到期的學習中卡片。 */
  dueToday: number;
  /** 今天還要學的新字數。 */
  newToday: number;
  /** 今天已學的新字與複習次數。 */
  newDone: number;
  reviewsDone: number;
  /** 學過的字（不含還沒開始的手動加入卡）。 */
  learned: number;
  /** 連續學習天數（昨天或今天有學才算延續）。 */
  streak: number;
  longestStreak: number;
}

export function currentStreak(state: SrsState, now: number): number {
  const day = dayKey(now);
  const last = state.streak.last_day;
  return last === day || last === previousDay(day) ? state.streak.current : 0;
}

export function studySummary(state: SrsState, candidates: readonly SrsCandidate[], now: number): StudySummary {
  const end = nextDayStart(now);
  const today = rollToday(state, dayKey(now));
  let dueNow = 0;
  let dueToday = 0;
  let learned = 0;
  for (const card of Object.values(state.cards)) {
    if (card.state === 0) continue;
    learned += 1;
    if (isDue(card, now)) dueNow += 1;
    if (card.state === 2 ? isDue(card, now) : card.due < end) dueToday += 1;
  }
  return {
    dueNow,
    dueToday,
    newToday: pickNewCards(state, candidates, now).length,
    newDone: today.new_count,
    reviewsDone: today.review_count,
    learned,
    streak: currentStreak(state, now),
    longestStreak: state.streak.longest,
  };
}
